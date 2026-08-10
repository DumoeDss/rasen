# Independent Review: teacher-consultation-canvas (child 4)

**Reviewer:** Independent, fresh context
**Date:** 2026-08-10
**Branch:** feat/teacher-advisor-workflow

## Round 1 verdict: CHANGES-REQUESTED (3 findings: BLK-1, BLK-2, MAJ-1)
## Round 2 verdict: CLEAN

---

## Round 2 — Delta re-review

The fixer touched ONLY test files (no source). The tracked diff (`git diff --stat HEAD`) is byte-identical to round 1: 5 source files, same line counts (142+39+54+145+4 = 375 insertions, 9 deletions). No source regression.

### BLK-1 — CONFIRMED FIXED

Both component test files now use the container pattern:

- `consultation-observability.test.tsx`: Lines 1 (`// @vitest-environment jsdom`), 61-66 (`beforeEach` creates `container`), 68-71 (`afterEach` cleanup), 75 (`render(<...>, container)` two-arg), 76+ (queries via `container.querySelector`). All 7 tests pass.
- `consultation-binding-editor.test.tsx`: Lines 1, 54-64 (same pattern), 68+81 (two-arg render), queries via `container`. All 6 tests pass.

The 13 tests that crashed in round 1 now all pass.

### BLK-2 — CONFIRMED FIXED

New file `packages/ui/test/canvas/v2-node-panel-consultation.test.tsx` (237 lines, 4 tests):

1. AtomicStage+binding renders consultation section AND preserves execution editor (`v2-node-panel-capability` still present).
2. Gate node does NOT render consultation section; Gate editor still present.
3. BoundedLoop node does NOT render consultation section; BoundedLoop editor still present.
4. AtomicStage without `fullDefinition` prop does NOT render consultation section; execution editor still present.

The test exercises real V2NodePanel rendering (not just the ConsultationBindingEditor directly) and verifies both positive presence (correct node type) and negative absence (wrong node types, missing prop). All 4 tests pass.

### MAJ-1 — CONFIRMED FIXED (discriminating)

The "no advice bodies" test now uses distinctive VALUE strings as fixture digests (lines 7-9):
```ts
const QUESTION_DIGEST = `sha256:question-body-${'b'.repeat(50)}`;
const ADVICE_DIGEST = `sha256:advice-body-${'d'.repeat(50)}`;
const EVIDENCE_DIGEST = `sha256:evidence-body-${'e'.repeat(50)}`;
```

And asserts their VALUES are absent from the rendered text (lines 148-150):
```ts
expect(text).not.toContain(QUESTION_DIGEST);
expect(text).not.toContain(ADVICE_DIGEST);
expect(text).not.toContain(EVIDENCE_DIGEST);
```

**Discrimination proof:** If someone added `{entry.source.questionDigest}` to the panel JSX, the DOM would contain `sha256:question-body-bbbbb...` (the actual digest value). The assertion `expect(text).not.toContain(QUESTION_DIGEST)` checks for exactly that string, so it would FAIL. The test is now genuinely discriminating — it catches value leakage, not just key-name coincidence.

### Source files untouched

`git diff --stat HEAD` shows the same 5 source files with identical line counts as round 1. No source code was modified by the fixer.

---

## Round 2 test counts (independently observed)

| Suite | Passed | Failed | Skipped | Files |
|---|---|---|---|---|
| Consultation tests only (4 files) | 39 | 0 | 0 | 4 |
| Full `packages/ui` suite | 699 | 1 (i18n timeout, flaky) | 0 | 64 |
| i18n catalog test in isolation | 12 | 0 | 0 | 1 |

The 1 failure in the full suite (`test/i18n/catalog.test.ts > "all literal catalog keys..."`) is a timeout under resource contention — it passes in isolation (12/12 in 1.2s). Unrelated to this change.

**UI file paths confirmed in vitest output:** `test/canvas/consultation-canvas.test.ts`, `test/components/consultation-observability.test.tsx`, `test/components/consultation-binding-editor.test.tsx`, `test/canvas/v2-node-panel-consultation.test.tsx` — all listed and passing.

---

## Overall verdict: CLEAN

All three findings from round 1 are genuinely resolved. The fix is clean (test-only, no source changes). The 39 consultation tests all pass, including the central safety-constraint tests (no advice bodies rendered, no interactive controls) that were broken in round 1.

---

## Round 1 (archived for reference)

### Original findings (all resolved in round 2)

**BLK-1 [Blocker] — 13 of 35 new tests crash: preact `render()` called without container argument**
Both test files called `render(<Component />)` with a single argument. Fixed in round 2: both now use two-arg `render(<Component />, container)` with `beforeEach`/`afterEach`.

**BLK-2 [Blocker] — Task 6.5 (V2NodePanel integration test) had no test coverage**
Fixed in round 2: new `v2-node-panel-consultation.test.tsx` with 4 tests covering AtomicStage positive case, Gate/BoundedLoop negative cases, and missing-prop negative case.

**MAJ-1 [Major] — Observability panel "no advice bodies" test checked key-name absence, not value absence**
Fixed in round 2: test now asserts distinctive digest VALUES (`sha256:question-body-...`) are absent from rendered text, not just key names.

### Original code review (areas A-F, all still valid — source unchanged)

**A. Pure-UI claim:** CONFIRMED. All 5 tracked files under `packages/ui/`. Zero server-side changes.
**B. Observability panel:** Component renders only state badges, counters, identities, decisions, failure reasons. Zero interactive controls. Now verified by passing tests.
**C. definitionIssuePathTarget:** Correct and additive for both v1 (fallback after null issuePathTarget) and v2 (new segment check before definitionFields). No collision.
**D. Additive + backward compat:** `fullDefinition` prop optional. Existing editors unchanged. 145 existing UI tests pass.
**E. Wire-type mirror:** `WireConsultationBinding` matches `ConsultationBindingYamlSchema`. `ConsultationViewSection` matches `ConsultationViewSectionSchema`. v1 round-trip passes.
**F. Verification theater:** Logic tests discriminating (extractor, draft helpers, path routing). Component tests now discriminating (container pattern, value-based assertions, integration coverage).
