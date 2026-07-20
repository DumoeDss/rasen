import { COMMAND_PREFIX } from '../../config.js';
/**
 * Codex Command Adapter
 *
 * Formats commands for Codex following its frontmatter specification.
 * Codex custom prompts live in the global home directory (~/.codex/prompts/)
 * and are not shared through the repository. The CODEX_HOME env var can
 * override the default ~/.codex location.
 */

import path from 'path';
import { resolveCodexHome as getCodexHome } from '../../codex/codex-home.js';
import type { CommandContent, ToolCommandAdapter } from '../types.js';
import { escapeYamlValue } from '../yaml.js';

/**
 * Codex adapter for command generation.
 * File path: <CODEX_HOME>/prompts/rasen-<id>.md (absolute, global)
 * Frontmatter: description, argument-hint
 */
export const codexAdapter: ToolCommandAdapter = {
  toolId: 'codex',

  getFilePath(commandId: string): string {
    return path.join(getCodexHome(), 'prompts', `${COMMAND_PREFIX}-${commandId}.md`);
  },

  formatFile(content: CommandContent): string {
    return `---
description: ${escapeYamlValue(content.description)}
argument-hint: command arguments
---

${content.body}
`;
  },
};
