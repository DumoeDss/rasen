## Why

The management-api subsystem introduced by PR #15 (daemon, session supervisor, kill-tree, submit bridge, `daemon`/`ui` commands) was authored on a POSIX platform and has never worked on Windows. On Windows 11 / Node 24, 32-33 tests across 8 files fail deterministically (confirmed non-flake by three reviewers). Diagnosis traces them to one real product bug plus a cluster of test-only platform assumptions:

- **Real product bug (headline):** `supervisor.ts` spawns the resolved agent CLI with `shell: false`. On Windows this throws *synchronously* — `EINVAL` for `.cmd`/`.bat` shims (Node's post-CVE-2024 spawn hardening), `EFTYPE` for a non-PE file — so the `try/catch` returns `503 agent_cli_unavailable` and **every session launch dies**. Users who installed the `claude` CLI via npm (which creates `claude.cmd`) cannot launch a single session on Windows. This is not a test artifact; it is the subsystem being non-functional on the platform.
- **Test-only assumptions:** POSIX-only executable fixtures (`session-fake-cli.mjs` spawned as the command itself via shebang), a Windows-unsafe temp-dir teardown (`fs.rmSync` while a still-dying child holds the dir as cwd → `EPERM`), and a diagnostic-string assertion that hard-codes the POSIX `ENOTDIR` errno where Windows reports `ENOENT`.
- **One unrelated pre-existing failure** (`command-file-id.test.ts`) that is NOT Windows-specific and is recommended for a split (see design.md).

Fixing this makes the entire session platform usable on Windows and turns the test suite green on the platform.

## What Changes

- Make the session supervisor spawn the resolved agent CLI correctly on Windows: route `.cmd`/`.bat` shim targets through `cmd.exe /d /s /c` (keeping `shell: false` for `.exe` and POSIX), so a real npm-installed `claude.cmd` launches instead of crashing with a synchronous `EINVAL`. **This is a user-facing behavior change** on Windows (session launch: broken → working).
- Cross-platform test fixtures: on Windows the fake-CLI fixture resolves to a `.cmd` wrapper that runs `node <fixture>.mjs %*`, so the tests exercise the exact real-world `.cmd` spawn codepath rather than a POSIX shebang. POSIX keeps the `.mjs`.
- Windows-tolerant test teardown: a shared helper that removes temp dirs with a short retry/backoff on `EPERM`/`EBUSY`, covering the documented Windows "cannot delete a directory a live process holds as cwd" case (submit's 504 test, and any daemon-lifecycle teardown that races a dying child).
- Platform-aware diagnostic assertions in `file-system.test.ts`: accept the Windows `ENOENT`-driven "Path component … is not a directory" message (equally valid; the return value is already correct on both platforms). No product change.
- Re-evaluate the daemon-lifecycle / ui-launch-stale-replace 10s hook timeouts once the spawn fix lands; widen specific timeouts (or inject a short `killGraceMs`) **only** where Windows process-spawn/`taskkill`-grace overhead is shown by evidence to require it — never as a blanket bump.
- **Out of scope / split recommended:** `command-file-id.test.ts` drift failure — a cross-platform test/contract staleness tied to the expert-install-flip, not a Windows issue.

## Capabilities

### New Capabilities
- `windows-process-launch`: The daemon and session supervisor SHALL resolve and spawn the agent CLI, and terminate its process tree, correctly across Windows executable shim types (`.exe`, `.cmd`, `.bat`), so session launch works on a stock npm install and is not broken by Node's `.cmd`/`.bat` spawn hardening.

### Modified Capabilities
<!-- None. The remaining fixes are test-only / compatibility and change no committed requirement. -->

## Impact

- **Product code:** `src/core/management-api/supervisor.ts` (spawn path); possibly a small shared spawn helper. `src/core/management-api/kill-tree.ts` only if evidence shows the Windows graceful `taskkill /T` (no `/F`) grace window must be tightened.
- **Test code:** `test/core/management-api/{supervisor,sessions-api,server-shutdown}.test.ts`, `test/commands/{daemon-lifecycle,ui-launch-stale-replace}.test.ts`, `test/core/management-api/submit.test.ts`, `test/utils/file-system.test.ts`; the fixture `test/fixtures/management-api/session-fake-cli.mjs` (add a Windows `.cmd` wrapper resolution); a shared Windows-safe temp-dir removal test helper.
- **No version bump.** No change to the POSIX behavior of any of the above.
- **Not touched:** `command-file-id.test.ts` / `profile-sync-drift.ts` (split out).
