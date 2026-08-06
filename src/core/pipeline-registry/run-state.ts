/**
 * Run-state for an orchestrated pipeline run.
 *
 * The LEAD (the `auto` workflow) records progress for a change in
 * `auto-run.json` while it drives a pipeline — resolved through the
 * `file-placement` sticky-legacy chain (`stateFileSearchChain`): the execution
 * root's ephemera directory first, then the legacy machine-home work
 * directory, then the change directory. This
 * module is the canonical typed contract for that file: the schema the LEAD
 * writes to, the reader `rasen pipeline resume` consumes, and a helper to
 * derive completed stages. State is durable on disk so a run survives a dead
 * worker, a new session, or a Tier B/C cold re-spawn.
 */
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';
import { AgentRuntimeSandboxSchema, AgentRuntimeSchema } from './types.js';
import { RETENTION_MODES, type RetentionMode } from '../retention.js';
import { hasRuntimeCapability } from '../runtime-adapters.js';
import {
  FrozenKnowledgeContextSchema,
  type FrozenExecutionRef,
  type FrozenKnowledgeContext,
} from '../learned-skills/index.js';

/** Canonical retention stage id and the retired full-feature retro stage id. */
export const RETAIN_STAGE_ID = 'retain';
const LEGACY_RETRO_STAGE_ID = 'retro';
const ARCHIVE_STAGE_ID = 'archive';
const LEGACY_GOAL_PIPELINE_NAMES = new Set([
  'goal-loop-measure',
  'goal-loop-evaluate',
]);
const LEGACY_GOAL_COMPLETED_REASON = 'legacy-completed';

export const RUN_STATE_FILENAME = 'auto-run.json';

export const StageStatusSchema = z.enum([
  'pending',
  'in_progress',
  'done',
  'skipped',
  'escalated',
  'delegated',
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
  dispatchMode: z.enum(['native', 'exec-bridge', 'legacy-fallback']).optional(),
  role: z.string().optional(),
  agentId: z.string().optional(),
  transcript: z.string().optional(),
  sessionId: z.string().optional(),
  cwd: z.string().optional(),
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
export type RunStateDispatchMode = NonNullable<RunStateWorker['dispatchMode']>;

export interface WorkerDispatchInference {
  dispatchMode?: RunStateDispatchMode;
  inferred: boolean;
  warning?: string;
}

/**
 * Resolve lifecycle mechanics for archived worker records without inventing a
 * handle. A Codex thread is the verified exec-bridge shape; agent handles are
 * native. Transcript-only Codex records remain ambiguous and fall back to
 * artifact/transcript reconstruction with a warning.
 */
export function inferWorkerDispatchMode(
  worker: RunStateWorker
): WorkerDispatchInference {
  if (worker.dispatchMode) {
    return { dispatchMode: worker.dispatchMode, inferred: false };
  }
  if (worker.runtime === 'codex' && worker.threadId) {
    return { dispatchMode: 'exec-bridge', inferred: true };
  }
  if (worker.runtime === 'claude' && worker.sessionId) {
    return { dispatchMode: 'exec-bridge', inferred: true };
  }
  if (worker.agentId) {
    return { dispatchMode: 'native', inferred: true };
  }
  if (worker.runtime === 'claude' && worker.transcript) {
    return { dispatchMode: 'native', inferred: true };
  }
  return {
    inferred: true,
    warning:
      'Worker dispatch mode is ambiguous; use the recorded transcript/artifacts for conservative reconstruction.',
  };
}

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
 * distills its state via `/rasen-handoff` so a fresh session reads the
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
 *
 * `pipeline` is OPTIONAL (design D1): a completed change that never ran through
 * a classified pipeline can still hold frozen retention identity, and naming a
 * pipeline it never ran would freeze a claim that is not true. This is a
 * relaxation — every file valid before it stays valid — and the only reader
 * that resolves a pipeline definition (`rasen pipeline resume`) skips that
 * resolution when the field is absent rather than inventing a name.
 */
export const RunStateSchema = z
  .object({
    pipeline: z.string().optional(),
    classification: z.string().optional(),
    tier: z.enum(['A', 'B', 'C']).optional(),
    // autopilot-gate-policy: the resolved gate policy for this run, recorded
    // once at run start (precedence flag > project autopilot.gates > store
    // autopilot.gates > global autopilot.gates > default on — see
    // resolveAutopilotGatePolicy in project-config.ts) so `pipeline resume`
    // can read it back without the user re-passing `--no-gate`. Absent on runs
    // from before this capability existed (defaults to on). `source: 'store'`
    // records a policy inherited from the project's store (store-config-scope).
    // `source: 'config'` is a legacy value from before the global layer
    // existed (pre-config-page-coherence runs) — still accepted here for
    // backward compatibility with recorded run-state.
    gatePolicy: z
      .object({
        effective: z.enum(['on', 'off']),
        source: z.enum(['flag', 'project', 'store', 'global', 'config', 'default']),
      })
      .optional(),
    stages: z.record(z.string(), RunStateStageSchema).optional(),
    // The retention mode frozen on first entry to the retain stage (design D2).
    // Once recorded, resume prefers it over a later profile edit so a mid-run
    // profile change never switches the retain branch.
    retention: z.enum(RETENTION_MODES).optional(),
    // Frozen independently from retention. It records typed portable identity
    // only; canonical roots are re-resolved and revalidated on resume.
    knowledgeContext: FrozenKnowledgeContextSchema.optional(),
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
        // Optional so run-state written before this field still parses; the
        // default (3) is applied by the registry schema at inject time.
        blockedThreshold: z.number().int().positive().optional(),
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
        // Consecutive rounds the same implementer-reported blocker has recurred
        // (resets on progress or a materially different blocker). Optional so it
        // survives worker relay without breaking pre-existing loopProgress caches.
        blockedStreak: z.number().int().nonnegative().optional(),
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

/**
 * Nullable-optional string fields on a worker record. A non-Claude LEAD may
 * legitimately write JSON `null` for one of these ("field known, value
 * unknown") where the schema means "field absent" — normalization treats the
 * two as equivalent at the read boundary (design D1).
 */
const WORKER_NULLABLE_STRING_KEYS = [
  'transcript',
  'agentId',
  'sessionId',
  'cwd',
  'threadId',
  'turnId',
  'jobId',
  'threadName',
  'model',
  'effort',
  'resumeMode',
  'previousThreadId',
  'reusedFrom',
  'updatedAt',
  'role',
] as const;

/**
 * Normalize a RAW (untyped, pre-validation) worker-shaped record so host
 * variance a non-Claude LEAD legitimately writes does not reject the file
 * (design D1): a JSON `null` on any nullable-optional string field is treated
 * as the field being absent (key removed); a `runtime` string outside
 * `claude|codex` is preserved under the passthrough key `runtimeRaw` and
 * `runtime` is removed (never coerced to a runtime the worker did not use).
 * Non-object input (e.g. a bare-string worker) passes through unchanged.
 * Shared by `parseRunState` (per-stage `worker`) and `parsePortfolioState`
 * (the `planner` record, which reuses the same shape). This is a READ-side
 * tolerance only — `writeRunState`/`writePortfolioState` keep validating
 * against the unwidened schema.
 */
export function normalizeRunStateWorkerRecord(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return raw;
  const obj: Record<string, unknown> = { ...(raw as Record<string, unknown>) };
  for (const key of WORKER_NULLABLE_STRING_KEYS) {
    if (obj[key] === null) delete obj[key];
  }
  // `runtime: null` is the same "field known, value unknown" statement as
  // null on any other nullable-optional field above — treat it as absent
  // (drop the key) rather than routing it into `runtimeRaw`, since there is
  // no raw value to preserve for observability. Only a non-enum STRING gets
  // the runtimeRaw passthrough treatment.
  if (obj.runtime === null) {
    delete obj.runtime;
  } else if (
    typeof obj.runtime === 'string' &&
    !hasRuntimeCapability(obj.runtime, 'canDispatch')
  ) {
    obj.runtimeRaw = obj.runtime;
    delete obj.runtime;
  }
  return obj;
}

/**
 * Migrates an in-flight legacy full-feature run whose tail was recorded against
 * the retired post-archive `retro` stage (design D2): the `retro` stage entry is
 * moved to `retain` (its status preserved — a completed legacy retro stays
 * completed rather than re-running, an incomplete one resumes as retain), and
 * the frozen retention mode is set to `report` (legacy retro was report
 * behavior) unless an explicit `retention` is already recorded. Completion is
 * NEVER inferred from configuration. No-op when there is no legacy `retro`
 * stage or a `retain` stage already exists.
 */
function migrateLegacyRetroStage(
  obj: Record<string, unknown>,
  stages: Record<string, unknown>
): void {
  if (!(LEGACY_RETRO_STAGE_ID in stages) || RETAIN_STAGE_ID in stages) return;
  stages[RETAIN_STAGE_ID] = stages[LEGACY_RETRO_STAGE_ID];
  delete stages[LEGACY_RETRO_STAGE_ID];
  if (obj.retention === undefined) obj.retention = 'report';
}

function stageIsComplete(stages: Record<string, unknown>, stageId: string): boolean {
  const stage = stages[stageId];
  if (typeof stage !== 'object' || stage === null || Array.isArray(stage)) return false;
  const status = (stage as Record<string, unknown>).status;
  return status === 'done' || status === 'skipped';
}

/**
 * Preserves completion for pre-retain goal runs that already archived. Runs
 * still awaiting archive need no mutation: with `ship` done, the upgraded DAG
 * naturally exposes `retain` as their next frontier. This migration is bounded
 * to the two changed built-in pipelines and exact stage identities; it never
 * infers completion from retention configuration or learned-skill state.
 */
function migrateLegacyCompletedGoalTail(
  obj: Record<string, unknown>,
  stages: Record<string, unknown>
): void {
  if (
    typeof obj.pipeline !== 'string' ||
    !LEGACY_GOAL_PIPELINE_NAMES.has(obj.pipeline) ||
    RETAIN_STAGE_ID in stages ||
    !stageIsComplete(stages, ARCHIVE_STAGE_ID)
  ) {
    return;
  }

  stages[RETAIN_STAGE_ID] = {
    status: 'skipped',
    reason: LEGACY_GOAL_COMPLETED_REASON,
  };
}

/**
 * Migrates the older top-level `completed[]` form without losing its existing
 * frontier. Once archive is complete, materialize equivalent stage records and
 * the synthetic skipped retain record so `completedStages()` continues to see
 * the whole run as complete and the legacy-completed reason remains auditable.
 */
function migrateLegacyCompletedGoalTailFromCompleted(
  obj: Record<string, unknown>
): void {
  if (
    typeof obj.pipeline !== 'string' ||
    !LEGACY_GOAL_PIPELINE_NAMES.has(obj.pipeline) ||
    !Array.isArray(obj.completed)
  ) {
    return;
  }

  const completed = obj.completed.filter((stageId): stageId is string => typeof stageId === 'string');
  if (!completed.includes(ARCHIVE_STAGE_ID) || completed.includes(RETAIN_STAGE_ID)) return;

  const stages: Record<string, unknown> = Object.fromEntries(
    completed.map((stageId) => [stageId, { status: 'done' }])
  );
  stages[RETAIN_STAGE_ID] = {
    status: 'skipped',
    reason: LEGACY_GOAL_COMPLETED_REASON,
  };
  obj.stages = stages;
}

/** Normalize the raw run-state JSON's per-stage `worker` records before validation. */
function normalizeRunStateJson(json: unknown): unknown {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return json;
  const obj: Record<string, unknown> = { ...(json as Record<string, unknown>) };
  if (typeof obj.stages === 'object' && obj.stages !== null && !Array.isArray(obj.stages)) {
    const stages: Record<string, unknown> = { ...(obj.stages as Record<string, unknown>) };
    for (const [id, stage] of Object.entries(stages)) {
      if (typeof stage !== 'object' || stage === null || Array.isArray(stage)) continue;
      const s: Record<string, unknown> = { ...(stage as Record<string, unknown>) };
      if (typeof s.worker === 'object' && s.worker !== null) {
        s.worker = normalizeRunStateWorkerRecord(s.worker);
      }
      stages[id] = s;
    }
    migrateLegacyRetroStage(obj, stages);
    migrateLegacyCompletedGoalTail(obj, stages);
    obj.stages = stages;
  } else if (obj.stages === undefined) {
    migrateLegacyCompletedGoalTailFromCompleted(obj);
  }
  return obj;
}

/** Parse + validate run-state JSON. Throws on malformed JSON or schema mismatch. */
export function parseRunState(content: string): RunState {
  const json = JSON.parse(content) as unknown;
  const normalized = normalizeRunStateJson(json);
  const result = RunStateSchema.safeParse(normalized);
  if (!result.success) {
    throw new RunStateValidationError(
      `Invalid run-state: ${result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`
    );
  }
  return result.data;
}

/**
 * Tagged result of a detailed run-state read (design D3): exactly one of a
 * parsed state, an invalid-file report (present but unparseable, with a
 * human-readable reason), or absent (no file at that path).
 */
export type RunStateReadResult =
  | { kind: 'ok'; state: RunState }
  | { kind: 'invalid'; reason: string }
  | { kind: 'absent' };

/**
 * Read run-state for a change directory, distinguishing "no file" from "file
 * present but invalid" (design D3) — `resume` uses this to report a broken
 * `auto-run.json` diagnosably instead of masquerading as "not found". Other
 * callers that only need the null-swallowing shape keep using `readRunState`.
 */
export function readRunStateDetailed(changeDir: string): RunStateReadResult {
  const p = runStatePath(changeDir);
  if (!fs.existsSync(p)) return { kind: 'absent' };
  try {
    return { kind: 'ok', state: parseRunState(fs.readFileSync(p, 'utf-8')) };
  } catch (err) {
    return { kind: 'invalid', reason: err instanceof Error ? err.message : String(err) };
  }
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
 * The sticky-legacy search inputs for a per-change state file. Stated once
 * here and reused by every state-file resolver (`file-placement` capability):
 * new state is born in the execution root's ephemera directory; state that
 * already lives at a legacy location keeps living there. One file's state is
 * never split across locations.
 */
export interface StateFileLocationOptions {
  /**
   * The execution root's ephemera directory — the TERMINAL landing, searched
   * first. Omitted only by callers that cannot resolve an execution root.
   */
  ephemeraDir?: string | null;
  /** The legacy machine-home work directory, searched second. */
  workDir?: string | null;
  /** Store v2 planning Changes are not execution-owned state locations. */
  includeChangeDir?: boolean;
}

/**
 * The ordered sticky-legacy search chain for a per-change state file: the
 * execution root's ephemera directory, then the legacy machine-home work
 * directory, then the change directory (the oldest legacy location). The
 * ordering rule lives here alone so every state-file resolver agrees.
 */
export function stateFileSearchChain(
  changeDir: string,
  options: StateFileLocationOptions = {}
): string[] {
  const chain: string[] = [];
  if (options.ephemeraDir) chain.push(options.ephemeraDir);
  if (options.workDir) chain.push(options.workDir);
  if (options.includeChangeDir !== false) chain.push(changeDir);
  return chain;
}

/**
 * Resolves WHERE `auto-run.json` lives for a change along the sticky-legacy
 * chain (design D3): the execution root's ephemera directory first, then the
 * legacy machine-home work directory, then the change directory. Returns null
 * when no location has one. This only locates the file; callers read it via
 * `readRunState(location.dir)` to get the validated `RunState`, keeping
 * `readRunState`'s existing signature and behavior intact.
 */
export function resolveRunStateLocation(
  changeDir: string,
  options: StateFileLocationOptions = {}
): RunStateLocation | null {
  for (const dir of stateFileSearchChain(changeDir, options)) {
    const candidate = runStatePath(dir);
    if (fs.existsSync(candidate)) {
      return { dir, path: candidate };
    }
  }

  return null;
}

/**
 * A private temp name in `dir`, owned by this process alone. Entropy — not just
 * pid + clock — because two writers in the same millisecond on a shared
 * ephemera directory (bind-mounted containers can repeat a pid) would otherwise
 * pick the same name and publish each other's bytes. Matches the repo's
 * canonical no-clobber writer (`threshold-schemes.ts`).
 */
function runStateTempPath(dir: string): string {
  const suffix = `${process.pid}-${crypto.randomBytes(8).toString('hex')}`;
  return path.join(dir, `.${RUN_STATE_FILENAME}.${suffix}.tmp`);
}

function removeRunStateTemp(temporary: string): void {
  try {
    fs.rmSync(temporary, { force: true });
  } catch {
    // Best effort: the publish already succeeded or already failed, and a temp
    // can never be mistaken for run-state (`resolveRunStateLocation` matches
    // only the exact `auto-run.json` name).
  }
}

/**
 * Writes `content` over `destination` crash-safely: a temp file in the SAME
 * directory, then a rename (design D5). Retention preparation updates a file
 * that may already exist and that a LEAD may also be hand-writing, so a
 * half-written `auto-run.json` — which every reader would then report as
 * invalid — must not be an observable state. Synchronous on purpose: the
 * canonical write seam below is synchronous and has synchronous callers.
 *
 * Either syscall failing removes the temp before rethrowing. A temp orphaned by
 * an UNCATCHABLE interruption (SIGKILL between the write and the publish) is
 * inert but unswept: `classifyEphemera` records an unrecognized top-level file
 * as `preserved`/`unknown` — not a blocker, so `rasen archive` still succeeds —
 * and nothing deletes it, so it lingers in the ephemera directory.
 */
function writeRunStateFileAtomically(destination: string, content: string): void {
  const dir = path.dirname(destination);
  fs.mkdirSync(dir, { recursive: true });
  const temporary = runStateTempPath(dir);
  try {
    fs.writeFileSync(temporary, content, { encoding: 'utf-8', flag: 'wx' });
    fs.renameSync(temporary, destination);
  } catch (error) {
    removeRunStateTemp(temporary);
    throw error;
  }
}

/** Whether `destination` is currently owned by any filesystem entry. */
function runStateEntryExists(destination: string): boolean {
  try {
    fs.lstatSync(destination);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

/** Validate, then write run-state into `runStateDir` (pretty JSON). */
export function writeRunState(runStateDir: string, state: RunState): void {
  const validated = RunStateSchema.parse(state);
  writeRunStateFileAtomically(
    runStatePath(runStateDir),
    `${JSON.stringify(validated, null, 2)}\n`
  );
}

export type RunStateCreateResult =
  | { kind: 'created'; path: string }
  | { kind: 'exists'; path: string };

/**
 * Creates run-state in `runStateDir` ONLY when no entry owns the name yet.
 *
 * `writeRunState` publishes with `renameSync`, which replaces whatever it lands
 * on. That is correct for a caller that just read the file it is updating, and
 * wrong for a caller that decided "there is no run-state here" some time ago:
 * retention preparation resolves knowledge identity asynchronously in between,
 * and a LEAD's `auto-run.json` — which carries the pipeline name and every
 * stage record — can be seeded inside that window. Replacing it would destroy a
 * whole run's progress and leave a file indistinguishable from a legitimately
 * retention-only record, so this seam reports the collision instead and lets
 * the caller merge into what is already there.
 *
 * `linkSync` is the exclusive publish: atomic like `renameSync`, but it fails
 * rather than replacing when the name is taken, on Windows and POSIX alike.
 */
export function createRunStateExclusive(
  runStateDir: string,
  state: RunState
): RunStateCreateResult {
  const validated = RunStateSchema.parse(state);
  const destination = runStatePath(runStateDir);
  const dir = path.dirname(destination);
  fs.mkdirSync(dir, { recursive: true });
  const temporary = runStateTempPath(dir);
  fs.writeFileSync(temporary, `${JSON.stringify(validated, null, 2)}\n`, {
    encoding: 'utf-8',
    flag: 'wx',
  });
  try {
    fs.linkSync(temporary, destination);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // Windows reports a taken name as EACCES/EPERM rather than EEXIST, so
    // confirm against the destination before calling it a collision.
    if (code === 'EEXIST' || ((code === 'EACCES' || code === 'EPERM') && runStateEntryExists(destination))) {
      return { kind: 'exists', path: destination };
    }
    throw error;
  } finally {
    // `linkSync` adds a second directory entry for the same inode rather than
    // consuming the temp, so the temp is always ours to clear.
    removeRunStateTemp(temporary);
  }
  return { kind: 'created', path: destination };
}

/** Why a raw knowledge-context injection did not happen. */
export type RunStateContextUpdateRefusal =
  | { kind: 'absent' }
  | { kind: 'invalid'; reason: string }
  | { kind: 'already-recorded'; context: FrozenKnowledgeContext };

export type RunStateContextUpdateResult =
  | { kind: 'written'; path: string }
  | RunStateContextUpdateRefusal;

/**
 * Injects a frozen knowledge context into an EXISTING run-state file without
 * rewriting anything else in it (design D4).
 *
 * Deliberately raw: it mutates the parsed JSON object rather than a validated
 * `RunState`, because the canonical write path normalizes at the read boundary
 * (`parseRunState` moves a non-enum `runtime` to `runtimeRaw`, drops `null`
 * optional fields) and applies nested schema defaults. A parse/serialize round
 * trip would therefore silently rewrite records the LEAD hand-wrote, which the
 * spec forbids — `knowledgeContext` is ADDED and no other value is changed.
 * (The document is re-serialized, so byte-level formatting is not preserved:
 * `JSON.parse` has already collapsed a repeated key to its last value, which is
 * exactly the ambiguity `detectDuplicateKeys` reports at read time.)
 *
 * An already-recorded context of ANY version is a refusal, not an overwrite:
 * preparation reuses what is recorded and never upgrades a version in place.
 */
export function updateRunStateKnowledgeContext(
  runStateDir: string,
  context: FrozenKnowledgeContext
): RunStateContextUpdateResult {
  const destination = runStatePath(runStateDir);
  let raw: string;
  try {
    raw = fs.readFileSync(destination, 'utf-8');
  } catch (error) {
    // Only a genuine absence is `absent`. EACCES on a file this seam's callers
    // have already located must not read back as "no record here" — the caller
    // renders that as a false `no auto-run.json found` diagnostic, and its own
    // contract promises the real errno instead.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'absent' };
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return {
      kind: 'invalid',
      reason: error instanceof Error ? error.message : String(error),
    };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { kind: 'invalid', reason: `${RUN_STATE_FILENAME} is not a JSON object` };
  }

  const record = parsed as Record<string, unknown>;
  const recorded = FrozenKnowledgeContextSchema.safeParse(record.knowledgeContext);
  if (recorded.success) return { kind: 'already-recorded', context: recorded.data };
  if (record.knowledgeContext !== undefined) {
    return {
      kind: 'invalid',
      reason: `the recorded knowledgeContext is not a valid frozen identity: ${recorded.error.issues
        .map((issue) => issue.message)
        .join('; ')}`,
    };
  }

  // Validate the MERGED document before it is written, so preparation never
  // turns a readable file into one a later resume reports as invalid — but
  // write the raw merge, not the validated projection.
  const merged = { ...record, knowledgeContext: context };
  const validation = RunStateSchema.safeParse(normalizeRunStateJson(merged));
  if (!validation.success) {
    return {
      kind: 'invalid',
      reason: validation.error.issues
        .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('; '),
    };
  }

  writeRunStateFileAtomically(destination, `${JSON.stringify(merged, null, 2)}\n`);
  return { kind: 'written', path: destination };
}

export interface RunStatePipelineSeed {
  name: string;
  stages: readonly { id: string }[];
}

/**
 * Initialize the durable state for a newly-created change assigned to a
 * pipeline. This is the single writer seam used by portfolio child creation,
 * so every child is resumable before its first stage starts.
 */
export function initializeRunState(
  changeDir: string,
  pipeline: RunStatePipelineSeed
): { path: string; state: RunState } {
  const destination = runStatePath(changeDir);
  if (fs.existsSync(destination)) {
    throw new Error(`Run-state already exists at ${destination}`);
  }
  const state: RunState = {
    pipeline: pipeline.name,
    stages: Object.fromEntries(
      pipeline.stages.map(stage => [stage.id, { status: 'pending' as const }])
    ),
  };
  writeRunState(changeDir, state);
  return { path: destination, state };
}

/**
 * Stages that count as completed for resume purposes: when `stages` is present,
 * those with status done|skipped; otherwise the `completed` convenience array.
 *
 * `delegated` is NOT completed — work handed to children is outstanding until
 * the children finish it, so a decomposed parent's stage list can never on its
 * own leave delivery as the only thing remaining.
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
 * The retention mode frozen for this run (design D2): the mode the retain stage
 * recorded on first entry. Resume prefers this over the current profile so a
 * mid-run profile edit never switches the retain branch. Undefined when no
 * retain stage has run yet (the router then reads the active profile).
 */
export function frozenRetentionMode(state: RunState): RetentionMode | undefined {
  return state.retention;
}

/** The typed learned-skill owner/planning identity frozen for retain/codify. */
export function frozenKnowledgeContext(
  state: RunState
): FrozenKnowledgeContext | undefined {
  return state.knowledgeContext;
}

/**
 * The execution binding this run was frozen against, or undefined when it
 * recorded none (a version 1 record, written before this existed).
 */
export function frozenExecutionBinding(
  state: RunState
): FrozenExecutionRef | undefined {
  const frozen = state.knowledgeContext;
  if (frozen === undefined || frozen.version === 1) return undefined;
  return frozen.execution;
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
 * boundary: a native `agentId`, a Claude bridge `sessionId`, a Codex bridge
 * `threadId`, or an explicit `transcript` path. These are what a resume uses
 * for exact-session continuation or warm-seeding; stages with no such pointer
 * are omitted. Bare-string (role-only) workers are omitted because they hold
 * nothing to resume from.
 */
export function stageWorkers(state: RunState): Record<string, RunStateWorker> {
  const out: Record<string, RunStateWorker> = {};
  if (!state.stages) return out;
  for (const [id, stage] of Object.entries(state.stages)) {
    const w = normalizeWorker(stage.worker);
    if (w && (w.agentId || w.sessionId || w.transcript || w.threadId)) out[id] = w;
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
 * `worker` lacks EVERY durable handle (`agentId`, `sessionId`, `transcript`,
 * `threadId`),
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
    if (
      normalized.agentId ||
      normalized.sessionId ||
      normalized.transcript ||
      normalized.threadId
    ) {
      continue;
    }
    const keys =
      typeof worker === 'string' ? [] : Object.keys(worker).filter((k) => k !== 'role');
    out.push({ stage: id, keys });
  }
  return out;
}
