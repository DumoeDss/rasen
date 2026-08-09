import type {
  PipelineValidationIssue,
  WirePipelineDefinition,
} from '../api/types.js';
import {
  definitionIssuePathTarget,
  type DefinitionIssueTarget,
} from './draft.js';

/** Lists every authoritative issue and navigates only paths the current draft can resolve. */
export function IssuesDrawer({
  issues,
  draft,
  onSelectTarget,
  onDismiss,
}: {
  issues: PipelineValidationIssue[];
  draft: WirePipelineDefinition;
  onSelectTarget: (
    target: DefinitionIssueTarget,
    severity: 'error' | 'warning'
  ) => void;
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
            Close
          </button>
        )}
      </div>
      <ul class="issues-drawer__list">
        {issues.map((issue, index) => {
          const target = definitionIssuePathTarget(draft, issue.path);
          const targetLabel = !target
            ? null
            : target.kind === 'definition'
              ? 'Definition'
              : target.kind === 'body-node' || target.kind === 'body-connection'
                ? `${target.declarationId} / ${target.id}`
                : target.id;
          return (
            <li
              key={`${issue.path}-${index}`}
              class={`issues-drawer__item issues-drawer__item--${issue.severity}`}
              data-testid="issues-drawer-item"
              data-severity={issue.severity}
              data-path={issue.path}
            >
              <span class="issues-drawer__severity">{issue.severity}</span>
              {issue.code && <code class="issues-drawer__code">{issue.code}</code>}
              <span class="issues-drawer__message">{issue.message}</span>
              <span
                class="issues-drawer__path"
                data-testid={target ? 'issues-drawer-path' : 'issues-drawer-unmapped'}
              >
                {issue.path || '(pipeline)'}
              </span>
              {(issue.related ?? []).length > 0 && (
                <ul class="issues-drawer__related" data-testid="issues-drawer-related">
                  {issue.related!.map((related, relatedIndex) => (
                    <li key={`${related.path}:${relatedIndex}`}>
                      <code>{related.path}</code> {related.message}
                    </li>
                  ))}
                </ul>
              )}
              {target && (
                <button
                  type="button"
                  class="issues-drawer__select"
                  data-testid="issues-drawer-select"
                  onClick={() => onSelectTarget(target, issue.severity)}
                >
                  {targetLabel} →
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
