# Tasks — issue-unified-review-gate

## 1. Types and the review derivation

- [x] 1.1 Add `IssueReviewDetermination` (the seven-value discriminated vocabulary of
  design D1), `IssueReviewThread`, and `IssueReview` to `src/core/issue-status/types.ts`;
  export from the module index.
- [x] 1.2 Create `src/core/issue-status/review.ts` with
  `deriveIssueReview(issueId: string, revisionId: string | null, status: IssueStatus): IssueReview`:
  the gate-mapped determination (total mapping over the refusal-code union — compiler-pinned
  exhaustiveness), the thread inventory (design D2: attention-mapped kinds via
  `deriveIssueAttention`, then optional-open / archive-pending / record-absent /
  evidence-missing in stable (kind, nodeId) order), and the verification summary by
  reference (`status.progress`, the internally derived delivery counts).
- [x] 1.3 Unit-pin the determination matrix: review-ready (names the conditions revision),
  accepted (carries record date + revision), not-ready (blocker count; blockers stay in
  `status.acceptance.gate`), conditions-missing, no-plan (no revision at all), dropped,
  and acceptance-unknown (a status whose read supplied no acceptance facts).

## 2. Composition discipline pins

- [x] 2.1 No-second-basis pin: an Issue whose gate holds while every thread kind stands
  (optional in-flight, archive-pending, record-absent, evidence-missing) still derives
  `review-ready`; no thread changes any determination value.
- [x] 2.2 Thread-mapping pins: attention items of kind failure/blocked-behind/waiting-human
  become threads in fail-first order; `acceptance-awaiting` and `problem` items are
  excluded (documented reasons); failed/waiting optional nodes surface BOTH their
  optional-open thread and their attention thread.
- [x] 2.3 Purity + stability: same (issueId, revisionId, status) derives the identical
  review twice; thread ordering is stable under re-derivation; the derivation performs no
  filesystem/index/run-state access (extend the read-only guard pattern).

## 3. CLI surface

- [x] 3.1 In `src/commands/store-issue.ts` show: derive the review at the same call site
  as the delivery rollup, add `review` to the `--json` payload beside `status` and
  `delivery`, and render the concluding `review:` section after the delivery evidence —
  determination line (with its carried facts), thread lines, verification summary line,
  and the closing statement that review derives and accepting remains the operator's act.
- [x] 3.2 Parity test: human vs `--json` carry the same determination, threads, and
  summary; `list` output unchanged (no review facts); `not-ready` renders the blocker
  count without duplicating the gate's blocker list.

## 4. Byte-level coverage (temp stores)

- [x] 4.1 Temp-store fixture (extending the delivery suites' recipes): a review-ready
  Issue with conditions published and threads standing (optional in-flight node,
  run-terminal unarchived node, a record with a missing name); a not-ready Issue (un-terminal
  required + standing problem); conditions-missing; dropped. Assert determinations, threads,
  and the show section bytes.
- [x] 4.2 Write-nothing bytes: store refs, acceptance content, archive records, run-state
  files, and the workspace index byte-identical before/after a show with the review section.

## 5. Dogfood receipts (real store, read-only)

- [x] 5.1 On `issue-registry` (READ-ONLY): capture `store issue show` for the four closed
  Issues — each must read `accepted` carrying its record facts, with threads standing
  (per-record `evidence-missing: verification-report`; the three run-terminal
  `archive-pending` rows incl. the cross-project `document-multi-project-issues` one), plus
  one `--json` parity receipt. Any determination or thread that surprises is a finding,
  not a fixture edit.

## 6. Close-out

- [x] 6.1 Update `architecture-index` (quick-locate row + the issue-status module note) for
  `review.ts` and the show review section.
- [x] 6.2 Full affected-set run (issue-status + acceptance + CLI suites), validate green,
  hand to review with the receipts.
