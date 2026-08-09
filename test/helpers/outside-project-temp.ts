import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

function hasRasenWorkspaceAncestor(startPath: string): boolean {
  let current = fs.realpathSync.native(startPath);

  for (;;) {
    try {
      if (fs.statSync(path.join(current, 'rasen')).isDirectory()) return true;
    } catch {
      // A missing or unreadable sibling is not a workspace marker.
    }

    const parent = path.dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

/**
 * Creates a temp directory whose full ancestor chain has no `rasen/`
 * workspace marker. `os.tmpdir()` alone cannot guarantee that: on a machine
 * retaining the legacy `%LOCALAPPDATA%/rasen` data directory, every child of
 * `%LOCALAPPDATA%/Temp` otherwise resolves as the `%LOCALAPPDATA%` project.
 */
export function createOutsideProjectTempDir(prefix: string): string {
  const cwd = fs.realpathSync.native(process.cwd());
  const systemTemp = fs.realpathSync.native(os.tmpdir());
  const candidateBases = [
    path.parse(cwd).root,
    path.parse(systemTemp).root,
    path.dirname(cwd),
    systemTemp,
  ];
  const attempted = new Set<string>();

  for (const rawBase of candidateBases) {
    let base: string;
    try {
      base = fs.realpathSync.native(rawBase);
    } catch {
      continue;
    }
    const identity = process.platform === 'win32' ? base.toLowerCase() : base;
    if (attempted.has(identity) || hasRasenWorkspaceAncestor(base)) continue;
    attempted.add(identity);

    let tempDir: string | undefined;
    try {
      tempDir = fs.mkdtempSync(path.join(base, prefix));
      tempDir = fs.realpathSync.native(tempDir);
      if (!hasRasenWorkspaceAncestor(tempDir)) return tempDir;
    } catch {
      // Try the next existing, writable base.
    }

    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  }

  throw new Error(
    `Could not create an outside-project temp directory; candidate bases: ${candidateBases.join(', ')}`
  );
}
