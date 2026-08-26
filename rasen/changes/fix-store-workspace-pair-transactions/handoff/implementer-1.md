# Implementer 1 handoff — change B, complete

## Scope and state

- Role: implementer for `fix-store-workspace-pair-transactions` (tranche B of the operator's A+B+G2 scope decision, 2026-08-26).
- Tree: `E:\AI\ChatAI\Agents\VibeCodingProjects\workflow\Reference\OpenSpec-code`, branch `dev/0.2.0`, HEAD `9f9f68cf`. Shared working tree with change A and change G2R throughout.
- Task record: 28/28 ticked (`rasen instructions apply` reports `all_done`, 0 remaining).
- Verdict received: reviewer-1 SHIP, 0 Blockers, 2 artifact-only Majors (B-1, B-2) — both closed here.
- Nothing committed, pushed, PR'd, or version-bumped. Ship is the operator's stage.

## What shipped

Three defects in one transaction, not two. D1/D2/D4 are the planner's; D6 was found during
implementation and approved by the LEAD.

- **D1, apply-side (`workspace/apply.ts`).** For a create-disposition side, absence now SATISFIES
  revalidation. The recorded-identity comparison is scoped to the resumable case — destination exists
  on the planned ref AND the index entry's recorded root IS the planned root (`samePath`). A
  narrowing, not a weakening: the only behaviour removed was refusing an absent destination because a
  leftover index entry carried an id.
- **D2, plan-side (`workspace/plan.ts`).** The own-Change index entry is reconciled into named
  preconditions instead of ignored: satisfied `<side>-recorded-pair-recreated` when the recorded
  worktree is gone, unsatisfied `<side>-recorded-pair-single` (code `workspace_already_bound`, naming
  the recorded pair and the cleanup repair) when it is still live at another root.
- **D4.** `<side>-created-from` discloses the locator ref and the frozen commit for every created
  side.
- **D3, compound (`workspace/module.ts`, `commands/workspace.ts`).** `StoreWorkspace.prepare()` and
  `rasen store workspace plan --apply`: scope resolved twice on purpose — once outside the hold for
  the lock keys, once inside it so everything the plan freezes is read under the lock.
- **D6, the surviving pair branch.** Three-way disposition per created side (mint / REATTACH at the
  branch's own frozen tip / refuse when another worktree holds it), apply revalidating a reattached
  tip against the frozen OID, `addWorktree` gaining optional `createBranch` (default true). Full
  decision and four rejected alternatives in `design.md`; tasks under group 4b.

## Decisions worth keeping

1. **Reattach at the branch's OWN tip, never the line's.** The reuse disposition already freezes a
   live `headOid` rather than the line tip; doing the same for an existing pair branch keeps
   "created from a frozen OID, never from a ref name" true in both directions and cannot discard
   commits. Forcing the branch to the line tip (`worktree add -B`) was rejected as the most
   destructive option available to a *preparation* verb.
2. **The pair branch is NOT cleanup's problem.** Deleting it during cleanup was the tempting fix and
   is wrong: cleanup's contract is provable losslessness, and the branch is equally in the way after
   a plain `git worktree remove` that cleanup never saw.
3. **Same-root re-creation keeps the pair identity, and the spec now says so.** `worktreeInstanceId`
   is a pure function of canonical repo dir + canonical worktree root, so the canonical requirement's
   unqualified "re-preparing SHALL produce a different pair identity" contradicted shipped behaviour.
   Carried into the delta under MODIFIED with all three canonical scenarios VERBATIM (machine-checked
   by extracting and comparing bodies, not eyeballed), body narrowed to the new-destination case, and
   one added scenario pinning the same-root case the narrowed body now claims.
4. **Fail-closed was moved, never removed.** Every refusal that existed still fires; the
   fresh-destination case moved EARLIER (plan-side) so its named repair actually repairs.

## Dead ends and eliminated hypotheses

- **"The two reported symptoms are two independent bugs to fix separately."** Eliminated. They
  compound: defect 1's refusal is designed and self-healing; defect 2 is what made the re-plan loop
  futile. Fixing either alone leaves the flow unusable.
- **"D1 + D2 are sufficient for re-preparation to converge."** ELIMINATED BY MEASUREMENT, and this is
  the one that would cost a successor the most time. Proven false twice: standalone against real Git
  (`git worktree add -b <name>` after `worktree remove` → `fatal: a branch named ... already
  exists`), then through the module once D1 stopped refusing earlier. Tasks 2.2 and 3.2 are
  unreachable without D6.
- **"`rasen store workspace cleanup` clears the way for a fresh pair."** Eliminated: cleanup removes
  worktrees and the index entry, never a branch — it says so in its own output.
- **"Assert the pair identity DIFFERS after same-root re-preparation" (task 2.2 as written).**
  Eliminated: the identity model cannot produce it. See decision 3.
- **"The `workspace-cleanup` timeouts are a logic regression from my change."** Eliminated by
  baseline comparison: the pre-fix parallel baseline already carried one such timeout at 34189ms.
  They are 30s-default timeouts under added parallel load, not assertions.
- **"`store add-project` registers the project checkout."** Eliminated during dogfood: it records
  membership and prints "Registry: registered" but writes no entry to
  `<dataDir>/rasen/projects/registry.json`; `rasen init` is what does. Consequence:
  `store workspace plan` refuses "no registered checkout on this machine" even when
  `--execution-worktree` is passed, because a to-be-CREATED destination is not yet a directory and
  cannot answer for its own repository. Left alone — adjacent to the converge-projectid work, not B.

## Evidence (all under `evidence/`, all untracked so it survived the stash incident)

| file | what it proves |
| --- | --- |
| `baseline-red-solo.txt` | fail-first: 8 failed / 4 passed, EXIT=1, 169.32s, full enumerated list |
| `baseline-red-parallel-store-suite.txt` | same baseline under parallel load: 9 failed / 1540 passed |
| `postfix-inversion-defect-pins-red.txt` | the inversion in BOTH directions — 10 contract tests green, both defect pins red — before the pins were deleted |
| `mutation-proof-2.3.txt` | guard bites: unique landing site verified first, `!==`→`===` at apply.ts:209, red at the asserted line, sha256 identical after revert |
| `postfix-store-suite.txt` | full `test/core/store/`: 89 files, 1572 passed, 0 failed, EXIT=0 |
| `postfix-workspace-neighbours.txt` | task 5.2 guard set together: 7 files, 113 passed, EXIT=0 |
| `postfix-cli-surface.txt` | CLI/completions/locale surface: 15 files, 351 passed, EXIT=0 |
| `dogfood-real-cli.txt` | the field sequence through the real CLI on a disposable store, transcript + script |

## Working set

- Source: `src/core/store/workspace/{plan,apply,module,dependencies}.ts`, `src/commands/workspace.ts`,
  `src/core/completions/command-registry.ts`, `src/locales/{en,ja,zh-cn}.json`.
- Tests: `test/core/store/workspace-repreparation.test.ts` (new, 13 cases, per-`it` timeouts);
  describe-level `{ timeout: 180_000 }` added to `workspace-{apply,plan,binding,cleanup,pairing}.test.ts`
  and `store-archive-delivery.test.ts`; weight entry in `vitest.config.ts`.
- Artifacts: `proposal.md`, `design.md` (D6 + rejected alternatives), `tasks.md` (group 4b),
  `specs/store-planning-worktree-bindings/spec.md`, this handoff, `evidence/`.
- Index: one row added to `.claude/skills/architecture-index/detail/quick-locate.md`.
- NOT touched: `src/core/store-planning/**`, `src/core/store/identity.ts` (change A),
  `src/core/store/layout-migration/**`, `src/commands/store-migrate-layout.ts` (change G2R).

## Next action

None for the implementer role — the change is complete and reviewed SHIP. The remaining work is the
operator's:

1. Ship (commit / PR) with `proposal.md` as the body.
2. After landing: rebuild `dist`, reinstall the dogfood CLI, then run the stranded elftia retentions
   through the official flow. That pilot mutates live stores and is an owner action, not CI, and not
   part of this change's execution.

## Two hazards a successor in this repo should expect

- **Shared working tree.** A tree-mutating git operation here silently reverts other agents' source
  and any run in flight then measures code nobody wrote. It happened mid-change (an `src/`-scoped
  `git stash` reverted all three changes at once); the work was recovered by `git stash pop` and a
  full store run had to be killed and redone. Discard any run that straddles such an operation.
- **The 30s default.** 68 test files call `createStoreWorkspaceFixture(`; 52 of them carry neither a
  describe-level timeout nor any per-`it` timeout, so they ride the 30s default. Adding one more
  heavy real-git suite tips whichever neighbours are marginal that run, and the failure reads as a
  broken assertion rather than a timeout. Six were given explicit timeouts here — the ones in this
  change's blast radius. The next heavy real-git suite added to `test/core/store/` will hit this
  again.
