/**
 * Retired Command Paths
 *
 * Static knowledge of the command-delivery surface, frozen here BEFORE
 * `src/core/command-generation/` is deleted. The command surface (a slash
 * command file per workflow, per tool) has been retired in favor of
 * skills-only delivery; this module retains only what cleanup needs to find
 * and remove pre-existing command files on disk. It must never depend on the
 * live command-generation module (registry/adapters) — that module is gone.
 *
 * Modeled on the `RETIRED_WORKFLOW_COMMAND_IDS` precedent in
 * `../legacy-cleanup.js`.
 */

import path from 'path';
import { COMMAND_PREFIX, LEGACY_COMMAND_PREFIX } from '../config.js';
import { resolveCodexHome } from '../codex/codex-home.js';

/**
 * The 19 built-in workflow ids that had a generated slash-command file,
 * frozen at the point the command surface was retired (already run through
 * the `-command`-suffix strip, matching `getCommandFileId`'s historical
 * behavior for fusion workflow ids like `ship-command` -> `ship`).
 */
export const RETIRED_COMMAND_IDS = [
  'apply',
  'archive',
  'auto',
  'bulk-archive',
  'continue',
  'explore',
  'goal',
  'handoff',
  'help',
  'new',
  'office-hours',
  'onboard',
  'propose',
  'retro',
  'review-cycle',
  'ship',
  'sync',
  'verify',
  'verify-enhanced',
] as const;

export type RetiredCommandId = (typeof RETIRED_COMMAND_IDS)[number];

type CommandPathBuilder = (commandId: string) => string;

/**
 * Per-tool command file-path rule, frozen from each tool's now-deleted
 * `ToolCommandAdapter.getFilePath`. Every path is built with `path.join` so
 * candidates are correct on every platform. Codex is the one absolute,
 * global-scoped path (its prompts live outside the project tree).
 */
const TOOL_COMMAND_PATH_BUILDERS: Record<string, CommandPathBuilder> = {
  'amazon-q': (id) => path.join('.amazonq', 'prompts', `${COMMAND_PREFIX}-${id}.md`),
  antigravity: (id) => path.join('.agent', 'workflows', `${COMMAND_PREFIX}-${id}.md`),
  auggie: (id) => path.join('.augment', 'commands', `${COMMAND_PREFIX}-${id}.md`),
  bob: (id) => path.join('.bob', 'commands', `${COMMAND_PREFIX}-${id}.md`),
  claude: (id) => path.join('.claude', 'commands', COMMAND_PREFIX, `${id}.md`),
  cline: (id) => path.join('.clinerules', 'workflows', `${COMMAND_PREFIX}-${id}.md`),
  codebuddy: (id) => path.join('.codebuddy', 'commands', COMMAND_PREFIX, `${id}.md`),
  codex: (id) => path.join(resolveCodexHome(), 'prompts', `${COMMAND_PREFIX}-${id}.md`),
  continue: (id) => path.join('.continue', 'prompts', `${COMMAND_PREFIX}-${id}.prompt`),
  costrict: (id) => path.join('.cospec', COMMAND_PREFIX, 'commands', `${COMMAND_PREFIX}-${id}.md`),
  crush: (id) => path.join('.crush', 'commands', COMMAND_PREFIX, `${id}.md`),
  cursor: (id) => path.join('.cursor', 'commands', `${COMMAND_PREFIX}-${id}.md`),
  factory: (id) => path.join('.factory', 'commands', `${COMMAND_PREFIX}-${id}.md`),
  gemini: (id) => path.join('.gemini', 'commands', COMMAND_PREFIX, `${id}.toml`),
  'github-copilot': (id) => path.join('.github', 'prompts', `${COMMAND_PREFIX}-${id}.prompt.md`),
  iflow: (id) => path.join('.iflow', 'commands', `${COMMAND_PREFIX}-${id}.md`),
  junie: (id) => path.join('.junie', 'commands', `${COMMAND_PREFIX}-${id}.md`),
  kilocode: (id) => path.join('.kilocode', 'workflows', `${COMMAND_PREFIX}-${id}.md`),
  kiro: (id) => path.join('.kiro', 'prompts', `${COMMAND_PREFIX}-${id}.prompt.md`),
  lingma: (id) => path.join('.lingma', 'commands', COMMAND_PREFIX, `${id}.md`),
  opencode: (id) => path.join('.opencode', 'commands', `${COMMAND_PREFIX}-${id}.md`),
  pi: (id) => path.join('.pi', 'prompts', `${COMMAND_PREFIX}-${id}.md`),
  qoder: (id) => path.join('.qoder', 'commands', COMMAND_PREFIX, `${id}.md`),
  qwen: (id) => path.join('.qwen', 'commands', `${COMMAND_PREFIX}-${id}.toml`),
  roocode: (id) => path.join('.roo', 'commands', `${COMMAND_PREFIX}-${id}.md`),
  windsurf: (id) => path.join('.windsurf', 'workflows', `${COMMAND_PREFIX}-${id}.md`),
};

/**
 * Returns the current command file path for a tool + command id, or `null`
 * when the tool never had a command adapter (no command surface for it).
 */
export function getRetiredCommandFilePath(toolId: string, commandId: string): string | null {
  const builder = TOOL_COMMAND_PATH_BUILDERS[toolId];
  return builder ? builder(commandId) : null;
}

/**
 * Maps a workflow id to the id used for its generated command file. Strips
 * the '-command' suffix from fusion workflow ids (e.g. `ship-command` ->
 * `ship`). Migrated verbatim from the deleted `command-file-id.ts`.
 */
export function getCommandFileId(workflowId: string): string {
  return workflowId.replace(/-command$/, '');
}

/**
 * Rewrites a command file path so its brand prefix uses `LEGACY_COMMAND_PREFIX`
 * instead of `COMMAND_PREFIX`, or returns null when the path carries no rasen
 * prefix segment. Older rasen installs wrote command files under the `opsx`
 * prefix in both adapter forms — the `commands/opsx/<id>.md` subdir form and
 * the `opsx-<id>.md` hyphen form — so cleanup must probe those too.
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
 * Returns the legacy '-command'-suffixed file path for a workflow at a tool,
 * or null when the workflow id and file id are identical (no legacy suffix
 * ever existed) or the tool has no command path rule.
 */
export function getLegacyCommandFilePath(toolId: string, workflowId: string): string | null {
  if (getCommandFileId(workflowId) === workflowId) return null;
  return getRetiredCommandFilePath(toolId, workflowId);
}

/**
 * Returns every file path a workflow's command may live at, for a tool:
 * - the current path (rasen prefix, file id) first,
 * - the legacy '-command'-suffixed path when it differs,
 * - and the legacy-brand-prefix variants of both (older rasen installs wrote
 *   command files under the `opsx` prefix), so cleanup still finds
 *   pre-rebrand files.
 *
 * Returns an empty array when the tool has no command path rule.
 */
export function getCommandFilePathCandidates(toolId: string, workflowId: string): string[] {
  const current = getRetiredCommandFilePath(toolId, getCommandFileId(workflowId));
  if (!current) return [];

  const paths = [current];
  const legacySuffix = getLegacyCommandFilePath(toolId, workflowId);
  if (legacySuffix) paths.push(legacySuffix);

  for (const candidate of [...paths]) {
    const legacyPrefix = toLegacyPrefixPath(candidate);
    if (legacyPrefix && !paths.includes(legacyPrefix)) paths.push(legacyPrefix);
  }
  return paths;
}

/**
 * Every candidate command file path for every retired built-in command id,
 * at one tool — the full set an unconditional cleanup must check.
 */
export function getAllRetiredCommandFilePathCandidates(toolId: string): string[] {
  const paths: string[] = [];
  for (const id of RETIRED_COMMAND_IDS) {
    for (const candidate of getCommandFilePathCandidates(toolId, id)) {
      if (!paths.includes(candidate)) paths.push(candidate);
    }
  }
  return paths;
}
