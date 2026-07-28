import type { ComponentChildren } from 'preact';

/**
 * The shared page header (ui-component-system spec: "Every page SHALL open with
 * a common header pattern — the page title with the page-level actions aligned
 * in one toolbar row"). A serif title on the left, the page-level actions on
 * the right in one baseline-aligned row. Every top-level page (Board, Archive,
 * Config, Pipelines, Workflows) adopts it so actions live in a consistent
 * position; the single primary action per view is styled `.btn--primary` by the
 * caller.
 */
export function PageHeader({
  title,
  actions,
  testid,
}: {
  title: string;
  /** Page-level actions, rendered right-aligned in the toolbar row. */
  actions?: ComponentChildren;
  testid?: string;
}) {
  return (
    <div class="page-header" data-testid={testid}>
      <h2 class="page-header__title">{title}</h2>
      {actions && <div class="page-header__actions">{actions}</div>}
    </div>
  );
}
