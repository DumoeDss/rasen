/**
 * Shared LEAD Orchestration Playbook
 *
 * One playbook, embedded by the workflows that drive a pipeline of stages
 * (`auto`, `review-cycle`). It tells the executing agent to act as the LEAD —
 * the sole orchestrator — and dispatch each stage to a role-isolated leaf
 * worker that invokes the stage's existing OPSX skill. It defines capability
 * tiers (A/B/C), role isolation + the structural author!=verifier invariant,
 * the change-directory blackboard + run-state, interpretation of
 * gate/loop/parallelGroup/condition stage metadata, and the bounded
 * review->fix loop with human escalation.
 *
 * HOW (this playbook) is intentionally decoupled from WHAT (the pipeline
 * definition). The pipeline DAG is supplied inline today and from the
 * data-driven pipeline registry later; this text does not change when the
 * source of the DAG changes.
 */

export const ORCHESTRATION_PLAYBOOK = `## Orchestration Playbook — LEAD drives role-isolated subagents

You are the **LEAD**. You orchestrate; you do NOT author stage outputs yourself. Each pipeline stage is dispatched to a **leaf worker** subagent that invokes that stage's existing OPSX skill and returns its result to you. Workers never spawn their own subagents — you are the sole orchestrator (flat hierarchy: LEAD + leaf workers).

### Step A — Detect the capability tier (once, at start)

- **Tier A (full):** Claude Code with agent-teams (\`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1\`). You can spawn role workers AND resume a specific worker via \`SendMessage\` for warm-context continuation. Only the LEAD may originate \`SendMessage\` (that is you); it is within-session only.
- **Tier B (multi-agent, no warm resume):** Subagent spawning is available but agent-teams is not. Spawn a FRESH worker per stage/round and reconstruct its context from the change directory + run-state.
- **Tier C (degraded fallback):** No subagent capability. Execute the pipeline sequentially in a single context. This is the explicit fallback, NOT the primary path.

Record the detected tier in run-state. The pipeline definition is identical across tiers; only the mechanics below differ.

### Step B — Dispatch a stage to a role-isolated worker

For each stage, spawn a worker of the stage's **role** and have it invoke the stage's **skill** via the Task tool, e.g.:

> Task tool (subagent_type: "general-purpose", prompt: "You are the <role> for change '<name>'. Use the Skill tool to invoke <skill>. Read openspec/changes/<name>/ for context. <stage-specific instructions>. Return <what the LEAD needs back>. Do only this one unit of work — do NOT spawn subagents of your own; the LEAD owns all orchestration.")

Isolation comes from the separate worker context — that is what keeps one stage's noise out of the next. Hand off between stages through the **change directory** (proposal.md, design.md, tasks.md, specs/, review-report.md, ship-log.md), never through shared memory. Use \`SendMessage\` only to continue a conversation with a worker you already spawned (Tier A), not as the inter-stage state channel.

### Step C — Enforce author != verifier by role assignment

- The reviewer worker MUST NOT be the implementer worker.
- The fixer of a design-level finding MUST NOT be the original author.
- The worker that re-reviews a fix MUST NOT be the worker that authored the fix.

Under Tier C (single context) the non-author confirmation degrades to an independent gate-run (tests/lint/build) plus a diff-read of the exact change, recorded in run-state and marked as the fallback.

### Step D — Honor stage metadata

- **gate:** After the stage, pause. Summarize what was done and what is next; wait for the human to Continue / Stop (save progress, resumable later) / switch to Manual.
- **condition:** If the stage's condition is not met for this change, skip it and record the skip. When a stage lists several MUTUALLY EXCLUSIVE conditions (e.g. one expert "or else" another), pick exactly one.
- **parallelGroup:** Run the group's members concurrently and collect every result before proceeding. A single stage MAY itself fan out into a parallel group — e.g. a \`verify\` stage with \`parallelGroup=experts\` becomes one reviewer worker per condition-met expert skill (review / cso / benchmark / design-review / qa), all dispatched at once and all results collected before the loop.
- **loop:** Run the stage as the bounded review->fix loop (Step E).
- Pipelines MAY carry additional stage metadata beyond the above (e.g. \`leadReview\`, \`verifyPolicy\`); the consuming workflow's own sections define how to handle them.

### Step E — The review -> fix loop (bounded; this is the review-cycle inner loop)

When a stage is a **loop**:

1. **Review** — dispatch reviewer worker(s), delegating each pass to the \`openspec-gstack-review\` engine, over the current diff; collect findings with severity (Blocker / Major / Minor / Trivial). Do NOT fork or reimplement the review heuristics.
2. **Triage by fix size** — trivial (you fix inline) / non-trivial (route to the implementer worker that wrote the code) / design-level (route to a SEPARATE fixer worker, never the author).
3. **Fix** via the routed actor; capture the exact fix delta so re-review can target only the delta.
4. **Re-review the delta with a non-author** — Tier A: resume the original reviewer via \`SendMessage\` to re-review only the delta against its prior findings. Tier B/C: a fresh reviewer over just the delta, with prior findings + fix diff passed through a shared file. A finding is resolved ONLY after a non-author confirms it; self-certification by the fixer is rejected.
5. **Loop or terminate** — all Blocker/Major resolved (non-author confirmed) -> clean. Resolvable findings remain AND rounds < cap -> next round, re-review the new delta. Cap reached with any unresolved Blocker/Major -> STOP and escalate to the human (open findings + round history + recommendation). Default cap: 3. Never report clean while a Blocker or Major finding is open. Any open Minor/Trivial findings at clean-time MUST be recorded in run-state as accepted-known — never silently dropped.

### Step F — Maintain run-state (observability + resume)

Record in \`openspec/changes/<name>/auto-run\` (markdown now; JSON once formalized): the detected tier, classification, selected pipeline, per-stage status, which worker handled each stage, review rounds, open findings, and any skips/escalations. Subagent work is otherwise opaque; this record is what lets the run be observed, resumed after an interruption, and cold-reconstructed for Tier B fresh workers.

### Step G — Portfolio orchestration (the \`decompose\` fan-out)

A stage with **kind: decompose** is NOT a leaf skill call — it is a fan-out point you, the LEAD, interpret. It is always the pipeline's first stage. Evaluate its \`condition\` (e.g. \`needs-decomposition\`) against the task and either **skip** or **take** it:

- **Skip** (single coherent, reviewable slice): record the decompose stage as \`skipped\` and run the parent's remaining stages on the ONE parent change exactly as a non-decomposed pipeline does. Zero behavior change.
- **Take** (multiple independent deliverables / several distinct capabilities / a scope too large to review as one diff): the parent change becomes a **planning container** — mark its remaining stages \`delegated\` (do NOT run them at the parent level) and fan out into child changes.

**1. Produce a decomposition plan.** A set of child changes — each an independently-shippable, reviewable slice — plus a **dependency DAG** declaring which children must land before which. Create each child with \`openspec new change <child-id>\` (name them with a parent-derived prefix, e.g. \`<parent>-<slice>\`, for traceability).

**2. Self-audit the plan; proceed automatically (no human gate).** Before fanning out, audit your own plan: slice coherence, the independence basis behind any parallel cohort, and DAG correctness. If it is safe, proceed automatically — decompose is NOT a human gate (\`gate: false\`); do NOT pause for approval. Escalate to the human ONLY when you cannot produce a safe plan (you can neither establish independence NOR find a safe serial ordering). The user may still interrupt at any time, as in any auto run. Optionally you MAY dispatch an independent reviewer worker to audit the plan (author≠verifier) for extra assurance — not required.

**3. Run each child through its childPipeline.** Each child runs the decompose stage's resolved \`childPipeline\` (default \`small-feature\`, always decompose-free) via the SAME per-change pipeline machinery (propose → apply → verify → review-loop → …). A child MAY override its pipeline (e.g. one child is \`bug-fix\` while a sibling is \`full-feature\`); record each child's actual pipeline in portfolio run-state.

**4. Conservative serial/parallel policy (the safety core).**
- **Dependency edge → strict serial, topological order.** A dependent child's pipeline MUST NOT begin until EVERY prerequisite child is implemented and review-clean (its review-loop passed); never run a prerequisite and its dependent concurrently. A **shared working tree + review-clean is sufficient** for a dependent to consume a prerequisite's code — do NOT force the prerequisite to ship/archive first; escalate to ship/archive only when the dependency is on landed/merged artifacts.
- **Parallel ONLY when all hold:** (1) no dependency edge in either direction, (2) NO overlap in touched capabilities / spec folders / files, and (3) host is **Tier A**. Provably-independent children get separate worker teams and run concurrently with **no fixed cohort cap**. Under Tier B/C, run ALL children serially regardless of independence.
- **Uncertain independence → serial.** Overlapping or ambiguous touch-sets are treated as a dependency. Parallelism requires a *positive* independence proof, never merely the absence of a declared edge — "宁可串行也不能乱并行".

**5. Recursion guard.** Decompose happens at most once per portfolio, only at the top level. A child's \`childPipeline\` is decompose-free, so child runs NEVER decompose further.

**6. Portfolio run-state.** Maintain a parent-level record at \`openspec/changes/<parent>/portfolio-run.json\`: the decomposition plan, child list, dependency DAG (each child's prerequisites), per-child execution mode (serial/parallel) + parallel cohort, per-child pipeline, per-child status, and the current runnable frontier. Each child keeps its OWN per-change \`auto-run.json\`. The portfolio record is AUTHORITATIVE for resume; child-directory/artifact presence is a cross-check. Resume via \`openspec pipeline resume <parent>\` (computes the next runnable child(ren) from the DAG). On **partial failure** (a child fails or escalates mid-run): stop that child's dependent chain, leave already-complete independent children intact, and escalate with the open frontier.`;
