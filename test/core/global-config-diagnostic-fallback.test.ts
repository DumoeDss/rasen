/**
 * D4 (locale-diagnostic-reporter design.md): when locale/catalog resolution
 * fails, `getGlobalConfig()`'s default-reporter helper (`safeDefaultReporter`)
 * must swallow the error and fall back to `reportConfigDiagnostic`'s
 * pre-existing English-fallback path — never drop the diagnostic, never
 * throw out of `getGlobalConfig()` itself. Simulated by mocking
 * `config-diagnostic-locale.js` (the module `safeDefaultReporter` calls into)
 * to throw on construction, isolated to this file only.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

vi.mock('../../src/core/config-diagnostic-locale.js', () => ({
  createConfigDiagnosticReporter: () => {
    throw new Error('simulated locale/catalog resolution failure');
  },
  formatConfigDiagnostic: () => {
    throw new Error('simulated locale/catalog resolution failure');
  },
}));

describe('getGlobalConfig default-reporter fallback on locale/catalog failure', () => {
  let tempDir: string;
  let originalEnv: NodeJS.ProcessEnv;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tempDir = path.join(os.tmpdir(), `rasen-global-config-fallback-test-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });
    originalEnv = { ...process.env };
    delete process.env.RASEN_HOME;
    process.env.XDG_CONFIG_HOME = tempDir;
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tempDir, { recursive: true, force: true });
    consoleErrorSpy.mockRestore();
  });

  it('deliveryRetired still prints, using the English fallback text, and getGlobalConfig() does not throw', async () => {
    const { getGlobalConfig } = await import('../../src/core/global-config.js');
    const configDir = path.join(tempDir, 'rasen');
    const configPath = path.join(configDir, 'config.json');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(
      configPath,
      JSON.stringify({ featureFlags: {}, profile: 'full', language: 'ja', delivery: 'both' })
    );

    let config: ReturnType<typeof getGlobalConfig> | undefined;
    expect(() => {
      config = getGlobalConfig();
    }).not.toThrow();

    expect(config).toBeDefined();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("the 'delivery' setting has been retired")
    );
  });

  it('invalidGlobalJson still prints, using the English fallback text, and getGlobalConfig() does not throw', async () => {
    const { getGlobalConfig } = await import('../../src/core/global-config.js');
    const configDir = path.join(tempDir, 'rasen');
    const configPath = path.join(configDir, 'config.json');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(configPath, '{ invalid json }');

    let config: ReturnType<typeof getGlobalConfig> | undefined;
    expect(() => {
      config = getGlobalConfig();
    }).not.toThrow();

    expect(config).toBeDefined();
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid JSON'));
  });
});
