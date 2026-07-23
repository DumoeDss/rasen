import { describe, it, expect } from 'vitest';
import * as path from 'node:path';

import { mapLegacySkillId } from '../../src/core/pipeline-registry/index.js';
import { getCommandFilePathCandidates } from '../../src/core/shared/retired-command-paths.js';

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

  it('maps the upstream namespace form openspec:<x> to the hyphen rasen-<x>', () => {
    expect(mapLegacySkillId('openspec:apply')).toBe('rasen-apply');
  });

  it('maps the retired colon namespace rasen:<x> to the hyphen rasen-<x>', () => {
    expect(mapLegacySkillId('rasen:review')).toBe('rasen-review');
  });

  it('returns null for an already-migrated (hyphen rasen-) ID', () => {
    expect(mapLegacySkillId('rasen-ship')).toBeNull();
  });
});

describe('command file path candidates include legacy opsx-prefixed variants', () => {
  function toPosix(p: string): string {
    return p.replace(/\\/g, '/');
  }

  it('adds a commands/opsx/<id>.md variant for subdir-form tools', () => {
    const candidates = getCommandFilePathCandidates('claude', 'ship').map(toPosix);

    // Current rasen path plus the legacy opsx subdir variant.
    expect(candidates).toContain(path.join('.claude', 'commands', 'rasen', 'ship.md').replace(/\\/g, '/'));
    expect(candidates.some((c) => c.includes('commands/opsx/ship.md'))).toBe(true);
  });

  it('adds an opsx-<id> variant for hyphen-form tools', () => {
    const candidates = getCommandFilePathCandidates('cursor', 'ship').map(toPosix);

    expect(candidates.some((c) => /(^|\/)rasen-ship\.md$/.test(c))).toBe(true);
    expect(candidates.some((c) => /(^|\/)opsx-ship\.md$/.test(c))).toBe(true);
  });
});
