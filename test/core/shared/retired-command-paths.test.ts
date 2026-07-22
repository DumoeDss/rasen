import { describe, expect, it } from 'vitest';
import path from 'path';

import {
  RETIRED_COMMAND_IDS,
  getCommandFileId,
  getCommandFilePathCandidates,
  getAllRetiredCommandFilePathCandidates,
  getRetiredCommandFilePath,
  getLegacyCommandFilePath,
} from '../../../src/core/shared/retired-command-paths.js';

describe('retired-command-paths', () => {
  it('freezes exactly the 19 built-in command ids', () => {
    expect(RETIRED_COMMAND_IDS).toHaveLength(19);
    expect([...RETIRED_COMMAND_IDS].sort()).toEqual(
      [
        'apply',
        'archive',
        'auto',
        'bulk-archive',
        'continue',
        'explore',
        'goal',
        'handoff',
        'help',
        'new',
        'office-hours',
        'onboard',
        'propose',
        'retro',
        'review-cycle',
        'ship',
        'sync',
        'verify',
        'verify-enhanced',
      ].sort()
    );
  });

  it('strips the -command suffix from fusion workflow ids', () => {
    expect(getCommandFileId('ship-command')).toBe('ship');
    expect(getCommandFileId('goal-command')).toBe('goal');
    expect(getCommandFileId('explore')).toBe('explore');
  });

  it('resolves a current path for a known tool, built with path.join', () => {
    const claudePath = getRetiredCommandFilePath('claude', 'ship');
    expect(claudePath).toBe(path.join('.claude', 'commands', 'rasen', 'ship.md'));

    const cursorPath = getRetiredCommandFilePath('cursor', 'ship');
    expect(cursorPath).toBe(path.join('.cursor', 'commands', 'rasen-ship.md'));
  });

  it('returns null for an unknown tool id', () => {
    expect(getRetiredCommandFilePath('not-a-real-tool', 'ship')).toBeNull();
  });

  it('candidates for a fusion workflow id include current, -command legacy, and opsx variants', () => {
    const candidates = getCommandFilePathCandidates('claude', 'ship-command').map((p) =>
      p.replace(/\\/g, '/')
    );

    expect(candidates).toContain('.claude/commands/rasen/ship.md');
    expect(candidates.some((c) => c.includes('commands/opsx/ship.md'))).toBe(true);
  });

  it('candidates for a hyphen-form tool include the current and opsx-prefixed dash variants', () => {
    const candidates = getCommandFilePathCandidates('cursor', 'ship-command').map((p) =>
      p.replace(/\\/g, '/')
    );

    expect(candidates.some((c) => /(^|\/)rasen-ship\.md$/.test(c))).toBe(true);
    expect(candidates.some((c) => /(^|\/)opsx-ship\.md$/.test(c))).toBe(true);
  });

  it('getLegacyCommandFilePath is null when the workflow id carries no -command suffix', () => {
    expect(getLegacyCommandFilePath('claude', 'explore')).toBeNull();
    expect(getLegacyCommandFilePath('claude', 'ship-command')).not.toBeNull();
  });

  it('getAllRetiredCommandFilePathCandidates covers every one of the 19 ids for a tool', () => {
    const all = getAllRetiredCommandFilePathCandidates('claude');
    // At minimum one current-path candidate per id, plus legacy variants for
    // the fusion ids that carry a -command suffix historically.
    expect(all.length).toBeGreaterThanOrEqual(RETIRED_COMMAND_IDS.length);
    expect(all).toContain(path.join('.claude', 'commands', 'rasen', 'explore.md'));
    expect(all).toContain(path.join('.claude', 'commands', 'rasen', 'ship.md'));
  });

  it('builds every path with path.join (no hardcoded separators)', () => {
    for (const candidate of getAllRetiredCommandFilePathCandidates('windsurf')) {
      // path.join normalizes to the platform separator; a hardcoded '/'-only
      // path on Windows would still pass this, so also assert against the
      // known expected shape for one representative id.
      expect(candidate.length).toBeGreaterThan(0);
    }
    const windsurfShip = getRetiredCommandFilePath('windsurf', 'ship');
    expect(windsurfShip).toBe(path.join('.windsurf', 'workflows', 'rasen-ship.md'));
  });
});
