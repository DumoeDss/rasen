import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { generateKeyPair, exportJWK, SignJWT, createLocalJWKSet, type KeyLike, type JWK } from 'jose';
import worker from '../src/index';
import { ACCESS_URLS } from '../src/access';

const TEAM_DOMAIN = 'testteam.cloudflareaccess.com';
const AUD = 'test-aud-tag';
const KID = 'test-kid';
const SQL_API_PREFIX = 'https://api.cloudflare.com/client/v4/accounts/';

let privateKey: KeyLike;
let publicJwk: JWK;

// Mint a valid Access-style JWT signed by the test keypair.
async function mintToken(overrides: { aud?: string; iss?: string; email?: string; expiresIn?: string } = {}) {
  return new SignJWT({ email: overrides.email ?? 'ws11579@gmail.com' })
    .setProtectedHeader({ alg: 'RS256', kid: KID })
    .setIssuedAt()
    .setIssuer(overrides.iss ?? `https://${TEAM_DOMAIN}`)
    .setAudience(overrides.aud ?? AUD)
    .setExpirationTime(overrides.expiresIn ?? '5m')
    .sign(privateKey);
}

// Records SQL bodies the handler POSTs so tests can assert query shaping.
let sqlBodies: string[];
let sqlResponse: { status: number; body: unknown };

function installFetchStub() {
  sqlBodies = [];
  sqlResponse = { status: 200, body: { data: [] } };
  // Only the CF SQL API goes through global fetch; JWKS is injected in-memory
  // via ACCESS_URLS.keySet (jose's Node build bypasses global fetch for JWKS).
  vi.stubGlobal('fetch', async (input: unknown, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : (input as Request).url ?? String(input);
    if (url.startsWith(SQL_API_PREFIX)) {
      sqlBodies.push(String(init?.body ?? ''));
      return new Response(JSON.stringify(sqlResponse.body), { status: sqlResponse.status });
    }
    throw new Error('unexpected fetch to ' + url);
  });
}

interface TestEnv {
  TELEMETRY: { writeDataPoint: ReturnType<typeof vi.fn> };
  ASSETS: { fetch: ReturnType<typeof vi.fn> };
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  ACCESS_ALLOWED_EMAILS?: string;
  TELEMETRY_SQL_TOKEN?: string;
}

function makeEnv(over: Partial<TestEnv> = {}): TestEnv {
  return {
    TELEMETRY: { writeDataPoint: vi.fn() },
    ASSETS: { fetch: vi.fn(async () => new Response('PANEL-HTML-BYTES', { status: 200 })) },
    ...over,
  };
}

const accessEnv = () => makeEnv({ ACCESS_TEAM_DOMAIN: TEAM_DOMAIN, ACCESS_AUD: AUD });

function req(path: string, init: RequestInit = {}) {
  return new Request('https://openspec-telemetry.ws11579.workers.dev' + path, init);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const call = (r: Request, env: TestEnv) => (worker as any).fetch(r, env);

beforeAll(async () => {
  const kp = await generateKeyPair('RS256', { extractable: true });
  privateKey = kp.privateKey;
  publicJwk = { ...(await exportJWK(kp.publicKey)), kid: KID, alg: 'RS256', use: 'sig' };
  // Inject an in-memory JWKS so verification runs offline against the test key.
  ACCESS_URLS.keySet = createLocalJWKSet({ keys: [publicJwk] });
});

beforeEach(() => installFetchStub());
afterEach(() => vi.unstubAllGlobals());

describe('ingest (unchanged public path)', () => {
  it('POST / valid event → 202 and writes one data point', async () => {
    const env = makeEnv();
    const res = await call(
      req('/', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ command: 'init', version: '0.1.0', distinctId: 'u1', os: 'linux', node_version: '22' }) }),
      env
    );
    expect(res.status).toBe(202);
    expect(env.TELEMETRY.writeDataPoint).toHaveBeenCalledTimes(1);
  });

  it('POST / missing required field → 400, writes nothing', async () => {
    const env = makeEnv();
    const res = await call(
      req('/', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ command: 'init', version: '0.1.0' }) }),
      env
    );
    expect(res.status).toBe(400);
    expect(env.TELEMETRY.writeDataPoint).not.toHaveBeenCalled();
  });

  it('GET / → 405', async () => {
    const res = await call(req('/', { method: 'GET' }), makeEnv());
    expect(res.status).toBe(405);
  });

  it('unexpected fields are ignored (only contract fields persisted)', async () => {
    const env = makeEnv();
    await call(
      req('/', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ command: 'init', version: '0.1.0', distinctId: 'u1', cwd: '/secret/path', args: ['--force'] }) }),
      env
    );
    const dp = env.TELEMETRY.writeDataPoint.mock.calls[0][0];
    expect(dp.blobs).toEqual(['init', '0.1.0', '', '']);
    expect(dp.indexes).toEqual(['u1']);
    expect(JSON.stringify(dp)).not.toContain('/secret/path');
  });
});

describe('fail-closed admin enforcement', () => {
  it('no Access config → GET /admin 403 sealed HTML, no asset bytes, ASSETS not called', async () => {
    const env = makeEnv();
    const res = await call(req('/admin'), env);
    expect(res.status).toBe(403);
    const body = await res.text();
    expect(body).not.toContain('PANEL-HTML-BYTES');
    expect(env.ASSETS.fetch).not.toHaveBeenCalled();
  });

  it('no Access config → GET /api/admin/overview 403 JSON', async () => {
    const res = await call(req('/api/admin/overview'), makeEnv());
    expect(res.status).toBe(403);
    expect(res.headers.get('content-type')).toContain('application/json');
  });

  it('Access configured but no JWT header → 403, ASSETS not called', async () => {
    const env = accessEnv();
    const res = await call(req('/admin'), env);
    expect(res.status).toBe(403);
    expect(env.ASSETS.fetch).not.toHaveBeenCalled();
  });

  it('Access configured, forged/garbage JWT → 403', async () => {
    const env = accessEnv();
    const res = await call(req('/admin', { headers: { 'Cf-Access-Jwt-Assertion': 'not.a.real.jwt' } }), env);
    expect(res.status).toBe(403);
    expect(env.ASSETS.fetch).not.toHaveBeenCalled();
  });

  it('valid JWT with wrong audience → 403', async () => {
    const env = accessEnv();
    const token = await mintToken({ aud: 'someone-elses-aud' });
    const res = await call(req('/admin', { headers: { 'Cf-Access-Jwt-Assertion': token } }), env);
    expect(res.status).toBe(403);
  });
});

describe('valid identity', () => {
  it('valid JWT → GET /admin 200 serving the panel via ASSETS(/index.html)', async () => {
    const env = accessEnv();
    const token = await mintToken();
    const res = await call(req('/admin', { headers: { 'Cf-Access-Jwt-Assertion': token } }), env);
    expect(res.status).toBe(200);
    expect(env.ASSETS.fetch).toHaveBeenCalledTimes(1);
    const served = env.ASSETS.fetch.mock.calls[0][0] as Request;
    expect(new URL(served.url).pathname).toBe('/index.html');
  });

  it('valid JWT + missing TELEMETRY_SQL_TOKEN → /api/admin/overview 503 with hint', async () => {
    const env = accessEnv(); // no TELEMETRY_SQL_TOKEN
    const token = await mintToken();
    const res = await call(req('/api/admin/overview', { headers: { 'Cf-Access-Jwt-Assertion': token } }), env);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe('stats_unconfigured');
    expect(body.hint).toContain('TELEMETRY_SQL_TOKEN');
  });

  it('valid JWT + SQL token → /api/admin/dau?days=999 clamps to 30 in the query', async () => {
    const env = accessEnv();
    env.TELEMETRY_SQL_TOKEN = 'sql-token';
    const token = await mintToken();
    const res = await call(req('/api/admin/dau?days=999', { headers: { 'Cf-Access-Jwt-Assertion': token } }), env);
    expect(res.status).toBe(200);
    expect(sqlBodies.length).toBeGreaterThan(0);
    expect(sqlBodies[0]).toContain("INTERVAL '30' DAY");
    expect(sqlBodies[0]).not.toContain('999');
  });

  it('valid JWT + SQL upstream 403 → clean 502 (not a crash)', async () => {
    const env = accessEnv();
    env.TELEMETRY_SQL_TOKEN = 'sql-token';
    sqlResponse = { status: 403, body: 'forbidden' };
    const token = await mintToken();
    const res = await call(req('/api/admin/commands', { headers: { 'Cf-Access-Jwt-Assertion': token } }), env);
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe('stats_upstream_error');
  });
});
