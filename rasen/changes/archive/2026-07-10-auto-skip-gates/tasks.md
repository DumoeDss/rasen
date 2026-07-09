## 1. Widen the stage gate schema

- [x] 1.1 In `src/core/pipeline-registry/types.ts`, change `StageSchema.gate` from `z.boolean().default(false)` to `z.union([z.boolean(), z.literal('vet')]).default(false)`. Do NOT touch the goal-loop `loop.gate` / `GoalLoopConfig.gate` discriminated union (types.ts:199, run-state.ts:142) — that is a different field.
- [x] 1.2 Update the `Stage['gate']` type consumers: `StageView.gate` in `src/commands/pipeline.ts:90` widens to `boolean | 'vet'`; confirm the passthrough at line 629 needs no change and the truthy human-table check at line 680 still works (`'vet'` is truthy).
- [x] 1.3 (Optional, per design open question) In `pipeline.ts` human-table rendering, surface a `vet` gate distinctly (e.g. `gate(vet)`) while `--json` keeps the exact value.
- [x] 1.4 Add schema tests: `gate: true`, `gate: false`, `gate: 'vet'`, and omitted `gate` all parse to the expected values; an invalid gate value (e.g. `gate: 'maybe'`) is rejected.

## 2. Project config gate default

- [x] 2.1 In `src/core/project-config.ts`, declare `autopilot: { gates: 'on' | 'off' }` on `ProjectConfigSchema` and parse it with the existing resilient per-field `safeParse` (warn-and-drop on invalid; absent → undefined). Keep this edit additive and non-conflicting with the `references:` append path touched by sibling change `store-add-project` (different field, different function).
- [x] 2.2 Add a gate-policy resolver (flag `>` `autopilot.gates` config `>` built-in default ON) usable by the autopilot flow, returning the effective policy and its source.
- [x] 2.3 Tests: config with `autopilot.gates: off`, `on`, absent, and an invalid value; resolver precedence (flag beats config beats default).

## 3. Run-state recording and resume

- [x] 3.1 In `src/core/pipeline-registry/run-state.ts`, persist the resolved gate policy at run start and record a per-gate `gateDecision: auto-approved (<source>)` entry when a gate is auto-approved. Keep additions backward-compatible with existing run-state (new fields optional).
- [x] 3.2 Ensure `pipeline resume` reads the gate policy from run-state so the flag need not be re-passed; add a test for resume honoring the recorded policy.

## 4. Pipeline YAML: vet the goal-loop define-goal gate

- [x] 4.1 Change `define-goal` stage `gate: true` → `gate: vet` in `pipelines/goal-loop-measure/pipeline.yaml`, `pipelines/goal-loop-evaluate/pipeline.yaml`, and `pipelines/goal-loop-research/pipeline.yaml`. Leave all `ship` gates as `gate: true` and leave the iterate stages' `loop.gate` untouched.
- [x] 4.2 Verify `rasen pipeline show goal-loop-measure --json` (and evaluate/research) reports `define-goal` gate as `'vet'` and validates cleanly.

## 5. Template wording (prompt-level behavior)

- [x] 5.1 In `src/core/templates/workflows/auto.ts`: document `--no-gate` in the Input line (auto.ts:30 area); amend the "Always pause at gate stages — never skip human confirmation" guardrail (auto.ts:130) to reflect the gate policy and the `vet` exemption; add instructions to resolve the effective policy once, display it at run start, and record auto-approvals in run-state.
- [x] 5.2 In `src/core/templates/workflows/_orchestration.ts` Step D (line 88): make gate interpretation read the recorded policy — auto-approve `gate: true` when policy is off, and hold `gate: 'vet'` `>` `--no-gate` so a `vet` gate always pauses. Connect the "parent directive > child gate" wording in Step G so `--no-gate` propagates to ordinary child gates but not child `vet` gates.
- [x] 5.3 Confirm goal-command / goal-plan template text that references the `define-goal` `gate: true` (goal-command.ts:57,92; goal-plan.ts:8,63) still reads correctly with `gate: 'vet'`; update wording where it names the boolean explicitly.
- [x] 5.4 Run the template build→update flow (`node build.js` then the skill update step) so the compiled skills reflect the template edits; verify parity hashes/generated skill files per repo convention.

## 6. Validation and cross-platform

- [x] 6.1 Backward-compat regression test: existing built-in pipelines (small-feature, bug-fix, full-feature) parse and their `propose`/`apply`/`ship` gates behave as today under the default policy.
- [x] 6.2 Run `rasen validate auto-skip-gates`, `pnpm build`, `pnpm lint`, and the test suite. Account for the known Windows EBUSY flake in CLI-spawning tests (isolate-rerun to confirm any failure is the flake, not a regression).
- [x] 6.3 Confirm no version bump landed in `package.json` (release-agnostic change).
