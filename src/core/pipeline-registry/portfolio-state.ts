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

/** Child lifecycle status; intentionally excludes parent-stage `delegated`. */
export const PortfolioChildStatusSchema = z.enum([
  'pending',
  'in_progress',
  'done',
  'skipped',
  'escalated',
]);
export type PortfolioChildStatus = z.infer<typeof PortfolioChildStatusSchema>;

/** One-time parent-level delivery uses the same lifecycle, not parent ownership. */
export const PortfolioDeliveryStatusSchema = PortfolioChildStatusSchema;
export type PortfolioDeliveryStatus = z.infer<typeof PortfolioDeliveryStatusSchema>;

export const PortfolioDeliverySchema = z.object({
  status: PortfolioDeliveryStatusSchema.default('pending'),
  mode: z.string().optional(),
  note: z.string().optional(),
}).passthrough();
export type PortfolioDelivery = z.infer<typeof PortfolioDeliverySchema>;

/**
 * One child change in the portfolio. `dependsOn` (other child ids) encodes the
 * dependency DAG. `pipeline` is the pipeline this child actually runs — the
 * decompose stage's `childPipeline` by default, but overridable per child (so a
 * child can be `bug-fix` while a sibling is `full-feature`); it MUST be
 * decompose-free. Child status is deliberately narrower than parent stage
 * status: `delegated` describes parent ownership transfer, not child progress.
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
}).passthrough();
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
    delivery: PortfolioDeliverySchema.default({ status: 'pending' }),
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

/**
 * Normalize the raw portfolio-state JSON's `planner` record before validation
 * (design D1) — reuses the same worker-record normalization run-state.ts
 * applies to per-stage workers, since `planner` shares the worker shape.
 */
/**
 * Preserve an unrecognized `status` value verbatim in `statusRaw`, defaulting
 * the typed `status` field to `pending`. A portfolio record may carry a status
 * outside the parsed enum (e.g. `propose-done`); without this, the schema parse
 * would fail and `readPortfolioState` would return null — making a present
 * portfolio look absent, the substitution that can present delivery as the next
 * step for work that is not finished.
 */
function normalizeChildStatusRaw(child: Record<string, unknown>): void {
  if (!Object.prototype.hasOwnProperty.call(child, 'status')) return;
  const parsed = PortfolioChildStatusSchema.safeParse(child.status);
  if (parsed.success) {
    child.status = parsed.data;
    return;
  }
  child.statusRaw = typeof child.status === 'string' ? child.status : String(child.status);
  child.status = 'pending';
}

function normalizePortfolioStateJson(json: unknown): unknown {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return json;
  const obj: Record<string, unknown> = { ...(json as Record<string, unknown>) };
  if (typeof obj.planner === 'object' && obj.planner !== null) {
    obj.planner = normalizeRunStateWorkerRecord(obj.planner);
  }
  if (Array.isArray(obj.children)) {
    obj.children = obj.children.map((rawChild, index) => {
      if (typeof rawChild !== 'object' || rawChild === null || Array.isArray(rawChild)) {
        return rawChild;
      }
      const child: Record<string, unknown> = { ...(rawChild as Record<string, unknown>) };
      normalizeChildStatusRaw(child);
      if (!Object.prototype.hasOwnProperty.call(child, 'prerequisites')) {
        return child;
      }

      const legacy = z.array(z.string()).safeParse(child.prerequisites);
      if (!legacy.success) {
        throw new PortfolioStateValidationError(
          `Invalid portfolio run-state: children.${index}.prerequisites must be an array of strings`
        );
      }

      if (Object.prototype.hasOwnProperty.call(child, 'dependsOn')) {
        const canonical = z.array(z.string()).safeParse(child.dependsOn);
        if (!canonical.success) {
          throw new PortfolioStateValidationError(
            `Invalid portfolio run-state: children.${index}.dependsOn must be an array of strings`
          );
        }
        const sortedLegacy = [...legacy.data].sort();
        const sortedCanonical = [...canonical.data].sort();
        if (JSON.stringify(sortedLegacy) !== JSON.stringify(sortedCanonical)) {
          throw new PortfolioStateValidationError(
            `Invalid portfolio run-state: children.${index} has conflicting dependsOn and prerequisites`
          );
        }
      } else {
        child.dependsOn = legacy.data;
      }

      delete child.prerequisites;
      return child;
    });
  }
  return obj;
}

/** Parse + validate portfolio-state JSON. Throws on malformed JSON / schema mismatch. */
export function parsePortfolioState(content: string): PortfolioState {
  const json = JSON.parse(content) as unknown;
  const normalized = normalizePortfolioStateJson(json);
  const result = PortfolioStateSchema.safeParse(normalized);
  if (!result.success) {
    const valueAt = (root: unknown, issuePath: PropertyKey[]): unknown =>
      issuePath.reduce<unknown>((value, key) => {
        if (typeof value !== 'object' || value === null) return undefined;
        return (value as Record<PropertyKey, unknown>)[key];
      }, root);
    throw new PortfolioStateValidationError(
      `Invalid portfolio run-state: ${result.error.issues
        .map(i => {
          const actual = valueAt(normalized, i.path);
          const received = actual === undefined ? '' : ` (received ${JSON.stringify(actual)})`;
          return `${i.path.join('.')}: ${i.message}${received}`;
        })
        .join('; ')}`
    );
  }
  return result.data;
}

/**
 * Lossy compatibility reader for best-effort UI joins. Returns null when the
 * file is absent or invalid. Authoritative resume callers must use the detailed
 * reader below so invalid portfolio state cannot masquerade as absence.
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

export type PortfolioStateReadResult =
  | { kind: 'absent' }
  | { kind: 'invalid'; reason: string }
  | { kind: 'ok'; state: PortfolioState };

/**
 * Read portfolio state without collapsing invalid content into absence.
 * Resume uses this strict seam because a present portfolio is authoritative:
 * falling back to auto-run.json would resume the wrong orchestration model.
 */
export function readPortfolioStateDetailed(changeDir: string): PortfolioStateReadResult {
  const p = portfolioStatePath(changeDir);
  if (!fs.existsSync(p)) return { kind: 'absent' };
  try {
    return { kind: 'ok', state: parsePortfolioState(fs.readFileSync(p, 'utf-8')) };
  } catch (error) {
    return {
      kind: 'invalid',
      reason: error instanceof Error ? error.message : String(error),
    };
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
 * `resolveRunStateLocation`; authoritative callers then use
 * `readPortfolioStateDetailed(location.dir)`.
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
export function arePortfolioChildrenComplete(state: PortfolioState): boolean {
  return state.children.length > 0 && state.children.every(c => isSatisfied(c.status));
}

/** True only after both child work and the one-time parent delivery finish. */
export function isPortfolioComplete(state: PortfolioState): boolean {
  return arePortfolioChildrenComplete(state)
    && (state.delivery.status === 'done' || state.delivery.status === 'skipped');
}
