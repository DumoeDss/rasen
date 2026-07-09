/**
 * Run-state for an orchestrated pipeline run.
 *
 * The LEAD (the `auto` workflow) records progress for a change in
 * `openspec/changes/<name>/auto-run.json` while it drives a pipeline. This
 * module is the canonical typed contract for that file: the schema the LEAD
 * writes to, the reader `rasen pipeline resume` consumes, and a helper to
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
  // Lineage: the id of a prior child change whose context this worker's
  // transcript already carries (i.e. the worker was reused warm across
  // children). Descriptive only — not a stage-worker inclusion key.
  reusedFrom: z.string().optional(),
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
  // autopilot-gate-policy: recorded ONLY when this stage's gate was
  // auto-approved rather than confirmed by a human, e.g.
  // "auto-approved (--no-gate)" or "auto-approved (autopilot.gates: off)".
  // A human-confirmed gate leaves this unset — the presence of the field is
  // itself the audit signal, distinguishing an auto-approval from a Continue.
  gateDecision: z.string().optional(),
}).passthrough();
export type RunStateStage = z.infer<typeof RunStateStageSchema>;

/**
 * Session-level handoff pointer: written when a whole session (the LEAD)
 * distills its state via `/rasen:handoff` so a fresh session reads the
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
    // autopilot-gate-policy: the resolved gate policy for this run, recorded
    // once at run start (precedence flag > autopilot.gates config > default
    // on — see resolveAutopilotGatePolicy in project-config.ts) so `pipeline
    // resume` can read it back without the user re-passing `--no-gate`.
    // Absent on runs from before this capability existed (defaults to on).
    gatePolicy: z
      .object({
        effective: z.enum(['on', 'off']),
        source: z.enum(['flag', 'config', 'default']),
      })
      .optional(),
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
    // Goal-loop: the injected effective loop config (runtime authoritative).
    // The LEAD reads goal-plan.md and merges the concrete gate config here
    // before round 1. Optional — only present for a goal-loop run.
    loopConfig: z
      .object({
        kind: z.literal('goal'),
        gate: z.discriminatedUnion('kind', [
          z.object({
            kind: z.literal('measure'),
            command: z.string(),
            threshold: z.number().optional(),
            target: z.number().optional(),
            direction: z.enum(['gte', 'lte']),
            // Per-task measure timeout, injected from goal-plan.md. Mirrors the
            // registry schema so a configured value survives the strict nested
            // object (which would otherwise strip it); defaults to 120s.
            timeoutSec: z.number().int().positive().default(120),
          }),
          z.object({
            kind: z.literal('evaluate'),
            goal: z.string(),
            rubric: z.string().optional(),
          }),
        ]),
        maxRounds: z.number().int().positive(),
        loopStallLimit: z.number().int().positive(),
        workProduct: z.enum(['code', 'prose']),
      })
      .optional(),
    // Goal-loop: best-effort derived cache. The AUTHORITATIVE per-round record
    // is goal-run.json (historyRef); this is a convenience for the resume fast path.
    loopProgress: z
      .object({
        kind: z.literal('goal'),
        round: z.number().int().nonnegative(),
        lastScore: z.number().optional(),
        measurePassed: z.boolean().optional(), // present when gate=measure
        evaluateSatisfied: z.boolean().optional(), // present when gate=evaluate
        stallStreak: z.number().int().nonnegative(),
        historyRef: z.string(), // -> goal-run.json
      })
      .optional(),
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

/** The directory (and full file path) a run-state candidate resolved from. */
export interface RunStateLocation {
  dir: string;
  path: string;
}

/**
 * Resolves WHERE `auto-run.json` lives for a change (design D4, sticky-legacy):
 * `workDir` first when provided and it holds the file, else `changeDir`
 * (legacy). Returns null when neither location has one. This only locates the
 * file; callers read it via `readRunState(location.dir)` to get the validated
 * `RunState`, keeping `readRunState`'s existing signature and behavior intact.
 */
export function resolveRunStateLocation(
  changeDir: string,
  workDir?: string | null
): RunStateLocation | null {
  if (workDir) {
    const workPath = runStatePath(workDir);
    if (fs.existsSync(workPath)) {
      return { dir: workDir, path: workPath };
    }
  }

  const legacyPath = runStatePath(changeDir);
  if (fs.existsSync(legacyPath)) {
    return { dir: changeDir, path: legacyPath };
  }

  return null;
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
