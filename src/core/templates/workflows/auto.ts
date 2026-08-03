/**
 * Auto Rasen Workflow Command
 *
 * Autopilot mode — the LEAD classifies the task, selects a pipeline, and drives
 * it end-to-end by orchestrating role-isolated subagents (see the shared
 * orchestration playbook). Pipelines are sourced from the data-driven pipeline
 * registry via the `rasen pipeline` CLI (classify / show / resume); the DAG
 * is not hard-coded here, and the orchestration playbook is registry-agnostic.
 */
import type { SkillTemplate } from '../types.js';
import { STORE_SELECTION_GUIDANCE } from './store-selection.js';
import { AUTO_ORCHESTRATION_PLAYBOOK } from './_orchestration.js';

const AUTO_INSTRUCTIONS = `Autopilot — drive the full Rasen workflow end-to-end.

${STORE_SELECTION_GUIDANCE}

You are the **LEAD**. You select a pipeline (default \`small-feature\`) and drive it by orchestrating role-isolated subagents (you do not do the stage work yourself). You pause at gates and the user can switch to manual at any time.

## When to Use

Use when: "auto", "autopilot", "end to end", "do it all", "one shot".

## 0. Pre-flight context probe (once, non-blocking)

Before anything else run \`rasen agent context --latest --json\` — it measures YOUR (the LEAD session's) context occupancy from the transcript's recorded API usage. At or above the session handoff threshold (default 0.5; see the playbook's Step H), offer the user a three-way choice: (a) automatic relay now — write the session handoff document and launch a successor session per the playbook's Step H.7; (b) continue this session (auto-compact remains the backstop); (c) handle it manually via rasen-handoff. Proceed on the user's say-so; below the threshold, proceed silently. Declining leaves behavior exactly as before. Never re-probe on a running loop and never inject a token countdown into the conversation; this is a single entry check, not a meter.

This probe is non-blocking for EVERY host, including a non-Claude LEAD (e.g. a Codex CLI session) that has no Claude transcript for the probe to read. On such a host the command exits \`0\` and prints \`{"available": false, "reason": "no-transcript", "detail": "..."}\` instead of erroring — treat that shape as "no occupancy signal available", record it if you are tracking your own state (e.g. \`unavailable-<runtime>\`), and proceed exactly as if the threshold had not been reached. Do not treat \`available: false\` as a failure to swallow or retry.

On a Codex host, run \`rasen agent context --latest --runtime codex --json\` instead — it discovers YOUR own rollout in the Codex sessions tree and reports real occupancy rather than falling straight to \`available: false\`.

## 0.5. Resolve and record the gate policy (once, before dispatching any stage)

Resolve the effective **gate policy mask base** with precedence **run flag > project config > store config > global config > built-in default**: (1) \`--no-gate\` present on the invocation -> \`off\`, source \`flag\`; else (2) \`autopilot.gates: on|off\` in \`rasen/config.yaml\` (read via the project config the same way other config keys resolve) -> that value, source \`project\`; else (3) \`autopilot.gates: on|off\` in the inherited store's config (when \`rasen/config.yaml\` declares \`store:\` beside local planning) -> that value, source \`store\`; else (4) \`autopilot.gates: on|off\` in the global (machine-wide) config -> that value, source \`global\`; else (5) \`on\`, source \`default\`. Display the resolved base at run start (e.g. \`Gate policy: off (flag)\`) so it is visible, never silent. Record it ONCE as \`gatePolicy: { effective, source }\` in run-state (Step F) at run start — **resume reads it back from run-state so the user does NOT re-pass \`--no-gate\`** on a resumed run.

\`autopilot.gates\` is a **mask base**, not the final word on any single gate. Each stage's effective gate resolves as \`pipelines.<name>.gates.<stage>\` (a per-stage config instance, project > store > global) **over** this base (an effective \`off\` suppresses the gate) **over** the stage definition's own \`gate:\`. Do NOT combine the base with stage definitions yourself: read each stage's already-masked **effective gate** from \`rasen pipeline show <name> --json\` (each stage's \`effectiveGate\`, with the deciding layer in \`gateSource\`) and gate Step D on that resolved value — so a per-stage \`on\` pierces an \`off\` base and a per-stage \`off\` silences one stage under an \`on\` base, exactly as configured. This governs EVERY gate — no gate type is exempt from the mask; the goal-loop \`define-goal\` stage pauses by default (\`gate: true\`) and is configurable per stage exactly like any other.

## 0.6. Resolve the selection policy (once, before selecting a pipeline)

Resolve the effective **selection policy** with precedence **run flags (\`--auto-compose\` > \`--auto-select\`) > project config > store config > global config > built-in default**: (1) \`--auto-compose\` present on the invocation -> \`compose\`, source \`flag\` (compose is the superset policy — it wins over \`--auto-select\` when both are present, since composing always classifies first); else (2) \`--auto-select\` present -> \`classify\`, source \`flag\`; else (3) \`autopilot.selection: classify|manual|compose\` in \`rasen/config.yaml\` -> that value, source \`project\`; else (4) \`autopilot.selection: classify|manual|compose\` in the inherited store's config (when \`rasen/config.yaml\` declares \`store:\` beside local planning) -> that value, source \`store\`; else (5) \`autopilot.selection: classify|manual|compose\` in the global (machine-wide) config -> that value, source \`global\`; else (6) \`manual\`, source \`default\`. Display the resolved policy at run start alongside the gate policy line (e.g. \`Selection policy: compose (flag)\`) so an opted-in run is never silent about how it will pick a pipeline. This governs ONLY the no-explicit-selector branch of pipeline selection (section 1 below) — an explicit selector always wins regardless of policy, and absent every flag and both config layers, selection behavior is exactly 0.1.x (\`manual\`, default \`small-feature\`, no auto-escalation).

## 0.7. Resolve the engine (once, before launching anything)

Resolve the effective **Run engine** with precedence **\`--engine\` flag > project \`runs.engine\` > store \`runs.engine\` > global \`runs.engine\` > built-in default \`auto\`. Do NOT re-derive this chain by reading config files: \`rasen pipeline show <name> --json\` reports it already resolved as \`enginePolicy: { configured, source, effectiveEngine }\`, beside the \`availableEngines\`/\`reconcilerSupport\` capability discovery for that pipeline. Read it from there, exactly as you read \`effectiveGate\` rather than re-masking gates yourself.

Resolution outcomes:
- **\`auto\` (default)** -> the **reconciler** engine when \`reconcilerSupport.supported\` (equivalently, \`availableEngines\` contains \`reconciler\`); otherwise the **legacy** engine, and you display the support reason so the fallback is never silent.
- **\`reconciler\`** -> forced. If the pipeline is unsupported, \`rasen pipeline start\` fails with the support reason and NO Run is created under either engine. Do not silently substitute legacy — the user asked for the engine by name.
- **\`legacy\`** -> the reconciler off-switch. \`rasen pipeline start\` refuses with \`engine_disabled_by_config\` naming the deciding layer; run the legacy playbook path instead.

**Task-loop exception:** \`task-loop\` requires the reconciler. If its resolved engine is legacy, or \`reconcilerSupport.supported\` is false, stop before dispatching work with \`task_loop_reconciler_required\`. Never use the generic legacy fallback for this pipeline.

**Gauntlet-loop exception:** \`gauntlet-loop\` requires the reconciler. If its resolved engine is legacy, or \`reconcilerSupport.supported\` is false, stop before dispatching work with \`gauntlet_reconciler_required\`. Never use the generic legacy fallback for this pipeline.

Display it at run start beside the gate and selection policy lines (e.g. \`Engine: reconciler (auto)\`), and record it ONCE in run-state as \`engine: { effective, source }\` (playbook Step F) — resume reads it back to know which contract it is resuming under.

**This is the branch that decides how section 3 executes.** For a **reconciler-engine** run, launch ONE canonical Run for the whole pipeline with \`rasen pipeline start <change> <name> --json\` and drive every stage through it per the playbook (Step E.1 for review-cycle loops, Step L for goal loops): the Run owns stage sequencing, loop rounds and caps, actor separation, and terminal outcomes, and you own selection, launch, per-action worker dispatch, and result submission. For a **legacy-engine** run, execute the playbook's legacy path exactly as before. A change already owned by one engine is always continued under THAT engine (see Resume) — engine selection applies to a NEW Run only, and never re-homes one in flight.

## 1. Select the pipeline (explicit wins; policy governs the rest)

**Input**: \`rasen-auto [--pipeline <name>] [--auto-select] [--auto-compose] [--review-plan] [--no-gate] [--planner claude|codex] [--implementer claude|codex] [--reviewer claude|codex] [--fixer claude|codex] [--shipper claude|codex] <task description>\`. Task Loop has exactly two explicit entry forms: \`rasen-auto task-loop <task>\` and \`rasen-auto --pipeline task-loop <task>\`. Gauntlet Loop has exactly two explicit entry forms: \`rasen-auto gauntlet-loop <goal>\` and \`rasen-auto --pipeline gauntlet-loop <goal>\`.

\`--no-gate\` makes gate stages (\`gate: true\`) auto-approve instead of pausing, for unattended runs — see **step 0.5** below for resolution and recording. \`--auto-select\` opts this run into adopting the classification suggestion, and \`--auto-compose\` opts into the superset compose policy — see **step 0.6** above and the policy branch below.

Choose the pipeline in this order:
1. **Explicit always wins** — if the invocation has \`--pipeline <name>\`, OR its first token is a known pipeline name from \`rasen pipeline list --json\` (e.g. \`rasen-auto full-feature 重构鉴权子系统\`), use THAT pipeline. Strip the selector token; the rest is the task description. Classification is NOT consulted and the selection policy (including \`--auto-select\` and \`--auto-compose\`) has no effect — explicit selection sits ABOVE the policy, not inside it.
2. **No explicit selector — follow the resolved selection policy (step 0.6):**
   - **Task-loop is excluded here** — classifier, advisory, compose, and fallback branches never classify or suggest \`task-loop\`. It is selected only by one of the two explicit forms above; the default remains \`small-feature\`.
   - **Gauntlet-loop is excluded here** — classifier, advisory, compose, and fallback branches never classify or suggest \`gauntlet-loop\`. It is selected only by one of the two explicit forms above; the default remains \`small-feature\`.
   - **\`classify\` policy (opt-in)** — run \`rasen pipeline classify "<task>" --json\`. If it returns a \`suggested\` pipeline that IS in \`available\`, ADOPT it exactly as returned: display the adoption with its basis (e.g. \`Pipeline: bug-fix (auto-selected, matched: fix)\` for a \`keyword\` basis, \`Pipeline: small-feature (auto-selected, default basis)\` for a \`default\` basis) and let the user change it before proceeding — adoption only changes the starting value, never the user's authority to override. Never escalate or substitute a different pipeline by your own judgment; adopt exactly what classify returned. If the command fails, returns no suggestion, or suggests a pipeline NOT in \`available\`, fall back to \`small-feature\` and display the fallback and its cause — the same invariant fallback as the \`manual\` policy below.
   - **\`compose\` policy (opt-in, classify-first)** — run classify exactly as the \`classify\` policy does. A \`keyword\`-basis suggestion is adopted exactly as above; composition never overrides an affirmative match. On a \`default\`-basis suggestion, judge fit: if \`small-feature\` or any other registered pipeline (\`rasen pipeline list --json\`) fits the task's stage needs, use it — a registered pipeline that fits is always preferred. Only when NO registered pipeline fits MAY you compose: draw stages from the registered stage vocabulary (inspect built-ins via \`rasen pipeline show <name> --json\`), reusing known skills/roles/gates/loops/verifyPolicy values and drawing \`requires\` edges yourself; name it \`composed-<slug>\` (a short kebab slug of the task) after checking \`rasen pipeline list --json\` for a collision — on collision append a numeric suffix, NEVER overwrite or reuse an existing name; stamp the YAML \`origin: composed\`; include the quality-floor stages — at least one stage with \`role: reviewer\` and at least one stage with \`loop.kind: review-cycle\` — every composition MUST carry both, never a composition free of independent inspection; write it to the project pipelines directory. Then gate execution on \`rasen validate <name> --type pipeline --json\`: proceed only on \`valid: true\`. On a validation failure you MAY make ONE bounded fix attempt; if it still does not validate, fall back to \`small-feature\`, display the fallback and its cause, and remove the invalid composed pipeline directory so it does not linger in the registry. Display the composition (name, full stage list with the floor stages called out, and the validation verdict) at the same user-changeable display point as an adopted classify suggestion — the user may replace it with any registered pipeline, or reject it, before any stage runs. Composition is permission, not obligation: \`small-feature\` remains a fine general-purpose fallback.
   - **\`manual\` policy (default = small-feature)** — otherwise use **\`small-feature\`** (the default pipeline). Do NOT auto-escalate to full-feature/bug-fix. You MAY run \`rasen pipeline classify "<task>" --json\` for a suggestion, or pick any pipeline from \`rasen pipeline list\` (including project/user-defined ones) — but the suggestion is advisory-only here, and absent an explicit selection the default is \`small-feature\`.

DISPLAY the chosen pipeline and let the user change it before proceeding, whichever branch produced it.

Built-in pipelines (see \`rasen pipeline list --json\`):
- **full-feature** — office-hours -> propose -> apply -> parallel expert reviews -> review-loop -> ship -> retain -> archive
- **small-feature** — propose -> apply -> verify -> review-loop -> ship -> archive  _(default)_
- **bug-fix** — propose -> apply -> adaptive verify -> ship -> archive
- **task-loop** — iterate (builder -> fresh critic) -> ship -> archive _(explicit only; no spec stages)_
- **gauntlet-loop** — phased iterate (serial foundation -> lead-driven per-wave polish with blind A/B -> convergence) -> ship -> archive _(explicit only; no spec stages; reference quality bar)_

### Task-loop explicit launch contract

Apply this section only when \`task-loop\` was explicitly selected. Resolve and display the reconciler capability first; on a legacy engine or unsupported reconciler, emit \`task_loop_reconciler_required\` and stop before creating or dispatching any work.

Use a Change id only as the canonical Run's technical identity and storage container. After input and reconciler preflight pass, create its empty active Change directory under the CLI-resolved \`changesDir\` with a path-safe filesystem API if it does not already exist; never call a proposal/new-change workflow to create it. Do not run proposal or planning stages, and do not create runtime \`proposal.md\`, \`design.md\`, \`specs/\`, \`tasks.md\`, \`planning-context.md\`, or \`goal-plan.md\`. Instead, freeze the user's request before launch under \`inputs.taskLoop\`:

\`{ "format": "task-loop-input/1", "goal": "...", "artifactTargets": ["..."], "bar": [{ "id": "...", "criterion": "...", "evidenceHint": "..." }], "constraints": ["..."] }\`

Every target and bar criterion must be concrete and inspectable, and each criterion must name the raw evidence the fresh critic can examine. Reject missing targets, an empty or vague bar, or missing evidence before launch. Write only the canonical launch-input envelope \`{ "taskLoop": <the frozen object above>, "gatePolicy": { "effective": "on|off", "source": "..." } }\` to \`<ephemeraDir>/task-loop-input.json\` as UTF-8 using a path-safe file API (never shell redirection), then launch the canonical Run with \`rasen pipeline start <change> task-loop --input-file "<ephemeraDir>/task-loop-input.json" --json\`, threading the same engine/store/project selectors used for inspection.

The Run drives three uninterrupted stages: bounded iterate, ship, archive. The builder receives the frozen contract plus only the prior round's largest gap and pass condition. Every judge action goes to a fresh critic and contains real artifact targets plus raw evidence, never the builder's narrative. The canonical Record decides satisfaction, exhaustion, cancellation, and delivery eligibility.

\`--no-gate\` is recorded in \`gatePolicy\`, but no-gate cannot bypass input validation, the evidence bar, actor separation, terminal-state checks, or the ship/archive delivery guard. If launch returns \`launch_request_conflict\`, display the conflict and stop without mutating the existing Run. \`task_loop_exhausted\`, blocked, failed, and cancelled outcomes are terminal: report the evidence and remaining gap, never convert, upgrade, or fall back to a spec pipeline.

### Gauntlet-loop explicit launch contract

Apply this section only when \`gauntlet-loop\` was explicitly selected. Resolve and display the reconciler capability first; on a legacy engine or unsupported reconciler, emit \`gauntlet_reconciler_required\` and stop before creating or dispatching any work.

Use a Change id only as the canonical Run's technical identity and storage container. After input and reconciler preflight pass, create its empty active Change directory under the CLI-resolved \`changesDir\` with a path-safe filesystem API if it does not already exist; never call a proposal/new-change workflow to create it. Do not run proposal or planning stages, and do not create runtime \`proposal.md\`, \`design.md\`, \`specs/\`, \`tasks.md\`, \`planning-context.md\`, or \`goal-plan.md\`. Instead, freeze the user's request before launch under \`inputs.gauntlet\`:

\`{ "format": "gauntlet-loop-input/1", "goal": "...", "artifactTargets": ["..."], "bar": { "format": "gauntlet-reference-bar/1", "domain": "code/runnable", "referenceTargets": ["..."], "comparisonAxis": "observable-behavior/output" }, "constraints": ["..."] }\`

Every artifact target and reference target must be concrete and inspectable, and the comparison axis must be a concrete inspectable property (not a subjective adjective). Reject missing targets, an empty or subjective bar, or a missing reference before launch. Display the frozen goal, reference bar (domain, comparison axis, reference targets), and effective wave/round budget before the Run starts so the user can verify the bar. Write only the canonical launch-input envelope \`{ "gauntlet": <the frozen object above>, "gatePolicy": { "effective": "on|off", "source": "..." } }\` to \`<ephemeraDir>/gauntlet-loop-input.json\` as UTF-8 using a path-safe file API (never shell redirection), then launch the canonical Run with \`rasen pipeline start <change> gauntlet-loop --input-file "<ephemeraDir>/gauntlet-loop-input.json" --json\`, threading the same engine/store/project selectors used for inspection.

The Run drives three uninterrupted stages: bounded iterate, ship, archive. The iterate stage runs a phased gauntlet loop: Phase 0 serial foundation (one builder/critic over the whole artifact against the reference bar), optional lead-driven phase transition to per-wave polish (piece-builders serial, piece-critics and meta-critic parallel as read-only), and optional smoothing between waves. Every judge action goes to a fresh critic and contains real artifact targets plus raw evidence, never the builder's narrative. The critic performs a blind A/B comparison against the reference bar and returns at most the single largest remaining gap.

The user MAY issue a convergence attestation at any phase. The attestation drives a final convergence-judge Action (fresh session) that records an auditable satisfied result whose evidence is the attestation. The satisfied source is semantically "user-converged via attestation" (\`attestation-evidenced\`), NOT "bar reached." Ship becomes ready only after this convergence-judge satisfaction, and archive only after ship. No bypass terminal exists around the judge.

\`--no-gate\` is recorded in \`gatePolicy\`, but no-gate cannot bypass input validation, the reference bar, evidence, fresh-critic, blind-A/B, actor separation, terminal-state checks, or the ship/archive delivery guard. If launch returns \`launch_request_conflict\`, display the conflict and stop without mutating the existing Run. \`gauntlet_exhausted\`, \`gauntlet_blocked\`, backstop-suspended, cancelled, and failed outcomes are terminal: report the evidence and remaining gap, never convert, upgrade, or fall back to a spec pipeline. A backstop-suspended Run suspends and prompts the user to converge or resume — it never destroys committed work.

## 2. Fetch the selected pipeline's stage DAG

Load the chosen pipeline's stages from the registry — do NOT hard-code them:

\`\`\`bash
rasen pipeline show <name> --for-execution --json <same role flags from this invocation>
\`\`\`

\`--for-execution\` is mandatory on this auto path: forward every role flag from the \`rasen-auto\` invocation onto this command. It resolves the active profile, applies those run-local choices to the final execution plan, and rejects disabled skills or unsupported final host routes before the LEAD can dispatch the returned DAG. Plain \`pipeline show\` remains a display-only structural inspection.

Execute stages in \`buildOrder\`. Each stage carries the metadata the LEAD interprets via the playbook in section 3: **id**, **kind** (\`standard\` | \`decompose\`), **skill** (the Rasen skill the worker invokes; absent for a decompose stage), **childPipeline** (decompose only — the pipeline each child change runs), **role** (worker isolation), **requires** (DAG edges), **gate** (human pause after), **loop** (bounded review->fix), **parallelGroup** (concurrent fan-out — e.g. a \`verify\` stage's experts), **condition** (run only if met; mutually exclusive conditions like ui / non-ui pick exactly one), **leadReview** (LEAD checks the output for drift — section 4), **verifyPolicy** (section 5).

**Decompose is the conditional FIRST step.** If \`buildOrder[0]\` is a stage with **kind: decompose** (e.g. the \`auto-decompose\` pipeline), evaluate run-or-skip from the task BEFORE any other stage — **skip** it and the remaining stages run on one change exactly as today; **take** it and fan the task out into multiple child changes. This is LEAD-audited and proceeds automatically (no human gate); see the playbook's **Step G — Portfolio orchestration**. Pipelines without a decompose first stage are unaffected.

Before running stages, display the effective runtime table and let the user change it:

\`\`\`
planner=claude|codex  implementer=claude|codex  reviewer=claude|codex  fixer=claude|codex  shipper=claude|codex
\`\`\`

The user may mix runtimes across all four supported host-target pairs. On a Claude host, Codex workers use the \`codex-exec\` bridge; on a Codex host, Claude workers use the \`claude-print\` bridge through \`rasen agent dispatch\`. Same-runtime workers remain native. Pipeline stages may also set \`runtime\`, \`sessionReuse\`, \`sandbox\`, \`model\`, and \`effort\`; invocation role flags override those defaults for this run because they were forwarded into the final execution-plan command above. The effective **model** for a stage additionally falls through machine config below the pipeline's own role default: stage \`model\` > pipeline \`agents.<role>.model\` > project config \`models.roles.<role>\` > project config \`models.default\` > global config \`models.roles.<role>\` > global config \`models.default\` > the runtime's own default. \`rasen pipeline show <name> --json\` already resolves this whole chain — read the stage's \`model\`/\`modelSource\` from there rather than re-deriving it.

## 3. Execute the pipeline as the LEAD

${AUTO_ORCHESTRATION_PLAYBOOK}

## 4. Propose direction-review gate (optional)

When the \`propose\` stage has **leadReview** enabled (via the \`--review-plan\` argument or the stage flag): after the propose worker returns and BEFORE \`apply\`, you (the LEAD) review proposal.md / design.md / specs / tasks.md against the user's ORIGINAL intent for direction drift. You hold the original intent and did NOT author the proposal, so this is a legitimate non-author check.
- Aligned -> continue to apply.
- Drifted -> bounce back to a fresh planner worker with the drift notes, or surface it to the user at the gate.
- **Tier C exception:** under the single-context fallback the LEAD itself authored the proposal, so leadReview would be a self-review. There, do NOT count it as a non-author check — degrade it to an explicit human-confirmation gate before apply, and record it as a fallback in run-state.
When leadReview is not enabled, proceed from propose to the next stage without the extra review.

## 5. verify stage — verifyPolicy semantics

A \`verify\` stage carries a **verifyPolicy** of \`adaptive\` (default), \`standard\`, or \`light\`. Every value has defined behavior — none is dead config:

**\`adaptive\` (default) — scale the verification passes to the diff size:**
- Run the unit-test gate first. Record the gate's command, result, and the content tree fingerprint (\`git rev-parse HEAD^{tree}\`) of the git state it ran against in run-state — the ship stage's evidence-based test gate consumes this to decide whether tests must be re-run.
- **Simple** fix (single file / non-core path / tests sufficient) AND tests green -> verify passes; skip the review loop.
- **Complex** fix (multiple files / core paths / insufficient coverage) -> spawn a dedicated test/verification worker for deeper checking AND enter the review-cycle loop.
- Compute the simple/complex determination from the diff and record it in run-state.

**\`standard\` — a single verify pass, no review-cycle loop.** Run the verify worker once over the diff, record its verdict + the test-gate evidence (command/result/tree fingerprint) as under \`adaptive\`, and proceed on a clean verdict; do NOT enter the bounded review->fix loop. Open Blocker/Major findings still block \`ship\` (escalate per Step H) — "no loop" narrows the passes, it does not waive the finding-gate.

**\`light\` — skip verification when the diff is trivial** (e.g. docs-only or tests-only, no product-source change). Record the skip and its basis (the trivial-diff determination) in run-state. If the diff is NOT trivial, do not honor \`light\` — fall back to \`standard\` and note the fallback, so a mis-tagged non-trivial change is never shipped unverified.

## Resume

**First, resume under the OWNING engine.** Read the recorded \`engine\` from run-state (step 0.7). A change with an active **reconciler-engine** Run resumes from the CANONICAL FRONTIER: \`rasen pipeline resume-run <change> <name> --json\` returns the ready actions, and you dispatch from those — artifact presence and run-state stage ticks are observability for such a run and MUST NOT override the frontier. A **legacy-engine** change (or one with no canonical Run) uses the artifact + run-state heuristic below. Never resume a change under a different engine than the one that owns it; if both a canonical Run and legacy run-state exist for the same change, surface that engine-ownership conflict to the user rather than picking a side. The rest of this section is the **legacy-engine** resume surface; the worker re-engagement rules at the end of it are engine-neutral.

On invocation for an existing **legacy-engine** change, determine the next incomplete stage from the change's run-state AND artifacts via \`rasen pipeline resume <change> --json\`, then resume from there rather than restarting. Resume performs the same active-profile execution preflight and refuses to return an executable frontier when a stage skill is unknown or known-but-disabled. If the run is store- or project-scoped (the change lives in a \`--store\`- or \`--project\`-selected Rasen root), thread the SAME flag onto resume — \`rasen pipeline resume <change> --store <id> --json\` (or \`--project <id>\`) — so it resolves that root and reads run-state from its change directory; omitting it would resolve the cwd root and report \`hasRunState:false\` for a change that is actually mid-run. The run-state per-stage status is AUTHORITATIVE; artifact presence is a heuristic to seed or cross-check it, and run-state wins on any conflict. Artifact signals: office-hours-design.md -> office-hours done; proposal.md -> propose done; tasks.md all checked -> apply done; review-report.md (or any expert \`*-report.md\` — the verify worker saves these per the playbook's Step B) -> verify done; review-cycle-report.md -> review-loop done; ship-log.md -> ship done; retain (retention) runs after ship and before archive — its completion is authoritative in run-state (report mode also writes retro.md; codify writes no change artifact, so never infer retain from artifact presence); change moved to archive -> archive done. If neither run-state nor any artifact exists yet, start from the pipeline's first stage.

A fresh session has no live workers, so \`SendMessage\` cannot reach a worker from a prior session (agentIds are dead handles across a session boundary). Re-engagement is **agentId-first** within a live session — but a completed worker is NOT reliably name-addressable even in-session, so do NOT rely on a spawn \`name\`; fall back to the transcript warm-seed of the playbook's **Step F.1** when the agentId is absent or does not resolve. When you must re-engage a role on resume (e.g. the reviewer for a re-review, or an interrupted stage), **warm-seed** a fresh same-role worker from its predecessor's recorded transcript. \`rasen pipeline resume\` reports the per-stage \`workers\` pointers (agentId / transcript) available to seed from; fall back to cold reconstruction from the change directory when a transcript is gone.

**Portfolio resume.** For a parent with \`portfolio-run.json\`, \`rasen pipeline resume <parent> --json\` returns children and the runnable frontier (add the same store/project selector when scoped). Continue incomplete children in DAG order; never rerun decompose or completed children. Terminal children expose \`next: portfolio-delivery\` until delivery is \`done\`/\`skipped\`. The portfolio is authoritative: report invalid content, never bypass it with parent \`auto-run.json\`; each child resumes from its own state. Warm-seed the persistent \`planner\` it returns plus \`planning-context.md\`.

## Output Format

\`\`\`
## Auto: <change-name>

Classification: Full Feature | Small Feature | Bug Fix      Tier: A | B | C

### Progress
- [x] propose      — planner worker; 7 tasks generated
- [ ] apply        — implementer worker; in progress
- [ ] verify       — reviewer worker(s)
- [ ] review-loop
- [ ] ship

### Workers / experts
- review (always), cso (security), benchmark (perf), qa (UI) / qa-report-only (non-UI; dispatch \`rasen-qa\` with an explicit report-only instruction)
\`\`\`

When decompose is taken, report **portfolio progress** instead — the children, their dependency order, what runs in parallel, and the runnable frontier:

\`\`\`
## Auto: <parent> (decomposed into 3 children)      Tier: A

### Portfolio
- [x] <parent>-api      small-feature   (done)
- [ ] <parent>-ui       full-feature    (running; depends on -api)
- [ ] <parent>-docs     small-feature   (parallel with -ui; independent)

Frontier: <parent>-ui, <parent>-docs
\`\`\`

## Guardrails

- Selection policy default is **OFF** (\`manual\`): absent every flag (\`--auto-select\`, \`--auto-compose\`) and \`autopilot.selection\`, pipeline selection behaves exactly as 0.1.x — explicit selection wins, otherwise the default is \`small-feature\`, classification is advisory-only, and there is no auto-escalation.
- Explicit pipeline selection (\`--pipeline\` or a leading known-pipeline token) always wins over the selection policy — classification is never consulted, and \`--auto-select\`/\`--auto-compose\` are inert when an explicit selector is present.
- \`task-loop\` is explicit-only and reconciler-only. Never classify or suggest \`task-loop\`; never convert, upgrade, or fall back from a terminal Task Loop outcome to a spec pipeline. No-gate cannot bypass its frozen-input, evidence, fresh-critic, or delivery guards.
- \`gauntlet-loop\` is explicit-only and reconciler-only. Never classify or suggest \`gauntlet-loop\`; never convert, upgrade, or fall back from a terminal Gauntlet Loop outcome to a spec pipeline. No-gate cannot bypass its frozen-input, reference-bar, evidence, fresh-critic, blind-A/B, convergence-through-judge, or delivery guards.
- Under the \`classify\` policy, adopt the classification suggestion EXACTLY as returned — never escalate or substitute a different pipeline by your own judgment.
- When classification is unavailable, errors, returns no suggestion, or suggests a pipeline not in \`available\`, fall back to \`small-feature\` and display the fallback and its cause.
- Composition (\`compose\` policy) is classify-first and fires ONLY on a \`default\`-basis suggestion with no registered pipeline fit — never as a substitute for an affirmative \`keyword\`-basis match, and never obligatory (a fitting registered pipeline is always preferred over composing).
- The LEAD never executes an unregistered, in-memory DAG: every pipeline it runs — including its own compositions — MUST resolve by name via \`rasen pipeline show <name> --for-execution --json\` before execution. The execution flag is mandatory so active-profile skill enablement is checked before dispatch. A composed pipeline is always written to the project pipelines directory and validated (\`rasen validate <name> --type pipeline --json\`) before any stage runs.
- A composed pipeline's YAML is ALWAYS stamped \`origin: composed\` and ALWAYS contains the quality floor: at least one \`role: reviewer\` stage and at least one \`loop.kind: review-cycle\` stage — the LEAD never composes itself an inspection-free pipeline. This is machine-enforced at parse time (a floor-violating composed pipeline cannot load), not merely a prose rule.
- A composed pipeline name (\`composed-<slug>\`) is checked against \`rasen pipeline list --json\` before writing and NEVER reuses or overwrites an existing pipeline name — collision gets a numeric suffix, never a shadowed/overwritten pipeline.
- Gate stages pause for human confirmation UNLESS the resolved effective gate (step 0.5) is \`off\`, in which case the \`gate: true\` stage is auto-approved and the approval is recorded in run-state (\`gateDecision: auto-approved (<source>)\`) — never silently skipped, never deleted from the record. No gate type is exempt: under \`--no-gate\` or \`autopilot.gates: off\` every gate, including the goal-loop \`define-goal\` stage, is auto-approved unless a per-stage \`pipelines.<name>.gates.<stage>: on\` instance restores its pause. (For a decomposed portfolio's child-pipeline gates, this resolves per the playbook's Step G child-gate semantics: parent directive > child gate.)
- If a stage is stuck (relay caps, stalled handoffs, exhausted review rounds), run the playbook's Step H escalation ladder — LEAD strategy review first, then park the stage as \`escalated\` and continue unblocked work; surface parked items at the next gate or the run-end report. Hard-stop only on failures the ladder cannot express (e.g. corrupted state).
- The user can interrupt at any time and switch to manual.
- The effective engine is resolved ONCE (step 0.7), displayed at run start, and recorded in run-state. A reconciler-engine run owns no mechanical progression here: rounds, caps, actor separation, result validity, and terminal outcomes come from the canonical Run, and you report what it says rather than keeping a second copy. A legacy-engine run keeps every mechanic of the legacy playbook path.
- Save run-state so the pipeline can be resumed from where it left off. For a reconciler-engine run, run-state carries the engine, worker handles, the gate-policy freeze, the retention mode, strategy attempts, and session-relay generation — plus labeled projections that are never read back to make a progression decision the Run owns.
- Do not run \`ship\` if verification has unresolved Blocker/Major findings — escalate first. Under the reconciler engine this is also enforced at the Record: a clean settle with open Blocker/Major findings is rejected, so never present one as clean.
- Staff stages so author != verifier (reviewer != implementer; design-level fixer != author; re-reviewer != fixer). Staffing is always yours; under the reconciler engine the Record additionally REJECTS a same-actor verification at commit, so do not also carry your own verdict on it.
- Decompose is LEAD-audited, not a human gate — proceed automatically once the plan is safe; escalate only when no safe plan exists. The user can still interrupt.
- NEVER parallelize children you cannot prove are independent: parallel requires no dependency edge AND no overlapping touched capabilities/specs/files AND Tier A. When uncertain, run serial. Never parallelize under Tier B/C.
- A dependent child waits for every prerequisite to be implemented + review-clean before it starts; a shared working tree is sufficient (no forced ship/archive of the prerequisite unless the dependency is on landed/merged artifacts).
- Decomposed children ship in **local** delivery mode (commit only — no per-child push or PR). The portfolio delivers ONCE: after ALL children complete, resolve the delivery mode at the parent level and push / create the PR there. On partial failure, completed children's commits stay local — never push a half-delivered portfolio.
- Save portfolio run-state (\`portfolio-run.json\`, in the resolved ephemera directory per the playbook's Step G.7 — sticky-legacy fallback) so a decomposed run is observable and resumable; on a child's failure, stop its dependent chain, keep independent done children, and escalate with the open frontier.`;

export function getAutoCommandSkillTemplate(): SkillTemplate {
  return {
    name: 'rasen-auto',
    description: 'Autopilot mode — the LEAD classifies the task, selects a pipeline, and drives it end-to-end by orchestrating role-isolated subagents with gates, the review-cycle loop, and human escalation.',
    instructions: AUTO_INSTRUCTIONS,
    license: 'MIT',
    compatibility: 'Requires rasen CLI.',
    metadata: { author: 'rasen', version: '1.0' },
  };
}
