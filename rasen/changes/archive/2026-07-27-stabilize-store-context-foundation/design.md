## Context

Children A–D2 of the `store-context-unification` portfolio are implemented,
shipped, and archived. Children E and F are proposed and deliberately unstarted.
This change corrects five defects the portfolio left in the foundation, all of
which Phase E would otherwise build on top of.

Two of the five were re-derived during planning and did **not** match the
predecessor's description. Both re-derivations are load-bearing, so they are
recorded here rather than left implicit.

### Re-derivation 1 — the resume defect has a different root cause

The predecessor's account was: the parent records delegated stages as `skipped`,
resume counts `skipped` as complete, so only `ship` remains. That is the *second*
half of the failure. The first half is what actually triggers it.

`rasen pipeline resume` already has a portfolio branch that takes precedence over
stage-based resume (`src/commands/pipeline.ts:576-628`). It did not fire. The
reason, reproduced directly:

```text
parsePortfolioState(portfolio-run.json)
  -> PortfolioStateValidationError:
     children.6.status: Invalid option:
       expected one of "pending"|"in_progress"|"done"|"skipped"|"escalated"
readPortfolioState(...) -> null
```

The portfolio's seventh child, `portable-project-knowledge`, carries
`status: "propose-done"` — a value the LEAD invented to mean "proposal complete,
implementation not started". It is outside the enum, so validation fails.
`readPortfolioState` catches every error and returns `null`
(`portfolio-state.ts:114-122`), and the caller treats `null` as "this is not a
portfolio". The parent therefore loses its portfolio identity entirely, falls
through to single-change resume, and only there does `completedStages` count the
five delegated-as-`skipped` stages as complete and leave `ship`.

This matters for the fix: **repairing `completedStages` alone would not fix this
bug**, because the correct behavior is that resume should never have reached the
stage-based branch. The fix has to start at the silent degradation.

There is a direct precedent in the shipped spec — `opsx-pipeline-registry`
already requires that resume "distinguishes invalid run-state from absent
run-state" for `auto-run.json`. The identical guarantee was simply never extended
to `portfolio-run.json`.

### Re-derivation 2 — the evaluation-root fallback, and which side is wrong

The predecessor recommended making the resolved project root the single fallback,
on the basis that `context.ts:770` uses `process.cwd()` while `effective.ts:487`
uses `project.root`. Checked against the shipped specs, the direction is right
but the stated reason is not, and taking the recommendation literally would
contradict a requirement that is already in `rasen/specs/`.

`learned-skill-effective-materialization` states: "When no session records a
checkout, the current directory SHALL be used, following the same precedence the
session runtime context states rather than a separate rule." Read alone, that
makes `process.cwd()` look correct and `project.root` look like the deviation.

The clause it defers to settles it. `session-runtime-context` requires resolution
in the order *explicit selector → session context → working directory*, and that
"a later step SHALL NOT be consulted once an earlier one has answered". By the
time either helper runs, an owner has **already been resolved** through that
order. `effective.ts` falling back to the resolved owner's root is therefore not
a separate rule — it is the outcome of the stated one. `context.ts` reaching for
raw `process.cwd()` is the actual violation: it consults the last step even when
an earlier step already answered, so a session that resolved its project by
explicit selector evaluates applicability in whatever directory the process
happens to sit in.

So the unification is: fall back to the resolved execution checkout, and let the
working directory answer only when no checkout was resolved at all — which is a
real case (a Store or global owner has no project checkout), not a dead branch.
Both specs are satisfied without amending either one's intent.

## Goals / Non-Goals

**Goals:**

- A paused portfolio cannot be resumed into delivery, and an unreadable portfolio
  record fails loudly instead of quietly changing what resume means.
- A decomposed parent can record delegation honestly.
- Frozen Store ownership survives a rename and distinguishes namesakes.
- The launch surface tells three distinct Store situations apart, in three
  languages, and states the limit of a planning-only grant.
- One rule for where applicability is evaluated.
- Nine archived task boxes tell the truth, and future gates are checkable.

**Non-Goals:**

- Any Phase E or Phase F behavior. Their unstarted state is intentional.
- Fixing the pre-existing suite failures documented below. They are provably not
  this portfolio's, and adopting them would widen scope into another session's
  work (see Decision 6).
- Rewriting durable records already on disk. Every migration in this change is
  read-time; nothing is rewritten in place.
- The repository byte guard, `docs/zh` debt, `RuntimeExecutionRef.home?`,
  `listStoreMemberCandidates`, and the final branch rebase. None is a
  prerequisite for anything here.

## Decisions

### D1 — An unreadable portfolio record is reported, never silently downgraded

`readPortfolioState` keeps its lenient signature for callers that legitimately
want "portfolio or not", but resume stops using absence and unreadability
interchangeably. Resume distinguishes three outcomes: no portfolio record
(single-change resume, unchanged), a readable one (portfolio frontier), and a
located-but-unreadable one (reported as unreadable, with the file path and the
validation reason, and **no** stage frontier offered).

*Alternative considered:* make `readPortfolioState` throw. Rejected — it is used
on paths where a missing or legacy record must degrade gracefully, and turning
every reader into a failure path would widen the blast radius well beyond resume.
The distinction belongs at the surface that acts on it.

This mirrors the existing `auto-run.json` requirement exactly, including the
`invalidRunState`-style reporting shape, so the two records behave alike.

### D2 — Unknown child progress normalizes to unfinished, and `proposed` becomes real

Two complementary changes, because tolerance and vocabulary solve different
halves:

- **Vocabulary:** child progress gains `proposed` — proposal complete,
  implementation not started. This is a state the portfolio genuinely has (it is
  what the LEAD was reaching for with `propose-done`), and it is non-terminal, so
  a `proposed` child keeps the portfolio incomplete.
- **Tolerance:** a child status the reader does not recognize is preserved under
  `statusRaw` and treated as **non-terminal**, following the `runtimeRaw`
  precedent already in `Host-tolerant run-state parsing`.

The safety property is the ordering of those two: tolerance means vocabulary
drift degrades to "not done" (safe) rather than "portfolio invisible" (unsafe).
An unknown status must never be able to make a portfolio look complete, which is
why it normalizes to non-terminal rather than being dropped.

*Alternative considered:* keep the enum strict and require the LEAD to write only
canonical values. Rejected — that is exactly the assumption that produced this
bug. A record written by a different LEAD, a newer version, or another runtime
must not be able to disarm a safety guard by using a word the reader has not
learned yet.

### D3 — `delegated` is a first-class stage state

`skipped` currently has to carry two incompatible meanings: "deliberately not
needed" (complete) and "handed to children" (outstanding). The parent's own
run-state says so in a `schemaNote`, calling the workaround "a real gap worth
closing in the pipeline-registry, not a fudge here".

Stage status gains `delegated`, counted as outstanding. Existing records that say
`skipped` keep parsing and keep their current meaning — this is additive, and no
file is rewritten.

Combined with D1 and D2 this gives defense in depth: even if a portfolio record
were absent entirely, a parent whose stages are honestly marked `delegated` still
cannot present `ship` as its frontier.

### D4 — Frozen Store identity carries permanent identity, read fail-closed

The durable vocabulary already exists and is already correct elsewhere:
`StoreIdentityRef` (`uid` required, display name optional) is what catalog
records are keyed on. Only the *frozen run* record still uses the alias-keyed
`{type:'store', id}` shape, because `ownerIdentity()` and `planningIdentity()`
drop the resolved `uid` on the way in.

The frozen context is already versioned (v1 planning+owner, v2 adds the execution
binding), so the migration path is the one the type was built for: a new version
carries durable refs; v1 and v2 records stay readable.

Reading a record that carries only a name is **fail-closed**, reusing the
`learned_owner_legacy_alias` refusal vocabulary that already exists for exactly
this situation: if the name resolves to exactly one Store, it resolves and the
run continues; if it resolves to none or to more than one, the run refuses and
names the candidates rather than picking one. Silently choosing a namesake is the
failure this whole item exists to prevent, so it is the one outcome not allowed.

`retain.ts` currently instructs runs to freeze `{type,id}`; that instruction is
updated in step, or the template would keep minting the shape being retired.

**Fail-closed is a READ-side rule only** — recorded here in review round 3,
because it is the load-bearing implementation decision this section originally
left unstated. `registerStore` / `commitStoreRegistration` mint no `uid` (only
`store setup` and `store upgrade-identity` do), so a Store registered from a
legacy root genuinely has no permanent identity to freeze. Refusing to freeze
against it would stop retain runs that work today, which is a regression this
change was never asked to make, and the Risks section below scopes the
fail-closed refusal to reads for exactly that reason. So `freezeKnowledgeContext`
writes the new durable version only when EVERY ref carries an identity, and
otherwise keeps the older name-keyed shape. Nothing becomes unwritable; the
hazard — silently choosing between namesakes — is caught on the read, where it
actually occurs.

The contract is therefore **conditional on the Store having an identity to
record**, and the `store-scoped-learned-skills` delta states it in exactly those
terms (LEAD adjudication, round 3): the obligation to record permanent identity,
its purpose clause, and the newly-frozen scenario are all scoped to a Store that
has one, with a sibling scenario specifying the uid-less case rather than leaving
it permitted by silence. What is **not** conditional — in the spec or here — is
the pair of guarantees this item exists for: a rename never re-targets a frozen
run, and namesakes never claim each other's runs. Those hold for *every* frozen
record, because a permanent identity resolves through a rename and past a
namesake while a name-only record refuses instead of guessing.

*Alternative considered:* rewrite existing frozen records on read. Rejected — a
frozen record is the authority for a run in flight, and rewriting it during a
resume changes the thing being resumed.

### D5 — The launch surface names three situations, not two

Today a Store with members that all lack local checkouts renders as a list of
disabled rows with no explanation, while the only explanatory message
(`members_empty`) is reserved for a Store with no members at all. The three
situations become individually addressable:

| Situation | Today | After |
|---|---|---|
| Members exist, at least one has a checkout | selectable rows | unchanged |
| Members exist, none has a checkout here | silent disabled rows | stated: known members, no checkout on this machine |
| Store has no members | `members_empty` | unchanged |

A disabled member row also gains per-row wording explaining *why* it cannot be
chosen, and the planning-only option states that it grants no permission to write
code — which `session-runtime-context` already requires the session to say, but
which the launch surface never surfaced at the point of choice.

Three new keys, added to `en`, `ja`, and `zh-cn` together. The locale files are
flat-keyed and held 378 keys each (20 under `dialog.launch.*`) when this was
written; after this change they hold 381 each, 23 under `dialog.launch.*`;
parity is checked, not assumed.

### D6 — The four `full suite green` gates: reworded, then settled against real evidence

This is the decision the task called out, so the reasoning is recorded in full.

The nine unchecked archived boxes are three different things:

| Kind | Count | Where |
|---|---:|---|
| Archive-merge rehearsal, **never performed** — settled by the completed archive instead | 4 | A 7.4, B 12.5, C 12.5, D1 10.5 |
| Literal `full suite green` gate | 4 | B 10.8, C 10.9, D1 8.5, D2 9.11 |
| Real implementation omission | 1 | C 9.4 (= the launch-surface work, D5) |

**Corrected in review round 1.** This table originally called the four
rehearsal boxes "performed but never ticked". That was wrong for at least two of
them, and the artifacts said so on their own lines: D1 10.5 records "deliberately
not run", and C 12.5 records "(deferred to the ship/archive stage)". Ticking them
against a later successful archive — better evidence of the same property, but
not the evidence the gate named — would have put a `[x]` beside a sentence
contradicting it, which is precisely what the `verify-ship-evidence` requirement
this change ADDS forbids: *"A gate SHALL NOT be recorded as met unless the
evidence it names was actually obtained."*

So all four get the same **restate-then-settle** treatment the four `full suite
green` boxes get, for the same reason and by the same mechanism: the original
wording stays visible, the gate is restated as the outcome the child was really
responsible for (*the spec merge for this change is proven to succeed*), and it
is settled against the archive commit that performed that merge — with the
substitution recorded rather than glossed. A 7.4 and B 12.5 carry no
self-contradicting text, but the classification is identical, so they are
treated identically rather than left as a second, quieter standard.

**The four gates cannot be ticked as written.** The suite is not green. Planning
anticipated three reproducible failures; the combined run found **four**. All
four are attributed below, and the authority for every attribution is
`combined-verification-A-D2.md`, which ships with this change:

- `test/release-contract.test.ts` — suite-level `SyntaxError`. Both the test and
  the module it imports (`scripts/release-contract.mjs`) are **byte-identical to
  the branch base commit `d73c1da2`** (`git diff d73c1da2..HEAD` over both paths
  is empty, and both are clean in the working tree). The failure therefore
  pre-exists the entire portfolio.
- `test/commands/handoff.test.ts` — a stale `maxRelays: 3` assertion.
  **Corrected in review round 2.** This bullet previously blamed
  `313df542 fix(workflows): make verification risk-proportional`, a
  concurrent-session commit. That is false, and this change's own evidence
  refutes it: `git show 313df542 | grep maxRelays` returns **no matches** (it
  touches four `rasen/specs/**` and four `src/core/templates/**` files, and
  `_orchestration.ts` is not among them). The literal actually left the playbook
  at `58faffad feat(ui): add threshold scheme management surfaces`
  (`git log -S "maxRelays: 3" -- src/core/templates/workflows/_orchestration.ts`),
  and `git merge-base --is-ancestor 58faffad d73c1da2` is **true** — so it
  pre-dates the branch base, not merely A–D2. Both the test and
  `_orchestration.ts` are byte-identical to base.
- The CLI locale case (`test/cli-e2e/basic.test.ts`) — an installed-skill
  version warning on stderr, an environment/fixture isolation issue rather than
  a product defect. The stamp `0.1.5-dev.local.1` exists nowhere in tracked
  source, so no commit here produced it.
- `test/commands/workset.test.ts` — the fourth, which planning did not
  anticipate. The known Windows temp-cleanup flake: 10s timeout plus `EPERM` on
  `rmSync` of a temp directory, byte-identical to base, and **41/41 in
  isolation**.

None was caused by A–D2. So there are exactly three honest options: fix debt that
belongs to other work (scope widening, and for the concurrent-session commit it
would mean editing another session's change mid-flight); leave four boxes
permanently unticked with no recorded resolution; or state the gate that was
actually intended in words that can be checked, and settle it against real
evidence.

**Chosen: reword, then settle.** Every one of those four boxes was written by a
child that then *deferred the run to the LEAD* — B, C, D1, and D2 each say so in
the task text itself ("the LEAD runs the full suite before ship", "the FULL run
is the LEAD's"). The gate's intent was never "this repository has zero failing
tests forever"; it was "this child did not break the suite". That intent is
checkable. The literal wording never was.

The four boxes are restated as: lint and build green, and one combined
verification run carried to completion in which **every** failure is individually
attributed to a cause outside this portfolio — proven either by the failing files
being byte-identical to the base commit, or by the failure tracing to a commit
that is not part of A–D2. They are ticked only against that recorded run. If a
failure appears that cannot be attributed that way, it is this change's failure
and the box stays open.

To stop this recurring, `verify-ship-evidence` gains the durable rule: a
completion gate SHALL name the evidence that settles it. "Full suite green" in a
repository with known unrelated failures is a gate no honest run can ever tick,
and writing one is what created this debt.

The four rehearsal boxes are reworded too, per the correction above: no
rehearsal is on record, so they are restated and settled against the completed
archive that superseded it. C 9.4 is not bookkeeping at all; it is settled by
doing the work in D5.

**No box is ticked next to a statement that is false.**

## Risks / Trade-offs

- **Reworded archived task text could read as covering something up.** →
  Mitigated by keeping the original wording visible in the restated line, citing
  the specific attribution evidence next to each tick, and recording the whole
  decision here rather than in a commit message. A reader can check every claim:
  the byte-identity check and the commit attribution are both one command.
- **Treating an unknown child status as non-terminal could strand a portfolio
  that is genuinely finished.** → Accepted deliberately. The two failure
  directions are not symmetric: reporting a finished portfolio as unfinished
  costs one correction, while reporting an unfinished one as finished is the
  premature-delivery defect this change exists to remove. Fail safe.
- **Fail-closed legacy identity reads will refuse runs that work today.** → Only
  where the recorded name is genuinely ambiguous or resolves to nothing, which is
  precisely the case where continuing would silently target the wrong Store. The
  refusal names the candidates so the user can resolve it explicitly.
- **The three locale files are being edited by a concurrent session right now.**
  → Only additive, key-scoped edits; re-check `git status` immediately before
  touching them; never stage unrelated hunks; never `git add -A`. If they are
  occupied at that moment, sequence the locale step and report rather than
  overwriting concurrent work.
- **The combined verification run is long.** → Backgrounded with bounded
  foreground polling at intervals of at most 270 seconds, in small serial
  batches, never concurrent vitest batches — concurrent batches have produced
  spurious timeouts on this repository before.

## Migration Plan

Every migration is read-time; no durable record is rewritten by this change.

1. Stage status `delegated` and child status `proposed` are additive. Existing
   records parse unchanged and keep their current meaning.
2. Unrecognized child statuses normalize on read, preserving the original under
   `statusRaw`. Nothing on disk changes.
3. Frozen knowledge context gains a version whose refs carry permanent identity.
   Older versions stay readable; ambiguous name-only records refuse rather than
   guess. A run frozen before this change continues to resume as long as its
   recorded name still resolves to exactly one Store.
4. Locale keys are added, never renamed or removed, so no existing string moves.

Rollback: each of the five items is independent and separately revertible. None
depends on another's data shape.

## Open Questions

- Should `rasen pipeline resume` also refuse a non-zero exit for an unreadable
  portfolio record, rather than reporting it at exit 0 as the `auto-run.json`
  case does? Kept consistent with the existing case for now — resume is a
  read-only reporting surface — but a delivery-blocking condition may warrant
  louder treatment.
- The parent portfolio record still carries the invalid `propose-done` value.
  This change makes the reader safe against it; whether the LEAD also normalizes
  the record itself is an orchestration decision, not a code one, and is left to
  whoever resumes the portfolio for Phase E.
