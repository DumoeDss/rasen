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
import { AgentRuntimeSandboxSchema, AgentRuntimeSchema } from './types.js';

export const RUN_STATE_FILENAME = 'auto-run.json';

export const StageStatusSchema = z.enum([
  'pending',
  'in_progress',
  'done',
  'skipped',
  'escalated',
]);
export type StageStatus = z.infer<typeof StageStatusSchema>;

/**
 * The worker that handled a stage. Two forms are accepted:
 *  - a bare string — a human label / role (observability only); and
 *  - the structured form — `role`, the spawn handle `agentId`, and the durable
 *    `transcript` pointer to the worker's persisted conversation (e.g.
 *    `agent-<agentId>.jsonl` under the project's Claude transcript directory).
 *
 * IMPORTANT: `agentId` is a LIVE handle — a valid `SendMessage` target ONLY
 * within the session that spawned the worker; it is a dead handle after a
 * restart. `transcript` is the cross-session asset: on resume the LEAD reads it
 * back to WARM-SEED a fresh same-role worker (a new agentId primed with the
 * prior worker's full context). Recording `agentId` still helps across a
 * restart because it locates that transcript file. Resume itself only needs
 * `status`; `worker` exists for warm-seed + isolation auditing.
 */
export const RunStateWorkerSchema = z.object({
  runtime: AgentRuntimeSchema.optional(),
  role: z.string().optional(),
  agentId: z.string().optional(),
  transcript: z.string().optional(),
  threadId: z.string().optional(),
  turnId: z.string().optional(),
  jobId: z.string().optional(),
  threadName: z.string().optional(),
  sandbox: AgentRuntimeSandboxSchema.optional(),
  model: z.string().optional(),
  effort: z.string().optional(),
  resumeMode: z.string().optional(),
  previousThreadId: z.string().optional(),
  updatedAt: z.string().optional(),
}).passthrough();
export type RunStateWorker = z.infer<typeof RunStateWorkerSchema>;

/**
 * A single mid-stage handoff: an exhausted worker distilled its state to a
 * handoff document and returned, and the LEAD recorded the pointer here. `path`
 * is the only required field (the distillate location); everything else is
 * observability the LEAD fills in when known. Lenient by design so partial
 * records from older runs still parse.
 */
export const StageHandoffRecordSchema = z.object({
  n: z.number().int().positive().optional(),
  path: z.string(),
  reason: z.string().optional(),
  completed: z.array(z.string()).optional(),
  remaining: z.array(z.string()).optional(),
  at: z.string().optional(),
}).passthrough();
export type StageHandoffRecord = z.infer<typeof StageHandoffRecordSchema>;

export const RunStateStageSchema = z.object({
  status: StageStatusSchema,
  worker: z.union([z.string(), RunStateWorkerSchema]).optional(),
  note: z.string().optional(),
  handoffs: z.array(StageHandoffRecordSchema).optional(),
}).passthrough();
export type RunStateStage = z.infer<typeof RunStateStageSchema>;

/**
 * Session-level handoff pointer: written when a whole session (the LEAD)
 * distills its state via `/opsx:handoff` so a fresh session reads the
 * distillate before warm-seeding from raw transcripts. `n` is the relay
 * generation (1st handoff = 1); records without it are generation 1.
 */
export const SessionHandoffSchema = z.object({
  path: z.string(),
  n: z.number().int().positive().optional(),
  pct: z.number().optional(),
  afterStage: z.string().optional(),
  at: z.string().optional(),
}).passthrough();
export type SessionHandoff = z.infer<typeof SessionHandoffSchema>;

/** Relay generation of a session handoff record; absent `n` means generation 1. */
export function sessionHandoffGeneration(handoff: SessionHandoff): number {
  return handoff.n ?? 1;
}

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
    sessionHandoff: SessionHandoffSchema.optional(),
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

/**
 * Normalize a stage's `worker` (bare string or structured) to the structured
 * shape. A bare string is treated as the worker's `role`. Returns undefined
 * when no worker was recorded.
 */
export function normalizeWorker(
  worker: RunStateStage['worker']
): RunStateWorker | undefined {
  if (worker === undefined) return undefined;
  if (typeof worker === 'string') return { role: worker };
  return worker;
}

/**
 * Per-stage worker pointers that carry something reusable across a session
 * boundary — an `agentId` (locates the transcript) or an explicit `transcript`
 * path. These are what a resume warm-seeds a fresh worker from; stages with no
 * such pointer are omitted. Bare-string (role-only) workers are omitted because
 * they hold nothing to seed from.
 */
export function stageWorkers(state: RunState): Record<string, RunStateWorker> {
  const out: Record<string, RunStateWorker> = {};
  if (!state.stages) return out;
  for (const [id, stage] of Object.entries(state.stages)) {
    const w = normalizeWorker(stage.worker);
    if (w && (w.agentId || w.transcript || w.threadId)) out[id] = w;
  }
  return out;
}

/**
 * Latest handoff document path per stage, for resume. A stage contributes an
 * entry only when it has a non-empty `handoffs[]`; the "latest" record is the
 * one with the highest `n` (falling back to the last array element when `n` is
 * absent). Stages without handoffs are omitted.
 */
export function latestStageHandoffs(state: RunState): Record<string, string> {
  const out: Record<string, string> = {};
  if (!state.stages) return out;
  for (const [id, stage] of Object.entries(state.stages)) {
    const handoffs = stage.handoffs;
    if (!handoffs || handoffs.length === 0) continue;
    let latest = handoffs[0];
    for (const h of handoffs.slice(1)) {
      const latestN = latest.n ?? -Infinity;
      const hN = h.n ?? -Infinity;
      // Highest n wins; when n is absent on both, later array position wins.
      if (hN >= latestN) latest = h;
    }
    out[id] = latest.path;
  }
  return out;
}

/**
 * Stage ids currently in a given status, sorted. Empty when `stages` is absent
 * (the `completed[]` convenience array carries no per-stage status). Used by
 * resume to surface `escalated` (needs human) and `in_progress` (interrupted,
 * re-engage) stages so neither is silently dropped.
 */
export function stagesWithStatus(state: RunState, status: StageStatus): string[] {
  if (!state.stages) return [];
  return Object.entries(state.stages)
    .filter(([, s]) => s.status === status)
    .map(([id]) => id)
    .sort();
}
