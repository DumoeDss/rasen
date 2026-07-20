import * as fs from 'node:fs';
import * as path from 'node:path';
import { TextDecoder } from 'node:util';

import { WORKFLOW_LIMITS } from './limits.js';
import { checkPortableRelativePath, portablePathCollisionKey } from './path-policy.js';
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

  let rootStats: fs.Stats;
  try {
    rootStats = fs.lstatSync(sourcePath);
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

  const visit = (directory: string, prefix: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch (error) {
      diagnostics.push(
        diagnostic(
          'directory_unreadable',
          error instanceof Error ? error.message : String(error),
          directory,
          prefix || undefined
        )
      );
      return;
    }

    entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
    for (const entry of entries) {
      const logicalPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolutePath = path.join(directory, entry.name);
      const pathCheck = checkPortableRelativePath(logicalPath);
      if (!pathCheck.valid) {
        diagnostics.push(
          diagnostic(pathCheck.code!, pathCheck.message!, absolutePath, logicalPath)
        );
        continue;
      }

      let stats: fs.Stats;
      try {
        stats = fs.lstatSync(absolutePath);
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
        visit(absolutePath, logicalPath);
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
      if (stats.size > WORKFLOW_LIMITS.maxFileBytes) {
        diagnostics.push(
          diagnostic(
            'file_too_large',
            `File exceeds ${WORKFLOW_LIMITS.maxFileBytes} bytes`,
            absolutePath,
            logicalPath,
            { actual: stats.size, limit: WORKFLOW_LIMITS.maxFileBytes }
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
        bytes = fs.readFileSync(absolutePath);
      } catch (error) {
        diagnostics.push(
          diagnostic(
            'file_unreadable',
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
    }
  };

  visit(sourcePath, '');
  files.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  return { files, diagnostics };
}
