import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Daemon-lifetime teardown through the SHIPPED transport.
 *
 * The native crate's own oracle already proves the kernel property. What this file proves is the
 * delivery: that a scope created by a real Node daemon through `native-assembly` actually carries
 * the endpoint, so the daemon's death is the scope's death - and, just as importantly, that a
 * living daemon's scope is never killed early.
 *
 * Gate: `process.platform === 'linux' && RASEN_ACTUAL_WSL_ORACLE === '1'`. Run from Windows this
 * file skips entirely and proves nothing.
 */
const ACTUAL_WSL = process.platform === 'linux' &&
  process.env.RASEN_ACTUAL_WSL_ORACLE === '1';
const describeActualWsl = ACTUAL_WSL ? describe : describe.skip;
const SOURCE_ROOT = path.resolve('.');

/** How long the workload and its descendants wait before recording that they outlived teardown. */
const ESCAPE_SECONDS = 6;
const SETTLE_MS = (ESCAPE_SECONDS + 4) * 1_000;
const LIVE_MARKERS = ['live-root', 'live-setsid', 'live-doublefork'] as const;
const ESCAPE_MARKERS = ['escaped-root', 'escaped-setsid', 'escaped-doublefork'] as const;

function requiredPackageRoot(): string {
  const value = process.env.RASEN_LINUX_PROCESS_AUTHORITY_PACKAGE_ROOT;
  if (!value || !path.isAbsolute(value)) {
    throw new Error('RASEN_LINUX_PROCESS_AUTHORITY_PACKAGE_ROOT is required.');
  }
  return fs.realpathSync(value);
}

function createRoot(label: string): string {
  const root = fs.mkdtempSync(path.join(os.homedir(), `.rasen-${label}-`));
  fs.chmodSync(root, 0o700);
  for (const child of ['runtime', 'cwd', 'markers']) {
    fs.mkdirSync(path.join(root, child), { mode: 0o700 });
    fs.chmodSync(path.join(root, child), 0o700);
  }
  return root;
}

function startDaemon(root: string): { readonly child: ChildProcess; readonly stderr: () => string } {
  const loader = pathToFileURL(path.join(SOURCE_ROOT, 'test/fixtures/typescript-source-loader.mjs'))
    .href;
  const fixture = path.join(
    SOURCE_ROOT,
    'test/fixtures/linux-process-authority-daemon-lifetime-daemon.mjs'
  );
  let stderr = '';
  const child = spawn(process.execPath, ['--no-warnings', '--experimental-loader', loader, fixture], {
    env: {
      ...process.env,
      RPA_DL_SOURCE_ROOT: SOURCE_ROOT,
      RPA_DL_PACKAGE_ROOT: requiredPackageRoot(),
      RPA_DL_TEST_ROOT: root,
      RPA_DL_MARKERS: path.join(root, 'markers'),
      RPA_DL_READY: path.join(root, 'ready'),
      RPA_DL_ESCAPE_SECONDS: String(ESCAPE_SECONDS),
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  child.stderr?.on('data', (chunk: Buffer | string) => { stderr += chunk.toString(); });
  return Object.freeze({ child, stderr: () => stderr });
}

async function waitFor(file: string, what: string, stderr: () => string): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (!fs.existsSync(file)) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${what}. ${stderr()}`);
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  }
}

function present(markers: string, names: readonly string[]): string[] {
  return names.filter((name) => fs.existsSync(path.join(markers, name)));
}

async function killAndReap(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  child.kill('SIGKILL');
  await exited;
}

describeActualWsl('Linux daemon-lifetime teardown through the shipped transport', () => {
  it('kills a live scope when the owning daemon dies', async () => {
    const root = createRoot('dl-death');
    const markers = path.join(root, 'markers');
    const daemon = startDaemon(root);
    try {
      await waitFor(path.join(root, 'ready'), 'the daemon to activate its scope', daemon.stderr);
      for (const name of LIVE_MARKERS) {
        await waitFor(path.join(markers, name), name, daemon.stderr);
      }
      // Positive control: nothing below means anything unless the whole workload was live and
      // had not yet had time to record an escape.
      expect(present(markers, ESCAPE_MARKERS)).toEqual([]);

      await killAndReap(daemon.child);
      await new Promise<void>((resolve) => setTimeout(resolve, SETTLE_MS));

      expect(present(markers, ESCAPE_MARKERS)).toEqual([]);
      expect(fs.existsSync(path.join(markers, 'root-completed'))).toBe(false);
    } finally {
      await killAndReap(daemon.child);
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 120_000);

  it('leaves a live scope alone while the owning daemon is alive', async () => {
    const root = createRoot('dl-alive');
    const markers = path.join(root, 'markers');
    const daemon = startDaemon(root);
    try {
      await waitFor(path.join(root, 'ready'), 'the daemon to activate its scope', daemon.stderr);
      for (const name of LIVE_MARKERS) {
        await waitFor(path.join(markers, name), name, daemon.stderr);
      }
      // The daemon is never touched. The workload must be allowed to run to completion, which is
      // what a wiring that releases its endpoint too early would break.
      await waitFor(path.join(markers, 'root-completed'), 'the workload to finish', daemon.stderr);
      expect(present(markers, ESCAPE_MARKERS).sort()).toEqual([...ESCAPE_MARKERS].sort());
      expect(daemon.child.exitCode).toBeNull();
    } finally {
      await killAndReap(daemon.child);
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 120_000);
});
