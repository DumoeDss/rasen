## Why

Child 1 (`slice3-session-runtime`) gave the platform supervised agent sessions, but they live inside the foreground `rasen ui` process: close the terminal and every running session is reaped (`shutdownAll('server-shutdown')` — the posture child 1 chose precisely because an in-memory registry had no adopter). Slices 1–2 deliberately deferred resident-process semantics with the rationale "residency's real need comes from session supervision" — that need now exists. This change makes the supervisor's owner a resident daemon that survives terminal exits, and turns `rasen ui` into an adopt-or-spawn consumer of it.

## What Changes

- New `rasen daemon` command family: `start` (spawn the resident daemon detached and return once it answers), `stop` (identity-verified shutdown of a running daemon), `status` (probe and report), and `run` (the foreground daemon process itself — what `start` detaches; also the debugging form). New commands land in the completions registry and both en/ja locales (the double-seam).
- The daemon process hosts the same management server assembly `rasen ui` hosts today (management API + config API + UI assets + sessions route group) on a fixed default port, and constructs the very same `session-registry` / `supervisor` modules child 1 shipped with zero server dependencies — sessions keep running when terminals close.
- The daemon writes a runtime state file (`~/.rasen/daemon/daemon.json`, owner-only permissions: version, pid, port, token, startedAt) so consumers can find and authenticate against it; daemon stdout/stderr go to a log file next to it. Runtime metadata only — never workspace or pipeline state.
- `rasen ui` becomes an adopt-or-spawn consumer (omnicross `daemon_runtime.rs` state machine): probe the daemon port → classify by the identity headers every server response has carried since slice 1 (`x-rasen-daemon`/`x-rasen-pid`) → same-version daemon is adopted (no spawn); stale-version rasen daemon is killed by its reported pid and respawned; a listener without identity headers is a foreign process — fail with a clear reason, never adopt, **never kill what you cannot identify**. No listener → spawn the daemon and wait bounded for readiness.
- Residency posture (planner ruling, deviating from the omnicross template deliberately): `rasen ui` never reaps the daemon on exit — not even one it spawned — because surviving the terminal is residency's whole point. Daemon lifetime belongs to `rasen daemon stop`, stale-version replacement, or the OS. Session reaping moves with ownership: the daemon reaps its live sessions on its own clean shutdown; a `rasen ui` exit no longer touches them. `rasen ui --no-daemon` preserves child 1's self-hosted foreground behavior (dev loop, spawn-failure fallback) including its kill-on-exit posture.
- Supervisor hardening carried forward from child 1's review (N1/N2): the `draining` flag is re-checked after the async agent-CLI resolution inside `launch` (closing the spawn-after-drain-snapshot orphan window for any genuinely-async resolver), and the sync-spawn-catch path's tail-prune leak is fixed.

## Capabilities

### New Capabilities
- `daemon-residency`: the resident daemon's lifecycle (start/stop/status/run), its runtime state file and identity contract, the adopt-or-spawn classification state machine consumers follow, and the never-adopt/never-kill rules for foreign listeners.

### Modified Capabilities
- `management-ui-command`: `rasen ui` changes from "start a server in the foreground" to "adopt or spawn the resident daemon, then open the browser against it"; clean-shutdown semantics are restated (exiting `rasen ui` leaves the daemon and its sessions running; `--no-daemon` keeps the old self-hosted behavior).
- `session-supervision`: the shutdown-posture requirement ("Foreground server shutdown reaps its sessions") is restated to bind reaping to the supervisor's owning process — the daemon reaps on daemon shutdown; a consumer's exit does not reap; the pre-residency foreground behavior remains only under `--no-daemon`. (Stacked delta: child 1's spec archives first.)

## Impact

- Affected code: `src/commands/` (new `daemon.ts`, `ui-launch.ts` adopt-or-spawn rewrite), `src/cli/index.ts` (command wiring), `src/core/management-api/` (daemon bootstrap reusing the existing server assembly; supervisor N1/N2 hardening), `src/core/completions/command-registry.ts`, `src/locales/en.json` + `ja.json`, tests alongside. **No `packages/ui` files** — the sibling `slice3-sessions-ui` owns that tree exclusively (parallel-safety guarantee).
- The fixed daemon port must never be 8890 (the user's preview server); default is 8791 with env/flag override.
- Depends on child 1 (shipped, commit 3df65f9). Sibling `slice3-sessions-ui` is file-disjoint and unaffected by this change's API surface (the sessions wire contract is settled and untouched here).
