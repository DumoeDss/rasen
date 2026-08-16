import type { PipelineCatalogSkill } from '../api/types.js';
import {
  isBindableSkill,
  V2_ROOT_PALETTE_GESTURES,
  type V2RootGesture,
} from './draft.js';

/** The DnD payload MIME type carrying a dragged skill's catalog entry. */
export const PALETTE_DND_TYPE = 'application/rasen-pipeline-skill';

const GESTURE_LABEL: Record<V2RootGesture, string> = {
  stage: 'Stage',
  parallel: 'Parallel',
  loop: 'Loop',
  finish: 'Finish',
};

/**
 * The assembly palette. Version 1 keeps the established draggable skill
 * vocabulary; version 2 offers the four author gestures (design D2/D3) —
 * Stage, Parallel, Loop, Finish — rather than the Definition's eight raw
 * node kinds. The panel renders and decides nothing: which gestures are
 * available is decided entirely by the caller's `disabledGestures`
 * (`unavailableRootGestures()` in `draft.ts`), read here and nowhere
 * recomputed.
 */
export function PalettePanel({
  skills,
  loading,
  definitionVersion = 1,
  disabledGestures,
  onAddGesture,
  onAddStage,
}: {
  skills: PipelineCatalogSkill[] | null;
  loading: boolean;
  definitionVersion?: 1 | 2;
  /** Gestures the current draft cannot accept right now (`unavailableRootGestures`). */
  disabledGestures?: readonly V2RootGesture[];
  /** Parallel / Loop / Finish — gestures that take no further author input. */
  onAddGesture?: (gesture: 'parallel' | 'loop' | 'finish') => void;
  /** Stage — the author picks which installed skill's capability to bind. */
  onAddStage?: (capability: { id: string; version: string }) => void;
}) {
  function onDragStart(event: DragEvent, skill: PipelineCatalogSkill) {
    if (!event.dataTransfer) return;
    event.dataTransfer.setData(PALETTE_DND_TYPE, JSON.stringify(skill));
    event.dataTransfer.effectAllowed = 'move';
  }

  return (
    <aside class="palette-panel" data-testid="palette-panel">
      <h3 class="palette-panel__title">
        {definitionVersion === 2 ? 'Gestures' : 'Skills'}
      </h3>
      {loading && (
        <p class="palette-panel__loading" data-testid="palette-loading">
          Loading catalog…
        </p>
      )}
      {definitionVersion === 2 && (
        <div class="palette-panel__list" data-testid="v2-palette">
          {V2_ROOT_PALETTE_GESTURES.map((gesture) => {
            const unavailable = (disabledGestures ?? []).includes(gesture);
            if (gesture === 'stage') {
              return (
                <div
                  key="stage"
                  class="palette-panel__gesture-group"
                  data-testid="v2-palette-gesture-stage"
                >
                  <div class="palette-panel__gesture-label">Stage</div>
                  {unavailable && (
                    <p class="palette-panel__empty">
                      No enabled exact capability revision is available.
                    </p>
                  )}
                  {!unavailable &&
                    (skills ?? []).map((skill) => {
                      // One rule, owned by `draft.ts` — the same predicate the
                      // page's `exactCapabilities()` reads to decide whether the
                      // Stage gesture is offered at all. The panel decides
                      // nothing (see this component's doc comment).
                      const skillDisabled = !isBindableSkill(skill);
                      // The state is NAMED on screen, not only in a `title`
                      // tooltip: a tooltip is not a visible state, and the
                      // requirement is that a skill which cannot be placed says
                      // so. Mirrors the v1 branch's `palette-card__state` span
                      // below, but distinguishes the two reasons a skill is
                      // unplaceable because the requirement names both.
                      const stateLabel = !skill.enabled
                        ? 'disabled'
                        : 'no exact capability';
                      return (
                        <button
                          key={skill.id}
                          type="button"
                          class={`palette-card${skillDisabled ? ' palette-card--disabled' : ''}`}
                          data-testid={`v2-palette-gesture-stage-${skill.id}`}
                          disabled={skillDisabled}
                          title={
                            skillDisabled
                              ? `${skill.description} — ${
                                  !skill.enabled
                                    ? 'disabled in this profile'
                                    : 'no exact capability revision'
                                }`
                              : skill.description
                          }
                          onClick={() => skill.capability && onAddStage?.(skill.capability)}
                        >
                          <span class="palette-card__id">{skill.id}</span>
                          {skillDisabled && (
                            <span
                              class="palette-card__state"
                              data-testid="palette-card-disabled-state"
                              data-skill={skill.id}
                            >
                              {stateLabel}
                            </span>
                          )}
                        </button>
                      );
                    })}
                </div>
              );
            }
            return (
              <button
                key={gesture}
                type="button"
                class="palette-card"
                data-testid={`v2-palette-gesture-${gesture}`}
                disabled={unavailable}
                onClick={() => onAddGesture?.(gesture)}
              >
                {GESTURE_LABEL[gesture]}
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
