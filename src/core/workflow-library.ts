import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { parse as parseYaml } from 'yaml';

import {
  acquireFileLock,
  releaseFileLock,
  type FileLockErrorInfo,
  type FileLockErrorKind,
} from './file-state.js';
import { getGlobalConfigDir, getGlobalDataDir } from './global-config.js';
import {
  createWorkflowPackage,
  decodePackage,
  discardWorkflowInstall,
  encodePackage,
  stagePackageWorkflows,
  stageWorkflowDefinitions,
  commitWorkflowInstall,
  WORKFLOW_PACKAGE_LIMITS,
  WorkflowPackageError,
  type RasenPackage,
  type WorkflowInstallResult,
} from './workflow-package/index.js';
import {
  getUserWorkflowsDir,
  isPortableWorkflowId,
  loadWorkflowCatalog,
  resolveWorkflowSelection,
  validateWorkflowDirectory,
  type WorkflowDefinition,
  type WorkflowDiagnostic,
  type WorkflowRegistryOptions,
  type WorkflowValidationResult,
} from './workflow-registry/index.js';

export class WorkflowLibraryError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly details?: Record<string, string | string[] | number>
  ) {
    super(message);
    this.name = 'WorkflowLibraryError';
  }
}

export interface WorkflowUsage {
  kind: 'global-selection' | 'profile' | 'dependency' | 'pipeline' | 'ledger';
  consumer: string;
  path?: string;
  hard: true;
}

export interface WorkflowValidationSummary {
  valid: boolean;
  kind: 'installed' | 'directory' | 'package';
  id?: string;
  packageKind?: RasenPackage['kind'];
  diagnostics: WorkflowDiagnostic[];
}

function lockError(kind: FileLockErrorKind, info: FileLockErrorInfo): WorkflowLibraryError {
  return new WorkflowLibraryError(
    kind === 'timeout'
      ? 'Workflow registry is busy'
      : `Cannot create workflow registry lock at ${info.lockPath}`,
    'workflow_registry_busy',
    { lockPath: info.lockPath }
  );
}

async function withWorkflowRegistryLock<T>(
  options: WorkflowRegistryOptions,
  operation: () => T | Promise<T>
): Promise<T> {
  const workflowsDir = getUserWorkflowsDir(options);
  const lockPath = path.join(path.dirname(workflowsDir), '.workflows.lock');
  const lock = await acquireFileLock({ lockPath, errorFor: lockError });
  try {
    return await operation();
  } finally {
    await releaseFileLock(lock, lockPath);
  }
}

function readPackageFile(filePath: string, expectedKind?: RasenPackage['kind']): RasenPackage {
  let before: fs.Stats;
  try {
    before = fs.statSync(filePath);
  } catch (error) {
    throw new WorkflowLibraryError(
      error instanceof Error ? error.message : String(error),
      'package_not_found'
    );
  }
  if (!before.isFile()) {
    throw new WorkflowLibraryError('Package path must be a regular file', 'package_not_file');
  }
  if (before.size > WORKFLOW_PACKAGE_LIMITS.maxPackageBytes) {
    throw new WorkflowLibraryError('Package exceeds byte limit', 'package_too_large', {
      actual: before.size,
      limit: WORKFLOW_PACKAGE_LIMITS.maxPackageBytes,
    });
  }
  const bytes = fs.readFileSync(filePath);
  const after = fs.statSync(filePath);
  if (
    before.size !== bytes.length ||
    after.size !== bytes.length ||
    before.mtimeMs !== after.mtimeMs
  ) {
    throw new WorkflowLibraryError('Package changed while it was being read', 'package_changed');
  }
  return decodePackage(bytes, expectedKind);
}

function writeFileAtomically(filePath: string, bytes: Buffer, overwrite: boolean): void {
  const parent = path.dirname(path.resolve(filePath));
  fs.mkdirSync(parent, { recursive: true });
  const target = path.resolve(filePath);
  const suffix = `${process.pid}-${randomBytes(8).toString('hex')}`;
  const temporary = path.join(parent, `.${path.basename(target)}.${suffix}.tmp`);
  const backup = path.join(parent, `.${path.basename(target)}.${suffix}.bak`);
  let existing: fs.Stats | undefined;
  try {
    existing = fs.lstatSync(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (existing && !existing.isFile()) {
    throw new WorkflowLibraryError('Export destination must be a regular file', 'destination_not_file');
  }
  if (existing && !overwrite) {
    throw new WorkflowLibraryError('Export destination already exists', 'destination_exists');
  }

  fs.writeFileSync(temporary, bytes, { flag: 'wx', mode: 0o600 });
  try {
    if (!existing) {
      fs.renameSync(temporary, target);
      return;
    }
    fs.renameSync(target, backup);
    try {
      fs.renameSync(temporary, target);
      fs.rmSync(backup, { force: true });
    } catch (error) {
      if (fs.existsSync(target)) fs.rmSync(target, { force: true });
      fs.renameSync(backup, target);
      throw error;
    }
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

export function scaffoldWorkflow(id: string, outputPath: string): string {
  if (!isPortableWorkflowId(id)) {
    throw new WorkflowLibraryError(`Workflow ID "${id}" is not portable`, 'workflow_id_invalid');
  }
  const target = path.resolve(outputPath);
  if (path.basename(target) !== id) {
    throw new WorkflowLibraryError(
      `Output directory name must match workflow ID "${id}"`,
      'output_id_mismatch'
    );
  }
  let existing: fs.Stats | undefined;
  try {
    existing = fs.lstatSync(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (existing) {
    if (!existing.isDirectory() || existing.isSymbolicLink()) {
      throw new WorkflowLibraryError('Output must be a real directory', 'output_not_directory');
    }
    if (fs.readdirSync(target).length > 0) {
      throw new WorkflowLibraryError('Output directory must be empty', 'output_not_empty');
    }
  } else {
    fs.mkdirSync(target, { recursive: true, mode: 0o700 });
  }

  const manifest = [
    'version: 1',
    `id: ${id}`,
    'command:',
    '  enabled: false',
    'files:',
    '  sidecars: []',
    '  scripts: []',
    'requires:',
    '  workflows: []',
    '  skills: []',
    'recommends:',
    '  workflows: []',
    '',
  ].join('\n');
  const skill = [
    '---',
    `name: rasen-${id}`,
    `description: Describe when to use the ${id} workflow.`,
    'license: MIT',
    'compatibility: Requires rasen CLI.',
    'metadata:',
    '  author: user',
    '  version: "1.0"',
    '---',
    '',
    `# ${id}`,
    '',
    'Describe the bounded workflow steps and completion condition here.',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(target, 'workflow.yaml'), manifest, { flag: 'wx', mode: 0o600 });
  fs.writeFileSync(path.join(target, 'SKILL.md'), skill, { flag: 'wx', mode: 0o600 });
  return target;
}

export async function importWorkflow(
  sourcePath: string,
  options: WorkflowRegistryOptions = {}
): Promise<WorkflowInstallResult> {
  const resolved = path.resolve(sourcePath);
  let stats: fs.Stats;
  try {
    stats = fs.lstatSync(resolved);
  } catch (error) {
    throw new WorkflowLibraryError(
      error instanceof Error ? error.message : String(error),
      'import_source_not_found'
    );
  }
  if (stats.isDirectory() && !stats.isSymbolicLink()) {
    const validation = validateWorkflowDirectory(resolved);
    if (!validation.valid || !validation.definition) {
      throw new WorkflowLibraryError(
        'Workflow directory failed validation',
        'workflow_invalid',
        { diagnostics: validation.diagnostics.map((item) => item.code) }
      );
    }
    const plan = stageWorkflowDefinitions(
      [validation.definition],
      [validation.definition.id],
      options
    );
    return commitWorkflowInstall(plan, options);
  }
  if (!stats.isFile()) {
    throw new WorkflowLibraryError(
      'Import source must be a directory or .rasenpkg file',
      'import_source_invalid'
    );
  }
  const packageValue = readPackageFile(resolved, 'workflow');
  const plan = stagePackageWorkflows(packageValue, options);
  return commitWorkflowInstall(plan, options);
}

export function exportWorkflow(
  id: string,
  destination: string,
  options: WorkflowRegistryOptions & { overwrite?: boolean } = {}
): string {
  const catalog = loadWorkflowCatalog(options);
  const root = catalog.get(id);
  if (!root) throw new WorkflowLibraryError(`Workflow "${id}" was not found`, 'workflow_not_found');
  if (root.source === 'built-in') {
    throw new WorkflowLibraryError(
      'Built-in workflows are already distributed with Rasen and cannot be exported',
      'builtin_export_forbidden'
    );
  }
  const closure = resolveWorkflowSelection(catalog, [id]).filter(
    (definition) => definition.source === 'user'
  );
  const packageValue = createWorkflowPackage([id], closure);
  writeFileAtomically(destination, encodePackage(packageValue), options.overwrite === true);
  return path.resolve(destination);
}

export function validateWorkflowInput(
  idOrPath: string,
  options: WorkflowRegistryOptions = {}
): WorkflowValidationSummary {
  const resolved = path.resolve(idOrPath);
  if (fs.existsSync(resolved)) {
    const stats = fs.lstatSync(resolved);
    if (stats.isDirectory() && !stats.isSymbolicLink()) {
      const result = validateWorkflowDirectory(resolved);
      return {
        valid: result.valid,
        kind: 'directory',
        id: result.definition?.id,
        diagnostics: result.diagnostics,
      };
    }
    try {
      const packageValue = readPackageFile(resolved);
      const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-package-validation-'));
      try {
        const plan = stagePackageWorkflows(packageValue, {
          workflowsDir: path.join(temporary, 'workflows'),
        });
        discardWorkflowInstall(plan);
      } finally {
        fs.rmSync(temporary, { recursive: true, force: true });
      }
      return {
        valid: true,
        kind: 'package',
        packageKind: packageValue.kind,
        diagnostics: [],
      };
    } catch (error) {
      return {
        valid: false,
        kind: 'package',
        diagnostics: [
          {
            code:
              error instanceof WorkflowPackageError || error instanceof WorkflowLibraryError
                ? error.code
                : 'package_invalid',
            severity: 'error',
            message: error instanceof Error ? error.message : String(error),
            sourcePath: resolved,
          },
        ],
      };
    }
  }

  const catalog = loadWorkflowCatalog(options);
  const definition = catalog.get(idOrPath);
  if (definition) {
    return { valid: true, kind: 'installed', id: definition.id, diagnostics: [] };
  }
  const invalid = catalog.invalid.find((record) => record.id === idOrPath);
  return {
    valid: false,
    kind: 'installed',
    id: idOrPath,
    diagnostics: invalid?.diagnostics ?? [
      {
        code: 'workflow_not_found',
        severity: 'error',
        message: `Workflow "${idOrPath}" was not found`,
      },
    ],
  };
}

function workflowIdsFromYamlFile(filePath: string): string[] {
  try {
    const parsed = parseYaml(fs.readFileSync(filePath, 'utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object') return [];
    const object = parsed as Record<string, unknown>;
    if (Array.isArray(object.workflows)) {
      return object.workflows.filter((value): value is string => typeof value === 'string');
    }
    if (Array.isArray(object.stages)) {
      return object.stages
        .map((stage) =>
          stage && typeof stage === 'object' ? (stage as Record<string, unknown>).skill : undefined
        )
        .filter((value): value is string => typeof value === 'string');
    }
  } catch {
    return [];
  }
  return [];
}

function collectPipelineUsage(baseDir: string, skillName: string, kind: string): WorkflowUsage[] {
  if (!fs.existsSync(baseDir)) return [];
  const usage: WorkflowUsage[] = [];
  for (const entry of fs.readdirSync(baseDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const pipelinePath = path.join(baseDir, entry.name, 'pipeline.yaml');
    if (!fs.existsSync(pipelinePath)) continue;
    if (workflowIdsFromYamlFile(pipelinePath).includes(skillName)) {
      usage.push({ kind: 'pipeline', consumer: `${kind}:${entry.name}`, path: pipelinePath, hard: true });
    }
  }
  return usage;
}

export function scanWorkflowUsage(
  id: string,
  options: WorkflowRegistryOptions & { projectRoot?: string } = {}
): WorkflowUsage[] {
  const catalog = loadWorkflowCatalog(options);
  const definition = catalog.get(id);
  if (!definition) return [];
  const usage: WorkflowUsage[] = [];
  const globalDataDir = options.globalDataDir ?? getGlobalDataDir();
  const globalConfigDir = process.env.RASEN_HOME
    ? path.resolve(process.env.RASEN_HOME)
    : getGlobalConfigDir();
  const globalConfigPath = path.join(globalConfigDir, 'config.json');
  try {
    const config = JSON.parse(fs.readFileSync(globalConfigPath, 'utf8')) as Record<string, unknown>;
    if (Array.isArray(config.workflows) && config.workflows.includes(id)) {
      usage.push({
        kind: 'global-selection',
        consumer: 'global configuration',
        path: globalConfigPath,
        hard: true,
      });
    }
  } catch {
    // Missing or invalid config is reported by its owning command, not usage scanning.
  }

  const profilesDir = path.join(globalConfigDir, 'profiles');
  if (fs.existsSync(profilesDir)) {
    for (const entry of fs.readdirSync(profilesDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.yaml')) continue;
      const profilePath = path.join(profilesDir, entry.name);
      if (workflowIdsFromYamlFile(profilePath).includes(id)) {
        usage.push({ kind: 'profile', consumer: entry.name.replace(/\.yaml$/, ''), path: profilePath, hard: true });
      }
    }
  }
  for (const candidate of catalog.definitions) {
    if (candidate.source === 'user' && candidate.requires.workflows.includes(id)) {
      usage.push({
        kind: 'dependency',
        consumer: candidate.id,
        path: candidate.sourcePath,
        hard: true,
      });
    }
  }
  usage.push(...collectPipelineUsage(path.join(globalDataDir, 'pipelines'), definition.skill.template.name, 'user'));
  const projectRoot = options.projectRoot ?? process.cwd();
  usage.push(...collectPipelineUsage(path.join(projectRoot, 'rasen', 'pipelines'), definition.skill.template.name, 'project'));

  const ledgerPath = path.join(projectRoot, 'rasen', '.workflow-artifacts.json');
  try {
    const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8')) as { workflows?: string[] };
    if (ledger.workflows?.includes(id)) {
      usage.push({ kind: 'ledger', consumer: 'current project artifacts', path: ledgerPath, hard: true });
    }
  } catch {
    // The generation layer owns ledger diagnostics.
  }
  return usage;
}

export async function deleteWorkflow(
  id: string,
  options: WorkflowRegistryOptions & { projectRoot?: string } = {}
): Promise<void> {
  await withWorkflowRegistryLock(options, async () => {
    const catalog = loadWorkflowCatalog(options);
    const definition = catalog.get(id);
    if (!definition) throw new WorkflowLibraryError(`Workflow "${id}" was not found`, 'workflow_not_found');
    if (definition.source === 'built-in') {
      throw new WorkflowLibraryError('Built-in workflows cannot be deleted', 'builtin_delete_forbidden');
    }
    const usage = scanWorkflowUsage(id, options);
    if (usage.length > 0) {
      throw new WorkflowLibraryError(
        `Workflow "${id}" is still referenced`,
        'workflow_in_use',
        { consumers: usage.map((item) => `${item.kind}:${item.consumer}`) }
      );
    }

    const target = path.join(getUserWorkflowsDir(options), id);
    const tombstone = `${target}.delete-${process.pid}-${randomBytes(8).toString('hex')}`;
    fs.renameSync(target, tombstone);
    try {
      fs.rmSync(tombstone, { recursive: true });
    } catch (error) {
      fs.renameSync(tombstone, target);
      throw error;
    }
  });
}

export function workflowDefinitionForJson(definition: WorkflowDefinition): Record<string, unknown> {
  return {
    id: definition.id,
    source: definition.source,
    sourcePath: definition.sourcePath ?? null,
    manifestVersion: definition.manifestVersion,
    digest: definition.digest,
    skill: {
      name: definition.skill.template.name,
      dirName: definition.skill.dirName,
      description: definition.skill.template.description,
    },
    command: definition.command
      ? {
          id: definition.command.content.id,
          name: definition.command.content.name,
          category: definition.command.content.category,
          tags: definition.command.content.tags,
        }
      : null,
    requires: definition.requires,
    recommends: definition.recommends,
    files: definition.files.map((file) => ({ path: file.path, sha256: file.sha256 })),
  };
}
