import * as http from 'node:http';

import { sanitizeAgentDiagnostic } from '../agent-diagnostics.js';
import {
  CreateRouteLeaseRequestSchema,
  CreateRouteLeaseResponseSchema,
  OmniCrossDaemonErrorSchema,
  OmniCrossRouteError,
  ReleaseRouteLeaseRequestSchema,
  ReleaseRouteLeaseResponseSchema,
  RenewRouteLeaseRequestSchema,
  RenewRouteLeaseResponseSchema,
  type CreateRouteLeaseRequest,
  type CreateRouteLeaseResponse,
  type OmniCrossFailure,
  type ReleaseRouteLeaseRequest,
  type ReleaseRouteLeaseResponse,
  type RenewRouteLeaseRequest,
  type RenewRouteLeaseResponse,
} from './contracts.js';
import type { OmniCrossControlAuthority } from './config.js';

export const MAX_OMNICROSS_RESPONSE_BYTES = 256 * 1024;

export interface OmniCrossHttpRequest {
  readonly method: 'POST' | 'DELETE';
  readonly url: URL;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly timeoutMs: number;
  readonly maxResponseBytes: number;
  readonly signal?: AbortSignal;
}

export interface OmniCrossHttpResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly body: string;
}

export type OmniCrossHttpTransport = (
  request: OmniCrossHttpRequest
) => Promise<OmniCrossHttpResponse>;

export const nodeOmniCrossHttpTransport: OmniCrossHttpTransport = (input) =>
  new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      input.signal?.removeEventListener('abort', abort);
      callback();
    };
    const request = http.request(
      input.url,
      {
        method: input.method,
        headers: input.headers,
        agent: false,
      },
      (response) => {
        const chunks: Buffer[] = [];
        let bytes = 0;
        response.on('data', (chunk: Buffer | string) => {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'utf8');
          bytes += buffer.length;
          if (bytes > input.maxResponseBytes) {
            request.destroy(new Error('response-size-limit'));
            return;
          }
          chunks.push(buffer);
        });
        response.on('end', () =>
          finish(() =>
            resolve({
              status: response.statusCode ?? 0,
              headers: response.headers,
              body: Buffer.concat(chunks).toString('utf8'),
            })
          )
        );
      }
    );
    request.setTimeout(input.timeoutMs, () => {
      const error = new Error('request-timeout');
      (error as NodeJS.ErrnoException).code = 'ETIMEDOUT';
      request.destroy(error);
    });
    request.on('error', (error) => finish(() => reject(error)));
    const abort = (): void => {
      request.destroy(input.signal?.reason instanceof Error
        ? input.signal.reason
        : new Error('request-cancelled'));
    };
    if (input.signal?.aborted) {
      abort();
      return;
    }
    input.signal?.addEventListener('abort', abort, { once: true });
    request.end(input.body);
  });

function transportFailure(error: unknown): OmniCrossFailure {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (code === 'ETIMEDOUT' || (error instanceof Error && error.message === 'request-timeout')) {
    return {
      kind: 'daemon-timeout',
      message: 'The OmniCross daemon did not respond within the configured timeout.',
      retryable: true,
    };
  }
  if (error instanceof Error && error.message === 'response-size-limit') {
    return {
      kind: 'unsupported-schema',
      message: 'The OmniCross daemon response exceeded the bounded response size.',
      retryable: false,
    };
  }
  return {
    kind: 'daemon-unavailable',
    message: 'The configured loopback OmniCross daemon is unavailable.',
    retryable: true,
  };
}

const DAEMON_FAILURE_MAP: Readonly<Record<string, OmniCrossFailure['kind']>> = {
  control_unauthorized: 'control-unauthorized',
  daemon_not_ready: 'daemon-not-ready',
  invalid_request: 'invalid-input',
  upstream_not_found: 'upstream-invalid',
  upstream_invalid: 'upstream-invalid',
  model_not_supported: 'model-invalid',
  model_invalid: 'model-invalid',
  format_unsupported: 'format-unsupported',
  idempotency_conflict: 'idempotency-conflict',
  capacity_exhausted: 'capacity-exhausted',
  lease_expired: 'route-expired',
  lease_not_found: 'route-lost',
  unsupported_schema: 'unsupported-schema',
};

function responseFailure(response: OmniCrossHttpResponse, secrets: readonly string[]): never {
  let parsed: unknown;
  try {
    parsed = JSON.parse(response.body) as unknown;
  } catch {
    parsed = undefined;
  }
  const daemon = OmniCrossDaemonErrorSchema.safeParse(parsed);
  if (daemon.success) {
    const kind = DAEMON_FAILURE_MAP[daemon.data.error.code] ??
      (response.status === 401 || response.status === 403
        ? 'control-unauthorized'
        : response.status === 503
          ? 'daemon-not-ready'
          : 'invalid-input');
    throw new OmniCrossRouteError({
      kind,
      message: sanitizeAgentDiagnostic(daemon.data.error.message, 2048, secrets),
      retryable: daemon.data.error.retryable,
      daemonCode: daemon.data.error.code,
    });
  }
  throw new OmniCrossRouteError({
    kind: response.status === 401 || response.status === 403
      ? 'control-unauthorized'
      : response.status === 503
        ? 'daemon-not-ready'
        : 'unsupported-schema',
    message: `OmniCross returned HTTP ${response.status} with an invalid error envelope.`,
    retryable: response.status >= 500,
  });
}

function parseJson<T>(
  response: OmniCrossHttpResponse,
  schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } },
  label: string
): T {
  let value: unknown;
  try {
    value = JSON.parse(response.body) as unknown;
  } catch {
    throw new OmniCrossRouteError({
      kind: 'unsupported-schema',
      message: `OmniCross ${label} response was not valid JSON.`,
      retryable: false,
    });
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new OmniCrossRouteError({
      kind: 'unsupported-schema',
      message: `OmniCross ${label} response did not match the supported versioned contract.`,
      retryable: false,
    });
  }
  return parsed.data;
}

export interface OmniCrossRouteLeaseClient {
  create(request: CreateRouteLeaseRequest, signal?: AbortSignal): Promise<CreateRouteLeaseResponse>;
  renew(leaseId: string, request: RenewRouteLeaseRequest, signal?: AbortSignal): Promise<RenewRouteLeaseResponse>;
  release(leaseId: string, request: ReleaseRouteLeaseRequest, signal?: AbortSignal): Promise<ReleaseRouteLeaseResponse>;
}

export interface OmniCrossRouteLeaseClientOptions {
  readonly authority: OmniCrossControlAuthority;
  readonly transport?: OmniCrossHttpTransport;
  readonly maxResponseBytes?: number;
}

export function createOmniCrossRouteLeaseClient(
  options: OmniCrossRouteLeaseClientOptions
): OmniCrossRouteLeaseClient {
  const transport = options.transport ?? nodeOmniCrossHttpTransport;
  const maxResponseBytes = options.maxResponseBytes ?? MAX_OMNICROSS_RESPONSE_BYTES;
  const secrets = [options.authority.controlToken];

  const send = async (
    method: 'POST' | 'DELETE',
    pathname: string,
    body: unknown,
    signal?: AbortSignal
  ): Promise<OmniCrossHttpResponse> => {
    const serialized = JSON.stringify(body);
    try {
      return await transport({
        method,
        url: new URL(pathname, `${options.authority.connection.endpoint}/`),
        headers: {
          authorization: `Bearer ${options.authority.controlToken}`,
          'content-type': 'application/json',
          accept: 'application/json',
          'content-length': String(Buffer.byteLength(serialized, 'utf8')),
        },
        body: serialized,
        timeoutMs: options.authority.connection.requestTimeoutMs,
        maxResponseBytes,
        ...(signal ? { signal } : {}),
      });
    } catch (error) {
      throw new OmniCrossRouteError(transportFailure(error));
    }
  };

  const client: OmniCrossRouteLeaseClient = {
    async create(request: CreateRouteLeaseRequest, signal?: AbortSignal) {
      const checked = CreateRouteLeaseRequestSchema.parse(request);
      let response: OmniCrossHttpResponse;
      try {
        response = await send('POST', '/admin/api/route-leases', checked, signal);
      } catch (error) {
        if (!(error instanceof OmniCrossRouteError) || !error.failure.retryable || signal?.aborted) {
          throw error;
        }
        // Exactly one safe create retry, using byte-identical payload and idempotency key.
        response = await send('POST', '/admin/api/route-leases', checked, signal);
      }
      if (response.status < 200 || response.status >= 300) responseFailure(response, secrets);
      const cacheControl = response.headers['cache-control'];
      const header = Array.isArray(cacheControl) ? cacheControl.join(',') : cacheControl ?? '';
      if (!/(?:^|,)\s*no-store\s*(?:,|$)/i.test(header)) {
        throw new OmniCrossRouteError({
          kind: 'unsupported-schema',
          message: 'OmniCross create response must carry Cache-Control: no-store.',
          retryable: false,
        });
      }
      return parseJson(response, CreateRouteLeaseResponseSchema, 'create');
    },

    async renew(
      leaseId: string,
      request: RenewRouteLeaseRequest,
      signal?: AbortSignal
    ) {
      const checked = RenewRouteLeaseRequestSchema.parse(request);
      const response = await send(
        'POST',
        `/admin/api/route-leases/${encodeURIComponent(leaseId)}/renew`,
        checked,
        signal
      );
      if (response.status < 200 || response.status >= 300) responseFailure(response, secrets);
      return parseJson(response, RenewRouteLeaseResponseSchema, 'renew');
    },

    async release(
      leaseId: string,
      request: ReleaseRouteLeaseRequest,
      signal?: AbortSignal
    ) {
      const checked = ReleaseRouteLeaseRequestSchema.parse(request);
      const response = await send(
        'DELETE',
        `/admin/api/route-leases/${encodeURIComponent(leaseId)}`,
        checked,
        signal
      );
      if (response.status === 404 || response.status === 410) {
        return {
          schemaVersion: 'omnicross.route-lease.release/1',
          leaseId,
          released: true,
        };
      }
      if (response.status < 200 || response.status >= 300) responseFailure(response, secrets);
      return parseJson(response, ReleaseRouteLeaseResponseSchema, 'release');
    },
  };
  return Object.freeze(client);
}
