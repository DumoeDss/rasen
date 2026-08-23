# Design — issue-deferral-record

## Context

The lifecycle vocabulary lives in one place (`ExecutionPlanNodeLifecycle`,
`src/core/store/issues/types.ts:155`) and is consumed through TWO different check shapes,
and that difference is the whole design:

- **Positive checks** — `isWanted` (`required || optional`) in `projection.ts:661`,
  `attention.ts:55`, `ready-set.ts:38`, `issue-execution/binding.ts:65`, `confirm.ts`;
  `isRequired` (`required` only) for progress and lanes; the review view's
  `node.lifecycle === 'optional'` at `review.ts:151`. A fifth value falls OUT of all of
  these automatically: phase, health, attention, review threads, ready membership, the
  start frontier, and the confirm scope need zero logic changes.
- **Negative enumerations** — `lifecycle === 'cancelled' || lifecycle === 'superseded'` in
  the gate's `lifecycleAccounting` and failing-node skip (`gate.ts:68,176`), the ready-set
  exit ladder (`ready-set.ts:54-55`), the `--node` refusal (`binding.ts:299`), the plans
  schema reason conditional (`plans.ts:209`), and the record exclusion enum
  (`acceptance.ts:124`). A fifth value falls THROUGH all of these — and two of the
  fall-throughs are lies waiting to run: a deferred node's ready exit would read "blocked"
  with zero blockers, and `--node` on a deferred node would emit a real launch contract.

g-002 shipped three findings this change must honor: the optional-open seam is in place
(dissolve the thread by lifecycle, never by a new determination branch), the gate's refusal
codes shadow in order (add none), and the accepted-with-null-facts behavior is pinned (touch
nothing near it).

## Goals / Non-Goals

**Goals**

- An explicit, recorded, honest spelling for "postponed beyond this Issue" on Change nodes.
- Deferral never holds Done; deferral is always on the books (revision, gate account,
  acceptance record).
- Every surface that would otherwise lie about a deferred node names it instead (ready exit,
  start refusal).
- Zero new blocking bases; zero determination or thread vocabulary growth in the review view.

**Non-Goals**

- No un-defer verb, no deferral history query, no "deferred until" date: the plan revision
  chain IS the history, and restoring the work is publishing a revision that wants it again.
- No intent-node deferral (see D1). No dependency rewiring on deferral (see D5).
- No new command, flag, or store file; no wire/locale/completions/template churn; frozen
  zones untouched.

## Decisions

### D1 — `deferred` is a fifth Change-node lifecycle with a mandatory reason

`ExecutionPlanNodeLifecycle` widens to
`'required' | 'optional' | 'cancelled' | 'superseded' | 'deferred'`. Meaning: work the Issue
still intends but explicitly postpones beyond this Issue's completion — postponed, not
abandoned (`cancelled`) and not replaced (`superseded`). Mechanics are deliberately identical
to the other two not-demanded values: Change-node-only, mandatory portable-durable `reason`,
stored in the canonical form (only `required` is omitted), changed only by publishing the
next revision.

Intent nodes keep their two-value vocabulary. The existing rationale extends cleanly: the
reason-bearing values explain work that EXISTED as a Change; intent work no Change ever
backed is postponed by keeping it `optional` or omitting it from the next revision, and a
postponement worth a durable reason implies the work was real enough to be a Change node.
Refusal messages name `deferred` beside `cancelled`/`superseded` in the intent-node branch.

The plans schema's one conditional extends: `deferred` without a reason is refused;
a reason on `required`/`optional` stays refused, with the message reworded from "work the
plan no longer wants" to "work the plan does not demand toward Done" — `deferred` work is
still wanted eventually, so the old wording would become false the moment the value exists.

### D2 — One family, not a new axis: the not-demanded family absorbs deferred through existing checks

For the gate and every projection axis, `deferred` joins `cancelled`/`superseded` in the
not-demanded family, and almost all of it is free: the positive `isWanted`/`isRequired`
checks already exclude any non-`required`/`optional` value, so phase (`active`/`ready`
scan wanted nodes), health (failure/waiting signals come from wanted nodes), progress and
lanes (required-scoped), attention (wanted-scoped), ready membership, the start frontier,
and the confirm scope all treat a deferred node as outside the execution graph with NO code
change. Its observation stays reported on its node line — outside the graph, still observed —
exactly the history-preservation rule cancelled/superseded already follow.

The two gate edits are in `gate.ts` only: `lifecycleAccounting` routes `deferred` into
`exclusions` (widening `IssueAcceptanceGateExclusion.lifecycle` and the store-level
`AcceptanceRecordExclusion.lifecycle` to the three-value union), and the failing-node loop
adds `deferred` to its skip so a deferred node's recorded failure is never named a blocker.
The semantic distinction from `cancelled` is carried by the word itself everywhere the
exclusion surfaces — that is the point of the vocabulary: the reviewer reads
`excluded <node> (deferred): <reason>` and knows the work moved out, not away.

### D3 — 记录在案: three durable surfaces, no new store shape

"Deferral does not block Done but is recorded" lands on three existing surfaces:

1. **The plan revision** — the deferral IS an immutable revision naming `deferred` + reason;
   the revision delta already reports lifecycle changes generically (`from`/`to` over the
   widened union — free).
2. **The gate account on every read** — `renderGateLine` renders `gate.exclusions`
   generically; a deferred exclusion prints with its reason on eligible and blocked
   evaluations alike, in human and `--json` forms. Free once the gate emits it.
3. **The acceptance record** — `RecordExclusionSchema`'s lifecycle enum gains `'deferred'`;
   the digest body, absent-when-none canonical form, duplicate-node refusal, and
   portable-text validation are shape-generic and unchanged. A deferral that stood at
   acceptance is frozen with node, lifecycle, and reason forever.

`renderStatusNode` already prints `(<lifecycle>: <reason>)` for any non-required node — the
node line names the deferral with no edit.

### D4 — The review seam: dissolve by lifecycle, add nothing (g-002 findings honored)

`review.ts` is not edited. `optional-open` fires on `lifecycle === 'optional'` positively,
so publishing the revision that defers a node dissolves that node's thread; a deferred node
is not `wanted`, so no attention-derived thread names it either. No `deferral` thread kind
is added: threads are the facts the gate excludes FROM VIEW, and a deferral is already fully
presented in the acceptance section's exclusion account — copying it into threads would be
the same anti-pattern g-002 rejected for `problem` items (presented twice reads as blocking
nowhere). The determination mapping is untouched: no new gate refusal code exists (the
refusal ORDER and its shadowing are byte-identical), and the accepted/null-facts pins stand.
All of this is pinned by tests and one added spec scenario, not by new branches.

Two honest leftovers stay as they are: a deferred node whose work already ran to terminal
without archiving still surfaces `archive-pending`, and an archived-then-deferred node's
`evidence-missing`/`record-absent` threads still fire — those threads are lifecycle-blind
recorded facts about delivery evidence, and hiding them for deferred nodes would un-name
real facts.

### D5 — Named exits where fall-through would lie

- **Ready set**: `IssueReadyExit` gains `{ kind: 'deferred', reason: string | null }`,
  checked in the exit ladder beside cancelled/superseded (before the observation switch).
  Without it a deferred not-started node reads `blocked` with an empty blocker list.
  `renderReadyExit` gains the matching case (`deferred (<reason>)`).
- **Start**: `IssueStartRefusal` gains `issue_start_node_deferred`; `binding.ts` refuses an
  addressed deferred node before any launch machinery, naming the lifecycle and reason, and
  the not-runnable reasons list names deferred nodes like cancelled ones. `refusalFix`
  reuses the existing lifecycle-refusal fix text ("re-publish a revision whose lifecycle
  wants it"). The command layer renders refusals generically — no CLI edit.
- **Dependents**: a node depending on a deferred node stays blocked with the dependency
  named on its line and in its exits — inherited cancelled-dependency semantics, correct
  and honest: deferring upstream work without re-edging or deferring its dependents is a
  plan inconsistency the read surface must show, not absorb. The revision that defers is
  where the operator re-edges; nothing implicit happens.

### D6 — Compatibility is fail-closed in the old direction, byte-stable in the new

New build, old bytes: absent lifecycle still reads `required`; four-value revisions,
pre-field acceptance records, and no-exclusion records parse and re-derive their digests
byte-for-byte (enum widening is read-additive; canonical forms untouched). Old build, new
bytes: a revision or record carrying `deferred` fails its closed-vocabulary validation and
reports its named problem (`unreadable-plan` / `unreadable-acceptance`) — fail-closed, the
same class as every prior vocabulary widening, and the reason vocabulary widenings ride
minor releases with the store dogfooded first.

## Risks / Trade-offs

- **Six MODIFIED deltas, zero ADDED** — archive-time delta application touches six specs in
  one change. Mitigated by strict discipline: requirement titles and existing scenario
  bodies byte-verbatim, new scenarios appended only, and a pre-ship `validate` plus archive
  dry-run expectation in tasks.
- **A deferred REQUIRED node is expressible** — lifecycle authoring is per-revision, so an
  operator can defer work that was `required` in the predecessor. This is intended (deferral
  is descoping-with-record; the revision delta shows `required → deferred`), but it means
  deferral can change the required total between revisions exactly as cancellation can. The
  gate account explains the smaller total; no cross-revision guard is added.
- **No un-defer affordance** — restoring deferred work is publishing a revision that wants
  it. Cheap by design; documented in refusal fix text rather than a new verb.
- **Template prose staleness** — `_orchestration.ts` illustrates "never cancelled/superseded"
  when scoping confirmed work; the normative phrase "required and optional only" already
  excludes deferred, so the sentence stays true and the template (with its hash/pipeline-pin
  coordination tail) is consciously left untouched this change.

## Migration Plan

None required. No stored byte changes shape; no index, wire, or config migration. Ship, then
the vocabulary is available to new revisions; existing stores are unaffected until an
operator publishes a deferral.

## Open Questions

None blocking. Whether intent nodes should someday admit `deferred` is explicitly deferred
(the omit-or-optional spelling covers today's cases); revisit only if a real plan needs a
recorded intent postponement.
