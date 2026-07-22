/**
 * Wire (HTTP JSON) shapes for the config API — see design.md D2/D3 of the
 * `unified-config-api` change. Kept separate from the in-process types
 * (`effective-config.ts`, `config-keys.ts`) because the wire shape drops the
 * unserializable `definition.validate` function in favor of derived
 * `constraints`, and adds `warnings` for read-time invalidity signaling.
 */
import type { ConfigScope, ConfigValueType } from '../config-keys.js';
import type { ConfigSource } from '../effective-config.js';

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

/**
 * A trimmed projection of a pipeline stage for the read-only gates inventory
 * (D5 of `config-page-coherence`) — only what a gates panel needs, not the
 * CLI's full `StageView` (no runtime/handoff/model detail). `gate: 'vet'`
 * marks a stage that ALWAYS pauses, distinct from an ordinary `gate: true`.
 */
export interface WirePipelineStage {
  id: string;
  role: string | null;
  skill: string | null;
  gate: false | true | 'vet';
}

/** A pipeline's identity plus its gate-carrying stage list, for `GET /api/v1/pipelines`. */
export interface WirePipeline {
  name: string;
  description: string;
  stages: WirePipelineStage[];
}
