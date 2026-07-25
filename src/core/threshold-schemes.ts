import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { z } from 'zod';

import { getGlobalConfigDir } from './global-config.js';
import {
  REUSE_THRESHOLD_ROLES,
  THRESHOLD_ROLES,
  thresholdSchema,
  type ReuseThresholdRole,
  type ThresholdRole,
  type ThresholdValue,
} from './threshold-values.js';
import {
  bestEffortCloseThresholdSchemeFile,
  bestEffortRemoveThresholdSchemeFile,
} from './threshold-scheme-lock-internal.js';
import { formatZodIssues } from './zod-issues.js';

export const THRESHOLD_SCHEMES_DIR_NAME = 'schemes';
export const MAX_THRESHOLD_SCHEME_FILE_BYTES = 1024 * 1024;
export const THRESHOLD_SCHEME_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
export const RESERVED_THRESHOLD_SCHEME_NAMES = ['default'] as const;
export const ThresholdSchemeNameSchema = z
  .string()
  .regex(THRESHOLD_SCHEME_NAME_PATTERN)
  .refine((name) => name !== 'default', {
    error: 'Scheme name "default" is reserved for the fallback binding row.',
  });

const HandoffRoleThresholdsSchema = z
  .object(
    Object.fromEntries(
      THRESHOLD_ROLES.map((role) => [role, thresholdSchema('threshold').optional()])
    )
  )
  .strict() as z.ZodType<Partial<Record<ThresholdRole, ThresholdValue>>>;

const ReuseRoleThresholdsSchema = z
  .object(
    Object.fromEntries(
      REUSE_THRESHOLD_ROLES.map((role) => [
        role,
        thresholdSchema('reuse threshold').optional(),
      ])
    )
  )
  .strict() as z.ZodType<Partial<Record<ReuseThresholdRole, ThresholdValue>>>;

export const ThresholdSchemeSchema = z
  .object({
    handoff: thresholdSchema('handoff threshold'),
    handoffRoles: HandoffRoleThresholdsSchema.optional(),
    reuse: thresholdSchema('reuse threshold'),
    reuseRoles: ReuseRoleThresholdsSchema.optional(),
  })
  .strict();

export interface ThresholdScheme {
  handoff: ThresholdValue;
  handoffRoles?: Partial<Record<ThresholdRole, ThresholdValue>>;
  reuse: ThresholdValue;
  reuseRoles?: Partial<Record<ReuseThresholdRole, ThresholdValue>>;
}

export type ThresholdSchemeListEntry =
  | { name: string; valid: true; scheme: ThresholdScheme }
  | { name: string; valid: false; error: string };

export class ThresholdSchemeError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'invalid_name'
      | 'reserved_name'
      | 'not_found'
      | 'already_exists'
      | 'invalid_file'
      | 'lock_timeout'
  ) {
    super(message);
    this.name = 'ThresholdSchemeError';
  }
}

export function validateThresholdSchemeName(name: string): string | null {
  if (!THRESHOLD_SCHEME_NAME_PATTERN.test(name)) {
    return 'Scheme names must be 1-64 characters, start with a lowercase letter or digit, and contain only lowercase letters, digits, dots, underscores, or hyphens.';
  }
  if (RESERVED_THRESHOLD_SCHEME_NAMES.includes(name as 'default')) {
    return 'Scheme name "default" is reserved for the fallback binding row.';
  }
  return null;
}

export function assertValidThresholdSchemeName(name: string): void {
  const problem = validateThresholdSchemeName(name);
  if (!problem) return;
  throw new ThresholdSchemeError(
    `Invalid threshold scheme name "${name}": ${problem}`,
    RESERVED_THRESHOLD_SCHEME_NAMES.includes(name as 'default')
      ? 'reserved_name'
      : 'invalid_name'
  );
}

export function parseThresholdScheme(
  input: unknown,
  source = 'threshold scheme'
): ThresholdScheme {
  const parsed = ThresholdSchemeSchema.safeParse(input);
  if (!parsed.success) {
    throw new ThresholdSchemeError(
      `Invalid ${source}: ${formatZodIssues(parsed.error)}`,
      'invalid_file'
    );
  }
  return parsed.data;
}

export function getThresholdSchemesDir(): string {
  return path.join(getGlobalConfigDir(), THRESHOLD_SCHEMES_DIR_NAME);
}

export function getThresholdSchemePath(name: string): string {
  assertValidThresholdSchemeName(name);
  return path.join(getThresholdSchemesDir(), `${name}.yaml`);
}

function parseThresholdSchemeContent(content: string, source: string): ThresholdScheme {
  let raw: unknown;
  try {
    raw = parseYaml(content);
  } catch (error) {
    throw new ThresholdSchemeError(
      `Invalid threshold scheme "${source}": ${
        error instanceof Error ? error.message : String(error)
      }`,
      'invalid_file'
    );
  }
  return parseThresholdScheme(raw, `threshold scheme "${source}"`);
}

function readThresholdSchemeFile(filePath: string, name: string): ThresholdScheme {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new ThresholdSchemeError(`Threshold scheme "${name}" was not found.`, 'not_found');
    }
    throw error;
  }
  if (!stat.isFile()) {
    throw new ThresholdSchemeError(
      `Threshold scheme "${name}" is not a file: ${filePath}`,
      'invalid_file'
    );
  }
  if (stat.size > MAX_THRESHOLD_SCHEME_FILE_BYTES) {
    throw new ThresholdSchemeError(
      `Threshold scheme "${name}" is too large (${stat.size} bytes; maximum ${MAX_THRESHOLD_SCHEME_FILE_BYTES}).`,
      'invalid_file'
    );
  }
  return parseThresholdSchemeContent(fs.readFileSync(filePath, 'utf-8'), name);
}

export function readThresholdScheme(name: string): ThresholdScheme {
  return readThresholdSchemeFile(getThresholdSchemePath(name), name);
}

export function listThresholdSchemes(): ThresholdSchemeListEntry[] {
  const dir = getThresholdSchemesDir();
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }

  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.yaml'))
    .map((entry) => ({
      name: path.basename(entry.name, '.yaml'),
      filePath: path.join(dir, entry.name),
    }))
    .sort((left, right) => left.name.localeCompare(right.name))
    .map(({ name, filePath }): ThresholdSchemeListEntry => {
      const nameProblem = validateThresholdSchemeName(name);
      if (nameProblem) {
        return {
          name,
          valid: false,
          error: `Invalid threshold scheme name "${name}": ${nameProblem}`,
        };
      }
      try {
        return { name, valid: true, scheme: readThresholdSchemeFile(filePath, name) };
      } catch (error) {
        return {
          name,
          valid: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    });
}

export function listValidThresholdSchemeNames(): string[] {
  try {
    return listThresholdSchemes()
      .filter(
        (entry): entry is Extract<ThresholdSchemeListEntry, { valid: true }> => entry.valid
      )
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

const SCHEME_LOCK_TIMEOUT_MS = 5_000;
const SCHEME_LOCK_RETRY_MS = 10;
const lockWaitBuffer = new Int32Array(new SharedArrayBuffer(4));

function waitForSchemeLock(): void {
  Atomics.wait(lockWaitBuffer, 0, 0, SCHEME_LOCK_RETRY_MS);
}

interface SchemeLockOwnership {
  fd: number;
  lockPath: string;
  token: string;
  dev: bigint;
  ino: bigint;
}

function releaseSchemeLock(lock: SchemeLockOwnership): void {
  bestEffortCloseThresholdSchemeFile(lock.fd);

  try {
    const current = fs.lstatSync(lock.lockPath, { bigint: true });
    if (current.dev !== lock.dev || current.ino !== lock.ino) return;
    if (fs.readFileSync(lock.lockPath, 'utf8') !== lock.token) return;
  } catch {
    // The holder may already have been cleaned up, or the path may be
    // temporarily unreadable. In either case, never risk removing a lock whose
    // ownership cannot be proved.
    return;
  }

  bestEffortRemoveThresholdSchemeFile(lock.lockPath);
}

function withSchemeLock<T>(targetPath: string, action: () => T): T {
  const dir = path.dirname(targetPath);
  fs.mkdirSync(dir, { recursive: true });
  const lockPath = path.join(dir, `.${path.basename(targetPath)}.lock`);
  const startedAt = Date.now();
  let lock: SchemeLockOwnership | undefined;

  while (lock === undefined) {
    let lockFd: number | undefined;
    try {
      lockFd = fs.openSync(lockPath, 'wx', 0o600);
      const token = `${process.pid}\n${Date.now()}\n${crypto.randomBytes(16).toString('hex')}\n`;
      try {
        fs.writeFileSync(lockFd, token, 'utf8');
        const stat = fs.fstatSync(lockFd, { bigint: true });
        lock = {
          fd: lockFd,
          lockPath,
          token,
          dev: stat.dev,
          ino: stat.ino,
        };
      } catch (error) {
        bestEffortCloseThresholdSchemeFile(lockFd);
        bestEffortRemoveThresholdSchemeFile(lockPath);
        throw error;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;

      if (Date.now() - startedAt >= SCHEME_LOCK_TIMEOUT_MS) {
        throw new ThresholdSchemeError(
          `Threshold scheme "${path.basename(targetPath, '.yaml')}" is busy. Retry shortly. If contention persists, inspect ${lockPath}, confirm that no Rasen process is actively mutating this scheme, then remove that lock file manually.`,
          'lock_timeout'
        );
      }
      waitForSchemeLock();
    }
  }

  try {
    return action();
  } finally {
    releaseSchemeLock(lock);
  }
}

function targetExists(targetPath: string): boolean {
  try {
    fs.lstatSync(targetPath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

function writeNewSchemeNoClobber(targetPath: string, content: string): void {
  const dir = path.dirname(targetPath);
  const suffix = `${process.pid}-${crypto.randomBytes(8).toString('hex')}`;
  const temporaryPath = path.join(dir, `.${path.basename(targetPath)}.${suffix}.tmp`);

  fs.writeFileSync(temporaryPath, content, { flag: 'wx', mode: 0o600 });
  try {
    try {
      // A hard link publishes the already-complete temporary inode without a
      // replace mode. The destination transition is atomic and fails when any
      // file-system entry already owns the scheme name on Windows and POSIX.
      fs.linkSync(temporaryPath, targetPath);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (
        code === 'EEXIST' ||
        ((code === 'EACCES' || code === 'EPERM') && targetExists(targetPath))
      ) {
        throw new ThresholdSchemeError(
          `Threshold scheme "${path.basename(targetPath, '.yaml')}" already exists.`,
          'already_exists'
        );
      }
      throw error;
    }
  } finally {
    bestEffortRemoveThresholdSchemeFile(temporaryPath);
  }
}

function replaceSchemeSafely(targetPath: string, content: string): void {
  const dir = path.dirname(targetPath);
  let targetStat: fs.Stats | undefined;
  try {
    targetStat = fs.lstatSync(targetPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (targetStat && !targetStat.isFile() && !targetStat.isSymbolicLink()) {
    throw new ThresholdSchemeError(
      `Threshold scheme destination is not a file: ${targetPath}`,
      'invalid_file'
    );
  }

  const suffix = `${process.pid}-${crypto.randomBytes(8).toString('hex')}`;
  const temporaryPath = path.join(dir, `.${path.basename(targetPath)}.${suffix}.tmp`);
  const backupPath = path.join(dir, `.${path.basename(targetPath)}.${suffix}.bak`);

  fs.writeFileSync(temporaryPath, content, { flag: 'wx', mode: 0o600 });
  try {
    if (!targetStat) {
      fs.renameSync(temporaryPath, targetPath);
      return;
    }
    fs.renameSync(targetPath, backupPath);
    try {
      fs.renameSync(temporaryPath, targetPath);
    } catch (error) {
      try {
        if (fs.existsSync(targetPath)) fs.rmSync(targetPath, { force: true });
        fs.renameSync(backupPath, targetPath);
      } catch (restoreError) {
        throw new Error(
          `Failed to replace ${targetPath}; the previous scheme remains at ${backupPath}: ${
            restoreError instanceof Error ? restoreError.message : String(restoreError)
          }`,
          { cause: error }
        );
      }
      throw error;
    }
    try {
      fs.rmSync(backupPath, { force: true });
    } catch {
      // Replacement succeeded; retaining the uniquely named backup is safer.
    }
  } finally {
    bestEffortRemoveThresholdSchemeFile(temporaryPath);
  }
}

function normalizedSchemeContent(name: string, scheme: ThresholdScheme): {
  normalized: ThresholdScheme;
  content: string;
} {
  const normalized = parseThresholdScheme(scheme, `threshold scheme "${name}"`);
  return {
    normalized,
    content: stringifyYaml(normalized, { lineWidth: 0 }),
  };
}

export function createThresholdScheme(
  name: string,
  scheme: ThresholdScheme
): ThresholdScheme {
  const targetPath = getThresholdSchemePath(name);
  const { normalized, content } = normalizedSchemeContent(name, scheme);
  return withSchemeLock(targetPath, () => {
    writeNewSchemeNoClobber(targetPath, content);
    return normalized;
  });
}

export function updateThresholdScheme(
  name: string,
  scheme: ThresholdScheme
): ThresholdScheme {
  const targetPath = getThresholdSchemePath(name);
  const { normalized, content } = normalizedSchemeContent(name, scheme);
  return withSchemeLock(targetPath, () => {
    if (!targetExists(targetPath)) {
      throw new ThresholdSchemeError(
        `Threshold scheme "${name}" was not found.`,
        'not_found'
      );
    }
    replaceSchemeSafely(targetPath, content);
    return normalized;
  });
}

export function saveThresholdScheme(name: string, scheme: ThresholdScheme): string {
  const targetPath = getThresholdSchemePath(name);
  const { content } = normalizedSchemeContent(name, scheme);
  withSchemeLock(targetPath, () => {
    if (targetExists(targetPath)) {
      replaceSchemeSafely(targetPath, content);
    } else {
      writeNewSchemeNoClobber(targetPath, content);
    }
  });
  return targetPath;
}

export function deleteThresholdScheme(name: string): void {
  const targetPath = getThresholdSchemePath(name);
  withSchemeLock(targetPath, () => {
    if (!targetExists(targetPath)) {
      throw new ThresholdSchemeError(
        `Threshold scheme "${name}" was not found.`,
        'not_found'
      );
    }
    fs.rmSync(targetPath);
  });
}
