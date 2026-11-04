# Review report — issue-needs-attention (VERIFY, child 3/3, portfolio finale)

Reviewer: independent verifier leg, 2026-08-22. Worktree `feat/issue-phase5`
(delta uncommitted on `ef6e70cf`). Persistent store `issue-registry` treated
READ-ONLY throughout (verified clean after every read). Canonical severities
(Blocker/Major/Minor/Trivial).

## Verdict

**PASS — 0 Blocker, 0 Major, 0 Minor, 3 Trivial (observations, none blocking).**

## 1. Unit-test gate (real exit codes, node-spawn, dist rebuilt first)

| Batch | Files | Tests | Exit |
| --- | --- | --- | --- |
| New suites: `test/core/issue-status/issue-attention.test.ts` + `test/commands/store-attention-cli.test.ts` | 2 | 19 passed (13 + 6) | 0 |
| Full family `test/core/issue-status/` + `test/core/issue-acceptance/` | 18 | 113 passed | 0 |
| Locale/completions trio: `test/locales/catalog.test.ts` + `test/core/completions/` + `test/core/cli-presentation.test.ts` | 13 | 338 passed, 13 skipped (pre-existing) | 0 |
| Store CLI family: `store.test.ts`, `store-aggregate-cli`, `store-issue-cli`, acceptance ×2, lifecycle, confirm | 7 | 79 passed | 0 |
| `pnpm build` (before CLI runs; restored clean at the end) | — | — | 0 |

Counts match the implementer's `local-gates.md` exactly on tests (113 / 6 /
338+13skip); see Trivial-1 for the one file-count off-by-one in that table.
Logs: worktree `.rasen/rev-*.log`.

## 2. Live Issue #4 verification (persistent store, read-only)

- `store attention --store issue-registry` (human, exit 0; json, exit 0):
  `4 Issue(s) scanned`; `issue-cross-project-replanning: active/healthy — 0
  item(s)`; the three sibling Issues `done/healthy — 0 item(s)`; run-state
  located by execution-root = this worktree; honest empty state ("none need
  attention — 4 Issue(s) scanned, zero items"); "wrote nothing" line present.
  Human and json carry the same facts (scannedCount 4, total 0, counts zeros,
  items []).
- `store issue show issue-cross-project-replanning` (exit 0): phase `active`,
  health `healthy`, progress **2/3**, nodes — finale `in-flight`, both shipped
  children `finalized` **each with diagnostic "finalized on a legacy archive
  record (no v2 outcome was ever recorded)"**, problems `[]`. Attention's
  active/healthy/0-items agrees fact-for-fact with show — the
  composition-reuse claim holds in bytes, not just in design: the verb calls
  `resolveProjectionContext`/`resolveStoreWideningContext`/`statusInputFor`/
  `resolvePredecessorPlan` exported from `src/commands/store-issue.ts`
  (store-issue.ts:266-365) and composes `readIssueAcceptanceFacts` exactly as
  `show` does (store-issue.ts:1085-1103 vs store.ts attention action).
- No acceptance record exists: `acceptance.record = null`; gate message reads
  "not accepted yet — node issue-needs-attention is in-flight" — the close is
  staged (conditions revision 0001 store-side), not executed. Correct per D5.
- Store git: exactly the four documented dogfood commits on top
  (2065262 seed / 7ef1bc8 open+plan 0001 / a671b54 plan 0002 / 2b3afab
  conditions 0001), working tree clean before and after my reads.

## 3. Claim sweep

- **Five kinds + unmasking**: failure item carries `active`+`failed` beside
  the node while siblings run (unit "a failed node among running siblings…"
  + CLI integration spine + temp-store receipt-6, which I re-derived from the
  keeper suite's fixture shape); kind order fail-first, stable within group
  (unit ordering pin; CLI asserts exact item arrays AND that the failure line
  precedes the waiting-human line in the human form).
- **blocked-behind is one hop with the blast-radius rule**: direct blocker
  failed/waiting-human/unknown ⇒ item naming every non-terminal direct
  dependency; direct blocker not-started or healthy in-flight ⇒ no item even
  when a grandparent failed (unit boundary suite, both branches pinned; the
  deeper hop lists itself — asserted in the same tests).
- **waiting-human/acceptance-awaiting distinct**: review-phase end-to-end CLI
  test (terminal node + published conditions → one `acceptance-awaiting` item,
  phase `review`, health `waiting-human`, gate `eligible` with conditions
  revision carried; human line exact-match asserted). Parked stage is its own
  kind on the node axis.
- **Problems carried, none dropped**: derivation iterates `status.problems`
  verbatim (attention.ts:130-139); unit test pins three representative kinds
  including an Issue-level (`node: null`) problem. See Trivial-2.
- **Absence discipline**: healthy in-flight contributes nothing but the scan
  summary lists the Issue (live receipt above — the exact "scanned and
  honestly unlisted" case); serial-wait and ready/terminal nodes pinned
  excluded; empty state says "N Issue(s) scanned, zero items" — verified live
  and in the all-healthy CLI test.
- **No caching / no second mutable truth**: no memoization anywhere in
  attention.ts or the store.ts action; each scan recomposes every Issue; the
  determinism test (same scan twice, deep-equal) and my two live invocations
  agree.
- **Honest corrections verified**: implementer-finding #1 is right and the
  receipts say so — both seeded children's repo-side archive.json are
  v1-shaped, and my live show carries the legacy-basis diagnostic on both
  children ("finalized on a legacy archive record (no v2 outcome was ever
  recorded)") — g-001's ruling working as designed, not a defect; no v2
  outcome record was forged. Finding #4 (only portfolio records produce
  `failed`) is confirmed by the fixture using `writePortfolioState` with an
  escalated child as the failure signal.
- **Export-only diff on store-issue.ts**: the entire diff is four `export`
  keyword additions + one doc-comment block (verified hunk by hunk); the
  113-test family + 79 store-CLI tests green are the behavioral proof.
- **Fences byte-empty**: `git diff ef6e70cf --name-only` is exactly the
  sanctioned set (src: attention.ts + types/index barrels + store.ts +
  store-issue.ts + command-registry.ts + 3 locales; tests: 2 new + 2
  extended; architecture-index 3 files). No `packages/ui/`, no
  `src/core/pipeline-registry/`, no `package.json` (no version bump).
- **New capability's spec is its own**: no `issue-needs-attention` under
  `rasen/specs/`; none of the four requirement titles collide with any
  existing spec (grep-swept); every requirement's first body sentence carries
  SHALL (4/4); `rasen validate` green per evidence.

## 4. Fixture-coincidence spot-checks (mutations, real exit codes)

- **Mutation A — kill the failure-leads ordering** (`ISSUE_ATTENTION_KIND_ORDER`
  with `waiting-human` ranked before `failure`): unit ordering test FAILS
  (1 failed / 12 passed, exit 1) and the CLI unmasking receipt FAILS
  (exit 1). The ordering is load-bearing in both layers.
- **Mutation B — widen blocked-behind to two hops** (trigger also on a
  grandparent's trouble through an ordinary direct blocker): the blast-radius
  boundary test FAILS (1 failed / 12 passed, exit 1) — the one-hop rule is
  pinned, not decorative.
- Original restored (byte-copy), dist rebuilt, both suites re-run: 19/19
  passed, exit 0. Worktree left on the pristine delta.

## Findings (all Trivial)

1. **Trivial (evidence bookkeeping)** — `local-gates.md`'s family row says
   "17" files for the issue-status + acceptance family; the actual count is
   18 (15 + 3). Test count (113) matches exactly. No action required for
   ship; correct the number if the table is ever revisited.
   (`evidence/local-gates.md`, first table row.)
2. **Trivial (coverage observation)** — no dedicated pin feeds
   `invalid-archive-record` through `deriveIssueAttention`. The carry is
   structurally total (the problem loop iterates `status.problems` verbatim)
   and the projection side is pinned in
   `test/core/issue-status/issue-status-legacy-archive-ruling.test.ts:343`,
   so this is a gap in directness, not in truth. A Phase 6 attention test
   that stages an invalid archive record end-to-end would close it.
3. **Trivial (semantics note for Phase 6)** — `--issue` refusal is keyed on
   `listIssues` membership; an Issue that exists only inside an unsearched
   ref is refused as unknown. This is honest under the spec's "an identifier
   the Store does not know" (the answer carries `unsearchedRefs`/`complete`
   so the incompleteness is visible), but operators narrowing on a large
   store with unsearched refs should read the refusal as "not visible to this
   scan", not "does not exist". No code change requested.

## Bottom line

The change is what the proposal claimed: one closed five-kind vocabulary
derived purely from the projection, a store-level read verb that literally
reuses show's composition seams, absence discipline stated and tested as
truth, the unmasking guarantee structural and mutation-verified, and an Issue
#4 dogfood whose receipts match the live store byte-for-byte — including the
honest legacy-basis correction. Ship-ready from this review's side.
