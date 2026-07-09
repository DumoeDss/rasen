import { COMMAND_PREFIX } from '../../config.js';
/**
 * Crush Command Adapter
 *
 * Formats commands for Crush following its frontmatter specification.
 */

import path from 'path';
import type { CommandContent, ToolCommandAdapter } from '../types.js';

/**
 * Crush adapter for command generation.
 * File path: .crush/commands/rasen/<id>.md
 * Frontmatter: name, description, category, tags
 */
export const crushAdapter: ToolCommandAdapter = {
  toolId: 'crush',

  getFilePath(commandId: string): string {
    return path.join('.crush', 'commands', COMMAND_PREFIX, `${commandId}.md`);
  },

  formatFile(content: CommandContent): string {
    const tagsStr = content.tags.join(', ');
    return `---
name: ${content.name}
description: ${content.description}
category: ${content.category}
tags: [${tagsStr}]
---

${content.body}
`;
  },
};
