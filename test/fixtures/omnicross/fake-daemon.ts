import * as http from 'node:http';
import type { AddressInfo } from 'node:net';

import type {
  CreateRouteLeaseRequest,
  OmniCrossUpstream,
} from '../../../src/core/omnicross/contracts.js';

export interface CapturedOmniCrossRequest {
  readonly method: string;
  readonly path: string;
  readonly authorization?: string;
  readonly body: unknown;
}

export interface FakeOmniCrossDaemonOptions {
  readonly controlToken?: string;
  readonly failCreate?: {
    status: number;
    code: string;
    message: string;
    retryable: boolean;
  };
  readonly omitNoStore?: boolean;
  readonly createExpiryMs?: number;
  readonly renewExpiryMs?: number;
  readonly failRenew?: {
    status: number;
    code: string;
    message: string;
    retryable: boolean;
  };
  readonly failRelease?: {
    status: number;
    code: string;
    message: string;
    retryable: boolean;
  };
  readonly descriptor?: (request: CreateRouteLeaseRequest, token: string) => {
    env: Record<string, string>;
    extraArgs: string[];
  };
}

export interface FakeOmniCrossDaemon {
  readonly endpoint: string;
  readonly controlToken: string;
  readonly requests: CapturedOmniCrossRequest[];
  readonly activeLeases: ReadonlySet<string>;
  close(): Promise<void>;
}

function defaultDescriptor(
  request: CreateRouteLeaseRequest,
  token: string
): { env: Record<string, string>; extraArgs: string[] } {
  if (request.runtime === 'codex') {
    return {
      env: { OMNICROSS_CODEX_ROUTE_TOKEN: token },
      extraArgs: [
        '-c', 'model_provider="omnicross"',
        '-c', 'model_providers.omnicross.name="omnicross"',
        '-c', 'model_providers.omnicross.base_url="http://127.0.0.1:8766/openai"',
        '-c', 'model_providers.omnicross.wire_api="responses"',
        '-c', 'model_providers.omnicross.env_key="OMNICROSS_CODEX_ROUTE_TOKEN"',
        '-c', 'disable_response_storage=true',
      ],
    };
  }
  return {
    env: {
      ANTHROPIC_BASE_URL: 'http://127.0.0.1:8766/anthropic',
      ANTHROPIC_AUTH_TOKEN: token,
      ANTHROPIC_API_KEY: 'omnicross-route',
      ANTHROPIC_MODEL: request.model,
    },
    extraArgs: [],
  };
}

async function readJson(request: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

export async function startFakeOmniCrossDaemon(
  options: FakeOmniCrossDaemonOptions = {}
): Promise<FakeOmniCrossDaemon> {
  const controlToken = options.controlToken ?? 'fake-admin-control-token';
  const requests: CapturedOmniCrossRequest[] = [];
  const leases = new Map<string, {
    runtime: 'claude' | 'codex';
    upstream: OmniCrossUpstream;
    model: string;
  }>();
  let serial = 0;

  const server = http.createServer(async (request, response) => {
    const body = await readJson(request).catch(() => undefined);
    requests.push({
      method: request.method ?? '',
      path: request.url ?? '',
      ...(request.headers.authorization ? { authorization: request.headers.authorization } : {}),
      body,
    });
    response.setHeader('content-type', 'application/json');
    if (request.headers.authorization !== `Bearer ${controlToken}`) {
      response.statusCode = 401;
      response.end(JSON.stringify({
        schemaVersion: 'omnicross.error/1',
        error: { code: 'control_unauthorized', message: 'bad control token', retryable: false },
      }));
      return;
    }

    if (request.method === 'POST' && request.url === '/admin/api/route-leases') {
      if (options.failCreate) {
        response.statusCode = options.failCreate.status;
        response.end(JSON.stringify({
          schemaVersion: 'omnicross.error/1',
          error: {
            code: options.failCreate.code,
            message: options.failCreate.message,
            retryable: options.failCreate.retryable,
          },
        }));
        return;
      }
      const leaseRequest = body as CreateRouteLeaseRequest;
      serial += 1;
      const leaseId = `lease-${serial}`;
      const token = `route-token-${serial}`;
      leases.set(leaseId, {
        runtime: leaseRequest.runtime,
        upstream: leaseRequest.upstream,
        model: leaseRequest.model,
      });
      if (!options.omitNoStore) response.setHeader('cache-control', 'no-store');
      response.end(JSON.stringify({
        schemaVersion: 'omnicross.route-lease/1',
        leaseId,
        expiresAt: new Date(Date.now() + (options.createExpiryMs ?? 120_000)).toISOString(),
        runtime: leaseRequest.runtime,
        upstream: leaseRequest.upstream,
        model: leaseRequest.model,
        launch: (options.descriptor ?? defaultDescriptor)(leaseRequest, token),
      }));
      return;
    }

    const renew = /^\/admin\/api\/route-leases\/([^/]+)\/renew$/.exec(request.url ?? '');
    if (request.method === 'POST' && renew) {
      if (options.failRenew) {
        response.statusCode = options.failRenew.status;
        response.end(JSON.stringify({
          schemaVersion: 'omnicross.error/1',
          error: options.failRenew,
        }));
        return;
      }
      const leaseId = decodeURIComponent(renew[1]!);
      const lease = leases.get(leaseId);
      if (!lease) {
        response.statusCode = 404;
        response.end(JSON.stringify({
          schemaVersion: 'omnicross.error/1',
          error: { code: 'lease_not_found', message: 'missing lease', retryable: false },
        }));
        return;
      }
      response.end(JSON.stringify({
        schemaVersion: 'omnicross.route-lease.metadata/1',
        leaseId,
        expiresAt: new Date(Date.now() + (options.renewExpiryMs ?? 120_000)).toISOString(),
        ...lease,
        status: 'active',
      }));
      return;
    }

    const release = /^\/admin\/api\/route-leases\/([^/]+)$/.exec(request.url ?? '');
    if (request.method === 'DELETE' && release) {
      const leaseId = decodeURIComponent(release[1]!);
      if (options.failRelease) {
        response.statusCode = options.failRelease.status;
        response.end(JSON.stringify({
          schemaVersion: 'omnicross.error/1',
          error: options.failRelease,
        }));
        return;
      }
      leases.delete(leaseId);
      response.end(JSON.stringify({
        schemaVersion: 'omnicross.route-lease.release/1',
        leaseId,
        released: true,
      }));
      return;
    }

    response.statusCode = 404;
    response.end(JSON.stringify({
      schemaVersion: 'omnicross.error/1',
      error: { code: 'lease_not_found', message: 'unknown path', retryable: false },
    }));
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address() as AddressInfo;
  return {
    endpoint: `http://127.0.0.1:${address.port}`,
    controlToken,
    requests,
    get activeLeases() {
      return new Set(leases.keys());
    },
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}
