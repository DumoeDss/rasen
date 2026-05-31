import { describe, it, expect } from 'vitest';
import {
  createCompletedSet,
  markCompleted,
  unmarkCompleted,
  isStageCompleted,
} from '../../../src/core/pipeline-registry/state.js';

describe('pipeline-registry/state', () => {
  it('createCompletedSet returns empty set by default', () => {
    expect(createCompletedSet().size).toBe(0);
  });

  it('createCompletedSet seeds from an iterable', () => {
    const set = createCompletedSet(['a', 'b']);
    expect(isStageCompleted(set, 'a')).toBe(true);
    expect(isStageCompleted(set, 'b')).toBe(true);
    expect(isStageCompleted(set, 'c')).toBe(false);
  });

  it('markCompleted adds without mutating the input', () => {
    const base = createCompletedSet(['a']);
    const next = markCompleted(base, 'b');
    expect(isStageCompleted(next, 'b')).toBe(true);
    expect(isStageCompleted(base, 'b')).toBe(false); // immutable
  });

  it('unmarkCompleted removes without mutating the input', () => {
    const base = createCompletedSet(['a', 'b']);
    const next = unmarkCompleted(base, 'b');
    expect(isStageCompleted(next, 'b')).toBe(false);
    expect(isStageCompleted(base, 'b')).toBe(true); // immutable
  });
});
