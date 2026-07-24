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

/**
 * YAML indicator characters that may not begin a plain (unquoted) scalar.
 * (`- `, `? `, `: ` are also disallowed but are caught by the sequence checks
 * in {@link needsYamlQuoting}.)
 */
const YAML_LEADING_INDICATORS = new Set([
  '!', '&', '*', '#', '|', '>', '%', '@', '`', '"', "'", ',', '[', ']', '{', '}',
]);

/**
 * YAML tokens that a plain scalar would be typed as a boolean or null rather
 * than a string. Covers the YAML 1.1 set (yes/no/on/off, y/n) as well as 1.2
 * core, so the value keeps its string type under either parser.
 */
const YAML_BOOL_NULL = new Set([
  'true', 'false', 'yes', 'no', 'on', 'off', 'y', 'n', 'null', '~',
]);

/**
 * Reports whether a value cannot be safely emitted as a YAML plain (unquoted)
 * scalar. When true, the value must be quoted or a strict YAML parser will
 * either reject it or reinterpret its type.
 *
 * The checks encode the YAML plain-scalar constraints (not an open-ended
 * heuristic): the ": " (colon-space) and " #" (space-hash) sequences and a
 * trailing ":" are disallowed; leading/trailing whitespace and control
 * characters are not representable; a leading indicator character changes the
 * node kind; and boolean/null/number-looking tokens would be typed as
 * non-strings.
 */
export function needsYamlQuoting(value: string): boolean {
  if (value.length === 0) return true;
  if (value !== value.trim()) return true;
  // Control characters, tabs, and line breaks (not representable as a plain scalar).
  if (/[\u0000-\u001f\u007f]/.test(value)) return true;
  // Colon-space and space-hash sequences, and a trailing colon.
  if (value.includes(': ') || value.includes(' #') || value.endsWith(':')) return true;
  // Leading indicator characters, including `-`/`?`/`:` that start a token.
  const first = value[0];
  if (YAML_LEADING_INDICATORS.has(first)) return true;
  if ((first === '-' || first === '?' || first === ':') && (value.length === 1 || value[1] === ' ')) {
    return true;
  }
  // Would be parsed as a boolean, null, or number instead of a string.
  if (YAML_BOOL_NULL.has(value.toLowerCase())) return true;
  if (/^[+-]?(\d[\d_]*(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(value)) return true;
  return false;
}

/**
 * Emits a string as a YAML scalar: unquoted when it is safe as a plain scalar,
 * double-quoted (via {@link quoteYamlValue}) when it is not. Keeps generated
 * frontmatter valid YAML without churning values that are already safe.
 */
export function yamlScalar(value: string): string {
  return needsYamlQuoting(value) ? quoteYamlValue(value) : value;
}
