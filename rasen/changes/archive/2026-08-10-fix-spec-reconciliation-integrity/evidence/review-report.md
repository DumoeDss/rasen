# Independent Review Report: fix-spec-reconciliation-integrity

- Mode: dispatched, report-only, non-author review
- Review date: 2026-08-09
- Branch: `fix/archive-transaction-recovery-follow-up`
- Pre-child HEAD: `27b2d4c2fb6828fa9849b85cbfb458a47f2a0fac`
- Child code/test delta after re-review fix: 4 files, 1,035 insertions, 41 deletions
- Scope: `src/core/validation/validator.ts`, the three focused test files, and the complete child proposal/design/specs/tasks
- Verdict: **PASS / CLEAN** — the prior Minor is non-author-confirmed resolved; no open findings

## Scope check

**CLEAN.** The delta adds validator issue metadata and focused reconciliation/validation/CLI regressions. It does not modify archive, registry, workspace, Store-finalization, CLI options, dependencies, or persistence formats. The absence of a `src/commands/validate.ts` edit is consistent with the design: the stronger tests prove the existing direct and bulk renderers already preserve the complete issue array. VSR-1 through VSR-3 rely on the pre-child reconciliation implementation at HEAD and are credited here only as verified context, not as child-authored source changes.

## Re-review round 1 — 2026-08-09

- Target: the 234-line test-only fix added after the initial report in `test/core/validation.test.ts:1528-1760`.
- Original finding: **Minor `validation-error-family-coverage`** at `src/core/validation/validator.ts:183`.
- Disposition: **NON-AUTHOR-CONFIRMED RESOLVED**.

The five table-driven cases close the finding without widening production scope:

| Case | Covered validator families |
|---|---|
| `no operations` at `test/core/validation.test.ts:1540` | `spec_delta_no_operations`; explicitly proves the `requirement` property is absent. |
| `missing text and scenarios` at `test/core/validation.test.ts:1548` | Missing text and missing scenarios for both ADDED and MODIFIED. |
| `duplicate operation forms` at `test/core/validation.test.ts:1593` | Duplicate ADDED, MODIFIED, REMOVED, RENAMED FROM, and RENAMED TO. |
| `cross-section conflicts` at `test/core/validation.test.ts:1644` | MODIFIED+REMOVED, MODIFIED+ADDED, and ADDED+REMOVED. |
| `rename conflicts` at `test/core/validation.test.ts:1680` | MODIFIED using the RENAMED source and RENAMED target colliding with ADDED. |

The shared assertion at `test/core/validation.test.ts:1709` verifies exact `code` and `source`, nested root-relative capability identity (`area-one/<capability>`), and explicit `requirement` presence/absence. It validates each fixture twice and compares both ordered signatures to the same exact expected array at lines 1757-1758, covering deterministic repeat ordering. Together with the already-reviewed unreadable-input and missing-keyword cases, every `deltaIssue()` call family in `src/core/validation/validator.ts:203-521` now has direct metadata coverage.

## Findings

Pre-Landing Review: No open issues found.

### Standards

- **[RESOLVED Minor] `src/core/validation/validator.ts:183` — validation error-family metadata coverage.** The requested table-driven coverage was added at `test/core/validation.test.ts:1528-1760` and satisfies every condition in the original finding. Resolution is independently confirmed in re-review round 1.

Standards axis: **0 open findings; worst none.** No data-safety, concurrency, trust-boundary, enum-consumer, dead-code, performance, or Fowler-smell defect was found in the scoped delta. The test-only fix is whitespace-clean and strictly decodes as UTF-8.

### Spec

No missing, partial, incorrect, or out-of-scope requirement was found for VSR-1 through VSR-5 or CCR-1.

| Finding | Disposition | Evidence |
|---|---|---|
| VSR-1 fence masking | **VERIFIED CLOSED** | Both inventories flow through the line-preserving mask in `src/core/specs-apply.ts:885` and `src/core/specs-apply.ts:908`; backtick and tilde apply regressions are at `test/core/specs-apply.test.ts:206` and `test/core/specs-apply.test.ts:267`, with strict validation at `test/core/validation.test.ts:883`. The incoming-fence apply test also proves no canonical mutation on failure. |
| VSR-2 duplicate canonical no-delete | **VERIFIED CLOSED** | The one-to-one canonical inventory is checked before mutation/`emptied` computation at `src/core/specs-apply.ts:533`; `test/core/specs-apply.test.ts:328` removes the collapsed key, receives `spec_target_structure_invalid`, and proves both the file bytes and capability directory survive. |
| VSR-3 duplicate MODIFIED diagnostics | **VERIFIED CLOSED** | Each block is compared against `canonicalBlocks` before `skippedModified` suppresses simulation at `src/core/specs-apply.ts:643`; `test/core/specs-apply.test.ts:617` asserts the duplicate diagnostic plus the distinct missing-scenario result from each duplicate in exact order and no prepared update. |
| VSR-4 granular projected dedupe | **VERIFIED CLOSED** | Keys include exact source, semantic kind, and normalized requirement at `src/core/validation/validator.ts:143`, and suppression requires the corresponding projected key at `src/core/validation/validator.ts:612`; `test/core/validation.test.ts:547` proves one equivalent keyword error is deduped while an unrelated projected scenario error in the same source survives. |
| VSR-5 unreadable capability identity | **VERIFIED CLOSED** | `entryPath` and the normalized root-relative capability are derived before `readFile` at `src/core/validation/validator.ts:177`; `test/core/validation.test.ts:1328` covers a nested unreadable capability on Windows, and `test/core/validation.test.ts:1382` includes it in a repeatable mixed-error ordering assertion. |
| CCR-1 multi-error rendering | **VERIFIED CLOSED** | Direct rendering iterates the complete issue array at `src/commands/validate.ts:314`; bulk rendering does the same at `src/commands/validate.ts:481`. Direct human/JSON tests are at `test/commands/validate.test.ts:185` and `test/commands/validate.test.ts:206`; strict bulk human/JSON tests are at `test/commands/validate.test.ts:277` and `test/commands/validate.test.ts:296`, including item validity, exit status, and summary totals. |

Spec axis: **0 findings; worst none.** Stable code/source/capability/requirement metadata and deterministic readable/unreadable/projected/reconciliation ordering are explicitly asserted twice by the mixed report test.

## Compact coverage diagram

```text
delta discovery (sorted, root-relative identity)
├─ unreadable file ─────────────── [TESTED VSR-5]
└─ readable file
   ├─ shape issue metadata
   │  ├─ missing keyword ───────── [TESTED]
   │  └─ other changed families ── [TESTED: 5 table cases]
   ├─ projected validation
   │  ├─ same source/req/kind ──── [DEDUPED + TESTED VSR-4]
   │  └─ independent requirement ─ [RETAINED + TESTED VSR-4]
   └─ canonical reconciliation
      ├─ fenced scenarios ───────── [TESTED VSR-1]
      ├─ duplicate canonical ────── [NO DELETE + TESTED VSR-2]
      └─ duplicate MODIFIED ─────── [ALL DIAGNOSTICS + TESTED VSR-3]

complete ValidationReport.issues
├─ direct human + JSON ──────────── [TESTED CCR-1]
└─ strict bulk human + JSON ─────── [TESTED CCR-1]
```

## Test and verification disposition

- Recorded focused evidence after the fix is credible for the six named failure modes and the metadata-family closure: `94 passed, 3 skipped`; the five additional passes correspond to the five table-driven cases. The three skips remain the pre-existing Windows-inapplicable chmod permission tests, while the unreadable-input regression uses a read spy and runs on Windows.
- The command tests invoke `runCLI()`, whose harness verifies/builds a fresh `dist` before spawning the CLI, so the human/JSON evidence exercises built command behavior rather than stale TypeScript sources.
- Recorded focused tests and strict validation pass, and the present test fix is whitespace-clean. The new evidence now plausibly covers every changed `deltaIssue()` error family and both branches of requirement metadata presence.
- Task 4.3 remains an external verification hold: local Windows evidence is green and CI includes these test files, but PR #148 points at pre-child HEAD and no remote Windows job can exercise the uncommitted delta yet. This is not a code finding, but the child should not claim remote cross-platform completion until the post-commit job passes.
- This reviewer did not rerun tests because the dispatched `rasen-review` contract explicitly forbids a leaf reviewer from running or modifying tests; the disposition is based on the recorded evidence plus source/test inspection.

## Greptile

No Greptile comment was eligible for triage. PR #148 has head OID `27b2d4c2`, identical to the pre-child HEAD, so GitHub comments cannot target this uncommitted child delta. No replies or history writes were made.

## Explicit verification disposition

- VSR-1 through VSR-5: **closed at implementation/spec level**.
- CCR-1: **closed at implementation/spec level**.
- Standards gate: **clean; the prior Minor is non-author-confirmed resolved**.
- Remote Windows CI: **pending external evidence**.
- Overall: **PASS / CLEAN; 0 Blocker, 0 Major, 0 Minor, 0 Trivial**.

## Durable findings

1. The original Minor `validation-error-family-coverage` is non-author-confirmed resolved by the five table-driven cases.
2. Record a passing Windows CI job after the child delta is committed; the current PR head cannot supply that external evidence.
3. No eligible Greptile feedback exists for the uncommitted child delta.
