# Design: Orchestrated, data-driven autopilot pipelines

## 1. Problem and goal

`/opsx:auto` is a single agent following a hand-written linear recipe. We want it to run as a **LEAD agent orchestrating role-isolated subagents**, where different tasks are fully isolated and, within one task, the LEAD can resume a specific subagent via `SendMessage` to continue with warm context. We also want pipelines to be **data**, so adding a task type is a definition, not new orchestration code.

The central design move is to **separate WHAT from HOW**:

```
┌─ Layer 1: Pipeline registry (DATA = WHAT) ───────────────────────────┐
│  pipelines/<name>/pipeline.yaml — ordered DAG of stages, each:         │
│    { id, skill, role, gate?, loop?, parallelGroup?, condition?,        │
│      leadReview?, verifyPolicy? }                                      │
│  full-feature / small-feature / bug-fix / <future> = one yaml each     │
│  Surfaced via `openspec pipeline ... --json` (mirrors schema CLI)      │
└────────────────────────────────────────────────────────────────────┘
                         ↓ LEAD reads + interprets
┌─ Layer 2: Orchestration playbook (INSTRUCTIONS = HOW, written once) ──┐
│  Detect tier → per stage: spawn role-isolated leaf worker (invokes the │
│  stage's existing skill) → honor gate (pause) / loop (review-cycle) /  │
│  parallelGroup (concurrent experts) / condition (expert selection) →   │
│  same-task SendMessage warm-resume → record run-state → enforce        │
│  author≠verifier → cap loops + escalate to human.                      │
└────────────────────────────────────────────────────────────────────┘
```

Why this is the right factoring: the architecture changes once and scales to N task types for free; `auto` and `review-cycle` share one orchestration model (`review-cycle` is just the `loop` stage); and each stage's logic stays owned by its existing skill (single source of truth).

## 2. Pipeline data model

A pipeline is an ordered DAG of stages. Stage fields:

| Field | Meaning |
|-------|---------|
| `id` | Stage identifier (e.g. `office-hours`, `propose`, `apply`, `verify`, `ship`, `archive`, `retro`). |
| `skill` | The existing OPSX skill the worker invokes for this stage (e.g. `openspec-propose`). The orchestrator does not reimplement stage logic. |
| `role` | Worker role for isolation + author≠verifier: `planner` / `implementer` / `reviewer` / `fixer` / `shipper`. Distinct roles ⇒ distinct workers. |
| `requires` | Stage IDs that must complete first (DAG edges; topo-sorted like the artifact graph). |
| `gate?` | Optional human pause point after this stage, with a prompt. |
| `loop?` | Optional loop spec for this stage (e.g. `{ kind: review-cycle, maxRounds: 3 }`). Marks the stage as the bounded review→fix loop. |
| `parallelGroup?` | Optional group label; stages sharing a label run concurrently (e.g. expert reviewers in `verify`). |
| `condition?` | Optional predicate gating whether the stage runs (e.g. `security-relevant` → `/cso`). |
| `leadReview?` | Optional: after the worker returns, the LEAD reviews the output against original intent for drift (the propose direction-review gate). May be forced on by definition or toggled by an `auto` parameter. |
| `verifyPolicy?` | Optional policy for verify-class stages: `adaptive` (unit-test gate for simple, dedicated test worker for complex), `standard`, `light`. |

Resolution mirrors schemas exactly (project ⊃ user ⊃ package), reusing a shared `createDualRootResolver`:
1. `<projectRoot>/openspec/pipelines/<name>/pipeline.yaml`
2. `${XDG_DATA_HOME}/openspec/pipelines/<name>/pipeline.yaml`
3. `<package>/pipelines/<name>/pipeline.yaml`

Validation (parse → Zod → custom rules, like `artifact-graph/schema.ts`): unique stage ids, `requires` reference existing stages, no cycles, `skill` exists in the skill registry, `role` is known, `parallelGroup` members are mutually independent in the DAG.

### Built-in pipelines (initial)

- **full-feature:** `office-hours(planner,gate) → propose(planner,leadReview?) → apply(implementer,gate) → verify(reviewer, parallelGroup=experts, conditions: review always / cso if security / benchmark if perf / qa if UI) → loop(review-cycle, fixer) → ship(shipper,gate) → archive → retro`.
- **small-feature:** `propose(planner) → apply(implementer,gate) → verify(reviewer, standard) → loop(review-cycle) → ship → archive`.
- **bug-fix:** `propose(planner, simplified) → apply(implementer,gate) → verify(reviewer, verifyPolicy=adaptive) → ship → archive`.

## 3. Orchestration model and the flat-hierarchy constraint

The single most important runtime constraint: **Claude Code subagents cannot spawn their own subagents.** Therefore the LEAD is the *sole* orchestrator and every worker is a *leaf*. All loop control, fan-out, triage, and routing live in the LEAD; workers only do one unit of work and return.

```
                     ┌──────── LEAD (orchestrate / record; never writes code) ────────┐
 office-hours ───────┤ spawn planner worker → invoke openspec-opsx-office-hours          │
 propose      ───────┤ spawn planner worker → invoke openspec-propose  (leadReview?)      │
 apply        ───────┤ spawn implementer worker → invoke openspec-apply                   │
 verify       ───────┤ parallel spawn reviewer workers (review / cso / benchmark / qa)    │
 loop         ───────┤ ┌ triage → route fix worker (≠author) → re-review worker (≠fixer) ┐│
 (review-cycle)      │ └────────── {clean → exit | open → loop | cap → escalate human} ───┘│
 ship         ───────┤ spawn shipper worker → invoke openspec-opsx-ship                    │
                     └─────────────────────────────────────────────────────────────────────┘
```

Workers invoke existing skills via the established OpenSpec pattern (see `archive-change.ts`, which already does `Task tool (subagent_type: "general-purpose", prompt: "Use Skill tool to invoke openspec-sync-specs ...")`). Role isolation is achieved by spawning *distinct* general-purpose subagents with a role-specific prompt; the isolation comes from separate contexts, not a named agent type.

## 4. Capability tiers (auto-detected; same pipeline, different HOW)

| Tier | Condition | Mechanics |
|------|-----------|-----------|
| **A — full** | Claude Code + `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` | LEAD spawns role workers AND resumes a specific worker via `SendMessage` for warm-context continuation (e.g. re-engage the reviewer on the fix delta). Only the LEAD originates `SendMessage`. author≠verifier is structural. |
| **B — multi-agent, no warm resume** | `Task`/spawn available, no agent-teams | Fresh worker per stage/round; all context cold-reconstructed from the change directory + run-state. Isolation and author≠verifier still structural; just costlier (cold re-reads). |
| **C — degraded** | No subagent capability | Single-context sequential execution = today's behavior. Explicitly labeled fallback. |

The LEAD detects the tier once at start and chooses mechanics per stage. Because state lives in the change directory (Section 5), tier B/C lose only *warmth*, not *capability* — the same pipeline completes.

### SendMessage boundaries (shape tier A)
- Only the LEAD may originate `SendMessage`; within-session only.
- Cross-session resume of a specific worker is not possible → a resumed `/opsx:auto` in a new session falls to tier B for continuation (cold-reconstruct from run-state), then may resume warm again for new workers it spawns.

## 5. State: change directory as blackboard + LEAD run-state

OpenSpec's existing strength: the change directory is a durable, tool-agnostic blackboard. Stages hand off through artifacts (`proposal.md`, `design.md`, `tasks.md`, `specs/`, `review-report.md`, `ship-log.md`). Workers read/write files; they do not share memory. `SendMessage` is only a warm-continuation optimization layered on top — never the inter-stage state channel. This is what makes tier B/C possible and makes the whole run survive a dead worker or a new session.

Because subagent work is otherwise opaque, the LEAD maintains a **run-state** file (`openspec/changes/<name>/auto-run.json`, formalized in P3): classification, selected pipeline, per-stage status, which worker handled what, review rounds, and open findings. It powers (a) observability, (b) `openspec pipeline resume <change>` after an interruption, and (c) tier-B cold context reconstruction. P1 may begin with a markdown run-log; P3 promotes it to a validated JSON schema.

## 6. Roles and the author≠verifier invariant

The invariant is enforced *structurally* by the LEAD assigning distinct workers:
- reviewer worker ≠ implementer worker (the verifier never wrote the code under review);
- the fixer of a design-level finding ≠ the original author (no quiet in-place redesign by the author);
- the re-review worker ≠ the fixer (no self-certification).

In tier C (single context) this degrades to the recorded convention used today (independent gate-run + diff-read for trivial fixes); the design makes clear that A/B are the intended path and C is fallback.

## 7. The propose direction-review gate (decision)

`leadReview` on the `propose` stage, toggleable by an `auto` parameter (e.g. `--review-plan`). When enabled, after the propose worker returns and before `apply`, the LEAD — which holds the original user intent and did not author the proposal — reviews `proposal/design/specs/tasks` for direction drift. Outcomes: accept and continue; bounce back to a fresh planner worker with the drift notes; or surface to the human at the pause point. Because the LEAD is not the author, this is a legitimate non-author check, not a self-review.

## 8. Adaptive Bug-Fix verify (decision)

`verifyPolicy: adaptive` on the bug-fix `verify` stage. The LEAD first runs the unit-test gate. If the change is simple — single file / non-core path / tests deemed sufficient — a green gate is enough and the loop is skipped. If complex — multiple files / core paths / insufficient coverage — the LEAD spawns a dedicated test/verification worker for deeper checking and enters the review-cycle loop. The simple/complex heuristic is computed by the LEAD from the diff and recorded in run-state.

## 9. CLI surface (P2)

Mirrors the schema/status CLI conventions (Commander subcommand group, `--json` via `console.log(JSON.stringify(x, null, 2))`):
- `openspec pipeline list [--json]` — available pipelines (package/user/project, with source).
- `openspec pipeline show <name> [--json]` — the stage DAG with all metadata.
- `openspec pipeline classify "<task>" [--json]` — suggested pipeline + indicators (the LEAD/user may override).
- `openspec pipeline resume <change> [--json]` — given a change's artifacts + run-state, the next incomplete stage and what remains.

`openspec validate` is extended to validate pipeline definitions (Section 2 rules).

## 10. `review-cycle` unification

`review-cycle` is rewritten to consume the same orchestration playbook as its inner loop. The current file inverts the priority (SendMessage = "optional acceleration", single-context = "mandatory baseline"); this is corrected so tier A (SendMessage-driven, structurally isolated reviewer/fixer) is PRIMARY and single-context is the explicit fallback. No fork: each review pass still delegates to the `openspec-gstack-review` engine.

## 11. Phasing and rationale

- **P1 — orchestration playbook + tiers + roles, pipelines inline.** Build `_orchestration.ts`; rewrite `auto` to classify → select an *inline* DAG → interpret via the playbook (office-hours/propose/apply included); rewrite `review-cycle` to share it; add the propose-review gate and adaptive bug-fix verify. This validates the highest-risk part (real subagent orchestration + tiers + role isolation + SendMessage) on real Claude Code before investing in the data layer.
- **P2 — promote pipelines to the data registry + CLI.** Implement `pipeline-registry` + the `openspec pipeline` command group + validation; refactor `auto` to read the DAG from the CLI and drop the inline defs. Because HOW (the playbook) and WHAT (the DAG) were already decoupled in P1, this step only swaps the *source* of the DAG.
- **P3 — hardening.** Formalize run-state (JSON schema + resume), verify tier B/C fallbacks, update docs, retro.

Sequencing rationale: P1 de-risks the orchestration; the WHAT/HOW split means P2 is a source swap, not a rewrite.

## 12. Risks and tradeoffs

- **Token cost.** Many workers are expensive → classification scales team size (bug-fix is minimal; adaptive verify avoids spinning extra workers for simple fixes).
- **Latency.** Stages are inherently serial; only intra-stage (expert) work parallelizes.
- **Flat hierarchy.** All orchestration is in the LEAD; workers are leaves — a hard constraint, not a preference.
- **SendMessage limits.** Lead-only, same-session → cross-session continuation degrades to tier B.
- **Handoff fidelity.** Workers hand off via files, so artifacts must be self-sufficient — which OpenSpec already enforces.

## 13. Out of scope

- No change to the `spec-driven` schema or `src/core/artifact-graph/*` behavior (only a shared dual-root resolver is factored out and reused).
- No new agent *types* in the host tool; workers are general-purpose subagents told their role.
- Cross-change orchestration: one `/opsx:auto` invocation = one change = one team. Multiple changes are separate invocations.
