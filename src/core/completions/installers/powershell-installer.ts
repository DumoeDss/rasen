import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { FileSystemUtils, findAllMarkerBlocks } from '../../../utils/file-system.js';
import {
  InstallationResult,
  type InstallerMessageDescriptor,
  type InstallerMessageReporter,
  type UninstallationResult,
} from '../factory.js';

/**
 * Installer for PowerShell completion scripts.
 * Works with both Windows PowerShell 5.1 and PowerShell Core 7+
 */
export class PowerShellInstaller {
  private readonly homeDir: string;

  /**
   * Markers for PowerShell profile configuration management
   */
  private readonly PROFILE_MARKERS = {
    start: '# RASEN:START',
    end: '# RASEN:END',
  };

  /**
   * Legacy markers from older installs — recognized for upgrade/uninstall only,
   * never written into new content.
   */
  private readonly LEGACY_PROFILE_MARKERS = {
    start: '# OPENSPEC:START',
    end: '# OPENSPEC:END',
  };

  constructor(homeDir: string = os.homedir()) {
    this.homeDir = homeDir;
  }

  /**
   * Detect the encoding of a file by inspecting its BOM (Byte Order Mark).
   * Returns the Node.js BufferEncoding and the raw BOM bytes to preserve on write.
   */
  private detectEncoding(buffer: Buffer): { encoding: BufferEncoding; bom: Buffer } {
    // UTF-16 LE BOM: FF FE
    if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
      return { encoding: 'utf16le', bom: Buffer.from([0xff, 0xfe]) };
    }
    // UTF-16 BE BOM: FE FF — not natively supported by Node
    if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
      throw new Error(
        'File is encoded as UTF-16 BE which is not supported. ' +
          'Please re-save as UTF-8 or UTF-16 LE, then retry.',
      );
    }
    // UTF-8 BOM: EF BB BF
    if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
      return { encoding: 'utf-8', bom: Buffer.from([0xef, 0xbb, 0xbf]) };
    }
    // No BOM → default UTF-8
    return { encoding: 'utf-8', bom: Buffer.alloc(0) };
  }

  /**
   * Read a profile file, preserving its encoding metadata for round-trip writes.
   * Throws if the file uses UTF-16 BE (unsupported by Node).
   */
  private async readProfileFile(filePath: string): Promise<{ content: string; encoding: BufferEncoding; bom: Buffer }> {
    const raw = await fs.readFile(filePath);
    const { encoding, bom } = this.detectEncoding(raw);
    const content = raw.subarray(bom.length).toString(encoding);
    return { content, encoding, bom };
  }

  /**
   * Write a profile file, preserving the original BOM and encoding.
   */
  private async writeProfileFile(filePath: string, content: string, encoding: BufferEncoding, bom: Buffer): Promise<void> {
    const body = Buffer.from(content, encoding);
    await fs.writeFile(filePath, Buffer.concat([bom, body]));
  }

  /**
   * Get PowerShell profile path
   * Prefers $PROFILE environment variable, falls back to platform defaults
   *
   * @returns Profile path
   */
  getProfilePath(): string {
    // Check $PROFILE environment variable (set when running in PowerShell)
    if (process.env.PROFILE) {
      return process.env.PROFILE;
    }

    // Fall back to platform-specific defaults
    if (process.platform === 'win32') {
      // Windows: Documents/PowerShell/Microsoft.PowerShell_profile.ps1
      return path.join(this.homeDir, 'Documents', 'PowerShell', 'Microsoft.PowerShell_profile.ps1');
    } else {
      // macOS/Linux: .config/powershell/Microsoft.PowerShell_profile.ps1
      return path.join(this.homeDir, '.config', 'powershell', 'Microsoft.PowerShell_profile.ps1');
    }
  }

  /**
   * Get all PowerShell profile paths to configure.
   * On Windows, returns both PowerShell Core and Windows PowerShell 5.1 paths.
   * On Unix, returns PowerShell Core path only.
   */
  private getAllProfilePaths(): string[] {
    // If PROFILE env var is set, use only that path
    if (process.env.PROFILE) {
      return [process.env.PROFILE];
    }

    if (process.platform === 'win32') {
      return [
        // PowerShell Core 6+ (cross-platform)
        path.join(this.homeDir, 'Documents', 'PowerShell', 'Microsoft.PowerShell_profile.ps1'),
        // Windows PowerShell 5.1 (Windows-only)
        path.join(this.homeDir, 'Documents', 'WindowsPowerShell', 'Microsoft.PowerShell_profile.ps1'),
      ];
    } else {
      // Unix systems: PowerShell Core only
      return [path.join(this.homeDir, '.config', 'powershell', 'Microsoft.PowerShell_profile.ps1')];
    }
  }

  /**
   * Get the installation path for the completion script
   *
   * @returns Installation path
   */
  getInstallationPath(): string {
    const profilePath = this.getProfilePath();
    const profileDir = path.dirname(profilePath);
    return path.join(profileDir, 'OpenSpecCompletion.ps1');
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
   * Generate PowerShell profile configuration content
   *
   * @param scriptPath - Path to the completion script
   * @returns Configuration content
   */
  private generateProfileConfig(scriptPath: string): string {
    return [
      '# Rasen shell completions configuration',
      `if (Test-Path "${scriptPath}") {`,
      `    . "${scriptPath}"`,
      '}',
    ].join('\n');
  }

  /**
   * Configure PowerShell profile to source the completion script
   *
   * @param scriptPath - Path to the completion script
   * @returns true if configured successfully, false otherwise
   */
  async configureProfile(
    scriptPath: string,
    reporter?: InstallerMessageReporter
  ): Promise<boolean> {
    const profilePaths = this.getAllProfilePaths();
    let anyConfigured = false;

    for (const profilePath of profilePaths) {
      try {
        const profileDir = path.dirname(profilePath);
        let profileExists = false;
        try {
          await fs.access(profilePath);
          profileExists = true;
        } catch (err: any) {
          if (err?.code !== 'ENOENT') {
            throw err;
          }
        }

        if (!profileExists) {
          if (!(await FileSystemUtils.canWriteFile(profilePath, { onDiagnostic: false }))) {
            throw new Error(`Path is not writable: ${profilePath}`);
          }
          await fs.mkdir(profileDir, { recursive: true });
        }

        let profileContent = '';
        let fileEncoding: BufferEncoding = 'utf-8';
        let fileBom: Buffer = Buffer.alloc(0);
        try {
          const file = await this.readProfileFile(profilePath);
          profileContent = file.content;
          fileEncoding = file.encoding;
          fileBom = file.bom;
        } catch (err: any) {
          // If the file doesn't exist that's fine — we'll create it as UTF-8.
          // Any other read error (permissions, unsupported encoding, etc.) → skip this profile.
          if (err?.code === 'ENOENT') {
            // keep defaults
          } else {
            const detail = err?.message ?? String(err);
            reporter?.(
              `Warning: Skipping ${profilePath}: ${detail}`,
              { key: 'skipPowerShellProfile', values: { path: profilePath, detail } }
            );
            continue;
          }
        }

        // Check if already configured under the current markers. PowerShell's managed
        // block always appends a trailing description after the start marker on the same
        // line (see managedBlockLines below), so this consumer opts into the relaxed
        // line-start-only match — bash/zsh keep the strict default via updateFileWithMarkers.
        const scriptLine = `. "${scriptPath}"`;
        const existingBlocks = findAllMarkerBlocks(
          profileContent,
          [this.PROFILE_MARKERS, this.LEGACY_PROFILE_MARKERS],
          { strict: false }
        );

        if (
          existingBlocks.length === 1 &&
          existingBlocks[0].startMarker === this.PROFILE_MARKERS.start &&
          profileContent.includes(scriptLine)
        ) {
          continue; // Already configured with current markers and no orphan to clean up, skip
        }
        if (existingBlocks.length === 0 && profileContent.includes(scriptLine)) {
          continue; // Script already referenced outside a managed block, skip
        }

        const managedBlockLines = [
          `${this.PROFILE_MARKERS.start} - Rasen completion (managed block, do not edit manually)`,
          scriptLine,
          this.PROFILE_MARKERS.end,
        ].join('\n');

        let newContent: string;
        if (existingBlocks.length > 0) {
          // Replace the first block (by position) in place with fresh content; drop every
          // other recognized block so a profile never ends up with more than one.
          const [first, ...rest] = existingBlocks;
          let result = profileContent.substring(0, first.startIndex) + managedBlockLines;
          let cursor = first.endIndex + first.endMarker.length;

          for (const match of rest) {
            result += profileContent.substring(cursor, match.startIndex);
            cursor = match.endIndex + match.endMarker.length;
          }
          result += profileContent.substring(cursor);

          newContent = rest.length > 0 ? result.replace(/(\r?\n){3,}/g, '\n\n') : result;
        } else {
          // Append a new managed block
          newContent = profileContent + ['', managedBlockLines, ''].join('\n');
        }

        if (!(await FileSystemUtils.canWriteFile(profilePath, { onDiagnostic: false }))) {
          throw new Error(`Path is not writable: ${profilePath}`);
        }
        await this.writeProfileFile(profilePath, newContent, fileEncoding, fileBom);
        anyConfigured = true;
      } catch (error) {
        // Continue to next profile if this one fails
        const detail = String(error);
        reporter?.(
          `Warning: Could not configure ${profilePath}: ${detail}`,
          {
            key: 'unableConfigurePowerShellProfile',
            values: { path: profilePath, detail },
          }
        );
      }
    }

    return anyConfigured;
  }

  /**
   * Remove PowerShell profile configuration
   * Used during uninstallation
   *
   * @returns true if removed successfully, false otherwise
   */
  async removeProfileConfig(reporter?: InstallerMessageReporter): Promise<boolean> {
    const profilePaths = this.getAllProfilePaths();
    let anyRemoved = false;

    for (const profilePath of profilePaths) {
      try {
        // Read profile content with encoding detection
        let profileContent: string;
        let fileEncoding: BufferEncoding = 'utf-8';
        let fileBom: Buffer = Buffer.alloc(0);
        try {
          const file = await this.readProfileFile(profilePath);
          profileContent = file.content;
          fileEncoding = file.encoding;
          fileBom = file.bom;
        } catch (err: any) {
          if (err?.code === 'ENOENT') {
            continue; // Profile doesn't exist, nothing to remove
          }
          const detail = err?.message ?? String(err);
          reporter?.(
            `Warning: Could not read ${profilePath}: ${detail}`,
            { key: 'unableReadPowerShellProfile', values: { path: profilePath, detail } }
          );
          continue;
        }

        // Remove every managed block under either the current or legacy marker family.
        // Relaxed line-start-only match, same reasoning as configureProfile() above.
        const existingBlocks = findAllMarkerBlocks(
          profileContent,
          [this.PROFILE_MARKERS, this.LEGACY_PROFILE_MARKERS],
          { strict: false }
        );

        if (existingBlocks.length === 0) {
          continue; // No managed block found under either marker family
        }

        // Cursor-splice out every block's span, collecting the surrounding pieces.
        const pieces: string[] = [];
        let cursor = 0;
        for (const match of existingBlocks) {
          pieces.push(profileContent.substring(cursor, match.startIndex));
          cursor = match.endIndex + match.endMarker.length;
        }
        pieces.push(profileContent.substring(cursor));

        // Trim the edge of each piece that touches a removed block, then join and trim
        // the whole result — generalizes the single-block before/after trim to N blocks.
        const trimmedPieces = pieces.map((piece, index) => {
          let result = piece;
          if (index > 0) {
            result = result.trimStart();
          }
          if (index < pieces.length - 1) {
            result = result.trimEnd();
          }
          return result;
        });

        const newContent = trimmedPieces.join('\n').trim() + '\n';

        if (!(await FileSystemUtils.canWriteFile(profilePath, { onDiagnostic: false }))) {
          throw new Error(`Path is not writable: ${profilePath}`);
        }
        await this.writeProfileFile(profilePath, newContent, fileEncoding, fileBom);
        anyRemoved = true;
      } catch (error) {
        const detail = String(error);
        reporter?.(
          `Warning: Could not clean ${profilePath}: ${detail}`,
          { key: 'unableCleanPowerShellProfile', values: { path: profilePath, detail } }
        );
      }
    }

    return anyRemoved;
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
      const reportWarning: InstallerMessageReporter = (message, descriptor) => {
        warnings.push(message);
        warningDescriptors.push(descriptor);
      };

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
              'If completions are not working, try restarting PowerShell or run: . $PROFILE',
            ],
            instructionDescriptors: [
              { key: 'alreadyInstalledDetail' },
              { key: 'tryPowerShellReload' },
            ],
          };
        }
        // File exists but content is different - this is an update
        isUpdate = true;
      } catch (error: any) {
        // File doesn't exist or can't be read, proceed with installation
        if (error?.code !== 'ENOENT') {
          reportWarning(
            `Warning: Could not read existing completion file at ${targetPath}: ${error.message}`,
            {
              key: 'unableReadCompletionFile',
              values: { path: targetPath, detail: error.message },
            }
          );
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

      // Auto-configure PowerShell profile
      const profileConfigured = await this.configureProfile(targetPath, reportWarning);

      // Generate instructions if profile wasn't auto-configured
      const instructions = profileConfigured ? undefined : this.generateInstructions(targetPath);
      const instructionDescriptors = profileConfigured
        ? undefined
        : this.generateInstructionDescriptors(this.getProfilePath());

      // Determine appropriate message
      let message: string;
      let messageDescriptor: InstallerMessageDescriptor;
      if (isUpdate) {
        message = backupPath
          ? 'Completion script updated successfully (previous version backed up)'
          : 'Completion script updated successfully';
        messageDescriptor = { key: backupPath ? 'updatedWithBackup' : 'updated' };
      } else {
        message = profileConfigured
          ? 'Completion script installed and PowerShell profile configured successfully'
          : 'Completion script installed successfully for PowerShell';
        messageDescriptor = {
          key: profileConfigured
            ? 'installedAndConfiguredPowerShell'
            : 'installedForPowerShell',
        };
      }

      return {
        success: true,
        installedPath: targetPath,
        backupPath,
        profileConfigured,
        message,
        messageDescriptor,
        instructions,
        instructionDescriptors,
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
   * Generate user instructions for enabling completions
   *
   * @param installedPath - Path where the script was installed
   * @returns Array of instruction strings
   */
  private generateInstructions(installedPath: string): string[] {
    const profilePath = this.getProfilePath();

    return [
      'Completion script installed successfully.',
      '',
      `To enable completions, add the following to your PowerShell profile (${profilePath}):`,
      '',
      '  # Source Rasen completions',
      `  if (Test-Path "${installedPath}") {`,
      `      . "${installedPath}"`,
      '  }',
      '',
      'Then restart PowerShell or run: . $PROFILE',
    ];
  }

  private generateInstructionDescriptors(
    profilePath: string
  ): Array<InstallerMessageDescriptor | null> {
    return [
      { key: 'installedSuccessfully' },
      null,
      { key: 'enablePowerShellProfile', values: { path: profilePath } },
      null,
      null,
      null,
      null,
      null,
      null,
      { key: 'restartPowerShell' },
    ];
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
      const warnings: string[] = [];
      const warningDescriptors: InstallerMessageDescriptor[] = [];
      const reportWarning: InstallerMessageReporter = (message, descriptor) => {
        warnings.push(message);
        warningDescriptors.push(descriptor);
      };

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

      // Remove profile configuration
      await this.removeProfileConfig(reportWarning);

      return {
        success: true,
        message: 'Completion script uninstalled successfully',
        messageDescriptor: { key: 'uninstalled' },
        warnings: warnings.length > 0 ? warnings : undefined,
        warningDescriptors: warningDescriptors.length > 0 ? warningDescriptors : undefined,
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
