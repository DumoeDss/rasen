import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { z } from 'zod';

import { getGlobalConfigDir } from './global-config.js';
import { acquireFileLock, releaseFileLock } from './file-state.js';
import { ALL_EXPERTS, ALL_WORKFLOWS, CORE_WORKFLOWS, QUALITY_FLOOR_EXPERTS } from './profiles.js';
import {
  RETENTION_MODES,
  RETIRED_RETRO_WORKFLOW_ID,
  builtInProfileRetention,
  isRetentionMode,
  resolveMigratedRetention,
  type RetentionMode,
} from './retention.js';
import {
  WORKFLOW_PACKAGE_LIMITS,
  commitWorkflowInstall,
  createProfilePackage,
  decodePackage,
  discardWorkflowInstall,
  encodePackage,
  stagePackageWorkflows,
  type ProfilePackage,
  type WorkflowInstallResult,
} from './workflow-package/index.js';
import { formatZodIssues } from './zod-issues.js';
import {
  WorkflowCatalog,
  loadWorkflowCatalog,
  resolveWorkflowSelection,
  type WorkflowRegistryOptions,
} from './workflow-registry/index.js';

/** The current profile-definition version written on every normalized save/export. */
export const PROFILE_DEFINITION_VERSION = 2 as const;
/** The legacy profile-definition version still accepted (and migrated) on read. */
export const PROFILE_DEFINITION_VERSION_V1 = 1 as const;
export const PROFILE_DIR_NAME = 'profiles';
export const BUILTIN_PROFILE_NAMES = ['full', 'core'] as const;
export const RESERVED_PROFILE_NAMES = ['full', 'core', 'custom'] as const;

const MAX_PROFILE_FILE_BYTES = 1024 * 1024;
const PROFILE_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const SUPPORTED_IMPORT_EXTENSIONS = new Set(['.json', '.yaml', '.yml']);

// A dedicated version-1 reader kept for migration: `retention` is absent, and a
// retired `delivery` field is tolerated-but-ignored so a profile file written
// by an older rasen release still parses. Normalization maps it to version 2.
const ProfileDefinitionV1Schema = z
  .object({
    version: z.literal(PROFILE_DEFINITION_VERSION_V1),
    delivery: z.unknown().optional(),
    workflows: z.array(z.string()),
  })
  .strict();

// The strict current schema: exactly `version`, `workflows`, and one
// `retention` value. Unknown fields (including `delivery`) fail.
const ProfileDefinitionV2Schema = z
  .object({
    version: z.literal(PROFILE_DEFINITION_VERSION),
    workflows: z.array(z.string()),
    retention: z.enum(RETENTION_MODES),
  })
  .strict();

const ProfileDefinitionSchema = z.discriminatedUnion('version', [
  ProfileDefinitionV1Schema,
  ProfileDefinitionV2Schema,
]);

type ParsedProfileDefinition = z.infer<typeof ProfileDefinitionSchema>;

function validateProfileMembership(
  definition: ParsedProfileDefinition,
  catalog: WorkflowCatalog
): string | null {
  const seen = new Set<string>();
  for (const workflow of definition.workflows) {
    if (!catalog.has(workflow)) return `Unknown workflow ID "${workflow}"`;
    if (seen.has(workflow)) {
      return `Duplicate workflow ID "${workflow}"`;
    }
    seen.add(workflow);
  }
  return null;
}

export interface ProfileDefinition {
  version: typeof PROFILE_DEFINITION_VERSION;
  workflows: string[];
  /** Exactly one retention mode. Migrated from a v1 `retro-command` selection. */
  retention: RetentionMode;
}

/** The loose shape `normalizeProfileDefinition` accepts: a v1 or v2 definition. */
export interface ProfileDefinitionInput {
  version: number;
  workflows: string[];
  retention?: RetentionMode;
  delivery?: unknown;
}

export interface AvailableProfile {
  name: string;
  builtIn: boolean;
  definition?: ProfileDefinition;
  error?: string;
  /** Non-enumerable when present so legacy JSON payload fields remain stable. */
  errorDescriptor?: NamedProfileMessageDescriptor;
}

export type NamedProfileErrorMessageKey =
  | 'invalidName'
  | 'reservedName'
  | 'invalidSource'
  | 'fileNotFound'
  | 'pathNotFile'
  | 'fileTooLarge'
  | 'unsupportedFormat'
  | 'destinationNotFile'
  | 'destinationExists'
  | 'profileNotFound'
  | 'profilePackageChanged'
  | 'profilePackageIncomplete'
  | 'selfContainedRequired'
  | 'profileRegistryBusy';

export interface NamedProfileMessageDescriptor {
  key: NamedProfileErrorMessageKey;
  values?: Record<string, string | number>;
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
      | 'unsupported_format',
    readonly messageDescriptor?: NamedProfileMessageDescriptor
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
  throw new NamedProfileError(error, code, {
    key: code === 'reserved_name' ? 'reservedName' : 'invalidName',
    values: { name },
  });
}

export function getNamedProfilePath(name: string): string {
  assertValidUserProfileName(name);
  return path.join(getNamedProfilesDir(), `${name}.yaml`);
}

export function normalizeProfileDefinition(
  definition: ProfileDefinitionInput,
  catalog: WorkflowCatalog = loadWorkflowCatalog()
): ProfileDefinition {
  // Retention is explicit on a v2 input; a v1 input migrates it from whether
  // the selection contained the retired `retro-command`. Either way the
  // retired id is stripped from the persisted workflow list.
  const retention: RetentionMode = isRetentionMode(definition.retention)
    ? definition.retention
    : resolveMigratedRetention(definition.workflows);
  const withoutRetired = definition.workflows.filter(
    (workflow) => workflow !== RETIRED_RETRO_WORKFLOW_ID
  );
  const expanded = resolveWorkflowSelection(catalog, withoutRetired);
  return {
    version: PROFILE_DEFINITION_VERSION,
    workflows: expanded.map((workflow) => workflow.id),
    retention,
  };
}

export function parseProfileDefinition(
  raw: unknown,
  source = 'profile definition',
  catalog: WorkflowCatalog = loadWorkflowCatalog()
): ProfileDefinition {
  const result = ProfileDefinitionSchema.safeParse(raw);
  if (!result.success) {
    throw new NamedProfileError(
      `Invalid ${source}: ${formatZodIssues(result.error)}`,
      'invalid_file',
      {
        key: 'invalidSource',
        values: { source, detail: formatZodIssues(result.error) },
      }
    );
  }
  const membershipError = validateProfileMembership(result.data, catalog);
  if (membershipError) {
    throw new NamedProfileError(
      `Invalid ${source}: ${membershipError}`,
      'invalid_file',
      { key: 'invalidSource', values: { source, detail: membershipError } }
    );
  }
  return normalizeProfileDefinition(result.data, catalog);
}

function parseProfileContent(content: string, extension: string, source: string): ProfileDefinition {
  let raw: unknown;
  try {
    raw = extension === '.json' ? JSON.parse(content) : parseYaml(content);
  } catch (error) {
    throw new NamedProfileError(
      `Invalid ${source}: ${error instanceof Error ? error.message : String(error)}`,
      'invalid_file',
      {
        key: 'invalidSource',
        values: { source, detail: error instanceof Error ? error.message : String(error) },
      }
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
      throw new NamedProfileError(`Profile file not found: ${filePath}`, 'not_found', {
        key: 'fileNotFound',
        values: { path: filePath },
      });
    }
    throw error;
  }
  if (!stat.isFile()) {
    throw new NamedProfileError(`Profile path is not a file: ${filePath}`, 'invalid_file', {
      key: 'pathNotFile',
      values: { path: filePath },
    });
  }
  if (stat.size > MAX_PROFILE_FILE_BYTES) {
    throw new NamedProfileError(
      `Profile file is too large (${stat.size} bytes; maximum ${MAX_PROFILE_FILE_BYTES}).`,
      'invalid_file',
      {
        key: 'fileTooLarge',
        values: { size: stat.size, maximum: MAX_PROFILE_FILE_BYTES },
      }
    );
  }

  const extension = path.extname(filePath).toLowerCase();
  if (!SUPPORTED_IMPORT_EXTENSIONS.has(extension)) {
    throw new NamedProfileError(
      `Unsupported profile format "${extension || '(none)'}". Use .yaml, .yml, or .json.`,
      'unsupported_format',
      { key: 'unsupportedFormat', values: { extension: extension || '(none)' } }
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

function writeFileSafely(
  targetPath: string,
  content: string | Uint8Array,
  overwrite: boolean
): void {
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
      throw new NamedProfileError(`Destination is not a file: ${targetPath}`, 'invalid_file', {
        key: 'destinationNotFile',
        values: { path: targetPath },
      });
    }
    if (!overwrite) {
      throw new NamedProfileError(`Destination already exists: ${targetPath}`, 'already_exists', {
        key: 'destinationExists',
        values: { path: targetPath },
      });
    }
  }

  const suffix = `${process.pid}-${crypto.randomBytes(8).toString('hex')}`;
  const temporaryPath = path.join(targetDir, `.${path.basename(targetPath)}.${suffix}.tmp`);
  const backupPath = path.join(targetDir, `.${path.basename(targetPath)}.${suffix}.bak`);

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
    throw new NamedProfileError(`Profile "${name}" was not found.`, 'not_found', {
      key: 'profileNotFound',
      values: { name },
    });
  }
  fs.rmSync(profilePath);
}

export function getBuiltinProfileDefinition(
  name: (typeof BUILTIN_PROFILE_NAMES)[number]
): ProfileDefinition {
  // Experts share the unified workflow id space (D1) — `full` names every
  // built-in expert, `core` names the quality-floor set. The retired
  // `retro-command` is dropped (its former meaning is carried by retention),
  // and the built-in's retention mode is stamped (`full` → report,
  // `core` → off). Canonical membership order is preserved (no closure
  // reordering) so a `profile use full`/`core` write stays byte-stable.
  const workflows = (
    name === 'full'
      ? [...ALL_WORKFLOWS, ...ALL_EXPERTS]
      : [...CORE_WORKFLOWS, ...QUALITY_FLOOR_EXPERTS]
  ).filter((workflow) => workflow !== RETIRED_RETRO_WORKFLOW_ID);
  return {
    version: PROFILE_DEFINITION_VERSION,
    workflows,
    retention: builtInProfileRetention(name),
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
      const profile: AvailableProfile = {
        name,
        builtIn: false,
        error: error instanceof Error ? error.message : String(error),
      };
      if (error instanceof NamedProfileError && error.messageDescriptor) {
        Object.defineProperty(profile, 'errorDescriptor', {
          value: error.messageDescriptor,
          enumerable: false,
        });
      }
      return profile;
    }
  });
}

export function listAvailableProfiles(): AvailableProfile[] {
  const builtIns = BUILTIN_PROFILE_NAMES.map((name) => ({
    name,
    builtIn: true,
    definition: getBuiltinProfileDefinition(name),
  }));
  return [...builtIns, ...listUserProfiles()];
}

export function resolveProfileDefinition(name: string): ProfileDefinition {
  if (BUILTIN_PROFILE_NAMES.includes(name as (typeof BUILTIN_PROFILE_NAMES)[number])) {
    return getBuiltinProfileDefinition(name as (typeof BUILTIN_PROFILE_NAMES)[number]);
  }
  assertValidUserProfileName(name);
  return readNamedProfile(name);
}

export function importNamedProfile(
  sourcePath: string,
  options: { overwrite?: boolean; name?: string } = {}
): { name: string; path: string; definition: ProfileDefinition } {
  const resolvedSource = path.resolve(sourcePath);
  const extension = path.extname(resolvedSource).toLowerCase();
  if (!SUPPORTED_IMPORT_EXTENSIONS.has(extension)) {
    throw new NamedProfileError(
      `Unsupported profile format "${extension || '(none)'}". Use .yaml, .yml, or .json.`,
      'unsupported_format',
      { key: 'unsupportedFormat', values: { extension: extension || '(none)' } }
    );
  }
  const name = options.name ?? userProfileNameFromPath(resolvedSource);
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

export interface ProfilePackageImportResult {
  name: string;
  path: string;
  definition: ProfileDefinition;
  workflows: WorkflowInstallResult;
}

export interface ProfileExportResult {
  path: string;
  kind: 'thin' | 'package';
}

function readProfilePackageFile(filePath: string): ProfilePackage {
  const resolved = path.resolve(filePath);
  let before: fs.Stats;
  try {
    before = fs.statSync(resolved);
  } catch (error) {
    throw new NamedProfileError(
      error instanceof Error ? error.message : String(error),
      'not_found',
      { key: 'fileNotFound', values: { path: resolved } }
    );
  }
  if (!before.isFile()) {
    throw new NamedProfileError(`Profile path is not a file: ${resolved}`, 'invalid_file', {
      key: 'pathNotFile',
      values: { path: resolved },
    });
  }
  if (before.size > WORKFLOW_PACKAGE_LIMITS.maxPackageBytes) {
    throw new NamedProfileError(
      `Profile package is too large (${before.size} bytes; maximum ${WORKFLOW_PACKAGE_LIMITS.maxPackageBytes}).`,
      'invalid_file',
      {
        key: 'fileTooLarge',
        values: { size: before.size, maximum: WORKFLOW_PACKAGE_LIMITS.maxPackageBytes },
      }
    );
  }
  const bytes = fs.readFileSync(resolved);
  const after = fs.statSync(resolved);
  if (
    before.size !== bytes.length ||
    after.size !== bytes.length ||
    before.mtimeMs !== after.mtimeMs
  ) {
    throw new NamedProfileError(
      'Profile package changed while it was being read.',
      'invalid_file',
      { key: 'profilePackageChanged' }
    );
  }
  return decodePackage(bytes, 'profile') as ProfilePackage;
}

/**
 * Imports a self-contained profile package. Workflow installation and the
 * profile write form one logical transaction: a profile write failure removes
 * only workflow directories created by this import.
 */
export async function importProfilePackage(
  sourcePath: string,
  options: WorkflowRegistryOptions & { overwrite?: boolean; name?: string } = {}
): Promise<ProfilePackageImportResult> {
  const packageValue = readProfilePackageFile(sourcePath);
  const name = options.name ?? packageValue.name;
  assertValidUserProfileName(name);
  if (namedProfileExists(name) && options.overwrite !== true) {
    const targetPath = getNamedProfilePath(name);
    throw new NamedProfileError(`Destination already exists: ${targetPath}`, 'already_exists', {
      key: 'destinationExists',
      values: { path: targetPath },
    });
  }

  const plan = stagePackageWorkflows(packageValue, options);
  let commitStarted = false;
  try {
    const currentCatalog = loadWorkflowCatalog(options);
    const incomingIds = new Set(plan.definitions.map((definition) => definition.id));
    const combinedCatalog = new WorkflowCatalog([
      ...currentCatalog.definitions,
      ...plan.definitions.filter((definition) => !currentCatalog.has(definition.id)),
    ]);
    const definition = parseProfileDefinition(
      packageValue.profile,
      `profile package ${path.resolve(sourcePath)}`,
      combinedCatalog
    );
    for (const workflowId of definition.workflows) {
      const workflow = combinedCatalog.get(workflowId)!;
      if (workflow.source === 'user' && !incomingIds.has(workflowId)) {
        throw new NamedProfileError(
          `Profile package is not self-contained: workflow "${workflowId}" is not embedded.`,
          'invalid_file',
          { key: 'profilePackageIncomplete', values: { workflow: workflowId } }
        );
      }
    }

    let savedPath = '';
    commitStarted = true;
    const workflows = await commitWorkflowInstall(plan, {
      ...options,
      afterInstall: async () => {
        const profileLockPath = path.join(getGlobalConfigDir(), '.profiles.lock');
        const profileLock = await acquireFileLock({
          lockPath: profileLockPath,
          errorFor: () => new NamedProfileError(
            'Profile registry is busy.',
            'invalid_file',
            { key: 'profileRegistryBusy' }
          ),
        });
        try {
          savedPath = saveNamedProfile(name, definition, { overwrite: options.overwrite });
        } finally {
          await releaseFileLock(profileLock, profileLockPath);
        }
      },
    });
    return { name, path: savedPath, definition, workflows };
  } catch (error) {
    if (!commitStarted) discardWorkflowInstall(plan);
    throw error;
  }
}

/** Exports a thin YAML/JSON profile or a self-contained profile package. */
export function exportProfile(
  destinationPath: string,
  name: string,
  definition: ProfileDefinition,
  options: WorkflowRegistryOptions & { overwrite?: boolean; thin?: boolean } = {}
): ProfileExportResult {
  const resolvedDestination = path.resolve(destinationPath);
  const catalog = loadWorkflowCatalog(options);
  const normalized = parseProfileDefinition(definition, 'profile definition', catalog);
  const selected = resolveWorkflowSelection(catalog, normalized.workflows);
  const userDefinitions = selected.filter((workflow) => workflow.source === 'user');
  const extension = path.extname(resolvedDestination).toLowerCase();
  const packageRequested = extension === '.rasenpkg';

  if (options.thin) {
    if (!SUPPORTED_IMPORT_EXTENSIONS.has(extension)) {
      throw new NamedProfileError(
        `Thin profile export requires .yaml, .yml, or .json, not "${extension || '(none)'}".`,
        'unsupported_format',
        { key: 'unsupportedFormat', values: { extension: extension || '(none)' } }
      );
    }
    return {
      path: exportProfileDefinition(resolvedDestination, normalized, options),
      kind: 'thin',
    };
  }

  if (userDefinitions.length === 0 && !packageRequested) {
    return {
      path: exportProfileDefinition(resolvedDestination, normalized, options),
      kind: 'thin',
    };
  }
  if (!packageRequested) {
    throw new NamedProfileError(
      'Profiles containing user workflows must be exported to a .rasenpkg file, or use --thin explicitly.',
      'unsupported_format',
      { key: 'selfContainedRequired' }
    );
  }

  assertValidUserProfileName(name);
  const roots = userDefinitions.map((workflow) => workflow.id);
  const packageValue = createProfilePackage(name, normalized, roots, userDefinitions);
  writeFileSafely(resolvedDestination, encodePackage(packageValue), options.overwrite === true);
  return { path: resolvedDestination, kind: 'package' };
}
