import { COMMAND_PREFIX } from '../../config.js';
/**
 * Factory Droid Command Adapter
 *
 * Formats commands for Factory Droid following its frontmatter specification.
 */

import path from 'path';
import type { CommandContent, ToolCommandAdapter } from '../types.js';
import { escapeYamlValue } from '../yaml.js';

/**
 * Factory adapter for command generation.
 * File path: .factory/commands/rasen-<id>.md
 * Frontmatter: description, argument-hint
 */
export const factoryAdapter: ToolCommandAdapter = {
  toolId: 'factory',

  getFilePath(commandId: string): string {
    return path.join('.factory', 'commands', `${COMMAND_PREFIX}-${commandId}.md`);
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
