/**
 * Command File Id Mapping
 *
 * Fusion workflow ids carry a '-command' suffix (e.g. 'ship-command') so they
 * stay distinct from the always-installed expert skill ids (e.g. 'ship') in
 * profiles and the global config. That suffix must not leak into generated
 * slash-command filenames: the documented command is /rasen:ship, not
 * /rasen:ship-command. This module maps workflow ids to file ids at the file
 * layer only — workflow ids in profiles/config are unchanged.
 */

import path from 'path';
import { COMMAND_PREFIX, LEGACY_COMMAND_PREFIX } from '../config.js';
import type { ToolCommandAdapter } from './types.js';

/**
 * Maps a workflow id to the id used for its generated command file.
 * Strips the '-command' suffix from fusion workflow ids.
 */
export function getCommandFileId(workflowId: string): string {
  return workflowId.replace(/-command$/, '');
}

/**
 * Rewrites a command file path so its brand prefix uses LEGACY_COMMAND_PREFIX
 * instead of COMMAND_PREFIX, or returns null when the path carries no rasen
 * prefix segment. Older rasen installs wrote command files under the `opsx`
 * prefix in both adapter forms — the `commands/opsx/<id>.md` subdir form and
 * the `opsx-<id>.md` hyphen form — so detection/cleanup must probe those too.
 */
function toLegacyPrefixPath(filePath: string): string | null {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const segments = dir.split(path.sep);
  let changed = false;

  const rewrittenSegments = segments.map((segment) => {
    if (segment === COMMAND_PREFIX) {
      changed = true;
      return LEGACY_COMMAND_PREFIX;
    }
    return segment;
  });

  let rewrittenBase = base;
  if (base.startsWith(`${COMMAND_PREFIX}-`)) {
    rewrittenBase = `${LEGACY_COMMAND_PREFIX}-${base.slice(COMMAND_PREFIX.length + 1)}`;
    changed = true;
  }

  if (!changed) return null;
  return path.join(rewrittenSegments.join(path.sep), rewrittenBase);
}

/**
 * Returns the legacy '-command'-suffixed file path for a workflow, or null
 * when the workflow id and file id are identical. Older releases generated
 * command files under the raw workflow id (e.g. opsx/ship-command.md); these
 * paths are checked for cleanup and install detection.
 */
export function getLegacyCommandFilePath(
  adapter: ToolCommandAdapter,
  workflowId: string
): string | null {
  return getCommandFileId(workflowId) === workflowId ? null : adapter.getFilePath(workflowId);
}

/**
 * Returns every file path a workflow's command may live at:
 * - the current path (rasen prefix, file id) first,
 * - the legacy '-command'-suffixed path when it differs,
 * - and the legacy-brand-prefix variants of both (older rasen installs wrote
 *   command files under the `opsx` prefix), so install detection and cleanup
 *   still find pre-rebrand files.
 */
export function getCommandFilePathCandidates(
  adapter: ToolCommandAdapter,
  workflowId: string
): string[] {
  const paths = [adapter.getFilePath(getCommandFileId(workflowId))];
  const legacySuffix = getLegacyCommandFilePath(adapter, workflowId);
  if (legacySuffix) paths.push(legacySuffix);

  for (const current of [...paths]) {
    const legacyPrefix = toLegacyPrefixPath(current);
    if (legacyPrefix && !paths.includes(legacyPrefix)) paths.push(legacyPrefix);
  }
  return paths;
}
