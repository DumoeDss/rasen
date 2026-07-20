/** Quotes arbitrary text as a TOML basic string without allowing new keys. */
export function quoteTomlString(value: string): string {
  return JSON.stringify(value)
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
