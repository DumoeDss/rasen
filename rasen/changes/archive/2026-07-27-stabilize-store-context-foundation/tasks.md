## 0. Ground rules for every group below

- [x] 0.1 Re-take `git status --porcelain` before touching any file under `packages/ui/**` or `rasen/config.yaml`. A concurrent session owns those paths; they may have changed since planning.
- [x] 0.2 Never run `git add -A`, and never stage a path this change did not author. Stage with explicit pathspecs only.
- [x] 0.3 Use `path.join()` / `path.resolve()` for every path, in source and in test expectations. No hardcoded separators; assertions must pass on Windows.
- [x] 0.4 Any command expected to run longer than ~2 minutes runs backgrounded with bounded foreground polling at intervals of at most 270 seconds. Never run two vitest batches concurrently — that has produced spurious timeouts on this repository.

## 1. Portfolio resume can no longer route unfinished work to delivery

Root cause established in `design.md` (Re-derivation 1): the portfolio record fails validation on an out-of-enum child status, `readPortfolioState` returns `null` silently, resume falls through to the single-change path, and only there does delegated-as-`skipped` leave `ship`. Fix the degradation first, then the counting.

- [x] 1.1 Reproduce the defect and capture the baseline: `node bin/rasen.js pipeline resume store-context-unification --json` currently returns `next: ship`. Record the output before changing anything.
- [x] 1.2 In `src/core/pipeline-registry/portfolio-state.ts`, add a child progress state meaning "proposal complete, implementation not started", and treat it as non-terminal (it must not satisfy `isSatisfied`).
- [x] 1.3 In the same file, normalize an unrecognized child status on read: preserve the original value under a passthrough key (follow the existing `runtimeRaw` precedent in `run-state.ts`) and treat the child as non-terminal. An unrecognized status must never let `isPortfolioComplete` return true.
- [x] 1.4 Give callers a way to distinguish "no portfolio record" from "portfolio record present but unreadable" — the lenient `readPortfolioState` stays for callers that legitimately want either, so add the distinguishing reader rather than changing its contract.
- [x] 1.5 In `src/core/pipeline-registry/run-state.ts`, add a `delegated` stage status and exclude it from `completedStages()`. Leave `skipped` counting as complete — existing records keep their meaning.
- [x] 1.6 In `src/commands/pipeline.ts` `resume()`, report a located-but-unreadable portfolio record with its path and validation reason, and offer no next step for it. It must not fall through to the stage-based branch.
- [x] 1.7 In the same method, ensure a portfolio parent with any unfinished child never exposes delivery as `next`, `ready`, or `remaining`.
- [x] 1.8 Localize every new human-readable string through `src/commands/pipeline-messages.ts`; keep the JSON output locale-neutral, per the existing `Pipeline machine contracts are locale-neutral` requirement.
- [x] 1.9 Test: a portfolio whose record carries an out-of-enum child status still resolves as a portfolio, counts that child unfinished, and does not offer delivery.
- [x] 1.10 Test: a portfolio record that is genuinely malformed is reported as unreadable, names its path and reason, and offers no next step — and specifically does not fall back to a stage frontier.
- [x] 1.11 Test: a parent whose stages are all `delegated` reports them outstanding and does not offer delivery, with no portfolio record present at all (defense in depth).
- [x] 1.12 Test: a change with no portfolio record resumes from its own stages exactly as before (no regression to the ordinary path).
- [x] 1.13 Test: a portfolio whose children have all finished still reports complete and still offers delivery.
- [x] 1.14 Regression check on the real record: `node bin/rasen.js pipeline resume store-context-unification --json` must no longer return `next: ship`, and must name the remaining children. Record the new output.
- [x] 1.15 Gate: `pnpm exec vitest run` over the pipeline-registry and pipeline-command suites is green. Evidence: the recorded run output, attached to this task.

Added in review round 1 (reviewer-1 MINOR-1 / MINOR-2). Both are the same
swallow-or-vacuum defect class this group exists to close, found by probing for
other instances of the shape rather than reported as new scope.

- [x] 1.16 Route `src/core/management-api/task-detail.ts` through `readPortfolioStateDetailed` too — it was the last caller of the lenient reader on this file, so an unreadable record silently rendered as "no dependencies recorded". Report it the way `/runs` reports the same file. Fold the duplicated private `ok|invalid|absent` reader in `src/core/management-api/runs.ts` into the shared one at the same time.
- [x] 1.17 Guard `isPortfolioComplete` against a zero-child record: `[].every(...)` is vacuously true, so a portfolio whose children were never appended reported itself complete with no evidence. Test both directions. **Rationale corrected in review round 2** — the first version of this line claimed the existing requirement already covered it. It did not. "Delivery SHALL become available only once every child has reached a finished state" is a NECESSARY condition: with zero children it is vacuously satisfied, so it *permits* the guard without *requiring* it. Worse, the ADDED scenario "A parent whose children have all finished can deliver" is a SUFFICIENT condition, and read with the same vacuous logic a zero-child portfolio meets its WHEN and the scenario would demand `complete: true` — the opposite of the fix. The spec was silent-to-contradictory, not merely under-implemented, so the `opsx-pipeline-registry` delta gains an explicit clause and a scenario for the zero-child case. That is completing an incomplete spec, not bending a spec to match code.

## 2. Frozen Store ownership survives a rename and distinguishes namesakes

- [x] 2.1 In `src/core/learned-skills/types.ts`, add a frozen-context version whose owner and planning-root refs carry the Store's permanent identity, reusing the existing `StoreIdentityRef` / `ProjectIdentityRef` vocabulary from `src/core/store/identity-types.ts` rather than declaring a second one.
- [x] 2.2 In `src/core/learned-skills/context.ts`, stop dropping the resolved `uid` in `ownerIdentity()` and `planningIdentity()` — they currently narrow a `ResolvedKnowledgeOwnerRef` (which carries `uid`) down to `{type, id}`.
- [x] 2.3 Keep every earlier frozen-context version readable. Do not rewrite a frozen record on read — it is the authority for a run already in flight.
- [x] 2.4 Resolve a name-only legacy record fail-closed: exactly one match resolves; zero or several stop the run, name what could not be settled, and list the candidates. Reuse the existing `learned_owner_legacy_alias` refusal vocabulary rather than inventing a second one.
- [x] 2.5 Update `src/core/templates/workflows/retain.ts` — its step 1 currently instructs runs to freeze `knowledgeContext: { version: 1, planningRoot: {type,id}, owner: {type,id} }`, which would keep minting the shape being retired.
- [x] 2.6 Check whether the retain template's parity hash or workflow-template-parity fixtures need regenerating after 2.5, and regenerate if so.
- [x] 2.7 Test: a Store renamed after a run was frozen against it still owns that run.
- [x] 2.8 Test: two Stores sharing a display name, one frozen against — resume resolves to the frozen one, not the namesake.
- [x] 2.9 Test: a newly frozen run records permanent identity, with the display name carried only for readability.
- [x] 2.10 Test: a legacy name-only record resolves when unambiguous; stops and lists candidates when several match; stops and names the Store when none match.
- [x] 2.11 Test: reading a legacy record leaves the file byte-identical.
- [x] 2.12 Gate: `pnpm exec vitest run` over the learned-skills and store-identity suites is green. Evidence: the recorded run output.

## 3. One rule for the checkout applicability is evaluated in

Direction confirmed in `design.md` (Re-derivation 2): fall back to the **resolved** execution checkout, with the current directory as the genuine last resort. `context.ts` is the side that violates the stated resolution order, not `effective.ts`.

- [x] 3.1 In `src/core/learned-skills/context.ts:770`, replace the bare `process.cwd()` fallback in `resolveLearnedSkillRoots()` so a resolved project checkout answers before the current directory.
- [x] 3.2 Keep the current directory reachable as the last resort — a Store or global owner has no project checkout, so this branch is live, not dead code.
- [x] 3.3 Confirm `src/core/learned-skills/effective.ts:487` now expresses the same order as 3.1, and factor the shared fallback into one place so the two cannot drift apart again.
- [x] 3.4 Test: with no session checkout recorded, an explicitly resolved project checkout decides applicability even when the process runs from a different directory.
- [x] 3.5 Test: with no session checkout and no resolved project checkout, the current directory decides applicability.
- [x] 3.6 Test: both entry points agree on the same checkout for the same session — construct a case where the old code disagreed and assert they now match.
- [x] 3.7 Gate: the learned-skills suites are green. Evidence: the recorded run output.

## 4. The launch surface tells three Store situations apart (archived child C task 9.4)

Locale files are flat-keyed (`dialog.launch.*`), 378 keys each across `en`, `ja`, `zh-cn` at planning time (381 each after this change). **A concurrent session owns these files.**

- [x] 4.1 Re-take `git status --porcelain -- packages/ui` immediately before starting this group. If the three locale files are actively occupied, stop and report rather than editing over concurrent work.
- [x] 4.2 Add the new keys to `packages/ui/src/i18n/locales/en.json` by **narrow, additive edit only** — insert alongside the existing `dialog.launch.*` keys. Do not reformat, reorder, or rewrite the file, and do not touch any other key.
- [x] 4.3 Add the same keys to `ja.json` and `zh-cn.json` with translations, under the identical discipline as 4.2.
- [x] 4.4 Verify key parity across the three files programmatically (equal key sets), not by eye.
- [x] 4.5 In `packages/ui/src/components/LaunchSessionDialog.tsx`, render the per-row explanation on a member with no local checkout — the disabled branch currently renders name and id with no wording at all.
- [x] 4.6 Add the distinct "members exist, none has a checkout on this machine" message, and keep `members_empty` reserved for a Store with genuinely no members. Do not let one message serve both states.
- [x] 4.7 State on the planning-only option that it grants no permission to write code. The shipped `session-runtime-context` requirement "A planning-only session can write no code, and says so" already mandates this at the launch surface; the current `planning_hint` does not say it.
- [x] 4.8 Style any new elements in `packages/ui/src/style.css` only if required; keep additions scoped to the launch dialog's existing class namespace.
- [x] 4.9 Test: a member without a local checkout is listed, not selectable, and states that no checkout exists on this machine.
- [x] 4.10 Test: a Store whose members all lack checkouts shows the new message and does **not** claim the Store has no member projects.
- [x] 4.11 Test: a Store with no members still shows the existing empty message.
- [x] 4.12 Test: a member with a checkout is still selectable (no regression).
- [x] 4.13 Test: the planning-only option states the no-code-write limit.
- [x] 4.14 Gate: `pnpm --dir packages/ui exec vitest run test/components/launch-session-dialog.test.tsx` is green. Evidence: the recorded run output.

## 5. Reconcile the nine archived A–D2 task boxes truthfully

Classification and the four-gate decision are recorded in `design.md` D6. **Never tick a box next to a statement that is false.**

- [x] 5.1 Settle the four archive-rehearsal boxes — `2026-07-25-store-immutable-identity` 7.4, `2026-07-25-project-keyed-store-membership` 12.5, `2026-07-26-unified-session-runtime-context` 12.5, `2026-07-26-store-scoped-learned-knowledge` 10.5 — citing the evidence inline next to each tick. **Corrected in review round 1:** this task and design D6 both assumed "rehearsal evidence already on record". There is none — D1 10.5 says "deliberately not run" and C 12.5 says "deferred to the ship/archive stage" on their own lines. Ticking them against a later successful archive would have put `[x]` beside a sentence contradicting it, which the `verify-ship-evidence` requirement this change ADDS forbids. All four therefore get D6's restate-then-settle treatment instead: original wording visible, gate restated as "the spec merge is proven to succeed", settled against the archive commit that performed it, substitution recorded.
- [x] 5.2 Restate the four `full suite green` gate lines per D6 — keeping the original wording visible in the restated line — in `2026-07-25-project-keyed-store-membership` 10.8, `2026-07-26-unified-session-runtime-context` 10.9, `2026-07-26-store-scoped-learned-knowledge` 8.5, `2026-07-26-learned-knowledge-effective-resolution` 9.11. Do not tick them in this task; they are settled only by group 6.
- [x] 5.3 Tick `2026-07-26-unified-session-runtime-context` 9.4 only after group 4 is complete, citing this change as where the work landed.
- [x] 5.4 Verify no unchecked box remains in the five archived A–D2 `tasks.md` files, and that every tick added by this change cites its evidence.

## 6. Obtain the combined A–D2 verification result the restated gates require

- [x] 6.1 Run `pnpm lint` and `pnpm build`; record both results.
- [x] 6.2 Run the full suite to completion, backgrounded with bounded foreground polling per 0.4, in small serial batches. A run that does not complete is not a result.
- [x] 6.3 Enumerate the **complete** list of failing files from the run. Do not extrapolate an attribution from a truncated tail — attribute each file individually.
- [x] 6.4 Attribute each failure with checkable evidence. Already established during planning, to be re-confirmed against the final tree: `test/release-contract.test.ts` and `scripts/release-contract.mjs` are byte-identical to base `d73c1da2` (`git diff d73c1da2..HEAD` over both paths is empty), so that failure pre-dates the portfolio. **Re-confirmation refuted the second planning premise, and this line is corrected in review round 2 to say so:** `test/commands/handoff.test.ts` does **not** trace to `313df542` — `git show 313df542 | grep maxRelays` returns no matches, and that commit touches neither the test nor `src/core/templates/workflows/_orchestration.ts`. The assertion went stale at `58faffad` (`git log -S "maxRelays: 3" -- src/core/templates/workflows/_orchestration.ts`), which `git merge-base --is-ancestor 58faffad d73c1da2` shows is an ancestor of the branch base — so it pre-dates the whole portfolio rather than belonging to a concurrent session. Both files are byte-identical to base. Full attribution for all four failures: `combined-verification-A-D2.md`, section 3.
- [x] 6.5 Any failure that cannot be attributed outside A–D2 and outside this change counts against this change — fix it, do not reclassify it.
- [x] 6.6 Write the combined verification result to the change work directory, listing every failure with its attribution and the evidence for each.
- [x] 6.7 Only now, tick the four restated gate boxes from 5.2, each citing this recorded result.
- [x] 6.8 Confirm the known failures are unchanged in nature by this change — this change must not add a failure or alter an existing one's signature. **Count corrected in review round 2:** planning listed three; the run found **four** (`test/commands/workset.test.ts` was not anticipated). All four are unchanged in signature and each is byte-identical to base `d73c1da2`; see `combined-verification-A-D2.md`, "This change did not add or alter a failure".

## 7. Close out

- [x] 7.1 Re-run `node bin/rasen.js validate stabilize-store-context-foundation --changes --json` and confirm this change reports `valid: true`.
- [x] 7.2 Rehearse the spec merge with `node bin/rasen.js archive --json --yes` and confirm it would succeed. `validate --changes` does not apply deltas to the main specs, so a delta that drifts from a main-spec requirement title passes validation and fails only here. Abort before the move if it fails.
- [x] 7.3 Confirm no delta spec introduces a `TBD - created by archiving` placeholder: `rg -l "TBD - created by archiving" rasen/specs/` must return nothing.
- [x] 7.4 Scan the files this change touched for NUL bytes before staging — two children of this portfolio independently introduced one. Include `scripts/**` in the scan, not only `src/**` and `test/**`.
- [x] 7.5 Review `git status --porcelain` one final time and confirm the staged set contains only paths this change authored — no `packages/ui` hunks belonging to the concurrent session, no untracked directories owned by others.
