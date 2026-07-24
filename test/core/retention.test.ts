import { describe, expect, it } from 'vitest';

import {
  DEFAULT_RETENTION_MODE,
  RETENTION_MODES,
  RETIRED_RETRO_WORKFLOW_ID,
  builtInProfileRetention,
  isRetentionMode,
  resolveMigratedRetention,
} from '../../src/core/retention.js';

describe('retention module', () => {
  it('exposes exactly the three closed modes', () => {
    expect([...RETENTION_MODES]).toEqual(['off', 'report', 'codify']);
    expect(DEFAULT_RETENTION_MODE).toBe('off');
  });

  it('guards the closed value domain', () => {
    for (const mode of RETENTION_MODES) expect(isRetentionMode(mode)).toBe(true);
    for (const invalid of ['always', 'REPORT', '', undefined, null, 1]) {
      expect(isRetentionMode(invalid)).toBe(false);
    }
  });

  it('maps built-in profiles to their retention: full → report, core → off', () => {
    expect(builtInProfileRetention('full')).toBe('report');
    expect(builtInProfileRetention('core')).toBe('off');
    // Any other profile (custom / a saved name) has no built-in coupling.
    expect(builtInProfileRetention('custom')).toBe('off');
    expect(builtInProfileRetention('my-saved-profile')).toBe('off');
  });

  it('migrates a v1 selection by the presence of the retired retro id', () => {
    expect(resolveMigratedRetention([RETIRED_RETRO_WORKFLOW_ID, 'propose'])).toBe('report');
    expect(resolveMigratedRetention(['propose', 'apply'])).toBe('off');
    expect(resolveMigratedRetention([])).toBe('off');
  });
});
