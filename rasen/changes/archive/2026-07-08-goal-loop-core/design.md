## Context

`/opsx:auto` orchestrates role-isolated workers through a data-driven pipeline registry. Every built-in pipeline today (`full-feature`, `small-feature`, `bug-fix`) produces a code-change document — the DAG always ends in ship → archive, and the only loop the playbook knows (`review-cycle`, Step E) drives a diff to review-clean. There is no way to drive a task whose "done" is a *condition* rather than a document: a measurable threshold (Lighthouse score, p99 latency, memory), a quality judgment against a rubric, or autoresearch-style research/writing.

`StageLoopSchema` (`src/core/pipeline-registry/types.ts:170`) is a single `z.object({ kind: z.literal('review-cycle'), maxRounds })`. The loop is consumed in exactly two places: the playbook prose (Step E in `_orchestration.ts:94`) and the `pipeline show` display (`src/commands/pipeline.ts:641`). Run-state (`run-state.ts`) has no loop-progress fields. The registry auto-discovers pipelines from `pipelines/<name>/pipeline.yaml` (no code registration), and skill templates are registered in two hardcoded lists in `src/core/shared/skill-generation.ts` (`getSkillTemplates`, `getCommandTemplates`) re-exported from `src/core/templates/skill-templates.ts`.

This change adds a **goal-driven iteration loop** (`kind: goal`) as a first-class loop kind, with three registered backend pipelines and a single user-facing entry `/opsx:goal`. It is one coherent mechanism, scoped to `goal-loop-core`; end-to-end tests and docs are the separate `goal-loop-validation` change.

## Goals / Non-Goals

**Goals:**
- A goal-loop stage repeats modify→judge until a gate is satisfied or `maxRounds` is exhausted, with `loopStallLimit` catching no-progress spirals.
- Two gate kinds, each its own pipeline: `measure` (deterministic command → `{score, passed}`) and `evaluate` (fresh reviewer worker → `{satisfied, gaps}`). Exactly one gate per pipeline.
- One user-facing entry `/opsx:goal`; the LEAD classifies and selects one of three backend pipelines (explicit override wins).
- Zero behavior change to existing pipelines and the `review-cycle` loop.
- Data-driven: goal-loop is registered pipelines + a loop kind, not hard-coded branches in `auto.ts`.

**Non-Goals:**
- No new agent role (reuse `implementer`, `reviewer`, `planner`, `shipper`).
- No AND/OR gate combination in v1 (one gate per pipeline by construction).
- No sandbox enforcement on `measure.command` beyond the define-goal human gate.
- No dedicated named tool for implementer self-measure (the implementer runs the measure command via Bash during its dispatch).
- End-to-end / kill-resume integration tests and user-facing docs (deferred to `goal-loop-validation`).

## Decisions

### D1 — A family of homogeneous pipelines, not one generic pipeline with conditions

**Decision:** Three backend pipelines (`goal-loop-measure`, `goal-loop-evaluate`, `goal-loop-research`), each with exactly one gate type, one iterate-skill flavor, and one tail.

**Rationale.** An earlier single-pipeline design (v3) forced heterogeneous tasks into one shape via runtime `conditions` on stages + one generic iterate skill. Adversarial review found three load-bearing defects: (a) AND-semantics stall hole — combining a measure and evaluate gate left no single well-defined "progress" signal; (b) unenforced conditional-tail exclusivity — ship-vs-report was a runtime condition that could silently pick neither; (c) a hand-waved generic prose skill that conflated code-edit and research dispatch. A family of homogeneous pipelines dissolves all three: each pipeline has ONE gate type, ONE iterate flavor, ONE tail. No conditions, no combination, no tail ambiguity.

**Alternative considered (rejected).** Single pipeline with `gate: { measure?: …, evaluate?: … }` and conditional tails. Rejected on the three defects above.

### D2 — Discriminated union on `loop.kind`, gate as a required discriminated union

**Decision.** Convert `StageLoopSchema` from `z.object({ kind: z.literal('review-cycle'), … })` to `z.discriminatedUnion('kind', [reviewCycleVariant, goalVariant])`. Inside the `goal` variant, `gate` is itself a `z.discriminatedUnion('kind', [measureVariant, evaluateVariant])` and is **required**.

**Rationale.** A discriminated union makes the two loop kinds (and the two gate kinds) structurally exclusive — TypeScript narrows on `kind`, and Zod rejects mixed shapes at parse. This is what dissolves AND/OR combination: you cannot express "measure AND evaluate" in the schema. The existing `review-cycle` variant keeps its exact shape, so the union is backward compatible.

**Field name `loopStallLimit`** (not `stallLimit`, not `measureStallLimit`). The registry already has `HandoffConfigSchema.stallLimit` (`types.ts:100`); reusing the name would collide conceptually and in resolved-config reporting. `loopStallLimit` is gate-neutral (applies to both measure and evaluate progress), so it is not named after one gate kind.

**superRefine:** a measure gate needs `threshold` OR `target` to define a stop condition; the refine enforces this at parse. The measure `command` string is **optional in the registry schema but required at runtime** — the registered pipeline declares only the gate *type* (`{ kind: measure }`); the LEAD injects the concrete `command`/`threshold` from `goal-plan.md` into `iterate.loopConfig` before round 1 and asserts the command is present. This keeps the pipeline data static while letting the per-task command vary.

**Alternatives considered (rejected).**
- Conditions on stages (rejected — see D1).
- `gate` as an array allowing combination (rejected — reopens the AND-semantics stall hole).

### D3 — Run-state is additive; `goal-run.json` is the authoritative loop spine

**Decision.** Add two optional fields to `RunStateSchema` (`run-state.ts`, which is already `.passthrough()`): `loopConfig` (the injected effective gate config) and `loopProgress` (a best-effort derived cache: current round, last score, stall streak, `historyRef` → `goal-run.json`). The **authoritative** per-round record is `goal-run.json` in the change directory — each round appends `{round, score?, measurePassed?, evaluateSatisfied?, detail?, gaps?, error?, gitTreeFingerprint}`.

**Rationale.** Run-state already uses `passthrough()`, so additive fields cannot break existing readers or the typed reader (`parseRunState`). `loopProgress` is a convenience for the `pipeline resume` fast path; `goal-run.json` is the spine that survives worker relay (the implementer is warm-reused but may hand off via Step H.3 — the record on disk is what a successor reads). Mirrors how `review-cycle-report.md` is the durable artifact for the review loop.

### D4 — Orchestration: generalize Step E to dispatch on `loop.kind`; add Step L

**Decision.** Step E currently assumes `review-cycle`. Generalize its preamble so the LEAD narrows on `loop.kind`: `review-cycle` runs the existing review→fix protocol unchanged; `goal` runs the new Step L. Step L is isomorphic to review-cycle's single-dispatch-per-round shape:

- **Inject** (once, before round 1): read `goal-plan.md`, merge concrete gate config into `iterate.loopConfig`; assert a measure gate has its `command`.
- **Each round**: dispatch the implementer (warm-reused across all rounds — same worker, like review-cycle reuses the fixer thread; rounds do NOT each cost a fresh relay). Round-1 seed = `goal-plan.md`; round-N>1 seed = plan + prior round's judgment. Then run the gate: measure = run `gate.command`, parse `{score, passed, detail}`; evaluate = dispatch a **fresh reviewer worker** (≠ implementer — author≠verifier) that MUST return structured `{satisfied: boolean, gaps: string[]}`. Record the round to `goal-run.json`.
- **Stop**: gate satisfied → tail. `maxRounds` exhausted → proceed to tail but mark `outcome: maxRounds-exhausted` (never lie about success).
- **Stall** (gate-neutral): a round progresses if (measure: score moved favorably — gte increased / lte decreased) or (evaluate: gap-set shrank or newly satisfied). Round 1 counts as progress. `loopStallLimit` consecutive non-progressing rounds → LEAD strategy review.
- **Resume** (authoritative = `goal-run.json` last record): satisfied → tail; not-passed (round complete) → resume at lastRound+1; no record → round 1. Before resuming a round, MAY re-run the gate once on the current tree (`gitTreeFingerprint` detects tree changes under us).
- **measure failure branch**: non-zero exit / timeout / unparseable JSON → record `{round, error}`, treat round as not-passed, feed stderr/parse-error as the gap. No deadlock.

**Rationale.** Single dispatch per round matches review-cycle's proven shape and preserves the flat-hierarchy invariant (only the LEAD orchestrates; workers never spawn children). Warm-reusing the implementer across rounds is the same optimization review-cycle applies to the fixer.

### D5 — Research pipeline uses implementer-inline + H.3 relay, not a research-sibling

**Decision.** `goal-loop-research` sets a lower `handoff.roles.implementer.threshold` (0.35) so the implementer relays earlier under context pressure. Research is done inline by the implementer; when its context fills it follows the standard Step H.3 self-handoff (write handoff doc, return `HANDOFF`); the LEAD warm-seeds a successor and the loop continues, with `goal-run.json` as the spine.

**Rationale.** A separate research-sibling subagent would violate the flat-hierarchy invariant (workers must not spawn children). The implementer already has web tools inline; the only problem is context weight, which the lower threshold + H.3 relay solve. Confirmed by the user.

**Alternative considered (rejected).** A dedicated research-sibling worker spawned by the iterate skill — rejected (flat-hierarchy violation).

### D6 — Data-driven registration; skills in the hardcoded generation lists

**Decision.** The three pipelines are auto-discovered from `pipelines/goal-loop-{measure,evaluate,research}/pipeline.yaml` (the registry's `collectPipelineNames` scans the package pipelines dir — no code change to register). The three iterate skills + the `/opsx:goal` command ARE code, so their `SkillTemplate`/`CommandTemplate` factories are added to the existing hardcoded lists in `src/core/shared/skill-generation.ts` (`getSkillTemplates`, `getCommandTemplates`) and re-exported from `src/core/templates/skill-templates.ts` — exactly how `review-cycle` and `auto` are registered.

**Rationale.** Mirrors the existing two registration mechanisms precisely (data for pipelines, code generation lists for skills/commands). No new detection mechanism.

## Risks / Trade-offs

- **[measure.command is arbitrary shell]** → Mitigated by the `define-goal` stage's human `gate: true` — the user confirms the command before any round runs. v1 adds no extra sandbox enforcement (open question OQ1).
- **[Discriminated-union migration changes the parsed `loop` object shape]** → The `review-cycle` variant's parsed output is `{ kind: 'review-cycle', maxRounds: 3 }` — identical to today. The assertion at `pipeline.test.ts:74` stays green. Step E's generalization must keep the `review-cycle` path byte-for-byte equivalent.
- **[Warm-reused implementer could accumulate stale context across rounds]** → The implementer relays via H.3 when context fills; the gate's per-round record on disk is the spine. Evaluate-gate freshness is guaranteed structurally (a FRESH reviewer each round, never the implementer).
- **[maxRounds exhaustion could be reported as success]** → Step L explicitly marks `outcome: maxRounds-exhausted` and the report/ship-log must surface it; "never lie about success" is a non-negotiable termination invariant.
- **[Research pipeline tail differs (report, not ship/archive)]** → The three pipelines intentionally diverge on the tail; each is internally homogeneous. The `goal-loop-report` skill is research-only.
- **[Lower implementer threshold on research could cause excess relays]** → Bounded by the global `maxRelays`/`stallLimit` caps from `HandoffConfigSchema`; the LEAD review ladder (H.5) catches relay thrash.

## Migration Plan

1. Convert `StageLoopSchema` to the discriminated union (D2). Run `pipeline.test.ts` — the `review-cycle` assertion at line 74 must stay green (shape unchanged).
2. Add `loopConfig`/`loopProgress` to `RunStateSchema` (additive; `passthrough()` keeps readers whole).
3. Generalize Step E's preamble + append Step L to the playbook.
4. Generalize the `pipeline.ts:641` display line.
5. Add the three pipeline YAMLs (auto-discovered).
6. Add the skill/command template files + register them in `skill-generation.ts` + re-export from `skill-templates.ts`.
7. Add unit tests for schema, built-ins, and pipeline parsing.

**Rollback.** The change is additive behind the discriminated union. Reverting the schema to the single `review-cycle` object, removing the new pipeline YAMLs and template files, and restoring the original Step E / display line restores the prior state. No data migration of existing run-state files is needed (the new fields are optional).

## Open Questions

- **OQ1 — measure.command sandbox.** v1 relies on the define-goal human gate (no extra sandbox enforcement). Revisit if goal-loop is pointed at untrusted tasks.
- **OQ2 — implementer self-measure tooling.** v1 lets the implementer run the measure command directly via Bash during its dispatch; no dedicated named tool. If observability suffers, add a named `opsx goal measure` runner.
- **OQ3 — per-pipeline maxRounds default.** Research/evaluate MAY set a lower default (e.g. 3) via the pipeline YAML's `loop.maxRounds`; the schema default stays 5. Decide concrete values during implementation.
