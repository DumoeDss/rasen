import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Command } from 'commander';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { version: OWN_VERSION } = require('../../package.json') as { version: string };

// Mocked so this suite never opens a real socket, spawns a real browser
// process, or leaves a live server/SIGINT handler dangling after the test —
// mirrors test/commands/config-ui.test.ts, whose logic `src/commands/ui.ts`
// deliberately duplicates (review round 1 M3).
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

// The adopt-or-spawn seam this suite exercises at the `runUiLaunch` level
// only — the daemon-probe/daemon-state/spawn mechanics themselves have
// dedicated coverage (daemon.test.ts, ui-launch-adopt-or-spawn.test.ts with
// real fixture loopback servers, per tasks 5.2-5.3).
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

async function runUiCommand(args: string[]): Promise<Command> {
  const { registerUiCommand } = await import('../../src/commands/ui.js');
  const program = new Command();
  registerUiCommand(program);
  await program.parseAsync(['node', 'rasen', 'ui', ...args]);
  return program;
}

describe('ui command', () => {
  let tempDir: string;
  let originalEnv: NodeJS.ProcessEnv;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-ui-cmd-'));
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
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tempDir, { recursive: true, force: true });
    consoleErrorSpy.mockRestore();
    consoleLogSpy.mockRestore();
    vi.resetModules();
  });

  it('is listed in --help as the management platform entry point (management-ui-command spec)', async () => {
    const { registerUiCommand } = await import('../../src/commands/ui.js');
    const program = new Command();
    registerUiCommand(program);
    const uiCommand = program.commands.find((c) => c.name() === 'ui');
    expect(uiCommand).toBeDefined();
    // Commander's own hidden flag, the mechanism `--help` respects — must
    // be unset now that `rasen ui` is public.
    expect((uiCommand as unknown as { _hidden?: boolean })._hidden).toBeFalsy();
    expect(program.helpInformation()).toContain(' ui ');
    expect(uiCommand!.description()).toMatch(/management platform/i);
  });

  describe('default (adopt-or-spawn) form', () => {
    it('adopts a running same-version daemon without spawning', async () => {
      probeDaemonMock.mockResolvedValue({ port: 8791, result: { kind: 'rasen-daemon', version: OWN_VERSION, pid: 4242 } });
      readDaemonStateMock.mockReturnValue({ version: OWN_VERSION, pid: 4242, port: 8791, token: 'adopted-token', startedAt: Date.now() });

      await runUiCommand([]);

      expect(spawnDaemonDetachedMock).not.toHaveBeenCalled();
      expect(startManagementServerMock).not.toHaveBeenCalled();
      const printed = consoleLogSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(printed).toMatch(/^Rasen UI: http:\/\/127\.0\.0\.1:8791\/#token=adopted-token$/m);
    });

    it('spawns a daemon when nothing listens and prints its URL', async () => {
      probeDaemonMock.mockResolvedValue({ port: 8791, result: { kind: 'no-listener' } });
      spawnDaemonDetachedMock.mockResolvedValue({ ok: true, port: 8791, version: OWN_VERSION, pid: 5555 });
      readDaemonStateMock.mockReturnValue({ version: OWN_VERSION, pid: 5555, port: 8791, token: 'spawned-token', startedAt: Date.now() });

      await runUiCommand([]);

      expect(spawnDaemonDetachedMock).toHaveBeenCalledWith(8791);
      const printed = consoleLogSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(printed).toMatch(/^Rasen UI: http:\/\/127\.0\.0\.1:8791\/#token=spawned-token$/m);
    });

    it('fails without touching a foreign listener', async () => {
      probeDaemonMock.mockResolvedValue({ port: 8791, result: { kind: 'foreign' } });

      await runUiCommand([]);

      expect(process.exitCode).toBe(1);
      expect(spawnDaemonDetachedMock).not.toHaveBeenCalled();
      const printed = consoleErrorSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(printed).toContain('8791');
      expect(printed).toContain('--no-daemon');
    });

    it('fails with remediation, no kill, when the adopted daemon token is unreadable', async () => {
      probeDaemonMock.mockResolvedValue({ port: 8791, result: { kind: 'rasen-daemon', version: OWN_VERSION, pid: 4242 } });
      readDaemonStateMock.mockReturnValue(null);

      await runUiCommand([]);

      expect(process.exitCode).toBe(1);
      const printed = consoleErrorSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(printed).toContain('rasen daemon stop');
    });
  });

  describe('--no-daemon (self-hosted foreground form)', () => {
    it('starts the management server, prints the root URL with the token fragment, and opens the browser by default', async () => {
      await runUiCommand(['--no-daemon']);

      expect(startManagementServerMock).toHaveBeenCalledTimes(1);
      const printed = consoleLogSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(printed).toMatch(/^Rasen UI: http:\/\/127\.0\.0\.1:4321\/#token=[0-9a-f]{64}$/m);
      expect(spawnMock).toHaveBeenCalledTimes(1);
    });

    it('prints the install hint when the UI package is not resolved', async () => {
      await runUiCommand(['--no-daemon']);
      const printed = consoleLogSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(printed).toContain('UI package not installed. Run: npm install -g @atelierai/rasen-ui');
    });

    it('--no-open suppresses the browser', async () => {
      await runUiCommand(['--no-daemon', '--no-open']);
      expect(spawnMock).not.toHaveBeenCalled();
    });

    it('passes --port through to the server start call', async () => {
      await runUiCommand(['--no-daemon', '--port', '5555']);
      expect(startManagementServerMock).toHaveBeenCalledWith(expect.objectContaining({ port: 5555 }));
    });

    it('reports a clear error on port collision (EADDRINUSE) and exits non-zero', async () => {
      const err = Object.assign(new Error('listen EADDRINUSE'), { code: 'EADDRINUSE' });
      startManagementServerMock.mockRejectedValueOnce(err);

      await runUiCommand(['--no-daemon', '--port', '5555']);

      expect(process.exitCode).toBe(1);
      const printed = consoleErrorSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(printed).toContain('5555');
      expect(printed).toContain('already in use');
    });
  });

  it('rejects a non-numeric --port without starting anything', async () => {
    await runUiCommand(['--port', 'not-a-number']);
    expect(process.exitCode).toBe(1);
    expect(startManagementServerMock).not.toHaveBeenCalled();
    expect(probeDaemonMock).not.toHaveBeenCalled();
  });

  it('rejects an out-of-range --port without starting anything', async () => {
    await runUiCommand(['--port', '99999']);
    expect(process.exitCode).toBe(1);
    expect(startManagementServerMock).not.toHaveBeenCalled();
    expect(probeDaemonMock).not.toHaveBeenCalled();
  });
});
