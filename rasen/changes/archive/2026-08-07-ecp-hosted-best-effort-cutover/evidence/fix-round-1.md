# Fix round 1 - ecp-hosted-best-effort-cutover

Role: FIXER (same author as the implementation; the reviewer was independent).
Responds to `evidence/review-round-1.md` (verdict CHANGES_REQUIRED, Major 1,
Minor 3), reviewed tree `50c15be0`, review commit `9db76d31`.

Host: Windows 11 Pro 10.0.26200.8875, Node v24.14.0, vitest 3.2.6.
`dist/cli/index.js` confirmed present before every vitest invocation.

| Finding | Disposition | Commit |
| --- | --- | --- |
| F1 [Major] RC-004 probe parser containment | FIXED + authorized pin rebaseline | `8e48ce45`, `0e86380f` |
| F2 [Minor] D3 terminate-leg hardening | FIXED | `8e48ce45` |
| F3 [Minor] guards without a failing counterpart | FIXED (5 mutations, no waiver) | `708b558c` + this commit |
| F4 [Minor] RC-005 retention shape | DEFERRED to closure 12.8 by review recommendation - recorded, not fixed | this commit |

## F1 - one-shot probe parser containment

`oneShotProbe`'s stdout callback ran `CapsuleFrames.push` with no `try/catch`
while the resident client wraps the identical call and routes failure into typed
`fail()`. This change is what made that path production-reachable (design D4), so
the conditionally-parked RC-004 came due here.

What the fix does (`native-process-scope.ts`):

- contains the callback: a parse throw becomes a typed `ProcessScopeError`
  carrying the `inspect`/`terminate` phase, rejected into the probe deferred;
- rejects every non-observation frame as a typed protocol failure instead of
  ignoring it until the close/timeout deadline (the second half of RC-004's
  original text);
- settles the deferred exactly once, so a duplicate observation cannot re-settle;
- SIGKILLs a probe child that timed out **or broke protocol**, where previously
  only the timeout path killed it - a malfunctioning probe is no longer left
  running.

The wrapper then maps the typed rejection through `uncertainObservationFromError`
/ `uncertainFromError`, so the hosted seam reports retained uncertainty.

### Discriminators (through the existing `fake-process-capsule.ts` probe seam)

Four malformed-probe modes were added to the seam and are asserted in
`win32-best-effort-scope.test.ts`:

| Mode | Shape | Asserted outcome |
| --- | --- | --- |
| `oversized-frame` | header declaring 64 MiB, past the parser bound | typed uncertain on inspect AND terminate; `receiptAuthorizesRelease` false |
| `truncated-observation` | OBSERVATION with a 3-byte payload | same |
| `unknown-frame` | frame kind `0x77` | same |
| `duplicate-observation` | two OBSERVATION frames | first wins (`foreign`), no throw, no re-settle |

### Mutation receipt (g)

Reverting the containment restores the exact pre-fix callback:

```diff
   child.stdout.on('data', (chunk: Buffer) => {
-    if (settled) return;
-    try {
-      for (const item of parser.push(chunk)) { ...typed handling... }
-    } catch (error) {
-      failProbe(error);
-    }
+    for (const item of parser.push(chunk)) {
+      if (item.kind === OBSERVATION && item.payload.length === 1) result.resolve(item.payload[0]);
+      else if (item.kind === ERROR) result.reject(new ProcessScopeError(...));
+    }
   });
```

RED:

```
 FAIL  foreign and stale refs translate conservatively without wedging > survives a malformed probe answer with typed uncertainty instead of crashing
 Error: Test timed out in 30000ms.
      Tests  1 failed | 21 passed (22)
```

GREEN unmutated: 22 passed (22). Reverted byte-exact.

**Honest scope of this receipt.** The observed failure mode under vitest is that
the probe never yields a typed answer, so the call hangs to its deadline and the
test times out; vitest's worker did **not** report an unhandled error, so this
receipt does not independently confirm the "kills the daemon" half of the review's
claim. The review established that half by code reading (a throw escaping an
EventEmitter callback), which stands on its own. The containment is justified by
the observed half regardless: a control path that cannot produce a typed answer
is already fail-open, which is what this tier's whole design forbids.

### Pin rebaseline (LEAD-authorized)

Exactly one entry moved, in both `LEGACY_PROCESS_CAPSULE_INPUTS` lists, with a
lineage comment at each site:

```
src/core/session-host/process-capsule/native-process-scope.ts
0848c77b55d405afdf02b43c797986cb15193cca453b61fa7aa03d07209588fa
->
a070733cc338730258f5725c962c70f2284ead3601a2bc49b24c5c5d75211977
```

Digest taken from the COMMITTED bytes of the fix commit
(`git show 8e48ce45:<path> | sha256sum`), and the working-tree hash was checked
to equal it - the guard reads the working tree, so the two must agree or an
autocrlf divergence would hide behind a green run. All other digests recomputed
from the pin commit and byte-identical: Rust crate, `Cargo.lock`, build script,
`resolver.ts`, both pinned capsule test files, and both `FROZEN_COMMON_INPUTS`
entries. Both pin suites: 21 passed (21).

The reviewer's `decision13-regrade.md` RC-004 entry is deliberately NOT edited -
the re-review owns that update, per the review's own instruction.

## F2 - D3 terminate-leg hardening

Two structural gaps, both currently unreachable through the host but real:

1. `translateTermination` never re-checked `state.transportLost` after its await,
   so a channel dying mid-cancel could still mint a terminal.
2. The latch was armed only inside `activate()`, so a controller dying during the
   prepared window never armed it.

Fixes in `win32-best-effort-scope.ts`:

- the latch is re-checked **after** the await;
- minting additionally requires the answer to be attributable to this daemon's
  own resident channel. This is the crux: the capsule answers `closed` from both
  the resident channel and the one-shot probe. `inspect` can tell them apart
  structurally (a resident channel never answers `closed`), but `terminate`
  cannot, so the call site states it - `abort` is attributable by construction
  (a dead channel throws rather than answering), and `terminate` reads the
  capsule's `gracefulAttempted` flag, which only its resident leg sets
  (`native-process-scope.ts:511` vs `:385`);
- `armTransportLostFromError` latches the scope from any typed control failure
  seen during the prepared window, where no live `closed` promise exists yet.

New guard: "never mints a terminal after the controller dies during the prepared
window" - prepare, kill the controller, then terminate; the probe reports the Job
gone and the wrapper must still answer retained uncertainty rather than
`never-activated`.

### Mutation receipt (h)

```diff
-    if (state.transportLost || !channelAttributed) return LOST_CONTROL_RECEIPT;
+    if (state.transportLost) return LOST_CONTROL_RECEIPT;
```

RED: `FAIL ... never mints a terminal after the controller dies during the
prepared window`, 1 failed | 21 passed (22). GREEN unmutated 22/22.

## F3 - the four guards that lacked a failing counterpart

Three supplied by mutation; one narrowly waived with justification.

### (i) "leaves the hosted terminal unsettled after transport loss"

Mutation: the live `closed` rejection handler settles a terminal instead of
arming the latch.

```
 FAIL  transport and controller loss are retained uncertainty, never a terminal > leaves the hosted terminal unsettled after transport loss
 FAIL  transport and controller loss are retained uncertainty, never a terminal > never lets a post-loss probe turn a scope we owned into a terminal
      Tests  2 failed | 20 passed (22)
```

Both are the same latch, so both fire - the guard the review named is now
demonstrably discriminating.

### (j) cutover suite's API-projection guard

Mutation in `contracts.ts`: the projection stops carrying `processDeclaration`.

```
 FAIL  the win32 declaration is visible before the workload starts > records the limits and projects them to the API before the workload is activated
      Tests  1 failed | 9 passed (10)
```

### (k) cutover suite's activation-gate guard

Mutation in `host.ts`: the "declaration did not land" gate stops refusing.

```
 FAIL  the win32 declaration is visible before the workload starts > fails activation typed and runs no workload when the declaration cannot be recorded
      Tests  1 failed | 9 passed (10)
```

### (a-real) win32 real-host receipt 7.1

The review noted the Linux real-kernel suite re-ran its mutation on the real
kernel while the win32 real suite did not. Mutation (a) (wrapper forges a
clean-cancel receipt) was therefore re-run against the **real capsule on this
host**:

```
$ RASEN_WIN32_REAL_CAPSULE=1 npx vitest run test/core/session-host/win32-real-capsule-receipts.test.ts
 FAIL  win32 real-capsule receipts on this host > 7.1 cancels a real Job-backed workload and records cancelled / emptiness-unproven
      Tests  1 failed | 2 passed (3)
```

Unmutated: 3 passed (3). The real-host suite is now demonstrably capable of
failing against a dishonest wrapper, not only against the organic first-run
failure of 7.3.

### (m-real) win32 real-host receipt 7.2b

An earlier draft of this file waived 7.2b with a justification. The waiver is
**withdrawn**: the LEAD's fix dispatch required a mutation counterpart for 7.2b
as well as 7.1, so one was supplied rather than argued around.

Mutation: a ref from a previous daemon lifetime is adopted as a live,
controllable scope - the reattach this tier forbids outright.

```diff
-      if (observation.controllable) return observation;
-      if (observation.state === 'foreign' || observation.state === 'uncertain') {
-        return observation;
-      }
-      if (observation.state === 'declared-unproven') return observation;
+      return { state: 'live', controllable: true };
```

RED against the REAL packaged capsule on this host:

```
$ RASEN_WIN32_REAL_CAPSULE=1 npx vitest run test/core/session-host/win32-real-capsule-receipts.test.ts
   ✓ 7.1 cancels a real Job-backed workload and records cancelled / emptiness-unproven  2219ms
   ✓ 7.3 reports controller loss as retained uncertainty, not a clean detach  2158ms
 FAIL  7.2b reports a ref from a dead daemon honestly and never reattaches
      Tests  1 failed | 2 passed (3)
```

Precise: 7.2b alone fails while 7.1 and 7.3 stay green, so the RED is
attributable to the reattach property specifically rather than to a broad
breakage. Unmutated: 3 passed (3). Reverted byte-exact;
`git diff --numstat -- src/ test/` empty.

With (a-real) and (m-real) both landed, every property the win32 real-host suite
guards has a demonstrated failing counterpart, and no waiver remains in this
change.

## F4 - RC-005 retention shape (DEFERRED, recorded only)

Both tier modules keep a per-ref map that is never pruned:
`posix-best-effort-scope.ts` `scopes` and `win32-best-effort-scope.ts` `scopes`.
Terminal replay is deliberate (a re-terminate must replay the same terminal
rather than re-signalling), but a long-lived daemon accumulates one entry per
session for its whole lifetime - the same shape RC-005 recorded against the
legacy `clients` map.

Not fixed here, per the review's own recommendation: one lifecycle rule should
cover all three maps, and that rule belongs to closure task 12.8. Fixing two of
the three maps here would leave the third and pre-empt the design of a rule this
change does not own. Carried forward in `handoff/implementer-1.md`.

## Verification after the fix round

```
$ npx tsc --noEmit            -> exit 0
$ npx eslint <changed paths>  -> clean

$ npx vitest run <eight guard + regression suites>
 Test Files  8 passed (8)
      Tests  80 passed | 2 skipped (82)

$ npx vitest run <both pin suites>
 Test Files  2 passed (2)
      Tests  21 passed (21)

$ RASEN_WIN32_REAL_CAPSULE=1 npx vitest run <real capsule suite>
      Tests  3 passed (3)
```

Every mutation in this round was applied and reverted with byte-exact
backup/restore, never `git checkout --` (which rewrites the working tree as CRLF
under this repo's `core.autocrlf=true` and makes the next LF anchor silently
miss).
