## 1. Reconciliation Integrity

- [x] 1.1 Audit and complete `src/core/specs-apply.ts` scenario extraction so the existing line-preserving Markdown fence mask is applied to both canonical and incoming requirement blocks; add core apply and strict-validation regressions with backtick and tilde fences proving visible scenarios are neither hidden nor falsely preserved.
- [x] 1.2 Reject duplicate normalized canonical requirement headers before constructing the mutation map or computing `emptied`; add an apply regression proving the canonical file and capability directory are unchanged instead of deleted.
- [x] 1.3 Separate duplicate-`MODIFIED` diagnostic analysis from mutation eligibility so every duplicate block is compared with the immutable canonical scenario inventory while no duplicate wins simulation; assert the duplicate error plus each distinct missing-scenario issue in deterministic order.

## 2. Validator Issue Fidelity

- [x] 2.1 Replace any source-wide projected-error suppression in `src/core/validation/validator.ts` with exact source, normalized requirement, and semantic-kind keys; add a regression where an equivalent shape issue is deduplicated but an unrelated projected requirement error survives.
- [x] 2.2 Derive the root-relative capability identity before reading each discovered delta and attach it to every `spec_delta_read_failed` issue; cover nested capability paths and platform separator normalization without cwd fallback.
- [x] 2.3 Verify reconciliation, shape, and projected issues retain stable code/source/capability/requirement metadata and deterministic ordering when readable and unreadable capabilities fail together.

## 3. Command-Level Multi-Error Coverage

- [x] 3.1 Add direct `rasen validate --strict` human and JSON regressions in `test/commands/validate.test.ts` that assert at least two independent errors across capabilities, including their stable capability and requirement metadata.
- [x] 3.2 Add bulk strict human and JSON regressions that assert the same complete multi-error item is not truncated and that item validity, exit status, and summary counts remain consistent; adjust `src/commands/validate.ts` only if the stronger coverage exposes loss or reshaping.

## 4. Verification and Review

- [x] 4.1 Run `pnpm exec vitest run test/core/specs-apply.test.ts test/core/validation.test.ts test/commands/validate.test.ts --reporter=dot` and record focused evidence for VSR-1 through VSR-5 and CCR-1.
  - Evidence (Windows, 2026-08-09): 3 files passed; 89 tests passed, 3 skipped; exit 0 in 68.00s.
- [x] 4.2 Run `pnpm exec tsc --noEmit` and `pnpm lint` once after the focused suites are green.
  - Evidence (Windows, 2026-08-09): `tsc --noEmit` exit 0; `pnpm lint` exit 0.
- [ ] 4.3 Confirm the repository Windows CI job exercises the nested/unreadable capability-path and fenced-reconciliation regressions, and record the passing job as cross-platform evidence.
  - Pending external evidence: `.github/workflows/ci.yml` runs all `test/**/*.test.ts` across three `windows-latest` PowerShell shards, so the new focused files are covered. The local Windows focused run passed, but no remote job can include these uncommitted changes before portfolio shipping.
- [x] 4.4 Obtain non-author review of the scoped diff and focused evidence; do not mark any parent VSR/CCR finding resolved until that review confirms the exact failure mode is closed.
  - Pending LEAD orchestration: this leaf was explicitly prohibited from spawning or messaging a reviewer.
