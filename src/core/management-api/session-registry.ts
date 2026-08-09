/**
 * In-memory session registry (design D2). `Map`-backed, no server
 * dependencies of its own — child 2's daemon must be able to construct and
 * own this exact module standalone, so it imports nothing from `server.ts`
 * or `router.ts`. Getters return copies so callers can never mutate
 * registry state by holding a reference to an internal record.
 */
import { randomUUID } from 'node:crypto';
// Type-only (erased at build): the runtime execution vocabulary is declared
// once in `session-runtime-context.ts` rather than redeclared here, and a
// type-only import adds nothing to this module's runtime graph.
import type { RuntimeExecutionRef } from '../session-runtime-context.js';

export type SessionKind = 'auto' | 'goal';

export type SessionState = 'starting' | 'running' | 'exiting' | 'exited';

export type TerminationReason =
  | 'exit'
  | 'signal'
  | 'overall-timeout'
  | 'no-output-timeout'
  | 'killed'
  | 'server-shutdown'
  | 'spawn-error';

/**
 * The planning space a session is attributed to (planning-space-addressing
 * design D3), frozen at launch from the session's cwd (or the explicitly
 * selected launch space). Structurally identical to `DerivedSpace`
 * (root-selection.ts); redeclared here so the session registry stays
 * dependency-light.
 */
export interface SessionSpace {
  type: 'project' | 'store';
  id: string;
  root: string;
}

/**
 * What a session works on, frozen at launch (unified-session-runtime-context
 * design D2). Planning-only is the explicit `{ kind: 'planning-only' }` arm,
 * never an omitted field — "this session changes no project code" is a fact
 * the record states, not one a reader infers from a gap.
 *
 * The field itself stays optional on `SessionRecord` only for records created
 * before this capability existed (and by tests that construct a record
 * directly); every launch through `resolveSessionLaunchContext` sets it.
 */
export type SessionExecution = RuntimeExecutionRef;

export interface SessionRecord {
  id: string;
  kind: SessionKind;
  task: string;
  cwd: string;
  /** Planning space this session belongs to (design D3), frozen at launch. Absent when the cwd yields no derivable space. */
  space?: SessionSpace;
  /** Execution identity + local checkout binding, frozen at launch. */
  execution?: SessionExecution;
  pid?: number;
  /** The claude CLI's own session id, parsed best-effort from the stream-json `init` event — observability only, never the registry key. */
  agentSessionId?: string;
  state: SessionState;
  startedAt: number;
  lastOutputAt: number;
  endedAt?: number;
  exitCode?: number | null;
  exitSignal?: string | null;
  terminationReason?: TerminationReason;
  changeName?: string;
}

/** Retention cap on ended records (design D2): oldest pruned first once exceeded. */
const MAX_EXITED_RECORDS = 50;

export interface SessionRegistry {
  /** Creates a new record in state `starting` and returns its id. */
  create(input: {
    kind: SessionKind;
    task: string;
    cwd: string;
    changeName?: string;
    space?: SessionSpace;
    execution?: SessionExecution;
  }): SessionRecord;
  get(id: string): SessionRecord | undefined;
  list(): SessionRecord[];
  updateState(id: string, state: SessionState, patch?: Partial<SessionRecord>): void;
  touchOutput(id: string): void;
  /**
   * Marks the record `exited`, sets `endedAt`, and prunes the oldest exited
   * record(s) past the retention cap. Returns the ids of any records pruned
   * by this call (review m2) — the registry itself holds no per-session
   * side-resources, but a caller (the supervisor's output tails) that keys
   * its own external map off session id needs to know which ids just
   * stopped existing, or that map grows unbounded even though the registry
   * stays capped.
   */
  finalize(
    id: string,
    reason: TerminationReason,
    exitCode?: number | null,
    exitSignal?: string | null
  ): string[];
}

/**
 * Copy-on-read. The nested `space` and `execution` refs are cloned too: a
 * shallow spread would hand every caller the SAME object, so one caller
 * mutating `record.execution.root` would silently retarget the session for
 * everyone else holding a "copy".
 */
function copy(record: SessionRecord): SessionRecord {
  return {
    ...record,
    ...(record.space !== undefined ? { space: { ...record.space } } : {}),
    ...(record.execution !== undefined ? { execution: { ...record.execution } } : {}),
  };
}

export function createSessionRegistry(): SessionRegistry {
  const records = new Map<string, SessionRecord>();

  function pruneExited(): string[] {
    const exited: SessionRecord[] = [];
    for (const record of records.values()) {
      if (record.state === 'exited') exited.push(record);
    }
    if (exited.length <= MAX_EXITED_RECORDS) return [];

    exited.sort((a, b) => (a.endedAt ?? 0) - (b.endedAt ?? 0));
    const toRemove = exited.length - MAX_EXITED_RECORDS;
    const prunedIds: string[] = [];
    for (let i = 0; i < toRemove; i++) {
      records.delete(exited[i].id);
      prunedIds.push(exited[i].id);
    }
    return prunedIds;
  }

  return {
    create(input) {
      const now = Date.now();
      const record: SessionRecord = {
        id: randomUUID(),
        kind: input.kind,
        task: input.task,
        cwd: input.cwd,
        state: 'starting',
        startedAt: now,
        lastOutputAt: now,
        ...(input.changeName !== undefined ? { changeName: input.changeName } : {}),
        ...(input.space !== undefined ? { space: input.space } : {}),
        ...(input.execution !== undefined ? { execution: input.execution } : {}),
      };
      records.set(record.id, record);
      return copy(record);
    },

    get(id) {
      const record = records.get(id);
      return record ? copy(record) : undefined;
    },

    list() {
      return Array.from(records.values()).map(copy);
    },

    updateState(id, state, patch) {
      const record = records.get(id);
      if (!record) return;
      record.state = state;
      if (patch) {
        if (patch.pid !== undefined) record.pid = patch.pid;
        if (patch.agentSessionId !== undefined) record.agentSessionId = patch.agentSessionId;
        if (patch.terminationReason !== undefined) record.terminationReason = patch.terminationReason;
        if (patch.exitCode !== undefined) record.exitCode = patch.exitCode;
        if (patch.exitSignal !== undefined) record.exitSignal = patch.exitSignal;
      }
    },

    touchOutput(id) {
      const record = records.get(id);
      if (!record) return;
      record.lastOutputAt = Date.now();
    },

    finalize(id, reason, exitCode, exitSignal) {
      const record = records.get(id);
      if (!record) return [];
      record.state = 'exited';
      record.endedAt = Date.now();
      // First-set termination reason wins (mirrors omnicross run-registry):
      // a watchdog/overall-timeout cancellation races the child's own
      // 'close' event, and the reason that identified *why* the kill
      // happened should not be overwritten by the generic 'signal'/'exit'
      // that close() reports afterward.
      if (!record.terminationReason) {
        record.terminationReason = reason;
      }
      if (exitCode !== undefined) record.exitCode = exitCode;
      if (exitSignal !== undefined) record.exitSignal = exitSignal;
      return pruneExited();
    },
  };
}

// Durable reusable-session state is deliberately separate from the one-shot
// in-memory record model above. Re-exporting it here keeps this module as the
// single management-layer registry boundary without changing the established
// `createSessionRegistry()` API.
export * from './durable-session-registry.js';
