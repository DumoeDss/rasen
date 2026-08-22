# Design — issue-ready-set-scheduling

## Context

The issue layer's Phase 1–4 chain already holds every ingredient the deterministic scheduler
needs, spread across three surfaces that each answer a slice of "what may run now":

- `src/core/issue-status/projection.ts` — per-node observations on the work-complete basis,
  with `withBlockerFacts` already listing each dependency whose observed work is not
  complete (the gate list, one writer, one basis);
- `src/core/issue-execution/binding.ts` — `isRunnable` (private): wanted ∧ `not-started` ∧
  every dependency work-complete; the frontier `store issue start` refuses among when
  several qualify;
- `src/core/issue-execution/confirm.ts` — the same classification recomposed per node into
  contracts / pending / waiting / unprepared.

What no surface answers is the set itself. And the Phase-4 close of Issue #3 exposed the
legacy-seed gap in the committed-evidence basis: `observeNode` finalizes a node only when
`archived && outcome !== null` (`projection.ts:453`), while `readArchiveEntry`
(`src/core/store/query/module.ts:411`) reports `outcome: null, legacyRecord: true` for every
archive entry that is not a valid schemaVersion-2 record — so work archived before v2 outcome
records existed reads `not-started` forever ("legacy-seed-reads-fresh"). The Issue #3 close
worked around it by hand-mirroring run-state to the archive-done truth; the scheduler this
change builds must not inherit that workaround.

Binding input facts (planning-context Phase-4 handovers): the legacy-seed ruling is THIS
change's to land (#1); the pinned-confirmation anchor (#2) stays deferred until a consumer
needs it; claimant-alias keying ownership (#3) is transferred untouched (see D6).

## Goals / Non-Goals

**Goals:**

- One deterministic ready-set derivation with one writer, consumed by the new read verb, the
  start frontier, and the confirm classification — the three surfaces cannot drift.
- The legacy-seed ruling landed read-side with its basis named honestly, pinned by the replay
  of the Issue #3 shape (seeded-legacy dependency releases downstream with no mirrors).
- Superseded/cancelled nodes exit the ready answer visibly, with their recorded reasons.
- Every non-member named with a closed reason vocabulary — nothing silently dropped.

**Non-Goals:**

- No Needs-Attention aggregation (g-003), no revision-history preservation semantics (g-002),
  no acceptance-gate changes — the gate already excludes `cancelled`/`superseded` since P2.
- No persisted confirmation anchor; the ready answer is read-composed and needs none.
- No change to the five Issue mutations; no new writer of any kind.
- No UI, no `src/core/pipeline-registry/` change, no version changes.
- Issue #4 dogfood authoring stays g-003's documented staging point; this change's byte tests
  run on temp stores only.

## Decisions

### D1 — The ready set is a projection post-pass (the one-seam fence)

`deriveIssueReadySet(status: IssueStatus)` lives in `src/core/issue-status/` beside
`deriveProjectLanes` and `deriveRevisionDelta`, consuming ONLY the projection output.
Membership is exactly: kind `change` ∧ lifecycle ∈ {`required`,`optional`} ∧ observation
`not-started` ∧ `blockedBy` empty. This is not a re-derivation: `withBlockerFacts` already
computes the work-complete gate list over the same observations `start` gates on, so
`blockedBy.length === 0` is propositionally identical to `isRunnable`'s dependency clause —
the projection IS the seam, and the ready set is its scheduling view. Alternatives rejected:
deriving from `detail.plan.readiness` (the query's archive-based basis — a second truth the
projection spec deliberately keeps apart); deriving inside `issue-execution` (would make the
read verb depend on launch machinery it does not need).

### D2 — One predicate, three consumers (compose, don't rebuild)

`binding.ts`'s private `isRunnable` and `confirm.ts`'s inline classification are refactored
onto the shared derivation: `start`'s candidate list becomes the ready set's members;
`confirm`'s launchable scope (fresh contracts + unprepared) becomes its members filtered
through launch-route resolution. The refactor is behavior-preserving for the FRESH-LAUNCH
partition — the frontier's refusal behavior and the fresh contract set are byte-stable,
pinned both ways by equivalence tests (`start`-candidates == members; confirm's fresh
scope == members) — per the fixture-coincides lesson, a shared predicate that three callers
merely *could* import is not one writer; the equivalence tests are what make drift
impossible.

One seam changes BY DESIGN (round-1 carve-out): a wanted node whose observation is anything
other than `not-started` no longer lands in confirm's waiting list when its dependencies
are incomplete — dependency gating applies to fresh launches, and a begun node is reported
as what it is (a resume-oriented or report-only contract, or an unprepared report),
matching the ready answer's running/complete exits. The pin-first discipline covered the
fresh-launch seam; this begun-node seam had no prior pin (the reviewer's round-1 probe is
what surfaced it) and now carries both a spec sentence in the confirm requirement's delta
and a covering fixture in the equivalence suite.

The invariant the equivalence rests on, named: `binding.ts` and `confirm.ts` TRUST the
projection rows' `blockedBy` as the dependency gate (one derivation, one truth source) —
they no longer recompute work-completeness from the observations themselves. Every
production caller feeds projection-derived rows (`withBlockerFacts` is the sole writer), so
the biconditional "`blockedBy` empty ⟺ every dependency's observed work complete" holds by
construction; synthetic fixtures that hand-plant rows must honor it (see fix-round-1's
prior-fixture disclosure).

Rejected: leaving `isRunnable` as a parallel copy "because it ships" — that is exactly the
second basis the portfolio was chartered to eliminate, and the ready-set requirement pins
the equivalence at spec level, so the code must satisfy it structurally.

### D3 — The legacy-seed ruling: archived-legacy reads complete, read-side, basis named

**Ruling: an archived Change whose archive entry carries a legacy record basis counts its
work complete for scheduling — observation `finalized`, with the legacy basis named in the
node's diagnostic. Nothing is minted at seed time.**

Rationale against the alternative (outcome-bearing seeds minted at seed time): minting a v2
outcome for legacy-archived evidence contradicts the landed stance that a relocated legacy
record "reports no outcome and is marked as legacy. Nothing is inferred, defaulted, or
upgraded: inventing `landed` to fill a column is exactly the lie the four-outcome model
exists to prevent" (`readArchiveEntry`'s contract, pinned by store-aggregate-query tests).
The no-inference rule governs the OUTCOME VALUE; it does not govern the ARCHIVE FACT. An
entry's existence under the v1 discipline is itself committed evidence the work story closed
— reading it complete invents no outcome name. A seed-time minting would also add a writer
to a path that today has none, and would bless the seeded bytes with an outcome the original
archive never recorded. Read-side ruling: no new writes, no byte changes, and the manual
run-state mirrors the Issue #3 close needed become inert the day it lands (they stop being
load-bearing; no cleanup required).

### D4 — The corrupt-record split: damaged bytes fail closed

`readArchiveEntry` today collapses four branches into `legacyRecord: true`: record absent,
unparseable JSON, `schemaVersion !== 2`, and schemaVersion-2 that fails `validateArchiveV2`.
Only the first and third are the legacy shape; a v2-shaped record that fails validation is
damaged evidence (tampering or engine bug — archive accounting is content-addressed), and
the repo's uniform discipline (invalid run-state → `unknown` + problem; unreadable plan → no
progress; unsearched refs → never absence) is that damaged bytes never gate-release.
Implementation: `readArchiveEntry` records which branch fired as an additive
`outcomeBasis: 'v2' | 'legacy' | 'invalid'` on `AggregateArchiveEntry`; `deriveReadiness`
threads it into the plan resolution (additive field beside `outcome`/`archived`); the
projection's finalized branch becomes `archived ∧ basis ≠ 'invalid'` — `legacy` finalizes
with the basis diagnostic, `invalid` reports `unknown` with the new `invalid-archive-record`
problem kind naming the file and reason. Display semantics of `legacyRecord` are untouched
(no aggregate-query behavior change); the basis is machine-facing enrichment for the
scheduling consumer. The query's own `readiness`/`blockedBy` fields stay archive-outcome
based — the two-bases-by-design split the projection spec already pins
(`readyToResolve` feeds the acceptance truth, not the scheduling truth).

### D5 — The read verb: `rasen store issue ready <issue-id>`

Read-only, latest revision only (no `--revision`: the scheduler schedules the latest;
addressing an older ordinal is `show`/`confirm`'s concern), refuses toward planning on no
readable revision with the same refusal shape `start`/`confirm` share. Human and `--json`
forms carry the same facts: ready members (node id, project, line, alias, suggested pipeline,
optional lifecycle), every non-member with its reason from the closed vocabulary, the
run-state visibility label, and the status problems. Exit-reason rendering reuses
`issueBlockerState` for blocker states so the ready answer and the node lines share one
vocabulary. Locale strings sync in en/ja/zh-cn and completions in the three sync files, per
the command-surface obligations `confirm` established.

### D6 — Handled handovers and transferred questions

The pinned-confirmation anchor (handover #2) stays deferred — the ready set is read-composed
and needs no anchor; the D6 rejected-alternatives record in the review-flow archive remains
its design input when a consumer appears. Claimant-alias keying (handover #3): NOT decided
here — this change does not touch the run-state locator, and the ruling removes the
scheduler's need for mirrors on terminal-legacy nodes; the remaining mirror pressure is
active-node visibility, which stays on the LEAD ledger for g-003. Superseded history
preservation (g-002) consumes what this change exposes: the exit reasons make the
superseded/cancelled exit visible; preserving old-node observations across revisions is the
next child's deliverable.

## Risks / Trade-offs

- [The `binding.ts`/`confirm.ts` refactor touches shipped verbs] → Equivalence tests land
  FIRST as a commit (pinning current behavior), then the refactor must keep them green
  without editing their assertions; any behavioral delta surfaces as a test diff, not as a
  regression in flight. Round-1 carve-out: the pins covered the fresh-launch seam; the
  begun-node seam (a begun node with incomplete dependencies moving from `waiting` to its
  per-node resolution) changed by design and was pinned after the fact — the disclosure
  lives in D2 above and fix-round-1.
- [`archived ∧ basis ≠ 'invalid'` widens who reads `finalized`] → The widening is exactly
  the set of entries that today read `not-started`-forever; a corrupt v2 record previously
  ALSO read fresh (and gated forever) — after the change it still gates (unknown), so no
  gate ever opens that did not; the release surface grows only by the legacy basis the
  ruling names. Pinned by the fail-closed test and the equivalence suite.
- [Threaded basis field is additive on query-facing types] → Wire/CLI consumers see a new
  field; no consumer narrows on it today; `legacyRecord` display semantics unchanged; no
  stored-format change, so no digest or migration surface.
- [The visibility hazard predates this change] → A node running on another machine reads
  `not-started` from an unrelated directory and is ready-set eligible — identical to what
  `start`'s frontier does today, and the answer labels run-state visibility so the operator
  knows which machine's view it is. Changing machine-truth semantics is out of scope and
  unnamed by the roadmap.

## Migration Plan

None required: no stored format changes, no schema migration, no writer added. The change is
a read-surface widening plus a behavior-preserving refactor; rollback is revert of the
commit. Existing stores read identically except that legacy-archived nodes now report
`finalized` with the basis named (the intended ruling) and corrupt v2 archive records report
`unknown` + problem (previously read fresh — a stricter, fail-closed change).

## Open Questions

None blocking. The transferred questions (confirmation anchor, claimant-alias keying
ownership) are recorded in D6 with their owners; both stay outside this change's fences.
