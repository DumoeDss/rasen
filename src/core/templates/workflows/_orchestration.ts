/**
 * Shared LEAD Orchestration Playbook
 *
 * This complete playbook is the canonical semantic source. Workflow-specific
 * bundles select modules from it for `auto`, `goal`, and `review-cycle` while
 * preserving the complete auto rendering byte-for-byte. It tells the executing
 * agent to act as the LEAD — the sole orchestrator — and dispatch each stage
 * to a role-isolated leaf worker that invokes the stage's existing Rasen skill.
 * It defines capability tiers (A/B/C), role isolation + the structural
 * author!=verifier invariant, the change-directory blackboard + run-state,
 * stage metadata, bounded review and goal loops, portfolio orchestration, and
 * the context sensing + handoff protocol (Step H).
 *
 * HOW (this playbook) is intentionally decoupled from WHAT (the pipeline
 * definition). The pipeline DAG is supplied inline today and from the
 * data-driven pipeline registry later; this text does not change when the
 * source of the DAG changes.
 */

export const ORCHESTRATION_PLAYBOOK = `## Orchestration Playbook — LEAD drives role-isolated subagents

You are the **LEAD**. You orchestrate; you do NOT author WHOLE stage outputs yourself. **Exception:** you MAY apply a **trivial inline fix** per Step E.2 (a one-character typo, an obvious rename) — which is then re-reviewed by a non-author like any other fix; a trivial finding does NOT warrant spawning a separate fixer worker. Anything larger than a trivial inline fix is authored by a dispatched worker, never by you. Each pipeline stage is dispatched to a **leaf worker** subagent that invokes that stage's existing Rasen skill and returns its result to you. Workers never spawn their own subagents — you are the sole orchestrator (flat hierarchy: LEAD + leaf workers).

### Step A — Detect the capability tier (once, at start)

- Run \`rasen pipeline show <name> --for-execution --json\` once, appending every run-local role flag supplied to this workflow (for example \`--planner codex --reviewer codex\`), and consume its detected \`hostRuntime\`, \`hostRuntimeSource\`, and per-stage \`runtime\`, \`runtimeSource\`, and \`dispatchMode\`. Do not infer the host independently from whichever worker tool happens to be visible.
- **Tier A (native):** the host's native leaf-worker tools are available. On a Claude host this is the existing Task/Agent + \`SendMessage\` lifecycle. On a Codex host this is \`spawn_agent\`, \`send_message\`, \`followup_task\`, and \`wait_agent\`; native Codex completion is the worker's final response, which is delivered to the LEAD automatically.
- **Tier B (no warm continuation):** native spawning is available but the host cannot warm-continue a completed worker. Spawn a FRESH worker per stage/round and reconstruct its context from the change directory + run-state (and, when available, the prior worker's recorded transcript — Step F.1).
- **Tier C (degraded fallback):** No subagent capability. Execute the pipeline sequentially in a single context. This is the explicit fallback, NOT the primary path.

For Claude native dispatch, agent-teams (\`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1\`) enables \`SendMessage\` re-engagement of a worker by its **agentId** in general — but it does NOT guarantee a COMPLETED worker is reachable. So record **agentId** + **transcript**, re-engage **agentId-first**, and fall back to the transcript warm-seed of Step F.1. Only the LEAD may originate \`SendMessage\`; it is within-session only.

Record the detected host, tier, and each stage's dispatch mode in run-state. The pipeline definition is identical across hosts; only the mechanics below differ.

### Step A.1 — Resolve each agent runtime (Claude or Codex)

Each stage has an effective **runtime** and **dispatch mode**. The execution view returned in Step A is the authoritative FINAL plan: because Step A forwarded the invocation role flags, the registry has already applied each run-local choice before route validation. Do not apply or validate the flags a second time after preflight. The reported precedence is:

1. Per-invocation role overrides from the user, e.g. \`--planner codex --reviewer claude --fixer codex\`.
2. The registry execution view: config role instance, then stage declaration, then \`agents.<role>\`, then the detected host runtime.
3. Only when the host is unknown, preserve the legacy Claude fallback and label the route \`legacy-fallback\`; never describe that compatibility result as confident host-native dispatch.

The mandatory \`--for-execution\` call computes every override's route against the same detected host and rejects an unsupported final route before any worker launches. Supported roles are \`planner\`, \`implementer\`, \`reviewer\`, \`fixer\`, and \`shipper\`. A single run may mix runtimes only where the host route matrix supports it.

The supported matrix is: Claude host → Claude worker \`native\`; Claude host → Codex worker \`exec-bridge\`; Codex host → Codex worker \`native\`; Codex host → Claude worker \`unsupported\`. Unknown host uses \`legacy-fallback\` only. Never silently substitute a different runtime for an unsupported explicit choice.

### Step B — Dispatch a stage to a role-isolated worker

For each stage, dispatch a worker of the stage's **role** using the effective runtime from Step A.1.

For a **Claude-native** stage, spawn a worker and have it invoke the stage's **skill** via the Task tool, e.g.:

> Task tool (subagent_type: "general-purpose", prompt: "You are the <role> for change '<name>'. Use the Skill tool to invoke <skill>. Read rasen/changes/<name>/ for context. <stage-specific instructions>. Return <what the LEAD needs back> via \`SendMessage\` to the LEAD — not solely as your final turn's plain-text output, which the LEAD may never observe. Do only this one unit of work — do NOT spawn subagents of your own; the LEAD owns all orchestration. <handoff clause — Step H.3>")

For a **Codex-native** stage, call \`spawn_agent\` with a concrete leaf task and record the returned **agent id**. Use \`send_message\` only for intermediate guidance while that worker is running, and \`followup_task\` to start a new turn when an existing worker is idle. The worker's final \`DONE\` or \`HANDOFF\` response is delivered to the LEAD automatically: do NOT send a duplicate completion message. Collect independent work as it arrives. Call \`wait_agent\` only at a true dependency barrier where no useful local or sibling work remains, and prefer one long, barrier-sized event-driven wait over repeated 30- or 60-second polling cycles. Repeated \`Waiting for agents\` loops are orchestration churn, not a required Codex protocol.

Every dispatch prompt MUST end with the handoff clause of **Step H.3** (triggers + the structured \`DONE\`/\`HANDOFF\` return contract) — a worker that runs out of context mid-stage hands its work to a successor instead of silently degrading. The handoff document is runtime-agnostic; an exec-bridge \`threadId\` is only an optimization for that one route.

Isolation comes from the separate worker context — that is what keeps one stage's noise out of the next. Hand off between stages through the **change directory** (proposal.md, design.md, tasks.md, specs/) for review material, and the **work directory** (review-report.md, ship-log.md, and the rest of the process ephemera set — Step F resolves and defines this location) for process ephemera, never through shared memory. Use \`SendMessage\` only to continue a conversation with a worker you already spawned (Tier A), not as the inter-stage state channel. When you have several consecutive instructions ready for the same live (not parked) worker and do not need an intermediate result between them, combine them into a single \`SendMessage\` rather than sending them separately — each delivery rebases the worker's conversation and re-taxes its cache, so batching pays that cost once instead of once per instruction.

A worker MUST leave its stage's durable artifact before returning — its conversation output alone is NOT a handoff. In particular, the generic expert skills (review / cso / qa / qa-only / benchmark / design-review), when dispatched, run report-only (see their PREAMBLE "Dispatched vs standalone mode") and write their findings — tagged with canonical severities — to the canonical report file in the **work directory** THEMSELVES (Step F's resolved location; sticky-legacy fallback to the change directory), not to their standalone \`.rasen/*-reports/\` paths: \`review-report.md\` (code review), \`cso-report.md\` (security), \`qa-report.md\` (qa or qa-only), \`benchmark-report.md\` (performance), \`design-review-report.md\` (design). The worker that invokes them verifies the report is present before returning. State the target report path in the dispatch prompt's stage-specific instructions. These files are what the resume artifact cross-check, \`ship\`'s verification pre-flight, and \`retain\` (report mode) consume.

For a **Codex exec-bridge** stage, dispatch a leaf worker as a \`codex exec\` process — the shipped invocation shape (\`src/core/codex\`'s \`buildCodexExecInvocation\`), rendered as the shell command you actually run:

\`\`\`
codex exec --json --output-schema <schema.json> -o <last-message.txt> \\
  -s <read-only|workspace-write> -m <model> -c model_reasoning_effort="<effort>" \\
  "<inlined template + task prompt + flat-hierarchy guard>" < /dev/null
\`\`\`

Non-negotiable invariants, not style preferences:

- **Always redirect stdin from \`/dev/null\`.** \`codex exec\` blocks forever awaiting EOF otherwise.
- **Always end the prompt with the flat-hierarchy no-delegation guard** (the library's \`CODEX_FLAT_HIERARCHY_GUARD\` constant — paraphrase it, do not skip it: it tells the worker it is a leaf and must not spawn, delegate, or wait on sub-agents under any circumstances). Codex's native multi-agent system is hierarchical by default and only prompt-level suppression is verified to work.
- **Never dispatch a leaf worker at \`ultra\` reasoning effort.** \`ultra\` auto-delegates to sub-agents, which breaks the flat-leaf invariant; use \`xhigh\` for the hardest leaf work instead.
- **Inline template and skill bodies into the prompt client-side** — never rely on Codex resolving a prompt file on its own (\`$CODEX_HOME/prompts\`); that path fails silently rather than erroring, so a worker that was supposed to receive a skill body can silently run without it.
- **Constrain worker returns with the structured-return contract.** Write the leaf-return schema (or the evaluate-gate schema, for a goal-loop evaluate dispatch) to a schema file and pass it via \`--output-schema\`; parse the \`-o\` last-message file as strict JSON against that schema — do not accept free text as a worker's structured result.

Use \`workspace-write\` only for artifact-writing roles such as planner or explicitly approved fixing work; use \`read-only\` for reviewers, leadReview checks, and re-review.

When you spawn a worker, record its identity in run-state (Step F) FROM THE SPAWN RESULT: Claude-native workers record **runtime=claude**, **dispatchMode=native**, **role**, **agentId**, and **transcript**. Codex-native workers record **runtime=codex**, **dispatchMode=native**, **role**, and the returned **agentId**; record a transcript only if the host actually surfaces one, and never invent a \`threadId\` or \`turnId\`. Codex exec-bridge workers record **runtime=codex**, **dispatchMode=exec-bridge**, **role**, **threadId** (from the \`--json\` stream's \`thread.started\` event), **sandbox**/**model**/**effort**, and the rollout file path as **transcript**. Exec mode yields NO turn id. NEVER record a fabricated \`name\` in place of these handles. If a spawn result did not surface a handle, record what you have and flag it for the next dispatch — do not invent one.

### Step B.1 — Persistent planner: propose-only session reuse

**Governed by \`reuse.planner\`.** Resolve the planner reuse mode from \`resolvePipelineReuseConfig(pipeline).planner\` via \`rasen pipeline show <name> --json\` (default \`auto\` — the same place Step H reads resolved handoff config). Under **\`auto\`** the persistent-planner rule below applies as today. Under **\`never\`** do NOT persist a planner: spawn a FRESH planner for each propose, seeded from \`planning-context.md\` + the sibling proposals already on disk (this is item 2's Tier-B seeding path, promoted to the general \`never\` path), rather than reusing the prior planner. Everything else in this section describes the \`auto\` path.

Propose is the ONE exception to fresh-per-stage spawning: under \`reuse.planner: auto\` a run keeps a SINGLE planner and re-engages it for every propose-stage unit of work (the first change's propose, then every decomposed child's propose). Rationale: proposing is research-heavy — one planner researches the codebase ONCE and amortizes it across all proposals, and a shared planner keeps sibling specs mutually consistent (child #2's planner knows what child #1 promised). All OTHER stages keep fresh role-isolated workers exactly as Step B — do NOT extend this reuse beyond propose. Author != verifier is unaffected: the planner never verifies its own outputs (direction review belongs to the LEAD, leadReview).

1. **Seed once.** Before the first propose, write what YOU already know to \`rasen/changes/<name>/planning-context.md\` (for a portfolio: the parent's directory): the user's intent verbatim, your codebase findings so far, the decompose plan + dependency rationale, and constraints/decisions already made. The first planner reads this FIRST, then researches only what is missing — not from zero.
2. **Reuse for every subsequent propose.** Claude native: do NOT spawn a new planner — \`SendMessage\` the SAME planner agentId. Codex native: use \`followup_task\` on the same idle planner agent. Exec-bridge: resume the same thread per Step B.2. Tier B (no warm continuation): spawn fresh but seed it with planning-context.md + the sibling proposals already on disk — still skips most re-research.
3. **Keep the digest current.** Instruct the planner to APPEND durable new findings (decisions, discovered constraints — not chatter) to planning-context.md after each propose, so Tier B re-spawns and post-restart warm-seeds stay cheap.
3.5. **Keepalive between consecutive proposes (Step B.4).** The persistent planner is MILESTONE_BOUND: when the NEXT child's propose will be dispatched within the planner's beat budget (12 beats ≈ 54 minutes), have the planner park in \`rasen agent wait --role planner\` instead of completing its turn, and deliver the next propose brief as a \`resume\` signal; after the LAST child's propose completes, write its \`standDown\` signal. When the gap to the next propose is long or unbounded (children serialized behind full pipelines), do NOT park — let the planner complete normally and re-engage it per this section's existing rules, accepting the warm-rewrite cost.
4. **Record the planner pointer.** Portfolio runs: record the planner's canonical route-specific worker identity at the TOP level of \`portfolio-run.json\` (field \`planner\`) — \`agentId\` plus transcript when surfaced for native dispatch, or \`threadId\` plus rollout transcript for exec-bridge. Single change: the propose stage's \`worker\` record (Step F) suffices. After a restart, warm-seed the next planner from this pointer per Step F.1 (\`rasen pipeline resume\` reports it).
5. **Retire on bloat (deterministic).** A planner that has proposed many children accumulates context. Before EVERY planner re-engagement, apply the Step H.2 warm-continue guard: probe its recorded transcript with \`rasen agent context --transcript <path>\`; at or above its threshold, retire it — have it write a final handoff document, then seed a fresh planner from that document + planning-context.md and continue the run with the successor (update the recorded pointer). This is a CROSS-CHANGE re-staffing decision, so the threshold it compares against is the resolved **reuse** threshold for the planner (\`resolvePipelineReuseConfig(pipeline).roles.planner\`, default 0.25) — NOT the handoff threshold that governs mid-task relay; the transcript-probe mechanism is otherwise unchanged.

### Step B.2 — Codex exec-bridge lifecycle (resume, death, failure, occupancy, parallelism)

- **Resume.** Re-engage an existing Codex worker with \`codex exec resume <threadId> --json --output-schema <schema.json> -o <last-message.txt> -m <model> -c model_reasoning_effort="<effort>" "<message>" < /dev/null\` — same capture flags and closed stdin as a fresh dispatch, including \`--output-schema\` whenever the resume expects a structured return (e.g. a completion-shaped "finish the remaining tasks" nudge still needs the leaf-return/evaluate-gate contract; omit it only for a genuinely free-form conversational nudge) — but with **NO \`-s\`/\`--sandbox\`**: sandbox mode is fixed at thread creation and \`codex exec resume\` rejects the flag outright. If a resume needs a different sandbox, that requires a fresh thread, not a resume call. Always resume by explicit \`threadId\` — there is no "latest thread" form (racy under parallel dispatch).
- **Death detection.** A Codex thread is dead-in-flight when the rollout's last turn-opening event (\`task_started\`) has no following turn-closing event (\`task_complete\` or \`turn_aborted\`) — this is the real rollout event vocabulary; the dotted \`turn.*\` names belong to \`codex exec --json\`'s stdout stream, not the rollout file. A rollout with no opener at all is idle, not dead.
- **Revival.** When re-engaging a thread that died mid-turn, prepend a revival notice to the resume message (the library's \`CODEX_REVIVAL_NOTICE\` semantics): the interrupted turn's last action may not have completed — do not trust that turn's claims about command or file state, re-verify before continuing.
- **Failure handling.** Classify a failed turn before deciding how to react: a rate-limit failure (429) is retryable — back off and retry starting around 20s, doubling each attempt, capped at 120s; a model-not-available failure (404) is fatal — do not retry, surface it; anything else is unknown — escalate per the Step H.4a worker-death taxonomy rather than guessing.
- **Occupancy.** Probe a Codex worker's context the same way as a Claude worker — \`rasen agent context --transcript <rolloutPath> --json\` — under the SAME thresholds (Step H); a zero-turn rollout legitimately reads 0% occupancy, that is normal, not an error.
- **Parallel discipline.** Any number of independent \`codex exec\` processes may run concurrently, each on its own thread — that is safe and verified. NEVER run two concurrent resumes against the SAME thread id: one thread id, one writer, always.

### Step B.3 — Codex project-context guidance

Pass per-change context to a Codex worker by **naming the change directory's artifact paths in the dispatch prompt** (e.g. "Read \`rasen/changes/<name>/proposal.md\`, \`design.md\`, and \`tasks.md\` before starting") — this is a verified mechanism, workers genuinely read referenced files, not an aspiration. Reserve repo-root \`AGENTS.md\` for repo-global conventions that apply to every worker regardless of change; it is NOT a per-change context vehicle. Do NOT relocate or \`cd\` a worker into a change directory to trigger nested \`AGENTS.md\` auto-discovery as a substitute for naming files explicitly.

### Step B.4 — Parked-worker keepalive (\`rasen agent wait\`)

At run start, the LEAD reads the effective \`keepalive.enabled\` entry ONCE for the current planning context (project > global > registry default \`true\`) through the effective-config view and snapshots that policy for the whole run. Before each stage dispatch, combine that snapshot with the stage runtime already resolved in Step A.1: **ONLY \`keepalive.enabled=true\` AND runtime \`claude\` may receive a reusable horizon supported by this pipeline**. When the switch is disabled OR the runtime is non-Claude, dispatch the stage as \`ONE_SHOT\`. A gate-forced \`ONE_SHOT\` prompt names only that horizon; it MUST omit the \`rasen agent wait\` loop, signal-file resume/stand-down protocol, parking timeout, and the raw switch value. The LEAD owns this decision — leaf workers never receive or re-resolve the switch.

Subagent prompt caches expire after ~5 minutes of idling; a worker resumed after that pays a full-context cache rewrite, and a \`SendMessage\` delivered to it rebases its conversation and forces the same rewrite even sooner. When a worker will be needed again shortly, park it WARM instead of letting it idle: the worker stays in its turn and calls \`rasen agent wait --change <name> --role <key>\` in a loop, acting on each returned JSON — \`{beat, remaining}\`: **emit no text and no deliberation — immediately re-issue the identical wait call** (each continuation stays a pure tool-result extension of the cached prefix); \`{resumed, instruction}\`: perform the instruction; \`{standDown, reason}\`: stand down (below). Each beat is a bounded blocking poll of \`<changeRoot>/signals/<key>.json\`, so every continuation stays a clean cache extension. The beat length resolves from config: an explicit \`--beat-seconds\` flag wins, else \`keepalive.beatSeconds\` (registry default 270 — near the optimal refresh cadence for the ~5-minute cache TTL), else a built-in 100s fuse when config is unreadable or the on-disk value is out of range; the 300s TTL hard cap always applies. A worker cannot read config, so **every park dispatch prompt MUST require the worker to issue its \`rasen agent wait\` call with an explicit Bash tool \`timeout: 330000\` (ms) named in the same sentence as the wait call** — a fixed constant covering the maximum 280s beat plus margin, so a configured beat is never killed mid-poll by the tool's default 120s timeout (which would silently defeat the keepalive). On the first beat of an episode the command discards any signal file older than ~2 minutes — a leftover standDown from a previous park cannot insta-kill a new one. The command self-limits: a uniform beat cap (12 beats for every role ≈ 54 minutes at the default beat — the economic stop-loss backstop, not the primary retirement mechanism), and runtime gating (Claude on, Codex off by default — parking is pointless off the Claude cache model, so a Codex worker gets \`standDown\` at once and follows the normal retire path). There is NO context floor by default — park any worker with scheduled reuse regardless of size (\`keepalive.contextFloor\` in config can re-enable a floor, enforced only when \`--context-tokens\` is passed).

**Reuse horizons — decide at dispatch, and SAY it in the dispatch prompt:**
- **ONE_SHOT** (default; ship, archive, every parallel fan-out member, any worker with no scheduled reuse): never calls \`wait\`; DONE → exit.
- **LOOP_BOUND** (review-loop reviewer/fixer): parks between rounds; stands down when the loop exits (clean or cap). The same horizon covers the **apply implementer**: when a review/verify stage immediately follows apply, dispatch it to park pending the first review verdict rather than leaving it un-parked to idle out its cache. Stand it down through the normal stand-down protocol when that first verdict is clean; when the verdict routes a fix back to it, deliver the fix through the signal protocol below, not \`SendMessage\`.
- **MILESTONE_BOUND** (the persistent planner): may park between consecutive propose dispatches; the LEAD writes a \`standDown\` signal when the milestone lands (for a decompose run: the last child's propose is done).

**LEAD signal protocol (the ONLY channel to a parked worker):** write \`{"kind":"resume","instruction":"<next unit of work>"}\` or \`{"kind":"standDown"}\` to \`<changeRoot>/signals/<key>.json\` — atomically (write a temp file in the same directory, then rename). NEVER \`SendMessage\` a parked worker: mid-turn delivery rebases its conversation and destroys exactly the cache the park is preserving (\`SendMessage\` rules for non-parked workers are unchanged). The worker consumes the signal file on read. **Write the \`standDown\` signal the moment a parked worker is no longer needed** — prompt stand-down is the retirement mechanism; the beat cap is only a stop-loss backstop for when you forget, never the intended way a park ends.

**Stand-down protocol (any \`standDown\` reason):** the worker writes/refreshes its handoff distillate per Step H.3, returns \`DONE\` with durable findings, and exits, freeing its slot. The LEAD treats a stood-down worker as retired — a successor is cold-seeded from the dispatch brief + handoff document, never resumed. Do NOT park across long or unbounded gaps (a full child pipeline, an open-ended human gate): the beat cap will burn out first — retire instead.

**Long-running-command warming (same cache discipline, applied to a worker's OWN commands):** a command a worker expects to run longer than ~2 minutes, or of unknown duration (test suites, builds), MUST run via the shell tool's background mode (\`run_in_background\`) paired with bounded FOREGROUND polling at intervals of at most 270 seconds — NOT a single blocking foreground call that idles past the cache TTL, and NOT a fire-and-forget background wait that idles until a completion notification. Two rationales, both load-bearing: a backgrounded command's completion notification can be lost (the original long-task discipline), and each foreground poll return refreshes the prompt cache exactly as a beat does (the keepalive rationale). Short, sub-2-minute commands stay in the foreground. The 270-second polling bound is a FIXED figure — it does NOT track \`keepalive.beatSeconds\`.

### Step C — Enforce author != verifier by role assignment

- The reviewer worker MUST NOT be the implementer worker.
- The fixer of a design-level finding MUST NOT be the original author.
- The worker that re-reviews a fix MUST NOT be the worker that authored the fix.

Under Tier C (single context) the non-author confirmation degrades to an independent gate-run (tests/lint/build) plus a diff-read of the exact change, recorded in run-state and marked as the fallback.

### Step D — Honor stage metadata

- **gate (autopilot-gate-policy):** \`gate: true\` is a pause gate — do not confuse it with the unrelated goal-loop \`loop.gate\` measure/evaluate union (Step L), which is a stop CONDITION, not a pause. Read each stage's already-masked **effective gate** (\`effectiveGate\` from \`rasen pipeline show <name> --json\`, decided per \`pipelines.<name>.gates.<stage>\` over the recorded \`gatePolicy.effective\` base over the stage definition) rather than re-deriving it — no gate type is exempt from the mask. For a stage whose effective gate is \`on\`: pause exactly as before — summarize what was done and what is next, wait for the human to Continue / Stop (save progress, resumable later) / switch to Manual. For a stage whose effective gate is \`off\` (e.g. an \`autopilot.gates: off\` base with no per-stage \`on\` instance): auto-approve without pausing, and record \`gateDecision: auto-approved (<source>)\` on that stage in run-state (Step F) — the decision is recorded, never silently skipped and never deleted.
- **condition:** If the stage's condition is not met for this change, skip it and record the skip. When a stage lists several MUTUALLY EXCLUSIVE conditions (e.g. one expert "or else" another), pick exactly one.
- **parallelGroup:** Run the group's members concurrently and collect every result before proceeding. A single stage MAY itself fan out into a parallel group — e.g. a \`verify\` stage with \`parallelGroup=experts\` becomes one reviewer worker per condition-met expert skill (review / cso / benchmark / design-review / qa), all results collected before the loop. **Stagger the fan-out (cache-stampede guard):** same-model Claude members of a group share a byte-identical prompt prefix (system prompt + tools), but a prompt-cache entry becomes readable only AFTER the first request has started streaming — N simultaneous dispatches therefore ALL pay a full-price cache write. Dispatch ONE member first; only after its spawn result returns, dispatch the remaining members together — they read the prefix the first one just wrote (~0.1x input cost instead of a full write each). The stagger reorders dispatch only; the collect-every-result-before-proceeding invariant is unchanged. **Prompt caches are MODEL-SCOPED:** members resolved to different models (Step A.1 chain) share nothing — keep one model per group when the pipeline allows it; a mixed-model group is a legitimate cost trade-off, but only same-model members benefit from the stagger. Codex members are exempt from the guard entirely (the cost model is Claude-cache-specific — same reasoning as Step B.4's runtime gate). Every fan-out member is dispatched **ONE_SHOT** (Step B.4) — parked keepalive never stacks onto a wide fan-out, where held slots would starve the group. **Under Tier C** (no subagent capability) run the group's members **sequentially in the single context** and collect all results before proceeding — the concurrency is a Tier-A/B optimization, but the collect-all-results-before-proceeding invariant holds across ALL tiers.
- **loop:** Run the stage as the bounded review->fix loop (Step E).
- **retain stage (frozen mode):** Before dispatching a stage whose canonical ID is \`retain\`, read run-state \`retention\`. If absent, resolve the effective profile mode once (\`off\` | \`report\` | \`codify\`) and record it in run-state BEFORE dispatch; otherwise reuse it without reading the current profile. Pass the frozen mode in the dispatch instructions; resume always uses it. The LEAD is the sole run-state writer; the worker never changes this field. This stage-identity rule applies in every pipeline.
- **archive stage (archive timing axis):** Read the ship log's RECORDED facts from \`workDir\` (Step F) before deciding how to run the archive stage — key the decision on what the ship log actually recorded, NEVER on the currently-resolved \`archive.timing\` (a config value can be edited after the fact; the recorded delivery cannot — same rule as the archive skill's own step 2.5). **Ship log records an \`Archived in ship:\` line** — ship already ran sync + bookkeeping inside its own stage for THIS delivery; record the archive stage \`done\`/\`skipped\` with reason "archived in ship" and dispatch nothing. **No \`Archived in ship:\` line** (covers every other case: \`on-merge\` push/local/pr delivery, or no ship log at all) — dispatch the archive stage normally; do NOT pre-branch push/local vs pr here — the archive skill's own steps (1.5 directory scan, 2.5 recorded-Mode branch, 2.6 merge gate) resolve the rest, including the idempotent no-op and the merge-confirmation gate, from the same recorded facts. If the dispatch returns an unmerged refusal (the merge-confirmation gate did not pass), record the stage as \`pending\` in run-state with an awaiting-merge note (the PR URL) and END the run cleanly, surfacing the open frontier — never poll or busy-wait for the merge. A later \`pipeline resume\` re-enters the stage and re-attempts the merge check fresh (check-on-invocation); \`pending\` is already a valid stage status (Step F) — no run-state schema change.
- Pipelines MAY carry additional stage metadata beyond the above (e.g. \`leadReview\`, \`verifyPolicy\`); the consuming workflow's own sections define how to handle them.

### Step E — The review -> fix loop (bounded; this is the review-cycle inner loop)

When a stage is a **loop**, narrow on \`loop.kind\`:

- **\`loop.kind === 'review-cycle'\`** runs the review -> fix protocol below (Steps 1–5). This is the ONLY loop kind that existed before goal-loop; the steps are unchanged.
- **\`loop.kind === 'goal'\`** runs the goal-driven iteration loop defined in **Step L** (single dispatch per round, warm-reused implementer, a measure or evaluate gate). Skip the review-cycle protocol below for a goal loop — it is review-cycle-specific.

Then narrow on the **ENGINE** resolved for this run (\`--engine\` flag > \`runs.engine\` config > default \`auto\`; the launcher displays it at run start). A **reconciler-engine** run drives the canonical Run — **E.1**. A **legacy-engine** run runs the LEAD-owned protocol — **E.2**. A Run has exactly ONE engine owner, frozen at launch: never run one branch's mechanics against a Run owned by the other.

**Per-role threshold inside a loop stage.** A loop stage carries a single nominal \`role\` (e.g. a review-loop stage's \`role: fixer\`), but it dispatches reviewers, implementers, AND fixers internally. Resolve EACH dispatched worker's handoff threshold by that worker's ACTUAL role — \`handoff.roles[<dispatched role>]\` (Step H) — NOT by the loop stage's nominal \`role\`. A reviewer dispatched inside a \`review-loop\` stage uses the **reviewer** threshold, not the stage's fixer threshold. This applies under BOTH engines: it governs how you staff and relay workers, which is yours either way.

#### E.1 — Reconciler engine: drive the canonical Run

The canonical Run owns every mechanical fact of the loop: round counting, phase order, the \`maxRounds\` cap, actor separation, result validation, and the clean/escalated outcome. Each of those has a real rejection path in the Record, so you keep NO second copy of any of them — do not count rounds, do not decide clean, do not check author != verifier as a verdict, do not judge whether a returned result is well-formed. Your job is selection, launch, per-action worker dispatch, result submission, and honest reporting.

**Launch.** \`rasen pipeline start <change> <pipeline> --json\` creates ONE canonical Run for the whole pipeline; the review-loop stage is a bounded loop inside it. The receipt reports the effective engine and the layer that decided it.

**At each quiescent boundary:**
1. \`rasen pipeline resume-run <change> <pipeline> --json\` — grants the ready frontier (a review, triage, fix, or re-review phase action).
2. Dispatch ONE role-isolated worker per granted action, composing its brief from the \`review-cycle\` section. A **review** or **re-review** action goes to a reviewer that delegates the pass to the \`rasen-review\` engine — do NOT fork or reimplement the review heuristics. A **triage** action classifies the collected findings by severity and disposition. A **fix** action goes to the implementer that wrote the code, or to a separate fixer for a design-level finding. Staffing distinct workers remains YOURS (Step C): the Run rejects a same-actor verification at commit, but only you can put a different worker on it.
3. \`rasen pipeline complete <change> --action-id <id> --json\` with the phase result contract, the actor identity, and the attestation evidence. The Run validates before the Record mutates: a malformed result, a same-actor verification, and a clean claim with open Blocker/Major findings are all rejected rather than absorbed.

Warm continuation of a worker between its actions follows the same recorded-route and parked-worker rules as **E.2** below, under the Step H.2 guard — those are worker-lifecycle mechanics, not loop mechanics, and are engine-neutral.

**Read progress from the \`review-cycle\` section**, never from your own accounting: \`rasen pipeline status <change> <pipeline> --json\` returns \`{ round, maxRounds, phase, outcome, findings (each with severity + status), actors, waitReason }\`. That section is the ONE source of truth for "where is this loop"; report exactly what it says.

**Termination is the Run's.** Blocker/Major all resolved -> the loop exits clean and downstream stages proceed. The cap reached with open Blocker/Major -> the Run escalates, and you report that escalation honestly — never retry past the Run's own cap to manufacture a clean result. A Run that HAS escalated is a legitimate entry point for the **Step H.5/H.6** strategy ladder: a LEAD strategy review over the Run's recorded history where each attempt changes a material variable (different fix approach, design-level rework via the planner, isolating the stubborn finding), recorded in \`strategyAttempts\`. Open Minor/Trivial findings at clean-time are already in the section; carry them into run-state as accepted-known rather than dropping them.

#### E.2 — Legacy engine: the LEAD-owned review -> fix protocol

**This is the legacy-engine path.** It runs when the effective engine is \`legacy\` — an explicit \`runs.engine: legacy\`, or \`auto\` for a pipeline whose capability discovery reports the reconciler unsupported — and for any change whose existing run-state is legacy-owned. Here there is no canonical Run to own the mechanics, so the LEAD owns them, exactly as before:

1. **Review** — dispatch reviewer worker(s), delegating each pass to the \`rasen-review\` engine, over the current diff; collect findings with severity (Blocker / Major / Minor / Trivial). Do NOT fork or reimplement the review heuristics.
2. **Triage by fix size** — trivial (you fix inline) / non-trivial (route to the implementer worker that wrote the code) / design-level (route to a SEPARATE fixer worker, never the author). If that implementer is parked pending its first review verdict (Step B.4), route the fix through the Step B.4 signal-file protocol, not \`SendMessage\` — mid-park delivery rebases its cache and defeats the purpose of parking it.
3. **Fix** via the routed actor; capture the exact fix delta so re-review can target only the delta.
4. **Re-review the delta with a non-author** — **Parked reviewer first (Step B.4):** when the reviewer was dispatched LOOP_BOUND and is parked in \`rasen agent wait\`, write a \`resume\` signal carrying the delta pointer — do NOT \`SendMessage\` it (mid-turn delivery rebases its cache). With a reviewer that already COMPLETED its turn (not parked), apply the Step H.2 warm-continue guard, then continue it through the stage's recorded route: Claude-native uses \`SendMessage\` by agentId; Codex-native uses \`followup_task\` by agent id; exec-bridge uses \`codex exec resume <threadId>\`. Re-review only the delta against its prior findings. Across a session boundary, resume a durable exec-bridge thread by explicit \`threadId\`; when a native reviewer has no live handle, warm-seed a fresh reviewer from that reviewer's recorded handoff/transcript pointers (Step F.1) so it carries the prior findings. Tier B/C: a fresh reviewer over just the delta, with prior findings + fix diff passed through a shared file. A finding is resolved ONLY after a non-author confirms it; self-certification by the fixer is rejected.
5. **Loop or terminate** — all Blocker/Major resolved (non-author confirmed) -> clean. Resolvable findings remain AND rounds < cap -> next round, re-review the new delta. Cap reached with any unresolved Blocker/Major -> do NOT stop for a human immediately: run the **Step H.5/H.6 escalation ladder** — a LEAD strategy review where each retry changes a material variable (different fix approach, design-level rework via the planner, isolating the stubborn finding), recorded in \`strategyAttempts\`; only after the strategy budget is exhausted is the stage parked as \`escalated\` and surfaced at the next natural pause point. The round cap is the stage's \`loop.maxRounds\`, resolved from the pipeline definition — read it from \`rasen pipeline show <name> --json\` rather than assuming a number; its default and its independence from the relay cap (\`maxRelays\`) are in the counter table in Step H. A review round MAY span multiple worker relays (a fixer that hands off mid-fix is relayed within the same round). Never report clean while a Blocker or Major finding is open. Any open Minor/Trivial findings at clean-time MUST be recorded in run-state as accepted-known — never silently dropped.

### Step L — The goal-loop (reconciler-driven)

A \`goal\` loop drives a task whose "done" is a *condition* — a measurable threshold (measure gate) or a quality judgment (evaluate gate). Under the reconciler engine, the loop mechanics (rounds, work→judge phases, stall detection, maxRounds cap, actor separation) are owned by the canonical Run. The LEAD does NOT own mechanical state — it drives the Run through \`rasen pipeline resume-run\` and reads the \`goal\` section from \`rasen pipeline status\`.

**Launch.** \`rasen pipeline start <change> goal-loop-<variant> --json\` creates the canonical Run.

**Each round (drive via the reconciler).** At each quiescent boundary:
1. \`rasen pipeline resume-run <change> goal-loop-<variant> --json\` — grants the ready frontier (work phase or judge phase).
2. For a **work phase** action: dispatch the implementer — warm-reused across ALL rounds (the SAME worker). After the Step H.2 warm-continue guard, continue through the recorded route: Claude-native uses \`SendMessage\` on the same implementer agentId; Codex-native uses \`followup_task\` on the same idle implementer agent; exec-bridge uses \`codex exec resume <threadId>\`. The implementer NEVER spawns child subagents.
3. For a **judge phase** action: dispatch a **FRESH reviewer worker** (≠ the implementer — the reconciler enforces actor separation at commit time). The reviewer applies the completion-audit discipline (below).
4. \`rasen pipeline complete <change>\` with the action receipt to commit each phase result.

**Read progress from the goal section.** \`rasen pipeline status <change> goal-loop-<variant> --json\` includes a \`goal\` section: \`{ variant, round, phase, outcome, lastScore?, lastGaps, stallStreak, budget: {used, max}, waitReason }\`. Read this instead of tracking state manually.

**The judge's completion-audit contract (evaluate gate).** The reviewer decides satisfaction by a completion AUDIT, not by failing to notice remaining work: treat completion as **unproven**; derive concrete requirements from goal/rubric and demand **authoritative evidence** per requirement; treat uncertain evidence as **not achieved**; NEVER accept intent, partial progress, or memory as proof. Unproven requirements become \`gaps\`.

**Termination (reconciler-owned).** Gate satisfied → the bounded-loop succeeds → downstream stages (ship → retain → archive for code-producing pipelines, or report only for research) proceed. \`maxRounds\` exhausted → the Run escalates with \`goal_cycle_exhausted\`. The LEAD reports the outcome honestly.

**Resume.** \`rasen pipeline resume-run <change> goal-loop-<variant> --json\`. The reconciler replays committed events from the canonical Record — the next ready action is deterministic. \`goal-run.json\` is a derived compatibility projection, NOT the authoritative spine.

### Step F — Maintain run-state (observability + resume)

First resolve TWO locations: run \`rasen status --change <name> --json\` (or the artifact/apply instructions payload, which also carries it) and read the \`changeRoot\` field (NOT \`changeDir\`) — the change's directory under the SELECTED Rasen root, which for a \`--store\`-selected or non-cwd run is NOT under the current working directory — and the \`workDir\` field, the external per-change work directory (design capability \`change-work-dir\`; absent when the project has no machine identity yet — the instructions surfaces mint one on first use).

**Two-location blackboard.** Review material — proposal.md, design.md, tasks.md, specs/, planning-context.md — lives under \`changeRoot\`; write and read it there, never at a cwd-relative \`rasen/changes/<name>/\`, or a store-selected run will strand it where a resumer (resolved to the same root) cannot find it. Process ephemera — run-state (auto-run.json / portfolio-run.json / the goal-loop run artifact), handoff documents, and reports — lives under \`workDir\` instead, external to the repo (it never needs a commit or a gitignore entry).

**Sticky-legacy fallback (states the rule once; every ephemeron path elsewhere in this playbook follows it): read \`workDir\` first; a file that already exists under \`changeRoot\` (an in-flight change predating this capability) keeps living there — never split one file's state across both locations; when \`workDir\` is absent from the payload, read and write everything under \`changeRoot\`, exactly as before this capability existed.**

Record progress as JSON in \`<workDir>/auto-run.json\` (sticky-legacy fallback: \`<changeRoot>/auto-run.json\`). This exact filename + JSON shape is what \`rasen pipeline resume\` reads — do NOT write markdown or a different name, or resume will not see it; resume reports the directory it actually read as \`runStateDir\` — write further updates to that SAME directory rather than re-deriving \`workDir\`. Minimum shape the reader understands:

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
  "sessionHandoff": { "n": 1, "path": "handoff/lead-1.md", "pct": 0.52, "afterStage": "apply", "at": "<iso>" },
  "rounds": 0,
  "openFindings": []
}
\`\`\`

**Run-state boundary by engine.** For a **legacy-engine** run this file is the AUTHORITATIVE record of progression, exactly as described here and below. For a **reconciler-engine** run it is bounded to what the canonical Run does not model — the engine and its deciding source, worker handles and transcripts, the gate-policy freeze, the retention mode, \`strategyAttempts\`, and the session-relay generation. Mechanical truth for such a run (stage status, rounds, phases, findings, outcomes) lives in the canonical Record and is READ from the run view; anything you mirror into run-state is a labeled projection (e.g. \`"projection": true\` beside the mirrored block) and MUST NEVER be read back to make a progression decision the Run owns. Record the engine once at run start as \`engine: { effective: 'reconciler'|'legacy', source: 'flag'|'project'|'store'|'global'|'default' }\`, so a resumer knows which of these two contracts it is reading before it interprets a single field.

\`status\` is pending | in_progress | done | skipped | escalated | delegated; \`delegated\` is parent-stage-only, and **done | skipped | delegated** count as complete for resume. (A simpler \`"completed": ["propose","apply"]\` array is also accepted when you are not recording per-stage workers.) Record each dispatched worker's **role**, **runtime**, **dispatchMode**, and only the identity pointers actually returned by that route (Step B). Also record review \`rounds\`, \`openFindings\` (legacy-engine: authoritative; reconciler-engine: a labeled projection of the run view's \`review-cycle\` section, never the thing you branch on), any skips/escalations, per-stage \`handoffs\` and \`strategyAttempts\` (Step H), and the top-level \`sessionHandoff\` when the session itself hands off. **autopilot-gate-policy:** record the top-level \`gatePolicy: { effective: 'on'|'off', source: 'flag'|'project'|'global'|'default' }\` ONCE at run start (Step D), and a per-stage \`gateDecision: "auto-approved (<source>)"\` on any stage whose gate was auto-approved rather than confirmed by a human — a human-confirmed gate leaves \`gateDecision\` unset. \`sessionHandoff.n\` is the session RELAY GENERATION (the example seeds it at \`1\`); Step H.7 caps it at \`maxRelays\`, and a \`sessionHandoff\` record written WITHOUT \`n\` reads as generation 1 and never advances — so always carry \`n\` and increment it each session relay, or the H.7 cap can never trip. Subagent work is otherwise opaque; this record is what lets the run be observed and resumed.

**Write canonical values only (host-runtime neutrality).** \`worker.runtime\` MUST be exactly \`claude\` or \`codex\`, and \`worker.dispatchMode\` MUST be exactly \`native\`, \`exec-bridge\`, or \`legacy-fallback\`. The runtime means which known worker runtime ran the stage, not what host is the LEAD. Never write JSON \`null\` for an absent optional field (\`transcript\`, \`agentId\`, \`threadId\`, etc.) — OMIT the key instead. Archived records without \`dispatchMode\` remain valid: readers infer \`exec-bridge\` from a Codex \`threadId\`, \`native\` from a native \`agentId\`/Claude transcript, and otherwise keep the ambiguity explicit with a compatibility warning. Writers always emit the known mode.

### Step F.1 — Resume a run (cold start: a planned relay OR an unexpected interruption — crash, power loss, socket-close, killed terminal)

A new session has NO live **native** workers: Claude-native \`SendMessage\` and Codex-native \`followup_task\` cannot cross a host-session boundary; their agentIds die there. Exec-bridge \`threadId\` is process-durable and resumes with \`codex exec resume <threadId>\`. Within a live session, use the recorded route-specific handle first, but a COMPLETED native worker may not resolve and a spawn \`name\` is never a handle. After an interruption, resume an exec thread directly; otherwise seed a fresh native worker from its handoff, then its surfaced transcript. Do NOT reconstruct from artifacts while those pointers exist — they preserve findings, dead ends, and in-flight reasoning. To resume:

0. **Resume under the OWNING engine, never a different one.** Read the run-state \`engine\` recorded at run start (Step F). For a **reconciler-engine** run the canonical Run is the resume truth: \`rasen pipeline resume-run <change> <pipeline> --json\` returns the ready frontier, and you dispatch from THAT — artifact presence and run-state stage ticks are observability, and never override the frontier. For a **legacy-engine** run (or when no canonical Run exists) use the artifact + run-state heuristic of step 1. If the recorded engine is absent, infer it from what is actually on disk rather than from config: a canonical Run for this change means reconciler, only legacy run-state means legacy, and both present is an engine-ownership conflict you SURFACE rather than resolve by picking one. The steps below are the legacy-engine resume surface; the worker re-engagement ladder in steps 2–4 is engine-neutral and applies to both.
1. Run \`rasen pipeline resume <name> --json\` → it returns \`completed\`, the next incomplete stage(s) (\`next\`/\`ready\`), \`remaining\`, \`workers\` (the per-stage \`agentId\`/\`transcript\` pointers worth warm-seeding from), and — so nothing is silently stranded — \`inProgressStages\` (interrupted; re-engage these), \`escalatedStages\`, and \`openFindings\` (unresolved Blocker/Major — never ship past them). For a decomposed parent it returns the per-child \`runnableChildren\` (start fresh), \`interruptedChildren\` (warm-seed-resume), \`escalatedChildren\` (human attention), and \`completedChildren\`. Run-state status is AUTHORITATIVE; artifact presence is a cross-check.
2. **Handoff document first, transcript second.** Seed from the latest holder's own \`handoffs[]\` (or LEAD \`sessionHandoff\`) before its transcript; the document is cheaper and cleaner. Mid-flight death produces no \`HANDOFF\`: native dispatch falls to step 3, while exec-bridge first resumes its \`threadId\`. A newer intact transcript beats an older generation's document. In the same live session, first try Claude-native \`SendMessage\` by agentId, Codex-native \`followup_task\` by agent id, or exec-bridge resume by \`threadId\`; fall back when absent/unresolved, and never use a spawn \`name\`.
3. **Warm-seed, don't cold-restart.** When you must re-engage a prior role (e.g. re-review a fix, or continue an interrupted stage), spawn a FRESH worker of that role and seed it with its predecessor's context. Use the recorded transcript path when the route surfaced one. For Claude-native only, when the path is missing but agentId exists, GLOB \`<claude-projects>/<cwd-as-slug>/**/subagents/agent-<agentId>.jsonl\` (the \`agent-<agentId>.meta.json\` sidecar confirms its role). For Codex-native, use a transcript only when the host actually surfaced it — never invent one. Read the available context, extract the relevant prior findings/reasoning, and pass them into the new worker's prompt ("Here is what your predecessor established: …"). The new worker has a new agentId but carries the prior context — functionally a resumed reviewer.
4. **Fallback when the transcript is gone** (pruned / expired / unavailable): cold-reconstruct from the change directory + run-state alone (the Tier B path), and record in run-state that this resume was a cold reconstruction.

Within a live session, prefer Claude-native \`SendMessage\`, Codex-native \`followup_task\`, or exec-bridge resume by \`threadId\`. Native handles fall back to warm-seeding and die across host sessions; exec threads remain resumable across processes. Claude transcript globbing is not a Codex-native assumption.

### Step G — Portfolio orchestration (the \`decompose\` fan-out)

A stage with **kind: decompose** is NOT a leaf skill call — it is a fan-out point you, the LEAD, interpret. It is always the pipeline's first stage. Evaluate its \`condition\` (e.g. \`needs-decomposition\`) against the task and either **skip** or **take** it:

- **Skip** (single coherent, reviewable slice): record the decompose stage as \`skipped\` and run the parent's remaining stages on the ONE parent change exactly as a non-decomposed pipeline does. Zero behavior change.
- **Take** (multiple independent deliverables / several distinct capabilities / a scope too large to review as one diff): the parent change becomes a **planning container** — mark its remaining stages \`delegated\` (do NOT run them at the parent level) and fan out into child changes.

**1. Produce a decomposition plan.** Define independently-shippable child slices and their dependency DAG. Resolve each pipeline, then create the prefixed child with \`rasen new change <child-id> --pipeline <childPipeline>\`; this initializes its own \`auto-run.json\` with all stages \`pending\`. Never create a child without run-state or hand-write it later.

**2. Self-audit the plan; proceed automatically (no human gate).** Before fanning out, audit your own plan: slice coherence, the independence basis behind any parallel cohort, and DAG correctness. If it is safe, proceed automatically — decompose is NOT a human gate (\`gate: false\`); do NOT pause for approval. Escalate to the human ONLY when you cannot produce a safe plan (you can neither establish independence NOR find a safe serial ordering). The user may still interrupt at any time, as in any auto run. Optionally you MAY dispatch an independent reviewer worker to audit the plan (author≠verifier) for extra assurance — not required.

**3. Run each child through its childPipeline.** Each child runs the decompose stage's resolved \`childPipeline\` (default \`small-feature\`, always decompose-free) via the SAME per-change pipeline machinery (propose → apply → verify → review-loop → …). A child MAY override its pipeline (e.g. one child is \`bug-fix\` while a sibling is \`full-feature\`); record each child's actual pipeline in portfolio run-state.

**Child-pipeline gate resolution under portfolio orchestration.** "Proceeds automatically (no human gate)" in item 2 governs the **decompose decision only** — it does not by itself decide how the children's pipeline gates resolve; those resolve per the parent run's gate directive (below). A child's \`childPipeline\` internal \`gate: true\` stages resolve per the **parent run's gate directive**: a parent auto run the user launched autonomously (or that resolved decompose without a gate) treats child gates as **auto-continue checkpoints** — RECORD each as taken in portfolio run-state, do NOT pause per child. If the user asked to be gated, collapse the child's gates into ONE per-child checkpoint (not one per gate stage). **Precedence: parent directive > child pipeline \`gate\`.** \`--no-gate\` (or a resolved gate policy of \`off\`) IS a parent directive in this sense: it auto-approves \`gate: true\` child gates the same way it does at the parent level, recorded per child in portfolio run-state. No child gate type is exempt — a per-stage \`pipelines.<name>.gates.<stage>: on\` instance is the only thing that restores a pause under an \`off\` directive, and it does so at the child level exactly as at the parent (Step D). (This reconciles the auto command's gate-policy wording, which governs a NON-portfolio run, with the decompose autonomy — the 9-pauses literal reading of a 3-child × 3-gate portfolio is explicitly rejected.)

**4. Conservative serial/parallel policy (the safety core).**
- **Dependency edge → strict serial, topological order.** A dependent child's pipeline MUST NOT begin until EVERY prerequisite child is implemented and review-clean (its review-loop passed); never run a prerequisite and its dependent concurrently. A **shared working tree + review-clean is sufficient** for a dependent to consume a prerequisite's code — do NOT force the prerequisite to ship/archive first; escalate to ship/archive only when the dependency is on landed/merged artifacts.
- **Parallel ONLY when all hold:** (1) no dependency edge in either direction, (2) NO overlap in touched capabilities / spec folders / files, and (3) host is **Tier A**. Provably-independent children get separate worker teams and run concurrently with **no fixed cohort cap** — when launching a cohort, apply Step D's cache-stampede stagger to its first dispatches (one worker first, the rest after its spawn confirms). Under Tier B/C, run ALL children serially regardless of independence.
- **Uncertain independence → serial.** Overlapping or ambiguous touch-sets are treated as a dependency. Parallelism requires a *positive* independence proof, never merely the absence of a declared edge — "宁可串行也不能乱并行".

**5. Single portfolio-level delivery.** Children ship \`local\` (commit only). Start \`delivery.status\` as \`pending\`; after ALL children finish, set \`in_progress\`, deliver once at the parent (pr / push / local), record the mode, then set \`done\` on success. \`skipped\` means an explicit no-delivery decision; \`escalated\` means failed delivery needing attention. Never push a partial portfolio. Resume reports \`next: portfolio-delivery\` while terminal children await delivery.

**6. Recursion guard.** Decompose happens at most once per portfolio, only at the top level. A child's \`childPipeline\` is decompose-free, so child runs NEVER decompose further.

**7. Portfolio run-state.** Write the authoritative parent record at \`<workDir>/portfolio-run.json\` (sticky-legacy change-dir fallback). Use \`dependsOn\`, never \`prerequisites\`. Child/delivery status is \`pending | in_progress | done | skipped | escalated\`; \`delegated\` is parent-stage-only. Canonical minimum:

\`\`\`json
{
  "parent": "<parent>",
  "children": [
    {"id": "<parent>-a", "pipeline": "small-feature", "dependsOn": [], "status": "pending"},
    {"id": "<parent>-b", "pipeline": "small-feature", "dependsOn": ["<parent>-a"], "status": "pending"}
  ],
  "delivery": {"status": "pending"}
}
\`\`\`

Preserve optional planner/mode/cohort/note metadata. Validate immediately with \`rasen pipeline resume <parent> --json\`: a present but invalid portfolio is an error; fix it, never bypass it with parent \`auto-run.json\`. Resume reports runnable, interrupted, escalated, and delivery frontiers. Artifact presence is only a cross-check. On child failure, stop its dependents, preserve independent completions, and escalate the open frontier.

### Step G.1 — Cross-child implementer reuse (warm-vs-retire)

A dependent child directly consumes its prerequisite's code, so the implementer that just wrote that code is the warmest possible worker for it — but only when it still has the headroom to take on a whole new change. Between a prerequisite child and its dependent, decide reuse-vs-retire (governed by \`reuse.implementer\`; resolve it and the reuse threshold from \`resolvePipelineReuseConfig(pipeline)\` via \`rasen pipeline show <name> --json\`, default \`auto\` / \`0.25\`). Under \`reuse.implementer: never\`, skip this entirely — always spawn a fresh implementer per child.

1. **Relatedness = DAG adjacency.** Reuse is meaningful ONLY across a direct dependency edge (the dependent consumes the prerequisite's code). Independent / parallel-cohort children share nothing to reuse — give them fresh workers.
2. **Probe point = prerequisite review-clean.** Take the reuse decision at the SAME gate that already unblocks the dependent (item 4 of Step G: a dependent MUST NOT begin until every prerequisite is implemented and review-clean), so there is no new synchronization point. Probe the prerequisite implementer's recorded transcript with \`rasen agent context --transcript <path>\` (the Step F worker pointer). Do NOT probe earlier — non-trivial fixes route back to the implementer, so context keeps growing through the review-fix loop; only the review-clean reading is stable.
3. **Decision (compare to the resolved implementer reuse threshold — \`resolvePipelineReuseConfig(pipeline).roles.implementer\`).**
   - \`pct ≤ threshold\` → **warm reuse.** Claude native uses \`SendMessage\`; Codex native uses \`followup_task\`; exec-bridge resumes the same thread. Continue the SAME implementer with the dependent child's dispatch, carrying the **contamination guard** — the prerequisite's conventions hold ONLY where the dependent child's own artifacts (proposal/design) are silent; the worker MUST read the dependent's proposal/design FIRST and treat them as authoritative.
   - \`pct > threshold\` → **retire-between-children.** The worker's final task is to write a handoff document with reason \`retired-between-children\`, focused on cross-change-transferable knowledge (conventions, gotchas, dead ends, working set) with an EMPTY \`remaining\` (the prerequisite is complete — nothing to finish, only knowledge to carry). Then **dual-source seed** a fresh implementer for the dependent child from that document PLUS your own child dispatch brief.
4. **Merge-node rule — unique warm predecessor required.** Reuse requires a SINGLE warm predecessor. A child that depends on more than one prerequisite (a DAG merge node) ALWAYS gets a fresh implementer, multi-source seeded from each prerequisite's durable findings — never inherit any one predecessor's worker at a merge node.
5. **Lineage.** When you reuse (or seed a fresh worker from a retired) predecessor across a child boundary, record \`reusedFrom: <prerequisite-child-id>\` on the dependent child's implementer worker record in run-state (LEAD-written, single-writer invariant — child-1's frozen field).
6. **Scope guards.** \`reuse.implementer: never\` → always fresh. The design-level **fixer is excluded from reuse** — its value is fresh eyes, so never warm-reuse a prior worker for a fixer role. Under **Tier B**, carry the reuse intent through the transcript warm-seed of Step F.1. For Codex exec-bridge only, use \`threadId\` resume (Step B.2); Codex-native agents use their native agent id and \`followup_task\`, never a fabricated thread id. When an exec-bridge thread is unresumable or context-poor, seed a fresh worker from the prior rollout via warm-seed distillation. Reuse across a user's manually-run sequence of unrelated changes is an explicit NON-goal.

### Step H — Context sensing & the handoff protocol

Agents cannot feel their own context usage; they MEASURE it. \`rasen agent context\` reads exact occupancy from a transcript's recorded API usage — \`--latest\` probes your own (the LEAD's) main session, \`--transcript <path>\` probes a worker via the pointer recorded in run-state (Step B). Probe ONLY at the discrete decision points below. NEVER inject a running token countdown into any agent's context — it breaks the prompt-cache prefix and induces premature wrap-up (context anxiety).

Resolve each dispatched worker's handoff threshold with its **actual dispatched role** and **effective runtime**, in this exact order: configured \`pipelines.<name>.handoff.<stage>\` instance > stage YAML \`handoff\` > runtime-bound threshold scheme (\`handoffRoles[<actual role>]\` before the scheme scalar) > pipeline YAML \`handoff.roles[<actual role>]\` > pipeline YAML \`handoff.threshold\` > legacy project \`handoff.roles[<actual role>]\` > project \`handoff.threshold\` > inherited-store role > inherited-store scalar > global role > global scalar > model preset (the suggested \`handoffThreshold\` of the resolved model) > built-in default \`0.5\`. Binding candidates are row-first: the worker's explicit effective-runtime row at project, store, then global scope is exhausted before the \`default\` row at project, store, then global scope. A binding to a missing or invalid scheme emits a diagnostic and falls through to the next candidate; it never blocks resolution. \`maxRelays\` and \`stallLimit\` continue to resolve from the stage/pipeline handoff blocks and built-in defaults. Consume the already-resolved threshold, source, binding, and diagnostics from \`rasen pipeline show <name> --json\` (and compare it with \`rasen agent context\` output); NEVER read scheme/config files to recreate this precedence in the LEAD. Context-heavy roles (reviewer, fixer) typically carry higher thresholds — their bootstrap (diff + specs + findings) is expensive, and retiring them too early buys relays that spend most of their window re-loading. When a role keeps hitting its threshold right after bootstrap, the durable fix is better seeding (hand the successor a distilled context pack), not a higher threshold.

**Two threshold families, two decisions.** Which threshold governs a context-occupancy decision depends on WHAT you are deciding:
- A **mid-task relay** ("should this worker keep going on the task in hand?") compares occupancy to that worker's server-resolved **handoff** threshold from the complete chain above.
- A **cross-change re-staffing** decision ("should this worker take on a whole NEW child change?" — persistent-planner reuse per Step B.1.5, cross-child implementer reuse per Step G.1.3) compares occupancy to the server-resolved **reuse** threshold. For each reuse role, \`resolvePipelineReuseConfig(pipeline).roles[<role>]\` resolves from the scheme bound to that role's actual effective runtime (\`reuseRoles[<role>]\` before the scheme scalar; explicit runtime project/store/global rows before default project/store/global rows, with missing/invalid schemes warning and falling through) > pipeline YAML \`reuse.roles[<role>]\` > pipeline YAML \`reuse.threshold\` > model preset > built-in default **0.25**. Planner and implementer therefore may resolve different bindings. The role-agnostic \`resolvePipelineReuseConfig(pipeline).threshold\` has no runtime or model: it considers only the \`default\` binding row at project/store/global (scheme scalar only) > pipeline YAML \`reuse.threshold\` > built-in default; runtime-specific rows and presets do not apply. Reuse modes remain pipeline declaration > built-in default. Consume \`resolvePipelineReuseConfig(pipeline)\` as reported by \`rasen pipeline show\`; do not duplicate either chain in orchestration logic.

These are different numbers for a reason; do NOT apply the handoff threshold to a reuse decision or vice-versa.

**Dual-form threshold comparison.** A resolved threshold is either a fraction or an absolute \`{ remainingTokens: N }\` — \`rasen pipeline show <name> --json\` reports whichever form resolved, and a probe (\`rasen agent context\`) reports both \`pct\` and \`remainingTokens\` so either form reads off one field:
- **Fraction** \`t\`: handoff fires at \`pct >= t\`; reuse permits at \`pct <= t\`.
- **Absolute** \`{ remainingTokens: N }\`: handoff fires at \`remainingTokens <= N\`; reuse permits at \`remainingTokens >= N\`.

A probe reporting \`limit: 0\` (no window known — e.g. a Codex rollout with zero completed turns) fires NEITHER form: a young rollout is by definition not near its limit, so treat the threshold as not-yet-fired and re-probe later.

**Counter table — every orchestration counter, what it counts, and its independence.** Several caps share the same default value; they are DISTINCT counters and never share a tally:

| Counter | Counts | Cap (default) | Trigger semantics | Independent of |
|---|---|---|---|---|
| **relay count** (\`handoffs[]\`) | worker HANDOFF relays within one stage | \`maxRelays\` (3) | **soft** — on the (maxRelays+1)th relay the LEAD reviews (H.5); may continue if progressing | review rounds, goal rounds |
| **review rounds** (\`loop.maxRounds\`) | review→fix→re-review cycles in a review-cycle loop | \`maxRounds\` (3) | at cap with open Blocker/Major → strategy ladder (H.5/H.6) | relays (one round MAY span several relays) |
| **strategy attempts** (\`strategyAttempts\`) | material-change retries after a cap/stall | budget (3) | exhausted → park stage \`escalated\` | relays, rounds |
| **goal-loop rounds** (goal \`maxRounds\`) | implementer-dispatch + gate iterations in a goal loop | \`maxRounds\` (5) | exhausted → tail with \`outcome: maxRounds-exhausted\` | relays (a warm-reused implementer relays WITHIN a round) |
| **goal stall** (\`loopStallLimit\`) | consecutive NON-progressing goal ROUNDS | 2 | → Step H.5 strategy review | handoff \`stallLimit\` (which counts relays) |
| **blocked streak** (\`blockedThreshold\`) | consecutive rounds the SAME implementer-reported BLOCKER recurs | 3 | → Step H.5/H.6 ladder (re-approach / rework / isolate) | \`loopStallLimit\` (score non-progress) and goal \`maxRounds\` |
| **handoff stall** (\`stallLimit\`) | consecutive NO-progress RELAYS | 2 | → Step H.5 early review | \`loopStallLimit\` (which counts rounds) |
| **session relay** (\`sessionHandoff.n\`) | LEAD session generations | \`maxRelays\` (3) | **hard** — at \`maxRelays\`, STOP auto-relay and recommend decompose (H.7) | the worker relay counter |

**Who counts.** Under the reconciler engine every LOOP counter in this table — a loop's rounds, its cap, and its stall streaks — is tallied and enforced by the canonical Run; the table tells you what each one MEANS and how to read it out of the run view, not that you should keep your own tally. The relay, strategy-attempt, and session-relay counters stay yours under BOTH engines: they count worker and session lifecycle events the Run does not model. Under the legacy engine every counter here is yours.

**\`maxRelays\` asymmetry (deliberate).** The SAME config value \`maxRelays\` is a **soft review trigger after N** for worker relays (H.5 — a stuck stage can be re-strategized and continue) but a **hard stop at N** for session relays (H.7 — a session that keeps self-relaying to generation N is the decompose signal). This is intentional, not a bug.

**H.1 Session pre-flight (auto entry).** Once, at the start of an auto run: \`rasen agent context --latest --json\`. At or above the session threshold, offer the user a three-way choice — (a) **automatic relay now**: write the session handoff document (rasen-handoff template), then launch a successor session per H.7; (b) **continue this session** — auto-compact remains the backstop; (c) **handle it manually** (rasen-handoff and a fresh session on their own terms). Proceed only on their say-so at that moment; below the threshold, proceed silently. This is an offer, not a gate — the user owns session handoff, and declining leaves behavior exactly as before. On a Codex host, use \`rasen agent context --latest --runtime codex --json\` instead — it discovers YOUR own rollout in the Codex sessions tree and reports real occupancy rather than falling straight to \`available: false\`.

**H.2 Warm-continue guard.** Before EVERY \`SendMessage\` to an existing worker (Claude-native), \`followup_task\` (Codex-native), or exec-bridge resume — collectively, every warm continuation — probe that worker's recorded transcript when one exists. Below its resolved threshold → continue warm. At or above → retire it via a route-appropriate final instruction to write \`<workDir>/handoff/<role>-<n>.md\`, then spawn a fresh successor seeded from that document (plus planning-context.md for the planner). Seed from the raw transcript only when the document cannot be produced. **Which threshold this guard compares against depends on the decision (per the two-threshold-families rule above):** a mid-task continuation uses the **handoff** threshold, but a **cross-change re-staffing** case — persistent-planner reuse (Step B.1.5) and cross-child implementer reuse (Step G.1.3) — compares against the **reuse** threshold (\`resolvePipelineReuseConfig(pipeline).roles[<role>]\`, default 0.25, stricter), NOT the handoff threshold.

**H.3 Worker self-handoff (the dispatch-prompt clause).** Workers cannot probe themselves mid-run, so every dispatch prompt carries this contract:
- **Triggers**: (a) the soft budget the LEAD stated in the prompt (e.g. "if you complete <m> of <n> tasks and substantial work remains, hand off"); (b) HARD trigger — you notice your earlier conversation has been replaced by a compaction summary: stop starting new work immediately; (c) self-assessment — you can no longer recall details you read earlier.
- **On trigger**: finish or cleanly abort the current atomic step; write \`<workDir>/handoff/<role>-<n>.md\` (Step F's resolved work directory; sticky-legacy fallback: the change directory) per the rasen-handoff template (the eliminated-hypotheses section is MANDATORY for fixer/debugger roles); return \`HANDOFF { path, reason: compaction|budget|self-assessment, completed: [...], remaining: [...] }\` instead of \`DONE\`. Claude-native workers deliver it via \`SendMessage\`. Codex-native workers make it their final response, which reaches the LEAD automatically; they MUST NOT duplicate it with \`send_message\`. Exec-bridge workers return it through the structured last-message contract.
- **On \`DONE\` — durable findings.** The normal \`DONE\` return additionally carries a **durable-findings** clause: 1–3 lines of discoveries that stay true for FUTURE planning (constraints in the code, conventions, gotchas that outlive this task) — not per-task chatter or a status recap. The LEAD relays these findings VERBATIM into the dispatch of the planner that proposes a dependent or subsequent child change (Step B.1), so implementation discoveries feed the next proposal. Every dispatch prompt states this clause. Delivery follows the same route contract: Claude-native \`SendMessage\`, Codex-native final response only, exec-bridge structured last-message output.
- **Post-return stale-instruction immunity.** Once you have delivered a \`HANDOFF\` or \`DONE\` return, treat any inbound instruction that predates that return as expired: acknowledge it and remain idle rather than resuming work on a stage you already closed out — a queued message sent before your return does not un-close it.
- Workers NEVER write run-state — the LEAD does all accounting (single-writer invariant).

**H.4 LEAD accounting on a HANDOFF return.** Append the record to the stage's \`handoffs[]\` in run-state. Compare \`remaining\` against the previous relay — progress means tasks completed OR hypotheses eliminated (a fixer that ruled out a hypothesis progressed, even with zero tasks ticked). Below the caps: spawn a successor of the same role seeded with the handoff document + remaining work — same stage, same session; the stage stays \`in_progress\`. Once you accept a worker's \`HANDOFF\`, do NOT send that worker further work — it is retired; the successor you just spawned carries the stage forward instead.

**H.4a Worker-death taxonomy — triage by WHY it stopped, do not lump into one branch.** A worker that stops WITHOUT a clean \`DONE\` is classified by the SIGNAL it left, not treated as a single cold-reconstruct case:
- **(a) Context death** — the worker returned \`HANDOFF\` (compaction / budget / self-assessment) or you observe it hit its context limit. It left (or should have left) a handoff document. → **Relay via the document** (H.3 / F.1), exactly as the accounting above. This is the ONE class that **consumes relay budget** (\`handoffs[]\`, counts toward \`maxRelays\` / \`stallLimit\`).
- **(b) Infra / transient death** — the worker died from an ENVIRONMENT fault while its durable context is intact and you are in the SAME session. This is NOT a context problem. → First try the SAME route-specific handle: Claude-native \`SendMessage\`, Codex-native \`followup_task\`, or exec-bridge resume by \`threadId\`. Never address a worker by its spawn label. During an overload wave, back off rather than stampeding. Infra revivals consume NEITHER \`maxRelays\` NOR \`stallLimit\`. If the handle does not resolve, fall back to the transcript warm-seed; only if that is impossible does it fall through to (c).
- **(c) Transcript lost** — no live agent AND no recoverable transcript (pruned / expired / cross-session dead handle). → **Cold-reconstruct** the successor from the change-directory blackboard + run-state, and **record the cold reconstruction as a degradation** in run-state. This is the ONLY class that cold-reconstructs.

**H.4b \`DONE\` with unticked tasks is NOT a death.** A \`DONE\` return that left some tasks unticked is an ambiguous completion by a worker that is ALIVE and in-session — not any of the three deaths above. Continue the SAME worker through its route-specific continuation primitive (\`SendMessage\`, \`followup_task\`, or exec-bridge resume); do not rely on a spawn label. Its reasoning is preserved and **no relay is charged**. If its durable handle does not resolve, fall back to the transcript warm-seed of Step F.1.

**H.5 Relay caps → LEAD review (not a human gate).** Defaults: \`maxRelays: 3\`, \`stallLimit: 2\`. On the (maxRelays+1)th handoff request for one stage, or on \`stallLimit\` consecutive NO-progress relays (this fires early — do not wait for the count cap), STOP relaying and review the history yourself: relays that are progressing may continue past the cap after review; stalled ones need a MATERIAL change. Options, cheapest first: (1) change the approach — re-prompt the successor with a different strategy, or fix the seeding so it stops burning its window on bootstrap; (2) design-level rework — send the problem back to the planner (revise design/tasks, then re-apply the affected part); (3) isolate — split the stubborn remainder into its own task or child change so the main line can move. Record every attempt in the stage's \`strategyAttempts\` with rationale; a retry that changes nothing material is not an attempt, it is thrash. **Counter scoping:** here \`maxRelays\` is a **soft** review trigger — a progressing stage may continue past it — whereas for session relays (H.7) the same \`maxRelays\` is a **hard** stop (the asymmetry noted in the Step H counter table). And for a **goal loop** the relevant stall counter is \`loopStallLimit\` over ROUNDS (Step L), NOT \`stallLimit\` over relays — they are independent counters.

**H.6 Strategy budget & non-blocking escalation (shared with Step E's loop termination).** Default budget: 3 strategy attempts per stage. When it is exhausted (or Step E's round cap is hit and the ladder is exhausted): mark the stage \`escalated\` in run-state with the full relay/strategy/finding history, PARK it, and CONTINUE unblocked work — other portfolio children always; later stages of the same change only when the parked problem does not block them (open Blocker/Major findings block \`ship\`, per the guardrails). Surface every parked item at the next natural pause — a gate, or the run-end report — as a decision for the human. Never hard-stop the whole run mid-flight for one stuck stage; never report clean while a Blocker/Major is open; never silently pass.

**H.7 Session relay (relaying yourself).** The LEAD can launch its own successor — a verified platform capability (2026-07-07, claude CLI 2.1.202: a session can spawn a new interactive Claude Code window seeded with an initial prompt; the earlier "platform cannot restart the main session" assumption is retired). The mechanics (bootstrap prompt via file indirection or \`-EncodedCommand\` — bare-quoted prompts get truncated by nested shell parsing; platform spawn commands; manual fallback) live in the rasen-handoff skill's "Session relay" section. The orchestration-level invariants:
- **Quiesce first.** Relay ONLY at a stage boundary: every dispatched worker has returned \`DONE\`/\`HANDOFF\` and run-state is persisted. A probe that fires mid-stage waits for the worker's structured return (H.3 covers the worker's own exhaustion) before the handoff-plus-relay sequence. Additionally, before the relay any **held warm reuse candidate** — a worker that returned \`DONE\` but was RETAINED for a dependent child rather than dismissed (Step G.1) — MUST first write its knowledge digest document — which IS a handoff document: the same rasen-handoff template, written to \`<workDir>/handoff/<role>-<n>.md\` (sticky-legacy fallback: the change directory) with reason \`retired-between-children\`, so the successor's document-first resume ladder (F.1) finds it — because its cross-change knowledge would otherwise be lost with its session-scoped agent handle.
- **Spawn after persistence, then stand down.** The handoff document and the \`sessionHandoff\` record (with generation \`n\`) hit disk BEFORE the spawn; after the spawn, end the turn and tell the user the predecessor window can be closed — never keep orchestrating from the predecessor.
- **Generation cap.** \`sessionHandoff.n\` at \`maxRelays\` (resolved config, default 3) stops auto-relay: present the relay history and recommend decomposing the change (Step G) — repeated session relays are the decompose signal, same as worker relays (H.5).
- **No cross-session worker resurrection.** The successor never addresses the predecessor's workers (dead agentIds); it re-creates what it needs via the Step F.1 ladder — handoff document first, recorded transcript second, change-directory cold reconstruction last.
- **Codex exec-bridge workers are unaffected by a Claude LEAD session relay.** Their recorded \`threadId\`s are durable and may be resumed per Step B.2. Codex-native agent ids are host-session handles, not exec thread ids; after a session boundary, follow the document/transcript reconstruction ladder and never fabricate a \`threadId\`. (A future Codex-LEAD self-relay design remains outside this playbook.)`;

export interface OrchestrationFeatureSet {
  readonly persistentPlanner: boolean;
  readonly stageMetadata: boolean;
  readonly reviewLoop: boolean;
  readonly goalLoop: boolean;
  readonly portfolio: boolean;
}

type OrchestrationModuleId =
  | 'header'
  | 'A'
  | 'A.1'
  | 'B'
  | 'B.1'
  | 'B.2'
  | 'B.3'
  | 'B.4'
  | 'C'
  | 'D'
  | 'E'
  | 'L'
  | 'F'
  | 'F.1'
  | 'G'
  | 'G.1'
  | 'H';

const ORCHESTRATION_MODULE_ORDER: readonly OrchestrationModuleId[] = [
  'header',
  'A',
  'A.1',
  'B',
  'B.1',
  'B.2',
  'B.3',
  'B.4',
  'C',
  'D',
  'E',
  'L',
  'F',
  'F.1',
  'G',
  'G.1',
  'H',
];

const STEP_HEADING_PATTERN =
  /^### Step (A\.1|B\.1|B\.2|B\.3|B\.4|F\.1|G\.1|[A-HL])\b.*$/gm;

function splitCanonicalModules(
  source: string
): Readonly<Record<OrchestrationModuleId, string>> {
  const headings = [...source.matchAll(STEP_HEADING_PATTERN)];
  const firstHeading = headings[0];
  if (!firstHeading || firstHeading.index === undefined) {
    throw new Error('Orchestration playbook is missing its first step heading');
  }

  const modules = new Map<OrchestrationModuleId, string>();
  modules.set('header', source.slice(0, firstHeading.index));

  for (const [index, heading] of headings.entries()) {
    const moduleId = heading[1] as OrchestrationModuleId;
    const start = heading.index;
    const end = headings[index + 1]?.index ?? source.length;
    if (start === undefined) {
      throw new Error(`Orchestration module ${moduleId} has no source offset`);
    }
    modules.set(moduleId, source.slice(start, end));
  }

  for (const moduleId of ORCHESTRATION_MODULE_ORDER) {
    if (!modules.has(moduleId)) {
      throw new Error(`Orchestration playbook is missing module ${moduleId}`);
    }
  }

  return Object.fromEntries(modules) as Record<OrchestrationModuleId, string>;
}

const ORCHESTRATION_MODULES = splitCanonicalModules(ORCHESTRATION_PLAYBOOK);

function replaceExactlyOnce(
  source: string,
  search: string | RegExp,
  replacement: string,
  label: string
): string {
  let count = 0;

  if (typeof search === 'string') {
    if (search.length === 0) {
      throw new Error(`Orchestration replacement "${label}" has an empty search`);
    }

    let offset = 0;
    while (true) {
      const index = source.indexOf(search, offset);
      if (index === -1) {
        break;
      }
      count += 1;
      offset = index + search.length;
    }
  } else {
    const flags = search.flags.includes('g')
      ? search.flags
      : `${search.flags}g`;
    count = [...source.matchAll(new RegExp(search.source, flags))].length;
  }

  if (count !== 1) {
    throw new Error(
      `Orchestration replacement "${label}" expected exactly one match, found ${count}`
    );
  }

  return source.replace(search, replacement);
}

function includesModule(
  moduleId: OrchestrationModuleId,
  features: OrchestrationFeatureSet
): boolean {
  switch (moduleId) {
    case 'B.1':
      return features.persistentPlanner;
    case 'D':
      return features.stageMetadata;
    case 'E':
      return features.reviewLoop;
    case 'L':
      return features.goalLoop;
    case 'G':
    case 'G.1':
      return features.portfolio;
    default:
      return true;
  }
}

function renderHeader(
  source: string,
  features: OrchestrationFeatureSet
): string {
  if (features.reviewLoop) {
    return source;
  }

  return replaceExactlyOnce(
    source,
    /\*\*Exception:\*\*[\s\S]*?never by you\. /,
    '',
    'header review-loop exception'
  );
}

function renderDispatchCore(
  source: string,
  features: OrchestrationFeatureSet
): string {
  if (features.goalLoop) {
    return source;
  }

  return replaceExactlyOnce(
    source,
    ' (or the evaluate-gate schema, for a goal-loop evaluate dispatch)',
    '',
    'dispatch evaluate-gate schema'
  );
}

function renderCodexLifecycle(
  source: string,
  features: OrchestrationFeatureSet
): string {
  if (features.goalLoop) {
    return source;
  }

  return replaceExactlyOnce(
    source,
    ' (e.g. a completion-shaped "finish the remaining tasks" nudge still needs the leaf-return/evaluate-gate contract; omit it only for a genuinely free-form conversational nudge)',
    ' (a completion-shaped "finish the remaining tasks" nudge still needs the leaf-return contract; omit it only for a genuinely free-form conversational nudge)',
    'Codex resume evaluate-gate contract'
  );
}

function renderStageMetadata(
  source: string,
  features: OrchestrationFeatureSet
): string {
  if (features.reviewLoop) {
    return source;
  }

  return replaceExactlyOnce(
    source,
    /^- \*\*loop:\*\*.*$/m,
    '- **loop:** Run a goal-loop stage as bounded iteration toward its configured gate condition (Step L).',
    'stage metadata goal-only loop'
  );
}

function renderReviewLoop(
  source: string,
  features: OrchestrationFeatureSet
): string {
  if (features.goalLoop) {
    return source;
  }

  let rendered = replaceExactlyOnce(
    source,
    /^- \*\*`loop\.kind === 'goal'`\*\*.*\r?\n/m,
    '',
    'review loop goal-kind branch'
  );
  rendered = replaceExactlyOnce(
    rendered,
    'This is the ONLY loop kind that existed before goal-loop; the steps are unchanged.',
    'The steps are unchanged.',
    'review-loop historical goal reference'
  );
  return rendered;
}

function renderGoalLoop(
  source: string,
  features: OrchestrationFeatureSet
): string {
  let rendered = source;

  // The thin Step L (ECP-3) no longer contains these review-cycle comparison
  // phrases or decomposition references. These replacements are only relevant
  // for the legacy full-length Step L text; skip them gracefully when the
  // target string is absent.
  if (!features.portfolio && rendered.includes('decompose the obstruction')) {
    rendered = replaceExactlyOnce(
      rendered,
      'new approach, different tool, decompose the obstruction',
      'new approach, different tool, isolate the obstruction',
      'goal-loop decomposition strategy'
    );
  }

  if (!features.reviewLoop && rendered.includes('isomorphic to review-cycle')) {
    rendered = replaceExactlyOnce(
      rendered,
      ' — not a review-clean diff. It is isomorphic to review-cycle\'s single-dispatch-per-round shape:',
      ', using a single-dispatch-per-round shape:',
      'goal-loop review-cycle comparison'
    );
    rendered = replaceExactlyOnce(
      rendered,
      ' (the SAME worker, like review-cycle reuses the fixer thread; rounds do NOT each cost a fresh relay)',
      ' (the SAME worker; rounds do NOT each cost a fresh relay)',
      'goal-loop review-cycle reuse comparison'
    );
  }

  return rendered;
}

function renderRunState(
  source: string,
  features: OrchestrationFeatureSet
): string {
  let rendered = source;

  if (!features.portfolio) {
    rendered = replaceExactlyOnce(
      rendered,
      ' / portfolio-run.json',
      '',
      'run-state portfolio artifact'
    );
  }

  if (!features.goalLoop) {
    rendered = replaceExactlyOnce(
      rendered,
      ' / the goal-loop run artifact',
      '',
      'run-state goal-loop artifact'
    );
  }

  if (!features.reviewLoop) {
    rendered = replaceExactlyOnce(
      rendered,
      "Also record review `rounds`, `openFindings` (legacy-engine: authoritative; reconciler-engine: a labeled projection of the run view's `review-cycle` section, never the thing you branch on), any skips/escalations,",
      'Also record any skips/escalations,',
      'run-state review fields'
    );
  }

  if (!features.stageMetadata) {
    rendered = replaceExactlyOnce(
      rendered,
      / \*\*autopilot-gate-policy:\*\*.*?leaves `gateDecision` unset\./,
      '',
      'run-state gate policy'
    );
  }

  return rendered;
}

function renderKeepalive(
  source: string,
  features: OrchestrationFeatureSet
): string {
  let rendered = source;

  if (!features.reviewLoop) {
    rendered = replaceExactlyOnce(
      rendered,
      /^- \*\*LOOP_BOUND\*\*.*\r?\n/m,
      '',
      'keepalive review-loop horizon'
    );
  }

  if (!features.persistentPlanner && !features.portfolio) {
    rendered = replaceExactlyOnce(
      rendered,
      /^- \*\*MILESTONE_BOUND\*\*.*\r?\n/m,
      '',
      'keepalive planner horizon'
    );
  }

  if (!features.portfolio) {
    rendered = replaceExactlyOnce(
      rendered,
      'a full child pipeline',
      'a long intervening stage',
      'keepalive child-pipeline gap'
    );
  }

  return rendered;
}

function renderResume(
  source: string,
  features: OrchestrationFeatureSet
): string {
  let rendered = source;

  if (!features.portfolio) {
    rendered = replaceExactlyOnce(
      rendered,
      / For a decomposed parent it returns the per-child `runnableChildren` \(start fresh\), `interruptedChildren` \(warm-seed-resume\), `escalatedChildren` \(human attention\), and `completedChildren`\./,
      '',
      'resume decomposed-parent child fields'
    );
  }

  if (!features.reviewLoop) {
    rendered = replaceExactlyOnce(
      rendered,
      ', and `openFindings` (unresolved Blocker/Major — never ship past them)',
      '',
      'resume review findings'
    );
    rendered = replaceExactlyOnce(
      rendered,
      '(e.g. re-review a fix, or continue an interrupted stage)',
      '(e.g. continue an interrupted stage)',
      'resume review example'
    );
    rendered = replaceExactlyOnce(
      rendered,
      'functionally a resumed reviewer',
      'functionally a resumed worker',
      'resume reviewer role'
    );
  }

  return rendered;
}

function renderHandoff(
  source: string,
  features: OrchestrationFeatureSet
): string {
  if (
    features.persistentPlanner &&
    features.stageMetadata &&
    features.reviewLoop &&
    features.goalLoop &&
    features.portfolio
  ) {
    return source;
  }

  let rendered = replaceExactlyOnce(
    source,
    /\*\*Two threshold families, two decisions\.\*\*[\s\S]*?These are different numbers for a reason; do NOT apply the handoff threshold to a reuse decision or vice-versa\.\r?\n\r?\n/,
    '**Context threshold.** A mid-task relay compares occupancy to the server-resolved **handoff** threshold for the worker\'s actual dispatched role and effective runtime: configured `pipelines.<name>.handoff.<stage>` instance > stage YAML `handoff` > runtime-bound scheme (`handoffRoles[<actual role>]` before scheme scalar; explicit runtime project/store/global rows before default project/store/global rows) > pipeline YAML role/scalar > legacy project role/scalar > inherited-store role/scalar > global role/scalar > model preset > built-in default **0.5**. Missing or invalid schemes warn and fall through. Consume the resolver output from `rasen pipeline show`; do not recreate this chain from files.\n\n',
    'handoff reuse-threshold family'
  );

  if (!features.reviewLoop) {
    rendered = replaceExactlyOnce(
      rendered,
      /^\| \*\*review rounds\*\*.*\r?\n/m,
      '',
      'handoff review counter row'
    );
  }

  if (!features.goalLoop) {
    rendered = replaceExactlyOnce(
      rendered,
      /^\| \*\*goal-loop rounds\*\*.*\r?\n/m,
      '',
      'handoff goal-round counter row'
    );
    rendered = replaceExactlyOnce(
      rendered,
      /^\| \*\*goal stall\*\*.*\r?\n/m,
      '',
      'handoff goal-stall counter row'
    );
    rendered = replaceExactlyOnce(
      rendered,
      /^\| \*\*blocked streak\*\*.*\r?\n/m,
      '',
      'handoff blocked-streak counter row'
    );
  }

  const roundCounters = [
    features.reviewLoop ? 'review rounds' : '',
    features.goalLoop ? 'goal rounds' : '',
  ].filter(Boolean).join(', ');
  rendered = replaceExactlyOnce(
    rendered,
    '| review rounds, goal rounds |',
    `| ${roundCounters} |`,
    'handoff relay-counter independence'
  );

  if (!features.goalLoop) {
    rendered = replaceExactlyOnce(
      rendered,
      '| `loopStallLimit` (which counts rounds) |',
      '| review rounds |',
      'handoff stall-counter independence'
    );
  }

  const continuationExamples = features.reviewLoop
    ? 'delta re-review or any warm continuation'
    : 'any warm continuation';
  rendered = replaceExactlyOnce(
    rendered,
    /\*\*H\.2 Warm-continue guard\.\*\*[\s\S]*?\r?\n\r?\n\*\*H\.3 Worker self-handoff/,
    `**H.2 Warm-continue guard.** Before ${continuationExamples} of an existing worker (Claude-native \`SendMessage\`, Codex-native \`followup_task\`, or exec-bridge resume), probe that worker's recorded transcript when one exists. Below its resolved handoff threshold → continue warm. At or above → retire it via a route-appropriate final instruction to write \`<workDir>/handoff/<role>-<n>.md\`, then spawn a fresh successor seeded from that document. Seed from the raw transcript only when the document cannot be produced.\n\n**H.3 Worker self-handoff`,
    'handoff warm-continue guard'
  );

  if (!features.persistentPlanner) {
    rendered = replaceExactlyOnce(
      rendered,
      /The LEAD relays these findings VERBATIM into the dispatch of the planner that proposes a dependent or subsequent child change \(Step B\.1\), so implementation discoveries feed the next proposal\./,
      'The LEAD carries these findings forward so later work benefits from durable implementation discoveries.',
      'handoff persistent-planner findings'
    );
  }

  if (!features.goalLoop) {
    rendered = replaceExactlyOnce(
      rendered,
      / And for a \*\*goal loop\*\* the relevant stall counter is `loopStallLimit` over ROUNDS \(Step L\), NOT `stallLimit` over relays — they are independent counters\./,
      '',
      'handoff goal-loop stall clause'
    );
  }

  if (!features.reviewLoop) {
    rendered = replaceExactlyOnce(
      rendered,
      '**H.6 Strategy budget & non-blocking escalation (shared with Step E\'s loop termination).**',
      '**H.6 Strategy budget & non-blocking escalation.**',
      'handoff review-loop escalation heading'
    );
    rendered = replaceExactlyOnce(
      rendered,
      'When it is exhausted (or Step E\'s round cap is hit and the ladder is exhausted):',
      'When it is exhausted:',
      'handoff review-loop round cap'
    );
    rendered = replaceExactlyOnce(
      rendered,
      ' (open Blocker/Major findings block `ship`, per the guardrails)',
      '',
      'handoff review-loop ship guard'
    );
    rendered = replaceExactlyOnce(
      rendered,
      '; never report clean while a Blocker/Major is open',
      '',
      'handoff review-loop clean report'
    );
  }

  if (!features.portfolio) {
    rendered = replaceExactlyOnce(
      rendered,
      /mark the stage `escalated` in run-state with the full relay\/strategy\/finding history, PARK it, and CONTINUE unblocked work — other portfolio children always; later stages of the same change only when the parked problem does not block them/,
      'mark the stage `escalated` in run-state with the full relay/strategy/finding history, PARK it, and CONTINUE later stages only when the parked problem does not block them',
      'handoff portfolio escalation'
    );
    rendered = replaceExactlyOnce(
      rendered,
      '(3) isolate — split the stubborn remainder into its own task or child change so the main line can move.',
      '(3) isolate — split the stubborn remainder into its own independent task so the main line can move.',
      'handoff child-change strategy'
    );
    rendered = replaceExactlyOnce(
      rendered,
      /^- \*\*Quiesce first\.\*\*.*$/m,
      '- **Quiesce first.** Relay ONLY at a stage boundary: every dispatched worker has returned `DONE`/`HANDOFF` and run-state is persisted. A probe that fires mid-stage waits for the worker\'s structured return (H.3 covers the worker\'s own exhaustion) before the handoff-plus-relay sequence.',
      'handoff portfolio quiescence'
    );
    rendered = replaceExactlyOnce(
      rendered,
      'present the relay history and recommend decomposing the change (Step G) — repeated session relays are the decompose signal',
      'present the relay history and stop — repeated session relays are the signal to narrow the work before another run',
      'handoff decomposition recommendation'
    );
    rendered = replaceExactlyOnce(
      rendered,
      'STOP auto-relay and recommend decompose (H.7)',
      'STOP auto-relay and surface the relay history (H.7)',
      'handoff session-counter decomposition'
    );
    rendered = replaceExactlyOnce(
      rendered,
      'a session that keeps self-relaying to generation N is the decompose signal',
      'a session that keeps self-relaying to generation N is the signal to narrow scope',
      'handoff relay-asymmetry decomposition'
    );
  }

  return rendered;
}

function renderModule(
  moduleId: OrchestrationModuleId,
  source: string,
  features: OrchestrationFeatureSet
): string {
  switch (moduleId) {
    case 'header':
      return renderHeader(source, features);
    case 'B':
      return renderDispatchCore(source, features);
    case 'B.2':
      return renderCodexLifecycle(source, features);
    case 'D':
      return renderStageMetadata(source, features);
    case 'E':
      return renderReviewLoop(source, features);
    case 'L':
      return renderGoalLoop(source, features);
    case 'B.4':
      return renderKeepalive(source, features);
    case 'F':
      return renderRunState(source, features);
    case 'F.1':
      return renderResume(source, features);
    case 'H':
      return renderHandoff(source, features);
    default:
      return source;
  }
}

function assertReferenceClosure(
  playbook: string,
  features: OrchestrationFeatureSet
): void {
  const omittedReferences: Array<[boolean, RegExp, string]> = [
    [features.persistentPlanner, /Step B\.1\b/, 'B.1'],
    [features.stageMetadata, /Step D\b/, 'D'],
    [features.reviewLoop, /Step E(?:\b|\.)/, 'E'],
    [features.goalLoop, /Step L\b/, 'L'],
    [features.portfolio, /Step G(?:\b|\.)/, 'G'],
  ];

  for (const [included, pattern, step] of omittedReferences) {
    if (!included && pattern.test(playbook)) {
      throw new Error(
        `Orchestration bundle references omitted Step ${step}`
      );
    }
  }
}

export function composeOrchestrationPlaybook(
  features: OrchestrationFeatureSet
): string {
  if (
    features.persistentPlanner &&
    features.stageMetadata &&
    features.reviewLoop &&
    features.goalLoop &&
    features.portfolio
  ) {
    return ORCHESTRATION_PLAYBOOK;
  }

  const playbook = ORCHESTRATION_MODULE_ORDER
    .filter(moduleId => includesModule(moduleId, features))
    .map(moduleId =>
      renderModule(moduleId, ORCHESTRATION_MODULES[moduleId], features)
    )
    .join('');

  assertReferenceClosure(playbook, features);
  return playbook;
}

const AUTO_FEATURES: OrchestrationFeatureSet = {
  persistentPlanner: true,
  stageMetadata: true,
  reviewLoop: true,
  goalLoop: true,
  portfolio: true,
};

const GOAL_FEATURES: OrchestrationFeatureSet = {
  persistentPlanner: false,
  stageMetadata: true,
  reviewLoop: false,
  goalLoop: true,
  portfolio: false,
};

const REVIEW_CYCLE_FEATURES: OrchestrationFeatureSet = {
  persistentPlanner: false,
  stageMetadata: false,
  reviewLoop: true,
  goalLoop: false,
  portfolio: false,
};

export const AUTO_ORCHESTRATION_PLAYBOOK =
  composeOrchestrationPlaybook(AUTO_FEATURES);
export const GOAL_ORCHESTRATION_PLAYBOOK =
  composeOrchestrationPlaybook(GOAL_FEATURES);
export const REVIEW_CYCLE_ORCHESTRATION_PLAYBOOK =
  composeOrchestrationPlaybook(REVIEW_CYCLE_FEATURES);
