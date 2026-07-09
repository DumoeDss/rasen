## Context

Child #3 of `prompt-audit-fixes` — the orchestration playbook's taxonomy/accounting fixes. Scope: OR-1..OR-15 (audit-orchestration.md) + SH-4, SH-5, SH-7 (audit-shared.md) + planning-context §3. All line refs re-verified against the current tree (post-rebrand 2ebfae9 + children 1-2 landed; `_orchestration.ts` is 241 lines and already carries child #1's Step B sentence edit). Verified current locations: H.2 @223, H-preamble defaults `{threshold:0.5,maxRelays:3,stallLimit:2}` @219, B.1.5 reuse-threshold 0.25 @76, Step F run-state example `sessionHandoff` (no `n`) @157, Step G "proceed automatically" @187, Step L Inject @113 / evaluate @119 / stall @126 / runArtifact-hardcode @122·124, Step E.1 dispatch @103 / E.5 cap @107, Step C Tier-C degrade @84, H.4 @231, H.5 @233, H.7 @240, F.1 dead-handles @167 + "SendMessage IS transcript-resume" note @176, SH-7 opener @22, Tier C @28. `_shared.ts` PREAMBLE solo @92/96/98. `types.ts` ReuseThresholdSchema "headroom" @126 + "stricter than handoff" @470, `runArtifact` @230, `loopStallLimit` @225, goal `maxRounds` @219, `verifyPolicy` @300. `auto.ts` verifyPolicy=adaptive-only @77. `goal-command.ts` measure-only gate guardrail @92 / evaluate author≠verifier @66 / maxRounds 5 @65.

Constraint: TS templates + a schema doc-comment; do NOT touch archive/sync-specs/apply (child #5), store paths (child #6), office-hours (child #4).

## Goals / Non-Goals

**Goals:** resolve the Critical planner-threshold contradiction; give worker death a taxonomy with cheap in-session revival; name and separate every counter; close the goal-loop config holes; define the missing Tier-C degradations; reconcile portfolio gate autonomy; fix the two self-contradictory schema/policy surfaces; scope the PREAMBLE solo disposition and the LEAD authoring rule.

**Non-Goals:** no new pipeline yaml FIELDS (only make the playbook honor existing ones); no changes to the archive/apply/store/office-hours seams; no re-derivation of the audit (diagnoses accepted). WF-4 archive-gate stays child #5.

## Decisions

### D1 — The threshold selection rule (OR-1, SH-4) — Critical

State once, in Step H's preamble, the general rule and have H.2 inline-exempt reuse:

> **Two threshold families, two decisions.** A **mid-task relay** ("should this worker keep going on the task in hand?") compares occupancy to the **handoff** threshold (`handoff.roles[<role>]` > `handoff` > default **0.5**). A **cross-change re-staffing** decision ("should this worker take on a whole new child change?") compares occupancy to the **reuse** threshold (`resolvePipelineReuseConfig(pipeline).roles[<role>]`, default **0.25** — stricter, because taking a fresh change needs more headroom than finishing the current one).

H.2 edit: its trigger list keeps "planner reuse / cross-child continuation" but adds an inline exemption — "for these cross-change re-staffing cases, compare against the **reuse** threshold per Step B.1.5 (planner) / G.1.3 (implementer), NOT the handoff threshold named above." This removes the 0.5-vs-0.25 contradiction at the exact place a top-down reader hits it. Alternative (drop "planner reuse" from H.2 entirely) rejected: H.2 is the natural lookup point; a forward-reference is safer than a silent omission.

### D2 — Worker-death taxonomy + infra-death revival (H.4, OR-6)

Replace H.4's single cold-reconstruct branch with a three-class taxonomy. **Death-taxonomy wording (canonical, goes into the playbook):**

> **A worker that stops without a clean `DONE` is triaged by WHY, not lumped into one branch:**
> - **(a) Context death** — the worker returned `HANDOFF` (compaction / budget / self-assessment) or you observe it hit its context limit. It left (or should have left) a handoff document. → Relay via the document (H.3/F.1), as today. Consumes relay budget (`handoffs[]`, counts toward `maxRelays`/`stallLimit`).
> - **(b) Infra / transient death** — the worker died from an environment fault (API error, tool timeout, socket close, or returned nothing) while its transcript is INTACT and you are in the SAME session. This is NOT a context problem. → **FIRST action: `SendMessage` the SAME agent to revive it** — "You were interrupted by an infrastructure failure, not a context limit. The working directory may have moved; re-read `tasks.md` and run `git status` to re-orient, then continue where you left off." During an overload wave (multiple workers erroring at once), back off and retry the wake with increasing delay rather than stampeding. **Infra revivals consume NEITHER `maxRelays` NOR `stallLimit`** — they are not progress failures, they are environment hiccups; charging them would spend the decompose budget on transient faults. Only if the wake fails (agent unreachable / transcript gone) does this fall through to (c).
> - **(c) Transcript lost** — no live agent AND no recoverable transcript (pruned / expired / cross-session dead handle). → Cold-reconstruct the successor from the change-directory blackboard + run-state, and RECORD the cold reconstruction as a degradation in run-state. This is the ONLY branch that cold-reconstructs.

**OR-6 folds in:** a `DONE` with unticked tasks is NOT any of the deaths — the worker is alive and in-session. → `SendMessage` the same worker ("you left 4.4/4.5 unticked — finish them or explain why they're moot"); its reasoning is preserved and no relay is charged. Only escalate to (c) if it is cross-session/unreachable.

**Supporting edits:** (1) scope F.1's "agentIds are dead handles" rule to **cross-session** explicitly (it is false within a live session — that is exactly the (b)/OR-6 revival path); (2) promote the buried note @176 ("`SendMessage`-ing a completed worker IS a transcript-resume") from the blockquote into the F.1 rule body, since it is the mechanism (b) and OR-6 rely on.

### D3 — Counter disambiguation table (OR-9, OR-13, OR-15)

Add one table to the playbook (near Step H) naming every counter, what it counts, its cap/default, and its reset. **Counter table (canonical):**

| Counter | Counts | Cap (default) | Trigger semantics | Independent of |
|---|---|---|---|---|
| **relay count** (`handoffs[]`) | worker HANDOFF relays within one stage | `maxRelays` (3) | **soft** — on the (maxRelays+1)th relay, LEAD reviews (may continue if progressing) | review rounds, goal rounds |
| **review rounds** (`loop.maxRounds`) | review→fix→re-review cycles in a review-cycle loop | `maxRounds` (3) | at cap with open Blocker/Major → strategy ladder | relays (a round MAY span several relays) |
| **strategy attempts** (`strategyAttempts`) | material-change retries after a cap/stall | budget (3) | exhausted → park `escalated` | relays, rounds |
| **goal-loop rounds** (goal `maxRounds`) | implementer dispatch + gate iterations | `maxRounds` (5) | exhausted → tail with `outcome: maxRounds-exhausted` | relays (`loopStallLimit` counts rounds, not relays) |
| **goal stall** (`loopStallLimit`) | consecutive NON-progressing goal rounds | 2 | → Step H.5 strategy review | handoff `stallLimit` (relays) |
| **handoff stall** (`stallLimit`) | consecutive NO-progress relays | 2 | → Step H.5 early review | `loopStallLimit` (rounds) |
| **session relay** (`sessionHandoff.n`) | LEAD session generations | `maxRelays` (3) | **hard** — at `maxRelays`, STOP auto-relay, recommend decompose | worker relay counter |

Explicit **maxRelays asymmetry note (OR-13):** the same config value `maxRelays` is a **soft review trigger after N** for worker relays (H.5) and a **hard stop at N** for session relays (H.7) — deliberate (a stuck stage can be re-strategized; a self-relaying session that hit N is the decompose signal). Step E gains the goal-loop's line (OR-15): "a review round may span multiple worker relays; the round cap and `maxRelays` are independent counters." H.5 gains the parenthetical (OR-9): "for a goal loop the stall counter is `loopStallLimit` over rounds (Step L), not `stallLimit` over relays."

### D4 — sessionHandoff.n in run-state (OR-2)

Add `"n": 1` to the `sessionHandoff` object in the Step F canonical example @157, with an inline comment "// relay generation; H.7 caps at maxRelays." Without it, handoff.ts's "a record without `n` reads as generation 1" freezes every relay at gen 1 and H.7's cap never trips.

### D5 — Loop-stage per-role threshold resolution (OR-7)

Add to Step E (and cross-reference H): "A loop stage carries a single nominal `role` (e.g. `fixer`), but it dispatches reviewers, implementers, and fixers internally. Resolve EACH dispatched worker's handoff threshold by that worker's ACTUAL role — `handoff.roles[<dispatched role>]` — not by the loop stage's nominal `role`. A reviewer dispatched inside a `review-loop` stage uses the reviewer threshold, not the stage's fixer threshold."

### D6 — Portfolio child-gate semantics (OR-3)

Add to Step G a gate-resolution clause: "'Proceeds automatically (no human gate)' governs the **decompose decision only** — it does NOT suppress the children's own pipeline gates by default. Under portfolio orchestration, a child's `childPipeline` internal `gate: true` stages resolve per the **parent run's gate directive**: an auto run that the user launched autonomously (or that resolved decompose without a gate) treats child gates as **auto-continue checkpoints** — record each as taken, do not pause per child — UNLESS the user asked to be gated, in which case collapse them into ONE per-child checkpoint. State the precedence: parent directive > child pipeline `gate`." This reconciles auto.ts's "always pause at gate stages" (which governs a NON-portfolio run) with "proceeds automatically" (the decompose autonomy). Chosen default = auto-continue (autonomy is the point of a decompose run); the 9-pause literal reading is explicitly rejected.

### D7 — Tier-C degradations (OR-4, OR-14)

- **evaluate gate (OR-4):** Step L and goal-command's invariants gain a Tier-C branch — "Under Tier C (no subagent), author≠verifier for an `evaluate` gate degrades to a **second, freshly-reset single-context pass** seeded ONLY with `goal` + `rubric` + the artifact under judgment (NOT the implementation transcript), recorded as the Tier-C fallback. If even that is impossible, declare goal-loop-evaluate unsupported under Tier C rather than let the implementer self-certify." Step C's code-gate degrade explicitly does NOT apply to a subjective rubric.
- **parallelGroup (OR-14):** Step D gains "Under Tier C, run the group's members **sequentially** in the single context and collect all results before proceeding" — the concurrency is a Tier-A/B optimization, the collect-all-before-proceeding invariant is tier-independent.

### D8 — Goal-loop config holes (OR-5, OR-10, OR-12)

- **OR-5:** Step L Inject copies `maxRounds` (and `loopStallLimit` if the planner set it) from goal-plan.md into `iterate.loopConfig`, alongside the gate config. The planner's per-task cap stops being orphaned.
- **OR-10:** Step L reads `loop.runArtifact` (fallback `goal-run.json`) everywhere it currently hardcodes the filename. Instruction-text fix, not schema.
- **OR-12:** goal-command's define-goal guardrail generalizes: "confirm the goal + gate (the measure command **or** the evaluate goal/rubric) before any round runs" — so the gate is not read as vacuous on evaluate/research runs that have no command.

### D9 — Schema/policy contract fixes (OR-8, OR-11)

- **OR-8 (schema comment, acceptable per scope):** rewrite `ReuseThresholdSchema`'s doc from headroom language to **occupancy-ceiling**: "the maximum context occupancy (0,1] at which a worker may take on a whole new child change; stricter (lower) than the handoff threshold." This matches G.1.3's `pct ≤ threshold → reuse` and the "stricter than handoff" note @470. Prefer this over changing runtime behavior — the behavior (occupancy) is already correct; only the comment lies.
- **OR-11 (define, not remove):** define `verifyPolicy: standard` and `light` in auto §5 — "standard = a single verify pass, no review-cycle loop; light = skip verify entirely when the diff is trivial (docs/tests-only); adaptive (default) = scale the passes to diff size." Defining beats removing enum members (two shipped pipelines set `standard`; removal would be a breaking schema change touching yaml — out of the "no field changes" goal).

### D10 — PREAMBLE solo scope + LEAD authoring exception (SH-5, SH-7)

- **SH-5:** scope the PREAMBLE `solo` "investigate and offer to fix proactively / Default to action" (`_shared.ts:92`) and "ANY workflow step … Never let a noticed issue silently pass" (`:96/:98`) to **interactive / standalone** sessions. Enumerate-and-gate: add a clause naming the downstream absolute ("Default to action", "ANY workflow step", "Never let … silently pass") and carving out dispatched leaf workers — "When you are a dispatched leaf worker (one-unit-of-work dispatch; see the dispatched-mode contract), an out-of-scope issue you notice goes into your `DONE` durable-findings for the LEAD to triage — do NOT investigate or fix it yourself; the 'offer to fix' disposition is for interactive/standalone use, where you can actually reach the user." This extends child #1's `expert-dispatch-contract` (hence a delta there).
- **SH-7:** add one clause to the Step-22 opener — "you do not author **whole** stage artifacts; you MAY apply **trivial inline fixes** per Step E.2 (which are then re-reviewed by a non-author). A one-character typo does not warrant a fixer worker."

### D11 — OPTIONAL parity debt

Check current parity coverage of `ship.ts` / `verify-enhanced.ts` / `auto` / `goal` command templates. Commands are covered by the "teaches store selection in every deployed command template" test and (if present) content-parity. If ship/verify-enhanced/auto/goal lack content-parity entries, add them here (child #2 already added chrome-use); else relay to child #5 with a note. Decided in tasks after inspecting the registry.

## Risks / Trade-offs

- [Infra-revival mis-fires: a context death mis-classified as infra → wake a truly-full worker] → The taxonomy keys on the SIGNAL (returned HANDOFF/hit-limit = context; environment error/empty-return with intact transcript = infra); the wake message tells the agent to re-orient, and if it is genuinely full it will immediately HANDOFF (class a) on the next turn. Cheap to attempt, self-correcting.
- [Not charging infra revivals could mask a genuinely doomed stage that keeps erroring] → The overload backoff + the fact that a persistently unreachable agent falls through to (c) cold-reconstruct (which IS charged) bounds it.
- [Child-gate default = auto-continue could surprise a user who wanted per-child pauses] → Precedence is explicit and the parent directive wins; a gated launch collapses to one checkpoint per child, not zero.
- [Large parity churn across all playbook-embedding command templates] → Expected; tasks tail rebuilds and hand-pastes, confirming only auto/review-cycle/goal (+ PREAMBLE embedders for SH-5) moved.
- [Shared tree with other sessions] → explicit pathspec on ship, `git show --stat`, accept whole-file rebrand bundling per precedent.

## Migration Plan

Prompt-template + one schema doc-comment; no runtime/data migration. `pnpm build` (fallback `node build.js`) → `node dist/cli/index.js update` → `npx vitest run test/core/templates/` green with hand-pasted hashes → `validate`. Rollback = revert + regenerate.

## Open Questions

- Backoff specifics for the infra-revival overload wave (fixed vs exponential delay, max attempts) — left as guidance ("increasing delay; a handful of attempts, then fall through to cold reconstruct") rather than a hard number, since the platform's overload behavior varies. Recorded as intentional.
- OR-11: whether `light` should be reachable from any shipped pipeline today (none set it) — defined for completeness; if the portfolio later wants to drop it, that is a schema change for another child. Not blocking.
- Parity coverage for auto/goal/ship/verify-enhanced (D11) — resolved empirically in tasks; if it balloons scope, relayed to child #5.
