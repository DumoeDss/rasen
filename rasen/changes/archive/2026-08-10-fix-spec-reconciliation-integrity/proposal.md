## Why

Canonical-spec reconciliation and `rasen validate` can currently accept destructive replacements or hide independent defects when Markdown examples, duplicate requirement headers, unreadable deltas, or multiple simultaneous errors are present. The open VSR-1 through VSR-5 and CCR-1 findings must be closed before the parent archive-recovery portfolio can rely on validation as its pre-mutation integrity gate.

## What Changes

- Make scenario-preservation comparison ignore `#### Scenario:` examples inside fenced Markdown on both canonical and incoming requirement blocks.
- Reject duplicate normalized canonical requirement headers before reconciliation can collapse the inventory or classify a capability as empty, with no canonical write or deletion on failure.
- Preserve missing-scenario diagnostics for every duplicate `MODIFIED` block while suppressing only their ambiguous simulated mutation.
- Deduplicate projected-spec validation failures only against the corresponding delta-shape issue, so unrelated requirement errors remain visible.
- Attach the root-relative capability identity to unreadable-delta diagnostics and keep deterministic, complete issue ordering across capabilities.
- Strengthen direct and bulk command coverage so human and JSON output must retain multiple independent errors rather than only the first one.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `cli-validate`: Validation reports every independent reconciliation and projected-spec issue with stable capability identity and consistent human/JSON behavior.
- `openspec-conventions`: Canonical requirement uniqueness and complete `MODIFIED` scenario replacement remain enforceable even around fenced examples and duplicate delta blocks.

## Impact

- Reconciliation and apply safety in `src/core/specs-apply.ts`.
- Validation issue collection and deduplication in `src/core/validation/validator.ts` and command rendering/coverage in `src/commands/validate.ts`.
- Focused reconciliation, validator, and validate-command tests, including strict, bulk, human, JSON, unreadable-input, duplicate-header, and no-mutation cases.
- No archive-engine, registry, workspace coordination, Store-finalization, CLI option, dependency, or persistence-format change.
