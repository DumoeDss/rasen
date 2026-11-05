## Why

A completed Change whose ADDED requirements were already synchronized to canonical specs cannot be archived with `--skip-specs` while validation is enabled. Operators need to finalize that Change without rewriting historical deltas or disabling validation, and need requirement-level explanations when content genuinely conflicts.

## What Changes

- Allow `archive --skip-specs` to validate an ADDED requirement already present with the same complete parsed requirement block in the selected canonical spec.
- Keep malformed deltas, duplicate requirements, conflicting same-name content, and other existing validation failures blocking. Keep ordinary spec application and standalone `rasen validate` behavior unchanged.
- Preserve canonical spec bytes and historical delta bytes during skipped synchronization; use the authoritative archive plan/apply workflow.
- Include actionable validation issues in human and JSON archive previews and saved plans instead of exposing only a generic validation blocker.
- Verify the behavior with isolated fixtures, including saved-plan apply. Do not replay or modify the reported live Change or its retained evidence.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `cli-archive`: Clarify validation under skipped synchronization, admit identical existing ADDED requirements in that context, and retain requirement-level archive validation diagnostics.

## Impact

- `src/core/archive.ts`: Select the skip-specs validation context and carry validation issues into plan blockers.
- `src/core/validation/validator.ts` and `src/core/specs-apply.ts`: Reuse existing snapshot-based validation and reconciliation with a narrowly scoped existing-ADDED policy.
- Focused archive, validator, and reconciliation regression coverage; existing archive usage documentation.
- No new dependency, CLI flag, persistent format migration, or change to merge confirmation, task completion, Store v2 outcome policy, or archive recovery.

Source context: local report `2026-10-30--archive-already-synchronized-added-validation.md`. Its retained preview establishes the original failure; an isolated current-source CLI comparison independently establishes the same validation defect. The report and product evidence remain local and unchanged.
