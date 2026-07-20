import { describe, it, expect } from 'vitest';

import { createSessionRegistry } from '../../../src/core/management-api/session-registry.js';

describe('session-registry (design D2)', () => {
  it('creates a record in state starting with the given fields', () => {
    const registry = createSessionRegistry();
    const record = registry.create({ kind: 'auto', task: 'do a thing', cwd: '/tmp/proj' });

    expect(record.kind).toBe('auto');
    expect(record.task).toBe('do a thing');
    expect(record.cwd).toBe('/tmp/proj');
    expect(record.state).toBe('starting');
    expect(typeof record.id).toBe('string');
    expect(record.id.length).toBeGreaterThan(0);
    expect(record.changeName).toBeUndefined();
  });

  it('carries changeName only when provided', () => {
    const registry = createSessionRegistry();
    const record = registry.create({ kind: 'goal', task: 't', cwd: '/tmp', changeName: 'my-change' });
    expect(record.changeName).toBe('my-change');
  });

  it('get/list return copies, not live references', () => {
    const registry = createSessionRegistry();
    const record = registry.create({ kind: 'auto', task: 't', cwd: '/tmp' });

    const fetched = registry.get(record.id)!;
    fetched.task = 'mutated';
    expect(registry.get(record.id)!.task).toBe('t');

    const listed = registry.list();
    listed[0].task = 'also mutated';
    expect(registry.get(record.id)!.task).toBe('t');
  });

  it('get returns undefined for an unknown id', () => {
    const registry = createSessionRegistry();
    expect(registry.get('does-not-exist')).toBeUndefined();
  });

  it('updateState patches pid, agentSessionId, and termination fields', () => {
    const registry = createSessionRegistry();
    const record = registry.create({ kind: 'auto', task: 't', cwd: '/tmp' });

    registry.updateState(record.id, 'running', { pid: 4242 });
    expect(registry.get(record.id)!.state).toBe('running');
    expect(registry.get(record.id)!.pid).toBe(4242);

    registry.updateState(record.id, 'running', { agentSessionId: 'agent-abc' });
    expect(registry.get(record.id)!.agentSessionId).toBe('agent-abc');
  });

  it('updateState on an unknown id is a silent no-op', () => {
    const registry = createSessionRegistry();
    expect(() => registry.updateState('nope', 'running')).not.toThrow();
  });

  it('touchOutput updates lastOutputAt', async () => {
    const registry = createSessionRegistry();
    const record = registry.create({ kind: 'auto', task: 't', cwd: '/tmp' });
    const before = registry.get(record.id)!.lastOutputAt;

    await new Promise((resolve) => setTimeout(resolve, 5));
    registry.touchOutput(record.id);

    expect(registry.get(record.id)!.lastOutputAt).toBeGreaterThan(before);
  });

  it('finalize sets state exited, endedAt, and the termination reason', () => {
    const registry = createSessionRegistry();
    const record = registry.create({ kind: 'auto', task: 't', cwd: '/tmp' });

    registry.finalize(record.id, 'exit', 0, null);

    const finalRecord = registry.get(record.id)!;
    expect(finalRecord.state).toBe('exited');
    expect(finalRecord.terminationReason).toBe('exit');
    expect(finalRecord.exitCode).toBe(0);
    expect(finalRecord.exitSignal).toBeNull();
    expect(typeof finalRecord.endedAt).toBe('number');
  });

  it('finalize preserves the first-set termination reason', () => {
    const registry = createSessionRegistry();
    const record = registry.create({ kind: 'auto', task: 't', cwd: '/tmp' });

    registry.updateState(record.id, 'exiting', { terminationReason: 'killed' });
    registry.finalize(record.id, 'signal', null, 'SIGTERM');

    expect(registry.get(record.id)!.terminationReason).toBe('killed');
  });

  it('prunes the oldest exited record once the retention cap (50) is exceeded, keeping live records', () => {
    const registry = createSessionRegistry();

    const liveRecord = registry.create({ kind: 'auto', task: 'still running', cwd: '/tmp' });

    const exitedIds: string[] = [];
    for (let i = 0; i < 55; i++) {
      const r = registry.create({ kind: 'auto', task: `t${i}`, cwd: '/tmp' });
      exitedIds.push(r.id);
      registry.finalize(r.id, 'exit', 0, null);
    }

    const all = registry.list();
    const exitedCount = all.filter((r) => r.state === 'exited').length;
    expect(exitedCount).toBe(50);

    // The still-running record survives regardless of the exited cap.
    expect(registry.get(liveRecord.id)).toBeDefined();

    // The earliest-finalized exited records were pruned; the most recent ones remain.
    expect(registry.get(exitedIds[0])).toBeUndefined();
    expect(registry.get(exitedIds[exitedIds.length - 1])).toBeDefined();
  });
});
