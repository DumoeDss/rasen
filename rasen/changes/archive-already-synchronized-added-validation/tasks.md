## 1. Lock Down Existing-ADDED Semantics

- [ ] 1.1 Add an isolated archive regression in `test/core/archive.test.ts` proving that valid identical existing ADDED content must pass `--skip-specs` validation with zero spec actions; observe the current existing-name blocker before changing implementation.
- [ ] 1.2 Add focused reconciliation/validator cases for identical blocks, differing requirement or scenario content, malformed identical blocks, duplicates/cross-section conflicts, and mixed capabilities. Include LF/CRLF input and preserve strict ordinary validation/application behavior.

## 2. Implement Context-Aware Validation

- [ ] 2.1 Inspect references for affected exported APIs, then thread a narrow skipped-synchronization validation context from `src/core/archive.ts` through `src/core/validation/validator.ts` to the existing analyzer in `src/core/specs-apply.ts`; keep all other callers strict.
- [ ] 2.2 Accept an existing ADDED block only when its complete parsed `raw` content equals the admitted canonical block under that context. Preserve independent validation checks, existing snapshot handling, and the empty skip-specs action list.

## 3. Preserve Actionable Archive Diagnostics

- [ ] 3.1 Return validation reports at the archive boundary and carry every blocking issue into existing plan blockers with its source path, stable code, and capability/requirement context. Preserve non-blocking warning semantics and existing summary diagnostics.
- [ ] 3.2 Extend archive coverage to prove human/JSON conflict visibility, saved-plan issue retention, multiple independent errors, and unchanged merge/task gates. Use behavioral assertions rather than exact incidental wording; update locale catalogs and completeness coverage only if introducing package-owned message keys.

## 4. Verify the Authoritative Workflow

- [ ] 4.1 Run the affected archive, reconciliation, and validator tests, followed by type and lint checks for the changed interfaces. Record exact commands and outcomes; expand verification only if shared-contract failures warrant it.
- [ ] 4.2 Build current sources and run an isolated real CLI preview with `--skip-specs --dry-run --save-plan --json`, then apply its saved plan with validation enabled. Verify successful publication, removal of the active fixture Change, byte-identical canonical specs, and archived delta bytes equal to the originals. Verify a conflicting fixture remains blocked with actionable diagnostics. Do not replay the reported live Change or edit its saved plan.
- [ ] 4.3 Verify the focused tests in Windows CI as well as the local platform, using `path.join`/`path.resolve` fixtures and LF/CRLF cases. Record any unavailable platform evidence explicitly rather than treating local execution as Windows proof.

## 5. Document the Supported Behavior

- [ ] 5.1 Update the archive sections of `docs/cli.md` and `docs/zh/cli.md` in their existing languages: skipped synchronization retains validation, identical ADDED blocks are accepted only in that context, conflicts remain blocking, and prior blocked plans require a fresh operator-reviewed preview.
