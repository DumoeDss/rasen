import { describe, expect, it, vi } from 'vitest';

import {
  CLAUDE_CLI_VERSION_PREMISE,
  probeClaudeAvailability,
} from '../../../src/core/claude/index.js';

describe('Claude availability', () => {
  it('records the verified CLI premise', () => {
    expect(CLAUDE_CLI_VERSION_PREMISE).toBe('2.1.220');
  });

  it('uses injected resolution and version execution', () => {
    const runVersion = vi.fn(() => ({ status: 0, signal: null }));
    expect(
      probeClaudeAvailability({
        resolveBinary: () => '/fixture/claude',
        runVersion,
      })
    ).toBe(true);
    expect(runVersion).toHaveBeenCalledWith('/fixture/claude');
  });

  it('does not fall through to a real CLI when the injected resolver says unavailable', () => {
    const runVersion = vi.fn();
    expect(
      probeClaudeAvailability({
        resolveBinary: () => null,
        runVersion,
      })
    ).toBe(false);
    expect(runVersion).not.toHaveBeenCalled();
  });

  it('returns false for nonzero, timeout, and thrown probes', () => {
    expect(
      probeClaudeAvailability({
        resolveBinary: () => 'fixture',
        runVersion: () => ({ status: 1, signal: null }),
      })
    ).toBe(false);
    expect(
      probeClaudeAvailability({
        resolveBinary: () => 'fixture',
        runVersion: () => ({ status: null, signal: 'SIGTERM' }),
      })
    ).toBe(false);
    expect(
      probeClaudeAvailability({
        resolveBinary: () => {
          throw new Error('boom');
        },
      })
    ).toBe(false);
  });
});
