/**
 * Legacy fragment-token compatibility. Current servers establish an opaque
 * HttpOnly browser session while serving the page, so normal launches carry
 * no token in the URL. Older launch links may still include `#token=<hex>`;
 * on boot the app reads that value into module-scope memory and scrubs the
 * fragment so it never lingers in the address bar or gets copied.
 */

let currentToken: string | null = null;
let unauthorized = false;
const unauthorizedListeners = new Set<() => void>();

const TOKEN_PATTERN = /(?:^|[?&#])token=([^&]+)/;

/** Extracts `token=<value>` from a hash string (e.g. `#token=abc123`), decoded. */
export function extractTokenFromHash(hash: string): string | null {
  const match = TOKEN_PATTERN.exec(hash);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]!);
  } catch {
    return null;
  }
}

/**
 * Reads the token from `location.hash`, stores it in memory, and scrubs the
 * fragment from the address bar. Call once at boot. Safe to call in a
 * non-browser test environment that provides `location`/`history`.
 */
export function initTokenFromLocation(): void {
  const token = extractTokenFromHash(location.hash);
  if (token) {
    currentToken = token;
    const scrubbed = location.pathname + location.search;
    history.replaceState(null, '', scrubbed);
  } else if (import.meta.env.DEV && import.meta.env.VITE_DEV_TOKEN) {
    // Dev-only convenience (design.md D5 dev-proxy workflow): a pasted token
    // supplied via env var when developing against a live `rasen config ui`
    // instance through the Vite proxy, where no fragment delivery happens.
    currentToken = import.meta.env.VITE_DEV_TOKEN;
  }
}

export function getToken(): string | null {
  return currentToken;
}

export function hasToken(): boolean {
  return currentToken !== null;
}

export function isUnauthorized(): boolean {
  return unauthorized;
}

/** Marks the session unauthorized after automatic refresh also returned 401. */
export function markUnauthorized(): void {
  unauthorized = true;
  for (const listener of unauthorizedListeners) listener();
}

/** Subscribes to unauthorized transitions (used by the app shell to re-render the notice). Returns an unsubscribe function. */
export function onUnauthorized(listener: () => void): () => void {
  unauthorizedListeners.add(listener);
  return () => unauthorizedListeners.delete(listener);
}

/** Test-only reset. */
export function resetTokenStateForTest(): void {
  currentToken = null;
  unauthorized = false;
  unauthorizedListeners.clear();
}
