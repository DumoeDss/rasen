import * as fs from 'node:fs';
import * as path from 'node:path';
import { TextDecoder } from 'node:util';

import { WORKFLOW_LIMITS } from './limits.js';
import {
  checkPortableRelativePath,
  isOsJunkEntryName,
  portablePathCollisionKey,
} from './path-policy.js';
import type { WorkflowDiagnostic } from './types.js';

export interface LoadedWorkflowFile {
  path: string;
  content: string;
  bytes: Buffer;
}

export interface LoadedWorkflowTree {
  files: LoadedWorkflowFile[];
  diagnostics: WorkflowDiagnostic[];
}

class WorkflowEntryChangedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkflowEntryChangedError';
  }
}

function sameFileIdentity(left: fs.BigIntStats, right: fs.BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function hasStableFileIdentity(stats: fs.BigIntStats): boolean {
  return stats.ino !== 0n;
}

function sameFileVersion(left: fs.BigIntStats, right: fs.BigIntStats): boolean {
  return (
    sameFileIdentity(left, right) &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  );
}

function assertDirectoryUnchanged(
  directory: string,
  expected: fs.BigIntStats
): void {
  let current: fs.BigIntStats;
  try {
    current = fs.lstatSync(directory, { bigint: true });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new WorkflowEntryChangedError(
      `Directory changed or became unreadable while it was being traversed: ${reason}`
    );
  }

  if (!hasStableFileIdentity(expected) || !hasStableFileIdentity(current)) {
    throw new WorkflowEntryChangedError(
      'Platform cannot safely verify directory identity while traversing the workflow source'
    );
  }
  if (
    expected.isSymbolicLink() ||
    !expected.isDirectory() ||
    current.isSymbolicLink() ||
    !current.isDirectory() ||
    !sameFileVersion(expected, current)
  ) {
    throw new WorkflowEntryChangedError('Directory changed while it was being traversed');
  }
}

function readValidatedFile(absolutePath: string, expected: fs.BigIntStats): Buffer {
  const noFollow = fs.constants.O_NOFOLLOW;
  const hasNoFollow = typeof noFollow === 'number' && noFollow !== 0;
  let descriptor: number | undefined;

  try {
    descriptor = fs.openSync(
      absolutePath,
      fs.constants.O_RDONLY | (hasNoFollow ? noFollow : 0)
    );
    const opened = fs.fstatSync(descriptor, { bigint: true });
    const currentPath = fs.lstatSync(absolutePath, { bigint: true });
    if (
      !opened.isFile() ||
      currentPath.isSymbolicLink() ||
      !currentPath.isFile() ||
      !sameFileVersion(expected, opened) ||
      !sameFileVersion(opened, currentPath)
    ) {
      throw new WorkflowEntryChangedError('File changed while it was being opened');
    }
    if (!hasNoFollow && !hasStableFileIdentity(opened)) {
      throw new WorkflowEntryChangedError(
        'Platform cannot safely verify file identity without no-follow support'
      );
    }

    const bytes = fs.readFileSync(descriptor);
    const afterRead = fs.fstatSync(descriptor, { bigint: true });
    const finalPath = fs.lstatSync(absolutePath, { bigint: true });
    if (
      finalPath.isSymbolicLink() ||
      !finalPath.isFile() ||
      !sameFileVersion(opened, afterRead) ||
      !sameFileVersion(afterRead, finalPath) ||
      afterRead.size !== BigInt(bytes.length)
    ) {
      throw new WorkflowEntryChangedError('File changed while it was being read');
    }
    return bytes;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function diagnostic(
  code: string,
  message: string,
  sourcePath: string,
  logicalPath?: string,
  details?: WorkflowDiagnostic['details']
): WorkflowDiagnostic {
  return { code, severity: 'error', message, sourcePath, path: logicalPath, details };
}

export function loadWorkflowSourceTree(sourcePath: string): LoadedWorkflowTree {
  const diagnostics: WorkflowDiagnostic[] = [];
  const files: LoadedWorkflowFile[] = [];
  const collisionKeys = new Map<string, string>();
  let totalBytes = 0;

  let rootStats: fs.BigIntStats;
  try {
    rootStats = fs.lstatSync(sourcePath, { bigint: true });
  } catch (error) {
    return {
      files,
      diagnostics: [
        diagnostic(
          'source_unreadable',
          error instanceof Error ? error.message : String(error),
          sourcePath
        ),
      ],
    };
  }
  if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
    return {
      files,
      diagnostics: [
        diagnostic('source_not_directory', 'Workflow source must be a real directory', sourcePath),
      ],
    };
  }

  const visit = (
    directory: string,
    prefix: string,
    expectedDirectory: fs.BigIntStats
  ): void => {
    const filesStart = files.length;
    const diagnosticsStart = diagnostics.length;
    const totalBytesStart = totalBytes;
    const collisionKeysBefore = new Set(collisionKeys.keys());

    try {
      assertDirectoryUnchanged(directory, expectedDirectory);
      const entries = fs.readdirSync(directory, { withFileTypes: true });
      assertDirectoryUnchanged(directory, expectedDirectory);

      entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
      for (const entry of entries) {
        if (isOsJunkEntryName(entry.name)) continue;
        assertDirectoryUnchanged(directory, expectedDirectory);
        try {
          const logicalPath = prefix ? `${prefix}/${entry.name}` : entry.name;
          const absolutePath = path.join(directory, entry.name);
          const pathCheck = checkPortableRelativePath(logicalPath);
          if (!pathCheck.valid) {
            diagnostics.push(
              diagnostic(pathCheck.code!, pathCheck.message!, absolutePath, logicalPath)
            );
            continue;
          }

          let stats: fs.BigIntStats;
          try {
            stats = fs.lstatSync(absolutePath, { bigint: true });
          } catch (error) {
            diagnostics.push(
              diagnostic(
                'entry_unreadable',
                error instanceof Error ? error.message : String(error),
                absolutePath,
                logicalPath
              )
            );
            continue;
          }
          if (stats.isSymbolicLink()) {
            diagnostics.push(
              diagnostic('symlink_forbidden', 'Symbolic links are not allowed', absolutePath, logicalPath)
            );
            continue;
          }
          if (stats.isDirectory()) {
            visit(absolutePath, logicalPath, stats);
            continue;
          }
          if (!stats.isFile()) {
            diagnostics.push(
              diagnostic('special_file_forbidden', 'Only regular files are allowed', absolutePath, logicalPath)
            );
            continue;
          }

          if (files.length >= WORKFLOW_LIMITS.maxEntries) {
            diagnostics.push(
              diagnostic(
                'entry_limit_exceeded',
                `Workflow contains more than ${WORKFLOW_LIMITS.maxEntries} files`,
                sourcePath,
                logicalPath,
                { actual: files.length + 1, limit: WORKFLOW_LIMITS.maxEntries }
              )
            );
            continue;
          }
          if (stats.size > BigInt(WORKFLOW_LIMITS.maxFileBytes)) {
            diagnostics.push(
              diagnostic(
                'file_too_large',
                `File exceeds ${WORKFLOW_LIMITS.maxFileBytes} bytes`,
                absolutePath,
                logicalPath,
                { actual: Number(stats.size), limit: WORKFLOW_LIMITS.maxFileBytes }
              )
            );
            continue;
          }

          const collisionKey = portablePathCollisionKey(logicalPath);
          const existing = collisionKeys.get(collisionKey);
          if (existing) {
            diagnostics.push(
              diagnostic(
                'path_collision',
                `Path collides with "${existing}" under portable matching rules`,
                absolutePath,
                logicalPath,
                { conflictingPath: existing }
              )
            );
            continue;
          }
          collisionKeys.set(collisionKey, logicalPath);

          let bytes: Buffer;
          try {
            bytes = readValidatedFile(absolutePath, stats);
          } catch (error) {
            diagnostics.push(
              diagnostic(
                error instanceof WorkflowEntryChangedError ? 'entry_changed' : 'file_unreadable',
                error instanceof Error ? error.message : String(error),
                absolutePath,
                logicalPath
              )
            );
            continue;
          }
          if (bytes.length > WORKFLOW_LIMITS.maxFileBytes) {
            diagnostics.push(
              diagnostic(
                'file_too_large',
                `File exceeds ${WORKFLOW_LIMITS.maxFileBytes} bytes`,
                absolutePath,
                logicalPath,
                { actual: bytes.length, limit: WORKFLOW_LIMITS.maxFileBytes }
              )
            );
            continue;
          }
          totalBytes += bytes.length;
          if (totalBytes > WORKFLOW_LIMITS.maxTotalContentBytes) {
            diagnostics.push(
              diagnostic(
                'content_limit_exceeded',
                `Workflow content exceeds ${WORKFLOW_LIMITS.maxTotalContentBytes} bytes`,
                sourcePath,
                logicalPath,
                { actual: totalBytes, limit: WORKFLOW_LIMITS.maxTotalContentBytes }
              )
            );
            continue;
          }
          if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
            diagnostics.push(
              diagnostic('utf8_bom_forbidden', 'UTF-8 BOM is not allowed', absolutePath, logicalPath)
            );
            continue;
          }

          try {
            const content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
            files.push({ path: logicalPath, content, bytes });
          } catch {
            diagnostics.push(
              diagnostic('utf8_invalid', 'File is not valid UTF-8', absolutePath, logicalPath)
            );
          }
        } finally {
          assertDirectoryUnchanged(directory, expectedDirectory);
        }
      }
      assertDirectoryUnchanged(directory, expectedDirectory);
    } catch (error) {
      files.splice(filesStart);
      diagnostics.splice(diagnosticsStart);
      totalBytes = totalBytesStart;
      for (const key of collisionKeys.keys()) {
        if (!collisionKeysBefore.has(key)) collisionKeys.delete(key);
      }
      diagnostics.push(
        diagnostic(
          error instanceof WorkflowEntryChangedError ? 'directory_changed' : 'directory_unreadable',
          error instanceof Error ? error.message : String(error),
          directory,
          prefix || undefined
        )
      );
    }
  };

  visit(sourcePath, '', rootStats);
  files.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  return { files, diagnostics };
}
