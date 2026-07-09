## 1. Orient (read before writing)

- [x] 1.1 Read `src/core/templates/workflows/auto.ts` and `review-cycle.ts` (current single-context recipes) and `archive-change.ts` (the existing `Task tool` subagent-spawn precedent)
- [x] 1.2 Read `src/core/templates/types.ts` (`SkillTemplate`/`CommandTemplate`), `skill-templates.ts`, `src/core/shared/skill-generation.ts`, `profiles.ts` (registry + ALL_WORKFLOWS)
- [x] 1.3 Read `src/core/artifact-graph/{types,schema,graph,resolver,state}.ts` (the data-layer template to mirror for pipelines) and `src/commands/workflow/{status,instructions,shared}.ts` + `src/cli/index.ts` (CLI conventions)

## 2. P1 — Orchestration playbook (pipelines still inline)

- [x] 2.1 Create `src/core/templates/workflows/_orchestration.ts` exporting the shared LEAD orchestration playbook text: tier detection (A/B/C), spawn role-isolated leaf workers that invoke existing stage skills, change-directory blackboard + run-state, structural author≠verifier, gate/loop/parallelGroup/condition interpretation, bounded loops + human escalation, SendMessage lead-only/same-session/warm-resume
- [x] 2.2 Re-export the playbook helper from `src/core/templates/skill-templates.ts` (consumed directly by auto/review-cycle via import; no skill-registry entry needed)
- [x] 2.3 Rewrite `auto.ts`: classify → select an INLINE pipeline DAG → interpret it via the playbook; cover `office-hours`/`propose`/`apply`; keep the human pause points as `gate`s
- [x] 2.4 Add the optional propose direction-review gate to `auto` (`--review-plan` / stage `leadReview`), with a Tier C self-review carve-out
- [x] 2.5 Add the adaptive Bug-Fix verify policy to `auto`
- [x] 2.6 Rewrite `review-cycle.ts` to consume the same playbook, inverting primary/fallback (SendMessage multi-agent PRIMARY, single-context explicit FALLBACK); keep delegating to `openspec-gstack-review`
- [x] 2.7 Tests: upgraded auto/review-cycle generation + content (tiers, role isolation, author≠verifier, propose-review gate, adaptive bug-fix, escalation); `core` profile still excludes opt-in workflows
- [ ] 2.8 Live agent-teams dry-run of a `small-feature` on real Claude Code — **deferred**: not runnable in the dev session (no agent-teams). Static generation + content verified; needs a Tier A session. (see retro follow-ups)

## 3. P2 — Pipeline registry (data) + CLI

- [x] 3.1 Mirror dual/tri-root resolution for pipelines (project > user > package) without modifying `artifact-graph/resolver.ts` (shared `createDualRootResolver` factory intentionally deferred to keep schema resolution untouched)
- [x] 3.2 Create `src/core/pipeline-registry/{types,pipeline,graph,resolver,state,index}.ts` mirroring `artifact-graph/*`: Zod stage schema, parser+validators (unique ids, requires resolve, acyclic, parallelGroup independence, injectable skill-existence), `PipelineGraph` (topo-sort), tri-root resolver, state
- [x] 3.3 Create built-in `pipelines/{full-feature,small-feature,bug-fix}/pipeline.yaml`; add `pipelines/` to `package.json` `files` (expert stages use real `gstack:<x>` skill names)
- [x] 3.4 Create `src/commands/pipeline.ts` (`list/show/classify/resume`) + register the `pipeline` command group in `src/cli/index.ts`; `--json` output; positional-arg validation
- [x] 3.5 Extend `openspec validate` to validate pipelines (unique ids, requires resolve, acyclic, skill/role exist, parallelGroup independence)
- [x] 3.6 Refactor `auto.ts` to read the DAG from the CLI (`pipeline classify`→`show`) and drop the inline pipeline defs; the playbook is unchanged
- [x] 3.7 Tests: `test/core/pipeline-registry/*`; `test/commands/pipeline.test.ts` + validate pipeline tests; a regression test proving a new task type = a new `pipeline.yaml` with no `.ts` change

## 4. P3 — Hardening, run-state, docs, retro

- [x] 4.1 Formalize run-state: `src/core/pipeline-registry/run-state.ts` (Zod schema + parse/read/write + `completedStages`); `pipeline resume` consumes the typed reader; tests added
- [~] 4.2 Tier B/C fallbacks: the single-context (Tier C) degrade rules and file-based reconstruction are specified + unit-covered (run-state read/parse, resume fallback). **Live Tier B run deferred** with 2.8.
- [~] 4.3 Docs: `docs/opsx-workflow-guide.md` updated to the orchestration model (tiers, registry, pipeline CLI, propose-review gate, adaptive verify). **Deferred**: `docs/commands.md` / `workflows.md` / `supported-tools.md` + `docs/zh/` mirrors (see retro follow-ups)
- [x] 4.4 Wrote `retro.md` for the change
- [x] 4.5 Closed the two P2-review UX Minors: `validate --type pipeline` (no name) → validate all pipelines; interactive selector includes pipelines

## 5. Final gate

- [x] 5.1 Full `pnpm build` + `pnpm test` (1473 passed / 0 failed) + `npm run lint` (eslint src/, clean)
- [~] 5.2 Three-tier smoke: Tier C path is the existing single-context behavior; **Tier A live smoke deferred** (no agent-teams in dev session)
- [x] 5.3 `openspec validate upgrade-auto-orchestrated-pipelines --json` passes; `validate --pipelines` passes (3/3)
