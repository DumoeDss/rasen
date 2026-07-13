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
 *
 * A spawn `name` (the label passed to the Agent/Task tool when the worker was
 * dispatched) is NOT a durable handle — it is not even a field on this schema —
 * and MUST NOT be recorded in place of `agentId`/`transcript`. A completed
 * worker is not reliably name-addressable even within the session that spawned
 * it, so a name-only record carries nothing a resume can warm-seed from and is
 * silently omitted by `stageWorkers`. Capture `agentId` + `transcript` from the
 * spawn RESULT; `name` is a non-durable dispatch label, never a resume handle.
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

/**
 * Non-fatal duplicate-key detector over RAW run-state JSON text. `JSON.parse`
 * (and Zod on its output) silently collapses a repeated key to its last value,
 * so a hand-edited `auto-run.json` that carries e.g. two `rounds` keys is
 * otherwise invisible. This scans the raw text WITHOUT parsing: it tracks
 * object scope while ignoring every token inside a string literal, and reports
 * each key that repeats at the SAME object level as `{ path, key }`, where
 * `path` is a dotted JSONPath-style pointer to the enclosing object (`$` is the
 * root). A key that appears at two different nesting levels is NOT a duplicate.
 *
 * Advisory only — it never throws, never changes which value parses, and leaves
 * archived run-state readable. Returns `[]` for clean input.
 */
export function detectDuplicateKeys(content: string): { path: string; key: string }[] {
  const duplicates: { path: string; key: string }[] = [];
  const len = content.length;
  let i = 0;

  type Frame = { kind: 'object' | 'array'; seen: Set<string>; path: string; index: number };
  const stack: Frame[] = [];
  let pendingKey = '';
  const top = (): Frame | undefined => stack[stack.length - 1];

  // Returns the index of the closing quote for the string starting at `start`
  // (which points at the opening quote), skipping over `\<char>` escapes so an
  // escaped quote does not end the literal early.
  const readString = (start: number): number => {
    let j = start + 1;
    while (j < len) {
      const ch = content[j];
      if (ch === '\\') {
        j += 2;
        continue;
      }
      if (ch === '"') return j;
      j++;
    }
    return j;
  };

  const skipWs = (from: number): number => {
    let j = from;
    while (j < len && /\s/.test(content[j])) j++;
    return j;
  };

  while (i < len) {
    const ch = content[i];

    if (ch === '"') {
      const close = readString(i);
      const value = content.slice(i + 1, close);
      i = close + 1;
      // A string is a KEY only when the next non-whitespace char is ':'.
      const colonAt = skipWs(i);
      if (content[colonAt] === ':') {
        const frame = top();
        if (frame && frame.kind === 'object') {
          if (frame.seen.has(value)) {
            duplicates.push({ path: frame.path, key: value });
          } else {
            frame.seen.add(value);
          }
        }
        pendingKey = value;
        i = colonAt + 1; // consume the ':'
      }
      continue;
    }

    if (ch === '{' || ch === '[') {
      const parent = top();
      const path = !parent
        ? '$'
        : parent.kind === 'object'
          ? `${parent.path}.${pendingKey}`
          : `${parent.path}[${parent.index}]`;
      stack.push({ kind: ch === '{' ? 'object' : 'array', seen: new Set(), path, index: 0 });
      pendingKey = '';
      i++;
      continue;
    }

    if (ch === '}' || ch === ']') {
      stack.pop();
      i++;
      continue;
    }

    if (ch === ',') {
      const frame = top();
      if (frame && frame.kind === 'array') frame.index++;
      i++;
      continue;
    }

    i++;
  }

  return duplicates;
}

/**
 * Per-stage worker-handle validation (advisory). For each stage whose recorded
 * `worker` lacks EVERY durable handle (`agentId`, `transcript`, `threadId`),
 * returns the stage id plus the non-durable keys the record carries — so a
 * name-only or role-only worker is SURFACED rather than silently dropped from
 * the warm-seed set by `stageWorkers`. A bare-string worker carries no object
 * keys (it is just a role label → `keys: []`); a structured record lists its
 * keys minus the always-expected `role` label, so the warning surfaces drift
 * keys (e.g. a fabricated `name`) rather than noise. Reuses `normalizeWorker`
 * and does NOT mutate `stageWorkers`/its behavior. Stages with no worker, or a
 * worker carrying a durable handle, are omitted.
 */
export function stagesLackingDurableHandle(
  state: RunState
): { stage: string; keys: string[] }[] {
  const out: { stage: string; keys: string[] }[] = [];
  if (!state.stages) return out;
  for (const [id, stage] of Object.entries(state.stages)) {
    const { worker } = stage;
    if (worker === undefined) continue; // no worker record → nothing to warn on
    const normalized = normalizeWorker(worker);
    if (normalized === undefined) continue;
    // A durable handle present → warm-seedable; no warning.
    if (normalized.agentId || normalized.transcript || normalized.threadId) continue;
    const keys =
      typeof worker === 'string' ? [] : Object.keys(worker).filter((k) => k !== 'role');
    out.push({ stage: id, keys });
  }
  return out;
}
