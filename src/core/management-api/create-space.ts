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
 * bounded-CLI whitelist tier. The request discriminant selects the verb
 * without inspecting filesystem state:
 *  - `create-project` → `init <path>`
 *  - `register-store` → `store register <path> --yes [--id <id>] --json`
 *  - `create-store` → `store setup <id> --path <joined-parent-and-id> --json`
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import * as path from 'node:path';

import { FileSystemUtils } from '../../utils/file-system.js';
import { validateStoreId } from '../store/foundation.js';
import { PATH_CONTROL_CHAR_PATTERN } from './local-path-resolver.js';
import { handleSpaces } from './spaces.js';
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

type ValidationFailure = { ok: false; status: number; code: string; message: string };

function validateAbsolutePath(value: unknown, field: 'path' | 'parent'): string | ValidationFailure {
  if (typeof value !== 'string' || value.length === 0) {
    return { ok: false, status: 400, code: 'invalid_input', message: `${field} must be a non-empty string.` };
  }
  if (!path.isAbsolute(value)) {
    return {
      ok: false,
      status: 400,
      code: 'invalid_input',
      message: `${field} must be an absolute filesystem path.`,
    };
  }
  if (value.length > MAX_PATH_LENGTH) {
    return {
      ok: false,
      status: 400,
      code: 'invalid_input',
      message: `${field} must be at most ${MAX_PATH_LENGTH} characters.`,
    };
  }
  if (PATH_CONTROL_CHAR_PATTERN.test(value)) {
    return {
      ok: false,
      status: 400,
      code: 'invalid_input',
      message: `${field} must not contain control characters.`,
    };
  }
  return value;
}

function validateId(value: unknown, required: boolean): string | undefined | ValidationFailure {
  if (value === undefined && !required) return undefined;
  if (typeof value !== 'string' || value.length === 0) {
    return { ok: false, status: 400, code: 'invalid_input', message: 'id must be a non-empty string.' };
  }
  try {
    validateStoreId(value);
    return value;
  } catch (error) {
    return {
      ok: false,
      status: 400,
      code: 'invalid_input',
      message: error instanceof Error ? error.message : 'Invalid store id.',
    };
  }
}

/** All validation before any subprocess. The operation and allowed fields are explicit. */
function validate(body: unknown): Validated | ValidationFailure {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, status: 400, code: 'invalid_input', message: 'Request body must be an object.' };
  }
  const request = body as Record<string, unknown>;
  if (
    request.op !== 'create-project' &&
    request.op !== 'create-store' &&
    request.op !== 'register-store'
  ) {
    return {
      ok: false,
      status: 400,
      code: 'invalid_input',
      message: "op must be 'create-project', 'create-store', or 'register-store'.",
    };
  }

  const allowed =
    request.op === 'create-project'
      ? new Set(['op', 'path'])
      : request.op === 'create-store'
        ? new Set(['op', 'parent', 'id'])
        : new Set(['op', 'path', 'id']);
  if (Object.keys(request).some((key) => !allowed.has(key))) {
    return {
      ok: false,
      status: 400,
      code: 'invalid_input',
      message: `${request.op} contains fields that belong to a different operation.`,
    };
  }

  if (request.op === 'create-project') {
    const targetPath = validateAbsolutePath(request.path, 'path');
    if (typeof targetPath !== 'string') return targetPath;
    return {
      kind: 'project',
      targetPath,
      id: undefined,
      op: 'create-project-space',
      operation: 'init',
      argv: ['init', targetPath],
    };
  }

  // Store ids are validated before any path join.
  const id = validateId(request.id, request.op === 'create-store');
  if (id !== undefined && typeof id !== 'string') return id;

  if (request.op === 'register-store') {
    const targetPath = validateAbsolutePath(request.path, 'path');
    if (typeof targetPath !== 'string') return targetPath;
    return {
      kind: 'store',
      targetPath,
      id,
      op: 'register-store-space',
      operation: 'store-register',
      argv: ['store', 'register', targetPath, '--yes', ...(id ? ['--id', id] : []), '--json'],
    };
  }

  const parent = validateAbsolutePath(request.parent, 'parent');
  if (typeof parent !== 'string') return parent;
  const targetPath = path.join(parent, id as string);
  return {
    kind: 'store',
    targetPath,
    id,
    op: 'setup-store-space',
    operation: 'store-setup',
    argv: ['store', 'setup', id as string, '--path', targetPath, '--json'],
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
      (s) => s.type === 'project' && s.root !== undefined && canonicalizeOrResolve(s.root) === canonicalTarget
    );
  }
  const canonicalTarget = canonicalizeOrResolve(validated.targetPath);
  if (validated.operation === 'store-setup') {
    return spaces.find(
      (s) => s.type === 'store' && s.root !== undefined && canonicalizeOrResolve(s.root) === canonicalTarget
    );
  }
  const wantedId = storeIdFromStdout ?? validated.id;
  if (wantedId) {
    const byId = spaces.find((s) => s.type === 'store' && s.id === wantedId);
    if (byId) return byId;
  }
  return spaces.find((s) => s.type === 'store' && s.root !== undefined && canonicalizeOrResolve(s.root) === canonicalTarget);
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
