import { mkdtempSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  ensureCliBuildFresh,
  terminateActiveCliChildren,
} from './test/helpers/run-cli.js';
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

  // Third net layer: host-runtime detection (src/core/runtime-adapters.ts)
  // reads harness fingerprints straight off the environment. Scrubbing EVERY
  // input detectHostRuntime reads makes the default host `unknown` everywhere,
  // matching CI.
  delete process.env.RASEN_AGENT_RUNTIME;
  delete process.env.CODEX_THREAD_ID;
  delete process.env.CODEX_SANDBOX;
  delete process.env.OMPCODE;
  delete process.env.CLAUDECODE;

  // OMP agent dir resolution: scrub every ambient variable it reads.
  delete process.env.OMP_PROFILE;
  delete process.env.PI_PROFILE;
  delete process.env.PI_CONFIG_DIR;
  delete process.env.PI_CODING_AGENT_DIR;

  // Git: fixture repos in temp fall outside any includeIf scope, so they
  // inherit the global config. Pin identity and config to deterministic values.
  process.env.GIT_CONFIG_GLOBAL = path.join(machineRoot, 'absent-gitconfig');
  process.env.GIT_CONFIG_NOSYSTEM = '1';
  process.env.GIT_AUTHOR_NAME = 'Rasen Test';
  process.env.GIT_AUTHOR_EMAIL = 'test@rasen.invalid';
  process.env.GIT_COMMITTER_NAME = 'Rasen Test';
  process.env.GIT_COMMITTER_EMAIL = 'test@rasen.invalid';

  // Locale: pin to en_US so suites asserting English output match CI.
  delete process.env.RASEN_LANG;
  process.env.LC_ALL = 'en_US.UTF-8';
  process.env.LC_MESSAGES = 'en_US.UTF-8';
  process.env.LANG = 'en_US.UTF-8';

  // Verify the shared bundle matches the current sources, compiling only when
  // it does not. Never an unconditional clean+rebuild: two Vitest processes in
  // one checkout would otherwise remove or half-overwrite the `dist/` the other
  // is executing. `ensureCliBuildFresh` ignores any ambient readiness marker,
  // so a stale pre-existing `dist/` is still never trusted.
  await ensureCliBuildFresh();
}

export async function teardown() {
  terminateActiveCliChildren();
  cleanupTempPath(machineRoot);
  cleanupTempPath(xdgDataNet);
}
