/**
 * Pure lifecycle-column derivation for the board (design.md D8 of
 * `rasen-ui-slice1-readonly-api`). Kept separate from rendering so it is
 * testable without a DOM (same precedent as `config/grouping.ts`). Column
 * assignment is UI policy, not a wire field (design D4) — the API reports
 * facts (`applyReady`, `taskProgress`, run state); this derives the board's
 * four lifecycle columns from those facts.
 */
import type { ChangeRunEntry, ChangeSummary } from '../api/types.js';

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
 */
export function deriveColumn(change: ChangeSummary, run?: ChangeRunEntry): DerivedColumn {
  const escalated = isEscalated(run);

  if (!change.applyReady) {
    return { column: 'planning', escalated };
  }

  const { total, completed } = change.taskProgress;
  if (total > 0 && completed === total) {
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
