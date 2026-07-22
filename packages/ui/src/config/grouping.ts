/**
 * Pure grouping/ordering logic for the config page (design.md D6). Kept
 * separate from rendering so it is testable without a DOM (design.md D9).
 */
import type { WireConfigEntry } from '../api/types.js';
import { isVisibleInMode, type ConfigMode, type SpaceType } from './controls.js';

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

/**
 * The tab layout (design D2): registry groups mapped to page tabs, in tab
 * order. The `Workflow` tab is interim — it carries the Workflow and Autopilot
 * groups (with the gates inventory) exactly as they render today, until W3
 * moves them to the pipeline surface. Any registry group not named here falls
 * into the trailing {@link OTHER_TAB} bucket so no key can silently vanish.
 */
export const TAB_MAP: ReadonlyArray<{ tab: string; groups: readonly string[] }> = [
  { tab: 'General', groups: ['Profile', 'Appearance', 'Behavior'] },
  { tab: 'Project', groups: ['Project', 'Archive'] },
  { tab: 'Privacy', groups: ['Telemetry'] },
  { tab: 'Advanced', groups: ['Advanced'] },
  { tab: 'Workflow', groups: ['Workflow', 'Autopilot'] },
];

/** The trailing bucket tab for any registry group not claimed by {@link TAB_MAP}. */
export const OTHER_TAB = 'Other';

export interface TabbedEntries {
  tab: string;
  groups: GroupedEntries[];
}

const MAPPED_GROUPS = new Set(TAB_MAP.flatMap((t) => [...t.groups]));

/**
 * Groups entries into scope-filtered tabs (design D2). Entries are first
 * filtered to those visible in the active mode, then bucketed by
 * {@link TAB_MAP} (each group's entries kept in registry order); a tab with no
 * visible entries is omitted, and any group outside the map lands in a
 * trailing {@link OTHER_TAB} bucket (groups there ordered by {@link groupEntries}).
 * Pure — no DOM, no registry-count assumptions (portfolio rule).
 */
export function tabbedEntries(
  entries: WireConfigEntry[],
  mode: ConfigMode,
  spaceType: SpaceType
): TabbedEntries[] {
  const visible = entries.filter((e) => isVisibleInMode(e, mode, spaceType));
  const tabs: TabbedEntries[] = [];

  for (const { tab, groups } of TAB_MAP) {
    const tabGroups: GroupedEntries[] = [];
    for (const group of groups) {
      const groupEntries = visible.filter((e) => e.definition.group === group);
      if (groupEntries.length > 0) tabGroups.push({ group, entries: groupEntries });
    }
    if (tabGroups.length > 0) tabs.push({ tab, groups: tabGroups });
  }

  const unmapped = visible.filter((e) => !MAPPED_GROUPS.has(e.definition.group));
  if (unmapped.length > 0) {
    tabs.push({ tab: OTHER_TAB, groups: groupEntries(unmapped) });
  }

  return tabs;
}
