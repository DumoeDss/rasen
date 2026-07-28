import type { PipelineCatalogSkill } from '../api/types.js';
import type { V2EditableNodeKind } from './draft.js';

/** The DnD payload MIME type carrying a dragged skill's catalog entry. */
export const PALETTE_DND_TYPE = 'application/rasen-pipeline-skill';

/**
 * The assembly palette. Version 1 keeps the established draggable skill
 * vocabulary; version 2 exposes only the four root node kinds this Definition
 * slice can mutate. AtomicStage is unavailable until the trusted catalog
 * supplies an exact capability revision.
 */
export function PalettePanel({
  skills,
  loading,
  definitionVersion = 1,
  onAddV2Node,
}: {
  skills: PipelineCatalogSkill[] | null;
  loading: boolean;
  definitionVersion?: 1 | 2;
  onAddV2Node?: (kind: V2EditableNodeKind) => void;
}) {
  function onDragStart(event: DragEvent, skill: PipelineCatalogSkill) {
    if (!event.dataTransfer) return;
    event.dataTransfer.setData(PALETTE_DND_TYPE, JSON.stringify(skill));
    event.dataTransfer.effectAllowed = 'move';
  }

  return (
    <aside class="palette-panel" data-testid="palette-panel">
      <h3 class="palette-panel__title">
        {definitionVersion === 2 ? 'Root nodes' : 'Skills'}
      </h3>
      {loading && (
        <p class="palette-panel__loading" data-testid="palette-loading">
          Loading catalog…
        </p>
      )}
      {definitionVersion === 2 && (
        <div class="palette-panel__list" data-testid="v2-palette">
          {(['AtomicStage', 'Gate', 'Choice', 'Finish'] as const).map((kind) => {
            const disabled =
              kind === 'AtomicStage' &&
              !(skills ?? []).some(
                (skill) => skill.enabled && skill.capability !== undefined
              );
            return (
              <button
                key={kind}
                type="button"
                class="palette-card"
                data-testid={`v2-palette-add-${kind}`}
                disabled={disabled}
                onClick={() => onAddV2Node?.(kind)}
              >
                {kind}
              </button>
            );
          })}
        </div>
      )}
      {definitionVersion === 1 && !loading && (skills ?? []).length === 0 && (
        <p class="palette-panel__empty">No skills installed.</p>
      )}
      {definitionVersion === 1 && (
        <div class="palette-panel__list">
          {(skills ?? []).map((skill) => (
            <div
              key={skill.id}
              class={`palette-card${skill.enabled ? '' : ' palette-card--disabled'}`}
              data-testid="palette-card"
              data-skill={skill.id}
              data-enabled={skill.enabled}
              draggable={skill.enabled}
              title={
                skill.enabled
                  ? skill.description
                  : `${skill.description} — disabled in this profile`
              }
              onDragStart={(event) =>
                skill.enabled
                  ? onDragStart(event as unknown as DragEvent, skill)
                  : event.preventDefault()
              }
            >
              <span class="palette-card__id">{skill.id}</span>
              {!skill.enabled && (
                <span
                  class="palette-card__state"
                  data-testid="palette-card-disabled-state"
                >
                  disabled
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}
