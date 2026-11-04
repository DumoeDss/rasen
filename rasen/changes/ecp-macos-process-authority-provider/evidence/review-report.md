# Non-author verify review - ecp-macos-process-authority-provider

Reviewer: non-author, 2026-08-07. Read the full change directory and the code.
Ran: the two new suites (24/24 green), the full `test/core/session-host/`
directory (46 files, 606 passed, 7 platform-skipped, 0 failed), and
`rasen validate ecp-macos-process-authority-provider --strict` (green,
re-verified independently). No source, test, or task file was edited; this
report is the only file written. No full build was run.

## Verdict summary

The four honesty conditions HOLD in the code that exists. All nine mutation
receipts are SOUND. The change is honestly non-terminal. The defects found are
not in what was built but in what the ticked ledger claims was built: the
live-transport close route never persists the honest terminal (Major-1), the
management-API wire projection drops both new fields (Major-2), and the
dispatch half of the CAS fix has no guard at all (Major-3). Task 7.3 as
written would fail against the current code - see Major-1.

## Findings

### Major-1: The live-close route never persists the declared-unproven terminal

`noteProcessTerminal` is called from exactly two places, both inside
`closeDurableProcess` (`src/core/session-host/host.ts:690`, `host.ts:696`).
That function serves only the no-live-transport routes (stale cancel
`host.ts:1024`, restart `host.ts:1119`, retire `host.ts:1194`, reconcile
`host.ts:1299`). The live-transport routes persist nothing:

- `ClaudeResidentTransport.terminate` (`src/core/session-host/claude-backend.ts:318-333`)
  receives the full declared-unproven receipt and discards `receipt.unproven`
  into a boolean - `BackendTermination` is `{closed, cancelledBeforeWork}`
  (`src/core/session-host/backend.ts:26-29`). The terminal cannot reach the
  host from this seam.
- The live-cancel path (`host.ts:1096-1105`) clears `current.process` and marks
  the request ambiguous; no `processTerminal` is written.
- `observeTransportClose` (`host.ts:723-745`) likewise clears `process` with no
  terminal, so natural completion of a live darwin session drops
  `completed / emptiness-unproven` too.

Consequence: cancelling a RUNNING macOS hosted session - the production-normal
case, and exactly the receipt task 7.3 demands ("capture the Record showing the
pre-start declaration and the `cancelled / emptiness-unproven` terminal") -
releases correctly but leaves no `processTerminal` on the record. The release
RULE is wired on this route (`receiptAuthorizesRelease` at
`claude-backend.ts:330`); the record-honesty half of tasks 4.2/4.3 is not,
although both are ticked. The record does not lie (the request goes
`ambiguous`, recovery reason `cancelled-outcome-unknown`); it fails to carry
the promised terminal. Falsifier: open a live darwin-tier session, cancel via
`dispatch`, assert `registry.get(sessionId).processTerminal` - fails today.
Task 7.3 on a real macOS host is the acceptance-path falsifier.

### Major-2: The management-API wire projection drops both new fields

`hostedSessionToWire` (`src/core/management-api/hosted-sessions.ts:9-32`)
projects `SessionHostView` to the wire record and includes neither
`processDeclaration` nor `processTerminal`. The view carries them
(`src/core/session-host/contracts.ts:427-430`) and `host.inspect` surfaces
them, but the HTTP surface - the only remote operator surface - never does.
Task 4.3 says "on the hosted-session record and its API projection so an
operator reading the Record sees `cancelled / emptiness-unproven`". Repo-wide
sweep: `processTerminal`/`processDeclaration` appear nowhere outside
`session-host/` and the two new test files. Caveat: `hosted-sessions.ts` may
belong to the concurrent workstream; the gap stands either way. Falsifier: GET
the hosted session over the management API after a declared-unproven release;
the response carries no terminal and no declaration.

### Major-3: The dispatch half of the CAS fix is unguarded

`flushProcessTerminals` is wired at `host.ts:1280` (dispatch `finally`) and
`host.ts:1388` (end of `reconcileOnStart`, before `ready = true`). Every
deterministic release test drives the reconcile flush only (all four tests in
`test/core/session-host/darwin-declaration-gated-release.test.ts` call
`reconcileOnStart`); `processTerminal` appears in no other test. Deleting
`await flushProcessTerminals()` from the dispatch `finally` leaves the entire
suite green while silently un-persisting terminals for every dispatch-routed
close in a live daemon (`pendingTerminals` is in-memory; after a daemon
restart the scope is foreign and the terminal cannot be re-derived). On this
change's own working premise - an unmutated guard is non-discriminating - the
dispatch wiring of the fix under review has no guard. No receipt claims one;
this is an uncovered critical line, not a false receipt.

### Minor-1: flushProcessTerminals drops a terminal silently on persistent CAS failure

`host.ts:662-669`: the `pendingTerminals` entry is deleted BEFORE the write
attempt, and `updateLatest(...).catch(() => undefined)` swallows exhaustion of
the four CAS attempts (`session-busy`) - the terminal is then lost permanently
and silently. This is a narrow re-instance of the failure class the CAS fix
exists to kill (a silently missing state transition). Deleting the entry only
after a successful write would close it. Falsifier: a registry that throws
`stale-generation` four times during flush; the record ends released with no
terminal and no diagnostic.

### Minor-2: Never-activated abort releases persist no terminal

`host.ts:488`, `host.ts:571`, and `host.ts:1408` release prepared declared
scopes from a `declared-unproven` (`never-activated`) abort receipt via
`receiptAuthorizesRelease` without staging a terminal; on the `host.ts:571`
path the already-written process facts are then cleared (`host.ts:588-594`),
leaving no trace. Spec letter: "The released session's record SHALL keep the
unproven terminal state permanently." Low stakes - no workload ran, nothing
lies - but the requirement text covers this receipt shape.

### Minor-3: The declaration-before-spawn guard has a concurrency evasion

`test/core/session-host/darwin-declaration-gated-release.test.ts:327-369`
discriminates against both realistic reorderings: dropping the declaration
from the record write (mutation (f), RED), and moving the record write after
`await activate()` (the gate deadlocks activation, the 2s poll expires,
`beforeActivation.process` is undefined, RED). Evasion: a host that initiated
activation fire-and-forget BEFORE the record write would still pass, because
the test gate holds the spawn that production would perform immediately. The
shipped host is strictly sequential (`registry.update` at `host.ts:446`
resolves before `prepared.activate()` at `host.ts:499`), so this is a
guard-robustness note, not a code defect.

### Minor-4: A darwin session lost to daemon death is unretirable forever

Pre-existing rule (unchanged by this change): a foreign observation returns
`live-or-uncertain` (`host.ts:685-687`), so `retire` (`host.ts:1194`) and
`restart` (`host.ts:1119`) fail `session-busy` permanently for a record whose
scope died with the daemon - and on this tier that is the CERTAIN outcome of
daemon death with a live workload, because no reattach ever exists (D7).
Design goal "without wedging the session" holds only for in-lifetime
terminals. Shared with the exact tier's foreign handling; surfaced because the
declared daemon-death posture makes it structural here. Task 7.5 will meet it
on a real macOS host if retire is attempted after the restart.

### Trivial-1: darwin branch silently drops NativeProcessScopeOptions

`src/core/session-host/process-capsule/hosted-process-scope.ts:20-22`: on
darwin the `nativeOptions` rest is discarded. All three production sites pass
no options today; a future caller's options would be silently ignored on
darwin only.

### Trivial-2: Scope map entries are retained for the daemon lifetime

`darwin-best-effort-scope.ts:169`: terminal scopes stay in `scopes` forever.
Matches the native capsule's pattern (neither deletes) and terminal inspect
needs the entry; growth is bounded by sessions-per-daemon-lifetime.

### Trivial-3: watchNaturalCompletion polls unbounded with non-unref'd timers

`darwin-best-effort-scope.ts:292-310`: after root exit with a persisting
group, the observer polls every 25ms indefinitely and holds the event loop
(the non-unref choice at `:164-167` is deliberate for cancel; this loop
inherits it). Task 3.5's bound list names control phases; this is an observer,
so the tick is defensible - but the event-loop hold is real.

## The four honesty conditions

1. **Declaration in the record before the workload spawns: HOLDS.**
   `host.ts:446-465` writes the declaration under generation/revision CAS
   before the sole activation site (`host.ts:497-499`, "This is the sole
   activation site"); the post-write re-check (`host.ts:469-481`) aborts the
   scope and throws typed `authority-persist-failed` if the write dropped it,
   proven by the stripped-registry test (test file `:371-409`). The guard the
   LEAD asked about discriminates: the gate means a record that has not
   appeared before assertions implies the spawn could not have happened, and
   both realistic reorderings go RED (see Minor-3 for the one evasion).
2. **Cancel terminal always `cancelled / emptiness-unproven`: HOLDS in the
   scope.** `runCancelProtocol` returns `unprovenReceipt('cancelled', ...)`
   unconditionally (`darwin-best-effort-scope.ts:262-266`); `emptiness` is a
   literal with no branch (`:123-127`); no `closed`/`scope-empty` emission
   exists in the module (source scan guard plus my read). The group-observed-
   empty case is covered by the escape test and by real-kernel oracle 6.3,
   whose verbatim receipt shows `escapeeAlive: true` with
   `emptiness: "unproven"`. A terminate timeout returns `uncertain` - not a
   completed cancellation, and it fails closed for release. CAVEAT: the
   terminal reaches the durable Record only on the `closeDurableProcess`
   routes - Major-1.
3. **Escalation keyed off whole-group emptiness, never leader exit: HOLDS.**
   The escalation predicate reads only `pollGroupEmpty`
   (`darwin-best-effort-scope.ts:241-258`); `state.rootExit` is attached to
   the receipt but never read in the decision. Proven by the deterministic
   guard, and on a real kernel by oracle 6.1, whose mutant receipt shows the
   worst form: descendant left alive AND `groupObservedEmpty: true` - a lying
   record, exactly the protected invariant.
4. **Both limit flags literal `false`, no widening path: HOLDS - checked, not
   accepted from the comment.** Exhaustive writer sweep: the frozen literal
   constant (`darwin-best-effort-scope.ts:32-37`), literal-`false` types at
   both seams (`process-scope.ts:85-86`, `contracts.ts:70-71`), field-by-field
   copies of declared values in the host (`host.ts:457-458`), and the registry
   refusing any declaration whose flags are not exactly `false` - at write AND
   at load, since `parseSession` runs in `create`/`update`/`load`
   (`registry.ts:314-331`, `:738`, `:772`, `:401`). No config or environment
   input touches them. (The write-path validation is stronger than the
   "fails at read-back, not at write" framing in the task brief -
   an inaccuracy in the safe direction.)

## The nine mutation receipts

Method: I could not re-inject the mutations (report-only, no source edits;
a concurrent worker is editing neighbouring files). Each verdict is by code-
flow analysis of the mutation against the named guard, cross-checked against
the quoted failure sets and suite totals, which match the suite sizes I
reproduced (16 and 8).

- **(a) escalation keyed to leader exit - SOUND.** The `|| Boolean(state.rootExit)`
  widening skips escalation exactly when the leader died during grace; both
  named tests fail for that reason and no other.
- **(b) leader-only kill - SOUND.** Positive-pid delivery leaves the trapping
  descendant alive; all four named failures are downstream of the named
  defect, including the direct group-addressing assertion.
- **(c) forged clean-cancel - SOUND**, caught by the behavioural guard
  (`receipt.state).not.toBe('closed')`). Note: the sibling SOURCE-SCAN guard
  would NOT catch this exact mutant - `state: receipt.groupObservedEmpty ?
  'closed' : ...` does not match `/state:\s*'closed'/` - which confirms the
  receipts file was right to classify the scans as non-behavioural and to
  lean on the behavioural sibling.
- **(d) release without declaration, receipt path - SOUND.** Fails exactly the
  one guard that owns that path; does not touch the observation path.
- **(e) release without declaration, observation path - SOUND.** Fails exactly
  the observation-path guard. (d)/(e) together demonstrate the two paths are
  independently discriminated - the implementer's own two-path discovery is
  real and correctly closed.
- **(f) declaration omitted from the record - SOUND.** The before-start
  assertion reads the written record, not the prepared object; dropping the
  spread goes RED with exactly one failure, as quoted.
- **(g) darwin deselected - SOUND.** The declaration assertion on the darwin
  branch rejects when the selector routes to the native scope.
- **(h) construction-site bypass - SOUND for the named defect**, with a stated
  limitation: it is a source scan over the three named files only. My sweep
  confirms no fourth `createNativeProcessScope` construction site exists in
  `src/` today (the only call is the selector's own, `hosted-process-scope.ts:22`),
  but the guard would not notice a new site in a new file.
- **(i) non-absolute command accepted - SOUND.** Disabling the check makes
  prepare succeed; the refusal guard is the only thing that fails.

The two real-kernel mutants (6.1-mutant, 6.2-mutant) are the strongest
receipts in the set: one-line-patched copies of the COMPILED PRODUCTION module
leaving a real descendant alive on a real kernel. Verified from harness source
(`evidence/oracles/posix-preflight.mjs` imports
`dist/core/session-host/process-capsule/darwin-best-effort-scope.js`, no
reimplementation) and the quoted receipts; not re-executed (see below).

## Production-vs-stand-in sweep

Rigor: EXHAUSTIVE at the ProcessScope seam over surfaces this change added or
modified; SAMPLED for pre-existing host routes it touches.

- **Real:** the darwin scope protocol against a real Linux kernel via the
  compiled production module (labelled WRONG OS, correctly); the registry
  validators via a real file-backed registry in the release tests;
  `toSessionHostView` asserted through `host.inspect`.
- **Fixture-mediated at the seam (consistent with what the implementer is said
  to have reported):** the host release rule (the `terminalScope` stub - the
  test says so itself at `:61-65`); the host declaration-recording path (the
  `gatedDarwinScope` wraps a real darwin scope over a fake spawn/control).
- **Not exercised anywhere, NOT reported in any evidence file:**
  1. `ClaudeResidentTransport.terminate`'s declaration-gated close
     (`claude-backend.ts:318-333`) - no deterministic test, no oracle, no
     mutation receipt; it also conceals Major-1.
  2. The dispatch-`finally` flush (`host.ts:1280`) - Major-3.
  3. The declared arms of the three abort-release sites (`host.ts:488`,
     `:571`, `:1408`) - only the undeclared (exact) arms have regression
     coverage.
  4. The `router.ts:639` darwin arm - source scan only; real construction is
     exercised end-to-end on Windows (native tier); the darwin arm is macOS-
     gated, which Section 7 declares honestly.
- I could not find the implementer's "two production entry points still
  fixture-mediated" enumeration anywhere on disk (no `handoff/`, not in
  `verification.md`); the sweep above stands on its own.

## Claims verified as true

- **Exact-tier byte-identity of the release rule.** Old rule
  `if (receipt.state !== 'closed') return 'live-or-uncertain'` is semantically
  identical to `!receiptAuthorizesRelease(receipt, false)` for every receipt
  state (`process-scope.ts:204-210` first branch is the old predicate
  inverted); the new `declared-unproven` observation branch is unreachable for
  exact scopes (the native capsule never emits that state). The three-state
  regression loop plus 606 green session-host tests on Windows back it.
- **The CAS fix.** `closeDurableProcess` (`host.ts:673-708`) contains zero
  session-registry writes - inspect/terminate/ownership only, and
  `ownership.ts` never references the registry (delegates to claude
  session-state writer-claim files). All four callers enumerated (`:1024`,
  `:1119`, `:1194`, `:1299`); each drains through the dispatch `finally`
  (`:1280`) or the reconcile flush (`:1388`); every post-close CAS update in
  the callers (`:1134`, `:1205`, `:1314-1384`) now operates on an unbumped
  record. Staged-then-flushed is the correct shape; its two residues are
  Minor-1 and Major-3.
- **The registry allowlist additions are complete.** New persisted fields are
  exactly `process.declaration` and `processTerminal`; both have allowlist
  entries (`registry.ts:163`, `:174`) and strict validators (`:176-180`,
  `:317-331`, `:333-351`), exercised through a real registry by the release
  tests (a missing entry would have thrown in `create`/`update`).
- **Non-acceptance labelling is present and adequate.**
  `posix-preflight-oracles.md:3-8` (header, "WRONG OS", gate reference),
  `mutation-receipts.md:3-8`, the harness itself (`posix-preflight.mjs:3-6`),
  and `provenance.acceptance: false` inside the receipt JSON. Section 7 open
  (6 tasks) plus 8.4 open = 29/36 ticked, matching the ledger and run-state.
- **DAG.** The change's `.openspec.yaml` declares no dependencies; run-state
  shows this child `dependsOn: [ecp-platform-process-authority-foundation]`
  and closure `dependsOn: [linux, windows]`. No edge into closure anywhere.
- **Whitespace on bytes.** Every change-touched src/test/evidence file is
  LF-only, no trailing whitespace, final newline, no trailing blank line.
  `router.ts` is whole-file CRLF in the working tree exactly as 8.1 reports
  (pre-existing; LF at HEAD; correctly escalated rather than fixed).
- **`rasen validate --strict`** re-run by me: green.

## What I could not verify

- Anything on real macOS - no host exists; the change is honestly
  non-terminal and Section 7 is correctly open.
- The Linux/WSL oracle receipts by re-execution (requires the WSL run tree and
  a current `dist/`; rebuilding is prohibited in this session). Assessed from
  harness source and quoted output. The correspondence of the receipts' `dist`
  to the current source could therefore not be re-established byte-for-byte.
- The nine deterministic mutation receipts by re-injection (report-only
  constraint). Verdicts are analytic, cross-checked against quoted failure
  sets and reproduced suite sizes.
- The implementer's 88-file/1115-test Windows run as a whole; I re-ran the
  session-host directory (606 passed, 0 failed) and the two new suites, not
  `management-api` + `cli-e2e`.
- Whether `hosted-sessions.ts` belongs to this change or the concurrent
  workstream (Major-2 stands either way).
- 8.3's forward half by construction: neither pending contract edit has
  landed, so D2-survives-the-landed-wording remains a future check, as the
  implementer itself recorded.
