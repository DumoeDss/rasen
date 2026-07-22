import * as fs from 'node:fs';
import * as path from 'node:path';

import { getGlobalDataDir } from '../global-config.js';
import { getBuiltInWorkflowDefinitions } from './builtins.js';
import { WorkflowCatalog } from './catalog.js';
import { getBuiltInExpertDefinitions } from './experts.js';
import { portablePathCollisionKey } from './path-policy.js';
import type {
  InvalidWorkflowRecord,
  WorkflowDefinition,
  WorkflowDiagnostic,
} from './types.js';
import { validateWorkflowDirectory } from './validator.js';

export const USER_WORKFLOWS_DIR_NAME = 'workflows';

export interface WorkflowRegistryOptions {
  globalDataDir?: string;
  workflowsDir?: string;
  /**
   * Repo/project root used to resolve project-layer `requires.pipelines` /
   * `requires.schemas` referents during directory validation. Optional —
   * omitting it keeps today's built-in+user-only resolution (no regression).
   */
  projectRoot?: string;
}

export function getUserWorkflowsDir(options: WorkflowRegistryOptions = {}): string {
  return options.workflowsDir ?? path.join(options.globalDataDir ?? getGlobalDataDir(), USER_WORKFLOWS_DIR_NAME);
}

function invalidRecord(
  id: string,
  sourcePath: string,
  diagnostics: WorkflowDiagnostic[]
): InvalidWorkflowRecord {
  return { id, source: 'user', sourcePath, diagnostics };
}

function dependencyCycleIds(definitions: readonly WorkflowDefinition[]): Set<string> {
  const byId = new Map(definitions.map((definition) => [definition.id, definition]));
  const visited = new Set<string>();
  const visiting: string[] = [];
  const cycleIds = new Set<string>();

  const visit = (id: string): void => {
    if (visited.has(id)) return;
    const cycleIndex = visiting.indexOf(id);
    if (cycleIndex >= 0) {
      for (const cycleId of visiting.slice(cycleIndex)) cycleIds.add(cycleId);
      return;
    }
    const definition = byId.get(id);
    if (!definition) return;
    visiting.push(id);
    for (const dependency of definition.requires.workflows) visit(dependency);
    visiting.pop();
    visited.add(id);
  };

  for (const definition of definitions) visit(definition.id);
  return cycleIds;
}

/**
 * The full built-in catalog: workflows plus experts (`kind: 'expert'`),
 * unified per the registry-unification decision (design.md D3). Built-in
 * workflows and built-in experts are disjoint ID/skill-identity spaces by
 * construction; a real collision here is a built-in authoring bug, not a
 * runtime condition to recover from.
 */
export function getBuiltInCatalogDefinitions(): WorkflowDefinition[] {
  return [...getBuiltInWorkflowDefinitions(), ...getBuiltInExpertDefinitions()];
}

export function loadWorkflowCatalog(options: WorkflowRegistryOptions = {}): WorkflowCatalog {
  const builtIns = getBuiltInCatalogDefinitions();
  const workflowsDir = getUserWorkflowsDir(options);
  const invalid: InvalidWorkflowRecord[] = [];
  const warnings: WorkflowDiagnostic[] = [];
  const candidates: WorkflowDefinition[] = [];

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(workflowsDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return new WorkflowCatalog(builtIns);
    }
    return new WorkflowCatalog(builtIns, [
      invalidRecord(path.basename(workflowsDir), workflowsDir, [
        {
          code: 'registry_unreadable',
          severity: 'error',
          message: error instanceof Error ? error.message : String(error),
          sourcePath: workflowsDir,
        },
      ]),
    ]);
  }

  entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
  for (const entry of entries) {
    const sourcePath = path.join(workflowsDir, entry.name);
    if (!entry.isDirectory()) {
      invalid.push(
        invalidRecord(entry.name, sourcePath, [
          {
            code: 'registry_entry_not_directory',
            severity: 'error',
            message: 'Workflow registry entries must be directories',
            sourcePath,
          },
        ])
      );
      continue;
    }
    const result = validateWorkflowDirectory(sourcePath);
    if (!result.valid || !result.definition) {
      invalid.push(invalidRecord(entry.name, sourcePath, result.diagnostics));
      continue;
    }
    candidates.push(result.definition);
  }

  const accepted: WorkflowDefinition[] = [...builtIns];
  const byId = new Map(builtIns.map((definition) => [definition.id, definition]));
  const bySkill = new Map<string, { id: string; kind: 'workflow' | 'expert' }>();
  for (const definition of builtIns) {
    const kind = definition.kind === 'expert' ? 'expert' : 'workflow';
    for (const name of new Set([definition.skill.template.name, definition.skill.dirName])) {
      bySkill.set(portablePathCollisionKey(name), { id: definition.id, kind });
    }
  }
  for (const candidate of candidates) {
    const collisionDiagnostics: WorkflowDiagnostic[] = [];
    const idCollision = byId.get(candidate.id);
    if (idCollision) {
      collisionDiagnostics.push({
        code: 'workflow_id_collision',
        severity: 'error',
        message: `Workflow ID "${candidate.id}" collides with ${idCollision.source} workflow "${idCollision.id}"`,
        path: 'id',
        sourcePath: candidate.sourcePath,
      });
    }
    const skillCollision = [candidate.skill.template.name, candidate.skill.dirName]
      .map((name) => bySkill.get(portablePathCollisionKey(name)))
      .find((collision) => collision !== undefined);
    if (skillCollision) {
      collisionDiagnostics.push({
        code: 'skill_name_collision',
        severity: 'error',
        message: `Skill identity "${candidate.skill.template.name}" collides with ${skillCollision.kind} "${skillCollision.id}"`,
        path: 'SKILL.md.name',
        sourcePath: candidate.sourcePath,
      });
    }
    if (collisionDiagnostics.length > 0) {
      invalid.push(invalidRecord(candidate.id, candidate.sourcePath!, collisionDiagnostics));
      continue;
    }

    accepted.push(candidate);
    byId.set(candidate.id, candidate);
    for (const name of new Set([candidate.skill.template.name, candidate.skill.dirName])) {
      bySkill.set(portablePathCollisionKey(name), { id: candidate.id, kind: 'workflow' });
    }
  }

  const expertNames = new Set(
    builtIns
      .filter((definition) => definition.kind === 'expert')
      .map((definition) => definition.skill.template.name)
  );
  const dependencyInvalid = new Map<string, WorkflowDiagnostic[]>();
  const userDefinitions = accepted.filter((definition) => definition.source === 'user');
  const cycleIds = dependencyCycleIds(accepted);

  for (const definition of userDefinitions) {
    const diagnostics: WorkflowDiagnostic[] = [];
    if (cycleIds.has(definition.id)) {
      diagnostics.push({
        code: 'workflow_dependency_cycle',
        severity: 'error',
        message: `Workflow "${definition.id}" participates in a dependency cycle`,
        path: 'requires.workflows',
        sourcePath: definition.sourcePath,
      });
    }
    for (const dependency of definition.requires.workflows) {
      if (!byId.has(dependency)) {
        diagnostics.push({
          code: 'workflow_dependency_missing',
          severity: 'error',
          message: `Required workflow "${dependency}" is not installed`,
          path: 'requires.workflows',
          sourcePath: definition.sourcePath,
          details: { dependency },
        });
      }
    }
    for (const skill of definition.requires.skills) {
      if (!expertNames.has(skill)) {
        diagnostics.push({
          code: 'skill_dependency_missing',
          severity: 'error',
          message: `Required always-installed skill "${skill}" does not exist`,
          path: 'requires.skills',
          sourcePath: definition.sourcePath,
          details: { dependency: skill },
        });
      }
    }
    for (const recommendation of definition.recommends.workflows) {
      if (!byId.has(recommendation)) {
        warnings.push({
          code: 'recommended_workflow_missing',
          severity: 'warning',
          message: `Recommended workflow "${recommendation}" is not installed`,
          path: 'recommends.workflows',
          sourcePath: definition.sourcePath,
          details: { workflowId: definition.id, dependency: recommendation },
        });
      }
    }
    if (diagnostics.length > 0) dependencyInvalid.set(definition.id, diagnostics);
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const definition of userDefinitions) {
      if (dependencyInvalid.has(definition.id)) continue;
      const unavailable = definition.requires.workflows.find((dependency) =>
        dependencyInvalid.has(dependency)
      );
      if (!unavailable) continue;
      dependencyInvalid.set(definition.id, [
        {
          code: 'workflow_dependency_invalid',
          severity: 'error',
          message: `Required workflow "${unavailable}" is invalid`,
          path: 'requires.workflows',
          sourcePath: definition.sourcePath,
          details: { dependency: unavailable },
        },
      ]);
      changed = true;
    }
  }

  for (const definition of userDefinitions) {
    const diagnostics = dependencyInvalid.get(definition.id);
    if (diagnostics) invalid.push(invalidRecord(definition.id, definition.sourcePath!, diagnostics));
  }
  const validDefinitions = accepted.filter(
    (definition) => definition.source === 'built-in' || !dependencyInvalid.has(definition.id)
  );

  return new WorkflowCatalog(validDefinitions, invalid, warnings);
}
