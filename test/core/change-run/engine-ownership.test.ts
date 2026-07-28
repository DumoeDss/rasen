import { describe, expect, it } from 'vitest';

import {
  EngineOwnershipError,
  assertSingleEngineOwner,
  classifyEngineOwnership,
} from '../../../src/core/change-run/internal/engine-ownership.js';

describe('bilateral engine ownership guard (10.5/10.6)', () => {
  it('classifies legacy-only, canonical-only, both, and neither', () => {
    expect(classifyEngineOwnership({ canonicalPresent: false, legacyPresent: true })).toBe('legacy');
    expect(classifyEngineOwnership({ canonicalPresent: true, legacyPresent: false })).toBe('reconciler');
    expect(classifyEngineOwnership({ canonicalPresent: true, legacyPresent: true })).toBe('ambiguous');
    expect(classifyEngineOwnership({ canonicalPresent: false, legacyPresent: false })).toBe('unknown');
  });

  it('asserts a single owner for legacy-only and canonical-only', () => {
    expect(
      assertSingleEngineOwner({ canonicalPresent: true, legacyPresent: false })
    ).toBe('reconciler');
    expect(
      assertSingleEngineOwner({ canonicalPresent: false, legacyPresent: true })
    ).toBe('legacy');
  });

  it('blocks mutation on ambiguous (both) ownership', () => {
    expect(() =>
      assertSingleEngineOwner({ canonicalPresent: true, legacyPresent: true })
    ).toThrowError(EngineOwnershipError);
  });

  it('never treats absence as a free slot (unknown blocks)', () => {
    expect(() =>
      assertSingleEngineOwner({ canonicalPresent: false, legacyPresent: false })
    ).toThrowError(EngineOwnershipError);
  });
});
