import path from 'path';
import * as fs from 'fs';
import { AI_TOOLS } from './config.js';
import { getConfiguredTools, resolveToolSkillsRoot } from './shared/index.js';
import { getBuiltInWorkflowDefinitions } from './workflow-registry/index.js';
import {
  filterKnownWorkflowRoots,
  loadWorkflowCatalog,
  resolveWorkflowSelection,
} from './workflow-registry/index.js';
import {
  hasWorkflowArtifactLedgerDrift,
  readWorkflowArtifactLedger,
} from './workflow-artifact-ledger.js';

type WorkflowId = string;

/**
 * Maps workflow IDs to their skill directory names.
 */
export const WORKFLOW_TO_SKILL_DIR = Object.fromEntries(
  getBuiltInWorkflowDefinitions().map((definition) => [definition.id, definition.skill.dirName])
) as Record<WorkflowId, string>;

/**
 * Resolves a desired workflow selection (raw or already closure-resolved)
 * to its full dependency closure — the selection plus every expert a
 * selected workflow's skill-dependency closure requires. A stored profile
 * is intentionally not closure-expanded (`profiles` spec), while installed
 * experts ARE closure-governed, so drift detection must reconcile the two
 * by closing over the selection itself, using the same primitive the
 * install/removal seam uses (`resolveDesiredWorkflowSelection` in
 * `profiles.ts`). Idempotent for callers that already pass a
 * closure-resolved set.
 */
function resolveClosureDesiredWorkflows(workflows: readonly string[]): WorkflowId[] {
  const catalog = loadWorkflowCatalog();
  const { known } = filterKnownWorkflowRoots(catalog, workflows);
  return resolveWorkflowSelection(catalog, known, { includeSkillDependencies: true }).map(
    (definition) => definition.id
  );
}

/**
 * Returns tools that are configured via skills (the only delivery surface
 * now that the command surface is retired).
 */
export function getConfiguredToolsForProfileSync(projectPath: string): string[] {
  const skillConfigured = getConfiguredTools(projectPath);
  let ledgerConfigured: string[] = [];
  try {
    ledgerConfigured = Object.keys(readWorkflowArtifactLedger(projectPath)?.tools ?? {});
  } catch {
    // An invalid ledger is reported as drift by the generation layer.
  }
  return [...new Set([...skillConfigured, ...ledgerConfigured])];
}

/**
 * Detects if a single tool has profile drift against the desired state:
 * required skills missing for selected workflows, or skill artifacts for
 * workflows (or, since the expert install-semantics flip, experts) that
 * were deselected from the current profile.
 *
 * `desiredWorkflows` is treated as a selection to be closed over
 * internally: callers may pass either the raw stored selection (e.g. a
 * profile's `state.workflows`) or an already closure-resolved set (e.g.
 * `resolveDesiredWorkflowSelection`'s output, as `update.ts` passes) and
 * get the same result — this function resolves the dependency closure
 * itself via the same primitive the install path (`getSkillTemplates`) and
 * the removal seam (`removeUnselectedSkillDirs`) use, so drift, install,
 * and removal never disagree about experts.
 */
export function hasToolProfileDrift(
  projectPath: string,
  toolId: string,
  desiredWorkflows: readonly string[]
): boolean {
  const tool = AI_TOOLS.find((t) => t.value === toolId);
  if (!tool?.skillsDir) return false;

  const knownDesiredWorkflows = resolveClosureDesiredWorkflows(desiredWorkflows);
  const desiredWorkflowSet = new Set<WorkflowId>(knownDesiredWorkflows);
  const definitions = loadWorkflowCatalog().definitions;
  const definitionById = new Map(definitions.map((definition) => [definition.id, definition]));
  const skillsDir = resolveToolSkillsRoot(tool, projectPath);

  // Skills are forward-required for every selected workflow.
  for (const workflow of knownDesiredWorkflows) {
    const dirName = definitionById.get(workflow)!.skill.dirName;
    const skillFile = path.join(skillsDir, dirName, 'SKILL.md');
    if (!fs.existsSync(skillFile)) {
      return true;
    }
  }

  // Deselecting workflows in a profile should trigger sync.
  for (const definition of definitions.filter((item) => item.source === 'built-in')) {
    if (desiredWorkflowSet.has(definition.id)) continue;
    const dirName = definition.skill.dirName;
    const skillDir = path.join(skillsDir, dirName);
    if (fs.existsSync(skillDir)) {
      return true;
    }
  }

  return false;
}

/**
 * Returns configured tools that currently need a profile sync.
 */
export function getToolsNeedingProfileSync(
  projectPath: string,
  desiredWorkflows: readonly string[],
  configuredTools?: readonly string[]
): string[] {
  const tools = configuredTools ? [...new Set(configuredTools)] : getConfiguredToolsForProfileSync(projectPath);
  return tools.filter((toolId) =>
    hasToolProfileDrift(projectPath, toolId, desiredWorkflows) ||
    hasWorkflowArtifactLedgerDrift(projectPath, [toolId], desiredWorkflows)
  );
}

function getInstalledWorkflowsForTool(projectPath: string, toolId: string): WorkflowId[] {
  const tool = AI_TOOLS.find((t) => t.value === toolId);
  if (!tool?.skillsDir) return [];

  const installed = new Set<WorkflowId>();
  const skillsDir = resolveToolSkillsRoot(tool, projectPath);
  const definitions = loadWorkflowCatalog().definitions;

  for (const definition of definitions.filter((item) => item.source === 'built-in')) {
    const workflow = definition.id;
    const dirName = definition.skill.dirName;
    const skillFile = path.join(skillsDir, dirName, 'SKILL.md');
    if (fs.existsSync(skillFile)) {
      installed.add(workflow);
    }
  }

  return [...installed];
}

/**
 * Detects whether the current project has any profile drift.
 */
export function hasProjectConfigDrift(
  projectPath: string,
  desiredWorkflows: readonly string[]
): boolean {
  const configuredTools = getConfiguredToolsForProfileSync(projectPath);
  if (hasWorkflowArtifactLedgerDrift(projectPath, configuredTools, desiredWorkflows)) {
    return true;
  }
  if (getToolsNeedingProfileSync(projectPath, desiredWorkflows, configuredTools).length > 0) {
    return true;
  }

  const desiredSet = new Set(resolveClosureDesiredWorkflows(desiredWorkflows));

  for (const toolId of configuredTools) {
    const installed = getInstalledWorkflowsForTool(projectPath, toolId);
    if (installed.some((workflow) => !desiredSet.has(workflow))) {
      return true;
    }
  }

  return false;
}
