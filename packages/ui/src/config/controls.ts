/**
 * Constraint-driven control selection (design.md D6). Maps a wire entry's
 * `constraints` to the control the config page should render, plus the
 * client-side validation mirror (the server verdict remains authoritative).
 */
import type { WireConfigEntry } from '../api/types.js';

export type ControlKind = 'toggle' | 'select' | 'ranged-number' | 'text' | 'readonly';

export interface ControlSpec {
  kind: ControlKind;
  /** True when the entry cannot be edited at all (env-override, not_settable/wildcard display-only). */
  readonly: boolean;
  enumValues?: readonly string[];
  range?: { gt: number; lte: number };
}

/**
 * Env-override values are always read-only precedence (design.md D6): never
 * offered for editing regardless of type. Everything else follows
 * `constraints.type` — UNLESS every scope the key allows has been filtered
 * out by `projectSelected` (design.md D6 "Launched outside a project": a
 * project-only key has nothing writable until a project is selected), in
 * which case the control is disabled too rather than firing a write that the
 * server will reject with `project_required`.
 */
export function selectControl(entry: WireConfigEntry, projectSelected: boolean): ControlSpec {
  if (entry.source === 'env-override' || entry.definition.wildcard) {
    // env-override: always read-only precedence. wildcard (e.g. featureFlags):
    // the API returns not_supported for individual leaves in v1 (D6) — the
    // family entry itself is display-only.
    return { kind: 'readonly', readonly: true };
  }

  if (writableScopes(entry, projectSelected).length === 0) {
    return { kind: 'readonly', readonly: true };
  }

  const { constraints } = entry.definition;
  switch (constraints.type) {
    case 'boolean':
      return { kind: 'toggle', readonly: false };
    case 'enum':
      return { kind: 'select', readonly: false, enumValues: constraints.enumValues };
    case 'number':
      return { kind: 'ranged-number', readonly: false, range: constraints.range };
    case 'string':
      return { kind: 'text', readonly: false };
    case 'array':
    default:
      return { kind: 'readonly', readonly: true };
  }
}

/** Client-side mirror of the server's numeric range check — immediate feedback only, server is authoritative. */
export function validateRangedNumber(value: number, range?: { gt: number; lte: number }): string | null {
  if (Number.isNaN(value)) return 'Must be a number';
  if (!range) return null;
  if (value <= range.gt || value > range.lte) {
    return `Must be greater than ${range.gt} and at most ${range.lte}`;
  }
  return null;
}

/**
 * Scopes a key allows for writes/unsets (registry `scopes`, minus
 * env-override which is never writable, minus `project` when no project is
 * selected — design.md D6 "Launched outside a project": project-scope
 * editing is disabled until a project is selected, so it must never appear
 * as a choosable/default scope in that state).
 */
export function writableScopes(
  entry: WireConfigEntry,
  projectSelected: boolean
): Array<'global' | 'project'> {
  if (entry.source === 'env-override') return [];
  return entry.definition.scopes.filter((s) => s !== 'project' || projectSelected);
}

/**
 * The scope a scope-choice control should default to (design.md D6): the
 * currently-effective scope when it's writable, otherwise the first allowed
 * scope. The user can always change it — every write still carries the
 * explicit chosen scope.
 */
export function defaultWriteScope(
  entry: WireConfigEntry,
  projectSelected: boolean
): 'global' | 'project' | undefined {
  const scopes = writableScopes(entry, projectSelected);
  if (scopes.length === 0) return undefined;
  if (entry.source === 'global' || entry.source === 'project') {
    if (scopes.includes(entry.source)) return entry.source;
  }
  return scopes[0];
}
