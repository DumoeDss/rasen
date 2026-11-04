## 1. Lock Down Existing-ADDED Semantics

- [x] 1.1 Add an isolated archive regression in `test/core/archive.test.ts` proving that valid identical existing ADDED content must pass `--skip-specs` validation with zero spec actions; observe the current existing-name blocker before changing implementation.
- [x] 1.2 Add focused reconciliation/validator cases for identical blocks, differing requirement or scenario content, malformed identical blocks, duplicates/cross-section conflicts, and mixed capabilities. Include LF/CRLF input and preserve strict ordinary validation/application behavior.

## 2. Implement Context-Aware Validation

- [x] 2.1 Inspect references for affected exported APIs, then thread a narrow skipped-synchronization validation context from `src/core/archive.ts` through `src/core/validation/validator.ts` to the existing analyzer in `src/core/specs-apply.ts`; keep all other callers strict.
- [x] 2.2 Accept an existing ADDED block only when its complete parsed `raw` content equals the admitted canonical block under that context. Preserve independent validation checks, existing snapshot handling, and the empty skip-specs action list.

## 3. Preserve Actionable Archive Diagnostics

- [x] 3.1 Return validation reports at the archive boundary and carry every blocking issue into existing plan blockers with its source path, stable code, and capability/requirement context. Preserve non-blocking warning semantics and existing summary diagnostics.
- [x] 3.2 Extend archive coverage to prove human/JSON conflict visibility, saved-plan issue retention, multiple independent errors, and unchanged merge/task gates. Use behavioral assertions rather than exact incidental wording; update locale catalogs and completeness coverage only if introducing package-owned message keys.

## 4. Verify the Authoritative Workflow

- [x] 4.1 Run focused analyzer, validator, archive, and affected contract tests; run required type/lint checks. Build before CLI tests that execute `dist/`.
- [x] 4.2 Build current sources and run an isolated real CLI preview with `--skip-specs --dry-run --save-plan --json`, then apply its saved plan with validation enabled. Verify successful publication, removal of the active fixture Change, byte-identical canonical specs, and archived delta bytes equal to the originals. Verify a conflicting fixture remains blocked with actionable diagnostics. Do not replay the reported live Change or edit its saved plan.
- [ ] 4.3 Verify the focused tests in Windows CI as well as the local platform, using `path.join`/`path.resolve` fixtures and LF/CRLF cases. Record any unavailable platform evidence explicitly rather than treating local execution as Windows proof.

## 5. Document the Supported Behavior

- [x] 5.1 Update the existing CLI documentation to explain that `--skip-specs` preserves validation, accepts only identical already-synchronized ADDED blocks, and requires a fresh preview after a conflict is repaired. Keep source comments concise and preserve the language of localized documentation.
