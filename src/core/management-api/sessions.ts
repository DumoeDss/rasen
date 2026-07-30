/**
 * Sessions HTTP handlers (design D4): `POST /api/v1/sessions` (launch),
 * `GET /api/v1/sessions` (list, registry + read-only run-state join),
 * `GET /api/v1/sessions/:id` (detail + bounded tails), `DELETE
 * /api/v1/sessions/:id` (kill). Validation mirrors slice 2's `submit.ts`
 * (task text: non-empty, length-capped, control-chars-free except tab/
 * newline) and reuses `validateChangeName` for the optional `changeName`.
 */
import * as path from 'node:path';

import { validateChangeName } from '../../utils/change-utils.js';
import { WORKSPACE_DIR_NAME } from '../config.js';
import type { ProjectHome } from '../project-home.js';
import { FileSystemUtils } from '../../utils/file-system.js';
import { buildChangeRunEntry } from './runs.js';
import { ephemeraDir } from '../file-placement.js';
import { CONTROL_CHAR_PATTERN } from './submit.js';
import {
  NO_OUTPUT_TIMEOUT_CAP_MS,
  OVERALL_TIMEOUT_CAP_MS,
  getSupervisedEntry,
} from './whitelist.js';
import {
  resolveSessionLaunchContext,
  type ResolveSessionLaunchContextInput,
} from './session-launch-context.js';
import type { SessionSupervisor } from './supervisor.js';
import type {
  LaunchSessionRequest,
  SessionDetailResponse,
  SessionListEntry,
  SessionRecordWire,
  SessionsResponse,
} from './wire-types.js';

/** Length cap on the submitted task text (design D1; matches slice 2's description cap). */
const MAX_TASK_LENGTH = 10_000;

export type SessionsResult =
  | { ok: true; status: number; response: unknown }
  | { ok: false; status: number; code: string; message: string };

function canonicalizeOrResolve(target: string): string {
  try {
    return FileSystemUtils.canonicalizeExistingPath(target);
  } catch {
    return path.resolve(target);
  }
}

function validateTask(task: unknown): string | null {
  if (typeof task !== 'string' || task.length === 0) {
    return 'task must be a non-empty string.';
  }
  if (task.length > MAX_TASK_LENGTH) {
    return `task must be at most ${MAX_TASK_LENGTH} characters.`;
  }
  if (CONTROL_CHAR_PATTERN.test(task)) {
    return 'task must not contain control characters.';
  }
  return null;
}

function toWire(record: import('./session-registry.js').SessionRecord): SessionRecordWire {
  return { ...record };
}

/**
 * `POST /api/v1/sessions` (design D4). Validation order matches tasks.md
 * 2.3: kind/task/changeName/timeout shape, then the concurrency cap, then
 * agent-CLI availability (the latter two live inside `supervisor.launch`,
 * called last so a 400 never touches the supervisor's cap or spawns
 * anything).
 */
export async function handleLaunchSession(
  supervisor: SessionSupervisor,
  body: Partial<LaunchSessionRequest>,
  launchProject: ResolveSessionLaunchContextInput['launchProject']
): Promise<SessionsResult> {
  const entry = getSupervisedEntry(body.kind);
  if (!entry) {
    return { ok: false, status: 400, code: 'invalid_input', message: 'kind must be one of the supervised long-runner operations.' };
  }

  const taskError = validateTask(body.task);
  if (taskError) {
    return { ok: false, status: 400, code: 'invalid_input', message: taskError };
  }

  if (body.space !== undefined && typeof body.space !== 'string') {
    return { ok: false, status: 400, code: 'invalid_input', message: 'space must be a string.' };
  }

  let changeName: string | undefined;
  if (body.changeName !== undefined) {
    if (typeof body.changeName !== 'string') {
      return { ok: false, status: 400, code: 'invalid_input', message: 'changeName must be a string.' };
    }
    const nameCheck = validateChangeName(body.changeName);
    if (!nameCheck.valid) {
      return { ok: false, status: 400, code: 'invalid_input', message: nameCheck.error ?? 'Invalid changeName.' };
    }
    changeName = body.changeName;
  }

  let timeoutMs = entry.defaultTimeoutMs;
  if (body.timeoutMs !== undefined) {
    if (typeof body.timeoutMs !== 'number' || !Number.isFinite(body.timeoutMs) || body.timeoutMs <= 0) {
      return { ok: false, status: 400, code: 'invalid_input', message: 'timeoutMs must be a positive number.' };
    }
    if (body.timeoutMs > OVERALL_TIMEOUT_CAP_MS) {
      return { ok: false, status: 400, code: 'invalid_input', message: `timeoutMs must be at most ${OVERALL_TIMEOUT_CAP_MS}.` };
    }
    timeoutMs = body.timeoutMs;
  }

  let noOutputTimeoutMs = entry.defaultNoOutputTimeoutMs;
  if (body.noOutputTimeoutMs !== undefined) {
    if (typeof body.noOutputTimeoutMs !== 'number' || !Number.isFinite(body.noOutputTimeoutMs) || body.noOutputTimeoutMs <= 0) {
      return { ok: false, status: 400, code: 'invalid_input', message: 'noOutputTimeoutMs must be a positive number.' };
    }
    if (body.noOutputTimeoutMs > NO_OUTPUT_TIMEOUT_CAP_MS) {
      return { ok: false, status: 400, code: 'invalid_input', message: `noOutputTimeoutMs must be at most ${NO_OUTPUT_TIMEOUT_CAP_MS}.` };
    }
    noOutputTimeoutMs = body.noOutputTimeoutMs;
  }

  // The deep selector-in/facts-out resolver owns every planning/execution
  // registry, worktree, pointer, path, and attachment rule. This handler
  // validates only generic request fields and passes launch-ready facts on.
  const launchContext = await resolveSessionLaunchContext({
    ...(typeof body.space === 'string' ? { space: body.space } : {}),
    ...((body as { execution?: unknown }).execution !== undefined
      ? { execution: (body as { execution?: unknown }).execution }
      : {}),
    launchProject,
  });
  if (!launchContext.ok) {
    return {
      ok: false,
      status: launchContext.status,
      code: launchContext.code,
      message: launchContext.message,
    };
  }

  const resolved = launchContext.context;
  const result = await supervisor.launch({
    kind: entry.op as 'auto' | 'goal',
    skill: entry.skill,
    task: body.task as string,
    cwd: resolved.cwd,
    attachedRoots: resolved.attachedRoots,
    ...(changeName !== undefined ? { changeName } : {}),
    ...(resolved.planningSpace !== undefined ? { space: resolved.planningSpace } : {}),
    // The resolver already worked out which project this session executes in
    // and which checkout that is on this machine. Passing it on is the whole
    // point of `session-runtime-context`: before this, the answer survived
    // only as `cwd`, and every downstream consumer re-derived it.
    execution: resolved.execution,
    timeoutMs,
    noOutputTimeoutMs,
  });

  if (!result.ok) {
    return { ok: false, status: result.status, code: result.code, message: result.message };
  }
  return { ok: true, status: 201, response: { session: toWire(result.record) } };
}

/**
 * `GET /api/v1/sessions` (design D3/D4): registry records, optionally filtered
 * to a single space, with each listed session's run-state joined against its
 * OWN recorded space root and that space's machine home (not the server's
 * launch project). `filterRoot` (a canonical root) restricts the listing to
 * sessions recorded in that space; when omitted, every session is returned
 * (unattributed ones included, compat). A session without a recorded space or
 * a `changeName` reports `runState: { kind: 'absent' }`.
 */
export async function handleListSessions(
  supervisor: SessionSupervisor,
  filterRoot: string | undefined,
  resolveHomeForRoot: (root: string) => Promise<ProjectHome | null>
): Promise<SessionsResponse> {
  const sessions: SessionListEntry[] = [];
  for (const record of supervisor.list()) {
    if (filterRoot !== undefined) {
      if (!record.space || canonicalizeOrResolve(record.space.root) !== filterRoot) {
        continue;
      }
    }
    if (!record.changeName || !record.space) {
      sessions.push({ session: toWire(record), runState: { kind: 'absent' } });
      continue;
    }
    const changeDir = path.join(record.space.root, WORKSPACE_DIR_NAME, 'changes', record.changeName);
    const home = await resolveHomeForRoot(record.space.root);
    // Resolved against the SESSION's own space, never the server's launch
    // project: its execution root's ephemera directory first, then that
    // space's machine-home work directory, then its change directory.
    const locations = {
      ephemeraDir: ephemeraDir(record.space.root, record.changeName),
      workDir: home ? home.workDir(record.changeName) : null,
    };
    sessions.push({ session: toWire(record), runState: buildChangeRunEntry(record.changeName, changeDir, locations) });
  }
  return { sessions };
}

/** `GET /api/v1/sessions/:id` (design D4): the record plus bounded tails, 404 unknown. */
export function handleGetSession(
  supervisor: SessionSupervisor,
  id: string
): { ok: true; status: 200; response: SessionDetailResponse } | { ok: false; status: 404 } {
  const record = supervisor.getRecord(id);
  if (!record) return { ok: false, status: 404 };
  const tails = supervisor.getTails(id) ?? { stdout: '', stderr: '' };
  return { ok: true, status: 200, response: { session: toWire(record), tails } };
}

/** `DELETE /api/v1/sessions/:id` (design D4): 202 exiting for live, 200 idempotent for exited, 404 unknown. */
export function handleKillSession(
  supervisor: SessionSupervisor,
  id: string
): { ok: true; status: 200 | 202; response: { session: SessionRecordWire } } | { ok: false; status: 404 } {
  const result = supervisor.kill(id);
  if (!result.ok) return { ok: false, status: 404 };
  return { ok: true, status: result.status, response: { session: toWire(result.record) } };
}
