import { CompletionGenerator } from './types.js';
import { ZshGenerator } from './generators/zsh-generator.js';
import { BashGenerator } from './generators/bash-generator.js';
import { FishGenerator } from './generators/fish-generator.js';
import { PowerShellGenerator } from './generators/powershell-generator.js';
import { ZshInstaller } from './installers/zsh-installer.js';
import { BashInstaller } from './installers/bash-installer.js';
import { FishInstaller } from './installers/fish-installer.js';
import { PowerShellInstaller } from './installers/powershell-installer.js';
import { SupportedShell } from '../../utils/shell-detection.js';

/**
 * Common installation result interface
 */
export interface InstallationResult {
  success: boolean;
  installedPath?: string;
  backupPath?: string;
  message: string;
  instructions?: string[];
  warnings?: string[];
  messageDescriptor?: InstallerMessageDescriptor;
  instructionDescriptors?: Array<InstallerMessageDescriptor | null>;
  warningDescriptors?: Array<InstallerMessageDescriptor | null>;
  // Shell-specific optional fields
  isOhMyZsh?: boolean;
  zshrcConfigured?: boolean;
  bashrcConfigured?: boolean;
  profileConfigured?: boolean;
}

export interface InstallerMessageDescriptor {
  key: InstallerMessageKey;
  values?: Record<string, string | number>;
}

export const INSTALLER_MESSAGE_KEYS = [
  'alreadyInstalled',
  'alreadyInstalledDetail',
  'tryExecBash',
  'tryExecZsh',
  'fishAlreadyAvailable',
  'tryPowerShellReload',
  'updated',
  'updatedWithBackup',
  'installedForBash',
  'installedForFish',
  'installedForPowerShell',
  'installedForZsh',
  'installedForOhMyZsh',
  'installedAndConfiguredBashrc',
  'installedAndConfiguredZshrc',
  'installedAndConfiguredPowerShell',
  'installFailed',
  'notInstalled',
  'uninstalled',
  'uninstallFailed',
  'installedSuccessfully',
  'enableBashrc',
  'restartBash',
  'bashCompletionWarning',
  'bashCompletionRequired',
  'installItWith',
  'addToBashProfile',
  'fishLoadsFrom',
  'fishAvailableImmediately',
  'enablePowerShellProfile',
  'restartPowerShell',
  'installedOhMyZshDirectory',
  'restartZsh',
  'completionsActivateAutomatically',
  'ohMyZshAutoLoadNote',
  'verifyFpath',
  'ohMyZshFpathMissing',
  'installedZshDirectory',
  'enableZshrc',
  'checkExistingLines',
  'removedFrom',
  'removedZshrc',
  'removedFromAndZshrc',
  'unableConfigureBashrc',
  'unableRemoveBashrc',
  'unableConfigureZshrc',
  'unableRemoveZshrc',
  'skipPowerShellProfile',
  'unableConfigurePowerShellProfile',
  'unableReadPowerShellProfile',
  'unableCleanPowerShellProfile',
  'unableReadCompletionFile',
] as const;

export type InstallerMessageKey = (typeof INSTALLER_MESSAGE_KEYS)[number];

export interface UninstallationResult {
  success: boolean;
  message: string;
  messageDescriptor?: InstallerMessageDescriptor;
  warnings?: string[];
  warningDescriptors?: InstallerMessageDescriptor[];
}

export type InstallerMessageReporter = (
  message: string,
  descriptor: InstallerMessageDescriptor
) => void;

/**
 * Interface for completion installers
 */
export interface CompletionInstaller {
  install(script: string): Promise<InstallationResult>;
  uninstall(): Promise<UninstallationResult>;
}

/**
 * Factory for creating completion generators and installers
 * This design makes it easy to add support for additional shells
 */
export class CompletionFactory {
  private static readonly SUPPORTED_SHELLS: SupportedShell[] = ['zsh', 'bash', 'fish', 'powershell'];

  /**
   * Create a completion generator for the specified shell
   *
   * @param shell - The target shell
   * @returns CompletionGenerator instance
   * @throws Error if shell is not supported
   */
  static createGenerator(shell: SupportedShell): CompletionGenerator {
    switch (shell) {
      case 'zsh':
        return new ZshGenerator();
      case 'bash':
        return new BashGenerator();
      case 'fish':
        return new FishGenerator();
      case 'powershell':
        return new PowerShellGenerator();
      default:
        throw new Error(`Unsupported shell: ${shell}`);
    }
  }

  /**
   * Create a completion installer for the specified shell
   *
   * @param shell - The target shell
   * @returns CompletionInstaller instance
   * @throws Error if shell is not supported
   */
  static createInstaller(shell: SupportedShell): CompletionInstaller {
    switch (shell) {
      case 'zsh':
        return new ZshInstaller();
      case 'bash':
        return new BashInstaller();
      case 'fish':
        return new FishInstaller();
      case 'powershell':
        return new PowerShellInstaller();
      default:
        throw new Error(`Unsupported shell: ${shell}`);
    }
  }

  /**
   * Check if a shell is supported
   *
   * @param shell - The shell to check
   * @returns true if the shell is supported
   */
  static isSupported(shell: string): shell is SupportedShell {
    return this.SUPPORTED_SHELLS.includes(shell as SupportedShell);
  }

  /**
   * Get list of all supported shells
   *
   * @returns Array of supported shell names
   */
  static getSupportedShells(): SupportedShell[] {
    return [...this.SUPPORTED_SHELLS];
  }
}
