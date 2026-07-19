import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { z } from 'zod';

import { getGlobalConfigDir, type Delivery } from './global-config.js';
import { ALL_WORKFLOWS, CORE_WORKFLOWS } from './profiles.js';
import { formatZodIssues } from './zod-issues.js';

export const PROFILE_DEFINITION_VERSION = 1 as const;
export const PROFILE_DIR_NAME = 'profiles';
export const BUILTIN_PROFILE_NAMES = ['full', 'core'] as const;
export const RESERVED_PROFILE_NAMES = ['full', 'core', 'custom'] as const;

const MAX_PROFILE_FILE_BYTES = 1024 * 1024;
const PROFILE_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const SUPPORTED_IMPORT_EXTENSIONS = new Set(['.json', '.yaml', '.yml']);

const ProfileDefinitionSchema = z
  .object({
    version: z.literal(PROFILE_DEFINITION_VERSION),
    delivery: z.enum(['both', 'skills']),
    workflows: z.array(z.string()),
  })
  .strict()
  .superRefine((definition, context) => {
    const seen = new Set<string>();
    for (const [index, workflow] of definition.workflows.entries()) {
      if (!ALL_WORKFLOWS.includes(workflow as (typeof ALL_WORKFLOWS)[number])) {
        context.addIssue({
          code: 'custom',
          path: ['workflows', index],
          message: `Unknown workflow ID "${workflow}"`,
        });
      }
      if (seen.has(workflow)) {
        context.addIssue({
          code: 'custom',
          path: ['workflows', index],
          message: `Duplicate workflow ID "${workflow}"`,
        });
      }
      seen.add(workflow);
    }
  });

export interface ProfileDefinition {
  version: typeof PROFILE_DEFINITION_VERSION;
  delivery: Delivery;
  workflows: string[];
}

export interface AvailableProfile {
  name: string;
  builtIn: boolean;
  definition?: ProfileDefinition;
  error?: string;
}

export class NamedProfileError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'invalid_name'
      | 'reserved_name'
      | 'not_found'
      | 'already_exists'
      | 'invalid_file'
      | 'unsupported_format'
  ) {
    super(message);
    this.name = 'NamedProfileError';
  }
}

export function getNamedProfilesDir(): string {
  return path.join(getGlobalConfigDir(), PROFILE_DIR_NAME);
}

export function validateUserProfileName(name: string): string | null {
  if (!PROFILE_NAME_PATTERN.test(name)) {
    return 'Profile names must be 1-64 characters, start with a lowercase letter or digit, and contain only lowercase letters, digits, dots, underscores, or hyphens.';
  }
  if (RESERVED_PROFILE_NAMES.includes(name as (typeof RESERVED_PROFILE_NAMES)[number])) {
    return `Profile name "${name}" is reserved.`;
  }
  return null;
}

export function assertValidUserProfileName(name: string): void {
  const error = validateUserProfileName(name);
  if (!error) return;
  const code = RESERVED_PROFILE_NAMES.includes(name as (typeof RESERVED_PROFILE_NAMES)[number])
    ? 'reserved_name'
    : 'invalid_name';
  throw new NamedProfileError(error, code);
}

export function getNamedProfilePath(name: string): string {
  assertValidUserProfileName(name);
  return path.join(getNamedProfilesDir(), `${name}.yaml`);
}

export function normalizeProfileDefinition(definition: ProfileDefinition): ProfileDefinition {
  const selected = new Set(definition.workflows);
  return {
    version: PROFILE_DEFINITION_VERSION,
    delivery: definition.delivery,
    workflows: ALL_WORKFLOWS.filter((workflow) => selected.has(workflow)),
  };
}

export function parseProfileDefinition(raw: unknown, source = 'profile definition'): ProfileDefinition {
  const result = ProfileDefinitionSchema.safeParse(raw);
  if (!result.success) {
    throw new NamedProfileError(
      `Invalid ${source}: ${formatZodIssues(result.error)}`,
      'invalid_file'
    );
  }
  return normalizeProfileDefinition(result.data);
}

function parseProfileContent(content: string, extension: string, source: string): ProfileDefinition {
  let raw: unknown;
  try {
    raw = extension === '.json' ? JSON.parse(content) : parseYaml(content);
  } catch (error) {
    throw new NamedProfileError(
      `Invalid ${source}: ${error instanceof Error ? error.message : String(error)}`,
      'invalid_file'
    );
  }
  return parseProfileDefinition(raw, source);
}

export function readProfileDefinitionFile(filePath: string): ProfileDefinition {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new NamedProfileError(`Profile file not found: ${filePath}`, 'not_found');
    }
    throw error;
  }
  if (!stat.isFile()) {
    throw new NamedProfileError(`Profile path is not a file: ${filePath}`, 'invalid_file');
  }
  if (stat.size > MAX_PROFILE_FILE_BYTES) {
    throw new NamedProfileError(
      `Profile file is too large (${stat.size} bytes; maximum ${MAX_PROFILE_FILE_BYTES}).`,
      'invalid_file'
    );
  }

  const extension = path.extname(filePath).toLowerCase();
  if (!SUPPORTED_IMPORT_EXTENSIONS.has(extension)) {
    throw new NamedProfileError(
      `Unsupported profile format "${extension || '(none)'}". Use .yaml, .yml, or .json.`,
      'unsupported_format'
    );
  }

  return parseProfileContent(fs.readFileSync(filePath, 'utf-8'), extension, filePath);
}

export function serializeProfileDefinition(
  definition: ProfileDefinition,
  format: 'json' | 'yaml'
): string {
  const normalized = normalizeProfileDefinition(parseProfileDefinition(definition));
  if (format === 'json') {
    return JSON.stringify(normalized, null, 2) + '\n';
  }
  return stringifyYaml(normalized, { lineWidth: 0 });
}

function writeFileSafely(targetPath: string, content: string, overwrite: boolean): void {
  const targetDir = path.dirname(targetPath);
  fs.mkdirSync(targetDir, { recursive: true });

  let targetStat: fs.Stats | undefined;
  try {
    targetStat = fs.lstatSync(targetPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  if (targetStat) {
    if (!targetStat.isFile() && !targetStat.isSymbolicLink()) {
      throw new NamedProfileError(`Destination is not a file: ${targetPath}`, 'invalid_file');
    }
    if (!overwrite) {
      throw new NamedProfileError(`Destination already exists: ${targetPath}`, 'already_exists');
    }
  }

  const suffix = `${process.pid}-${crypto.randomBytes(8).toString('hex')}`;
  const temporaryPath = path.join(targetDir, `.${path.basename(targetPath)}.${suffix}.tmp`);
  const backupPath = path.join(targetDir, `.${path.basename(targetPath)}.${suffix}.bak`);

  fs.writeFileSync(temporaryPath, content, { encoding: 'utf-8', flag: 'wx' });
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
        if (fs.existsSync(targetPath)) {
          fs.rmSync(targetPath, { force: true });
        }
        fs.renameSync(backupPath, targetPath);
      } catch (restoreError) {
        throw new Error(
          `Failed to replace ${targetPath}; the previous file remains at ${backupPath}: ${
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
      // The replacement succeeded. Leaving a uniquely named backup is safer
      // than treating cleanup failure as a failed write and removing the new file.
    }
  } finally {
    fs.rmSync(temporaryPath, { force: true });
  }
}

export function saveNamedProfile(
  name: string,
  definition: ProfileDefinition,
  options: { overwrite?: boolean } = {}
): string {
  const targetPath = getNamedProfilePath(name);
  const content = serializeProfileDefinition(definition, 'yaml');
  writeFileSafely(targetPath, content, options.overwrite === true);
  return targetPath;
}

export function readNamedProfile(name: string): ProfileDefinition {
  return readProfileDefinitionFile(getNamedProfilePath(name));
}

export function namedProfileExists(name: string): boolean {
  return fs.existsSync(getNamedProfilePath(name));
}

export function deleteNamedProfile(name: string): void {
  const profilePath = getNamedProfilePath(name);
  if (!fs.existsSync(profilePath)) {
    throw new NamedProfileError(`Profile "${name}" was not found.`, 'not_found');
  }
  fs.rmSync(profilePath);
}

export function getBuiltinProfileDefinition(
  name: (typeof BUILTIN_PROFILE_NAMES)[number],
  delivery: Delivery
): ProfileDefinition {
  return {
    version: PROFILE_DEFINITION_VERSION,
    delivery,
    workflows: name === 'full' ? [...ALL_WORKFLOWS] : [...CORE_WORKFLOWS],
  };
}

function userProfileNameFromPath(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  return path.basename(filePath, extension);
}

export function listUserProfiles(): AvailableProfile[] {
  const profileDir = getNamedProfilesDir();
  if (!fs.existsSync(profileDir)) return [];

  const names = fs
    .readdirSync(profileDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.yaml'))
    .map((entry) => userProfileNameFromPath(entry.name))
    .filter((name) => validateUserProfileName(name) === null)
    .sort((left, right) => left.localeCompare(right));

  return names.map((name) => {
    try {
      return { name, builtIn: false, definition: readNamedProfile(name) };
    } catch (error) {
      return {
        name,
        builtIn: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
}

export function listAvailableProfiles(delivery: Delivery): AvailableProfile[] {
  const builtIns = BUILTIN_PROFILE_NAMES.map((name) => ({
    name,
    builtIn: true,
    definition: getBuiltinProfileDefinition(name, delivery),
  }));
  return [...builtIns, ...listUserProfiles()];
}

export function resolveProfileDefinition(name: string, delivery: Delivery): ProfileDefinition {
  if (BUILTIN_PROFILE_NAMES.includes(name as (typeof BUILTIN_PROFILE_NAMES)[number])) {
    return getBuiltinProfileDefinition(
      name as (typeof BUILTIN_PROFILE_NAMES)[number],
      delivery
    );
  }
  assertValidUserProfileName(name);
  return readNamedProfile(name);
}

export function importNamedProfile(
  sourcePath: string,
  options: { overwrite?: boolean } = {}
): { name: string; path: string; definition: ProfileDefinition } {
  const resolvedSource = path.resolve(sourcePath);
  const extension = path.extname(resolvedSource).toLowerCase();
  if (!SUPPORTED_IMPORT_EXTENSIONS.has(extension)) {
    throw new NamedProfileError(
      `Unsupported profile format "${extension || '(none)'}". Use .yaml, .yml, or .json.`,
      'unsupported_format'
    );
  }
  const name = userProfileNameFromPath(resolvedSource);
  assertValidUserProfileName(name);
  const definition = readProfileDefinitionFile(resolvedSource);
  const savedPath = saveNamedProfile(name, definition, options);
  return { name, path: savedPath, definition };
}

export function exportProfileDefinition(
  destinationPath: string,
  definition: ProfileDefinition,
  options: { overwrite?: boolean } = {}
): string {
  const resolvedDestination = path.resolve(destinationPath);
  const format = path.extname(resolvedDestination).toLowerCase() === '.json' ? 'json' : 'yaml';
  writeFileSafely(
    resolvedDestination,
    serializeProfileDefinition(definition, format),
    options.overwrite === true
  );
  return resolvedDestination;
}
