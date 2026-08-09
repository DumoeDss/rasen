import { describe, expect, it } from 'vitest';

import {
  HOOKS_DIR,
  resolveHookInstallDecision,
} from '../../scripts/repo-hygiene/install-git-hooks.mjs';

function decide(overrides: Record<string, unknown> = {}) {
  return resolveHookInstallDecision({
    env: {},
    isGitWorkTree: true,
    configuredHooksPath: '',
    desiredHooksPath: HOOKS_DIR,
    ...overrides,
  });
}

describe('git hook installation decision', () => {
  it('installs in a normal git work tree with no hooks path configured', () => {
    expect(decide()).toEqual({ action: 'install', reason: 'unconfigured' });
  });

  it('is idempotent when already pointed at the tracked hooks directory', () => {
    expect(decide({ configuredHooksPath: HOOKS_DIR })).toEqual({
      action: 'install',
      reason: 'already-configured',
    });
  });

  it('never clobbers a developer&apos;s own hooks path', () => {
    expect(decide({ configuredHooksPath: '.my-hooks' })).toEqual({
      action: 'skip',
      reason: 'foreign-hooks-path',
    });
  });

  it('skips outside a git work tree so dependency installs still succeed', () => {
    expect(decide({ isGitWorkTree: false })).toEqual({
      action: 'skip',
      reason: 'no-git-work-tree',
    });
  });

  it('skips in CI, which gates on its own job rather than local git config', () => {
    expect(decide({ env: { CI: 'true' } })).toEqual({ action: 'skip', reason: 'ci' });
  });

  it('honors the documented opt-out ahead of every other signal', () => {
    expect(
      decide({ env: { RASEN_SKIP_GIT_HOOKS: '1', CI: 'true' }, isGitWorkTree: false })
    ).toEqual({ action: 'skip', reason: 'opt-out' });
  });
});
