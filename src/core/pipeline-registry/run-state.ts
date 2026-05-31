/**
 * Run-state for an orchestrated pipeline run.
 *
 * The LEAD (the `auto` workflow) records progress for a change in
 * `openspec/changes/<name>/auto-run.json` while it drives a pipeline. This
 * module is the canonical typed contract for that file: the schema the LEAD
 * writes to, the reader `openspec pipeline resume` consumes, and a helper to
 * derive completed stages. State is durable on disk so a run survives a dead
 * worker, a new session, or a Tier B/C cold re-spawn.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';

export const RUN_STATE_FILENAME = 'auto-run.json';

export const StageStatusSchema = z.enum([
  'pending',
  'in_progress',
  'done',
  'skipped',
  'escalated',
]);
export type StageStatus = z.infer<typeof StageStatusSchema>;

export const RunStateStageSchema = z.object({
  status: StageStatusSchema,
  worker: z.string().optional(),
  note: z.string().optional(),
});
export type RunStateStage = z.infer<typeof RunStateStageSchema>;

/**
 * Canonical run-state shape. `passthrough()` lets the LEAD record extra context
 * without breaking the typed reader. `stages` (per-stage status) is the
 * authoritative progress record; `completed` is a simpler convenience the
 * reader also accepts (and falls back to when `stages` is absent).
 */
export const RunStateSchema = z
  .object({
    pipeline: z.string(),
    classification: z.string().optional(),
    tier: z.enum(['A', 'B', 'C']).optional(),
    stages: z.record(z.string(), RunStateStageSchema).optional(),
    completed: z.array(z.string()).optional(),
    rounds: z.number().int().nonnegative().optional(),
    openFindings: z
      .array(
        z
          .object({
            severity: z.enum(['blocker', 'major', 'minor', 'trivial']).optional(),
            summary: z.string().optional(),
            stage: z.string().optional(),
          })
          .passthrough()
      )
      .optional(),
    updatedAt: z.string().optional(),
  })
  .passthrough();
export type RunState = z.infer<typeof RunStateSchema>;

export class RunStateValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RunStateValidationError';
  }
}

export function runStatePath(changeDir: string): string {
  return path.join(changeDir, RUN_STATE_FILENAME);
}

/** Parse + validate run-state JSON. Throws on malformed JSON or schema mismatch. */
export function parseRunState(content: string): RunState {
  const json = JSON.parse(content) as unknown;
  const result = RunStateSchema.safeParse(json);
  if (!result.success) {
    throw new RunStateValidationError(
      `Invalid run-state: ${result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`
    );
  }
  return result.data;
}

/**
 * Read run-state for a change directory. Returns null when the file is absent,
 * malformed, or fails validation — i.e. "no usable run-state" — so callers like
 * `resume` degrade gracefully rather than crashing.
 */
export function readRunState(changeDir: string): RunState | null {
  const p = runStatePath(changeDir);
  if (!fs.existsSync(p)) return null;
  try {
    return parseRunState(fs.readFileSync(p, 'utf-8'));
  } catch {
    return null;
  }
}

/** Validate, then write run-state to the change directory (pretty JSON). */
export function writeRunState(changeDir: string, state: RunState): void {
  const validated = RunStateSchema.parse(state);
  fs.mkdirSync(changeDir, { recursive: true });
  fs.writeFileSync(runStatePath(changeDir), `${JSON.stringify(validated, null, 2)}\n`, 'utf-8');
}

/**
 * Stages that count as completed for resume purposes: when `stages` is present,
 * those with status done|skipped; otherwise the `completed` convenience array.
 */
export function completedStages(state: RunState): string[] {
  if (state.stages) {
    return Object.entries(state.stages)
      .filter(([, s]) => s.status === 'done' || s.status === 'skipped')
      .map(([id]) => id);
  }
  return state.completed ?? [];
}
