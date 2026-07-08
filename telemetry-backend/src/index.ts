/**
 * openspec-telemetry — anonymous CLI usage ingestion Worker.
 *
 * Privacy contract (hard line): only command + version + anonymous distinctId
 * (+ optional os / node_version) is ever persisted. No IP, no paths, no args,
 * no project info. The request body is never echoed back.
 */

interface AnalyticsEngineDataset {
  writeDataPoint(event: {
    blobs?: (string | null)[];
    doubles?: number[];
    indexes?: string[];
  }): void;
}

interface Env {
  TELEMETRY: AnalyticsEngineDataset;
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Only POST is accepted; everything else is rejected without storing.
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
  },
} satisfies ExportedHandler<Env>;
