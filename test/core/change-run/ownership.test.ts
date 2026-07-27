import { describe, expect, it } from 'vitest';

import {
  classifyExternalOwnership,
  type ObservedOwnershipMarker,
} from '../../../src/core/change-run/internal/ownership.js';

const EFFECT = `effect:${'1'.repeat(58)}11`;
const OTHER = `effect:${'2'.repeat(58)}22`;

const absent: ObservedOwnershipMarker = {
  resourcePresent: false,
  wellFormed: true,
};
const ownedByThis: ObservedOwnershipMarker = {
  resourcePresent: true,
  wellFormed: true,
  creditedEffectId: EFFECT,
};
const ownedByOther: ObservedOwnershipMarker = {
  resourcePresent: true,
  wellFormed: true,
  creditedEffectId: OTHER,
};
const tampered: ObservedOwnershipMarker = {
  resourcePresent: true,
  wellFormed: false,
  creditedEffectId: EFFECT,
};
const attributionless: ObservedOwnershipMarker = {
  resourcePresent: true,
  wellFormed: true,
};

describe('external ownership classification (6.11/6.12)', () => {
  it('classifies a fresh resource as new', () => {
    expect(classifyExternalOwnership(EFFECT, absent)).toBe('new');
  });

  it('credits only the exact EffectId as owned (idempotent under response loss)', () => {
    expect(classifyExternalOwnership(EFFECT, ownedByThis)).toBe('owned');
    // Re-querying after a response loss yields the same owned verdict -> no duplicate effect.
    expect(classifyExternalOwnership(EFFECT, ownedByThis)).toBe('owned');
  });

  it('returns conflict when a different Run/Effect owns the resource', () => {
    expect(classifyExternalOwnership(EFFECT, ownedByOther)).toBe('conflict');
  });

  it('keeps a tampered marker uncertain rather than treating it as success', () => {
    expect(classifyExternalOwnership(EFFECT, tampered)).toBe('uncertain');
  });

  it('keeps a present-but-unattributed resource uncertain (preexisting identical output)', () => {
    expect(classifyExternalOwnership(EFFECT, attributionless)).toBe('uncertain');
  });
});
