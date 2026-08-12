/**
 * Sessions HTTP handlers (design D4): `POST /api/v1/sessions` (launch),
 * `GET /api/v1/sessions` (list, registry + read-only run-state join),
 * `GET /api/v1/sessions/:id` (detail + bounded tails), `DELETE
 * /api/v1/sessions/:id` (kill). Validation mirrors slice 2's `submit.ts`
 * (task text: non-empty, length-capped, control-chars-free except tab/
 * newline) and reuses `validateChangeName` for the optional `changeName`.
 */
import * as fs from 'node:fs';

import { validateChangeName } from '../../utils/change-utils.js';
import type { ProjectHome } from '../project-home.js';
import { StorePlanning, type PlanningSelection } from '../store-planning/index.js';
import type { ResolvedSpace } from '../config-api/project-addressing.js';
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
 * OWN frozen execution root and that checkout's machine home (not the
 * planning Store or server launch project). `filterSpace` restricts the
 * listing by recorded planning space IDENTITY (type + id) rather than by a
 * canonical root, so a Store space matches every session recorded against it
 * regardless of which member checkout each one executes in; when omitted,
 * every session is returned (unattributed ones included, compat). A session
 * without a recorded space, change name, or usable frozen project execution
 * reports `runState: { kind: 'absent' }`.
 */
export async function handleListSessions(
  supervisor: SessionSupervisor,
  filterSpace: Pick<ResolvedSpace, 'type' | 'id'> | undefined,
  resolveHomeForRoot: (root: string) => Promise<ProjectHome | null>
): Promise<SessionsResponse> {
  const sessions: SessionListEntry[] = [];
  for (const record of supervisor.list()) {
    if (filterSpace !== undefined) {
      if (
        !record.space ||
        record.space.type !== filterSpace.type ||
        record.space.id !== filterSpace.id
      ) {
        continue;
      }
    }
    if (!record.changeName || !record.space) {
      sessions.push({ session: toWire(record), runState: { kind: 'absent' } });
      continue;
    }
    if (!record.execution || record.execution.kind !== 'project') {
      sessions.push({ session: toWire(record), runState: { kind: 'absent' } });
      continue;
    }
    let executionRoot: string;
    try {
      const stats = fs.statSync(record.execution.root);
      if (!stats.isDirectory()) {
        sessions.push({ session: toWire(record), runState: { kind: 'absent' } });
        continue;
      }
      executionRoot = FileSystemUtils.canonicalizeExistingPath(record.execution.root);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ENOTDIR') {
        sessions.push({ session: toWire(record), runState: { kind: 'absent' } });
      } else {
        sessions.push({
          session: toWire(record),
          runState: {
            name: record.changeName,
            kind: 'error',
            message: error instanceof Error ? error.message : String(error),
          },
        });
      }
      continue;
    }
    let home: ProjectHome | null;
    try {
      home = await resolveHomeForRoot(executionRoot);
    } catch (error) {
      sessions.push({
        session: toWire(record),
        runState: {
          name: record.changeName,
          kind: 'error',
          message: error instanceof Error ? error.message : String(error),
        },
      });
      continue;
    }

    // The Change directory comes from the resolved planning scope, never from
    // joining `<space.root>/rasen/changes` — that flat join is exactly what a
    // Store v2 project partition invalidates.
    const facts = record.space.planning;
    let selection: PlanningSelection | undefined;
    if (facts?.storeUid !== undefined || facts?.storeId !== undefined) {
      selection = {
        store: facts.storeUid ?? facts.storeId,
        project: facts.projectId ?? record.execution.projectId,
        ...(facts.targetLineId === undefined ? {} : { targetLine: facts.targetLineId }),
      };
    } else if (record.space.type === 'store') {
      selection = { store: record.space.id, project: record.execution.projectId };
    }

    let changeDir: string;
    let storeV2Planning = false;
    try {
      const planningScope = await StorePlanning.open({
        intent: 'project-read',
        startPath: executionRoot,
        ...(selection === undefined ? {} : { selection }),
        change: { changeId: record.changeName },
      });
      changeDir = (await planningScope.openChange({ changeId: record.changeName })).location.absolutePath;
      storeV2Planning = planningScope.describe().kind === 'store-project';
    } catch (error) {
      sessions.push({
        session: toWire(record),
        runState: {
          name: record.changeName,
          kind: 'error',
          message: error instanceof Error ? error.message : String(error),
        },
      });
      continue;
    }

    // Terminal locations belong to the frozen execution checkout. For a Store
    // v2 project scope the planning Change directory is NEVER an ephemera
    // fallback (task 5.5); for standalone and legacy scopes it remains the
    // oldest compatibility location.
    const locations = {
      ephemeraDir: ephemeraDir(executionRoot, record.changeName),
      workDir: home ? home.workDir(record.changeName) : null,
      ...(storeV2Planning ? { includeChangeDir: false } : {}),
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
