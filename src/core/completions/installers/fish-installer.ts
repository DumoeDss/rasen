import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { FileSystemUtils } from '../../../utils/file-system.js';
import {
  InstallationResult,
  type InstallerMessageDescriptor,
  type UninstallationResult,
} from '../factory.js';

/**
 * Installer for Fish completion scripts.
 * Fish automatically loads completions from ~/.config/fish/completions/
 */
export class FishInstaller {
  private readonly homeDir: string;

  constructor(homeDir: string = os.homedir()) {
    this.homeDir = homeDir;
  }

  /**
   * Get the installation path for Fish completions
   *
   * @returns Installation path
   */
  getInstallationPath(): string {
    return path.join(this.homeDir, '.config', 'fish', 'completions', 'rasen.fish');
  }

  /**
   * Backup an existing completion file if it exists
   *
   * @param targetPath - Path to the file to backup
   * @returns Path to the backup file, or undefined if no backup was needed
   */
  async backupExistingFile(targetPath: string): Promise<string | undefined> {
    try {
      await fs.access(targetPath);
      // File exists, create a backup
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = `${targetPath}.backup-${timestamp}`;
      await fs.copyFile(targetPath, backupPath);
      return backupPath;
    } catch {
      // File doesn't exist, no backup needed
      return undefined;
    }
  }

  /**
   * Install the completion script
   *
   * @param completionScript - The completion script content to install
   * @returns Installation result with status and instructions
   */
  async install(completionScript: string): Promise<InstallationResult> {
    try {
      const targetPath = this.getInstallationPath();
      const warnings: string[] = [];
      const warningDescriptors: InstallerMessageDescriptor[] = [];

      // Check if already installed with same content
      let isUpdate = false;
      try {
        const existingContent = await fs.readFile(targetPath, 'utf-8');
        if (existingContent === completionScript) {
          // Already installed and up to date
          return {
            success: true,
            installedPath: targetPath,
            message: 'Completion script is already installed (up to date)',
            messageDescriptor: { key: 'alreadyInstalled' },
            instructions: [
              'The completion script is already installed and up to date.',
              'Fish automatically loads completions - they should be available immediately.',
            ],
            instructionDescriptors: [
              { key: 'alreadyInstalledDetail' },
              { key: 'fishAlreadyAvailable' },
            ],
          };
        }
        // File exists but content is different - this is an update
        isUpdate = true;
      } catch (error: any) {
        // File doesn't exist or can't be read, proceed with installation
        if (error?.code !== 'ENOENT') {
          warnings.push(
            `Warning: Could not read existing completion file at ${targetPath}: ${error.message}`
          );
          warningDescriptors.push({
            key: 'unableReadCompletionFile',
            values: { path: targetPath, detail: error.message },
          });
        }
      }

      if (!(await FileSystemUtils.canWriteFile(targetPath, { onDiagnostic: false }))) {
        throw new Error(`Path is not writable: ${targetPath}`);
      }

      // Ensure the directory exists
      const targetDir = path.dirname(targetPath);
      await fs.mkdir(targetDir, { recursive: true });

      // Backup existing file if updating
      const backupPath = isUpdate ? await this.backupExistingFile(targetPath) : undefined;

      // Write the completion script
      await fs.writeFile(targetPath, completionScript, 'utf-8');

      // Determine appropriate message
      let message: string;
      let messageDescriptor: InstallerMessageDescriptor;
      if (isUpdate) {
        message = backupPath
          ? 'Completion script updated successfully (previous version backed up)'
          : 'Completion script updated successfully';
        messageDescriptor = { key: backupPath ? 'updatedWithBackup' : 'updated' };
      } else {
        message = 'Completion script installed successfully for Fish';
        messageDescriptor = { key: 'installedForFish' };
      }

      return {
        success: true,
        installedPath: targetPath,
        backupPath,
        message,
        messageDescriptor,
        instructions: [
          'Fish automatically loads completions from ~/.config/fish/completions/',
          'Completions are available immediately - no shell restart needed.',
        ],
        instructionDescriptors: [
          { key: 'fishLoadsFrom' },
          { key: 'fishAvailableImmediately' },
        ],
        warnings: warnings.length > 0 ? warnings : undefined,
        warningDescriptors: warningDescriptors.length > 0 ? warningDescriptors : undefined,
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to install completion script: ${error instanceof Error ? error.message : String(error)}`,
        messageDescriptor: {
          key: 'installFailed',
          values: { detail: error instanceof Error ? error.message : String(error) },
        },
      };
    }
  }

  /**
   * Uninstall the completion script
   *
   * @param options - Optional uninstall options
   * @param options.yes - Skip confirmation prompt (handled by command layer)
   * @returns Uninstallation result
   */
  async uninstall(options?: { yes?: boolean }): Promise<UninstallationResult> {
    try {
      const targetPath = this.getInstallationPath();

      // Check if installed
      try {
        await fs.access(targetPath);
      } catch {
        return {
          success: false,
          message: 'Completion script is not installed',
          messageDescriptor: { key: 'notInstalled' },
        };
      }

      const targetDir = path.dirname(targetPath);
      if (!(await FileSystemUtils.canWriteFile(targetDir, { onDiagnostic: false }))) {
        throw new Error(`Path is not writable: ${targetDir}`);
      }

      // Remove the completion script
      await fs.unlink(targetPath);

      return {
        success: true,
        message: 'Completion script uninstalled successfully',
        messageDescriptor: { key: 'uninstalled' },
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to uninstall completion script: ${error instanceof Error ? error.message : String(error)}`,
        messageDescriptor: {
          key: 'uninstallFailed',
          values: { detail: error instanceof Error ? error.message : String(error) },
        },
      };
    }
  }
}
