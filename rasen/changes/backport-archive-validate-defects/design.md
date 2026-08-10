## Context

0.2.0 and 0.1.7 forked at `e62b101f`. 0.1.7 later fixed six archive/validate defects (B1–B6) in its `archive-and-validate-defects` portfolio, but 0.2.0 independently rewrote `src/core/archive-engine.ts` and `src/core/validation/validator.ts`, so those fixes do not exist on 0.2.0 and cannot be cherry-picked (verified: 0.2.0 has zero markers for `mergeConfirmed`/`reservedSection`/`missingScenarios`, and `validator.ts` lacks the preservation check). The defect semantics are documented in `E:\Downloads\2026-08-07-archive-and-validate-defects.md` and the 0.1.7 fixes serve as a **design reference** for behavior, but the implementation must fit 0.2.0's own archive/validate shapes (which implementation will locate precisely — e.g. the 0.2.0 apply path, the 0.2.0 plan builder, the 0.2.0 validator issue collector).

Two of the six are Blockers on the documented `pr` + `on-merge` archive flow (B1, B6).

## Goals / Non-Goals

**Goals:**
- B1: an `on-merge` + `pr` change can be archived by following the shipped instructions — `--apply-plan --yes` clears the timing gate at apply time via a `mergeConfirmed` assertion, without depending on the override being frozen into the immutable plan.
- B2: `rasen validate --strict` rejects a MODIFIED delta that deletes baseline scenarios (warning under plain `validate`).
- B3: the preservation gate reports every failing requirement in one pass.
- B4: a strict archive-intent rejection names the offending key/constraint per failure mode.
- B6: archive planning rejects a reserved `## Archive` ship-log heading before issuing a token.
- Each fix has a test that mutation-confirms the guard (especially the two Blockers).

**Non-Goals:**
- Store-v2-coupled fixes: finalization TOCTOU, workspace claim recovery, registry alias safety (need Store-v2).
- retention / OMP feature adaptation (separate change; depends on PR #151 for OMP).
- 0.1.7's dispatch-adapter (`DISPATCH_ADAPTERS`) or Store-v2 refactors — not imported.

## Decisions

- **B1 — apply-time assertion, not frozen override.** The merge override is an operator assertion about the outside world, not a property of the planned mutation. Introduce an apply-time assertion (`mergeConfirmed`) that filters the timing blocker out of the plan's blocker list at apply/inspect time, leaving the stored plan byte-identical. The CLI threads `--yes` into this assertion at the apply step. If 0.2.0 already has an apply inspection seam, reuse it; otherwise add a minimal one. Also fix the blocked-apply recovery text to name the real fix, and correct the skill's save/apply ordering so `--yes` is documented at the right step. (Mirrors 0.1.7 `inspectArchiveApplyPlan` semantics, adapted to 0.2.0's apply path.)
- **B2 — preservation check lives in validate too.** Run the same MODIFIED-block scenario-preservation comparison that the archive gate uses, inside `validate`, against the already-resolved delta + main spec. Level is `ERROR` under `--strict`, `WARNING` otherwise (preserves plain-validate exit codes). Carry `missingScenarios` into the issue so the message names what would be lost.
- **B3 — collect all, dedupe precisely.** Collect the preservation result for every MODIFIED requirement and emit one issue per failure. Deduplicate projected-spec failures only against the corresponding delta-shape issue, so unrelated requirement errors remain visible (no first-failure-only short-circuit).
- **B4 — named-constraint issues.** Each intent failure mode gets its own stable code and names the offending field/path: unexpected key (lists accepted keys), wrong `schemaVersion` (received value), mismatched `change` (received value), incomplete handoff. No generic catch-all restatement.
- **B6 — plan-time reserved-heading blocker.** When building the archive plan, detect a reserved `## Archive` heading in the ship log and emit a typed `evidence` blocker (do not declare the plan complete, do not issue a token). The apply-time guard that already rejects the collision stays as the second layer; the plan-time check is the user-facing, pre-token fix. (Mirrors 0.1.7 `reservedSection` semantics, adapted to 0.2.0's plan builder.)

## Risks / Trade-offs

- **Structural mismatch with 0.1.7.** 0.2.0's archive-engine/validator are laid out differently; the 0.1.7 fix code is a behavior reference, not a copy target. Implementation must locate the 0.2.0 function that owns each concern (plan builder, apply path, intent resolver, validator issue collector) and adapt. Mitigation: per-fix tests pin behavior, not structure.
- **B1 apply-path shape.** If 0.2.0's apply path has no assertion seam, adding one is a small interface change; keep it minimal and additive so non-merge applies are unaffected.
- **Test discrimination.** The two Blockers must have mutation-discriminating tests (disable the guard → the assertion that the observable flips). Without that, a regression that removes the guard would stay green.
