import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';

import { startManagementServer, type ManagementServerHandle } from '../../../src/core/management-api/server.js';
import type { ManagementApiContext } from '../../../src/core/management-api/router.js';
import { MAX_THEME_BYTES } from '../../../src/core/theme-library/index.js';

const TOKEN = 'theme-api-token';

function request(
  port: number,
  method: string,
  requestPath: string,
  headers: Record<string, string> = {},
  body?: string | Buffer
): Promise<{ status: number; headers: http.IncomingHttpHeaders; json: any }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, method, path: requestPath, headers, agent: false },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          resolve({ status: res.statusCode ?? 0, headers: res.headers, json: text ? JSON.parse(text) : undefined });
        });
      }
    );
    req.on('error', reject);
    req.end(body);
  });
}

describe('authenticated theme API', () => {
  let home: string;
  let originalEnv: NodeJS.ProcessEnv;
  let server: ManagementServerHandle;

  const auth = (extra: Record<string, string> = {}) => ({
    Authorization: `Bearer ${TOKEN}`,
    ...extra,
  });

  beforeEach(async () => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-theme-api-'));
    originalEnv = { ...process.env };
    process.env.RASEN_HOME = home;
    const context: ManagementApiContext = {
      token: TOKEN,
      launchProjectRoot: null,
      launchProjectRef: null,
      version: 'theme-test',
      uiAssetsDir: null,
    };
    server = await startManagementServer({ context });
  });

  afterEach(async () => {
    await server.stopServer();
    process.env = originalEnv;
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('requires auth, tolerates a trailing slash, carries identity, and GET is read-only/fresh', async () => {
    expect((await request(server.port, 'GET', '/api/v1/themes')).status).toBe(401);
    const first = await request(server.port, 'GET', '/api/v1/themes/', auth());
    expect(first.status).toBe(200);
    expect(first.headers['x-rasen-daemon']).toBe('theme-test');
    expect(first.json).toEqual({ themes: [], skipped: [] });
    expect(fs.existsSync(path.join(home, 'themes'))).toBe(false);

    const body = fs.readFileSync(path.join(process.cwd(), 'test/fixtures/themes/accepted.json'));
    const imported = await request(server.port, 'POST', '/api/v1/themes/import', auth({
      'Content-Type': 'application/json',
      'Content-Length': String(body.length),
    }), body);
    expect(imported.status).toBe(201);
    const second = await request(server.port, 'GET', '/api/v1/themes', auth());
    expect(second.json.themes.map((theme: { id: string }) => theme.id)).toEqual(['forest-paper']);
  });

  it('enforces media type/size and maps stable validation/conflict errors', async () => {
    expect((await request(server.port, 'POST', '/api/v1/themes/import', auth(), '{}')).status).toBe(415);
    const oversized = await request(server.port, 'POST', '/api/v1/themes/import', auth({
      'Content-Type': 'application/json',
      'Content-Length': String(MAX_THEME_BYTES + 1),
    }));
    expect(oversized.status).toBe(413);
    expect(oversized.json.error.code).toBe('payload_too_large');

    const invalid = fs.readFileSync(path.join(process.cwd(), 'test/fixtures/themes/rejected-effect.json'));
    const rejected = await request(server.port, 'POST', '/api/v1/themes/import', auth({
      'Content-Type': 'application/json',
    }), invalid);
    expect(rejected.status).toBe(400);
    expect(rejected.json.error.code).toBe('invalid_theme');
    expect(rejected.json.error.details[0].path).toContain('effects');

    const prototypeTokens = fs.readFileSync(
      path.join(process.cwd(), 'test/fixtures/themes/rejected-prototype-tokens.json')
    );
    const prototypeRejected = await request(server.port, 'POST', '/api/v1/themes/import', auth({
      'Content-Type': 'application/json',
    }), prototypeTokens);
    expect(prototypeRejected.status).toBe(400);
    expect(prototypeRejected.json.error.code).toBe('invalid_theme');
    expect(prototypeRejected.json.error.details).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'tokens.light.constructor', code: 'unknown_token' }),
      expect.objectContaining({ path: 'tokens.light.__proto__', code: 'unknown_token' }),
      expect.objectContaining({ path: 'tokens.light.toString', code: 'unknown_token' }),
    ]));

    const valid = fs.readFileSync(path.join(process.cwd(), 'test/fixtures/themes/accepted.json'));
    expect((await request(server.port, 'POST', '/api/v1/themes/import', auth({ 'Content-Type': 'application/json' }), valid)).status).toBe(201);
    const conflict = await request(server.port, 'POST', '/api/v1/themes/import', auth({ 'Content-Type': 'application/json' }), valid);
    expect(conflict.status).toBe(409);
    expect(conflict.json.error.code).toBe('identifier_conflict');
  });

  it('rejects unsupported methods and does not admit deeper suffixes', async () => {
    for (const [method, url] of [
      ['POST', '/api/v1/themes'],
      ['GET', '/api/v1/themes/import'],
      ['PUT', '/api/v1/themes'],
      ['DELETE', '/api/v1/themes/import'],
    ]) {
      expect((await request(server.port, method, url, auth())).status).toBe(405);
    }
    expect((await request(server.port, 'GET', '/api/v1/themes/extra', auth())).status).toBe(404);
  });
});

