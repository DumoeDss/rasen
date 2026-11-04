# Fix round 1 - ecp-macos-process-authority-provider

Fixer: non-author, non-reviewer, 2026-08-07. Source of every item is
`evidence/review-report.md`. No full build was run; `dist/` was not touched.
Nothing was committed and no `.rasen/**` file was written.

## The root cause was one thing, not three

`BackendTermination` (`src/core/session-host/backend.ts`) was
`{ closed: boolean; cancelledBeforeWork: boolean }` - a boolean-only shape and
therefore a structural information sink. `ProcessScope` produced a full
`DeclaredUnprovenReceipt`; `ClaudeResidentTransport.terminate` collapsed it to
one bit; the host could not persist what it never received. Every live-path
symptom in Major-1 follows from that single narrowing, so the type was widened
first and the symptoms were then wired, not papered over.

Widening, in two parts:

1. `BackendTermination.unproven?: DeclaredUnprovenReceipt` - the terminal a
   close produced, carried instead of collapsed. The release *decision* stays
   the boolean (`receiptAuthorizesRelease` still runs in the backend); the
   *terminal* is now reported alongside it, and the host applies its own gate.
2. `BackendClosure` + `backendClosureTerminal(value: unknown)` - the value a
   transport's `closed` promise may carry, plus the one narrowing function that
   reads it. This is what makes **natural completion** reach the Record, not
   only cancel.

The seam type `AgentSessionTransport.closed` deliberately stays
`Promise<unknown>`. Roughly fifteen test doubles across `test/core/session-host/`
and `test/core/management-api/` resolve `Promise<void>`; narrowing the seam type
would have forced churn on all of them for no behavioural gain, and
`backendClosureTerminal` gives typed narrowing at the single place that reads it.

What the widening made possible: the host can now stage or write the honest
terminal from **every** close route (live cancel, natural completion, retire,
restart-failure, shutdown), not only from `closeDurableProcess`.

## Major-1: the live-close route now persists the declared-unproven terminal

Three routes were dropping it. All three are wired:

| Route | Change |
| --- | --- |
| `ClaudeResidentTransport.terminate` (`claude-backend.ts`) | passes `receipt.unproven` through instead of discarding it |
| `closeLive` (`host.ts`) | stages `noteProcessTerminal` when the close was authorised and carried a terminal |
| `observeTransportClose` (`host.ts`) | writes the terminal **inline** in the CAS mutation that clears the process facts |

`observeTransportClose` writes inline rather than staging on purpose: it runs
off the transport's own close promise, outside any dispatch, so a staged
terminal there would wait for a flush that no dispatch will run. Writing it in
the same mutation that clears `process` also makes the two atomic.

`closeLive` stages, because its callers (`cancel`, `retire`, `restart`, the
open-drain, `shutdown`) each perform their own generation/revision CAS
afterwards - the same reason `closeDurableProcess` stages.

Guards (all behavioural, in `test/core/session-host/darwin-live-close-terminal.test.ts`).
The harness drives the **real** darwin provider over a fake spawn and fake group
control, through the real claude backend, the real host and a real file-backed
registry; only the leader process and the group probe are stand-ins.

- `records cancelled / emptiness-unproven when a RUNNING declared session is cancelled` -
  the production-normal case, and the deterministic analogue of task 7.3.
- `records completed / emptiness-unproven when a declared session ends naturally`
- `records the terminal when the daemon shuts down over a live declared session`
- `leaves an undeclared live scope byte-identical: released, with no terminal`

Mutation receipts:

- **(M1) backend termination discards `receipt.unproven`** - restores the exact
  defect the reviewer named. RED: `3 failed | 2 passed (5)`; the cancel,
  shutdown and contended-flush guards fail, natural completion survives because
  it travels the `closed` promise rather than `terminate`. That split is itself
  evidence the two paths are independently wired.
- **(M2) `closeLive` does not stage** - RED: `3 failed | 2 passed (5)`, the same
  three.
- **(M3) `observeTransportClose` drops the terminal** - RED: `1 failed |
  4 passed (5)`, exactly the natural-completion guard and nothing else.

## Major-2: the operator surface carries both fields

`hostedSessionToWire` (`src/core/management-api/hosted-sessions.ts`) now projects
`processDeclaration` and `processTerminal`, and `SessionRecordWire`
(`src/core/management-api/wire-types.ts`) declares them.

Guard: `test/core/management-api/hosted-session-honesty-projection.test.ts`
starts a **real management server** over a seeded registry and reads
`GET /api/v1/sessions` and `GET /api/v1/sessions/:id` over HTTP - the actual
remote operator surface, not the projection function in isolation.

It asserts against two records because the two fields are never simultaneously
readable: the declaration lives under `record.process`, which release clears,
and the terminal is written as those facts go away. That is a property of the
record shape, not of the projection.

Mutation receipts:

- **(M8) drop the `processTerminal` spread** - RED, `expected undefined to match
  object { outcome: 'cancelled', ... }`.
- **(M9) drop the `processDeclaration` spread** - RED, `expected undefined to
  deeply equal { tier: 'best-effort', ... }`.

## Major-3: every flush point now has its own guard

The reviewer named two wiring points. After the Major-1 fix there are **three** -
`shutdown()` drains live transports and stages terminals that no dispatch and no
reconcile will ever flush, because `pendingTerminals` is in-memory and the daemon
is leaving. That third point was added and guarded rather than left implicit.

| Flush point | Guard | Mutation | Result |
| --- | --- | --- | --- |
| `dispatch` `finally` | `records cancelled ... when a RUNNING declared session is cancelled` | **(M4)** delete the call | RED `2 failed \| 11 passed (13)` |
| end of `reconcileOnStart` | the four pre-existing tests in `darwin-declaration-gated-release.test.ts` | **(M6)** delete the call | RED `2 failed \| 11 passed (13)` |
| end of `shutdown` | `records the terminal when the daemon shuts down over a live declared session` | **(M5)** delete the call | RED `1 failed \| 12 passed (13)` |

M4 is the receipt the review asked for, and it reproduces the reviewer's
diagnosis exactly: with the dispatch-`finally` flush deleted,
`darwin-declaration-gated-release.test.ts` stays **entirely green** - the old
suite cannot see this defect - while the new live-close suite goes red.

## Minor-1: a staged terminal is no longer lost on CAS exhaustion

`flushProcessTerminals` deleted the staged entry *before* attempting the write
and swallowed the failure, so four exhausted CAS attempts destroyed the terminal
permanently and silently. Now the entry is deleted only after the write lands;
a contended or failing write keeps it staged for the next flush. The single
exception is `session-not-found`, where no later flush could ever succeed.

Guard: `keeps the terminal pending on CAS exhaustion and persists it on a later
flush`. The fixture contends **only the flush's own write** (it classifies a
pending mutation by applying it to a clone and rejecting it if it would set
`processTerminal`), so every other lifecycle write proceeds and the terminal
really is staged before contention starts. This is the reviewer's falsifier.

Mutation **(M7)**: restore delete-before-write plus `.catch(() => undefined)` -
RED, `1 failed | 4 passed (5)`.

Not closed: the *silence*. There is no logger at this seam, so an exhausted
flush still emits no diagnostic - it now merely retries instead of losing data.
Retained entries are bounded by sessions-per-daemon-lifetime.

## Ticks 4.2 and 4.3

Both were overclaims when the review was written: 4.2 names "the live-close
route" and 4.3 names "its API projection", and neither existed. Per the two
options offered, the second was taken - **the fix lands the work and the receipt
is re-taken** - so the ticks now stand on code that exists:

- 4.2's live-close half: `closeLive` + `observeTransportClose`, guarded by M1/M2/M3.
- 4.3's API projection: `hostedSessionToWire`, guarded by M8/M9.

Task text is unchanged because it is now accurate. Section 7 and 8.4 remain
open; this change is still honestly non-terminal awaiting a real macOS host.

## An honest negative receipt

`observeTransportClose` gates the terminal write on `current.process?.declaration`,
mirroring `closeDurableProcess`. **Mutation (M10)** removes that gate
(`if (terminal && current.process?.declaration)` to `if (terminal)`) and the
whole `test/core/session-host/` directory stays at baseline - `1 failed |
611 passed | 7 skipped (619)`, that one failure being the unrelated native
digest freeze below. The gate is therefore **not discriminated by any test**.

That is not a missing guard, it is an unreachable state: a declared scope whose
record lost its declaration cannot activate at all - `openTransport` aborts the
scope and throws typed `authority-persist-failed` before activation, which is
condition 1 of the change's own honesty conditions. The gate is defence in depth
over a state unreachable by construction, and is reported as such rather than
dressed up with a receipt.

## Dispositions - findings deliberately not fixed

- **Minor-2** (never-activated abort releases persist no terminal;
  `host.ts` prepared-abort sites). NOT FIXED. Accurate against the spec letter,
  but all three sites release a scope where no workload ever ran and the
  `never-activated` receipt is minted locally rather than observed. Wiring it
  would mean staging a terminal on paths that have no durable close CAS of their
  own, widening the blast radius past the live-path defect this round targets.
  Recommend a dedicated follow-up, or an explicit spec carve-out for
  `never-activated`.
- **Minor-3** (declaration-before-spawn guard has a concurrency evasion). NOT
  FIXED. The reviewer states it is a guard-robustness note and not a code
  defect; the shipped host is strictly sequential. Confirmed unchanged by this
  round.
- **Minor-4** (a darwin session lost to daemon death is unretirable forever).
  NOT FIXED, and deliberately not redesigned. This is a **pre-existing host
  rule** - a foreign observation returns `live-or-uncertain`, so `retire` and
  `restart` fail `session-busy` permanently - that this tier's no-reattach
  posture merely makes certain rather than merely possible. **Flagged for task
  7.5 and for the executor**: on a real macOS host, a retire attempted after the
  daemon-death restart will fail `session-busy` and that is the current design,
  not a regression to fix in the moment.
- **Trivial-1** (darwin branch drops `NativeProcessScopeOptions`). NOT FIXED -
  in `process-capsule/hosted-process-scope.ts`, adjacent to files owned by a
  concurrent worker; no production site passes options today.
- **Trivial-2** (scope map entries retained for the daemon lifetime). NOT FIXED -
  matches the native capsule's pattern and terminal `inspect` needs the entry.
- **Trivial-3** (`watchNaturalCompletion` polls with non-unref'd timers). NOT
  FIXED - the non-unref choice is deliberate and documented; the observer loop
  inherits it. Worth a bound, but it is provider behaviour, not honesty-path.

## What the review missed or got slightly wrong

1. **Major-3 undercounts the wiring points, post-fix.** Two points were correct
   for the code as reviewed. The moment the live-close route stages terminals -
   which is the Major-1 fix - `shutdown()` becomes a third unflushed drain. Added
   and guarded (M5).
2. **A pre-existing guard did discriminate a byte-identity regression in this
   fix.** The first version resolved `{}` from `ClaudeResidentTransport.closed`
   instead of `undefined`, and
   `claude-backend.test.ts > turns a child error/early close into one typed
   active-turn failure` went red with `expected {} to be undefined`. The exact
   tier now resolves `undefined` exactly as before. Worth recording against the
   change's working premise: an unmutated guard is *usually* non-discriminating,
   but this one caught a real exact-tier behaviour change on its first run.
3. **Major-2's repo-wide sweep has a caveat the review did not reach.** The UI
   mirror of `SessionRecordWire` (`packages/ui/src/api/types.ts`) has **already**
   drifted from the server wire type for the *entire* hosted-session family - it
   lacks `kind: 'hosted'`, `hostState`, `backend`, `backendSessionId`,
   `generation`, `currentRequest`, `recoveryReason`, `retirementReason` and the
   `'retired'`/`'host-failed'` termination reasons. Adding only the two honesty
   fields there would be incoherent, so the mirror was deliberately left alone.
   Pre-existing drift, out of this change's scope, flagged for whoever owns the
   hosted-sessions UI surface.
4. **`hosted-sessions.ts` is untracked in this worktree** (`git status` reports
   `??`), which settles the review's open question: it is a new file on this
   branch, not a file belonging to the concurrent workstream.
5. **`wire-types.ts` is whole-file CRLF in the working tree while HEAD is LF** -
   the same pre-existing condition the review correctly reported for
   `router.ts`, and from the same cause (another workstream's uncommitted
   edits). It was **not** normalised. The four added lines match the file's
   current CRLF convention, so no mixed line endings were introduced; a byte
   scan shows zero bare LFs. `git diff --check` is clean.

## Verification, as run

- `npx tsc --noEmit -p tsconfig.json` - clean, including against the eight-element
  `RECURSIVE_PROCESS_SCOPE_SEMANTICS` landed by `e31d297d`. No file under
  `process-authority/`, `native/` or the build scripts was touched.
- `test/core/session-host/` - **48 files, 611 passed, 7 skipped, 1 failed.**
  The single failure is
  `windows-process-authority-package-ci.test.ts > leaves the frozen Linux native
  tree at its recorded source digest`, which hashes
  `native/linux-process-authority/{Cargo.lock,Cargo.toml,THIRD_PARTY.md}`. This
  change touches no file under `native/`, and HEAD is `beeee1b8 wip(ecp7):
  preserve interrupted native work -- BOTH FREEZES ARE BROKEN`. Not attributable
  to this round; owned by the concurrent native workstream.
- `test/core/management-api/` - **43 files, 515 passed, 1 skipped, 0 failed.**
- Ten mutations run; each restored byte-identically from an in-memory copy and
  verified equal after restore.
- Whitespace gate verified **on bytes** for every file this round added or
  edited: no trailing whitespace, final newline present, no trailing blank line
  at EOF, no BOM. `wire-types.ts` CRLF is pre-existing and untouched, as above.
- `node bin/rasen.js validate ecp-macos-process-authority-provider --strict` -
  green.
