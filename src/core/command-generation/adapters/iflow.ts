import { COMMAND_PREFIX } from '../../config.js';
/**
 * iFlow Command Adapter
 *
 * Formats commands for iFlow following its frontmatter specification.
 */

import path from 'path';
import type { CommandContent, ToolCommandAdapter } from '../types.js';

/**
 * iFlow adapter for command generation.
 * File path: .iflow/commands/rasen-<id>.md
 * Frontmatter: name, id, category, description
 */
export const iflowAdapter: ToolCommandAdapter = {
  toolId: 'iflow',

  getFilePath(commandId: string): string {
    return path.join('.iflow', 'commands', `${COMMAND_PREFIX}-${commandId}.md`);
  },

  formatFile(content: CommandContent): string {
    return `---
name: /${COMMAND_PREFIX}-${content.id}
id: ${COMMAND_PREFIX}-${content.id}
category: ${content.category}
description: ${content.description}
---

${content.body}
`;
  },
};
