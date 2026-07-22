/**
 * Shared YAML frontmatter helpers.
 *
 * Skill generation emits YAML frontmatter and needs to escape user-facing
 * strings (name, description, metadata) so the generated file stays valid
 * YAML. Migrated from the deleted `command-generation/yaml.ts` (only
 * `quoteYamlValue` is still referenced; the command-only `escapeYamlValue`
 * and its heuristics were retired with the command surface).
 */

/**
 * Escapes a string value for safe YAML output.
 *
 * Quotes the value with double quotes when it contains characters that
 * carry special meaning in YAML (or leading/trailing whitespace), and
 * escapes the characters that are not representable verbatim inside a
 * double-quoted scalar: backslash, double quote, line feed and carriage
 * return. Values without special characters are returned unquoted.
 *
 * @param value - The raw string to embed in YAML frontmatter.
 * @returns The value, double-quoted and escaped when necessary.
 */
export function quoteYamlValue(value: string): string {
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
  return `"${escaped}"`;
}
