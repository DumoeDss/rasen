/**
 * Optional UI package resolution (design.md D7). The package name lives in
 * ONE constant so a rename touches one place; resolution tries the CLI's own
 * module-resolution path first (covers global installs where the UI package
 * lands beside the CLI in the same `node_modules`), then a sibling-directory
 * probe from the CLI package root (covers package-manager layouts, e.g.
 * pnpm's isolated global store, where sibling packages are off the
 * resolution path).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

/** The single source of truth for the UI package's name — rename here only. */
export const UI_PACKAGE_NAME = '@atelierai/rasen-ui';

/** Absolute path to this CLI package's own root (three levels up from `dist/core/config-api/`). */
function cliPackageRoot(): string {
  const currentFile = fileURLToPath(import.meta.url);
  return path.join(path.dirname(currentFile), '..', '..', '..');
}

function distDirIfExists(candidate: string): string | null {
  const dist = path.join(candidate, 'dist');
  try {
    return fs.statSync(dist).isDirectory() ? dist : null;
  } catch {
    return null;
  }
}

/**
 * Resolves the UI package's `dist/` directory, or null when it is not
 * installed anywhere this probe knows to look. Never throws.
 */
export function resolveUiPackageDir(): string | null {
  const require = createRequire(import.meta.url);
  try {
    const pkgJsonPath = require.resolve(`${UI_PACKAGE_NAME}/package.json`, {
      paths: [cliPackageRoot()],
    });
    const dist = distDirIfExists(path.dirname(pkgJsonPath));
    if (dist) return dist;
  } catch {
    // Fall through to the sibling probe.
  }

  const siblingRoot = path.join(cliPackageRoot(), '..', UI_PACKAGE_NAME);
  return distDirIfExists(siblingRoot);
}
