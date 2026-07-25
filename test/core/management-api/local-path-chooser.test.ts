import { EventEmitter } from 'node:events';
import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { PassThrough } from 'node:stream';
import type { spawn } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildNativeChooserCommand,
  createLocalPathChooser,
  WINDOWS_CHOOSER_OUTPUT_ENCODING_SCRIPT,
} from '../../../src/core/management-api/local-path-chooser.js';
import { cleanupTempPathAsync } from '../../helpers/temp-cleanup.js';

function spawnResult(
  stdout: string,
  code: number,
  closeDelay = 0,
  stderr = ''
): typeof spawn {
  return vi.fn(() => {
    const child = new EventEmitter() as EventEmitter & {
      stdin: PassThrough;
      stdout: PassThrough;
      stderr: PassThrough;
      kill: ReturnType<typeof vi.fn>;
    };
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    const completion = setTimeout(() => {
      if (stdout) child.stdout.write(stdout);
      if (stderr) child.stderr.write(stderr);
      child.stdout.end();
      child.stderr.end();
      child.emit('close', code);
    }, closeDelay);
    child.kill = vi.fn(() => {
      clearTimeout(completion);
      setTimeout(() => child.emit('close', null), 0);
      return true;
    });
    return child;
  }) as unknown as typeof spawn;
}

describe('native local path chooser', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.realpathSync.native(
      fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'rasen-chooser-'))
    );
  });

  afterEach(() => cleanupTempPathAsync(dir));

  it('uses a fixed explicit platform table and Linux Zenity-before-KDialog order', () => {
    const exists = (candidate: string) =>
      candidate.endsWith(path.join('bin', 'zenity')) ||
      candidate.endsWith(path.win32.join('WindowsPowerShell', 'v1.0', 'powershell.exe')) ||
      candidate === '/usr/bin/osascript';
    const linux = buildNativeChooserCommand(
      { kind: 'file', filter: 'rasen-package' },
      'linux',
      { PATH: path.join(path.parse(process.cwd()).root, 'bin'), DISPLAY: ':0' },
      exists
    );
    expect(typeof linux).not.toBe('string');
    if (typeof linux !== 'string') {
      expect(linux.executable.endsWith('zenity')).toBe(true);
      expect(linux.args).toContain('--file-selection');
    }
    const mac = buildNativeChooserCommand(
      { kind: 'directory' },
      'darwin',
      {},
      exists
    );
    expect(typeof mac !== 'string' && mac.executable).toBe('/usr/bin/osascript');
    const windows = buildNativeChooserCommand(
      { kind: 'directory' },
      'win32',
      { SystemRoot: 'C:\\Windows' },
      exists
    );
    expect(typeof windows !== 'string' && windows.args).toContain('-STA');
  });

  it('returns unavailable without spawning in a headless Linux session', async () => {
    const spawnOverride = vi.fn() as unknown as typeof spawn;
    const chooser = createLocalPathChooser({
      platform: 'linux',
      env: { PATH: '' },
      spawnOverride,
    });
    expect(await chooser.choose({ kind: 'directory' })).toEqual({
      ok: true,
      response: { status: 'unavailable', reason: 'headless' },
    });
    expect(spawnOverride).not.toHaveBeenCalled();
  });

  it('canonicalizes a selected path and preserves cancellation', async () => {
    const selected = createLocalPathChooser({
      platform: 'darwin',
      spawnOverride: spawnResult(`${dir}\n`, 0),
      executableExistsOverride: () => true,
    });
    expect(await selected.choose({ kind: 'directory' })).toEqual({
      ok: true,
      response: {
        status: 'selected',
        path: dir,
        kind: 'directory',
        separator: path.sep,
      },
    });

    const cancelled = createLocalPathChooser({
      platform: 'darwin',
      spawnOverride: spawnResult('', 1, 0, 'execution error: User canceled. (-128)'),
      executableExistsOverride: () => true,
    });
    expect(await cancelled.choose({ kind: 'directory' })).toEqual({
      ok: true,
      response: { status: 'cancelled' },
    });
  });

  it('distinguishes adapter cancellation evidence from code-1 runtime failures', async () => {
    const macCancelled = createLocalPathChooser({
      platform: 'darwin',
      spawnOverride: spawnResult('', 1, 0, 'execution error: User canceled. (-128)'),
      executableExistsOverride: () => true,
    });
    expect(await macCancelled.choose({ kind: 'directory' })).toEqual({
      ok: true,
      response: { status: 'cancelled' },
    });

    const macFailed = createLocalPathChooser({
      platform: 'darwin',
      spawnOverride: spawnResult('', 1, 0, 'execution error: Application is not running. (-600)'),
      executableExistsOverride: () => true,
    });
    expect(await macFailed.choose({ kind: 'directory' })).toEqual({
      ok: true,
      response: { status: 'unavailable', reason: 'launch-failed' },
    });

    const linuxCancelled = createLocalPathChooser({
      platform: 'linux',
      env: { PATH: path.join(path.parse(process.cwd()).root, 'bin'), DISPLAY: ':0' },
      spawnOverride: spawnResult('', 1),
      executableExistsOverride: (candidate) => candidate.endsWith('zenity'),
    });
    expect(await linuxCancelled.choose({ kind: 'directory' })).toEqual({
      ok: true,
      response: { status: 'cancelled' },
    });

    const linuxFailed = createLocalPathChooser({
      platform: 'linux',
      env: { PATH: path.join(path.parse(process.cwd()).root, 'bin'), DISPLAY: ':0' },
      spawnOverride: spawnResult('', 1, 0, 'Gtk-WARNING **: cannot open display'),
      executableExistsOverride: (candidate) => candidate.endsWith('zenity'),
    });
    expect(await linuxFailed.choose({ kind: 'directory' })).toEqual({
      ok: true,
      response: { status: 'unavailable', reason: 'launch-failed' },
    });

    const windowsCancelled = createLocalPathChooser({
      platform: 'win32',
      env: { SystemRoot: 'C:\\Windows' },
      spawnOverride: spawnResult('__RASEN_CANCELLED__', 0),
      executableExistsOverride: () => true,
    });
    expect(await windowsCancelled.choose({ kind: 'directory' })).toEqual({
      ok: true,
      response: { status: 'cancelled' },
    });

    const windowsFailed = createLocalPathChooser({
      platform: 'win32',
      env: { SystemRoot: 'C:\\Windows' },
      spawnOverride: spawnResult('', 1, 0, 'Add-Type failed'),
      executableExistsOverride: () => true,
    });
    expect(await windowsFailed.choose({ kind: 'directory' })).toEqual({
      ok: true,
      response: { status: 'unavailable', reason: 'launch-failed' },
    });
  });

  it.runIf(process.platform === 'win32')(
    'decodes synthesized non-ASCII output from real Windows PowerShell as UTF-8',
    async () => {
      const command = buildNativeChooserCommand(
        { kind: 'directory' },
        'win32',
        process.env,
        fs.existsSync
      );
      expect(typeof command).not.toBe('string');
      if (typeof command === 'string') return;
      expect(command.args.at(-1)).toContain(WINDOWS_CHOOSER_OUTPUT_ENCODING_SCRIPT);
      const probeScript = [
        WINDOWS_CHOOSER_OUTPUT_ENCODING_SCRIPT,
        '[Console]::Out.Write(([string][char]0x8DEF + [string][char]0x5F84))',
      ].join('; ');
      const stdout = await new Promise<string>((resolve, reject) => {
        execFile(
          command.executable,
          [...command.args.slice(0, -1), probeScript],
          { encoding: 'utf8' },
          (error, output) => {
            if (error) reject(error);
            else resolve(output);
          }
        );
      });
      expect(stdout).toBe('路径');
    }
  );

  it('caps chooser concurrency and terminates an expired child', async () => {
    const spawnOverride = spawnResult('', 0, 5_000);
    const chooser = createLocalPathChooser({
      platform: 'darwin',
      spawnOverride,
      executableExistsOverride: () => true,
      timeoutMs: 20,
    });
    const first = chooser.choose({ kind: 'directory', initialDirectory: dir });
    const busy = await chooser.choose({ kind: 'directory', initialDirectory: dir });
    expect(busy.ok).toBe(false);
    if (!busy.ok) expect(busy.status).toBe(409);
    expect(await first).toEqual({
      ok: true,
      response: { status: 'unavailable', reason: 'timeout' },
    });
    expect(spawnOverride).toHaveBeenCalledTimes(1);
    await chooser.shutdown();
  });

  it('rejects open-ended modes, filters, and initial paths before spawn', async () => {
    const spawnOverride = vi.fn() as unknown as typeof spawn;
    const chooser = createLocalPathChooser({
      platform: 'darwin',
      spawnOverride,
      executableExistsOverride: () => true,
    });
    for (const body of [
      { kind: 'anything' },
      { kind: 'file', filter: 'custom-script' },
      { kind: 'directory', initialDirectory: 'relative' },
      { kind: 'directory', script: 'evil' },
    ]) {
      const result = await chooser.choose(body);
      expect(result.ok).toBe(false);
    }
    expect(spawnOverride).not.toHaveBeenCalled();
  });
});
