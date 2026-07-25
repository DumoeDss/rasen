import { hasRuntimeCapability, type ProbeRuntime } from './runtime-adapters.js';
import {
  listThresholdSchemes,
  type ThresholdScheme,
} from './threshold-schemes.js';
import type {
  ReuseThresholdRole,
  ThresholdRole,
  ThresholdValue,
} from './threshold-values.js';

export type ThresholdFamily = 'handoff' | 'reuse';
export type ThresholdBindingScope = 'project' | 'store' | 'global';
export type ThresholdBindingRow = ProbeRuntime | 'default';
export type ThresholdBindings = Partial<Record<ThresholdBindingRow, string>>;

export interface ThresholdBindingLayers {
  project?: ThresholdBindings;
  store?: ThresholdBindings;
  global?: ThresholdBindings;
}

export type ThresholdSchemeSnapshotEntry =
  | { valid: true; scheme: ThresholdScheme }
  | { valid: false; error: string };
export type ThresholdSchemeSnapshot = Readonly<Record<string, ThresholdSchemeSnapshotEntry>>;

export interface ThresholdCandidate {
  value?: ThresholdValue;
  source: string;
}

export interface ThresholdNonBindingLayers {
  /** Handoff only: configured pipelines.<pipeline>.handoff.<stage>. */
  configuredStage?: ThresholdCandidate;
  /** Handoff only: stage YAML handoff. */
  stage?: ThresholdCandidate;
  pipelineRole?: ThresholdCandidate;
  pipeline?: ThresholdCandidate;
  projectRole?: ThresholdCandidate;
  project?: ThresholdCandidate;
  storeRole?: ThresholdCandidate;
  store?: ThresholdCandidate;
  globalRole?: ThresholdCandidate;
  global?: ThresholdCandidate;
  preset?: ThresholdCandidate;
  default: ThresholdCandidate & { value: ThresholdValue };
}

export interface ThresholdBindingMetadata {
  scope: ThresholdBindingScope;
  row: ThresholdBindingRow;
  scheme: string;
}

export interface ThresholdDiagnostic {
  code: 'missing-scheme' | 'invalid-scheme';
  scope: ThresholdBindingScope;
  row: ThresholdBindingRow;
  scheme: string;
  message: string;
}

export interface ResolveThresholdInput {
  family: ThresholdFamily;
  role?: ThresholdRole;
  runtime?: string;
  /** Optional identities retained for callers/reporting; resolution does no I/O with them. */
  pipeline?: string;
  stage?: string;
  bindings?: ThresholdBindingLayers;
  schemes?: ThresholdSchemeSnapshot;
  nonBinding: ThresholdNonBindingLayers;
  /** Top-level reuse has no runtime identity and considers only default rows. */
  bindingRows?: 'runtime-and-default' | 'default-only';
}

export interface ResolvedThreshold {
  threshold: ThresholdValue;
  source: string;
  binding?: ThresholdBindingMetadata;
  diagnostics: ThresholdDiagnostic[];
}

export function loadThresholdSchemeSnapshot(): ThresholdSchemeSnapshot {
  return Object.fromEntries(
    listThresholdSchemes().map((entry) => [
      entry.name,
      entry.valid
        ? { valid: true as const, scheme: entry.scheme }
        : { valid: false as const, error: entry.error },
    ])
  );
}

function bindingCandidates(input: ResolveThresholdInput): Array<{
  scope: ThresholdBindingScope;
  row: ThresholdBindingRow;
  scheme: string;
}> {
  const result: Array<{
    scope: ThresholdBindingScope;
    row: ThresholdBindingRow;
    scheme: string;
  }> = [];
  const scopes = ['project', 'store', 'global'] as const;
  const rows: ThresholdBindingRow[] = [];
  if (
    input.bindingRows !== 'default-only' &&
    hasRuntimeCapability(input.runtime, 'canProbeContext')
  ) {
    rows.push(input.runtime);
  }
  rows.push('default');

  for (const row of rows) {
    for (const scope of scopes) {
      const scopeBindings = input.bindings?.[scope];
      if (!scopeBindings || !Object.hasOwn(scopeBindings, row)) continue;
      const scheme = scopeBindings[row];
      if (scheme !== undefined) result.push({ scope, row, scheme });
    }
  }
  return result;
}

function schemeThreshold(
  family: ThresholdFamily,
  role: ThresholdRole | undefined,
  scheme: ThresholdScheme
): { threshold: ThresholdValue; roleOverride: boolean } {
  if (family === 'handoff') {
    const roleThreshold = role === undefined ? undefined : scheme.handoffRoles?.[role];
    return roleThreshold === undefined
      ? { threshold: scheme.handoff, roleOverride: false }
      : { threshold: roleThreshold, roleOverride: true };
  }

  const reusableRole =
    role === 'planner' || role === 'implementer'
      ? (role as ReuseThresholdRole)
      : undefined;
  const roleThreshold =
    reusableRole === undefined ? undefined : scheme.reuseRoles?.[reusableRole];
  return roleThreshold === undefined
    ? { threshold: scheme.reuse, roleOverride: false }
    : { threshold: roleThreshold, roleOverride: true };
}

function firstCandidate(
  candidates: Array<ThresholdCandidate | undefined>
): ThresholdCandidate & { value: ThresholdValue } {
  for (const candidate of candidates) {
    if (candidate?.value !== undefined) {
      return candidate as ThresholdCandidate & { value: ThresholdValue };
    }
  }
  throw new Error('Threshold resolution requires a default candidate.');
}

/**
 * Pure, synchronous threshold selection. All filesystem/config/runtime probing
 * is caller-injected through normalized layers.
 */
export function resolveThreshold(input: ResolveThresholdInput): ResolvedThreshold {
  const diagnostics: ThresholdDiagnostic[] = [];
  const preBinding =
    input.family === 'handoff'
      ? [input.nonBinding.configuredStage, input.nonBinding.stage].find(
          (candidate) => candidate?.value !== undefined
        )
      : undefined;

  if (preBinding?.value !== undefined) {
    return {
      threshold: preBinding.value,
      source: preBinding.source,
      diagnostics,
    };
  }

  for (const candidate of bindingCandidates(input)) {
    const schemeSnapshot = input.schemes;
    if (!schemeSnapshot || !Object.hasOwn(schemeSnapshot, candidate.scheme)) {
      diagnostics.push({
        code: 'missing-scheme',
        ...candidate,
        message: `Threshold binding ${candidate.scope}.${candidate.row} references missing scheme "${candidate.scheme}"; skipping it.`,
      });
      continue;
    }
    const snapshot = schemeSnapshot[candidate.scheme]!;
    if (!snapshot.valid) {
      diagnostics.push({
        code: 'invalid-scheme',
        ...candidate,
        message: `Threshold binding ${candidate.scope}.${candidate.row} references invalid scheme "${candidate.scheme}": ${snapshot.error}; skipping it.`,
      });
      continue;
    }
    const selected = schemeThreshold(input.family, input.role, snapshot.scheme);
    return {
      threshold: selected.threshold,
      source: `${candidate.scope}-scheme${selected.roleOverride ? '-role' : ''}`,
      binding: {
        scope: candidate.scope,
        row: candidate.row,
        scheme: candidate.scheme,
      },
      diagnostics,
    };
  }

  const layers = input.nonBinding;
  const fallback =
    input.family === 'handoff'
      ? firstCandidate([
          layers.pipelineRole,
          layers.pipeline,
          layers.projectRole,
          layers.project,
          layers.storeRole,
          layers.store,
          layers.globalRole,
          layers.global,
          layers.preset,
          layers.default,
        ])
      : firstCandidate([
          layers.pipelineRole,
          layers.pipeline,
          layers.preset,
          layers.default,
        ]);

  return {
    threshold: fallback.value,
    source: fallback.source,
    diagnostics,
  };
}
