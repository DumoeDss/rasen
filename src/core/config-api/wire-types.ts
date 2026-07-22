/**
 * Wire (HTTP JSON) shapes for the config API — see design.md D2/D3 of the
 * `unified-config-api` change. Kept separate from the in-process types
 * (`effective-config.ts`, `config-keys.ts`) because the wire shape drops the
 * unserializable `definition.validate` function in favor of derived
 * `constraints`, and adds `warnings` for read-time invalidity signaling.
 */
import type { ConfigScope, ConfigValueType } from '../config-keys.js';
import type { ConfigSource } from '../effective-config.js';
import type { ThresholdValue } from '../pipeline-registry/index.js';

/** `{ projectId, name, root }` — a registered project, or the server's launch project. */
export interface ProjectRef {
  projectId: string;
  name: string;
  root: string;
}

/**
 * The store contributing the store layer to a config read (design D6): the
 * inherited store for a project context, or the addressed store's own root
 * for a store context. `null` in a response when no store layer is active.
 */
export interface StoreLayerRef {
  id: string;
  root: string;
}

export interface WireConstraints {
  type: ConfigValueType;
  enumValues?: readonly string[];
  /** For `type: 'number'`, or the fraction branch of `type: 'threshold'`. */
  range?: { gt: number; lte: number };
  /**
   * Present only for `type: 'threshold'` (dual-form): describes the
   * alternate absolute form, a strict object `{ remainingTokens: N }` where
   * `N` is an integer greater than `remainingTokensGt`. The fraction form's
   * range is `range` above — a `'threshold'` entry always carries both.
   */
  remainingTokensGt?: number;
}

/** `ConfigKeyDefinition` minus the `validate` function, plus derived `constraints` for form rendering. */
export interface WireConfigKeyDefinition {
  key: string;
  scopes: ConfigScope[];
  type: ConfigValueType;
  enumValues?: readonly string[];
  defaultValue: unknown;
  description: string;
  group: string;
  wildcard?: boolean;
  constraints: WireConstraints;
}

export interface WireConfigEntry {
  definition: WireConfigKeyDefinition;
  value: unknown;
  source: ConfigSource;
  scopeValues: { global?: unknown; store?: unknown; project?: unknown };
  /**
   * The fully-qualified instance path for a wildcard family instance entry
   * (e.g. `pipelines.small-feature.gates.propose`). Absent on fixed keys and
   * on a family's template entry. Additive optional field — the UI mirror in
   * `packages/ui/src/api/types.ts` does NOT carry it yet (it lands with the
   * Pipelines-page consumer, keeping this change's touch-set disjoint).
   */
  instanceKey?: string;
  /** Present only when a raw on-disk scope value fails registry validation; the API never rewrites the file to fix it. */
  warnings?: string[];
}

/** Uniform non-2xx error envelope, mirroring the CLI's `StoreError` code/fix vocabulary. */
export interface ApiErrorBody {
  error: { code: string; message: string; fix?: string };
}

/** An effective value plus the scope-qualified layer that supplied it (`GET /api/v1/pipelines`). */
export interface WireEffectiveValue<T> {
  value: T;
  source: string;
}

/**
 * A pipeline stage for `GET /api/v1/pipelines` (pipeline-http-api). Beside its
 * declared identity and its declared `gate` value (`false` | `true` | `'vet'`,
 * where `'vet'` marks an always-pausing stage distinct from an ordinary
 * `true`), it reports each EFFECTIVE per-stage value — gate (after the mask),
 * model, handoff threshold, and runtime — with the layer that supplied it, so
 * the UI renders resolution without reimplementing it.
 */
export interface WirePipelineStage {
  id: string;
  role: string | null;
  skill: string | null;
  /** The declared gate value from the pipeline definition, unmasked. */
  gate: false | true | 'vet';
  /** The effective gate after the mask: `true` pauses, `false` auto-approves, `'vet'` always pauses. */
  effectiveGate: WireEffectiveValue<boolean | 'vet'>;
  effectiveModel: WireEffectiveValue<string | null>;
  effectiveHandoff: WireEffectiveValue<ThresholdValue>;
  effectiveRuntime: WireEffectiveValue<'claude' | 'codex'>;
}

/**
 * A pipeline's identity, provenance, and per-stage effective configuration for
 * `GET /api/v1/pipelines`. `provenance` marks a built-in versus a user pipeline;
 * `sourceLayer` names the layer the definition resolved from.
 */
export interface WirePipeline {
  name: string;
  description: string;
  provenance: 'built-in' | 'user';
  sourceLayer: 'project' | 'user' | 'package';
  stages: WirePipelineStage[];
}

/** The `op` discriminated request body for `POST /api/v1/pipelines`. */
export type PipelineMutationRequest =
  | { op: 'import'; path: string; force?: boolean }
  | { op: 'init'; name: string; output: string }
  | { op: 'export'; name: string; path: string; force?: boolean }
  | { op: 'delete'; name: string; force?: boolean };
