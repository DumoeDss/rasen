import type { NodeId } from '../contracts.js';
import { deriveNodeId } from './identity.js';
import type { CanonicalRunRecord, CommittedAction } from './record.js';
import type {
  RuntimePlan,
  RuntimePlanBoundedLoopNode,
  RuntimePlanCompositeBody,
  RuntimePlanCompositeStage,
} from './runtime-plan.js';

/**
 * Descriptor for the next body stage to admit in a composite-body bounded loop.
 * Carries the same data the reconciler needs to emit an admit candidate:
 * nodeId, round, stage path, profile path, admission kind, and workspace.
 */
export interface CompositeBodyInvocationDescriptor {
  readonly loop: RuntimePlanBoundedLoopNode;
  readonly round: number;
  readonly stage: RuntimePlanCompositeStage;
  readonly hierarchicalPath: string;
  readonly nodeId: NodeId;
}

/**
 * Pure progress result for a composite-body bounded loop. Mirrors the
 * ReviewCycleProgress shape (ready|waiting|failed|clean|exhausted) so the
 * reconciler's bounded-loop pass switch logic is shared.
 */
export type CompositeBodyProgress =
  | Readonly<{
      kind: 'ready';
      next: CompositeBodyInvocationDescriptor;
    }>
  | Readonly<{
      kind: 'waiting';
      next: CompositeBodyInvocationDescriptor;
      action: CommittedAction;
    }>
  | Readonly<{
      kind: 'failed';
      next: CompositeBodyInvocationDescriptor;
      action: CommittedAction;
    }>
  | Readonly<{
      kind: 'clean';
      readonly outcome: string;
    }>
  | Readonly<{ kind: 'exhausted' }>;

/**
 * Derive the hierarchical path for a body stage in a specific iteration.
 * Format: `<loopPath>/round:<n>/<stageId>`
 */
export function compositeBodyStagePath(
  loopPath: string,
  round: number,
  stageHierarchicalPath: string
): string {
  // The stage's hierarchicalPath already includes the loop prefix
  // (root:<loopId>/<stageId>); we just need to add the round segment.
  // We insert /round:<n> before the stage id part.
  const slashIndex = stageHierarchicalPath.lastIndexOf('/');
  const stageId = slashIndex >= 0 ? stageHierarchicalPath.slice(slashIndex + 1) : stageHierarchicalPath;
  return `${loopPath}/round:${round}/${stageId}`;
}

function actionForNodeId(
  record: CanonicalRunRecord,
  nodeId: NodeId
): CommittedAction | undefined {
  return Object.values(record.actions).find(
    (action) => action.action.nodeId === nodeId
  );
}

/**
 * Pure function: determine the current state of a composite-body bounded loop.
 * Reads only the frozen plan and committed Record, just like
 * projectReviewCycleProgress.
 *
 * Algorithm:
 * 1. For each iteration (1..maxIterations), check each body stage in topo order.
 * 2. A stage is "succeeded" when a committed action with status 'succeeded'
 *    exists for its per-round nodeId.
 * 3. If all body stages in an iteration succeed, derive the iteration's outcome
 *    from the body's outcome map. If the outcome maps to 'continue', proceed to
 *    the next iteration. If it maps to an exit outcome, the loop is terminal
 *    (clean with that outcome).
 * 4. If a stage action is active (admitted but not completed), the loop is
 *    waiting.
 * 5. If a stage action failed, the loop is failed.
 * 6. If a stage has no action yet and its dependencies are satisfied, it's
 *    ready to admit.
 * 7. If maxIterations is reached without an exit, the loop is exhausted.
 */
export function projectCompositeBodyProgress(
  plan: RuntimePlan,
  loop: RuntimePlanBoundedLoopNode,
  record: CanonicalRunRecord
): CompositeBodyProgress {
  if (loop.body.kind !== 'composite') {
    throw new Error('projectCompositeBodyProgress called on non-composite body');
  }
  const body = loop.body;
  const succeededThisRound = new Set<string>();

  for (let round = 1; round <= loop.maxIterations; round += 1) {
    succeededThisRound.clear();

    for (const stage of body.stages) {
      const perRoundPath = compositeBodyStagePath(
        loop.hierarchicalPath,
        round,
        stage.hierarchicalPath
      );
      const perRoundNodeId = deriveNodeId(plan.runId, perRoundPath);
      const action = actionForNodeId(record, perRoundNodeId);

      if (action === undefined) {
        // No action yet. Check if dependencies are satisfied (all required
        // stages in this round have succeeded).
        const depsSatisfied = stage.requires.every((depNodeId) => {
          // depNodeId is the per-iteration nodeId from the plan. For the first
          // round, it's the flat nodeId. But we need to track per-round success.
          // Actually, the stage.requires in the plan are nodeIds of other body
          // stages (flat, not per-round). For per-round tracking, we need to
          // map them back to per-round paths.
          // The stage.requires contains plan nodeIds. We need to find the
          // stage whose nodeId matches, compute its per-round path, and check
          // if it's in succeededThisRound.
          const depStage = body.stages.find((s) => s.nodeId === depNodeId);
          if (depStage === undefined) return false;
          const depPath = compositeBodyStagePath(
            loop.hierarchicalPath,
            round,
            depStage.hierarchicalPath
          );
          return succeededThisRound.has(depPath);
        });

        if (!depsSatisfied) {
          // Still waiting on a dependency within this round; loop is waiting.
          // Find the dependency stage that's not done to check its state.
          const missingDep = body.stages.find((s) =>
            stage.requires.includes(s.nodeId) &&
            !succeededThisRound.has(
              compositeBodyStagePath(loop.hierarchicalPath, round, s.hierarchicalPath)
            )
          );
          if (missingDep !== undefined) {
            const depPath = compositeBodyStagePath(
              loop.hierarchicalPath,
              round,
              missingDep.hierarchicalPath
            );
            const depNodeId = deriveNodeId(plan.runId, depPath);
            const depAction = actionForNodeId(record, depNodeId);
            if (depAction !== undefined && depAction.result?.status === 'failed') {
              return Object.freeze({
                kind: 'failed',
                next: invocation(plan, loop, round, stage, perRoundPath),
                action: depAction,
              });
            }
          }
          // Not ready, not failed — must be waiting on something.
          // But actually, if the dep is succeeded, depsSatisfied would be true.
          // If deps are not satisfied and not failed, the dep must be active.
          // This is a waiting state.
          return Object.freeze({
            kind: 'waiting',
            next: invocation(plan, loop, round, stage, perRoundPath),
            action: actionForNodeId(
              record,
              deriveNodeId(
                plan.runId,
                compositeBodyStagePath(
                  loop.hierarchicalPath,
                  round,
                  (missingDep ?? body.stages[0])!.hierarchicalPath
                )
              )
            )!,
          });
        }

        // Dependencies satisfied — this stage is ready to admit.
        return Object.freeze({
          kind: 'ready',
          next: invocation(plan, loop, round, stage, perRoundPath),
        });
      }

      // Action exists.
      if (action.result === undefined || action.state === 'active') {
        // Action is active (admitted but not completed).
        return Object.freeze({
          kind: 'waiting',
          next: invocation(plan, loop, round, stage, perRoundPath),
          action,
        });
      }

      if (action.result.status === 'failed') {
        return Object.freeze({
          kind: 'failed',
          next: invocation(plan, loop, round, stage, perRoundPath),
          action,
        });
      }

      // Action succeeded.
      succeededThisRound.add(perRoundPath);
    }

    // All body stages in this iteration succeeded. Derive the body outcome
    // from the exit mapping: prefer the first outcome that maps to an 'exit'
    // action (the success/terminal path). If none exit, fall back to the
    // first declared outcome (which maps to 'continue').
    const exitOutcome = Object.entries(body.outcomes).find(
      ([, exitAction]) => exitAction !== 'continue'
    );
    const bodyOutcome = (exitOutcome?.[0] ?? Object.keys(body.outcomes)[0]) ?? 'done';
    const exitMapping = body.outcomes[bodyOutcome];

    if (exitMapping !== undefined && exitMapping !== 'continue') {
      // The outcome maps to an exit — loop is clean with this exit outcome.
      return Object.freeze({ kind: 'clean', outcome: exitMapping });
    }

    // Outcome maps to 'continue' — proceed to next iteration.
  }

  // maxIterations reached without an exit.
  return Object.freeze({ kind: 'exhausted' });
}

function invocation(
  plan: RuntimePlan,
  loop: RuntimePlanBoundedLoopNode,
  round: number,
  stage: RuntimePlanCompositeStage,
  hierarchicalPath: string
): CompositeBodyInvocationDescriptor {
  return Object.freeze({
    loop,
    round,
    stage,
    hierarchicalPath,
    nodeId: deriveNodeId(plan.runId, hierarchicalPath),
  });
}
