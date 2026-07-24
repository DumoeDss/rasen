/**
 * `{placeholder}` interpolation (design D3) — a verbatim mirror of the CLI's
 * `formatLocaleMessage` (src/locales/index.ts) so the two systems stay
 * recognizable siblings. An unknown placeholder is left intact (same as the
 * CLI); a known placeholder is stringified. Zero dependencies.
 *
 * `t('board.empty', { count: 3 })` against `"board.empty": "No tasks ({count} shown)"`
 * yields `"No tasks (3 shown)"`.
 */
export function formatMessage(
  template: string,
  values: Record<string, string | number>
): string {
  return template.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, (placeholder, key: string) => {
    const value = values[key];
    return value === undefined ? placeholder : String(value);
  });
}
