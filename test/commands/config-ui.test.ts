import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Command } from 'commander';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { version: OWN_VERSION } = require('../../package.json') as { version: string };

// Mocked so this suite never opens a real socket, spawns a real browser
// process, or leaves a live server/SIGINT handler dangling after the test.
// `config ui` is a deprecated alias over `ui-launch.ts`'s shared flow
// (design D1 of `rasen-ui-unify-management-surface`), which is now an
// adopt-or-spawn consumer of the resident daemon by default
// (`slice3-daemon-residency` design D3/D6 — this alias gets adopt-or-spawn
// "for free", no separate `--no-daemon` decision was made for it).
const stopServerMock = vi.fn().mockResolvedValue(undefined);
const startManagementServerMock = vi.fn();
vi.mock('../../src/core/management-api/server.js', () => ({
  startManagementServer: (...args: unknown[]) => startManagementServerMock(...args),
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

const probeDaemonMock = vi.fn();
vi.mock('../../src/core/management-api/daemon-probe.js', () => ({
  probeDaemon: (...args: unknown[]) => probeDaemonMock(...args),
  probeDaemonPort: vi.fn().mockResolvedValue({ kind: 'no-listener' }),
  resolveDefaultDaemonPort: () => 8791,
}));

const readDaemonStateMock = vi.fn();
vi.mock('../../src/core/management-api/daemon-state.js', () => ({
  readDaemonState: () => readDaemonStateMock(),
}));

const spawnDaemonDetachedMock = vi.fn();
vi.mock('../../src/commands/daemon.js', () => ({
  spawnDaemonDetached: (...args: unknown[]) => spawnDaemonDetachedMock(...args),
}));

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

    startManagementServerMock.mockReset();
    stopServerMock.mockClear();
    resolveUiPackageDirMock.mockReset().mockReturnValue(null);
    spawnMock.mockClear();
    probeDaemonMock.mockReset();
    readDaemonStateMock.mockReset();
    spawnDaemonDetachedMock.mockReset();

    startManagementServerMock.mockResolvedValue({
      port: 4321,
      server: {},
      stopServer: stopServerMock,
    });

    // Default: adopt a running same-version daemon, so most tests below
    // only need to inspect the printed URL/notice, not the daemon mechanics
    // (those have dedicated coverage — see ui.test.ts and the fixture-based
    // adopt-or-spawn tests, tasks 5.2-5.3).
    probeDaemonMock.mockResolvedValue({ port: 4321, result: { kind: 'rasen-daemon', version: OWN_VERSION, pid: 4242 } });
    readDaemonStateMock.mockReturnValue({ version: OWN_VERSION, pid: 4242, port: 4321, token: 'a'.repeat(64), startedAt: Date.now() });
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tempDir, { recursive: true, force: true });
    consoleErrorSpy.mockRestore();
    consoleLogSpy.mockRestore();
    vi.resetModules();
  });

  it('adopts the resident daemon, prints the /config URL with its token, and opens the browser by default', async () => {
    await runConfigCommand(['ui']);

    expect(startManagementServerMock).not.toHaveBeenCalled();
    expect(spawnDaemonDetachedMock).not.toHaveBeenCalled();
    const printed = consoleLogSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(printed).toMatch(new RegExp(`^Config UI: http://127\\.0\\.0\\.1:4321/config#token=a{64}$`, 'm'));
  });

  it('prints a one-line deprecation notice naming `rasen ui` (design D1)', async () => {
    await runConfigCommand(['ui']);
    const printed = consoleLogSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(printed).toContain('deprecated');
    expect(printed).toContain('rasen ui');
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

  it('spawns a daemon when nothing listens and prints its URL', async () => {
    probeDaemonMock.mockResolvedValue({ port: 8791, result: { kind: 'no-listener' } });
    spawnDaemonDetachedMock.mockResolvedValue({ ok: true, port: 8791, version: OWN_VERSION, pid: 5555 });
    readDaemonStateMock.mockReturnValue({ version: OWN_VERSION, pid: 5555, port: 8791, token: 'spawned-token', startedAt: Date.now() });

    await runConfigCommand(['ui']);

    expect(spawnDaemonDetachedMock).toHaveBeenCalledWith(8791);
    const printed = consoleLogSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(printed).toMatch(/^Config UI: http:\/\/127\.0\.0\.1:8791\/config#token=spawned-token$/m);
  });

  it('fails without touching a foreign listener', async () => {
    probeDaemonMock.mockResolvedValue({ port: 8791, result: { kind: 'foreign' } });

    await runConfigCommand(['ui']);

    expect(process.exitCode).toBe(1);
    expect(spawnDaemonDetachedMock).not.toHaveBeenCalled();
  });

  it('rejects a non-numeric --port without starting anything', async () => {
    await runConfigCommand(['ui', '--port', 'not-a-number']);
    expect(process.exitCode).toBe(1);
    expect(startManagementServerMock).not.toHaveBeenCalled();
    expect(probeDaemonMock).not.toHaveBeenCalled();
  });
});
