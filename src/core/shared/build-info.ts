/**
 * Local (unreleased) build provenance for `rasen --version`.
 *
 * A tarball produced by the `rasen-npm-pack` skill ships one extra file,
 * `dist/build-info.json`, and leaves `package.json` at its canonical
 * `X.Y.Z`. Keeping the stamp OUT of the version string is deliberate: skill
 * `generatedBy` stamps (`tool-detection.ts`), the daemon handshake
 * (`daemon.ts`), `.rasenpkg` `minRasenVersion` preflight
 * (`workflow-package/version-gate.ts`) and the CLI/UI lockstep release checks
 * all compare version strings, so a `-dev.local.N` suffix made a locally
 * built CLI report spurious mismatches against skills, daemons and packages
 * created by the same source tree.
 *
 * The file is absent from every published install: only the pack helper
 * writes it (after `pnpm run build`, before `npm pack`), and `build.js`
 * deletes `dist/` at the start of every build — so a plain `pnpm run build`,
 * a CI build and a registry install all read `null` here and print the bare
 * version.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export interface LocalBuildInfo {
  /** Provenance channel; `dev.local` for a tarball built by the pack skill. */
  channel: string;
  /** Short commit the build came from, when the source tree is a Git checkout. */
  commit?: string;
}

/**
 * `<package root>/dist/build-info.json`. Resolved through the package
 * manifest rather than `import.meta.url` so the path is identical whether
 * this module runs from `src/core/shared/` (tests, ts-node) or the compiled
 * `dist/core/shared/`.
 */
export function localBuildInfoPath(): string {
  const packageJsonPath = require.resolve('../../../package.json');
  return path.join(path.dirname(packageJsonPath), 'dist', 'build-info.json');
}

/**
 * Reads the local build stamp, or null when this is an ordinary install.
 * Never throws and never partially trusts the file: a missing, unreadable,
 * malformed or incomplete stamp degrades to `null`, i.e. to the bare version.
 */
export function readLocalBuildInfo(filePath: string = localBuildInfoPath()): LocalBuildInfo | null {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;

  const record = parsed as Record<string, unknown>;
  const channel = typeof record.channel === 'string' ? record.channel.trim() : '';
  if (!channel) return null;

  const info: LocalBuildInfo = { channel };
  if (typeof record.commit === 'string' && record.commit) info.commit = record.commit;
  return info;
}

/**
 * The string `rasen --version` prints. It ALWAYS starts with the bare
 * `package.json` version and appends nothing on a published install, so
 * `rasen --version` stays byte-identical there and any `^\d+\.\d+\.\d+`
 * parse keeps working. A local build appends its channel and the commit it
 * was built from: `0.1.7 (dev.local c915bf8e)`.
 *
 * Deliberately locale-neutral: this is provenance metadata on a machine-read
 * line, not prose, and it must not drift per catalog.
 */
export function formatCliVersion(
  version: string,
  info: LocalBuildInfo | null = readLocalBuildInfo()
): string {
  if (!info) return version;
  return info.commit
    ? `${version} (${info.channel} ${info.commit})`
    : `${version} (${info.channel})`;
}
