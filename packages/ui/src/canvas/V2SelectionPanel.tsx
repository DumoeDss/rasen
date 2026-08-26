/**
 * Selection summary panel for a multi-selection (canvas-multi-selection
 * design D6). The ONLY panel the multi state opens: it states how many nodes
 * and connections are selected, names the selected node kinds, and offers
 * one delete action wired to the page's shared batch-removal path — the same
 * path the Delete key takes. It renders and decides nothing beyond that:
 * `selectionPanelMode` in `draft.ts` is the single owner of "which panel
 * does this selection open", and `removeV2Nodes` owns every deletion rule;
 * both refusals and the pair co-deletion surface through the caller's toast,
 * not here. Reuses the `.stage-panel` class so it inherits the same
 * constrained, independently scrolling treatment as its sibling panels.
 */
export function V2SelectionPanel({
  nodeCount,
  connectionCount,
  nodeKinds,
  title = 'Selection',
  onDelete,
  onPackage,
  packageRefusals,
  onClose,
}: {
  nodeCount: number;
  connectionCount: number;
  /** Selected node kinds with per-kind counts, e.g. `AtomicStage × 2` — empty in the v1 editor, whose stages carry no node kinds. */
  nodeKinds: readonly string[];
  /** Panel heading — the v2 default 'Selection'; the page passes 'Selected stages' for the v1 stage editor (review t1). */
  title?: string;
  onDelete: () => void;
  /**
   * Package-into-reusable-block action (canvas-subgraph-extraction design D4).
   * Provided ONLY when the model's refusal list is empty — the page decides,
   * from `subgraphExtractionRefusals`, whether the action is offered at all;
   * this panel renders the button and nothing else.
   */
  onPackage?: () => void;
  /** The model's refusal strings, rendered as muted text — why the selection cannot be packaged right now. */
  packageRefusals?: readonly string[];
  onClose: () => void;
}) {
  return (
    <aside
      class="stage-panel v2-selection-panel"
      data-testid="v2-selection-panel"
      data-node-count={nodeCount}
      data-connection-count={connectionCount}
    >
      <div class="stage-panel__header">
        <h3 class="stage-panel__title">{title}</h3>
        <button
          type="button"
          class="stage-panel__close"
          aria-label="Close selection summary"
          onClick={onClose}
        >
          ×
        </button>
      </div>

      <p class="stage-panel__muted" data-testid="v2-selection-panel-counts">
        {nodeCount} node{nodeCount === 1 ? '' : 's'}
        {connectionCount > 0
          ? ` · ${connectionCount} connection${connectionCount === 1 ? '' : 's'}`
          : ''}
      </p>
      {nodeKinds.length > 0 && (
        <p class="stage-panel__muted" data-testid="v2-selection-panel-kinds">
          {nodeKinds.join(', ')}
        </p>
      )}

      {onPackage && (
        <button
          type="button"
          class="btn--primary"
          data-testid="v2-selection-panel-package"
          onClick={onPackage}
        >
          Package into reusable block
        </button>
      )}
      {packageRefusals && packageRefusals.length > 0 && (
        <div data-testid="v2-selection-panel-refusals">
          {packageRefusals.map((refusal, index) => (
            // Keyed by INDEX: two refusal strings can be byte-identical (a
            // stage under two consultation bindings emits one per binding,
            // same message), and a string key would duplicate (review m1).
            <p class="stage-panel__muted" key={index}>
              {refusal}
            </p>
          ))}
        </div>
      )}

      <button
        type="button"
        class="btn--danger"
        data-testid="v2-selection-panel-delete"
        onClick={onDelete}
      >
        Delete selection
      </button>
    </aside>
  );
}
