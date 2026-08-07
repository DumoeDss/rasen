import { describe, expect, it } from 'vitest';

import { normalizeSessionHostReplay } from '../../helpers/session-host-normalization.js';

describe('Session host deterministic replay normalization', () => {
  it('ignores only declared timestamps, random ids, and PIDs', () => {
    const left = {
      sessionId: crypto.randomUUID(),
      requestId: crypto.randomUUID(),
      pid: 111,
      createdAt: '2026-08-04T00:00:00.000Z',
      backendSessionId: 'backend-stable-1',
      requestDigest: 'sha256:input-one',
      lifecycle: ['starting', 'active', 'idle'],
      events: [{ type: 'init' }, { type: 'result', digest: 'sha256:result-one' }],
    };
    const right = {
      ...left,
      sessionId: crypto.randomUUID(),
      requestId: crypto.randomUUID(),
      pid: 222,
      createdAt: '2026-08-04T01:00:00.000Z',
    };
    expect(normalizeSessionHostReplay(left)).toEqual(normalizeSessionHostReplay(right));

    for (const mutation of [
      { requestDigest: 'sha256:different-input' },
      { lifecycle: ['starting', 'idle', 'active'] },
      { events: [{ type: 'init' }, { type: 'error', digest: 'sha256:result-one' }] },
      { backendSessionId: 'backend-drifted-2' },
    ]) {
      expect(normalizeSessionHostReplay({ ...right, ...mutation })).not.toEqual(
        normalizeSessionHostReplay(left)
      );
    }
  });
});
