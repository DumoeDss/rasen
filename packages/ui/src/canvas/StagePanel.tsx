import { useState } from 'preact/hooks';
import type { PipelineCatalogResponse, WirePipelineDefinitionStage } from '../api/types.js';
import { KNOWN_MODEL_IDS } from '../config/controls.js';

/**
 * The selection-driven properties panel (pipeline-canvas-edit design D3):
 * edits id (rename), role, skill, gate, condition, verify policy, model,
 * runtime, parallel group, and the review-cycle loop's kind + max rounds.
 * Every closed vocabulary comes from the catalog response, never a literal
 * retyped in UI code. A stage carrying a `loop.kind: 'goal'` config renders it
 * read-only with a "preserved as-is" note — goal-loop gate authoring is out of
 * scope (design non-goal); only its presence and kind are visible here.
 */
export function StagePanel({
  stage,
  catalog,
  existingGroups,
  fieldIssues,
  onRename,
  onPatch,
  onClose,
}: {
  stage: WirePipelineDefinitionStage;
  catalog: PipelineCatalogResponse | null;
  /** Existing `parallelGroup` values in the draft, offered as datalist suggestions. */
  existingGroups: string[];
  /** Field name -> severity, for the currently-open stage's validation issues (design D5). */
  fieldIssues?: Record<string, 'error' | 'warning'>;
  onRename: (newId: string) => void;
  onPatch: (patch: Partial<WirePipelineDefinitionStage>) => void;
  onClose: () => void;
}) {
  const [idDraft, setIdDraft] = useState(stage.id);

  function commitRename() {
    const trimmed = idDraft.trim();
    if (trimmed && trimmed !== stage.id) onRename(trimmed);
    else setIdDraft(stage.id);
  }

  /** The field-highlight class modifier for a stage-panel field named by its `path` tail segment. */
  function fieldClass(field: string): string {
    const severity = fieldIssues?.[field];
    return severity ? ` stage-panel__field--issue-${severity}` : '';
  }

  const loopKind = stage.loop?.kind ?? 'none';
  const isGoalLoop = stage.loop?.kind === 'goal';

  return (
    <aside class="stage-panel" data-testid="stage-panel" data-stage={stage.id}>
      <div class="stage-panel__header">
        <h3 class="stage-panel__title">Stage</h3>
        <button type="button" class="stage-panel__close" data-testid="stage-panel-close" onClick={onClose}>
          ✕
        </button>
      </div>

      <label class={`stage-panel__field${fieldClass('id')}`}>
        <span>Id</span>
        <input
          type="text"
          data-testid="stage-panel-id"
          value={idDraft}
          onInput={(e) => setIdDraft((e.target as HTMLInputElement).value)}
          onBlur={commitRename}
        />
      </label>

      <label class={`stage-panel__field${fieldClass('role')}`}>
        <span>Role</span>
        <select
          data-testid="stage-panel-role"
          value={stage.role ?? ''}
          onChange={(e) => {
            const v = (e.target as HTMLSelectElement).value;
            onPatch({ role: v ? (v as WirePipelineDefinitionStage['role']) : undefined });
          }}
        >
          <option value="">(none)</option>
          {(catalog?.roles ?? []).map((role) => (
            <option key={role} value={role}>
              {role}
            </option>
          ))}
        </select>
      </label>

      <label class={`stage-panel__field${fieldClass('skill')}`}>
        <span>Skill</span>
        <select
          data-testid="stage-panel-skill"
          value={stage.skill ?? ''}
          onChange={(e) => {
            const v = (e.target as HTMLSelectElement).value;
            onPatch({ skill: v || undefined });
          }}
        >
          <option value="">(none)</option>
          {(catalog?.skills ?? [])
            .filter((s) => s.enabled || s.id === stage.skill)
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.id}
              </option>
            ))}
        </select>
      </label>

      <label class={`stage-panel__field stage-panel__field--checkbox${fieldClass('gate')}`}>
        <input
          type="checkbox"
          data-testid="stage-panel-gate"
          checked={stage.gate}
          onChange={(e) => onPatch({ gate: (e.target as HTMLInputElement).checked })}
        />
        <span>Gate (pauses for approval)</span>
      </label>

      <label class={`stage-panel__field${fieldClass('condition')}`}>
        <span>Condition</span>
        <input
          type="text"
          list="stage-panel-condition-labels"
          data-testid="stage-panel-condition"
          value={stage.condition ?? ''}
          onInput={(e) => onPatch({ condition: (e.target as HTMLInputElement).value || undefined })}
        />
        <datalist id="stage-panel-condition-labels">
          {(catalog?.conditionLabels ?? []).map((label) => (
            <option key={label} value={label} />
          ))}
        </datalist>
      </label>

      <label class={`stage-panel__field${fieldClass('verifyPolicy')}`}>
        <span>Verify policy</span>
        <select
          data-testid="stage-panel-verify-policy"
          value={stage.verifyPolicy ?? ''}
          onChange={(e) => {
            const v = (e.target as HTMLSelectElement).value;
            onPatch({ verifyPolicy: v ? (v as WirePipelineDefinitionStage['verifyPolicy']) : undefined });
          }}
        >
          <option value="">(inherit)</option>
          {(catalog?.verifyPolicies ?? []).map((policy) => (
            <option key={policy} value={policy}>
              {policy}
            </option>
          ))}
        </select>
      </label>

      <label class={`stage-panel__field${fieldClass('model')}`}>
        <span>Model</span>
        <input
          type="text"
          list="stage-panel-model-suggestions"
          data-testid="stage-panel-model"
          value={stage.model ?? ''}
          onInput={(e) => onPatch({ model: (e.target as HTMLInputElement).value || undefined })}
        />
        <datalist id="stage-panel-model-suggestions">
          {KNOWN_MODEL_IDS.map((id) => (
            <option key={id} value={id} />
          ))}
        </datalist>
      </label>

      <label class={`stage-panel__field${fieldClass('runtime')}`}>
        <span>Runtime</span>
        <select
          data-testid="stage-panel-runtime"
          value={stage.runtime ?? ''}
          onChange={(e) => {
            const v = (e.target as HTMLSelectElement).value;
            onPatch({ runtime: v ? (v as WirePipelineDefinitionStage['runtime']) : undefined });
          }}
        >
          <option value="">(inherit)</option>
          {(catalog?.runtimes ?? []).map((runtime) => (
            <option key={runtime} value={runtime}>
              {runtime}
            </option>
          ))}
        </select>
      </label>

      <label class={`stage-panel__field${fieldClass('parallelGroup')}`}>
        <span>Parallel group</span>
        <input
          type="text"
          list="stage-panel-group-suggestions"
          data-testid="stage-panel-parallel-group"
          value={stage.parallelGroup ?? ''}
          onInput={(e) => onPatch({ parallelGroup: (e.target as HTMLInputElement).value || undefined })}
        />
        <datalist id="stage-panel-group-suggestions">
          {existingGroups.map((group) => (
            <option key={group} value={group} />
          ))}
        </datalist>
      </label>

      {isGoalLoop ? (
        <div class="stage-panel__field" data-testid="stage-panel-goal-loop-readonly">
          <span>Loop (goal-driven — preserved as-is)</span>
          <pre class="stage-panel__json">{JSON.stringify(stage.loop, null, 2)}</pre>
        </div>
      ) : (
        <>
          <label class="stage-panel__field">
            <span>Loop</span>
            <select
              data-testid="stage-panel-loop-kind"
              value={loopKind}
              onChange={(e) => {
                const v = (e.target as HTMLSelectElement).value;
                if (v === 'none') onPatch({ loop: undefined });
                else onPatch({ loop: { kind: 'review-cycle', maxRounds: stage.loop?.kind === 'review-cycle' ? stage.loop.maxRounds : 3 } });
              }}
            >
              {(catalog?.loopKinds ?? ['none', 'review-cycle'])
                .filter((kind) => kind !== 'goal')
                .map((kind) => (
                  <option key={kind} value={kind}>
                    {kind}
                  </option>
                ))}
            </select>
          </label>
          {stage.loop?.kind === 'review-cycle' && (
            <label class="stage-panel__field">
              <span>Max rounds</span>
              <input
                type="number"
                min="1"
                step="1"
                data-testid="stage-panel-loop-max-rounds"
                value={stage.loop.maxRounds}
                onInput={(e) => {
                  const raw = Number((e.target as HTMLInputElement).value);
                  if (Number.isInteger(raw) && raw > 0) {
                    onPatch({ loop: { kind: 'review-cycle', maxRounds: raw } });
                  }
                }}
              />
            </label>
          )}
        </>
      )}
    </aside>
  );
}
