import path from 'path';
import * as fs from 'fs';
import { AI_TOOLS } from './config.js';
import type { Delivery } from './global-config.js';
import {
  CommandAdapterRegistry,
  getCommandFileId,
  getLegacyCommandFilePath,
  getCommandFilePathCandidates,
} from './command-generation/index.js';
import { getConfiguredTools, resolveToolSkillsRoot } from './shared/index.js';
import { getBuiltInWorkflowDefinitions } from './workflow-registry/index.js';
import { loadWorkflowCatalog } from './workflow-registry/index.js';
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

function toKnownWorkflows(workflows: readonly string[]): WorkflowId[] {
  const catalog = loadWorkflowCatalog();
  return workflows.filter((workflow) => catalog.has(workflow));
}

/**
 * Checks whether a tool has at least one generated Rasen command file.
 */
export function toolHasAnyConfiguredCommand(projectPath: string, toolId: string): boolean {
  const adapter = CommandAdapterRegistry.get(toolId);
  if (!adapter) return false;

  for (const commandId of getBuiltInWorkflowDefinitions()
    .flatMap((definition) => definition.command ? [definition.command.content.id] : [])) {
    for (const cmdPath of getCommandFilePathCandidates(adapter, commandId)) {
      const fullPath = path.isAbsolute(cmdPath) ? cmdPath : path.join(projectPath, cmdPath);
      if (fs.existsSync(fullPath)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Returns tools with at least one generated command file on disk.
 */
export function getCommandConfiguredTools(projectPath: string): string[] {
  return AI_TOOLS
    .filter((tool) => {
      if (!tool.skillsDir) return false;
      const toolDir = path.join(projectPath, tool.skillsDir);
      try {
        return fs.statSync(toolDir).isDirectory();
      } catch {
        return false;
      }
    })
    .map((tool) => tool.value)
    .filter((toolId) => toolHasAnyConfiguredCommand(projectPath, toolId));
}

/**
 * Returns tools that are configured via either skills or commands.
 */
export function getConfiguredToolsForProfileSync(projectPath: string): string[] {
  const skillConfigured = getConfiguredTools(projectPath);
  const commandConfigured = getCommandConfiguredTools(projectPath);
  let ledgerConfigured: string[] = [];
  try {
    ledgerConfigured = Object.keys(readWorkflowArtifactLedger(projectPath)?.tools ?? {});
  } catch {
    // An invalid ledger is reported as drift by the generation layer.
  }
  return [...new Set([...skillConfigured, ...commandConfigured, ...ledgerConfigured])];
}

/**
 * Detects if a single tool has profile/delivery drift against the desired state.
 *
 * This function covers:
 * - required artifacts missing for selected workflows
 * - artifacts that should not exist for the selected delivery mode
 * - artifacts for workflows that were deselected from the current profile
 */
export function hasToolProfileOrDeliveryDrift(
  projectPath: string,
  toolId: string,
  desiredWorkflows: readonly string[],
  delivery: Delivery
): boolean {
  const tool = AI_TOOLS.find((t) => t.value === toolId);
  if (!tool?.skillsDir) return false;

  const knownDesiredWorkflows = toKnownWorkflows(desiredWorkflows);
  const desiredWorkflowSet = new Set<WorkflowId>(knownDesiredWorkflows);
  const definitions = loadWorkflowCatalog().definitions;
  const definitionById = new Map(definitions.map((definition) => [definition.id, definition]));
  const skillsDir = resolveToolSkillsRoot(tool, projectPath);
  const adapter = CommandAdapterRegistry.get(toolId);
  // Skills are always installed; only commands are gated on delivery.
  const shouldGenerateCommands = delivery === 'both';

  // Skills are forward-required for every selected workflow regardless of delivery.
  for (const workflow of knownDesiredWorkflows) {
    const dirName = definitionById.get(workflow)!.skill.dirName;
    const skillFile = path.join(skillsDir, dirName, 'SKILL.md');
    if (!fs.existsSync(skillFile)) {
      return true;
    }
  }

  // Deselecting workflows in a profile should trigger sync.
  for (const definition of definitions.filter((item) => item.source === 'built-in' && item.kind !== 'expert')) {
    if (desiredWorkflowSet.has(definition.id)) continue;
    const dirName = definition.skill.dirName;
    const skillDir = path.join(skillsDir, dirName);
    if (fs.existsSync(skillDir)) {
      return true;
    }
  }

  if (shouldGenerateCommands && adapter) {
    // Only workflows with a command template (e.g. goal-command) generate a
    // command file. Skill-only workflows (e.g. goal-plan/iterate/report, the
    // goal-loop's internal stage skills) have no command counterpart, so
    // requiring one here would report drift forever.
    for (const workflow of knownDesiredWorkflows) {
      const definition = definitionById.get(workflow)!;
      if (!definition.command) continue;
      const cmdPath = adapter.getFilePath(getCommandFileId(definition.command.content.id));
      const fullPath = path.isAbsolute(cmdPath) ? cmdPath : path.join(projectPath, cmdPath);
      if (!fs.existsSync(fullPath)) {
        return true;
      }
    }

    for (const definition of definitions.filter((item) => item.source === 'built-in' && item.kind !== 'expert')) {
      const workflow = definition.id;
      // Deselecting workflows in a profile should trigger sync.
      if (definition.command && !desiredWorkflowSet.has(workflow)) {
        const cmdPath = adapter.getFilePath(getCommandFileId(workflow));
        const fullPath = path.isAbsolute(cmdPath) ? cmdPath : path.join(projectPath, cmdPath);
        if (fs.existsSync(fullPath)) {
          return true;
        }
      }
      // Lingering legacy '-command'-suffixed files should trigger sync.
      const legacyPath = getLegacyCommandFilePath(adapter, workflow);
      if (legacyPath) {
        const fullPath = path.isAbsolute(legacyPath) ? legacyPath : path.join(projectPath, legacyPath);
        if (fs.existsSync(fullPath)) {
          return true;
        }
      }
    }
  } else if (!shouldGenerateCommands && adapter) {
    for (const definition of definitions.filter((item) => item.source === 'built-in' && item.kind !== 'expert')) {
      if (!definition.command) continue;
      for (const cmdPath of getCommandFilePathCandidates(adapter, definition.command.content.id)) {
        const fullPath = path.isAbsolute(cmdPath) ? cmdPath : path.join(projectPath, cmdPath);
        if (fs.existsSync(fullPath)) {
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * Returns configured tools that currently need a profile/delivery sync.
 */
export function getToolsNeedingProfileSync(
  projectPath: string,
  desiredWorkflows: readonly string[],
  delivery: Delivery,
  configuredTools?: readonly string[]
): string[] {
  const tools = configuredTools ? [...new Set(configuredTools)] : getConfiguredToolsForProfileSync(projectPath);
  return tools.filter((toolId) =>
    hasToolProfileOrDeliveryDrift(projectPath, toolId, desiredWorkflows, delivery) ||
    hasWorkflowArtifactLedgerDrift(projectPath, [toolId], desiredWorkflows, delivery)
  );
}

function getInstalledWorkflowsForTool(
  projectPath: string,
  toolId: string,
  options: { includeSkills: boolean; includeCommands: boolean }
): WorkflowId[] {
  const tool = AI_TOOLS.find((t) => t.value === toolId);
  if (!tool?.skillsDir) return [];

  const installed = new Set<WorkflowId>();
  const skillsDir = resolveToolSkillsRoot(tool, projectPath);
  const definitions = loadWorkflowCatalog().definitions;

  if (options.includeSkills) {
    for (const definition of definitions.filter((item) => item.source === 'built-in' && item.kind !== 'expert')) {
      const workflow = definition.id;
      const dirName = definition.skill.dirName;
      const skillFile = path.join(skillsDir, dirName, 'SKILL.md');
      if (fs.existsSync(skillFile)) {
        installed.add(workflow);
      }
    }
  }

  if (options.includeCommands) {
    const adapter = CommandAdapterRegistry.get(toolId);
    if (adapter) {
      for (const definition of definitions.filter((item) => item.source === 'built-in' && item.kind !== 'expert')) {
        if (!definition.command) continue;
        const workflow = definition.id;
        for (const cmdPath of getCommandFilePathCandidates(adapter, definition.command.content.id)) {
          const fullPath = path.isAbsolute(cmdPath) ? cmdPath : path.join(projectPath, cmdPath);
          if (fs.existsSync(fullPath)) {
            installed.add(workflow);
            break;
          }
        }
      }
    }
  }

  return [...installed];
}

/**
 * Detects whether the current project has any profile/delivery drift.
 */
export function hasProjectConfigDrift(
  projectPath: string,
  desiredWorkflows: readonly string[],
  delivery: Delivery
): boolean {
  const configuredTools = getConfiguredToolsForProfileSync(projectPath);
  if (hasWorkflowArtifactLedgerDrift(projectPath, configuredTools, desiredWorkflows, delivery)) {
    return true;
  }
  if (getToolsNeedingProfileSync(projectPath, desiredWorkflows, delivery, configuredTools).length > 0) {
    return true;
  }

  const desiredSet = new Set(toKnownWorkflows(desiredWorkflows));
  const includeSkills = true;
  const includeCommands = delivery === 'both';

  for (const toolId of configuredTools) {
    const installed = getInstalledWorkflowsForTool(projectPath, toolId, { includeSkills, includeCommands });
    if (installed.some((workflow) => !desiredSet.has(workflow))) {
      return true;
    }
  }

  return false;
}
