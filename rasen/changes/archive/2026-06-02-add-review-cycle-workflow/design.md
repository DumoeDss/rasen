## Context

OpenSpec already ships several review touchpoints, but each is a single pass:

- **Plan review** — the `spec-driven` schema attaches `enhance: plan-ceo-review` / `plan-design-review` / `plan-eng-review` to the proposal/specs/design artifacts. These fire once, during planning, before any code exists.
- **`openspec-gstack-review`** — an always-installed expert skill (`skills/gstack/review/SKILL.md`) that analyzes the diff against the base branch for SQL safety, LLM trust-boundary violations, conditional side effects, and other structural issues. It is a single pre-landing pass.
- **Fusion `verify-enhanced` / `ship`** (active change `add-opsx-fusion-commands`) — `verify-enhanced` runs one combined verification gate (artifact consistency + review + qa + cso + design-review); `ship` runs pre-flight checks once before pushing.

What is missing is the **loop** that ties a review pass to the fixes it produces and keeps going until the change is actually clean: `review → triage → fix → re-review(Δ) → {pass | loop | escalate}`. Today this happens informally — a reviewer files findings, someone fixes them, and the change ships without a guarantee that (a) the fix was confirmed by someone other than its author, or (b) unresolved findings reached a human instead of being quietly dropped.

This change adds `review-cycle` as the workflow that owns that loop. It does NOT reimplement the reviewer — each pass delegates to `openspec-gstack-review`.

## Goals / Non-Goals

**Goals:**
- Add a runtime workflow `review-cycle` (`/opsx:review-cycle`, skill `openspec-review-cycle`) that drives the iterative review→triage→fix→re-review loop.
- Enforce an **author ≠ verifier** invariant: a finding is resolved only after a non-author check confirms it against the original finding.
- Triage fixes by size (trivial / non-trivial / design-level) and route each to the right actor.
- Be tool-agnostic, with an optional Claude Code agent-teams acceleration that resumes the original reviewer for a delta-only re-review, plus a fresh-review fallback everywhere else.
- Terminate deterministically (max rounds, default 3) and escalate to the human on unresolved Blocker/Major findings — never silently pass.
- Ship the workflow opt-in (`ALL_WORKFLOWS`), not in `core`.

**Non-Goals:**
- Do NOT modify the core `spec-driven` schema or the artifact-graph code (`schemas/spec-driven/**`). The loop is a runtime behavior, not a file-DAG artifact.
- Do NOT fork or reimplement `openspec-gstack-review`; reuse it as the review engine.
- Do NOT change the existing one-shot review pieces (plan review, `verify-enhanced`, `ship`).
- Do NOT add a new CLI command; `review-cycle` is delivered as a skill + slash command via the existing template pipeline.
- Do NOT require Claude Code; the Claude-resume path is a strict optimization over the tool-agnostic fallback.

## Decisions

### Decision 1: Command/skill axis, NOT a schema artifact

**Choice**: Implement `review-cycle` as a workflow template under `src/core/templates/workflows/review-cycle.ts`, registered through `skill-templates.ts` → `skill-generation.ts` → `profiles.ts`, exactly like the existing fusion commands (`ship.ts`, `verify-enhanced.ts`).

**Why X over Y**: The alternative is a new artifact in `schemas/spec-driven/schema.yaml`. But the artifact graph is a DAG of files each generated once (proposal → specs → design → tasks). A review cycle is fundamentally a **loop** that runs against the live diff and repeats N times — there is no fixed file output and no place in the DAG for "run this again with the delta." Modeling a loop as a DAG artifact would be a category error. The command/skill axis already expresses runtime workflows (explore, ship, verify-enhanced), so `review-cycle` belongs there.

### Decision 2: Reuse `openspec-gstack-review` as the review engine

**Choice**: Each review pass invokes the existing `openspec-gstack-review` skill. `review-cycle` owns only the loop, triage, the author≠verifier invariant, termination, and escalation.

**Why X over Y**: Forking review logic into `review-cycle` would duplicate the SQL/trust-boundary/side-effect heuristics and immediately drift from the expert skill. The expert skill is already always-installed, so the dependency is safe. `review-cycle` is a thin orchestrator on top of it.

### Decision 3: Author ≠ verifier invariant

**Choice**: A finding is marked resolved only when a reviewer who did NOT author the fix confirms it against the original finding text. For trivial inline fixes done by the orchestrator, the equivalent non-author check is an independent gate-run (tests/lint/build) plus a diff-read of the exact change, and that check MUST be recorded in the cycle report.

**Why X over Y**: Letting the fixer self-certify is the most common way a "resolved" finding regresses — the author re-reads their own intent, not the original objection. Requiring an independent confirmer (or, for trivial fixes, an objective gate + diff-read trail) keeps the resolution honest without forcing a full second human into every typo fix.

### Decision 4: Fix-size triage routes to the right actor

**Choice**: Triage each finding into one of three buckets:
- **trivial** — orchestrator fixes inline (e.g. a typo, a missing null guard the orchestrator can see end-to-end);
- **non-trivial** — the implementing agent that wrote the code fixes it (it holds the most context);
- **design-level** — a separate fix agent handles it, because the change touches the design and should not be patched by the original author in-place.

**Why X over Y**: A flat "the implementer fixes everything" rule wastes a round-trip on typos and lets the original author quietly redesign on design-level findings. Routing by size keeps trivial fixes cheap and forces design-level findings through a fresh pair of hands.

### Decision 5: Tool-agnostic loop with optional Claude acceleration

**Choice**: The loop is fully tool-agnostic. On Claude Code with agent-teams enabled (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`), the lead MAY resume the original reviewer agent via `SendMessage` to re-review only the delta (only the lead may originate `SendMessage`). When resume is unavailable — any other tool, or teams disabled — the workflow MUST fall back to a fresh delta review, passing the prior findings and the fix diff through a shared file. The outcome is equivalent; the fallback is just costlier (a cold reviewer re-reads context).

**Why X over Y**: Hard-coding the Claude path would make the workflow unusable on Codex/other tools; hard-coding the fallback would throw away a cheap optimization where it exists. Treating resume as an optimization over a mandatory fallback keeps both correct.

### Decision 6: Deterministic termination + escalation

**Choice**: Cap the loop at max rounds (default 3, configurable). On reaching the cap with any unresolved Blocker or Major finding, STOP and escalate to the human with the open findings and round history. Minor/trivial leftovers may be logged as accepted-known, but the workflow MUST NOT report a clean pass while Blocker/Major findings remain.

**Why X over Y**: An unbounded loop can thrash on a finding the agents cannot resolve; silently passing buries real problems. A hard cap plus mandatory escalation makes the failure mode loud and human-owned.

### Decision 7: Opt-in profile placement

**Choice**: Add `'review-cycle'` to `ALL_WORKFLOWS` only, NOT `CORE_WORKFLOWS`.

**Why X over Y**: `core` is the streamlined new-user set (propose/explore/apply/archive). An iterative multi-agent review loop is an advanced workflow; surfacing it by default would clutter the core experience. Opt-in matches how the other fusion commands are placed.

## Risks / Trade-offs

- **Loop non-termination / thrash** → Hard max-rounds cap (default 3) with mandatory escalation on the cap; no unbounded recursion.
- **Silent pass on unresolved findings** → Invariant: never report clean while Blocker/Major findings are open; escalate to human instead.
- **Author self-certifies a fix** → Author≠verifier invariant; trivial fixes require a recorded gate-run + diff-read as the equivalent non-author check.
- **Claude-only assumption leaks into the workflow** → Resume via `SendMessage` is specified strictly as an optimization; the tool-agnostic fresh-review fallback is mandatory and is the spec's baseline.
- **Drift from `openspec-gstack-review`** → `review-cycle` delegates to that skill rather than copying its heuristics, so there is one review engine to maintain.
- **Instruction length** → The skill content covers loop + triage + invariant + both re-review paths + termination; organize into clear sections so the agent reads only what each phase needs.

## Open Questions

- Should the max-rounds default (3) be exposed as a slash-command argument (`/opsx:review-cycle --max-rounds N`) at launch, or hard-coded initially and parameterized later?
- Where should the cycle report live — a `review-cycle-report.md` in the change directory (consistent with `ship-log.md` / `review-report.md`), or appended to the existing verification report?
- For the Claude resume path, should the lead always prefer resume when available, or only when the delta is small enough that a cold re-review would be wasteful?
- Should design-level findings automatically suggest re-running plan review (`plan-*-review`) rather than being handled purely inside the cycle?
