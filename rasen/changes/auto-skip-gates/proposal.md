## Why

The autopilot workflow (`/rasen:auto`) pauses at gate stages (propose, apply, ship) and waits for the user to Continue / Stop / go Manual. When a user wants Rasen to run unattended end-to-end, they must repeat "no gate" / "don't stop when you're done" at every pause. There is no way to declare "run without stopping" once. This change adds an explicit, auditable way to auto-approve gates — a run flag plus a project-level default — while keeping a safety carve-out for gates that exist specifically so a human can vet something dangerous.

## What Changes

- **New `--no-gate` argument on `/rasen:auto`.** When present, ordinary gate stages are auto-approved instead of pausing: the LEAD records the auto-approval and proceeds without waiting for human confirmation.
- **New project-level default.** A config key (`autopilot.gates: on | off`) in `rasen/config.yaml` lets a user set the gate policy once so they need not pass the flag each run. Precedence: run flag `>` project config `>` built-in default (gates ON).
- **Auto-approve is recorded, not silent.** Every skipped gate is written into the change's run-state with an explicit decision (e.g. `gateDecision: auto-approved (--no-gate)`), so the audit trail survives and `pipeline resume` reads the gate policy from run-state — the user does not re-pass the flag on resume.
- **`vet` gate carve-out (safety).** The pipeline stage schema's `gate` field widens from `true|false` to accept a new `'vet'` value. `--no-gate` auto-approves `gate: true` stages but NEVER a `gate: 'vet'` stage. The goal-loop pipelines' `define-goal` stage becomes `gate: 'vet'` because that gate exists so a human vets the LEAD-generated arbitrary-shell measure command before any round runs.
- **Backward compatible.** Existing `gate: true` / `gate: false` pipeline YAML parses and behaves exactly as today; the human-facing default is unchanged (gates on). No version bumps.

## Capabilities

### New Capabilities
- `autopilot-gate-policy`: The gate-skipping policy for `/rasen:auto` — the `--no-gate` argument, the `autopilot.gates` project-config default and its precedence, run-state recording of auto-approved gates, resume reading the policy from run-state, and the `gate: 'vet'` exemption that `--no-gate` never skips.

### Modified Capabilities
<!-- No existing capability's spec-level REQUIREMENTS change. The pipeline `gate` field's schema widening is an additive, backward-compatible mechanism (no existing gate-parsing requirement is specced as boolean-only); goal-loop and orchestration behavior changes are template/prompt text governed by the new capability above. If a reviewer identifies an existing spec whose stated requirement is boolean-only gate parsing, add a MODIFIED delta there — none was found in rasen/specs/. -->

## Impact

- **Schema**: `src/core/pipeline-registry/types.ts` — `StageSchema.gate` widens from `z.boolean().default(false)` to accept `'vet'` (e.g. `z.union([z.boolean(), z.literal('vet')]).default(false)`), keeping the default and boolean acceptance unchanged.
- **Gate consumers**: `src/commands/pipeline.ts` — `StageView.gate` type widens to `boolean | 'vet'`; the passthrough (line 629) is unchanged; the human-table truthy check (line 680) stays correct (`'vet'` is truthy) and MAY surface `gate(vet)`.
- **Templates (prompt-level behavior)**: `src/core/templates/workflows/auto.ts` — document `--no-gate`, amend the "Always pause at gate stages" guardrail, add gate-policy resolution + run-state recording instructions; `src/core/templates/workflows/_orchestration.ts` — Step D reads the recorded gate policy and honors `vet` as never-skippable. Template edits require the build→update flow (templates compile into skills via `build.js`).
- **Pipeline YAML**: `pipelines/goal-loop-measure/`, `goal-loop-evaluate/`, `goal-loop-research/` — `define-goal` stage `gate: true` → `gate: vet`.
- **Config**: `src/core/project-config.ts` — declare and parse the `autopilot.gates` key (kept non-conflicting with the config work in sibling change `store-add-project`).
- **Run-state**: `src/core/pipeline-registry/run-state.ts` — record the resolved gate policy and per-gate auto-approval decisions so resume is policy-stable.
- **Out of scope**: changing the built-in default (gates remain ON absent flag/config); any change to the goal-loop `loop.gate` measure/evaluate discriminated union (a different field).
