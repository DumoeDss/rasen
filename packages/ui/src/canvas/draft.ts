/**
 * Pure draft-mutation functions for the pipeline canvas editor
 * (pipeline-canvas-edit design D2). The draft is a `WirePipelineDefinition`
 * value — NOT React Flow nodes/edges — the single source of truth; the canvas
 * derives nodes/edges from it per render via `layout.ts`. Kept free of React
 * Flow and DOM so cycle logic and field-preservation are unit-testable
 * without a canvas mount, the same reasoning that made `layout.ts` pure.
 */
import type { WirePipelineDefinition, WirePipelineDefinitionStage } from '../api/types.js';

/**
 * Appends a stage to the draft. Callers assemble the full stage object
 * (typically via `stageIdFor` for the id and the catalog's `gate.default` for
 * the initial gate) — this function performs no defaulting of its own so it
 * stays a pure append.
 */
export function addStage(
  def: WirePipelineDefinition,
  stage: WirePipelineDefinitionStage
): WirePipelineDefinition {
  return { ...def, stages: [...def.stages, stage] };
}

/**
 * Removes a stage and drops every `requires` reference to it from every
 * other stage — no dangling edge survives a deletion.
 */
export function removeStage(def: WirePipelineDefinition, id: string): WirePipelineDefinition {
  return {
    ...def,
    stages: def.stages
      .filter((stage) => stage.id !== id)
      .map((stage) =>
        stage.requires.includes(id)
          ? { ...stage, requires: stage.requires.filter((r) => r !== id) }
          : stage
      ),
  };
}

/** Adds a `from -> to` dependency (i.e. `to` now requires `from`), if not already present. */
export function addRequire(def: WirePipelineDefinition, from: string, to: string): WirePipelineDefinition {
  return {
    ...def,
    stages: def.stages.map((stage) =>
      stage.id === to && !stage.requires.includes(from)
        ? { ...stage, requires: [...stage.requires, from] }
        : stage
    ),
  };
}

/** Removes a `from -> to` dependency. */
export function removeRequire(def: WirePipelineDefinition, from: string, to: string): WirePipelineDefinition {
  return {
    ...def,
    stages: def.stages.map((stage) =>
      stage.id === to ? { ...stage, requires: stage.requires.filter((r) => r !== from) } : stage
    ),
  };
}

/**
 * Patches a stage's fields with a spread — every field the patch does not
 * name is preserved verbatim, including fields the properties panel never
 * exposes (goal-loop gates, runtime session settings, etc).
 */
export function updateStageFields(
  def: WirePipelineDefinition,
  id: string,
  patch: Partial<WirePipelineDefinitionStage>
): WirePipelineDefinition {
  return {
    ...def,
    stages: def.stages.map((stage) => (stage.id === id ? { ...stage, ...patch } : stage)),
  };
}

/** Renames a stage id and rewrites every `requires` reference to it. */
export function renameStage(
  def: WirePipelineDefinition,
  oldId: string,
  newId: string
): WirePipelineDefinition {
  return {
    ...def,
    stages: def.stages.map((stage) => {
      const requires = stage.requires.map((r) => (r === oldId ? newId : r));
      return stage.id === oldId ? { ...stage, id: newId, requires } : { ...stage, requires };
    }),
  };
}

/** Forward adjacency over `requires`: node -> the stages that require it. */
function buildAdjacency(def: WirePipelineDefinition): Map<string, string[]> {
  const adjacency = new Map<string, string[]>();
  for (const stage of def.stages) {
    for (const req of stage.requires) {
      const arr = adjacency.get(req) ?? [];
      arr.push(stage.id);
      adjacency.set(req, arr);
    }
  }
  return adjacency;
}

/**
 * Whether connecting `from -> to` (i.e. `to` requiring `from`) would close a
 * dependency cycle, checked by reachability: if `to` can already reach `from`
 * via existing `requires` edges, adding the new edge closes a loop. Same
 * algorithm as the React Flow demo (`rasen/office-hours/canvas-demos/
 * react-flow/src/App.jsx`) parameterized over the draft's `requires` graph
 * instead of raw edges. A convenience client-side fast-path only — the
 * server's dry-run validation remains authoritative.
 */
export function wouldCreateCycle(def: WirePipelineDefinition, from: string, to: string): boolean {
  if (from === to) return true;
  const adjacency = buildAdjacency(def);
  const stack: string[] = [to];
  const visited = new Set<string>();
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node === from) return true;
    if (visited.has(node)) continue;
    visited.add(node);
    stack.push(...(adjacency.get(node) ?? []));
  }
  return false;
}

/**
 * Generates a stage id from a skill id (lowercased, non-id characters
 * collapsed to `-`), uniquified against the draft's existing stage ids with a
 * numeric suffix. Panel-editable afterward via `renameStage`.
 */
export function stageIdFor(skill: string, def: WirePipelineDefinition): string {
  const base = skill.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'stage';
  const existing = new Set(def.stages.map((stage) => stage.id));
  if (!existing.has(base)) return base;
  let n = 2;
  while (existing.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

/** Structural deep-equality, order-independent on object keys. */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  const aKeys = Object.keys(a as Record<string, unknown>);
  const bKeys = Object.keys(b as Record<string, unknown>);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((k) =>
    Object.prototype.hasOwnProperty.call(b, k) &&
    deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])
  );
}

/** Whether the draft has diverged from the last-loaded definition (header "Unsaved changes" chip). */
export function isDirty(draft: WirePipelineDefinition, loaded: WirePipelineDefinition): boolean {
  return !deepEqual(draft, loaded);
}

/** A validation issue mapped onto a concrete draft stage. */
export interface IssueTarget {
  stageIndex: number;
  field?: string;
}

/**
 * Maps a validation issue's JSON-pointer-ish `path` (e.g. `/stages/2/skill`)
 * onto the stage index (resolved against the SAME draft stage-order array the
 * validation request serialized) and optional field tail. `/stages` or `/`
 * (pipeline-level) and any path this pattern does not recognize map to
 * `null` — the caller still lists the issue in the drawer, never drops it.
 * When `stageCount` is passed, an index at or past it also maps to `null`
 * (an out-of-range index is exactly as unmappable as a malformed path) —
 * pass it whenever the target array is at hand so the function validates
 * standalone instead of relying on every call site's own `?.id` guard.
 */
export function issuePathTarget(path: string, stageCount?: number): IssueTarget | null {
  const match = /^\/stages\/(\d+)(?:\/(.+))?$/.exec(path);
  if (!match) return null;
  const stageIndex = Number(match[1]);
  if (!Number.isInteger(stageIndex) || stageIndex < 0) return null;
  if (stageCount !== undefined && stageIndex >= stageCount) return null;
  return match[2] ? { stageIndex, field: match[2] } : { stageIndex };
}
