/**
 * Shared LEAD Orchestration Playbook
 *
 * One playbook, embedded by the workflows that drive a pipeline of stages
 * (`auto`, `review-cycle`). It tells the executing agent to act as the LEAD —
 * the sole orchestrator — and dispatch each stage to a role-isolated leaf
 * worker that invokes the stage's existing Rasen skill. It defines capability
 * tiers (A/B/C), role isolation + the structural author!=verifier invariant,
 * the change-directory blackboard + run-state, interpretation of
 * gate/loop/parallelGroup/condition stage metadata, the bounded
 * review->fix loop with a LEAD-first escalation ladder, and the context
 * sensing + handoff protocol (Step H).
 *
 * HOW (this playbook) is intentionally decoupled from WHAT (the pipeline
 * definition). The pipeline DAG is supplied inline today and from the
 * data-driven pipeline registry later; this text does not change when the
 * source of the DAG changes.
 */

export const ORCHESTRATION_PLAYBOOK = `## Orchestration Playbook — LEAD drives role-isolated subagents

You are the **LEAD**. You orchestrate; you do NOT author stage outputs yourself. Each pipeline stage is dispatched to a **leaf worker** subagent that invokes that stage's existing Rasen skill and returns its result to you. Workers never spawn their own subagents — you are the sole orchestrator (flat hierarchy: LEAD + leaf workers).

### Step A — Detect the capability tier (once, at start)

- **Tier A (full):** Claude Code with agent-teams (\`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1\`). You can spawn role workers AND resume a specific worker via \`SendMessage\` for warm-context continuation. Only the LEAD may originate \`SendMessage\` (that is you); it is within-session only — a worker spawned in a previous session is gone (its agentId is a dead handle after a restart), so crossing a session boundary uses the transcript warm-seed of Step F.1, NOT \`SendMessage\`.
- **Tier B (no \`SendMessage\` warm continuation):** Subagent spawning is available but agent-teams is not. Spawn a FRESH worker per stage/round and reconstruct its context from the change directory + run-state (and, when available, the prior worker's recorded transcript — Step F.1).
- **Tier C (degraded fallback):** No subagent capability. Execute the pipeline sequentially in a single context. This is the explicit fallback, NOT the primary path.

Record the detected tier in run-state. The pipeline definition is identical across tiers; only the mechanics below differ.

### Step A.1 — Resolve each agent runtime (Claude or Codex)

Each stage has an effective **runtime**. Resolve it in this order:

1. Per-invocation role overrides from the user, e.g. \`--planner codex --reviewer claude --fixer codex\`.
2. The registry output from \`rasen pipeline show <name> --json\`: stage-level \`runtime\` first, then \`agents.<role>\`.
3. Default \`claude\`.

Supported roles are \`planner\`, \`implementer\`, \`reviewer\`, \`fixer\`, and \`shipper\`. A single run may freely mix Claude and Codex workers by role or by stage.

Claude workers use the existing Task/subagent path and record \`agentId\` plus \`transcript\`. Codex workers use Codex app-server threads through the installed Codex Claude Code plugin or the Rasen Codex bridge when available, and record \`threadId\` plus \`turnId\`. For Codex, \`threadId\` is the durable resume handle; do not store it as a Claude \`agentId\`.

### Step B — Dispatch a stage to a role-isolated worker

For each stage, dispatch a worker of the stage's **role** using the effective runtime from Step A.1.

For a **Claude** stage, spawn a worker and have it invoke the stage's **skill** via the Task tool, e.g.:

> Task tool (subagent_type: "general-purpose", prompt: "You are the <role> for change '<name>'. Use the Skill tool to invoke <skill>. Read rasen/changes/<name>/ for context. <stage-specific instructions>. Return <what the LEAD needs back>. Do only this one unit of work — do NOT spawn subagents of your own; the LEAD owns all orchestration. <handoff clause — Step H.3>")

Every dispatch prompt MUST end with the handoff clause of **Step H.3** (triggers + the structured \`DONE\`/\`HANDOFF\` return contract) — a worker that runs out of context mid-stage hands its work to a successor instead of silently degrading. This applies to Codex workers too (the handoff document is runtime-agnostic; \`threadId\` resume is an optimization on top of it).

Isolation comes from the separate worker context — that is what keeps one stage's noise out of the next. Hand off between stages through the **change directory** (proposal.md, design.md, tasks.md, specs/, review-report.md, ship-log.md), never through shared memory. Use \`SendMessage\` only to continue a conversation with a worker you already spawned (Tier A), not as the inter-stage state channel.

A worker MUST leave its stage's durable artifact in the change directory before returning — its conversation output alone is NOT a handoff. In particular, the generic expert skills (review / cso / qa / qa-only / benchmark / design-review), when dispatched, run report-only (see their PREAMBLE "Dispatched vs standalone mode") and write their findings — tagged with canonical severities — to the canonical report file in the change directory THEMSELVES, not to their standalone \`.rasen/*-reports/\` paths: \`review-report.md\` (code review), \`cso-report.md\` (security), \`qa-report.md\` (qa or qa-only), \`benchmark-report.md\` (performance), \`design-review-report.md\` (design). The worker that invokes them verifies the report is present before returning. State the target report path in the dispatch prompt's stage-specific instructions. These files are what the resume artifact cross-check, \`ship\`'s verification pre-flight, and \`retro\` consume.

For Codex stages, use this prompt shape:

> Codex prompt: "You are the <role> for change '<name>'. Execute the <stage-id> stage. Read rasen/changes/<name>/ for context. Follow the <skill> contract exactly. Write the required durable artifacts to the change directory before returning. Do not spawn other agents. Return a concise final summary plus written files / findings / validation status."

Use Codex \`workspace-write\` only for artifact-writing roles such as planner or explicitly approved fixing work. Use \`read-only\` for reviewers, leadReview checks, and re-review. When using the Claude Code Codex plugin manually, the closest command path is \`/codex:rescue\` for a new persistent task and \`/codex:rescue --resume\` for the latest task thread; prefer a programmatic Codex bridge when available because it exposes \`threadId\`, \`turnId\`, status, cancellation, and structured results directly.

When you spawn a worker, record its identity in run-state (Step F): Claude workers record **role**, **agentId**, and **transcript**; Codex workers record **runtime=codex**, **role**, **threadId**, **turnId** when available, and sandbox/model metadata. For Claude, transcript is the cross-session asset. For Codex, threadId is the cross-session asset.

### Step B.1 — Persistent planner: propose-only session reuse

**Governed by \`reuse.planner\`.** Resolve the planner reuse mode from \`resolvePipelineReuseConfig(pipeline).planner\` via \`rasen pipeline show <name> --json\` (default \`auto\` — the same place Step H reads resolved handoff config). Under **\`auto\`** the persistent-planner rule below applies as today. Under **\`never\`** do NOT persist a planner: spawn a FRESH planner for each propose, seeded from \`planning-context.md\` + the sibling proposals already on disk (this is item 2's Tier-B seeding path, promoted to the general \`never\` path), rather than reusing the prior planner. Everything else in this section describes the \`auto\` path.

Propose is the ONE exception to fresh-per-stage spawning: under \`reuse.planner: auto\` a run keeps a SINGLE planner and re-engages it for every propose-stage unit of work (the first change's propose, then every decomposed child's propose). Rationale: proposing is research-heavy — one planner researches the codebase ONCE and amortizes it across all proposals, and a shared planner keeps sibling specs mutually consistent (child #2's planner knows what child #1 promised). All OTHER stages keep fresh role-isolated workers exactly as Step B — do NOT extend this reuse beyond propose. Author != verifier is unaffected: the planner never verifies its own outputs (direction review belongs to the LEAD, leadReview).

1. **Seed once.** Before the first propose, write what YOU already know to \`rasen/changes/<name>/planning-context.md\` (for a portfolio: the parent's directory): the user's intent verbatim, your codebase findings so far, the decompose plan + dependency rationale, and constraints/decisions already made. The first planner reads this FIRST, then researches only what is missing — not from zero.
2. **Reuse for every subsequent propose.** Tier A: do NOT spawn a new planner — \`SendMessage\` the SAME planner agentId ("Propose <child-2>. You already hold the codebase research and <child-1>'s proposal; keep the interfaces consistent."). Tier B (no \`SendMessage\`): spawn fresh but seed it with planning-context.md + the sibling proposals already on disk — still skips most re-research.
3. **Keep the digest current.** Instruct the planner to APPEND durable new findings (decisions, discovered constraints — not chatter) to planning-context.md after each propose, so Tier B re-spawns and post-restart warm-seeds stay cheap.
4. **Record the planner pointer.** Portfolio runs: record the planner's \`{role, agentId, transcript}\` at the TOP level of \`portfolio-run.json\` (field \`planner\`) — it spans children, so a per-change stage record is not enough. Single change: the propose stage's \`worker\` record (Step F) suffices. After a restart, warm-seed the next planner from this pointer per Step F.1 (\`rasen pipeline resume\` reports it).
5. **Retire on bloat (deterministic).** A planner that has proposed many children accumulates context. Before EVERY planner re-engagement, apply the Step H.2 warm-continue guard: probe its recorded transcript with \`rasen agent context --transcript <path>\`; at or above its threshold, retire it — have it write a final handoff document, then seed a fresh planner from that document + planning-context.md and continue the run with the successor (update the recorded pointer). This is a CROSS-CHANGE re-staffing decision, so the threshold it compares against is the resolved **reuse** threshold for the planner (\`resolvePipelineReuseConfig(pipeline).roles.planner\`, default 0.25) — NOT the handoff threshold that governs mid-task relay; the transcript-probe mechanism is otherwise unchanged.

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

When a stage is a **loop**, narrow on \`loop.kind\`:

- **\`loop.kind === 'review-cycle'\`** runs the review -> fix protocol below (Steps 1–5). This is the ONLY loop kind that existed before goal-loop; the steps are unchanged.
- **\`loop.kind === 'goal'\`** runs the goal-driven iteration loop defined in **Step L** (single dispatch per round, warm-reused implementer, a measure or evaluate gate). Skip Steps 1–5 for a goal loop — they are review-cycle-specific.

For a **review-cycle** loop:

1. **Review** — dispatch reviewer worker(s), delegating each pass to the \`rasen-review\` engine, over the current diff; collect findings with severity (Blocker / Major / Minor / Trivial). Do NOT fork or reimplement the review heuristics.
2. **Triage by fix size** — trivial (you fix inline) / non-trivial (route to the implementer worker that wrote the code) / design-level (route to a SEPARATE fixer worker, never the author).
3. **Fix** via the routed actor; capture the exact fix delta so re-review can target only the delta.
4. **Re-review the delta with a non-author** — Tier A, same session: resume the original reviewer via \`SendMessage\` (after the Step H.2 warm-continue guard) to re-review only the delta against its prior findings. Across a session boundary (the original reviewer is gone): warm-seed a fresh reviewer from that reviewer's recorded transcript (Step F.1) so it carries the prior findings, then re-review only the delta. Tier B/C: a fresh reviewer over just the delta, with prior findings + fix diff passed through a shared file. A finding is resolved ONLY after a non-author confirms it; self-certification by the fixer is rejected.
5. **Loop or terminate** — all Blocker/Major resolved (non-author confirmed) -> clean. Resolvable findings remain AND rounds < cap -> next round, re-review the new delta. Cap reached with any unresolved Blocker/Major -> do NOT stop for a human immediately: run the **Step H.5/H.6 escalation ladder** — a LEAD strategy review where each retry changes a material variable (different fix approach, design-level rework via the planner, isolating the stubborn finding), recorded in \`strategyAttempts\`; only after the strategy budget is exhausted is the stage parked as \`escalated\` and surfaced at the next natural pause point. Default cap: 3. Never report clean while a Blocker or Major finding is open. Any open Minor/Trivial findings at clean-time MUST be recorded in run-state as accepted-known — never silently dropped.

### Step L — The goal-loop (bounded iteration toward a gate condition)

A \`goal\` loop drives a task whose "done" is a *condition* — a measurable threshold (measure gate) or a quality judgment (evaluate gate) — not a review-clean diff. It is isomorphic to review-cycle's single-dispatch-per-round shape: ONE implementer dispatch per round, then a gate, then a recorded judgment. Only the LEAD orchestrates; the implementer NEVER spawns child subagents (flat hierarchy).

**Inject (once, before round 1).** Read \`goal-plan.md\` (produced by the \`define-goal\` stage's planner) and merge the concrete gate config into \`iterate.loopConfig\` in run-state: for a \`measure\` gate assert the \`command\` is present (it is optional in the pipeline YAML, REQUIRED at run-time) and copy \`threshold\`/\`target\`/\`direction\`/\`timeoutSec\`; for an \`evaluate\` gate copy \`goal\`/\`rubric\`. The pipeline registers only the gate *type*; the per-task specifics come from goal-plan.md.

**Each round (single dispatch, warm-reused implementer).**
- **Dispatch the implementer** — warm-reused across ALL rounds (the SAME worker, like review-cycle reuses the fixer thread; rounds do NOT each cost a fresh relay). Tier A: \`SendMessage\` the same implementer agentId (after the Step H.2 warm-continue guard). Tier B/C: spawn fresh per round seeded from goal-plan.md + the prior round's judgment + the run's handoff documents. Seed: **round 1** = goal-plan.md (no prior score); **round N>1** = goal-plan.md + the prior round's recorded \`{score/gaps, measurePassed/evaluateSatisfied}\`. The implementer MAY self-run the measure command / self-check informally during its dispatch; the **formal recorded score** is the post-dispatch gate below. Every dispatch prompt ends with the Step H.3 handoff clause and the flat-hierarchy clause (no child subagents).
- **Run the gate (one type, per the pipeline):**
  - **measure** — run \`gate.command\` (bounded by \`timeoutSec\`, default 120s), parse stdout JSON \`{ score: number, passed?: number, detail?: string }\`. Compare \`score\` against \`threshold\` using \`direction\` (\`gte\` → score ≥ threshold; \`lte\` → score ≤ threshold), or \`passed\` against \`target\` (passed ≥ target). Satisfied when the comparison holds.
  - **evaluate** — dispatch a **FRESH reviewer worker** (≠ the implementer — author ≠ verifier). Hand it \`goal\` + \`rubric\` + the artifact under judgment; it MUST return structured \`{ satisfied: boolean, gaps: string[] }\` (no free text, for reproducibility). Satisfied when \`satisfied === true\`.
- **Measure failure branch (no deadlock).** Non-zero exit / timeout / unparseable JSON → record \`{round, error: <stderr|timeout|parse>}\`, treat the round as NOT passed, and feed the stderr/parse-error as the gap for the next round. The loop never blocks on a broken measure command.

**Record.** Append \`{round, score?, measurePassed?, evaluateSatisfied?, detail?, gaps?, error?, gitTreeFingerprint}\` to \`goal-run.json\` in the change root (\`git rev-parse HEAD^{tree}\` for \`gitTreeFingerprint\`). This file is the AUTHORITATIVE loop spine — it survives worker relay. Also mirror the summary into \`loopProgress\` in run-state (best-effort cache).

**Stop.** Gate satisfied → proceed to the pipeline tail (ship/archive, or report for research). \`maxRounds\` exhausted → proceed to the tail BUT mark \`outcome: maxRounds-exhausted\` in the ship-log/report — **never lie about success**. The ship/report stage surfaces the real outcome.

**Stall (gate-neutral).** A round "progresses" if: measure — \`score\` moved favorably vs the prior round (\`gte\`: score increased; \`lte\`: score decreased); evaluate — the gap-set shrank or the gate is newly satisfied. **Round 1 always counts as progress** (no prior to compare). \`loopStallLimit\` (default 2) consecutive NON-progressing rounds → run the Step H.5 LEAD strategy review: warm-seed a fresh implementer with a different approach, or escalate. Never silently burn rounds on a stuck measure/evaluate.

**Resume (authoritative = \`goal-run.json\` last record).**
- last record satisfied → go to the tail (do NOT re-run the round).
- last record NOT passed (round complete, has a record) → resume at **lastRound + 1** (fresh dispatch, seeded with the prior gap). NOT "re-run N" — round N already has its recorded judgment.
- no record (define-goal done, iterate died before the first gate) → dispatch round 1.
- Before resuming a round, you MAY re-run the gate once on the current tree (catch a flaky measure command or externally-fixed state); \`gitTreeFingerprint\` detects tree changes under you — if the tree changed since the last record, the prior judgment may be stale.

**Context / handoff.** The implementer is warm-reused; when its context fills it follows the standard **Step H.3** self-handoff (write a handoff doc, return \`HANDOFF { path, reason, completed, remaining }\`). The LEAD warm-seeds a successor and the loop continues — \`goal-run.json\` is the spine that survives the relay. The **research pipeline** sets a lower \`handoff.roles.implementer.threshold\` (0.35) so relay happens earlier (research is context-heavy); this is the "implementer inline + relay" decision — do NOT use a research-sibling subagent pattern (that violates the flat hierarchy).

### Step F — Maintain run-state (observability + resume)

First resolve the change's ABSOLUTE directory: run \`rasen status --change <name> --json\` and read the \`changeRoot\` field (NOT \`changeDir\`) — that is the change's directory under the SELECTED Rasen root, which for a \`--store\`-selected or non-cwd run is NOT under the current working directory. Every \`rasen/changes/<name>/\` path this workflow teaches (auto-run.json / portfolio-run.json, handoff documents, planning-context.md, and all blackboard artifacts) is relative to that \`changeRoot\` base — write and read them there, never at a cwd-relative \`rasen/changes/<name>/\`, or a store-selected run will strand its run-state where \`rasen pipeline resume\` (resolved to the same root) cannot find it.

Record progress as JSON in \`<changeRoot>/auto-run.json\` (this exact filename + JSON shape is what \`rasen pipeline resume\` reads — do NOT write markdown or a different name, or resume will not see it). Minimum shape the reader understands:

\`\`\`json
{
  "pipeline": "small-feature",
  "classification": "small-feature",
  "tier": "A",
  "stages": {
    "propose": { "status": "done", "worker": { "role": "planner", "agentId": "<id>", "transcript": "<project>/<session-id>/subagents/agent-<id>.jsonl" } },
    "verify":  { "status": "done", "worker": { "role": "reviewer", "agentId": "<id>", "transcript": "<project>/<session-id>/subagents/agent-<id>.jsonl" } },
    "apply":   {
      "status": "in_progress",
      "worker": { "role": "implementer", "agentId": "<id>" },
      "handoffs": [ { "n": 1, "path": "handoff/implementer-1.md", "reason": "compaction", "completed": ["1.1","1.2"], "remaining": ["1.3"], "at": "<iso>" } ],
      "strategyAttempts": [ { "round": 3, "action": "re-prompt", "rationale": "<why this changes the outcome>", "result": "<what happened>" } ]
    }
  },
  "sessionHandoff": { "path": "handoff/lead-1.md", "pct": 0.52, "afterStage": "apply", "at": "<iso>" },
  "rounds": 0,
  "openFindings": []
}
\`\`\`

\`status\` is one of pending | in_progress | done | skipped | escalated; a stage counts as complete for resume only when **done | skipped**. (A simpler \`"completed": ["propose","apply"]\` array is also accepted when you are not recording per-stage workers.) Record each dispatched worker's **role**, **agentId**, and **transcript** pointer (Step B). Also record review \`rounds\`, \`openFindings\`, any skips/escalations, per-stage \`handoffs\` and \`strategyAttempts\` (Step H), and the top-level \`sessionHandoff\` when the session itself hands off. Subagent work is otherwise opaque; this record is what lets the run be observed and resumed.

### Step F.1 — Resume a run (cold start: a planned relay OR an unexpected interruption — crash, power loss, socket-close, killed terminal)

A new session has NO live workers — \`SendMessage\` cannot reach a worker spawned in a previous session (agentIds are dead handles across a restart). Any request to "resume the worker / resume its session" after an interruption MEANS this ladder: seed a fresh worker from the predecessor's recorded pointers (handoff document, then transcript). Do NOT reverse-engineer the predecessor's progress from artifacts on disk while a pointer exists — artifacts show what survived, but only the ladder carries what the predecessor learned (findings, dead ends, in-flight reasoning). To resume:

1. Run \`rasen pipeline resume <name> --json\` → it returns \`completed\`, the next incomplete stage(s) (\`next\`/\`ready\`), \`remaining\`, \`workers\` (the per-stage \`agentId\`/\`transcript\` pointers worth warm-seeding from), and — so nothing is silently stranded — \`inProgressStages\` (interrupted; re-engage these), \`escalatedStages\`, and \`openFindings\` (unresolved Blocker/Major — never ship past them). For a decomposed parent it returns the per-child \`runnableChildren\` (start fresh), \`interruptedChildren\` (warm-seed-resume), \`escalatedChildren\` (human attention), and \`completedChildren\`. Run-state status is AUTHORITATIVE; artifact presence is a cross-check.
2. **Handoff document first, transcript second.** When run-state records a handoff document for the role you are re-engaging (the stage's \`handoffs[]\`, or \`sessionHandoff\` for the LEAD itself), read the DOCUMENT and seed the fresh worker from it — it is the predecessor's own distillation and is cheaper and cleaner than replaying a raw transcript. Fall back to the transcript warm-seed below only when no document exists. A worker that died mid-flight (crash / socket-close) never returned \`HANDOFF\`, so it has no document — expect an interrupted stage's resume to land directly on the transcript warm-seed (step 3), and go find the transcript BEFORE inspecting artifacts.
3. **Warm-seed, don't cold-restart.** When you must re-engage a prior role (e.g. re-review a fix, or continue an interrupted stage), spawn a FRESH worker of that role and seed it with its predecessor's context: locate that worker's transcript — use the recorded path if present, else GLOB \`<claude-projects>/<cwd-as-slug>/**/subagents/agent-<agentId>.jsonl\` for the recorded agentId (the \`agent-<agentId>.meta.json\` sidecar confirms its role) — read it back, extract the relevant prior findings/reasoning, and pass them into the new worker's prompt ("Here is what your predecessor established: …"). The new worker has a new agentId but carries the prior context — functionally a resumed reviewer.
4. **Fallback when the transcript is gone** (pruned / expired / unavailable): cold-reconstruct from the change directory + run-state alone (the Tier B path), and record in run-state that this resume was a cold reconstruction.

Within a SINGLE live session, prefer the cheaper \`SendMessage\` warm continuation (Tier A); the transcript warm-seed is specifically for crossing a session boundary.

> The two are the SAME mechanism. \`SendMessage\`-ing a completed worker is itself a resume-from-transcript (the harness re-engages it from its \`agent-<agentId>.jsonl\`); within a session the harness locates that transcript for you via the agentId, so it looks like "the same agent continued". After a restart that in-memory agentId→transcript bookkeeping is gone, so you locate the file yourself (glob) and seed a fresh worker. Same transcript-resume — the only difference is who finds the file.

### Step G — Portfolio orchestration (the \`decompose\` fan-out)

A stage with **kind: decompose** is NOT a leaf skill call — it is a fan-out point you, the LEAD, interpret. It is always the pipeline's first stage. Evaluate its \`condition\` (e.g. \`needs-decomposition\`) against the task and either **skip** or **take** it:

- **Skip** (single coherent, reviewable slice): record the decompose stage as \`skipped\` and run the parent's remaining stages on the ONE parent change exactly as a non-decomposed pipeline does. Zero behavior change.
- **Take** (multiple independent deliverables / several distinct capabilities / a scope too large to review as one diff): the parent change becomes a **planning container** — mark its remaining stages \`delegated\` (do NOT run them at the parent level) and fan out into child changes.

**1. Produce a decomposition plan.** A set of child changes — each an independently-shippable, reviewable slice — plus a **dependency DAG** declaring which children must land before which. Create each child with \`rasen new change <child-id>\` (name them with a parent-derived prefix, e.g. \`<parent>-<slice>\`, for traceability).

**2. Self-audit the plan; proceed automatically (no human gate).** Before fanning out, audit your own plan: slice coherence, the independence basis behind any parallel cohort, and DAG correctness. If it is safe, proceed automatically — decompose is NOT a human gate (\`gate: false\`); do NOT pause for approval. Escalate to the human ONLY when you cannot produce a safe plan (you can neither establish independence NOR find a safe serial ordering). The user may still interrupt at any time, as in any auto run. Optionally you MAY dispatch an independent reviewer worker to audit the plan (author≠verifier) for extra assurance — not required.

**3. Run each child through its childPipeline.** Each child runs the decompose stage's resolved \`childPipeline\` (default \`small-feature\`, always decompose-free) via the SAME per-change pipeline machinery (propose → apply → verify → review-loop → …). A child MAY override its pipeline (e.g. one child is \`bug-fix\` while a sibling is \`full-feature\`); record each child's actual pipeline in portfolio run-state.

**4. Conservative serial/parallel policy (the safety core).**
- **Dependency edge → strict serial, topological order.** A dependent child's pipeline MUST NOT begin until EVERY prerequisite child is implemented and review-clean (its review-loop passed); never run a prerequisite and its dependent concurrently. A **shared working tree + review-clean is sufficient** for a dependent to consume a prerequisite's code — do NOT force the prerequisite to ship/archive first; escalate to ship/archive only when the dependency is on landed/merged artifacts.
- **Parallel ONLY when all hold:** (1) no dependency edge in either direction, (2) NO overlap in touched capabilities / spec folders / files, and (3) host is **Tier A**. Provably-independent children get separate worker teams and run concurrently with **no fixed cohort cap**. Under Tier B/C, run ALL children serially regardless of independence.
- **Uncertain independence → serial.** Overlapping or ambiguous touch-sets are treated as a dependency. Parallelism requires a *positive* independence proof, never merely the absence of a declared edge — "宁可串行也不能乱并行".

**5. Single portfolio-level delivery.** A child's ship stage runs in **local** delivery mode — commit only; no per-child push, no per-child PR. After ALL children complete, perform ONE portfolio-level delivery at the parent level: resolve the delivery mode there (pr / push) and push or create the PR exactly once. On partial failure, completed children's commits stay local — NEVER push a half-delivered portfolio; escalate with the open frontier.

**6. Recursion guard.** Decompose happens at most once per portfolio, only at the top level. A child's \`childPipeline\` is decompose-free, so child runs NEVER decompose further.

**7. Portfolio run-state.** Maintain a parent-level record at \`rasen/changes/<parent>/portfolio-run.json\`: the decomposition plan, child list, dependency DAG (each child's prerequisites), per-child execution mode (serial/parallel) + parallel cohort, per-child pipeline, per-child status, and the current runnable frontier. Each child keeps its OWN per-change \`auto-run.json\`. The portfolio record is AUTHORITATIVE for resume; child-directory/artifact presence is a cross-check. Resume via \`rasen pipeline resume <parent>\` (computes the next runnable child(ren) from the DAG). It also reports \`interruptedChildren\` (were \`in_progress\` at stop — re-engage via warm-seed, do NOT leave stranded) and \`escalatedChildren\` (need human attention). On **partial failure** (a child fails or escalates mid-run): stop that child's dependent chain, leave already-complete independent children intact, and escalate with the open frontier.

### Step G.1 — Cross-child implementer reuse (warm-vs-retire)

A dependent child directly consumes its prerequisite's code, so the implementer that just wrote that code is the warmest possible worker for it — but only when it still has the headroom to take on a whole new change. Between a prerequisite child and its dependent, decide reuse-vs-retire (governed by \`reuse.implementer\`; resolve it and the reuse threshold from \`resolvePipelineReuseConfig(pipeline)\` via \`rasen pipeline show <name> --json\`, default \`auto\` / \`0.25\`). Under \`reuse.implementer: never\`, skip this entirely — always spawn a fresh implementer per child.

1. **Relatedness = DAG adjacency.** Reuse is meaningful ONLY across a direct dependency edge (the dependent consumes the prerequisite's code). Independent / parallel-cohort children share nothing to reuse — give them fresh workers.
2. **Probe point = prerequisite review-clean.** Take the reuse decision at the SAME gate that already unblocks the dependent (item 4 of Step G: a dependent MUST NOT begin until every prerequisite is implemented and review-clean), so there is no new synchronization point. Probe the prerequisite implementer's recorded transcript with \`rasen agent context --transcript <path>\` (the Step F worker pointer). Do NOT probe earlier — non-trivial fixes route back to the implementer, so context keeps growing through the review-fix loop; only the review-clean reading is stable.
3. **Decision (compare to the resolved implementer reuse threshold — \`resolvePipelineReuseConfig(pipeline).roles.implementer\`).**
   - \`pct ≤ threshold\` → **warm reuse.** Tier A: \`SendMessage\` the SAME implementer with the dependent child's dispatch, carrying the **contamination guard** — the prerequisite's conventions hold ONLY where the dependent child's own artifacts (proposal/design) are silent; the worker MUST read the dependent's proposal/design FIRST and treat them as authoritative.
   - \`pct > threshold\` → **retire-between-children.** The worker's final task is to write a handoff document with reason \`retired-between-children\`, focused on cross-change-transferable knowledge (conventions, gotchas, dead ends, working set) with an EMPTY \`remaining\` (the prerequisite is complete — nothing to finish, only knowledge to carry). Then **dual-source seed** a fresh implementer for the dependent child from that document PLUS your own child dispatch brief.
4. **Merge-node rule — unique warm predecessor required.** Reuse requires a SINGLE warm predecessor. A child that depends on more than one prerequisite (a DAG merge node) ALWAYS gets a fresh implementer, multi-source seeded from each prerequisite's durable findings — never inherit any one predecessor's worker at a merge node.
5. **Lineage.** When you reuse (or seed a fresh worker from a retired) predecessor across a child boundary, record \`reusedFrom: <prerequisite-child-id>\` on the dependent child's implementer worker record in run-state (LEAD-written, single-writer invariant — child-1's frozen field).
6. **Scope guards.** \`reuse.implementer: never\` → always fresh. The design-level **fixer is excluded from reuse** — its value is fresh eyes, so never warm-reuse a prior worker for a fixer role. Under **Tier B** (no \`SendMessage\`) or for **Codex** workers, carry the reuse intent through the existing degradation ladders — the transcript warm-seed of Step F.1 for Tier B, \`threadId\` resume for Codex — rather than a live continuation; the policy holds across runtimes. Reuse across a user's manually-run sequence of unrelated changes is an explicit NON-goal (no reliable relatedness signal) — leave that staffing to the user.

### Step H — Context sensing & the handoff protocol

Agents cannot feel their own context usage; they MEASURE it. \`rasen agent context\` reads exact occupancy from a transcript's recorded API usage — \`--latest\` probes your own (the LEAD's) main session, \`--transcript <path>\` probes a worker via the pointer recorded in run-state (Step B). Probe ONLY at the discrete decision points below. NEVER inject a running token countdown into any agent's context — it breaks the prompt-cache prefix and induces premature wrap-up (context anxiety).

Thresholds and caps resolve from the pipeline's \`handoff\` config: stage-level \`handoff\` > pipeline \`handoff.roles[<role>]\` (threshold only) > pipeline \`handoff\` > built-in defaults \`{ threshold: 0.5, maxRelays: 3, stallLimit: 2 }\`. \`rasen pipeline show <name> --json\` reports each stage's resolved values. Context-heavy roles (reviewer, fixer) typically carry higher thresholds — their bootstrap (diff + specs + findings) is expensive, and retiring them too early buys relays that spend most of their window re-loading. When a role keeps hitting its threshold right after bootstrap, the durable fix is better seeding (hand the successor a distilled context pack), not a higher threshold.

**H.1 Session pre-flight (auto entry).** Once, at the start of an auto run: \`rasen agent context --latest --json\`. At or above the session threshold, offer the user a three-way choice — (a) **automatic relay now**: write the session handoff document (rasen-handoff template), then launch a successor session per H.7; (b) **continue this session** — auto-compact remains the backstop; (c) **handle it manually** (/rasen:handoff and a fresh session on their own terms). Proceed only on their say-so at that moment; below the threshold, proceed silently. This is an offer, not a gate — the user owns session handoff, and declining leaves behavior exactly as before.

**H.2 Warm-continue guard.** Before EVERY \`SendMessage\` to an existing worker (delta re-review, planner reuse, any Tier A continuation): probe that worker's recorded transcript. Below its resolved threshold → continue warm (cheapest). At or above → retire it via handoff: make the worker's FINAL \`SendMessage\` task "write your handoff document (rasen-handoff template) to rasen/changes/<name>/handoff/<role>-<n>.md", then spawn a fresh successor seeded from that document (plus planning-context.md for the planner). Seed from the raw transcript only when the document cannot be produced (worker already dead).

**H.3 Worker self-handoff (the dispatch-prompt clause).** Workers cannot probe themselves mid-run, so every dispatch prompt carries this contract:
- **Triggers**: (a) the soft budget the LEAD stated in the prompt (e.g. "if you complete <m> of <n> tasks and substantial work remains, hand off"); (b) HARD trigger — you notice your earlier conversation has been replaced by a compaction summary: stop starting new work immediately; (c) self-assessment — you can no longer recall details you read earlier.
- **On trigger**: finish or cleanly abort the current atomic step; write \`rasen/changes/<name>/handoff/<role>-<n>.md\` per the rasen-handoff template (the eliminated-hypotheses section is MANDATORY for fixer/debugger roles — it is what stops the successor from re-exploring dead ends); return \`HANDOFF { path, reason: compaction|budget|self-assessment, completed: [...], remaining: [...] }\` instead of \`DONE\`.
- **On \`DONE\` — durable findings.** The normal \`DONE\` return additionally carries a **durable-findings** clause: 1–3 lines of discoveries that stay true for FUTURE planning (constraints in the code, conventions, gotchas that outlive this task) — not per-task chatter or a status recap. The LEAD relays these findings VERBATIM into the dispatch of the planner that proposes a dependent or subsequent child change (Step B.1), so implementation discoveries feed the next proposal. Every dispatch prompt states this clause so the worker knows to produce it.
- Workers NEVER write run-state — the LEAD does all accounting (single-writer invariant).

**H.4 LEAD accounting on a HANDOFF return.** Append the record to the stage's \`handoffs[]\` in run-state. Compare \`remaining\` against the previous relay — progress means tasks completed OR hypotheses eliminated (a fixer that ruled out a hypothesis progressed, even with zero tasks ticked). Below the caps: spawn a successor of the same role seeded with the handoff document + remaining work — same stage, same session; the stage stays \`in_progress\`. A worker that dies without a document, or returns \`DONE\` with unticked tasks, is treated as a handoff WITHOUT a document: cold-reconstruct the successor's context from the change-directory blackboard.

**H.5 Relay caps → LEAD review (not a human gate).** On the (maxRelays+1)th handoff request for one stage, or on \`stallLimit\` consecutive NO-progress relays (this fires early — do not wait for the count cap), STOP relaying and review the history yourself: relays that are progressing may continue past the cap after review; stalled ones need a MATERIAL change. Options, cheapest first: (1) change the approach — re-prompt the successor with a different strategy, or fix the seeding so it stops burning its window on bootstrap; (2) design-level rework — send the problem back to the planner (revise design/tasks, then re-apply the affected part); (3) isolate — split the stubborn remainder into its own task or child change so the main line can move. Record every attempt in the stage's \`strategyAttempts\` with rationale; a retry that changes nothing material is not an attempt, it is thrash.

**H.6 Strategy budget & non-blocking escalation (shared with Step E's loop termination).** Default budget: 3 strategy attempts per stage. When it is exhausted (or Step E's round cap is hit and the ladder is exhausted): mark the stage \`escalated\` in run-state with the full relay/strategy/finding history, PARK it, and CONTINUE unblocked work — other portfolio children always; later stages of the same change only when the parked problem does not block them (open Blocker/Major findings block \`ship\`, per the guardrails). Surface every parked item at the next natural pause — a gate, or the run-end report — as a decision for the human. Never hard-stop the whole run mid-flight for one stuck stage; never report clean while a Blocker/Major is open; never silently pass.

**H.7 Session relay (relaying yourself).** The LEAD can launch its own successor — a verified platform capability (2026-07-07, claude CLI 2.1.202: a session can spawn a new interactive Claude Code window seeded with an initial prompt; the earlier "platform cannot restart the main session" assumption is retired). The mechanics (bootstrap prompt via file indirection or \`-EncodedCommand\` — bare-quoted prompts get truncated by nested shell parsing; platform spawn commands; manual fallback) live in the rasen-handoff skill's "Session relay" section. The orchestration-level invariants:
- **Quiesce first.** Relay ONLY at a stage boundary: every dispatched worker has returned \`DONE\`/\`HANDOFF\` and run-state is persisted. A probe that fires mid-stage waits for the worker's structured return (H.3 covers the worker's own exhaustion) before the handoff-plus-relay sequence. Additionally, before the relay any **held warm reuse candidate** — a worker that returned \`DONE\` but was RETAINED for a dependent child rather than dismissed (Step G.1) — MUST first write its knowledge digest document — which IS a handoff document: the same rasen-handoff template, written to \`rasen/changes/<name>/handoff/<role>-<n>.md\` with reason \`retired-between-children\`, so the successor's document-first resume ladder (F.1) finds it — because its cross-change knowledge would otherwise be lost with its session-scoped agent handle.
- **Spawn after persistence, then stand down.** The handoff document and the \`sessionHandoff\` record (with generation \`n\`) hit disk BEFORE the spawn; after the spawn, end the turn and tell the user the predecessor window can be closed — never keep orchestrating from the predecessor.
- **Generation cap.** \`sessionHandoff.n\` at \`maxRelays\` (resolved config, default 3) stops auto-relay: present the relay history and recommend decomposing the change (Step G) — repeated session relays are the decompose signal, same as worker relays (H.5).
- **No cross-session worker resurrection.** The successor never addresses the predecessor's workers (dead agentIds); it re-creates what it needs via the Step F.1 ladder — handoff document first, recorded transcript second, change-directory cold reconstruction last.`;
