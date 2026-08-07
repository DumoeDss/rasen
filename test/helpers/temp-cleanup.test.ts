import { describe, expect, it, vi } from 'vitest';

import { cleanupTempPathAsync } from './temp-cleanup.js';

function fsError(code: string, message = code): NodeJS.ErrnoException {
  return Object.assign(new Error(message), { code });
}

describe('cleanupTempPathAsync', () => {
  it('waits for a transient EPERM owner to release before retrying the exact target', async () => {
    const target = 'bounded-test-root';
    let ownerReleased = false;
    const removePath = vi.fn((actualTarget: string) => {
      if (!ownerReleased) throw fsError('EPERM', 'directory still owned');
      expect(actualTarget).toBe(target);
    });
    const wait = vi.fn(async () => {
      ownerReleased = true;
    });

    await cleanupTempPathAsync(target, {
      maxRetries: 2,
      retryDelayMs: 1,
      removePath,
      wait,
    });

    expect(removePath).toHaveBeenCalledTimes(2);
    expect(removePath).toHaveBeenNthCalledWith(1, target);
    expect(removePath).toHaveBeenNthCalledWith(2, target);
    expect(wait).toHaveBeenCalledOnce();
    expect(wait).toHaveBeenCalledWith(1);
  });

  it('retries transient descriptor exhaustion instead of misclassifying it as permanent', async () => {
    const removePath = vi
      .fn<(target: string) => void>()
      .mockImplementationOnce(() => {
        throw fsError('EMFILE');
      })
      .mockImplementationOnce(() => undefined);

    await cleanupTempPathAsync('descriptor-pressure-root', {
      maxRetries: 1,
      retryDelayMs: 0,
      removePath,
      wait: async () => undefined,
    });

    expect(removePath).toHaveBeenCalledTimes(2);
  });

  it('surfaces a permanent lock after the exact bounded attempt count', async () => {
    const permanent = fsError('EPERM', 'permanent lock');
    const removePath = vi.fn(() => {
      throw permanent;
    });
    const wait = vi.fn(async () => undefined);

    await expect(
      cleanupTempPathAsync('permanently-locked-root', {
        maxRetries: 2,
        retryDelayMs: 0,
        removePath,
        wait,
      })
    ).rejects.toBe(permanent);

    expect(removePath).toHaveBeenCalledTimes(3);
    expect(wait).toHaveBeenCalledTimes(2);
  });

  it('does not retry a non-transient error or redirect deletion outside the target', async () => {
    const target = 'only-this-test-root';
    const denied = fsError('EACCES', 'access denied');
    const removePath = vi.fn(() => {
      throw denied;
    });
    const wait = vi.fn(async () => undefined);

    await expect(
      cleanupTempPathAsync(target, {
        maxRetries: 15,
        retryDelayMs: 200,
        removePath,
        wait,
      })
    ).rejects.toBe(denied);

    expect(removePath).toHaveBeenCalledOnce();
    expect(removePath).toHaveBeenCalledWith(target);
    expect(wait).not.toHaveBeenCalled();
  });

  it.each([
    ['maxRetries', Number.POSITIVE_INFINITY],
    ['maxRetries', -1],
    ['retryDelayMs', Number.NaN],
    ['retryDelayMs', -1],
  ] as const)('rejects an unbounded or invalid %s option', async (name, value) => {
    await expect(
      cleanupTempPathAsync('invalid-budget-root', { [name]: value })
    ).rejects.toThrow(`${name} must be a non-negative safe integer`);
  });
});
