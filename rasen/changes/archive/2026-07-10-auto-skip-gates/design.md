## Context

Gates in Rasen are stage metadata, not runtime code. A pipeline YAML stage may carry `gate: true` (`StageSchema.gate: z.boolean().default(false)`, `src/core/pipeline-registry/types.ts:297`), and the LEAD interprets it at prompt level: the orchestration playbook's Step D (`src/core/templates/workflows/_orchestration.ts:88`) says "After the stage, pause… wait for the human to Continue / Stop / switch to Manual", and `auto.ts:130` reinforces "Always pause at gate stages — never skip human confirmation". The built-in pipelines gate at `propose`, `apply`, and `ship` (small-feature, bug-fix, full-feature) and at `define-goal` and `ship` (the three goal-loop pipelines).

Because gate behavior is prompt text the LEAD reads — not a branch in TypeScript — most of this change is template wording. The only structural code change is widening the `gate` schema value so a pipeline can mark a gate as human-must-vet, plus a project-config key and run-state recording so the policy is set-once and resume-stable.

There are two unrelated fields both named `gate`: the stage-level pause gate (`StageSchema.gate`, the subject of this change) and the goal-loop `loop.gate` discriminated union (measure/evaluate) that configures the iterate loop's stop condition (`types.ts:199`, `run-state.ts:142`). This change touches ONLY the former. See `planning-context.md` for the verbatim intent and approved direction.

## Goals / Non-Goals

**Goals:**
- One argument (`--no-gate`) that makes `/rasen:auto` auto-approve ordinary gates and run unattended.
- A project-config default (`autopilot.gates: on|off`) so the flag need not be repeated; precedence flag `>` config `>` built-in default (on).
- Auto-approval is auditable: each skipped gate is recorded in run-state, and resume reads the policy from run-state without re-passing the flag.
- A `gate: 'vet'` value that `--no-gate` never skips, for gates whose purpose is human vetting of something dangerous (goal-loop `define-goal`).
- Strict backward compatibility: existing `gate: true|false` YAML parses and behaves exactly as today.

**Non-Goals:**
- Changing the built-in default. Absent flag and config, gates stay ON.
- Any change to the goal-loop `loop.gate` measure/evaluate union or the iterate loop's stop logic.
- Sandboxing the goal-loop measure command — the `vet` gate IS the safety mechanism (goal-plan.ts:63 explicitly relies on human confirmation instead of sandboxing).
- A CLI `rasen` flag. `--no-gate` is an argument to the `/rasen:auto` skill prompt, parsed by the LEAD like the existing `--pipeline` / `--review-plan` / `--planner` args, not a Commander option.
- Version bumps (repo directive, 2026-07-10).

## Decisions

**D1 — Widen `gate` to `boolean | 'vet'`, keep the default and boolean semantics.**
`StageSchema.gate` becomes `z.union([z.boolean(), z.literal('vet')]).default(false)`. `true`/`false` parse and mean exactly what they mean today; `'vet'` is a new opt-in. Rationale: a union preserves the existing default and every existing YAML value with zero migration. Alternative considered — an enum `'off'|'confirm'|'vet'` — rejected because it would break every existing `gate: true/false` document and the many tests that assert boolean gates.

**D2 — `--no-gate` is a prompt argument resolved by the LEAD, layered over run-state.** The LEAD parses `--no-gate` from the invocation (same place `auto.ts:30` documents `--pipeline` etc.), resolves the effective gate policy once (flag `>` `autopilot.gates` config `>` default on), and records it in the change's run-state at run start. Step D then reads the recorded policy per gate rather than re-deriving it. Rationale: keeps the behavior where it already lives (LEAD interpretation), and recording once makes resume deterministic. Alternative considered — a hard-coded TypeScript branch that skips gates — rejected because gate interpretation is deliberately prompt-level and per-pipeline; the LEAD already owns it.

**D3 — Auto-approve, never delete.** A skipped gate still produces a run-state entry (e.g. `gateDecision: auto-approved (--no-gate)`), so the audit trail reads identically to a human "Continue" except for the actor. Rationale: preserves resumability and post-hoc review; a skipped-but-unrecorded gate would make resume ambiguous about whether the stage was vetted. This is the semantic the user approved.

**D4 — `vet` is the hard safety carve-out.** Step D honors precedence `gate: 'vet'` `>` `--no-gate`: a `vet` stage ALWAYS pauses for human confirmation, even under `--no-gate`, and the wording states this explicitly so the LEAD cannot rationalize skipping it. The goal-loop `define-goal` stage becomes `gate: 'vet'` in all three goal-loop pipelines because it exists to let a human vet the LEAD-generated arbitrary-shell measure command before any round runs (goal-plan.ts:63). Rationale: `--no-gate` is about convenience gates (propose/apply/ship), not about waiving the one gate that guards arbitrary code execution. This also gives future human-must-approve gates a first-class hook.

**D5 — Child gates resolve via the existing parent-directive rule.** The playbook's Step G already states "parent directive `>` child gate" for decomposed portfolios. `--no-gate` IS a parent directive; the wording connects the two so a decomposed run's child-pipeline gates inherit the parent's auto-approve — except `vet` child gates, which still stop (D4 wins). No new mechanism; a wording bridge.

**D6 — Ship stage is not special-cased.** `ship`'s `gate: true` is auto-approved under `--no-gate` like any ordinary gate. The delivery mode (pr/push/local) is already explicit config, so `--no-gate` + delivery=pr means unattended PR creation. Rationale: no hidden exception; the risk surface is delivery mode, which the user already controls. Documented, not gated.

**D7 — Config key shape and non-conflict with `store-add-project`.** Add `autopilot: { gates: 'on' | 'off' }` under the project config, declared and validated the same resilient way existing keys are (`ProjectConfigSchema` in `project-config.ts`, per-field `safeParse` with warn-and-drop). The sibling `store-add-project` change touches the `references:` append path in the SAME file; this change only ADDS a schema field and reads it — the two edits are on different fields and different functions (schema declaration vs. raw-YAML append helper), so they compose without conflict. Rationale: keep both config edits additive and orthogonal.

## Risks / Trade-offs

- **A reader mistakes the two `gate` fields** → widening the wrong one would corrupt goal-loop stop logic. Mitigation: change ONLY `StageSchema.gate` at types.ts:297; leave `GoalLoopConfig.gate` / `loop.gate` (types.ts:199, run-state.ts:142) untouched. Called out in tasks and in the durable findings.
- **Template drift from compiled skills** → templates compile into skills via `build.js`; editing `auto.ts`/`_orchestration.ts` without rebuilding leaves stale skill text. Mitigation: run the build→update flow after template edits and verify parity per repo convention (a task).
- **`--no-gate` semantics leak to non-auto entry points** → `verify`/`ship`/other skills also read gate wording. Mitigation: scope the policy to the `/rasen:auto` LEAD flow and the run-state it writes; other skills are unchanged. The `vet` schema value is inert for pipelines that don't use it.
- **A user sets `autopilot.gates: off` and forgets** → unattended runs including ship. Mitigation: `vet` gates still stop; delivery mode still governs how ship delivers; the resolved policy is recorded in run-state and shown at run start so it is visible, not silent.
- **Backward-compat regression in gate parsing** → Mitigation: a test asserting existing `gate: true`/`gate: false`/absent all parse to their current values, plus the pipeline-show JSON shape for each.

## Migration Plan

Purely additive. Existing pipelines, existing `gate: true|false` YAML, and existing config files are unaffected until a user passes `--no-gate` or sets `autopilot.gates`. The goal-loop `define-goal` change from `gate: true` to `gate: 'vet'` is behavior-preserving under the default (both pause); it only changes behavior under `--no-gate`, where `vet` correctly still pauses. Rollback is reverting the schema union and template wording; any `autopilot.gates` config key left behind parses harmlessly (warn-and-drop if the field is removed from the schema).

## Open Questions

- Config value spelling: `autopilot.gates: on|off` (approved wording) vs. a boolean `autopilot.skipGates: true`. Leaning `gates: on|off` as it reads as policy state rather than a double-negative. Non-blocking; a trivial rename before implementation.
- Whether `pipeline show` should render `gate: 'vet'` distinctly (`gate(vet)`) in the human table for operator visibility. Recommended but cosmetic; the JSON already carries the exact value.
