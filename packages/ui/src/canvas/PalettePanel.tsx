import type { PipelineCatalogSkill } from '../api/types.js';

/** The DnD payload MIME type carrying a dragged skill's catalog entry. */
export const PALETTE_DND_TYPE = 'application/rasen-pipeline-skill';

/**
 * The left-hand assembly palette (pipeline-canvas-edit design D3): one card
 * per catalog skill, its description as a tooltip. A disabled skill (per the
 * catalog's `enabled: false`) is greyed and NOT draggable — a dropped disabled
 * skill guarantees a validation error, so the tooltip explains why instead of
 * letting the user find out server-side.
 */
export function PalettePanel({
  skills,
  loading,
}: {
  skills: PipelineCatalogSkill[] | null;
  loading: boolean;
}) {
  function onDragStart(event: DragEvent, skill: PipelineCatalogSkill) {
    if (!event.dataTransfer) return;
    event.dataTransfer.setData(PALETTE_DND_TYPE, JSON.stringify(skill));
    event.dataTransfer.effectAllowed = 'move';
  }

  return (
    <aside class="palette-panel" data-testid="palette-panel">
      <h3 class="palette-panel__title">Skills</h3>
      {loading && <p class="palette-panel__loading" data-testid="palette-loading">Loading catalog…</p>}
      {!loading && (skills ?? []).length === 0 && (
        <p class="palette-panel__empty">No skills installed.</p>
      )}
      <div class="palette-panel__list">
        {(skills ?? []).map((skill) => (
          <div
            key={skill.id}
            class={`palette-card${skill.enabled ? '' : ' palette-card--disabled'}`}
            data-testid="palette-card"
            data-skill={skill.id}
            data-enabled={skill.enabled}
            draggable={skill.enabled}
            title={skill.enabled ? skill.description : `${skill.description} — disabled in this profile`}
            onDragStart={(e) => (skill.enabled ? onDragStart(e as unknown as DragEvent, skill) : e.preventDefault())}
          >
            <span class="palette-card__id">{skill.id}</span>
            {!skill.enabled && (
              <span class="palette-card__state" data-testid="palette-card-disabled-state">
                disabled
              </span>
            )}
          </div>
        ))}
      </div>
    </aside>
  );
}
