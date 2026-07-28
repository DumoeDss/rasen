/** Frozen exact identifiers used only for upgrade normalization and cleanup. */
export const RETIRED_EDIT_BOUNDARY_EXPERT_IDS = [
  'freeze',
  'guard',
  'unfreeze',
] as const;

export const RETIRED_EDIT_BOUNDARY_SKILL_DIRS = [
  'rasen-freeze',
  'rasen-guard',
  'rasen-unfreeze',
] as const;

const RETIRED_IDS = new Set<string>(RETIRED_EDIT_BOUNDARY_EXPERT_IDS);

export function isRetiredEditBoundaryExpertId(value: string): boolean {
  return RETIRED_IDS.has(value);
}

export function normalizeRetiredEditBoundaryExpertIds(
  ids: readonly string[]
): string[] {
  return ids.filter((id) => !isRetiredEditBoundaryExpertId(id));
}
