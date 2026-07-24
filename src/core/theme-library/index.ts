import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';

import { getGlobalDataDir, type GlobalDataDirOptions } from '../global-config.js';
import {
  BUILT_IN_THEME_IDS,
  validateThemeManifest,
  type ThemeManifest,
  type ThemeValidationDetail,
} from './manifest.js';

export * from './manifest.js';

export const MAX_THEME_BYTES = 256 * 1024;

export interface ThemeLibraryOptions extends GlobalDataDirOptions {
  dataDir?: string;
}

export interface SkippedTheme {
  file: string;
  code: string;
  details?: ThemeValidationDetail[];
}

export interface ThemeCatalog {
  themes: ThemeManifest[];
  skipped: SkippedTheme[];
}

export class ThemeLibraryError extends Error {
  constructor(
    public readonly code: 'payload_too_large' | 'invalid_json' | 'invalid_theme' | 'identifier_conflict' | 'persistence_failed',
    message: string,
    public readonly details?: ThemeValidationDetail[]
  ) {
    super(message);
    this.name = 'ThemeLibraryError';
  }
}

export function resolveThemesDir(options: ThemeLibraryOptions = {}): string {
  return path.join(options.dataDir ?? getGlobalDataDir(options), 'themes');
}

function samePath(left: string, right: string): boolean {
  const normalizedLeft = path.resolve(left);
  const normalizedRight = path.resolve(right);
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function isContained(parent: string, child: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

/**
 * Resolve the themes directory through the filesystem, never through a
 * directory symlink/junction. The canonical directory must be the canonical
 * data root's direct `themes` child.
 */
function canonicalThemesDir(
  options: ThemeLibraryOptions,
  create: boolean
): string | null {
  const dataRoot = path.resolve(options.dataDir ?? getGlobalDataDir(options));
  if (!fs.existsSync(dataRoot)) {
    if (!create) return null;
    fs.mkdirSync(dataRoot, { recursive: true });
  }
  if (!fs.statSync(dataRoot).isDirectory()) {
    throw new ThemeLibraryError('persistence_failed', 'The machine data root is not a directory.');
  }

  const canonicalRoot = fs.realpathSync.native(dataRoot);
  const lexicalThemesDir = path.join(dataRoot, 'themes');
  if (!fs.existsSync(lexicalThemesDir)) {
    if (!create) return null;
    fs.mkdirSync(lexicalThemesDir);
  }

  const directoryStat = fs.lstatSync(lexicalThemesDir);
  if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) {
    throw new ThemeLibraryError(
      'persistence_failed',
      'The themes directory must be a real directory beneath the machine data root.'
    );
  }

  const canonicalDir = fs.realpathSync.native(lexicalThemesDir);
  const expectedCanonicalDir = path.join(canonicalRoot, 'themes');
  if (
    !samePath(canonicalDir, expectedCanonicalDir) ||
    !samePath(path.dirname(canonicalDir), canonicalRoot)
  ) {
    throw new ThemeLibraryError(
      'persistence_failed',
      'The themes directory resolves outside the machine data root.'
    );
  }
  return canonicalDir;
}

/** Freshly reads direct, regular JSON files and reports bad entries without failing the catalog. */
export function listImportedThemes(options: ThemeLibraryOptions = {}): ThemeCatalog {
  const themes: ThemeManifest[] = [];
  const skipped: SkippedTheme[] = [];
  let dir: string | null;
  try {
    dir = canonicalThemesDir(options, false);
  } catch {
    return { themes, skipped: [{ file: 'themes', code: 'unsafe_directory' }] };
  }
  if (!dir) return { themes, skipped };

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.name.toLowerCase().endsWith('.json')) continue;
    const candidate = path.join(dir, entry.name);
    if (!isContained(dir, candidate) || !entry.isFile() || entry.isSymbolicLink()) {
      skipped.push({ file: entry.name, code: 'unsafe_entry' });
      continue;
    }
    try {
      const stat = fs.lstatSync(candidate);
      const canonicalCandidate = fs.realpathSync.native(candidate);
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        !samePath(canonicalCandidate, candidate) ||
        !samePath(path.dirname(canonicalCandidate), dir) ||
        stat.size > MAX_THEME_BYTES
      ) {
        skipped.push({ file: entry.name, code: stat.size > MAX_THEME_BYTES ? 'payload_too_large' : 'unsafe_entry' });
        continue;
      }
      const parsed: unknown = JSON.parse(fs.readFileSync(candidate, 'utf8'));
      const validation = validateThemeManifest(parsed);
      if (!validation.ok) {
        skipped.push({ file: entry.name, code: 'invalid_theme', details: validation.details });
        continue;
      }
      if (
        BUILT_IN_THEME_IDS.some((id) => id.toLowerCase() === validation.manifest.id.toLowerCase()) ||
        path.basename(entry.name, path.extname(entry.name)).toLowerCase() !== validation.manifest.id.toLowerCase()
      ) {
        skipped.push({ file: entry.name, code: 'identifier_conflict' });
        continue;
      }
      if (themes.some((theme) => theme.id.toLowerCase() === validation.manifest.id.toLowerCase())) {
        skipped.push({ file: entry.name, code: 'identifier_conflict' });
        continue;
      }
      themes.push(validation.manifest);
    } catch {
      skipped.push({ file: entry.name, code: 'invalid_json' });
    }
  }
  themes.sort((a, b) => a.name.localeCompare(b.name));
  return { themes, skipped };
}

/**
 * Validates entirely in memory, then publishes normalized JSON with a
 * same-directory hard-link. link(2) is atomic and never overwrites an existing
 * destination on Windows, macOS, or Linux.
 */
export function installTheme(
  input: string | Buffer | Uint8Array,
  options: ThemeLibraryOptions = {}
): ThemeManifest {
  const bytes = typeof input === 'string' ? Buffer.from(input) : Buffer.from(input);
  if (bytes.byteLength > MAX_THEME_BYTES) {
    throw new ThemeLibraryError('payload_too_large', `Theme document exceeds ${MAX_THEME_BYTES} bytes.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new ThemeLibraryError('invalid_json', 'Theme document is not valid JSON.');
  }
  // Collision classification precedes grammar validation for a case-only
  // variation of a reserved/installed id. It still uses the raw id only for
  // comparison; no destination path is constructed until full validation.
  const rawId =
    typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) &&
    typeof (parsed as { id?: unknown }).id === 'string'
      ? (parsed as { id: string }).id
      : undefined;
  if (
    rawId &&
    BUILT_IN_THEME_IDS.some((id) => id.toLowerCase() === rawId.toLowerCase())
  ) {
    throw new ThemeLibraryError('identifier_conflict', `Theme id "${rawId}" is already installed or reserved.`);
  }
  const validation = validateThemeManifest(parsed);
  if (!validation.ok) {
    throw new ThemeLibraryError('invalid_theme', 'Theme manifest failed validation.', validation.details);
  }
  const manifest = validation.manifest;
  const dir = canonicalThemesDir(options, true);
  if (!dir) {
    throw new ThemeLibraryError('persistence_failed', 'The themes directory could not be created.');
  }
  const catalog = listImportedThemes(options);
  if (catalog.skipped.some((entry) => entry.code === 'unsafe_directory')) {
    throw new ThemeLibraryError('persistence_failed', 'The themes directory is unsafe.');
  }
  const fileIds = fs.readdirSync(dir)
    .filter((name) => name.toLowerCase().endsWith('.json'))
    .map((name) => path.basename(name, path.extname(name)).toLowerCase());
  if (
    BUILT_IN_THEME_IDS.some((id) => id.toLowerCase() === manifest.id.toLowerCase()) ||
    catalog.themes.some((theme) => theme.id.toLowerCase() === manifest.id.toLowerCase()) ||
    fileIds.includes(manifest.id.toLowerCase())
  ) {
    throw new ThemeLibraryError('identifier_conflict', `Theme id "${manifest.id}" is already installed or reserved.`);
  }

  const finalPath = path.join(dir, `${manifest.id}.json`);
  if (!isContained(dir, finalPath)) {
    throw new ThemeLibraryError('invalid_theme', 'Theme identifier does not resolve beneath the theme directory.');
  }

  // Also protect hand-created invalid/case-variant files which listing skips.
  const collision = fs.readdirSync(dir).some((name) => name.toLowerCase() === `${manifest.id}.json`.toLowerCase());
  if (collision) {
    throw new ThemeLibraryError('identifier_conflict', `Theme id "${manifest.id}" is already installed or reserved.`);
  }

  const tempPath = path.join(dir, `.${manifest.id}.${process.pid}.${randomUUID()}.tmp`);
  let fd: number | undefined;
  try {
    const writeBoundaryDir = canonicalThemesDir(options, true);
    if (!writeBoundaryDir || !samePath(writeBoundaryDir, dir)) {
      throw new ThemeLibraryError('persistence_failed', 'The themes directory changed before installation.');
    }
    fd = fs.openSync(tempPath, 'wx', 0o600);
    const canonicalTemp = fs.realpathSync.native(tempPath);
    if (!samePath(path.dirname(canonicalTemp), dir)) {
      throw new ThemeLibraryError('persistence_failed', 'The temporary theme file resolved outside the theme directory.');
    }
    const normalized = `${JSON.stringify(manifest, null, 2)}\n`;
    fs.writeFileSync(fd, normalized, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    const publishBoundaryDir = canonicalThemesDir(options, true);
    if (!publishBoundaryDir || !samePath(publishBoundaryDir, dir)) {
      throw new ThemeLibraryError('persistence_failed', 'The themes directory changed before publication.');
    }
    fs.linkSync(tempPath, finalPath);
    return manifest;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new ThemeLibraryError('identifier_conflict', `Theme id "${manifest.id}" is already installed or reserved.`);
    }
    if (error instanceof ThemeLibraryError) throw error;
    throw new ThemeLibraryError('persistence_failed', 'Theme could not be installed.');
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { /* best-effort */ }
    }
    try { fs.unlinkSync(tempPath); } catch { /* absent or best-effort cleanup */ }
  }
}
