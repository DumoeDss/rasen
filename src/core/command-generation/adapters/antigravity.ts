import { COMMAND_PREFIX } from '../../config.js';
/**
 * Antigravity Command Adapter
 *
 * Formats commands for Antigravity following its frontmatter specification.
 */

import path from 'path';
import type { CommandContent, ToolCommandAdapter } from '../types.js';
import { escapeYamlValue } from '../yaml.js';

/**
 * Antigravity adapter for command generation.
 * File path: .agent/workflows/rasen-<id>.md
 * Frontmatter: description
 */
export const antigravityAdapter: ToolCommandAdapter = {
  toolId: 'antigravity',

  getFilePath(commandId: string): string {
    return path.join('.agent', 'workflows', `${COMMAND_PREFIX}-${commandId}.md`);
  },

  formatFile(content: CommandContent): string {
    return `---
description: ${escapeYamlValue(content.description)}
---

${content.body}
`;
  },
};
