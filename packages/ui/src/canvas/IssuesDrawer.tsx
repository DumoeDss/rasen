import type { PipelineValidationIssue, WirePipelineDefinition } from '../api/types.js';
import { issuePathTarget } from './draft.js';

/**
 * The validation issues drawer (pipeline-canvas-edit design D5): every issue
 * the server's dry-run validation returned, severity-tagged, with a
 * click-to-select-the-stage affordance when its `path` maps onto a draft
 * stage. Issues whose path does not resolve to a stage (pipeline-level, or an
 * unrecognized locator) still render here — never dropped.
 */
export function IssuesDrawer({
  issues,
  draft,
  onSelectStage,
}: {
  issues: PipelineValidationIssue[];
  draft: WirePipelineDefinition;
  onSelectStage: (stageId: string) => void;
}) {
  if (issues.length === 0) return null;

  return (
    <div class="issues-drawer" data-testid="issues-drawer">
      <h4 class="issues-drawer__title">Issues ({issues.length})</h4>
      <ul class="issues-drawer__list">
        {issues.map((issue, i) => {
          const target = issuePathTarget(issue.path, draft.stages.length);
          const stageId = target ? draft.stages[target.stageIndex]?.id : undefined;
          return (
            <li
              key={`${issue.path}-${i}`}
              class={`issues-drawer__item issues-drawer__item--${issue.severity}`}
              data-testid="issues-drawer-item"
              data-severity={issue.severity}
            >
              <span class="issues-drawer__severity">{issue.severity}</span>
              <span class="issues-drawer__message">{issue.message}</span>
              {stageId ? (
                <button
                  type="button"
                  class="issues-drawer__select"
                  data-testid="issues-drawer-select"
                  onClick={() => onSelectStage(stageId)}
                >
                  {stageId} →
                </button>
              ) : (
                <span class="issues-drawer__path" data-testid="issues-drawer-unmapped">
                  {issue.path || '(pipeline)'}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
