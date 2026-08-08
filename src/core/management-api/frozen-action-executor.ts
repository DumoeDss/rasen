/**
 * `POST /api/v1/frozen-action-executor/dispatch` — the daemon face of the
 * frozen-action session executor (task 7.1 driver-face wiring).
 *
 * Routes a granted frozen Action through the shared `dispatchGrantedAction`
 * contract at the daemon seam (where the `SessionHost` lives). The CLI, Canvas,
 * interactive launcher, and daemon all reach the executor through this one
 * endpoint, so no face maintains a second Run or Session truth (design D7). The
 * executor validates the granted ActionView against the committed Record
 * (loaded read-only, same path as `run-control.ts`), selects a backend through
 * the capability matrix (never silently rerouting), drives the SessionHost, and
 * reconciles the host outcome into a typed Action outcome.
 *
 * Like `hosted-sessions/execute`, this endpoint drives the trusted daemon-owned
 * `SessionHost` in-process (the daemon is the trusted path, not a browser). It
 * performs NO Record mutation: completion is written only through the canonical
 * Facade `complete` path (run-control spawns the CLI for that). This endpoint
 * returns the typed `ExecutionDispatchResult` the caller completes from.
 */
import * as path from 'node:path';
import * as fs from 'node:fs';

import type { SessionHost, TurnLimits } from '../session-host/contracts.js';
import {
  decodeRunAction,
  decodeWorkspaceRevision,
  type ExactChangeRunRef,
  type RunAction,
  type WorkspaceRevision,
} from '../change-run/index.js';
import { decodeCanonicalRunRecord, type CanonicalRunRecord } from '../change-run/internal/record.js';
import { createProductionExecutor } from '../frozen-action-executor/index.js';
import type { ExecutionBackendId } from '../frozen-action-executor/index.js';

const MAX_DISPATCH_BODY_BYTES = 2 * 1024 * 1024;

export interface FrozenActionDispatchBody {
  readonly runRef: ExactChangeRunRef;
  readonly grantedAction: RunAction;
  readonly expectedRecordVersion: number;
  readonly workspaceRevision: WorkspaceRevision;
  readonly requestedBackend?: ExecutionBackendId;
  readonly explicitDefaultBackend?: ExecutionBackendId;
  readonly turnInput: string;
  readonly hostedSeam: { readonly cwd: string; readonly backend: string; readonly limits: TurnLimits };
}

export type FrozenActionDispatchResult =
  | { readonly ok: true; readonly status: number; readonly result: unknown }
  | { readonly ok: false; readonly status: number; readonly code: string; readonly message: string };

function findHeadRecordFile(dirPath: string): string | null {
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
  return path.join(dirPath, `record-v${bestVersion}.json`);
}

function loadHeadRecord(storeRoot: string, runId: string): CanonicalRunRecord | null {
  const dirName = runId.replace(/[^a-z0-9]/gi, '_');
  const file = findHeadRecordFile(path.join(storeRoot, dirName));
  if (file === null) return null;
  try {
    const raw = fs.readFileSync(file, 'utf-8');
    return decodeCanonicalRunRecord(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

/**
 * Resolve the machine run-store root (`<dataDir>/runs`), the same location
 * `run-control.ts` resolves. Returns null if the data directory is unavailable.
 */
async function resolveRunStoreRoot(): Promise<string | null> {
  try {
    const { getGlobalDataDir } = await import('../global-config.js');
    return path.join(getGlobalDataDir(), 'runs');
  } catch {
    return null;
  }
}

function badRequest(code: string, message: string): FrozenActionDispatchResult {
  return { ok: false, status: 400, code, message };
}

/**
 * Handle `POST /api/v1/frozen-action-executor/dispatch`. The body is a
 * {@link FrozenActionDispatchBody}; the URL path carries the changeId + runId
 * (cross-checked against the body's runRef, same as run-control). Loads the head
 * Record read-only, constructs the production executor bound to the daemon's
 * `SessionHost`, dispatches the granted Action, and returns the typed
 * `ExecutionDispatchResult`.
 */
export async function handleFrozenActionDispatch(input: Readonly<{
  host: SessionHost;
  hostPlatform: string;
  body: unknown;
  bodyBytes?: number;
  storeRoot?: string;
}>): Promise<FrozenActionDispatchResult> {
  if ((input.bodyBytes ?? 0) > MAX_DISPATCH_BODY_BYTES) {
    return { ok: false, status: 413, code: 'body_too_large', message: 'Dispatch body exceeds the size limit.' };
  }
  if (input.body === null || typeof input.body !== 'object' || Array.isArray(input.body)) {
    return badRequest('bad_request', 'Dispatch body must be a JSON object.');
  }

  const envelope = input.body as {
    runRef?: unknown;
    grantedAction?: unknown;
    expectedRecordVersion?: unknown;
    workspaceRevision?: unknown;
    requestedBackend?: unknown;
    explicitDefaultBackend?: unknown;
    turnInput?: unknown;
    hostedSeam?: unknown;
  };

  // --- Decode the runRef (the body's authority; the endpoint is path-flat) ---
  let runRef: ExactChangeRunRef;
  try {
    if (envelope.runRef === null || typeof envelope.runRef !== 'object') {
      throw new Error('runRef must be an object.');
    }
    const ref = envelope.runRef as { change?: { changeId?: unknown }; runId?: unknown };
    if (typeof ref.change?.changeId !== 'string' || typeof ref.runId !== 'string') {
      throw new Error('runRef must carry change.changeId and runId strings.');
    }
    runRef = envelope.runRef as ExactChangeRunRef;
  } catch (err) {
    return badRequest('invalid_run_ref', err instanceof Error ? err.message : String(err));
  }
  const changeId = runRef.change.changeId;
  const runId = runRef.runId;

  // --- Decode the granted Action + workspace revision through the strict schemas ---
  let grantedAction: RunAction;
  try {
    grantedAction = decodeRunAction(envelope.grantedAction);
  } catch (err) {
    return badRequest('invalid_granted_action', err instanceof Error ? err.message : String(err));
  }
  if (typeof envelope.expectedRecordVersion !== 'number' || !Number.isInteger(envelope.expectedRecordVersion)) {
    return badRequest('invalid_expected_record_version', 'expectedRecordVersion must be an integer.');
  }
  let workspaceRevision: WorkspaceRevision;
  try {
    workspaceRevision = decodeWorkspaceRevision(envelope.workspaceRevision);
  } catch (err) {
    return badRequest('invalid_workspace_revision', err instanceof Error ? err.message : String(err));
  }
  if (typeof envelope.turnInput !== 'string' || envelope.turnInput.length === 0) {
    return badRequest('invalid_turn_input', 'turnInput must be a non-empty string.');
  }
  if (envelope.requestedBackend !== undefined && envelope.requestedBackend !== 'hosted' && envelope.requestedBackend !== 'in-tool') {
    return badRequest('invalid_backend', 'requestedBackend must be "hosted" or "in-tool".');
  }
  if (envelope.hostedSeam === null || typeof envelope.hostedSeam !== 'object') {
    return badRequest('invalid_hosted_seam', 'hostedSeam must be an object.');
  }

  // --- Load the head Record read-only (no mutation here) ---
  const storeRoot = input.storeRoot ?? (await resolveRunStoreRoot());
  if (storeRoot === null) {
    return { ok: false, status: 500, code: 'run_store_unavailable', message: 'Machine data directory is not available.' };
  }
  const record = loadHeadRecord(storeRoot, runId);
  if (record === null) {
    return { ok: false, status: 404, code: 'run_not_found', message: `No Run record found for ${runId}.` };
  }
  if (record.change.changeId !== changeId) {
    return { ok: false, status: 404, code: 'run_not_found', message: `Run ${runId} does not belong to change ${changeId}.` };
  }

  // --- Construct the production executor bound to the daemon's SessionHost + dispatch ---
  const executor = createProductionExecutor({
    hostPlatform: input.hostPlatform,
    host: input.host,
    hostedSeamOptions: {
      cwd: (envelope.hostedSeam as { cwd: string }).cwd,
      backend: (envelope.hostedSeam as { backend: string }).backend,
      limits: (envelope.hostedSeam as { limits: TurnLimits }).limits,
    },
  });
  const result = await executor.dispatch({
    runRef,
    grantedAction,
    record,
    expectedRecordVersion: envelope.expectedRecordVersion,
    workspaceRevision,
    requestedBackend: envelope.requestedBackend as ExecutionBackendId | undefined,
    explicitDefaultBackend: envelope.explicitDefaultBackend as ExecutionBackendId | undefined,
    turnInput: envelope.turnInput,
  });

  return { ok: true, status: 200, result };
}
