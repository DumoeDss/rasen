# Planning context — fix-run-state-worker-handles

## User intent (verbatim)
> "small-feature 把这两个缺陷深度挖掘，然后进行修复（同时看看这里还有没有其他隐藏的bug），全程由你推进，不要停下。开个worktree从main分支创建fix分支处理任务，最后开pr到main分支。"

i.e. Deeply investigate the **two defects** the LEAD already diagnosed (below), fix them, hunt for **other hidden bugs** in the same area, and ship via PR to `main` (`DumoeDss/OpenSpec`). Worktree `fix-worker-resume-handles` already created from `origin/main`.

## What this repo is
This IS the Rasen/OpenSpec TypeScript CLI (v0.1.2). It dogfoods its own workflow: every fix is a Rasen change under `rasen/changes/` (see `rasen/changes/archive/`). The orchestration **playbook text that the LEAD reads at runtime** is GENERATED from template strings in `src/core/templates/workflows/*.ts` (not hand-written markdown). Run-state is read/written/validated by `src/core/pipeline-registry/run-state.ts` and consumed by `src/commands/pipeline.ts` (`pipeline resume`). Tests: `test/**/*.test.ts`, runner = vitest. Build/lint: pnpm + `eslint.config.js`, `tsc` via `tsconfig.json`.

## The two defects (diagnosed from a real failing run's transcript)

### Evidence (session `a2f6314f-…`, one continuous session, NO compaction)
- Line 108: LEAD spawns implementer via the **Agent tool**, `name:"implementer"`, → agentId `a924bbb525d9b1dc9` (returned in the Agent result, line 119).
- Line 119: implementer returns DONE (clean).
- Line 146: LEAD calls `SendMessage` with `to:"implementer"` (**by NAME**).
- Lines 147–148: harness replies: **"No agent named 'implementer' is currently addressable. Spawn a new one or use the agent ID."**
- The implementer's transcript + meta are still intact on disk at `…\<session>\subagents\agent-a924bbb525d9b1dc9.{jsonl,meta.json}`.
- The run-state the LEAD wrote recorded the worker as `{ "role":"implementer", "runtime":"claude", "name":"implementer" }` — **no `agentId`, no `transcript`**.

### Defect #1 — run-state worker records lack durable handles
- The LEAD recorded a `name` field (not even in the schema) instead of the durable `agentId` + `transcript`. The Agent tool result DID contain the agentId, so the information was available — the LEAD just didn't persist it.
- **Code consequence:** `src/core/pipeline-registry/run-state.ts` `collectStageWorkers` only surfaces workers with `agentId || transcript || threadId` (see ~line 314). A name-only record is **silently dropped** → the worker is invisible to `rasen pipeline resume` → no warm-seed pointer, forced cold reconstruction. This is the real-world harm.
- The `Worker` schema (~line 44: `role`/`agentId`/`transcript`/`threadId`, all optional) and its doc comment (~lines 30–43) are already correct. The gap is: (a) the **playbook text** doesn't force the LEAD to capture `agentId`+`transcript` from the Agent result, and (b) there is **no validation/warning** when a worker record lacks a durable handle (no `doctor` check, no resume warning), so the mistake passes silently.

### Defect #2 — the "within-session SendMessage revives a completed worker" claim is wrong
- The playbook (generated from `src/core/templates/workflows/_orchestration.ts`) states in Step A (~line 26) and Step F.1 (~lines 174, 183, 264 — the "two are the SAME mechanism" note) that within a live session, `SendMessage`-ing a **completed** worker revives it from its transcript.
- The transcript **contradicts** this for name-based addressing: a completed Agent-tool subagent was NOT name-addressable 27 messages later in the same un-compacted session. The harness error itself distinguishes name from agentId ("…or use the agent ID"), implying **agentId** is the more durable live handle and **name** is not.
- Fix direction: the playbook must (a) instruct the LEAD to record `agentId`+`transcript` on every dispatch; (b) on re-engagement, try `SendMessage` by **agentId** (not name), and treat name-only as insufficient; (c) correctly characterize that a completed Agent-tool subagent may not be name-addressable even within the same session — fall back to transcript warm-seed (Tier-B path) rather than assuming revival. Align the code comments in `run-state.ts` (~lines 34–43) and `pipeline.ts` (~lines 423–425) with this.

## Hidden-bug leads to investigate (planner + reviewer should dig here)
1. **`collectStageWorkers` silent drop** (`run-state.ts` ~314): name-only or role-only worker records vanish from resume output with no warning. Should resume/`doctor` warn "stage X worker has no durable handle"?
2. **`name` field is not in the `Worker` schema**, yet the LEAD invented it. Either accept+map `name` → handle, or have validation reject/flag unknown worker fields so the drift is caught.
3. **Tier detection honesty:** the failing run self-recorded `"tier":"A"` (agent-teams), yet name-based `SendMessage` to a completed worker failed. Is Tier A over-claimed when `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` is unset, or does agent-teams genuinely not keep *completed Task-subagents* name-addressable? Check `src/core/claude-settings.ts` and wherever `tier` is resolved/probed.
4. **Duplicate JSON keys in auto-run.json** (the failing run had dup `propose`/`verify`/`rounds` keys). This comes from the LEAD rewriting run-state imperfectly. Is there schema validation / a canonical writer that could prevent or detect duplicate keys? Check if `rasen doctor` or resume validates run-state JSON.
5. **Step B dispatch prompt** (`_orchestration.ts`): does it explicitly tell the LEAD to capture `agentId` + `transcript` from the Agent tool's result and write them into the worker record? If not, that's the root instruction gap behind defect #1.
6. **H.4a(b) infra-death revival via SendMessage** and **H.4b unticked-DONE SendMessage** (`_orchestration.ts` ~263–265 region) — these also assume SendMessage-by-name/agentId reaches a completed/idle worker within session; reconcile with the empirical behavior.

## Constraints / decisions already made
- Schema: `spec-driven`. Capability: most naturally **`orchestration-worker-lifecycle`** (already exists under `rasen/specs/`) — extend it; or add a focused `run-state-worker-handles` capability. Planner decides; keep delta minimal.
- Keep changes **backward-compatible**: existing archived `auto-run.json` files must still parse. The `Worker` schema already optional — don't make fields required; add validation as *warnings*, not hard errors.
- Tests must be updated/added in `test/core/pipeline-registry/run-state.test.ts` and `test/commands/pipeline.test.ts` (both already exist and reference `agentId`).
- No breaking CLI changes. `pnpm test` (vitest) must stay green; `pnpm lint` / `tsc` clean.
- Delivery: PR to `main`. Branch `worktree-fix-worker-resume-handles` already exists in the worktree.

## Durable findings (carry forward)
- The playbook is **generated from `src/core/templates/workflows/*.ts`** — to "fix the playbook text" you edit those TS template strings, not markdown. `auto.ts`, `handoff.ts`, `review-cycle.ts`, `_orchestration.ts` all contribute.
- Run-state for this repo lives in the **change directory** (sticky-legacy; no external workDir resolved for the worktree). Historical precedent: archived changes keep `auto-run.json` in-tree.
