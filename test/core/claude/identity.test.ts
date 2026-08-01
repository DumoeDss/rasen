import { describe, expect, it } from 'vitest';

import { buildClaudeWorkerRecord } from '../../../src/core/claude/index.js';
import {
  inferWorkerDispatchMode,
  RunStateWorkerSchema,
} from '../../../src/core/pipeline-registry/run-state.js';

describe('Claude exec-bridge worker identity', () => {
  it('records session ID and cwd without native/Codex handles', () => {
    const record = buildClaudeWorkerRecord({
      sessionId: 'claude-session',
      cwd: 'C:\\repo with spaces',
      role: 'reviewer',
      model: 'sonnet',
      sandbox: 'read-only',
      effort: 'high',
    });
    expect(RunStateWorkerSchema.parse(record)).toMatchObject({
      runtime: 'claude',
      dispatchMode: 'exec-bridge',
      sessionId: 'claude-session',
      cwd: 'C:\\repo with spaces',
    });
    expect(record).not.toHaveProperty('agentId');
    expect(record).not.toHaveProperty('threadId');
  });

  it('infers archived Claude session records as exec-bridge', () => {
    expect(
      inferWorkerDispatchMode({
        runtime: 'claude',
        sessionId: 'old-session',
        cwd: '/repo',
      })
    ).toEqual({ dispatchMode: 'exec-bridge', inferred: true });
  });
});
