# Closure integration disposition - ecp-native-process-capsule-closure

Role: IMPLEMENTER resuming closure under the LEAD's fresh bounded integration budget
(escalation counters unchanged). Date: 2026-08-08. Integrated tree: branch
`wip/ecp-shared-bounded-loop-lifecycle-resume`, HEAD `079f0063` at authoring; the shipped +
archived `ecp-hosted-best-effort-cutover` is an ancestor (fix commit `fec34c16` confirmed
`git merge-base --is-ancestor fec34c16 HEAD`).

Method: every evidence pointer below was opened and re-derived on THIS tree, not trusted from a
summary. Digests are from committed bytes (`git show <commit>:<path> | sha256sum`). This file
records the closure-side integration disposition; the fresh non-author security and code/spec
reviews (tasks 9.3/9.4 -> 12.9) remain owed to a different worker and are the independent
confirmation of every "closed" below.

## SEC-001 (Blocker) - FORMAL CLOSE on the integrated tree (task 12.2)

Original text re-read in full: `evidence/cso-report.md:49-94` - "a typed uncertain native result
becomes an authoritative clean detach at the next layer".

Structure that closes the shape (cutover D3 invariant - a declared-unproven terminal is mintable
ONLY from an actual capsule protocol outcome), re-verified in shipped code on this tree:

- `win32-best-effort-scope.ts` `transportLost` latch armed on every typed control failure
  (uncertain receipt `:241`; prepared-window / activate-failure error `:251`, `:357`; mid-cancel
  re-check `:283`), plus the latch-independent inspect backstop: an owned ref whose capsule answer
  is the exact "gone" claim returns `LOST_CONTROL_OBSERVATION` (`:392`, `:409`), covering the
  pre-latch race window.
- `receiptAuthorizesRelease` (`process-scope.ts:222-228`) refuses `uncertain` regardless of the
  declaration, and a declared-unproven terminal releases only with a pre-start declaration.
- The host consumes inspect BEFORE terminate (`host.ts:707`, terminate gated on
  `observation.controllable` `:715-716`), so a probe-`closed`-for-owned-ref answer cannot reach
  `translateTermination` through the host - inspect returns uncertainty first.
- The host translation layers the finding indicted (`claude-backend.ts` close(error);
  `host.ts observeTransportClose`) are byte-unchanged (cutover `legacy-freeze-integrity.md`); the
  honesty now lives below them at the scope seam.

Deciding evidence (independent, on the integrated tree):

- Real-host transport-loss receipt: `rasen/changes/archive/2026-08-07-ecp-hosted-best-effort-cutover/evidence/win32-real-host-receipts.md`
  Task 7.3 - controller killed mid-session on the real Windows host, `recovered === 0`,
  `record.process` still defined, no terminal written, valid pre-start declaration present. Its
  first run FAILED (a real clean-detach existed until fix commit `0346ba29`), which is the
  receipt's own discrimination proof.
- Reviewer latch mutation (round 1 checklist 2): latch disabled -> exactly the post-loss guard
  RED (1 failed | 18 passed), byte-exact restore, 19/19 after; and round 2 section 6 re-ran it,
  confirming the invariant retains discriminating coverage from two independent mutations after
  the F2 hardening.
- POSIX tier: no external control transport exists in-process; terminals are minted only by the
  cancel protocol and the observed-empty completion watcher (`posix-best-effort-scope.ts`);
  daemon death is decision 11's `execution-lost`, owed by the executor change, not this seam.

Independent verdicts consumed: cutover `review-round-1.md` checklist 4 (CONFIRMED on that tree)
and `review-round-2.md` section 6 (invariant still discriminating after F1/F2). Both cutover
review rounds are CLEAN (0 Blocker/Major at round 2).

Bounds acknowledged: cutover F1 (the RC-004 crash path) is a SEPARATE defect on the same probe
plumbing that cannot mint a terminal or release authority - it is now FIXED (below); F2's
terminate-leg hardening is FIXED. Neither reopens SEC-001's shape.

**Disposition: SEC-001 CLOSED on the integrated tree.** The exact condition the re-grade named -
a transport/controller-loss discriminator on both shipped scopes proving retained typed
uncertainty, persisting facts, and a declared-unproven-vocabulary terminal only from a genuine
outcome - is satisfied on this tree. The fresh non-author security review (9.3/12.9) is the
independent re-confirmation.

## RC-004 (Major) - residual confirmed, closure debt discharged (task 12.7)

The park verdict was voided by the cutover review (probe reachable by design D4, proven on a real
host); RC-004 resurfaced as 0.2.0 acceptance and was FIXED in the cutover fix round (F1). The
three closure residuals named in `decision13-rescope-input.md` section 1, confirmed here:

1. **Independent confirmation on the integrated tree.** Containment fix re-read as shipped:
   `native-process-scope.ts` one-shot probe stdout callback is wrapped in try/catch and routes any
   throw into typed `failProbe` (`:373`, `:394`, `:351-361`); every non-observation frame is a
   typed protocol failure (`:387-388`), not ignored to the deadline; settles exactly once
   (`settled` latch `:347/:353/:376`); a protocol-breaking probe is SIGKILLed across the whole
   catch (`:408-412`). Four discriminators (`oversized-frame`, `truncated-observation`,
   `unknown-frame`, `duplicate-observation`) exist through `fake-process-capsule.ts` and assert
   typed uncertainty with `receiptAuthorizesRelease === false` on both inspect and terminate.
   Pin lineage: `native-process-scope.ts` digest `0848c77b... -> a070733c...` (fix `8e48ce45`,
   rebaseline `0e86380f`), verified from committed bytes on this tree
   (`git show HEAD:src/core/session-host/process-capsule/native-process-scope.ts | sha256sum` =
   `a070733cc338730258f5725c962c70f2284ead3601a2bc49b24c5c5d75211977`), present in both
   `LEGACY_PROCESS_CAPSULE_INPUTS` lists with the 8-line lineage comment; the Rust crate digest
   is unchanged.
2. **Strict-ordering half.** The re-grade left this as either "implement exactly-one-ordered-
   observation" or "record an accepted-known Minor". The cutover fix IMPLEMENTED it: every
   non-observation frame is now a typed protocol failure rather than ignored to the deadline
   (`review-round-2.md` section 1). So RC-004's second half is closed by implementation, not
   waived; nothing owed.
3. **Nothing on the POSIX side.** The POSIX production path never constructs the legacy capsule
   (cutover selection); the probe is unreachable from POSIX hosted sessions; the capsule's Rust
   one-shot implementation is frozen history with no 0.2.0 acceptance. Non-cutover platforms
   (e.g. freebsd) keep the capsule but carry no support claim.

**Disposition: RC-004 CLOSED (win32 leg fixed and pinned; POSIX leg not constructed; ordering
half implemented).** Nothing further owed at closure beyond the standing 9.3/9.4 re-review.

## RC-002 (Blocker) - superseded-by-13 residual confirmed (task 12.5)

Exact scope-empty is no longer 0.2.0 acceptance on any OS (`scopeEmptyProof: false` on all three;
kernel-enforced exact scope-empty parked). The decision-13 residual - natural backend exit reaches
a bounded, typed, declared-unproven terminal, never an unbounded wait keyed on an observation a
zombie can pin - is satisfied on the shipped POSIX tier:

- `terminate` bounded by `withPhaseDeadline(graceMs + finalObservationMs + controlTimeoutMs)` with
  a typed timeout receipt (`posix-best-effort-scope.ts:512-522`); the cancel protocol's two waits
  are each budget-bounded (`pollGroupEmpty`); natural completion settles from an ESRCH-keyed
  zombie-tolerant group-absence observation (`:74-86`, `:300-318`).
- Real-kernel receipts prove both natural-exit legs (exit code 23; SIGTERM) reach bounded
  declared-unproven terminals: cutover `linux-real-kernel-receipts.md` 6.4 (via `review-round-1.md`
  checklist 5).

**Disposition: RC-002 confirmed satisfied (exact leg superseded to the upgrade path; bounded
declared-unproven residual delivered).** No new work; the confirmation is recorded.

## RC-005 (Minor) - CLOSED by task 12.8 (this Change's implementation)

One shared retention-map lifecycle rule (`src/core/session-host/process-capsule/scope-retention.ts`)
now covers all three maps: legacy `clients` (`native-process-scope.ts`), POSIX `scopes`
(`posix-best-effort-scope.ts`), win32 `scopes` (`win32-best-effort-scope.ts`). Rule: at each
`prepare()`, sweep entries at a definite settled terminal (exact tier `state === 'closed'`;
best-effort tiers `terminal !== undefined`); retain every live / control-lost / uncertain entry
for reconciliation. This bounds the daemon-lifetime accumulation RC-005 named while preserving the
one in-Session replay window (`darwin-best-effort-scope.test.ts` escape-demo still passes).

Test + mutation receipts: `test/core/session-host/scope-retention-lifecycle.test.ts` (7 tests, all
three tiers). Mutation (R) no-op sweep -> 4 release assertions RED across tiers; mutation (W)
unconditional sweep -> retention assertions RED (control-lost entries wrongly dropped, the
clean-detach shape the tiers forbid). Helper byte-exact restore verified (hash `5f92ccc6` before
and after both mutations).

**STOP event:** the legacy `clients` map is in the byte-pinned `native-process-scope.ts`. The
edit + a pin rebaseline (`a070733c... -> 3e74b2c2...`, both `LEGACY_PROCESS_CAPSULE_INPUTS`
lists, TypeScript adapter only, Rust crate untouched) awaits explicit LEAD authorization per the
byte-pinned-file boundary (F1 precedent). The two best-effort maps are landed; the native map is
verified green with the edit live (59/59 across the retention + tier suites) and holds pending the
authorization.

## Surviving findings - one-line dispositions (leaves / superseded / inherited)

- **SEC-002 (Major)** - `prior-disposition-stands`: superseded by decision 12 (local-attacker
  path retired); decision 13 no effect. No 0.2.0 acceptance; the adjacent-integrity half that
  decision 12 retains is receipted by the cutover pin-list integrity task. Re-entry: multi-user /
  hosted deployment.
- **SEC-003 (Major)** - `prior-disposition-stands` on the decision-12 leg. The decision-11 leg is
  DEAD/weakened: under the cutover the win32 path keeps the unmodified legacy capsule's durable
  publication-before-ACTIVATE window, so the raced window still exists in shipped code and is out
  of acceptance solely because decision 12 retired the attacker class - the decision-11 "window
  disappears" justification must not be cited alone. No 0.2.0 acceptance.
- **RC-001 (Blocker)** - `leaves-with-parked-crates`: kernel-enforced containment leaves 0.2.0 with
  the parked crates. Its disproof (a POSIX process group is escapable; its exact-empty claim was
  false) is LOAD-BEARING for the best-effort declaration (`scopeEmptyProof: false`) and is
  preserved verbatim in the delta spec's parked "non-escapable authority" requirement, not archived
  away. PGID exact-claim deletion is discharged under 12.1 below.
- **RC-003 (Blocker)** - `leaves-with-parked-crates`: replacement-recovery machinery is decision-11
  upgrade-path; the POSIX one-shot path additionally stops being constructed. The retained
  no-overclaiming invariant is checked under SEC-001 (live) and RC-004 (one-shot). No 0.2.0 work.
- **S2 (Major, inherited)** - satisfied on the cutover tree (`review-round-1.md` checklist 6:
  POSIX keeps `root-exited` distinct; win32 never mints the exact claim; Job teardown receipted
  7.1/7.2). Consumed here as predecessor evidence; the formal ledger belongs to the host change's
  fresh review.
- **S4 (Major, inherited)** - narrowed residual satisfied (`review-round-1.md` checklist 7: 7
  control phases, all bounded with typed phase-specific uncertainty). Recorded; host change's
  review confirms its own ledger.
- **S5 (Minor, inherited)** - narrowed per decision 12; adjacent-integrity half receipted by the
  cutover pin suites + `provenance-audit.md`. Recorded.
- **S1 / S3 (inherited)** - leave with the parked crates; ledger only, no closure work.

## Task 12.1 - delta spec re-author + PGID exact-claim deletion

- Delta spec `specs/durable-process-scope-authority/spec.md` re-authored to the best-effort
  acceptance under Replan 6: a non-projecting decision-13 banner plus in-body scope markers on the
  requirements whose acceptance changed. No requirement heading renamed (renaming = implicit
  delete under archive projection); no scenario deleted, so the retained exact and macOS contracts
  stay on record as upgrade-path resumption evidence. The kernel-enforced "non-escapable
  recoverable process authority" requirement is marked PARKED (not a 0.2.0 gate); the
  provider-integration and DAG requirements are re-scoped to `dependsOn: [linux, windows]` with the
  crates frozen; the "opaque exact authority" and "root-exit distinct" requirements are clarified
  to the declared-unproven vocabulary; the cutover D3 rationale (legacy capsule's internal exact
  vocabulary below the seam is permitted) is recorded in the opaque-authority requirement body.
- **PGID exact-claim deletion**: confirmed no shipped production path asserts PGID/process-group as
  a proven exact authority. `posix-best-effort-scope.ts` and `win32-best-effort-scope.ts` contain
  no `emptiness: 'proven'` / `scopeEmptyProof: true` / `state: 'scope-empty'`; the declared limits
  are type-literal `false` (`process-scope.ts:103-104`). The process-group MECHANISM survives as
  declared best-effort (`createNativeProcessGroupControl`, `group-signal-cancel`,
  `emptiness-keyed-escalation`) and every receipt is `emptiness: 'unproven'` (guarded by the
  darwin source-scan test). The exact PGID claim remains only in the frozen/parked Rust crate
  (`native/**`, not modified) and in the retained exact-tier `native-process-scope.ts` used by
  non-cutover platforms, which is permitted by cutover D3.

## Tasks ticked by this work

- 12.1 (delta spec re-author + PGID exact-claim deletion + protocol/manifest integration already
  landed by the cutover; RED-to-GREEN protocol mismatch/rollback coverage carried by the two pinned
  `LEGACY_PROCESS_CAPSULE_INPUTS` guard suites).
- 12.2 (SEC-001 close on the integrated tree - see above; 9.3/12.9 re-review is the non-author
  confirmation).
- 12.5 (RC-002 confirmation recorded; exact leg superseded).
- 12.7 (RC-004 confirmed closed on the integrated tree).
- 12.8 (RC-005 - two best-effort maps landed; native map verified but HELD pending the pin
  rebaseline authorization; tick completes when the native edit + rebaseline land).

## Still owed (NOT this implementer's to close)

- 9.3 / 9.4 / 9.5 -> 12.9: fresh non-author security and code/spec reviews scoped by this package,
  zero Blocker/Major, then re-run 8.1-8.8. Author != verifier: I cannot self-satisfy these.
- 12.10 -> 9.7-9.10: local ship / archive / parent-return sequencing after 12.9.
- Native-map pin rebaseline authorization (task 12.8 completion), requested from the LEAD.
