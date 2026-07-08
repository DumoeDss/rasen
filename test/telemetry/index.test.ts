import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { randomUUID } from 'node:crypto';
import https from 'node:https';

// The maintainer-owned Cloudflare Worker endpoint (fork-phase1-telemetry-backend).
const TELEMETRY_ENDPOINT = 'https://openspec-telemetry.ws11579.workers.dev';
const TELEMETRY_REQUEST_TIMEOUT_MS = 1000;

type TelemetryModule = typeof import('../../src/telemetry/index.js');

/**
 * Import the telemetry module fresh, after vi.resetModules(), so its
 * module-level caches (anonymousId, in-flight send) never leak across tests.
 */
async function loadTelemetry(): Promise<TelemetryModule> {
  return import('../../src/telemetry/index.js');
}

interface CapturedRequest {
  url: unknown;
  options: any;
  body?: string;
}

type Behavior = 'ok' | 'error' | 'never';

describe('telemetry/index', () => {
  let tempDir: string;
  let originalEnv: NodeJS.ProcessEnv;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let requestSpy: ReturnType<typeof vi.spyOn<typeof https, 'request'>>;
  let captured: CapturedRequest[];

  /**
   * Replace https.request with a controllable double. Records url/options/body
   * and drives resolution according to `behavior`:
   * - 'ok'    → invokes the response callback and emits 'end' (202-style)
   * - 'error' → emits a request 'error' (network failure)
   * - 'never' → emits nothing; only the module's guard timer can resolve it
   */
  function installHttpsMock(behavior: Behavior = 'ok'): void {
    requestSpy.mockImplementation(((...args: any[]) => {
      const [url, options, callback] = args;
      const rec: CapturedRequest = { url, options };
      captured.push(rec);

      const req: any = new EventEmitter();
      req.destroy = vi.fn();
      req.end = vi.fn((body?: string) => {
        rec.body = body;
        if (behavior === 'ok') {
          const res: any = new EventEmitter();
          callback(res);
          queueMicrotask(() => res.emit('end'));
        } else if (behavior === 'error') {
          queueMicrotask(() => req.emit('error', new Error('network down')));
        }
        // 'never': stay silent; the module's guard timer must resolve it.
      });
      return req;
    }) as any);
  }

  beforeEach(() => {
    tempDir = path.join(os.tmpdir(), `openspec-telemetry-test-${randomUUID()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    originalEnv = { ...process.env };
    process.env.XDG_CONFIG_HOME = tempDir;
    process.env.HOME = tempDir;
    process.env.USERPROFILE = tempDir;
    delete process.env.RASEN_TELEMETRY;
    delete process.env.DO_NOT_TRACK;
    delete process.env.CI;

    vi.resetModules();
    vi.clearAllMocks();

    captured = [];
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    requestSpy = vi.spyOn(https, 'request');
    installHttpsMock('ok');
  });

  afterEach(() => {
    process.env = originalEnv;
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
    vi.restoreAllMocks();
  });

  describe('isTelemetryEnabled', () => {
    it('should return false when RASEN_TELEMETRY=0', async () => {
      process.env.RASEN_TELEMETRY = '0';
      const { isTelemetryEnabled } = await loadTelemetry();
      expect(isTelemetryEnabled()).toBe(false);
    });

    it('should return false when DO_NOT_TRACK=1', async () => {
      process.env.DO_NOT_TRACK = '1';
      const { isTelemetryEnabled } = await loadTelemetry();
      expect(isTelemetryEnabled()).toBe(false);
    });

    it('should return false when CI=true', async () => {
      process.env.CI = 'true';
      const { isTelemetryEnabled } = await loadTelemetry();
      expect(isTelemetryEnabled()).toBe(false);
    });

    it('should return true when no opt-out is set', async () => {
      const { isTelemetryEnabled } = await loadTelemetry();
      expect(isTelemetryEnabled()).toBe(true);
    });

    it('should prioritize RASEN_TELEMETRY=0 over other settings', async () => {
      process.env.RASEN_TELEMETRY = '0';
      const { isTelemetryEnabled } = await loadTelemetry();
      expect(isTelemetryEnabled()).toBe(false);
    });
  });

  describe('trackCommand', () => {
    it('POSTs the event to the maintainer Worker endpoint', async () => {
      const { trackCommand, shutdown } = await loadTelemetry();

      await trackCommand('change:apply', '0.1.0');
      await shutdown();

      expect(requestSpy).toHaveBeenCalledTimes(1);
      const { url, options } = captured[0];
      expect(url).toBe(TELEMETRY_ENDPOINT);
      expect(options.method).toBe('POST');
      expect(options.headers['content-type']).toBe('application/json');
      // agent:false → no keep-alive pool that would delay CLI exit.
      expect(options.agent).toBe(false);
    });

    it('sends exactly command, version, distinctId, os, node_version and nothing else', async () => {
      const { trackCommand, shutdown } = await loadTelemetry();

      await trackCommand('change:apply', '0.1.0');
      await shutdown();

      const body = JSON.parse(captured[0].body as string);
      expect(Object.keys(body).sort()).toEqual(
        ['command', 'distinctId', 'node_version', 'os', 'version'].sort()
      );
      expect(body.command).toBe('change:apply');
      expect(body.version).toBe('0.1.0');
      expect(body.os).toBe(process.platform);
      expect(body.node_version).toBe(process.versions.node);
      expect(typeof body.distinctId).toBe('string');
      expect(body.distinctId.length).toBeGreaterThan(0);
    });

    it('never sends PostHog-only or privacy-sensitive fields', async () => {
      const { trackCommand, shutdown } = await loadTelemetry();

      await trackCommand('init', '0.1.0');
      await shutdown();

      const body = JSON.parse(captured[0].body as string);
      expect(body).not.toHaveProperty('surface');
      expect(body).not.toHaveProperty('$ip');
      expect(body).not.toHaveProperty('arguments');
      expect(body).not.toHaveProperty('args');
      expect(body).not.toHaveProperty('path');
      expect(body).not.toHaveProperty('project');
    });

    it('sends a single request and does not retry', async () => {
      const { trackCommand, shutdown } = await loadTelemetry();

      await trackCommand('init', '0.1.0');
      await shutdown();

      expect(requestSpy).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['RASEN_TELEMETRY', '0'],
      ['DO_NOT_TRACK', '1'],
      ['CI', 'true'],
    ])('does not send or generate an id when %s=%s', async (key, value) => {
      process.env[key] = value;
      const { trackCommand, shutdown } = await loadTelemetry();

      await trackCommand('init', '0.1.0');
      await shutdown();

      expect(requestSpy).not.toHaveBeenCalled();
      // No anonymous id persisted → no config file written under the temp home.
      expect(fs.existsSync(path.join(tempDir, 'openspec', 'config.json'))).toBe(false);
    });
  });

  describe('silent failure', () => {
    it('swallows a network error without throwing', async () => {
      installHttpsMock('error');
      const { trackCommand, shutdown } = await loadTelemetry();

      await expect(trackCommand('init', '0.1.0')).resolves.toBeUndefined();
      await expect(shutdown()).resolves.not.toThrow();
    });

    it('swallows a request that throws synchronously', async () => {
      requestSpy.mockImplementation(() => {
        throw new Error('boom');
      });
      const { trackCommand, shutdown } = await loadTelemetry();

      await expect(trackCommand('init', '0.1.0')).resolves.toBeUndefined();
      await expect(shutdown()).resolves.not.toThrow();
    });

    it('gives up on a stalled request within the timeout and never throws', async () => {
      installHttpsMock('never');
      const { trackCommand, shutdown } = await loadTelemetry();

      const start = Date.now();
      await trackCommand('init', '0.1.0');
      await expect(shutdown()).resolves.not.toThrow();
      // Bounded by the guard timer; allow generous slack for CI timing.
      expect(Date.now() - start).toBeLessThan(TELEMETRY_REQUEST_TIMEOUT_MS + 4000);
    });
  });

  describe('maybeShowTelemetryNotice', () => {
    it('does not show the notice when telemetry is disabled', async () => {
      process.env.RASEN_TELEMETRY = '0';
      const { maybeShowTelemetryNotice } = await loadTelemetry();

      await maybeShowTelemetryNotice();

      expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    it('shows a truthful notice once, then suppresses it', async () => {
      const { maybeShowTelemetryNotice } = await loadTelemetry();

      await maybeShowTelemetryNotice();
      await maybeShowTelemetryNotice();

      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      const message = String(consoleLogSpy.mock.calls[0][0]);
      expect(message).toContain('Cloudflare Worker');
      expect(message).toContain('RASEN_TELEMETRY=0');
      expect(message.toLowerCase()).not.toContain('posthog');
      expect(message).not.toContain('edge.openspec.dev');
    });

    it('does not itself send any telemetry (notice precedes any send)', async () => {
      const { maybeShowTelemetryNotice } = await loadTelemetry();

      await maybeShowTelemetryNotice();

      expect(requestSpy).not.toHaveBeenCalled();
    });
  });

  describe('shutdown', () => {
    it('resolves without throwing when nothing was sent', async () => {
      const { shutdown } = await loadTelemetry();
      await expect(shutdown()).resolves.not.toThrow();
    });

    it('resolves without throwing after an in-flight send failed', async () => {
      installHttpsMock('error');
      const { trackCommand, shutdown } = await loadTelemetry();

      await trackCommand('init', '0.1.0');
      await expect(shutdown()).resolves.not.toThrow();
    });
  });
});
