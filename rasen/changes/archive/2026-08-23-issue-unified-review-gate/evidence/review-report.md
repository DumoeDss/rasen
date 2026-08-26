# Verify Review — issue-unified-review-gate (P6 g-002)

- Reviewer: fresh verify-stage reviewer (small-feature pipeline; did not participate in implementation). Report-only: no code changed, no git commits, no store writes.
- Date: 2026-08-23. Worktree `.claude/worktrees/issue-layer`, branch `feat/issue-phase6`.
- Scope: implementation (`src/core/issue-status/review.ts` new, `types.ts`, `index.ts`, `src/commands/store-issue.ts`), tests (`test/core/issue-status/issue-unified-review.test.ts` new, `test/commands/store-issue-review-cli.test.ts` new, `test/core/issue-status/issue-status-read-only-guard.test.ts` modified), architecture index (2 files), against proposal.md / design.md / specs/issue-unified-review/spec.md / tasks.md (13/13 checked) and the six evidence receipts.

## Verification commands run

| Command | Result |
| --- | --- |
| `pnpm run build` | exit 0, but the emitted dist was missing `dist/commands/shared-output.js` (see finding I-3) |
| `node node_modules/typescript/bin/tsc` (direct re-run) | exit 0, `shared-output.js` emitted; dist complete |
| `pnpm exec vitest run test/core/issue-status/issue-unified-review.test.ts` | 17/17 passed |
| `pnpm exec vitest run test/core/issue-status/issue-status-read-only-guard.test.ts` | 9/9 passed |
| `pnpm exec vitest run test/commands/store-issue-review-cli.test.ts` | first run 0/7 (incomplete dist, ERR_MODULE_NOT_FOUND on `shared-output.js`); after tsc re-run: 7/7 passed |
| `node bin/rasen.js validate issue-unified-review-gate` | "Change 'issue-unified-review-gate' is valid" |
| `node bin/rasen.js store issue show <4 closed issues> --store issue-registry` (+ one `--json`) | live reads match receipts exactly; store byte-clean before/after |
| 3 temporary mutations of `review.ts` (backup/restore via `.rasen/mut-backup-review.ts`, sha256-verified) | each turned the unit suite red (2, 4, 5 failures); restored byte-identical (sha256 `7b1a6ab3...` before and after; `diff` zero residue; backup deleted); suite re-run 17/17 green |

## Focus item 1 — determination is a full 1:1 map of the acceptance gate (one blocking basis)

**PASS.**

- `mapDetermination` (src/core/issue-status/review.ts:41-77) is the ONLY determination source. Its inputs are exclusively `status.acceptance` (null -> `acceptance-unknown`), `gate.eligible` (-> `review-ready` with `gate.conditionsRevisionId`), and the switch over `gate.refusalCode`. The refusal union (src/core/issue-acceptance/types.ts:120-125) has exactly five codes; the switch covers all five with no default, and the declared `IssueReviewDetermination` return type pins exhaustiveness at compile time. 5 codes + eligible + null = the seven-value closed vocabulary of design D1, exactly.
- No second basis exists: no branch of `mapDetermination` reads delivery state, lifecycle, thread facts, or counts. Thread facts are computed in separate functions (`attentionThreads`, `nodeThreads`) whose outputs land only in `threads`, never feed back into the determination (review.ts:203-221).
- Carried facts match the D1 table: `not-ready` carries only `blockerCount` (`gate.blockers.length`, review.ts:67) — the blocker list stays in `status.acceptance.gate.blockers`, rendered by the acceptance section above (src/commands/store-issue.ts:610), so "N blocker(s) named above" (store-issue.ts:800) is truthful. `accepted` carries the record's date/revision, honestly null when the record is present but unverifiable (review.ts:56-64; CLI-pinned by the tampered-record test). `conditions-missing` carries the gate's own message verbatim (unit-pinned character-for-character).
- Unit matrix (test file, task 1.3 block) maps determinations from the REAL `evaluateIssueAcceptanceGate` over the same node facts — no forged union members. Task 2.1 pins: gate holds + all four node-thread kinds standing -> still `review-ready`; erasing every thread fact leaves the determination identical; and the pin is proven live (a gate INPUT flip does change it, so the pin is not a constant).
- Mutation evidence: mutation A (review.ts:67 `blockerCount` -> constant 0) turned 2 tests red.

## Focus item 2 — live read of the four closed Issues on the persistent store

**PASS.**

Ran the real CLI (`node bin/rasen.js`, fresh dist) against store `issue-registry` (`E:\AI\ChatAI\Agents\VibeCodingProjects\workflow\Reference\rasen-issue-store`), read-only:

| Issue | determination | threads |
| --- | --- | --- |
| issue-autodecompose-uplift | `accepted` (record 2026-08-21T20:51:33.888Z, rev 0001) | evidence-missing x2 |
| issue-cross-project-execution | `accepted` (record 2026-08-20T18:03:54.626Z, rev 0001) | archive-pending `document-multi-project-issues` (cross-project) + evidence-missing x3 |
| issue-cross-project-replanning | `accepted` (record 2026-08-22T12:08:55.201Z, rev 0001) | archive-pending `issue-needs-attention` + evidence-missing x2 |
| issue-multi-change-execution | `accepted` (record 2026-08-20T09:46:11.369Z, rev 0001) | archive-pending `issue-persistent-baseline` + evidence-missing x2 |

Totals: all four `accepted`; `evidence-missing` x9 (every name `verification-report`); `archive-pending` x3 including the cross-project workspace-index-located node — exactly the receipts and the planner's fact base, zero surprises. JSON parity verified live on issue-multi-change-execution: the `--json` `review` key carries the identical determination/threads/verification the human section printed (same facts, same counts: 3 threads = 3 threads, required 3/3, delivery 2/0/1/0/0), and is deep-equal to receipt `dogfood-5-multi-change-execution.json`'s `review` key. Store discipline held: `git status --porcelain` empty and HEAD `3af7041e` unchanged before and after all five reads.

## Focus item 3 — thread vocabulary closure and documented exclusions

**PASS.**

- `IssueReviewThread` (src/core/issue-status/types.ts:604) is a closed discriminated union of exactly seven kinds: three attention-mapped (`failure`, `blocked-behind`, `waiting-human`) + four node-scanned (`optional-open`, `archive-pending`, `record-absent`, `evidence-missing`). The implementation can produce no other kind: `attentionThreads` filters on the frozen `THREAD_ATTENTION_KINDS` set (review.ts:89-93) with a defensive throw for anything else; `nodeThreads` (review.ts:147-186) pushes only the four literals.
- Both exclusions are in the spec verbatim ("An attention `acceptance-awaiting` item SHALL NOT become a thread — it is the review-ready determination's own conclusion — and an attention `problem` item SHALL NOT become a thread — standing problems are gate blockers the `not-ready` determination already carries"), reasoned in design D2, restated in the code comment above the set, and unit-pinned (task 2.2: a review-phase status with a standing problem contributes neither; JSON.stringify scans prove no leak).
- The honest overlap is spec'd and pinned: a failed/human-parked optional node carries BOTH its attention thread and its `optional-open` thread (unit test "surfaces BOTH its threads naming one node").
- `archive-pending` correctly requires terminal observation AND `not-archived` delivery (review.ts:164) — expected progress, never damage; a still-running not-archived node yields no thread (the CLI not-ready test pins `threads: (none)` with an in-flight required node). `evidence-missing` fires only on a non-null, non-empty recorded `missing[]` (null = no recorded name = no thread, documented in types.ts). `unreadable`/`unattributed` delivery states are deliberately outside the thread vocabulary — they surface in the counts, and their trouble reaches the reviewer through the gate's own blockers (standing problem / un-terminal observation), consistent with the one-blocking-basis design.
- Mutation evidence: mutation B (deleting `'failure'` from the set) turned 4 tests red; mutation C (dropping the terminal guard at review.ts:164) turned 5 tests red.

## Focus item 4 — list compactness fence

**PASS.**

- `deriveIssueReview` has exactly one CLI call site: the show action (src/commands/store-issue.ts:1331). The list action never derives or renders review facts.
- CLI-pinned ("keeps the listing compact"): human list output contains no `review:` / `determination` / thread-kind strings, and every `--json` list entry has `issue.review === undefined`.
- The review section renders only in show, as the concluding section after delivery evidence (store-issue.ts:1022-1024; order pinned by the ready-Issue CLI test's index comparison), matching the spec's "the listing stays compact" scenario.

## Focus item 5 — mutation spot-checks (all reverted byte-identically)

**PASS.** Backup `.rasen/mut-backup-review.ts` taken first (sha256 `7b1a6ab313383a0dfc25caf20490cbc6131e9964bb8af9534ce04879a78c5a3f`); every mutation site asserted unique (count==1) with its line number printed before replacing.

| # | Mutation (site) | Expected red | Result |
| --- | --- | --- | --- |
| A | `not-ready` blockerCount -> constant 0 (review.ts:67) | matrix + live-pin tests | 2 failed / 15 passed |
| B | delete `'failure'` from `THREAD_ATTENTION_KINDS` (review.ts:90) | fail-first mapping + overlap + ordering pins | 4 failed / 13 passed |
| C | drop the terminal guard on `archive-pending` (review.ts:164 -> `if (true)`) | never-block + ordering + mapping pins | 5 failed / 12 passed |

After each: restored from backup, sha256 re-verified identical, `diff` zero residue; final suite re-run 17/17 green; backup and temp JSON deleted from `.rasen/`.

## Artifact coherence (proposal claim-by-claim)

- Impact list == actual footprint: git status shows exactly the named source/test/index files; `src/core/pipeline-registry/` and `packages/ui/**` untouched; no version change; no new command/option/flag (diff confirms rendering + JSON key only — no completions/locale churn).
- Signature matches D3 exactly (`deriveIssueReview(issueId, revisionId, status)`, plain strings beside status, never null); verification summary is by reference (`status.progress`, rollup counts — no entries/blockers copied; unit-pinned via JSON scans).
- Show payload: `review` beside `status` and `delivery` (store-issue.ts:1338), same derivation call site as the rollup (1330-1331).
- Human shape matches D4 including the closing statement and the not-ready no-duplication rule.
- Read-only guard extended: `review.ts` is in the walked no-write-surface set and the projection byte-test derives a review too (guard suite 9/9).
- Architecture index: quick-locate row + spec-store-engine module note both added and accurate against the code.
- tasks.md 13/13 checked, each verified against a real test/artifact above. Receipts summary's totals (evidence-missing x9, archive-pending x3) reproduced live.

## Findings

| # | Severity | Finding | Location |
| --- | --- | --- | --- |
| I-1 | Info | Design D2 / planner-findings wording says the node-scanned threads order "in (kind, nodeId) code-point order", but the implemented (and design-enumerated, and unit-pinned) kind order is `optional-open` -> `archive-pending` -> `record-absent` -> `evidence-missing`, which is not code-point order of the kind strings (that would put `archive-pending` first). The spec — the binding artifact — only requires "a stable (kind, node) order", which holds; behavior is consistent everywhere. Doc wording nit only. | design.md D2; review.ts:96-101 |
| I-2 | Info | `attentionThreads` casts `item.nodeId as string` (review.ts:122,129,136). Sound by construction (attention sets nodeId non-null for all three mapped kinds; null only for the two excluded Issue-level kinds), but the `IssueAttentionItem` type does not discriminate nodeId nullability per kind, so the compiler cannot check it. Acceptable; a future per-kind narrowing in attention's type would remove the casts. | src/core/issue-status/review.ts:122 |
| I-3 | Info | Environment, not this change: one `pnpm run build` completed exit 0 yet the dist lacked `dist/commands/shared-output.js`, making all 7 CLI tests fail with ERR_MODULE_NOT_FOUND (phantom red). A direct `tsc` re-run emitted the file; suite then 7/7 green. Transient single-file emit gap on this Windows box; worth remembering when a CLI suite goes uniformly red after a "successful" build. | build.js / dist |
| I-4 | Info | Style nit: the dropped-determination CLI test opens with the first statement on the `it(...)` line (`async () => {    await run(`). Cosmetic only. | test/commands/store-issue-review-cli.test.ts:430 |

No Blocker, Major, or Minor findings. All five focus items PASS; implementation, tests, receipts, and artifacts are mutually consistent and truthful.

VERDICT: CLEAN
