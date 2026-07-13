# Goal Plan — codex-parity-research

## Goal

Produce a research dossier at `docs/codex-parity/` that maps EVERY Claude-Code-specific capability rasen's orchestration relies on (the numbered inventory below) to a concrete, live-tested Codex CLI (codex-cli 0.144.1) counterpart or workaround — each backed by real experiment evidence (actual codex commands + captured output) or, where live testing is impossible, an explicit justified `code-analysis-only` / `impossible-needs-emulation` verdict with an emulation design. This run produces the plan/solutions for future development; it does NOT implement any gap in rasen source code.

## Capability Inventory (Claude-Code-specific assumptions rasen makes)

Sources verified in code: `src/core/templates/workflows/_orchestration.ts` (the LEAD playbook — Steps A/A.1/B/B.1/E/L/F/F.1/G/G.1/H), `src/core/templates/workflows/goal-command.ts`, `src/core/agent-context.ts`, `src/core/command-generation/adapters/codex.ts`, `src/core/pipeline-registry/types.ts` (stage `runtime` / `agents.<role>` resolution), `src/core/templates/experts/codex.ts` (the existing `/codex` second-opinion skill — the only live-tested Codex usage today).

For each item, "a solution" must specify: the exact Codex command / API / config (flags, JSON-RPC method, file path), the resume/identity handle it yields, how the LEAD captures structured output from it, its failure modes, and — if no direct counterpart exists — the emulation design rasen would implement.

1. **Subagent spawning (Task tool), role isolation, flat hierarchy.** LEAD dispatches leaf workers via Task with a role prompt; workers cannot spawn sub-workers. Solution must specify: how a Claude LEAD launches a Codex worker non-interactively (`codex exec` vs `codex app-server` newThread/turn), how role isolation is preserved (one thread per role), and how "do not spawn agents" is enforced or moot in Codex.
2. **Parallel dispatch (`parallelGroup`).** Multiple workers run concurrently and all results collect before proceeding. Solution: can multiple `codex exec` / app-server turns run concurrently in one repo? Locking, sandbox contention, `~/.codex` state races — tested with at least 2 simultaneous runs.
3. **Warm continuation / SendMessage (Tier A).** LEAD re-engages a LIVE worker with a new message (delta re-review, goal-loop warm-reused implementer, planner reuse). Solution: the Codex equivalent of continuing the same conversation — `codex exec resume <session-id>` / `--last`, or app-server sending a new turn to an existing threadId — with evidence that the resumed run actually retains prior-turn context (probe: teach it a fact in turn 1, ask it back in turn 2).
4. **In-session revival after infra death (Step H.4a(b)) and DONE-with-unticked-tasks nudge (H.4b).** SendMessage to a completed/interrupted worker revives it. Solution: does resuming an interrupted/errored Codex session work (kill a run mid-turn, then resume)? What state survives?
5. **Transcript occupancy probe (`rasen agent context --transcript`).** `agent-context.ts` reads Claude JSONL transcripts' last `message.usage` (input + cache_read + cache_creation tokens) / contextWindow → pct, driving handoff thresholds (0.5), reuse thresholds (0.25), and research relay (0.35). Solution: do `~/.codex/sessions` rollout JSONL files record per-turn token usage / context-window occupancy? Exact JSON path to the fields, or the app-server event that carries them; else an emulation design (e.g. token estimation or turn-count proxy) with stated accuracy limits.
6. **Cross-session resume via transcript warm-seed (Step F.1).** Glob `agent-<agentId>.jsonl` + `.meta.json` role sidecar, read back findings, seed a fresh worker. Solution: locating a Codex session file by session/thread id after a restart, whether `codex exec resume <id>` works across process/session boundaries, and how to extract "what the predecessor established" from the rollout format.
7. **Skill / slash-command invocation inside workers.** Dispatch prompts say "Use the Skill tool to invoke <skill>"; commands are `/rasen:*`. The Codex adapter already writes `~/.codex/prompts/rasen-<id>.md` (CODEX_HOME override respected). Solution: verified frontmatter spec for Codex custom prompts, how a prompt is invoked interactively AND whether/how `codex exec` can execute one non-interactively (or the workaround: inline the skill body into the exec prompt), and argument passing.
8. **Structured worker returns (DONE/HANDOFF contract; evaluate gate `{satisfied, gaps}` JSON).** The LEAD parses a worker's final message. Solution: reliable capture of a Codex run's final message (`--output-last-message`, JSONL event stream, app-server turn result), and a prompt/parse convention that yields machine-readable DONE/HANDOFF and gate JSON, with observed failure modes.
9. **Model / reasoning-effort per-dispatch overrides.** Rasen assigns model per role (fable vs sonnet analog). Solution: `-m/--model`, `-c model_reasoning_effort=...`, config.toml profiles — which models are available under this auth, and the exact per-invocation override syntax (the existing `/codex` skill already uses `-c 'model_reasoning_effort="xhigh"'` — verify it on 0.144.1).
10. **Sandbox / permission-mode semantics per role.** Playbook: `workspace-write` for artifact-writing roles, `read-only` for reviewers; Claude side assumes permission modes + hooks. Solution: live-verify `--sandbox read-only|workspace-write|danger-full-access` and approval-policy flags actually block/allow writes as the playbook assumes; note network access defaults and escape hatches.
11. **Project context injection (CLAUDE.md analog).** Solution: AGENTS.md discovery rules (repo root? nested? global `~/.codex/AGENTS.md`?), size behavior, and whether rasen's per-change context (`rasen/changes/<name>/`) is best passed by prompt reference (verify the worker actually reads it).
12. **Programmatic bridge: `codex app-server` JSON-RPC and MCP mode.** The playbook names "Codex app-server threads", `threadId`/`turnId` records, and "the Rasen Codex bridge when available" — designed, untested. Solution: a live app-server session log (initialize, newThread/resumeThread, sendTurn or equivalent methods AS THEY ACTUALLY EXIST in 0.144.1 — method names must come from the experiment, not the seed list), event stream shape, cancellation, and whether `codex mcp` (Codex as an MCP server callable FROM Claude Code) is the better bridge for the LEAD=Claude case.
13. **Session relay — LEAD spawns a successor interactive session with a seeded prompt (Step H.7).** Solution: the Codex counterpart (new interactive `codex` with an initial prompt / `codex resume`), or a verdict that session relay stays Claude-only with Codex workers unaffected.
14. **Run-state & gates (auto-run.json / goal-run.json, `rasen pipeline resume`, gate pauses).** These are file-based and largely runtime-agnostic, but Codex worker records need `runtime=codex, threadId, turnId` + sandbox/model metadata (Step B/F). Solution: confirm what identity fields a real run yields (where does the session/thread id appear in `codex exec` output?) so run-state records are resumable; identify anything in the gate/pause flow that breaks when a worker is Codex.

Items 1–12 and 14 require live experiments (Codex is installed and authenticated). Item 13 may resolve to code-analysis + a small live check. Any other CLI (Gemini, etc.) is out of scope — Codex only.

## Gate

### evaluate

- goal: The dossier at `docs/codex-parity/` gives future development a complete, evidence-backed, actionable Codex counterpart or emulation design for every inventory item above.
- rubric (a fresh reviewer judges each round; ALL must hold for satisfied=true):
  1. **Coverage with evidence.** Every inventory item (1–14) has a solution entry under `docs/codex-parity/solutions/` that either (a) cites live experiment evidence — actual codex commands run and captured output/excerpts — or (b) carries an explicit `code-analysis-only` or `impossible-needs-emulation` verdict with a justification AND a concrete emulation design rasen could implement. No item may be silently absent or hand-waved ("should work") without a run.
  2. **Actionability.** Each solution states the exact commands/flags/JSON-RPC methods/config keys, the resume/identity handle (session id / threadId), how structured output is captured, and observed failure modes — enough that an implementer could code against it without re-running the experiments.
  3. **Experiment logs.** `docs/codex-parity/experiments/` contains one log per experiment with: purpose, exact command(s), environment notes, captured output (trimmed but genuine), observed result, and reproduction steps. Solutions reference their experiments by filename.
  4. **Index.** `docs/codex-parity/README.md` is an index table mapping each inventory item number → solution file → status (`live-verified` | `code-analysis-only` | `needs-emulation`) → key experiment(s). A reader can audit coverage from the README alone.
  5. **Honesty.** Negative results (a Codex feature that does NOT exist or does NOT behave as the playbook assumed) are recorded as findings, not omitted; version-pinned to codex-cli 0.144.1.

## Work Product

prose — research + a document tree at `docs/codex-parity/` (README.md index, experiments/, solutions/). No rasen source-code edits. Experiment scratch runs happen in the scratchpad or a throwaway sandbox dir; logs are copied into the dossier. Experiments must be non-destructive to this repo and to `~/.codex` (read config, don't rewrite it; run codex against throwaway dirs when testing writes/sandbox).

## maxRounds

5

## loopStallLimit

2

## Model policy (LEAD enforces; recorded per user directive 2026-07-12)

Solution-authoring / planning subagents = **fable**; executing / experiment-running subagents = **sonnet**. In this run the goal-loop implementer (runs codex experiments, writes logs) is sonnet; the evaluate-gate reviewer and any solution-synthesis dispatches are fable per the LEAD's discretion under this policy.

## Round-1 experiment plan sketch (for the implementer)

Start with the highest-leverage primitives; each experiment gets its own log file.

1. **E01 — baseline exec:** `codex exec "…" ` in a throwaway dir; capture stdout, locate the session id in output and in `~/.codex/sessions`/`history.jsonl`; try `--output-last-message` and JSON/JSONL output flags (`codex exec --help` first — record the real flag surface of 0.144.1).
2. **E02 — resume/warm continuation (items 3/4/6):** teach a fact in run 1, `codex exec resume <id>` (and `--last`) asking it back; then kill a run mid-turn and resume; then resume from a NEW shell/process.
3. **E03 — rollout transcript anatomy (item 5):** open the session JSONL; hunt for token-usage fields; document the schema.
4. **E04 — sandbox modes (item 10):** attempt a file write under `--sandbox read-only` vs `workspace-write`; record enforcement behavior.
5. **E05 — model/effort overrides (item 9):** `-m` and `-c model_reasoning_effort=…` variants; record accepted values/errors.
6. **E06 — custom prompts (item 7):** drop a test prompt in `$CODEX_HOME/prompts/` (use a temp CODEX_HOME to avoid touching the real one), verify discovery and exec-mode invocability.
7. **E07 — app-server probe (item 12):** start `codex app-server`, speak JSON-RPC over stdio, discover the real method set, run one full thread lifecycle.
8. **E08 — parallel runs (item 2):** two simultaneous `codex exec` in the same repo; watch for lock/state contention.

Rounds 2+ close whatever the evaluate reviewer flags: typically MCP mode, AGENTS.md rules, structured-return conventions under real prompts, and the per-item solution write-ups.
