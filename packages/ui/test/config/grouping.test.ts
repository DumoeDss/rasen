import { describe, expect, it } from 'vitest';
import { groupEntries } from '../../src/config/grouping.js';
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
    // Autopilot, Workflow, Profile, Behavior, Telemetry is the GROUP_ORDER
    // subsequence present in the fixture (config-page-coherence D6).
    expect(names).toEqual(['Autopilot', 'Workflow', 'Profile', 'Behavior', 'Telemetry']);
  });

  it('sorts unrecognized groups alphabetically after known ones', () => {
    const withExtra: WireConfigEntry[] = [
      ...entries,
      {
        ...entries[0]!,
        definition: { ...entries[0]!.definition, key: 'zzz.custom', group: 'Zeta' },
      },
      {
        ...entries[0]!,
        definition: { ...entries[0]!.definition, key: 'aaa.custom', group: 'Alpha' },
      },
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
