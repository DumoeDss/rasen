/**
 * `issue-execution-binding` — the confirm composition (review-flow D6).
 *
 * `rasen store issue confirm` is the Issue dispatch's confirm step: a READ
 * that composes, never a gate that persists. It resolves one revision,
 * verifies every Change node's instance against the committed Store evidence
 * the same plan read already resolved, and composes — for every node the plan
 * still wants whose dependencies' work is complete — the SAME launch contract
 * `store issue start --node <id>` would emit for it, suggestion included in
 * the pipeline resolution. Since issue-ready-set-scheduling (D2), the
 * launchable partition of that scope derives from the shared
 * `deriveIssueReadySet` derivation, so confirm's fresh-launch scope IS the
 * ready set the `ready` verb and start's frontier report. Intent nodes are
 * reported as pending Change creation, because confirm composes contracts and
 * mints nothing.
 *
 * Nothing here writes: there is no persisted confirmation record and no start
 * gate — the five declared Issue mutations stay five, and the plan-to-execution
 * history stays carried by the immutable revisions plus run-state attribution.
 * A pinned confirmation anchor is deliberately deferred (D6's rejected
 * alternatives record why) until deterministic replanning needs one.
 */
import type { ExecutionPlanChangeNode, ExecutionPlanNode } from '../store/issues/index.js';
import { deriveIssueReadySet } from '../issue-status/index.js';
import { resolveIssueLaunchBinding } from './binding.js';
import type {
  ComposeIssueConfirmInput,
  ComposeIssueConfirmResult,
  IssueConfirmPendingChange,
  IssueConfirmUnpreparedNode,
  IssueConfirmWaitingNode,
  IssueLaunchBinding,
} from './types.js';

function refuse(
  code:
    | 'issue_confirm_requires_plan'
    | 'issue_confirm_revision_unreadable'
    | 'issue_confirm_reference_unresolved',
  message: string
): ComposeIssueConfirmResult {
  return { ok: false, refusal: { code, message } };
}

function isChange(node: ExecutionPlanNode): node is ExecutionPlanChangeNode {
  return node.kind === 'change';
}

/**
 * Whether the plan still wants a node's work (lifecycles, absent = required).
 * Positive by construction: `cancelled`, `superseded`, and `deferred` nodes are
 * outside the confirmed scope with no branch of their own.
 */
function isWanted(node: ExecutionPlanNode): boolean {
  return (
    isChange(node) &&
    (node.lifecycle === undefined || node.lifecycle === 'required' || node.lifecycle === 'optional')
  );
}

/**
 * Composes the confirm report for one resolved revision. The per-node
 * contracts are resolved by `resolveIssueLaunchBinding` itself, addressed node
 * by node — the SAME resolution `start` applies, so confirm and start cannot
 * disagree about what a launch would look like.
 */
export async function composeIssueConfirm(
  input: ComposeIssueConfirmInput
): Promise<ComposeIssueConfirmResult> {
  const detail = input.detail;
  const plan = detail.plan;
  if (plan === null || plan.revision === null) {
    // A NAMED revision that did not read back is not the same truth as an
    // Issue with nothing to confirm. When the operator addressed an ordinal
    // and the Issue HAS published revisions, the misaddress is the defect —
    // named as such, with the readable range, so the advice points at the
    // ordinals instead of at publishing a new revision (review round-1
    // Minor-1: distinct truths get distinct refusals).
    const published = detail.issue.revisionIds;
    const latest = detail.issue.latestRevisionId;
    if (input.requestedRevisionId !== undefined && published.length > 0) {
      const range =
        published.length === 1
          ? `its one published revision is ${published[0]}`
          : `its published revisions run ${published[0]}–${
              published[published.length - 1]
            } (latest ${latest ?? published[published.length - 1]})`;
      return refuse(
        'issue_confirm_revision_unreadable',
        `Revision '${input.requestedRevisionId}' of Issue ${detail.issue.issueId} `
          + `could not be read back for confirmation; ${range}. Name a readable `
          + 'revision (the show command lists the ordinals) or omit --revision '
          + 'to confirm the latest.'
      );
    }
    return refuse(
      'issue_confirm_requires_plan',
      `Issue ${detail.issue.issueId} has no readable published Execution Plan revision; `
        + 'the planning phase and its publish action precede confirmation.'
    );
  }
  const revision = plan.revision;

  // Every Change node's instance verifies against committed Store evidence —
  // the same resolutions this plan read already performed over the same
  // gathered evidence family publication verifies through. A node that did
  // not resolve refuses the whole composition, naming the node and what its
  // reference read back as: no contract set is reported beside a defect.
  const byId = new Map(
    plan.readiness.nodes.map(row => [row.node.nodeId, row] as const)
  );
  for (const node of revision.nodes) {
    if (!isChange(node)) continue;
    const resolution = byId.get(node.nodeId)?.resolution;
    if (resolution?.status !== 'resolved') {
      const status = resolution?.status ?? 'unresolved';
      return refuse(
        'issue_confirm_reference_unresolved',
        `Node '${node.nodeId}' names Change instance ${node.changeInstanceId}, `
          + `which did not verify against committed Store evidence (reference ${status}); `
          + 'a revision whose Change reference does not resolve is not confirmable.'
      );
    }
  }

  const observationsById = new Map(
    input.status.nodes.map(row => [row.nodeId, row] as const)
  );
  const workComplete = (nodeId: string): boolean => {
    const observation = observationsById.get(nodeId)?.observation;
    return observation === 'finalized' || observation === 'run-terminal';
  };

  // The launchable scope derives from the shared ready set
  // (issue-ready-set-scheduling D2): a not-started wanted node is a member
  // exactly when its dependencies' observed work is complete, so the same one
  // derivation feeds the `ready` read verb, start's frontier, and this
  // composition. Begun nodes (running, complete, or unknown) keep their
  // per-node resolution below exactly as before — confirm composes their
  // resume-oriented and report-only contracts through the same
  // `resolveIssueLaunchBinding` a `start --node` would apply.
  const ready = deriveIssueReadySet(input.status);
  const memberIds = new Set(
    ready === null ? [] : ready.members.map(member => member.nodeId)
  );

  const contracts: IssueLaunchBinding[] = [];
  const pendingChanges: IssueConfirmPendingChange[] = [];
  const waiting: IssueConfirmWaitingNode[] = [];
  const unprepared: IssueConfirmUnpreparedNode[] = [];

  for (const node of revision.nodes) {
    if (!isChange(node)) {
      pendingChanges.push({
        nodeId: node.nodeId,
        projectId: node.projectId,
        targetLineId: node.targetLineId,
        summary: node.summary,
        suggestedPipeline: node.suggestedPipeline ?? null,
        lifecycle: node.lifecycle ?? 'required',
      });
      continue;
    }
    if (!isWanted(node)) continue; // cancelled/superseded/deferred: outside the confirmed scope
    if (
      observationsById.get(node.nodeId)?.observation === 'not-started' &&
      !memberIds.has(node.nodeId)
    ) {
      // A not-started wanted node outside the ready set is waiting on
      // dependency work; the reason names each blocker exactly as before.
      const blocked = node.dependsOn.filter(dependency => !workComplete(dependency));
      waiting.push({
        nodeId: node.nodeId,
        reason: `awaits ${blocked
          .map(
            dependency =>
              `${dependency}@${byId.get(dependency)?.node.projectId ?? '(unknown node)'} (${
                observationsById.get(dependency)?.observation ?? 'unknown'
              })`
          )
          .join(', ')}`,
      });
      continue;
    }
    const resolved = await resolveIssueLaunchBinding({
      detail,
      status: input.status,
      workspaceEntries: input.workspaceEntries,
      launchContextFor: input.launchContextFor,
      nodeId: node.nodeId,
    });
    if (resolved.ok) {
      contracts.push(resolved.binding);
      continue;
    }
    // A launch-context failure over an otherwise-launchable node is a fact to
    // report, not a defect that refuses the composition: the plan is still
    // confirmable, and the exact preparation that would create the binding is
    // what the operator needs to see.
    unprepared.push({
      nodeId: node.nodeId,
      reason: resolved.refusal.message,
      preparation: resolved.refusal.preparation,
    });
  }

  return {
    ok: true,
    report: {
      issueId: detail.issue.issueId,
      revisionId: revision.revisionId,
      contracts,
      pendingChanges,
      waiting,
      unprepared,
    },
  };
}
