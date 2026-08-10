import { useEffect, useState } from 'preact/hooks';
import type {
  PipelineCatalogResponse,
  WireAtomicStageNode,
  WireBoundedLoopLifecyclePolicyV1,
  WireBoundedLoopNode,
  WireCompositeDeclaration,
  WireCompositeRefNode,
  WireConsultationBinding,
  WireDefinitionNode,
  WireFanOutNode,
  WireGateNode,
  WireJoinNode,
  WirePipelineDefinition,
  WirePipelineDefinitionV2,
} from '../api/types.js';
import {
  getConsultationBindingForStage,
  isV2EditableNodeKind,
  type AtomicStageExecutionPatch,
  type BoundedLoopContractPatch,
  type ConsultationBindingPatch,
  type ParallelContractPatch,
  type ParallelMemberPatch,
} from './draft.js';
import {
  ConsultationBindingEditor,
} from './ConsultationBindingEditor.js';
import {
  IntegerContractField,
  type IntegerContractDraftError,
} from './IntegerContractField.js';
import { V2ExecutionEditor } from './V2ExecutionEditor.js';

function listValue(values: readonly string[]): string {
  return values.join(',');
}

/** Narrow an untyped wire-node field to a string list before rendering it. */
function stringList(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function parseList(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );
}

export function V2NodePanel({
  node,
  catalog,
  definition,
  fullDefinition,
  fieldIssues,
  draftErrors = {},
  focusedField = null,
  onRename,
  onPatch,
  onAtomicExecutionPatch,
  onGateDisposition,
  onBoundedLoopPatch,
  onParallelMembers,
  onParallelMemberPatch,
  onParallelContractPatch,
  onDeleteParallelPair,
  onConsultationAdd,
  onConsultationPatch,
  onConsultationRemove,
  onInvalidChange,
  onClose,
}: {
  node: WireDefinitionNode;
  catalog: PipelineCatalogResponse | null;
  definition?: WirePipelineDefinitionV2 | null;
  fullDefinition?: WirePipelineDefinition | null;
  fieldIssues: Record<string, 'error' | 'warning'>;
  draftErrors?: Readonly<Record<string, IntegerContractDraftError>>;
  focusedField?: string | null;
  onRename: (id: string) => void;
  onPatch: (patch: Partial<WireDefinitionNode>) => boolean | void;
  onAtomicExecutionPatch?: (patch: AtomicStageExecutionPatch) => void;
  onGateDisposition?: (
    decision: string,
    disposition: WireGateNode['dispositions'][string]
  ) => void;
  onBoundedLoopPatch?: (patch: BoundedLoopContractPatch) => void;
  onParallelMembers?: (fanOutId: string, memberIds: readonly string[]) => void;
  onParallelMemberPatch?: (
    fanOutId: string,
    memberId: string,
    patch: ParallelMemberPatch
  ) => void;
  onParallelContractPatch?: (fanOutId: string, patch: ParallelContractPatch) => void;
  onDeleteParallelPair?: (fanOutId: string) => void;
  onConsultationAdd?: (binding: WireConsultationBinding) => void;
  onConsultationPatch?: (
    sourceStage: string,
    patch: ConsultationBindingPatch
  ) => void;
  onConsultationRemove?: (sourceStage: string) => void;
  onInvalidChange?: (
    field: string,
    error: IntegerContractDraftError | null
  ) => void;
  onClose: () => void;
}) {
  const supported = isV2EditableNodeKind(node.kind);
  const [idDraft, setIdDraft] = useState(node.id);
  const authoritativeOutcomes =
    node.kind === 'Gate' || node.kind === 'Choice'
      ? listValue(node.outcomes)
      : '';
  const [outcomesDraft, setOutcomesDraft] = useState(authoritativeOutcomes);
  useEffect(() => {
    setIdDraft(node.id);
  }, [node.id]);
  useEffect(() => {
    setOutcomesDraft(authoritativeOutcomes);
  }, [node.id, authoritativeOutcomes]);
  const commitRename = () => {
    const next = idDraft.trim();
    if (next && next !== node.id) {
      onRename(next);
      // A rejected rename (for example, a duplicate id) leaves the node prop
      // unchanged; restore its authoritative value just like the prior
      // prop-controlled editor did. A successful rename remounts under its new
      // stable key and initializes from that new id.
      setIdDraft(node.id);
      return;
    }
    setIdDraft(node.id);
  };
  const commitOutcomes = () => {
    const outcomes = parseList(outcomesDraft);
    const accepted = onPatch({ outcomes });
    setOutcomesDraft(
      accepted === false ? authoritativeOutcomes : listValue(outcomes)
    );
  };
  const fieldClass = (field: string) => nestedFieldClass(fieldIssues, field);

  return (
    <aside
      class="stage-panel v2-node-panel"
      data-testid="v2-node-panel"
      data-node={node.id}
      data-kind={node.kind}
      data-focused-field={focusedField ?? ''}
    >
      <div class="stage-panel__header">
        <h3 class="stage-panel__title">{node.kind}</h3>
        <button
          type="button"
          class="stage-panel__close"
          aria-label="Close node properties"
          onClick={onClose}
        >
          ×
        </button>
      </div>

      {!supported ? (
        <>
          <p data-testid="v2-node-panel-unsupported">
            This known Definition kind is preserved exactly and is read-only in
            this editor slice.
          </p>
          {node.kind === 'FanOut' && <FanOutDetails node={node} />}
          {node.kind === 'Join' && <JoinDetails node={node} />}
          <pre class="stage-panel__json">{JSON.stringify(node, null, 2)}</pre>
        </>
      ) : (
        <>
          <label class={fieldClass('id')}>
            <span>Stable id</span>
            <input
              data-testid="v2-node-panel-id"
              value={idDraft}
              onInput={(event) =>
                setIdDraft((event.target as HTMLInputElement).value)
              }
              onBlur={commitRename}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  (event.currentTarget as HTMLInputElement).blur();
                }
              }}
            />
          </label>

          {node.kind === 'AtomicStage' && (
            <>
              <V2ExecutionEditor
                node={node as WireAtomicStageNode}
                catalog={catalog}
                fieldIssues={fieldIssues}
                capabilityTestId="v2-node-panel-capability"
                onCapabilityPatch={(capability) => onPatch({ capability })}
                onExecutionPatch={(patch) => onAtomicExecutionPatch?.(patch)}
              />
              {fullDefinition && (
                <ConsultationBindingEditor
                  stageId={node.id}
                  definition={fullDefinition}
                  catalog={catalog}
                  binding={getConsultationBindingForStage(fullDefinition, node.id)}
                  draftErrors={draftErrors}
                  resetKey={`${fullDefinition.name ?? ''}\0${node.id}`}
                  onInvalidChange={onInvalidChange}
                  onAddBinding={(binding) => onConsultationAdd?.(binding)}
                  onPatchBinding={(sourceStage, patch) =>
                    onConsultationPatch?.(sourceStage, patch)
                  }
                  onRemoveBinding={(sourceStage) =>
                    onConsultationRemove?.(sourceStage)
                  }
                />
              )}
            </>
          )}

          {(node.kind === 'Gate' || node.kind === 'Choice') && (
            <label class={fieldClass('outcomes')}>
              <span>Branch outcomes</span>
              <input
                data-testid="v2-node-panel-outcomes"
                value={outcomesDraft}
                onInput={(event) =>
                  setOutcomesDraft(
                    (event.target as HTMLInputElement).value
                  )
                }
                onBlur={commitOutcomes}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    (event.currentTarget as HTMLInputElement).blur();
                  }
                }}
              />
            </label>
          )}

          {node.kind === 'Gate' && (
            <GateDetails
              node={node as WireGateNode}
              definition={definition}
              fieldIssues={fieldIssues}
              onPatch={onPatch}
              onDisposition={onGateDisposition}
            />
          )}

          {node.kind === 'Finish' && (
            <label class={fieldClass('outcome')}>
              <span>Terminal outcome</span>
              <select
                data-testid="v2-node-panel-outcome"
                value={node.outcome}
                onChange={(event) =>
                  onPatch({
                    outcome: (event.target as HTMLSelectElement).value,
                  })
                }
              >
                {!definition?.outcomes.includes(node.outcome) && (
                  <option value={node.outcome}>{node.outcome} (invalid)</option>
                )}
                {(definition?.outcomes ?? [node.outcome]).map((outcome) => (
                  <option key={outcome} value={outcome}>{outcome}</option>
                ))}
              </select>
            </label>
          )}

          {node.kind === 'BoundedLoop' && (
            <BoundedLoopDetails
              node={node as WireBoundedLoopNode}
              definition={definition}
              catalog={catalog}
              fieldIssues={fieldIssues}
              draftErrors={draftErrors}
              errorScope={`root-node:${node.id}`}
              resetKey={`${definition?.name ?? ''}\0${node.id}`}
              onInvalidChange={onInvalidChange}
              onPatch={(patch) => onBoundedLoopPatch?.(patch)}
            />
          )}

          {node.kind === 'CompositeRef' && (
            <CompositeRefDetails
              node={node as WireCompositeRefNode}
              definition={definition}
              onPatch={onPatch}
            />
          )}

          {(node.kind === 'FanOut' || node.kind === 'Join') && definition && (
            <ParallelEditor
              node={node as WireFanOutNode | WireJoinNode}
              definition={definition}
              fieldIssues={fieldIssues}
              draftErrors={draftErrors}
              onInvalidChange={onInvalidChange}
              onMembers={onParallelMembers}
              onMemberPatch={onParallelMemberPatch}
              onContractPatch={onParallelContractPatch}
              onDeletePair={onDeleteParallelPair}
            />
          )}
        </>
      )}
    </aside>
  );
}

function GateDetails({
  node,
  definition,
  fieldIssues,
  onPatch,
  onDisposition,
}: {
  node: WireGateNode;
  definition?: WirePipelineDefinitionV2 | null;
  fieldIssues: Record<string, 'error' | 'warning'>;
  onPatch: (patch: Partial<WireDefinitionNode>) => boolean | void;
  onDisposition?: (
    decision: string,
    disposition: WireGateNode['dispositions'][string]
  ) => void;
}) {
  const targets = (definition?.root.nodes ?? []).filter(
    (candidate): candidate is WireAtomicStageNode => candidate.kind === 'AtomicStage'
  );
  return (
    <section class="stage-panel__section" data-testid="v2-gate-editor">
      <label class={`stage-panel__field${fieldIssues.target ? ` stage-panel__field--issue-${fieldIssues.target}` : ''}`}>
        <span>Target AtomicStage</span>
        <select
          data-testid="v2-gate-target"
          value={node.target}
          onChange={(event) => onPatch({ target: (event.target as HTMLSelectElement).value })}
        >
          {!targets.some((target) => target.id === node.target) && (
            <option value={node.target}>{node.target} (invalid)</option>
          )}
          {targets.map((target) => (
            <option key={target.id} value={target.id}>{target.id}</option>
          ))}
        </select>
      </label>
      {node.outcomes.map((decision) => (
        <label key={decision} class={nestedFieldClass(fieldIssues, `dispositions/${decision}`)}>
          <span>{decision} disposition</span>
          <select
            data-testid="v2-gate-disposition"
            data-decision={decision}
            value={node.dispositions[decision] ?? ''}
            onChange={(event) =>
              onDisposition?.(
                decision,
                (event.target as HTMLSelectElement).value as
                  | 'proceed'
                  | 'fail'
                  | 'escalate'
              )
            }
          >
            {!node.dispositions[decision] && <option value="">Missing</option>}
            <option value="proceed">proceed</option>
            <option value="fail">fail</option>
            <option value="escalate">escalate</option>
          </select>
        </label>
      ))}
      <p class="stage-panel__muted">
        Gate owns the authored decision policy; AtomicStage execution has no gate field.
      </p>
    </section>
  );
}

function nestedFieldClass(
  fieldIssues: Record<string, 'error' | 'warning'>,
  field: string
): string {
  const severity = Object.entries(fieldIssues).find(
    ([candidate]) => candidate === field || candidate.startsWith(`${field}/`)
  )?.[1];
  return `stage-panel__field${
    severity ? ` stage-panel__field--issue-${severity}` : ''
  }`;
}

/**
 * Complete BoundedLoop contract editor: body selection, domain exits, limits,
 * optional goal variant, and the shared lifecycle policy. Body graph shape is
 * edited in the declaration panel rather than duplicated here.
 */
function BoundedLoopDetails({
  node,
  definition,
  catalog,
  fieldIssues,
  draftErrors,
  errorScope,
  resetKey,
  onInvalidChange,
  onPatch,
}: {
  node: WireBoundedLoopNode;
  definition?: WirePipelineDefinitionV2 | null;
  catalog: PipelineCatalogResponse | null;
  fieldIssues: Record<string, 'error' | 'warning'>;
  draftErrors: Readonly<Record<string, IntegerContractDraftError>>;
  errorScope: string;
  resetKey: string;
  onInvalidChange?: (
    field: string,
    error: IntegerContractDraftError | null
  ) => void;
  onPatch: (patch: BoundedLoopContractPatch) => void;
}) {
  const declarations = definition?.declarations ?? [];
  const declaration = declarations.find((candidate) => candidate.id === node.body);
  const lifecycle = node.lifecycle;
  const bodyNodes = declaration?.graph.nodes ?? [];
  const isReviewCycle = bodyNodes.some(
    (candidate) => candidate.kind === 'AtomicStage' && candidate.reviewCyclePhase
  );
  const registryField = (field: string) => `${errorScope}/${field}`;
  type LifecycleExitKey =
    | 'iterationLimit'
    | 'actionLimit'
    | 'budgetLimit'
    | 'stalled'
    | 'blocked'
    | 'strategyExhausted';
  type LifecycleExitValue =
    WireBoundedLoopLifecyclePolicyV1['exits'][LifecycleExitKey];
  const lifecycleExit = (
    key: LifecycleExitKey,
    label: string,
    actions: readonly string[]
  ) => {
    const current = lifecycle?.exits[key] as LifecycleExitValue | undefined;
    const outcome = current && 'outcome' in current ? current.outcome : '';
    return (
      <div class={nestedFieldClass(fieldIssues, `lifecycle/exits/${key}`)} data-testid="v2-loop-lifecycle-exit" data-trigger={key}>
        <span>{label}</span>
        <select
          data-testid="v2-loop-lifecycle-action"
          data-trigger={key}
          value={current?.action ?? ''}
          onChange={(event) => {
            const action = (event.target as HTMLSelectElement).value;
            const next = action === 'strategy'
              ? { action: 'strategy' as const }
              : { action: action as 'exit' | 'fail' | 'escalate' | 'human-required', outcome: outcome || key };
            onPatch({ lifecycle: { exits: { [key]: next } } });
          }}
        >
          {!current && <option value="">Missing</option>}
          {actions.map((action) => <option key={action} value={action}>{action}</option>)}
        </select>
        {current && current.action !== 'strategy' && (
          <input
            data-testid="v2-loop-lifecycle-outcome"
            data-trigger={key}
            value={outcome}
            onInput={(event) =>
              onPatch({
                lifecycle: {
                  exits: {
                    [key]: {
                      ...current,
                      outcome: (event.target as HTMLInputElement).value,
                    },
                  },
                },
              })
            }
          />
        )}
      </div>
    );
  };

  return (
    <div class="stage-panel__bounded-loop" data-testid="v2-node-panel-bounded-loop">
      <label class={nestedFieldClass(fieldIssues, 'body')}>
        <span>Body declaration</span>
        <select data-testid="v2-loop-body" value={node.body} onChange={(event) => onPatch({ body: (event.target as HTMLSelectElement).value })}>
          {!declarations.some((candidate) => candidate.id === node.body) && <option value={node.body}>{node.body} (invalid)</option>}
          {declarations.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.id}</option>)}
        </select>
      </label>
      <div class="stage-panel__bounded-loop-phases" data-testid="v2-node-panel-phases">
        <span>{isReviewCycle ? 'ReviewCycle phases' : 'Body stages'}</span>
        <ol>{bodyNodes.map((bodyNode) => <li key={bodyNode.id}>{bodyNode.id}</li>)}</ol>
      </div>
      <label class={nestedFieldClass(fieldIssues, 'goalCycleVariant')}>
        <span>Goal variant</span>
        <select data-testid="v2-loop-goal-variant" value={node.goalCycleVariant ?? ''} onChange={(event) => {
          const value = (event.target as HTMLSelectElement).value;
          onPatch({ goalCycleVariant: value ? (value as 'measure' | 'evaluate' | 'research') : null });
        }}>
          <option value="">None</option>
          <option value="measure">measure</option>
          <option value="evaluate">evaluate</option>
          <option value="research">research</option>
        </select>
      </label>
      {([
        ['maxIterations', 'Max iterations', 'v2-node-panel-max-rounds'],
        ['maxActions', 'Max actions', 'v2-loop-max-actions'],
        ['budget', 'Budget', 'v2-loop-budget'],
      ] as const).map(([key, label, testId]) => (
        <IntegerContractField
          key={key}
          label={label}
          value={node.limits[key]}
          minimum={1}
          allowClear={key !== 'maxIterations'}
          field={registryField(`limits/${key}`)}
          resetKey={resetKey}
          testId={testId}
          className={nestedFieldClass(fieldIssues, `limits/${key}`)}
          draftError={draftErrors[registryField(`limits/${key}`)]}
          onDraftError={(field, error) => onInvalidChange?.(field, error)}
          onValue={(value) => {
            if (key === 'maxIterations') {
              if (value !== null) onPatch({ limits: { maxIterations: value } });
              return;
            }
            onPatch({ limits: { [key]: value } });
          }}
        />
      ))}
      <section class="stage-panel__section" data-testid="v2-loop-domain-exits">
        <h4 class="stage-panel__section-title">Domain outcomes</h4>
        {(declaration?.outcomes ?? Object.keys(node.exits)).map((bodyOutcome) => {
          const current = node.exits[bodyOutcome] ?? { action: 'continue' as const };
          return (
            <div key={bodyOutcome} class={nestedFieldClass(fieldIssues, `exits/${bodyOutcome}`)} data-outcome={bodyOutcome}>
              <span>{bodyOutcome}</span>
              <select data-testid="v2-loop-domain-action" data-outcome={bodyOutcome} value={current.action} onChange={(event) => {
                const action = (event.target as HTMLSelectElement).value;
                onPatch({ exits: { [bodyOutcome]: action === 'continue' ? { action: 'continue' } : { action: 'exit', outcome: definition?.outcomes[0] ?? 'done' } } });
              }}>
                <option value="continue">continue</option>
                <option value="exit">exit</option>
              </select>
              {current.action === 'exit' && (
                <select data-testid="v2-loop-domain-outcome" data-outcome={bodyOutcome} value={current.outcome} onChange={(event) => onPatch({ exits: { [bodyOutcome]: { action: 'exit', outcome: (event.target as HTMLSelectElement).value } } })}>
                  {!definition?.outcomes.includes(current.outcome) && <option value={current.outcome}>{current.outcome} (invalid)</option>}
                  {(definition?.outcomes ?? []).map((outcome) => <option key={outcome} value={outcome}>{outcome}</option>)}
                </select>
              )}
            </div>
          );
        })}
      </section>
      <section class="stage-panel__section" data-testid="v2-loop-lifecycle">
        <h4 class="stage-panel__section-title">bounded-loop-lifecycle/1</h4>
        {!lifecycle && <p class="stage-panel__muted">Incomplete lifecycle; edit a field to repair it.</p>}
        <IntegerContractField
          label="Stall iterations"
          value={lifecycle?.thresholds.stallIterations}
          minimum={1}
          allowClear={false}
          field={registryField('lifecycle/thresholds/stallIterations')}
          resetKey={resetKey}
          testId="v2-loop-stall-iterations"
          className={nestedFieldClass(fieldIssues, 'lifecycle/thresholds/stallIterations')}
          draftError={draftErrors[registryField('lifecycle/thresholds/stallIterations')]}
          onDraftError={(field, error) => onInvalidChange?.(field, error)}
          onValue={(stallIterations) => {
            if (stallIterations !== null) {
              onPatch({ lifecycle: { thresholds: { stallIterations } } });
            }
          }}
        />
        <IntegerContractField
          label="Same blocker attempts"
          value={lifecycle?.thresholds.sameBlockerAttempts}
          minimum={1}
          allowClear={false}
          field={registryField('lifecycle/thresholds/sameBlockerAttempts')}
          resetKey={resetKey}
          testId="v2-loop-blocker-attempts"
          className={nestedFieldClass(fieldIssues, 'lifecycle/thresholds/sameBlockerAttempts')}
          draftError={draftErrors[registryField('lifecycle/thresholds/sameBlockerAttempts')]}
          onDraftError={(field, error) => onInvalidChange?.(field, error)}
          onValue={(sameBlockerAttempts) => {
            if (sameBlockerAttempts !== null) {
              onPatch({ lifecycle: { thresholds: { sameBlockerAttempts } } });
            }
          }}
        />
        <IntegerContractField
          label="Strategy attempts"
          value={lifecycle?.strategy.maxAttempts}
          minimum={0}
          allowClear={false}
          field={registryField('lifecycle/strategy/maxAttempts')}
          resetKey={resetKey}
          testId="v2-loop-strategy-attempts"
          className={nestedFieldClass(fieldIssues, 'lifecycle/strategy/maxAttempts')}
          draftError={draftErrors[registryField('lifecycle/strategy/maxAttempts')]}
          onDraftError={(field, error) => onInvalidChange?.(field, error)}
          onValue={(maxAttempts) => {
            if (maxAttempts !== null) {
              onPatch({
                lifecycle: {
                  strategy: {
                    maxAttempts,
                    ...(maxAttempts === 0 ? { capability: null } : {}),
                  },
                },
              });
            }
          }}
        />
        <label class={nestedFieldClass(fieldIssues, 'lifecycle/strategy/capability')}>
          <span>Exact strategy capability</span>
          <select data-testid="v2-loop-strategy-capability" disabled={(lifecycle?.strategy.maxAttempts ?? 0) === 0} value={lifecycle?.strategy.capability ? `${lifecycle.strategy.capability.id}\0${lifecycle.strategy.capability.version}` : ''} onChange={(event) => {
            const value = (event.target as HTMLSelectElement).value;
            const capability = (catalog?.skills ?? []).map((skill) => skill.capability).find((candidate) => candidate && `${candidate.id}\0${candidate.version}` === value);
            onPatch({ lifecycle: { strategy: { capability: capability ? { id: capability.id, version: capability.version } : null } } });
          }}>
            <option value="">Select exact capability</option>
            {(catalog?.skills ?? []).filter((skill) => skill.enabled && skill.capability).map((skill) => <option key={`${skill.capability!.id}\0${skill.capability!.version}`} value={`${skill.capability!.id}\0${skill.capability!.version}`}>{skill.capability!.id} @ {skill.capability!.version}</option>)}
          </select>
        </label>
        <label class="stage-panel__field">
          <input type="checkbox" checked disabled data-testid="v2-loop-require-material-change" />
          Strategy must produce material change
        </label>
        {lifecycleExit('iterationLimit', 'Iteration limit', ['exit', 'escalate', 'fail', 'strategy'])}
        {lifecycleExit('actionLimit', 'Action limit', ['exit', 'escalate', 'fail'])}
        {lifecycleExit('budgetLimit', 'Budget limit', ['exit', 'escalate', 'fail'])}
        {lifecycleExit('stalled', 'Stalled', ['exit', 'escalate', 'fail', 'strategy'])}
        {lifecycleExit('blocked', 'Blocked', ['exit', 'escalate', 'fail', 'strategy', 'human-required'])}
        {lifecycleExit('strategyExhausted', 'Strategy exhausted', ['exit', 'escalate', 'fail'])}
      </section>
      {Object.keys(fieldIssues).length > 0 && <span class="stage-panel__muted">Server diagnostics are authoritative for loop legality.</span>}
    </div>
  );
}

/**
 * CompositeRef detail renderer (design D5): shows the referenced declaration
 * (editable via dropdown), the declaration's contract (inputs/artifacts/
 * outcomes read-only summary), the body stages list, and the port mapping
 * between root-level connections and the declaration's declared ports.
 */
function CompositeRefDetails({
  node,
  definition,
  onPatch,
}: {
  node: WireCompositeRefNode;
  definition?: WirePipelineDefinitionV2 | null;
  onPatch: (patch: Partial<WireDefinitionNode>) => boolean | void;
}) {
  const declarations = definition?.declarations ?? [];
  const selectedDeclaration = declarations.find(
    (d) => d.id === node.declarationId
  );

  return (
    <div
      class="stage-panel__composite-ref"
      data-testid="v2-node-panel-composite-ref"
    >
      <label class="stage-panel__field">
        <span>Declaration</span>
        <select
          data-testid="v2-node-panel-declaration"
          value={node.declarationId}
          onChange={(event) => {
            const value = (event.target as HTMLSelectElement).value;
            onPatch({ declarationId: value });
          }}
        >
          {declarations.length === 0 && (
            <option value="">(no declarations)</option>
          )}
          {declarations.map((d) => (
            <option key={d.id} value={d.id}>
              {d.id}
              {d.provenance === 'built-in' ? ' (built-in)' : ''}
            </option>
          ))}
        </select>
      </label>

      {selectedDeclaration && (
        <DeclarationSummary declaration={selectedDeclaration} />
      )}
    </div>
  );
}

/**
 * Read-only declaration contract summary: inputs, artifacts, outcomes, and
 * body stage list. Also shows the port mapping surface.
 */
function DeclarationSummary({
  declaration,
}: {
  declaration: WireCompositeDeclaration;
}) {
  const inputs = declaration.inputs ?? [];
  const artifacts = declaration.artifacts ?? [];
  const outcomes = declaration.outcomes ?? [];
  const bodyNodes = (declaration.graph?.nodes ?? []) as Array<{
    id: string;
    kind: string;
    capability?: { id: string };
  }>;
  const bodyConnections = declaration.graph?.connections ?? [];

  return (
    <div
      class="stage-panel__declaration-summary"
      data-testid="v2-node-panel-declaration-summary"
    >
      {inputs.length > 0 && (
        <div class="stage-panel__field">
          <span>Inputs</span>
          <ul class="stage-panel__port-list">
            {inputs.map((port) => (
              <li key={port.name}>
                {port.name}: {port.type}
              </li>
            ))}
          </ul>
        </div>
      )}
      {artifacts.length > 0 && (
        <div class="stage-panel__field">
          <span>Artifacts</span>
          <ul class="stage-panel__port-list">
            {artifacts.map((art) => (
              <li key={art.name}>
                {art.name}: {art.type}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div class="stage-panel__field">
        <span>Outcomes</span>
        <div class="stage-panel__outcomes-list">
          {outcomes.join(', ') || '(none)'}
        </div>
      </div>
      <div class="stage-panel__field">
        <span>Body stages ({bodyNodes.length})</span>
        <ol class="stage-panel__body-stages">
          {bodyNodes.map((n) => (
            <li key={n.id} data-testid="v2-node-panel-body-stage">
              {n.id} ({n.kind})
              {n.capability ? ` → ${n.capability.id}` : ''}
            </li>
          ))}
        </ol>
      </div>
      {bodyConnections.length > 0 && (
        <div class="stage-panel__field">
          <span>Body connections ({bodyConnections.length})</span>
          <ul class="stage-panel__port-list">
            {bodyConnections.map((c, i) => (
              <li key={i}>
                {c.from.node}:{c.from.port} → {c.to.node}:{c.to.port}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div class="stage-panel__field stage-panel__port-mapping">
        <span>Port mapping</span>
        <div class="stage-panel__port-mapping-grid" data-testid="v2-node-panel-port-mapping">
          {inputs.map((port) => (
            <div key={`in:${port.name}`} class="stage-panel__port-mapping-row">
              <span class="stage-panel__port-mapping-root">root:{port.name}</span>
              <span class="stage-panel__port-mapping-arrow">→</span>
              <span class="stage-panel__port-mapping-decl">{port.name}</span>
            </div>
          ))}
          {outcomes.map((outcome) => (
            <div key={`out:${outcome}`} class="stage-panel__port-mapping-row">
              <span class="stage-panel__port-mapping-decl">{outcome}</span>
              <span class="stage-panel__port-mapping-arrow">→</span>
              <span class="stage-panel__port-mapping-root">root:{outcome}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ParallelJoinIdField({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <input
      data-testid="v2-parallel-join-id"
      value={draft}
      onInput={(event) => setDraft((event.target as HTMLInputElement).value)}
      onBlur={() => {
        const next = draft.trim();
        if (next && next !== value) onCommit(next);
        setDraft(value);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') (event.currentTarget as HTMLInputElement).blur();
      }}
    />
  );
}

function ParallelEditor({
  node,
  definition,
  fieldIssues,
  draftErrors,
  onInvalidChange,
  onMembers,
  onMemberPatch,
  onContractPatch,
  onDeletePair,
}: {
  node: WireFanOutNode | WireJoinNode;
  definition: WirePipelineDefinitionV2;
  fieldIssues: Record<string, 'error' | 'warning'>;
  draftErrors: Readonly<Record<string, IntegerContractDraftError>>;
  onInvalidChange?: (
    field: string,
    error: IntegerContractDraftError | null
  ) => void;
  onMembers?: (fanOutId: string, memberIds: readonly string[]) => void;
  onMemberPatch?: (fanOutId: string, memberId: string, patch: ParallelMemberPatch) => void;
  onContractPatch?: (fanOutId: string, patch: ParallelContractPatch) => void;
  onDeletePair?: (fanOutId: string) => void;
}) {
  const fanOut = node.kind === 'FanOut'
    ? node
    : definition.root.nodes.find(
        (candidate): candidate is WireFanOutNode =>
          candidate.kind === 'FanOut' && candidate.joinNodeId === node.id
      );
  const join = fanOut
    ? definition.root.nodes.find(
        (candidate): candidate is WireJoinNode =>
          candidate.kind === 'Join' && candidate.id === fanOut.joinNodeId
      )
    : undefined;
  if (!fanOut || !join) {
    return (
      <section class="stage-panel__section" data-testid="v2-parallel-editor">
        <h4>Incomplete parallel contract</h4>
        <p class="stage-panel__muted">The paired FanOut or Join is missing. Server validation remains authoritative.</p>
      </section>
    );
  }
  const eligible = definition.root.nodes.filter(
    (candidate): candidate is WireAtomicStageNode => candidate.kind === 'AtomicStage'
  );
  const selected = new Set(fanOut.members.map((member) => member.id));
  const registryField = (field: string) => `parallel:${fanOut.id}/${field}`;
  const resetKey = `${definition.name}\0${fanOut.id}`;
  return (
    <section class="stage-panel__section" data-testid="v2-parallel-editor" data-fanout-id={fanOut.id} data-join-id={join.id}>
      <h4 class="stage-panel__section-title">Paired FanOut / Join</h4>
      <div class={nestedFieldClass(fieldIssues, 'members')}>
        <span>Eligible members</span>
        {eligible.map((candidate) => (
          <label key={candidate.id}>
            <input
              type="checkbox"
              data-testid="v2-parallel-member-select"
              data-member-id={candidate.id}
              checked={selected.has(candidate.id)}
              onChange={(event) => {
                const checked = (event.target as HTMLInputElement).checked;
                const next = checked
                  ? [...fanOut.branches, candidate.id]
                  : fanOut.branches.filter((memberId) => memberId !== candidate.id);
                onMembers?.(fanOut.id, next);
              }}
            />
            {candidate.id}
          </label>
        ))}
      </div>
      {fanOut.members.map((member) => (
        <fieldset key={member.id} class={nestedFieldClass(fieldIssues, `members/${fanOut.members.indexOf(member)}`)} data-testid="v2-parallel-member" data-member-id={member.id}>
          <legend>{member.id}</legend>
          <label>
            <input type="checkbox" data-testid="v2-parallel-required" data-member-id={member.id} checked={member.required} onChange={(event) => onMemberPatch?.(fanOut.id, member.id, { required: (event.target as HTMLInputElement).checked })} />
            Required
          </label>
          <label>
            <span>Condition</span>
            <input data-testid="v2-parallel-condition" data-member-id={member.id} value={member.condition} onInput={(event) => onMemberPatch?.(fanOut.id, member.id, { condition: (event.target as HTMLInputElement).value })} />
          </label>
          <label>
            <span>Hierarchical path</span>
            <input data-testid="v2-parallel-path" data-member-id={member.id} value={member.hierarchicalPath} onInput={(event) => onMemberPatch?.(fanOut.id, member.id, { hierarchicalPath: (event.target as HTMLInputElement).value })} />
          </label>
        </fieldset>
      ))}
      <IntegerContractField
        label="Concurrency cap"
        value={fanOut.concurrencyCap}
        minimum={1}
        allowClear={false}
        field={registryField('concurrencyCap')}
        resetKey={resetKey}
        testId="v2-parallel-concurrency-cap"
        className={nestedFieldClass(fieldIssues, 'concurrencyCap')}
        draftError={draftErrors[registryField('concurrencyCap')]}
        onDraftError={(field, error) => onInvalidChange?.(field, error)}
        onValue={(concurrencyCap) => {
          if (concurrencyCap !== null) {
            onContractPatch?.(fanOut.id, { concurrencyCap });
          }
        }}
      />
      <IntegerContractField
        label="Budget"
        value={fanOut.budget}
        minimum={1}
        allowClear={false}
        field={registryField('budget')}
        resetKey={resetKey}
        testId="v2-parallel-budget"
        className={nestedFieldClass(fieldIssues, 'budget')}
        draftError={draftErrors[registryField('budget')]}
        onDraftError={(field, error) => onInvalidChange?.(field, error)}
        onValue={(budget) => {
          if (budget !== null) onContractPatch?.(fanOut.id, { budget });
        }}
      />
      <label class={nestedFieldClass(fieldIssues, 'joinNodeId')}>
        <span>Join stable id</span>
        <ParallelJoinIdField
          value={join.id}
          onCommit={(joinId) => onContractPatch?.(fanOut.id, { joinId })}
        />
      </label>
      <label class={nestedFieldClass(fieldIssues, 'outcomes/proceed')}>
        <span>Proceed outcome</span>
        <input data-testid="v2-parallel-proceed-outcome" value={join.outcomes.proceed} onInput={(event) => onContractPatch?.(fanOut.id, { outcomes: { proceed: (event.target as HTMLInputElement).value } })} />
      </label>
      <label class={nestedFieldClass(fieldIssues, 'outcomes/failed')}>
        <span>Failed outcome</span>
        <input data-testid="v2-parallel-failed-outcome" value={join.outcomes.failed} onInput={(event) => onContractPatch?.(fanOut.id, { outcomes: { failed: (event.target as HTMLInputElement).value } })} />
      </label>
      <div class="stage-panel__field">
        <span>Join partitions</span>
        <output data-testid="v2-parallel-required-summary">required: {join.requiredMembers.join(', ') || '(none)'}</output>
        <output data-testid="v2-parallel-optional-summary">optional: {join.optionalMembers.join(', ') || '(none)'}</output>
      </div>
      <button type="button" data-testid="v2-parallel-delete-pair" onClick={() => onDeletePair?.(fanOut.id)}>
        Delete FanOut and Join
      </button>
      {Object.keys(fieldIssues).length > 0 && <p class="stage-panel__muted">A server diagnostic targets this paired contract.</p>}
    </section>
  );
}

/**
 * ECP-4 FanOut detail renderer: shows member list with required badges,
 * concurrency cap, and budget scalars (read-only display).
 */
function FanOutDetails({ node }: { node: WireDefinitionNode }) {
  const branches = listValue(
    stringList((node as Readonly<{ branches?: unknown }>).branches)
  );
  const cap = (node as Readonly<{ concurrencyCap?: unknown }>).concurrencyCap;
  const budget = (node as Readonly<{ budget?: unknown }>).budget;
  const members = (node as Readonly<{ members?: ReadonlyArray<{ id: string; required: boolean; condition: string }> }>).members;
  return (
    <div class="stage-panel__section" data-testid="v2-node-panel-fanout">
      <h4 class="stage-panel__section-title">Parallel Members</h4>
      {members !== undefined ? (
        <ul class="stage-panel__member-list">
          {members.map((m) => (
            <li key={m.id} class="stage-panel__member-item">
              <span class="stage-panel__member-id">{m.id}</span>
              {m.required && (
                <span class="stage-panel__badge stage-panel__badge--required">required</span>
              )}
              <span class="stage-panel__member-condition">{m.condition}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p class="stage-panel__muted">{branches}</p>
      )}
      <div class="stage-panel__scalars">
        <label class="stage-panel__scalar">
          <span>Concurrency cap</span>
          <output>{String(cap ?? 3)}</output>
        </label>
        <label class="stage-panel__scalar">
          <span>Budget</span>
          <output>{String(budget ?? '—')}</output>
        </label>
      </div>
    </div>
  );
}

/**
 * ECP-4 Join detail renderer: shows required/optional members and outcomes.
 */
function JoinDetails({ node }: { node: WireDefinitionNode }) {
  const inputs = listValue(
    stringList((node as Readonly<{ inputs?: unknown }>).inputs)
  );
  const requiredMembers = (node as Readonly<{ requiredMembers?: readonly string[] }>).requiredMembers;
  const optionalMembers = (node as Readonly<{ optionalMembers?: readonly string[] }>).optionalMembers;
  const outcomes = (node as Readonly<{ outcomes?: Readonly<{ proceed: string; failed: string }> }>).outcomes;
  return (
    <div class="stage-panel__section" data-testid="v2-node-panel-join">
      <h4 class="stage-panel__section-title">Barrier Members</h4>
      {requiredMembers !== undefined && optionalMembers !== undefined ? (
        <ul class="stage-panel__member-list">
          {requiredMembers.map((m) => (
            <li key={m} class="stage-panel__member-item">
              <span class="stage-panel__member-id">{m}</span>
              <span class="stage-panel__badge stage-panel__badge--required">required</span>
            </li>
          ))}
          {optionalMembers.map((m) => (
            <li key={m} class="stage-panel__member-item">
              <span class="stage-panel__member-id">{m}</span>
              <span class="stage-panel__badge stage-panel__badge--optional">optional</span>
            </li>
          ))}
        </ul>
      ) : (
        <p class="stage-panel__muted">{inputs}</p>
      )}
      {outcomes !== undefined && (
        <div class="stage-panel__outcomes">
          <span>proceed: {outcomes.proceed}</span>
          <span>failed: {outcomes.failed}</span>
        </div>
      )}
    </div>
  );
}
