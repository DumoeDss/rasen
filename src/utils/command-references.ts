/**
 * Command Reference Utilities
 *
 * Utilities for transforming command references to tool-specific formats.
 */

import { COMMAND_PREFIX } from '../core/config.js';

// Colon → hyphen transform, built from the single command-prefix constant so
// the two forms (`/rasen:name` and `/rasen-name`) can never drift apart.
const COLON_PREFIX_PATTERN = new RegExp(`/${COMMAND_PREFIX}:`, 'g');

/**
 * Transforms colon-based command references to hyphen-based format.
 * Converts `/rasen:` patterns to `/rasen-` for tools that use hyphen syntax.
 *
 * @param text - The text containing command references
 * @returns Text with command references transformed to hyphen format
 *
 * @example
 * transformToHyphenCommands('/rasen:new') // returns '/rasen-new'
 * transformToHyphenCommands('Use /rasen:apply to implement') // returns 'Use /rasen-apply to implement'
 */
export function transformToHyphenCommands(text: string): string {
  return text.replace(COLON_PREFIX_PATTERN, `/${COMMAND_PREFIX}-`);
}
