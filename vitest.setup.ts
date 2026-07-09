import { mkdtempSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { ensureCliBuilt, terminateActiveCliChildren } from './test/helpers/run-cli.js';
import { cleanupTempPath } from './test/helpers/temp-cleanup.js';

let machineRoot: string | undefined;

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

  await ensureCliBuilt();
}

export async function teardown() {
  terminateActiveCliChildren();
  cleanupTempPath(machineRoot);
}
