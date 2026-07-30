import type { ReconcilerSupportReason, WirePipeline } from '../api/types.js';

/**
 * Engine support panel (task 14.7/14.8 of `ecp-run-spine`). Renders the
 * shared support analysis (`availableEngines`/`reconcilerSupport`/`profileDigest`/
 * `reason`) from the SAME prepared analyzer that `pipeline show`, `pipeline
 * start`, and the management detail endpoint use. The UI renders server truth
 * — it never guesses engine support from the pipeline name.
 *
 * `executionMode`/`unavailableReason` (the LEGACY_NORMALIZED compatibility
 * fields) are kept as SEPARATE compatibility information, displayed in their
 * own section, never conflated with the reconciler support analysis.
 *
 * When the reconciler engine is not supported, any start affordance is
 * disabled. This panel surfaces the reason verbatim from the server.
 */

/**
 * Human-readable label for a reconciler-support reason code.
 *
 * ECP-5 (task 6.1): the record is keyed by `ReconcilerSupportReason`, so a
 * reason added to the server union and mirrored here without copy is a TYPE
 * ERROR rather than a raw code leaking into the panel. The two entries this
 * used to carry for reasons the analyzer never emits
 * (`unsupported_capability`, `unsupported_verify_policy`) are gone with the
 * mirror drift they belonged to; the `default` arm stays as the forward-compat
 * escape for a newer server.
 */
const REASON_LABELS: Record<ReconcilerSupportReason, string> = {
  supported_root_dag_bug_fix: 'Supported: root-DAG bug-fix',
  supported_v2_review_cycle: 'Supported: v2 ReviewCycle',
  supported_v2_executable: 'Supported: v2 executable',
  supported_v2_parallel: 'Supported: v2 parallel (FanOut/Join)',
  unsupported_definition_version: 'Unsupported: definition version',
  unsupported_pipeline_shape: 'Unsupported: pipeline shape',
  unsupported_pipeline_semantics: 'Unsupported: pipeline semantics',
  execution_profile_unavailable: 'Unavailable: execution profile',
};

function reasonLabel(reason: string): string {
  return REASON_LABELS[reason as ReconcilerSupportReason] ?? reason;
}

/**
 * Renders the additive engine support analysis for one pipeline. Placed in the
 * PipelineCanvasPage header (view mode), right after the provenance badge.
 * Renders nothing when the server did not include the additive fields
 * (pre-reconciler servers).
 */
export function EngineSupportPanel({ pipeline }: { pipeline: WirePipeline }) {
  const availableEngines = pipeline.availableEngines;
  const reconcilerSupport = pipeline.reconcilerSupport;

  // Pre-reconciler servers do not include these fields — the panel is absent,
  // not empty-looking.
  if (!availableEngines && !reconcilerSupport) return null;

  const reconcilerSupported = reconcilerSupport?.supported ?? false;
  const legacyNormalizedMode = pipeline.executionMode ?? null;

  return (
    <div
      class={`engine-support${reconcilerSupported ? ' engine-support--supported' : ' engine-support--unsupported'}`}
      data-testid="engine-support-panel"
    >
      {/* Available engines — from the shared analyzer, not name guessing. */}
      {availableEngines && availableEngines.length > 0 && (
        <div class="engine-support__engines" data-testid="engine-support-engines">
          <span class="engine-support__label">Engines:</span>
          {availableEngines.map((engine) => (
            <span
              key={engine}
              class={`engine-support__engine engine-support__engine--${engine}`}
              data-testid="engine-support-engine"
              data-engine={engine}
            >
              {engine}
            </span>
          ))}
        </div>
      )}

      {/* Reconciler support verdict — the server's authoritative projection. */}
      {reconcilerSupport && (
        <div class="engine-support__reconciler" data-testid="engine-support-reconciler">
          <span
            class={`engine-support__verdict engine-support__verdict--${reconcilerSupported ? 'yes' : 'no'}`}
            data-testid="engine-support-verdict"
            data-supported={reconcilerSupported ? 'true' : 'false'}
          >
            {reconcilerSupported ? 'Reconciler: supported' : 'Reconciler: unsupported'}
          </span>
          <span class="engine-support__reason" data-testid="engine-support-reason">
            {reasonLabel(reconcilerSupport.reason)}
          </span>
          {reconcilerSupport.profileDigest && (
            <code
              class="engine-support__digest"
              data-testid="engine-support-digest"
              title={reconcilerSupport.profileDigest}
            >
              {reconcilerSupport.profileDigest.slice(0, 16)}…
            </code>
          )}
        </div>
      )}

      {/* LEGACY_NORMALIZED compatibility info — SEPARATE from reconciler support.
          This is the legacy executionMode field, kept for backward compat. */}
      {legacyNormalizedMode && (
        <div class="engine-support__legacy" data-testid="engine-support-legacy">
          <span class="engine-support__label">Legacy mode:</span>
          <span class={`engine-support__legacy-mode engine-support__legacy-mode--${legacyNormalizedMode}`}>
            {legacyNormalizedMode}
          </span>
          {pipeline.unavailableReason && (
            <span class="engine-support__legacy-reason" data-testid="engine-support-legacy-reason">
              {pipeline.unavailableReason}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
