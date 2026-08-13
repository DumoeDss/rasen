import type { ModelProviderOverride } from '../codex/invocation.js';
import {
  OmniCrossRouteError,
  type CreateRouteLeaseRequest,
  type CreateRouteLeaseResponse,
} from './contracts.js';
import { isLoopbackHostname } from './config.js';
import { sameUpstream } from './inference-file.js';

export const CODEX_ROUTE_TOKEN_ENV = 'OMNICROSS_CODEX_ROUTE_TOKEN' as const;
export const CLAUDE_API_KEY_SENTINEL = 'omnicross-route' as const;

export interface CodexRouteBinding {
  readonly runtime: 'codex';
  readonly env: Readonly<Record<typeof CODEX_ROUTE_TOKEN_ENV, string>>;
  readonly providerOverride: Readonly<ModelProviderOverride & {
    name: 'omnicross';
    wireApi: 'responses';
    envKey: typeof CODEX_ROUTE_TOKEN_ENV;
    disableResponseStorage: true;
  }>;
  readonly secretValues: readonly string[];
}

export interface ClaudeRouteBinding {
  readonly runtime: 'claude';
  readonly env: Readonly<{
    ANTHROPIC_BASE_URL: string;
    ANTHROPIC_AUTH_TOKEN: string;
    ANTHROPIC_MODEL: string;
    ANTHROPIC_API_KEY?: string;
  }>;
  readonly secretValues: readonly string[];
}

export type RuntimeRouteBinding = CodexRouteBinding | ClaudeRouteBinding;

function invalid(message: string): never {
  throw new OmniCrossRouteError({
    kind: 'invalid-descriptor',
    message,
    retryable: false,
  });
}

function proxyUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return invalid('OmniCross launch descriptor contains an invalid proxy URL.');
  }
  if (
    url.protocol !== 'http:' ||
    !isLoopbackHostname(url.hostname) ||
    Boolean(url.username || url.password || url.search || url.hash)
  ) {
    return invalid('OmniCross launch proxy must be an unauthenticated HTTP loopback URL.');
  }
  return url.toString().replace(/\/$/, '');
}

function decodeQuoted(value: string): string {
  if (!/^"(?:[^"\\]|\\.)*"$/.test(value)) {
    return invalid('OmniCross Codex provider string values must use quoted TOML literals.');
  }
  try {
    return JSON.parse(value) as string;
  } catch {
    return invalid('OmniCross Codex provider string literal is malformed.');
  }
}

function codexConfig(args: readonly string[]): Map<string, string> {
  if (args.length % 2 !== 0) return invalid('OmniCross Codex extraArgs must contain -c/value pairs.');
  const config = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    if (args[index] !== '-c') return invalid('OmniCross Codex descriptor may contain only -c provider overrides.');
    const expression = args[index + 1]!;
    const split = expression.indexOf('=');
    if (split <= 0) return invalid('OmniCross Codex provider override is malformed.');
    const key = expression.slice(0, split);
    const value = expression.slice(split + 1);
    if (config.has(key)) return invalid(`OmniCross Codex provider override ${key} is duplicated.`);
    config.set(key, value);
  }
  return config;
}

function reduceCodex(response: CreateRouteLeaseResponse): CodexRouteBinding {
  const envKeys = Object.keys(response.launch.env);
  if (envKeys.length !== 1 || envKeys[0] !== CODEX_ROUTE_TOKEN_ENV) {
    return invalid(`Codex launch env must contain only ${CODEX_ROUTE_TOKEN_ENV}.`);
  }
  const token = response.launch.env[CODEX_ROUTE_TOKEN_ENV]!;
  if (!token) return invalid('Codex route token is empty.');
  if (response.launch.extraArgs.some((arg) => arg.includes(token))) {
    return invalid('Codex route token must not appear in argv.');
  }
  const config = codexConfig(response.launch.extraArgs);
  const allowed = new Set([
    'model_provider',
    'model_providers.omnicross.name',
    'model_providers.omnicross.base_url',
    'model_providers.omnicross.wire_api',
    'model_providers.omnicross.env_key',
    'disable_response_storage',
  ]);
  if (config.size !== allowed.size || [...config.keys()].some((key) => !allowed.has(key))) {
    return invalid('Codex launch descriptor contains an unknown or missing provider override.');
  }
  if (
    decodeQuoted(config.get('model_provider')!) !== 'omnicross' ||
    decodeQuoted(config.get('model_providers.omnicross.name')!) !== 'omnicross' ||
    decodeQuoted(config.get('model_providers.omnicross.wire_api')!) !== 'responses' ||
    decodeQuoted(config.get('model_providers.omnicross.env_key')!) !== CODEX_ROUTE_TOKEN_ENV ||
    config.get('disable_response_storage') !== 'true'
  ) {
    return invalid('Codex launch descriptor does not select the closed OmniCross Responses provider contract.');
  }
  const baseUrl = proxyUrl(decodeQuoted(config.get('model_providers.omnicross.base_url')!));
  return Object.freeze({
    runtime: 'codex',
    env: Object.freeze({ [CODEX_ROUTE_TOKEN_ENV]: token }),
    providerOverride: Object.freeze({
      name: 'omnicross',
      baseUrl,
      wireApi: 'responses',
      envKey: CODEX_ROUTE_TOKEN_ENV,
      disableResponseStorage: true,
    }),
    secretValues: Object.freeze([token]),
  });
}

function reduceClaude(response: CreateRouteLeaseResponse): ClaudeRouteBinding {
  if (response.launch.extraArgs.length > 0) {
    return invalid('Claude launch descriptor must not contain argv overrides.');
  }
  const allowed = new Set([
    'ANTHROPIC_BASE_URL',
    'ANTHROPIC_AUTH_TOKEN',
    'ANTHROPIC_API_KEY',
    'ANTHROPIC_MODEL',
  ]);
  const keys = Object.keys(response.launch.env);
  if (keys.some((key) => !allowed.has(key))) {
    return invalid('Claude launch descriptor contains an unrecognized environment key.');
  }
  const baseUrl = response.launch.env.ANTHROPIC_BASE_URL;
  const token = response.launch.env.ANTHROPIC_AUTH_TOKEN;
  const model = response.launch.env.ANTHROPIC_MODEL;
  if (!baseUrl || !token || !model) {
    return invalid('Claude launch descriptor is missing base URL, route authentication, or model.');
  }
  if (model !== response.model) return invalid('Claude launch model does not match the frozen route model.');
  const sentinel = response.launch.env.ANTHROPIC_API_KEY;
  if (sentinel !== undefined && sentinel !== CLAUDE_API_KEY_SENTINEL) {
    return invalid('Claude API-key sentinel must use the documented non-secret value.');
  }
  return Object.freeze({
    runtime: 'claude',
    env: Object.freeze({
      ANTHROPIC_BASE_URL: proxyUrl(baseUrl),
      ANTHROPIC_AUTH_TOKEN: token,
      ANTHROPIC_MODEL: model,
      ...(sentinel ? { ANTHROPIC_API_KEY: sentinel } : {}),
    }),
    secretValues: Object.freeze([token]),
  });
}

/** Reduce a token-bearing daemon response into the only two launch contracts Rasen accepts. */
export function reduceLaunchDescriptor(
  request: CreateRouteLeaseRequest,
  response: CreateRouteLeaseResponse,
  nowMs = Date.now()
): RuntimeRouteBinding {
  if (
    response.runtime !== request.runtime ||
    response.model !== request.model ||
    !sameUpstream(response.upstream, request.upstream)
  ) {
    return invalid('OmniCross lease response does not match the requested runtime, upstream, and model.');
  }
  if (Date.parse(response.expiresAt) <= nowMs + 1_000) {
    return invalid('OmniCross lease response is already expired or inside the launch safety window.');
  }
  return response.runtime === 'codex' ? reduceCodex(response) : reduceClaude(response);
}
