import { describe, expect, it } from 'vitest';

import {
  HOST_REGISTRY_SCHEMA,
  canTransitionHostedSession,
  projectHostedCompatibilityState,
  sanitizeHostDiagnostic,
  validateSessionHostCommand,
} from '../../../src/core/session-host/contracts.js';

describe('backend-neutral SessionHost contracts', () => {
  it('uses named durable schema and compatibility projection', () => {
    expect(HOST_REGISTRY_SCHEMA).toBe('rasen-session-host-registry/2');
    expect(projectHostedCompatibilityState('starting')).toBe('starting');
    expect(projectHostedCompatibilityState('idle')).toBe('running');
    expect(projectHostedCompatibilityState('active')).toBe('running');
    expect(projectHostedCompatibilityState('recovering')).toBe('running');
    expect(projectHostedCompatibilityState('interrupted')).toBe('running');
    expect(projectHostedCompatibilityState('cancelling')).toBe('exiting');
    expect(projectHostedCompatibilityState('retiring')).toBe('exiting');
    expect(projectHostedCompatibilityState('failed')).toBe('exited');
    expect(projectHostedCompatibilityState('retired')).toBe('exited');
  });

  it('makes retirement terminal and admits only named lifecycle transitions', () => {
    expect(canTransitionHostedSession('starting', 'idle')).toBe(true);
    expect(canTransitionHostedSession('idle', 'active')).toBe(true);
    expect(canTransitionHostedSession('active', 'idle')).toBe(true);
    expect(canTransitionHostedSession('active', 'interrupted')).toBe(true);
    expect(canTransitionHostedSession('interrupted', 'recovering')).toBe(true);
    expect(canTransitionHostedSession('recovering', 'idle')).toBe(true);
    expect(canTransitionHostedSession('idle', 'retiring')).toBe(true);
    expect(canTransitionHostedSession('retiring', 'retired')).toBe(true);
    expect(canTransitionHostedSession('retired', 'idle')).toBe(false);
  });

  it('rejects invalid public commands without backend-specific argv or binary fields', () => {
    expect(validateSessionHostCommand({ op: 'execute' })).toMatchObject({
      ok: false,
      code: 'invalid-input',
    });
    expect(
      validateSessionHostCommand({
        op: 'execute',
        requestId: 'not-a-uuid',
        backend: 'claude',
        cwd: '.',
        input: 'hello',
        limits: { timeoutMs: 1000, maxInputBytes: 1024, maxOutputBytes: 1024 },
        argv: ['--dangerous'],
      })
    ).toMatchObject({ ok: false });

    const sessionId = crypto.randomUUID();
    expect(validateSessionHostCommand({
      op: 'restart',
      sessionId,
      binary: '/tmp/untrusted',
    })).toMatchObject({ ok: false, code: 'invalid-input' });
    expect(validateSessionHostCommand({
      op: 'cancel',
      sessionId,
      reason: 'stop',
      argv: ['--force'],
    })).toMatchObject({ ok: false, code: 'invalid-input' });
    expect(validateSessionHostCommand({
      op: 'execute',
      requestId: crypto.randomUUID(),
      backend: 'claude',
      cwd: process.cwd(),
      input: 'hello',
      limits: {
        timeoutMs: 1000,
        maxInputBytes: 1024,
        maxOutputBytes: Number.MAX_SAFE_INTEGER,
      },
    })).toMatchObject({ ok: false, code: 'invalid-input' });
  });

  it('bounds and redacts diagnostics', () => {
    const diagnostic = sanitizeHostDiagnostic(
      `token=secret-value ${'x'.repeat(200)}`,
      64
    );
    expect(Buffer.byteLength(diagnostic, 'utf8')).toBeLessThanOrEqual(64);
    expect(diagnostic).not.toContain('secret-value');
  });
});
