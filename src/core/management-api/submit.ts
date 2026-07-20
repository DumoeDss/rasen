/**
 * `POST /api/v1/changes` submission bridge (change-submission design D2/D3).
 *
 * The server never writes workspace files or reimplements change-creation
 * logic: it validates input, then spawns the CLI's own `dist/cli/index.js`
 * entry (never PATH) as `new change <name> --proposal=<description> --json`,
 * with `shell: false` and an argv array, and passes the CLI's exit code and
 * output through verbatim. The whitelist (design D2/D7) is the shared
 * tiered table in `whitelist.ts` — this bridge admits only the bounded-cli
 * tier's one entry, create-change (checked via `getBoundedCliEntry`); the
 * supervised long-runner tier is served exclusively by `sessions.ts`.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import * as path from 'node:path';

import { validateChangeName } from '../../utils/change-utils.js';
import type { ManagementApiContext } from './router.js';
import { getBoundedCliEntry } from './whitelist.js';
import type { SubmitChangeResponse } from './wire-types.js';

const require = createRequire(import.meta.url);

/** Length cap on the submitted description (design D3). */
const MAX_DESCRIPTION_LENGTH = 10_000;

/** Hard timeout on the subprocess (design D3): generous for a filesystem command. */
const DEFAULT_TIMEOUT_MS = 30_000;

/** Grace period between SIGTERM and SIGKILL on timeout (design D3). */
const DEFAULT_KILL_GRACE_MS = 2_000;

/**
 * Matches any C0 control character or DEL — rejected in the submitted
 * description — EXCEPT `\t` (tab) and `\n` (newline), which are permitted:
 * the board's textarea naturally produces multi-line text destined for a
 * `## Why` section, and the value is still bound into exactly one
 * `--proposal=<text>` argv token either way, so the injection posture is
 * unaffected (review M2).
 */
export const CONTROL_CHAR_PATTERN = /[\x00-\x08\x0b-\x1f\x7f]/;

export type SubmitResult =
  | { ok: true; status: 201; response: SubmitChangeResponse }
  | { ok: false; status: number; code: string; message: string; cliExitCode?: number; stderr?: string };

/**
 * Resolves the CLI entry belonging to this very server process's own
 * installation (design D3), never whatever `rasen` happens to be on PATH.
 * `package.json` sits at the same relative depth above this module whether
 * it is running from `src/core/management-api/` (tests, ts-node) or the
 * compiled `dist/core/management-api/` (the shipped CLI), so the same
 * relative path resolves the installation root in both cases.
 */
function resolveCliEntry(): string {
  const pkgPath = require.resolve('../../../package.json');
  return path.join(path.dirname(pkgPath), 'dist', 'cli', 'index.js');
}

function validateDescription(description: unknown): string | null {
  if (typeof description !== 'string' || description.length === 0) {
    return 'description must be a non-empty string.';
  }
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    return `description must be at most ${MAX_DESCRIPTION_LENGTH} characters.`;
  }
  if (CONTROL_CHAR_PATTERN.test(description)) {
    return 'description must not contain control characters.';
  }
  return null;
}

/**
 * Parses the CLI's `--json` stdout for `newChangeCommand`'s success shape.
 * Known, accepted limitation (review t3): requires the stdout to be pure
 * JSON — any future stdout pollution ahead of the JSON payload (an update
 * notice, a stray warning) would turn a successful creation into a 500
 * `cli_protocol_error`. Not hardened against on purpose: the contract is
 * honest and tested today, and a more lenient parse (e.g. "last JSON line")
 * risks silently accepting output that was never meant to be machine-read.
 */
function parseSuccessPayload(stdout: string): SubmitChangeResponse | null {
  try {
    const parsed = JSON.parse(stdout) as { change?: { id?: unknown; path?: unknown; schema?: unknown } };
    const change = parsed.change;
    if (
      change &&
      typeof change.id === 'string' &&
      typeof change.path === 'string' &&
      typeof change.schema === 'string'
    ) {
      return { change: { id: change.id, path: change.path, schema: change.schema } };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Parses `newChangeCommand`'s `--json` failure shape
 * (`{ change: null, status: [{ message, ... }] }`), which lands on stdout
 * even though the process exits non-zero and stderr may be empty.
 */
function parseErrorMessage(stdout: string, stderr: string): string {
  try {
    const parsed = JSON.parse(stdout) as { status?: { message?: unknown }[] };
    const message = parsed.status?.[0]?.message;
    if (typeof message === 'string' && message.length > 0) return message;
  } catch {
    // fall through to stderr
  }
  return stderr.trim().length > 0 ? stderr : 'The CLI exited with an error and produced no message.';
}

/**
 * Builds the create-change submitter closed over one server's context and
 * concurrency state (design D3: at most one write subprocess in flight per
 * server). Call once per server instance — the returned function is not
 * itself reentrant-safe across independently-constructed instances sharing
 * no state, by design.
 */
export function createChangeSubmitter(
  context: Pick<ManagementApiContext, 'launchProjectRoot'>,
  options: { timeoutMs?: number; killGraceMs?: number; cliEntryOverride?: string } = {}
): (name: unknown, description: unknown) => Promise<SubmitResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const killGraceMs = options.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
  const cliEntry = options.cliEntryOverride ?? resolveCliEntry();
  let inFlight = false;

  return async (name, description) => {
    // Admission gate through the shared whitelist table (design D7, review
    // m4): this endpoint serves only the bounded-cli tier's one entry.
    // `create-change` is a fixed constant here — there is no `kind`/`op`
    // field on this request to smuggle a different tier's entry through —
    // so this can only fail if the table itself is edited to drop the
    // entry, which is exactly the "single admission source" contract D7
    // promises: the table is load-bearing, not vestigial documentation.
    if (!getBoundedCliEntry('create-change')) {
      return {
        ok: false,
        status: 500,
        code: 'internal_error',
        message: 'create-change is not present in the admission whitelist.',
      };
    }

    if (inFlight) {
      return { ok: false, status: 409, code: 'busy', message: 'Another submission is already in flight.' };
    }

    if (typeof name !== 'string') {
      return { ok: false, status: 400, code: 'invalid_input', message: 'name must be a string.' };
    }
    const nameCheck = validateChangeName(name);
    if (!nameCheck.valid) {
      return { ok: false, status: 400, code: 'invalid_input', message: nameCheck.error ?? 'Invalid name.' };
    }

    const descriptionError = validateDescription(description);
    if (descriptionError) {
      return { ok: false, status: 400, code: 'invalid_input', message: descriptionError };
    }

    if (!context.launchProjectRoot) {
      return {
        ok: false,
        status: 409,
        code: 'no_project',
        message: 'No Rasen project is available for this server; launch `rasen ui` inside a project.',
      };
    }

    inFlight = true;
    // The slot is released by `runSubmission` itself, from the child's own
    // 'close' (or spawn 'error') event — NOT here, and NOT tied to when the
    // returned promise resolves. On the timeout path those two moments
    // diverge: the promise resolves immediately with 504 so the caller gets
    // a fast answer, but the subprocess may still be alive (ignoring
    // SIGTERM) for up to `killGraceMs` longer. Releasing at response time
    // would let a second POST spawn a concurrent subprocess while the first
    // is still running, breaking the cap-1 guarantee (review M1).
    return runSubmission(
      cliEntry,
      context.launchProjectRoot,
      name,
      description as string,
      timeoutMs,
      killGraceMs,
      () => {
        inFlight = false;
      }
    );
  };
}

function runSubmission(
  cliEntry: string,
  cwd: string,
  name: string,
  description: string,
  timeoutMs: number,
  killGraceMs: number,
  onChildClosed: () => void
): Promise<SubmitResult> {
  return new Promise((resolve) => {
    // A single `--proposal=<text>` token (rather than two argv elements) so
    // a description that starts with `-` can never be parsed as a distinct
    // CLI option (design D3, injection posture).
    const argv = [cliEntry, 'new', 'change', name, `--proposal=${description}`, '--json'];

    const child = spawn(process.execPath, argv, { cwd, shell: false });

    let stdout = '';
    let stderr = '';
    let responded = false; // guards the response promise only; independent of child lifecycle
    let childClosed = false; // set exactly once the child process has actually exited
    let killTimer: NodeJS.Timeout | undefined;

    const respond = (result: SubmitResult) => {
      if (responded) return;
      responded = true;
      resolve(result);
    };

    // Releases the cap-1 concurrency slot exactly once, only once the child
    // is confirmed gone (or never actually started) — never on a timeout's
    // early 504 response.
    const releaseSlot = () => {
      if (childClosed) return;
      childClosed = true;
      onChildClosed();
    };

    const timeoutTimer = setTimeout(() => {
      child.kill('SIGTERM');
      // Escalation is keyed off child state (`childClosed`), not response
      // state — the response already settled with 504 above, but the child
      // may still be alive and ignoring SIGTERM (review M1).
      killTimer = setTimeout(() => {
        if (!childClosed) child.kill('SIGKILL');
      }, killGraceMs);
      killTimer.unref?.();
      respond({ ok: false, status: 504, code: 'cli_timeout', message: 'The CLI subprocess timed out.' });
    }, timeoutMs);
    timeoutTimer.unref?.();

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf-8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf-8');
    });

    child.on('error', (error) => {
      clearTimeout(timeoutTimer);
      if (killTimer) clearTimeout(killTimer);
      respond({
        ok: false,
        status: 500,
        code: 'cli_protocol_error',
        message: `Failed to spawn the CLI subprocess: ${error.message}`,
      });
      // 'error' at spawn time means no live process was ever created (or it
      // is already gone) — safe to release immediately.
      releaseSlot();
    });

    child.on('close', (code) => {
      clearTimeout(timeoutTimer);
      if (killTimer) clearTimeout(killTimer);

      if (code === 0) {
        const parsed = parseSuccessPayload(stdout);
        if (!parsed) {
          respond({
            ok: false,
            status: 500,
            code: 'cli_protocol_error',
            message: `The CLI exited successfully but its output could not be parsed: ${stdout || '(empty)'}`,
          });
        } else {
          respond({ ok: true, status: 201, response: parsed });
        }
      } else {
        respond({
          ok: false,
          status: 422,
          code: 'cli_error',
          message: parseErrorMessage(stdout, stderr),
          cliExitCode: code ?? undefined,
          stderr,
        });
      }

      releaseSlot();
    });
  });
}
