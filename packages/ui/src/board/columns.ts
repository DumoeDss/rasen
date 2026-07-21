/**
 * Pure lifecycle-column derivation for the board (design.md D8 of
 * `rasen-ui-slice1-readonly-api`). Kept separate from rendering so it is
 * testable without a DOM (same precedent as `config/grouping.ts`). Column
 * assignment is UI policy, not a wire field (design D4) — the API reports
 * facts (`applyReady`, `taskProgress`, run state); this derives the board's
 * four lifecycle columns from those facts.
 */
import type {
  ChangeRunEntry,
  ChangeSummary,
  SessionListEntry,
  SessionRecordWire,
} from '../api/types.js';

export type BoardColumn = 'planning' | 'ready' | 'in-progress' | 'done';

export interface DerivedColumn {
  column: BoardColumn;
  /** An escalated stage exists for this change's run — rendered as a badge, never a fifth column (design D8). */
  escalated: boolean;
}

function autoRunStages(run: ChangeRunEntry | undefined) {
  if (!run || run.kind !== 'ok' || run.autoRun.kind !== 'ok') return undefined;
  return run.autoRun.state.stages;
}

function hasActiveRun(run: ChangeRunEntry | undefined): boolean {
  const stages = autoRunStages(run);
  if (!stages) return false;
  return Object.values(stages).some((s) => s.status === 'in_progress' || s.status === 'escalated');
}

function isEscalated(run: ChangeRunEntry | undefined): boolean {
  const stages = autoRunStages(run);
  if (!stages) return false;
  return Object.values(stages).some((s) => s.status === 'escalated');
}

/**
 * Maps one change (plus its optional run-state entry) to a lifecycle column:
 * apply-required artifacts not yet done → Planning; apply-ready with no
 * tasks completed and no active run → Ready; some tasks completed, or a run
 * reports an in-progress/escalated stage → In Progress; all tasks completed
 * → Done. Escalation is reported as a badge flag alongside the column, not a
 * fifth column.
 *
 * Zero-task case (design D8 addendum, review round 1 m1): a change with
 * `applyReady: true` but no `tasks.md` at all (`taskProgress.total === 0`)
 * has nothing left for a task-based Done check to confirm, so it would be
 * stranded in Ready forever under a naive `total > 0 && completed === total`
 * test. Explicit decision: an apply-ready, task-less change with
 * `isComplete: true` (every schema artifact done — the strongest completion
 * signal the API reports) counts as Done. A task-less change that is
 * apply-ready but NOT `isComplete` (e.g. a schema with post-apply artifacts
 * still open) stays in Ready, which is still correct — there is more to do.
 */
export function deriveColumn(change: ChangeSummary, run?: ChangeRunEntry): DerivedColumn {
  const escalated = isEscalated(run);

  if (!change.applyReady) {
    return { column: 'planning', escalated };
  }

  const { total, completed } = change.taskProgress;
  const isDone = total > 0 ? completed === total : change.isComplete;
  if (isDone) {
    return { column: 'done', escalated };
  }

  if (completed > 0 || hasActiveRun(run)) {
    return { column: 'in-progress', escalated };
  }

  return { column: 'ready', escalated };
}

export const BOARD_COLUMNS: { id: BoardColumn; label: string }[] = [
  { id: 'planning', label: 'Planning' },
  { id: 'ready', label: 'Ready' },
  { id: 'in-progress', label: 'In Progress' },
  { id: 'done', label: 'Done' },
];

// ---- Tasks (ui-space-redesign-task-board design D1/D2/D3) ----
// The board's unit of intent is the Task, not the raw change: a portfolio
// container groups its child changes into one Task; a change with no
// container is an implicit single-item Task. Grouping, column placement, and
// live-run derivation stay UI-side (the same "column assignment is UI policy"
// precedent as `deriveColumn`); the one fact the UI cannot compute — portfolio
// membership — arrives on `ChangeSummary.portfolio` from the server.

/** A live session is one still in flight (design D3) — the only signal that means "running now", unlike persisted run files. */
export const LIVE_SESSION_STATES: readonly SessionRecordWire['state'][] = ['starting', 'running', 'exiting'];

export interface Task {
  /** The portfolio container name, or the bare change's own name. */
  id: string;
  /** Same as `id` for this child (child 4 may enrich a portfolio label from its parent dir). */
  label: string;
  kind: 'portfolio' | 'single';
  /** The Task's constituent changes: ≥1; a single Task has exactly one. */
  children: ChangeSummary[];
  /** Derived lifecycle column (design D2), never a persisted status. */
  column: BoardColumn;
  /** OR of each child's run escalation — rendered as a badge, never a fifth column. */
  escalated: boolean;
  /** Portfolio: done vs on-board children ("N/M changes"). Single: the change's own task checkboxes ("N/M tasks"). */
  progress: { done: number; total: number };
  /** The current stage of a live session targeting a child (design D3); absent when nothing is running for the Task. */
  liveStage?: string;
}

/**
 * Aggregates a Task's column from its children (design D2), running the
 * existing per-change {@link deriveColumn} and combining by precedence:
 * any child In Progress → In Progress; else any Ready → Ready; else any
 * Planning → Planning; else (every child Done) → Done. `escalated` is the OR
 * of each child's escalation. A single-item Task degenerates to its one
 * change's column. Pure — no DOM, no fetch — exactly like `deriveColumn`.
 */
export function deriveTaskColumn(
  children: ChangeSummary[],
  runsByName: Map<string, ChangeRunEntry>
): DerivedColumn {
  let hasInProgress = false;
  let hasReady = false;
  let hasPlanning = false;
  let escalated = false;
  for (const child of children) {
    const derived = deriveColumn(child, runsByName.get(child.name));
    escalated = escalated || derived.escalated;
    if (derived.column === 'in-progress') hasInProgress = true;
    else if (derived.column === 'ready') hasReady = true;
    else if (derived.column === 'planning') hasPlanning = true;
  }
  const column: BoardColumn = hasInProgress
    ? 'in-progress'
    : hasReady
      ? 'ready'
      : hasPlanning
        ? 'planning'
        : 'done';
  return { column, escalated };
}

/** The current stage of a live session (design D3): its pipeline and in-progress stage from the joined run-state, or the raw task text when no run-state is available. */
export function sessionStage(entry: SessionListEntry): string {
  const { runState } = entry;
  if (runState.kind === 'ok' && runState.autoRun.kind === 'ok') {
    const { pipeline, stages } = runState.autoRun.state;
    const active = stages
      ? Object.entries(stages).find(([, s]) => s.status === 'in_progress')?.[0]
      : undefined;
    return active ? `${pipeline} · ${active}` : pipeline;
  }
  return entry.session.task;
}

/**
 * Groups a space's active changes into Tasks (design D1), preserving each
 * Task's first-appearance order. Changes sharing a `portfolio` value collapse
 * into one portfolio Task (id/label = the container name); a change with no
 * `portfolio` becomes an implicit single-item Task (id/label = its name).
 * Each Task's column comes from {@link deriveTaskColumn}, its progress from
 * child-change completion (portfolio) or task-checkbox counts (single), and
 * its `liveStage`/`⦿` from a live session targeting one of its children.
 */
export function groupIntoTasks(
  changes: ChangeSummary[],
  runsByName: Map<string, ChangeRunEntry>,
  sessions: SessionListEntry[]
): Task[] {
  const order: string[] = [];
  const childrenById = new Map<string, ChangeSummary[]>();
  for (const change of changes) {
    const id = change.portfolio ?? change.name;
    let group = childrenById.get(id);
    if (!group) {
      group = [];
      childrenById.set(id, group);
      order.push(id);
    }
    group.push(change);
  }

  // change name → owning Task id, for session-provenance mapping.
  const taskIdByChange = new Map<string, string>();
  for (const [id, children] of childrenById) {
    for (const child of children) taskIdByChange.set(child.name, id);
  }

  // First live session targeting each Task sets its stage (design D3).
  const liveStageByTask = new Map<string, string>();
  for (const entry of sessions) {
    if (!LIVE_SESSION_STATES.includes(entry.session.state)) continue;
    const changeName = entry.session.changeName;
    if (!changeName) continue; // a changeName-less auto session maps to no Task
    const taskId = taskIdByChange.get(changeName);
    if (taskId && !liveStageByTask.has(taskId)) liveStageByTask.set(taskId, sessionStage(entry));
  }

  return order.map((id) => {
    const children = childrenById.get(id)!;
    const kind: Task['kind'] = children[0]!.portfolio ? 'portfolio' : 'single';
    const { column, escalated } = deriveTaskColumn(children, runsByName);
    const progress =
      kind === 'portfolio'
        ? {
            done: children.filter(
              (c) => deriveColumn(c, runsByName.get(c.name)).column === 'done'
            ).length,
            total: children.length,
          }
        : { done: children[0]!.taskProgress.completed, total: children[0]!.taskProgress.total };
    const liveStage = liveStageByTask.get(id);
    return {
      id,
      label: id,
      kind,
      children,
      column,
      escalated,
      progress,
      ...(liveStage !== undefined ? { liveStage } : {}),
    };
  });
}

/**
 * Splits a space's sessions into those belonging to a Task — whose linked
 * `changeName` is one of the Task's children — partitioned into `live` and
 * `ended`, with live ordered first (ui-space-redesign-task-detail design D4).
 * A session without a `changeName`, or one linked to a change outside this
 * Task, is excluded. Pure — the session→Task mapping stays in this tested
 * module rather than being reinvented in the detail component.
 */
export function sessionsForTask(
  sessions: SessionListEntry[],
  childNames: Set<string>
): { live: SessionListEntry[]; ended: SessionListEntry[] } {
  const live: SessionListEntry[] = [];
  const ended: SessionListEntry[] = [];
  for (const entry of sessions) {
    const changeName = entry.session.changeName;
    if (changeName === undefined || !childNames.has(changeName)) continue;
    if (LIVE_SESSION_STATES.includes(entry.session.state)) live.push(entry);
    else ended.push(entry);
  }
  return { live, ended };
}

/**
 * Whether a session `cwd` lies within a member `root` (design D4/D7). Both are
 * server-emitted canonical paths, so this is a plain path-prefix test guarded
 * at a segment boundary (so `/repo` never matches `/repo-two`), tolerant of
 * either separator since the OS that emitted them is not known here. This is a
 * path comparison, not a space-token transform — it does not touch the opaque
 * id rule.
 */
export function isUnderRoot(cwd: string, root: string): boolean {
  if (cwd === root) return true;
  const base = root.endsWith('/') || root.endsWith('\\') ? root.slice(0, -1) : root;
  return cwd.startsWith(`${base}/`) || cwd.startsWith(`${base}\\`);
}

/**
 * Narrows a Task list to those attributed to a member by session provenance
 * (design D4): a Task is kept when it has a session — live or listed —
 * targeting one of its children whose `cwd` is under `memberRoot`. `null`
 * (the "All" chip) returns every Task unchanged. A Task no session has ever
 * run for is attributed to no member and so appears only under "All" — the
 * documented ceiling, since the disk records no change→member link.
 */
export function tasksForMember(
  tasks: Task[],
  sessions: SessionListEntry[],
  memberRoot: string | null
): Task[] {
  if (memberRoot === null) return tasks;
  return tasks.filter((task) => {
    const childNames = new Set(task.children.map((c) => c.name));
    return sessions.some(
      (e) =>
        e.session.changeName !== undefined &&
        childNames.has(e.session.changeName) &&
        isUnderRoot(e.session.cwd, memberRoot)
    );
  });
}
