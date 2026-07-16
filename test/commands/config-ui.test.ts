import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Command } from 'commander';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// Mocked so this suite never opens a real socket, spawns a real browser
// process, or leaves a live server/SIGINT handler dangling after the test.
const stopServerMock = vi.fn().mockResolvedValue(undefined);
const startConfigApiServerMock = vi.fn();
vi.mock('../../src/core/config-api/server.js', () => ({
  startConfigApiServer: (...args: unknown[]) => startConfigApiServerMock(...args),
}));

const resolveUiPackageDirMock = vi.fn(() => null);
vi.mock('../../src/core/config-api/ui-package.js', () => ({
  UI_PACKAGE_NAME: '@atelierai/rasen-ui',
  resolveUiPackageDir: () => resolveUiPackageDirMock(),
}));

const spawnMock = vi.fn(() => ({
  on: vi.fn(),
  unref: vi.fn(),
}));
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, spawn: (...args: unknown[]) => spawnMock(...args) };
});

async function runConfigCommand(args: string[]): Promise<void> {
  const { registerConfigCommand } = await import('../../src/commands/config.js');
  const program = new Command();
  registerConfigCommand(program);
  await program.parseAsync(['node', 'rasen', 'config', ...args]);
}

describe('config ui command', () => {
  let tempDir: string;
  let originalEnv: NodeJS.ProcessEnv;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-config-ui-cmd-'));
    originalEnv = { ...process.env };
    delete process.env.RASEN_HOME;
    process.env.XDG_CONFIG_HOME = tempDir;
    process.env.XDG_DATA_HOME = tempDir;

    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    process.exitCode = undefined;

    startConfigApiServerMock.mockReset();
    stopServerMock.mockClear();
    resolveUiPackageDirMock.mockReset().mockReturnValue(null);
    spawnMock.mockClear();

    startConfigApiServerMock.mockResolvedValue({
      port: 4321,
      server: {},
      stopServer: stopServerMock,
    });
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tempDir, { recursive: true, force: true });
    consoleErrorSpy.mockRestore();
    consoleLogSpy.mockRestore();
    vi.resetModules();
  });

  it('starts the server, prints the URL with the token fragment, and opens the browser by default', async () => {
    await runConfigCommand(['ui']);

    expect(startConfigApiServerMock).toHaveBeenCalledTimes(1);
    const printed = consoleLogSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(printed).toMatch(/^Config UI: http:\/\/127\.0\.0\.1:4321\/#token=[0-9a-f]{64}$/m);
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  it('prints the install hint when the UI package is not resolved', async () => {
    await runConfigCommand(['ui']);
    const printed = consoleLogSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(printed).toContain('UI package not installed. Run: npm install -g @atelierai/rasen-ui');
  });

  it('--no-open suppresses the browser', async () => {
    await runConfigCommand(['ui', '--no-open']);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('passes --port through to the server start call', async () => {
    await runConfigCommand(['ui', '--port', '5555']);
    expect(startConfigApiServerMock).toHaveBeenCalledWith(expect.objectContaining({ port: 5555 }));
  });

  it('rejects a non-numeric --port without starting the server', async () => {
    await runConfigCommand(['ui', '--port', 'not-a-number']);
    expect(process.exitCode).toBe(1);
    expect(startConfigApiServerMock).not.toHaveBeenCalled();
  });

  it('reports a clear error on port collision (EADDRINUSE) and exits non-zero', async () => {
    const err = Object.assign(new Error('listen EADDRINUSE'), { code: 'EADDRINUSE' });
    startConfigApiServerMock.mockRejectedValueOnce(err);

    await runConfigCommand(['ui', '--port', '5555']);

    expect(process.exitCode).toBe(1);
    const printed = consoleErrorSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(printed).toContain('5555');
    expect(printed).toContain('already in use');
  });
});
