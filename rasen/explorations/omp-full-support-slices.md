# Oh My Pi Full Support — Slice Map

## Context

`detect-omp-host-runtime` (archived 2026-08-06) made Oh My Pi (`omp`) a nameable LEAD host with **zero** operation capabilities, replacing a silent wrong answer with an honest refusal. It deliberately deferred everything else. This exploration is the full map of what "complete Oh My Pi support" means, produced 2026-08-06 from a live `omp` v17.2.9 session in this repository.

The work decomposes into four slices. Two are now proposed together; two remain to be proposed separately, and this document is their input so the investigation does not have to be redone.

| Slice | Scope | Status |
|---|---|---|
| **S0** install surface | `AI_TOOLS` entry so `rasen init` offers `omp` | proposed — `omp-install-target-and-context-probe` |
| **S1** `canProbeContext` | session locator + occupancy reader | proposed — same change |
| **S2** `canAudit` | token-audit reader, report shape, viewer | **not yet proposed** |
| **S3** `canDispatch` | `omp-print` bridge, pipeline enums, playbook arm | **not yet proposed** |

Rasen keeps two deliberately orthogonal registries (`src/core/runtime-adapters.ts:13-17`): `AI_TOOLS` (`src/core/config.ts:39-72`) is the install surface, `RUNTIME_ADAPTERS` (`src/core/runtime-adapters.ts:33-54`) is the orchestration surface. S0 belongs entirely to the first; S1–S3 entirely to the second. `hermes` is adapted with no runtime adapter and `zed` is a runtime adapter absent from `AI_TOOLS`, so the orthogonality is load-bearing, not theoretical.

## Verified Oh My Pi facts (reusable by S2 and S3)

Everything here was confirmed against `omp` v17.2.9 on this machine or against Oh My Pi's own published documentation. S2 and S3 can rely on it without re-verifying.

### Session storage

- Layout: `<agentDir>/sessions/<bucket>/<timestamp>_<sessionId>.jsonl`. Documented bucket form is `<scope>-<basename>-<sha256(canonical cwd)>` (`omp://session.md`).
- **Two bucket layouts coexist for the same cwd.** Live scan found `home-rasen-0a97387b…` (newest 2026-08-05) alongside the legacy home-relative `-SyncLocal-rasen` (newest 2026-08-06), both with header `cwd=/Users/boao.zeng/SyncLocal/rasen`. `sha256("/Users/boao.zeng/SyncLocal/rasen")` = `0a97387b3087…`, matching the hashed name exactly — so the documented derivation is right and **still insufficient**. Any locator that computes one bucket name reads a stale session.
- The header carries `cwd` explicitly, on the second physical row; the first is a fixed-width `title` slot. Confirming candidates against that field is the only reliable filter.
- The agent directory is relocatable (`PI_CODING_AGENT_DIR`, default profile only) and profile-scoped (`~/.omp/profiles/<name>/agent`); `PI_CONFIG_DIR` moves the config root.
- Entry-type census across 21 session files on this machine: `title` 21, `session` 21, `message` 5596, `custom` 2866, `custom_message` 72, `model_change` 23, `thinking_level_change` 22, `credential_pin` 20, `ttsr_injection` 10, `title_change` 10. No `compaction` or `reset_boundary` was present in the sample, though both are documented.

### Per-message usage (the input for both S1 and S2)

```jsonc
{"type":"message","message":{
  "model":"claude-opus-5","provider":"anthropic","role":"assistant",
  "usage":{"input":2,"output":768,"cacheRead":197324,"cacheWrite":747,
           "totalTokens":198841,
           "cost":{"input":0.00001,"output":0.0192,"cacheRead":0.098662,
                   "cacheWrite":0.00747,"total":0.125342},
           "cttl":{"ephemeral1h":747}}}}
```

- Occupancy is `input + cacheRead + cacheWrite` = `198073`, mapping one-to-one onto Claude's `sumUsage` (`src/core/agent-context.ts:115-121`).
- `totalTokens` (`198841`) adds the turn's output and is **not** the occupancy figure.
- `cost` is present per message with a per-category breakdown — richer than Claude's transcript, which S2 can use directly instead of a pricing table.
- Model ids are bare (`claude-opus-5`), with `provider` a sibling field. `resolveModelPreset` substring matching therefore resolves them, but Oh My Pi routes to dozens of providers whose models are absent from `MODEL_PRESETS`.

### Install surface

- Skills roots: `<ancestor>/.omp/skills/*/SKILL.md` and `~/.omp/agent/skills/*/SKILL.md` (`omp://config-usage.md:247`). Skills discovery is the one surface that does **not** require `.omp/` to be non-empty, and it walks ancestors (`:241`).
- The provider owning `.omp/skills` is `native`, priority 100 — above `claude` at 80, so `.omp/skills` shadows `.claude/skills` on same-named skills.
- `native` discovery requires `description` front matter; Rasen's generated skills already have it.
- All 12 `skills.*` settings default `true`, including `enableSkillCommands` (live `omp config list`). No project config file is needed for an install to work.
- **Nested-install hazard:** project instructions (`.omp/AGENTS.md`), sticky rules (`.omp/RULES.md`), commands, hooks, and settings resolve from the **nearest non-empty** `.omp/` and do not continue upward (`omp://config-usage.md:240-242`). Populating `<pkg>/.omp/skills` in a monorepo silently stops `<repo>/.omp/AGENTS.md` and `RULES.md` from loading.
- An empty, untracked `.omp/` exists in this repository and in none of the other checkouts scanned — so bare-directory detection would false-positive here.

### CLI capability (the input for S3)

`omp --help`, v17.2.9: `-p/--print` (non-interactive), `-r/--resume <id prefix|path|picker>`, `-c/--continue`, `--session-dir`, `--mode=text|json|rpc|rpc-ui`, `--model/--smol/--slow/--plan`, `--auto-approve`, `--approval-mode=always-ask|write|yolo`, `--cwd`, `--add-dir`, `--max-time`, `--append-system-prompt`, `--tools`, `--skills`, `--no-session`, plus an `acp` subcommand (Agent Client Protocol over stdio). A print bridge equivalent to `claude -p` / `codex exec` is therefore implementable, with resume and session pinning available.

## S2 — `canAudit` (not yet proposed)

Shares the JSONL parser with S1, so it is cheaper after S1 lands. `cost` per message makes the report richer than Claude's.

Compiler-forced work:

- `src/core/runtimes/audit-readers.ts` — `satisfies { [Id in AuditRuntime]: AuditReader<Id> }`, missing-key error on the flip.
- `src/core/token-audit/types.ts:355` — `OmpAuditResult` joins the `AuditResult` union with `schema: 'rasen-token-audit/2'` and `session.runtime: 'omp'` as discriminant. `ZedAuditResult:327-353` is the precedent for a runtime that keeps the schema tag while omitting structures it cannot support. Needs an `isOmpAuditResult` narrowing helper.
- `src/core/token-audit/management.ts:779-802` — `AUDIT_MANAGEMENT` needs all three of `validateReportShape`, `discoverRecent`, `resolveNativeTarget`; `AuditManagementOptions:75-79` needs an `ompSessionsRoot?`.

Hand-maintained lists (no compiler help):

- `src/commands/agent.ts:191-206` — `summarizeAuditResult` dispatches on `isCodexAuditResult`/`isZedAuditResult` with an **implicit Claude else**. Without a branch, an Oh My Pi report is summarized as Claude.
- `viewer/audit.html:218-219` — allow-list `['claude','codex','zed']` rejects an Oh My Pi report as malformed.
- `viewer/audit.html:372-384` — render dispatch's else is `renderClaude`; card visibility keys on `runtime !== 'claude'` at `:374,376`.
- `packages/ui/src/api/types.ts:341` — `AuditRuntime` mirror; relax before the server widens.
- `packages/ui/src/components/AuditPage.tsx:386` — `runtime === 'zed' ? 'threads' : 'agents'`.

Contract change: `src/core/token-audit/audit.ts:175-181`, the "No token auditor exists…" refusal. Guarded by exactly one test, `test/cli-e2e/agent-audit.test.ts:228-252`, plus `test/core/token-audit/audit.test.ts:123-128`.

Spec: `rasen/specs/cli-agent-audit/spec.md` does **not** pin the Oh My Pi refusal at all — the refusal lives only in `runtime-adapter-registry/spec.md:26-30`. S2 should add a positive requirement there rather than amend a nonexistent one. `src/core/templates/workflows/audit.ts:24-27` enumerates exactly three auditable runtimes and needs a fourth bullet or the skill never routes to Oh My Pi.

Owns two recorded follow-ups from `runtime-adapter-interface-extraction`:

- **FU-2** — the zero-report invariant. `agent audit <omp file> --runtime claude` still writes an exit-0 report with `session.runtime:"claude"` and `requests:0`. The report names "the Oh My Pi `AuditReader` follow-on" as owner. The decision is either a format-recognition guard in `runClaudeAudit` or tightening the scenario to a *recognized* harness.
- **FU-3/FU-4** — the audit wire mirror and the viewer allow-list, both explicitly assigned to "the audit capability change".

## S3 — `canDispatch` (not yet proposed)

Largest blast radius by a wide margin. Feasible (see CLI capability above); the cost is not the adapter.

**The real cost is the orchestration playbook.** `src/core/templates/workflows/_orchestration.ts` is 851 lines containing 68 `Codex`, 58 `Claude`, 26 `SendMessage`, 23 `codex`, 14 `claude`, 2 `wait_agent`, 2 `Task tool`, 1 `agent-teams` mentions. Both existing harnesses' dispatch procedures are written into the prose. Oh My Pi host → Oh My Pi worker derives to `native`, so a third arm must be authored around Oh My Pi's own subagent mechanism (`task`, `hub` messaging, `handle`). That authorship then moves the parity hashes for 6+ generated skills.

Registry and adapter:

- `DispatchBridge` needs an `'omp-print'` literal and `DISPATCH_BRIDGES.omp`. **`DISPATCH_BRIDGES` becomes missing-key, but the new literal is NOT compiler-forced** — reusing `'claude-print'` typechecks while making every diagnostic name the wrong tool.
- `src/core/runtimes/dispatch-adapters.ts` — full entry. `spawn: 'rasen-owned'` makes `childEnv: runtimeIdentityEnv('omp')` type-required.
- New `src/core/omp/availability.ts` (`codex/availability.ts` shape). `execution-validation.ts:141-146` reads it directly, so a stub means every Oh My Pi-targeted stage passes preflight and fails at spawn.
- New invocation builder for `omp -p`.

Enum and schema widening, each with a guard:

| Site | Note |
|---|---|
| `src/core/config-keys.ts:531-542` | auto-widens; `:540` description hard-codes `(claude \| codex)`. **`test/core/config-keys.test.ts:470-482` asserts `toEqual(['claude','codex'])`** |
| `src/core/config-keys.ts:274-289` | `keepalive.runtimes.*` is hand-listed; a third entry is needed or the key is unsettable while `project-config.ts` reads it |
| `src/core/config-schema.ts:69-85` | global keepalive `z.object({claude,codex})` strips an unlisted key |
| `src/core/project-config.ts:1349-1352` | loops `DISPATCH_RUNTIMES` into a `{claude?,codex?}` type — **hard compile error**; fix at `:225-230` |
| `src/core/keepalive/index.ts:270,277,285,293-296,343-347` | hand-written shape + if-chain. The flip alone does not change gating; adding the arm breaks the deliberate tripwire at `test/core/keepalive.test.ts:171-183` |
| `src/core/pipeline-registry/types.ts:38-39` | `AgentRuntimeSchema` widens ⇒ `runtime: omp` legal in pipeline YAML |
| `src/core/pipeline-registry/types.ts:604-621,985-989` | Oh My Pi host stops collapsing to the legacy Claude default |
| `src/core/pipeline-registry/run-state.ts:112-131,355-363` | `inferDispatchMode` arm decision; the normalizer stops demoting a recorded `runtime:'omp'`, changing how historical run-state files read |
| `src/core/pipeline-registry/execution-validation.ts:293-301` | the `host-runtime-without-dispatch-adapter` notice goes silent for Oh My Pi ⇒ becomes zed-only, reachable only via `RASEN_AGENT_RUNTIME=zed` |

Not generic, needs an explicit scope statement either way: `src/commands/agent.ts:330-403` (`rasen agent dispatch` hard-rejects non-Claude at `:346-348`, hard-codes `claude-print` at `:341` and `DISPATCH_ADAPTERS.claude` at `:397`) and `src/core/management-api/supervisor.ts:309-328` (Claude print worker hard-coded).

UI mirrors: `packages/ui/src/api/types.ts:1040,229,244,1044-1060,1148`; `PipelinesPage.tsx:66-70` (hand-listed keepalive keys), `:312-314` (`endsWith('.claude') ? 'Claude Code' : 'Codex'` — an Oh My Pi key renders as "Codex"), `:894-916`; `config/labels.ts:33-34` plus three i18n catalogs.

Owns **FU-1** — the bridged-worker identity guarantee is enforced on declaration but not on application. `bridgeChildEnv` is the single merge site, but a bridge calling `spawnAgentCli` directly compiles clean and reintroduces the defect. The follow-up report names "the Oh My Pi `DispatchAdapter` follow-on, which adds exactly the third rasen-owned bridge this entry is about" as owner.

## Cross-slice hazards worth carrying forward

1. **A locator derived from one bucket name reproduces the bug `detect-omp-host-runtime` fixed.** Measured, not hypothetical.
2. **`usage.totalTokens` includes output.** Any consumer of Oh My Pi usage must sum the three input-side fields.
3. **A new `DispatchBridge` literal is not compiler-forced.**
4. **`summarizeAuditResult` and the report viewer both fall through to Claude.**
5. **`MODEL_PRESETS` covers four families; Oh My Pi routes to dozens.** An unlisted model gets a 200 000 fallback and a silently wrong `pct` unless the reader reports an unknown window.
6. **`test/core/runtimes/registry-enforcement.test.ts:26-30` is a hand-written string mirror of the capability matrix inside a compiler fixture** — it drifts silently instead of failing.
7. **`skillsHome: 'global'` is hard-wired to Hermes' home** (`src/core/shared/tool-detection.ts:121-126`). Not hit by S0 because Oh My Pi is project-local, but a future second global-home tool would write into `~/.hermes/skills` while `test/core/init.test.ts:283-303` stays green.
8. **Four published tool lists are already stale** (none names `hermes`): `docs/supported-tools.md:26-56,:77`, `docs/cli.md:116-118`, `docs/zh/supported-tools.md:25-76,:78`, `docs/zh/cli.md:108-110`. No test enforces them against `AI_TOOLS`.

## Suggested order

S0 and S1 first (proposed together — the install alone leaves the harness's own context unmeasurable, the probe alone leaves a harness Rasen can measure but not install into). Then S2, which reuses S1's parser and closes FU-2/FU-3/FU-4. S3 last: the locale copy at `src/locales/*:433` promises that forcing a runtime lifts the context-probe refusal, which is only correctable once S1 has removed that refusal, and S3's playbook arm is the single largest piece of authorship in the whole map.

## Related

- `rasen/changes/archive/2026-08-06-detect-omp-host-runtime/` — the prior change; its `design.md` "Out of scope" is the origin of S0/S1
- `rasen/changes/runtime-adapter-interface-extraction/evidence/deferred-followups-report.md` — FU-1 through FU-8
- `rasen/changes/omp-install-target-and-context-probe/` — S0 + S1
