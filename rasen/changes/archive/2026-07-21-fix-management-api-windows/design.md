## Context

PR #15 (merge `7fa4966`, branch `dev/platform-slice3`) introduced the management-api subsystem — `src/core/management-api/{supervisor,session-registry,kill-tree,submit,server,router}.ts` and `src/commands/{daemon,ui-launch}.ts`. It was authored on a POSIX platform and has plausibly never passed on Windows. On this machine (Windows 11, Node v24.14.0), 32-33 tests across 8 files fail deterministically.

This document is the diagnosis. Each failing test was run in isolation with full output captured, and the two decisive platform behaviours were confirmed empirically (see "Empirical evidence" below) rather than assumed.

### Empirical evidence (Node v24.14.0, win32)

A standalone reproduction (`child_process.spawn`, `shell:false`) established:

- `spawn('<path>.mjs', …)` → **throws synchronously** `EFTYPE`. A `.mjs` with a `#!/usr/bin/env node` shebang is NOT directly executable on Windows.
- `spawn('<path>.cmd', …, {shell:false})` → **throws synchronously** `EINVAL`. This is Node's post-CVE-2024-27980 hardening: `.cmd`/`.bat` require `shell:true` (or an explicit `cmd.exe` invocation) since Node 18.20 / 20.12 / 22+.
- A repaired spawn — a `.cmd` wrapper (`@node "<fixture>.mjs" %*`) invoked via `spawn(ComSpec, ['/d','/s','/c', bin, ...argv], {shell:false, windowsHide:true})` — spawns cleanly, streams the fixture's NDJSON on stdout, and exits 0. This single shape fixes BOTH the product `.cmd` case and the test fixture, and makes the tests exercise the real `.cmd` codepath.

Both throws land in the supervisor's `try { child = spawn(...) } catch` (`supervisor.ts:202-221`), which returns `503 agent_cli_unavailable` — i.e. `launch()` resolves `{ ok:false }`. That is precisely the `expect(result.ok).toBe(true)` failure seen across the supervisor/sessions suites.

## Goals / Non-Goals

**Goals:**
- Make the session supervisor spawn the resolved agent CLI on Windows for the real-world shim types (`.exe`, `.cmd`, `.bat`), so a stock npm-installed `claude.cmd` launches instead of throwing.
- Make the management-api tests exercise that real Windows codepath (not skip it), and make their harness (fixtures, temp-dir teardown, diagnostic assertions) cross-platform.
- Turn the 8 files green on Windows without weakening any POSIX behaviour and without version bumps.

**Non-Goals:**
- Rewriting kill-tree semantics. Only tighten the Windows grace window if post-fix evidence shows a test legitimately needs it.
- Fixing `command-file-id.test.ts` — cross-platform, unrelated (split; see Decisions D6).
- Blanket `describe.skipIf(win32)`. Skips are reserved for genuinely POSIX-only behaviour with a documented justification; none is needed here.

## Decisions

### Diagnosis table (the heart)

Classes: **(a)** real product Windows bug users hit; **(b)** test-only platform assumption; **(c)** environment/timeout. Counts are approximate (the supervisor/sessions counts drifted 16-17 / 7-8 across reviewer runs because a launch failure cascades into every downstream assertion in the file).

| # | File (count) | Failure mode | Root cause (file:line) | Class | Fix direction |
|---|---|---|---|---|---|
| 1 | `supervisor.test.ts` (~16-17) | every `expect(result.ok).toBe(true)` is false; kill/concurrency/tail assertions collapse | `spawn(claudeBin, argv, {shell:false})` throws sync on win32 for the `.mjs` fixture (`EFTYPE`) and for real `.cmd` shims (`EINVAL`) → caught at `supervisor.ts:202-221` → 503. Fixture claims direct-exec (`session-fake-cli.mjs:9-10`), POSIX-only. | **a + b** | Product: Windows-aware spawn (route `.cmd`/`.bat` via `cmd.exe /d /s /c`, keep `shell:false` for `.exe`). Test: fixture = `.cmd` wrapper on win32. |
| 2 | `sessions-api.test.ts` (~7-8) | launches 503 instead of 201; listings/kills never confirm | Same spawn cascade; supervisor fed `RASEN_CLAUDE_BIN=session-fake-cli.mjs` (`sessions-api.test.ts:12,77`). | **a + b** | Same as #1. Verify the `PATH=''` → 503 test (`sessions-api.test.ts:185-200`) still holds — it does (resolver returns null, unaffected). |
| 3 | `server-shutdown.test.ts` (1) | `isAlive(pid)` chain fails — session never spawned | Same spawn cascade (`server-shutdown.test.ts:12,63`). Post-fix, re-check the kill-grace timing on `expect(isAlive(pid)).toBe(false)` at `:112`. | **a + b (+c)** | Same as #1; inject a short `killGraceMs` if the default 5s grace makes the assertion slow/flaky. |
| 4 | `daemon-lifecycle.test.ts` (2) | HTTP `503` where `201` expected (`:150`); `afterEach` 10s hook timeout | Daemon subprocess (`node dist/cli/index.js daemon run`, `daemon.ts:178-184`) inherits `RASEN_CLAUDE_BIN=.mjs` and cannot spawn the agent → 503; the wedged daemon makes `daemon stop` + temp-rm in `afterEach` (`:120-126`) exceed 10s. | **a + b (+c)** | Same as #1 (unwedges the daemon). Windows-safe teardown for the rm; re-check hook timeout post-fix. |
| 5 | `ui-launch-stale-replace.test.ts` (2) | `afterEach` 10s hook timeout | **NOT the agent-spawn bug** — this file sets no `RASEN_CLAUDE_BIN` and launches no sessions. `daemon stop` + `killIdentifiedDaemonAndWaitFree` → `killProcessTree` uses `taskkill /T` (no `/F`) then `/F /T` after a 5s grace (`kill-tree.ts:84-104`); the graceful `/T` is a no-op against a detached `node.exe`, so each kill burns the full grace, and stacked kills exceed the 10s hook. | **c (+ latent a)** | Re-check post-fix; widen the hook timeout with evidence, or tighten the Windows grace / escalate `/F` sooner (this also speeds real `rasen daemon stop` on Windows). |
| 6 | `submit.test.ts` (1) | `EPERM` in `afterEach` `fs.rmSync(projectRoot)` (`:30`) — the 504 assertion itself PASSES | The timed-out fake-CLI child (spawned with `cwd:projectRoot`, `submit.ts:213`) still holds `projectRoot` as its cwd when `afterEach` deletes it; Windows forbids deleting a directory a live process holds as cwd. Submit deliberately responds 504 before the child dies (`submit.ts:175-195`), so teardown always races the dying child. | **b** | Windows-tolerant temp-dir removal (retry on `EPERM`/`EBUSY` with short backoff). No product change. |
| 7 | `file-system.test.ts` (2) | asserted diagnostic string mismatch (`:282-286`, `:311-312`) | OS errno divergence: POSIX `fs.stat` through a file → `ENOTDIR` → generic branch "Unable to determine write permissions … ENOTDIR" (`file-system.ts:283-287`). Windows → `ENOENT` → parent-walk → "Path component … exists but is not a directory" (`file-system.ts:225-229`). Return value (`false`) is correct on both; the Windows message contains the *parent*, not the full `filePath`, so `toContain(filePath)` at `:312` also fails. | **b** | Platform-aware assertion (both messages are valid diagnostics). No product change. |
| 8 | `command-file-id.test.ts` (1) | clean init reports drift `true` where `false` expected (`:159`) | **NOT Windows-specific.** Test passes the raw workflow list as `desiredWorkflows`; post expert-install-flip (`6f7ae96`) `hasToolProfileOrDeliveryDrift` requires the *closure-resolved* set. Init installs closure experts (`rasen-cso`, `rasen-design-review`, `rasen-qa`, `rasen-qa-only`, `rasen-review`); the deselection check flags them → drift. Confirmed by instrumentation (`profile-sync-drift.ts:129-136`). Mechanism is platform-agnostic. | **pre-existing, cross-platform** | **Split out** — route to the expert-flip owners; fix by passing `resolveDesiredWorkflowSelection()` output, not here. |

Per-class tally: **class (a)** 1 product defect (spawn) cascading through #1-#4; **class (b)** #1/#2/#3 fixtures, #6 teardown, #7 diagnostics; **class (c)** #4/#5 hook timeouts (downstream of a, plus latent kill-grace); **out of scope** #8.

### D1 — Windows agent-CLI spawn (class a, the fix)

Introduce a small spawn helper used by `supervisor.ts` (and reusable by any agent-CLI spawn): on `win32`, if `path.extname(bin).toLowerCase()` is `.cmd`/`.bat`, invoke the target through `process.env.ComSpec || 'cmd.exe'` with `['/d','/s','/c', '"<commandLine>"']`, where `<commandLine>` is the shim path plus every argument escaped for `cmd.exe`, passed with `{ shell:false, windowsVerbatimArguments:true, windowsHide:true }`; otherwise spawn `bin` directly as today.

**Command-injection posture — the load-bearing detail.** `cmd.exe /S /C` re-parses its trailing command line as shell grammar. Node's default per-argument quoting is CRT-style (a literal `"` becomes `\"`), which the CRT/`CommandLineToArgvW` of a *normal* target understands — but `cmd.exe` does NOT: to `cmd.exe`, that `"` still toggles quote state, so a `"`-bearing prompt breaks out and any following `&`/`|`-chained text runs live. This was reproduced with a PoC (`task = 'foo" & echo INJECTED>PWNED.txt & "bar'` wrote a real file). Therefore the naive `['/d','/s','/c', bin, ...argv]` shape (relying on Node's default quoting) is itself vulnerable — an earlier draft of this change shipped exactly that shape and the reviewer's PoC broke it.

The fix builds the command line explicitly with **cross-spawn's vetted `cmd.exe` escaper** (`cross-spawn/lib/util/escape`; cross-spawn is an exact-pinned direct dependency, loaded lazily via `createRequire` like `commands/workset.ts`) and passes it `windowsVerbatimArguments:true` so Node does not re-quote what is already escaped. Metacharacters are **double-escaped** (`escape.argument(arg, true)`): an npm-generated `.cmd`/`.bat` shim proxies its args to node via `%*`, which re-parses through `cmd.exe` a *second* time — a single `^`-escape layer is consumed by the first parse and the metachar would reach the shell live on the second (empirically: cross-spawn's own single-escape path, used for shims outside `node_modules/.bin`, injects; forced double-escape does not). Rationale over alternatives, each tested empirically on this machine (Node v24.14.0, win32):
- **`spawn(bin, argv, {shell:true})` (Node-native path)** — rejected. It emits `DEP0190` ("arguments are not escaped, only concatenated") and *does* inject on unquoted `&`/`|`/`%VAR%` payloads in the fuzz set. Node itself declares this path unsafe.
- **`spawn(bin, argv, {shell:false})` directly on the `.cmd`** — throws `EINVAL` (the post-CVE-2024-27980 hardening). Node offers no safe direct-`.cmd` path on this version, so hypothesis "Node auto-escapes `.cmd` args" does not hold here.
- **cross-spawn as a black box (public API)** — rejected as sole mechanism: it only double-escapes when the shim path matches `node_modules[\\/]\.bin[\\/]…\.cmd`; a PATH/global `claude.cmd` (e.g. `%APPDATA%\npm\claude.cmd`) misses that regex and is single-escaped → injects. Reusing its escaper directly with forced double-escape is what makes it correct for an arbitrary resolved shim location.
- **Rejecting cmd metacharacters at the validation boundary (`sessions.ts`)** — rejected as a fix: it silently mangles legitimate prompts (task text routinely contains `&`, `|`, `%`, `"`), and defense belongs at the spawn boundary, not by censoring input.
- **Prefer `.exe` only** — insufficient; npm global installs create only `claude.cmd`, and `candidateNames()` already lists `.cmd`.
- The `error`-event handler and slot accounting are unchanged; only the synchronous `spawn` call shape changes.

### D2 — Cross-platform fixture (class b)

Resolve the fake-CLI to a spawnable form per platform. On win32, use/generate a `.cmd` wrapper (`@node "<abs path to session-fake-cli.mjs>" %*`) and point `RASEN_CLAUDE_BIN` / `resolveAgentCli` at it; on POSIX keep the `.mjs`. This deliberately drives the D1 `.cmd` codepath so the product fix is actually tested. A committed `.cmd` fixture file (or a per-test tmp wrapper) both work; a committed sibling fixture is simpler to reason about. The fixture header comment (`session-fake-cli.mjs:9-10`) must be updated to stop asserting POSIX direct-exec.

### D3 — Windows-safe temp-dir teardown (class b)

Add a shared test helper `removeDirWithRetry(dir)` that calls `fs.rmSync(dir, {recursive:true, force:true})` and, on `EPERM`/`EBUSY`/`ENOTEMPTY`, retries a few times with a short backoff. Use it in `submit.test.ts`'s `afterEach` and any daemon/ui teardown that races a dying child. This matches the repo's known Windows rmdir flake pattern and is the minimal honest fix (the product resolves 504 before the child exits by design; the test must tolerate the lingering cwd handle).

### D4 — Platform-aware diagnostics (class b)

In the two `file-system.test.ts` cases, assert the platform's actual diagnostic: on win32 expect "Path component … exists but is not a directory" and drop the `toContain(filePath)` (Windows reports the parent component), else keep the `ENOTDIR` wording. Both are correct diagnoses of the same condition; the product's `canWriteFile` already returns `false` correctly on both, so no product change. (An alternative — normalising `canWriteFile` to emit one platform-independent message — is over-engineering for a correct-but-differently-worded diagnostic and would itself need a spec touch.)

### D5 — Timeouts / kill grace (class c), evidence-gated

Do not pre-emptively widen timeouts. After D1+D3 land, re-run #4 and #5. If they still exceed 10s, the residual is the Windows `taskkill /T` (no `/F`) grace window (`kill-tree.ts:86-104`): the graceful phase is a near-no-op against detached `node.exe`, so every kill waits the full `DEFAULT_GRACE_MS` (5s). Two honest options, chosen on evidence: (i) inject a short `killGraceMs` in the affected tests, or (ii) shorten the Windows default grace / escalate to `/F /T` sooner — which also improves real `rasen daemon stop` latency on Windows (a latent class-a nicety, not a correctness bug). Prefer (i) for a test-scoped fix unless (ii) is clearly warranted.

### D6 — Split recommendation

`command-file-id.test.ts` (#8) is a cross-platform test/contract staleness entangled with the active expert-install-flip work (agents `impl-flip`/`rev-flip`/`ship-flip`). It does not belong in a Windows-compat change: bundling it would misattribute a POSIX-failing test to Windows and couple this change to in-flight flip work. Recommend it be owned by the flip change (fix the test to pass the closure-resolved desired set). This change should exclude it.

## Risks / Trade-offs

- **`cmd.exe /d /s /c` argument quoting** → Node's default arg-quoting is NOT safe here: `cmd.exe` re-parses the command line and a literal `"` in the prompt breaks out of it (PoC-confirmed command injection; see D1). The fix escapes the command line with cross-spawn's vetted `cmd.exe` escaper (double-escaped for the shim's `%*` second parse) and passes `windowsVerbatimArguments:true`. Verified against an adversarial fuzz set through the real `supervisor.launch()` path (`test/core/management-api/supervisor-injection.test.ts`, 9 cases: embedded `"`+`&`, bare `&`, `&&`, `|`, `%VAR%`, `^`, parens, no-space quote/metachar, and a benign-metachar intactness case) — no injected command runs and the prompt arrives as one intact literal argument. The regression test was confirmed to FAIL against the pre-fix naive shape and PASS after the fix. Keep the existing `submit.ts` "single `--proposal=` token" injection posture as the reference discipline.
- **Newline in task text is unrepresentable through the Windows shim** → a raw `\n`/`\r` cannot be carried as argument data through `cmd.exe /C`: cmd truncates the command line at the first newline, silently dropping the rest of the prompt AND the trailing `--dangerously-skip-permissions`/`--output-format`/`--verbose` flags (no escaping survives it; cross-spawn does not escape newlines either — confirmed non-exploitable, truncated not executed, but silent data loss). The Windows `.cmd`/`.bat` spawn branch therefore REJECTS a newline-bearing argv up front by throwing, which the supervisor's existing spawn-`catch` surfaces as a clear `503 agent_cli_unavailable` naming the multi-line limitation — never a silent truncated launch. This guard is scoped to the Windows shim transport specifically, NOT `validateTask()`: on POSIX (and for a native `.exe`) a newline in an argv element is passed literally, so multi-line prompts are a valid, supported feature there; a global validation change would regress it. Covered by `supervisor-injection.test.ts` (Windows: newline → loud 503 with nothing spawned, confirmed to FAIL/truncate without the guard; POSIX: a multi-line task still launches and exits cleanly).
- **`.cmd` wrapper changes the observed `child.pid`** → on win32 the pid is `cmd.exe`'s; the real agent runs as its child. `killProcessTree(pid)` uses `taskkill /T` (tree), so tree-kill still reaps the node child. Confirm the kill/`isAlive` assertions in #2/#3 pass against the wrapper's pid.
- **Retry-on-EPERM teardown could mask a real leak** → bound the retries (small count, short total backoff) so a genuinely stuck handle still surfaces rather than hanging.
- **Under-fixing #5** → if the kill-grace residual is left as a pure timeout bump, real Windows `daemon stop` stays slow. Flag D5(ii) to reviewers even if the test-scoped D5(i) is taken.

## Open Questions

- Does the shipped Windows `claude` install this project targets ship a real `claude.exe`, only a `claude.cmd`, or both? Either way D1 is required (the `.cmd` case is real), but it informs whether D5(ii) is worth doing now.
- Should D1's helper live in `management-api/` or a shared `utils/` module for reuse by the relay/browser spawns? Reviewer's call; keep it local to `management-api` unless a second caller appears in this change.
