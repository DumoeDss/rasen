import { mkdtempSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { ensureCliBuilt, terminateActiveCliChildren } from './test/helpers/run-cli.js';
import { cleanupTempPath } from './test/helpers/temp-cleanup.js';

let machineRoot: string | undefined;
let xdgDataNet: string | undefined;

// Ensure the CLI bundle exists before tests execute, and install the
// machine-root safety net (harden-adoption-and-test-isolation D4): every
// in-process getGlobalDataDir()/getGlobalConfigDir() resolution should be
// isolated per-test via an explicit `globalDataDir`/`env` override, but a
// suite that forgets one must never fall through to the developer's real
// `~/.rasen`. RASEN_HOME outranks XDG and the literal default (see
// resolveRasenHome in src/core/global-config.ts), and globalSetup runs in
// the main process before the forks pool spawns workers — workers inherit
// process.env, so setting it here (no `provide()` plumbing needed) reaches
// every in-process call. Spawned CLIs are unaffected: `runCLI`
// (test/helpers/run-cli.ts) blanks RASEN_HOME and applies its own XDG
// isolation per invocation, so the two isolation schemes never collide.
// This is a NET, not the primary isolation — suites should still pass an
// explicit override per test.
export async function setup() {
  machineRoot = mkdtempSync(path.join(os.tmpdir(), 'rasen-test-home-'));
  process.env.RASEN_HOME = machineRoot;

  // Second net layer: many suites `delete process.env.RASEN_HOME` so their
  // per-suite XDG_CONFIG_HOME isolation takes effect, but forget the DATA
  // axis — getGlobalDataDir() (RASEN_HOME > XDG_DATA_HOME > ~/.rasen) then
  // falls through to the developer's real ~/.rasen, leaking e.g. project
  // registry writes (2000+ test entries were found in the real registry).
  // With XDG_DATA_HOME also pointed at a run-scoped temp dir, deleting
  // RASEN_HOME alone can never reach the real machine home. Suites that
  // exercise XDG_DATA_HOME behavior set/delete it themselves and win.
  xdgDataNet = mkdtempSync(path.join(os.tmpdir(), 'rasen-test-xdg-data-'));
  process.env.XDG_DATA_HOME = xdgDataNet;

  await ensureCliBuilt();
}

export async function teardown() {
  terminateActiveCliChildren();
  cleanupTempPath(machineRoot);
  cleanupTempPath(xdgDataNet);
}
