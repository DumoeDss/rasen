/**
 * `POST /api/v1/workflows` mutation bridge (workflow-http-api design D4).
 *
 * Mirrors `submit.ts` exactly: the server never writes a library or workspace
 * file and never reimplements the workflow-library logic. It validates input,
 * then spawns the CLI's own `dist/cli/index.js` entry (never PATH) with a
 * fixed argv template per operation, `shell: false` and an argv array, and
 * passes the CLI's exit code and `--json` output through verbatim. Admission
 * is the shared tiered table in `whitelist.ts`; this bridge admits only the
 * four workflow bounded-cli ops (checked via `getBoundedCliEntry`) — never
 * `create-change` or any supervised entry.
 *
 * The four operations (design D4):
 *   import  → `workflow import <path> --json`
 *   init    → `workflow init <id> --output <output> --json`
 *   export  → `workflow export <id> <path> --json`  (+ `--force` iff `force`)
 *   delete  → `workflow delete <id> --yes --json`   (+ `--force` iff `force`)
 *
 * `--yes` is always passed on delete: confirmation is the UI dialog's job
 * (workflow-http-api spec), mirroring how the bounded tier already treats a
 * non-interactive CLI run.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import * as path from 'node:path';

import { isPortableWorkflowId } from '../workflow-registry/index.js';
import type { ManagementApiContext } from './router.js';
import { getBoundedCliEntry } from './whitelist.js';
import type { WorkflowMutationRequest } from './wire-types.js';

const require = createRequire(import.meta.url);

/**
 * Hard timeout on the subprocess (design D4): more generous than change
 * submission's 30s because an import copies whole file trees.
 */
const DEFAULT_TIMEOUT_MS = 60_000;

/** Grace period between SIGTERM and SIGKILL on timeout (mirrors submit.ts). */
const DEFAULT_KILL_GRACE_MS = 2_000;

/** The bounded-cli op each request `op` maps to in the shared whitelist. */
const OP_TO_WHITELIST: Readonly<Record<WorkflowMutationRequest['op'], string>> = {
  import: 'import-workflow',
  init: 'init-workflow',
  export: 'export-workflow',
  delete: 'delete-workflow',
};

export type WorkflowSubmitResult =
  | { ok: true; status: 200 | 201; response: Record<string, unknown> }
  | { ok: false; status: number; code: string; message: string; cliExitCode?: number; stderr?: string };

/**
 * Resolves the CLI entry belonging to this very server process's own
 * installation (mirrors submit.ts), never whatever `rasen` is on PATH.
 */
function resolveCliEntry(): string {
  const pkgPath = require.resolve('../../../package.json');
  return path.join(path.dirname(pkgPath), 'dist', 'cli', 'index.js');
}

/**
 * Parses the CLI's `--json` stdout for any workflow subcommand's success
 * payload. Same honest-but-strict contract as submit.ts: the stdout must be
 * pure JSON, so a future stray warning ahead of the payload turns a success
 * into a 500 `cli_protocol_error` rather than being silently accepted.
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
 * Parses a workflow subcommand's `--json` failure shape
 * (`{ ...emptyPayload, status: [{ message, ... }] }`), which lands on stdout
 * even though the process exits non-zero. Falls back to stderr, then a
 * generic message.
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
function invalid(message: string): WorkflowSubmitResult {
  return { ok: false, status: 400, code: 'invalid_input', message };
}

/**
 * Validates one mutation request and builds its argv suffix (after the CLI
 * entry) — all guards run here, before any subprocess exists (design D4 /
 * task 1.3). Returns the argv tokens on success, or a 400 result on any guard
 * failure. `import`/`init` create things (201); `export`/`delete` do not (200).
 */
function buildArgv(
  request: WorkflowMutationRequest
): { argv: string[]; successStatus: 200 | 201 } | WorkflowSubmitResult {
  // Every filesystem path must be absolute (rejects relative traversal AND
  // doubles as the option-injection guard — an absolute path cannot begin
  // with `-`). `path.isAbsolute` accepts both `E:\…` and `/…` native forms.
  // Every id must match the exact identifier form the workflow manifest
  // schema accepts (`isPortableWorkflowId`) so the guard can never refuse an
  // id the CLI would accept; that pattern also forbids a leading `-`.
  switch (request.op) {
    case 'import': {
      if (typeof request.path !== 'string' || !path.isAbsolute(request.path)) {
        return invalid('import path must be an absolute path.');
      }
      return { argv: ['workflow', 'import', request.path, '--json'], successStatus: 201 };
    }
    case 'init': {
      if (typeof request.id !== 'string' || !isPortableWorkflowId(request.id)) {
        return invalid('init id must be a valid workflow identifier.');
      }
      if (typeof request.output !== 'string' || !path.isAbsolute(request.output)) {
        return invalid('init output must be an absolute path.');
      }
      return {
        argv: ['workflow', 'init', request.id, '--output', request.output, '--json'],
        successStatus: 201,
      };
    }
    case 'export': {
      if (typeof request.id !== 'string' || !isPortableWorkflowId(request.id)) {
        return invalid('export id must be a valid workflow identifier.');
      }
      if (typeof request.path !== 'string' || !path.isAbsolute(request.path)) {
        return invalid('export path must be an absolute path.');
      }
      const argv = ['workflow', 'export', request.id, request.path, '--json'];
      if (request.force === true) argv.push('--force');
      return { argv, successStatus: 200 };
    }
    case 'delete': {
      if (typeof request.id !== 'string' || !isPortableWorkflowId(request.id)) {
        return invalid('delete id must be a valid workflow identifier.');
      }
      // `--yes` is always present — the UI owns confirmation.
      const argv = ['workflow', 'delete', request.id, '--yes', '--json'];
      if (request.force === true) argv.push('--force');
      return { argv, successStatus: 200 };
    }
    default:
      // An `op` outside the four admitted operations spawns nothing (spec:
      // "Unknown operation spawns nothing").
      return { ok: false, status: 400, code: 'invalid_input', message: 'Unknown workflow operation.' };
  }
}

/**
 * Builds the workflow mutation submitter closed over one server's context and
 * concurrency state (cap-1 in flight per bridge, mirroring submit.ts). Call
 * once per server instance.
 */
export function createWorkflowSubmitter(
  context: Pick<ManagementApiContext, 'launchProjectRoot'>,
  options: { timeoutMs?: number; killGraceMs?: number; cliEntryOverride?: string } = {}
): (request: unknown) => Promise<WorkflowSubmitResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const killGraceMs = options.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
  const cliEntry = options.cliEntryOverride ?? resolveCliEntry();
  let inFlight = false;

  return async (request) => {
    if (typeof request !== 'object' || request === null || typeof (request as { op?: unknown }).op !== 'string') {
      return { ok: false, status: 400, code: 'invalid_input', message: 'op must be a string.' };
    }

    const built = buildArgv(request as WorkflowMutationRequest);
    // A guard failure (400) or unknown op must reject BEFORE the busy check
    // and before any spawn — an unknown/invalid request never occupies the
    // concurrency slot and never starts a subprocess.
    if ('ok' in built) return built;

    const op = OP_TO_WHITELIST[(request as WorkflowMutationRequest).op];
    // Admission gate through the shared whitelist table: this bridge serves
    // only its own four workflow ops. `op` is resolved from the fixed
    // OP_TO_WHITELIST map, so a foreign op can never be smuggled through.
    if (!op || !getBoundedCliEntry(op)) {
      return {
        ok: false,
        status: 500,
        code: 'internal_error',
        message: `Workflow operation is not present in the admission whitelist.`,
      };
    }

    if (inFlight) {
      return { ok: false, status: 409, code: 'busy', message: 'Another workflow mutation is already in flight.' };
    }

    // cwd = launch project root, falling back to the server cwd outside a
    // project (design D2). Never client free text.
    const cwd = context.launchProjectRoot ?? process.cwd();

    inFlight = true;
    // The slot is released by `runMutation` from the child's own 'close' (or
    // spawn 'error') event, NOT at response time — on the timeout path the
    // promise resolves early with 504 while the child may still be alive, and
    // releasing then would break the cap-1 guarantee (submit.ts review M1).
    return runMutation(cliEntry, cwd, built.argv, built.successStatus, timeoutMs, killGraceMs, () => {
      inFlight = false;
    });
  };
}

function runMutation(
  cliEntry: string,
  cwd: string,
  argvSuffix: string[],
  successStatus: 200 | 201,
  timeoutMs: number,
  killGraceMs: number,
  onChildClosed: () => void
): Promise<WorkflowSubmitResult> {
  return new Promise((resolve) => {
    const argv = [cliEntry, ...argvSuffix];
    const child = spawn(process.execPath, argv, { cwd, shell: false });

    let stdout = '';
    let stderr = '';
    let responded = false;
    let childClosed = false;
    let killTimer: NodeJS.Timeout | undefined;

    const respond = (result: WorkflowSubmitResult) => {
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
          respond({ ok: true, status: successStatus, response: parsed });
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
