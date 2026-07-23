import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { stringify as stringifyYaml } from 'yaml';

import {
  acquireFileLock,
  releaseFileLock,
  type FileLockErrorInfo,
  type FileLockErrorKind,
} from './file-state.js';
import { getGlobalConfigDir } from './global-config.js';
import { findRepoPlanningRootSync } from './planning-home.js';
import { PipelineValidationError, parsePipeline, validatePipelineSkills } from './pipeline-registry/pipeline.js';
import { resolvePipelineExecutionSkillSets } from './pipeline-registry/execution-validation.js';
import {
  getUserPipelinesDir,
  listPipelinesWithInfo,
  loadPipelineByName,
  resolveChildPipelineName,
} from './pipeline-registry/resolver.js';
import type { PipelineYaml } from './pipeline-registry/types.js';
import { isPortableWorkflowId } from './workflow-registry/path-policy.js';
import {
  loadWorkflowCatalog,
  type WorkflowRegistryOptions,
} from './workflow-registry/index.js';
import {
  commitWorkflowInstall,
  computeFileDigest,
  computePackagedPipelineDigest,
  createPipelinePackage,
  decodePackage,
  discardWorkflowInstall,
  encodePackage,
  stagePackageWorkflows,
  WORKFLOW_PACKAGE_LIMITS,
  WorkflowPackageError,
  type PackageFile,
  type PipelinePackage,
  type RasenPackage,
} from './workflow-package/index.js';

export class PipelineLibraryError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly details?: Record<string, string | string[] | number>
  ) {
    super(message);
    this.name = 'PipelineLibraryError';
  }
}

function pipelinesLockError(kind: FileLockErrorKind, info: FileLockErrorInfo): PipelineLibraryError {
  return new PipelineLibraryError(
    kind === 'timeout'
      ? 'Pipeline registry is busy'
      : `Cannot create pipeline registry lock at ${info.lockPath}`,
    'pipeline_registry_busy',
    { lockPath: info.lockPath }
  );
}

function getPipelinesLockPath(): string {
  return path.join(getGlobalConfigDir(), '.pipelines.lock');
}

async function withPipelinesLock<T>(operation: () => T | Promise<T>): Promise<T> {
  const lockPath = getPipelinesLockPath();
  const lock = await acquireFileLock({ lockPath, errorFor: pipelinesLockError });
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
    throw new PipelineLibraryError(
      error instanceof Error ? error.message : String(error),
      'package_not_found'
    );
  }
  if (!before.isFile()) {
    throw new PipelineLibraryError('Package path must be a regular file', 'package_not_file');
  }
  if (before.size > WORKFLOW_PACKAGE_LIMITS.maxPackageBytes) {
    throw new PipelineLibraryError('Package exceeds byte limit', 'package_too_large', {
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
    throw new PipelineLibraryError('Package changed while it was being read', 'package_changed');
  }
  return decodePackage(bytes, expectedKind);
}

function readDirectoryFiles(root: string): PackageFile[] {
  const files: PackageFile[] = [];
  const walk = (current: string, prefix: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const absolute = path.join(current, entry.name);
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(absolute, relative);
        continue;
      }
      if (!entry.isFile()) continue;
      const content = fs.readFileSync(absolute, 'utf8');
      files.push({
        path: relative,
        encoding: 'utf8',
        sha256: computeFileDigest(content),
        content,
      });
    }
  };
  walk(root, '');
  return files.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
}

export interface PipelineUsage {
  kind: 'requires' | 'decompose';
  consumer: string;
  path?: string;
  hard: true;
}

export interface PipelineUsageContext {
  readonly byPipelineName: ReadonlyMap<string, readonly PipelineUsage[]>;
}

type PipelineUsageOptions = WorkflowRegistryOptions & { projectRoot?: string };

function addPipelineUsage(
  usageByPipelineName: Map<string, PipelineUsage[]>,
  name: string,
  usage: PipelineUsage
): void {
  if (!usageByPipelineName.has(name)) usageByPipelineName.set(name, []);
  usageByPipelineName.get(name)!.push(usage);
}

/**
 * Scans two hard-referrer populations for every known pipeline name:
 *  - any installed workflow's `requires.pipelines` (child-4 data), and
 *  - every OTHER pipeline's `decompose` stage `childPipeline` edge (explicit
 *    or defaulted to `DEFAULT_CHILD_PIPELINE`).
 * Mirrors `createWorkflowUsageContext`'s shape for the analogous guard.
 */
export function createPipelineUsageContext(options: PipelineUsageOptions = {}): PipelineUsageContext {
  const projectRoot =
    options.projectRoot ?? findRepoPlanningRootSync(process.cwd()) ?? process.cwd();
  const pipelineInfos = listPipelinesWithInfo(projectRoot);
  const usageByPipelineName = new Map<string, PipelineUsage[]>(
    pipelineInfos.map((info) => [info.name, []])
  );

  const catalog = loadWorkflowCatalog(options);
  for (const definition of catalog.definitions) {
    for (const name of new Set(definition.requires.pipelines)) {
      addPipelineUsage(usageByPipelineName, name, {
        kind: 'requires',
        consumer: definition.id,
        path: definition.sourcePath,
        hard: true,
      });
    }
  }

  for (const info of pipelineInfos) {
    let pipeline: PipelineYaml;
    try {
      pipeline = loadPipelineByName(info.name, projectRoot);
    } catch {
      continue;
    }
    for (const stage of pipeline.stages) {
      if (stage.kind !== 'decompose') continue;
      const childName = resolveChildPipelineName(stage);
      addPipelineUsage(usageByPipelineName, childName, {
        kind: 'decompose',
        consumer: info.name,
        hard: true,
      });
    }
  }

  return { byPipelineName: usageByPipelineName };
}

export function scanPipelineUsage(
  name: string,
  options: PipelineUsageOptions = {},
  context?: PipelineUsageContext
): PipelineUsage[] {
  const resolvedContext = context ?? createPipelineUsageContext(options);
  return [...(resolvedContext.byPipelineName.get(name) ?? [])];
}

export function scaffoldPipeline(name: string, outputPath: string): string {
  if (!isPortableWorkflowId(name)) {
    throw new PipelineLibraryError(`Pipeline name "${name}" is not portable`, 'pipeline_id_invalid');
  }
  const target = path.resolve(outputPath);
  if (path.basename(target) !== name) {
    throw new PipelineLibraryError(
      `Output directory name must match pipeline name "${name}"`,
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
      throw new PipelineLibraryError('Output must be a real directory', 'output_not_directory');
    }
    if (fs.readdirSync(target).length > 0) {
      throw new PipelineLibraryError('Output directory must be empty', 'output_not_empty');
    }
  } else {
    fs.mkdirSync(target, { recursive: true, mode: 0o700 });
  }

  const yaml = [
    `name: ${name}`,
    `description: Describe when to use the ${name} pipeline.`,
    'stages:',
    '  - id: implement',
    '    skill: rasen-apply-change',
    '    role: implementer',
    '    requires: []',
    '',
  ].join('\n');
  parsePipeline(yaml); // fail fast if the scaffold itself is not structurally valid
  fs.writeFileSync(path.join(target, 'pipeline.yaml'), yaml, { flag: 'wx', mode: 0o600 });
  return target;
}

export interface PipelineValidationSummary {
  valid: boolean;
  kind: 'installed' | 'directory' | 'package';
  name?: string;
  packageKind?: RasenPackage['kind'];
  diagnostics: { code: string; severity: 'error' | 'warning'; message: string }[];
}

/**
 * Structural-only validation (parse + the registry-free structural rules
 * inside `parsePipeline`): no skill-existence or decompose-registry check, so
 * a package/directory that references not-yet-installed skills or sibling
 * pipelines still validates. Mirrors `validateWorkflowInput`'s directory/
 * package split. Installed-name lookups DO additionally resolve decompose
 * children through the registry, since those must already be resolvable.
 */
export function validatePipelineInput(
  nameOrPath: string,
  options: PipelineUsageOptions = {}
): PipelineValidationSummary {
  const resolved = path.resolve(nameOrPath);
  const projectRoot =
    options.projectRoot ?? findRepoPlanningRootSync(process.cwd()) ?? process.cwd();

  if (fs.existsSync(resolved)) {
    const stats = fs.lstatSync(resolved);
    if (stats.isDirectory() && !stats.isSymbolicLink()) {
      const pipelinePath = path.join(resolved, 'pipeline.yaml');
      if (!fs.existsSync(pipelinePath)) {
        return {
          valid: false,
          kind: 'directory',
          diagnostics: [
            { code: 'pipeline_manifest_missing', severity: 'error', message: 'pipeline.yaml is required' },
          ],
        };
      }
      try {
        const pipeline = parsePipeline(fs.readFileSync(pipelinePath, 'utf8'));
        return { valid: true, kind: 'directory', name: pipeline.name, diagnostics: [] };
      } catch (error) {
        return {
          valid: false,
          kind: 'directory',
          diagnostics: [
            {
              code: error instanceof PipelineValidationError ? error.code : 'pipeline_invalid',
              severity: 'error',
              message: error instanceof Error ? error.message : String(error),
            },
          ],
        };
      }
    }
    try {
      const packageValue = readPackageFile(resolved, 'pipeline');
      return { valid: true, kind: 'package', packageKind: packageValue.kind, diagnostics: [] };
    } catch (error) {
      return {
        valid: false,
        kind: 'package',
        diagnostics: [
          {
            code:
              error instanceof WorkflowPackageError || error instanceof PipelineLibraryError
                ? error.code
                : 'package_invalid',
            severity: 'error',
            message: error instanceof Error ? error.message : String(error),
          },
        ],
      };
    }
  }

  try {
    const pipeline = loadPipelineByName(nameOrPath, projectRoot);
    return { valid: true, kind: 'installed', name: pipeline.name, diagnostics: [] };
  } catch (error) {
    return {
      valid: false,
      kind: 'installed',
      name: nameOrPath,
      diagnostics: [
        {
          code: 'pipeline_not_found',
          severity: 'error',
          message: error instanceof Error ? error.message : String(error),
        },
      ],
    };
  }
}

export interface PipelinePackageImportResult {
  imported: string[];
  path: string;
  digests: Record<string, string>;
}

function verifyStagedPipelineDigest(name: string, stagedDir: string, expectedDigest: string): void {
  const files = readDirectoryFiles(stagedDir);
  const actualDigest = computePackagedPipelineDigest(name, files);
  if (actualDigest !== expectedDigest) {
    throw new PipelineLibraryError(
      `Pipeline "${name}" failed digest validation after staging`,
      'staged_digest_mismatch'
    );
  }
}

/**
 * Imports a `pipeline`-kind package: validates + decodes it (which already
 * digest-verifies the embedded payload), stages every packaged pipeline to a
 * temp root and RE-verifies each digest after writing to disk (guards against
 * a write-path bug, mirroring the workflow staging re-verify), then commits
 * all of them atomically under `.pipelines.lock` — one failure rolls back the
 * whole import, never a partial set of installed pipelines.
 *
 * Reuses `stagePackageWorkflows` + `commitWorkflowInstall({ afterInstall })`
 * for the outer transaction shape (workflow registry lock + rollback), even
 * though a pipeline package embeds no workflows this round — the profile
 * packaging precedent for a "third kind" artifact target.
 */
export async function importPipelinePackage(
  sourcePath: string,
  options: WorkflowRegistryOptions & { overwrite?: boolean } = {}
): Promise<PipelinePackageImportResult> {
  const resolvedSource = path.resolve(sourcePath);
  const packageValue = readPackageFile(resolvedSource, 'pipeline') as PipelinePackage;
  const plan = stagePackageWorkflows(packageValue, options);
  let commitStarted = false;
  try {
    commitStarted = true;
    let imported: string[] = [];
    const digests: Record<string, string> = {};
    await commitWorkflowInstall(plan, {
      ...options,
      afterInstall: async () => {
        const result = await withPipelinesLock(() => {
          const userPipelinesDir = getUserPipelinesDir();
          const stageParent = path.dirname(userPipelinesDir);
          fs.mkdirSync(stageParent, { recursive: true });
          const stageRoot = path.join(
            stageParent,
            `.pipeline-import-${process.pid}-${randomBytes(8).toString('hex')}`
          );
          fs.mkdirSync(stageRoot, { recursive: false, mode: 0o700 });
          try {
            // Stage + digest-verify every packaged pipeline before touching
            // the real user pipelines directory (all-or-nothing).
            for (const packaged of packageValue.pipelines) {
              const stagedDir = path.join(stageRoot, packaged.name);
              fs.mkdirSync(stagedDir, { recursive: false, mode: 0o700 });
              for (const file of packaged.files) {
                const filePath = path.join(stagedDir, ...file.path.split('/'));
                fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
                fs.writeFileSync(filePath, file.content, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
              }
              verifyStagedPipelineDigest(packaged.name, stagedDir, packaged.digest);
            }

            const overwrite = options.overwrite === true;
            for (const packaged of packageValue.pipelines) {
              const targetDir = path.join(userPipelinesDir, packaged.name);
              if (fs.existsSync(targetDir) && !overwrite) {
                throw new PipelineLibraryError(
                  `Pipeline "${packaged.name}" already exists; use --force to overwrite`,
                  'pipeline_already_exists'
                );
              }
            }

            fs.mkdirSync(userPipelinesDir, { recursive: true, mode: 0o700 });
            const installedNames: string[] = [];
            const installedDigests: Record<string, string> = {};
            const renamedBackups: { targetDir: string; backupDir: string | null }[] = [];
            try {
              for (const packaged of packageValue.pipelines) {
                const stagedDir = path.join(stageRoot, packaged.name);
                const targetDir = path.join(userPipelinesDir, packaged.name);
                let backupDir: string | null = null;
                if (fs.existsSync(targetDir)) {
                  backupDir = `${targetDir}.replaced-${process.pid}-${randomBytes(8).toString('hex')}`;
                  fs.renameSync(targetDir, backupDir);
                }
                // Per-item try/catch around the swap-in rename (mirroring
                // writeFileAtomically's own backup/restore below): if THIS
                // step fails after the backup rename above already succeeded
                // (e.g. a transient EBUSY/EPERM), restore immediately rather
                // than depending on `renamedBackups` — which only records an
                // item once its full swap has succeeded, so it would never
                // see (and therefore never roll back) an item that failed
                // partway through its own two-step swap.
                try {
                  fs.renameSync(stagedDir, targetDir);
                } catch (error) {
                  if (backupDir) {
                    if (fs.existsSync(targetDir)) fs.rmSync(targetDir, { recursive: true, force: true });
                    fs.renameSync(backupDir, targetDir);
                  }
                  throw error;
                }
                renamedBackups.push({ targetDir, backupDir });
                installedNames.push(packaged.name);
                installedDigests[packaged.name] = packaged.digest;
              }
            } catch (error) {
              for (const { targetDir, backupDir } of renamedBackups.reverse()) {
                fs.rmSync(targetDir, { recursive: true, force: true });
                if (backupDir) fs.renameSync(backupDir, targetDir);
              }
              throw error;
            }
            for (const { backupDir } of renamedBackups) {
              if (backupDir) fs.rmSync(backupDir, { recursive: true, force: true });
            }
            return { imported: installedNames, digests: installedDigests };
          } finally {
            fs.rmSync(stageRoot, { recursive: true, force: true });
          }
        });
        imported = result.imported;
        Object.assign(digests, result.digests);
      },
    });
    return { imported, path: resolvedSource, digests };
  } catch (error) {
    if (!commitStarted) discardWorkflowInstall(plan);
    throw error;
  }
}

/**
 * Exports an installed USER pipeline as a `.rasenpkg` (`pipeline` kind). Only
 * the user layer is exportable — mirroring `exportWorkflow`'s
 * built-in/project exclusion — since built-in pipelines already ship with
 * rasen and project-local pipelines are file-based, not package-installed.
 */
export function exportPipeline(
  name: string,
  destination: string,
  options: WorkflowRegistryOptions & { projectRoot?: string; overwrite?: boolean } = {}
): string {
  // Resolve `name` through the registry enumeration BEFORE constructing any
  // filesystem path from it — exactly as `deletePipeline` does — rather than
  // joining `getUserPipelinesDir()` with a raw, unvalidated `name`. A `name`
  // containing `../` segments must never reach `path.join`/`readDirectoryFiles`
  // even though the later package-domain check (`isPortableWorkflowId` in
  // `validatePackageDomain`) would still refuse to WRITE the resulting
  // package — the arbitrary-directory READ must not happen in the first place.
  const projectRoot =
    options.projectRoot ?? findRepoPlanningRootSync(process.cwd()) ?? process.cwd();
  const info = listPipelinesWithInfo(projectRoot).find((entry) => entry.name === name);
  if (!info || info.source !== 'user') {
    throw new PipelineLibraryError(
      `Pipeline "${name}" was not found in the user pipeline library (built-in and project pipelines cannot be exported)`,
      'pipeline_not_found'
    );
  }
  const pipelineDir = path.join(getUserPipelinesDir(), name);
  const packageValue = createPipelinePackage([name], [{ name, files: readDirectoryFiles(pipelineDir) }]);
  const bytes = encodePackage(packageValue);
  writeFileAtomically(destination, bytes, options.overwrite === true);
  return path.resolve(destination);
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
    throw new PipelineLibraryError('Export destination must be a regular file', 'destination_not_file');
  }
  if (existing && !overwrite) {
    throw new PipelineLibraryError('Export destination already exists', 'destination_exists');
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

export interface DeletePipelineResult {
  forcedReferrers: string[];
}

/**
 * Deletes a USER pipeline. Refuses when it is referenced by any installed
 * workflow's `requires.pipelines` or another pipeline's `decompose`
 * `childPipeline` (`--force` bypasses the referrer guard only, warning about
 * dangling referrers). Built-in (package-layer) pipelines are never
 * deletable. Mirrors `deleteWorkflow`'s `DeleteWorkflowResult` shape.
 */
export async function deletePipeline(
  name: string,
  options: PipelineUsageOptions & { force?: boolean } = {}
): Promise<DeletePipelineResult> {
  return withPipelinesLock(async () => {
    const projectRoot =
      options.projectRoot ?? findRepoPlanningRootSync(process.cwd()) ?? process.cwd();
    const info = listPipelinesWithInfo(projectRoot).find((entry) => entry.name === name);
    if (!info) throw new PipelineLibraryError(`Pipeline "${name}" was not found`, 'pipeline_not_found');
    if (info.source !== 'user') {
      throw new PipelineLibraryError(
        `${info.source === 'package' ? 'Built-in' : 'Project-local'} pipelines cannot be deleted with this command`,
        'pipeline_delete_forbidden'
      );
    }

    const usageContext = createPipelineUsageContext({ ...options, projectRoot });
    const usage = scanPipelineUsage(name, { ...options, projectRoot }, usageContext);
    const forcedReferrers = usage.map((item) => `${item.kind}:${item.consumer}`);
    if (usage.length > 0 && !options.force) {
      throw new PipelineLibraryError(`Pipeline "${name}" is still referenced`, 'pipeline_in_use', {
        consumers: forcedReferrers,
      });
    }

    const target = path.join(getUserPipelinesDir(), name);
    const tombstone = `${target}.delete-${process.pid}-${randomBytes(8).toString('hex')}`;
    fs.renameSync(target, tombstone);
    try {
      fs.rmSync(tombstone, { recursive: true });
    } catch (error) {
      fs.renameSync(tombstone, target);
      throw error;
    }

    return { forcedReferrers: usage.length > 0 ? forcedReferrers : [] };
  });
}

export interface SavePipelineResult {
  name: string;
  path: string;
  /** `false` when an existing user pipeline of this name was overwritten (`--force`). */
  created: boolean;
}

/**
 * Installs a pipeline definition (read from `fromFile`, JSON or YAML — `yaml`'s
 * parser accepts both) as the named USER pipeline (pipeline-definition-api).
 * Validates through the SAME chain `parsePipeline` runs (schema + every
 * structural check, including the origin-scoped quality floor) plus the skill
 * known/enabled checks, refuses a built-in name unconditionally, refuses an
 * existing user pipeline without `force`, and emits canonical YAML preserving
 * every field — including `origin` — verbatim (no field is stamped or
 * stripped by this function; a caller wanting `origin: 'ui'` stamps it into
 * the definition before calling this).
 */
export async function savePipeline(
  name: string,
  fromFile: string,
  options: WorkflowRegistryOptions & { projectRoot?: string; force?: boolean } = {}
): Promise<SavePipelineResult> {
  if (!isPortableWorkflowId(name)) {
    throw new PipelineLibraryError(`Pipeline name "${name}" is not portable`, 'pipeline_id_invalid');
  }

  const projectRoot = options.projectRoot ?? findRepoPlanningRootSync(process.cwd()) ?? process.cwd();
  const info = listPipelinesWithInfo(projectRoot).find((entry) => entry.name === name);
  if (info?.source === 'package') {
    throw new PipelineLibraryError(
      `Pipeline "${name}" is a built-in pipeline and cannot be overwritten by save`,
      'pipeline_builtin_protected'
    );
  }
  if (info?.source === 'user' && !options.force) {
    throw new PipelineLibraryError(
      `Pipeline "${name}" already exists; use --force to overwrite`,
      'pipeline_already_exists'
    );
  }

  const resolvedFrom = path.resolve(fromFile);
  let content: string;
  try {
    content = fs.readFileSync(resolvedFrom, 'utf8');
  } catch (error) {
    throw new PipelineLibraryError(
      `Definition file "${resolvedFrom}" could not be read: ${error instanceof Error ? error.message : String(error)}`,
      'definition_not_found'
    );
  }

  // Full structural chain (schema, duplicate ids, requires refs, cycles,
  // parallel groups, decompose constraints, origin-scoped quality floor) —
  // throws PipelineValidationError on the first violation, exactly like every
  // other pipeline load.
  const pipeline = parsePipeline(content);

  const { knownSkillNames, enabledSkillNames } = await resolvePipelineExecutionSkillSets(
    projectRoot,
    { reporter: false }
  );
  validatePipelineSkills(pipeline, knownSkillNames, enabledSkillNames);

  return withPipelinesLock(() => {
    const targetDir = path.join(getUserPipelinesDir(), name);
    fs.mkdirSync(targetDir, { recursive: true, mode: 0o700 });
    const targetFile = path.join(targetDir, 'pipeline.yaml');
    fs.writeFileSync(targetFile, stringifyYaml(pipeline), { encoding: 'utf8', mode: 0o600 });
    return { name, path: targetFile, created: !info };
  });
}
