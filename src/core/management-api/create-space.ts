/**
 * `POST /api/v1/spaces` creation bridge (space-creation design D4/D5).
 *
 * The server never writes workspace files, mints identity, or modifies any
 * registry in-process: it validates input, then spawns the CLI's own
 * `dist/cli/index.js` entry (never PATH) with an argv array and `shell: false`,
 * and passes the CLI's exit code and output through verbatim. Modeled on
 * `submit.ts` (the established change-submission machinery) — its own cap-1
 * concurrency, 60s timeout with SIGTERM→SIGKILL escalation, and
 * slot-release-on-child-close discipline, admitted through the shared
 * bounded-CLI whitelist tier. The verb is selected deterministically from the
 * kind and the target directory's state:
 *  - `project`                    → `init <path>`
 *  - `store` + `<path>/rasen`     → `store register <path> --yes [--id <id>] --json`
 *  - `store` + no `<path>/rasen`  → `store setup <id> --path <path> --json`  (id required)
 */
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';

import { FileSystemUtils } from '../../utils/file-system.js';
import { validateStoreId } from '../store/foundation.js';
import { handleSpaces } from './spaces.js';
import { CONTROL_CHAR_PATTERN } from './submit.js';
import { getBoundedCliEntry } from './whitelist.js';
import type { CreateSpaceResponse, SpaceEntry } from './wire-types.js';

const require = createRequire(import.meta.url);

/** Length cap on the submitted path (design D5). */
const MAX_PATH_LENGTH = 4096;

/** Hard timeout on the subprocess (design D5): init writes many files; store ops share the ceiling. */
const DEFAULT_TIMEOUT_MS = 60_000;

/** Grace period between SIGTERM and SIGKILL on timeout (design D5). */
const DEFAULT_KILL_GRACE_MS = 2_000;

export type CreateSpaceResult =
  | { ok: true; status: 201; response: CreateSpaceResponse }
  | { ok: false; status: number; code: string; message: string; cliExitCode?: number; stderr?: string };

/** The three bounded-CLI operations this bridge admits (design D5). */
type SpaceOp = 'create-project-space' | 'register-store-space' | 'setup-store-space';

interface CreateSpaceOptions {
  timeoutMs?: number;
  killGraceMs?: number;
  cliEntryOverride?: string;
  /** Test seam (task 3.4): re-read the spaces listing through this instead of the real `handleSpaces()`. */
  listSpacesOverride?: () => Promise<{ spaces: SpaceEntry[] }>;
}

/** Resolves the CLI entry of this very server process's own installation (design D5) — same pattern as `submit.ts`. */
function resolveCliEntry(): string {
  const pkgPath = require.resolve('../../../package.json');
  return path.join(path.dirname(pkgPath), 'dist', 'cli', 'index.js');
}

function canonicalizeOrResolve(target: string): string {
  try {
    return FileSystemUtils.canonicalizeExistingPath(target);
  } catch {
    return target;
  }
}

/** Read-only stat: does the target directory already contain a `rasen/` root? */
function hasRasenRoot(targetPath: string): boolean {
  try {
    return fs.statSync(path.join(targetPath, 'rasen')).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Parses the store CLI's `--json` success stdout for the created/registered
 * store id (`toMutationOutput` emits `{ store: { id, root }, ... }`). Returns
 * null when the payload is absent or unparseable — the caller falls back to a
 * canonical-root match against the listing.
 */
function parseStoreId(stdout: string): string | null {
  try {
    const parsed = JSON.parse(stdout) as { store?: { id?: unknown } };
    const id = parsed.store?.id;
    return typeof id === 'string' && id.length > 0 ? id : null;
  } catch {
    return null;
  }
}

/**
 * Parses the CLI's failure message: the store commands emit a JSON
 * `{ status: [{ message }] }` on stdout even on non-zero exit; `init` has no
 * `--json` and reports on stderr. Mirrors `submit.ts`'s passthrough.
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

interface Validated {
  kind: 'project' | 'store';
  targetPath: string;
  id: string | undefined;
  op: SpaceOp;
  operation: CreateSpaceResponse['operation'];
  argv: string[];
}

/** All validation before any subprocess (design D5). Returns the resolved verb, or a 400. */
function validate(body: unknown): Validated | { ok: false; status: number; code: string; message: string } {
  const request = (body ?? {}) as { kind?: unknown; path?: unknown; id?: unknown };

  if (request.kind !== 'project' && request.kind !== 'store') {
    return { ok: false, status: 400, code: 'invalid_input', message: "kind must be 'project' or 'store'." };
  }

  const targetPath = request.path;
  if (typeof targetPath !== 'string' || targetPath.length === 0) {
    return { ok: false, status: 400, code: 'invalid_input', message: 'path must be a non-empty string.' };
  }
  if (!path.isAbsolute(targetPath)) {
    // Absoluteness doubles as the option-injection guard: an absolute path
    // cannot begin with `-`, so it can never be parsed as a CLI option.
    return { ok: false, status: 400, code: 'invalid_input', message: 'path must be an absolute filesystem path.' };
  }
  if (targetPath.length > MAX_PATH_LENGTH) {
    return { ok: false, status: 400, code: 'invalid_input', message: `path must be at most ${MAX_PATH_LENGTH} characters.` };
  }
  if (CONTROL_CHAR_PATTERN.test(targetPath)) {
    return { ok: false, status: 400, code: 'invalid_input', message: 'path must not contain control characters.' };
  }

  let id: string | undefined;
  if (request.id !== undefined) {
    if (typeof request.id !== 'string') {
      return { ok: false, status: 400, code: 'invalid_input', message: 'id must be a string.' };
    }
    try {
      // The CLI's own store-id validation, so the server and CLI can never
      // disagree on id shape; it also excludes option-like strings.
      validateStoreId(request.id);
    } catch (error) {
      return {
        ok: false,
        status: 400,
        code: 'invalid_input',
        message: error instanceof Error ? error.message : 'Invalid store id.',
      };
    }
    id = request.id;
  }

  if (request.kind === 'project') {
    return {
      kind: 'project',
      targetPath,
      id,
      op: 'create-project-space',
      operation: 'init',
      argv: ['init', targetPath],
    };
  }

  // kind === 'store': the target directory's state selects register vs setup.
  if (hasRasenRoot(targetPath)) {
    return {
      kind: 'store',
      targetPath,
      id,
      op: 'register-store-space',
      operation: 'store-register',
      argv: ['store', 'register', targetPath, '--yes', ...(id ? ['--id', id] : []), '--json'],
    };
  }

  if (!id) {
    return {
      ok: false,
      status: 400,
      code: 'invalid_input',
      message: 'id is required to create a fresh store (the target directory has no rasen/ root).',
    };
  }
  return {
    kind: 'store',
    targetPath,
    id,
    op: 'setup-store-space',
    operation: 'store-setup',
    argv: ['store', 'setup', id, '--path', targetPath, '--json'],
  };
}

/**
 * Locates the newly created space in the freshly re-read listing (design D4):
 * a project by canonical-root match against its target path; a store by id
 * (parsed from `--json` stdout when present — `register` may derive it from
 * metadata/folder), falling back to a canonical-root match.
 */
function findSpace(
  spaces: SpaceEntry[],
  validated: Validated,
  storeIdFromStdout: string | null
): SpaceEntry | undefined {
  if (validated.kind === 'project') {
    const canonicalTarget = canonicalizeOrResolve(validated.targetPath);
    return spaces.find(
      (s) => s.type === 'project' && canonicalizeOrResolve(s.root) === canonicalTarget
    );
  }
  const wantedId = storeIdFromStdout ?? validated.id;
  if (wantedId) {
    const byId = spaces.find((s) => s.type === 'store' && s.id === wantedId);
    if (byId) return byId;
  }
  const canonicalTarget = canonicalizeOrResolve(validated.targetPath);
  return spaces.find((s) => s.type === 'store' && canonicalizeOrResolve(s.root) === canonicalTarget);
}

/**
 * Builds the create-space creator closed over one server's concurrency state
 * (design D5: at most one space-creation subprocess in flight per server,
 * independent of change-submission's cap). Call once per server instance.
 */
export function createSpaceCreator(
  options: CreateSpaceOptions = {}
): (body: unknown) => Promise<CreateSpaceResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const killGraceMs = options.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
  const cliEntry = options.cliEntryOverride ?? resolveCliEntry();
  const listSpaces = options.listSpacesOverride ?? handleSpaces;
  let inFlight = false;

  return async (body) => {
    const validated = validate(body);
    // The success shape carries `op`; the rejection shape does not — a single
    // `in` check narrows cleanly (a compound `&&` guard would not).
    if (!('op' in validated)) {
      return validated;
    }
    const plan = validated;

    // Admission gate through the shared whitelist table (design D5): each
    // handler admits only its own operation set. This can only fail if the
    // table itself is edited to drop the row — the "single admission source"
    // contract the spec promises (the table is load-bearing).
    if (!getBoundedCliEntry(plan.op)) {
      return {
        ok: false,
        status: 500,
        code: 'internal_error',
        message: `${plan.op} is not present in the admission whitelist.`,
      };
    }

    if (inFlight) {
      return { ok: false, status: 409, code: 'busy', message: 'Another space creation is already in flight.' };
    }

    inFlight = true;
    return runCreation(cliEntry, plan, listSpaces, timeoutMs, killGraceMs, () => {
      inFlight = false;
    });
  };
}

function runCreation(
  cliEntry: string,
  plan: Validated,
  listSpaces: () => Promise<{ spaces: SpaceEntry[] }>,
  timeoutMs: number,
  killGraceMs: number,
  onChildClosed: () => void
): Promise<CreateSpaceResult> {
  return new Promise((resolve) => {
    const argv = [cliEntry, ...plan.argv];
    // cwd is the server process's own cwd — NEVER derived from client input
    // (design D5). Unlike change submission there is no space-root cwd to lock
    // to, because the space does not exist yet; the target path travels only
    // as a validated argv token.
    const child = spawn(process.execPath, argv, { cwd: process.cwd(), shell: false, windowsHide: true });

    let stdout = '';
    let stderr = '';
    let responded = false;
    let childClosed = false;
    let killTimer: NodeJS.Timeout | undefined;

    const respond = (result: CreateSpaceResult) => {
      if (responded) return;
      responded = true;
      resolve(result);
    };

    // Releases the cap-1 slot exactly once, only once the child is confirmed
    // gone — never on a timeout's early 504 (mirrors submit.ts's review-M1
    // discipline: releasing at response time would let a second request spawn
    // a concurrent subprocess while the first is still being killed).
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

      if (code !== 0) {
        respond({
          ok: false,
          status: 422,
          code: 'cli_error',
          message: parseErrorMessage(stdout, stderr),
          cliExitCode: code ?? undefined,
          stderr,
        });
        releaseSlot();
        return;
      }

      // Zero exit: re-read the listing and locate the new space. `init` has no
      // `--json`, so success is exit-0 + a listing re-read — never a parse of
      // its human output.
      const storeIdFromStdout = plan.kind === 'store' ? parseStoreId(stdout) : null;
      listSpaces()
        .then(({ spaces }) => {
          const space = findSpace(spaces, plan, storeIdFromStdout);
          if (!space) {
            respond({
              ok: false,
              status: 500,
              code: 'cli_protocol_error',
              message: 'The CLI reported success but the new space could not be found in the spaces listing.',
            });
          } else {
            respond({ ok: true, status: 201, response: { operation: plan.operation, space } });
          }
        })
        .catch((error: unknown) => {
          respond({
            ok: false,
            status: 500,
            code: 'cli_protocol_error',
            message: `Failed to re-read the spaces listing after creation: ${
              error instanceof Error ? error.message : String(error)
            }`,
          });
        })
        .finally(() => {
          releaseSlot();
        });
    });
  });
}
