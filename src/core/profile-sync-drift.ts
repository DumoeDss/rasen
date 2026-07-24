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
import { readProjectConfig } from './project-config.js';
import { resolveLockedProfileBase } from './profiles.js';

type WorkflowId = string;

/**
 * Options shared by the drift entry points. `expertSelectionExplicit` is the
 * same gate `update.ts` computes (global marker AND this project's own
 * acknowledgment); it only matters when the project carries a resolvable
 * built-in `profile` lock, whose expert set depends on the marker. Defaults
 * to `false` — the safe legacy (all-experts) branch, matching how a project
 * that has not acknowledged the expert-selection flip resolves.
 */
export interface ProfileDriftOptions {
  expertSelectionExplicit?: boolean;
}

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
function resolveClosureDesiredWorkflows(
  workflows: readonly string[],
  projectPath?: string,
  options: ProfileDriftOptions = {}
): WorkflowId[] {
  // A project carrying its own `workflows` override (space-workflow-enablement)
  // always wins the closure basis, regardless of what the caller passed in —
  // this is what keeps drift detection from ever disagreeing with `update`'s
  // per-project resolution (design.md D3) when a caller still passes the
  // global/stored selection (e.g. the profile editor's un-expanded state).
  // A resolvable `profile` lock is the next layer (init-profile-lock spec);
  // an unresolvable lock falls through to the caller's selection, exactly
  // like resolveProjectWorkflowSelection falls back to the user-wide profile.
  const projectConfig = projectPath ? readProjectConfig(projectPath) : null;
  const override = projectConfig?.workflows;
  let base: readonly string[] | undefined = override;
  const lockedProfile = projectConfig?.profile;
  if (base === undefined && lockedProfile !== undefined) {
    const lockBase = resolveLockedProfileBase(
      lockedProfile,
      options.expertSelectionExplicit === true
    );
    if (lockBase.ok) base = lockBase.workflows;
  }
  base ??= workflows;
  const catalog = loadWorkflowCatalog();
  const { known } = filterKnownWorkflowRoots(catalog, base);
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
  desiredWorkflows: readonly string[],
  options: ProfileDriftOptions = {}
): boolean {
  const tool = AI_TOOLS.find((t) => t.value === toolId);
  if (!tool?.skillsDir) return false;

  const knownDesiredWorkflows = resolveClosureDesiredWorkflows(desiredWorkflows, projectPath, options);
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
  configuredTools?: readonly string[],
  options: ProfileDriftOptions = {}
): string[] {
  const tools = configuredTools ? [...new Set(configuredTools)] : getConfiguredToolsForProfileSync(projectPath);
  return tools.filter((toolId) =>
    hasToolProfileDrift(projectPath, toolId, desiredWorkflows, options) ||
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
  desiredWorkflows: readonly string[],
  options: ProfileDriftOptions = {}
): boolean {
  const configuredTools = getConfiguredToolsForProfileSync(projectPath);
  if (hasWorkflowArtifactLedgerDrift(projectPath, configuredTools, desiredWorkflows)) {
    return true;
  }
  if (getToolsNeedingProfileSync(projectPath, desiredWorkflows, configuredTools, options).length > 0) {
    return true;
  }

  const desiredSet = new Set(resolveClosureDesiredWorkflows(desiredWorkflows, projectPath, options));

  for (const toolId of configuredTools) {
    const installed = getInstalledWorkflowsForTool(projectPath, toolId);
    if (installed.some((workflow) => !desiredSet.has(workflow))) {
      return true;
    }
  }

  return false;
}
