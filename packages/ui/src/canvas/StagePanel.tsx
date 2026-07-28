import { useEffect, useState } from 'preact/hooks';
import type {
  PipelineCatalogResponse,
  ThresholdValue,
  WirePipelineDefinitionStage,
} from '../api/types.js';
import { KNOWN_MODEL_IDS, validateThresholdValue } from '../config/controls.js';
import { useT } from '../i18n/store.js';

function thresholdInputValue(threshold: ThresholdValue | undefined): string {
  if (threshold === undefined) return '';
  return String(
    typeof threshold === 'number' ? threshold : threshold.remainingTokens
  );
}

function parseThresholdInput(
  raw: string,
  form: 'fraction' | 'remaining',
  fractionRange: [number, number] | undefined,
  remainingTokensGt: number | undefined
): ThresholdValue | null {
  if (raw.trim() === '') return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return null;

  const threshold: ThresholdValue =
    form === 'fraction' ? parsed : { remainingTokens: parsed };
  const range = fractionRange
    ? { gt: fractionRange[0], lte: fractionRange[1] }
    : undefined;
  return validateThresholdValue(threshold, range, remainingTokensGt) === null
    ? threshold
    : null;
}

/**
 * The selection-driven properties panel (pipeline-canvas-edit design D3):
 * edits id (rename), role, skill, gate, condition, verify policy, model,
 * runtime, optional dual-form handoff threshold, parallel group, and the
 * review-cycle loop's kind + max rounds.
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
  onHandoffThreshold,
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
  onHandoffThreshold: (threshold: ThresholdValue | undefined) => void;
  onClose: () => void;
}) {
  const t = useT();
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
  const handoffThreshold = stage.handoff?.threshold;
  const handoffForm =
    handoffThreshold === undefined
      ? 'inherit'
      : typeof handoffThreshold === 'number'
        ? 'fraction'
        : 'remaining';
  const fractionRange = catalog?.handoff.fractionRange;
  const remainingTokensGt = catalog?.handoff.remainingTokensGt;
  const [handoffValueDraft, setHandoffValueDraft] = useState(() =>
    thresholdInputValue(handoffThreshold)
  );
  const handoffThresholdKey =
    handoffThreshold === undefined
      ? 'inherit'
      : typeof handoffThreshold === 'number'
        ? `fraction:${handoffThreshold}`
        : `remaining:${handoffThreshold.remainingTokens}`;
  useEffect(() => {
    setHandoffValueDraft(thresholdInputValue(handoffThreshold));
  }, [handoffThresholdKey]);
  const fractionSeed = fractionRange
    ? 0.5 > fractionRange[0] && 0.5 <= fractionRange[1]
      ? 0.5
      : (fractionRange[0] + fractionRange[1]) / 2
    : 0.5;
  const remainingSeed = Math.max(
    50_000,
    Math.floor(remainingTokensGt ?? 0) + 1
  );
  const handoffIssueClass =
    fieldClass('handoff/threshold') || fieldClass('handoff');

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

      <fieldset
        class={`stage-panel__field stage-panel__handoff${handoffIssueClass}`}
        data-testid="stage-panel-handoff"
      >
        <legend>{t('pipelines.canvas.handoff.label')}</legend>
        <label>
          <span>{t('pipelines.canvas.handoff.form')}</span>
          <select
            data-testid="stage-panel-handoff-form"
            value={handoffForm}
            onChange={(event) => {
              const form = (event.target as HTMLSelectElement).value;
              if (form === 'inherit') {
                setHandoffValueDraft('');
                onHandoffThreshold(undefined);
              } else if (form === 'fraction') {
                setHandoffValueDraft(String(fractionSeed));
                onHandoffThreshold(fractionSeed);
              } else {
                setHandoffValueDraft(String(remainingSeed));
                onHandoffThreshold({ remainingTokens: remainingSeed });
              }
            }}
          >
            <option value="inherit">{t('pipelines.canvas.handoff.inherit')}</option>
            <option value="fraction">{t('pipelines.canvas.handoff.fraction')}</option>
            <option value="remaining">{t('pipelines.canvas.handoff.remaining_tokens')}</option>
          </select>
        </label>
        {handoffForm === 'fraction' && typeof handoffThreshold === 'number' && (
          <label>
            <span>{t('pipelines.canvas.handoff.value')}</span>
            <input
              type="number"
              step="any"
              min={fractionRange?.[0]}
              max={fractionRange?.[1]}
              data-testid="stage-panel-handoff-fraction"
              value={handoffValueDraft}
              onInput={(event) => {
                const raw = (event.target as HTMLInputElement).value;
                setHandoffValueDraft(raw);
                const threshold = parseThresholdInput(
                  raw,
                  'fraction',
                  fractionRange,
                  remainingTokensGt
                );
                if (threshold !== null) onHandoffThreshold(threshold);
              }}
              onBlur={() => {
                if (
                  parseThresholdInput(
                    handoffValueDraft,
                    'fraction',
                    fractionRange,
                    remainingTokensGt
                  ) === null
                ) {
                  setHandoffValueDraft(thresholdInputValue(handoffThreshold));
                }
              }}
            />
          </label>
        )}
        {handoffForm === 'remaining' && typeof handoffThreshold === 'object' && (
          <label>
            <span>{t('pipelines.canvas.handoff.value')}</span>
            <input
              type="number"
              step="1"
              min={remainingTokensGt === undefined ? undefined : remainingTokensGt + 1}
              data-testid="stage-panel-handoff-remaining"
              value={handoffValueDraft}
              onInput={(event) => {
                const raw = (event.target as HTMLInputElement).value;
                setHandoffValueDraft(raw);
                const threshold = parseThresholdInput(
                  raw,
                  'remaining',
                  fractionRange,
                  remainingTokensGt
                );
                if (threshold !== null) onHandoffThreshold(threshold);
              }}
              onBlur={() => {
                if (
                  parseThresholdInput(
                    handoffValueDraft,
                    'remaining',
                    fractionRange,
                    remainingTokensGt
                  ) === null
                ) {
                  setHandoffValueDraft(thresholdInputValue(handoffThreshold));
                }
              }}
            />
          </label>
        )}
        <small>
          {handoffForm === 'remaining'
            ? t('pipelines.canvas.handoff.remaining_hint', {
                minimum: (remainingTokensGt ?? 0) + 1,
              })
            : handoffForm === 'fraction' && fractionRange
              ? t('pipelines.canvas.handoff.fraction_hint', {
                  minimum: fractionRange[0],
                  maximum: fractionRange[1],
                })
              : t('pipelines.canvas.handoff.inherit_hint')}
        </small>
      </fieldset>

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
