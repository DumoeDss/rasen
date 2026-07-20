import { describe, it, expect, vi, beforeEach } from 'vitest';

let mockSpawnSyncResult: {
  status?: number | null;
  error?: NodeJS.ErrnoException;
} = { status: 0 };

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawnSync: (..._args: unknown[]) => mockSpawnSyncResult,
  };
});

import { probeCodexAvailability } from '../../../src/core/codex/availability.js';

describe('core/codex/availability', () => {
  beforeEach(() => {
    mockSpawnSyncResult = { status: 0 };
  });

  it('returns true on a clean codex --version success', () => {
    mockSpawnSyncResult = { status: 0 };
    expect(probeCodexAvailability()).toBe(true);
  });

  it('returns false on a non-zero exit', () => {
    mockSpawnSyncResult = { status: 1 };
    expect(probeCodexAvailability()).toBe(false);
  });

  it('returns false on a spawn error (e.g. ENOENT) without throwing', () => {
    mockSpawnSyncResult = {
      status: null,
      error: Object.assign(new Error('spawn codex ENOENT'), { code: 'ENOENT' }),
    };
    expect(() => probeCodexAvailability()).not.toThrow();
    expect(probeCodexAvailability()).toBe(false);
  });

  it('returns false without propagating when the spawn result is unusable', () => {
    // An unusable/undefined result (as if spawnSync itself misbehaved) must
    // be swallowed by the try/catch guard in probeCodexAvailability, not
    // thrown out to the caller.
    mockSpawnSyncResult = undefined as unknown as typeof mockSpawnSyncResult;
    expect(() => probeCodexAvailability()).not.toThrow();
    expect(probeCodexAvailability()).toBe(false);
  });
});
