import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Command } from 'commander';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

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

  it('starts the management server, prints the root URL with the token fragment, and opens the browser by default', async () => {
    await runUiCommand([]);

    expect(startManagementServerMock).toHaveBeenCalledTimes(1);
    const printed = consoleLogSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(printed).toMatch(/^Rasen UI: http:\/\/127\.0\.0\.1:4321\/#token=[0-9a-f]{64}$/m);
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  it('prints the install hint when the UI package is not resolved', async () => {
    await runUiCommand([]);
    const printed = consoleLogSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(printed).toContain('UI package not installed. Run: npm install -g @atelierai/rasen-ui');
  });

  it('--no-open suppresses the browser', async () => {
    await runUiCommand(['--no-open']);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('passes --port through to the server start call', async () => {
    await runUiCommand(['--port', '5555']);
    expect(startManagementServerMock).toHaveBeenCalledWith(expect.objectContaining({ port: 5555 }));
  });

  it('rejects a non-numeric --port without starting the server', async () => {
    await runUiCommand(['--port', 'not-a-number']);
    expect(process.exitCode).toBe(1);
    expect(startManagementServerMock).not.toHaveBeenCalled();
  });

  it('rejects an out-of-range --port without starting the server', async () => {
    await runUiCommand(['--port', '99999']);
    expect(process.exitCode).toBe(1);
    expect(startManagementServerMock).not.toHaveBeenCalled();
  });

  it('reports a clear error on port collision (EADDRINUSE) and exits non-zero', async () => {
    const err = Object.assign(new Error('listen EADDRINUSE'), { code: 'EADDRINUSE' });
    startManagementServerMock.mockRejectedValueOnce(err);

    await runUiCommand(['--port', '5555']);

    expect(process.exitCode).toBe(1);
    const printed = consoleErrorSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(printed).toContain('5555');
    expect(printed).toContain('already in use');
  });
});
