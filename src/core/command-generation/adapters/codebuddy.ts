import { COMMAND_PREFIX } from '../../config.js';
/**
 * CodeBuddy Command Adapter
 *
 * Formats commands for CodeBuddy following its frontmatter specification.
 */

import path from 'path';
import type { CommandContent, ToolCommandAdapter } from '../types.js';
import { escapeYamlValue, quoteYamlValue } from '../yaml.js';

/**
 * CodeBuddy adapter for command generation.
 * File path: .codebuddy/commands/rasen/<id>.md
 * Frontmatter: name, description, argument-hint
 */
export const codebuddyAdapter: ToolCommandAdapter = {
  toolId: 'codebuddy',

  getFilePath(commandId: string): string {
    return path.join('.codebuddy', 'commands', COMMAND_PREFIX, `${commandId}.md`);
  },

  formatFile(content: CommandContent): string {
    return `---
name: ${escapeYamlValue(content.name)}
description: ${quoteYamlValue(content.description)}
argument-hint: "[command arguments]"
---

${content.body}
`;
  },
};
