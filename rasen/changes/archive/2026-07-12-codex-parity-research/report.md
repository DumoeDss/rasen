# Run Report — codex-parity-research

## Goal

> Produce a research dossier at `docs/codex-parity/` that maps EVERY Claude-Code-specific capability rasen's orchestration relies on (the numbered inventory in goal-plan.md) to a concrete, live-tested Codex CLI (codex-cli 0.144.1) counterpart or workaround — each backed by real experiment evidence (actual codex commands + captured output) or, where live testing is impossible, an explicit justified `code-analysis-only` / `impossible-needs-emulation` verdict with an emulation design. This run produces the plan/solutions for future development; it does NOT implement any gap in rasen source code.

This was a **research run**: no rasen source-code edits were made, and there is nothing to ship or push. The deliverable is the document tree at `docs/codex-parity/`.

## Outcome

**satisfied** — at round 2 of 5 (maxRounds).

## Rounds

| Round | Gate judgment | Gaps / detail | gitTreeFingerprint | Reviewer |
|---|---|---|---|---|
| 1 | evaluateSatisfied = **false** | 4 gaps flagged (below) | `ae2118d5...9493b` | gate-reviewer-r1 (fable) |
| 2 | evaluateSatisfied = **true** | 0 gaps — "all 4 round-1 gaps closed with live evidence; 13 live-verified + 1 code-analysis-only (item 13); reviewer verified all 13 experiment logs genuine" | `ae2118d5...9493b` | gate-reviewer-r2 (fable) |

Note: the gitTreeFingerprint is identical across both rounds because this is a prose/docs work product — the recorded fingerprint tracks the rasen source tree, not `docs/codex-parity/`, which is outside its scope.

### Round-1 gaps and how round 2 closed them

1. **Item 9 (model enumeration)** — round 1 only *asserted* which models were available under this auth, unverified. Round 2 live-called the app-server's `model/list` method (E07 Step 3): 7 models enumerated (`gpt-5.6-sol` default, `gpt-5.6-terra`, `gpt-5.6-luna`, `gpt-5.5`, `gpt-5.4`, `gpt-5.4-mini`, `gpt-5.2`) with per-model reasoning-effort ranges. Bonus finding folded in: `ultra` reasoning effort auto-delegates (backend-documented), which interacts with item 1's flat-hierarchy guard.
2. **Item 11 (prompt-referenced file reads)** — round 1 asserted "no reason to doubt" a Codex worker reads prompt-referenced files, without a live probe. Round 2 added E12: an unguessable token planted in a file, referenced only by path in the dispatch prompt; confirmed the worker ran a real `rg` command and reported the correct token.
3. **Item 7 (TUI custom-prompt invocation)** — round 1 assumed TUI invocation worked without testing it (a banned "no reason to doubt" pattern). Round 2 added E13: drove the real interactive TUI non-interactively via a scripted pty (fixing a `TIOCSWINSZ` pty-sizing bug along the way, documented honestly). Found the command palette lists only 8 fixed built-in commands — the custom prompt is absent/unrecognized, and submitting it errors `Unrecognized command`. This is a live-verified **negative**, matching `codex exec`'s behavior from E06.
4. **E07 thread-id inconsistency** — the live app-server transcript mixed thread ids from two separate throwaway probe scripts (`probe.py` / `probe2.py`) without explanation. Traced and fixed: the transcript now quotes only the single self-consistent `probe2.py` run, with an explicit note about the unrelated earlier `probe.py` thread id.

## Final state of the work product

`docs/codex-parity/` — a document tree covering all 14 inventory items:

- `README.md` — index table (item → solution file → status → key experiments), the round-2 change log, durable findings, and open follow-ups.
- `solutions/` — 14 solution files, one per capability, each with exact commands/flags/JSON-RPC methods, resume/identity handles, and failure modes.
- `experiments/` — 13 experiment logs (E01–E13), each with purpose, exact commands, environment notes, captured output, and reproduction steps.

Coverage breakdown: **12 items live-verified**, **1 item (7 — skill/prompt invocation) needs-emulation** with a concrete emulation design (inline the skill/prompt body into the `codex exec` prompt string client-side), **1 item (13 — session relay) code-analysis-only**, justified since it only applies if rasen's architecture ever inverts to a Codex-driven LEAD.

## Key durable findings

1. **Auth-proxy trap.** This machine's `OPENAI_API_KEY`/`OPENAI_BASE_URL` point at a third-party reverse proxy the built-in `openai` model_provider doesn't honor (hardcoded to `api.openai.com`, 401 on every call). Fix requires a `model_providers` config override (`-c 'model_providers.proxy.{name,base_url,wire_api,env_key}=...' -c 'model_provider="proxy"'`). Environment-specific to this box, but any similarly-proxied install will hit it identically (E01).
2. **Native multi-agent system.** Codex ships its own built-in `spawn_agent`/`wait_agent`/`followup_task`/`send_message` tools (feature-flag `multi_agent`, enabled by default in 0.144.1) — the goal-plan's original premise assumed Codex needed external bridging into multi-agent behavior, but it doesn't. This native system defaults to a **hierarchical** agent tree, not flat, and is suppressed only by a prompt-level guard (`<multi_agent_mode>explicitRequestOnly</multi_agent_mode>`), not a hard code switch. Rasen's leaf-worker dispatch prompts must carry an explicit "do not delegate" instruction to stay flat (E11 + E07 Step 3).
3. **`prompts/*.md` is dead on both surfaces.** Custom prompts under `$CODEX_HOME/prompts/*.md` are rejected by both `codex exec` (treats `/name` as literal chat text, E06) and the interactive TUI (command palette doesn't list it, errors `Unrecognized command` on submit, E13). Rasen's Codex adapter must inline skill/prompt bodies into the `codex exec` prompt string client-side. Whether a different native mechanism (possibly `skills/SKILL.md`, hinted at by feature flags and a `<skills_instructions>` system-prompt block) is the real 0.144.1 equivalent is an open question for round 3.
4. **`ultra` reasoning effort auto-delegates.** The backend documents `ultra` as enabling automatic task delegation, which interacts with the flat-hierarchy requirement — leaf workers should be capped below `ultra` (e.g. `xhigh`) to avoid unwanted delegation.
5. **Occupancy probe is easier on Codex than Claude.** Rollout `token_count` events (and the app-server `thread/tokenUsage/updated` push notification) carry `model_context_window` inline, so no external model-to-window lookup table is needed (E03/E07).

## Open gaps (none blocking; honestly-flagged round-3+ follow-ups)

The gate is satisfied — these are forward-looking items the README explicitly defers, not unresolved gaps in this round's coverage:

- Determine whether Codex 0.144.1 has a *working* native mechanism for reusable named instructions (a `skills/SKILL.md` system, hinted at by feature flags/system-prompt scaffolding) that could let rasen drop the client-side-inlining emulation for item 7.
- Live-test `followup_task`/`send_message` against a still-running (not-yet-completed) child agent — only `spawn_agent` + blocking `wait_agent` was proven.
- Live-test `codex mcp-server` mode as an alternative/complementary bridge to `app-server`.
- Live-test `--output-schema`/`outputSchema` over the app-server `turn/start` call directly (present in the schema, not yet exercised live).
- Live-test `danger-full-access` sandbox mode and network-access behavior under each sandbox mode.
- Live-test global `~/.codex/AGENTS.md` discovery (only repo-scoped AGENTS.md was tested).
- Check whether `spawn_agent`/multi-agent tools can be hard-disabled via config rather than relying solely on the prompt-level suppression guard, and whether `ultra`'s auto-delegation can be independently suppressed.
