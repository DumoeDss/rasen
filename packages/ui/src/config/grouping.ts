/**
 * Pure grouping/ordering logic for the config page (design.md D6). Kept
 * separate from rendering so it is testable without a DOM (design.md D9).
 */
import type { WireConfigEntry } from '../api/types.js';

/** Stable display order for registry groups — anything unrecognized sorts last, alphabetically. */
export const GROUP_ORDER = [
  'Autopilot',
  'Workflow',
  'Profile',
  'Behavior',
  'Telemetry',
  'Project',
  'Archive',
  'Advanced',
] as const;

export interface GroupedEntries {
  group: string;
  entries: WireConfigEntry[];
}

function groupRank(group: string): number {
  const index = (GROUP_ORDER as readonly string[]).indexOf(group);
  return index === -1 ? GROUP_ORDER.length : index;
}

/** Groups entries by `definition.group`, in the stable order above; unknown groups sort last alphabetically. */
export function groupEntries(entries: WireConfigEntry[]): GroupedEntries[] {
  const byGroup = new Map<string, WireConfigEntry[]>();
  for (const entry of entries) {
    const group = entry.definition.group;
    const bucket = byGroup.get(group);
    if (bucket) {
      bucket.push(entry);
    } else {
      byGroup.set(group, [entry]);
    }
  }

  return [...byGroup.entries()]
    .sort(([a], [b]) => {
      const rankDiff = groupRank(a) - groupRank(b);
      return rankDiff !== 0 ? rankDiff : a.localeCompare(b);
    })
    .map(([group, groupEntries]) => ({ group, entries: groupEntries }));
}
