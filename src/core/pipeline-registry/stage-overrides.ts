/**
 * Per-pipeline stage-override resolver (design D2 of the
 * `ui-config-redesign-pipelines-page` change).
 *
 * Resolves the four `pipelines.<name>.*` config-key families for ONE pipeline
 * across the project/store/global layers into per-stage gate/model/handoff and
 * per-role runtime override maps, each value carrying the scope-qualified layer
 * that supplied it. This is the single place the per-stage top layer is
 * computed; BOTH `rasen pipeline show` (CLI) and `GET /api/v1/pipelines` (HTTP)
 * consume it, so the CLI and the UI can never disagree on effective values.
 *
 * It does NOT reimplement layer precedence: it calls `resolveEffectiveConfig`
 * with `includeWildcards: true` (which already ranks project > store > global
 * with a scope-qualified `source`, reads the same layer objects, and takes the
 * store layer from `resolveConfigStoreLayer`) and buckets the resulting family
 * instances by axis. The gate mask composition (per-stage instance → effective
 * `autopilot.gates: off` → stage definition) is layered on top of these maps by
 * the caller — see `resolveMaskedStageGate`.
 */
import {
  resolveEffectiveConfig,
  type EffectiveConfigEntry,
  type ResolveEffectiveConfigOptions,
} from '../effective-config.js';
import type { ResolvedGatePolicy } from '../project-config.js';
import {
  resolveStageHandoffConfig,
  resolveStageRuntimeConfig,
  type HandoffConfigLayers,
  type ModelConfigLayers,
  type ModelSource,
  type PipelineYaml,
  type ResolvedStageHandoffConfig,
  type RuntimeSource,
  type Stage,
  type StageConfigOverrides,
  type StageOverride,
  type StageOverrideScope,
  type StageRole,
  type ThresholdValue,
} from './types.js';

export type { StageOverride, StageOverrideScope };

/**
 * The resolved override maps for one pipeline. `gates`/`models`/`handoff` are
 * keyed by stage id; `runtimes` is keyed by role. An absent key means "no
 * override at any scope" — distinct from any concrete value (the families carry
 * no default), which the mask and chains below need to fall through cleanly.
 */
export interface PipelineStageOverrides {
  gates: Map<string, StageOverride<'on' | 'off'>>;
  models: Map<string, StageOverride<string>>;
  handoff: Map<string, StageOverride<ThresholdValue>>;
  runtimes: Map<string, StageOverride<'claude' | 'codex'>>;
}

/** `EffectiveConfigEntry.source` narrowed to the three layers a family instance can resolve from. */
function toStageOverrideScope(source: EffectiveConfigEntry['source']): StageOverrideScope | null {
  return source === 'project' || source === 'store' || source === 'global' ? source : null;
}

/**
 * Buckets the pipeline family instances for `pipelineName` out of an already
 * resolved effective-config entry list (pure given the entries). Only entries
 * with an `instanceKey` of the exact shape `pipelines.<pipelineName>.<axis>.<leaf>`
 * and a concrete resolved value contribute; a template entry (no `instanceKey`)
 * or an instance for another pipeline is ignored.
 */
export function bucketPipelineStageOverrides(
  entries: EffectiveConfigEntry[],
  pipelineName: string
): PipelineStageOverrides {
  const overrides: PipelineStageOverrides = {
    gates: new Map(),
    models: new Map(),
    handoff: new Map(),
    runtimes: new Map(),
  };

  for (const entry of entries) {
    const key = entry.instanceKey;
    if (key === undefined) continue;
    const segments = key.split('.');
    if (segments.length !== 4) continue;
    const [root, name, axis, leaf] = segments as [string, string, string, string];
    if (root !== 'pipelines' || name !== pipelineName) continue;

    const scope = toStageOverrideScope(entry.source);
    if (scope === null) continue;

    switch (axis) {
      case 'gates':
        if (entry.value === 'on' || entry.value === 'off') {
          overrides.gates.set(leaf, { value: entry.value, scope });
        }
        break;
      case 'models':
        if (typeof entry.value === 'string' && entry.value.length > 0) {
          overrides.models.set(leaf, { value: entry.value, scope });
        }
        break;
      case 'handoff':
        if (entry.value !== undefined) {
          overrides.handoff.set(leaf, { value: entry.value as ThresholdValue, scope });
        }
        break;
      case 'runtimes':
        if (entry.value === 'claude' || entry.value === 'codex') {
          overrides.runtimes.set(leaf, { value: entry.value, scope });
        }
        break;
      default:
        break;
    }
  }

  return overrides;
}

/**
 * Resolves the per-stage/per-role override maps for one pipeline against the
 * project/store/global config layers. `options` are the same
 * `resolveEffectiveConfig` options the config surfaces use (a project root with
 * its inherited store layer, or a store space's own root as the store layer);
 * `includeWildcards` is forced on so family instances surface.
 */
export function resolvePipelineStageOverrides(
  pipelineName: string,
  options: ResolveEffectiveConfigOptions = {}
): PipelineStageOverrides {
  const entries = resolveEffectiveConfig({ ...options, includeWildcards: true });
  return bucketPipelineStageOverrides(entries, pipelineName);
}

/**
 * The layer that decided a stage's effective gate after masking:
 *  - `stage-override-<scope>`: a `pipelines.<name>.gates.<stage>` instance won.
 *  - `autopilot-<baseSource>`: no instance, and an effective `autopilot.gates: off`
 *    at that base layer suppressed the ordinary gate.
 *  - `stage`: the stage definition's own `gate:` decided (base is `on`, or the
 *    stage carries the always-pausing `'vet'` gate, which is outside the mask).
 */
export type MaskedGateSource =
  | 'stage-override-project'
  | 'stage-override-store'
  | 'stage-override-global'
  | 'autopilot-flag'
  | 'autopilot-project'
  | 'autopilot-store'
  | 'autopilot-global'
  | 'stage';

/** A stage's gate after the mask: `true` pauses, `false` auto-approves, `'vet'` always pauses. */
export interface MaskedStageGate {
  effective: boolean | 'vet';
  source: MaskedGateSource;
}

/**
 * Composes the gate mask for one stage (design D2 / spec
 * `autopilot-gate-policy`). Precedence:
 *  1. A `pipelines.<name>.gates.<stage>` instance (project → store → global, as
 *     already resolved into `gateOverride`) decides outright: `on` pauses, `off`
 *     auto-approves.
 *  2. Otherwise, an effective `autopilot.gates: off` base suppresses the gate.
 *  3. Otherwise the stage definition's own `gate:` value decides.
 *
 * A stage whose definition declares the always-pausing `'vet'` gate is returned
 * as-is, entirely outside the mask (never overridable or suppressible) — the W5
 * boundary; no `'vet'` handling changes here.
 */
export function resolveMaskedStageGate(
  declaredGate: boolean | 'vet',
  gateOverride: StageOverride<'on' | 'off'> | undefined,
  basePolicy: ResolvedGatePolicy
): MaskedStageGate {
  // The vet carve-out sits outside the mask entirely (W5 boundary).
  if (declaredGate === 'vet') {
    return { effective: 'vet', source: 'stage' };
  }

  if (gateOverride !== undefined) {
    return {
      effective: gateOverride.value === 'on',
      source: `stage-override-${gateOverride.scope}` as MaskedGateSource,
    };
  }

  if (basePolicy.effective === 'off') {
    return { effective: false, source: `autopilot-${basePolicy.source}` as MaskedGateSource };
  }

  // Base is `on` (or defaulted on): the stage definition decides.
  return { effective: declaredGate, source: 'stage' };
}

/** The effective per-stage configuration a pipeline inspection surface reports. */
export interface EffectiveStageConfig {
  id: string;
  role: StageRole | null;
  skill: string | null;
  /** The stage's declared gate value, unmasked. */
  declaredGate: boolean | 'vet';
  gate: MaskedStageGate;
  model: { value: string | null; source: ModelSource };
  handoff: { threshold: ThresholdValue; source: ResolvedStageHandoffConfig['source'] };
  runtime: { value: 'claude' | 'codex'; source: RuntimeSource };
}

/** The per-root resolution inputs a pipeline's effective per-stage values are computed against. */
export interface EffectiveStageInputs {
  overrides: PipelineStageOverrides;
  basePolicy: ResolvedGatePolicy;
  configLayers?: HandoffConfigLayers;
  modelLayers?: ModelConfigLayers;
}

/** The `StageConfigOverrides` for one stage: model/handoff by stage id, runtime by role. */
export function stageConfigOverridesFor(
  stage: Stage,
  overrides: PipelineStageOverrides
): StageConfigOverrides {
  return {
    model: overrides.models.get(stage.id),
    handoff: overrides.handoff.get(stage.id),
    runtime: stage.role ? overrides.runtimes.get(stage.role) : undefined,
  };
}

/**
 * Computes one stage's effective gate/model/handoff/runtime with sources, using
 * the shared stage resolvers (no resolution reimplemented). This is the single
 * per-stage computation both `rasen pipeline show` and `GET /api/v1/pipelines`
 * report through, so the CLI and the UI can never disagree.
 */
export function resolveEffectiveStage(
  stage: Stage,
  pipeline: PipelineYaml,
  inputs: EffectiveStageInputs
): EffectiveStageConfig {
  const stageOverrides = stageConfigOverridesFor(stage, inputs.overrides);
  const runtime = resolveStageRuntimeConfig(stage, pipeline, inputs.modelLayers, stageOverrides);
  const handoff = resolveStageHandoffConfig(
    stage,
    pipeline,
    inputs.configLayers,
    inputs.modelLayers,
    stageOverrides
  );
  const gate = resolveMaskedStageGate(
    stage.gate,
    inputs.overrides.gates.get(stage.id),
    inputs.basePolicy
  );
  return {
    id: stage.id,
    role: stage.role ?? null,
    skill: stage.skill ?? null,
    declaredGate: stage.gate,
    gate,
    model: { value: runtime.model ?? null, source: runtime.modelSource },
    handoff: { threshold: handoff.threshold, source: handoff.source },
    runtime: { value: runtime.runtime, source: runtime.runtimeSource },
  };
}
