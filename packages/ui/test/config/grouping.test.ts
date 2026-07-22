import { describe, expect, it } from 'vitest';
import { groupEntries, tabbedEntries, OTHER_TAB } from '../../src/config/grouping.js';
import { configListFixture } from '../fixtures/config-list.js';
import type { WireConfigEntry } from '../../src/api/types.js';

const entries: WireConfigEntry[] = configListFixture.entries;

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

describe('tabbedEntries', () => {
  it('maps registry groups to tabs in tab order, filtered to the active mode (design D2)', () => {
    // Global mode at a project space: every global-scoped key is visible.
    const tabs = tabbedEntries(entries, 'global', 'project');
    const names = tabs.map((t) => t.tab);
    // Baseline fixture has Profile+Behavior (General), Telemetry (Privacy),
    // Workflow+Autopilot (Workflow); no Project/Archive/Advanced entries.
    expect(names).toEqual(['General', 'Privacy', 'Workflow']);

    const general = tabs.find((t) => t.tab === 'General')!;
    expect(general.groups.map((g) => g.group)).toEqual(['Profile', 'Behavior']);
    const workflow = tabs.find((t) => t.tab === 'Workflow')!;
    // Workflow tab carries both the Workflow and Autopilot groups (interim, D2).
    expect(workflow.groups.map((g) => g.group)).toEqual(['Workflow', 'Autopilot']);
  });

  it('omits a tab whose keys are all filtered out by the active mode (Privacy in Local mode)', () => {
    // Local mode at a project space: only the project-settable keys survive
    // (handoff.threshold + autopilot.gates); the global-only Telemetry,
    // Profile, and Behavior keys disappear, so Privacy and General are absent.
    const tabs = tabbedEntries(entries, 'local', 'project');
    const names = tabs.map((t) => t.tab);
    expect(names).toContain('Workflow');
    expect(names).not.toContain('Privacy');
    expect(names).not.toContain('General');
  });

  it('routes an unmapped group into the trailing Other bucket rather than hiding it', () => {
    const withUnmapped: WireConfigEntry[] = [
      ...entries,
      {
        ...entries[0]!,
        definition: { ...entries[0]!.definition, key: 'pipelines.x.gates.y', group: 'Pipelines', scopes: ['global'] },
      },
    ];
    const tabs = tabbedEntries(withUnmapped, 'global', 'project');
    const other = tabs.find((t) => t.tab === OTHER_TAB);
    expect(other).toBeDefined();
    expect(tabs[tabs.length - 1]!.tab).toBe(OTHER_TAB); // trailing
    expect(other!.groups.some((g) => g.group === 'Pipelines')).toBe(true);
  });

  it('does not assert registry key counts (portfolio rule) — a store space still tabs its own keys', () => {
    const tabs = tabbedEntries(entries, 'local', 'store');
    // handoff.threshold (store-settable) lands under Workflow; autopilot.gates too.
    expect(tabs.map((t) => t.tab)).toContain('Workflow');
  });
});
