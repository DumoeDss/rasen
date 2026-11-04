import type {
  PipelineCatalogResponse,
  WireAtomicStageNode,
  WireGoalCyclePhase,
  WireReviewCyclePhase,
  WireStageRole,
} from '../api/types.js';
import type { AtomicStageExecutionPatch } from './draft.js';

const ROLES: readonly WireStageRole[] = [
  'planner',
  'implementer',
  'reviewer',
  'fixer',
  'shipper',
];
const REVIEW_PHASES: readonly WireReviewCyclePhase[] = [
  'review',
  'triage',
  'fix',
  're-review',
];
const GOAL_PHASES: readonly WireGoalCyclePhase[] = ['work', 'judge'];

function issueClass(
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

export function V2ExecutionEditor({
  node,
  catalog,
  fieldIssues,
  testIdPrefix = 'v2-execution',
  capabilityTestId,
  showPhases = false,
  onCapabilityPatch,
  onExecutionPatch,
  onPhasePatch,
}: {
  node: WireAtomicStageNode;
  catalog: PipelineCatalogResponse | null;
  fieldIssues: Record<string, 'error' | 'warning'>;
  testIdPrefix?: string;
  capabilityTestId?: string;
  showPhases?: boolean;
  onCapabilityPatch: (capability: { id: string; version: string }) => void;
  onExecutionPatch: (patch: AtomicStageExecutionPatch) => void;
  onPhasePatch?: (patch: {
    reviewCyclePhase?: WireReviewCyclePhase;
    goalCyclePhase?: WireGoalCyclePhase;
  }) => void;
}) {
  const execution = node.execution ?? {
    version: 1 as const,
    role: 'implementer' as const,
    workspace: { access: 'write' as const },
  };
  const optionalText = (
    key: 'model' | 'effort',
    label: string
  ) => (
    <label class={issueClass(fieldIssues, `execution/${key}`)}>
      <span>{label}</span>
      <input
        data-testid={`${testIdPrefix}-${key}`}
        value={execution[key] ?? ''}
        onInput={(event) => {
          const value = (event.target as HTMLInputElement).value.trim();
          onExecutionPatch({ [key]: value || null });
        }}
      />
    </label>
  );
  return (
    <section class="stage-panel__section" data-testid={`${testIdPrefix}-editor`}>
      <h4 class="stage-panel__section-title">Execution</h4>
      <label class={issueClass(fieldIssues, 'capability')}>
        <span>Exact capability revision</span>
        <select
          data-testid={capabilityTestId ?? `${testIdPrefix}-capability`}
          data-stage-id={node.id}
          value={`${node.capability.id}\0${node.capability.version}`}
          onChange={(event) => {
            const selected = (event.target as HTMLSelectElement).value;
            const capability = (catalog?.skills ?? [])
              .map((skill) => skill.capability)
              .find(
                (candidate) =>
                  candidate &&
                  `${candidate.id}\0${candidate.version}` === selected
              );
            if (capability) {
              onCapabilityPatch({ id: capability.id, version: capability.version });
            }
          }}
        >
          <option value={`${node.capability.id}\0${node.capability.version}`}>
            {node.capability.id} @ {node.capability.version}
          </option>
          {(catalog?.skills ?? [])
            .filter(
              (skill) =>
                skill.enabled &&
                skill.capability &&
                `${skill.capability.id}\0${skill.capability.version}` !==
                  `${node.capability.id}\0${node.capability.version}`
            )
            .map((skill) => (
              <option
                key={`${skill.capability!.id}\0${skill.capability!.version}`}
                value={`${skill.capability!.id}\0${skill.capability!.version}`}
              >
                {skill.capability!.id} @ {skill.capability!.version}
              </option>
            ))}
        </select>
      </label>
      <label class={issueClass(fieldIssues, 'execution/role')}>
        <span>Role</span>
        <select
          data-testid={`${testIdPrefix}-role`}
          value={execution.role}
          onChange={(event) =>
            onExecutionPatch({
              role: (event.target as HTMLSelectElement).value as WireStageRole,
            })
          }
        >
          {ROLES.map((role) => (
            <option key={role} value={role}>{role}</option>
          ))}
        </select>
      </label>
      <label class={issueClass(fieldIssues, 'execution/workspace/access')}>
        <span>Workspace access</span>
        <select
          data-testid={`${testIdPrefix}-workspace`}
          value={execution.workspace.access}
          onChange={(event) =>
            onExecutionPatch({
              workspace: {
                access: (event.target as HTMLSelectElement).value as
                  | 'none'
                  | 'read'
                  | 'write',
              },
            })
          }
        >
          {(['none', 'read', 'write'] as const).map((access) => (
            <option key={access} value={access}>{access}</option>
          ))}
        </select>
      </label>
      <label class={issueClass(fieldIssues, 'execution/leadReview')}>
        <span>Lead review</span>
        <select
          data-testid={`${testIdPrefix}-lead-review`}
          value={execution.leadReview === undefined ? '' : String(execution.leadReview)}
          onChange={(event) => {
            const value = (event.target as HTMLSelectElement).value;
            onExecutionPatch({ leadReview: value === '' ? null : value === 'true' });
          }}
        >
          <option value="">Not authored</option>
          <option value="true">Required</option>
          <option value="false">Not required</option>
        </select>
      </label>
      <label class={issueClass(fieldIssues, 'execution/verifyPolicy')}>
        <span>Verification</span>
        <select
          data-testid={`${testIdPrefix}-verify-policy`}
          value={execution.verifyPolicy ?? ''}
          onChange={(event) => {
            const value = (event.target as HTMLSelectElement).value;
            onExecutionPatch({ verifyPolicy: value ? (value as 'adaptive' | 'standard' | 'light') : null });
          }}
        >
          <option value="">Not authored</option>
          {(catalog?.verifyPolicies ?? ['adaptive', 'standard', 'light']).map((policy) => (
            <option key={policy} value={policy}>{policy}</option>
          ))}
        </select>
      </label>
      <label class={issueClass(fieldIssues, 'execution/runtime')}>
        <span>Runtime</span>
        <select
          data-testid={`${testIdPrefix}-runtime`}
          value={execution.runtime ?? ''}
          onChange={(event) => {
            const value = (event.target as HTMLSelectElement).value;
            onExecutionPatch({ runtime: value ? (value as 'claude' | 'codex') : null });
          }}
        >
          <option value="">Not authored</option>
          {(catalog?.runtimes ?? ['claude', 'codex']).map((runtime) => (
            <option key={runtime} value={runtime}>{runtime}</option>
          ))}
        </select>
      </label>
      {optionalText('model', 'Model')}
      {optionalText('effort', 'Effort')}
      <label class={issueClass(fieldIssues, 'execution/sandbox')}>
        <span>Sandbox</span>
        <select
          data-testid={`${testIdPrefix}-sandbox`}
          value={execution.sandbox ?? ''}
          onChange={(event) => {
            const value = (event.target as HTMLSelectElement).value;
            onExecutionPatch({ sandbox: value ? (value as 'read-only' | 'workspace-write') : null });
          }}
        >
          <option value="">Not authored</option>
          <option value="read-only">read-only</option>
          <option value="workspace-write">workspace-write</option>
        </select>
      </label>
      <label class={issueClass(fieldIssues, 'execution/sessionReuse')}>
        <span>Session reuse</span>
        <select
          data-testid={`${testIdPrefix}-session-reuse`}
          value={execution.sessionReuse ?? ''}
          onChange={(event) => {
            const value = (event.target as HTMLSelectElement).value;
            onExecutionPatch({
              sessionReuse: value
                ? (value as 'none' | 'stage' | 'run-planner' | 'review-thread')
                : null,
            });
          }}
        >
          <option value="">Not authored</option>
          {(['none', 'stage', 'run-planner', 'review-thread'] as const).map((reuse) => (
            <option key={reuse} value={reuse}>{reuse}</option>
          ))}
        </select>
      </label>
      <label class={issueClass(fieldIssues, 'execution/handoff/maxRelays')}>
        <span>Handoff max relays</span>
        <input
          type="number"
          min={0}
          data-testid={`${testIdPrefix}-handoff-max-relays`}
          value={execution.handoff?.maxRelays ?? ''}
          onInput={(event) => {
            const value = (event.target as HTMLInputElement).value;
            onExecutionPatch(
              value === ''
                ? { handoff: { maxRelays: null } }
                : { handoff: { maxRelays: Number(value) } }
            );
          }}
        />
      </label>
      {showPhases && onPhasePatch && (
        <>
          <label class={issueClass(fieldIssues, 'reviewCyclePhase')}>
            <span>ReviewCycle phase</span>
            <select
              data-testid={`${testIdPrefix}-review-phase`}
              value={node.reviewCyclePhase ?? ''}
              onChange={(event) => {
                const value = (event.target as HTMLSelectElement).value;
                onPhasePatch({ reviewCyclePhase: value ? (value as WireReviewCyclePhase) : undefined });
              }}
            >
              <option value="">None</option>
              {REVIEW_PHASES.map((phase) => <option key={phase} value={phase}>{phase}</option>)}
            </select>
          </label>
          <label class={issueClass(fieldIssues, 'goalCyclePhase')}>
            <span>GoalLoop phase</span>
            <select
              data-testid={`${testIdPrefix}-goal-phase`}
              value={node.goalCyclePhase ?? ''}
              onChange={(event) => {
                const value = (event.target as HTMLSelectElement).value;
                onPhasePatch({ goalCyclePhase: value ? (value as WireGoalCyclePhase) : undefined });
              }}
            >
              <option value="">None</option>
              {GOAL_PHASES.map((phase) => <option key={phase} value={phase}>{phase}</option>)}
            </select>
          </label>
        </>
      )}
    </section>
  );
}
