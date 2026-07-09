# Planning context — auto-skip-gates

## User intent (verbatim, 2026-07-10)

> 当前的workflow设了几个gate点，需要用户确认，我希望添加个参数能够跳过gate，这样在用户想要rasen自己去跑的时候，就不需要每次都说"no gate/跑完任务不用停"之类的话了。

User approved the LEAD's design direction in the office-hours discussion.

## Converged design (approved by user)

Current state: gates are stage metadata (`gate: true`) in pipeline YAML (`pipelines/*/pipeline.yaml`; small-feature gates propose/apply/ship). The LEAD interprets them at prompt level (`src/core/templates/workflows/_orchestration.ts` Step D: pause, wait for Continue/Stop/Manual). `auto.ts` guardrail says "Always pause at gate stages — never skip human confirmation".

1. **Entry points:** `/rasen:auto --no-gate <task>` flag, PLUS a project-level config default in config.yaml (e.g. `autopilot.gates: on|off`) so the user doesn't repeat the flag. Precedence: flag > config > built-in default (gates on).
2. **Semantics = auto-approve, not delete:** every skipped gate is still recorded in run-state (e.g. `gateDecision: auto-approved (--no-gate)`) so audit trail and resume semantics survive. Resume reads the gate policy from run-state — user does not re-pass the flag.
3. **`vet` gate exemption (the safety carve-out):** widen the pipeline schema's `gate` field from `boolean` to `boolean | 'vet'` (`src/core/pipeline-registry/types.ts:297`). `--no-gate` skips ordinary `gate: true` stages but NEVER a `gate: 'vet'` stage. Motivation: goal-loop's `define-goal` gate exists so a human vets the LEAD-generated arbitrary-shell `measure.command` (`src/core/templates/workflows/goal-plan.ts:63` explicitly relies on that gate instead of sandboxing). Mark `define-goal` in the goal pipelines' YAML as `gate: vet`. This also gives future human-must-approve gates a proper hook.
4. **Decompose child gates:** playbook Step G already has "parent directive > child gate" — `--no-gate` IS that parent directive; wording should connect them.
5. **Ship stage:** no special-casing — delivery mode (pr/push/local) is already explicit config; docs note that `--no-gate` + delivery=pr means unattended PR creation.

## Implementation surface

- `src/core/templates/workflows/auto.ts` — flag parsing, amend the "Always pause" guardrail line, gate-policy resolution + run-state recording instructions.
- `src/core/templates/workflows/_orchestration.ts` — Step D gate interpretation reads the recorded gate policy; `vet` semantics.
- `src/core/pipeline-registry/types.ts` — `gate: z.boolean().default(false)` → accept `'vet'`; check every consumer of `stage.gate` (resolver, graph, run-state, pipeline show JSON output, tests).
- `pipelines/goal-loop-*/pipeline.yaml` — `define-goal` stage `gate: true` → `gate: vet`.
- Possibly `src/core/project-config.ts` — new config key for the project default (check how existing config keys are declared/validated).
- Template changes require the build→update flow (templates are compiled into skills; parity hashes where applicable — see repo docs/conventions).
- Tests: schema acceptance of `'vet'`, pipeline show output, config key parsing.

## Constraints

- Version discipline: NO version bumps (user directive 2026-07-10); release-agnostic wording.
- Windows dev machine; test suite has known EBUSY flake in CLI-spawning tests (isolate-rerun to confirm).
- Runs AFTER sibling change `store-add-project` in the same working tree — keep diffs scoped; ship with explicit pathspec commits.
- Gate semantics are consumed by the LEAD at prompt level — most of the behavior change is template text; keep the schema change minimal and backward-compatible (existing `gate: true/false` YAML must parse unchanged).

## Durable findings (appended by planner, 2026-07-10)

- **TWO unrelated `gate` fields — do not confuse them.** (1) `StageSchema.gate: z.boolean().default(false)` at `types.ts:297` is the stage-level PAUSE gate this change widens to `z.union([z.boolean(), z.literal('vet')])`. (2) The goal-loop `loop.gate` / `GoalLoopConfig.gate` discriminated union (measure XOR evaluate) at `types.ts:199` and `run-state.ts:142` is the iterate-loop STOP condition — LEAVE IT UNTOUCHED. The design and tasks call this out explicitly.
- **Exact consumers of stage `.gate`** (verified by grep): `StageView.gate: boolean` type at `pipeline.ts:90` (widen to `boolean | 'vet'`); passthrough `gate: stage.gate` at `pipeline.ts:629` (no change); human-table truthy check `if (stage.gate) meta.push('gate')` at `pipeline.ts:680` (both `true` and `'vet'` are truthy → backward compatible; optional `gate(vet)` enhancement). No resolver/graph branch keys on the boolean value.
- **Gate interpretation is prompt text, not code.** Step D at `_orchestration.ts:88` ("After the stage, pause… Continue/Stop/Manual") and the guardrail at `auto.ts:130` ("Always pause at gate stages"). Flags are parsed by the LEAD from the invocation line (`auto.ts:30` documents `--pipeline`/`--review-plan`/`--planner` etc.) — `--no-gate` is an ARGUMENT to the skill prompt, NOT a Commander CLI flag.
- **Gate inventory across pipelines:** `propose`/`apply`/`ship` carry `gate: true` in small-feature, bug-fix, full-feature; `define-goal` (`gate: true`) + `ship` (`gate: true`) in all three goal-loop-* pipelines. This change flips ONLY the three `define-goal` stages to `gate: vet`; all `ship` gates stay `gate: true` (skippable).
- **Templates compile into skills via `build.js`** (`package.json` "build": "node build.js"). Editing `auto.ts`/`_orchestration.ts` requires the build→update flow; verify parity per repo convention (task 5.4). goal-command.ts:57,92 and goal-plan.ts:8,63 name the `define-goal` `gate: true` in prose — update wording when it flips to `vet`.
- **Config non-conflict with sibling `store-add-project`:** both changes touch `src/core/project-config.ts`, but on DIFFERENT surfaces — this change ADDS an `autopilot.gates` field to `ProjectConfigSchema` (declaration + per-field safeParse); store-add-project only appends to `references:` via a raw-YAML round-trip helper (separate function). No overlap.

## Artifacts produced (planner, 2026-07-10)
- proposal.md, design.md (7 decisions D1-D7), specs/autopilot-gate-policy/spec.md (5 requirements, ADDED only), tasks.md (6 groups, ~20 tasks). `rasen validate auto-skip-gates` → valid. 4/4 artifacts complete. No modified capabilities (schema widening is additive/backward-compatible; no existing spec requires boolean-only gate parsing).
