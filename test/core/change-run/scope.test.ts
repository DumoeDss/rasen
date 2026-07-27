import { describe, expect, it } from 'vitest';

import {
  ScopeError,
  assertMutationScope,
  classifyRunScope,
  type ScopeIdentity,
} from '../../../src/core/change-run/internal/scope.js';

const same: ScopeIdentity = {
  planningSpaceId: 'planning-space:1',
  workspaceInstanceId: 'workspace-instance:a',
};
const otherWorktree: ScopeIdentity = {
  planningSpaceId: 'planning-space:1',
  workspaceInstanceId: 'workspace-instance:b',
};
const otherSpace: ScopeIdentity = {
  planningSpaceId: 'planning-space:2',
  workspaceInstanceId: 'workspace-instance:a',
};

describe('selected-root scope (8.9)', () => {
  it('classifies same / other-worktree / mismatch', () => {
    expect(classifyRunScope(same, same)).toBe('same');
    expect(classifyRunScope(same, otherWorktree)).toBe('other');
    expect(classifyRunScope(same, otherSpace)).toBe('mismatch');
  });

  it('allows mutation only on the exact same workspace', () => {
    expect(() => assertMutationScope(same, same)).not.toThrow();
    expect(() => assertMutationScope(same, otherWorktree)).toThrowError(ScopeError);
    expect(() => assertMutationScope(same, otherSpace)).toThrowError(ScopeError);
  });
});
