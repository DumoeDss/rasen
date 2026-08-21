/**
 * `issue-execution-binding` — resolving an Issue node's launch binding.
 *
 * The frontier IS the ready set (issue-ready-set-scheduling D2): the shared
 * `deriveIssueReadySet` derivation over the projection — wanted ∧ not-started ∧
 * every dependency's observed work complete on the work-complete basis — so
 * the start gate, the confirm composition, and the `ready` read verb cannot
 * disagree about what may run now. The projection's dependency facts, never
 * the plan read's archive-based `blockedBy` (design D3), carry the gate: a
 * dependency whose run-state is terminal but whose Change is not yet archived
 * has completed its WORK, which is what "dependencies' work is complete"
 * means. Since issue-node-lifecycle,
 * the frontier also derives from the plan's WANTS: only `required` and
 * `optional` nodes are candidates, and `--node` naming a `cancelled` or
 * `superseded` node is refused with its own refusal kind naming the lifecycle
 * and the recorded reason. Launch routes are tried in
 * a fixed order (design D4): the workspace pair recorded for the node's
 * Change instance, then the member-project checkout through the same
 * session-launch composition a supervised session uses, and neither is a
 * refusal naming the exact workspace preparation that would create a binding.
 * Nothing here writes: the binding is derived at read time from the plan
 * revision, Store membership, and the workspace index — there is no second
 * mutable truth beside them.
 */
import type {
  ExecutionPlanChangeNode,
  ExecutionPlanNode,
} from '../store/issues/index.js';
import { deriveIssueReadySet, issueBlockerState } from '../issue-status/index.js';
import type { IssueNodeObservation, IssueNodeStatus } from '../issue-status/index.js';
import { listPipelines } from '../pipeline-registry/resolver.js';
import type {
  IssueLaunchBinding,
  IssueLaunchContext,
  IssuePipelineKnown,
  IssueStartRefusal,
  IssueStartRefusalCode,
  ResolveIssueLaunchBindingInput,
  ResolveIssueLaunchBindingResult,
} from './types.js';

/** The honest default registry test: package + user layers, cwd-independent. */
const defaultPipelineKnown: IssuePipelineKnown = (name) =>
  listPipelines().includes(name.replace(/\.ya?ml$/, ''));

/** A node's dependency observations decide work-complete, never `blockedBy`. */
function workComplete(observation: IssueNodeObservation | undefined): boolean {
  return observation === 'finalized' || observation === 'run-terminal';
}

interface NodeView {
  readonly node: ExecutionPlanNode;
  readonly status: IssueNodeStatus | undefined;
}

function isChange(node: ExecutionPlanNode): node is ExecutionPlanChangeNode {
  return node.kind === 'change';
}

/**
 * Whether the plan still wants a node's work: `required` (the absent default)
 * or `optional`. `cancelled`/`superseded` nodes are outside the execution
 * graph — never frontier candidates, never launchable.
 */
function isWanted(node: ExecutionPlanNode): boolean {
  return isChange(node) && (node.lifecycle === undefined || node.lifecycle === 'required' || node.lifecycle === 'optional');
}

/**
 * One non-terminal dependency as a refusal names it (issue-cross-project-gating
 * D1): node id, target project, and observed state, composed from the
 * projection facts the resolver already holds — the state read through the
 * same refinement vocabulary the node line uses (`issueBlockerState`), so
 * "never started here" and "unreadable, here is why" are named, never guessed.
 * The target project comes from the revision node itself, the fact one hop
 * before its projection copy. The gate rules are untouched: this names what
 * they refuse on.
 */
function blockerName(dep: string, byId: Map<string, NodeView>): string {
  const view = byId.get(dep);
  if (view === undefined) {
    return `${dep} (${issueBlockerState(undefined)})`;
  }
  return `${dep}@${view.node.projectId} (${issueBlockerState(view.status)})`;
}

function refuse(
  code: IssueStartRefusalCode,
  message: string,
  extra: Partial<Omit<IssueStartRefusal, 'code' | 'message'>> = {}
): ResolveIssueLaunchBindingResult {
  return {
    ok: false,
    refusal: {
      code,
      message,
      candidates: [],
      blockers: [],
      preparation: null,
      diagnostic: null,
      ...extra,
    },
  };
}

/**
 * The actionable half of a refusal, for the CLI's `Fix:` line. `unprepared`
 * carries the exact preparation command as its fix — the two-step pair
 * machinery stays the sanctioned writer of bindings. A launch-context failure
 * has none: its diagnostic already carries the composition's own repair.
 */
export function refusalFix(refusal: IssueStartRefusal): string | undefined {
  switch (refusal.code) {
    case 'issue_start_requires_plan':
      return 'Publish an Execution Plan revision first: '
        + '`rasen store issue plan <issue-id> --store <store> --from-file <nodes.yaml>`.';
    case 'issue_start_frontier_ambiguous':
      return 'Re-run with `--node <node-id>` naming one runnable node.';
    case 'issue_start_node_not_runnable':
      return refusal.blockers.length > 0
        ? 'Complete the named dependencies’ work (terminal run-state or finalized evidence), then re-run.'
        : 'Address the node state named above, then re-run.';
    case 'issue_start_node_cancelled':
    case 'issue_start_node_superseded':
      return 'The plan does not want this node’s work. Start a wanted node, or re-publish a revision whose lifecycle wants it.';
    case 'issue_start_unprepared':
      return refusal.preparation ?? undefined;
    case 'issue_start_pipeline_conflict':
      return 'Re-run with the recorded pipeline, or omit `--pipeline` to resume as recorded.';
    case 'issue_start_pipeline_unknown':
      return 'List known pipelines with `rasen pipeline list`, then re-run with a known `--pipeline`.';
    default:
      return undefined;
  }
}

/** The exact two-step preparation that creates the missing binding (D4). */
function preparationLine(
  input: ResolveIssueLaunchBindingInput,
  node: ExecutionPlanChangeNode,
  alias: string | null
): string {
  const store = input.storeId ?? '<store-id>';
  const change = alias ?? '<change-alias>';
  return `rasen store workspace plan --existing-change --store ${store} `
    + `--project ${node.projectId} --target-line ${node.targetLineId} --change ${change}`;
}

/**
 * Design D4's fixed route order. Returns the composed context, or the refusal
 * that says which route failed and why — an unprepared refusal names the
 * preparation, every other failure carries its own diagnostic.
 */
async function resolveLaunchRoute(
  input: ResolveIssueLaunchBindingInput,
  node: ExecutionPlanChangeNode,
  alias: string | null
): Promise<
  | { readonly kind: 'context'; readonly context: IssueLaunchContext }
  | { readonly kind: 'refused'; readonly refusal: IssueStartRefusal }
> {
  // Route 1 — the workspace pair: the machine-local map from Change instance
  // to execution root. Several entries for one instance are named, never
  // averaged: no implicit choice is made on the operator's behalf.
  const entries = input.workspaceEntries.filter(
    entry => entry.changeInstanceId === node.changeInstanceId
  );
  if (entries.length > 1) {
    const named = entries
      .map(entry => `${entry.changeId}@${entry.planningScopeId} -> ${entry.execution.root}`)
      .join('; ');
    return {
      kind: 'refused',
      refusal: {
        code: 'issue_start_launch_context_failed',
        message: `${entries.length} workspace index entries record Change instance ${node.changeInstanceId}: ${named}. None is chosen implicitly.`,
        candidates: [],
        blockers: [],
        preparation: null,
        diagnostic: named,
      },
    };
  }
  if (entries.length === 1) {
    const entry = entries[0] as (typeof entries)[number];
    return {
      kind: 'context',
      context: {
        form: 'workspace-pair',
        cwd: entry.execution.root,
        // The pair's planning worktree IS the Store-side planning root bound
        // to this Change — the index records it, so this route needs no
        // machine project registry.
        attachedRoots: [entry.planning.root],
      },
    };
  }

  // Route 2 — the member-project checkout through the session-launch
  // composition: member-project cwd, Store planning root attached, membership
  // vouched by the Store's own record, checkout identity checked. A refusal
  // for membership or identity carries the composition's own diagnostic
  // through unchanged; a project with no registered checkout at all is the
  // unprepared state route 3 names the preparation for.
  const composed = await input.launchContextFor(node.projectId);
  if (composed.ok) {
    return {
      kind: 'context',
      context: {
        form: 'project-checkout',
        cwd: composed.context.cwd,
        attachedRoots: [...composed.context.attachedRoots],
      },
    };
  }
  if (composed.code === 'execution_not_found') {
    return {
      kind: 'refused',
      refusal: {
        code: 'issue_start_unprepared',
        message: `Change instance ${node.changeInstanceId} (alias ${alias ?? '(none)'}) has neither a workspace index entry nor a resolvable member-project checkout for project ${node.projectId}.`,
        candidates: [],
        blockers: [],
        preparation: preparationLine(input, node, alias),
        diagnostic: null,
      },
    };
  }
  return {
    kind: 'refused',
    refusal: {
      code: 'issue_start_launch_context_failed',
      message: `The session-launch composition refused project ${node.projectId}: ${composed.message}`,
      candidates: [],
      blockers: [],
      preparation: null,
      diagnostic: composed.message,
    },
  };
}

/**
 * Resolve one Issue's launch binding. Same inputs, same result: the only
 * machine interaction is the injected `launchContextFor`, and everything else
 * is a pure derivation over the inputs.
 */
export async function resolveIssueLaunchBinding(
  input: ResolveIssueLaunchBindingInput
): Promise<ResolveIssueLaunchBindingResult> {
  const detail = input.detail;
  const plan = detail.plan;
  if (plan === null || plan.revision === null) {
    return refuse(
      'issue_start_requires_plan',
      `Issue ${detail.issue.issueId} has no readable published Execution Plan revision; `
        + 'the planning phase and its publish action precede execution.'
    );
  }

  const byId = new Map<string, NodeView>(
    plan.revision.nodes.map(node => [
      node.nodeId,
      { node, status: input.status.nodes.find(status => status.nodeId === node.nodeId) },
    ])
  );

  // `--pipeline` is validated before anything else touches it: an unknown
  // name is refused regardless of what the frontier looks like.
  if (input.pipeline !== undefined) {
    const known = input.pipelineKnown ?? defaultPipelineKnown;
    if (!known(input.pipeline)) {
      return refuse(
        'issue_start_pipeline_unknown',
        `Pipeline '${input.pipeline}' is not known to the pipeline registry.`
      );
    }
  }

  let addressed: ExecutionPlanNode | undefined;
  if (input.nodeId !== undefined) {
    addressed = plan.revision.nodes.find(node => node.nodeId === input.nodeId);
    if (addressed === undefined) {
      const ids = plan.revision.nodes.map(node => node.nodeId).join(', ');
      return refuse(
        'issue_start_node_not_runnable',
        `No node '${input.nodeId}' exists in revision ${plan.revision.revisionId}; `
          + `the plan's nodes are: ${ids}.`
      );
    }
    if (!isChange(addressed)) {
      return refuse(
        'issue_start_node_not_runnable',
        `Node '${addressed.nodeId}' is an intent node; a Change must exist for it before it can run.`
      );
    }
    // A node the plan no longer wants is refused before any launch machinery
    // runs, naming the lifecycle and the recorded reason: the plan, not the
    // flag, says whose work may start.
    if (addressed.lifecycle === 'cancelled' || addressed.lifecycle === 'superseded') {
      const reason = addressed.reason === undefined ? '' : `: ${addressed.reason}`;
      return refuse(
        addressed.lifecycle === 'cancelled'
          ? 'issue_start_node_cancelled'
          : 'issue_start_node_superseded',
        `Node '${addressed.nodeId}' is ${addressed.lifecycle}${reason} — the plan says its work is not wanted; no launch contract is emitted.`
      );
    }
  } else {
    // The frontier IS the ready set (issue-ready-set-scheduling D2): one
    // derivation — `deriveIssueReadySet` over the projection — feeds this
    // gate, the confirm composition, and the `ready` read verb, so the three
    // surfaces cannot drift about what may run now. Membership is exactly the
    // old `isRunnable` clause over projection-consistent facts: wanted,
    // not-started, every dependency's observed work complete — `unknown`
    // dependencies stay non-terminal, so an unreadable dependency is never
    // proof its work completed.
    const ready = deriveIssueReadySet(input.status);
    const memberIds = new Set(
      ready === null ? [] : ready.members.map(member => member.nodeId)
    );
    const candidates = [...byId.values()].filter(view => memberIds.has(view.node.nodeId));
    if (candidates.length > 1) {
      const named = candidates.map(view => view.node.nodeId).sort().join(', ');
      return refuse(
        'issue_start_frontier_ambiguous',
        `${candidates.length} runnable nodes (${named}) — the command refuses to choose among them; `
          + 'name one with --node <node-id>.',
        { candidates: candidates.map(view => view.node.nodeId).sort() }
      );
    }
    if (candidates.length === 0) {
      // Name why, node by node: the refusal is the explanation, not a shrug.
      const reasons: string[] = [];
      for (const view of byId.values()) {
        if (!isChange(view.node)) {
          reasons.push(`${view.node.nodeId} is an intent node`);
          continue;
        }
        if (view.node.lifecycle === 'cancelled' || view.node.lifecycle === 'superseded') {
          const reason = view.node.reason === undefined ? '' : ` (${view.node.reason})`;
          reasons.push(`${view.node.nodeId} is ${view.node.lifecycle}${reason}`);
          continue;
        }
        const observation = view.status?.observation;
        if (workComplete(observation)) continue;
        if (observation === 'not-started') {
          const blockers = view.node.dependsOn
            .filter(dep => !workComplete(byId.get(dep)?.status?.observation))
            .map(dep => blockerName(dep, byId));
          reasons.push(`${view.node.nodeId} awaits ${blockers.join(', ')}`);
          continue;
        }
        reasons.push(`${view.node.nodeId} is ${observation ?? 'unobserved'}`);
      }
      if (reasons.length === 0) reasons.push('every Change node is already complete');
      return refuse(
        'issue_start_node_not_runnable',
        `No node of Issue ${detail.issue.issueId} is runnable: ${reasons.join('; ')}.`
      );
    }
    const chosen = candidates[0];
    if (chosen === undefined) {
      return refuse(
        'issue_start_node_not_runnable',
        `No node of Issue ${detail.issue.issueId} is runnable.`
      );
    }
    addressed = chosen.node;
  }

  const changeNode = addressed as ExecutionPlanChangeNode;
  const status = input.status.nodes.find(entry => entry.nodeId === changeNode.nodeId);
  const alias = status?.alias ?? changeNode.changeAlias ?? null;
  const recorded = status?.attribution.pipeline ?? null;

  const mode =
    workComplete(status?.observation)
      ? 'already-complete'
      : status?.observation === 'not-started'
        ? 'fresh'
        : 'already-running';

  if (mode === 'fresh') {
    // The observation rule names non-terminal dependencies, never the plan
    // read's archive-based `blockedBy` (design D3). Since
    // issue-cross-project-gating, each name carries the dependency's target
    // project and observed state — the same facts the node line shows, so a
    // cross-project wait names the member project it waits on.
    const blockers = changeNode.dependsOn.filter(
      dep => !workComplete(byId.get(dep)?.status?.observation)
    );
    if (blockers.length > 0) {
      return refuse(
        'issue_start_node_not_runnable',
        `Node '${changeNode.nodeId}' is not runnable: the work of ${blockers
          .map(dep => blockerName(dep, byId))
          .join(', ')} is not complete.`,
        { blockers: [...blockers] }
      );
    }
  }

  if (status?.observation === 'unknown') {
    return refuse(
      'issue_start_node_not_runnable',
      `Node '${changeNode.nodeId}' is unknown: ${status.diagnostic ?? 'its reference or run-state could not be read'}.`
    );
  }

  // A running pipeline is not renamed by a flag (design D5).
  if (
    mode === 'already-running' &&
    input.pipeline !== undefined &&
    recorded !== null &&
    input.pipeline !== recorded
  ) {
    return refuse(
      'issue_start_pipeline_conflict',
      `--pipeline '${input.pipeline}' disagrees with the pipeline '${recorded}' `
        + `the running node '${changeNode.nodeId}' records.`
    );
  }

  let launch: IssueLaunchContext | null = null;
  let launchDiagnostic: string | null = null;
  if (mode !== 'already-complete') {
    const route = await resolveLaunchRoute(input, changeNode, alias);
    if (route.kind === 'context') {
      launch = route.context;
    } else if (mode === 'fresh') {
      // A fresh launch without a binding has nowhere to run: refused.
      return { ok: false, refusal: route.refusal };
    } else {
      // The node is already running; its run-state location still orients the
      // resume, and the failure that left the contract without a working
      // directory is carried rather than swallowed.
      launchDiagnostic = route.refusal.diagnostic ?? route.refusal.message;
    }
  }

  // The pipeline chain, named by source. Fresh: `--pipeline` over the
  // run-state recording over the plan revision's suggestion (design D2 of
  // issue-autodecompose-review-flow) — a flag beating a suggestion does NOT
  // refuse, because manual selection is the fence; already-running: the
  // recorded pipeline leads exactly as before (an explicit disagreement was
  // already refused above); already-complete: no pipeline at all.
  let pipeline: string | null = null;
  let pipelineSource: IssueLaunchBinding['pipelineSource'] = null;
  if (mode === 'already-running') {
    if (recorded !== null) {
      pipeline = recorded;
      pipelineSource = 'run-state';
    } else if (input.pipeline !== undefined) {
      pipeline = input.pipeline;
      pipelineSource = 'operator';
    }
  } else if (mode === 'fresh') {
    if (input.pipeline !== undefined) {
      pipeline = input.pipeline;
      pipelineSource = 'operator';
    } else if (recorded !== null) {
      pipeline = recorded;
      pipelineSource = 'run-state';
    } else if (changeNode.suggestedPipeline !== undefined) {
      pipeline = changeNode.suggestedPipeline;
      pipelineSource = 'suggestion';
    }
  }

  return {
    ok: true,
    binding: {
      issueId: detail.issue.issueId,
      nodeId: changeNode.nodeId,
      changeInstanceId: changeNode.changeInstanceId,
      alias,
      projectId: changeNode.projectId,
      targetLineId: changeNode.targetLineId,
      launch,
      pipeline,
      pipelineSource,
      mode,
      runStatePath: status?.runStatePath ?? null,
      locatedBy: status?.locatedBy ?? null,
      ...(launchDiagnostic === null ? {} : { launchDiagnostic }),
    },
  };
}
