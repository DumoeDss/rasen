import type { PipelineValidationIssue, WirePipelineDefinition } from '../api/types.js';
import { definitionIssuePathTarget } from './draft.js';

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
  onDismiss,
}: {
  issues: PipelineValidationIssue[];
  draft: WirePipelineDefinition;
  onSelectStage: (stageId: string) => void;
  /** Dismiss the drawer (clears the current issue list) — optional. */
  onDismiss?: () => void;
}) {
  if (issues.length === 0) return null;

  return (
    <div class="issues-drawer" data-testid="issues-drawer">
      <div class="issues-drawer__header">
        <h4 class="issues-drawer__title">Issues ({issues.length})</h4>
        {onDismiss && (
          <button
            type="button"
            class="issues-drawer__dismiss btn--ghost"
            data-testid="issues-drawer-dismiss"
            aria-label="Dismiss issues"
            onClick={onDismiss}
          >
            ✕
          </button>
        )}
      </div>
      <ul class="issues-drawer__list">
        {issues.map((issue, i) => {
          const target = definitionIssuePathTarget(draft, issue.path);
          const root =
            draft.version === 2 &&
            draft.root !== null &&
            typeof draft.root === 'object' &&
            !Array.isArray(draft.root)
              ? (draft.root as {
                  connections?: {
                    to?: { node?: unknown };
                  }[];
                })
              : {};
          const connections = Array.isArray(root.connections)
            ? root.connections
            : [];
          const consumingNode =
            target?.kind === 'connection'
              ? connections[target.index]?.to?.node
              : undefined;
          const stageId =
            target?.kind === 'node'
              ? target.id
              : typeof consumingNode === 'string'
                ? consumingNode
                : undefined;
          return (
            <li
              key={`${issue.path}-${i}`}
              class={`issues-drawer__item issues-drawer__item--${issue.severity}`}
              data-testid="issues-drawer-item"
              data-severity={issue.severity}
              data-path={issue.path}
            >
              <span class="issues-drawer__severity">{issue.severity}</span>
              <span class="issues-drawer__message">{issue.message}</span>
              {stageId && (
                <span class="issues-drawer__path" data-testid="issues-drawer-path">
                  {issue.path || '(pipeline)'}
                </span>
              )}
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
