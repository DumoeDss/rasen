/**
 * Init Command
 *
 * Sets up Rasen with Agent Skills and /rasen:* slash commands.
 * This is the unified setup command that replaces both the old init and experimental commands.
 */

import path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import * as fs from 'fs';
import { createRequire } from 'module';
import { FileSystemUtils } from '../utils/file-system.js';
import { classifyOpenSpecDir, storePointerProblem } from './project-config.js';
import { resolveProjectHome } from './project-home.js';
import { findRepoPlanningRootSync } from './planning-home.js';
import {
  hasLegacyWorkspace,
  hasRasenWorkspace,
  migrateWorkspace,
  formatMigrationSummary,
} from './workspace-migration.js';
import { transformToHyphenCommands } from '../utils/command-references.js';
import {
  AI_TOOLS,
  OPENSPEC_DIR_NAME,
  WORKSPACE_DIR_NAME,
  AIToolOption,
} from './config.js';
import { PALETTE } from './styles/palette.js';
import { isInteractive } from '../utils/interactive.js';
import { serializeConfig } from './config-prompts.js';
import {
  generateCommands,
  CommandAdapterRegistry,
  getLegacyCommandFilePath,
  getCommandFilePathCandidates,
} from './command-generation/index.js';
import {
  detectLegacyArtifacts,
  cleanupMarkerBlocks,
  formatLegacyCoexistenceNotice,
  pruneRetiredExpertSkillDirs,
  pruneRetiredWorkflowSkillDirs,
  RETIRED_WORKFLOW_COMMAND_IDS,
} from './legacy-cleanup.js';
import {
  SKILL_NAMES,
  getToolsWithSkillsDir,
  isKnownUnadaptedTool,
  resolveToolSkillsRoot,
  getToolSkillStatus,
  getToolStates,
  getSkillTemplates,
  getCommandContents,
  generateSkillContent,
  copySkillSidecars,
  type ToolSkillStatus,
} from './shared/index.js';
import { getGlobalConfig, saveGlobalConfig, type Delivery, type Profile, type RepoMode } from './global-config.js';
import { writeExpertSelectionAck } from './expert-selection-state.js';
import { getProfileWorkflows, resolveDesiredWorkflowSelection, CORE_WORKFLOWS } from './profiles.js';
import {
  getBuiltInWorkflowDefinitions,
  loadWorkflowCatalog,
} from './workflow-registry/index.js';
import { syncWorkflowArtifactLedger } from './workflow-artifact-ledger.js';
import { getAvailableTools } from './available-tools.js';
import { ensureClaudeAgentTeams } from './claude-settings.js';
import { migrateIfNeeded } from './migration.js';

const require = createRequire(import.meta.url);
const { version: OPENSPEC_VERSION } = require('../../package.json');

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const DEFAULT_SCHEMA = 'spec-driven';

const PROGRESS_SPINNER = {
  interval: 80,
  frames: ['░░░', '▒░░', '▒▒░', '▒▒▒', '▓▒▒', '▓▓▒', '▓▓▓', '▒▓▓', '░▒▓'],
};

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

type InitCommandOptions = {
  tools?: string;
  force?: boolean;
  interactive?: boolean;
  profile?: string;
};

// -----------------------------------------------------------------------------
// Init Command Class
// -----------------------------------------------------------------------------

export class InitCommand {
  private readonly toolsArg?: string;
  private readonly force: boolean;
  private readonly interactiveOption?: boolean;
  private readonly profileOverride?: string;

  constructor(options: InitCommandOptions = {}) {
    this.toolsArg = options.tools;
    this.force = options.force ?? false;
    this.interactiveOption = options.interactive;
    this.profileOverride = options.profile;
  }

  async execute(targetPath: string): Promise<void> {
    const projectPath = path.resolve(targetPath);
    const openspecDir = OPENSPEC_DIR_NAME;
    const openspecPath = path.join(projectPath, openspecDir);

    // Validation happens silently in the background
    const extendMode = await this.validate(projectPath, openspecPath);

    // Pointer guard (slice 3.2): a config-only openspec/ with a store:
    // declaration is externalized planning, not a root to extend — and a
    // subdirectory of such a repo must not silently grow a nested root.
    // Refuse before legacy cleanup, migration, or prompts touch anything.
    // In extend mode the walk finds projectPath itself; otherwise it
    // finds the nearest ancestor root (so pointer-repo subdirectories
    // refuse exactly where a normal command would resolve the pointer).
    const guardRoot = findRepoPlanningRootSync(projectPath);
    if (guardRoot) {
      const { hasPlanningShape, pointer } = classifyOpenSpecDir(guardRoot);
      if (!hasPlanningShape) {
        if (pointer.malformed) {
          throw new Error(
            `The store declaration in ${pointer.filePath} is invalid (` +
              storePointerProblem(pointer.malformed) +
              `). Fix or remove the store: line before running rasen init.`
          );
        }
        if (pointer.value !== undefined) {
          throw new Error(
            `This repo's planning is externalized to store '${pointer.value}' (${pointer.filePath}). ` +
              `Remove the store: line first to convert this repo to a local Rasen root.`
          );
        }
      }
    }

    // Offer to migrate a legacy openspec/ workspace when no rasen/ exists yet.
    await this.offerWorkspaceMigration(projectPath, extendMode);

    // Report (never remove) legacy-namespace artifacts for coexistence clarity.
    await this.noticeLegacyArtifacts(projectPath);

    // Detect available tools in the project (task 7.1)
    const detectedTools = getAvailableTools(projectPath);

    // Migration check: migrate existing projects to profile system (task 7.3)
    if (extendMode) {
      migrateIfNeeded(projectPath, detectedTools);
    }

    // Show animated welcome screen (interactive mode only)
    const canPrompt = this.canPromptInteractively();
    if (canPrompt) {
      const { showWelcomeScreen } = await import('../ui/welcome-screen.js');
      await showWelcomeScreen();
    }

    // Validate profile override early so invalid values fail before tool setup.
    // The resolved value is consumed later when generation reads effective config.
    this.resolveProfileOverride();

    // Get tool states before processing
    const toolStates = getToolStates(projectPath);

    // Get tool selection (pass detected tools for pre-selection)
    const selectedToolIds = await this.getSelectedTools(toolStates, extendMode, detectedTools, projectPath);

    // Validate selected tools
    const validatedTools = this.validateTools(selectedToolIds, toolStates);

    // A fresh (non-extend) init is one of the explicit expert-aware write
    // paths (design.md D4): it marks the machine as having explicit expert
    // selection so the profile-default expert set governs from the start
    // (matrix row 4/5), rather than silently inheriting the legacy
    // all-experts fallback that exists only to protect installs that
    // predate expert selection. Re-running init on an already-initialized
    // project (extend mode) is left alone here, matching update semantics.
    // This global write alone is not enough to make ANOTHER already-existing
    // project narrow (review-round Blocker fix): `update`'s pruning also
    // requires that specific project's own acknowledgment file, written
    // below once THIS project's machine home is known.
    if (!extendMode) {
      const currentConfig = getGlobalConfig();
      if (currentConfig.expertSelectionExplicit !== true) {
        saveGlobalConfig({ ...currentConfig, expertSelectionExplicit: true });
      }
    }

    // Resolve the complete catalog selection before creating project files.
    // Missing or invalid selected user workflows therefore fail without a
    // partially generated tool configuration.
    const effectiveConfig = getGlobalConfig();
    const effectiveProfile = this.resolveProfileOverride() ?? effectiveConfig.profile ?? 'full';
    const { unknown: unknownEffectiveWorkflows } = resolveDesiredWorkflowSelection(
      loadWorkflowCatalog(),
      effectiveProfile,
      effectiveConfig.workflows,
      effectiveConfig.expertSelectionExplicit === true
    );
    if (unknownEffectiveWorkflows.length > 0) {
      console.log(
        chalk.yellow(
          `Warning: dropping unknown workflow id(s) from stored profile: ${unknownEffectiveWorkflows.join(', ')}`
        )
      );
    }

    // Create directory structure and config
    await this.createDirectoryStructure(openspecPath, extendMode);

    // Generate skills and commands for each tool
    const results = await this.generateSkillsAndCommands(projectPath, validatedTools);

    // Create config.yaml if needed
    const configStatus = await this.createConfig(openspecPath, extendMode);

    // Establish machine-home identity and registration (task 4.1). Best
    // effort: a registration failure never fails init - the repo-side
    // setup above has already completed.
    const machineHome = await this.registerMachineHome(projectPath);

    // A fresh (non-extend) init has nothing pre-existing to lose, so it is
    // safe to record THIS project's own expert-selection acknowledgment
    // immediately (review-round Blocker fix, expert-selection-state.ts):
    // its first `update` narrows straight away instead of taking the
    // one-run legacy detour a project that never ran its own explicit
    // action goes through.
    if (!extendMode && 'homeDir' in machineHome) {
      writeExpertSelectionAck(machineHome.homeDir);
    }

    // Display success message
    this.displaySuccessMessage(projectPath, validatedTools, results, configStatus, machineHome);
  }

  /**
   * Mints/preserves the project's identity and registers it in the
   * machine-wide project registry, creating its home directory. Failures
   * (unwritable global data dir, missing config, etc.) downgrade to a
   * warning shown in the success summary - the repo-side setup this method
   * runs after has already completed.
   */
  private async registerMachineHome(
    projectPath: string
  ): Promise<{ homeDir: string } | { warning: string }> {
    try {
      const home = await resolveProjectHome(projectPath, { ensure: true });
      return { homeDir: home!.homeDir };
    } catch (error) {
      return {
        warning: `Machine home registration failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  // ═══════════════════════════════════════════════════════════
  // VALIDATION & SETUP
  // ═══════════════════════════════════════════════════════════

  private async validate(
    projectPath: string,
    openspecPath: string
  ): Promise<boolean> {
    const extendMode = await FileSystemUtils.directoryExists(openspecPath);

    // Check write permissions
    if (!(await FileSystemUtils.ensureWritePermissions(projectPath))) {
      throw new Error(`Insufficient permissions to write to ${projectPath}`);
    }
    return extendMode;
  }

  private canPromptInteractively(): boolean {
    if (this.interactiveOption === false) return false;
    if (this.toolsArg !== undefined) return false;
    return isInteractive({ interactive: this.interactiveOption });
  }

  private resolveProfileOverride(): Profile | undefined {
    if (this.profileOverride === undefined) {
      return undefined;
    }

    if (this.profileOverride === 'full' || this.profileOverride === 'core' || this.profileOverride === 'custom') {
      return this.profileOverride;
    }

    throw new Error(`Invalid profile "${this.profileOverride}". Available profiles: full, core, custom`);
  }

  // ═══════════════════════════════════════════════════════════
  // LEGACY CLEANUP
  // ═══════════════════════════════════════════════════════════

  /**
   * When a legacy `openspec/` workspace exists but no `rasen/` workspace does,
   * offer copy-only migration. Declined or non-interactive runs proceed with a
   * fresh empty workspace (and a hint that `rasen migrate` remains available).
   */
  private async offerWorkspaceMigration(projectPath: string, extendMode: boolean): Promise<void> {
    // extendMode means a rasen/ workspace already exists — never migrate over it.
    if (extendMode || hasRasenWorkspace(projectPath) || !hasLegacyWorkspace(projectPath)) {
      return;
    }

    const canPrompt = this.canPromptInteractively();
    if (!canPrompt) {
      console.log(
        chalk.dim(
          'Detected a legacy openspec/ workspace. Creating a fresh rasen/ workspace; run "rasen migrate" to copy the existing content over (copy-only, originals untouched).'
        )
      );
      return;
    }

    const { confirm } = await import('@inquirer/prompts');
    const shouldMigrate = await confirm({
      message: 'A legacy openspec/ workspace was found. Copy it into a new rasen/ workspace? (copy-only; openspec/ is left untouched)',
      default: true,
    });

    if (!shouldMigrate) {
      console.log(chalk.dim('Skipping migration. Run "rasen migrate" later to copy openspec/ into rasen/.'));
      return;
    }

    const summary = migrateWorkspace(projectPath);
    console.log();
    console.log(formatMigrationSummary(summary));
    console.log();

    // Only inside the migrate flow, and only on explicit consent (default no),
    // may rasen remove OpenSpec marker blocks from shared config files: in
    // coexistence they may be upstream OpenSpec's active configuration.
    await this.offerMarkerCleanup(projectPath);
  }

  /**
   * Consent-gated (default no) removal of OpenSpec marker blocks from shared
   * config files. Runs only inside the migrate flow. Never deletes files or
   * touches command/skill artifacts. No-op non-interactively.
   */
  private async offerMarkerCleanup(projectPath: string): Promise<void> {
    if (!this.canPromptInteractively()) return;

    const detection = await detectLegacyArtifacts(projectPath);
    if (detection.configFilesToUpdate.length === 0) return;

    const { confirm } = await import('@inquirer/prompts');
    const shouldClean = await confirm({
      message: `Remove OpenSpec marker blocks from ${detection.configFilesToUpdate.join(', ')}? (they may be used by upstream OpenSpec)`,
      default: false,
    });
    if (!shouldClean) {
      console.log(chalk.dim('Keeping marker blocks. You can remove them manually anytime.'));
      return;
    }

    const { modifiedFiles, errors } = await cleanupMarkerBlocks(projectPath, detection);
    if (modifiedFiles.length > 0) {
      console.log(chalk.dim(`Removed OpenSpec markers from: ${modifiedFiles.join(', ')}`));
    }
    for (const error of errors) {
      console.log(chalk.yellow(`  ⚠ ${error}`));
    }
  }

  /**
   * Prints a one-time coexistence notice when legacy-namespace command/skill
   * artifacts or shared-config marker blocks are detected. Never removes or
   * modifies anything (D4: rasen cannot reliably distinguish an old rasen
   * install from an active upstream OpenSpec install).
   */
  private async noticeLegacyArtifacts(projectPath: string): Promise<void> {
    const detection = await detectLegacyArtifacts(projectPath);
    const notice = formatLegacyCoexistenceNotice(detection);
    if (!notice) return;
    console.log();
    console.log(notice);
    console.log();
  }

  // ═══════════════════════════════════════════════════════════
  // TOOL SELECTION
  // ═══════════════════════════════════════════════════════════

  private async getSelectedTools(
    toolStates: Map<string, ToolSkillStatus>,
    extendMode: boolean,
    detectedTools: AIToolOption[],
    projectPath: string
  ): Promise<string[]> {
    // Check for --tools flag first
    const nonInteractiveSelection = this.resolveToolsArg();
    if (nonInteractiveSelection !== null) {
      return nonInteractiveSelection;
    }

    const validTools = getToolsWithSkillsDir();
    const detectedToolIds = new Set(detectedTools.map((t) => t.value));
    const configuredToolIds = new Set(
      [...toolStates.entries()]
        .filter(([, status]) => status.configured)
        .map(([toolId]) => toolId)
    );
    const shouldPreselectDetected = !extendMode && configuredToolIds.size === 0;
    const canPrompt = this.canPromptInteractively();

    // Non-interactive mode: use detected tools as fallback (task 7.8)
    if (!canPrompt) {
      const adaptedDetectedToolIds = [...detectedToolIds].filter((id) => validTools.includes(id));
      if (adaptedDetectedToolIds.length > 0) {
        return adaptedDetectedToolIds;
      }
      throw new Error(
        `No tools detected and no --tools flag provided. Valid tools:\n  ${validTools.join('\n  ')}\n\nUse --tools all, --tools none, or --tools ${validTools.join(',')}`
      );
    }

    if (validTools.length === 0) {
      throw new Error(
        `No tools available for skill generation.`
      );
    }

    // Interactive mode: show searchable multi-select
    const { searchableMultiSelect } = await import('../prompts/searchable-multi-select.js');

    // Build choices: pre-select configured tools; keep detected tools visible but unselected.
    const sortedChoices = validTools
      .map((toolId) => {
        const tool = AI_TOOLS.find((t) => t.value === toolId);
        const status = toolStates.get(toolId);
        const configured = status?.configured ?? false;
        const detected = detectedToolIds.has(toolId);

        return {
          name: tool?.name || toolId,
          value: toolId,
          configured,
          detected: detected && !configured,
          preSelected: configured || (shouldPreselectDetected && detected && !configured),
        };
      })
      .sort((a, b) => {
        // Configured tools first, then detected (not configured), then everything else.
        if (a.configured && !b.configured) return -1;
        if (!a.configured && b.configured) return 1;
        if (a.detected && !b.detected) return -1;
        if (!a.detected && b.detected) return 1;
        return 0;
      });

    const configuredNames = validTools
      .filter((toolId) => configuredToolIds.has(toolId))
      .map((toolId) => AI_TOOLS.find((t) => t.value === toolId)?.name || toolId);

    if (configuredNames.length > 0) {
      console.log(`Rasen configured: ${configuredNames.join(', ')} (pre-selected)`);
    }

    const detectedOnlyNames = detectedTools
      .filter((tool) => !configuredToolIds.has(tool.value))
      .map((tool) => tool.name);

    if (detectedOnlyNames.length > 0) {
      const detectionLabel = shouldPreselectDetected
        ? 'pre-selected for first-time setup'
        : 'not pre-selected';
      console.log(`Detected tool directories: ${detectedOnlyNames.join(', ')} (${detectionLabel})`);
    }

    const selectedTools = await searchableMultiSelect({
      message: `Select tools to set up (${validTools.length} available)`,
      pageSize: 15,
      choices: sortedChoices,
      validate: (selected: string[]) => selected.length > 0 || 'Select at least one tool',
    });

    if (selectedTools.length === 0) {
      throw new Error('At least one tool must be selected');
    }

    return selectedTools;
  }

  private resolveToolsArg(): string[] | null {
    if (typeof this.toolsArg === 'undefined') {
      return null;
    }

    const raw = this.toolsArg.trim();
    if (raw.length === 0) {
      throw new Error(
        'The --tools option requires a value. Use "all", "none", or a comma-separated list of tool IDs.'
      );
    }

    const availableTools = getToolsWithSkillsDir();
    const availableSet = new Set(availableTools);
    const availableList = ['all', 'none', ...availableTools].join(', ');

    const lowerRaw = raw.toLowerCase();
    if (lowerRaw === 'all') {
      return availableTools;
    }

    if (lowerRaw === 'none') {
      return [];
    }

    const tokens = raw
      .split(',')
      .map((token) => token.trim())
      .filter((token) => token.length > 0);

    if (tokens.length === 0) {
      throw new Error(
        'The --tools option requires at least one tool ID when not using "all" or "none".'
      );
    }

    const normalizedTokens = tokens.map((token) => token.toLowerCase());

    if (normalizedTokens.some((token) => token === 'all' || token === 'none')) {
      throw new Error('Cannot combine reserved values "all" or "none" with specific tool IDs.');
    }

    const invalidTokens = tokens.filter(
      (_token, index) => !availableSet.has(normalizedTokens[index])
    );

    if (invalidTokens.length > 0) {
      const unadaptedTokens = invalidTokens.filter((token) => isKnownUnadaptedTool(token.toLowerCase()));
      const unknownTokens = invalidTokens.filter((token) => !isKnownUnadaptedTool(token.toLowerCase()));

      if (unadaptedTokens.length > 0 && unknownTokens.length === 0) {
        throw new Error(
          `Tool(s) recognized but not yet adapted in Rasen: ${unadaptedTokens.join(', ')}. Currently adapted tools: ${availableTools.join(', ')}.`
        );
      }

      if (unadaptedTokens.length > 0) {
        throw new Error(
          `Invalid tool(s): ${unknownTokens.join(', ')}. Available values: ${availableList}\n` +
          `Tool(s) recognized but not yet adapted in Rasen: ${unadaptedTokens.join(', ')}. Currently adapted tools: ${availableTools.join(', ')}.`
        );
      }

      throw new Error(
        `Invalid tool(s): ${invalidTokens.join(', ')}. Available values: ${availableList}`
      );
    }

    // Deduplicate while preserving order
    const deduped: string[] = [];
    for (const token of normalizedTokens) {
      if (!deduped.includes(token)) {
        deduped.push(token);
      }
    }

    return deduped;
  }

  private validateTools(
    toolIds: string[],
    toolStates: Map<string, ToolSkillStatus>
  ): Array<{ value: string; name: string; skillsDir: string; wasConfigured: boolean }> {
    const validatedTools: Array<{ value: string; name: string; skillsDir: string; wasConfigured: boolean }> = [];

    for (const toolId of toolIds) {
      const tool = AI_TOOLS.find((t) => t.value === toolId);
      if (!tool) {
        const validToolIds = getToolsWithSkillsDir();
        throw new Error(
          `Unknown tool '${toolId}'. Valid tools:\n  ${validToolIds.join('\n  ')}`
        );
      }

      if (isKnownUnadaptedTool(toolId)) {
        const validToolIds = getToolsWithSkillsDir();
        throw new Error(
          `Tool '${toolId}' is recognized but not yet adapted in Rasen. Currently adapted tools: ${validToolIds.join(', ')}.`
        );
      }

      if (!tool.skillsDir) {
        const validToolsWithSkills = getToolsWithSkillsDir();
        throw new Error(
          `Tool '${toolId}' does not support skill generation.\nTools with skill generation support:\n  ${validToolsWithSkills.join('\n  ')}`
        );
      }

      const preState = toolStates.get(tool.value);
      validatedTools.push({
        value: tool.value,
        name: tool.name,
        skillsDir: tool.skillsDir,
        wasConfigured: preState?.configured ?? false,
      });
    }

    return validatedTools;
  }

  // ═══════════════════════════════════════════════════════════
  // DIRECTORY STRUCTURE
  // ═══════════════════════════════════════════════════════════

  private async createDirectoryStructure(openspecPath: string, extendMode: boolean): Promise<void> {
    if (extendMode) {
      // In extend mode, just ensure directories exist without spinner
      const directories = [
        openspecPath,
        path.join(openspecPath, 'specs'),
        path.join(openspecPath, 'changes'),
        path.join(openspecPath, 'changes', 'archive'),
      ];

      for (const dir of directories) {
        await FileSystemUtils.createDirectory(dir);
      }
      return;
    }

    const spinner = this.startSpinner('Creating Rasen structure...');

    const directories = [
      openspecPath,
      path.join(openspecPath, 'specs'),
      path.join(openspecPath, 'changes'),
      path.join(openspecPath, 'changes', 'archive'),
    ];

    for (const dir of directories) {
      await FileSystemUtils.createDirectory(dir);
    }

    spinner.stopAndPersist({
      symbol: PALETTE.white('▌'),
      text: PALETTE.white('Rasen structure created'),
    });
  }

  // ═══════════════════════════════════════════════════════════
  // SKILL & COMMAND GENERATION
  // ═══════════════════════════════════════════════════════════

  /**
   * Removes command files left behind by retired built-in workflows (e.g.
   * `ff`), resolving candidate paths via the tool's command adapter for each
   * id in `RETIRED_WORKFLOW_COMMAND_IDS`. Scoped to exactly those ids;
   * idempotent (a no-op when no such file exists).
   */
  private async pruneRetiredWorkflowCommandFiles(
    projectPath: string,
    toolId: string,
  ): Promise<void> {
    const adapter = CommandAdapterRegistry.get(toolId);
    if (!adapter) return;

    for (const commandId of RETIRED_WORKFLOW_COMMAND_IDS) {
      for (const cmdPath of getCommandFilePathCandidates(adapter, commandId)) {
        const fullPath = path.isAbsolute(cmdPath) ? cmdPath : path.join(projectPath, cmdPath);
        try {
          if (fs.existsSync(fullPath)) {
            await fs.promises.unlink(fullPath);
          }
        } catch {
          // Ignore errors
        }
      }
    }
  }

  private async generateSkillsAndCommands(
    projectPath: string,
    tools: Array<{ value: string; name: string; skillsDir: string; wasConfigured: boolean }>
  ): Promise<{
    createdTools: typeof tools;
    refreshedTools: typeof tools;
    failedTools: Array<{ name: string; error: Error }>;
    commandsSkipped: string[];
    removedCommandCount: number;
  }> {
    const createdTools: typeof tools = [];
    const refreshedTools: typeof tools = [];
    const failedTools: Array<{ name: string; error: Error }> = [];
    const commandsSkipped: string[] = [];
    let removedCommandCount = 0;

    // Read global config for profile and delivery settings (use --profile override if set)
    const globalConfig = getGlobalConfig();
    const profile: Profile = this.resolveProfileOverride() ?? globalConfig.profile ?? 'full';
    const delivery: Delivery = globalConfig.delivery ?? 'both';
    const { ids: workflows, unknown: unknownProfileWorkflows } = resolveDesiredWorkflowSelection(
      loadWorkflowCatalog(),
      profile,
      globalConfig.workflows,
      globalConfig.expertSelectionExplicit === true
    );
    if (unknownProfileWorkflows.length > 0) {
      console.log(
        chalk.yellow(
          `Warning: dropping unknown workflow id(s) from stored profile: ${unknownProfileWorkflows.join(', ')}`
        )
      );
    }
    const proactive = globalConfig.proactive ?? true;
    const repoMode: RepoMode = globalConfig.repoMode ?? 'collaborative';

    // Skills are always installed; only command generation is gated on delivery.
    const shouldGenerateCommands = delivery === 'both';
    const skillTemplates = getSkillTemplates(workflows);
    const commandContents = shouldGenerateCommands ? getCommandContents(workflows) : [];

    // Process each tool
    for (const tool of tools) {
      const spinner = ora(`Setting up ${tool.name}...`).start();

      try {
        // Use tool-specific skills root — project-local for most tools, a
        // machine-global home for tools like Hermes (skillsHome: 'global').
        const toolDefinition = AI_TOOLS.find((t) => t.value === tool.value);
        const skillsDir = resolveToolSkillsRoot(
          toolDefinition ?? { name: tool.name, value: tool.value, available: true, skillsDir: tool.skillsDir },
          projectPath
        );

        // Prune expert-skill dirs orphaned by the rebrand (openspec-gstack-* →
        // openspec-*); installed dirs are not renamed in place.
        await pruneRetiredExpertSkillDirs(skillsDir);

        // Prune skill/command artifacts left behind by retired built-in
        // workflows (e.g. `ff` → `rasen-ff-change`); the registry-derived
        // cleanup below can no longer reach a retired id.
        await pruneRetiredWorkflowSkillDirs(skillsDir);
        await this.pruneRetiredWorkflowCommandFiles(projectPath, tool.value);

        // Create skill directories and SKILL.md files
        for (const { template, dirName, workflowId, escapeFrontmatter } of skillTemplates) {
          const skillDir = path.join(skillsDir, dirName);
          const skillFile = path.join(skillDir, 'SKILL.md');

          // Generate SKILL.md content with YAML frontmatter including generatedBy
          // Chain transformers: embed config values, then tool-specific transforms
          // (hyphen-based command references for tools where filename = command name)
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

          // Write the skill file
          await FileSystemUtils.writeFile(skillFile, skillContent);

          // Copy the skill's sidecar reference files (checklists, references,
          // scripts) so its relative-path references resolve at the install target.
          copySkillSidecars(workflowId, skillDir);
        }

        // Generate commands if delivery includes commands
        if (shouldGenerateCommands) {
          const adapter = CommandAdapterRegistry.get(tool.value);
          if (adapter) {
            const generatedCommands = generateCommands(commandContents, adapter);

            for (const cmd of generatedCommands) {
              const commandFile = path.isAbsolute(cmd.path) ? cmd.path : path.join(projectPath, cmd.path);
              await FileSystemUtils.writeFile(commandFile, cmd.fileContent);
            }

            // Remove legacy '-command'-suffixed files replaced by the short names above
            for (const content of commandContents) {
              const legacyPath = getLegacyCommandFilePath(adapter, content.id);
              if (!legacyPath) continue;
              const fullPath = path.isAbsolute(legacyPath) ? legacyPath : path.join(projectPath, legacyPath);
              try {
                if (fs.existsSync(fullPath)) {
                  await fs.promises.unlink(fullPath);
                }
              } catch {
                // Ignore errors
              }
            }
          } else {
            commandsSkipped.push(tool.value);
          }
        }
        if (!shouldGenerateCommands) {
          removedCommandCount += await this.removeCommandFiles(projectPath, tool.value);
        }

        syncWorkflowArtifactLedger(projectPath, tool.value, workflows, delivery);

        // Claude Code: enable agent-teams (Tier A orchestration) in project settings.
        if (tool.value === 'claude') {
          ensureClaudeAgentTeams(projectPath, tool.skillsDir);
        }

        spinner.succeed(`Setup complete for ${tool.name}`);

        if (tool.wasConfigured) {
          refreshedTools.push(tool);
        } else {
          createdTools.push(tool);
        }
      } catch (error) {
        spinner.fail(`Failed for ${tool.name}`);
        failedTools.push({ name: tool.name, error: error as Error });
      }
    }

    return {
      createdTools,
      refreshedTools,
      failedTools,
      commandsSkipped,
      removedCommandCount,
    };
  }

  // ═══════════════════════════════════════════════════════════
  // CONFIG FILE
  // ═══════════════════════════════════════════════════════════

  private async createConfig(openspecPath: string, extendMode: boolean): Promise<'created' | 'exists' | 'skipped'> {
    const configPath = path.join(openspecPath, 'config.yaml');
    const configYmlPath = path.join(openspecPath, 'config.yml');
    const configYamlExists = fs.existsSync(configPath);
    const configYmlExists = fs.existsSync(configYmlPath);

    if (configYamlExists || configYmlExists) {
      return 'exists';
    }


    try {
      const yamlContent = serializeConfig({ schema: DEFAULT_SCHEMA });
      await FileSystemUtils.writeFile(configPath, yamlContent);
      return 'created';
    } catch {
      return 'skipped';
    }
  }

  // ═══════════════════════════════════════════════════════════
  // UI & OUTPUT
  // ═══════════════════════════════════════════════════════════

  private displaySuccessMessage(
    projectPath: string,
    tools: Array<{ value: string; name: string; skillsDir: string; wasConfigured: boolean }>,
    results: {
      createdTools: typeof tools;
      refreshedTools: typeof tools;
      failedTools: Array<{ name: string; error: Error }>;
      commandsSkipped: string[];
      removedCommandCount: number;
    },
    configStatus: 'created' | 'exists' | 'skipped',
    machineHome: { homeDir: string } | { warning: string }
  ): void {
    console.log();
    console.log(chalk.bold('Rasen Setup Complete'));
    console.log();

    // Show created vs refreshed tools
    if (results.createdTools.length > 0) {
      console.log(`Created: ${results.createdTools.map((t) => t.name).join(', ')}`);
    }
    if (results.refreshedTools.length > 0) {
      console.log(`Refreshed: ${results.refreshedTools.map((t) => t.name).join(', ')}`);
    }

    // Show counts (respecting profile filter)
    const successfulTools = [...results.createdTools, ...results.refreshedTools];
    if (successfulTools.length > 0) {
      const globalConfig = getGlobalConfig();
      const profile: Profile = (this.profileOverride as Profile) ?? globalConfig.profile ?? 'full';
      const delivery: Delivery = globalConfig.delivery ?? 'both';
      const { ids: workflows } = resolveDesiredWorkflowSelection(
        loadWorkflowCatalog(),
        profile,
        globalConfig.workflows,
        globalConfig.expertSelectionExplicit === true
      );
      // Tools with a machine-global skills home (Hermes) report their
      // resolved global location instead of the project-local `.hermes/`
      // label, so the user knows skills landed outside the project.
      const toolDirEntries = [...new Set(successfulTools.map((t) => {
        const toolDefinition = AI_TOOLS.find((td) => td.value === t.value);
        if (toolDefinition?.skillsHome === 'global') {
          return `${resolveToolSkillsRoot(toolDefinition, projectPath)} (global)`;
        }
        return t.skillsDir;
      }))];
      const hasGlobalTool = toolDirEntries.some((entry) => entry.endsWith('(global)'));
      // Preserve the exact previous format (single trailing slash) when every
      // tool is project-local; a global entry already reads as a full path.
      const toolDirs = hasGlobalTool ? toolDirEntries.join(', ') : `${toolDirEntries.join(', ')}/`;
      const skillCount = getSkillTemplates(workflows).length;
      const commandCount = delivery === 'both' ? getCommandContents(workflows).length : 0;
      if (skillCount > 0 && commandCount > 0) {
        console.log(`${skillCount} skills and ${commandCount} commands in ${toolDirs}`);
      } else if (skillCount > 0) {
        console.log(`${skillCount} skills in ${toolDirs}`);
      } else if (commandCount > 0) {
        console.log(`${commandCount} commands in ${toolDirs}`);
      }
    }

    // Show failures
    if (results.failedTools.length > 0) {
      console.log(chalk.red(`Failed: ${results.failedTools.map((f) => `${f.name} (${f.error.message})`).join(', ')}`));
    }

    // Show skipped commands
    if (results.commandsSkipped.length > 0) {
      console.log(chalk.dim(`Commands skipped for: ${results.commandsSkipped.join(', ')} (no adapter)`));
    }
    if (results.removedCommandCount > 0) {
      console.log(chalk.dim(`Removed: ${results.removedCommandCount} command files (delivery: skills)`));
    }

    // Config status
    if (configStatus === 'created') {
      console.log(`Config: ${WORKSPACE_DIR_NAME}/config.yaml (schema: ${DEFAULT_SCHEMA})`);
    } else if (configStatus === 'exists') {
      // Show actual filename (config.yaml or config.yml)
      const configYaml = path.join(projectPath, OPENSPEC_DIR_NAME, 'config.yaml');
      const configYml = path.join(projectPath, OPENSPEC_DIR_NAME, 'config.yml');
      const configName = fs.existsSync(configYaml) ? 'config.yaml' : fs.existsSync(configYml) ? 'config.yml' : 'config.yaml';
      console.log(`Config: ${WORKSPACE_DIR_NAME}/${configName} (exists)`);
    } else {
      console.log(chalk.dim(`Config: skipped (non-interactive mode)`));
    }

    // Machine home (task 4.1)
    if ('homeDir' in machineHome) {
      console.log(`Machine home: ${machineHome.homeDir}`);
    } else {
      console.log(chalk.yellow(`  ⚠ ${machineHome.warning}`));
    }

    // Getting started (task 7.6: show propose if in profile)
    const globalCfg = getGlobalConfig();
    const activeProfile: Profile = (this.profileOverride as Profile) ?? globalCfg.profile ?? 'full';
    const activeWorkflows = [...getProfileWorkflows(activeProfile, globalCfg.workflows)];
    console.log();
    if (activeWorkflows.includes('propose')) {
      console.log(chalk.bold('Getting started:'));
      console.log('  Start your first change: /rasen:propose "your idea"');
    } else if (activeWorkflows.includes('new')) {
      console.log(chalk.bold('Getting started:'));
      console.log('  Start your first change: /rasen:new "your idea"');
    } else {
      console.log("Done. Run 'rasen profile' to configure your workflows.");
    }

    // Safety hook configuration hint
    console.log();
    console.log(chalk.bold('Safety Hook (optional):'));
    console.log('  Add to .claude/settings.json to detect destructive commands:');
    console.log(chalk.dim('  "hooks": { "PreToolUse": [{ "type": "command", "command": "bash hooks/safety-check.sh" }] }'));

    // Compact recovery hook configuration hint
    console.log();
    console.log(chalk.bold('Compact Recovery Hook (optional):'));
    console.log('  Add to .claude/settings.json to re-anchor on handoff distillates after a compaction:');
    console.log(chalk.dim('  "hooks": { "SessionStart": [{ "matcher": "compact", "hooks": [{ "type": "command", "command": "bash hooks/compact-recovery.sh" }] }] }'));

    // Links
    console.log();
    console.log(`Learn more: ${chalk.cyan('https://github.com/DumoeDss/rasen')}`);
    console.log(`Feedback:   ${chalk.cyan('https://github.com/DumoeDss/rasen/issues')}`);

    // Restart instruction if any tools were configured
    if (results.createdTools.length > 0 || results.refreshedTools.length > 0) {
      console.log();
      console.log(chalk.white('Restart your IDE for slash commands to take effect.'));
    }

    console.log();
  }

  private startSpinner(text: string) {
    return ora({
      text,
      stream: process.stdout,
      color: 'gray',
      spinner: PROGRESS_SPINNER,
    }).start();
  }

  private async removeCommandFiles(projectPath: string, toolId: string): Promise<number> {
    let removed = 0;
    const adapter = CommandAdapterRegistry.get(toolId);
    if (!adapter) return 0;

    for (const definition of getBuiltInWorkflowDefinitions()) {
      if (!definition.command) continue;
      for (const cmdPath of getCommandFilePathCandidates(adapter, definition.command.content.id)) {
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
}
