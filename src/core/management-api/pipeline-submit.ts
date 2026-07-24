/**
 * `POST /api/v1/pipelines` mutation bridge (pipeline-http-api design D6,
 * `save` added by pipeline-definition-api).
 *
 * Mirrors `workflow-submit.ts` exactly: the server never writes a library or
 * workspace file and never reimplements the pipeline-library logic. It validates
 * input, then spawns the CLI's own `dist/cli/index.js` entry (never PATH) with a
 * fixed argv template per operation, `shell: false` and an argv array, and
 * passes the CLI's exit code and `--json` output through verbatim. Admission is
 * the shared tiered table in `whitelist.ts`; this bridge admits only the five
 * pipeline bounded-cli ops (checked via `getBoundedCliEntry`) — never a workflow,
 * change, space, or supervised entry.
 *
 * The five operations:
 *   import  → `pipeline import <path> --json`               (+ `--force` iff `force`)
 *   init    → `pipeline init <name> --output <output> --json`
 *   export  → `pipeline export <name> <path> --json`        (+ `--force` iff `force`)
 *   delete  → `pipeline delete <name> --yes --json`         (+ `--force` iff `force`)
 *   save    → `pipeline save <name> --from <scratch-file> --json` (+ `--force` iff `force`)
 *
 * `--yes` is always passed on delete: confirmation is the UI dialog's job
 * (pipeline-http-api spec), mirroring how the bounded tier already treats a
 * non-interactive CLI run.
 *
 * `save` is the ONE sanctioned exception to "the server writes no library or
 * workspace file itself": the posted definition is written to a server-owned
 * scratch file in `os.tmpdir()` (random name, closed before spawn) solely to
 * hand it to the CLI as `--from <path>`, then deleted in a `finally` — deletion
 * failure (e.g. a transient Windows file lock) is logged and tolerated, never
 * surfaced as a request error. The definition itself never travels through argv.
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as os from 'node:os';
import * as path from 'node:path';

import { isPortableWorkflowId } from '../workflow-registry/index.js';
import type { ManagementApiContext } from './router.js';
import { getBoundedCliEntry } from './whitelist.js';
import type { PipelineMutationRequest } from './wire-types.js';

const require = createRequire(import.meta.url);

/** Hard timeout on the subprocess (design D6): matches the workflow bridge's 60s (an import copies file trees). */
const DEFAULT_TIMEOUT_MS = 60_000;

/** Grace period between SIGTERM and SIGKILL on timeout (mirrors workflow-submit.ts). */
const DEFAULT_KILL_GRACE_MS = 2_000;

/** The bounded-cli op each request `op` maps to in the shared whitelist. */
const OP_TO_WHITELIST: Readonly<Record<PipelineMutationRequest['op'], string>> = {
  import: 'import-pipeline',
  init: 'init-pipeline',
  export: 'export-pipeline',
  delete: 'delete-pipeline',
  save: 'save-pipeline',
};

/** Placeholder substituted for the real scratch-file path once it is written, right before spawn (`save` only). */
const SAVE_SCRATCH_PLACEHOLDER = '\0save-scratch-path\0';

export type PipelineSubmitResult =
  | { ok: true; status: 200 | 201; response: Record<string, unknown> }
  | { ok: false; status: number; code: string; message: string; cliExitCode?: number; stderr?: string };

/** Resolves the CLI entry belonging to THIS server process's own installation (mirrors workflow-submit.ts), never whatever `rasen` is on PATH. */
function resolveCliEntry(): string {
  const pkgPath = require.resolve('../../../package.json');
  return path.join(path.dirname(pkgPath), 'dist', 'cli', 'index.js');
}

/**
 * Parses the CLI's `--json` stdout for any pipeline subcommand's success
 * payload — pure JSON, so a stray warning ahead of it turns a success into a
 * 500 `cli_protocol_error` rather than being silently accepted.
 */
function parseSuccessPayload(stdout: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(stdout) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Parses a pipeline subcommand's `--json` failure shape
 * (`{ ...payload, status: [{ message, ... }] }`), which lands on stdout even
 * though the process exits non-zero. Falls back to stderr, then a generic message.
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

/** 400-with-no-spawn helper. */
function invalid(message: string): PipelineSubmitResult {
  return { ok: false, status: 400, code: 'invalid_input', message };
}

/**
 * Validates one mutation request and builds its argv suffix (after the CLI
 * entry) — all guards run here, before any subprocess exists (design D6). Every
 * client-supplied path must be absolute (rejects relative traversal AND doubles
 * as the option-injection guard — an absolute path cannot begin with `-`); every
 * pipeline name must match the portable id grammar pipeline names share
 * (`isPortableWorkflowId`), which also forbids a leading `-`. `import`/`init`
 * create things (201); `export`/`delete` do not (200).
 */
interface BuiltArgv {
  argv: string[];
  successStatus: 200 | 201;
  /**
   * `save`'s success status depends on whether the CLI created or overwrote
   * (201 vs 200) — reported back in its own `--json` payload (`created`), not
   * fixable statically like the other four ops. When present, this overrides
   * `successStatus` once the parsed payload is available.
   */
  successStatusFromPayload?: (payload: Record<string, unknown>) => 200 | 201;
}

function buildArgv(
  request: PipelineMutationRequest
): BuiltArgv | PipelineSubmitResult {
  switch (request.op) {
    case 'import': {
      if (typeof request.path !== 'string' || !path.isAbsolute(request.path)) {
        return invalid('import path must be an absolute path.');
      }
      const argv = ['pipeline', 'import', request.path, '--json'];
      if (request.force === true) argv.push('--force');
      return { argv, successStatus: 201 };
    }
    case 'init': {
      if (typeof request.name !== 'string' || !isPortableWorkflowId(request.name)) {
        return invalid('init name must be a valid pipeline identifier.');
      }
      if (typeof request.output !== 'string' || !path.isAbsolute(request.output)) {
        return invalid('init output must be an absolute path.');
      }
      return {
        argv: ['pipeline', 'init', request.name, '--output', request.output, '--json'],
        successStatus: 201,
      };
    }
    case 'export': {
      if (typeof request.name !== 'string' || !isPortableWorkflowId(request.name)) {
        return invalid('export name must be a valid pipeline identifier.');
      }
      if (typeof request.path !== 'string' || !path.isAbsolute(request.path)) {
        return invalid('export path must be an absolute path.');
      }
      const argv = ['pipeline', 'export', request.name, request.path, '--json'];
      if (request.force === true) argv.push('--force');
      return { argv, successStatus: 200 };
    }
    case 'delete': {
      if (typeof request.name !== 'string' || !isPortableWorkflowId(request.name)) {
        return invalid('delete name must be a valid pipeline identifier.');
      }
      // `--yes` is always present — the UI owns confirmation.
      const argv = ['pipeline', 'delete', request.name, '--yes', '--json'];
      if (request.force === true) argv.push('--force');
      return { argv, successStatus: 200 };
    }
    case 'save': {
      if (typeof request.name !== 'string' || !isPortableWorkflowId(request.name)) {
        return invalid('save name must be a valid pipeline identifier.');
      }
      if (typeof request.definition !== 'object' || request.definition === null) {
        return invalid('save definition must be an object.');
      }
      // The scratch-file path is substituted for SAVE_SCRATCH_PLACEHOLDER by
      // the caller right before spawn, once the definition has been written
      // to a temp file (design D6) — the definition itself never rides argv.
      const argv = ['pipeline', 'save', request.name, '--from', SAVE_SCRATCH_PLACEHOLDER, '--json'];
      if (request.force === true) argv.push('--force');
      return {
        argv,
        successStatus: 201,
        successStatusFromPayload: (payload) =>
          (payload as { created?: unknown }).created === false ? 200 : 201,
      };
    }
    default:
      // An `op` outside the five admitted operations spawns nothing.
      return { ok: false, status: 400, code: 'invalid_input', message: 'Unknown pipeline operation.' };
  }
}

/**
 * Builds the pipeline mutation submitter closed over one server's context and
 * concurrency state (cap-1 in flight per bridge, mirroring workflow-submit.ts).
 * Call once per server instance.
 */
export function createPipelineSubmitter(
  context: Pick<ManagementApiContext, 'launchProjectRoot'>,
  options: { timeoutMs?: number; killGraceMs?: number; cliEntryOverride?: string } = {}
): (request: unknown) => Promise<PipelineSubmitResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const killGraceMs = options.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
  const cliEntry = options.cliEntryOverride ?? resolveCliEntry();
  let inFlight = false;

  return async (request) => {
    if (typeof request !== 'object' || request === null || typeof (request as { op?: unknown }).op !== 'string') {
      return { ok: false, status: 400, code: 'invalid_input', message: 'op must be a string.' };
    }

    const built = buildArgv(request as PipelineMutationRequest);
    // A guard failure (400) or unknown op must reject BEFORE the busy check and
    // before any spawn — an invalid request never occupies the slot.
    if ('ok' in built) return built;

    const op = OP_TO_WHITELIST[(request as PipelineMutationRequest).op];
    // Admission gate through the shared whitelist table: this bridge serves only
    // its own four pipeline ops. `op` comes from the fixed OP_TO_WHITELIST map,
    // so a foreign op can never be smuggled through.
    if (!op || !getBoundedCliEntry(op)) {
      return {
        ok: false,
        status: 500,
        code: 'internal_error',
        message: `Pipeline operation is not present in the admission whitelist.`,
      };
    }

    if (inFlight) {
      return { ok: false, status: 409, code: 'busy', message: 'Another pipeline mutation is already in flight.' };
    }

    // cwd = launch project root, falling back to the server cwd outside a
    // project. Never client free text.
    const cwd = context.launchProjectRoot ?? process.cwd();

    // `save` is the sole scratch-write exception (design D6): the posted
    // definition is written to a server-owned temp file, closed before spawn,
    // solely so the CLI's `--from` can read it; the file is deleted in
    // `runMutation`'s cleanup regardless of outcome, failure tolerated and logged.
    let argvSuffix = built.argv;
    let scratchPath: string | undefined;
    if ((request as PipelineMutationRequest).op === 'save') {
      const definition = (request as Extract<PipelineMutationRequest, { op: 'save' }>).definition;
      scratchPath = path.join(
        os.tmpdir(),
        `rasen-pipeline-save-${process.pid}-${randomBytes(8).toString('hex')}.json`
      );
      try {
        fs.writeFileSync(scratchPath, JSON.stringify(definition), { encoding: 'utf-8', flag: 'wx', mode: 0o600 });
      } catch (error) {
        return {
          ok: false,
          status: 500,
          code: 'internal_error',
          message: `Failed to write the scratch definition file: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
      argvSuffix = argvSuffix.map((token) => (token === SAVE_SCRATCH_PLACEHOLDER ? scratchPath! : token));
    }

    inFlight = true;
    // The slot is released by `runMutation` from the child's own 'close' (or
    // spawn 'error') event, NOT at response time — on the timeout path the
    // promise resolves early while the child may still be alive.
    return runMutation(
      cliEntry,
      cwd,
      argvSuffix,
      built.successStatus,
      timeoutMs,
      killGraceMs,
      () => {
        inFlight = false;
      },
      scratchPath,
      built.successStatusFromPayload
    );
  };
}

function deleteScratchFile(scratchPath: string | undefined): void {
  if (!scratchPath) return;
  try {
    fs.rmSync(scratchPath, { force: true });
  } catch (error) {
    // Failure-tolerant: a transient Windows file lock (antivirus, etc.) must
    // never fail the response — log and leak the scratch file (design D6).
    console.error(`Failed to delete pipeline-save scratch file "${scratchPath}": ${error instanceof Error ? error.message : String(error)}`);
  }
}

function runMutation(
  cliEntry: string,
  cwd: string,
  argvSuffix: string[],
  successStatus: 200 | 201,
  timeoutMs: number,
  killGraceMs: number,
  onChildClosed: () => void,
  scratchPath?: string,
  successStatusFromPayload?: (payload: Record<string, unknown>) => 200 | 201
): Promise<PipelineSubmitResult> {
  return new Promise((resolve) => {
    const argv = [cliEntry, ...argvSuffix];
    const child = spawn(process.execPath, argv, { cwd, shell: false, windowsHide: true });

    let stdout = '';
    let stderr = '';
    let responded = false;
    let childClosed = false;
    let killTimer: NodeJS.Timeout | undefined;

    const respond = (result: PipelineSubmitResult) => {
      if (responded) return;
      responded = true;
      resolve(result);
    };

    const releaseSlot = () => {
      if (childClosed) return;
      childClosed = true;
      onChildClosed();
    };

    const timeoutTimer = setTimeout(() => {
      child.kill('SIGTERM');
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
      releaseSlot();
      deleteScratchFile(scratchPath);
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
          const status = successStatusFromPayload ? successStatusFromPayload(parsed) : successStatus;
          respond({ ok: true, status, response: parsed });
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
      // Scratch cleanup runs AFTER the CLI has fully exited (success or
      // failure alike) so the child process never races the deletion of the
      // file it was reading from.
      deleteScratchFile(scratchPath);
    });
  });
}
