# Non-author re-review, round 2 - fix delta 254e2ad9

Reviewer: the round-1 non-author reviewer, 2026-08-07. Scope: the fix delta
only; the round-1 report (`review-report.md`) stands unchanged. Written as a
separate file rather than an append so the round boundary is unambiguous.

Ran: the three darwin suites + `claude-backend.test.ts` + the HTTP projection
guard (5 files, 41/41 green), `npx tsc --noEmit -p tsconfig.json` (clean,
exit 0), byte checks on every blob the commit added or edited (all LF, no
trailing whitespace), and `git show` verification that the two round-1 suites
were committed byte-identical to the versions round 1 reviewed. No source
edited; this file is the round's only write. No full build.

## Per-finding verdicts

| Round-1 finding | Verdict |
| --- | --- |
| Major-1 (live-close route drops the terminal) | **RESOLVED.** Three routes wired: `terminate` carries `receipt.unproven` (`claude-backend.ts:339-347`), `closeLive` stages (`host.ts:631`), `observeTransportClose` writes inline in the same CAS that clears the facts (`host.ts:743`, `:766-768`). Guarded behaviourally end-to-end (real darwin provider, real backend, real host, real file-backed registry; only spawn and group control are stand-ins). |
| Major-2 (wire projection drops both fields) | **RESOLVED in code; delivery incomplete - see R2-1.** `hosted-sessions.ts:31-33` projects both fields, `SessionRecordWire` declares them, and the guard reads a real management server over HTTP. But the guard file itself is not in the commit. |
| Major-3 (dispatch flush unguarded) | **RESOLVED, and the fixer's correction to my count is right.** Two points was correct for the code as reviewed; staging on the live-close route (the Major-1 fix) creates a third drain at the end of `shutdown()` that neither dispatch nor reconcile would ever flush. All three exist (`host.ts:1318`, `:1426`, `:1506`) and each has its own guard and mutation (M4/M6/M5). M4 reproduces my round-1 diagnosis exactly: the old release suite stays entirely green while the new suite goes red. |
| Minor-1 (terminal lost on CAS exhaustion) | **RESOLVED.** Delete-only-after-write, retry on contention, prune only on `session-not-found` (`host.ts:672-696`). The guard is precisely my round-1 falsifier, built so contention hits only the flush's own write. The *silence* is honestly reported as not closed - accepted. |
| Minor-2 (never-activated releases persist no terminal) | **NOT FIXED - disposition accepted.** The follow-up recommendation is right; add R2-2 below to the same follow-up, since it is the same shape on a path where the workload DID run. |
| Minor-3 (guard concurrency evasion) | **NOT FIXED - accepted**, as I classified it: guard-robustness note, not a code defect. |
| Minor-4 (daemon-death sessions unretirable) | **NOT FIXED - accepted**, correctly flagged for task 7.5 and the executor rather than redesigned mid-round. |
| Trivial-1/2/3 | **NOT FIXED - accepted.** |

Nothing in the delta regressed the four honesty conditions: the exact tier
resolves `undefined` from `closed` exactly as before (`claude-backend.ts:410`,
and the pre-existing guard that caught the `{}` regression is green), the
undeclared byte-identity test passes, the limit flags gained no new writer
(`tsc` clean against the literal-`false` types), and the terminal vocabulary
is unchanged - the delta only carries it further.

## New findings (round 2)

### R2-1 (Major, delivery): the Major-2 guard is not in the commit

`test/core/management-api/hosted-session-honesty-projection.test.ts` is
untracked (`git status` reports `??`; `git log` for the path is empty). The
commit ships the Major-2 production fix (`hosted-sessions.ts`,
`wire-types.ts`) and its commit message cites this guard's results as
evidence, but the guard itself is only on disk. On a fresh checkout or in CI
at this commit, the wire projection is unguarded and receipts M8/M9 reference
a test git does not have. The test exists, runs, and passes (verified);
one `git add` closes this. Until then, 4.3's receipt is not durable.

### R2-2 (Minor): the ownership-bind-failed close drops the terminal

`openTransport`'s catch path calls `transport.terminate('ownership-bind-failed')`
directly (`host.ts:547`) and reads only `.closed`; `termination.unproven` is
discarded. A declared session whose workload activated but whose ownership
bind then failed releases with no terminal on the record. Same family as
disposed Minor-2, but here the workload ran. Rare path; fold into the same
follow-up.

### R2-3 (Minor): the closedState early-return can lose a completion terminal

`ClaudeResidentTransport.terminate` returns `{ closed: true }` without
`unproven` when `closedState` is already set (`claude-backend.ts:331`), even
when `this.scopeTerminal` holds the completion terminal. Window: natural
completion resolves `closed` (setting `closedState`), and a cancel dispatch
reaches `closeLive` - setting `live.closing` - before `observeTransportClose`'s
first check runs; observe then early-returns and terminate reports no
terminal, so `completed / emptiness-unproven` is never persisted. The window
is microtask-narrow (observe is a `.then` continuation of the same promise),
and I could not construct it under the real dispatch path without artificial
scheduling - hence Minor, not Major. One-line hardening: spread
`...(this.scopeTerminal ? { unproven: this.scopeTerminal } : {})` into the
early return.

### R2-4 (Trivial): a permanently unwritable staged terminal retries forever

`flushProcessTerminals` prunes only on `session-not-found`; any other
persistent failure (e.g. a validation reject) keeps the entry staged and
silently retried once per flush for the daemon lifetime (`host.ts:684-694`).
Bounded by sessions-per-lifetime and adjacent to the acknowledged
silence-not-closed disposition; recorded for completeness.

## M10: the unreachability claim HOLDS

Verified, not accepted. For the gate at `host.ts:766` to matter, a
declared-unproven `terminal` must arrive while `current.process` exists
WITHOUT its declaration. Chasing every writer: a non-undefined `terminal`
requires a darwin (declared) transport; for that transport to exist,
`openTransport` demanded the declaration on the written record before
activation and aborts typed if it did not land (`host.ts:471-483` - honesty
condition 1); the ONLY writer of `process` facts is `openTransport` itself
(`host.ts:448-464`), which always writes the declaration when the prepared
scope carries one; every other mutation clears the WHOLE `process` object,
which also breaks `observeTransportClose`'s ownerToken/runtimeRef match
(`host.ts:747-758`) so the mutation never reaches the gate. No in-process
path produces the guarded state. It is reachable only by out-of-process
registry-file tampering (the field is optional at parse), where refusing the
write - fail-closed - is the correct behaviour anyway. Verdict: genuine
defence-in-depth over a state unreachable by construction; the negative
receipt is the honest way to report it; the gate is NOT load-bearing and its
lack of a discriminating test is NOT a finding. Publishing a green-suite
mutation as a negative receipt is the right precedent.

## The ten mutations: all ten accepted

- **M1** (terminate discards `unproven`) - SOUND. Fails cancel, shutdown, and
  contended-flush; natural completion survives on the closure path.
- **M2** (closeLive does not stage) - SOUND. Same three, one layer up; either
  layer alone breaks the chain, so the two receipts are distinct.
- **M3** (observe drops the terminal) - SOUND. Exactly the natural-completion
  guard and nothing else.
- **M4** (delete dispatch flush) - SOUND, and it is the receipt my round-1
  Major-3 demanded: 2 failed in the new suite, the old release suite entirely
  green - my diagnosis reproduced verbatim.
- **M5** (delete shutdown flush) - SOUND. Exactly the shutdown guard.
- **M6** (delete reconcile flush) - SOUND. Exactly the two release-suite tests
  that assert a persisted terminal.
- **M7** (delete-before-write + swallow restored) - SOUND. Exactly the
  contended-flush guard, which is my round-1 falsifier implemented faithfully.
- **M8/M9** (drop each wire spread) - SOUND, each failing on its own field at
  the HTTP surface. Caveat R2-1: the guard they falsify is uncommitted.
- **M10** - accepted AS A NEGATIVE RECEIPT; see above.

**The M1/M3 row-count split: the inference holds, and mechanically, not
statistically.** Cancel terminals travel terminate -> closeLive -> staging ->
flush; completion terminals travel `closed` -> closure -> observe-inline. The
two cannot mask each other: during a cancel `live.closing` is set before
`terminate` is awaited, so `observeTransportClose` early-returns and cannot
rescue a broken terminate path - which is why M1's failures are real; and
`terminate` is never invoked on natural completion. Disjoint failure sets
from mutations at two different code sites is what independent wiring means.
The duller explanation (the split merely mirrors how many tests use each
route) explains the counts but not the disjointness.

## Ticks 4.2 / 4.3

**4.2: the work landed.** The live-close route exists at three points, each
behaviourally guarded with a sound mutation. The tick now stands on code.

**4.3: the work landed in code; its receipt has not landed in git** (R2-1).
The projection exists, the HTTP guard exists and passes, M8/M9 discriminate -
but the guard file is untracked, so the commit that claims the receipt does
not contain it. I would not call 4.3 closed until
`hosted-session-honesty-projection.test.ts` is committed. One command.

## The counter-example method note: I agree it is genuine

The pre-existing guard `claude-backend.test.ts > turns a child error/early
close into one typed active-turn failure` went RED against the fix's first
version (`{}` resolved from `closed` instead of `undefined`), and the fix was
corrected rather than the test. That is an unmutated guard demonstrating
discrimination empirically - a true positive in the wild, which is the
strongest receipt there is. It does not overturn the working premise; it
sharpens its wording: an unmutated guard's discrimination is UNKNOWN, not
absent, and a wild catch converts unknown to known without any injected
mutation. Logged as a genuine counter-example instance.

## What I could not verify

- The fixer's mutation runs by re-injection (report-only; verdicts are
  analytic against the guards I read and ran green, with quoted totals
  consistent with the suite sizes I reproduced: 16/8/5/1).
- The full `test/core/session-host/` + `test/core/management-api/` runs this
  round; I ran the five affected files (41/41) and rely on the fixer's
  directory totals, which match the expected shape including the known
  `beeee1b8` native-freeze failure (out of scope per the LEAD, not graded).
- Real macOS behaviour of the new wiring - Section 7 remains the gate;
  notably the new live-cancel guard is the deterministic analogue of 7.3,
  which materially de-risks that receipt.
