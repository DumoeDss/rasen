import { describe, expect, it } from 'vitest';

import {
  AUDIT_RUNTIMES,
  DISPATCH_RUNTIMES,
  PROBE_RUNTIMES,
  RUNTIME_ADAPTERS,
  hasRuntimeCapability,
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
