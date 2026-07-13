import { describe, expect, it } from 'vitest';
import { buildCodexWorkerRecord } from '../../../src/core/codex/identity.js';
import { RunStateWorkerSchema, stageWorkers, type RunState } from '../../../src/core/pipeline-registry/run-state.js';

describe('buildCodexWorkerRecord', () => {
  it('builds a record that validates against RunStateWorkerSchema', () => {
    const record = buildCodexWorkerRecord({
      threadId: '019f5504-86db-7cf1-9b59-5cdcf0f70672',
      model: 'gpt-5.6-sol',
      sandbox: 'workspace-write',
      effort: 'high',
      rolloutPath: '/home/user/.codex/sessions/2026/07/12/rollout-2026-07-12T14-29-47-019f5504.jsonl',
      role: 'implementer',
    });
    const result = RunStateWorkerSchema.safeParse(record);
    expect(result.success).toBe(true);
    expect(record.runtime).toBe('codex');
    expect(record.threadId).toBe('019f5504-86db-7cf1-9b59-5cdcf0f70672');
    expect(record.model).toBe('gpt-5.6-sol');
    expect(record.sandbox).toBe('workspace-write');
    expect(record.effort).toBe('high');
  });

  it('carries the rollout path as the transcript pointer', () => {
    const record = buildCodexWorkerRecord({
      threadId: 't1',
      model: 'm',
      sandbox: 'read-only',
      effort: 'low',
      rolloutPath: '/path/to/rollout.jsonl',
    });
    expect(record.transcript).toBe('/path/to/rollout.jsonl');
  });

  it('leaves turnId unset (exec-mode records omit turn granularity)', () => {
    const record = buildCodexWorkerRecord({
      threadId: 't1',
      model: 'm',
      sandbox: 'read-only',
      effort: 'low',
    });
    expect(record.turnId).toBeUndefined();
    expect('turnId' in record).toBe(false);
  });

  it('omits transcript when no rolloutPath is known', () => {
    const record = buildCodexWorkerRecord({
      threadId: 't1',
      model: 'm',
      sandbox: 'read-only',
      effort: 'low',
    });
    expect(record.transcript).toBeUndefined();
  });

  it('clamps ultra to xhigh, matching the builder — a record can never claim an effort no leaf dispatch actually ran with', () => {
    const record = buildCodexWorkerRecord({
      threadId: 't1',
      model: 'm',
      sandbox: 'read-only',
      effort: 'ultra',
    });
    expect(record.effort).toBe('xhigh');
  });

  it('is picked up by stageWorkers() as warm-seedable (via threadId)', () => {
    const record = buildCodexWorkerRecord({
      threadId: '019f5504-86db-7cf1-9b59-5cdcf0f70672',
      model: 'm',
      sandbox: 'read-only',
      effort: 'low',
    });
    const state: RunState = {
      pipeline: 'test-pipeline',
      stages: {
        implement: { status: 'done', worker: record },
      },
    };
    const workers = stageWorkers(state);
    expect(workers.implement).toEqual(record);
  });
});
