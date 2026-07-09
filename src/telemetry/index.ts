/**
 * Telemetry module for anonymous usage analytics.
 *
 * Privacy-first design:
 * - Only tracks command name and version (plus coarse os / node version)
 * - No arguments, file paths, or content
 * - Opt-out via RASEN_TELEMETRY=0 or DO_NOT_TRACK=1
 * - Auto-disabled in CI environments
 * - Anonymous ID is a random UUID with no relation to the user
 *
 * Transport: a single fire-and-forget HTTPS POST to the maintainer's own
 * Cloudflare Worker. The Worker returns 202 even on internal error, so the
 * client never parses the response body and never retries.
 *
 * Why `node:https` and not `fetch`: Node's global `fetch` (undici) keeps its
 * socket in a keep-alive pool with a reffed timer after the request settles,
 * which delays process exit by ~10s when the endpoint is slow or unreachable —
 * violating the "return fast / never block CLI exit" contract. `undici` is not
 * importable to tune the dispatcher, and forcing `process.exit()` is out of
 * scope (the CLI must need no changes). `https.request` with `agent: false`
 * uses no keep-alive pool, and a guard timer tears the socket down so a stalled
 * send can never hold the event loop open beyond the timeout.
 */
import { randomUUID } from 'crypto';
import https from 'node:https';
import { getTelemetryConfig, updateTelemetryConfig } from './config.js';

// Maintainer-owned Cloudflare Worker (fork-phase1-telemetry-backend). No API
// key required — the Worker is unauthenticated by design.
const TELEMETRY_ENDPOINT = 'https://telemetry.rasen.io';
const TELEMETRY_REQUEST_TIMEOUT_MS = 1000;

let anonymousId: string | null = null;
// The most recent in-flight send, so shutdown() can await it (bounded by the
// send's own guard timer) without ever blocking CLI exit.
let inFlightSend: Promise<void> | null = null;

/**
 * POST one event to the Worker, swallowing every failure. Resolves when the
 * request completes, errors, or hits the timeout — whichever comes first — and
 * never leaves a handle that could delay process exit.
 */
function sendEvent(payload: Record<string, unknown>): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    const done = (): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve();
    };

    try {
      const req = https.request(
        TELEMETRY_ENDPOINT,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          // No keep-alive: the socket closes after the response instead of
          // lingering in a connection pool and blocking CLI exit.
          agent: false,
        },
        (res) => {
          // Drain and discard. The Worker returns 202 even on internal error,
          // so there is nothing actionable to read — never parse the body.
          res.on('data', () => {});
          res.on('end', done);
          res.on('error', done);
        }
      );

      req.on('error', done);
      // Bound the whole attempt; on timeout tear the socket down so a stalled
      // request can never delay process exit beyond the timeout.
      timer = setTimeout(() => {
        req.destroy();
        done();
      }, TELEMETRY_REQUEST_TIMEOUT_MS);

      req.end(JSON.stringify(payload));
    } catch {
      // Silent failure - telemetry should never surface network noise.
      done();
    }
  });
}

/**
 * Check if telemetry is enabled.
 *
 * Disabled when:
 * - RASEN_TELEMETRY=0
 * - DO_NOT_TRACK=1
 * - CI=true (any CI environment)
 */
export function isTelemetryEnabled(): boolean {
  // Check explicit opt-out
  if (process.env.RASEN_TELEMETRY === '0') {
    return false;
  }

  // Respect DO_NOT_TRACK standard
  if (process.env.DO_NOT_TRACK === '1') {
    return false;
  }

  // Auto-disable in CI environments
  if (process.env.CI === 'true') {
    return false;
  }

  return true;
}

/**
 * Get or create the anonymous user ID.
 * Lazily generates a UUID on first call and persists it.
 */
export async function getOrCreateAnonymousId(): Promise<string> {
  // Return cached value if available
  if (anonymousId) {
    return anonymousId;
  }

  // Try to load from config
  const config = await getTelemetryConfig();
  if (config.anonymousId) {
    anonymousId = config.anonymousId;
    return anonymousId;
  }

  // Generate new UUID and persist
  anonymousId = randomUUID();
  await updateTelemetryConfig({ anonymousId });
  return anonymousId;
}

/**
 * Track a command execution.
 *
 * @param commandName - The command name (e.g., 'init', 'change:apply')
 * @param version - The Rasen version
 */
export async function trackCommand(commandName: string, version: string): Promise<void> {
  if (!isTelemetryEnabled()) {
    return;
  }

  try {
    const distinctId = await getOrCreateAnonymousId();

    // Fire-and-forget: start the send and record it so shutdown() can await it.
    // The command is not blocked on the network; the send overlaps its work.
    inFlightSend = sendEvent({
      command: commandName,
      version,
      distinctId,
      os: process.platform,
      node_version: process.versions.node,
    });
  } catch {
    // Silent failure - telemetry should never break CLI
  }
}

/**
 * Show first-run telemetry notice if not already seen.
 */
export async function maybeShowTelemetryNotice(): Promise<void> {
  if (!isTelemetryEnabled()) {
    return;
  }

  try {
    const config = await getTelemetryConfig();
    if (config.noticeSeen) {
      return;
    }

    // Display notice
    console.log(
      'Note: Rasen sends anonymous usage stats (command, version, OS, Node version, and a random id) to its own Cloudflare Worker. Opt out: RASEN_TELEMETRY=0'
    );

    // Mark as seen
    await updateTelemetryConfig({ noticeSeen: true });
  } catch {
    // Silent failure - telemetry should never break CLI
  }
}

/**
 * Flush any in-flight telemetry before CLI exit.
 *
 * There is no batched client to flush; this awaits the most recent send, which
 * is itself bounded by its guard timer, so it can never hang the CLI exit.
 */
export async function shutdown(): Promise<void> {
  const pending = inFlightSend;
  inFlightSend = null;
  if (!pending) {
    return;
  }

  try {
    await pending;
  } catch {
    // Silent failure - telemetry should never break CLI exit
  }
}
