# Independent delta re-review round 2 - ecp-hosted-best-effort-cutover

Role: non-author REVIEWER (author of `review-round-1.md`; not the fixer). Date: 2026-08-08.
Delta range **`9db76d31..fec34c16`** - `8e48ce45` (F1+F2), `0e86380f` (pin rebaseline),
`708b558c` (F3 + F4 deferral), `fec34c16` (7.2b waiver withdrawn + its real-host mutation).
Host: Windows 11 Pro 10.0.26200.8875, Node v24.14.0, vitest 3.2.6; `dist/cli/index.js`
confirmed present before every vitest invocation.

Method: the fixer's `fix-round-1.md` and handoff were read, then every claim was re-derived
independently - digests recomputed from committed bytes, three mutations re-run by this
reviewer (one deterministic, one against the real packaged capsule, one latch-disable), and
one new demonstration produced for the half the fixer honestly recorded as unproven. All
mutations used byte-exact backup/restore (wrapper hash `9a9bfc47...` before and after each),
never `git checkout --`.

## Per-item verdicts

### 1. F1 [Major] - one-shot probe parser containment: FIXED, and the crash half is now proven

Code re-read at `native-process-scope.ts:344-414`. All four properties the delta scope
required are present:

- **Containment**: the stdout callback body is wrapped in `try/catch` (`:370-392`), and
  `failProbe` (`:348-361`) converts any throw into a typed `ProcessScopeError` carrying the
  `inspect`/`terminate` phase. This mirrors the resident client's handler.
- **Every non-observation frame is a typed protocol failure** (`:384-388`) - RC-004's second
  half, which the original finding demanded and round 1 left as an open ruling. Ignoring
  unknown frames to the deadline is gone.
- **Settles once**: the `settled` latch (`:347`, `:349`, `:369`, `:373`) makes a duplicate
  observation unable to re-settle or reject an already-settled deferred.
- **A protocol-breaking probe is killed**: `child.kill('SIGKILL')` now covers the whole catch
  (`:408-412`), not only the timeout branch.

Four discriminators exist through the fake-capsule seam (`fake-process-capsule.ts:49-70`,
`:167-188`: `oversized-frame` with a 64 MiB declared length, `truncated-observation`,
`unknown-frame`, `duplicate-observation`) and are asserted in
`win32-best-effort-scope.test.ts` on BOTH `inspect` and `terminate`, including
`receiptAuthorizesRelease === false`.

**Ruling on the mutation-(g) crash half.** The fixer recorded honestly that reverting the
containment produces a hang-to-deadline under vitest rather than an observed crash, and that
the "kills the daemon" half therefore rested on code reading. That caveat is accurate about
vitest - a worker installs its own `uncaughtException` handling, so the throw is absorbed and
surfaces as a timeout. It is not adequate on its own for RC-004's typed-uncertainty core,
because "hang to deadline" and "process death" are different severities. So I produced the
missing demonstration rather than accept the code reading:

A standalone Node script reproduced the PRE-FIX handler shape exactly (bare
`readUInt32BE(1)` + bound check inside a real `ChildProcess` stdout `data` callback) with a
real child writing the same oversized header the seam's mode writes. Result: the host process
terminated with the stack `at Socket.<anonymous> ... at Pipe.onStreamRead`, exit code 1, and
the script's `SURVIVED:` line never printed. That is the daemon-death half, observed outside
vitest's absorption.

**Verdict: F1 fixed; both halves of the defect are now evidenced (hang under vitest, process
death outside it), and RC-004's second half - typed rejection of non-observation frames - is
implemented rather than deferred. The round-1 ruling that RC-004 needed either the ordering
half or a recorded accepted-known is satisfied by implementation.** Mutation (g)'s own RED
(1 failed | 21 passed) was accepted as recorded; it is corroborated by my demonstration and
by the four discriminators being green only against the contained code.

### 2. Pin rebaseline (`0e86380f`) - VERIFIED, exactly one entry moved

Recomputed by this reviewer from COMMITTED bytes at `fec34c16` (`git show <commit>:<path> |
sha256sum`), against the constants as committed:

| Pinned file | Digest at `fec34c16` | Status |
| --- | --- | --- |
| `src/core/session-host/process-capsule/native-process-scope.ts` | `a070733cc338730258f5725c962c70f2284ead3601a2bc49b24c5c5d75211977` | MOVED, matches the new pin |
| `native/process-capsule/src/main.rs` | `79dc1ad0...f0f41c8d` | unchanged |
| `native/process-capsule/Cargo.lock` | `f00e6411...1d32db8793` | unchanged |
| `scripts/build-process-capsule.mjs` | `4117b109...653f599ef92` | unchanged |
| `src/core/session-host/process-capsule/resolver.ts` | `a1df4e2e...5624bbf91` | unchanged |
| `test/core/session-host/process-capsule-package.test.ts` | `3ed5945c...528a759e1` | unchanged |
| `test/core/session-host/process-capsule-posix-replacement.test.ts` | `894a5119...2f4f0e64e047` | unchanged |
| `rasen/specs/process-authority-provider/spec.md` (FROZEN_COMMON) | `359db6d9...1452ef9` | unchanged |
| `test/helpers/process-authority-provider-conformance.ts` (FROZEN_COMMON) | `b9d8bd4f...cc58d2f0` | unchanged |

The constant diff confirms exactly one entry changed in each of the two
`LEGACY_PROCESS_CAPSULE_INPUTS` lists, with an identical eight-line lineage comment at both
sites naming the old and new hashes, the cause (F1 / RC-004 containment), the reachability
reason (design D4), the TypeScript-adapter-only scope, and the authorization date. The Rust
crate received zero bytes. Both pin suites pass in my run (21 tests).

### 3. F2 [Minor] - terminate-leg hardening: FIXED, and the attribution reasoning holds

Three changes verified in `win32-best-effort-scope.ts`: the latch is re-checked AFTER the
await (`:250` in the delta's `translateTermination`), minting additionally requires
`channelAttributed`, and `armTransportLostFromError` latches typed control failures during
the prepared window (plus `armTransportLost` on uncertain receipts and a latch on
`activate()` failure).

**Sanity-check of the attribution crux** (the fixer's reasoning: `terminate` cannot
structurally distinguish a resident `closed` from a probe `closed`, so it reads
`gracefulAttempted`). Verified against the capsule as shipped: the resident terminate leg
returns `{ state: 'closed', gracefulAttempted: true, forced: true }`
(`native-process-scope.ts:549`), while the probe leg's `receiptFrom` returns
`{ state: 'closed', gracefulAttempted: false, forced: true }` (`:423`). The flag is therefore
a sound discriminator for `closed` receipts on an owned ref. `abort`'s "attributable by
construction" claim also holds: `prepared.abort` writes TERMINATE on the resident channel and
a dead channel throws from `send` rather than answering (`:203-207`, `:486-508`). One
narrowing worth recording (not a finding): the attribution is a semantic contract on a
capsule field rather than a structural guarantee, so a future capsule change that set
`gracefulAttempted` on the probe leg would silently weaken it - the pinned digest and this
review are what hold that in place.

Mutation (h) re-run by ME (not accepted from the receipt): with `|| !channelAttributed`
removed, the suite failed at exactly "never mints a terminal after the controller dies during
the prepared window", **1 failed | 21 passed (22)**; restored byte-exact, 22/22 green.

### 4. F3 [Minor] - guard counterparts: FIXED, no waiver remains

(i)/(j)/(k) accepted as recorded with their named RED tests and counts: (i) reds both latch
guards including the round-1-named "terminal stays unsettled" (2 failed | 20 passed);
(j) reds only the API-projection guard (1 failed | 9 passed); (k) reds only the activation-gate
guard (1 failed | 9 passed).

The two real-host mutations were the ones worth re-running, and I ran (m-real) myself against
the REAL packaged capsule with `RASEN_WIN32_REAL_CAPSULE=1`: adopting a previous-lifetime ref
as live/controllable made **7.2b alone fail while 7.1 and 7.3 stayed green** (1 failed |
2 passed), which is the precision the delta scope asked for - attributable to the reattach
property, not broad breakage. Restored byte-exact; unmutated real-host suite 3/3 green in my
run. (a-real) accepted as recorded (7.1 alone RED against the forged clean-cancel).

The waiver withdrawal in `fec34c16` is real: no waiver text survives in `fix-round-1.md`, and
every win32 real-host property now has a demonstrated failing counterpart.

### 5. F4 [Minor] - correctly NOT fixed, and not silently touched

`git diff 9db76d31..fec34c16 -- posix-best-effort-scope.ts` is EMPTY (zero lines). Neither map
gained a lifecycle delete: at `fec34c16`, `posix-best-effort-scope.ts` has `scopes.set` at
`:447` and no `scopes.delete`; `win32-best-effort-scope.ts` has `scopes.set` at `:308` and no
`scopes.delete`. The deferral is recorded in `fix-round-1.md` and carried in the handoff as
the change's only open finding. This matches round 1's recommendation and the closure input
package, where task 12.8's scope was widened from one map to three.

### 6. No regression

- **SEC-001's post-loss regression guard still discriminates after F1.** I re-ran my round-1
  latch-disable (`state.transportLost = true` in the `closed`-rejection handler replaced by a
  no-op): the suite stayed 22/22 green - the F2 hardening now covers that path through
  `channelAttributed`, so this single mutation no longer discriminates alone. The property
  itself remains guarded and discriminated: mutation (h) above (which I ran) reds the
  prepared-window guard, and the fixer's (i) reds both "terminal stays unsettled" and "never
  lets a post-loss probe turn a scope we owned into a terminal". Recorded as an observation,
  not a finding: defence-in-depth makes any single-point mutation weaker, which is the
  intended consequence of fixing F2, and the invariant retains discriminating coverage from
  two independent mutations.
- **Suites**: nine deterministic suites (win32 wrapper 22, cutover release 10, darwin
  behavioural 17, darwin live-close 5, darwin release 8, both pin suites 21, both pinned
  capsule suites) - **97 passed | 2 skipped (99)**, the 2 skips being the platform-gated POSIX
  replacement cases. Gated real-capsule suite with `RASEN_WIN32_REAL_CAPSULE=1`: **3 passed**.
- **Static**: `npx tsc --noEmit` exit 0.
- **Hygiene**: `git diff --check 9db76d31..fec34c16` clean; CR scan over the delta's committed
  blobs (change directory, all process-capsule modules, the fake-capsule seam) zero matches;
  `git status --porcelain -- src/ test/` empty after all three of my mutations.

## Findings

None at Blocker or Major. One Trivial, recorded for accuracy rather than action:

### T1 [Trivial] `mutation-receipts.md` still refers to a waiver that was withdrawn

`evidence/mutation-receipts.md` "Later additions" says the fix-round mutations are recorded
"together with one narrow recorded waiver (real-host receipt 7.2b)". Commit `fec34c16`
withdrew that waiver and supplied the mutation, and `fix-round-1.md` says so; the index
paragraph was not updated to match. No claim anywhere else depends on it, and the file it
points to is correct. Fix at whatever next touches that file, or leave - it does not affect
acceptance.

## Overall verdict

**CLEAN.** Round 1's Major (F1) is fixed with both halves of the defect now evidenced and
RC-004's ordering half implemented rather than deferred; both Minors that were in scope (F2,
F3) are fixed with discriminating mutations, two of which I re-ran myself and one of which I
extended with an independent demonstration; F4 is correctly deferred to closure 12.8 and
provably untouched; the pin rebaseline moved exactly one entry with correct lineage and a
digest I recomputed from committed bytes; no regression, and the working tree is byte-identical
after my mutation runs.

**Ship is unblocked from the review side.** The remaining gates are the change's own
non-review tail (validate/ship/archive sequencing), and the one open item this change
knowingly carries forward is F4 -> closure task 12.8. SEC-001's evidence package
(`review-round-1.md` checklist 4, plus this round's confirmation that the invariant retains
discriminating coverage) stands ready for the closure re-review, which owns that finding's
formal close.
