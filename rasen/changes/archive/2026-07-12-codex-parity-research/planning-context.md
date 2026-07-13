# Planning Context — codex-parity-research

## User intent (verbatim, 2026-07-12)

> 我们当前把openspec的fork独立升级为了rasen，由于开发时都是使用claudecode，因此claudecode目前是能完美匹配我们的rasen项目（比如主agent控制在某些阶段激活同一个subagent来复用上下文而不是全部使用新subagent等），对于很多rasen新增的功能，我对于其他的codecli都没有经过测试。因此希望你来对codex进行实机探索测试，找到能够应用我们rasen所有功能的对应的方案（当前我们系统安装过的另一个codecli，其他的codecli没有安装因此没法实机测试，只能调整代码），这次的目标不是直接实现codex的缺口，而是不停的试验，找到补全所有缺口的方案，记录试验内容与最终方案，保存到文件夹中，供后续开发使用。

## Key decisions / constraints already made

- **Deliverable is a research dossier, NOT code changes.** Goal = a folder of experiment logs + final per-gap solutions, consumable by future development. No implementation of the gaps in this run.
- **Live testing scope**: Codex CLI only — it is the only other code CLI installed on this machine. Other CLIs: code-analysis-only, out of scope for live experiments.
- **Model assignment (user-specified)**: 方案/planning subagents = fable; 执行/experiment subagents = sonnet.
- **Method**: iterative experimentation ("不停的试验") — run real Codex invocations, observe, record, converge on a mapping for EVERY rasen capability that currently assumes Claude Code.

## Environment facts (verified by LEAD)

- `codex` at `/Users/sayo/.nvm/versions/node/v24.13.0/bin/codex`, version **codex-cli 0.144.1**, `~/.codex/` populated (auth.json present → authenticated; config.toml, history.jsonl, sessions).
- Repo: /Users/sayo/repos/rasen (the rasen product itself — an OpenSpec fork with heavy multi-agent orchestration built on Claude Code).
- Rasen already has partial Codex awareness: the goal/auto playbooks have a Step A.1 runtime resolution (claude|codex), Codex worker records `threadId`/`turnId`, mentions "Codex app-server threads", a "Rasen Codex bridge when available", and `/codex:rescue` plugin commands. These are DESIGNED but largely UNTESTED — that is the gap this research closes.

## Claude-Code-specific capabilities rasen relies on (seed list — planner should verify/extend by reading the skills/ and src/ tree)

1. Subagent spawning (Task tool) with role isolation; flat hierarchy.
2. **Warm continuation / SendMessage** to a live agent (Tier A agent-teams) — the "复用上下文" the user highlighted.
3. Transcript files (`agent-<id>.jsonl`) + `rasen agent context --transcript` occupancy probe → handoff thresholds, warm-seed resume across sessions.
4. Skill/slash-command invocation inside workers (`Skill` tool, /rasen:* commands).
5. Gates/pauses, run-state (auto-run.json / goal-run.json), pipeline resume.
6. Session relay (LEAD spawns successor session with seeded prompt).
7. Model/effort per-dispatch overrides; parallel dispatch.
8. Hooks / permission modes / sandbox semantics assumed by ship/apply stages.

## Codex-side primitives to experiment with (seed list)

- `codex exec` non-interactive runs; `codex exec resume <session>` / `--last`; session/thread ids; `~/.codex/sessions` rollout files (JSONL transcripts).
- `codex app-server` (JSON-RPC) — thread lifecycle, turn ids, structured events; the programmatic bridge path.
- `codex mcp` / MCP server mode; config.toml profiles; `--sandbox` modes (read-only / workspace-write); model selection flags; AGENTS.md as CLAUDE.md analog.
- Prompts/custom commands (~/.codex/prompts) as skill analog.

## Output location decision

Research dossier lives at `docs/codex-parity/` in-repo (experiments/ + solutions/ + README index), so future development finds it. Experiment scratch runs happen in the scratchpad or a throwaway sandbox dir, with logs copied into the dossier.

## Planner findings (appended 2026-07-12, define-goal stage)

- **The seed list was incomplete.** Reading `src/core/templates/workflows/_orchestration.ts` surfaced 14 distinct Claude-Code assumptions (goal-plan.md inventory). Beyond the seed: parallel-dispatch contention (parallelGroup), in-session revival of errored workers (H.4a(b)/H.4b), structured DONE/HANDOFF + evaluate `{satisfied,gaps}` parsing, and per-role sandbox mapping (workspace-write vs read-only, already written into the playbook at Step B but never live-verified).
- **The occupancy probe is the hardest gap.** `src/core/agent-context.ts` computes pct from the last `message.usage` entry in a Claude JSONL transcript (input + cache_read + cache_creation). Whether Codex rollout files in `~/.codex/sessions` carry comparable per-turn token usage is unknown — if not, the whole threshold family (handoff 0.5 / reuse 0.25 / research 0.35) needs an emulation design for Codex workers. Flagged as inventory item 5.
- **Rasen already ships a Codex command adapter** (`src/core/command-generation/adapters/codex.ts`): writes `<CODEX_HOME>/prompts/rasen-<id>.md` with `description`/`argument-hint` frontmatter, respects `CODEX_HOME`. The prompt-analog path exists in code; what is untested is discovery + non-interactive invocation (inventory item 7). The only live-tested Codex usage today is the `/codex` second-opinion expert (`src/core/templates/experts/codex.ts`), which already uses `codex exec` with JSONL output, `codex review --base`, and `-c 'model_reasoning_effort="xhigh"'` — reusable as known-good invocation patterns.
- **Playbook's app-server method names are unverified design fiction until E07 runs** — the playbook says "app-server threads / threadId / turnId" but no code speaks the protocol; the experiment must discover the real 0.144.1 JSON-RPC surface rather than trust the playbook wording.
- **Experiment hygiene constraint (recorded in goal-plan.md):** experiments must not mutate the user's real `~/.codex` (use temp CODEX_HOME for prompt tests) and write-tests run in throwaway dirs, not this repo.
