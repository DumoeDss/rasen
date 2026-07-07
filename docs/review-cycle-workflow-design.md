# Design: the `review-cycle` workflow — iterative review → fix → re-review

> Status: design draft · Date: 2026-05-29
> Scope: introduces a first-class **iterative** post-implementation review loop into OpenSpec, bridging the gap between the existing `review`/`verify-enhanced`/`ship` one-shot stages. The core stays tool-agnostic, complemented by one Claude Code agent-teams acceleration capability.
>
> This is a design document (in `docs/`). It is written so it can be promoted into an OpenSpec change (`openspec/changes/add-review-cycle-workflow/`) — see [§9 Promote to an OpenSpec change](#9-promote-to-an-openspec-change).

---

## 1. Motivation

OpenSpec's flow is `propose → apply → archive`, and the OPSX/gstack fusion work added expert skills and runtime commands:

- **Planning-phase review** is covered by the propose workflow's methodology consultation for design-intensive changes (`/codebase-design`, conditionally referenced); `schemas/spec-driven/schema.yaml` no longer carries any `enhance` hook (mechanism retained, currently no consumers).
- **One-shot code review** exists as the always-installed expert skill `openspec-review` (source: `src/core/templates/experts/review.ts`).
- **Validation / delivery** exist as fusion commands (`verify-enhanced`, `ship`) — see the in-progress change `openspec/changes/add-opsx-fusion-commands/`.

**Missing** is a first-class **iterative loop** that, after `apply`, wires these stages together:

1. **No enforced `fix → re-review` loop.** `review` can produce a findings list, but there is no structured mechanism to drive "fix these issues, then **re-review only the delta**, repeat until clean". Fixes may land without validation.
2. **No "author ≠ verifier" invariant.** The person who implements (or fixes) a change can also be the one who declares it clean. Independent verification of *the fix itself* is not guaranteed.
3. **Re-review is expensive.** Re-running a full review after each fix re-reads everything. With the now-available Claude Code agent-teams `SendMessage`, the original reviewer subagent can be **resumed** to check only the fix delta — cheap and focused — yet no OpenSpec workflow currently takes advantage of this.

`review-cycle` fills exactly this loop, reusing the existing `review` engine and staying aligned with the fusion direction.

---

## 2. What changes (overview)

- **New runtime workflow** `review-cycle` (`/opsx:review-cycle`, skill `openspec-review-cycle`), generated for all supported tools through the existing template → adapter pipeline.
- It orchestrates: **review → triage → fix → re-review(Δ) → {pass | loop | escalate}**, delegating actual review judgment to the existing `openspec-review` skill and fixes to the agent implementing the change.
- It encodes the **author ≠ verifier** invariant and a **fix-size triage** (trivial / non-trivial / design-level).
- Optional **Claude Code acceleration**: resume the reviewer subagent via `SendMessage` to re-review only the delta; plus a **graceful, tool-agnostic fallback** for all other tools (a fresh review scoped to the delta + a shared findings file).
- **Does not change the core schema or the artifact graph** — this is a runtime loop on the command/skill axis, not a planning artifact (see §4).
- Profile: ships in the **expanded/opt-in** set (not in `core`), consistent with the other fusion commands.

Non-goals: replacing `review`/`verify-enhanced`/`ship` (it composes with them); forcing the loop into the artifact DAG; making agent-teams a hard dependency.

---

## 3. Where it fits — OpenSpec's two extension axes

| Axis | Mechanism | Purpose |
| --- | --- | --- |
| **Schema axis** | `schemas/<name>/schema.yaml`: artifacts (`id/generates/template/instruction/requires/enhance/provider/context-from`) + `apply` (`requires/tracks/instruction`). Graph = `ArtifactGraph` (`src/core/artifact-graph/graph.ts`), Kahn topological sort, "enablers not gates". | **Planning-phase, file-producing** steps (proposal, specs, design, tasks). Planning review rides on this axis via the `enhance:` skill. |
| **Command/skill axis** | `src/core/templates/workflows/*.ts` → `src/core/templates/skill-templates.ts` → `src/core/shared/skill-generation.ts` → `src/core/profiles.ts` → tool adapters (`src/core/command-generation/adapters/`). | **Runtime, iterative** behavior (propose, apply, archive, verify-enhanced, ship, etc.). |

**Decision: `review-cycle` is a command/skill-axis workflow, not a schema artifact.** Rationale:

- The loop is **iterative and runtime** — it runs against the working tree/diff *during/after* implementation and may repeat N times. The artifact graph models a *one-shot file DAG*, not a loop.
- Modeling it as a single `review.md` artifact would cause: (a) loss of iteration, (b) loss of per-fix re-review, and (c) "done" to equal "file exists" rather than "findings resolved and independently confirmed".
- It composes with the existing `apply` stage: `apply` implements the tasks; `review-cycle` is the recommended **next runtime step** before `verify-enhanced`/`ship`/`archive`.

(Planning-phase review stays on the schema axis via `enhance:` — unchanged.)

---

## 4. The loop

```
                      ┌──────── orchestrator / lead agent (the only SendMessage hub) ────────┐
                      │                                                                       │
  apply (done) ─▶ review ─▶ triage ─▶ fix ─▶ re-review(Δ) ─▶ ┬─ pass ──▶ verify-enhanced ─▶ ship/archive
                   │         │         │        │            │
                   │         │         │        ├─ findings remain ─▶ (loop: triage → fix → re-review)
                   │         │         │        └─ max rounds reached ─▶ escalate to human
                   │         │         │
          `openspec-review`  │   implementing agent      resume original reviewer (Δ only)
            expert skill     │   (or orchestrator inline  via SendMessage if available;
                             │    for trivial)            else fresh delta review + findings file
                       fix-size triage (§4.2)
```

### 4.1 Steps

| Step | What it does | Engine |
| --- | --- | --- |
| **review** | Reviews the implemented diff against the change's specs/tasks; produces a findings list by severity (Blocker/Major/Minor), each tied to a file:line and (where possible) to a canonical `#### Scenario`. | Reuses `openspec-review` (`src/core/templates/experts/review.ts`). |
| **triage** | Classifies each actionable finding by fix size (§4.2) to decide who fixes it. | review-cycle instruction. |
| **fix** | Applies the fix. | Non-trivial fixes by the (resumed) implementing agent; trivial fixes inline by the orchestrator; design-level fixes by a fresh fixer agent. |
| **re-review(Δ)** | **Re-checks only the fix delta** against the original findings list; confirms resolved and no regression. | Resumed original reviewer (Claude), or a fresh delta review (other tools). |
| **decision** | All findings resolved and confirmed → exit to `verify-enhanced`/`ship`. Findings remain → loop. Max rounds reached → escalate to human. | review-cycle instruction. |

### 4.2 Fix-size triage (who fixes — the verifier is always someone else)

| Category | Heuristic | Who fixes | Required re-check |
| --- | --- | --- | --- |
| **trivial** | Rename / delete dead code / single-call-site substitution; no behavior change | orchestrator inline | orchestrator re-runs the gates + reads the diff (the non-author check) |
| **non-trivial** | Logic/behavior change | resumed implementing agent (context retained) | resumed reviewer re-reviews the delta |
| **design-level** | Needs a re-decision / cross-cutting impact | fresh fixer agent (separate from the implementer) | reviewer re-reviews the delta |

### 4.3 Invariant — author ≠ verifier

> The agent/persona that produces a fix MUST NOT be the sole confirmer that the fix is correct. The re-review MUST be performed by a different reviewer persona; for the trivial/inline path, the orchestrator's independent gate re-run + diff read is the equivalent non-author check, and MUST be recorded.

Tool-agnostic formulation (works for any tool): *"A finding is only resolved when a reviewer who did not author the fix confirms it against the original finding."*

### 4.4 Termination

Max rounds (default **3**). When the cap is reached with unresolved Blocker/Major findings, the loop **stops and escalates to the human with the residual findings** — it never silently passes.

---

## 5. Claude Code acceleration (agent-teams) + tool-agnostic fallback

OpenSpec targets ~24 tools; `SendMessage`/agent-teams are **Claude-Code-exclusive** (gated by `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`). So the loop is specified tool-neutrally, and the resume mechanism is just an *optimization*:

- **Claude Code, toggle on, within the same session:** the workflow retains the reviewer subagent's `agentId`; on re-review(Δ), **the orchestrator/lead resumes that reviewer via `SendMessage`**, attaching only the fix delta + a reference to the original findings list. The reviewer keeps its full prior context → cheap, focused, no re-read. (Constraint: only the lead can issue `SendMessage`, so coder↔reviewer never talk directly — the orchestrator is the hub.)
- **Cross-session (after a restart / `--resume`) — transcript warm-seeding:** `SendMessage` **only works in-session**; the previous session's worker is gone (`agentId` is a dead handle). Here the lead does not `SendMessage`; instead it reads the reviewer's **persistent transcript** (`agent-<agentId>.jsonl`) back in and **warm-seeds** a fresh same-role reviewer — new `agentId`, but carrying the predecessor's full context, still re-reviewing only the delta. run-state recording each worker's `agentId` + `transcript` pointer per stage is exactly for this; `openspec pipeline resume`'s `workers` field surfaces these pointers. This is the closest thing to "truly resuming the reviewer" the platform allows.
- **Any other tool, or toggle off, or transcript stale:** fall back — run a **fresh review scoped to the delta**, passing the original findings list through a shared file (e.g. the change's `review.md` / `FINDINGS.md`). Behaviorally equivalent, just more expensive.

The generated Claude skill (`.claude/skills/openspec-review-cycle/SKILL.md`) documents the resume path; the generic skill body documents the fallback path. All of this is expressed as instruction text — **there is no tool-specific code in OpenSpec core**, consistent with the adapter model.

---

## 6. Implementation plan (concrete, aligned with the real pipeline)

> Mirrors how `verify-enhanced`/`ship` were introduced (in-progress change `add-opsx-fusion-commands`).

1. **New workflow template** `src/core/templates/workflows/review-cycle.ts`
   - `export function getReviewCycleSkillTemplate(): SkillTemplate` — tool-agnostic loop instructions (§4) + Claude resume guidance + fallback (§5). References and calls `openspec-review` as the review engine.
   - `export function getOpsxReviewCycleCommandTemplate(): CommandTemplate` — `name: 'OPSX: Review Cycle'`, `category: 'Workflow'`, `tags: ['workflow','review','experimental']`, identical content.
2. **Export** from `src/core/templates/skill-templates.ts`:
   `export { getReviewCycleSkillTemplate, getOpsxReviewCycleCommandTemplate } from './workflows/review-cycle.js';`
3. **Register** in `src/core/shared/skill-generation.ts`:
   - Add to `getSkillTemplates()`'s `workflowSkills`: `{ template: getReviewCycleSkillTemplate(), dirName: 'openspec-review-cycle', workflowId: 'review-cycle' }`
   - Add to `getCommandTemplates()`: `{ template: getOpsxReviewCycleCommandTemplate(), id: 'review-cycle' }`
   - Add the import at the top of the file.
4. **Profiles** `src/core/profiles.ts`: add `'review-cycle'` to `ALL_WORKFLOWS`. Exclude it from `CORE_WORKFLOWS` (opt-in, consistent with the other fusion commands).
5. **Reuse, don't duplicate, the review engine**: the instructions call the existing `openspec-review` expert skill (always installed) to make review/re-review judgments; review-cycle only handles *loop + triage + invariant + termination + resume*.
6. **Adapters**: no changes — generation fans out to all tools automatically; the Claude adapter produces `.claude/skills/openspec-review-cycle/SKILL.md` + `.claude/commands/opsx/review-cycle.md`.
7. **Optional schema hint (separate, optional)**: a forked schema `spec-driven-reviewed` whose `apply.instruction` points `/opsx:review-cycle` as the recommended next step. **Do not** modify the core `spec-driven` schema. This is purely advisory; the workflow runs without it.
8. **Docs**: once implemented, add user-facing sections to `docs/commands.md` + `docs/workflows.md` (and `docs/zh/` mirrors); this design document is its rationale.

### Files touched
- New: `src/core/templates/workflows/review-cycle.ts`.
- Edited: `src/core/templates/skill-templates.ts`, `src/core/shared/skill-generation.ts`, `src/core/profiles.ts`.
- New test: `test/commands/review-cycle.test.ts` (plus assertions in skill-generation/profile tests).
- Docs: for now this file; fill in `docs/commands.md` / `docs/workflows.md` (+ zh) at implementation time.
- Unchanged: `schemas/spec-driven/**`, artifact-graph code, archive/validate core.

---

## 7. Test strategy (follows repo conventions — vitest, temp filesystem, no snapshots)

- **Generation**: a test verifying `getSkillTemplates()`/`getCommandTemplates()` include `review-cycle`, and that `openspec init --tools claude` (output to a temp dir) materializes `.claude/skills/openspec-review-cycle/SKILL.md` + `.claude/commands/opsx/review-cycle.md`.
- **Profile filtering**: `review-cycle` present under expanded/custom, absent under `core` (it is opt-in).
- **Adapter fan-out**: spot-check 2–3 other tool adapters to confirm they also produce the command/skill.
- **Instruction-content invariants**: the generated skill text should include the author≠verifier rule, the max-rounds/escalation clauses, and **both** the Claude resume path and the tool-agnostic fallback path.
- Follow `test/commands/*.test.ts`: `os.tmpdir()`, `XDG_CONFIG_HOME` isolation, `vi.resetModules()`, dynamic `import()`. No snapshots.

---

## 8. Open questions

1. **Core vs expanded profile** — proposed: expanded/opt-in. Needs maintainer confirmation (consistent with the fusion-command precedent).
2. **Standalone command vs folding into `verify-enhanced`** — `verify-enhanced` already runs a multi-stage validation pass; should `review-cycle` be its sibling, or should the loop be folded into `verify-enhanced`? Proposed: **sibling** (single responsibility = iterative fix loop), composed before `verify-enhanced`. Needs a decision.
3. **How to express "author ≠ verifier" for tools without addressable subagents?** For tools with no separate reviewer persona, the invariant degrades to "an independent review of the delta passes" + the orchestrator's independent gate re-run. This degradation must be explicitly documented.
4. **Default max rounds** (proposed 3), and whether it is configurable via `openspec/config.yaml`'s `rules`.
5. **Relationship/ordering with the in-progress `add-opsx-fusion-commands` change** — should `review-cycle` be added *into* that change, or land after it as its own standalone change? Proposed: as a standalone change depending on the fusion change (so the gstack `review` skill it reuses exists by then).

---

## 9. Promote to an OpenSpec change

OpenSpec dogfoods itself (`openspec/changes/`). To turn this design into a tracked change (the maintainer convention for a feature of this scope):

```bash
cd <OpenSpec-code>
openspec new change add-review-cycle-workflow      # or: /opsx:propose "add review-cycle iterative review→fix→re-review workflow"
```

Then fill in:
- `proposal.md` — §1 motivation, §2 changes, capabilities (`New: review-cycle-workflow`), Impact (§6 files touched).
- `design.md` — §3–§5 (axis decision, loop, agent-teams + fallback).
- `tasks.md` — §6 steps as a checklist + §7 testing.
- `specs/review-cycle-workflow/spec.md` — delta requirements, e.g.:

```markdown
## ADDED Requirements

### Requirement: Iterative review→fix→re-review loop
The `review-cycle` workflow SHALL drive review → fix → re-review iterations until all Blocker/Major findings are resolved and independently confirmed, or a maximum round count is reached.

#### Scenario: Fix is independently re-reviewed
- **WHEN** a finding from the review step is fixed
- **THEN** the fix is confirmed by a reviewer who did not author the fix
- **AND** the confirmation checks the fix against the original finding

#### Scenario: Unresolved findings escalate, never silently pass
- **WHEN** the maximum round count is reached with unresolved Blocker/Major findings
- **THEN** the workflow stops and surfaces the residual findings to the human
- **AND** does not report the change as review-clean

### Requirement: Tool-agnostic with optional Claude acceleration
The workflow SHALL be expressed tool-agnostically; on Claude Code with agent-teams enabled it MAY resume the original reviewer to re-review only the delta, and MUST fall back to a fresh delta review (with findings passed via a shared file) when resume is unavailable.

#### Scenario: Resume unavailable degrades gracefully
- **WHEN** the agent-teams resume capability is unavailable
- **THEN** the re-review is performed as a fresh review scoped to the fix delta
- **AND** the loop's outcome is equivalent (only more expensive)
```

Validate + apply + archive through the normal `openspec validate` / `/opsx:apply` / `openspec archive` flow.

---

## 10. References (real paths in this repo)
- Schema model: `schemas/spec-driven/schema.yaml`; graph `src/core/artifact-graph/graph.ts`, types `src/core/artifact-graph/types.ts`, loader `src/core/artifact-graph/instruction-loader.ts`.
- Command/skill pipeline: `src/core/templates/workflows/*.ts`, `src/core/templates/skill-templates.ts`, `src/core/shared/skill-generation.ts`, `src/core/profiles.ts`, adapters `src/core/command-generation/adapters/`.
- Reused review engine: `src/core/templates/experts/review.ts` (installed as `openspec-review`).
- Fusion precedent: `openspec/changes/add-opsx-fusion-commands/` (office-hours, verify-enhanced, ship, retro, auto + `hooks/safety-check.sh`).
- Doc conventions: `docs/concepts.md`, `docs/opsx.md`, `docs/commands.md`, `docs/workflows.md`, `docs/customization.md` (+ `docs/zh/`).
- Tests: `test/commands/*.test.ts`, `vitest.config.ts`.
