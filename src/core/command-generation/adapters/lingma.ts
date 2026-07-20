import { COMMAND_PREFIX } from '../../config.js';
/**
 * Lingma Command Adapter
 *
 * Formats commands for Lingma following its frontmatter specification.
 */

import path from 'path';
import type { CommandContent, ToolCommandAdapter } from '../types.js';
import { escapeYamlValue } from '../yaml.js';

/**
 * Lingma adapter for command generation.
 * File path: .lingma/commands/rasen/<id>.md
 * Frontmatter: name, description, category, tags
 */
export const lingmaAdapter: ToolCommandAdapter = {
  toolId: 'lingma',

  getFilePath(commandId: string): string {
    return path.join('.lingma', 'commands', COMMAND_PREFIX, `${commandId}.md`);
  },

  formatFile(content: CommandContent): string {
    const tagsStr = content.tags.map(escapeYamlValue).join(', ');
    return `---
name: ${escapeYamlValue(content.name)}
description: ${escapeYamlValue(content.description)}
category: ${escapeYamlValue(content.category)}
tags: [${tagsStr}]
---

${content.body}
`;
  },
};
