/**
 * External-effect ownership classification (tasks 6.11/6.12).
 *
 * An external effect (commit/ref/trailer, push lease, PR head/marker, archive
 * manifest/receipt) carries an ownership marker that credits the exact EffectId
 * whose operation produced it. The classifier answers: given the marker the
 * Adapter observed on the external resource, may THIS effect claim it?
 *
 * Credit is granted only to the exact EffectId. Two Runs on one resource see a
 * conflict; response loss re-queries to 'owned'; a tampered or attribution-less
 * marker on a present resource stays 'uncertain' — unprovable provider state is
 * never silently treated as success or as a fresh slot.
 */
export interface ObservedOwnershipMarker {
  readonly resourcePresent: boolean;
  readonly wellFormed: boolean;
  readonly creditedEffectId?: string;
}

export type OwnershipClassification =
  | 'new'
  | 'owned'
  | 'conflict'
  | 'uncertain';

export function classifyExternalOwnership(
  effectId: string,
  marker: ObservedOwnershipMarker
): OwnershipClassification {
  if (!marker.resourcePresent) {
    return 'new';
  }
  if (!marker.wellFormed) {
    return 'uncertain';
  }
  if (marker.creditedEffectId === undefined) {
    return 'uncertain';
  }
  if (marker.creditedEffectId === effectId) {
    return 'owned';
  }
  return 'conflict';
}
