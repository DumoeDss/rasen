# Review report — issue-acceptance-close (VERIFY, child 3/3)

Reviewer: independent verifier (not the implementer). Date: 2026-08-17. Tree: worktree
`feat/issue-layer`, C3 delta uncommitted on top of 63f58449.

**Verdict: APPROVE.** 0 Blocker, 0 Major, 2 Minor, 5 Info. The done-rule rewiring,
the two-artifact acceptance content, the gate taxonomy, the CLI three-way sync, and the
dogfood receipts all check out against the four deltas and design D1-D9. The two Minors
are a spec-wording vs code divergence on one edge case and a partial hardening invariant;
neither blocks ship.

## 1. Test gate (re-run by reviewer, real exit codes, no pipes)

- `pnpm build` → exit 0 (dist rebuilt by the reviewer before CLI tests; not trusted from report).
- Units: `pnpm exec vitest run test/core/issue-acceptance test/core/store/store-issue-acceptance-content.test.ts test/core/store/store-issue-acceptance-mutations.test.ts test/core/store/planning-layout-v2.test.ts test/core/store/store-issue-scope.test.ts test/core/issue-status`
  → **8 files / 134 tests passed, exit 0** (148.76s).
  Per file: mutations 11, locator-widening 7, read-only-guard 5, planning-layout-v2 65
  (12 `it(` sites expanded by each-flavors), content 12, scope 5, gate 8, projection 21.
- CLI: `pnpm exec vitest run test/commands/store-issue-acceptance-cli.test.ts test/commands/store-issue-status-cli.test.ts test/commands/store-issue-cli.test.ts test/commands/store-issue-start-cli.test.ts`
  → **4 files / 28 tests passed, exit 0** (205.73s). Matches the claimed 28/28 exactly.
- `node bin/rasen.js validate issue-acceptance-close` → "Change is valid", exit 0.

Count discrepancy vs claim: implementer reported units **8 files / 174**; the affected-set
invocation above yields **134** (see Info-1). All green either way; total measured 162 vs
claimed 202.

## 2. Prior-test sweep (the flagged review risk) — `git diff 63f58449 -- test/`

Exactly the four listed files changed (plus `vitest.config.ts`, judged below). No unlisted
prior test touched.

- `issue-status-projection.test.ts` — the C1 done test is contract-inverted in place, not
  deleted: the pre-flip assertions are untouched; `resolved.phase === 'done'` became
  `flipped.phase === 'review'` + `waiting-human` (the new spec contract), followed by the
  real `publishAcceptance` → `accept` → `done` flow asserting record revision `0001` and the
  gate reading `issue_accept_already_accepted` over the same read. Strictly stronger.
- `issue-status-read-only-guard.test.ts` — original byte-identity assertions and the
  non-vacuity check retained verbatim; additions non-vacuous (conditions revision reads back
  `0001`, gate eligible false, and an accepted twin reads `done` while both trees stay
  byte-identical).
- `planning-layout-v2.test.ts` — purely additive: three new address kinds, ordinal-refusal
  row, and the no-project/no-target-line invariance list extension. No original expectation
  altered.
- `store-issue-status-cli.test.ts` — exactly ONE change: the scenario timeout 30s → 60s with
  an explanatory comment (list/show now read acceptance content per Issue; solo wall-clock
  near 27s of the old 30s). Zero assertion changes. Legitimate.
- `vitest.config.ts` weights — judged **legitimate infra**, not test-hiding: entries follow
  the file's documented solo-measured convention for spawn-heavy files; they affect shard
  balancing only; no skip/exclude/assertion change anywhere. (See Info-5 for one understated
  entry.)

## 3. Claim sweep

**Done rule** (delta: issue-acceptance-close req 4; issue-status-projection MODIFIED):
`projection.ts:606-610` — `resolved` derives `done` iff a verified record reads back, else
`review`; no archived-count input anywhere in the phase derivation; the accept mutation takes
only the portable snapshot (no archive reads); the gate reads `node.observation`
(finalized|run-terminal — the C2 observation rule), never the query's archive-based
`blockedBy`. Tampered record → `unreadable-acceptance` problem + `review` (gate test 6).
Omitted acceptance input reproduces C2 derivations (gate test 7 asserts omitted-vs-empty
equality outside the acceptance block).

**Mutation vocabulary 3→5** (`store-issue-resources` RENAMED+MODIFIED): exactly
`publishAcceptance` and `accept` added to
`StoreIssues`; both under the existing `withWriteLock` + `report`/commit-suggestion
discipline; `accept` performs no run-state reads. `store/issues` has zero upward imports
(grep over `src/core/store/issues/*.ts` for issue-status/issue-acceptance/issue-execution:
comment hits only). Issue-record bytes unchanged: `records.ts` diff is the
`assertPortableIssueText` error-code union widening only; the legacy-upgrade test asserts
`issue.yaml` byte-identical across the upgrade.

**Stricter-than-letter readings, graded:**

- (a) accept re-reads + digest-verifies the named conditions revision under the lock
  (`module.ts`, refusal `issue_accept_conditions_unreadable`): **spec-consistent
  hardening.** It is a Store-content read, not a run-state read, so D2/D6 hold; the record
  requirement ("SHALL carry the conditions revision it accepted with that revision's
  digest") plus never-rewritten records makes a bad freeze unrecoverable, so refusing to
  freeze a nonexistent/mismatched revision is exactly the durable-evidence contract.
  Reachable and asserted in mutation test 7 (missing / digest-mismatched / unreadable).
- (b) gate snapshots coherence-checked at validate time (`assertCoherentGateSnapshot` runs
  inside `validateAcceptedRecord`, i.e. on read): **spec-consistent hardening with an
  asymmetry** — see Minor-2.

**Named refusals discriminate:** dropped / already-accepted (incl. a present-but-tampered
record) / no-plan / no-conditions are each asserted with the exact code at unit level
(gate test 4, mutation test 6) and via `expectJsonRefused` pinning `payload.status[0].code`
at CLI level (CLI test 3) — a refusal guessing a wrong code fails the test.

**Acceptance record durability:** one per Issue — presence check precedes everything,
including unparsable records (present-but-tampered → `already_accepted`, never re-written);
concurrent accepts serialize to one record + two `already_accepted` refusals
(`Promise.allSettled` test); content suite pins exact digests and exact YAML bytes
(absolute pins, not relational — no uniform-change blindness); lock release after refusal
tested; `supersedes` ordering and duplicate condition ids refused.

**CLI three-way sync:** commander `acceptance`/`accept` + symmetric en/ja/zh-cn locale keys
(store/from-file/note/json — verified byte-clean UTF-8, no mojibake) + completions
`COMMAND_REGISTRY` entries; `show` acceptance section asserted in human and `--json`
(`status.acceptance.*`) before and after acceptance, and `list --json` carries
`status.acceptance.record`. Malformed Issue ids travel in `page.problems`, not
`page.issues`, so the new per-Issue acceptance read in `list` cannot regress the malformed
twin handling.

**Dogfood receipts match claims:** Phase B (conditions 0001 + gate visible with the live
g-003 in-flight and the honest g-001 invalid-run-state problem, named together); Phase C
(HOLD, exit 1 — verified by a separate re-run, the tee trap explicitly handled); Phase D
(archived children + plan revision 0002 → eligible → accept → resolved with BOTH pathspecs
in one suggestion → committed → show reads done/healthy 3/3 + record + honest not-eligible
gate; list shows done; second accept refuses). Phase A/E trap-list discipline documented.
The failed-health HOLD is a labelled real-shaped fixture in the gate suite, per D9's own
rule against fabricating live failures.

**Fences:** `git diff 63f58449 -- src/core/pipeline-registry/ packages/ui package.json` is
byte-empty (0 lines) — covers both package.json files (root + packages/ui).

**Bookkeeping:** architecture-index updated in all three detail files (module map for
`issue-acceptance/`, quick-locate rows, done-rule note in the issue-status section).

## 4. Fixture-coincidence sweep

Mutation spot-checks against the gate suite (would the test fail if the predicate lied?):

- `isTerminal` → `return true`: gate test 2 fails (expects the two un-terminal-node
  blockers with exact observations).
- Drop the `health === 'failed'` branch: gate test 3 fails (`failing-node` containment +
  message).
- Drop the problems loop: gate test 2 fails (`invalid-run-state` blocker + message) and
  test 5 fails (`complete` false).
- Done from resolved alone: projection test fails (`flipped.phase` review) and gate test 6
  fails.

The gate tests guard the gate. CLI refusals pin taxonomy codes, not just exit 1.

## 5. Findings

### Minor-1 — derivePhase vs the delta's review clause on a premature close

`src/core/issue-status/projection.ts:606-610`. The MODIFIED "Phase derives from where the
execution graph stands" requirement scopes `review` to "every Change node's work is complete
or finalized, no intent node remains, and the Issue's close is not proven". The code returns
`review` (hence health `waiting-human`) for ANY resolved-without-verified-record,
unconditionally, without the terminality check the open-Issue review branch enforces.

Failure scenario: an operator sets an Issue to `resolved` while g-002 is still in flight;
`store issue show` reports `phase: review`, `health: waiting-human` — per the requirement's
precedence this graph should read `active`. The gate still refuses the accept honestly
(un-terminal node named), so no incorrect close is possible; the divergence is presentation
and spec-text conformance. Design D4/D5 arguably intend the code's reading (resolved =
operator-declared over; review = awaiting acceptance; D5's "closed early" row handles it at
the gate), and the delta's em-dash clause ("— an open Issue, or one resolved without an
acceptance record") can be read either way. Fix in one place: either carve the resolved
case out of the review clause's terminality wording in the delta, or make the resolved
branch fall through to the normal precedence when the graph is not uniformly terminal. No
test covers the premature-close phase today.

### Minor-2 — snapshot coherence check is partial

`src/core/store/issues/acceptance.ts:453-469` (invoked from `validateAcceptedRecord`).
The read-time coherence check enforces `problemsStanding === 0`, `completed <= total`, and
the health vocabulary, but not the other two invariants every genuine accept implies:
`completed === total` (the gate sets both to `nodes.length`, gate.ts:158-163) and
`health !== 'failed'`. A hand-crafted record re-digested over `completed: 1, total: 3` (or
`health: failed`) reads back "verified" and derives `done`. Digest verification cannot
catch a re-digesting author by design, and the spec's tamper scenario is "altered without
updating its digest", so this is not a spec breach — but the check's own stated purpose
("a hand-crafted record that re-digests over a contradiction is refused here") covers one
of three contradictions. Either complete the invariant set or narrow the comment to what it
actually guarantees.

### Info-1 — reported unit count not reproducible

Implementer reported units 8 files / 174 (+ CLI 4 / 28 = 202). The reviewer's affected-set
invocation (Section 1) measures 8 files / **134**; CLI matches exactly (28). All green;
nothing hidden — but the 174 does not reproduce under the natural reading of the affected
set, so the receipt's arithmetic (202) is off by the same 40.

### Info-2 — record written before the transition check in `accept`

`src/core/store/issues/module.ts` (accept): `accepted.yaml` is written before the
open→resolved transition check and state write. If the transition ever refused (a future
lifecycle change) or the state write failed mid-mutation, the record would be durable with
the state still `open` — an Issue that can neither present `done` (needs resolved) nor
re-accept (record present). Unreachable under the current table (open→resolved is
permitted) and commented in place; robustness note only.

### Info-3 — delta scenario without a direct test

"A later conditions revision does not change what the record says was accepted" has no
test that accepts under 0001, publishes 0002, and re-reads. Satisfied by construction (the
record's bytes are immutable and the read path parses `accepted.yaml` only, independently
of `readLatestConditions`), and the record-vs-gate separation at read time is asserted in
the projection test. Nice-to-have coverage.

### Info-4 — CLI `acceptance` reuses `issue_scope_required` for input-shape errors

`src/commands/store-issue.ts` acceptance action: missing `--from-file` and a file without
a `conditions:` list surface under `issue_scope_required` — a scope code for an
input-shape problem. Refusals still name the reason and fix; taxonomy hygiene only.

### Info-5 — one vitest weight understated

`test/commands/store-issue-acceptance-cli.test.ts` entered at 145000ms; solo measured here
at 194524ms (~34% under). Understating a spawn-heavy file is the shard-skew risk the entry
exists to prevent — the opposite of test-hiding, but worth correcting when the file's
budget is next touched. Related cosmetic: in `show`, the acceptance section prints with no
blank line after STATUS PROBLEMS (visible in `dogfood-phase-b-show-gate.txt:16-18`), so it
reads as part of the problems block.

## Round-1 re-review

Date: 2026-08-17 (same day). Scope: the round-1 fix delta only, verified claim by claim
against `evidence/fix-round-1.md` and the working tree.

**Verdict: CLEAN.** All seven round-1 findings resolved or accepted; no new Blocker or
Major. Gates re-run by the reviewer with real exit codes (see numbers below; two CLI
attempts flaked on documented ambient-load timeouts in files this round did not touch,
with a confirming green pass per test — details under Environmental note).

### Minor-1 — RESOLVED (delta wording + pin test; zero production change)

- `specs/issue-status-projection/spec.md` now scopes `review` to exactly the two cases
  (open + all-terminal + no intent; resolved-without-verified-record "whatever its nodes'
  state", with the operator-declared-over rationale), and adds the scenario "A premature
  close reads review regardless of the graph" including the gate-still-names-blockers AND.
- Pin test verified: "reads review/waiting-human for a premature close while a child is
  still in flight" — real-Git fixture, g-001 in-flight + g-002 not-started, asserts
  `review`/`waiting-human` + `issue_accept_blocked` with both exact un-terminal blockers.
- Zero production-code change confirmed two ways: `src/core/issue-status/` diffstat is
  byte-identical to round 0 (9/121/22), and the resolved branch at `projection.ts:606-610`
  is unchanged.

### Minor-2 — RESOLVED (invariants completed + genuinely re-digesting read test)

- `assertCoherentGateSnapshot` (`acceptance.ts:461-486`) now enforces the full set:
  non-negative, `completed <= total`, `completed === total`, health vocabulary,
  `health !== 'failed'`, `problemsStanding === 0`. One definition, two call sites
  (`module.ts:398` mutation input; `acceptance.ts:350` inside `validateAcceptedRecord`,
  i.e. on read).
- The re-digest test is genuine: the hand-assembled YAML's `contentSha256` is computed by
  `acceptedRecordDigest(draft)` over the exact contradictory body the YAML spells (quoted
  `"0002"` parses as the same string), so the digest VERIFIES and the refusal is the
  coherence invariant. It double-discriminates: a stale-digest fixture would throw
  "does not match the record body" and fail the `/completed \(1\) must equal total \(3\)/`
  assertion; removing the invariant would not throw at all. Both rows pinned
  (1-of-3-counts; failed-health-only). Serializer-refusal pins cover the write path
  (`content.test.ts:269-274`).

### Info-1 — RESOLVED (arithmetic verified and empirically reproduced)

The record's per-file numbers are internally consistent AND reproduce exactly under the
reviewer's union run: mutations 11 + locator 7 + guard 5 + layout 65 + scope 5 + content 13
+ issue-layout 45 + gate 9 + projection 22 = **182 (9 files)**. Reviewer-only set
(= union minus issue-layout 45, minus 3 new tests pre-fix) = 137 now / 134 pre-fix;
implementer set pre-fix = 182 - 3 - 5 = 174, and 174 + 28 = the round-0 "202". Both sets
named per-file in the record. Fully reconciled.

### Info-2 — RESOLVED (hoist verified, no atomicity regression)

`module.ts:385` — the `open -> resolved` check now runs through the same
`isPermittedIssueTransition` gate with the same `issue_state_transition_refused` surface
BEFORE any write (record write at 490, state write at 500, both inside the same
`withWriteLock` closure — one serialized pair, unchanged discipline). The wedge state
(record durable against a refused transition) is no longer constructible.

### Info-3 — RESOLVED (freeze pin test)

"freezes what was accepted: a later conditions revision changes neither the record nor
done" — accepts under 0001 via the REAL gate evaluation + mutation (snapshot from the
evaluation, not hand-built), publishes 0002 with different content, commits both, re-reads:
phase stays `done`, record still names `0001` + 0001's digest, while `conditions.revision`
reads `0002`. Discriminates the latest-vs-accepted separation.

### Info-4 — RESOLVED (own codes; locale claim verified)

`issue_acceptance_from_file_required` + `issue_acceptance_conditions_list_required` in
`StoreIssueErrorCode` (`types.ts:81,83`), wired at `store-issue.ts:815,825`, mirroring
`issue_plan_from_file_required` (line 785). Locale spot-check: 0 hits in en/ja/zh-cn for
`issue_plan_from_file_required`, `issue_state_undefined`, and the new codes — error codes
carry no locale entries by design; nothing to sync.

### Info-5 — RESOLVED (weight + spacing)

- `vitest.config.ts:100-108`: weight raised to 200000 with both solo measurements cited
  (145128ms warm, 194524ms reviewer solo) and the enter-the-higher-observation rationale.
- `renderAcceptanceSection` now prints a leading blank line with the not-a-continuation
  comment (`store-issue.ts:413-415`).

### The four additional 30s-to-60s raises — ACCEPTED as legitimate headroom

Solo floors for those four tests measured 20-26s in the reviewer's round-0 run against 30s
budgets (5-10s headroom); today under ambient load the same tests measured 40-61s. The
raises restore the same 2-3x headroom class as the C2 parity precedent (27s solo -> 60s).
Zero assertion changes; solo durations did not regress between rounds (145s warm file
total vs 194s cold round-0). Not budget creep hiding a slowdown — the slowdown is ambient
and applies equally to untouched files. One accuracy nit: the fix record says "comments in
place", but the four raise sites carry no inline comment (only the two 90s tests do).

### Gates re-run this round (reviewer, real exit codes, no pipes)

- `pnpm build` -> exit 0; `validate issue-acceptance-close` -> valid, exit 0; fences
  (`src/core/pipeline-registry/`, `packages/ui`, both package.json) -> 0 diff lines.
- Units union (9 files, both sets' members): **182/182 passed, exit 0**; per-file counts
  match the record's prediction exactly.
- CLI (4 files): the fixer's full run and the reviewer's round-0 run were 28/28 exit 0.
  The reviewer's two full re-runs today each flaked 1-2 tests — all timeout class, zero
  assertion failures — and a third pass plus a solo run turned every affected test green
  (see Environmental note). Net: every one of the 28 tests has a green execution this
  round under the current tree.

### Environmental note (report-only; not charged to this change)

Three full-suite attempts under today's ambient portfolio load each hit 30s/60s global
budget timeouts in C2-era tests untouched by this round's delta:
`store-issue-start-cli.test.ts` "emits the frontier launch contract from a workspace index
entry" (3x at 30s; measured **27,933ms solo, exit 0** — 93% of the 30s global budget,
a pre-existing thin budget; the `start` path is untouched by C3), and
`store-issue-status-cli.test.ts` tests at 30s/60s (green on the confirming run), plus
secondary EPERM temp-cleanup errors from the timed-out fixtures (the documented Windows
flake class). Disposition suggestion for the operator, per the solo-measurement convention:
the frontier-parity test (and any status-cli test measuring within ~15% of budget) merits
an explicit budget raise in a follow-up — it is C2-file territory, deliberately not
touched by this round's delta.

### Surviving/accepted items after round 1

- Minor-1: RESOLVED (spec wording + pin; no code change needed).
- Minor-2: RESOLVED (full invariant set + genuine re-digest read test).
- Info-1..5: RESOLVED as above.
- Accepted: four 60s raises (legitimate headroom; inline-comment nit noted).
- New (Info, environmental): thin pre-existing budgets in C2 CLI tests flake under
  ambient load; recommend budget raises in a follow-up, report-only.
