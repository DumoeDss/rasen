// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as client from '../../src/api/client.js';
import { initTokenFromLocation, isUnauthorized, resetTokenStateForTest } from '../../src/api/token.js';
import { healthFixture } from '../fixtures/health.js';
import { errorsFixture } from '../fixtures/errors.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('token → client integration', () => {
  beforeEach(() => {
    resetTokenStateForTest();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => vi.unstubAllGlobals());

  it('sends the fragment token as a Bearer header on every request', async () => {
    window.history.replaceState(null, '', '/#token=deadbeef');
    initTokenFromLocation();

    (fetch as any).mockResolvedValueOnce(jsonResponse(200, healthFixture));
    await client.health();

    const [, init] = (fetch as any).mock.calls[0];
    expect(init.headers['Authorization']).toBe('Bearer deadbeef');
  });

  it('marks the session unauthorized on a 401 response', async () => {
    window.history.replaceState(null, '', '/#token=stale');
    initTokenFromLocation();

    const { status, body } = errorsFixture.unauthorized;
    (fetch as any).mockResolvedValueOnce(jsonResponse(status, body));

    await expect(client.health()).rejects.toMatchObject({ code: 'unauthorized' });
    expect(isUnauthorized()).toBe(true);
  });

  it('board fetches (listChanges) go through the same seam: 401 triggers the re-launch notice path', async () => {
    window.history.replaceState(null, '', '/#token=stale');
    initTokenFromLocation();

    const { status, body } = errorsFixture.unauthorized;
    (fetch as any).mockResolvedValueOnce(jsonResponse(status, body));

    await expect(client.listChanges()).rejects.toMatchObject({ code: 'unauthorized' });
    // `markUnauthorized` is generic across every client function (design D9
    // of `unified-config-ui-pkg`) — the board's fetches inherit it for free,
    // which is exactly what board-ui's "shared API seam" requirement means.
    expect(isUnauthorized()).toBe(true);
  });
});
