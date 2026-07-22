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
  BUILT_IN_WORKFLOW_IDS,
  getUserWorkflowsDir,
  loadWorkflowCatalog,
  resolveWorkflowSelection,
  validateWorkflowDirectory,
  WorkflowCatalog,
  type WorkflowDefinition,
  type WorkflowRegistryOptions,
} from '../workflow-registry/index.js';
import { portablePathCollisionKey } from '../workflow-registry/path-policy.js';
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
  const expertDefinitions = current.definitions.filter((definition) => definition.kind === 'expert');
  const expertNames = new Set(expertDefinitions.map((definition) => definition.skill.template.name));
  const expertSkillIdentities = new Map<string, string>();
  for (const expert of expertDefinitions) {
    for (const name of new Set([expert.skill.template.name, expert.skill.dirName])) {
      expertSkillIdentities.set(portablePathCollisionKey(name), expert.id);
    }
  }
  const install: WorkflowDefinition[] = [];
  const reused: string[] = [];
  const incomingById = new Map<string, WorkflowDefinition>();
  const incomingSkillNames = new Map<string, string>();

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
    const expertCollision = [skillName, definition.skill.dirName]
      .map((name) => expertSkillIdentities.get(portablePathCollisionKey(name)))
      .find((id) => id !== undefined);
    if (expertCollision) {
      throw new WorkflowTransactionError(
        `Skill identity "${skillName}" conflicts with always-installed expert "${expertCollision}"`,
        'expert_skill_collision'
      );
    }
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

  // The indexed catalog also proves skill identity uniqueness.
  const combinedCatalog = new WorkflowCatalog(combined);
  for (const root of roots) resolveWorkflowSelection(combinedCatalog, [root]);
  return { install, reused };
}

function assertPackagedClosure(
  packageValue: RasenPackage,
  definitions: readonly WorkflowDefinition[]
): void {
  const byId = new Map(definitions.map((definition) => [definition.id, definition]));
  const builtIns = new Set<string>(BUILT_IN_WORKFLOW_IDS);
  // A pipeline package embeds no workflows this round (`workflows: []`), and
  // its `roots` names packaged PIPELINE names — a different ID space than
  // workflow IDs — so it has no workflow entrypoints to trace a closure from.
  const entrypoints = packageValue.kind === 'workflow'
    ? new Set(packageValue.roots)
    : packageValue.kind === 'profile'
      ? new Set(packageValue.profile.workflows.filter((id) => byId.has(id)))
      : new Set<string>();

  if (packageValue.kind === 'profile') {
    for (const workflowId of packageValue.profile.workflows) {
      if (!byId.has(workflowId) && !builtIns.has(workflowId)) {
        throw new WorkflowTransactionError(
          `Profile workflow "${workflowId}" is neither built-in nor embedded`,
          'profile_workflow_missing'
        );
      }
    }
    const roots = new Set(packageValue.roots);
    if (
      roots.size !== entrypoints.size ||
      [...entrypoints].some((workflowId) => !roots.has(workflowId))
    ) {
      throw new WorkflowTransactionError(
        'Profile package roots do not match embedded selected workflows',
        'profile_roots_mismatch'
      );
    }
  }

  const reachable = new Set<string>();
  const visit = (workflowId: string): void => {
    if (reachable.has(workflowId)) return;
    const definition = byId.get(workflowId);
    if (!definition) return;
    reachable.add(workflowId);
    for (const dependency of definition.requires.workflows) {
      if (byId.has(dependency)) visit(dependency);
      else if (!builtIns.has(dependency)) {
        throw new WorkflowTransactionError(
          `Required user workflow "${dependency}" is not embedded`,
          'package_dependency_missing'
        );
      }
    }
  };
  for (const entrypoint of entrypoints) visit(entrypoint);
  const unreachable = definitions
    .map((definition) => definition.id)
    .filter((workflowId) => !reachable.has(workflowId));
  if (unreachable.length > 0) {
    throw new WorkflowTransactionError(
      `Embedded workflows are outside the root dependency closure: ${unreachable.join(', ')}`,
      'package_workflow_unreachable'
    );
  }
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
      const validation = validateWorkflowDirectory(target, { projectRoot: options.projectRoot });
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
      const validation = validateWorkflowDirectory(target, { projectRoot: options.projectRoot });
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
    assertPackagedClosure(packageValue, definitions);
    // A pipeline package's `roots` names packaged pipeline names, not workflow
    // IDs (and it embeds no workflows this round). Treat it as having NO
    // workflow roots here — both for this function's own resolvability check
    // AND in the returned plan, since `commitWorkflowInstall` independently
    // re-runs the same workflow-root check against `plan.roots`. Otherwise a
    // pipeline name would be misread as an unknown workflow ID by either call.
    const workflowRoots = packageValue.kind === 'pipeline' ? [] : packageValue.roots;
    assertInstallableSet(definitions, workflowRoots, options);
    return { definitions, roots: [...workflowRoots], stageRoot };
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
