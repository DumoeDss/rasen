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

  // Third net layer: host-runtime detection (src/core/runtime-adapters.ts)
  // reads harness fingerprints straight off the environment. A developer
  // running the suite from inside a coding harness leaks that harness in —
  // `CLAUDECODE` made every host-sensitive assertion resolve `claude`
  // locally while CI (which sets none of these) resolved `unknown`, so the
  // two disagreed silently. Scrubbing EVERY input `detectHostRuntime` reads
  // — the override plus all four fingerprints, in its own precedence order —
  // makes the default host `unknown` everywhere, matching CI. A partial
  // scrub would just move the divergence to whichever harness the next
  // developer runs from. A suite that exercises a specific host sets the
  // fingerprint itself and wins, and spawned CLIs inherit the scrubbed
  // environment through `runCLI`.
  delete process.env.RASEN_AGENT_RUNTIME;
  delete process.env.CODEX_THREAD_ID;
  delete process.env.CODEX_SANDBOX;
  delete process.env.OMPCODE;
  delete process.env.CLAUDECODE;

  // Same divergence class, one layer deeper: `resolveOmpAgentDir`
  // (src/core/omp/omp-home.ts) resolves Oh My Pi's active agent directory —
  // and therefore where the session locator scans — from four ambient
  // variables. A developer running the suite under `omp --profile <name>`
  // carries `OMP_PROFILE`, so any assertion that reaches the locator without
  // injecting an explicit dir would search that profile's sessions while CI
  // searched the default one. Every input the resolution reads is scrubbed,
  // in its own precedence order, so the default is the same "no overrides"
  // state CI produces. A suite that exercises one specific override sets it
  // itself and wins.
  delete process.env.OMP_PROFILE;
  delete process.env.PI_PROFILE;
  delete process.env.PI_CONFIG_DIR;
  delete process.env.PI_CODING_AGENT_DIR;

  // Fourth net layer, same divergence class as the third: two more pieces of
  // developer machine state that CI does not have and that the suite reads
  // only indirectly, so a leak surfaces as an unrelated assertion failure
  // rather than as a configuration error.
  //
  // git — the suite builds throwaway fixture repositories in the OS temp
  // directory and commits to them. Those paths fall outside any `includeIf`
  // scope a developer set for this checkout, so fixture commits do NOT get
  // the identity the checkout itself commits with — they fall back to the
  // bare global config. On a machine that keeps a separate identity for this
  // fork, that means every fixture commit is attributed to the other one and
  // signed under its `commit.gpgsign`, which fails outright (26 local
  // failures across store bootstrap, worktree identity and learned-skill
  // suites). The signing failure is only the visible half; the identity
  // substitution is the half that matters for a public fork, because
  // anything a fixture records can reach a golden file. `core.excludesfile`
  // and `core.autocrlf` quietly alter fixture contents on top of that.
  // `GIT_CONFIG_GLOBAL` points at a path inside the run-scoped machine root
  // that is never created — git reads a missing config file as empty —
  // `GIT_CONFIG_NOSYSTEM` covers the system file, and identity moves to the
  // `GIT_*` variables, which outrank config and stay deterministic once
  // `user.name`/`user.email` are gone.
  process.env.GIT_CONFIG_GLOBAL = path.join(machineRoot, 'absent-gitconfig');
  process.env.GIT_CONFIG_NOSYSTEM = '1';
  process.env.GIT_AUTHOR_NAME = 'Rasen Test';
  process.env.GIT_AUTHOR_EMAIL = 'test@rasen.invalid';
  process.env.GIT_COMMITTER_NAME = 'Rasen Test';
  process.env.GIT_COMMITTER_EMAIL = 'test@rasen.invalid';

  // locale — `resolveCliLocale` (src/utils/locale.ts) falls through
  // `RASEN_LANG` > configured language > `LC_ALL`/`LC_MESSAGES`/`LANG` >
  // macOS `AppleLocale` > Node's ICU locale. Every locale-driving test sets
  // `RASEN_LANG` or a config value, both of which outrank this pin; what
  // this fixes is the DEFAULT for suites that assert English output, which
  // a `ja_JP.UTF-8` shell silently localized (3 local failures in
  // `bootstrap.test.ts`). Pinned rather than deleted: deleting these would
  // only hand the decision to `AppleLocale`, which is machine state too.
  delete process.env.RASEN_LANG;
  process.env.LC_ALL = 'en_US.UTF-8';
  process.env.LC_MESSAGES = 'en_US.UTF-8';
  process.env.LANG = 'en_US.UTF-8';

  await ensureCliBuilt();
}

export async function teardown() {
  terminateActiveCliChildren();
  cleanupTempPath(machineRoot);
  cleanupTempPath(xdgDataNet);
}
