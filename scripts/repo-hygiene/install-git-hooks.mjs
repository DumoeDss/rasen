import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const HOOKS_DIR = '.githooks';

/**
 * Decide whether to arm the tracked hooks directory.
 *
 * Pure so the decision table is testable without touching git config. Every
 * non-install outcome is a silent skip rather than a failure: this runs from
 * `prepare`, and a dependency install must never fail because of a developer
 * convenience.
 */
export function resolveHookInstallDecision(input) {
  const env = input.env ?? {};
  if (env.RASEN_SKIP_GIT_HOOKS) {
    return { action: 'skip', reason: 'opt-out' };
  }
  if (env.CI) {
    // CI runs the same checks as its own job; mutating runner git config
    // buys nothing and would only differ from what the job actually gates on.
    return { action: 'skip', reason: 'ci' };
  }
  if (!input.isGitWorkTree) {
    return { action: 'skip', reason: 'no-git-work-tree' };
  }
  const configured = (input.configuredHooksPath ?? '').trim();
  if (configured !== '' && configured !== input.desiredHooksPath) {
    // Never clobber a developer's own hook setup.
    return { action: 'skip', reason: 'foreign-hooks-path' };
  }
  return { action: 'install', reason: configured === '' ? 'unconfigured' : 'already-configured' };
}

function git(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.error || result.status !== 0) return null;
  return result.stdout.trim();
}

function main(repositoryRoot) {
  const decision = resolveHookInstallDecision({
    env: process.env,
    isGitWorkTree: git(['rev-parse', '--is-inside-work-tree'], repositoryRoot) === 'true',
    configuredHooksPath: git(['config', '--local', 'core.hooksPath'], repositoryRoot) ?? '',
    desiredHooksPath: HOOKS_DIR,
  });

  if (decision.action === 'skip') {
    if (decision.reason === 'foreign-hooks-path') {
      process.stdout.write(
        `Rasen: leaving your existing core.hooksPath alone; the pre-commit guard in ${HOOKS_DIR}/ is not armed.\n`
      );
    }
    return;
  }

  if (git(['config', '--local', 'core.hooksPath', HOOKS_DIR], repositoryRoot) === null) {
    process.stdout.write('Rasen: could not set core.hooksPath; the pre-commit guard is not armed.\n');
    return;
  }

  // Git needs the hook executable on POSIX. On Windows the bit is meaningless
  // and chmod is a no-op, so this is safe to run unconditionally.
  const hookPath = path.join(repositoryRoot, HOOKS_DIR, 'pre-commit');
  try {
    fs.chmodSync(hookPath, 0o755);
  } catch {
    // A missing or unchmod-able hook is not worth failing an install over;
    // git will simply not run it.
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  main(path.resolve(here, '..', '..'));
}
