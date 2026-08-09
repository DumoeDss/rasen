/**
 * Session-policy-and-control-parity: the configurable, provenance-bearing
 * source for the frozen-action executor's reuse/handoff/touch/retire policy
 * block (slice acceptance 5; design D4).
 *
 * The shipped executor resolver (`resolveReusePolicy`) accepts an
 * `ExecutorPolicyBlock` parameter and defines the `authored | definition |
 * default` provenance vocabulary, but in its own documented words "there is no
 * authoring surface for the numeric limits yet, so a recorded placeholder is
 * never enforced as authored" (`reuse-policy.ts:50-56`). It therefore stamps
 * the numeric limits `default` unconditionally. This module IS that authoring
 * surface: it resolves an operator/author `sessionPolicy` configuration key
 * through the existing configuration chain (project > store > global > the
 * shipped `DEFAULT_EXECUTOR_POLICY_BLOCK` default) and produces:
 *
 *  - the `ExecutorPolicyBlock` that feeds the executor resolver (so the
 *    configured VALUE reaches the resolver unchanged), and
 *  - the authoritative per-field provenance (`authored` for a configured
 *    project/store/global value; `default` for an unset one), carried on a
 *    `ResolvedReusePolicy` built from the executor resolver with its
 *    conservative `default` numeric-limit stamp corrected to the source's
 *    authoritative provenance.
 *
 * The executor resolver's SIGNATURE and its `decideReuse` safety decisions
 * (never / cross-authority / over-limit) are byte-identical — this module
 * consumes `resolveReusePolicy` and `decideReuse`, it does not modify them. A
 * configured limit can never disable a safety property: configured limits are
 * validated (positive bounded integers) and the over-limit / cross-authority
 * decisions stay unchanged regardless of the configured value (task 4.3).
 *
 * `definition` provenance is the vocabulary slot for a value derived from the
 * frozen Action's node nature (e.g. a future role-based limit). This change's
 * operator-config surface produces `authored` (configured) and `default`
 * (unset); `definition` is reserved for that future derivation and is part of
 * the vocabulary the provenance guard asserts.
 */
import {
  DEFAULT_EXECUTOR_POLICY_BLOCK,
  resolveReusePolicy,
  type AuthoredSessionGuidance,
  type ExecutorPolicyBlock,
  type PolicyProvenance,
  type ResolvedReusePolicy,
} from '../frozen-action-executor/reuse-policy.js';
import { getGlobalConfig } from '../global-config.js';
import { readProjectConfig } from '../project-config.js';

/**
 * The per-layer operator/author session-policy config (mirrors the
 * `sessionPolicy` zod block on `ProjectConfigSchema` and the optional
 * `sessionPolicy` field on `GlobalConfig`).
 */
export interface SessionPolicyConfig {
  readonly handoffTokenLimit?: number;
  readonly reuseRoundLimit?: number;
  readonly touchMaxIdleMs?: number;
  readonly retireReasonLabel?: string;
}

/**
 * The three configuration layers, in precedence order. A field is resolved by
 * the first layer (project, then store, then global) that defines it; a field
 * no layer defines falls through to the shipped default at `default`
 * provenance.
 */
export interface SessionPolicyConfigLayers {
  readonly project?: SessionPolicyConfig;
  readonly store?: SessionPolicyConfig;
  readonly global?: SessionPolicyConfig;
}

/** Which configuration layer supplied a resolved value. */
export type PolicyLayerSource = 'project' | 'store' | 'global' | 'default';

/**
 * A resolved policy field: its value, its provenance (`authored` when a layer
 * configured it, `definition` when derived from node nature, `default` when
 * unset), and the layer that supplied it (`default` when no layer did).
 */
export interface ResolvedPolicyField<T> {
  readonly value: T;
  readonly provenance: PolicyProvenance;
  readonly layer: PolicyLayerSource;
}

/**
 * The authoritative, provenance-bearing resolution. `block` feeds the executor
 * resolver; `fields` carries the true per-field provenance; `resolvedReusePolicy`
 * is the authoritative reuse policy the face-invariance harness and `decideReuse`
 * consume (built from the executor resolver with the numeric-limit provenance
 * corrected to the source's authoritative per-field provenance).
 */
export interface ResolvedSessionPolicySource {
  readonly block: ExecutorPolicyBlock;
  readonly fields: {
    readonly handoffTokenLimit: ResolvedPolicyField<number>;
    readonly reuseRoundLimit: ResolvedPolicyField<number>;
    readonly touchMaxIdleMs: ResolvedPolicyField<number>;
    readonly retireReasonLabel: ResolvedPolicyField<string>;
  };
  readonly resolvedReusePolicy: ResolvedReusePolicy;
}

/**
 * The config-layer resolution alone (no frozen-Action guidance): the
 * `ExecutorPolicyBlock` the executor resolver consumes plus the authoritative
 * per-field provenance. This is the operator-config surface that closes the
 * executor's "no authoring surface for the numeric limits yet" gap; it does not
 * need the frozen Action's authored guidance.
 */
export type SessionPolicyBlockResolution = Pick<
  ResolvedSessionPolicySource,
  'block' | 'fields'
>;

/**
 * The authoritative validation bounds. Configured numeric limits MUST be
 * positive bounded integers; a non-integer could permit an off-by-one silent
 * past-limit reuse (`handoffTokensUsed >= 1.5` admits one extra reuse), and an
 * unbounded value would effectively disable the over-limit protection. These
 * are the single source of truth the parser's resilient check and this
 * resolver's authoritative validation both honour (the parser drops the
 * clearly-malformed; this resolver rejects the selected value that escapes).
 */
export const SESSION_POLICY_LIMIT_BOUNDS = Object.freeze({
  handoffTokenLimit: { min: 1, max: 1_000_000 },
  reuseRoundLimit: { min: 1, max: 1_000_000 },
  touchMaxIdleMs: { min: 1, max: 24 * 60 * 60 * 1000 },
  retireReasonLabel: { min: 1, max: 200 },
});

/** The error raised when a configured policy value is invalid or safety-disabling. */
export class SessionPolicyConfigError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'invalid_handoff_token_limit'
      | 'invalid_reuse_round_limit'
      | 'invalid_touch_max_idle_ms'
      | 'invalid_retire_reason_label',
    readonly field: keyof SessionPolicyConfig
  ) {
    super(message);
    this.name = 'SessionPolicyConfigError';
  }
}

function validateLimit(
  field: 'handoffTokenLimit' | 'reuseRoundLimit' | 'touchMaxIdleMs',
  raw: number
): void {
  const bounds = SESSION_POLICY_LIMIT_BOUNDS[field];
  if (!Number.isInteger(raw) || raw < bounds.min || raw > bounds.max) {
    throw new SessionPolicyConfigError(
      `sessionPolicy.${field} must be a positive bounded integer in [${bounds.min}, ${bounds.max}] (got ${JSON.stringify(raw)}); a non-integer or out-of-bound value could permit a silent past-limit reuse or disable the over-limit protection.`,
      field === 'handoffTokenLimit'
        ? 'invalid_handoff_token_limit'
        : field === 'reuseRoundLimit'
          ? 'invalid_reuse_round_limit'
          : 'invalid_touch_max_idle_ms',
      field
    );
  }
}

function validateRetireReasonLabel(raw: string): void {
  const bounds = SESSION_POLICY_LIMIT_BOUNDS.retireReasonLabel;
  if (typeof raw !== 'string' || raw.length < bounds.min || raw.length > bounds.max) {
    throw new SessionPolicyConfigError(
      `sessionPolicy.retireReasonLabel must be a string of length [${bounds.min}, ${bounds.max}] (got ${JSON.stringify(raw)}).`,
      'invalid_retire_reason_label',
      'retireReasonLabel'
    );
  }
}

/**
 * Resolve one numeric field across the layers (project > store > global >
 * default). A configured value carries `authored` provenance; the shipped
 * default carries `default` provenance. The selected configured value is
 * authoritatively validated (a layer may have escaped the resilient parser —
 * notably the raw global config which has no schema gate on read).
 */
function resolveLimitField(
  field: 'handoffTokenLimit' | 'reuseRoundLimit' | 'touchMaxIdleMs',
  layers: SessionPolicyConfigLayers,
  defaultValue: number
): ResolvedPolicyField<number> {
  for (const source of ['project', 'store', 'global'] as const) {
    const layerValue = layers[source]?.[field];
    if (layerValue !== undefined) {
      validateLimit(field, layerValue);
      return { value: layerValue, provenance: 'authored', layer: source };
    }
  }
  return { value: defaultValue, provenance: 'default', layer: 'default' };
}

function resolveRetireReasonLabel(
  layers: SessionPolicyConfigLayers,
  defaultValue: string
): ResolvedPolicyField<string> {
  for (const source of ['project', 'store', 'global'] as const) {
    const layerValue = layers[source]?.retireReasonLabel;
    if (layerValue !== undefined) {
      validateRetireReasonLabel(layerValue);
      return { value: layerValue, provenance: 'authored', layer: source };
    }
  }
  return { value: defaultValue, provenance: 'default', layer: 'default' };
}

/**
 * Resolve the config-layer policy block (the operator/author surface) from the
 * configured layers. Pure: deterministic, no I/O, no credentials, no specific
 * OS. This is the authoritative source that closes the executor's "no authoring
 * surface for the numeric limits yet" gap: it walks project > store > global >
 * the shipped `DEFAULT_EXECUTOR_POLICY_BLOCK` default, stamps each field's
 * provenance (`authored` when a layer configured it, `default` when unset), and
 * authoritatively validates the selected value.
 *
 * @throws {SessionPolicyConfigError} when a selected configured value is not a
 *   positive bounded integer (a non-integer/out-of-bound limit could permit a
 *   silent past-limit reuse or disable the over-limit protection).
 */
export function resolveSessionPolicyBlock(
  layers: SessionPolicyConfigLayers
): SessionPolicyBlockResolution {
  const handoffTokenLimit = resolveLimitField(
    'handoffTokenLimit',
    layers,
    DEFAULT_EXECUTOR_POLICY_BLOCK.defaultHandoffTokenLimit
  );
  const reuseRoundLimit = resolveLimitField(
    'reuseRoundLimit',
    layers,
    DEFAULT_EXECUTOR_POLICY_BLOCK.defaultReuseRoundLimit
  );
  const touchMaxIdleMs = resolveLimitField(
    'touchMaxIdleMs',
    layers,
    DEFAULT_EXECUTOR_POLICY_BLOCK.touchMaxIdleMs
  );
  const retireReasonLabel = resolveRetireReasonLabel(
    layers,
    DEFAULT_EXECUTOR_POLICY_BLOCK.retireReasonLabel
  );

  const block: ExecutorPolicyBlock = Object.freeze({
    defaultHandoffTokenLimit: handoffTokenLimit.value,
    defaultReuseRoundLimit: reuseRoundLimit.value,
    touchMaxIdleMs: touchMaxIdleMs.value,
    retireReasonLabel: retireReasonLabel.value,
  });

  return Object.freeze({
    block,
    fields: Object.freeze({
      handoffTokenLimit,
      reuseRoundLimit,
      touchMaxIdleMs,
      retireReasonLabel,
    }),
  });
}

/**
 * Resolve the authoritative, provenance-bearing session-policy source from the
 * configured layers and the frozen Action's authored session guidance. Pure:
 * deterministic, no I/O, no credentials, no specific OS — the 0.2.0 gate.
 *
 * The produced `block` feeds the executor's `resolveReusePolicy` (signature
 * unchanged); the produced `resolvedReusePolicy` carries the authoritative
 * per-field provenance (the executor resolver's conservative `default` numeric
 * stamp is corrected here, since this source is the authority that knows
 * whether a value was configured). The `sessionReuse` scope provenance comes
 * straight from the executor resolver (it is correct: `authored` when the
 * frozen Action preserved its scope, `default` otherwise). The frozen Action's
 * authored guidance is required because the executor resolver reads the
 * authored `sessionReuse` scope from it (this source does not synthesize one).
 *
 * @throws {SessionPolicyConfigError} when a selected configured value is not a
 *   positive bounded integer (a non-integer/out-of-bound limit could permit a
 *   silent past-limit reuse or disable the over-limit protection).
 */
export function resolveSessionPolicySource(
  layers: SessionPolicyConfigLayers,
  authored: AuthoredSessionGuidance
): ResolvedSessionPolicySource {
  const blockResolution = resolveSessionPolicyBlock(layers);
  const { block, fields } = blockResolution;

  // Build the authoritative resolved reuse policy from the executor resolver,
  // then correct the numeric-limit provenance to the source's authoritative
  // per-field provenance. The executor resolver stamps the numeric limits
  // `default` (the documented "no authoring surface yet" gap); this source IS
  // that surface, so it is the authority on whether a value was configured.
  // The values, the sessionReuse scope provenance, and the retireReasonLabel
  // come straight from the executor resolver unchanged.
  const base = resolveReusePolicy({ authored, policyBlock: block });
  const resolvedReusePolicy: ResolvedReusePolicy = Object.freeze({
    ...base,
    handoffTokenLimit: {
      value: base.handoffTokenLimit.value,
      provenance: fields.handoffTokenLimit.provenance,
    },
    reuseRoundLimit: {
      value: base.reuseRoundLimit.value,
      provenance: fields.reuseRoundLimit.provenance,
    },
    touchMaxIdleMs: {
      value: base.touchMaxIdleMs.value,
      provenance: fields.touchMaxIdleMs.provenance,
    },
  });

  return Object.freeze({
    block,
    fields,
    resolvedReusePolicy,
  });
}

/**
 * Read the three session-policy config layers from the existing configuration
 * chain. The project and store layers come from `readProjectConfig` (resilient
 * parsing already drops a malformed `sessionPolicy` leaf with a warning); the
 * global layer comes from `getGlobalConfig` (raw JSON, no schema gate on read,
 * so the resolver re-validates). A layer with no `sessionPolicy` block
 * contributes nothing and the field falls through to the next layer. This is
 * the thin I/O adapter over the pure {@link resolveSessionPolicySource}.
 */
export function readSessionPolicyLayers(input: Readonly<{
  projectRoot?: string | null;
  storeRoot?: string | null;
}>): SessionPolicyConfigLayers {
  const projectConfig = input.projectRoot ? readProjectConfig(input.projectRoot) : null;
  const storeConfig = input.storeRoot ? readProjectConfig(input.storeRoot) : null;
  const globalConfig = getGlobalConfig();
  const layers: SessionPolicyConfigLayers = {};
  if (projectConfig?.sessionPolicy) {
    layers.project = projectConfig.sessionPolicy;
  }
  if (storeConfig?.sessionPolicy) {
    layers.store = storeConfig.sessionPolicy;
  }
  if (globalConfig.sessionPolicy) {
    layers.global = globalConfig.sessionPolicy;
  }
  return layers;
}
