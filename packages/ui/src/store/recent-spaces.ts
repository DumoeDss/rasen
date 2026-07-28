/**
 * Client-side recency for the header space switcher (spaces-ui design D1/D2).
 * Recency is ephemeral UX state — it lives in `localStorage`, NOT in
 * configuration (pins are the durable, CLI-visible preference; putting recency
 * in config would spam config writes on every navigation). A capped,
 * de-duplicated, most-recent-first list of `<type>:<id>` space selectors.
 *
 * Every storage access is guarded: a browser in private mode (or with storage
 * disabled) throws on `localStorage` access, and recency must degrade to
 * "no recents", never break the switcher.
 */

const STORAGE_KEY = 'rasen.recentSpaces';

/** Keep the recency list bounded; the switcher only ever shows a handful. */
const MAX_RECENT = 16;

function readRaw(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === 'string');
  } catch {
    return [];
  }
}

/** The most-recently-visited space selectors, most-recent first. Empty when storage is unavailable. */
export function getRecentSpaces(): string[] {
  return readRaw();
}

/**
 * Records a visit to a space: moves `selector` to the front (de-duplicated),
 * capped at {@link MAX_RECENT}. A no-op on an empty selector or when storage
 * is unavailable.
 */
export function recordSpaceVisit(selector: string): void {
  if (!selector) return;
  try {
    const existing = readRaw().filter((s) => s !== selector);
    const next = [selector, ...existing].slice(0, MAX_RECENT);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable (private mode, quota) — recency silently degrades.
  }
}
