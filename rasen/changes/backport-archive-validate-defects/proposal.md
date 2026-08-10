## Why

0.2.0 currently carries six archive/validate defects that 0.1.7 fixed in its `archive-and-validate-defects` portfolio (PR #146/#148). They could not be cherry-picked onto 0.2.0 because 0.2.0 independently rewrote `archive-engine.ts` and `validator.ts` after the `e62b101f` fork point — the two branches are bidirectionally divergent in exactly the files these fixes touch. Two of the defects are Blockers (B1, B6) that break the documented `pr` + `on-merge` archive flow on 0.2.0. This change re-implements the fixes on 0.2.0's own archive/validate architecture rather than porting 0.1.7's diff.

The Store-v2-coupled fixes from the same portfolio (finalization TOCTOU, workspace claim recovery, registry alias safety) are deliberately out of scope — they depend on the Store-v2 runtime that 0.2.0 does not have and will be addressed alongside any Store-v2 work.

## What Changes

- **B1 (Blocker)**: `--apply-plan --yes` clears the `on-merge` timing gate at apply time through a `mergeConfirmed` assertion, instead of the merge override being frozen into the immutable plan. Today 0.2.0 has no such assertion path, so a `pr` + `on-merge` change saved without `--yes` can never be applied, and the printed recovery command cannot succeed. Also correct the blocked-apply recovery text and the skill's save/apply ordering.
- **B2 (Major)**: `rasen validate --strict` rejects a MODIFIED delta that would delete scenarios from the permanent spec baseline. Today only `rasen archive` catches this, after the change has already merged. Plain `validate` reports it as a warning (preserving current exit-code behavior for casual runs).
- **B3 (Minor)**: the spec preservation gate reports every failing requirement in one pass, instead of one per dry-run, so a single run shows the complete work list.
- **B4 (Trivial)**: a strict archive-intent rejection names the offending key/constraint (unexpected key, wrong schemaVersion, mismatched change, incomplete handoff), instead of a generic schema restatement identical across failure modes.
- **B6 (Blocker)**: archive planning rejects a ship log containing the reserved `## Archive` heading before issuing a token, instead of issuing a blocker-free token that fails at apply as a false `recoverable` whose exact-token resume loops forever.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `cli-archive`: apply-time merge-confirmation gate (B1), plan-time reserved ship-log heading rejection (B6), and named-constraint strict-intent rejections (B4).
- `cli-validate`: scenario-preservation check under `--strict` (B2) and complete multi-requirement error reporting in one pass (B3).

## Impact

- `src/core/archive-engine.ts`: B1 apply-time `mergeConfirmed` path (inspect + filter the timing blocker); B4 `reportUnexpectedKeys`-style named-constraint issues; B6 reserved-section plan blocker.
- `src/core/validation/validator.ts`: B2/B3 scenario-preservation comparison and full issue collection with stable capability identity.
- `src/commands/archive.ts`, `src/commands/validate.ts`: CLI wiring of the new assertion/check and rendering.
- Tests mirroring the 0.1.7 coverage, including mutation-discriminating tests for the two Blockers (B1: disable the apply-time filter → assertion that `applicable` flips true→false; B6: disable the plan-time blocker → assertion that `complete` flips false→true).
