import { useState } from 'preact/hooks';

/**
 * Renders a configuration value readably (config-ui-package spec: "Raw
 * serialized JSON SHALL NOT be the user-facing presentation of any value").
 *
 * - array of primitives → a wrapping chip list, each item a small pill;
 *   collapsed to the first `COLLAPSE_AT` items behind a count + "Show all"
 *   disclosure when the list is long.
 * - plain object → labeled `key: value` fields.
 * - primitive / null / undefined → plain text ("not set" for absent).
 *
 * Display only — no edit affordances. The `inline` variant (used inside an
 * inherited-from annotation) summarizes an array by its count with the chips
 * available behind the same disclosure, never a second serialized dump.
 */

/** Above this many items an array list collapses to a count + disclosure. */
const COLLAPSE_AT = 8;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function primitiveText(value: unknown): string {
  // Array items and object field values are usually primitives, but a nested
  // object/array leaf must not degrade to "[object Object]" — fall back to a
  // compact JSON form (still more readable than the raw wall this replaces).
  if (typeof value === 'object' && value !== null) return JSON.stringify(value);
  return String(value);
}

function ArrayChips({ items, testid }: { items: unknown[]; testid?: string }) {
  const [expanded, setExpanded] = useState(false);
  const long = items.length > COLLAPSE_AT;
  const shown = long && !expanded ? items.slice(0, COLLAPSE_AT) : items;
  return (
    <span class="value-display value-display--array" data-testid={testid}>
      <span class="value-display__chips">
        {shown.map((item, i) => (
          <span key={i} class="value-display__chip">
            {primitiveText(item)}
          </span>
        ))}
      </span>
      {long && (
        <button
          type="button"
          class="value-display__toggle btn--ghost"
          data-testid="value-display-toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded((e) => !e)}
        >
          {expanded ? 'Show fewer' : `${items.length} items · Show all`}
        </button>
      )}
    </span>
  );
}

export function ValueDisplay({ value, testid }: { value: unknown; testid?: string }) {
  if (value === undefined || value === null) {
    return (
      <span class="value-display value-display--empty" data-testid={testid}>
        not set
      </span>
    );
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return (
        <span class="value-display value-display--empty" data-testid={testid}>
          none
        </span>
      );
    }
    return <ArrayChips items={value} testid={testid} />;
  }
  if (isPlainObject(value)) {
    return (
      <span class="value-display value-display--object" data-testid={testid}>
        {Object.entries(value).map(([k, v]) => (
          <span key={k} class="value-display__field">
            <span class="value-display__field-key">{k}</span>
            <span class="value-display__field-value">{primitiveText(v)}</span>
          </span>
        ))}
      </span>
    );
  }
  return (
    <span class="value-display value-display--primitive" data-testid={testid}>
      {primitiveText(value)}
    </span>
  );
}

/**
 * The array-summarizing form for annotations (config-ui-package spec: inherited
 * list values "summarized by their item count with the full list available on
 * demand"). A primitive value renders as inline text; an array renders as
 * "N items" with the chips behind a disclosure; an object renders as fields.
 */
export function ValueSummary({ value, testid }: { value: unknown; testid?: string }) {
  const [expanded, setExpanded] = useState(false);
  if (Array.isArray(value) && value.length > 0) {
    return (
      <span class="value-display value-display--summary" data-testid={testid}>
        <button
          type="button"
          class="value-display__toggle btn--ghost"
          data-testid="value-summary-toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded((e) => !e)}
        >
          {value.length} {value.length === 1 ? 'item' : 'items'}
        </button>
        {expanded && (
          <span class="value-display__chips">
            {value.map((item, i) => (
              <span key={i} class="value-display__chip">
                {primitiveText(item)}
              </span>
            ))}
          </span>
        )}
      </span>
    );
  }
  return <ValueDisplay value={value} testid={testid} />;
}
