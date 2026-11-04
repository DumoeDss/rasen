import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Relpath→content map of a directory tree. Directories are recorded too
 * (as `<relpath>/` entries) so a command deleting an empty subdirectory
 * cannot pass a byte-identity check.
 */
export function snapshotDirectory(root: string): Map<string, string> {
  const snapshot = new Map<string, string>();

  // Keys are POSIX-normalized so assertions like has('openspec/...')
  // behave identically on Windows (test/AGENTS.md).
  const relKey = (fullPath: string): string =>
    path.relative(root, fullPath).split(path.sep).join('/');

  // git's auto-maintenance creates and asynchronously removes
  // .git/objects/maintenance.lock after commits (observed racing on macOS
  // runners). It is git's own scratch state, never fixture content, so a
  // before/after byte-identity assertion must not observe it.
  const TRANSIENT_GIT_LOCK = '.git/objects/maintenance.lock';

  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (relKey(fullPath) === TRANSIENT_GIT_LOCK) continue;
      if (entry.isDirectory()) {
        snapshot.set(`${relKey(fullPath)}/`, '');
        walk(fullPath);
      } else if (entry.isFile()) {
        snapshot.set(relKey(fullPath), fs.readFileSync(fullPath, 'utf-8'));
      }
    }
  };

  walk(root);
  return snapshot;
}
