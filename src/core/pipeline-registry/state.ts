import type { CompletedSet } from './types.js';

/**
 * Creates an empty completion set.
 */
export function createCompletedSet(initial?: Iterable<string>): CompletedSet {
  return new Set<string>(initial ?? []);
}

/**
 * Returns a new completion set with the given stage id added.
 * Does not mutate the input set.
 */
export function markCompleted(completed: CompletedSet, stageId: string): CompletedSet {
  const next = new Set(completed);
  next.add(stageId);
  return next;
}

/**
 * Returns a new completion set with the given stage id removed.
 * Does not mutate the input set.
 */
export function unmarkCompleted(completed: CompletedSet, stageId: string): CompletedSet {
  const next = new Set(completed);
  next.delete(stageId);
  return next;
}

/**
 * Checks whether a stage id is present in the completion set.
 */
export function isStageCompleted(completed: CompletedSet, stageId: string): boolean {
  return completed.has(stageId);
}
