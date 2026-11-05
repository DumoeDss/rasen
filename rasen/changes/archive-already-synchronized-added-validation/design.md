## Context

The reported standalone Change was already synchronized: nine ADDED requirements matched five canonical specs. Its retained preview selected skipped synchronization and had no spec actions, but validation blocked archival. Merge confirmation was a separate blocker; confirming a merge does not waive validation.

Current source establishes the relevant path:

- `ArchiveCommand.run` validates before `prepareSpecActions` handles `skipSpecs` (`src/core/archive.ts`).
- `validateActiveChange` passes canonical specs to `Validator.validateChangeDeltaSpecs`, which uses `analyzeSpecUpdates` against admitted delta and canonical snapshots.
- `buildUpdatedSpecCore` reports `spec_added_requirement_exists` for every existing ADDED name without comparing content (`src/core/specs-apply.ts`).
- `validateActiveChange` returns a boolean. JSON output suppresses its console diagnostics, leaving the engine's generic `Archive validation did not pass.` blocker.

### Observed current-source behavior

On 2026-11-04, `pnpm run build:if-stale` confirmed that `dist/` matched current sources. A throwaway Node harness invoked `node bin/rasen.js archive synchronized-added --skip-specs --dry-run --json --yes` in three isolated project/home fixtures. Each Change contained one valid ADDED requirement and a completed task.

| Canonical state | CLI exit | Validation | Validator error |
| --- | --- | --- | --- |
| Identical requirement | 1 | blocked | `spec_added_requirement_exists` |
| Same name, different scenario outcome | 1 | blocked | `spec_added_requirement_exists` |
| Absent requirement | 0 | passed | none |

All three previews selected `specSync.mode: skip`, produced zero spec actions, and preserved canonical and delta content. No live Change was replayed, no apply was attempted, and temporary fixtures were removed. These observations bind the defect to the current source checkout; they do not establish which executable produced the historical report.

## Goals / Non-Goals

**Goals:**

- Finalize valid, already-synchronized ADDED content through `--skip-specs` with validation enabled.
- Distinguish complete content equality from a conflicting name collision.
- Preserve existing shape, discovery, duplicate, scenario, canonical-structure, and snapshot-consistency checks.
- Make actionable validation issues available in archive previews and saved plans.

**Non-Goals:**

- General idempotent replay of MODIFIED, REMOVED, or RENAMED operations.
- Relaxing ordinary archive spec application or standalone `rasen validate`.
- Changing Store v2 outcomes, merge/task gates, journal formats, or saved-plan recovery semantics.
- Repairing the live blocked Change, rewriting historical deltas, deleting canonical requirements, or providing an automatic validation bypass.

## Decisions

### 1. Select a narrow validation policy from the archive operation

Pass a typed reconciliation context from the explicit `skipSpecs` archive path through `validateActiveChange` and `validateChangeDeltaSpecs` into `analyzeSpecUpdates`. Its default remains strict; only skipped-synchronization archive validation admits identical existing ADDED blocks. Reuse the existing analysis path rather than filtering errors after validation or adding a second parser.

This is an internal operation context, not a new CLI flag or persisted configuration. Update every affected call site when adjusting signatures; ordinary validator, rebuild, and spec-writer callers retain strict behavior. The pre-existing `--no-validate` behavior remains separate.

Rejected alternatives: omitting the canonical directory would hide real conflicts; dropping all `spec_added_requirement_exists` issues would accept different content; globally changing ADDED semantics would widen this fix into ordinary synchronization behavior.

### 2. Compare the complete existing parsed block

Use the existing requirement-name lookup and compare the ADDED block's `raw` value with the matching block in the admitted canonical inventory. Both parser paths already normalize CRLF/CR to LF and trim trailing block whitespace. Equality includes the header, requirement text, scenario headings, scenario bodies, and their order; no semantic/fuzzy matching or new digest is needed.

For an equal block under the selected policy, keep the canonical block in the analysis and continue validation. For a differing block, retain `spec_added_requirement_exists` and its source, capability, and requirement identity. Do not treat a block introduced by another operation in the same delta as pre-existing canonical content. Existing duplicate and cross-section checks continue to block independently.

Only formatting normalization already performed by the parser is accepted. This intentionally refuses a canonical requirement that has acquired additional scenarios or otherwise diverged from the historical ADDED block.

### 3. Preserve validation issues at the archive boundary

Return the validation report rather than reducing it to a boolean inside `validateActiveChange`. Translate blocking issues into the existing plan-blocker representation with `operation: validation`, the delta source path, the stable issue code when available, and an actionable message containing capability/requirement context. Preserve issue order and independent failures across capabilities.

Keep the existing summary blocker and compatibility diagnostic as summaries; they must not be the only available explanation. Human rendering and JSON serialization consume the same issue facts. Warnings retain their existing non-blocking semantics. Keep raw diagnostics and existing machine codes stable; do not derive identity by parsing English messages. Any newly introduced package-owned human framing follows the existing locale catalog contract.

The existing blocker shape is sufficient: no archive journal or saved-plan schema migration is required. `archive-engine.ts` changes are unnecessary unless integration proves that its existing preparation-blocker input loses the supplied issue data.

### 4. Keep skipped synchronization write-free

`prepareSpecActions` continues returning an empty action list and `specSync.mode: skip`. Validation may read canonical specs; skipping synchronization does not mean skipping discovery or validation. The authoritative engine consumes the saved plan using its existing preconditions and performs no canonical writes. Archived delta bytes remain the original bytes.

New previews under the repaired implementation establish eligibility. Existing blocked saved plans remain blocked historical records; do not edit or reinterpret them.

### 5. Verify at consumer-visible boundaries

Add regression coverage in the existing archive and reconciliation suites, with direct validator coverage at the repository's existing seam. Cover identical versus conflicting blocks, malformed identical blocks, duplicate/cross-section failures, mixed capabilities, and strict callers. LF/CRLF fixtures exercise supported Windows-authored inputs without changing filesystem identity rules.

Run a built CLI saved-preview/apply smoke in an isolated project/home: validation enabled, identical ADDED blocks, skipped synchronization, successful publication, unchanged canonical bytes, and archived deltas equal to their originals. A conflicting fixture must remain active and return source/requirement diagnostics. Use direct byte comparisons, not new fingerprint machinery.

Run the affected tests after implementation, plus type/lint checks for changed interfaces. Existing wording-only assertions encountered in affected cases should become behavior assertions rather than being re-pinned. No full product/native test run or live archive replay is needed for this defect.

## Risks / Trade-offs

- **Equality is deliberately narrow.** Semantically equivalent wording or additional canonical scenarios still conflicts. This preserves the reported exact-match use case without guessing intent.
- **Shared analyzer policy could leak into writers.** Keep strict defaults and explicitly test ordinary validation/application collision rejection.
- **An identical malformed block could look synchronized.** Perform the normal shape and canonical checks; equality only resolves the existing-name collision.
- **A generic summary could continue hiding causes.** Assert issue codes, source paths, and requirement identities in JSON and saved plans, not only console output.
- **Preview success is not archive success.** Require isolated saved-plan apply and byte-preservation evidence before marking implementation complete.
- **Cross-platform inputs differ in separators and line endings.** Build fixture paths with `path.join`/`path.resolve` and reuse parser normalization; no platform-specific restriction is introduced.

## Migration Plan

Ship the bounded validation and diagnostic changes with their regression coverage and updates to the archive sections of `docs/cli.md` and `docs/zh/cli.md`, preserving each document's language. No data migration is required. A repaired CLI can create a fresh preview for a previously blocked Change after operator review; it does not automatically retry that Change. Reverting the code restores strict collision rejection without rewriting planning data.

## Open Questions

None for this scope. General already-applied MODIFIED/REMOVED/RENAMED handling is a separate behavior decision.
