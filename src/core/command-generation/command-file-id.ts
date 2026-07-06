/**
 * Command File Id Mapping
 *
 * Fusion workflow ids carry a '-command' suffix (e.g. 'ship-command') so they
 * stay distinct from the always-installed expert skill ids (e.g. 'ship') in
 * profiles and the global config. That suffix must not leak into generated
 * slash-command filenames: the documented command is /opsx:ship, not
 * /opsx:ship-command. This module maps workflow ids to file ids at the file
 * layer only — workflow ids in profiles/config are unchanged.
 */

import type { ToolCommandAdapter } from './types.js';

/**
 * Maps a workflow id to the id used for its generated command file.
 * Strips the '-command' suffix from fusion workflow ids.
 */
export function getCommandFileId(workflowId: string): string {
  return workflowId.replace(/-command$/, '');
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
 * Returns every file path a workflow's command may live at: the current path
 * first, then the legacy '-command'-suffixed path when it differs.
 */
export function getCommandFilePathCandidates(
  adapter: ToolCommandAdapter,
  workflowId: string
): string[] {
  const paths = [adapter.getFilePath(getCommandFileId(workflowId))];
  const legacy = getLegacyCommandFilePath(adapter, workflowId);
  if (legacy) paths.push(legacy);
  return paths;
}
