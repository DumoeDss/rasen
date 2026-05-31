## 1. Orient (read before writing)

- [ ] 1.1 Read `src/core/templates/workflows/auto.ts` and `review-cycle.ts` (current single-context recipes) and `archive-change.ts` (the existing `Task tool` subagent-spawn precedent)
- [ ] 1.2 Read `src/core/templates/types.ts` (`SkillTemplate`/`CommandTemplate`), `skill-templates.ts`, `src/core/shared/skill-generation.ts`, `profiles.ts` (registry + ALL_WORKFLOWS)
- [ ] 1.3 Read `src/core/artifact-graph/{types,schema,graph,resolver,state}.ts` (the data-layer template to mirror for pipelines) and `src/commands/workflow/{status,instructions,shared}.ts` + `src/cli/index.ts` (CLI conventions)

## 2. P1 — Orchestration playbook (pipelines still inline)

- [ ] 2.1 Create `src/core/templates/workflows/_orchestration.ts` exporting the shared LEAD orchestration playbook text: tier detection (A/B/C), spawn role-isolated leaf workers that invoke existing stage skills, change-directory blackboard + run-state, structural author≠verifier, gate/loop/parallelGroup/condition interpretation, bounded loops + human escalation, SendMessage lead-only/same-session/warm-resume
- [ ] 2.2 Re-export the playbook helper from `src/core/templates/skill-templates.ts`
- [ ] 2.3 Rewrite `auto.ts`: classify → select an INLINE pipeline DAG (full-feature/small-feature/bug-fix) → interpret it via the playbook; cover `office-hours`/`propose`/`apply`; keep the human pause points as `gate`s
- [ ] 2.4 Add the optional propose direction-review gate to `auto` (parameter `--review-plan` / stage `leadReview`): LEAD reviews proposal/design/specs/tasks for drift after the propose worker returns and before apply
- [ ] 2.5 Add the adaptive Bug-Fix verify policy to `auto`: unit-test gate suffices for simple, dedicated test worker + loop for complex; record the determination
- [ ] 2.6 Rewrite `review-cycle.ts` to consume the same playbook as its inner loop, inverting primary/fallback (SendMessage multi-agent PRIMARY, single-context explicit FALLBACK); keep delegating each pass to `openspec-gstack-review`
- [ ] 2.7 Tests: generation includes the upgraded `auto`/`review-cycle` for `claude`; instruction text contains tier A/B/C, role isolation, structural author≠verifier, propose-review gate, adaptive bug-fix, and bounded-loop escalation; `core` profile still excludes the opt-in workflows
- [ ] 2.8 `pnpm build` + `pnpm test` green; dry-run a `small-feature` on real Claude Code (agent-teams on) and confirm the LEAD spawns isolated workers, reviewer ≠ implementer, and warm SendMessage re-review fires

## 3. P2 — Pipeline registry (data) + CLI

- [ ] 3.1 Factor a shared `createDualRootResolver(name)` from `artifact-graph/resolver.ts` (package + user + project precedence); keep schema resolution behavior unchanged
- [ ] 3.2 Create `src/core/pipeline-registry/{types,pipeline,graph,resolver,state,index}.ts` mirroring `artifact-graph/*`: Zod stage schema (`id,skill,role,requires,gate?,loop?,parallelGroup?,condition?,leadReview?,verifyPolicy?`), parser+validators, `PipelineGraph` (topo-sort, next/blocked/complete), dual-root resolver, state
- [ ] 3.3 Create built-in `pipelines/{full-feature,small-feature,bug-fix}/pipeline.yaml`; add `pipelines/` to `package.json` `files`
- [ ] 3.4 Create `src/commands/pipeline.ts` (`PipelineCommand` with `list/show/classify/resume`) and register the `pipeline` command group in `src/cli/index.ts`; `--json` via `console.log(JSON.stringify(x, null, 2))`; positional-arg validation with helpful errors
- [ ] 3.5 Extend `openspec validate` to validate pipelines (unique ids, requires resolve, acyclic, skill/role exist, parallelGroup independence)
- [ ] 3.6 Refactor `auto.ts` to read the DAG from the CLI (`pipeline classify`→`show`) and drop the inline pipeline defs; the playbook is unchanged
- [ ] 3.7 Tests: `test/core/pipeline-registry/{types,pipeline,graph,resolver,state}.test.ts`; `test/commands/pipeline.test.ts` + e2e in `test/cli-e2e/`; a regression test proving **a new task type = a new `pipeline.yaml` with no `.ts` change**

## 4. P3 — Hardening, run-state, docs, retro

- [ ] 4.1 Formalize run-state: `openspec/changes/<name>/auto-run.json` schema + read/write helpers; wire `pipeline resume` to it
- [ ] 4.2 Verify Tier B (spawn, no agent-teams) and Tier C (single-context) fallbacks reconstruct context purely from the change directory + run-state
- [ ] 4.3 Update docs: `docs/opsx-workflow-guide.md` (orchestration model, tiers, parameters), `docs/commands.md`, `docs/workflows.md`, `docs/supported-tools.md` (tier annotations), and `docs/zh/` mirrors
- [ ] 4.4 Run `/opsx:retro` on the change

## 5. Final gate

- [ ] 5.1 Full `pnpm build` + `pnpm test` + `pnpm lint` green
- [ ] 5.2 Three-tier smoke: one pipeline each under A / B / C completes (or degrades) as specified
- [ ] 5.3 `openspec validate upgrade-auto-orchestrated-pipelines --json` passes
