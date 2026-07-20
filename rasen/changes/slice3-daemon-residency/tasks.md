## 1. Supervisor hardening carry-forwards (N1/N2, first — smallest surface)

- [x] 1.1 N2: in `supervisor.ts` `launch()`, re-check `draining` immediately after `await resolveAgentCli()`; when set, release the reserved concurrency slot and return the unavailable (503-shaped) result — test with a resolver that blocks until `shutdownAll` has been invoked, asserting no child is spawned and the slot count returns to zero
- [x] 1.2 N1: fix the sync-spawn-catch tail-prune leak — the catch path must delete the current record's tail entry symmetrically with the close path; test that a synchronous spawn failure leaves no entry in the tails map

## 2. Daemon runtime core

- [x] 2.1 Implement `src/core/management-api/daemon-state.ts`: runtime state file under the per-user rasen home (`daemon/daemon.json`) — write `{ version, pid, port, token, startedAt }` with `0600` (best-effort on win32), read-with-validation, delete; path resolution shared with the machine-home module; state is runtime metadata only
- [x] 2.2 Implement `src/core/management-api/daemon-probe.ts`: probe `GET /api/v1/status` on a candidate port with ~700ms timeout and NO proxy involvement, classify by response headers into `no-listener | foreign | rasen-daemon { version, pid }` (headers only — no token needed); probe order = state-file port hint first, then default port 8791 (`RASEN_DAEMON_PORT` override)
- [x] 2.3 Implement `daemon run` (foreground daemon) in `src/commands/daemon.ts`: assemble the existing management server (same composition `ui-launch.ts` uses) on the fixed port, mint the daemon-lifetime token, construct the same session-registry + supervisor modules, write the state file once listening, SIGINT/SIGTERM → `shutdownAll('server-shutdown')` → delete state file → exit; EADDRINUSE exits non-zero with a clear message
- [x] 2.4 Implement `daemon start`: detached self-spawn (`process.execPath` + own `dist/cli/index.js` + `daemon run` argv, `detached: true`, stdio → truncated log file `daemon/daemon.log`, `unref()`), bounded readiness poll (20 × 250ms) verifying rasen identity headers; on timeout tree-kill the half-started child, exit non-zero printing the log path; on discovering an already-running daemon mid-wait, converge to adoption semantics (report running, exit 0)
- [x] 2.5 Implement `daemon stop` and `daemon status`: both probe+classify; `status` reports classification (version/pid/port, foreign, absent) without acting; `stop` tree-kills only a positively-identified rasen daemon (any version) via reported pid, waits for the port to free, removes the state file; foreign → refuse with the never-touch explanation

## 3. Adopt-or-spawn consumer (`rasen ui`)

- [x] 3.1 Rewrite `runUiLaunch` in `src/commands/ui-launch.ts` around the state machine: probe → adopt same-version (token from state file; unreadable token → fail with `rasen daemon stop` remediation, no kill) / replace stale (tree-kill by reported pid, wait port free, spawn) / foreign → fail non-zero naming port, override, and `--no-daemon` fallback / no-listener → spawn + readiness wait; success prints the daemon URL `http://127.0.0.1:<port>/#token=<token>` and opens the browser unless `--no-open`
- [x] 3.2 Add `--no-daemon`: preserve the pre-residency self-hosted foreground path verbatim (ephemeral port, per-invocation token, SIGINT/SIGTERM shutdown reaping own sessions); `--port` applies to this form; `rasen config ui` alias goes through the same module unchanged
- [x] 3.3 Concurrent-launch convergence: the losing spawner's `daemon run` exits EADDRINUSE and the losing `start`/`ui` re-probes and adopts the winner — cover with a test simulating the race via a pre-bound port that starts answering with rasen identity mid-wait

## 4. CLI wiring and the double-seam

- [x] 4.1 Register the `daemon` command group (`start`, `stop`, `status`, `run`) and the `ui --no-daemon` flag in `src/cli/index.ts` with help descriptions (`run` described as the foreground/advanced form)
- [x] 4.2 Add every new command and flag to `src/core/completions/command-registry.ts`
- [x] 4.3 Add every new user-facing string to BOTH `src/locales/en.json` and `src/locales/ja.json` (the double-seam — verify with the existing locale-parity test if present, else assert key parity in a new test)

## 5. Tests

- [x] 5.1 daemon-state unit tests: write/read/delete round-trip, permissions best-effort, invalid JSON tolerated as absent, stale file (dead pid/port) treated as a hint only
- [x] 5.2 daemon-probe unit tests against a local http fixture: no-listener, foreign (no identity headers), rasen-daemon same/different version; proxy env vars set during the test to prove the probe ignores them
- [x] 5.3 Adopt-or-spawn state machine tests with fixture daemons (real loopback servers emitting identity headers): adopt without spawn; stale replaced (fixture killed by reported pid, new spawn observed); foreign fails with no signal sent (fixture asserts it received none and stays alive); token-unreadable adoption fails without kill
- [x] 5.4 Residency integration test: `daemon run` (in-process or child) supervising a fixture session; consumer exit does not touch it; `daemon stop` reaps it with `server-shutdown` and removes the state file
- [x] 5.5 `--no-daemon` regression: the child-1 sessions/shutdown test expectations still hold for the self-hosted form
- [x] 5.6 Zero-regression checks: identity headers on every response unchanged; config-api contracts and `getActiveChangeIds`-based listings untouched; NO file under `packages/ui/` modified by this change (parallel-safety with the sessions-ui sibling)

## 6. Verification

- [x] 6.1 Full suite green (`pnpm test`) in the worktree
- [x] 6.2 `rasen validate slice3-daemon-residency --json` passes
- [x] 6.3 Manual smoke on this machine (never port 8890): `rasen daemon start` in a scratch project → close the terminal → new terminal `rasen daemon status` shows it running → `rasen ui` adopts (no second server) → launch a trivial session, exit `rasen ui`, session still listed → `rasen daemon stop` reaps it (`server-shutdown`) and removes the state file; confirm no orphaned `claude`/node processes with `ps`
