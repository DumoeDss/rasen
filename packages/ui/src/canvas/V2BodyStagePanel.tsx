/**
 * Read-only facts for a body stage selected inside an expanded frame
 * (canvas-loop-body-visibility design D3): identity, kind, capability, and
 * the owning declaration — plus the honest note that body-stage EDITING is a
 * future change (no declaration-body mutation helpers exist yet; the loop's
 * contract lives in the declarations panel). Deliberately carries no
 * callbacks that mutate anything: the page's model owns every edit rule,
 * this panel renders what the declaration already says. Reuses the
 * `.stage-panel` treatment so it inherits the same constrained, independently
 * scrolling column as its sibling panels.
 */
export function V2BodyStagePanel({
  stageId,
  kind,
  capability,
  declarationId,
  frameId,
  onClose,
}: {
  stageId: string;
  kind: string;
  /** The AtomicStage capability binding (id + version), when the body stage carries one. */
  capability?: { id: string; version: string } | null;
  /** The declaration whose graph the stage lives in (the loop's body / the composite's target). */
  declarationId: string;
  /** The expanded frame (root node id) the stage was clicked inside. */
  frameId: string;
  onClose: () => void;
}) {
  return (
    <aside
      class="stage-panel v2-body-stage-panel"
      data-testid="v2-body-stage-panel"
      data-stage={stageId}
      data-declaration={declarationId}
      data-frame={frameId}
    >
      <div class="stage-panel__header">
        <h3 class="stage-panel__title">{stageId}</h3>
        <button
          type="button"
          class="stage-panel__close"
          aria-label="Close body stage"
          onClick={onClose}
        >
          ×
        </button>
      </div>

      <p class="stage-panel__muted" data-testid="v2-body-stage-panel-kind">
        {kind}
      </p>
      {capability && (
        <p class="stage-panel__muted" data-testid="v2-body-stage-panel-capability">
          capability: {capability.id} @ {capability.version}
        </p>
      )}
      <p class="stage-panel__muted" data-testid="v2-body-stage-panel-declaration">
        Body stage of declaration '{declarationId}', shown inside frame '{frameId}'.
      </p>
      <p class="stage-panel__muted" data-testid="v2-body-stage-panel-contract">
        The loop's contract is edited in the declarations panel.
      </p>
      <p class="stage-panel__muted" data-testid="v2-body-stage-panel-editing">
        Editing body stages here arrives in a future change.
      </p>
    </aside>
  );
}
