# Design: issue-acceptance-close

## Context

C1 (`issue-status-projection`) and C2 (`issue-execution-binding`) are landed: the tri-axis
projection reads plan + committed evidence + run-state (current root first, workspace index
second, `locatedBy` labelled), `rasen store issue start` resolves launch bindings, and the read
surface carries per-node attribution. The one interim rule left from C1 is the Done rule:
`resolved` alone derives `done` — a bare operator state flip — and nothing records what was
accepted or checks that the accepted work finished.

The mutation substrate is exactly three operations today (`store-issue-resources`:
create / setState / publishPlan), `resolved|dropped` are terminal states ("a terminal state
transitions nowhere, including to itself"), and the plan-revision machinery
(`src/core/store/issues/plans.ts` + `scope.ts` addresses + `withWriteLock` /
`allocateOrdinal` / digest / commit-suggestion flow in `module.ts`) is the proven discipline new
Issue content should mirror.

## Goals / Non-Goals

**Goals:**

- Acceptance conditions as strict, versioned, portable Issue content (conditions revisions).
- `rasen store issue accept`: gate-evaluated, honestly refusing, writing durable close evidence
  and closing the Issue.
- Done rewired: `resolved` + verified acceptance record ⇒ `done`; anything less reads as
  awaiting acceptance; archived counts never derive Done.
- The gate visible on `issue show` before it is crossed.
- A real dogfood proving HOLD-while-un-terminal and CLOSE-only-after-gate-passes.

**Non-Goals:**

- No re-open / re-accept lifecycle (`resolved` is terminal today; multi-acceptance arrives only
  if that lifecycle ever changes — the single-record shape is chosen to match it).
- No cross-project acceptance aggregation, no board/UI, no management-api routes.
- No machine verification of checklist items (conditions are statements with verification
  notes; the MACHINE gate is the derived node/health/problem state — the checklist's
  satisfaction is attested by the act of accepting, frozen with the gate snapshot).
- No state-vocabulary change (`open|resolved|dropped` stays; acceptance is evidence, not a
  fourth state), no version bumps, `src/core/pipeline-registry/` + `packages/ui/**` untouched.

## Decisions

### D1 — Two artifacts: conditions revisions, and one acceptance record

**Conditions revisions** (`acceptance/0001.yaml…` under the Issue directory): ordinal,
immutable, digest-carrying, `supersedes`-linked — the same discipline `plans.ts` implements,
reused rather than rebuilt (`allocateOrdinal`, digest-over-canonical-body, anti-overwrite
refusal). Each revision carries ≥1 condition: `id` (stable, unique within the revision),
`requirement` (text), optional `verification` note (how it was or will be verified). All text
passes `assertPortableIssueText` (no machine paths, no credentials — it becomes committed Store
content).

**The acceptance record** (`accepted.yaml`, its own layout address): one per Issue, never
rewritten. At-most-one is enforced by the existing lifecycle, not by new rules: `accept` on an
open Issue resolves it (terminal), and `accept` on a resolved-without-record Issue writes the
record without a transition (still terminal). It carries `acceptedAt`, the accepted conditions
revision id + that revision's digest (freezing WHAT was accepted against later revisions), the
gate snapshot (completed/total, health, problems-standing count of zero), optional note, and its
own content digest.

Rejected alternatives: an `acceptance:` field inside `issue.yaml` (bloats the deliberately
minimal record and drags checklist content through the state-mutation surface); acceptance
fields on plan nodes (acceptance is Issue-level and the plan schema would churn under C1/C2
readers); a fourth Issue state `accepted` (acceptance is evidence beside the close, not a
state; the three-state lifecycle and its transition table stay intact).

### D2 — Topology: mutations in `store/issues`, gate and orchestration in `issue-acceptance`

- `src/core/store/issues/acceptance.ts` — schemas, validation, digests, serializers, parsers
  for both artifacts (mirrors `plans.ts`/`records.ts`).
- `src/core/store/issues/module.ts` — two new mutations, `publishAcceptance` and `accept`,
  both under the existing `withWriteLock` + commit-suggestion discipline. `accept` takes the
  already-evaluated gate snapshot as input (portable facts only) and enforces the state matrix
  (D5); it performs no run-state reads.
- `src/core/issue-acceptance/` (new) — `evaluateIssueAcceptanceGate(status, acceptanceFacts)`
  (pure, closed blocker taxonomy) and `acceptIssue(...)` orchestrating read → gate → mutation.
  This is the C2 composition pattern, and it keeps the dependency direction clean: if
  `store/issues` imported `issue-status` for the gate, `store/*` would gain an upward edge into
  a top-level module that imports `store/query` — the exact direction C1 was cut to avoid
  (`query/issues-read` already imports the `issues` parsers, so the edge would close a
  package-level cycle).
- `src/core/issue-status/` extended in place (the one seam): input gains acceptance facts;
  `derivePhase`'s done rule is replaced; `IssueStatus` gains an `acceptance` block
  (conditions revision summary, gate evaluation, accepted record) for display.

### D3 — The gate rule and its blocker taxonomy

Eligible iff ALL hold, evaluated over the projection:

1. every required node's observation is `finalized | run-terminal` — the same
   work-complete rule C2 fixed for frontier readiness (not the query's archive-based
   `blockedBy`);
2. health ≠ `failed`;
3. `status.complete === true` and `status.problems` is empty (invalid run-state, unreadable
   plan, unresolved/ambiguous references, unsearched refs all hold the gate — an acceptance
   over unprovable facts is exactly the lie this change exists to prevent).

Blockers are named TOGETHER (one refusal lists every un-terminal node with its observation,
every node behind the failed health, and every open problem), never first-only. Structural
states are distinct refusals: dropped (`issue_accept_dropped`), already accepted
(`issue_accept_already_accepted`), no plan (`issue_accept_requires_plan`), no conditions
revision (`issue_accept_conditions_required`, naming an unreadable latest revision when that is
why). `waiting-human` health does NOT hold the gate — all-terminal work with an escalated
stage-record is impossible (escalation implies a non-terminal stage), so the only reachable
waiting-human at gate time is review-awaiting-acceptance, which is the human accepting.

### D4 — Done follows explicit acceptance; the compatibility story

New done rule: `record.state === 'resolved' && acceptedRecord reads back verified`. A
hand-planted or corrupted record fails its digest and is reported as a status problem — the
Issue presents `review`, never done-from-unreadable-bytes. A `resolved` Issue with no record
(the pre-capability close, including any existing store content) presents `review` with health
`waiting-human` — semantically exact: work complete, acceptance unproven — and `accept`
upgrades it in place (D5). Compatibility, stated once: Issue-record bytes are unchanged (no new
fields; old records valid as-is); the new content is additive files old readers simply do not
read; the single observable behavior change for existing content is that resolved-without-record
no longer reads `done`, and that change is spec-tracked (`issue-status-projection` MODIFIED).
C1's test asserting `resolved → done` is updated to the new contract, not deleted.

### D5 — The accept state matrix

| state | gate | outcome |
| --- | --- | --- |
| `open` | holds | write acceptance record + transition to `resolved` (one serialized mutation pair) |
| `open` | blocked | refuse, all blockers named; nothing written |
| `resolved`, no record | holds | write acceptance record only — the legacy upgrade; no transition attempted |
| `resolved`, no record | blocked | refuse with blockers (the Issue was closed early; the gate still tells the truth) |
| `resolved`, record present | — | refuse `already accepted` |
| `dropped` | — | refuse `dropped` — abandoned, not acceptable |

### D6 — Evaluate fresh, then write under the lock; the boundary is labelled

Gate evaluation is lock-free read composition (by design — reads never take the issue lock);
the mutation then serializes under `withWriteLock`. Between the two, run-state can move (a node
goes in-flight). The acceptance record's snapshot states the facts it was accepted under, so
the boundary is auditable rather than silently absorbed; making the store-locked writer read
machine-local run-state would break the store-purity the mutation module maintains. Documented
here rather than papered over.

### D7 — The snapshot carries portable facts only

Counts (`completed`, `total`), the health value, and problems-standing-as-zero — no paths, no
machine names. Portability rules identical to every other Issue content byte; a snapshot a
different machine cannot read would be a defect in a Store-level artifact.

### D8 — CLI surface mechanics (the C2 trap list applies)

`acceptance <issue-id> --from-file` and `accept <issue-id> [--note] [--store] [--json]` join
the `store issue` family; `show` gains the acceptance section (latest conditions with per-item
verification notes, the gate line — eligible or every named blocker — and the accepted record
when present). Adding subcommands is three-way sync: commander tree + en/ja/zh-cn locales +
completions `COMMAND_REGISTRY`, or `applyCliPresentation` fails at startup with 'visible
subcommand count differs'; CLI tests execute `dist/`, so a stale build masquerades as a code
bug — the build step is part of the test task, not a footnote.

### D9 — Dogfood: HOLD, then CLOSE (phases, receipts, honest boundary)

Phase A (rebuild, full trap list): OS-temp store; hand-declared `layoutVersion: 2`;
**rename the store's initial `master` branch to `main` before any plan publish** (C2 finding:
a `refs/heads/main` target line otherwise refuses every publish with
`store_query_ref_unreadable`); `add-project` (expect the `rasen/config.yaml` +
`.rasen-store/store.yaml` double write; clean both at teardown); explicit-list seeding with
ALL scalars quoted; issue + three-node plan.

Phase B (conditions receipt): `store issue acceptance issue-layer-phase1 --from-file` with
real conditions about this portfolio (projection shipped; binding loop proven; gate proven).

Phase C (HOLD receipt): from the WORKTREE cwd (execution root — live run-state visible),
`store issue accept issue-layer-phase1` → refused naming the un-terminal node(s) (g-003 is
in flight RIGHT NOW). Receipt: the refusal names the real node and observation.

Phase D (CLOSE receipts): seed the three children in the dogfood store as ARCHIVED entries
(outcome recorded — committed Store evidence, the honest substrate C1's dogfood already used
for active entries) and publish plan revision 2 naming those instances → all nodes `finalized`
→ `store issue accept` passes → record written, state resolved → `store issue show` reads the
acceptance block + `done`; `store issue list` line shows done; a second `accept` refuses
already-accepted. The failed-health HOLD is covered by unit tests over real-shaped run-state
fixtures (no real failure exists in this portfolio to receipt — fabricating one in dogfood
run-state would be theater; the unit fixtures are labeled as fixtures).

Phase E (teardown): trap-list teardown (`git restore rasen/config.yaml`, remove stray
`.rasen-store/`, delete temp tree); receipts under `evidence/`.

The LEAD's worktree guidance is noted: this dogfood needs no `issue start` / L6 route; if any
step ever wants an execution worktree, it is a FRESH temp one (the worktree-share rule pierces
to the main checkout — C2 finding 1).

## Risks / Trade-offs

- [Four spec files touched by one change] → every MODIFIED block is a full copy of the current
  requirement (post-C2 truth) edited in place; the RENAMED+MODIFIED combination on
  `store-issue-resources` follows the archived 2025-08-19 precedent (FROM/TO + full content
  under the new header).
- [Behavior change for legacy resolved Issues (done → review)] → deliberate, spec-tracked, and
  reversible by recording the acceptance; the upgrade path never re-transitions state (D5).
- [Evaluate-then-lock window] → D6 labels the boundary in the record itself.
- [Checklist satisfaction is operator-attested, not machine-verified] → the machine gate covers
  node/health/problem facts; the conditions freeze WHAT the operator accepted and the snapshot
  freezes the facts at the time — machine-verifying free-text conditions is a later phase's
  language problem, not a golden-path need.
- [Accept on a legacy-resolved Issue whose gate is blocked] → refused with blockers (the truth
  is more useful than a silent done); the operator can still see the gate on `show`.

## Migration Plan

Additive content + one derived-rule change; no data migration, no record-schema change, no
state-vocabulary change. Rollback = revert the commit; acceptance files are inert to old
readers. Existing `resolved` Issues read `review` after this change until accepted — the
compatibility story (D4) is the operator-facing note for that.

## Open Questions

None blocking. Deferred by design: re-open/re-accept lifecycle (needs a lifecycle change first),
cross-project acceptance aggregation, machine verification of condition text, and any
management-api/board surface for acceptance.
