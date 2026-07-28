import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/**
 * The `.rasenpkg` format version this CLI understands. Kept separate from the
 * running CLI's own release version — a new package `kind` (e.g. `pipeline`)
 * is a union extension within this format version, not a bump.
 */
export const SUPPORTED_PACKAGE_FORMAT_VERSION = 1;

/**
 * Reads the running CLI's own version from package.json — version-agnostic
 * (never a hardcoded literal), so this stays correct release over release.
 */
export function readCliVersion(): string {
  return (require('../../../package.json') as { version: string }).version;
}

function parseSemver(value: string): [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(value.trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/**
 * True when `version` is strictly older than `minVersion` (major.minor.patch
 * only — pre-release/build metadata is ignored). Either side failing to parse
 * returns false — this function itself FAILS OPEN (does not block) rather
 * than raising on a malformed value. This matters because `preflightPackageVersion`
 * calls it on RAW, not-yet-schema-validated JSON: a garbage `minRasenVersion`
 * (e.g. `"banana"`) silently passes the preflight here. It is only caught
 * afterward, when `RasenPackageSchema.safeParse` runs and rejects the field
 * against its semver-shape regex (`schema.ts`) with `package_schema_invalid` —
 * a different, less specific error than the clear upgrade message this
 * preflight gives for a validly-shaped but too-new version.
 */
export function isVersionOlder(version: string, minVersion: string): boolean {
  const a = parseSemver(version);
  const b = parseSemver(minVersion);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] < b[i];
  }
  return false;
}

export interface PackageVersionPreflightIssue {
  code: 'package_format_unsupported' | 'package_requires_newer_rasen';
  message: string;
  details: Record<string, string | number>;
}

/**
 * Extracts `formatVersion` / `minRasenVersion` from raw (not-yet-schema
 * validated) package JSON and checks them against what this CLI supports,
 * BEFORE the strict `RasenPackageSchema.safeParse`. This is what lets an
 * older CLI reject a newer package with a clear "upgrade rasen" message
 * instead of an opaque schema-validation failure.
 *
 * Honest limitation (documented, not hidden): a CLI that PREDATES this
 * preflight has no way to run it — handed a package it cannot parse (e.g. an
 * unknown `kind`), it fails at `discriminatedUnion` parse with an opaque
 * `package_schema_invalid`. This preflight only helps THIS and future CLIs
 * give clear messages for packages newer than themselves.
 */
export function preflightPackageVersion(
  raw: unknown,
  runningVersion: string = readCliVersion()
): PackageVersionPreflightIssue | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;

  const formatVersion = record.formatVersion;
  if (typeof formatVersion === 'number' && formatVersion > SUPPORTED_PACKAGE_FORMAT_VERSION) {
    return {
      code: 'package_format_unsupported',
      message: `This package uses format version ${formatVersion}, which this rasen CLI (format ${SUPPORTED_PACKAGE_FORMAT_VERSION}) does not support; upgrade rasen to import it.`,
      details: { formatVersion, supported: SUPPORTED_PACKAGE_FORMAT_VERSION },
    };
  }

  const minRasenVersion = record.minRasenVersion;
  if (typeof minRasenVersion === 'string' && isVersionOlder(runningVersion, minRasenVersion)) {
    return {
      code: 'package_requires_newer_rasen',
      message: `This package requires rasen >= ${minRasenVersion}; you have ${runningVersion} — upgrade rasen to import it.`,
      details: { minRasenVersion, runningVersion },
    };
  }

  return null;
}
