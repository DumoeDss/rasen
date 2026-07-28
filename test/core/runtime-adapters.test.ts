import { describe, expect, it } from 'vitest';

import {
  AUDIT_RUNTIMES,
  DISPATCH_RUNTIMES,
  PROBE_RUNTIMES,
  RUNTIME_ADAPTERS,
  detectHostRuntime,
  hasRuntimeCapability,
  resolveDispatchRoute,
} from '../../src/core/runtime-adapters.js';

describe('runtime adapter registry', () => {
  it('declares the exact shipped capability matrix', () => {
    expect(RUNTIME_ADAPTERS).toEqual({
      claude: {
        canProbeContext: true,
        canAudit: true,
        canDispatch: true,
      },
      codex: {
        canProbeContext: true,
        canAudit: true,
        canDispatch: true,
      },
      zed: {
        canProbeContext: false,
        canAudit: true,
        canDispatch: false,
      },
    });
  });

  it('derives deterministic capability sets in registry order', () => {
    expect(PROBE_RUNTIMES).toEqual(['claude', 'codex']);
    expect(AUDIT_RUNTIMES).toEqual(['claude', 'codex', 'zed']);
    expect(DISPATCH_RUNTIMES).toEqual(['claude', 'codex']);
  });

  it('checks membership against the requested capability', () => {
    expect(hasRuntimeCapability('claude', 'canProbeContext')).toBe(true);
    expect(hasRuntimeCapability('codex', 'canDispatch')).toBe(true);
    expect(hasRuntimeCapability('zed', 'canAudit')).toBe(true);
    expect(hasRuntimeCapability('zed', 'canProbeContext')).toBe(false);
    expect(hasRuntimeCapability('zed', 'canDispatch')).toBe(false);
    expect(hasRuntimeCapability('unknown', 'canAudit')).toBe(false);
    expect(hasRuntimeCapability(undefined, 'canAudit')).toBe(false);
  });

  it('exposes immutable registry and derived lists', () => {
    expect(Object.isFrozen(RUNTIME_ADAPTERS)).toBe(true);
    expect(Object.values(RUNTIME_ADAPTERS).every(Object.isFrozen)).toBe(true);
    expect(Object.isFrozen(PROBE_RUNTIMES)).toBe(true);
    expect(Object.isFrozen(AUDIT_RUNTIMES)).toBe(true);
    expect(Object.isFrozen(DISPATCH_RUNTIMES)).toBe(true);
  });
});

describe('host runtime detection', () => {
  it('detects unrestricted Codex from CODEX_THREAD_ID alone', () => {
    expect(detectHostRuntime({ CODEX_THREAD_ID: 'thread-1' })).toEqual({
      runtime: 'codex',
      source: 'codex-thread-id',
    });
  });

  it('lets Codex fingerprints outrank inherited Claude fingerprints', () => {
    expect(
      detectHostRuntime({
        CODEX_THREAD_ID: 'thread-1',
        CODEX_SANDBOX: 'danger-full-access',
        CLAUDECODE: '1',
      })
    ).toEqual({ runtime: 'codex', source: 'codex-thread-id' });
  });

  it('lets a valid explicit override outrank fingerprints', () => {
    expect(
      detectHostRuntime({
        RASEN_AGENT_RUNTIME: 'claude',
        CODEX_THREAD_ID: 'thread-1',
      })
    ).toEqual({ runtime: 'claude', source: 'env-override' });
  });

  it('falls through an invalid override to real fingerprints', () => {
    expect(
      detectHostRuntime({
        RASEN_AGENT_RUNTIME: 'gemini',
        CODEX_SANDBOX: 'seatbelt',
      })
    ).toEqual({ runtime: 'codex', source: 'codex-sandbox' });
  });

  it('reports unknown host provenance without recognized fingerprints', () => {
    expect(
      detectHostRuntime({ CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1' })
    ).toEqual({ runtime: 'unknown', source: 'unknown' });
  });
});

describe('host x target dispatch routes', () => {
  it.each([
    ['claude', 'claude', 'native'],
    ['claude', 'codex', 'exec-bridge'],
    ['codex', 'claude', 'unsupported'],
    ['codex', 'codex', 'native'],
    ['unknown', 'claude', 'legacy-fallback'],
    ['unknown', 'codex', 'legacy-fallback'],
  ] as const)('resolves %s -> %s as %s', (host, target, mode) => {
    expect(resolveDispatchRoute(host, target)).toMatchObject({
      host,
      target,
      mode,
    });
  });
});
