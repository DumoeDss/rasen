/**
 * Legacy cleanup module for detecting and removing Rasen artifacts
 * from previous init versions during the migration to the skill-based workflow.
 */

import path from 'path';
import { promises as fs } from 'fs';
import chalk from 'chalk';
import { FileSystemUtils, removeMarkerBlock as removeMarkerBlockUtil } from '../utils/file-system.js';
import { OPENSPEC_MARKERS } from './config.js';

/**
 * Retired installed-skill directory prefix left behind by the expert-skill
 * rebrand (`openspec-gstack-<name>` → `openspec-<name>`). Installed skill dirs
 * are not renamed in place by init/update, so the old dirs would linger as
 * orphans; {@link pruneRetiredExpertSkillDirs} removes them.
 */
export const RETIRED_EXPERT_SKILL_PREFIX = 'openspec-gstack-';

/**
 * Removes installed expert-skill directories orphaned by the rebrand — those whose
 * directory name begins with {@link RETIRED_EXPERT_SKILL_PREFIX}. Scoped to exactly
 * that prefix, so it can never remove a current `openspec-*` skill or any unrelated
 * directory. Idempotent: a no-op (no error) when the skills directory is absent or
 * contains no such directory.
 *
 * @param skillsDir - Absolute path to a tool's installed skills directory
 *   (e.g. `<project>/.claude/skills`)
 * @returns The directory names that were removed
 */
export async function pruneRetiredExpertSkillDirs(skillsDir: string): Promise<string[]> {
  const removed: string[] = [];

  let entries: import('fs').Dirent[];
  try {
    entries = await fs.readdir(skillsDir, { withFileTypes: true });
  } catch {
    return removed; // skills dir does not exist yet — nothing to prune
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!entry.name.startsWith(RETIRED_EXPERT_SKILL_PREFIX)) continue;
    try {
      await fs.rm(path.join(skillsDir, entry.name), { recursive: true, force: true });
      removed.push(entry.name);
    } catch {
      // Best-effort cleanup; ignore per-directory failures.
    }
  }

  return removed;
}

/**
 * Installed skill directory names left behind by retired built-in workflows.
 * A retired workflow id is no longer in the registry, so the registry-derived
 * deselection cleanup (`removeUnselectedSkillDirs`) can never reach its
 * installed directory; {@link pruneRetiredWorkflowSkillDirs} removes it by
 * exact name instead. Append here when a future built-in workflow is retired.
 */
export const RETIRED_WORKFLOW_SKILL_DIRS = ['rasen-ff-change'] as const;

/**
 * Command ids left behind by retired built-in workflows. Command file paths
 * are adapter-specific, so the corresponding prune lives in `update.ts`
 * (which already has the configured-tool + adapter context) rather than
 * here; this constant is the shared list of ids it prunes.
 */
export const RETIRED_WORKFLOW_COMMAND_IDS = ['ff'] as const;

/**
 * Removes installed skill directories orphaned by a retired built-in
 * workflow — those whose name exactly matches one of
 * {@link RETIRED_WORKFLOW_SKILL_DIRS}. Scoped to exact names (not a prefix),
 * so it can never remove a current skill directory. Idempotent: a no-op (no
 * error) when the skills directory is absent or contains no such directory.
 *
 * @param skillsDir - Absolute path to a tool's installed skills directory
 *   (e.g. `<project>/.claude/skills`)
 * @returns The directory names that were removed
 */
export async function pruneRetiredWorkflowSkillDirs(skillsDir: string): Promise<string[]> {
  const removed: string[] = [];

  for (const dirName of RETIRED_WORKFLOW_SKILL_DIRS) {
    const dirPath = path.join(skillsDir, dirName);
    try {
      const stat = await fs.stat(dirPath);
      if (!stat.isDirectory()) continue;
    } catch {
      continue; // does not exist — nothing to prune
    }
    try {
      await fs.rm(dirPath, { recursive: true, force: true });
      removed.push(dirName);
    } catch {
      // Best-effort cleanup; ignore per-directory failures.
    }
  }

  return removed;
}

/**
 * Installed skill directory names left behind by RETIRED retention workflows
 * whose migration window has ENDED — cleaned by exact name, never a prefix,
 * glob, or regex.
 *
 * This set is intentionally EMPTY for the current migration window: the only
 * retention artifact on disk is the temporary `rasen-retro` compatibility
 * wrapper, which reuses the retired retro workflow's directory name and is
 * refreshed (not removed) each init/update. It is distinguished by its exact
 * named identity and passed as a preserve entry to
 * {@link pruneRetiredRetentionSkillDirs}. When the wrapper's window ends, add
 * its exact directory name here and stop generating it (design D1, migration
 * step 9).
 */
export const RETIRED_RETENTION_SKILL_DIRS: readonly string[] = [];

/**
 * Removes installed skill directories orphaned by a retired retention workflow
 * — those whose name exactly matches an entry in `dirNames` (default
 * {@link RETIRED_RETENTION_SKILL_DIRS}) — while preserving any name in
 * `preserve` (the currently shipped compatibility wrapper). Scoped to exact
 * names, so it never removes a current skill or a similarly named directory.
 * Idempotent; a no-op when the skills directory is absent.
 *
 * `dirNames` is overridable so the retirement mechanism can be exercised
 * independently of the (currently empty) production set.
 *
 * @returns The directory names that were removed
 */
export async function pruneRetiredRetentionSkillDirs(
  skillsDir: string,
  preserve: readonly string[] = [],
  dirNames: readonly string[] = RETIRED_RETENTION_SKILL_DIRS
): Promise<string[]> {
  const preserved = new Set(preserve);
  const removed: string[] = [];

  for (const dirName of dirNames) {
    if (preserved.has(dirName)) continue;
    const dirPath = path.join(skillsDir, dirName);
    try {
      const stat = await fs.stat(dirPath);
      if (!stat.isDirectory()) continue;
    } catch {
      continue; // does not exist — nothing to prune
    }
    try {
      await fs.rm(dirPath, { recursive: true, force: true });
      removed.push(dirName);
    } catch {
      // Best-effort cleanup; ignore per-directory failures.
    }
  }

  return removed;
}

/**
 * Legacy config file names from the old ToolRegistry.
 * These were config files created at project root with Rasen markers.
 */
export const LEGACY_CONFIG_FILES = [
  'CLAUDE.md',
  'CLINE.md',
  'CODEBUDDY.md',
  'COSTRICT.md',
  'QODER.md',
  'IFLOW.md',
  'AGENTS.md', // root AGENTS.md (not openspec/AGENTS.md)
  'QWEN.md',
] as const;

/**
 * Legacy slash command patterns from the old SlashCommandRegistry.
 * These map toolId to the path pattern where legacy commands were created.
 * Some tools used a directory structure, others used individual files.
 */
export const LEGACY_SLASH_COMMAND_PATHS: Record<string, LegacySlashCommandPattern> = {
  // Directory-based: .tooldir/commands/openspec/ or .tooldir/commands/openspec/*.md
  'claude': { type: 'directory', path: '.claude/commands/openspec' },
  'codebuddy': { type: 'directory', path: '.codebuddy/commands/openspec' },
  'qoder': { type: 'directory', path: '.qoder/commands/openspec' },
  'lingma': { type: 'directory', path: '.lingma/commands/openspec' },
  'crush': { type: 'directory', path: '.crush/commands/openspec' },
  'gemini': { type: 'directory', path: '.gemini/commands/openspec' },
  'costrict': { type: 'directory', path: '.cospec/openspec/commands' },

  // File-based: individual openspec-*.md files in a commands/workflows/prompts folder
  'cursor': { type: 'files', pattern: '.cursor/commands/openspec-*.md' },
  'windsurf': { type: 'files', pattern: '.windsurf/workflows/openspec-*.md' },
  'kilocode': { type: 'files', pattern: '.kilocode/workflows/openspec-*.md' },
  'kiro': { type: 'files', pattern: '.kiro/prompts/openspec-*.prompt.md' },
  'github-copilot': { type: 'files', pattern: '.github/prompts/openspec-*.prompt.md' },
  'amazon-q': { type: 'files', pattern: '.amazonq/prompts/openspec-*.md' },
  'cline': { type: 'files', pattern: '.clinerules/workflows/openspec-*.md' },
  'roocode': { type: 'files', pattern: '.roo/commands/openspec-*.md' },
  'auggie': { type: 'files', pattern: '.augment/commands/openspec-*.md' },
  'factory': { type: 'files', pattern: '.factory/commands/openspec-*.md' },
  'opencode': { type: 'files', pattern: ['.opencode/command/opsx-*.md', '.opencode/command/openspec-*.md'] },
  'continue': { type: 'files', pattern: '.continue/prompts/openspec-*.prompt' },
  'antigravity': { type: 'files', pattern: '.agent/workflows/openspec-*.md' },
  'iflow': { type: 'files', pattern: '.iflow/commands/openspec-*.md' },
  'junie': { type: 'files', pattern: ['.junie/commands/opsx-*.md', '.junie/commands/openspec-*.md'] },
  'qwen': { type: 'files', pattern: '.qwen/commands/openspec-*.toml' },
  'codex': { type: 'files', pattern: '.codex/prompts/openspec-*.md' },
};

/**
 * Pattern types for legacy slash commands
 */
export interface LegacySlashCommandPattern {
  type: 'directory' | 'files';
  path?: string; // For directory type
  pattern?: string | string[]; // For files type (glob pattern or array of patterns)
}

/**
 * Result of legacy artifact detection
 */
export interface LegacyDetectionResult {
  /** Config files with Rasen markers detected */
  configFiles: string[];
  /** Config files to update (remove markers only, never delete) */
  configFilesToUpdate: string[];
  /** Legacy slash command directories found */
  slashCommandDirs: string[];
  /** Legacy slash command files found (for file-based tools) */
  slashCommandFiles: string[];
  /** Whether openspec/AGENTS.md exists */
  hasOpenspecAgents: boolean;
  /** Whether openspec/project.md exists (preserved, migration hint only) */
  hasProjectMd: boolean;
  /** Whether root AGENTS.md has Rasen markers */
  hasRootAgentsWithMarkers: boolean;
  /** Whether any legacy artifacts were found */
  hasLegacyArtifacts: boolean;
}

/**
 * Detects all legacy Rasen artifacts in a project.
 *
 * @param projectPath - The root path of the project
 * @returns Detection result with all found legacy artifacts
 */
export async function detectLegacyArtifacts(
  projectPath: string
): Promise<LegacyDetectionResult> {
  const result: LegacyDetectionResult = {
    configFiles: [],
    configFilesToUpdate: [],
    slashCommandDirs: [],
    slashCommandFiles: [],
    hasOpenspecAgents: false,
    hasProjectMd: false,
    hasRootAgentsWithMarkers: false,
    hasLegacyArtifacts: false,
  };

  // Detect legacy config files
  const configResult = await detectLegacyConfigFiles(projectPath);
  result.configFiles = configResult.allFiles;
  result.configFilesToUpdate = configResult.filesToUpdate;

  // Detect legacy slash commands
  const slashResult = await detectLegacySlashCommands(projectPath);
  result.slashCommandDirs = slashResult.directories;
  result.slashCommandFiles = slashResult.files;

  // Detect legacy structure files
  const structureResult = await detectLegacyStructureFiles(projectPath);
  result.hasOpenspecAgents = structureResult.hasOpenspecAgents;
  result.hasProjectMd = structureResult.hasProjectMd;
  result.hasRootAgentsWithMarkers = structureResult.hasRootAgentsWithMarkers;

  // Determine if any legacy artifacts exist
  result.hasLegacyArtifacts =
    result.configFiles.length > 0 ||
    result.slashCommandDirs.length > 0 ||
    result.slashCommandFiles.length > 0 ||
    result.hasOpenspecAgents ||
    result.hasRootAgentsWithMarkers ||
    result.hasProjectMd;

  return result;
}

/**
 * Detects legacy config files with Rasen markers.
 * All config files with markers are candidates for update (marker removal only).
 * Config files are NEVER deleted - they belong to the user's project root.
 *
 * @param projectPath - The root path of the project
 * @returns Object with all files found and files to update
 */
export async function detectLegacyConfigFiles(
  projectPath: string
): Promise<{
  allFiles: string[];
  filesToUpdate: string[];
}> {
  const allFiles: string[] = [];
  const filesToUpdate: string[] = [];

  for (const fileName of LEGACY_CONFIG_FILES) {
    const filePath = FileSystemUtils.joinPath(projectPath, fileName);

    if (await FileSystemUtils.fileExists(filePath)) {
      const content = await FileSystemUtils.readFile(filePath);

      if (hasOpenSpecMarkers(content)) {
        allFiles.push(fileName);
        filesToUpdate.push(fileName); // Always update, never delete config files
      }
    }
  }

  return { allFiles, filesToUpdate };
}

/**
 * Detects legacy slash command directories and files.
 *
 * @param projectPath - The root path of the project
 * @returns Object with directories and individual files found
 */
export async function detectLegacySlashCommands(
  projectPath: string
): Promise<{
  directories: string[];
  files: string[];
}> {
  const directories: string[] = [];
  const files: string[] = [];

  for (const [toolId, pattern] of Object.entries(LEGACY_SLASH_COMMAND_PATHS)) {
    if (pattern.type === 'directory' && pattern.path) {
      const dirPath = FileSystemUtils.joinPath(projectPath, pattern.path);
      if (await FileSystemUtils.directoryExists(dirPath)) {
        directories.push(pattern.path);
      }
    } else if (pattern.type === 'files' && pattern.pattern) {
      // For file-based patterns, check for individual files
      const patterns = Array.isArray(pattern.pattern) ? pattern.pattern : [pattern.pattern];
      for (const p of patterns) {
        const foundFiles = await findLegacySlashCommandFiles(projectPath, p);
        files.push(...foundFiles);
      }
    }
  }

  return { directories, files };
}

/**
 * Finds legacy slash command files matching a glob pattern.
 *
 * @param projectPath - The root path of the project
 * @param pattern - Glob pattern like '.cursor/commands/openspec-*.md'
 * @returns Array of matching file paths relative to projectPath
 */
async function findLegacySlashCommandFiles(
  projectPath: string,
  pattern: string
): Promise<string[]> {
  const foundFiles: string[] = [];

  // Extract directory and file pattern from glob
  // Handle both forward and backward slashes for Windows compatibility
  const lastForwardSlash = pattern.lastIndexOf('/');
  const lastBackSlash = pattern.lastIndexOf('\\');
  const lastSeparator = Math.max(lastForwardSlash, lastBackSlash);
  const dirPart = pattern.substring(0, lastSeparator);
  const filePart = pattern.substring(lastSeparator + 1);

  const dirPath = FileSystemUtils.joinPath(projectPath, dirPart);

  if (!(await FileSystemUtils.directoryExists(dirPath))) {
    return foundFiles;
  }

  try {
    const entries = await fs.readdir(dirPath);

    // Convert glob pattern to regex
    // openspec-*.md -> /^openspec-.*\.md$/
    // openspec-*.prompt.md -> /^openspec-.*\.prompt\.md$/
    // openspec-*.toml -> /^openspec-.*\.toml$/
    const regexPattern = filePart
      .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape regex special chars except *
      .replace(/\*/g, '.*'); // Replace * with .*
    const regex = new RegExp(`^${regexPattern}$`);

    for (const entry of entries) {
      if (regex.test(entry)) {
        // Use forward slashes for consistency in relative paths (cross-platform)
        const normalizedDir = dirPart.replace(/\\/g, '/');
        foundFiles.push(`${normalizedDir}/${entry}`);
      }
    }
  } catch {
    // Directory doesn't exist or can't be read
  }

  return foundFiles;
}

/**
 * Detects legacy Rasen structure files (AGENTS.md and project.md).
 *
 * @param projectPath - The root path of the project
 * @returns Object with detection results for structure files
 */
export async function detectLegacyStructureFiles(
  projectPath: string
): Promise<{
  hasOpenspecAgents: boolean;
  hasProjectMd: boolean;
  hasRootAgentsWithMarkers: boolean;
}> {
  let hasOpenspecAgents = false;
  let hasProjectMd = false;
  let hasRootAgentsWithMarkers = false;

  // Check for openspec/AGENTS.md
  const openspecAgentsPath = FileSystemUtils.joinPath(projectPath, 'openspec', 'AGENTS.md');
  hasOpenspecAgents = await FileSystemUtils.fileExists(openspecAgentsPath);

  // Check for openspec/project.md (for migration messaging, not deleted)
  const projectMdPath = FileSystemUtils.joinPath(projectPath, 'openspec', 'project.md');
  hasProjectMd = await FileSystemUtils.fileExists(projectMdPath);

  // Check for root AGENTS.md with Rasen markers
  const rootAgentsPath = FileSystemUtils.joinPath(projectPath, 'AGENTS.md');
  if (await FileSystemUtils.fileExists(rootAgentsPath)) {
    const content = await FileSystemUtils.readFile(rootAgentsPath);
    hasRootAgentsWithMarkers = hasOpenSpecMarkers(content);
  }

  return { hasOpenspecAgents, hasProjectMd, hasRootAgentsWithMarkers };
}

/**
 * Checks if content contains Rasen markers.
 *
 * @param content - File content to check
 * @returns True if both start and end markers are present
 */
export function hasOpenSpecMarkers(content: string): boolean {
  return (
    content.includes(OPENSPEC_MARKERS.start) && content.includes(OPENSPEC_MARKERS.end)
  );
}

/**
 * Checks if file content is 100% Rasen content (only markers and whitespace outside).
 *
 * @param content - File content to check
 * @returns True if content outside markers is only whitespace
 */
export function isOnlyOpenSpecContent(content: string): boolean {
  const startIndex = content.indexOf(OPENSPEC_MARKERS.start);
  const endIndex = content.indexOf(OPENSPEC_MARKERS.end);

  if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
    return false;
  }

  const before = content.substring(0, startIndex);
  const after = content.substring(endIndex + OPENSPEC_MARKERS.end.length);

  return before.trim() === '' && after.trim() === '';
}

/**
 * Removes the Rasen marker block from file content.
 * Only removes markers that are on their own lines (ignores inline mentions).
 * Cleans up double blank lines that may result from removal.
 *
 * @param content - File content with Rasen markers
 * @returns Content with marker block removed
 */
export function removeMarkerBlock(content: string): string {
  return removeMarkerBlockUtil(content, OPENSPEC_MARKERS.start, OPENSPEC_MARKERS.end);
}

/**
 * Removes ONLY the marker blocks from shared config files — never deletes or
 * touches command directories, command files, skill directories, or
 * openspec/AGENTS.md. This is the narrow, consent-gated cleanup invoked inside
 * the `rasen migrate` flow (default: keep). In coexistence, a marker block in a
 * shared config file (e.g. root AGENTS.md) may be upstream OpenSpec's ACTIVE
 * configuration, so removal only happens when the user explicitly confirms it.
 *
 * @param projectPath - The root path of the project
 * @param detection - Detection result from detectLegacyArtifacts
 * @returns The relative paths of config files whose marker block was removed
 */
export async function cleanupMarkerBlocks(
  projectPath: string,
  detection: LegacyDetectionResult
): Promise<{ modifiedFiles: string[]; errors: string[] }> {
  const modifiedFiles: string[] = [];
  const errors: string[] = [];

  for (const fileName of detection.configFilesToUpdate) {
    const filePath = FileSystemUtils.joinPath(projectPath, fileName);
    try {
      const content = await FileSystemUtils.readFile(filePath);
      const newContent = removeMarkerBlock(content);
      // Never delete user config files — always write back, even if now empty.
      await FileSystemUtils.writeFile(filePath, newContent);
      modifiedFiles.push(fileName);
    } catch (error: any) {
      errors.push(`Failed to modify ${fileName}: ${error.message}`);
    }
  }

  return { modifiedFiles, errors };
}

/**
 * Formats the one-time coexistence notice printed by `rasen init`/`rasen update`
 * when legacy-namespace artifacts are detected. Unlike the upgrade flow, this
 * notice NEVER removes anything: the artifacts may belong to upstream OpenSpec
 * or an older rasen install, so removal is left to the user (or the explicit
 * `rasen migrate` flow for marker blocks).
 *
 * Returns an empty string when there is nothing worth reporting.
 */
export function formatLegacyCoexistenceNotice(detection: LegacyDetectionResult): string {
  const hasCommandArtifacts =
    detection.slashCommandDirs.length > 0 ||
    detection.slashCommandFiles.length > 0 ||
    detection.hasOpenspecAgents;
  const hasMarkerConfigs = detection.configFilesToUpdate.length > 0;

  if (!hasCommandArtifacts && !hasMarkerConfigs) {
    return '';
  }

  const lines: string[] = [];
  lines.push(chalk.bold('Legacy OpenSpec-namespace artifacts detected'));
  lines.push(
    chalk.dim(
      'These may belong to upstream OpenSpec or an older rasen install. rasen'
    )
  );
  lines.push(chalk.dim('leaves them untouched — remove them manually only if they came from'));
  lines.push(chalk.dim('an older rasen install and you no longer need them.'));

  if (hasCommandArtifacts) {
    lines.push('');
    for (const dir of detection.slashCommandDirs) {
      lines.push(`  • ${dir}/`);
    }
    for (const file of detection.slashCommandFiles) {
      lines.push(`  • ${file}`);
    }
    if (detection.hasOpenspecAgents) {
      lines.push('  • openspec/AGENTS.md');
    }
  }

  if (hasMarkerConfigs) {
    lines.push('');
    lines.push(
      chalk.dim('Shared config files carry OpenSpec marker blocks (kept as-is):')
    );
    for (const file of detection.configFilesToUpdate) {
      lines.push(`  • ${file}`);
    }
    lines.push(
      chalk.dim('Run "rasen migrate" to copy the workspace and optionally remove them.')
    );
  }

  return lines.join('\n');
}

/**
 * Extract tool IDs from detected legacy artifacts.
 * Uses LEGACY_SLASH_COMMAND_PATHS to map paths back to tool IDs.
 *
 * @param detection - Detection result from detectLegacyArtifacts
 * @returns Array of tool IDs that had legacy artifacts
 */
export function getToolsFromLegacyArtifacts(detection: LegacyDetectionResult): string[] {
  const tools = new Set<string>();

  // Match directories to tool IDs
  for (const dir of detection.slashCommandDirs) {
    for (const [toolId, pattern] of Object.entries(LEGACY_SLASH_COMMAND_PATHS)) {
      if (pattern.type === 'directory' && pattern.path === dir) {
        tools.add(toolId);
        break;
      }
    }
  }

  // Match files to tool IDs using glob patterns
  for (const file of detection.slashCommandFiles) {
    // Normalize file path to use forward slashes for consistent matching (Windows compatibility)
    const normalizedFile = file.replace(/\\/g, '/');
    for (const [toolId, pattern] of Object.entries(LEGACY_SLASH_COMMAND_PATHS)) {
      if (pattern.type === 'files' && pattern.pattern) {
        // Convert glob pattern to regex for matching
        // e.g., '.cursor/commands/openspec-*.md' -> /^\.cursor\/commands\/openspec-.*\.md$/
        const patterns = Array.isArray(pattern.pattern) ? pattern.pattern : [pattern.pattern];
        let matched = false;
        for (const p of patterns) {
          const regexPattern = p
            .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape regex special chars except *
            .replace(/\*/g, '.*'); // Replace * with .*
          const regex = new RegExp(`^${regexPattern}$`);
          if (regex.test(normalizedFile)) {
            tools.add(toolId);
            matched = true;
            break;
          }
        }
        if (matched) break;
      }
    }
  }

  return Array.from(tools);
}

/**
 * Generates a migration hint message for project.md.
 * This is shown when project.md exists and needs manual migration to config.yaml.
 *
 * @returns Formatted migration hint string for console output
 */
export function formatProjectMdMigrationHint(): string {
  const lines: string[] = [];
  lines.push(chalk.yellow.bold('Needs your attention'));
  lines.push('  • openspec/project.md');
  lines.push(chalk.dim('    We won\'t delete this file. It may contain useful project context.'));
  lines.push('');
  lines.push(chalk.dim('    The new openspec/config.yaml has a "context:" section for planning'));
  lines.push(chalk.dim('    context. This is included in every Rasen request and works more'));
  lines.push(chalk.dim('    reliably than the old project.md approach.'));
  lines.push('');
  lines.push(chalk.dim('    Review project.md, move any useful content to config.yaml\'s context'));
  lines.push(chalk.dim('    section, then delete the file when ready.'));
  return lines.join('\n');
}
