import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  acquireFileLock,
  releaseFileLock,
  type FileLockErrorInfo,
  type FileLockErrorKind,
} from '../file-state.js';
import {
  getExpertSkillDefinitions,
  getUserWorkflowsDir,
  loadWorkflowCatalog,
  resolveWorkflowSelection,
  validateWorkflowDirectory,
  WorkflowCatalog,
  type WorkflowDefinition,
  type WorkflowRegistryOptions,
} from '../workflow-registry/index.js';
import type { RasenPackage } from './schema.js';

export class WorkflowTransactionError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly details?: Record<string, string | string[]>
  ) {
    super(message);
    this.name = 'WorkflowTransactionError';
  }
}

export interface WorkflowInstallPlan {
  definitions: WorkflowDefinition[];
  roots: string[];
  stageRoot: string;
}

export interface WorkflowInstallResult {
  imported: string[];
  reused: string[];
  roots: string[];
}

export interface WorkflowTransactionOptions extends WorkflowRegistryOptions {
  rename?: (oldPath: fs.PathLike, newPath: fs.PathLike) => void;
  remove?: (targetPath: fs.PathLike) => void;
  /**
   * Commits a dependent artifact while the workflow registry lock is held.
   * Throwing rolls back only workflow directories created by this transaction.
   */
  afterInstall?: (result: WorkflowInstallResult) => void | Promise<void>;
}

function lockError(kind: FileLockErrorKind, info: FileLockErrorInfo): WorkflowTransactionError {
  return new WorkflowTransactionError(
    kind === 'timeout'
      ? 'Workflow registry is busy'
      : `Cannot create workflow registry lock at ${info.lockPath}`,
    'workflow_registry_busy',
    { lockPath: info.lockPath }
  );
}

function uniqueTemporaryPath(parent: string): string {
  return path.join(
    parent,
    `.workflow-import-${process.pid}-${randomBytes(8).toString('hex')}`
  );
}

function writeDefinitionToStage(definition: WorkflowDefinition, target: string): void {
  fs.mkdirSync(target, { recursive: false, mode: 0o700 });
  for (const file of definition.files) {
    const filePath = path.join(target, ...file.path.split('/'));
    fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(filePath, file.content, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  }
}

function assertInstallableSet(
  definitions: readonly WorkflowDefinition[],
  roots: readonly string[],
  options: WorkflowRegistryOptions
): { install: WorkflowDefinition[]; reused: string[] } {
  const current = loadWorkflowCatalog(options);
  const expertNames = new Set(
    getExpertSkillDefinitions().map((definition) => definition.template.name)
  );
  const install: WorkflowDefinition[] = [];
  const reused: string[] = [];
  const incomingById = new Map<string, WorkflowDefinition>();
  const incomingSkillNames = new Map<string, string>();
  const incomingCommandIds = new Map<string, string>();

  for (const definition of definitions) {
    const duplicate = incomingById.get(definition.id);
    if (duplicate) {
      throw new WorkflowTransactionError(
        `Import contains duplicate workflow ID "${definition.id}"`,
        'workflow_id_duplicate'
      );
    }
    incomingById.set(definition.id, definition);

    const existing = current.get(definition.id);
    if (existing) {
      if (existing.source === 'user' && existing.digest === definition.digest) {
        reused.push(definition.id);
        continue;
      }
      throw new WorkflowTransactionError(
        `Workflow ID "${definition.id}" conflicts with installed ${existing.source} content`,
        existing.source === 'built-in' ? 'builtin_collision' : 'workflow_digest_conflict'
      );
    }
    const skillName = definition.skill.template.name;
    const skillCollision = current.getBySkillName(skillName);
    if (skillCollision) {
      throw new WorkflowTransactionError(
        `Skill name "${skillName}" conflicts with workflow "${skillCollision.id}"`,
        'skill_name_collision'
      );
    }
    const incomingSkill = incomingSkillNames.get(skillName);
    if (incomingSkill) {
      throw new WorkflowTransactionError(
        `Skill name "${skillName}" is shared by "${incomingSkill}" and "${definition.id}"`,
        'skill_name_collision'
      );
    }
    incomingSkillNames.set(skillName, definition.id);

    const commandId = definition.command?.content.id;
    if (commandId) {
      const commandCollision = current.getByCommandId(commandId);
      if (commandCollision) {
        throw new WorkflowTransactionError(
          `Command ID "${commandId}" conflicts with workflow "${commandCollision.id}"`,
          'command_id_collision'
        );
      }
      const incomingCommand = incomingCommandIds.get(commandId);
      if (incomingCommand) {
        throw new WorkflowTransactionError(
          `Command ID "${commandId}" is shared by "${incomingCommand}" and "${definition.id}"`,
          'command_id_collision'
        );
      }
      incomingCommandIds.set(commandId, definition.id);
    }
    for (const skill of definition.requires.skills) {
      if (!expertNames.has(skill)) {
        throw new WorkflowTransactionError(
          `Required always-installed skill "${skill}" does not exist`,
          'skill_dependency_missing'
        );
      }
    }
    install.push(definition);
  }

  const combined = [...current.definitions, ...install];
  const combinedById = new Map(combined.map((definition) => [definition.id, definition]));
  for (const definition of install) {
    for (const dependency of definition.requires.workflows) {
      if (!combinedById.has(dependency)) {
        throw new WorkflowTransactionError(
          `Required workflow "${dependency}" is not installed or included`,
          'workflow_dependency_missing'
        );
      }
    }
  }

  // The indexed catalog also proves skill and command identity uniqueness.
  const combinedCatalog = new WorkflowCatalog(combined);
  for (const root of roots) resolveWorkflowSelection(combinedCatalog, [root]);
  return { install, reused };
}

export function stageWorkflowDefinitions(
  definitions: readonly WorkflowDefinition[],
  roots: readonly string[],
  options: WorkflowRegistryOptions = {}
): WorkflowInstallPlan {
  const workflowsDir = getUserWorkflowsDir(options);
  const parent = path.dirname(workflowsDir);
  fs.mkdirSync(parent, { recursive: true });
  const stageRoot = uniqueTemporaryPath(parent);
  fs.mkdirSync(stageRoot, { recursive: false, mode: 0o700 });

  try {
    const stagedDefinitions: WorkflowDefinition[] = [];
    for (const definition of definitions) {
      const target = path.join(stageRoot, definition.id);
      writeDefinitionToStage(definition, target);
      const validation = validateWorkflowDirectory(target);
      if (!validation.valid || !validation.definition) {
        throw new WorkflowTransactionError(
          `Staged workflow "${definition.id}" failed validation`,
          'staged_workflow_invalid',
          { diagnostics: validation.diagnostics.map((item) => item.code) }
        );
      }
      if (validation.definition.digest !== definition.digest) {
        throw new WorkflowTransactionError(
          `Staged workflow "${definition.id}" does not match its source digest`,
          'staged_digest_mismatch'
        );
      }
      stagedDefinitions.push(validation.definition);
    }
    assertInstallableSet(stagedDefinitions, roots, options);
    return { definitions: stagedDefinitions, roots: [...roots], stageRoot };
  } catch (error) {
    fs.rmSync(stageRoot, { recursive: true, force: true });
    throw error;
  }
}

export function stagePackageWorkflows(
  packageValue: RasenPackage,
  options: WorkflowRegistryOptions = {}
): WorkflowInstallPlan {
  const workflowsDir = getUserWorkflowsDir(options);
  const parent = path.dirname(workflowsDir);
  fs.mkdirSync(parent, { recursive: true });
  const stageRoot = uniqueTemporaryPath(parent);
  fs.mkdirSync(stageRoot, { recursive: false, mode: 0o700 });

  try {
    const definitions: WorkflowDefinition[] = [];
    for (const packaged of packageValue.workflows) {
      const target = path.join(stageRoot, packaged.id);
      fs.mkdirSync(target, { recursive: false, mode: 0o700 });
      for (const file of packaged.files) {
        const filePath = path.join(target, ...file.path.split('/'));
        fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
        fs.writeFileSync(filePath, file.content, {
          encoding: 'utf8',
          flag: 'wx',
          mode: 0o600,
        });
      }
      const validation = validateWorkflowDirectory(target);
      if (!validation.valid || !validation.definition) {
        throw new WorkflowTransactionError(
          `Packaged workflow "${packaged.id}" failed domain validation`,
          'packaged_workflow_invalid',
          { diagnostics: validation.diagnostics.map((item) => item.code) }
        );
      }
      if (validation.definition.digest !== packaged.digest) {
        throw new WorkflowTransactionError(
          `Packaged workflow "${packaged.id}" failed digest validation after staging`,
          'staged_digest_mismatch'
        );
      }
      definitions.push(validation.definition);
    }
    assertInstallableSet(definitions, packageValue.roots, options);
    return { definitions, roots: [...packageValue.roots], stageRoot };
  } catch (error) {
    fs.rmSync(stageRoot, { recursive: true, force: true });
    throw error;
  }
}

export async function commitWorkflowInstall(
  plan: WorkflowInstallPlan,
  options: WorkflowTransactionOptions = {}
): Promise<WorkflowInstallResult> {
  const workflowsDir = getUserWorkflowsDir(options);
  const parent = path.dirname(workflowsDir);
  const lockPath = path.join(parent, '.workflows.lock');
  const lock = await acquireFileLock({ lockPath, errorFor: lockError });
  const created: string[] = [];
  const rename = options.rename ?? fs.renameSync;
  const remove =
    options.remove ??
    ((targetPath: fs.PathLike) => fs.rmSync(targetPath, { recursive: true, force: true }));

  try {
    fs.mkdirSync(workflowsDir, { recursive: true, mode: 0o700 });
    const checked = assertInstallableSet(plan.definitions, plan.roots, options);
    for (const definition of checked.install) {
      const stagedPath = path.join(plan.stageRoot, definition.id);
      const finalPath = path.join(workflowsDir, definition.id);
      rename(stagedPath, finalPath);
      created.push(finalPath);
    }
    const result = {
      imported: checked.install.map((definition) => definition.id),
      reused: checked.reused,
      roots: [...plan.roots],
    };
    await options.afterInstall?.(result);
    return result;
  } catch (error) {
    const rollbackFailures: string[] = [];
    for (const createdPath of created.reverse()) {
      try {
        remove(createdPath);
      } catch (rollbackError) {
        rollbackFailures.push(
          `${createdPath}: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`
        );
      }
    }
    if (rollbackFailures.length > 0) {
      throw new WorkflowTransactionError(
        `${error instanceof Error ? error.message : String(error)}; rollback also failed`,
        'workflow_install_rollback_failed',
        { rollbackFailures, stageRoot: plan.stageRoot }
      );
    }
    throw error;
  } finally {
    fs.rmSync(plan.stageRoot, { recursive: true, force: true });
    await releaseFileLock(lock, lockPath);
  }
}

export function discardWorkflowInstall(plan: WorkflowInstallPlan): void {
  fs.rmSync(plan.stageRoot, { recursive: true, force: true });
}
