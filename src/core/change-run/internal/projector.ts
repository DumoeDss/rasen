import type {
  ChangeRunView,
  WorkspaceRevision,
} from '../contracts.js';
import type {
  CanonicalRunRecord,
  CommittedAction,
} from './record.js';
import type { CanonicalWait } from './waits.js';
import { canonicalJson } from './identity.js';

function actionView(committed: CommittedAction) {
  const action = committed.action;
  return {
    format: 'change-run-action-view/1',
    kind: action.kind,
    actionId: action.actionId,
    invocationId: action.invocationId,
    attemptId: action.attemptId,
    nodeId: action.nodeId,
    deliveryState: committed.deliveryState,
    capability: {
      id: action.capability.id,
      contractVersion: action.capability.contractVersion,
      contractDigest: action.capability.contractDigest,
      artifactDigest: action.capability.artifact.contentDigest,
    },
    effects: [...committed.effects]
      .sort((left, right) => (left.slot < right.slot ? -1 : 1))
      .map((effect) => ({
        slot: effect.slot,
        effectId: effect.effectId,
        state: effect.state,
      })),
  };
}

type AllowedControl =
  | Readonly<{ kind: 'resume'; waitId: string }>
  | Readonly<{ kind: 'decision'; waitId: string; decisionId: string; outcomes: readonly string[] }>
  | Readonly<{ kind: 'accept-workspace-revision'; waitId: string; revision: WorkspaceRevision }>
  | Readonly<{ kind: 'escalate' }>
  | Readonly<{ kind: 'cancel' }>;

/**
 * Derive the safe controls a caller may submit for a wait (task 1.6/11.x). A
 * gate offers a decision control over its declared decisions; a resumable wait
 * (domain-blocked, capability-unavailable, workspace-reservation, retryable
 * infrastructure) offers resume; a workspace-drift wait offers an
 * accept-workspace-revision control carrying the exact observed revision;
 * escalate and cancel are always available on a non-terminal Run.
 */
function allowedControlsFor(
  waits: readonly CanonicalWait[],
  escalate: 'include' | 'omit'
): readonly AllowedControl[] {
  const controls: AllowedControl[] = [];
  for (const wait of waits) {
    switch (wait.kind) {
      case 'gate':
        for (const decisionId of wait.decisionIds) {
          controls.push({
            kind: 'decision',
            waitId: wait.waitId,
            decisionId,
            outcomes: [...wait.decisionIds],
          });
        }
        break;
      case 'domain-blocked':
      case 'capability-unavailable':
      case 'workspace-reservation':
        controls.push({ kind: 'resume', waitId: wait.waitId });
        break;
      case 'infrastructure':
        if (wait.retryable) {
          controls.push({ kind: 'resume', waitId: wait.waitId });
        }
        break;
      case 'workspace-drift':
        controls.push({
          kind: 'accept-workspace-revision',
          waitId: wait.waitId,
          revision: wait.observed,
        });
        break;
      case 'uncertain-effect':
        // Uncertain-effect waits resume only through strong observation, not an
        // ordinary resume control; no control is offered here.
        break;
    }
  }
  if (escalate === 'include') {
    controls.push({ kind: 'escalate' });
    controls.push({ kind: 'cancel' });
  }
  return [...controls].sort((left, right) => {
    const leftCanon = canonicalJson(left);
    const rightCanon = canonicalJson(right);
    return leftCanon < rightCanon ? -1 : leftCanon > rightCanon ? 1 : 0;
  });
}

/**
 * Project a canonical Record into a read-only `ChangeRunView` (tasks 11.1/11.2).
 * The projection is derived solely from committed Record truth: actions,
 * waits, terminal outcome, and the current workspace revision. The ready
 * frontier itself is produced by the reconciler; this projector reports the
 * committed state and the safe controls derivable from it.
 */
export function projectRunView(record: CanonicalRunRecord): ChangeRunView {
  const isTerminal = record.terminal !== undefined;
  const root = isTerminal
    ? {
        kind: 'root-dag' as const,
        version: 1 as const,
        frontier: [] as readonly never[],
        activeInvocations: [] as readonly never[],
        actions: [] as readonly never[],
        waits: [] as readonly never[],
        terminal: record.terminal,
        workspace: {
          current: record.currentWorkspaceRevision,
          expectedByActiveWriters: [] as readonly WorkspaceRevision[],
        },
        effectDiagnostics: [] as readonly never[],
        allowedControls: [] as readonly never[],
      }
    : {
        kind: 'root-dag' as const,
        version: 1 as const,
        frontier: [] as readonly string[],
        activeInvocations: [] as readonly never[],
        actions: Object.values(record.actions)
          .sort((left, right) =>
            left.action.actionId < right.action.actionId
              ? -1
              : 1
          )
          .map(actionView),
        waits: [...record.waits].sort((left, right) =>
          left.waitId < right.waitId ? -1 : 1
        ),
        workspace: {
          current: record.currentWorkspaceRevision,
          expectedByActiveWriters: [] as readonly WorkspaceRevision[],
        },
        effectDiagnostics: [] as readonly never[],
        allowedControls: allowedControlsFor(record.waits, 'include'),
      };

  return {
    format: 'change-run-view/1',
    engine: 'reconciler',
    runId: record.runId,
    change: record.change,
    recordVersion: record.recordVersion,
    status: record.status,
    sourceState: 'active',
    workspace: {
      instanceId: record.workspaceInstanceId,
      scope: 'current',
    },
    drift: {
      definition: 'unchanged',
      sourceRevision: {
        provenance: 'unchanged',
        content: 'unchanged',
        semantic: 'unchanged',
      },
      capability: 'unchanged',
      policy: 'unchanged',
      workspace: 'unchanged',
    },
    sections: [root],
  } as ChangeRunView;
}
