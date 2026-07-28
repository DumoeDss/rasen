/**
 * Tool Detection Utilities
 *
 * Shared utilities for detecting tool configurations and version status.
 */

import path from 'path';
import * as fs from 'fs';
import { AI_TOOLS, type AIToolOption } from '../config.js';
import { resolveHermesHome } from '../hermes/hermes-home.js';
import { readProjectConfig, updateProjectConfigKey, resolveConfigFilePath } from '../project-config.js';

/**
 * Names of skill directories created by rasen init.
 */
export const SKILL_NAMES = [
  'rasen-explore',
  'rasen-new-change',
  'rasen-continue-change',
  'rasen-apply-change',
  'rasen-sync-specs',
  'rasen-archive-change',
  'rasen-bulk-archive-change',
  'rasen-verify-change',
  'rasen-onboard',
  'rasen-propose',
] as const;

export type SkillName = (typeof SKILL_NAMES)[number];

/**
 * IDs of command templates created by rasen init.
 */
export const COMMAND_IDS = [
  'explore',
  'new',
  'continue',
  'apply',
  'sync',
  'archive',
  'bulk-archive',
  'verify',
  'onboard',
  'help',
  'propose',
  // Rasen fusion workflow commands
  'office-hours-command',
  'verify-enhanced-command',
  'ship-command',
  'retro-command',
  'auto-command',
  // Iterative review loop (opt-in)
  'review-cycle',
  // Context handoff (opt-in)
  'handoff',
  // Goal-loop workflow family (opt-in)
  'goal-command',
] as const;

export type CommandId = (typeof COMMAND_IDS)[number];

/**
 * Status of skill configuration for a tool.
 */
export interface ToolSkillStatus {
  /** Whether the tool has any skills configured */
  configured: boolean;
  /** Whether all skills are configured */
  fullyConfigured: boolean;
  /** Number of skills currently configured */
  skillCount: number;
}

/**
 * Version information for a tool's skills.
 */
export interface ToolVersionStatus {
  /** The tool ID */
  toolId: string;
  /** The tool's display name */
  toolName: string;
  /** Whether the tool has any skills configured */
  configured: boolean;
  /** The generatedBy version found in the skill files, or null if not found */
  generatedByVersion: string | null;
  /** Whether the tool needs updating (version mismatch or missing) */
  needsUpdate: boolean;
}

/**
 * Gets the list of adapted tools with skillsDir configured.
 * This is the install/selection surface — it only offers agents Rasen has
 * adapted orchestration for. Tolerant-read functions below intentionally do
 * NOT use this filter; they operate on the full AI_TOOLS list so already
 * configured (but unadapted) tools remain serviceable by update.
 */
export function getToolsWithSkillsDir(): string[] {
  return AI_TOOLS.filter((t) => t.skillsDir && t.adapted).map((t) => t.value);
}

/**
 * Classifies a token as a known-but-unadapted tool: it matches an AI_TOOLS
 * entry with a skillsDir, but that entry is not adapted. Used to give a
 * distinguishing "recognized but not yet adapted" error instead of the
 * generic "unknown tool" error.
 */
export function isKnownUnadaptedTool(value: string): boolean {
  const tool = AI_TOOLS.find((t) => t.value === value);
  return Boolean(tool?.skillsDir && !tool.adapted);
}

/**
 * Resolves where a tool's Rasen skills root lives on disk.
 *
 * Every tool defaults to a project-local skills directory
 * (`<projectPath>/<skillsDir>/skills`) — this default is unchanged for all
 * existing tools. A tool marked `skillsHome: 'global'` (currently only
 * Hermes) instead resolves to its machine-global home's skills directory,
 * independent of the project path.
 */
export function resolveToolSkillsRoot(tool: AIToolOption, projectPath: string): string {
  if (tool.skillsHome === 'global') {
    return path.join(resolveHermesHome(), 'skills');
  }
  return path.join(projectPath, tool.skillsDir ?? '', 'skills');
}

/**
 * Checks which skill files exist for a tool.
 */
export function getToolSkillStatus(projectRoot: string, toolId: string): ToolSkillStatus {
  const tool = AI_TOOLS.find((t) => t.value === toolId);
  if (!tool?.skillsDir) {
    return { configured: false, fullyConfigured: false, skillCount: 0 };
  }

  const skillsDir = resolveToolSkillsRoot(tool, projectRoot);
  let skillCount = 0;

  for (const skillName of SKILL_NAMES) {
    const skillFile = path.join(skillsDir, skillName, 'SKILL.md');
    if (fs.existsSync(skillFile)) {
      skillCount++;
    }
  }

  return {
    configured: skillCount > 0,
    fullyConfigured: skillCount === SKILL_NAMES.length,
    skillCount,
  };
}

/**
 * Gets the skill status for all tools with skillsDir configured.
 */
export function getToolStates(projectRoot: string): Map<string, ToolSkillStatus> {
  const states = new Map<string, ToolSkillStatus>();
  const toolIds = AI_TOOLS.filter((t) => t.skillsDir).map((t) => t.value);

  for (const toolId of toolIds) {
    states.set(toolId, getToolSkillStatus(projectRoot, toolId));
  }

  return states;
}

/**
 * Extracts the generatedBy version from a skill file's YAML frontmatter.
 * Returns null if the field is not found or the file doesn't exist.
 */
export function extractGeneratedByVersion(skillFilePath: string): string | null {
  try {
    if (!fs.existsSync(skillFilePath)) {
      return null;
    }

    const content = fs.readFileSync(skillFilePath, 'utf-8');

    // Look for generatedBy in the YAML frontmatter
    // The file format is:
    // ---
    // ...
    // metadata:
    //   author: rasen
    //   version: "1.0"
    //   generatedBy: "0.23.0"
    // ---
    const generatedByMatch = content.match(/^\s*generatedBy:\s*["']?([^"'\n]+)["']?\s*$/m);

    if (generatedByMatch && generatedByMatch[1]) {
      return generatedByMatch[1].trim();
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Gets version status for a tool by reading the first available skill file.
 */
export function getToolVersionStatus(
  projectRoot: string,
  toolId: string,
  currentVersion: string
): ToolVersionStatus {
  const tool = AI_TOOLS.find((t) => t.value === toolId);
  if (!tool?.skillsDir) {
    return {
      toolId,
      toolName: toolId,
      configured: false,
      generatedByVersion: null,
      needsUpdate: false,
    };
  }

  const skillsDir = resolveToolSkillsRoot(tool, projectRoot);
  let generatedByVersion: string | null = null;

  // Find the first skill file that exists and read its version
  for (const skillName of SKILL_NAMES) {
    const skillFile = path.join(skillsDir, skillName, 'SKILL.md');
    if (fs.existsSync(skillFile)) {
      generatedByVersion = extractGeneratedByVersion(skillFile);
      break;
    }
  }

  const configured = getToolSkillStatus(projectRoot, toolId).configured;
  const needsUpdate = configured && (generatedByVersion === null || generatedByVersion !== currentVersion);

  return {
    toolId,
    toolName: tool.name,
    configured,
    generatedByVersion,
    needsUpdate,
  };
}

/**
 * Gets all configured tools in the project.
 */
export function getConfiguredTools(projectRoot: string): string[] {
  return AI_TOOLS
    .filter((t) => t.skillsDir && getToolSkillStatus(projectRoot, t.value).configured)
    .map((t) => t.value);
}

/**
 * Result of resolving configured tools through the project-install-manifest.
 */
export interface ResolvedConfiguredTools {
  /** The resolved list of tool ids (the authoritative configured-tool set). */
  tools: string[];
  /**
   * `true` when the `tools:` manifest was absent in `rasen/config.yaml` and
   * this call seeded it from on-disk detection (or attempted to). `false`
   * when the manifest was already present and used verbatim.
   */
  seeded: boolean;
}

/**
 * Options for {@link resolveConfiguredTools}.
 */
export interface ResolveConfiguredToolsOptions {
  /**
   * Seed provider invoked when the manifest is absent. Required — every
   * caller knows which on-disk union is appropriate for its context (the
   * basic `getConfiguredTools` union, the richer profile-sync union
   * `rasen update` uses, or a test stub).
   */
  seedProvider: () => string[];
}

/**
 * Resolves the project's configured-tool set through the authoritative
 * `tools:` manifest in `rasen/config.yaml` (project-install-manifest spec).
 *
 * Behavior:
 * 1. If `tools:` is present (even empty), it is returned verbatim and is the
 *    authoritative set. `seeded === false`.
 * 2. If `tools:` is absent, the seed set is computed via `options.seedProvider`,
 *    then written into `rasen/config.yaml` via `updateProjectConfigKey`. The
 *    seed is returned for the current run. `seeded === true`.
 * 3. If the write fails (read-only, parse failure), a warning naming the
 *    config path is emitted and the in-memory seed is returned for the
 *    current run. `seeded` remains `true`.
 * 4. If the config itself cannot be parsed (not just absent), behaves as the
 *    write-failed path: fall back to on-disk detection for the current run.
 *
 * Migration is idempotent: a second call with the manifest present returns it
 * verbatim and does not rewrite.
 */
export function resolveConfiguredTools(
  projectRoot: string,
  options: ResolveConfiguredToolsOptions
): ResolvedConfiguredTools {
  const config = readProjectConfig(projectRoot);
  const computeSeed = options.seedProvider;

  if (config === null) {
    // Config itself unparseable/missing: fall back to disk for this run.
    const seed = computeSeed();
    const configPath = resolveConfigFilePath(projectRoot);
    if (configPath !== null) {
      console.warn(
        `Warning: could not read Rasen config at ${configPath}; falling back to on-disk tool detection for this run.`
      );
    }
    return { tools: seed, seeded: true };
  }

  if (Array.isArray(config.tools)) {
    return { tools: config.tools, seeded: false };
  }

  // Manifest absent: seed from disk.
  const seed = computeSeed();
  const configPath = resolveConfigFilePath(projectRoot);
  if (configPath === null) {
    // No config file at all — nothing to write into. Behave as fail-open.
    return { tools: seed, seeded: true };
  }
  try {
    updateProjectConfigKey(projectRoot, 'tools', seed);
  } catch (error) {
    // Write failure (read-only, parse issue): emit a warning and continue.
    console.warn(
      `Warning: could not seed tools: into ${configPath} (${
        error instanceof Error ? error.message : String(error)
      }); the manifest was not updated. On-disk detection is used for this run.`
    );
  }
  return { tools: seed, seeded: true };
}

/**
 * Gets version status for all configured tools.
 */
export function getAllToolVersionStatus(
  projectRoot: string,
  currentVersion: string
): ToolVersionStatus[] {
  const configuredTools = getConfiguredTools(projectRoot);
  return configuredTools.map((toolId) =>
    getToolVersionStatus(projectRoot, toolId, currentVersion)
  );
}
