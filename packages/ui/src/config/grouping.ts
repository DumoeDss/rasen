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
 * order. The config page settles at exactly these four tabs — the interim
 * Workflow tab is gone. The Workflow, Autopilot, and Pipelines groups no longer
 * render here at all (see {@link EXCLUDED_GROUPS}): those keys are owned by the
 * Pipelines page. Any OTHER registry group not named here still falls into the
 * trailing {@link OTHER_TAB} bucket so no key can silently vanish.
 */
export const TAB_MAP: ReadonlyArray<{ tab: string; groups: readonly string[] }> = [
  { tab: 'General', groups: ['Profile', 'Appearance', 'Behavior'] },
  { tab: 'Project', groups: ['Project', 'Archive'] },
  { tab: 'Privacy', groups: ['Telemetry'] },
  { tab: 'Advanced', groups: ['Advanced'] },
];

/**
 * Registry groups the config page deliberately does NOT render (design D5): the
 * Pipelines page claims them (the role-matrix Defaults table + per-pipeline
 * gate/model/handoff/runtime overrides). Excluded before the trailing bucket so
 * they don't reappear there.
 */
export const EXCLUDED_GROUPS: ReadonlySet<string> = new Set(['Workflow', 'Autopilot', 'Pipelines']);

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
 *
 * In Local mode the `Profile` group's raw rows (the `profile` lock and the
 * `workflows` selection) are excluded (ui-profile-workflow-split config-ui-package
 * spec, design D7): a space's profile is chosen through the Project tab's
 * Profile selector instead. Since `profile`/`workflows` are the only
 * project-scope keys in the General tab's groups, the General tab then has no
 * locally-visible entries and disappears via the empty-tab omission rule. Global
 * mode keeps the rows.
 */
export function tabbedEntries(
  entries: WireConfigEntry[],
  mode: ConfigMode,
  spaceType: SpaceType
): TabbedEntries[] {
  const visible = entries.filter((e) => isVisibleInMode(e, mode, spaceType));
  const hideRawProfileRows = mode === 'local';
  const tabs: TabbedEntries[] = [];

  for (const { tab, groups } of TAB_MAP) {
    const tabGroups: GroupedEntries[] = [];
    for (const group of groups) {
      if (hideRawProfileRows && group === 'Profile') continue;
      const groupEntries = visible.filter((e) => e.definition.group === group);
      if (groupEntries.length > 0) tabGroups.push({ group, entries: groupEntries });
    }
    if (tabGroups.length > 0) tabs.push({ tab, groups: tabGroups });
  }

  const unmapped = visible.filter(
    (e) => !MAPPED_GROUPS.has(e.definition.group) && !EXCLUDED_GROUPS.has(e.definition.group)
  );
  if (unmapped.length > 0) {
    tabs.push({ tab: OTHER_TAB, groups: groupEntries(unmapped) });
  }

  return tabs;
}
