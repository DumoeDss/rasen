/**
 * In-memory new-draft hint (pipeline-canvas-edit design D6). "Assemble in
 * canvas" (PipelinesPage) and "Duplicate to edit" (a built-in's read-only
 * view) both navigate to the graph route for a not-yet-existing pipeline
 * name; a normal mount would fetch the detail and 404. This module-level
 * record — deliberately NOT persisted (no localStorage, no sessionStorage) —
 * is set just before navigating and consumed once on the destination page's
 * mount, so it mounts straight into edit mode with a draft instead of
 * fetching. Because it is in-memory only, a hard refresh of the unsaved
 * draft's URL loses the hint and degrades to the ordinary not-found view,
 * which offers its own recovery affordance (an empty-draft restart, not a
 * defintion-seeded one) — accepted per design D6.
 */
import type { WirePipelineDefinition } from '../api/types.js';

export interface PendingDraft {
  name: string;
  /** Present for "Duplicate to edit" (seeded from a built-in's definition); absent for a fresh "Assemble in canvas" draft. */
  definition?: WirePipelineDefinition;
}

let pending: PendingDraft | null = null;

export function setPendingDraft(draft: PendingDraft): void {
  pending = draft;
}

/** Consumes (clears) the pending draft if its name matches; returns null otherwise. */
export function consumePendingDraft(name: string): PendingDraft | null {
  if (pending && pending.name === name) {
    const result = pending;
    pending = null;
    return result;
  }
  return null;
}
