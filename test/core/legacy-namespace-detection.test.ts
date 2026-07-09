import { describe, it, expect } from 'vitest';
import * as path from 'node:path';

import { mapLegacySkillId } from '../../src/core/pipeline-registry/index.js';
import {
  CommandAdapterRegistry,
} from '../../src/core/command-generation/index.js';
import { getCommandFilePathCandidates } from '../../src/core/command-generation/command-file-id.js';

/**
 * Legacy-namespace recognition for resume + command cleanup (tasks 3.2, 3.5):
 * old skill IDs map to their rasen equivalents, and command-path candidates
 * include legacy `opsx`-prefixed variants so pre-rebrand files are detected.
 */
describe('legacy skill-ID mapping', () => {
  it('collapses the double prefix openspec-opsx-<x> to rasen-<x>', () => {
    expect(mapLegacySkillId('openspec-opsx-ship')).toBe('rasen-ship');
  });

  it('maps openspec-<x> to rasen-<x>', () => {
    expect(mapLegacySkillId('openspec-review-cycle')).toBe('rasen-review-cycle');
  });

  it('maps the namespace form openspec:<x> to rasen:<x>', () => {
    expect(mapLegacySkillId('openspec:apply')).toBe('rasen:apply');
  });

  it('returns null for an already-migrated (rasen) ID', () => {
    expect(mapLegacySkillId('rasen-ship')).toBeNull();
    expect(mapLegacySkillId('rasen:apply')).toBeNull();
  });
});

describe('command file path candidates include legacy opsx-prefixed variants', () => {
  function toPosix(p: string): string {
    return p.replace(/\\/g, '/');
  }

  it('adds a commands/opsx/<id>.md variant for subdir-form adapters', () => {
    const adapter = CommandAdapterRegistry.get('claude');
    expect(adapter).toBeDefined();
    const candidates = getCommandFilePathCandidates(adapter!, 'ship').map(toPosix);

    // Current rasen path plus the legacy opsx subdir variant.
    expect(candidates).toContain(path.join('.claude', 'commands', 'rasen', 'ship.md').replace(/\\/g, '/'));
    expect(candidates.some((c) => c.includes('commands/opsx/ship.md'))).toBe(true);
  });

  it('adds an opsx-<id> variant for hyphen-form adapters', () => {
    const adapter = CommandAdapterRegistry.get('cursor');
    expect(adapter).toBeDefined();
    const candidates = getCommandFilePathCandidates(adapter!, 'ship').map(toPosix);

    expect(candidates.some((c) => /(^|\/)rasen-ship\.md$/.test(c))).toBe(true);
    expect(candidates.some((c) => /(^|\/)opsx-ship\.md$/.test(c))).toBe(true);
  });
});
