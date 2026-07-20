import { useEffect, useState } from 'preact/hooks';
import * as client from '../api/client.js';
import { ApiError } from '../api/client.js';
import type { WirePipeline } from '../api/types.js';

/**
 * Read-only gates inventory rendered inside the Autopilot group (design.md
 * D6): lists each pipeline's gated stages, fed by `GET /api/v1/pipelines`,
 * and marks every `gate: 'vet'` stage as always-pausing — distinctly from an
 * ordinary `gate: true` stage. Never writes configuration; offers no
 * gate-editing control.
 */
export function GatesInventoryPanel() {
  const [pipelines, setPipelines] = useState<WirePipeline[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    client
      .listPipelines()
      .then((res) => {
        if (cancelled) return;
        setPipelines(res.pipelines);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : 'Failed to load the gates inventory');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return <p class="gates-inventory__error">{error}</p>;
  }
  if (!pipelines) {
    return <p class="gates-inventory__loading">Loading gates inventory…</p>;
  }

  return (
    <div class="gates-inventory">
      <h3>Gates inventory</h3>
      <p class="gates-inventory__hint">Read-only — gates are edited via pipeline definitions, not here.</p>
      {pipelines.map((pipeline) => {
        const gatedStages = pipeline.stages.filter((s) => s.gate !== false);
        if (gatedStages.length === 0) return null;
        return (
          <div key={pipeline.name} class="gates-inventory__pipeline" data-pipeline={pipeline.name}>
            <h4>{pipeline.name}</h4>
            <ul>
              {gatedStages.map((stage) => (
                <li
                  key={stage.id}
                  class={`gates-inventory__stage gates-inventory__stage--${stage.gate === 'vet' ? 'vet' : 'gate'}`}
                  data-stage={stage.id}
                  data-gate={String(stage.gate)}
                >
                  <span class="gates-inventory__stage-id">{stage.id}</span>
                  {stage.role ? <span class="gates-inventory__stage-role"> ({stage.role})</span> : null}
                  {stage.gate === 'vet' ? (
                    <span class="gates-inventory__badge gates-inventory__badge--vet">
                      Always pauses — cannot be disabled by gates-off
                    </span>
                  ) : (
                    <span class="gates-inventory__badge gates-inventory__badge--gate">Gate</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
