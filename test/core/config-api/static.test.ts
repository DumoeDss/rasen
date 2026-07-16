import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type * as http from 'node:http';

import { serveStatic } from '../../../src/core/config-api/static.js';
import { UI_PACKAGE_NAME } from '../../../src/core/config-api/ui-package.js';

function fakeResponse() {
  const state = { status: 0, headers: {} as Record<string, string>, body: '' };
  const res = {
    writeHead(status: number, headers: Record<string, string>) {
      state.status = status;
      state.headers = headers;
    },
    end(body?: Buffer | string) {
      if (body) state.body = Buffer.isBuffer(body) ? body.toString('utf-8') : body;
    },
  } as unknown as http.ServerResponse;
  return { res, state };
}

describe('serveStatic', () => {
  let assetsDir: string;

  beforeEach(() => {
    assetsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-config-ui-assets-'));
    fs.writeFileSync(path.join(assetsDir, 'index.html'), '<html>index</html>');
    fs.writeFileSync(path.join(assetsDir, 'app.js'), 'console.log(1)');
  });

  afterEach(() => {
    fs.rmSync(assetsDir, { recursive: true, force: true });
  });

  it('serves the built-in hint page when assetsDir is null', async () => {
    const { res, state } = fakeResponse();
    await serveStatic(null, '/', res);
    expect(state.status).toBe(200);
    expect(state.body).toContain(UI_PACKAGE_NAME);
  });

  it('serves index.html at /', async () => {
    const { res, state } = fakeResponse();
    await serveStatic(assetsDir, '/', res);
    expect(state.status).toBe(200);
    expect(state.body).toBe('<html>index</html>');
    expect(state.headers['Cache-Control']).toBe('no-store');
  });

  it('serves a known asset with the correct MIME type', async () => {
    const { res, state } = fakeResponse();
    await serveStatic(assetsDir, '/app.js', res);
    expect(state.status).toBe(200);
    expect(state.headers['Content-Type']).toContain('javascript');
    expect(state.body).toBe('console.log(1)');
  });

  it('falls back to index.html for an unknown client-side route', async () => {
    const { res, state } = fakeResponse();
    await serveStatic(assetsDir, '/settings/general', res);
    expect(state.status).toBe(200);
    expect(state.body).toBe('<html>index</html>');
  });

  it('does not escape assetsDir via path traversal', async () => {
    const { res, state } = fakeResponse();
    await serveStatic(assetsDir, '/../../../../etc/passwd', res);
    // Falls back to the index page rather than serving anything outside assetsDir.
    expect(state.status).toBe(200);
    expect(state.body).toBe('<html>index</html>');
  });
});
