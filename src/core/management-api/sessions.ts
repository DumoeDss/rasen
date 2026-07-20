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
import { buildChangeRunEntry } from './runs.js';
import { CONTROL_CHAR_PATTERN } from './submit.js';
import {
  NO_OUTPUT_TIMEOUT_CAP_MS,
  OVERALL_TIMEOUT_CAP_MS,
  getSupervisedEntry,
} from './whitelist.js';
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
  launchProjectRoot: string | null,
  body: Partial<LaunchSessionRequest>
): Promise<SessionsResult> {
  const entry = getSupervisedEntry(body.kind);
  if (!entry) {
    return { ok: false, status: 400, code: 'invalid_input', message: 'kind must be one of the supervised long-runner operations.' };
  }

  const taskError = validateTask(body.task);
  if (taskError) {
    return { ok: false, status: 400, code: 'invalid_input', message: taskError };
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

  if (!launchProjectRoot) {
    return {
      ok: false,
      status: 409,
      code: 'no_project',
      message: 'No Rasen project is available for this server; launch `rasen ui` inside a project.',
    };
  }

  const result = await supervisor.launch({
    kind: entry.op as 'auto' | 'goal',
    skill: entry.skill,
    task: body.task as string,
    cwd: launchProjectRoot,
    ...(changeName !== undefined ? { changeName } : {}),
    timeoutMs,
    noOutputTimeoutMs,
  });

  if (!result.ok) {
    return { ok: false, status: result.status, code: result.code, message: result.message };
  }
  return { ok: true, status: 201, response: { session: toWire(result.record) } };
}

/**
 * `GET /api/v1/sessions` (design D4): registry records + a read-only
 * run-state join for any session carrying a `changeName`. Sessions without
 * one report `runState: { kind: 'absent' }`.
 */
export function handleListSessions(
  supervisor: SessionSupervisor,
  launchProjectRoot: string | null,
  home: ProjectHome | null
): SessionsResponse {
  const sessions: SessionListEntry[] = supervisor.list().map((record) => {
    if (!record.changeName || !launchProjectRoot) {
      return { session: toWire(record), runState: { kind: 'absent' } };
    }
    const changeDir = path.join(launchProjectRoot, WORKSPACE_DIR_NAME, 'changes', record.changeName);
    const workDir = home ? home.workDir(record.changeName) : null;
    return { session: toWire(record), runState: buildChangeRunEntry(record.changeName, changeDir, workDir) };
  });
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
