import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { handleFrozenActionDispatch } from '../../../src/core/management-api/frozen-action-executor.js';
import type {
  SessionHost,
  SessionHostCommand,
  SessionHostOutcome,
  SessionHostView,
  SessionRecoveryReport,
} from '../../../src/core/session-host/contracts.js';
import {
  makeRecordAction,
  recordIds,
  recordRevision,
} from '../change-run/record-fixture.js';

const LIMITS = { timeoutMs: 30_000, maxInputBytes: 1024 * 1024, maxOutputBytes: 1024 * 1024 };

function stubHost(): SessionHost {
  return {
    async dispatch(command: SessionHostCommand): Promise<SessionHostOutcome> {
      if (command.op === 'execute') {
        return {
          ok: true,
          op: 'execute',
          session: {
            sessionId: '11111111-1111-1111-1111-111111111111',
            backend: 'claude',
            cwd: command.cwd,
            hostState: 'idle',
            state: 'running',
            generation: 1,
            createdAt: '2026-08-08T00:00:00Z',
            updatedAt: '2026-08-08T00:00:00Z',
          },
          requestId: command.requestId,
          result: '{"ok":true}',
          resultDigest: 'sha256:abc',
        };
      }
      return { ok: false, op: command.op, code: 'invalid-input', message: 'execute only' };
    },
    inspect(): undefined {
      return undefined;
    },
    list(): SessionHostView[] {
      return [];
    },
    async reconcileOnStart(): Promise<SessionRecoveryReport> {
      return { ready: true, inspected: 0, recovered: 0, interrupted: 0, failed: 0, diagnostics: [] };
    },
    async shutdown(): Promise<void> {
      /* no-op */
    },
  };
}

function dispatchBody(overrides: Record<string, unknown> = {}) {
  return {
    runRef: {
      change: { projectRoot: '/root', changeId: 'fixture-change' },
      runId: recordIds.runId,
    },
    grantedAction: makeRecordAction(),
    expectedRecordVersion: 3,
    workspaceRevision: recordRevision,
    requestedBackend: 'hosted',
    turnInput: 'do the work',
    hostedSeam: { cwd: '/root', backend: 'claude', limits: LIMITS },
    ...overrides,
  };
}

describe('frozen-action-executor daemon face - body validation (additive endpoint)', () => {
  it('rejects a non-object body', async () => {
    const result = await handleFrozenActionDispatch({ host: stubHost(), hostPlatform: 'linux', body: 'nope' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('bad_request');
  });

  it('rejects an invalid runRef', async () => {
    const result = await handleFrozenActionDispatch({
      host: stubHost(),
      hostPlatform: 'linux',
      body: dispatchBody({ runRef: { change: {} } }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('invalid_run_ref');
  });

  it('rejects an invalid grantedAction', async () => {
    const result = await handleFrozenActionDispatch({
      host: stubHost(),
      hostPlatform: 'linux',
      body: dispatchBody({ grantedAction: { kind: 'agent' } }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('invalid_granted_action');
  });

  it('rejects a non-integer expectedRecordVersion', async () => {
    const result = await handleFrozenActionDispatch({
      host: stubHost(),
      hostPlatform: 'linux',
      body: dispatchBody({ expectedRecordVersion: 'three' }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('invalid_expected_record_version');
  });

  it('rejects an empty turnInput', async () => {
    const result = await handleFrozenActionDispatch({
      host: stubHost(),
      hostPlatform: 'linux',
      body: dispatchBody({ turnInput: '' }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('invalid_turn_input');
  });

  it('rejects an invalid requestedBackend', async () => {
    const result = await handleFrozenActionDispatch({
      host: stubHost(),
      hostPlatform: 'linux',
      body: dispatchBody({ requestedBackend: 'kernel-enforced' }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('invalid_backend');
  });

  it('returns run_not_found when no Record exists for the runId', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fae-store-'));
    try {
      const result = await handleFrozenActionDispatch({
        host: stubHost(),
        hostPlatform: 'linux',
        body: dispatchBody(),
        storeRoot: tmp,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.status).toBe(404);
        expect(result.code).toBe('run_not_found');
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
