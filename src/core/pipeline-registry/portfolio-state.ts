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
import { RunStateWorkerSchema, normalizeRunStateWorkerRecord } from './run-state.js';

export const PORTFOLIO_STATE_FILENAME = 'portfolio-run.json';

/** How a child is being executed relative to its siblings. */
export const ChildExecutionModeSchema = z.enum(['serial', 'parallel']);
export type ChildExecutionMode = z.infer<typeof ChildExecutionModeSchema>;

/**
 * A child's progress vocabulary. It started as the per-stage status enum
 * (`StageStatusSchema`) and now extends it with two members a child genuinely
 * needs and a stage does not:
 *
 *  - `proposed` — the child's proposal is complete but its implementation has
 *    not started. This is a real, common state for a paused portfolio; it is
 *    NON-terminal, so a `proposed` child keeps its portfolio unfinished. It
 *    exists because a LEAD reaching for this state with an invented value
 *    (`propose-done`) put the record outside the enum, which silently cost the
 *    parent its portfolio identity entirely.
 *  - `unknown` — the normalized landing place for a status this reader does not
 *    recognize. The value as written is preserved on `statusRaw`; see
 *    `normalizePortfolioChildStatus`. Also non-terminal.
 *
 * `delegated` is deliberately NOT here: it describes a parent's own stage being
 * handed to children, which is not a thing a child can be.
 */
export const PortfolioChildStatusSchema = z.enum([
  'pending',
  'in_progress',
  'proposed',
  'done',
  'skipped',
  'escalated',
  'unknown',
]);
export type PortfolioChildStatus = z.infer<typeof PortfolioChildStatusSchema>;

/**
 * One child change in the portfolio. `dependsOn` (other child ids) encodes the
 * dependency DAG. `pipeline` is the pipeline this child actually runs — the
 * decompose stage's `childPipeline` by default, but overridable per child (so a
 * child can be `bug-fix` while a sibling is `full-feature`); it MUST be
 * decompose-free. `statusRaw` preserves an unrecognized `status` exactly as
 * written (the `runtimeRaw` precedent in run-state.ts).
 */
export const PortfolioChildSchema = z.object({
  id: z.string().min(1),
  pipeline: z.string().min(1),
  dependsOn: z.array(z.string()).default([]),
  status: PortfolioChildStatusSchema.default('pending'),
  statusRaw: z.string().optional(),
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

const KNOWN_CHILD_STATUSES: ReadonlySet<string> = new Set(
  PortfolioChildStatusSchema.options
);

/**
 * Normalize a RAW (untyped, pre-validation) child record so a progress value
 * this reader has not learned yet cannot invalidate the whole portfolio: a
 * `status` string outside the vocabulary is preserved verbatim under
 * `statusRaw` and `status` becomes `unknown` — non-terminal, so the child
 * counts as unfinished and can never make `isPortfolioComplete` true.
 *
 * This follows the `runtimeRaw` precedent in run-state.ts, and the ordering
 * matters: tolerance means vocabulary drift degrades to "not done" (safe)
 * rather than "portfolio invisible" (unsafe — it is what let a paused parent
 * fall through to a stage-based resume that offered `ship`).
 *
 * Normalization runs on READ only. `unknown` is itself a member of the child
 * vocabulary, so a record read and written back round-trips it rather than
 * failing validation — deliberate, since rejecting it would discard the drift
 * `statusRaw` exists to preserve, and safe, because `unknown` is non-terminal
 * either way.
 */
function normalizePortfolioChildStatus(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return raw;
  const child: Record<string, unknown> = { ...(raw as Record<string, unknown>) };
  if (typeof child.status === 'string' && !KNOWN_CHILD_STATUSES.has(child.status)) {
    child.statusRaw = child.status;
    child.status = 'unknown';
  }
  return child;
}

/**
 * Normalize the raw portfolio-state JSON before validation: the `planner`
 * record (design D1) — reusing the same worker-record normalization
 * run-state.ts applies to per-stage workers, since `planner` shares the worker
 * shape — and each child's progress status.
 */
function normalizePortfolioStateJson(json: unknown): unknown {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return json;
  const obj: Record<string, unknown> = { ...(json as Record<string, unknown>) };
  if (typeof obj.planner === 'object' && obj.planner !== null) {
    obj.planner = normalizeRunStateWorkerRecord(obj.planner);
  }
  if (Array.isArray(obj.children)) {
    obj.children = obj.children.map(normalizePortfolioChildStatus);
  }
  return obj;
}

/** Parse + validate portfolio-state JSON. Throws on malformed JSON / schema mismatch. */
export function parsePortfolioState(content: string): PortfolioState {
  const json = JSON.parse(content) as unknown;
  const normalized = normalizePortfolioStateJson(json);
  const result = PortfolioStateSchema.safeParse(normalized);
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

/**
 * Tagged result of a detailed portfolio-state read: exactly one of a parsed
 * state, an invalid-file report (present but unparseable, with a human-readable
 * reason), or absent (no file at that path). Mirrors `RunStateReadResult`.
 */
export type PortfolioStateReadResult =
  | { kind: 'ok'; state: PortfolioState }
  | { kind: 'invalid'; reason: string }
  | { kind: 'absent' };

/**
 * Read portfolio run-state for a parent change directory, distinguishing "no
 * file" from "file present but unreadable". `resume` uses this so a broken
 * `portfolio-run.json` is reported diagnosably rather than masquerading as
 * "this change was never split" — the substitution that can present delivery as
 * the next step for work that is not finished.
 *
 * `readPortfolioState` keeps its lenient null-swallowing contract for the
 * callers that legitimately want "portfolio or not"; this is an addition beside
 * it, not a replacement.
 */
export function readPortfolioStateDetailed(changeDir: string): PortfolioStateReadResult {
  const p = portfolioStatePath(changeDir);
  if (!fs.existsSync(p)) return { kind: 'absent' };
  try {
    return { kind: 'ok', state: parsePortfolioState(fs.readFileSync(p, 'utf-8')) };
  } catch (err) {
    return { kind: 'invalid', reason: err instanceof Error ? err.message : String(err) };
  }
}

/** The directory (and full file path) a portfolio-state candidate resolved from. */
export interface PortfolioStateLocation {
  dir: string;
  path: string;
}

/**
 * Resolves WHERE `portfolio-run.json` lives for a parent change (design D4,
 * sticky-legacy): `workDir` first when provided and it holds the file, else
 * `changeDir` (legacy). Returns null when neither location has one. Mirrors
 * `resolveRunStateLocation` — callers read via `readPortfolioState(location.dir)`.
 */
export function resolvePortfolioStateLocation(
  changeDir: string,
  workDir?: string | null
): PortfolioStateLocation | null {
  if (workDir) {
    const workPath = portfolioStatePath(workDir);
    if (fs.existsSync(workPath)) {
      return { dir: workDir, path: workPath };
    }
  }

  const legacyPath = portfolioStatePath(changeDir);
  if (fs.existsSync(legacyPath)) {
    return { dir: changeDir, path: legacyPath };
  }

  return null;
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

/**
 * A child counts as satisfied (for unblocking dependents, and for portfolio
 * completeness) when done or skipped. Everything else — including `proposed`
 * and the normalized `unknown` — is non-terminal by construction: this is an
 * allowlist, so a status added to the vocabulary later, or one that arrives
 * from a newer writer, cannot accidentally read as finished.
 */
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

/**
 * True when the portfolio has at least one child and EVERY child has reached a
 * terminal state (done | skipped).
 *
 * The length check is not redundant. `children` defaults to `[]`, and
 * `[].every(...)` is vacuously true — so a record written before its children
 * were appended (these files are hand-written; there is no production writer)
 * would otherwise report a decomposed parent finished with no evidence at all.
 * That is the same failure this module exists to prevent, reached by a
 * different route.
 */
export function isPortfolioComplete(state: PortfolioState): boolean {
  return state.children.length > 0 && state.children.every(c => isSatisfied(c.status));
}
