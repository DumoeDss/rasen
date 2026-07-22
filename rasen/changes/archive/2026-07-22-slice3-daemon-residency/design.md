## Context

Child 1 shipped the session supervisor inside the foreground `rasen ui` server: `session-registry.ts` and `supervisor.ts` deliberately have zero server dependencies, `supervisor.shutdownAll(reason)` is exposed "for child 2 to re-decide the exit posture", and the sessions route group mounts at the server composition point without touching the config/management routers. The launch flow lives in `src/commands/ui-launch.ts` (ephemeral port, per-session random token printed as a URL fragment, SIGINT/SIGTERM → `stopServer` → `shutdownAll('server-shutdown')`).

Template: omnicross `apps/desktop/src-tauri/src/daemon_runtime.rs` — probe a fixed admin port with a no-proxy loopback client, classify by identity headers present on every response (even 401), adopt same-version, kill-by-reported-pid + respawn stale versions, hard-fail on foreign listeners, bounded readiness wait after spawn. Rasen's identity headers (`x-rasen-daemon: <version>`, `x-rasen-pid: <pid>`) have been on every management-server response since slice 1, explicitly to enable this classification.

Portfolio red lines: daemon is reader + launcher, never a second source of truth; "never kill what you didn't spawn" (precisely: never touch what you cannot identify); identity-header/config contracts and `getActiveChangeIds` SHALL NOTs zero-regression; never port 8890.

## Goals / Non-Goals

**Goals:**
- Supervised sessions survive terminal exits: the supervisor's owner is a resident daemon process.
- `rasen daemon start|stop|status|run` command family, with the completions-registry + en/ja locale double-seam served.
- `rasen ui` becomes an adopt-or-spawn consumer implementing the omnicross classification state machine over the existing identity headers.
- Fold in child 1's two carry-forward hardening items (N1 tail-prune leak, N2 post-await draining re-check) while in `supervisor.ts`.

**Non-Goals:**
- OS service integration (launchd/systemd/Service Manager) — the daemon is a detached user process; machine-boot persistence is out of scope.
- Multi-daemon / multi-project daemons — one daemon per machine-user, serving the project it was started in (same single-launch-project model as today's server; multi-project routing stays a config-api concern).
- Any `packages/ui` change (sibling child 3 owns that tree; file-disjointness is the parallel-safety guarantee).
- Changing the sessions wire contract (settled in child 1; child 3 builds against it).
- Log rotation/retention machinery — the log file is truncated at daemon start, nothing more.

## Decisions

### D1. Residency form: detached self-spawn with a `run`/`start` split

`rasen daemon run` is the daemon itself: a foreground process that assembles the same management server `rasen ui` assembles today (management API + config API + UI assets + sessions group) and owns the supervisor. `rasen daemon start` spawns it detached — `process.execPath` + this installation's own `dist/cli/index.js` entry (slice 2's own-installation rule; never PATH) + `daemon run` argv, `detached: true`, stdio redirected to the log file, `unref()` — then polls the status endpoint (bounded, ~20 × 250ms) and exits 0 only once the daemon answers with matching identity. This is the omnicross launcher/resident split translated to a CLI: `start` is the launcher, `run` is the resident, and `run` doubles as the transparent debugging form (Ctrl-C works, logs on the terminal).

Alternative considered — launchd/systemd registration: real machine-boot residency, but platform-specific, permission-heavy, and far beyond what "survive the terminal" needs. Rejected for this slice; the detached process is portable and sufficient.

### D2. Fixed port + runtime state file (discovery and auth handshake)

Adopt-or-spawn needs a knowable rendezvous. Two pieces:

- **Fixed default port 8791** (never 8890 — red line), overridable by `RASEN_DAEMON_PORT` or `rasen daemon start/run --port`. The management server itself already supports a pinned port; the daemon just pins it by default instead of using an ephemeral one.
- **Runtime state file** `~/.rasen/daemon/daemon.json`, written by the daemon process itself once listening: `{ version, pid, port, token, startedAt }`, `0600` permissions, deleted on clean daemon exit. Consumers use it for the token and for a port hint; probing order is state-file port first, then the default port. Stale state files are harmless: classification never trusts the file — it trusts the live probe's identity headers — and a file pointing at a dead port just falls through to NoListener.

The token moves from "minted per `rasen ui` invocation" to "minted per daemon lifetime": an adopting `rasen ui` reads the token from the state file and prints/opens the same `#token=` URL as today. Same trust boundary — the file is owner-readable only, exactly like the terminal scrollback that carries the URL today. Red-line check: this file is daemon runtime metadata (process facts), not workspace or pipeline state; the never-a-second-source-of-truth rule concerns pipeline truth, which stays in agent-written run-state files.

### D3. Adopt-or-spawn state machine (consumer side, in `rasen ui`)

States: `probing → adopted | spawning → running | failed` (omnicross vocabulary, minus Tauri).

1. **Probe**: GET `/api/v1/status` on the candidate port(s), short timeout (~700ms), **proxy-bypassed** (Node `fetch` ignores env proxies by default — must stay that way; the omnicross `.no_proxy()` lesson and the repo's own curl-vs-proxy history both say a loopback probe routed through a system proxy makes a live daemon look dead).
2. **Classify** by response headers, not body (identity headers are on every response including 401, so no token is needed to classify):
   - No response → `NoListener` → spawn path.
   - Response without `x-rasen-daemon` → **Foreign** → `failed` with a clear reason naming the port and how to override it. Never adopt, never kill.
   - `x-rasen-daemon` = own version → **Adopt**: read the token from the state file (unreadable/missing token → `failed` with remediation "run `rasen daemon stop` then retry", still no kill — a healthy daemon we cannot authenticate to is not ours to destroy), print URL, open browser. No spawn.
   - `x-rasen-daemon` ≠ own version → **stale rasen daemon**: kill by its **reported pid** (`x-rasen-pid`) via the existing tree-kill module, wait bounded for the port to free, then spawn fresh. This is killing something identity-verified as a rasen daemon — the rule "never kill what you didn't spawn" forbids touching what we cannot *identify*; a version-mismatched rasen daemon is identified, and leaving it would strand the platform on stale code.
3. **Spawn** (from `NoListener`): the D1 start flow, then bounded readiness wait; wait exhausted → `failed` with the log-file path in the message, and the just-spawned child is tree-killed (a half-started daemon is ours to reap — it never reached adoptable state).

`rasen daemon status` runs steps 1–2 and reports the classification honestly (running/adopted-able, foreign, stale, absent) without ever acting on it. `rasen daemon stop` runs 1–2 and kills only on a positive rasen-daemon classification (any version), removing the state file after the process is confirmed gone; foreign → refuse with the same never-touch message.

### D4. Ownership and exit postures (re-deciding child 1's D6, as invited)

- **Daemon owns the supervisor**: `daemon run` constructs the same `session-registry` + `supervisor` modules (their zero-server-deps design was built for exactly this) inside its server assembly. Sessions live and die with the daemon, not with any terminal.
- **`rasen ui` exit**: touches nothing. It neither reaps sessions (they are the daemon's) nor the daemon — including a daemon it just spawned. This deliberately deviates from the omnicross template ("a child WE spawned is tree-killed on app exit"): omnicross's desktop app *is* the platform surface, so daemon-outliving-app has no consumer; for rasen the entire point of this change is that sessions outlive the terminal, and the portfolio plan explicitly delegated the reap-on-exit question to this design. A spawned daemon becomes self-owned the moment it reaches `running`.
- **Daemon clean shutdown** (`rasen daemon stop`, SIGTERM/SIGINT of `daemon run`): reaps live sessions via `shutdownAll('server-shutdown')` — stopping the daemon is an explicit operator statement "stop the platform", and orphaning supervised claude runs burns tokens with no observer (child 1's reasoning, unchanged; only the owner moved). Then deletes the state file and exits.
- **Daemon SIGKILL**: orphans sessions and leaves a stale state file — same honest limitation as child 1's, one process further from the terminal; the stale file self-heals on the next probe (dead port → NoListener → respawn overwrites it).
- **`rasen ui --no-daemon`**: child 1's foreground behavior verbatim (self-hosted server, ephemeral port, kill-on-exit). Kept as the dev loop and as the fallback the failed state suggests when spawning is broken.

### D5. Supervisor hardening carried forward (N1/N2)

While in `supervisor.ts` for the daemon bootstrap, fold in the two review carry-forwards recorded in the parent planning-context:

- **N2** — `launch()` reserves a concurrency slot, then `await`s `resolveAgentCli()`. The `draining` flag is checked before the await; a `shutdownAll` that starts during the await lets the spawn land after the drain snapshot → orphaned child no shutdown will ever see. Fix: re-check `draining` after the await; when set, release the slot and return the 503-shaped unavailable result. Unconditional (cheap), though only a genuinely-async resolver can lose the race — and the daemon injects the same cached resolver, so this closes the window for any future resolver too.
- **N1** — the synchronous spawn-catch path finalizes the record but leaks the tail-buffer entry when `finalize`'s pruning returns ids whose tails were already registered: make the catch path delete the current record's tail entry symmetrically with the close path.

### D6. Command wiring and the double-seam

`daemon` is a public top-level command group (`start`, `stop`, `status`, `run`) in `src/cli/index.ts` via a new `src/commands/daemon.ts`; `run` is listed but described as the foreground/advanced form. Every new command and flag lands in `src/core/completions/command-registry.ts` AND `src/locales/en.json` + `ja.json` — the double-seam that bit slices 1 and 2 three times; tasks make each an explicit checkbox. `rasen ui` gains `--no-daemon` (same seams). `rasen config ui` (the deprecated alias) keeps its current foreground behavior wired through the same launch module — it gets adopt-or-spawn for free and needs no separate decision.

## Risks / Trade-offs

- [Fixed default port 8791 collides with an unrelated service on some machine] → classification refuses to touch a foreign listener and says exactly why; `RASEN_DAEMON_PORT`/`--port` reroutes; the state file lets consumers find a rerouted daemon.
- [Token in a file instead of terminal scrollback] → `0600` on a per-user home path is the same effective boundary; the file also dies with the daemon (deleted on clean exit).
- [Killing a stale-version daemon kills its live sessions] → inherent to replace-on-stale; the kill path goes through the daemon's own SIGTERM handler when possible (tree-kill sends TERM first), which runs `shutdownAll` — sessions die reaped, not orphaned; run-state files persist for resume.
- [Detached daemon on Windows: `detached: true` + file-descriptor stdio] → both are long-supported Node spawn semantics on win32; tree-kill's taskkill branch already ships from child 1; tests exercise the spawn shape with fixture children as child 1's did.
- [Two servers racing to bind (concurrent `rasen ui` invocations both see NoListener)] → the loser's `daemon run` fails EADDRINUSE and exits non-zero; the loser's `start` readiness-poll then finds the winner, re-probes, and adopts it — convergent without a lock file.
- [Readiness wait too short on cold machines] → 20 × 250ms matches the template and probes a local bind, not model traffic; the failure message carries the log path so a slow start is diagnosable and retryable.
- [`rasen ui` printed URL now points at a long-lived token] → acceptable: the board is a local single-user surface; token rotates on daemon restart, and `daemon stop` is the revocation lever.

## Open Questions

- None blocking. Whether the daemon should later self-update (respawn itself on CLI upgrade without waiting for the next `rasen ui`) is future work the stale-version kill path already approximates.
