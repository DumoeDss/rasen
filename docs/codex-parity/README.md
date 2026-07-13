# Codex Parity Research — Round 2

Research dossier mapping every Claude-Code-specific capability rasen's orchestration relies on
to a live-tested Codex CLI (**codex-cli 0.144.1**) counterpart, workaround, or emulation design.
See `rasen/changes/codex-parity-research/goal-plan.md` for the full 14-item capability inventory
and evaluate rubric. This round does **not** implement any gap in rasen — it's the research
dossier that future development builds on.

Round 1 produced full 14-item coverage; the round-1 evaluate reviewer found 4 specific gaps
(unverified "no reason to doubt" claims, and an internally-inconsistent experiment transcript).
Round 2 closed all 4 with additional live experiments — see "Round 2 changes" below.

## Index

| # | Capability | Solution | Status | Key experiment(s) |
|---|---|---|---|---|
| 1 | Subagent spawning, role isolation, flat hierarchy | [01](solutions/01-subagent-spawning-role-isolation.md) | live-verified | E01, E11, E02 |
| 2 | Parallel dispatch (`parallelGroup`) | [02](solutions/02-parallel-dispatch.md) | live-verified | E08 |
| 3 | Warm continuation / SendMessage (Tier A) | [03](solutions/03-warm-continuation-sendmessage.md) | live-verified | E02, E11 |
| 4 | In-session revival after infra death / DONE-with-unticked-tasks nudge | [04](solutions/04-in-session-revival-after-infra-death.md) | live-verified | E02 |
| 5 | Transcript occupancy probe | [05](solutions/05-transcript-occupancy-probe.md) | live-verified | E03, E07 |
| 6 | Cross-session resume via transcript warm-seed | [06](solutions/06-cross-session-resume-warm-seed.md) | live-verified | E02, E01, E03 |
| 7 | Skill / slash-command invocation inside workers | [07](solutions/07-skill-slash-command-invocation.md) | needs-emulation | E06, **E13 (round 2)** |
| 8 | Structured worker returns (DONE/HANDOFF; evaluate gate JSON) | [08](solutions/08-structured-worker-returns.md) | live-verified | E10 |
| 9 | Model / reasoning-effort per-dispatch overrides | [09](solutions/09-model-reasoning-effort-overrides.md) | live-verified | E05, E01, **E07 Step 3 (round 2)** |
| 10 | Sandbox / permission-mode semantics per role | [10](solutions/10-sandbox-permission-mode-semantics.md) | live-verified | E04 |
| 11 | Project context injection (CLAUDE.md analog) | [11](solutions/11-project-context-injection-agents-md.md) | live-verified | E09, **E12 (round 2)** |
| 12 | Programmatic bridge: `codex app-server` JSON-RPC / MCP mode | [12](solutions/12-programmatic-bridge-app-server.md) | live-verified | E07 |
| 13 | Session relay (Step H.7) | [13](solutions/13-session-relay.md) | code-analysis-only | — |
| 14 | Run-state & gates (identity fields, resumability) | [14](solutions/14-run-state-gates-identity-fields.md) | live-verified | E01, E02, E03, E07 |

## Experiment logs

| File | Covers |
|---|---|
| [E01-baseline-exec-and-auth.md](experiments/E01-baseline-exec-and-auth.md) | Real `codex exec` flag surface; a stdin-hang trap; a critical environment auth fix (`model_providers` override needed on this machine); session-file location; plain-output identity fields. |
| [E02-resume-warm-continuation.md](experiments/E02-resume-warm-continuation.md) | `resume --last` and `resume <id>` across processes/cwd; kill -9 mid-turn then resume; a transient 429 failure mode. |
| [E03-rollout-transcript-anatomy.md](experiments/E03-rollout-transcript-anatomy.md) | Exact JSON path for token usage + context window in rollout JSONL (`token_count` events). |
| [E04-sandbox-modes.md](experiments/E04-sandbox-modes.md) | Live proof `-s read-only` blocks writes at the OS layer, `-s workspace-write` allows them. |
| [E05-model-effort-overrides.md](experiments/E05-model-effort-overrides.md) | `-m`/`-c model_reasoning_effort` syntax; invalid-model 404 failure shape. |
| [E06-custom-prompts-discovery.md](experiments/E06-custom-prompts-discovery.md) | Negative result: `codex exec` does not expand `$CODEX_HOME/prompts/*.md`; emulation design. |
| [E07-app-server-jsonrpc.md](experiments/E07-app-server-jsonrpc.md) | Full real JSON-RPC method list (via `generate-json-schema`) + live initialize→thread/start→turn/start→turn/completed round trip (now internally self-consistent — see round 2 fix below) + **round 2: live `model/list` enumeration**. |
| [E08-parallel-dispatch.md](experiments/E08-parallel-dispatch.md) | Two concurrent `codex exec` against the same repo, no contention observed. |
| [E09-agents-md-discovery.md](experiments/E09-agents-md-discovery.md) | AGENTS.md root+nested merge behavior, live-verified with distinguishable tokens. |
| [E10-structured-output-schema.md](experiments/E10-structured-output-schema.md) | `--output-schema` forcing strict DONE/HANDOFF-shaped JSON final output. |
| [E11-native-multi-agent-collaboration.md](experiments/E11-native-multi-agent-collaboration.md) | **Major finding**: Codex ships its own native multi-agent system (`spawn_agent`/`wait_agent`/`followup_task`/`send_message`), live-proven with a real `spawn_agent`→child-thread→`wait_agent` round trip. |
| [E12-prompt-referenced-file-read.md](experiments/E12-prompt-referenced-file-read.md) | **Round 2.** Live proof a Codex worker actually reads a prompt-referenced file path (real `rg` command execution against an unguessable token), not hallucination. |
| [E13-tui-interactive-prompt-invocation.md](experiments/E13-tui-interactive-prompt-invocation.md) | **Round 2.** Live-drove the interactive TUI via a scripted pty (with a documented pty-sizing fix mid-experiment) to test custom-prompt discovery/invocation — also a live-verified negative, matching E06's `codex exec` result. |

## Round 2 changes (closing the 4 reviewer-flagged gaps)

1. **Item 9 — model enumeration was asserted-but-unverified; now live-enumerated.** Called the
   app-server's `model/list` method live (E07 Step 3): this auth serves 7 models
   (`gpt-5.6-sol` [default], `gpt-5.6-terra`, `gpt-5.6-luna`, `gpt-5.5`, `gpt-5.4`, `gpt-5.4-mini`,
   `gpt-5.2`) with per-model reasoning-effort ranges. Solution 09 now has a concrete table and a
   fast/cheap-vs-high-capability role mapping. Bonus finding: `ultra` reasoning effort is
   documented by the backend as enabling *automatic task delegation* — interacts with item 1's
   flat-hierarchy guard (leaf workers should avoid `ultra`).
2. **Item 11 — "no reason to doubt" a worker reads prompt-referenced files; now live-proven.**
   E12: planted an unguessable token in a file, referenced only the path in the dispatch prompt,
   confirmed the worker ran a real `rg` command and reported the correct token. Solution 11
   updated.
3. **Item 7 — TUI invocation was assumed working ("no reason to doubt"), banned pattern; now
   live-verified as a NEGATIVE result matching `codex exec`.** E13 drove the real interactive TUI
   non-interactively via a scripted pty (fixing a `TIOCSWINSZ` pty-sizing bug along the way,
   documented honestly) and found the command palette (triggered by typing `/`) lists only 8 fixed
   built-in commands — the custom prompt is absent, unrecognized, and submitting it errors
   `Unrecognized command`. Solution 07 rewritten: both invocation surfaces (`exec` and TUI) are now
   live-verified negatives, and a new open question is flagged (is `prompts/` even the real
   mechanism in 0.144.1, or has it moved to a `skills/SKILL.md` system? — not chased this round).
4. **E07 thread-id inconsistency — fixed.** The live app-server transcript mixed two separate probe
   runs' thread ids without explanation (`thread/start` showed one id, `turn/start` used another).
   Traced to two distinct throwaway scripts (`probe.py`, `probe2.py`); rewrote the transcript to
   quote only the single self-consistent `probe2.py` run throughout, with an explicit note that the
   earlier one-off `probe.py` check produced an unrelated, independent thread id not carried
   forward.

## Durable findings (carry into implementation)

1. **This machine's Codex auth setup requires a `model_providers` config override.** The global
   `OPENAI_API_KEY`/`OPENAI_BASE_URL` env vars point at a third-party reverse proxy that the
   built-in `openai` model_provider does not honor (hardcoded to `api.openai.com`, causing 401 on
   every call). Fix: `-c 'model_providers.proxy.{name,base_url,wire_api,env_key}=...' -c
   'model_provider="proxy"'`. This is environment-specific to this dev machine, not a rasen↔Codex
   design issue, but any automation on a similarly-proxied install will hit it identically (E01).
2. **Codex has a native, built-in multi-agent system** (`spawn_agent`/`wait_agent`/
   `followup_task`/`send_message`, feature-flag `multi_agent`, enabled by default in 0.144.1) that
   the original goal-plan's premise did not anticipate — it assumed Codex needed to be bridged
   into multi-agent behavior externally. This native system defaults to a **hierarchical** (not
   flat) agent tree and is suppressed only by a prompt-level guard
   (`<multi_agent_mode>explicitRequestOnly</multi_agent_mode>`), not a hard code-level switch —
   rasen leaf-worker dispatch prompts must carry an explicit "do not delegate" instruction to stay
   flat, and must avoid `ultra` reasoning effort which the backend documents as auto-delegating
   (E11 + E07 Step 3, solutions 01/09).
3. **Custom prompts under `$CODEX_HOME/prompts/*.md` are rejected by BOTH invocation surfaces on
   0.144.1** — not a TUI-only feature as round 1 assumed. `codex exec` treats `/name` as literal
   chat text (E06); the interactive TUI's own command palette doesn't list it and explicitly
   errors `Unrecognized command` on submit (E13, round 2). Rasen's Codex adapter must inline
   skill/prompt bodies into the `codex exec` prompt string client-side; whether a different native
   mechanism (possibly a `skills/SKILL.md` system, hinted at by enabled feature flags and a
   `<skills_instructions>` system-prompt block seen in every rollout) is the "real" 0.144.1
   equivalent is an open question for round 3 (solution 07).
4. **Codex's occupancy signal is strictly easier to compute than Claude's** — rollout `token_count`
   events (and the app-server `thread/tokenUsage/updated` push notification) carry
   `model_context_window` inline, so no external model-to-window lookup table is needed (E03/E07,
   solution 05).
5. **`--output-schema`** (both on `codex exec` and, per schema inspection, on app-server's
   `turn/start.outputSchema`) is a strictly better DONE/HANDOFF/evaluate-gate capture mechanism
   than prose-marker parsing — recommended for every rasen↔Codex structured-return contract (E10,
   solution 08).
6. **A worker genuinely reads prompt-referenced files rather than hallucinating** — confirmed via
   an unguessable-token probe with a real shell command visible in the JSONL trail (E12,
   solution 11), so "pass per-change context by prompt reference" is a proven pattern, not a
   plausible-sounding guess.

## Open follow-ups for round 3+

- Determine whether Codex 0.144.1 has a *working* native mechanism for reusable named
  instructions at all (a `skills/SKILL.md` system is hinted at by feature flags and system-prompt
  scaffolding, distinct from the now-doubly-disproven `prompts/*.md` mechanism) — would let rasen
  drop the client-side-inlining emulation if a real native path exists (solution 07).
- Live-test `followup_task`/`send_message` to a still-running (not-yet-completed) child agent
  (only `spawn_agent`+blocking `wait_agent` was proven — E11).
- Live-test `codex mcp-server` mode as an alternative/complementary bridge to `app-server`
  (solution 12).
- Live-test `--output-schema`/`outputSchema` over the app-server `turn/start` call directly
  (confirmed present in the schema, not yet exercised live).
- Live-test `danger-full-access` sandbox mode and network-access behavior under each sandbox mode
  (solution 10).
- Live-test global `~/.codex/AGENTS.md` discovery (only repo-scoped AGENTS.md was tested —
  solution 11).
- Live-test `codex resume`/`codex fork` seed-prompt behavior (only relevant if rasen's
  architecture ever inverts to a Codex-driven LEAD — solution 13).
- Check whether `spawn_agent`/multi-agent tools can be hard-disabled via a `-c`/feature flag
  rather than relying solely on prompt-level suppression, and whether `ultra` reasoning effort's
  auto-delegation can be independently suppressed (solution 01/09).
