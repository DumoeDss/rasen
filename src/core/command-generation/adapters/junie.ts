import { COMMAND_PREFIX } from '../../config.js';
/**
 * Junie Command Adapter
 *
 * Formats commands for Junie following its frontmatter specification.
 */

import path from 'path';
import type { CommandContent, ToolCommandAdapter } from '../types.js';

/**
 * Junie adapter for command generation.
 * File path: .junie/commands/rasen-<id>.md
 * Frontmatter: description
 */
export const junieAdapter: ToolCommandAdapter = {
  toolId: 'junie',

  getFilePath(commandId: string): string {
    return path.join('.junie', 'commands', `${COMMAND_PREFIX}-${commandId}.md`);
  },

  formatFile(content: CommandContent): string {
    return `---
description: ${content.description}
---

${content.body}
`;
  },
};
