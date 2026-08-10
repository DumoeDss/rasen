## Context

The parent change already introduced a shared `SpecReconciliationAnalysis` path in `src/core/specs-apply.ts` and routed canonical-aware change validation through it. Independent review found that the seam still has six integrity gaps: fenced example headings can be treated as real scenarios, canonical duplicate headers can be collapsed before safety classification, duplicate `MODIFIED` blocks can lose their own preservation diagnostics, projected validation errors can be suppressed too broadly, unreadable deltas can lose capability identity, and command tests do not prove that multiple errors survive rendering.

The implementation on this branch contains partial, unverified edits around these findings. This child will refine and prove the existing structured seam rather than introduce a second reconciliation engine. It is constrained to `src/core/specs-apply.ts`, `src/core/validation/validator.ts`, `src/commands/validate.ts`, and focused reconciliation/validation tests. The warning-only behavior of ordinary validation, strict-mode promotion, deterministic issue ordering, selected-root baseline resolution, and the global no-write-on-analysis-error gate remain unchanged.

## Goals / Non-Goals

**Goals:**

- Make scenario identity reflect visible Markdown headings only.
- Reject ambiguous canonical inventories before any map collapse, empty-capability decision, or write/delete action.
- Separate diagnostic collection from mutation simulation so every independently actionable error survives.
- Deduplicate only semantically corresponding shape and projected errors.
- Preserve root-relative capability identity and deterministic ordering for unreadable inputs.
- Prove direct and bulk human/JSON command surfaces render more than one error.

**Non-Goals:**

- Changing `MODIFIED` whole-requirement replacement semantics, warning severity, strict-mode policy, or selected planning-root behavior.
- Automatically repairing duplicate headers, restoring omitted scenarios, or inferring scenario renames.
- Changing archive transaction/recovery code, registry behavior, workspace coordination, Store finalization, command options, persistence formats, or localization catalogs.
- Reworking general Markdown parsing beyond the existing fenced-region masking contract.

## Decisions

### 1. Use one line-preserving Markdown visibility mask for scenario inventories

Both canonical and incoming requirement blocks will pass through the existing fenced-code masking helper before `#### Scenario:` headings are extracted. The helper preserves line count, so extracted visible headings can still slice the corresponding original lines without offset drift. Scenario matching remains exact by trimmed heading text and uses occurrence counts, preserving the current behavior for duplicate scenario names while preventing a fenced example from satisfying a real canonical scenario.

The alternative is to add a scenario-specific fence parser. That would create a second definition of Markdown visibility and risk disagreement with delta parsing. Reusing the existing mask keeps the comparison aligned with the parser behavior already used elsewhere.

### 2. Validate the canonical inventory before constructing its mutation map

Reconciliation will inventory every canonical requirement block, group it by normalized header, and emit a deterministic structural issue when any normalized header occurs more than once. Only a one-to-one inventory may be converted into the name-keyed simulation map. Empty-capability classification and rebuilt content generation therefore occur only after uniqueness is proved.

Any structural issue leaves the capability without a prepared update. The existing change-level analysis gate then refuses all writes before `applySpecs()` can create, replace, or delete a canonical target. This uses the current all-or-nothing write boundary instead of adding rollback behavior.

The alternative is to retain the first or last duplicate in the map. Either choice silently discards canonical content and can turn a removal into capability deletion, so ambiguous inventories must fail closed.

### 3. Separate duplicate-block diagnostics from simulated mutation

Preflight will continue to report duplicate `MODIFIED` headers, but the diagnostic pass will compare every individual `MODIFIED` block with the immutable canonical block before deciding whether that normalized key may mutate the simulation. Each block can therefore contribute its own missing-scenario issue. The duplicate key is excluded from simulated mutation after diagnostics, so no arbitrary duplicate wins.

The alternative is to skip every duplicate block as soon as duplication is detected. That avoids ambiguous mutation but hides independently useful scenario-loss details; delaying the skip preserves both safety and complete feedback.

### 4. Deduplicate projected errors with requirement-scoped semantic keys

Delta-shape errors that have a projected-spec equivalent will be indexed by exact source path, normalized requirement identity, and semantic kind (for example, missing normative keyword or invalid scenario structure). A projected error is suppressed only when its own derived key matches one of those shape errors. Root-level projected errors, errors for another requirement, and different semantic kinds remain in the report.

Reconciliation issues use their existing stable code/source/requirement identity and deterministic sort. No source-wide suppression set is permitted. The alternative—suppressing all projected errors after any shape error in a source—causes unrelated invalid requirements to disappear and is the VSR-4 failure mode.

### 5. Derive unreadable-delta identity before file I/O

For every discovered delta path, validation will derive its capability from the path relative to the selected change's `specs` directory before attempting to read the file. Platform separators are normalized through the existing path utility to the stable root-relative capability form used by successful reconciliation, including nested capability layouts. A read failure then carries path, source, capability, stable code, and message even though no snapshot exists.

This avoids guessing identity from an error message or a basename and keeps Windows, macOS, and Linux output equivalent.

### 6. Treat complete command rendering as an invariant

The command layer will continue to render the complete `ValidationReport.issues` array for direct and bulk modes. Focused tests will create at least two independent deterministic errors across capabilities and assert the full set in both human and JSON output, including strict bulk validation. This is primarily a coverage hardening decision: command code changes are needed only if the stronger tests expose truncation or reshaping.

## Risks / Trade-offs

- [Risk] Fence masking could change line offsets used to recover scenario text. → Keep the existing line-preserving mask and test both backtick and tilde fenced examples against canonical and incoming blocks.
- [Risk] Duplicate canonical detection could happen after a partial write in one call path. → Keep all callers behind `analyzeSpecUpdates()` and assert canonical files/directories remain byte-for-byte unchanged when any issue exists.
- [Risk] Requirement-scoped deduplication could expose additional errors and change snapshots. → Use stable semantic keys and assert deterministic ordering rather than relying on incidental parser order.
- [Risk] Capability derivation can differ on Windows separators. → Build paths with `path.join`/`path.relative` and normalize only for the user-facing capability identity.
- [Risk] Existing partial edits may appear to satisfy a finding without covering its failure mode. → Add a focused regression for each VSR/CCR finding and require non-author review evidence before the parent treats it as resolved.

## Migration Plan

1. Harden scenario extraction and canonical inventory admission in the shared reconciliation seam.
2. Split diagnostic collection from duplicate-key mutation eligibility and preserve deterministic issue sorting.
3. Narrow validator deduplication and attach capability identity before unreadable-delta reads.
4. Add focused core and command regressions for all six findings, then run the smallest relevant suites plus type checking.

No data migration or compatibility shim is required. Rollback is code-only; existing delta and canonical spec formats remain unchanged.

## Open Questions

None. The child intentionally preserves the parent change's public severity and reconciliation contracts while closing only VSR-1 through VSR-5 and CCR-1.
