## 1. Layout Contract Debt from Child 1

- [x] 1.1 Add `IssueId` and `ExecutionPlanRevisionId` brands, their parsers/predicates, `formatExecutionPlanRevisionId`, `EXECUTION_PLAN_REVISION_WIDTH`, and the `invalid_issue_record` / `invalid_execution_plan` error codes to `src/core/store/planning-validation.ts` — the exact block child 1 deliberately left to this change.
- [x] 1.2 Add the four Store-level Issue addresses (`issue`, `issue-record`, `execution-plans`, `execution-plan`) to `src/core/store/planning-layout-v2.ts`. Each is its own address; none takes a project or target line, and supplying either must not change the result.
- [ ] 1.3 Extend `test/core/store/planning-layout-v2.test.ts` and `planning-validation-v2.test.ts` for the new surface, including Windows and POSIX flavors built with the matching platform path API, case-alias rejection, traversal and device-name rejection, and the unpadded / differently-padded / zero revision ordinal cases.
- [ ] 1.4 Assert the two new brands are picked up by child 1's brand-vocabulary guard in `planning-foundation-consumer.test.ts` — the guard reads `planning-validation.ts`, so its counted vocabulary must move. If it does not move, the brands landed in a file the guard does not read; fix that rather than the assertion.

## 2. Issue Resources

- [x] 2.1 Add `src/core/store/issues/**` (11 files) at the **squash-base** state per design Context — exclude `migration-compiler.ts`, the `locks.ts` batch additions (`withIssueLockBatch`, `issueLockCanonicalBytes`, `heldIssueLockKeys`, the `onAcquired` seam), and the `reference-verification.ts` extraction. Reference verification stays inline in `module.ts`, which is the 520-line squash version.
- [x] 2.2 Implement `IssueRecordV1` and its states, and the three-method mutation surface `StoreIssues.{create,setState,publishPlan}` — refusing a duplicate identifier and an undefined state rather than overwriting or storing them.
- [x] 2.3 Implement `ExecutionPlanRevisionV1`: immutable revisions addressed by canonical zero-padded ordinal, never rewritten, with no gap or duplicate in the sequence, and `executionPlanDigest` over `executionPlanDigestBody`.
- [x] 2.4 Implement plan-node normalization and the graph checker: two spellings of one plan normalize to one plan, duplicates are refused rather than merged, and dangling dependencies and cycles are refused with the offending nodes named.
- [x] 2.5 Implement reference verification against committed Store evidence — a node naming an absent, uncommitted, or out-of-Store Change is refused with the reason named, and the working directory is never consulted as evidence.
- [x] 2.6 Implement the single Issue lock so all Issue mutation serializes through it, released even on failure, and a provably-dead owner does not permanently block a later operation.

## 3. Aggregate Query

- [x] 3.1 Add `src/core/store/query/**` (7 files) in the SAME change as `issues/**` — the bidirectional import cycle (`issues/module.ts` → `query/refs.js`, `query/issues-read.ts` → `issues/{records,plans,types}.js`) makes them one unit.
- [x] 3.2 Implement `StoreAggregateQuery.{listIssues,showIssue,issuesReferencing,resolveExecutionPlan,listProjects,listTargetLines,listChanges}`, with Changes grouped by project AND target line so one alias in two projects is two entries.
- [x] 3.3 Make every read lock-free and mutation-free: a read must complete while a mutation holds the Issue lock, and a full pass of every read operation must leave the Store byte-identical.
- [x] 3.4 Implement report-don't-refuse: one malformed Issue, project catalog, or Change yields a result carrying every readable item plus a named problem for the unreadable one — never a failed whole read, and never a silent omission.
- [ ] 3.5 Make reads digest-aware: a resolved plan carries its ordinal and verified digest, and a revision whose stored digest does not match its content is reported unverifiable rather than returned as valid. (Implemented in `plans.ts`/`issues-read.ts`, `tsc`-clean; NOT yet independently verified by a dedicated digest-mismatch test — deferred to land alongside the Section 7 read-side digest anchors, which exercise the same sites.)

## 4. Command Surface

- [ ] 4.1 Add `rasen store issue` (`new`, `list`, `show`, `set-state`, `publish-plan`) in `src/commands/store-issue.ts`, with a machine-readable form whose content matches the human form.
- [ ] 4.2 Add `rasen store aggregate` in `src/commands/store-aggregate.ts` with `--project` / `--target-line` filters, on the same terms.
- [ ] 4.3 Register both groups in `src/cli/index.ts`, `src/core/completions/command-registry.ts`, and all three locale trees in ONE step. Verify locale lockstep by **key set**, not by count, and confirm every new key is genuinely translated rather than copied from English.

## 5. API and UI Rim (additive only)

- [ ] 5.1 Add the Store aggregate read paths to `src/core/management-api/stores.ts` and the router, **beside** what this line built — no existing endpoint changes shape. Each path is a read: no mutation, no lock.
- [ ] 5.2 Add the new wire types and move `packages/ui/src/api/types.ts` in the SAME step. Add a test that fails when a Store-aggregate wire type exists without its UI mirror — a wire type added without its mirror is a known silent-drift failure mode in this repo, and inspection has not caught it before.
- [ ] 5.3 Enforce the complete-scope rule on the Store-scoped mutation surface: an incomplete scope is refused, and a sole candidate is not adopted as the missing part. Assert the sole-candidate case specifically — it is the one an inference would pass.
- [ ] 5.4 Add `packages/ui/src/components/{StoreIssuesView,StoreAggregateBoard}.tsx` and their suites. Run them with `pnpm -C packages/ui exec vitest run` and record a NON-ZERO test count — the root runner excludes `packages/ui` and will report "passed" having run nothing.
- [ ] 5.5 Decide the two MODIFIED requirements the reference change carried (`board-ui` member chip filter, `management-http-api` loopback/bearer security): read the LIVE 0.2.0 spec text for each, determine whether this change's surface genuinely alters it on THIS line, and if so author the MODIFIED delta from the 0.2.0 text — never from the reference's. If neither is altered, record that finding and add no delta.

## 6. Deferral and Substitute Coverage

- [ ] 6.1 Do NOT port `test/core/store/store-issue-scope-intent.test.ts` (7 cases). It imports `test/helpers/store-finalization-fixture.ts`, which pulls `finalization/**` and `store-planning/**` — a later slice. Record the deferral with its reason.
- [ ] 6.2 Determine which behaviours of `src/core/store/issues/scope.ts` (207 LOC) are covered ONLY by that file, and author finalization-free substitute coverage for each, driven through `StoreIssues` and the aggregate query directly. Mutation-prove each substitute like any other guard: break the behaviour, record RED, revert, record GREEN.
- [ ] 6.3 Record `test/core/store/store-issue-scope-intent.test.ts` as an inbound acceptance item for the finalization slice, alongside the item child 2 handed forward.

## 7. Anti-Blindness Verification

- [ ] 7.1 Add pinned-literal anchors for every durable-format site: `executionPlanDigest` (`plans.ts:312`), `serializeExecutionPlanRevision`, the Issue record serializer in `records.ts`, the Issue lock filename digest (`locks.ts:130`, over the `issue-lock/v1` domain preimage), and the read-side content digests (`query/issues-read.ts:29`, `query/refs.ts:447`). Each anchor pins its OWN literal inputs and expected value; no anchor may be computed from another's output.
- [ ] 7.2 Where a live per-run fact (a timestamp inside the preimage) makes a fixed literal impossible, have the test independently reconstruct the preimage and rehash with its OWN hardcoded hash call — not by calling the production helper.
- [ ] 7.3 Prove each anchor discriminates, and state the mutation used. It must be a change to the **serializer or preimage itself** with inputs held fixed — reorder a field, change a separator, drop the domain tag. Perturbing an input field does NOT discriminate: it moves only one side and is the break an unstrengthened anchor already catches. An anchor whose expected value is produced by calling production's own serializer a second time is blind and must be rewritten, not re-proved.
- [ ] 7.4 Walk each anchored value back through its own reader — the plan digest through `validateExecutionPlanRevision(..., { verifyDigest: true })`, the read-side digests through the aggregate read — so a preimage change cannot hide behind a verifier that stopped checking.
- [ ] 7.5 For each kind in `STORE_LOCK_ORDER`, name its taker in shipped code on this branch. Record `change` and `integration` as unenforced-by-design (their taker is the finalization slice). Do NOT offer `assertStoreLockOrderAgreesWithWorkspace()` as evidence that ordering survived — it compares two frozen arrays and passes under any partial port.

## 8. Gates

- [ ] 8.1 Port the test surface: `test/core/store/{store-aggregate-query, store-issue-layout, store-issue-locks, store-query-lock-free, store-query-read-only-guard}.test.ts` and `test/commands/{store-issue-cli, store-aggregate-cli}.test.ts`. Do NOT port `store-issue-migration-compiler.test.ts` (excluded with `f4a48a36`) or `store-issue-scope-intent.test.ts` (task 6.1). Port only the base portion of `store-issue-locks.test.ts` — its batch cases came with `f4a48a36`.
- [ ] 8.2 Re-derive the no-regression gate's file list from THIS change's own test-file additions and add them to the corrected list; then verify the run's reported file count against the change's test-file additions. A gate command frozen before this child existed will silently not run its suites — that is exactly what happened to child 2's four command suites, and a green gate then did not cover the child's own acceptance suites.
- [ ] 8.3 Run the gate at `VITEST_MAX_WORKERS=2` for a trustworthy number, and never triage a full-run failure by its shape — re-run the file solo before concluding anything. A busy filesystem on this machine produces genuine assertion failures, not just timeouts; only a solo re-run separates contention from defect. Do not accept "every file passes solo" as the gate either.
- [ ] 8.4 Record the intended divergences so a reviewer does not read them as drift: `git diff origin/dev/0.1.7 -- src/core/store/issues/` will be NON-empty by design (the `f4a48a36` exclusion, chiefly `module.ts` at its 520-line squash size), and `src/core/store/query/` should differ only by `references.ts` +5. State both in the evidence.
- [ ] 8.5 Measure each new suite's solo wall-clock and add `KNOWN_SLOW_TEST_WEIGHTS_MS` entries in `vitest.config.ts` for any of comparable weight to child 2's, or the macOS and Windows CI shards will skew. Note that child 2's `workspace-cleanup` entry (166610) measured 396.85s solo and looks more than 2x underestimated — do not copy its methodology, measure.
- [ ] 8.6 Windows CI verification: the layout Issue-address fixtures, the identifier case/alias/device-name cases, and the CLI suites must run on the Windows leg of the CI matrix, not only on Linux and macOS. Record the run reference.
- [ ] 8.7 Run `pnpm exec tsc --noEmit`, `pnpm run lint`, `pnpm run build`, and `node bin/rasen.js validate 'store-issue-resources' --type change --strict`, and record each result. Use `node bin/rasen.js` for every rasen invocation — the bare `rasen` command on this machine is a 0.1.7 build.
- [ ] 8.8 Audit the child diff: confirm no `finalization/`, `store-planning/`, `layout-migration/`, `layout-write-guard.ts`, `membership-layout.ts`, or `consistency-gates.ts` file is added; that `migration-compiler.ts` is absent; that no existing management-API endpoint, wire type, or locale key changed shape; and that no unrelated formatting change is present.
