import { describe, expect, it } from 'vitest';
import { groupEntries, tabbedEntries, OTHER_TAB, TAB_MAP, EXCLUDED_GROUPS } from '../../src/config/grouping.js';
import { configListFixture } from '../fixtures/config-list.js';
import type { WireConfigEntry } from '../../src/api/types.js';

const entries: WireConfigEntry[] = configListFixture.entries;

describe('TAB_MAP', () => {
  it('settles at exactly the four final tabs, none of them Workflow', () => {
    expect(TAB_MAP.map((t) => t.tab)).toEqual(['General', 'Project', 'Privacy', 'Advanced']);
  });

  it('excludes the Workflow, Autopilot, and Pipelines groups (owned by the Pipelines page)', () => {
    expect([...EXCLUDED_GROUPS].sort()).toEqual(['Autopilot', 'Pipelines', 'Workflow']);
  });
});

describe('groupEntries', () => {
  it('groups entries by definition.group', () => {
    const groups = groupEntries(entries);
    const names = groups.map((g) => g.group);
    expect(new Set(names)).toEqual(
      new Set(['Profile', 'Behavior', 'Workflow', 'Telemetry', 'Autopilot'])
    );
  });

  it('orders known groups per the stable GROUP_ORDER (Autopilot and Workflow lead)', () => {
    const groups = groupEntries(entries);
    const names = groups.map((g) => g.group);
    expect(names).toEqual(['Autopilot', 'Workflow', 'Profile', 'Behavior', 'Telemetry']);
  });

  it('sorts unrecognized groups alphabetically after known ones', () => {
    const withExtra: WireConfigEntry[] = [
      ...entries,
      { ...entries[0]!, definition: { ...entries[0]!.definition, key: 'zzz.custom', group: 'Zeta' } },
      { ...entries[0]!, definition: { ...entries[0]!.definition, key: 'aaa.custom', group: 'Alpha' } },
    ];
    const names = groupEntries(withExtra).map((g) => g.group);
    expect(names.slice(-2)).toEqual(['Alpha', 'Zeta']);
  });

  it('keeps every entry within its group bucket', () => {
    const groups = groupEntries(entries);
    const total = groups.reduce((sum, g) => sum + g.entries.length, 0);
    expect(total).toBe(entries.length);
  });
});

/** A `schema`-like project/store-settable key in the non-excluded Project group. */
const projectSchemaEntry: WireConfigEntry = {
  ...entries[0]!,
  definition: {
    ...entries[0]!.definition,
    key: 'schema',
    group: 'Project',
    scopes: ['store', 'project'],
  },
};

describe('tabbedEntries', () => {
  it('maps registry groups to the final four tabs, filtered to the active mode (design D5)', () => {
    // Global mode at a project space: every global-scoped key is visible, but
    // the Workflow and Autopilot groups (handoff.threshold, autopilot.gates)
    // are excluded — those keys are owned by the Pipelines page now.
    const tabs = tabbedEntries(entries, 'global', 'project');
    const names = tabs.map((t) => t.tab);
    expect(names).toEqual(['General', 'Privacy']);
    expect(names).not.toContain('Workflow');
    expect(names).not.toContain('Autopilot');

    const general = tabs.find((t) => t.tab === 'General')!;
    expect(general.groups.map((g) => g.group)).toEqual(['Profile', 'Behavior']);
  });

  it('never renders the excluded Workflow / Autopilot / Pipelines groups (design D5)', () => {
    const withPipelines: WireConfigEntry[] = [
      ...entries,
      {
        ...entries[0]!,
        definition: { ...entries[0]!.definition, key: 'pipelines.x.gates.y', group: 'Pipelines', scopes: ['global'] },
      },
    ];
    const tabs = tabbedEntries(withPipelines, 'global', 'project');
    const renderedGroups = tabs.flatMap((t) => t.groups.map((g) => g.group));
    expect(renderedGroups).not.toContain('Workflow');
    expect(renderedGroups).not.toContain('Autopilot');
    expect(renderedGroups).not.toContain('Pipelines');
    // Excluded groups never fall into the trailing Other bucket either.
    expect(tabs.find((t) => t.tab === OTHER_TAB)).toBeUndefined();
  });

  it('omits a tab whose keys are all filtered out by the active mode (Privacy in Local mode)', () => {
    // Local mode at a project space: only project-settable, non-excluded keys
    // survive — `schema` (Project); the global-only Telemetry/Profile/Behavior
    // keys and the excluded Workflow/Autopilot keys disappear.
    const tabs = tabbedEntries([...entries, projectSchemaEntry], 'local', 'project');
    const names = tabs.map((t) => t.tab);
    expect(names).toEqual(['Project']);
    expect(names).not.toContain('Privacy');
    expect(names).not.toContain('General');
    expect(names).not.toContain('Workflow');
  });

  it('hides the raw Profile-group rows in Local mode even when project-scoped, keeping them in Global (ui-profile-workflow-split)', () => {
    // A project-scoped `profile` lock key in the Profile group — the real key's
    // shape. In Local mode it must NOT render as a config row (the Project-tab
    // selector owns it); since it is the only project-scope key in the General
    // tab's groups, the General tab disappears. Global mode still shows it.
    const projectProfileEntry: WireConfigEntry = {
      ...entries[0]!,
      definition: { ...entries[0]!.definition, key: 'profile', group: 'Profile', scopes: ['global', 'project'] },
    };

    const globalTabs = tabbedEntries([...entries, projectProfileEntry], 'global', 'project');
    const globalGeneral = globalTabs.find((t) => t.tab === 'General');
    expect(globalGeneral).toBeDefined();
    expect(globalGeneral!.groups.some((g) => g.group === 'Profile')).toBe(true);

    const localTabs = tabbedEntries([...entries, projectProfileEntry], 'local', 'project');
    expect(localTabs.map((t) => t.tab)).not.toContain('General');
    expect(localTabs.flatMap((t) => t.groups.map((g) => g.group))).not.toContain('Profile');
  });

  it('routes a genuinely unmapped, non-excluded group into the trailing Other bucket', () => {
    const withUnmapped: WireConfigEntry[] = [
      ...entries,
      {
        ...entries[0]!,
        definition: { ...entries[0]!.definition, key: 'zzz.custom', group: 'Zeta', scopes: ['global'] },
      },
    ];
    const tabs = tabbedEntries(withUnmapped, 'global', 'project');
    const other = tabs.find((t) => t.tab === OTHER_TAB);
    expect(other).toBeDefined();
    expect(tabs[tabs.length - 1]!.tab).toBe(OTHER_TAB); // trailing
    expect(other!.groups.some((g) => g.group === 'Zeta')).toBe(true);
  });

  it('does not assert registry key counts (portfolio rule) — a store space still tabs its own keys', () => {
    const tabs = tabbedEntries([...entries, projectSchemaEntry], 'local', 'store');
    // `schema` (store-settable, Project group) lands under Project.
    expect(tabs.map((t) => t.tab)).toContain('Project');
  });
});
