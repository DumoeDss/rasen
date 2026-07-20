import * as nodeFs from 'fs';
import path from 'path';

const fs = nodeFs.promises;
const { constants: fsConstants } = nodeFs;

export interface CanWriteFileOptions {
  /** Omit to retain console.debug diagnostics; pass false to suppress them. */
  onDiagnostic?: false | ((message: string) => void);
}

function hasOwnerGroupOrOtherWriteBit(stats: nodeFs.Stats): boolean {
  return (stats.mode & 0o222) !== 0;
}

function hasOwnerGroupOrOtherExecuteBit(stats: nodeFs.Stats): boolean {
  return (stats.mode & 0o111) !== 0;
}

async function hasWritableModeAndAccess(targetPath: string): Promise<boolean> {
  try {
    const stats = await fs.stat(targetPath);

    // POSIX root can often write despite mode bits, but Rasen should respect
    // explicit read-only file/directory modes when deciding whether an install
    // path is user-writable. This also keeps permission checks deterministic in
    // root-run CI containers. On Windows, chmod mode bits are not authoritative,
    // so rely on fs.access below.
    if (process.platform !== 'win32' && !hasOwnerGroupOrOtherWriteBit(stats)) {
      return false;
    }
    if (process.platform !== 'win32' && stats.isDirectory() && !hasOwnerGroupOrOtherExecuteBit(stats)) {
      return false;
    }

    const accessMode = stats.isDirectory()
      ? fsConstants.W_OK | fsConstants.X_OK
      : fsConstants.W_OK;
    await fs.access(targetPath, accessMode);
    return true;
  } catch {
    return false;
  }
}

function isMarkerOnOwnLine(content: string, markerIndex: number, markerLength: number): boolean {
  let leftIndex = markerIndex - 1;
  while (leftIndex >= 0 && content[leftIndex] !== '\n') {
    const char = content[leftIndex];
    if (char !== ' ' && char !== '\t' && char !== '\r') {
      return false;
    }
    leftIndex--;
  }

  let rightIndex = markerIndex + markerLength;
  while (rightIndex < content.length && content[rightIndex] !== '\n') {
    const char = content[rightIndex];
    if (char !== ' ' && char !== '\t' && char !== '\r') {
      return false;
    }
    rightIndex++;
  }

  return true;
}

function findMarkerIndex(
  content: string,
  marker: string,
  fromIndex = 0
): number {
  let currentIndex = content.indexOf(marker, fromIndex);

  while (currentIndex !== -1) {
    if (isMarkerOnOwnLine(content, currentIndex, marker.length)) {
      return currentIndex;
    }

    currentIndex = content.indexOf(marker, currentIndex + marker.length);
  }

  return -1;
}

/**
 * Left-side-only variant of isMarkerOnOwnLine: only requires the marker to start its
 * line (nothing but whitespace before it). Unlike isMarkerOnOwnLine, content trailing
 * the marker on the same line is allowed — needed for consumers (like the PowerShell
 * profile installer) that write a human-readable comment after the marker literal
 * itself, e.g. "# RASEN:START - Rasen completion (managed block, do not edit manually)".
 */
function isMarkerAtLineStart(content: string, markerIndex: number): boolean {
  let leftIndex = markerIndex - 1;
  while (leftIndex >= 0 && content[leftIndex] !== '\n') {
    const char = content[leftIndex];
    if (char !== ' ' && char !== '\t' && char !== '\r') {
      return false;
    }
    leftIndex--;
  }
  return true;
}

function findMarkerAtLineStart(
  content: string,
  marker: string,
  fromIndex = 0
): number {
  let currentIndex = content.indexOf(marker, fromIndex);

  while (currentIndex !== -1) {
    if (isMarkerAtLineStart(content, currentIndex)) {
      return currentIndex;
    }

    currentIndex = content.indexOf(marker, currentIndex + marker.length);
  }

  return -1;
}

export class FileSystemUtils {
  /**
   * Converts a path to use forward slashes (POSIX style).
   * Essential for cross-platform compatibility with glob libraries like fast-glob.
   */
  static toPosixPath(p: string): string {
    return p.replace(/\\/g, '/');
  }

  /**
   * Returns a canonical absolute path when the target exists.
   * Falls back to path.resolve() so callers can still produce a stable absolute path.
   */
  static canonicalizeExistingPath(targetPath: string): string {
    try {
      // Prefer the native resolver so Windows short-path aliases are expanded.
      return nodeFs.realpathSync.native(targetPath);
    } catch {
      try {
        return nodeFs.realpathSync(targetPath);
      } catch {
        return path.resolve(targetPath);
      }
    }
  }

  private static isWindowsBasePath(basePath: string): boolean {
    return /^[A-Za-z]:[\\/]/.test(basePath) || basePath.startsWith('\\');
  }

  private static normalizeSegments(segments: string[]): string[] {
    return segments
      .flatMap((segment) => segment.split(/[\\/]+/u))
      .filter((part) => part.length > 0);
  }

  static joinPath(basePath: string, ...segments: string[]): string {
    const normalizedSegments = this.normalizeSegments(segments);

    if (this.isWindowsBasePath(basePath)) {
      const normalizedBasePath = path.win32.normalize(basePath);
      return normalizedSegments.length
        ? path.win32.join(normalizedBasePath, ...normalizedSegments)
        : normalizedBasePath;
    }

    const posixBasePath = basePath.replace(/\\/g, '/');

    return normalizedSegments.length
      ? path.posix.join(posixBasePath, ...normalizedSegments)
      : path.posix.normalize(posixBasePath);
  }

  static async createDirectory(dirPath: string): Promise<void> {
    await fs.mkdir(dirPath, { recursive: true });
  }

  static async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        console.debug(`Unable to check if file exists at ${filePath}: ${error.message}`);
      }
      return false;
    }
  }

  /**
   * Finds the first existing parent directory by walking up the directory tree.
   * @param dirPath Starting directory path
   * @returns The first existing directory path, or null if root is reached without finding one
   */
  private static reportCanWriteDiagnostic(
    message: string,
    options: CanWriteFileOptions | undefined
  ): void {
    if (options?.onDiagnostic === false) {
      return;
    }

    if (options?.onDiagnostic) {
      options.onDiagnostic(message);
      return;
    }

    console.debug(message);
  }

  private static async findFirstExistingDirectory(
    dirPath: string,
    options?: CanWriteFileOptions
  ): Promise<string | null> {
    let currentDir = dirPath;

    while (true) {
      try {
        const stats = await fs.stat(currentDir);
        if (stats.isDirectory()) {
          return currentDir;
        }
        // Path component exists but is not a directory (edge case)
        this.reportCanWriteDiagnostic(
          `Path component ${currentDir} exists but is not a directory`,
          options
        );
        return null;
      } catch (error: any) {
        if (error.code === 'ENOENT') {
          // Directory doesn't exist, move up one level
          const parentDir = path.dirname(currentDir);
          if (parentDir === currentDir) {
            // Reached filesystem root without finding existing directory
            return null;
          }
          currentDir = parentDir;
        } else {
          // Unexpected error (permissions, I/O error, etc.)
          this.reportCanWriteDiagnostic(
            `Error checking directory ${currentDir}: ${error.message}`,
            options
          );
          return null;
        }
      }
    }
  }

  static async canWriteFile(
    filePath: string,
    options?: CanWriteFileOptions
  ): Promise<boolean> {
    try {
      const stats = await fs.stat(filePath);

      if (stats.isDirectory()) {
        return hasWritableModeAndAccess(filePath);
      }

      if (!stats.isFile()) {
        return true;
      }

      return hasWritableModeAndAccess(filePath);
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        // File doesn't exist - find first existing parent directory and check its permissions
        const parentDir = path.dirname(filePath);
        const existingDir = await this.findFirstExistingDirectory(parentDir, options);

        if (existingDir === null) {
          // No existing parent directory found (edge case)
          return false;
        }

        // Check if the existing parent directory is writable.
        return hasWritableModeAndAccess(existingDir);
      }

      this.reportCanWriteDiagnostic(
        `Unable to determine write permissions for ${filePath}: ${error.message}`,
        options
      );
      return false;
    }
  }

  static async directoryExists(dirPath: string): Promise<boolean> {
    try {
      const stats = await fs.stat(dirPath);
      return stats.isDirectory();
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        console.debug(`Unable to check if directory exists at ${dirPath}: ${error.message}`);
      }
      return false;
    }
  }

  static async writeFile(filePath: string, content: string): Promise<void> {
    const dir = path.dirname(filePath);
    await this.createDirectory(dir);
    await fs.writeFile(filePath, content, 'utf-8');
  }

  static async readFile(filePath: string): Promise<string> {
    return await fs.readFile(filePath, 'utf-8');
  }

  /**
   * @param legacyMarkers - Optional legacy start/end marker pair to also recognize when
   * locating an existing managed block (e.g. a pre-existing block written by an older
   * version under a different marker literal). When found, that block is replaced in
   * place, but the content is always (re)written using the current `startMarker`/`endMarker`
   * passed above — the legacy pair is never written into new content.
   *
   * When blocks under more than one recognized marker family are present (e.g. an
   * interrupted upgrade left both a current and a legacy block behind), the first block
   * found (by position in the file) is refreshed in place and every other recognized
   * block is removed — a profile never ends up with more than one managed block.
   */
  static async updateFileWithMarkers(
    filePath: string,
    content: string,
    startMarker: string,
    endMarker: string,
    legacyMarkers?: { start: string; end: string }
  ): Promise<void> {
    let existingContent = '';

    if (await this.fileExists(filePath)) {
      existingContent = await this.readFile(filePath);

      // Preserve the pre-existing contract: a malformed *current* marker pair (only one
      // of start/end present) is a hard error. A malformed legacy pair is not — it is
      // silently skipped by findAllMarkerBlocks, same as before this function recognized
      // multiple families.
      const primaryMatches = findAllMarkerBlocks(existingContent, [{ start: startMarker, end: endMarker }]);
      if (primaryMatches.length === 0) {
        const hasStart = findMarkerIndex(existingContent, startMarker) !== -1;
        const hasEnd = findMarkerIndex(existingContent, endMarker) !== -1;
        if (hasStart !== hasEnd) {
          throw new Error(`Invalid marker state in ${filePath}. Found start: ${hasStart}, Found end: ${hasEnd}`);
        }
      }

      const families = [{ start: startMarker, end: endMarker }, ...(legacyMarkers ? [legacyMarkers] : [])];
      const matches = findAllMarkerBlocks(existingContent, families);

      if (matches.length > 0) {
        const [first, ...rest] = matches;
        let result = existingContent.substring(0, first.startIndex)
          + startMarker + '\n' + content + '\n' + endMarker;
        let cursor = first.endIndex + first.endMarker.length;

        for (const match of rest) {
          result += existingContent.substring(cursor, match.startIndex);
          cursor = match.endIndex + match.endMarker.length;
        }
        result += existingContent.substring(cursor);

        // Only collapse blank-line runs when a dedup actually dropped a block — the
        // single-match path must stay byte-identical to the pre-multi-block-aware behavior.
        existingContent = rest.length > 0 ? result.replace(/(\r?\n){3,}/g, '\n\n') : result;
      } else {
        existingContent = startMarker + '\n' + content + '\n' + endMarker + '\n\n' + existingContent;
      }
    } else {
      existingContent = startMarker + '\n' + content + '\n' + endMarker;
    }

    await this.writeFile(filePath, existingContent);
  }

  static async ensureWritePermissions(dirPath: string): Promise<boolean> {
    try {
      // If directory doesn't exist, check parent directory permissions
      if (!await this.directoryExists(dirPath)) {
        const parentDir = path.dirname(dirPath);
        if (!await this.directoryExists(parentDir)) {
          await this.createDirectory(parentDir);
        }
        return await this.ensureWritePermissions(parentDir);
      }

      const testFile = path.join(dirPath, '.openspec-test-' + Date.now() + '-' + Math.random().toString(36).slice(2));
      await fs.writeFile(testFile, '');

      // On Windows, file may be temporarily locked by antivirus or indexing services.
      // Retry unlink with a small delay if it fails.
      const maxRetries = 3;
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          await fs.unlink(testFile);
          break;
        } catch (unlinkError: any) {
          if (attempt === maxRetries - 1) {
            // Last attempt failed, but we successfully wrote the file, so permissions are OK
            // Just log and continue - the temp file will be cleaned up eventually
            console.debug(`Could not clean up test file ${testFile}: ${unlinkError.message}`);
          } else {
            // Wait briefly before retrying (Windows file lock release)
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
        }
      }
      return true;
    } catch (error: any) {
      console.debug(`Insufficient permissions to write to ${dirPath}: ${error.message}`);
      return false;
    }
  }
}

/**
 * A single recognized marker block found in file content.
 */
export interface MarkerBlockMatch {
  startIndex: number;
  /** Index of the start of the end marker (not past it — mirrors findMarkerIndex's return). */
  endIndex: number;
  startMarker: string;
  endMarker: string;
}

/**
 * Finds every recognized marker block across one or more marker families in `content`,
 * sorted by position (`startIndex` ascending) regardless of which family each match
 * belongs to or the order `markerFamilies` was given in.
 *
 * Within a family, blocks are found left-to-right, non-overlapping (each match's search
 * resumes after the previous match's end marker). If a family is in a malformed state —
 * a start marker with no matching end marker found after it — that family is skipped
 * entirely (no matches contributed for it) rather than throwing; callers that need strict
 * validation of a specific family should check for that themselves.
 *
 * @param options.strict - When `true` (the default), a marker only matches if it is
 * *alone* on its line — nothing but whitespace before or after it (mirrors the
 * pre-existing `isMarkerOnOwnLine`/`findMarkerIndex` behavior used elsewhere in this
 * module, e.g. `removeMarkerBlock`). This is required for bash/zsh, whose markers are
 * always bare (`# RASEN:START`) — matching anything looser risks swallowing a user's own
 * unrelated comment that merely happens to start with the same literal, silently deleting
 * their content. Pass `strict: false` only for consumers whose managed-block format
 * deliberately appends trailing text after the marker on the same line (currently just
 * the PowerShell profile installer, e.g. `# RASEN:START - Rasen completion (managed
 * block, do not edit manually)`) — in that mode only the left side (start-of-line) is
 * checked.
 *
 * Pure function: does not read or write files.
 */
export function findAllMarkerBlocks(
  content: string,
  markerFamilies: Array<{ start: string; end: string }>,
  options?: { strict?: boolean }
): MarkerBlockMatch[] {
  const strict = options?.strict ?? true;
  const findIndex = strict ? findMarkerIndex : findMarkerAtLineStart;
  const matches: MarkerBlockMatch[] = [];

  for (const family of markerFamilies) {
    const familyMatches: MarkerBlockMatch[] = [];
    let cursor = 0;
    let malformed = false;

    while (cursor <= content.length) {
      const startIndex = findIndex(content, family.start, cursor);
      if (startIndex === -1) {
        break;
      }

      const endIndex = findIndex(content, family.end, startIndex + family.start.length);
      if (endIndex === -1) {
        malformed = true;
        break;
      }

      familyMatches.push({
        startIndex,
        endIndex,
        startMarker: family.start,
        endMarker: family.end,
      });
      cursor = endIndex + family.end.length;
    }

    if (!malformed) {
      matches.push(...familyMatches);
    }
  }

  matches.sort((a, b) => a.startIndex - b.startIndex);
  return matches;
}

/**
 * Removes a marker block from file content.
 * Only removes markers that are on their own lines (ignores inline mentions).
 * Cleans up double blank lines that may result from removal.
 *
 * @param content - File content with markers
 * @param startMarker - The start marker string
 * @param endMarker - The end marker string
 * @returns Content with marker block removed, or original content if markers not found/invalid
 */
export function removeMarkerBlock(
  content: string,
  startMarker: string,
  endMarker: string
): string {
  const startIndex = findMarkerIndex(content, startMarker);
  const endIndex = startIndex !== -1
    ? findMarkerIndex(content, endMarker, startIndex + startMarker.length)
    : findMarkerIndex(content, endMarker);

  if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
    return content;
  }

  // Find the start of the line containing the start marker
  let lineStart = startIndex;
  while (lineStart > 0 && content[lineStart - 1] !== '\n') {
    lineStart--;
  }

  // Find the end of the line containing the end marker
  let lineEnd = endIndex + endMarker.length;
  while (lineEnd < content.length && content[lineEnd] !== '\n') {
    lineEnd++;
  }
  // Include the trailing newline if present
  if (lineEnd < content.length && content[lineEnd] === '\n') {
    lineEnd++;
  }

  const before = content.substring(0, lineStart);
  const after = content.substring(lineEnd);

  // Clean up double blank lines (handle both Unix \n and Windows \r\n)
  let result = before + after;
  result = result.replace(/(\r?\n){3,}/g, '\n\n');

  // Trim trailing whitespace but preserve leading whitespace and original newline style
  if (result.trimEnd() === '') {
    return '';
  }
  const newline = content.includes('\r\n') ? '\r\n' : '\n';
  return result.trimEnd() + newline;
}
