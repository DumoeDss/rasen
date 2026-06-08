/**
 * Portfolio run-state for a decomposed (fan-out) pipeline run.
 *
 * When the LEAD takes a `decompose` stage it splits one task into several child
 * changes and drives each through its own pipeline. This module is the typed
 * contract for the parent-level record that makes that multi-change run
 * observable and resumable: `openspec/changes/<parent>/portfolio-run.json`.
 *
 * The portfolio record is AUTHORITATIVE for resume; each child still keeps its
 * own per-change `auto-run.json` (see run-state.ts), and child-directory /
 * artifact presence is only a cross-check. The dependency DAG lives here (as
 * each child's `dependsOn`), not in per-change metadata — so this change does
 * not depend on the proposed `add-change-stacking-awareness` work.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';
import { StageStatusSchema, RunStateWorkerSchema } from './run-state.js';

export const PORTFOLIO_STATE_FILENAME = 'portfolio-run.json';

/** How a child is being executed relative to its siblings. */
export const ChildExecutionModeSchema = z.enum(['serial', 'parallel']);
export type ChildExecutionMode = z.infer<typeof ChildExecutionModeSchema>;

/**
 * One child change in the portfolio. `dependsOn` (other child ids) encodes the
 * dependency DAG. `pipeline` is the pipeline this child actually runs — the
 * decompose stage's `childPipeline` by default, but overridable per child (so a
 * child can be `bug-fix` while a sibling is `full-feature`); it MUST be
 * decompose-free. `status` reuses the per-stage status vocabulary.
 */
export const PortfolioChildSchema = z.object({
  id: z.string().min(1),
  pipeline: z.string().min(1),
  dependsOn: z.array(z.string()).default([]),
  status: StageStatusSchema.default('pending'),
  mode: ChildExecutionModeSchema.optional(),
  cohort: z.string().optional(),
  note: z.string().optional(),
});
export type PortfolioChild = z.infer<typeof PortfolioChildSchema>;

/**
 * Canonical portfolio run-state shape. `passthrough()` lets the LEAD record
 * extra context (e.g. the human-readable plan summary) without breaking the
 * typed reader. `childPipeline` is the stage default each child inherits unless
 * it overrides it.
 */
export const PortfolioStateSchema = z
  .object({
    parent: z.string().min(1),
    childPipeline: z.string().optional(),
    tier: z.enum(['A', 'B', 'C']).optional(),
    /**
     * Run-level persistent planner pointer (playbook Step B.1): ONE planner is
     * reused across every child's propose, so its identity lives here at the
     * portfolio level, not on any single child. Same shapes as a per-stage
     * worker record (bare string label, or {role, agentId, transcript}); the
     * agentId/transcript is what a post-restart resume warm-seeds from.
     */
    planner: z.union([z.string(), RunStateWorkerSchema]).optional(),
    children: z.array(PortfolioChildSchema).default([]),
    updatedAt: z.string().optional(),
  })
  .passthrough();
export type PortfolioState = z.infer<typeof PortfolioStateSchema>;

export class PortfolioStateValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PortfolioStateValidationError';
  }
}

export function portfolioStatePath(changeDir: string): string {
  return path.join(changeDir, PORTFOLIO_STATE_FILENAME);
}

/** Parse + validate portfolio-state JSON. Throws on malformed JSON / schema mismatch. */
export function parsePortfolioState(content: string): PortfolioState {
  const json = JSON.parse(content) as unknown;
  const result = PortfolioStateSchema.safeParse(json);
  if (!result.success) {
    throw new PortfolioStateValidationError(
      `Invalid portfolio run-state: ${result.error.issues
        .map(i => `${i.path.join('.')}: ${i.message}`)
        .join('; ')}`
    );
  }
  return result.data;
}

/**
 * Read portfolio run-state for a parent change directory. Returns null when the
 * file is absent, malformed, or fails validation — so callers (resume / auto)
 * degrade gracefully and fall back to the single-change path.
 */
export function readPortfolioState(changeDir: string): PortfolioState | null {
  const p = portfolioStatePath(changeDir);
  if (!fs.existsSync(p)) return null;
  try {
    return parsePortfolioState(fs.readFileSync(p, 'utf-8'));
  } catch {
    return null;
  }
}

/** Validate, then write portfolio run-state to the parent change directory. */
export function writePortfolioState(changeDir: string, state: PortfolioState): void {
  const validated = PortfolioStateSchema.parse(state);
  fs.mkdirSync(changeDir, { recursive: true });
  fs.writeFileSync(
    portfolioStatePath(changeDir),
    `${JSON.stringify(validated, null, 2)}\n`,
    'utf-8'
  );
}

/** A child counts as satisfied (for unblocking dependents) when done or skipped. */
function isSatisfied(status: PortfolioChild['status']): boolean {
  return status === 'done' || status === 'skipped';
}

/**
 * The runnable frontier: ids of children that are still `pending` and whose
 * every prerequisite is satisfied (done | skipped). A failed/escalated or
 * in-progress prerequisite is NOT satisfied, so its dependents stay blocked —
 * this is exactly the "partial failure stops the affected chain" behavior.
 * Sorted for deterministic ordering.
 */
export function runnableChildren(state: PortfolioState): string[] {
  const byId = new Map(state.children.map(c => [c.id, c]));
  const satisfied = (id: string): boolean => {
    const c = byId.get(id);
    return c ? isSatisfied(c.status) : false;
  };
  return state.children
    .filter(c => c.status === 'pending')
    .filter(c => c.dependsOn.every(satisfied))
    .map(c => c.id)
    .sort();
}

/**
 * Children that were mid-flight when the run stopped (status `in_progress`).
 * On resume these must be RE-ENGAGED — warm-seeded from their recorded
 * transcript (or cold-reconstructed) and driven to completion — NOT left
 * stranded. Their prerequisites are necessarily already satisfied (they had
 * started), so this is the interrupted half of the runnable frontier. Kept
 * separate from `runnableChildren` so a resumer can tell "start fresh" from
 * "resume an interrupted one". Sorted for deterministic ordering.
 */
export function interruptedChildren(state: PortfolioState): string[] {
  return state.children
    .filter(c => c.status === 'in_progress')
    .map(c => c.id)
    .sort();
}

/**
 * Children that failed/escalated (status `escalated`) and need human attention;
 * their dependent chains stay blocked until they are resolved. Surfaced so a
 * resume never silently drops them. Sorted.
 */
export function escalatedChildren(state: PortfolioState): string[] {
  return state.children
    .filter(c => c.status === 'escalated')
    .map(c => c.id)
    .sort();
}

/** True when every child has reached a terminal state (done | skipped). */
export function isPortfolioComplete(state: PortfolioState): boolean {
  return state.children.every(c => isSatisfied(c.status));
}
