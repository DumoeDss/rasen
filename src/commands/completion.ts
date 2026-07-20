import ora from 'ora';
import { CompletionFactory } from '../core/completions/factory.js';
import { COMMAND_REGISTRY } from '../core/completions/command-registry.js';
import { localizeCommandRegistry } from '../core/completions/description-localization.js';
import { getCliLocale } from '../core/cli-locale.js';
import { detectShell, SupportedShell } from '../utils/shell-detection.js';
import { CompletionProvider } from '../core/completions/completion-provider.js';
import { getArchivedChangeIds } from '../utils/item-discovery.js';
import { getGlobalConfig } from '../core/global-config.js';
import { listAvailableProfiles } from '../core/named-profiles.js';
import { loadWorkflowCatalog } from '../core/workflow-registry/index.js';
import { getLocaleCatalog } from '../locales/index.js';
import {
  formatInstallerMessage,
  getCompletionUiMessages,
} from './completion-messages.js';

interface GenerateOptions {
  shell?: string;
}

interface InstallOptions {
  shell?: string;
  verbose?: boolean;
}

interface UninstallOptions {
  shell?: string;
  yes?: boolean;
}

interface CompleteOptions {
  type: string;
}

/**
 * Command for managing shell completions for Rasen CLI
 */
export class CompletionCommand {
  private completionProvider: CompletionProvider;

  constructor() {
    this.completionProvider = new CompletionProvider();
  }
  /**
   * Resolve shell parameter or exit with error
   *
   * @param shell - The shell parameter (may be undefined)
   * @param operationName - Name of the operation (for error messages)
   * @returns Resolved shell or null if should exit
   */
  private resolveShellOrExit(shell: string | undefined, operationName: string): SupportedShell | null {
    const ui = getCompletionUiMessages();
    const supported = CompletionFactory.getSupportedShells().join(', ');
    const normalizedShell = this.normalizeShell(shell);

    if (!normalizedShell) {
      const detectionResult = detectShell();

      if (detectionResult.shell && CompletionFactory.isSupported(detectionResult.shell)) {
        return detectionResult.shell;
      }

      // Shell was detected but not supported
      if (detectionResult.detected && !detectionResult.shell) {
        console.error(ui.unsupportedShell(detectionResult.detected, supported));
        process.exitCode = 1;
        return null;
      }

      // No shell specified and cannot auto-detect
      console.error(ui.autoDetectFailed);
      console.error(ui.usage(operationName));
      console.error(ui.currentlySupported(supported));
      process.exitCode = 1;
      return null;
    }

    if (!CompletionFactory.isSupported(normalizedShell)) {
      console.error(ui.unsupportedShell(normalizedShell, supported));
      process.exitCode = 1;
      return null;
    }

    return normalizedShell;
  }

  /**
   * Generate completion script and output to stdout
   *
   * @param options - Options for generation (shell type)
   */
  async generate(options: GenerateOptions = {}): Promise<void> {
    const shell = this.resolveShellOrExit(options.shell, 'generate');
    if (!shell) return;

    await this.generateForShell(shell);
  }

  /**
   * Install completion script to the appropriate location
   *
   * @param options - Options for installation (shell type, verbose output)
   */
  async install(options: InstallOptions = {}): Promise<void> {
    const shell = this.resolveShellOrExit(options.shell, 'install');
    if (!shell) return;

    await this.installForShell(shell, options.verbose || false);
  }

  /**
   * Uninstall completion script from the installation location
   *
   * @param options - Options for uninstallation (shell type, yes flag)
   */
  async uninstall(options: UninstallOptions = {}): Promise<void> {
    const shell = this.resolveShellOrExit(options.shell, 'uninstall');
    if (!shell) return;

    await this.uninstallForShell(shell, options.yes || false);
  }

  /**
   * Generate completion script for a specific shell
   */
  private async generateForShell(shell: SupportedShell): Promise<void> {
    const generator = CompletionFactory.createGenerator(shell);
    const script = generator.generate(localizeCommandRegistry(COMMAND_REGISTRY, getCliLocale()));
    console.log(script);
  }

  /**
   * Install completion script for a specific shell
   */
  private async installForShell(shell: SupportedShell, verbose: boolean): Promise<void> {
    const locale = getCliLocale();
    const ui = getCompletionUiMessages(locale);
    const generator = CompletionFactory.createGenerator(shell);
    const installer = CompletionFactory.createInstaller(shell);

    const spinner = ora(ui.installing(shell)).start();

    try {
      // Generate the completion script
      const script = generator.generate(localizeCommandRegistry(COMMAND_REGISTRY, getCliLocale()));

      // Install it
      const result = await installer.install(script);

      spinner.stop();

      if (result.success) {
        console.log(`✓ ${formatInstallerMessage(result.messageDescriptor, result.message, locale)}`);

        if (verbose && result.installedPath) {
          console.log(ui.installedTo(result.installedPath));
          if (result.backupPath) {
            console.log(ui.backupCreated(result.backupPath));
          }

          // Check if any shell config was updated
          const configWasUpdated = result.zshrcConfigured || result.bashrcConfigured || result.profileConfigured;

          if (configWasUpdated) {
            const configPaths: Record<string, string> = {
              zsh: '~/.zshrc',
              bash: '~/.bashrc',
              fish: '~/.config/fish/config.fish',
              powershell: '$PROFILE',
            };
            const configPath = configPaths[shell] || 'config file';
            console.log(ui.configuredAutomatically(configPath));
          }
        }

        // Display warnings if present
        if (result.warnings && result.warnings.length > 0) {
          console.log('');
          for (const [index, warning] of result.warnings.entries()) {
            console.log(
              formatInstallerMessage(result.warningDescriptors?.[index] ?? undefined, warning, locale)
            );
          }
        }

        // Print instructions (only shown if .zshrc wasn't auto-configured)
        if (result.instructions && result.instructions.length > 0) {
          console.log('');
          for (const [index, instruction] of result.instructions.entries()) {
            console.log(
              formatInstallerMessage(
                result.instructionDescriptors?.[index] ?? undefined,
                instruction,
                locale
              )
            );
          }
        } else {
          // Check if any shell config was updated (InstallationResult has: zshrcConfigured, bashrcConfigured, profileConfigured)
          const configWasUpdated = result.zshrcConfigured || result.bashrcConfigured || result.profileConfigured;

          if (configWasUpdated) {
            console.log('');

            // Shell-specific reload instructions
            const reloadCommands: Record<string, string> = {
              zsh: 'exec zsh',
              bash: 'exec bash',
              fish: 'exec fish',
              powershell: '. $PROFILE',
            };
            const reloadCmd = reloadCommands[shell] || `restart your ${shell} shell`;

            console.log(ui.restartShell(reloadCmd));
          }
        }
      } else {
        console.error(`✗ ${formatInstallerMessage(result.messageDescriptor, result.message, locale)}`);
        process.exitCode = 1;
      }
    } catch (error) {
      spinner.stop();
      console.error(ui.installFailed(error instanceof Error ? error.message : String(error)));
      process.exitCode = 1;
    }
  }

  /**
   * Uninstall completion script for a specific shell
   */
  private async uninstallForShell(shell: SupportedShell, skipConfirmation: boolean): Promise<void> {
    const locale = getCliLocale();
    const ui = getCompletionUiMessages(locale);
    const installer = CompletionFactory.createInstaller(shell);

    // Prompt for confirmation unless --yes flag is provided
    if (!skipConfirmation) {
      const { confirm } = await import('@inquirer/prompts');

      // Get shell-specific config file path
      const configPaths: Record<string, string> = {
        zsh: '~/.zshrc',
        bash: '~/.bashrc',
        fish: ui.fishConfiguration, // Fish doesn't modify profile, just removes script file
        powershell: '$PROFILE',
      };
      const configPath = configPaths[shell] || ui.shellConfiguration(shell);

      const confirmed = await confirm({
        message: ui.removeConfiguration(configPath),
        default: false,
      });

      if (!confirmed) {
        console.log(ui.uninstallCancelled);
        return;
      }
    }

    const spinner = ora(ui.uninstalling(shell)).start();

    try {
      const result = await installer.uninstall();

      spinner.stop();

      if (result.success) {
        console.log(`✓ ${formatInstallerMessage(result.messageDescriptor, result.message, locale)}`);
      } else {
        console.error(`✗ ${formatInstallerMessage(result.messageDescriptor, result.message, locale)}`);
        process.exitCode = 1;
      }

      if (result.warnings && result.warnings.length > 0) {
        console.log('');
        for (const [index, warning] of result.warnings.entries()) {
          console.log(
            formatInstallerMessage(result.warningDescriptors?.[index], warning, locale)
          );
        }
      }
    } catch (error) {
      spinner.stop();
      console.error(ui.uninstallFailed(error instanceof Error ? error.message : String(error)));
      process.exitCode = 1;
    }
  }

  /**
   * Output machine-readable completion data for shell consumption
   * Format: tab-separated "id\tdescription" per line
   *
   * @param options - Options specifying completion type
   */
  async complete(options: CompleteOptions): Promise<void> {
    const type = options.type.toLowerCase();
    const locale = getCliLocale();
    const labels = getLocaleCatalog(locale).completion.dynamic;

    try {
      switch (type) {
        case 'changes': {
          const changeIds = await this.completionProvider.getChangeIds();
          for (const id of changeIds) {
            console.log(`${id}\t${labels.activeChange}`);
          }
          break;
        }
        case 'specs': {
          const specIds = await this.completionProvider.getSpecIds();
          for (const id of specIds) {
            console.log(`${id}\t${labels.specification}`);
          }
          break;
        }
        case 'schemas': {
          const schemaNames = await this.completionProvider.getSchemaNames();
          for (const name of schemaNames) {
            console.log(`${name}\t${labels.schema}`);
          }
          break;
        }
        case 'profiles': {
          const delivery = getGlobalConfig().delivery ?? 'both';
          for (const profile of listAvailableProfiles(delivery)) {
            if (!profile.definition) continue;
            const source = profile.builtIn
              ? labels.builtIn
              : labels.saved;
            console.log(
              `${profile.name}\t${source}${labels.profileSeparator}${labels.profile}`
            );
          }
          break;
        }
        case 'saved-profiles': {
          const delivery = getGlobalConfig().delivery ?? 'both';
          for (const profile of listAvailableProfiles(delivery)) {
            if (profile.builtIn || !profile.definition) continue;
            console.log(`${profile.name}\t${labels.savedProfile}`);
          }
          break;
        }
        case 'workflows': {
          // Experts (kind:'expert') are always-installed, not a selectable
          // --workflows value this round — exclude them from completion.
          for (const workflow of loadWorkflowCatalog().definitions) {
            if (workflow.kind === 'expert') continue;
            console.log(`${workflow.id}\t${labels.workflow}`);
          }
          break;
        }
        case 'archived-changes': {
          const archivedIds = await getArchivedChangeIds();
          for (const id of archivedIds) {
            console.log(`${id}\t${labels.archivedChange}`);
          }
          break;
        }
        default:
          // Invalid type - silently exit with no output for graceful shell completion failure
          process.exitCode = 1;
          break;
      }
    } catch {
      // Silently fail for graceful shell completion experience
      process.exitCode = 1;
    }
  }

  /**
   * Normalize shell parameter to lowercase
   */
  private normalizeShell(shell?: string): string | undefined {
    return shell?.toLowerCase();
  }
}
