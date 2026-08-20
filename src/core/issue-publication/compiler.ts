/**
 * The pure portfolio-state → plan-node-inputs compile (design D2/D6).
 *
 * A portfolio child's `id` IS the semantic Change name and IS the change
 * directory name (orchestration playbook Step G.7); scheduling ids live in
 * optional metadata and never enter it. The compile therefore produces, per
 * child, exactly:
 *
 *   - `nodeId` = the child id,
 *   - `changeAlias` = the child id (so the projection's run-state locator keys
 *     on the human-meaningful name when a reference later stops resolving),
 *   - `dependsOn` carried VERBATIM from the child's edges.
 *
 * Everything else a change node needs (project, target line, Change instance)
 * is committed identity the run-state does not carry; `resolution.ts` supplies
 * it from Store evidence. And nothing the run-state says beyond the DAG is
 * compiled at all: no child `status`, `pipeline`, `cohort`, `mode`, `note`, no
 * parent-level `delivery`/`planner`/`tier` — the plan node schema has no field
 * for them, and what a revision should say about node lifecycle is g-002's
 * decision, not this channel's (design D6).
 */
import type { PortfolioState } from '../pipeline-registry/portfolio-state.js';
import type { ExecutionPlanChangeNodeInput } from '../store/issues/types.js';
import type { ResolvedChildIdentity } from './types.js';

/** One child as the plan will name it: the child id and its edges, nothing else. */
export interface PortfolioChildNode {
  readonly childId: string;
  readonly dependsOn: readonly string[];
}

/**
 * The child list as node skeletons. Pure: same state in, same skeletons out,
 * no filesystem, no Git, no clock.
 *
 * A duplicate child id is NOT refused here — `publishPlan`'s graph checker
 * refuses it as a duplicate node with its own named diagnostic, and a
 * portfolio-level re-implementation of that check would be a second opinion
 * the design explicitly declines (design D3).
 */
export function compilePortfolioChildren(state: PortfolioState): readonly PortfolioChildNode[] {
  return state.children.map(child => ({
    childId: child.id,
    dependsOn: [...child.dependsOn],
  }));
}

/** One skeleton joined with the committed identity its name resolved to. */
export function planNodeForChild(
  child: PortfolioChildNode,
  identity: ResolvedChildIdentity
): ExecutionPlanChangeNodeInput {
  return {
    nodeId: child.childId,
    kind: 'change',
    projectId: identity.projectId,
    targetLineId: identity.targetLineId,
    changeInstanceId: identity.changeInstanceId,
    changeAlias: child.childId,
    dependsOn: [...child.dependsOn],
  };
}
