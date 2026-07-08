/**
 * openspec-telemetry — anonymous CLI usage ingestion Worker + Access-gated admin.
 *
 * Privacy contract (hard line): only command + version + anonymous distinctId
 * (+ optional os / node_version) is ever persisted. No IP, no paths, no args,
 * no project info. The request body is never echoed back.
 *
 * Routing (path-first): /api/admin/* and /admin* are gated by the fail-closed
 * Cloudflare Access check BEFORE any asset is served; everything else is the
 * unchanged public ingest path.
 */
import { verifyAdminAccess, type AccessEnv } from './access';
import { handleAdminApi, type StatsEnv } from './stats';
import { runDailyRollup, runBackfill, type RollupsEnv } from './rollups';

interface AnalyticsEngineDataset {
  writeDataPoint(event: {
    blobs?: (string | null)[];
    doubles?: number[];
    indexes?: string[];
  }): void;
}

interface Env extends AccessEnv, StatsEnv, RollupsEnv {
  TELEMETRY: AnalyticsEngineDataset;
  // Static-assets binding (admin/index.html). Served only after the Access gate.
  ASSETS: { fetch(request: Request): Promise<Response> };
  // ROLLUPS (D1 cold store) is declared on RollupsEnv — optional so an
  // un-provisioned deploy still ingests; the rollup path no-ops without it.
}

// Analytics Engine caps each blob at 5120 bytes; keep well under and bound
// per-field size so a hostile payload can't bloat storage.
const MAX_FIELD_LEN = 256;

function asField(value: unknown): string {
  return typeof value === 'string' ? value.slice(0, MAX_FIELD_LEN) : '';
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

const ACCESS_HEADER = 'Cf-Access-Jwt-Assertion';

// Sealed static 403 for the admin HTML path — never leaks the panel or asset
// bytes. no-store / nosniff / noindex.
function sealedAdmin403(): Response {
  return new Response(
    '<!doctype html><meta charset="utf-8"><title>403 — access required</title>' +
      '<body style="font-family:system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem">' +
      '<h1>403 — access required</h1>' +
      '<p>This admin console requires a valid Cloudflare Access identity. ' +
      'Sign in through Cloudflare Access and reload.</p></body>',
    {
      status: 403,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        'x-robots-tag': 'noindex',
      },
    }
  );
}

function adminApiForbidden(): Response {
  return new Response(
    JSON.stringify({ error: 'forbidden', hint: 'A valid Cloudflare Access identity is required.' }),
    {
      status: 403,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    }
  );
}

// The unchanged public ingest handler. POST / → 202/400; other methods → 405.
async function handleIngest(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('method not allowed', { status: 405 });
  }

  try {
    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return new Response('bad request', { status: 400 });
    }

    if (typeof payload !== 'object' || payload === null) {
      return new Response('bad request', { status: 400 });
    }

    const body = payload as Record<string, unknown>;

    // Required fields — reject and store nothing if any is missing/empty.
    if (
      !isNonEmptyString(body.command) ||
      !isNonEmptyString(body.version) ||
      !isNonEmptyString(body.distinctId)
    ) {
      return new Response('bad request', { status: 400 });
    }

    const command = body.command.slice(0, MAX_FIELD_LEN);
    const version = body.version.slice(0, MAX_FIELD_LEN);
    const distinctId = body.distinctId.slice(0, MAX_FIELD_LEN);
    const os = asField(body.os);
    const nodeVersion = asField(body.node_version);
    // All other fields (paths, args, project info, IP) are ignored by
    // construction — we only read the contract fields above.

    env.TELEMETRY.writeDataPoint({
      blobs: [command, version, os, nodeVersion],
      indexes: [distinctId],
    });

    return new Response('accepted', { status: 202 });
  } catch {
    // Ingestion must never hang or surface internal errors to the caller.
    return new Response('accepted', { status: 202 });
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // 1) Admin stats API — JWT gate FIRST; on failure return JSON 403 (never HTML).
    if (path === '/api/admin' || path.startsWith('/api/admin/')) {
      const identity = await verifyAdminAccess(env, request.headers.get(ACCESS_HEADER));
      if (!identity) return adminApiForbidden();
      // One-time historical backfill — behind the same fail-closed gate, so it
      // needs zero new auth code. Idempotent (shares the daily rollup's key tuple
      // + UPSERT), so it is safe to re-invoke.
      if (path === '/api/admin/backfill') {
        if (request.method !== 'POST') {
          return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
            status: 405,
            headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
          });
        }
        const summary = await runBackfill(env);
        return new Response(JSON.stringify(summary), {
          status: summary.ok ? 200 : 502,
          headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
        });
      }
      return handleAdminApi(url, env);
    }

    // 2) Admin panel — JWT gate FIRST, BEFORE any env.ASSETS.fetch. On failure
    //    return the sealed static 403 so the HTML can never leak from workers.dev.
    if (path === '/admin' || path.startsWith('/admin/')) {
      const identity = await verifyAdminAccess(env, request.headers.get(ACCESS_HEADER));
      if (!identity) return sealedAdmin403();
      // Serve the single panel file. directory=./admin holds index.html, so map
      // any /admin* request to /index.html on the asset binding.
      const assetRequest = new Request(new URL('/index.html', url.origin), request);
      return env.ASSETS.fetch(assetRequest);
    }

    // 3) Everything else → the unchanged public ingest path.
    return handleIngest(request, env);
  },

  // Daily cron ("0 1 * * *", 01:00 UTC) — aggregate the prior UTC day from
  // Analytics Engine into the D1 cold store. Pure bypass: shares no code with
  // handleIngest and never touches the ingest hot path. A SQL/token failure is a
  // clean no-op (runDailyRollup never throws) that the next cron re-runs.
  async scheduled(
    _event: unknown,
    env: Env,
    ctx: { waitUntil(promise: Promise<unknown>): void }
  ): Promise<void> {
    ctx.waitUntil(runDailyRollup(env));
  },
} satisfies ExportedHandler<Env>;
