/**
 * Migration Utilities
 *
 * One-time migration logic for existing projects when profile system is introduced.
 * Called by both init and update commands before profile resolution.
 */

import type { AIToolOption } from './config.js';
import { getGlobalConfig, getGlobalConfigPath, saveGlobalConfig } from './global-config.js';
import { getCommandFilePathCandidates } from './shared/retired-command-paths.js';
import { WORKFLOW_TO_SKILL_DIR } from './profile-sync-drift.js';
import { ALL_WORKFLOWS } from './profiles.js';
import { resolveToolSkillsRoot } from './shared/index.js';
import path from 'path';
import * as fs from 'fs';

interface InstalledWorkflowArtifacts {
  workflows: string[];
  hasSkills: boolean;
  hasCommands: boolean;
}

function scanInstalledWorkflowArtifacts(
  projectPath: string,
  tools: AIToolOption[]
): InstalledWorkflowArtifacts {
  const installed = new Set<string>();
  let hasSkills = false;
  let hasCommands = false;

  for (const tool of tools) {
    if (!tool.skillsDir) continue;
    const skillsDir = resolveToolSkillsRoot(tool, projectPath);

    for (const workflowId of ALL_WORKFLOWS) {
      const skillDirName = WORKFLOW_TO_SKILL_DIR[workflowId];
      const skillFile = path.join(skillsDir, skillDirName, 'SKILL.md');
      if (fs.existsSync(skillFile)) {
        installed.add(workflowId);
        hasSkills = true;
      }
    }

    // The command surface itself is retired, but a pre-existing install may
    // still carry command files from before the retirement — detected here
    // (via the frozen static path knowledge) purely so such a project is
    // still recognized as "has this workflow installed" during one-time
    // migration, not silently treated as a fresh/empty install.
    for (const workflowId of ALL_WORKFLOWS) {
      for (const commandPath of getCommandFilePathCandidates(tool.value, workflowId)) {
        const fullPath = path.isAbsolute(commandPath)
          ? commandPath
          : path.join(projectPath, commandPath);
        if (fs.existsSync(fullPath)) {
          installed.add(workflowId);
          hasCommands = true;
          break;
        }
      }
    }
  }

  return {
    workflows: ALL_WORKFLOWS.filter((workflowId) => installed.has(workflowId)),
    hasSkills,
    hasCommands,
  };
}

/**
 * Scans installed workflow files across all detected tools and returns
 * the union of installed workflow IDs.
 */
export function scanInstalledWorkflows(projectPath: string, tools: AIToolOption[]): string[] {
  return scanInstalledWorkflowArtifacts(projectPath, tools).workflows;
}

/**
 * Performs one-time migration if the global config does not yet have a profile field.
 * Called by both init and update before profile resolution.
 *
 * - If no profile field exists and workflows are installed: sets profile to 'custom'
 *   with the detected workflows, preserving the user's existing setup.
 * - If no profile field exists and no workflows are installed: no-op (defaults apply).
 * - If profile field already exists: no-op.
 */
export function migrateIfNeeded(projectPath: string, tools: AIToolOption[]): void {
  const config = getGlobalConfig();

  // Check raw config file for profile field presence
  const configPath = getGlobalConfigPath();

  let rawConfig: Record<string, unknown> = {};
  try {
    if (fs.existsSync(configPath)) {
      rawConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    }
  } catch {
    return; // Can't read config, skip migration
  }

  // If profile is already explicitly set, no migration needed
  if (rawConfig.profile !== undefined) {
    return;
  }

  // Scan for installed workflows
  const artifacts = scanInstalledWorkflowArtifacts(projectPath, tools);
  const installedWorkflows = artifacts.workflows;

  if (installedWorkflows.length === 0) {
    // No workflows installed, new user — defaults will apply
    return;
  }

  // Migrate: set profile to custom with detected workflows
  config.profile = 'custom';
  config.workflows = installedWorkflows;
  saveGlobalConfig(config);

  console.log(`Migrated: custom profile with ${installedWorkflows.length} workflows (${installedWorkflows.join(', ')})`);
  console.log("New in this version: the rasen-propose skill (combines new + ff). Try 'rasen config profile core' for the streamlined 4-workflow experience.");
}
