/**
 * Update Command
 *
 * Refreshes Rasen skills and commands for configured tools.
 * Supports profile-aware updates, delivery changes, migration, and smart update detection.
 */

import path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import * as fs from 'fs';
import { createRequire } from 'module';
import { FileSystemUtils } from '../utils/file-system.js';
import { ensureClaudeAgentTeams } from './claude-settings.js';
import { transformToHyphenCommands } from '../utils/command-references.js';
import { AI_TOOLS, OPENSPEC_DIR_NAME } from './config.js';
import {
  getAllRetiredCommandFilePathCandidates,
  getCommandFilePathCandidates,
} from './shared/retired-command-paths.js';
import {
  getToolVersionStatus,
  getSkillTemplates,
  generateSkillContent,
  copySkillSidecars,
  getToolsWithSkillsDir,
  resolveToolSkillsRoot,
  type ToolVersionStatus,
} from './shared/index.js';
import {
  detectLegacyArtifacts,
  formatLegacyCoexistenceNotice,
  pruneRetiredExpertSkillDirs,
  pruneRetiredWorkflowSkillDirs,
  RETIRED_WORKFLOW_COMMAND_IDS,
} from './legacy-cleanup.js';
import { hasLegacyWorkspace } from './workspace-migration.js';
import { getGlobalConfig, saveGlobalConfig, type GlobalConfig, type Profile, type RepoMode } from './global-config.js';
import { getCurrentBuiltInWorkflowIds, resolveProjectWorkflowSelection } from './profiles.js';
import { reportConfigDiagnostic } from './config-diagnostics.js';
import { createConfigDiagnosticReporter } from './config-diagnostic-locale.js';
import { resolveProjectHome } from './project-home.js';
import { hasExpertSelectionAck, writeExpertSelectionAck } from './expert-selection-state.js';
import {
  getBuiltInCatalogDefinitions,
  loadWorkflowCatalog,
} from './workflow-registry/index.js';
import { syncWorkflowArtifactLedger } from './workflow-artifact-ledger.js';
import { getAvailableTools } from './available-tools.js';
import {
  getConfiguredToolsForProfileSync,
  getToolsNeedingProfileSync,
} from './profile-sync-drift.js';
import {
  scanInstalledWorkflows as scanInstalledWorkflowsShared,
  migrateIfNeeded as migrateIfNeededShared,
} from './migration.js';

const require = createRequire(import.meta.url);
const { version: OPENSPEC_VERSION } = require('../../package.json');
const OLD_CORE_WORKFLOWS = ['propose', 'explore', 'apply', 'archive'] as const;

/**
 * Returns tools that have at least one pre-retirement rasen command file on
 * disk (via the frozen static path knowledge), so a project whose only
 * artifact for a tool predates the command-surface retirement is still
 * recognized as configured — update then cleans up its command files and
 * installs skills, rather than treating it as unconfigured.
 */
function getCommandConfiguredTools(projectPath: string): string[] {
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
    .filter((toolId) =>
      getAllRetiredCommandFilePathCandidates(toolId).some((cmdPath) => {
        const fullPath = path.isAbsolute(cmdPath) ? cmdPath : path.join(projectPath, cmdPath);
        return fs.existsSync(fullPath);
      })
    );
}

/**
 * Options for the update command.
 */
export interface UpdateCommandOptions {
  /** Force update even when tools are up to date */
  force?: boolean;
}

/**
 * Scans installed workflow artifacts (skills and managed commands) across all configured tools.
 * Returns the union of detected workflow IDs that match ALL_WORKFLOWS.
 *
 * Wrapper around the shared migration module's scanInstalledWorkflows that accepts tool IDs.
 */
export function scanInstalledWorkflows(projectPath: string, toolIds: string[]): string[] {
  const tools = toolIds
    .map((id) => AI_TOOLS.find((t) => t.value === id))
    .filter((t): t is NonNullable<typeof t> => t != null);
  return scanInstalledWorkflowsShared(projectPath, tools);
}

export class UpdateCommand {
  private readonly force: boolean;

  constructor(options: UpdateCommandOptions = {}) {
    this.force = options.force ?? false;
  }

  async execute(projectPath: string): Promise<void> {
    const resolvedProjectPath = path.resolve(projectPath);
    const openspecPath = path.join(resolvedProjectPath, OPENSPEC_DIR_NAME);

    // 1. Require a rasen/ workspace. A legacy-only project (openspec/ but no
    // rasen/) is pointed at migration and left untouched; anything else is an
    // uninitialized project.
    if (!await FileSystemUtils.directoryExists(openspecPath)) {
      if (hasLegacyWorkspace(resolvedProjectPath)) {
        throw new Error(
          'A legacy openspec/ workspace was found but no rasen/ workspace. ' +
            'Run "rasen migrate" to copy it (copy-only; openspec/ is left untouched), or "rasen init" to start fresh.'
        );
      }
      throw new Error("No rasen project found. Run 'rasen init' to set up.");
    }

    // 2. Perform one-time migration if needed before any legacy upgrade generation.
    // Use detected tool directories to preserve existing opsx skills/commands.
    const detectedTools = getAvailableTools(resolvedProjectPath);
    migrateIfNeededShared(resolvedProjectPath, detectedTools);

    // 3. Read global config for profile
    const globalConfig = getGlobalConfig();
    const profile = globalConfig.profile ?? 'full';

    // The machine-wide marker can flip to `true` from an action against a
    // completely different project (review-round Blocker fix). Expert
    // pruning below is additionally gated on THIS project's own
    // acknowledgment file (expert-selection-state.ts): a project that has
    // never been through its own transition keeps resolving the legacy
    // (all-experts) branch regardless of the global marker, so it can never
    // lose an installed expert as a side effect of what happened elsewhere.
    const globalMarkerExplicit = globalConfig.expertSelectionExplicit === true;
    let projectHome: Awaited<ReturnType<typeof resolveProjectHome>> = null;
    try {
      projectHome = await resolveProjectHome(resolvedProjectPath, { ensure: false });
    } catch {
      projectHome = null;
    }
    const projectAcknowledged = projectHome !== null && hasExpertSelectionAck(projectHome.homeDir);
    const expertSelectionExplicit = globalMarkerExplicit && projectAcknowledged;

    if (globalMarkerExplicit && !projectAcknowledged) {
      // First post-flip update for this specific project: stay on the safe
      // legacy branch this run (handled by `expertSelectionExplicit` above
      // being `false`), and record the acknowledgment so the *next* update
      // on this same project is the one that applies profile-default
      // narrowing.
      try {
        const home = projectHome ?? (await resolveProjectHome(resolvedProjectPath, { ensure: true }));
        if (home) writeExpertSelectionAck(home.homeDir);
      } catch {
        // Best-effort; a failed write just means this project re-evaluates
        // from the same safe starting point on its next update.
      }
    }

    const catalog = loadWorkflowCatalog();
    const {
      ids: desiredWorkflows,
      unknown: unknownProfileWorkflows,
      mode: selectionMode,
    } = resolveProjectWorkflowSelection(
      catalog,
      resolvedProjectPath,
      profile,
      globalConfig.workflows,
      expertSelectionExplicit
    );
    if (selectionMode === 'override') {
      console.log(
        chalk.dim('Note: this space uses its own workflow selection (project override), not the user-wide profile.')
      );
    }
    if (unknownProfileWorkflows.length > 0) {
      console.log(
        chalk.yellow(
          `Warning: dropping unknown workflow id(s) from stored profile: ${unknownProfileWorkflows.join(', ')}`
        )
      );
    }
    // Surface built-in workflows the catalog gained after this selection was
    // last saved (frozen `custom`/override selections lag; `full`/`core`
    // resolve against the live catalog and never lag). Runs before the
    // up-to-date short-circuit so an upgrade that adds a workflow is honest
    // even when no tool otherwise needs an update. Never rewrites the stored
    // selection.
    this.surfaceNewBuiltInWorkflows(globalConfig, desiredWorkflows);

    const proactive = globalConfig.proactive ?? true;
    const repoMode: RepoMode = globalConfig.repoMode ?? 'collaborative';

    // One-time (per run) non-regressive migration notice (design.md D4): an
    // install that predates expert selection resolves ALL 21 experts under
    // the legacy branch above, profile-independent — this only explains the
    // shift, it never narrows the install itself. `update` never sets the
    // marker; only the profile picker/`profile use`/`profile new`/`import`
    // and a fresh `init` do, so this notice keeps firing on every legacy
    // `update` until the user explicitly re-selects experts.
    if (!expertSelectionExplicit) {
      reportConfigDiagnostic(
        {
          key: 'expertSelectionMigration',
          fallback:
            "Note: experts are now individually selectable. All previously installed experts are kept for now — run `rasen profile` to choose which ones to install.",
          output: 'warn',
        },
        createConfigDiagnosticReporter()
      );
    }

    // 4. Report (never remove or rewrite) legacy-namespace artifacts. update
    // refreshes only rasen-namespace artifacts; upstream/older-rasen `opsx`
    // command files and `openspec-*` skill dirs are left untouched (D4).
    await this.noticeLegacyArtifacts(resolvedProjectPath);

    // 5. Find configured tools. Union in tools configured only via a
    // pre-retirement command file (skills-based detection alone would miss
    // a commands-only install) so it is still recognized and its stale
    // command files cleaned up rather than treated as unconfigured.
    const commandConfiguredTools = getCommandConfiguredTools(resolvedProjectPath);
    const commandConfiguredSet = new Set(commandConfiguredTools);
    const configuredTools = [
      ...new Set([...getConfiguredToolsForProfileSync(resolvedProjectPath), ...commandConfiguredTools]),
    ];

    if (configuredTools.length === 0) {
      console.log(chalk.yellow('No configured tools found.'));
      console.log(chalk.dim('Run "rasen init" to set up tools.'));
      return;
    }

    // 6. Check version status for all configured tools
    const toolStatuses = configuredTools.map((toolId) => {
      const status = getToolVersionStatus(resolvedProjectPath, toolId, OPENSPEC_VERSION);
      if (!status.configured && commandConfiguredSet.has(toolId)) {
        return { ...status, configured: true };
      }
      return status;
    });
    const statusByTool = new Map(toolStatuses.map((status) => [status.toolId, status] as const));

    // 7. Smart update detection
    const toolsNeedingVersionUpdate = toolStatuses
      .filter((s) => s.needsUpdate)
      .map((s) => s.toolId);
    const toolsNeedingConfigSync = getToolsNeedingProfileSync(
      resolvedProjectPath,
      desiredWorkflows,
      configuredTools
    );
    const toolsToUpdateSet = new Set<string>([
      ...toolsNeedingVersionUpdate,
      ...toolsNeedingConfigSync,
    ]);
    const toolsUpToDate = toolStatuses.filter((s) => !toolsToUpdateSet.has(s.toolId));

    // Prune expert-skill dirs orphaned by the rebrand (openspec-gstack-* →
    // openspec-*), skill/command artifacts left behind by retired built-in
    // workflows (e.g. `ff` → `rasen-ff-change`), AND any rasen command file
    // (the whole command surface is retired) for every configured tool,
    // before the up-to-date short-circuit. Installed artifacts are not
    // renamed or removed in place, and retired/stale artifacts are always
    // stale, so this must run even when no tool otherwise needs an update.
    let removedCommandCount = 0;
    for (const toolId of configuredTools) {
      const tool = AI_TOOLS.find((t) => t.value === toolId);
      if (!tool?.skillsDir) continue;
      await pruneRetiredExpertSkillDirs(resolveToolSkillsRoot(tool, resolvedProjectPath));
      await pruneRetiredWorkflowSkillDirs(resolveToolSkillsRoot(tool, resolvedProjectPath));
      await this.pruneRetiredWorkflowCommandFiles(resolvedProjectPath, toolId);
      removedCommandCount += await this.removeCommandFiles(resolvedProjectPath, toolId);
    }
    if (removedCommandCount > 0) {
      console.log(chalk.dim(`Removed: ${removedCommandCount} command files (commands have been consolidated into skills)`));
    }

    if (!this.force && toolsToUpdateSet.size === 0) {
      // All tools are up to date
      this.displayUpToDateMessage(toolStatuses);

      // Still check for new tool directories and extra workflows
      this.detectNewTools(resolvedProjectPath, configuredTools);
      this.displayExtraWorkflowsNote(resolvedProjectPath, configuredTools, desiredWorkflows);
      this.displayOldCoreCustomProfileNote(profile, globalConfig.workflows);
      return;
    }

    // 8. Display update plan
    if (this.force) {
      console.log(`Force updating ${configuredTools.length} tool(s): ${configuredTools.join(', ')}`);
    } else {
      this.displayUpdatePlan([...toolsToUpdateSet], statusByTool, toolsUpToDate);
    }
    console.log();

    // 9. Skills are the only delivery surface now.
    const skillTemplates = getSkillTemplates(desiredWorkflows);

    // 10. Update tools (all if force, otherwise only those needing update)
    const toolsToUpdate = this.force ? configuredTools : [...toolsToUpdateSet];
    const updatedTools: string[] = [];
    const failedTools: Array<{ name: string; error: string }> = [];
    let removedDeselectedSkillCount = 0;

    for (const toolId of toolsToUpdate) {
      const tool = AI_TOOLS.find((t) => t.value === toolId);
      if (!tool?.skillsDir) continue;

      const spinner = ora(`Updating ${tool.name}...`).start();

      try {
        const skillsDir = resolveToolSkillsRoot(tool, resolvedProjectPath);

        // Generate skill files (always installed regardless of delivery)
        for (const { template, dirName, workflowId, escapeFrontmatter } of skillTemplates) {
          const skillDir = path.join(skillsDir, dirName);
          const skillFile = path.join(skillDir, 'SKILL.md');

          // Chain transformers: embed config values, then tool-specific transforms
          // (hyphen-based command references for OpenCode), mirroring init.
          const configTransform = (text: string) => text
            .replace(/__OPENSPEC_PROACTIVE__/g, String(proactive))
            .replace(/__OPENSPEC_REPO_MODE__/g, repoMode);
          const toolTransform = (tool.value === 'opencode' || tool.value === 'pi') ? transformToHyphenCommands : undefined;
          const transformer = toolTransform
            ? (text: string) => toolTransform(configTransform(text))
            : configTransform;
          const skillContent = generateSkillContent(
            template,
            OPENSPEC_VERSION,
            transformer,
            escapeFrontmatter
          );
          await FileSystemUtils.writeFile(skillFile, skillContent);

          // Copy the skill's sidecar reference files so its relative-path
          // references resolve at the install target (idempotent overwrite).
          copySkillSidecars(workflowId, skillDir);
        }

        removedDeselectedSkillCount += await this.removeUnselectedSkillDirs(skillsDir, desiredWorkflows);

        syncWorkflowArtifactLedger(resolvedProjectPath, toolId, desiredWorkflows);

        // Claude Code: enable agent-teams (Tier A orchestration) in project settings.
        if (tool.value === 'claude') {
          ensureClaudeAgentTeams(resolvedProjectPath, tool.skillsDir);
        }

        spinner.succeed(`Updated ${tool.name}`);
        updatedTools.push(tool.name);
      } catch (error) {
        spinner.fail(`Failed to update ${tool.name}`);
        failedTools.push({
          name: tool.name,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    // 11. Summary
    console.log();
    if (updatedTools.length > 0) {
      console.log(chalk.green(`✓ Updated: ${updatedTools.join(', ')} (v${OPENSPEC_VERSION})`));
    }
    if (failedTools.length > 0) {
      console.log(chalk.red(`✗ Failed: ${failedTools.map(f => `${f.name} (${f.error})`).join(', ')}`));
    }
    if (removedDeselectedSkillCount > 0) {
      console.log(chalk.dim(`Removed: ${removedDeselectedSkillCount} skill directories (deselected workflows)`));
    }

    // 12. Detect new tool directories not currently configured
    this.detectNewTools(resolvedProjectPath, configuredTools);

    // 13. Display note about extra workflows not in profile
    this.displayExtraWorkflowsNote(resolvedProjectPath, configuredTools, desiredWorkflows);
    this.displayOldCoreCustomProfileNote(profile, globalConfig.workflows);

    // 15. List affected tools
    if (updatedTools.length > 0) {
      const toolDisplayNames = updatedTools;
      console.log(chalk.dim(`Tools: ${toolDisplayNames.join(', ')}`));
    }

    console.log();
    console.log(chalk.dim('Restart your IDE for changes to take effect.'));
  }

  /**
   * Display message when all tools are up to date.
   */
  private displayUpToDateMessage(toolStatuses: ToolVersionStatus[]): void {
    const toolNames = toolStatuses.map((s) => s.toolId);
    console.log(chalk.green(`✓ All ${toolStatuses.length} tool(s) up to date (v${OPENSPEC_VERSION})`));
    console.log(chalk.dim(`  Tools: ${toolNames.join(', ')}`));
    console.log();
    console.log(chalk.dim('Use --force to refresh files anyway.'));
  }

  /**
   * Display the update plan showing which tools need updating.
   */
  private displayUpdatePlan(
    toolsToUpdate: string[],
    statusByTool: Map<string, ToolVersionStatus>,
    upToDate: ToolVersionStatus[]
  ): void {
    const updates = toolsToUpdate.map((toolId) => {
      const status = statusByTool.get(toolId);
      if (status?.needsUpdate) {
        const fromVersion = status.generatedByVersion ?? 'unknown';
        return `${status.toolId} (${fromVersion} → ${OPENSPEC_VERSION})`;
      }
      return `${toolId} (config sync)`;
    });

    console.log(`Updating ${toolsToUpdate.length} tool(s): ${updates.join(', ')}`);

    if (upToDate.length > 0) {
      const upToDateNames = upToDate.map((s) => s.toolId);
      console.log(chalk.dim(`Already up to date: ${upToDateNames.join(', ')}`));
    }
  }

  /**
   * Detects new tool directories that aren't currently configured and displays a hint.
   */
  private detectNewTools(projectPath: string, configuredTools: string[]): void {
    const availableTools = getAvailableTools(projectPath);
    const configuredSet = new Set(configuredTools);

    const newTools = availableTools.filter((t) => !configuredSet.has(t.value) && t.adapted);

    if (newTools.length > 0) {
      const newToolNames = newTools.map((tool) => tool.name);
      const isSingleTool = newToolNames.length === 1;
      const toolNoun = isSingleTool ? 'tool' : 'tools';
      const pronoun = isSingleTool ? 'it' : 'them';
      console.log();
      console.log(
        chalk.yellow(
          `Detected new ${toolNoun}: ${newToolNames.join(', ')}. Run 'rasen init' to add ${pronoun}.`
        )
      );
    }
  }

  /**
   * Displays a note about extra workflows installed that aren't in the current profile.
   */
  private displayExtraWorkflowsNote(
    projectPath: string,
    configuredTools: string[],
    profileWorkflows: readonly string[]
  ): void {
    const installedWorkflows = scanInstalledWorkflows(projectPath, configuredTools);
    const profileSet = new Set(profileWorkflows);
    const extraWorkflows = installedWorkflows.filter((w) => !profileSet.has(w));

    if (extraWorkflows.length > 0) {
      console.log(chalk.dim(`Note: ${extraWorkflows.length} extra workflows not in profile (use \`rasen profile\` to manage)`));
    }
  }

  /**
   * Suggest opting back into core when a custom profile still matches the old
   * pre-sync core set. Keep custom profiles user-owned; do not mutate them.
   */
  private displayOldCoreCustomProfileNote(profile: Profile, workflows?: readonly string[]): void {
    if (profile !== 'custom' || !workflows) {
      return;
    }

    const workflowSet = new Set(workflows);
    const matchesOldCore =
      workflowSet.size === OLD_CORE_WORKFLOWS.length &&
      OLD_CORE_WORKFLOWS.every((workflow) => workflowSet.has(workflow));

    if (!matchesOldCore) {
      return;
    }

    console.log(chalk.dim('Note: The core profile now includes sync. Your custom profile is preserving the old core workflow set.'));
    console.log(chalk.dim('Run `rasen profile use core` and then `rasen update` to add sync.'));
  }

  /**
   * Surfaces built-in workflows that are in the current catalog but absent
   * from the resolved desired set because they were added after the stored
   * selection was last saved — the honest-upgrade note (design.md D1/D2).
   * Distinguishes a genuinely new workflow from a deliberate deselection via
   * the `knownBuiltInWorkflows` baseline: only built-ins absent from that
   * baseline are surfaced. A legacy config lacking the baseline is seeded
   * silently on this run (no note), so no pre-existing omission is surprised
   * onto the user. `full`/`core` selections already contain every built-in,
   * so `surface` is naturally empty for them. Never mutates the stored
   * selection — only the machine-managed baseline field.
   */
  private surfaceNewBuiltInWorkflows(
    globalConfig: GlobalConfig,
    desiredWorkflows: readonly string[]
  ): void {
    const currentBuiltInIds = getCurrentBuiltInWorkflowIds();
    const baseline = globalConfig.knownBuiltInWorkflows;

    if (baseline === undefined) {
      // First `update` on a config that predates this behavior: record the
      // currently-known built-ins without surfacing anything this run.
      try {
        saveGlobalConfig({ ...globalConfig, knownBuiltInWorkflows: currentBuiltInIds });
      } catch {
        // Best-effort: a failed seed just means this repeats next run (still
        // no surprise, since the same seed-then-quiet path re-runs).
      }
      return;
    }

    const baselineSet = new Set(baseline);
    const desiredSet = new Set(desiredWorkflows);
    const surface = currentBuiltInIds.filter(
      (id) => !baselineSet.has(id) && !desiredSet.has(id)
    );
    if (surface.length === 0) return;

    reportConfigDiagnostic(
      {
        key: 'newBuiltInWorkflowsAvailable',
        values: { workflows: surface.join(', ') },
        fallback: `Note: new built-in workflow(s) available that your selection does not include: ${surface.join(
          ', '
        )}. Run \`rasen profile\` to add ${surface.length === 1 ? 'it' : 'them'}.`,
        output: 'warn',
      },
      createConfigDiagnosticReporter()
    );
  }

  /**
   * Removes skill directories for built-in workflows OR experts that are no
   * longer in the resolved desired set (D5: iterates
   * `getBuiltInCatalogDefinitions()`, not the workflow-only
   * `getBuiltInWorkflowDefinitions()`, so a deselected-and-unreferenced
   * expert is pruned the same way a deselected workflow is). `desiredWorkflows`
   * already includes every profile-default and closure-required expert (and,
   * under the legacy migration marker, all 21), so a protected expert is
   * never removed here.
   * Returns the number of directories removed.
   */
  private async removeUnselectedSkillDirs(
    skillsDir: string,
    desiredWorkflows: readonly string[]
  ): Promise<number> {
    const desiredSet = new Set(desiredWorkflows);
    let removed = 0;

    for (const definition of getBuiltInCatalogDefinitions()) {
      if (desiredSet.has(definition.id)) continue;
      const dirName = definition.skill.dirName;
      if (!dirName) continue;

      const skillDir = path.join(skillsDir, dirName);
      try {
        if (fs.existsSync(skillDir)) {
          await fs.promises.rm(skillDir, { recursive: true, force: true });
          removed++;
        }
      } catch {
        // Ignore errors
      }
    }

    return removed;
  }

  /**
   * Removes command files left behind by retired built-in workflows (e.g.
   * `ff`), resolving candidate paths for each id in
   * `RETIRED_WORKFLOW_COMMAND_IDS` via the frozen static path knowledge.
   * Scoped to exactly those ids; idempotent (a no-op when no such file
   * exists).
   */
  private async pruneRetiredWorkflowCommandFiles(
    projectPath: string,
    toolId: string,
  ): Promise<number> {
    let removed = 0;

    for (const commandId of RETIRED_WORKFLOW_COMMAND_IDS) {
      for (const cmdPath of getCommandFilePathCandidates(toolId, commandId)) {
        const fullPath = path.isAbsolute(cmdPath) ? cmdPath : path.join(projectPath, cmdPath);

        try {
          if (fs.existsSync(fullPath)) {
            await fs.promises.unlink(fullPath);
            removed++;
          }
        } catch {
          // Ignore errors
        }
      }
    }

    return removed;
  }

  /**
   * Unconditionally removes every rasen command file for a tool — all 19
   * built-in command ids plus their `-command`/`opsx` legacy path variants
   * — using only the frozen static path knowledge (D2/D3: never the deleted
   * live command-generation registry, and never gated on workflow
   * selection since commands no longer exist to select). Merges the former
   * delivery-gated `removeCommandFiles` and selection-gated
   * `removeUnselectedCommandFiles` into one unconditional cleanup. Returns
   * the number of files removed.
   */
  private async removeCommandFiles(
    projectPath: string,
    toolId: string,
  ): Promise<number> {
    let removed = 0;

    for (const cmdPath of getAllRetiredCommandFilePathCandidates(toolId)) {
      const fullPath = path.isAbsolute(cmdPath) ? cmdPath : path.join(projectPath, cmdPath);

      try {
        if (fs.existsSync(fullPath)) {
          await fs.promises.unlink(fullPath);
          removed++;
        }
      } catch {
        // Ignore errors
      }
    }

    return removed;
  }

  /**
   * Prints a one-time coexistence notice when legacy-namespace command/skill
   * artifacts or shared-config marker blocks are detected. Never removes,
   * rewrites, or refreshes them: they may belong to upstream OpenSpec or an
   * older rasen install (D4). update only refreshes rasen-namespace artifacts.
   */
  private async noticeLegacyArtifacts(projectPath: string): Promise<void> {
    const detection = await detectLegacyArtifacts(projectPath);
    const notice = formatLegacyCoexistenceNotice(detection);
    if (!notice) return;
    console.log();
    console.log(notice);
    console.log();
  }
}
