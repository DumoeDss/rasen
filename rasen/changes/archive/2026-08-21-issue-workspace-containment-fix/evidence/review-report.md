# Review report: issue-workspace-containment-fix (VERIFY, independent)

Reviewer: reviewer-p2 (dispatched verifier). Date: 2026-08-21. Base: `40551f92`, delta
uncommitted on `feat/issue-phase4`. Report-only.

Tree fingerprint at review time: HEAD `40551f9235e334b0ebba631d24179e1cadc4cacf`;
`git diff 40551f92` sha256 `be45259af5de8926fbf0327e874d2f1dff9cba7bf22d6b6b7f4df518dfa29423`;
blobs `plan.ts 66039447`, `workspace-plan.test.ts 78166878`, `workspace-apply.test.ts 98126d63`.

## Verdict

APPROVED for ship. 0 Blocker / 0 Major / 1 Minor / 2 Info. All gates green under my own runs.

## 1. Unit-test gate (numbers I ran, real exit codes)

`pnpm run build` first: exit 0.

Delegated store-family leg (`test/core/store/`, all 80 `.test.ts` files — split into 4
invocations after the 10-min single-run timeout; `comm` against the directory listing shows
zero files missed):

| Batch | Files | Tests | Exit |
|---|---|---|---|
| b-f (bootstrap/finalization/foundation) | 17 | 381 passed | 0 |
| g-l (git/identity/layout-migration/legacy) | 19 | 282 passed, 1 skipped | 0 |
| m-p (membership/migration/planning) | 13 | 360 passed, 1 skipped | 0 |
| r-w (registry/remote/store-*/target/workspace-*/worktree) | 31 | 461 passed | 0 |
| **Total** | **80** | **1484 passed, 2 skipped** | **all 0** |

Both skips are pre-existing suite skips in files untouched by this delta
(`layout-migration-plan-gates.test.ts`, `project-records.test.ts`). Zero failures to enumerate.

Implementer's named-set numbers reproduced independently: workspace-plan 24, workspace-cleanup
26, workspace-apply 19, workspace-windows-paths 23 (store family), workspace-cli 14
(`test/commands/workspace-cli.test.ts`, exit 0) — 106/106 green as claimed. Locale leg:
`test/utils/locale.test.ts` 42 + `test/core/cli-locale.test.ts` 4 +
`test/core/config-diagnostic-locale.test.ts` 4 = 50 passed, exit 0. The "trio" membership
(claimed 18) was not identified exactly; every candidate suite I ran instead is green
(finalize-scope 14, store-planning 39, workspace-migration 5, workspace-manifest 4 = 62, exit 0).

## 2. Claim sweep

- **One-case discipline: CONFIRMED.** The exemption lives at the veto call site
  (`plan.ts:595-598`), keyed to `side === 'execution' && executionSide.facts.linked === false
  && samePath(root, repositoryRoot, flavor)`. `identity.ts` is byte-untouched
  (`git diff 40551f92 -- src/core/store/workspace/identity.ts` = 0 bytes). The other
  `isContainedIn` callers keep equality-as-inside: marker checks (`plan.ts:567,569`),
  `pair-roots-disjoint` (`plan.ts:621-622`), discovery (`module.ts`, `scope.ts` — files not
  in the diff). Consistency proven: `samePath(a,b)` implies `isContainedIn(a,b)` (empty
  relative), so the `!blessedMainCheckout` carve-out removes exactly the equality case.
- **Both directions pinned: CONFIRMED.** The strengthened test asserts the whole applicable
  face (`applicable`, empty `blockers`, token, `disposition: 'reuse'`, blessed containment
  detail) plus a new alias-spelling test; the nested refusal test (both sides) is unchanged
  and green. Mutation A below proves the first has teeth; mutation B'' proves the second does.
- **Normal-case bytes: CONFIRMED.** The outside/strictly-inside detail template literals are
  byte-identical in the diff (only source indentation of the ternary changed); pinned-token
  tests green in every run. Dogfood receipt shows `samePath` canonicalization was
  load-bearing in practice (`execution.repositoryRoot` printed forward-slash by git vs the
  backslash root spelling — still blessed).
- **Dogfood receipts: MATCH CLAIMS.** All five read: direction 1 `applicable: true`, all 9
  preconditions satisfied, blessing detail verbatim; direction 2 `applicable: false`,
  `execution-root-outside-repository` blocker code `workspace_destination_exists` with the
  nesting rationale byte-identical to the veto string at `plan.ts:607`, plus totality
  (`execution-destination-available`); apply state file pins HEAD/ref unchanged, status gains
  exactly `?? .rasen/`, worktrees still 1, association document present with correct facts.
- **Fences: CONFIRMED.** `git diff 40551f92 -- src/core/pipeline-registry/ packages/ui
  package.json` = 0 bytes. Diff is exactly 3 files (`plan.ts` + 2 test files).
- **Spec deltas: byte-stable titles.** Both requirement headers and all existing scenario
  titles byte-identical to `rasen/specs/store-planning-worktree-bindings/spec.md`; 4 scenarios
  ADDED (2 + 1), none renamed/removed. `rasen validate issue-workspace-containment-fix`:
  exit 0, valid.

## 3. Fixture-coincidence mutation spot-checks (all mutations reverted; hashes re-verified)

| Mutation | Result | Meaning |
|---|---|---|
| A: remove the exemption (`inside` unconditional) | 2 fail — both strengthened main-checkout tests, `applicable` false | The fix is pinned; nesting guard unaffected (correct) |
| B: drop `linked === false` key only | 0 fail (24/24 green) | Conjunct unpinned — see Info-1 |
| B': drop `samePath` key only | 0 fail (24/24 green) | Same reason — nesting fixtures never reach equality |
| B'': drop both keys (bare `side === 'execution'`) | 1 fail — "refuses a planned root inside its own repository checkout" | The conjunction is pinned; nesting guard has teeth |
| C: helper change (`identity.ts` equality no longer inside) | 1 fail — "refuses a pair whose two roots are the same path or nested" (83 tests, 4 files) | Helper semantics pinned via pair-roots-disjoint |

Correction to the dispatch's expected mutation outcomes: dropping the `linked === false` key
does NOT redden a nesting test (nesting fixtures are linked worktrees or occupied non-worktree
dirs, so `samePath` is false for them and the veto survives either single key), and a helper
change is caught by the pair-roots test, not by a digest pin (the blessed case's plan bytes are
computed from `samePath`, so mutation C cannot alter them). Both dispatched hypotheses are
disproven in their literal form; the underlying properties they wanted demonstrated ARE proven
by A / B'' / C as run above.

## Findings

### Minor-1: applicable surface widens to any repository's main checkout, including one nested inside another repo's checkout

`executionRepositoryFor` (`plan.ts:383-389,436-446`) derives `codeRepositoryRoot` from the
execution worktree's OWN repository, so `--execution-worktree <main checkout of repo S>` is
blessed and now exempt regardless of whether S is the project's repository. Failure scenario:
S's main checkout sits strictly inside repo R's checkout; before this change the equality veto
refused such a plan, now it is `applicable: true` and apply writes
`<S>/.rasen/planning-binding.json` — untracked content inside R's checkout, the exact
pollution the veto's rationale names, one repository removed. This is consistent with the
pre-existing `execution-is-linked-worktree` blessing (which never restricted to the project's
repository either — `plan.ts:269`) and with design D2's keying-to-the-blessing; the veto text
scopes its rationale to "the ${side} repository's OWN checkout", so no spec scenario is
contradicted. Exotic shape; recommend a portfolio-ledger line (g-002/g-003 planning context)
rather than action in this child.

### Info-1: the `linked === false` key is behaviorally redundant in every reachable state — and documented as such

Mutation B (drop the key) leaves the suite fully green. Verified by code reading that this is
co-occurrence, not blindness: `facts` are computed from the same root the loop tests,
`repositoryMainCheckout` (`scope.ts:271-278`) returns `worktreeList[0]` (the main checkout,
first by git guarantee), so a root equal to its own repository root always has
`linked === false`. Design D2 states exactly this and keeps the key as fail-closed defensive
keying (if `planSide`'s blessing logic ever decouples, the exemption reverts to the veto).
No action; recorded so the archive review does not re-derive it.

### Info-2: dogfood receipt incidentally demonstrates the Windows-alias scenario end to end

Direction-1 receipt's `execution.repositoryRoot` (`C:/Users/...`, git's spelling) differs in
separators from the root spelling (`C:\Users\...`) and still hit the exemption — the same
canonicalization the new alias test and the delta's Windows clause pin.

## Process notes

- During review, another agent moved the five `temp-pair-*` receipts from the change root into
  `evidence/` (their tasks-3.x home). Reviewed at their final location; no content change.
- All mutations were applied to working copies, run, and restored; `plan.ts` hash re-verified
  `66039447` and `identity.ts` returned outside the diff (base state) afterwards. Final
  `git diff 40551f92 --stat` matches the pre-review 3-file fingerprint exactly.
