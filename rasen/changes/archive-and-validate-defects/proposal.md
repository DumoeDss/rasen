## Why

A machine-local SkillMount defect report from 2026-08-07/08 identified six failures around archive planning, delta validation, and project registration. Two blocker defects make documented immutable-plan recovery impossible, while the validation gap can defer destructive scenario-loss detection until after delivery; these need correction without weakening the archive spec gate or the recorded-fact merge gate that correctly prevented data loss.

## What Changes

- Treat explicit merge confirmation on `rasen archive --apply-plan <token> --yes` as an apply-time operator assertion, while keeping planned mutations, finalization outcomes, and content fingerprints immutable. Never print an exact-token recovery command when replaying that token cannot advance.
- Check every `MODIFIED` requirement against its current canonical requirement during `rasen validate`: report omitted scenarios as warnings normally and strict-mode errors, with capability, requirement, file, and every missing scenario identified.
- Make archive spec preparation collect all delta reconciliation failures before returning blockers, instead of exposing one failing requirement per plan attempt.
- Make strict archive-intent diagnostics name each rejected key or failed constraint rather than collapsing unrelated schema failures into one generic message.
- Stop read-only root resolution from first-time-registering an unknown project path merely because copied config carries a `projectId`; when legacy ambiguity is encountered, name every conflicting root and the applicable `rasen home prune` repair.
- Reject a ship log containing the engine-reserved `## Archive` section during archive planning, before a blocker-free plan token can be issued. Ship and archive workflows will state and enforce ownership of that section.
- Add a confirmed, ownership-verified archive-plan abort path for an unapplied or early failed transaction. It may retire only engine-owned plan, stage, and journal state before canonical specs, publication, cleaner actions, or source removal; later transactions remain resumable and cannot be reset destructively.
- Document that a `MODIFIED` block replaces the complete requirement: every scenario that should survive must remain present, and behavior edits retain the scenario name unless deletion plus addition is intended.
- Preserve the existing safety contracts: archive still blocks scenario loss, merge timing is still gated on recorded delivery facts, immutable mutation plans are still content-bound, and foreign archive evidence is never overwritten.
- Keep generated single and bulk archive workflows aligned with the canonical PR gate: independently verify first, retain the blocker-naming interactive override for a known open PR and interactive merge-confirmation fallback when verification is unavailable, and refuse both paths in dispatched or non-interactive runs.
- Make human abort refusals enumerate blocker messages, the effective transaction phase, every retained path, and then the exact localized recovery or manual disposition, without generic replay advice for ownership or integrity disputes.
- Extend the canonical management finalization request with the explicit `mergeConfirmed` assertion and preserve nested structured finalization dispositions in the standard error envelope.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `cli-archive`: Apply-time merge confirmation, complete spec-preflight diagnostics, precise intent errors, reserved ship-log preflight, truthful recovery classification, and safe early transaction abort.
- `cli-validate`: Canonical-spec-aware scenario-preservation diagnostics with warning/strict-error severity.
- `openspec-conventions`: Complete-scenario semantics and stable scenario identity for `MODIFIED` requirements.
- `specs-sync-skill`: Reconciliation guidance must preserve every unchanged scenario when replacing a requirement.
- `opsx-archive-skill`: Generated archive workflows must reject reserved ship-log content and distinguish resumable failures from abort-and-replan failures.
- `opsx-ship-command`: Ship evidence must leave the `## Archive` section exclusively to the archive engine.
- `project-registry`: Read-only root resolution must not enroll copied roots, and duplicate-identity diagnostics must identify conflicting paths and repair commands.
- `change-finalization-transaction`: Stored-plan retirement must be ownership-verified, phase-limited, and incapable of undoing durable finalization effects.
- `management-http-api`: The Store finalization request accepts an explicit verified `mergeConfirmed` assertion, and refused finalizations preserve their nested blocker and recovery disposition.

## Impact

- Archive planning/application and transaction code in `src/core/archive.ts`, `src/core/archive-engine.ts`, generated-consumer invocation helpers, and Store v2 finalization wrappers.
- Delta parsing/reconciliation and validation in `src/core/specs-apply.ts`, `src/core/validation/validator.ts`, and `src/commands/validate.ts`.
- Project registry self-healing and owner-resolution diagnostics in `src/core/project-home.ts`, `src/core/project-registry.ts`, and learned-skill owner resolution.
- Archive/ship/sync workflow templates, spec-driven artifact instructions, command/completion metadata, all three CLI locale catalogs, and human abort refusal rendering.
- The management finalization HTTP bridge and its request/error contract.
- Focused regression coverage for saved-plan confirmation, multi-error preservation reports, strict validation, intent-key diagnostics, copied-root registration, reserved headings, recovery classification, canonical workflow PR overrides, localized abort disposition, management API finalization errors, and phase-safe abort on macOS, Linux, and Windows path semantics. No new runtime dependency is required.
