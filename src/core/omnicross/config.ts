import { createHash } from 'node:crypto';

import type { EffectiveConfigEntry } from '../effective-config.js';
import {
  OmniCrossConnectionIdentitySchema,
  OmniCrossRouteError,
  type OmniCrossConnectionIdentity,
} from './contracts.js';

export const DEFAULT_OMNICROSS_CONTROL_TOKEN_ENV = 'OMNICROSS_ADMIN_TOKEN';
export const DEFAULT_OMNICROSS_REQUEST_TIMEOUT_MS = 5_000;
export const DEFAULT_OMNICROSS_LEASE_TTL_SECONDS = 600;

function invalidConfig(message: string): never {
  throw new OmniCrossRouteError({
    kind: 'invalid-config',
    message,
    retryable: false,
  });
}

function ipv4Loopback(hostname: string): boolean {
  const parts = hostname.split('.');
  return (
    parts.length === 4 &&
    parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255) &&
    Number(parts[0]) === 127
  );
}

export function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return normalized === 'localhost' || normalized === '::1' || ipv4Loopback(normalized);
}

/** Normalize the v1 control-plane boundary to one credential-free HTTP loopback origin. */
export function normalizeOmniCrossEndpoint(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return invalidConfig('omnicross.endpoint must be a valid absolute HTTP URL.');
  }
  if (url.protocol !== 'http:') {
    return invalidConfig('omnicross.endpoint must use http:; remote/TLS daemons are not supported in this capability.');
  }
  if (!isLoopbackHostname(url.hostname)) {
    return invalidConfig('omnicross.endpoint must name localhost, 127.0.0.0/8, or [::1]; remote daemons are not supported.');
  }
  if (url.username || url.password || url.search || url.hash) {
    return invalidConfig('omnicross.endpoint must not contain credentials, query parameters, or a fragment.');
  }
  if (url.pathname !== '/' && url.pathname !== '') {
    return invalidConfig('omnicross.endpoint must be an origin without a path.');
  }
  return url.origin;
}

export function computeOmniCrossConfigRevision(
  value: Omit<OmniCrossConnectionIdentity, 'configRevision'>
): string {
  const canonical = JSON.stringify({
    endpoint: value.endpoint,
    controlTokenEnv: value.controlTokenEnv,
    requestTimeoutMs: value.requestTimeoutMs,
    leaseTtlSeconds: value.leaseTtlSeconds,
  });
  return `sha256:${createHash('sha256').update(canonical).digest('hex')}`;
}

function entryValue(entries: readonly EffectiveConfigEntry[], key: string): unknown {
  return entries.find((entry) => entry.definition.key === key)?.value;
}

/** Resolve the four ordinary effective-config entries into a frozen, non-secret identity. */
export function resolveOmniCrossConnectionFromEntries(
  entries: readonly EffectiveConfigEntry[]
): OmniCrossConnectionIdentity {
  const rawEndpoint = entryValue(entries, 'omnicross.endpoint');
  if (typeof rawEndpoint !== 'string' || rawEndpoint.trim() === '') {
    return invalidConfig('omnicross.endpoint is required for a routed stage.');
  }
  const endpoint = normalizeOmniCrossEndpoint(rawEndpoint.trim());
  const rawEnv = entryValue(entries, 'omnicross.controlTokenEnv');
  const controlTokenEnv =
    typeof rawEnv === 'string' && rawEnv.length > 0
      ? rawEnv
      : DEFAULT_OMNICROSS_CONTROL_TOKEN_ENV;
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(controlTokenEnv)) {
    return invalidConfig('omnicross.controlTokenEnv must be a valid environment variable name.');
  }
  const rawTimeout = entryValue(entries, 'omnicross.requestTimeoutMs');
  const requestTimeoutMs =
    typeof rawTimeout === 'number'
      ? rawTimeout
      : DEFAULT_OMNICROSS_REQUEST_TIMEOUT_MS;
  const rawTtl = entryValue(entries, 'omnicross.leaseTtlSeconds');
  const leaseTtlSeconds =
    typeof rawTtl === 'number'
      ? rawTtl
      : DEFAULT_OMNICROSS_LEASE_TTL_SECONDS;
  const base = { endpoint, controlTokenEnv, requestTimeoutMs, leaseTtlSeconds };
  return OmniCrossConnectionIdentitySchema.parse({
    ...base,
    configRevision: computeOmniCrossConfigRevision(base),
  });
}

export function validateFrozenOmniCrossConnection(
  value: unknown
): OmniCrossConnectionIdentity {
  const parsed = OmniCrossConnectionIdentitySchema.safeParse(value);
  if (!parsed.success) {
    return invalidConfig(`Frozen OmniCross connection is invalid: ${parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`);
  }
  const endpoint = normalizeOmniCrossEndpoint(parsed.data.endpoint);
  const base = {
    endpoint,
    controlTokenEnv: parsed.data.controlTokenEnv,
    requestTimeoutMs: parsed.data.requestTimeoutMs,
    leaseTtlSeconds: parsed.data.leaseTtlSeconds,
  };
  const expected = computeOmniCrossConfigRevision(base);
  if (parsed.data.configRevision !== expected) {
    return invalidConfig('Frozen OmniCross connection revision does not match its non-secret settings.');
  }
  return Object.freeze({ ...base, configRevision: expected });
}

export interface OmniCrossControlAuthority {
  readonly connection: OmniCrossConnectionIdentity;
  readonly controlToken: string;
}

/** Look up the control credential only at dispatch time; never mutate or return the source environment. */
export function resolveOmniCrossControlAuthority(
  connection: OmniCrossConnectionIdentity,
  env: NodeJS.ProcessEnv = process.env
): OmniCrossControlAuthority {
  const checked = validateFrozenOmniCrossConnection(connection);
  const token = env[checked.controlTokenEnv];
  if (typeof token !== 'string' || token.trim() === '') {
    return invalidConfig(`OmniCross control credential environment variable ${checked.controlTokenEnv} is missing or empty.`);
  }
  return Object.freeze({ connection: checked, controlToken: token });
}

/** Construct a child-only environment without forwarding the Admin credential. */
export function buildRoutedChildEnvironment(
  parent: NodeJS.ProcessEnv,
  controlTokenEnv: string,
  routeEnv: Readonly<Record<string, string>>
): NodeJS.ProcessEnv {
  const child = { ...parent };
  delete child[controlTokenEnv];
  if (Object.hasOwn(routeEnv, 'ANTHROPIC_BASE_URL')) {
    for (const key of [
      'ANTHROPIC_BASE_URL',
      'ANTHROPIC_AUTH_TOKEN',
      'ANTHROPIC_API_KEY',
      'ANTHROPIC_MODEL',
    ]) {
      delete child[key];
    }
  }
  if (Object.hasOwn(routeEnv, 'OMNICROSS_CODEX_ROUTE_TOKEN')) {
    delete child.OMNICROSS_CODEX_ROUTE_TOKEN;
  }
  return { ...child, ...routeEnv };
}
