/**
 * Cloudflare Access JWT verification for the admin surface.
 *
 * The `*.workers.dev` host does NOT pass through Cloudflare Access, so the Worker
 * must verify the Access identity itself on every /admin* and /api/admin* request
 * — fail-closed. Model mirrors the elftia backend-cf `services/admin.ts`
 * (createRemoteJWKSet + jwtVerify, a test-overridable certs URL, an
 * isConfigured gate), adapted to a bare Worker (no framework) and this change's
 * env var names.
 */
import { jwtVerify, createRemoteJWKSet } from 'jose';

export interface AccessEnv {
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  /** Optional defense-in-depth allowlist (JSON array or comma-separated). */
  ACCESS_ALLOWED_EMAILS?: string;
}

// jose's second argument to jwtVerify: a key or a key-resolver function.
type KeyResolver = Parameters<typeof jwtVerify>[1];

// Test hooks (inert in production). `certs` overrides the derived certs URL;
// `keySet`, when set, replaces the network-backed remote JWKS with a caller-
// supplied resolver (e.g. jose.createLocalJWKSet) so unit tests verify real
// RS256 signatures with no network — jose's Node build fetches JWKS over
// node:https directly and cannot be stubbed via global fetch.
export const ACCESS_URLS: { certs: string; keySet?: KeyResolver } = { certs: '' };

function certsUrlFor(env: AccessEnv): string {
  if (ACCESS_URLS.certs) return ACCESS_URLS.certs;
  return `https://${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`;
}

// JWKS sets cached per-URL within the isolate so verification does not re-fetch
// certs on every request.
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
function jwks(url: string): KeyResolver {
  if (ACCESS_URLS.keySet) return ACCESS_URLS.keySet;
  let set = jwksCache.get(url);
  if (!set) {
    set = createRemoteJWKSet(new URL(url));
    jwksCache.set(url, set);
  }
  return set;
}

/**
 * Configured only when BOTH Access values are present and non-empty. Checked
 * before reading any token, so an un-provisioned deploy exposes no admin surface.
 */
export function isAccessConfigured(env: AccessEnv): boolean {
  return Boolean(env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD);
}

// Accept a JSON array OR a comma-separated string; lowercased into a Set.
function parseAllowedEmails(raw: string | undefined): Set<string> {
  if (!raw) return new Set();
  let list: string[] = [];
  try {
    const v: unknown = JSON.parse(raw);
    if (Array.isArray(v)) {
      list = v.filter((x): x is string => typeof x === 'string');
    } else {
      list = String(raw).split(',').map((s) => s.trim()).filter(Boolean);
    }
  } catch {
    list = raw.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return new Set(list.map((e) => e.toLowerCase()));
}

/**
 * Verify the Cf-Access-Jwt-Assertion token against the Access team JWKS with the
 * algorithm pinned to RS256, the audience pinned to ACCESS_AUD, and the issuer
 * pinned to https://<team>. jwtVerify enforces exp/nbf automatically. Returns the
 * lowercased email claim, or null on any failure.
 */
export async function verifyAccessJwt(
  env: AccessEnv,
  token: string
): Promise<{ email: string } | null> {
  if (!isAccessConfigured(env)) return null;
  try {
    const { payload } = await jwtVerify(token, jwks(certsUrlFor(env)), {
      algorithms: ['RS256'],
      audience: env.ACCESS_AUD,
      issuer: `https://${env.ACCESS_TEAM_DOMAIN}`,
    });
    const email = typeof payload.email === 'string' ? payload.email : undefined;
    if (!email) return null;
    return { email: email.toLowerCase() };
  } catch {
    return null;
  }
}

/**
 * The single fail-closed gate the router calls. Collapses every denial into null:
 * unconfigured, missing token, invalid JWT, or (when ACCESS_ALLOWED_EMAILS is set)
 * an email not on the allowlist. Otherwise returns the verified identity.
 */
export async function verifyAdminAccess(
  env: AccessEnv,
  headerToken: string | null | undefined
): Promise<{ email: string } | null> {
  if (!isAccessConfigured(env)) return null;
  if (!headerToken) return null;
  const verified = await verifyAccessJwt(env, headerToken);
  if (!verified) return null;
  const allow = parseAllowedEmails(env.ACCESS_ALLOWED_EMAILS);
  if (allow.size > 0 && !allow.has(verified.email)) return null;
  return verified;
}
