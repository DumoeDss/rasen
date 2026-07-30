/**
 * `POST /api/v1/runs/<changeId>/<runId>` control bridge (design.md §13 of
 * `ecp-run-spine`).
 *
 * The server never edits Record files in-process: it validates exact IDs,
 * body, and space BEFORE spawning (pre-spawn admission), then spawns the local
 * CLI's own `pipeline control` subcommand with structured, safe argv, and
 * returns its JSON receipt. The CLI applies the control decision through the
 * frozen kernel's atomic commit path — the bridge only spawns and parses.
 *
 * The bridge seals `deliveryMode: "defer"`: the request body cannot override
 * it (the `deliveryMode` is a `RuntimeMutationContext` parameter, never a field
 * on the `ChangeRunControlRequest` body — and the facade's `control` method
 * ignores the context's `deliveryMode` entirely, always returning an empty
 * action list). HTTP responses therefore NEVER contain executable
 * Agent/Command/Host payloads — they return only the committed view and an
 * EMPTY receipt action list. A subsequent trusted CLI resume performs the
 * first atomic grant; browser response loss/replay cannot turn an unconsumed
 * admission into an uncertain already-delivered effect.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { createHash } from 'node:crypto';

import type { ProjectHome } from '../project-home.js';
import {
  decodeControl,
  type ChangeRunControlRequest,
  type ChangeRunView,
} from '../change-run/index.js';
import {
  derivePlanningSpaceId,
  deriveWorkspaceInstanceId,
  readPhysicalIdentity,
} from '../change-run/internal/identity.js';
import { projectRunView } from '../change-run/internal/projector.js';
import { decodeCanonicalRunRecord, type CanonicalRunRecord } from '../change-run/internal/record.js';
import type { RuntimePlan } from '../change-run/internal/runtime-plan.js';

const require = createRequire(import.meta.url);

// ---------------------------------------------------------------------------
// Injectable spawn seam.
// ---------------------------------------------------------------------------

/**
 * One structured call to the CLI subprocess. Every argument is a separate
 * argv element — the body travels via stdin, never interpolated into argv.
 */
export interface RunControlSpawnCall {
  /** Resolved project root the CLI resolves its own root from. */
  readonly cwd: string;
  /** Full argv array (`process.execPath` is separate). */
  readonly argv: readonly string[];
  /** The raw HTTP body, piped to the child's stdin. */
  readonly stdin: string;
  readonly timeoutMs: number;
  readonly killGraceMs: number;
}

/**
 * Result of one spawn call — the child's captured stdout/stderr, exit code,
 * and whether it was killed by the timeout.
 */
export interface RunControlSpawnResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

/**
 * The spawn seam. Production passes {@link createProductionRunControlSpawner};
 * tests inject a fake that asserts the argv/stdin and returns a canned result.
 */
export type RunControlSpawner = (call: RunControlSpawnCall) => Promise<RunControlSpawnResult>;

/**
 * Creates the production subprocess spawner. Uses `child_process.spawn` with
 * `shell: false` (no shell interpretation), pipes stdin, collects stdout/stderr,
 * and enforces a timeout with SIGTERM → SIGKILL escalation. The concurrency
 * slot is released only once the child process has actually exited (not when
 * the timeout's early response fires).
 */
export function createProductionRunControlSpawner(): RunControlSpawner {
  return (call) => {
    return new Promise((resolve) => {
      const child = spawn(process.execPath, call.argv, {
        cwd: call.cwd,
        shell: false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let childClosed = false;
      let killTimer: NodeJS.Timeout | undefined;

      const finish = (result: RunControlSpawnResult) => {
        if (childClosed) return;
        childClosed = true;
        resolve(result);
      };

      const timeoutTimer = setTimeout(() => {
        child.kill('SIGTERM');
        killTimer = setTimeout(() => {
          if (!childClosed) child.kill('SIGKILL');
        }, call.killGraceMs);
        killTimer.unref?.();
        // Respond immediately with the timeout result; the slot releases when
        // the child actually exits via 'close'.
      }, call.timeoutMs);
      timeoutTimer.unref?.();

      child.stdin.on('error', () => {
        // stdin write failure — the child may still be alive; let timeout/close handle it.
      });
      child.stdin.end(call.stdin);

      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf-8');
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf-8');
      });

      child.on('error', (error) => {
        clearTimeout(timeoutTimer);
        if (killTimer) clearTimeout(killTimer);
        finish({
          exitCode: null,
          stdout,
          stderr: stderr + `\n[spawn error: ${error.message}]`,
          timedOut: false,
        });
      });

      child.on('close', (code) => {
        clearTimeout(timeoutTimer);
        if (killTimer) clearTimeout(killTimer);
        const timedOut = killTimer !== undefined && code === null;
        finish({ exitCode: code, stdout, stderr, timedOut });
      });
    });
  };
}

// ---------------------------------------------------------------------------
// Result types.
// ---------------------------------------------------------------------------

/** The sealed POST response: committed view + disposition + empty actions. */
export interface RunControlResponse {
  /** Freshly projected view from the committed Record (post-control). */
  readonly view: ChangeRunView;
  /** The CLI receipt's disposition (`"advanced"` / `"terminal"` / `"waiting"`). */
  readonly disposition: string;
  /** ALWAYS empty — the bridge seals defer; no executable grants in the response. */
  readonly actions: readonly never[];
}

export type RunControlResult =
  | { ok: true; status: number; response: RunControlResponse }
  | { ok: false; status: number; code: string; message: string; cliExitCode?: number; stderr?: string };

// ---------------------------------------------------------------------------
// Constants.
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_KILL_GRACE_MS = 2_000;
const CONTROL_FORMAT = 'change-run-control/1';

// ---------------------------------------------------------------------------
// CLI entry resolution (same pattern as submit.ts).
// ---------------------------------------------------------------------------

function resolveCliEntry(): string {
  const pkgPath = require.resolve('../../../package.json');
  return path.join(path.dirname(pkgPath), 'dist', 'cli', 'index.js');
}

// ---------------------------------------------------------------------------
// Workspace identity (same read-only chain as runs.ts).
// ---------------------------------------------------------------------------

function deriveWorkspaceIdFromRoot(root: string): string | null {
  try {
    const planningSpaceHome = `project-${createHash('sha256')
      .update(root)
      .digest('hex')
      .slice(0, 12)}`;
    const planningSpaceId = derivePlanningSpaceId(planningSpaceHome);
    const st = fs.statSync(root, { bigint: true });
    const physical = readPhysicalIdentity({
      device: st.dev,
      ino: st.ino,
      birthtimeMs: st.birthtimeMs,
    });
    return deriveWorkspaceInstanceId(planningSpaceId, physical) as string;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Pre-spawn admission: read-only Record load + validation.
// ---------------------------------------------------------------------------

interface PreSpawnAdmission {
  record: CanonicalRunRecord;
}

/**
 * Pre-spawn admission (design §13): validates exact IDs, body, and workspace
 * BEFORE any subprocess exists. All checks are read-only — the bridge loads
 * the head Record through the canonical codec (same path as the GET detail
 * route), never writes, and never mints identity.
 *
 * Returns the loaded Record on success, or a typed error envelope.
 */
function admitControlRequest(
  changeId: string,
  runId: string,
  root: string | undefined,
  body: unknown,
  storeRoot: string
): PreSpawnAdmission | { ok: false; status: number; code: string; message: string } {
  // --- Body structural validation (before touching the store) ---
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, status: 400, code: 'bad_request', message: 'Request body must be a JSON object.' };
  }
  const envelope = body as { control?: unknown };
  if (envelope.control === undefined) {
    return { ok: false, status: 400, code: 'bad_request', message: 'Body must contain a "control" field.' };
  }

  // Decode the control request through the strict contract schema. This catches
  // unknown fields (e.g., a smuggled `deliveryMode`), wrong types, and missing
  // required fields — all before any spawn.
  let control: ChangeRunControlRequest;
  try {
    control = decodeControl(envelope.control);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 400, code: 'invalid_control', message: `Control request failed contract validation: ${message}` };
  }

  // --- Path/ref consistency: the body's ref must match the URL path ---
  if (control.ref.change.changeId !== changeId) {
    return {
      ok: false,
      status: 400,
      code: 'run_ref_mismatch',
      message: `Body ref.changeId "${control.ref.change.changeId}" does not match path changeId "${changeId}".`,
    };
  }
  if (control.ref.runId !== runId) {
    return {
      ok: false,
      status: 400,
      code: 'run_ref_mismatch',
      message: `Body ref.runId "${control.ref.runId}" does not match path runId "${runId}".`,
    };
  }

  // --- Store existence ---
  if (!fs.existsSync(storeRoot)) {
    return { ok: false, status: 404, code: 'run_not_found', message: `No Run with id ${runId}.` };
  }

  // --- Load + decode the head Record ---
  const dirName = runId.replace(/[^a-z0-9]/gi, '_');
  const dirPath = path.join(storeRoot, dirName);
  if (!fs.existsSync(dirPath)) {
    return { ok: false, status: 404, code: 'run_not_found', message: `No Run with id ${runId}.` };
  }

  const headRecord = findHeadRecord(dirPath);
  if (headRecord === null) {
    return { ok: false, status: 404, code: 'run_not_found', message: `No record file found for Run ${runId}.` };
  }

  let raw: string;
  try {
    raw = fs.readFileSync(headRecord.file, 'utf-8');
  } catch {
    return { ok: false, status: 500, code: 'run_store_unavailable', message: `Could not read the Run record file.` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, status: 500, code: 'run_store_corrupt', message: `Record JSON is unparseable.` };
  }

  let record: CanonicalRunRecord;
  try {
    record = decodeCanonicalRunRecord(parsed);
  } catch (err) {
    const code =
      err instanceof Error && 'code' in err && typeof (err as { code: unknown }).code === 'string'
        ? (err as { code: string }).code
        : 'run_store_corrupt';
    return { ok: false, status: 500, code, message: err instanceof Error ? err.message : String(err) };
  }

  // --- Identity cross-check: the Record's changeId must match the path ---
  if (record.change.changeId !== changeId) {
    return {
      ok: false,
      status: 404,
      code: 'run_not_found',
      message: `Run ${runId} does not belong to change ${changeId}.`,
    };
  }

  // --- Run ID cross-check: the sanitized dir must match the Record's runId ---
  if (record.runId !== runId) {
    return {
      ok: false,
      status: 404,
      code: 'run_not_found',
      message: `Run ${runId} does not match the stored Run ${record.runId}.`,
    };
  }

  // --- Workspace scope: mutations are rejected from other worktrees ---
  if (root) {
    const expectedWorkspace = deriveWorkspaceIdFromRoot(root);
    if (expectedWorkspace !== null && record.workspaceInstanceId !== expectedWorkspace) {
      return {
        ok: false,
        status: 403,
        code: 'workspace-scope-mismatch',
        message: `Run ${runId} belongs to a different workspace. Control is rejected from this workspace.`,
      };
    }
  }

  // --- Terminal Runs cannot accept control ---
  if (record.terminal !== undefined) {
    const t = record.terminal;
    const label = 'reason' in t ? t.reason : 'code' in t ? t.code : t.kind;
    return {
      ok: false,
      status: 409,
      code: 'run_terminal',
      message: `Run ${runId} is terminal (${label}). No control is accepted.`,
    };
  }

  // --- Engine freeze: only reconciler-engine Runs accept control ---
  if (record.engine !== 'reconciler') {
    return {
      ok: false,
      status: 409,
      code: 'engine_conflict',
      message: `Run ${runId} uses engine "${record.engine}". Only reconciler-engine Runs accept control.`,
    };
  }

  // --- Optimistic concurrency: expectedRecordVersion must match ---
  if (control.expectedRecordVersion !== record.recordVersion) {
    return {
      ok: false,
      status: 409,
      code: 'record_version_conflict',
      message: `expectedRecordVersion ${control.expectedRecordVersion} does not match the current Record version ${record.recordVersion}. Refetch the view and retry.`,
    };
  }

  return { record };
}

function findHeadRecord(dirPath: string): { file: string; version: number } | null {
  let files: string[];
  try {
    files = fs.readdirSync(dirPath);
  } catch {
    return null;
  }
  let bestVersion = -1;
  for (const file of files) {
    const match = /^record-v(\d+)\.json$/.exec(file);
    if (match) {
      const version = Number.parseInt(match[1]!, 10);
      if (version > bestVersion) bestVersion = version;
    }
  }
  if (bestVersion === -1) return null;
  return { file: path.join(dirPath, `record-v${bestVersion}.json`), version: bestVersion };
}

// ---------------------------------------------------------------------------
// Output validation.
// ---------------------------------------------------------------------------

/** The minimal shape the CLI `control --json` emits. */
interface CliControlReceipt {
  runId?: unknown;
  disposition?: unknown;
  status?: unknown;
}

/**
 * Parses the CLI's `--json` stdout for the control receipt shape. Requires the
 * stdout to be pure JSON — same honest-contract posture as submit.ts: any stdout
 * pollution ahead of the JSON would turn a successful control into a 500
 * `cli_protocol_error` rather than silently accepting malformed output.
 */
function parseCliReceipt(stdout: string): CliControlReceipt | null {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) return null;
  try {
    const parsed = JSON.parse(trimmed) as CliControlReceipt;
    if (
      typeof parsed.runId === 'string' &&
      typeof parsed.disposition === 'string' &&
      (parsed.status === undefined || typeof parsed.status === 'string')
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// The handler.
// ---------------------------------------------------------------------------

export interface HandleRunControlOptions {
  /** Override the CLI entry path (tests). */
  cliEntry?: string;
  /** Spawn timeout (default 30s). */
  timeoutMs?: number;
  /** SIGTERM → SIGKILL grace (default 2s). */
  killGraceMs?: number;
}

/**
 * Handles `POST /api/v1/runs/<changeId>/<runId>?space=...` (design §13).
 *
 * Pre-spawn admission rejects unknown/mismatched changeId/runId, bad space,
 * malformed body, wrong workspace, terminal Runs, engine conflicts, and stale
 * Record versions — all BEFORE any subprocess exists. Then spawns the local
 * CLI (`pipeline control <change> --run <runId> --from - --json`) with
 * structured, safe argv, pipes the validated body via stdin, and returns the
 * sealed response: the committed view + an EMPTY receipt action list.
 *
 * The bridge NEVER writes Record files in-process. All mutations go through
 * the CLI subprocess → frozen kernel → atomic filesystem commit.
 */
export async function handleRunControl(
  changeId: string,
  runId: string,
  root: string | undefined,
  home: ProjectHome | null,
  body: unknown,
  spawner: RunControlSpawner,
  options: HandleRunControlOptions = {}
): Promise<RunControlResult> {
  // --- Resolve the store root ---
  let storeRoot: string;
  try {
    const { getGlobalDataDir } = await import('../global-config.js');
    storeRoot = path.join(getGlobalDataDir(), 'runs');
  } catch {
    return { ok: false, status: 500, code: 'run_store_unavailable', message: 'Machine data directory is not available.' };
  }

  // --- Pre-spawn admission ---
  const admission = admitControlRequest(changeId, runId, root, body, storeRoot);
  if (!('record' in admission)) {
    return admission;
  }

  // --- A root is required for the CLI's cwd (pipeline definition resolution) ---
  if (!root) {
    return {
      ok: false,
      status: 400,
      code: 'no_project',
      message: 'A project root is required to control a Run. Select a space.',
    };
  }

  // --- Build safe, structured argv ---
  const cliEntry = options.cliEntry ?? resolveCliEntry();
  // Every argument is a discrete argv element. changeId and runId are already
  // validated against the Record's canonical fields — they cannot inject a
  // flag because spawn uses shell:false and each is its own argv token. The
  // `--from -` makes the CLI read the body from stdin, so no user text enters
  // argv at all.
  const argv: readonly string[] = [
    cliEntry,
    'pipeline',
    'control',
    changeId,
    '--run',
    runId,
    '--from',
    '-',
    '--json',
  ];

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const killGraceMs = options.killGraceMs ?? DEFAULT_KILL_GRACE_MS;

  // --- Spawn ---
  const result = await spawner({
    cwd: root,
    argv,
    stdin: JSON.stringify(body),
    timeoutMs,
    killGraceMs,
  });

  // --- Handle timeout ---
  if (result.timedOut) {
    return {
      ok: false,
      status: 504,
      code: 'cli_timeout',
      message: 'The CLI subprocess timed out.',
    };
  }

  // --- Handle non-zero exit ---
  if (result.exitCode !== 0) {
    const message = result.stderr.trim().length > 0
      ? result.stderr.trim()
      : 'The CLI exited with an error and produced no message.';
    return {
      ok: false,
      status: 422,
      code: 'cli_error',
      message,
      cliExitCode: result.exitCode ?? undefined,
      stderr: result.stderr,
    };
  }

  // --- Parse CLI output ---
  const receipt = parseCliReceipt(result.stdout);
  if (receipt === null) {
    return {
      ok: false,
      status: 500,
      code: 'cli_protocol_error',
      message: `The CLI exited successfully but its output could not be parsed: ${result.stdout.slice(0, 500) || '(empty)'}`,
    };
  }

  // --- Re-project the committed view (fresh read after the CLI finished) ---
  // This is a READ of the head Record — the bridge never writes. The CLI
  // subprocess already committed the control decision through the kernel's
  // atomic publish path; we just project the result.
  const postRecord = loadHeadRecord(storeRoot, runId);
  if (postRecord === null) {
    return {
      ok: false,
      status: 500,
      code: 'run_store_unavailable',
      message: `The Run record could not be read after the control was applied.`,
    };
  }
  // Load the persisted RuntimePlan so the review-cycle section is projected
  // (Major-2: operations emits the same review-cycle section as CLI).
  const runDirName = runId.replace(/[^a-z0-9]/gi, '_');
  const runDirPath = path.join(storeRoot, runDirName);
  let plan: RuntimePlan | undefined;
  try {
    const planFile = path.join(runDirPath, 'plan.json');
    if (fs.existsSync(planFile)) {
      plan = JSON.parse(fs.readFileSync(planFile, 'utf-8')) as RuntimePlan;
    }
  } catch {
    // Plan file absent or corrupt — project without it (additive section).
  }
  const view = projectRunView(postRecord, undefined, plan);

  // --- Seal the response: committed view + EMPTY action list ---
  // The control method inherently defers (facade.control ignores deliveryMode
  // and always returns empty actions). The receipt actions are sealed to empty
  // regardless of what the CLI output contained — no executable payload leaves
  // via HTTP. A subsequent trusted CLI resume performs the first atomic grant.
  return {
    ok: true,
    status: 200,
    response: {
      view,
      disposition: receipt.disposition as string,
      actions: [] as readonly never[],
    },
  };
}

/**
 * Loads and decodes the head Record for a Run (read-only). Returns null if the
 * Record cannot be found or decoded. Used for the post-spawn view projection.
 */
function loadHeadRecord(storeRoot: string, runId: string): CanonicalRunRecord | null {
  const dirName = runId.replace(/[^a-z0-9]/gi, '_');
  const dirPath = path.join(storeRoot, dirName);
  const head = findHeadRecord(dirPath);
  if (head === null) return null;
  try {
    const raw = fs.readFileSync(head.file, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    return decodeCanonicalRunRecord(parsed);
  } catch {
    return null;
  }
}
