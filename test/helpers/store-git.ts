import * as fs from 'node:fs';
import * as path from 'node:path';

import { DEFAULT_OPENSPEC_SCHEMA } from '../../src/core/index.js';

/**
 * Shared fixtures for store tests that touch real Git.
 */

export function createHealthyOpenSpecRoot(root: string, configName = 'config.yaml'): void {
  fs.mkdirSync(path.join(root, 'rasen', 'specs'), { recursive: true });
  fs.mkdirSync(path.join(root, 'rasen', 'changes', 'archive'), { recursive: true });
  fs.writeFileSync(path.join(root, 'rasen', configName), `schema: ${DEFAULT_OPENSPEC_SCHEMA}\n`);
}

/**
 * Isolates real git invocations from the host's gitconfig (signing, hooks,
 * templates) and provides a deterministic commit identity.
 *
 * `core.longpaths` is enabled so git's own file operations (object writes,
 * index updates) succeed when a Store root is intentionally pushed past the
 * classic Windows MAX_PATH budget. It does not relax the separate constraint
 * that `git -C` and `git init <path>` keep the Store root itself under that
 * budget — those entry points chdir before git reads any config.
 *
 * `gc.auto` and `maintenance.auto` are disabled so a read-only pass (e.g. an
 * inventory fingerprint) never triggers background maintenance that writes
 * `commit-graph`/`maintenance.lock` under `.git` — which would both race the
 * lock (ENOENT on macOS CI) and break tests that assert inventory leaves the
 * Store untouched.
 */
export function isolatedGitEnv(tempDir: string): NodeJS.ProcessEnv {
  const isolatedConfig = path.join(tempDir, 'gitconfig-isolated');
  if (!fs.existsSync(isolatedConfig)) {
    fs.writeFileSync(
      isolatedConfig,
      ['[core]', '\tlongpaths = true', '[gc]', '\tauto = 0', '[maintenance]', '\tauto = false', ''].join(
        '\n'
      )
    );
  }
  return {
    GIT_CONFIG_GLOBAL: isolatedConfig,
    GIT_CONFIG_SYSTEM: isolatedConfig,
    GIT_AUTHOR_NAME: 'Store Tester',
    GIT_AUTHOR_EMAIL: 'tester@example.com',
    GIT_COMMITTER_NAME: 'Store Tester',
    GIT_COMMITTER_EMAIL: 'tester@example.com',
  };
}
