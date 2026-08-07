## Context

`detect-omp-host-runtime` made Oh My Pi a nameable LEAD host with zero operation capabilities, and deliberately deferred both an `AI_TOOLS` install entry and a context reader. Its Context section established the governing principle this change also obeys: installing a tool and having a probe/auditor/dispatcher for it are separate contracts, and the two registries (`AI_TOOLS` in `src/core/config.ts:39-72`, `RUNTIME_ADAPTERS` in `src/core/runtime-adapters.ts:33-54`) stay orthogonal. This change therefore carries two independent slices in one delivery, joined only by the fact that both concern the same harness:

- **Install slice.** Add the `AI_TOOLS` entry. Every downstream install consumer already derives from the registry.
- **Probe slice.** Flip `canProbeContext` and register a session locator plus an occupancy reader.

Both facts the slices depend on were verified live against `omp` v17.2.9 on this machine and against Oh My Pi's own published documentation, not inferred from Rasen's tree. The prior change's stated reason for deferring the install entry — "an entry is one line whenever a project-local `.omp/skills` tree becomes desirable" — is now answerable: that tree is Oh My Pi's canonical, highest-precedence skills location, so the entry is one line.

## Evidence

| Fact | Verification |
|---|---|
| Oh My Pi's own skills roots are `<ancestor>/.omp/skills/*/SKILL.md` and `~/.omp/agent/skills/*/SKILL.md` | `omp://config-usage.md:247` |
| Skills discovery does **not** require `.omp/` to be non-empty, and walks ancestors | `omp://config-usage.md:241` |
| The provider owning `.omp/skills` is `native`, priority 100 — above `claude` at 80 | `omp://skills.md`, provider precedence table |
| `native` skill discovery requires a `description` in front matter | `omp://skills.md` ("`requireDescription: true`") |
| Rasen's generated skills already carry `description` | `.claude/skills/rasen-explore/SKILL.md:3` |
| All 12 `skills.*` settings default to `true`, including `enableSkillCommands` | live `omp config list` / `omp config get skills.enableSkillCommands` → `true` |
| Project instructions, sticky rules, commands, hooks and settings resolve from the **nearest non-empty** `.omp/` and do not continue upward; skills are the exception | `omp://config-usage.md:240-242` |
| Session file layout is `<agentDir>/sessions/<bucket>/<timestamp>_<sessionId>.jsonl`; documented bucket form is `<scope>-<basename>-<sha256(canonical cwd)>` | `omp://session.md`, "On-Disk Layout" |
| **Two bucket layouts coexist for one cwd, and the newest session was in the legacy one** | live scan of `~/.omp/agent/sessions`: `home-rasen-0a97387b…` (4 files, newest 2026-08-05T07:01Z) and `-SyncLocal-rasen` (8 files, newest 2026-08-06T10:37Z), both with header `cwd=/Users/boao.zeng/SyncLocal/rasen` |
| The documented digest is reproducible: `sha256("/Users/boao.zeng/SyncLocal/rasen")` = `0a97387b3087…` | live, matches the hashed bucket name exactly |
| Session header carries `cwd` explicitly, and the first physical row is a fixed-width `title` slot | live: `{"type":"title",…}` then `{"type":"session","version":3,"id":…,"cwd":…}` |
| Per-message usage shape is `{input, output, cacheRead, cacheWrite, totalTokens, cost{…}, cttl{…}}` | live: `input:2, output:768, cacheRead:197324, cacheWrite:747, totalTokens:198841` |
| `totalTokens` includes output — it is **not** the occupancy figure | live arithmetic: `2+197324+747 = 198073`, `198073+768 = 198841 = totalTokens` |
| Model id is bare (`claude-opus-5`), with `provider` a sibling field | live |
| The agent directory is relocatable (`PI_CODING_AGENT_DIR`) and profile-scoped (`~/.omp/profiles/<name>/agent`) | `omp://context-files.md`, "Native `.omp` files"; `omp://config-usage.md:74` |
| This repository currently holds an **empty, untracked** `.omp/`; no other checkout under `~/Work`, `~/PWork`, `~/AlertCheck`, `~/SyncLocal` has one | live filesystem scan |

## Goals / Non-Goals

**Goals:**

- `rasen init` offers, expands, and accepts Oh My Pi, writing skills where Oh My Pi's own top-priority provider reads them.
- `rasen agent context --latest` inside an Oh My Pi session reports that session's own occupancy, so Step H handoff sensing, threshold resolution, and every other occupancy consumer work in this harness.
- An Oh My Pi session file is readable by explicit `--transcript`, and `omp` is accepted as an explicit `--runtime`.
- No silent wrong answers are introduced: an unknown context window, a missing session, and a session with no completed turn each produce a distinguishable honest result.

**Non-Goals:**

- Token auditing for Oh My Pi (`canAudit`). Separate change; it owns follow-up FU-2 and FU-3/FU-4 from `runtime-adapter-interface-extraction`.
- Worker dispatch to Oh My Pi (`canDispatch`). Separate change; it owns follow-up FU-1, and its real cost is the orchestration playbook's third harness arm (`src/core/templates/workflows/_orchestration.ts` is 851 lines carrying 68 `Codex` / 58 `Claude` / 26 `SendMessage` mentions — a native Oh My Pi arm is authorship, not plumbing).
- Any keepalive change. No dispatch capability becomes true, so Oh My Pi stays withheld from beats by the existing fall-through fail-safe and gains no `keepalive.runtimes.omp` key.
- Generalizing `resolveToolSkillsRoot`'s global-home branch. D1 makes that unnecessary here.
- An opener entry in `BUILTIN_OPENERS`. Orthogonal to `AI_TOOLS`, kill-switched off by default, and users can add one through the `openers` config key with no code.

## Decisions

### D1 — Project-local `skillsDir: '.omp'`, not a global skills home

`resolveToolSkillsRoot` (`src/core/shared/tool-detection.ts:121-126`) resolves `<projectPath>/<skillsDir>/skills` by default, which for `.omp` yields `<project>/.omp/skills` — byte-identical to Oh My Pi's own project skills root. So the entry is:

```ts
{ name: 'Oh My Pi', value: 'omp', available: true, successLabel: 'Oh My Pi',
  skillsDir: '.omp', adapted: true, detectionPaths: [ /* D2 */ ] }
```

`available: true` is load-bearing, not decoration: `getToolsWithSkillsDir` filters `skillsDir && adapted` while `test/cli-e2e/basic.test.ts:215,331` derives its expected id list from `available && adapted`. A `false` there desynchronizes the two silently.

Rejected: `skillsHome: 'global'` pointing at `~/.omp/agent/skills`. It is a real Oh My Pi location, but choosing it would (a) make per-project skill selection impossible, and (b) require generalizing `resolveToolSkillsRoot`, whose `skillsHome === 'global'` branch is hard-wired to `resolveHermesHome()` — a second global-home tool would write into `~/.hermes/skills`. Worse, `test/core/init.test.ts:283-303` and `test/cli-e2e/basic.test.ts:406-432` both set `HERMES_HOME` and assert only specific paths, so that misdirection would keep both suites **green**. Project-local avoids the hazard entirely rather than fixing it.

### D2 — Detection names content inside `.omp/`, never the bare directory

`getAvailableTools` (`src/core/available-tools.ts:36-39`) treats an existing `skillsDir` directory as a detection. An empty `.omp/` exists in this very repository, so a bare-directory rule would report Oh My Pi as detected here — and `detectNewTools` (`src/core/update.ts:779-800`) would nudge on every `rasen update`. `detectionPaths` is the existing escape hatch (`github-copilot` precedent, `src/core/config.ts:55`); populate it with real Oh My Pi content paths (`.omp/skills`, `.omp/AGENTS.md`, `.omp/RULES.md`, `.omp/config.yml`, `.omp/commands`, `.omp/agents`, `.omp/mcp.json`).

### D3 — No project-config reconciler for Oh My Pi

`claude` gets `ensureClaudeAgentTeams` and `codex` gets `reconcileCodexProjectConfig` because each has a setting that gates Rasen's orchestration. Oh My Pi has none in this slice's scope: every `skills.*` setting ships `true`, so an installed skill is discovered and exposed as `/skill:<name>` with no file written. Adding a `.omp/config.yml` writer would create a project file with nothing to say.

### D4 — No command-file generation and no hyphen transform

The per-tool command surface is retired: `init.ts` unconditionally deletes command files, and `TOOL_COMMAND_PATH_BUILDERS` (`src/core/shared/retired-command-paths.ts:57-84`) already omits `hermes`, `trae`, `vibe`, `kimi`, `forgecode`. `getAllRetiredCommandFilePathCandidates('omp')` therefore returns `[]` and the cleanup is a correct no-op. **Adding a builder would make Rasen delete files it never wrote.** The `transformToHyphenCommands` transform stays off for the same reason it is off for `claude`/`codex`/`hermes`: Oh My Pi addresses skills by their canonical `rasen-*` name.

### D5 — Disclose the nested-install context capture rather than work around it

`omp://config-usage.md:240-242`: project instructions (`AGENTS.md`), sticky rules (`RULES.md`), commands, hooks, and settings load from the **nearest non-empty** `.omp/` and do not continue upward when that directory lacks the file. Populating `<pkg>/.omp/skills` in a monorepo package therefore silently stops `<repo>/.omp/AGENTS.md` and `<repo>/.omp/RULES.md` from loading. Skills themselves are unaffected — they walk ancestors.

Rejected: writing a placeholder `.omp/AGENTS.md` to keep the enclosing content reachable. Rasen does not author context files for any tool, and a placeholder would shadow the enclosing file just as effectively. Rejected: refusing to install in a nested directory — the install is legitimate. The install proceeds and names the files that stop loading.

### D6 — The session locator scans every bucket and confirms `cwd` from each header

This is the decision the whole probe slice turns on, and the naive alternative reproduces the exact bug `detect-omp-host-runtime` fixed.

Modelling the locator on `claudeProjectsDir` (`src/core/agent-context.ts:298-301`, a pure slug derivation) means computing one bucket name and reading it. Live measurement shows that would be wrong **today, on this machine**: the documented hashed bucket for this repository holds a session from 2026-08-05, while the legacy home-relative bucket holds today's live session. Oh My Pi migrates legacy buckets only best-effort, and evidently had not.

```
naive: bucket = f(cwd)                 → reads home-rasen-0a97387b… → 08-05 session
                                          = a foreign session reported as this one

chosen: for every bucket under <agentDir>/sessions
          take the newest .jsonl
          read its header cwd (first non-empty rows only)
          keep candidates whose cwd === requested cwd
        → newest across all layouts → 08-06 session ✓
```

Cost is bounded: `omp://session.md` states recent scans read only a 4 KiB prefix, and the header is in the first two rows. Codex's locator already takes a `cwd` argument (`findLatestRollout(dir, cwd)`), so a cwd-confirming locator is the established shape here, not a novelty.

The generalized form of this decision is written into `runtime-adapter-registry` as an ADDED requirement, because it is a registry-level contract about session locators rather than an Oh My Pi detail.

### D7 — Occupancy is `input + cacheRead + cacheWrite`; `totalTokens` is a trap

Claude's `sumUsage` (`src/core/agent-context.ts:115-121`) is `input_tokens + cache_read_input_tokens + cache_creation_input_tokens` — everything sent, nothing produced. Oh My Pi's usage object maps one-to-one onto those three fields, so the reader mirrors the definition exactly and the two harnesses' numbers stay comparable.

`totalTokens` is present and tempting and wrong: live, it is `198841` against a correct occupancy of `198073`, because it adds the turn's 768 output tokens. Using it would overstate occupancy by one turn's output on every reading and make Oh My Pi cross the handoff threshold earlier than Claude at the same real occupancy.

### D8 — An unknown context window reports `0`, not the 200 000 default

`resolveModelLimit` (`src/core/agent-context.ts:86-88`) falls back to `DEFAULT_CONTEXT_LIMIT = 200_000`. That floor is defensible for Claude Code, which runs one vendor's models, all at or above 200k. It is not defensible for Oh My Pi, which routes to dozens of providers (`omp://environment-variables.md` enumerates them) where the true window ranges from a few thousand tokens to over a million. A substituted 200k would produce a confident `pct` describing nothing — the class of defect this whole line of work exists to remove.

The reader therefore uses `resolveModelPreset(model)?.contextWindow ?? 0` and, at `limit === 0`, reports `pct: 0`. This is not new behavior in the codebase: the Codex branch already returns `limit: 0` when no window was ever reported (`agent-context.ts:267-278`), for the same reason.

Consequence to accept: an Oh My Pi session on a model outside `MODEL_PRESETS` gets occupancy and no fraction, so fraction-based handoff thresholds do not fire for it while absolute `remainingTokens` thresholds also cannot (remaining is `0` at an unknown limit). That is honest unavailability, and it is visible; a wrong percentage would not be.

### D9 — Model id comes from the message, with `model_change` as the fallback

Live sessions carry `message.model` on every assistant message, so the last usage-bearing message supplies both the usage and the model — one pass, no second scan, matching the Claude branch (`agent-context.ts:165`). `model_change` entries exist and are authoritative for context reconstruction inside Oh My Pi, but they can precede a turn that never completed; the model that actually produced the measured usage is the one attached to it. Fall back to the last `model_change`, then `'unknown'`.

### D10 — Agent-directory resolution is its own module

`src/core/omp/omp-home.ts`, mirroring `src/core/hermes/hermes-home.ts:23-26` and `src/core/codex/codex-home.ts`: resolve the active agent directory honoring `PI_CODING_AGENT_DIR` (default profile only), `OMP_PROFILE`/`PI_PROFILE` → `~/.omp/profiles/<name>/agent`, and `PI_CONFIG_DIR`, defaulting to `~/.omp/agent`. Keeping it separate means the locator has one place to ask and the probe never hardcodes `~/.omp`.

### D11 — The `unsupported-host` contract narrows; it is not deleted

After the flip, `omp` is probe-capable, so the implicit-`--latest` refusal no longer fires for it. `zed` remains registered without a probe adapter but has no host fingerprint, so the reason literal becomes reachable only via `RASEN_AGENT_RUNTIME=zed`. Keep the reason literal, the tagged-union arm, and the requirement: the next registered harness needs them, and removing a live contract to reflect a temporarily empty set is how the fabricated-zero class of defect comes back.

### D12 — The UI wire mirror is relaxed before the server widens

`packages/ui/src/api/types.ts:163` hand-mirrors `ThresholdBindingRow` in a separate typecheck realm. `src/core/management-api/threshold-schemes.ts:60` builds `bindingRows` from `[...PROBE_RUNTIMES, 'default']`, so the server starts sending `omp` the moment the flag flips. Per this project's `management-api-wire-mirror-field-relaxation` rule, widen the mirror first; otherwise both typechecks pass while the workbench renders a row it cannot type.

### D13 — The dispatch-fallback locale copy loses its second clause

`src/locales/{en,ja,zh-cn}.json:433` currently promises that forcing `RASEN_AGENT_RUNTIME` "also lifts the context-probe refusal", and that `rasen agent context --latest` then reads the Claude transcript store. Once Oh My Pi has a probe adapter there is no refusal for it to lift, and the sentence is false for the only host that can trigger this warning today.

The message key stays (removing it breaks catalog parity) and the second clause is dropped in all three catalogs. `test/commands/pipeline-messages.test.ts:105-135` asserts the exact rendered string in all three locales — deliberately, because the English copy contains "c-**omp**-atibility" and a `toContain('omp')` check would pass vacuously. All three expected strings move together.

### D14 — Threshold binding rows gain `omp`, and the handoff default is stated

`bindingRowsFor` (`src/core/threshold-resolver.ts:107-113`) pushes the probe runtime as a binding row only when it is probe-capable, so after the flip an Oh My Pi probe resolves an `omp` row instead of falling through to `default`. This is the intended realization of the already-written forward scenario "A future probe adapter becomes binding-eligible" (`rasen/specs/runtime-adapter-registry/spec.md:171-175`), and it changes the resolved threshold for an Oh My Pi session that has an `omp` binding configured.

`defaultHandoffThresholdForRuntime` (`src/core/pipeline-registry/types.ts:717-720`) branches only on `codex`, so Oh My Pi inherits the Claude default. Stated rather than changed: the Codex-specific value exists because codex-cli's own compaction behavior differs, and no equivalent measurement exists for Oh My Pi yet. Revisit with data, not by analogy.

## Risks / Trade-offs

- **[A future Oh My Pi bucket layout appears and the locator misses it]** → The locator enumerates whatever buckets exist rather than deriving names, so a third layout is found automatically; only a change to where the `sessions` directory itself lives would break it, and that is centralized in D10.
- **[Scanning all buckets is slower than deriving one name]** → Bounded by bucket count (6 on this machine) × one 4 KiB header read of the newest file per bucket. Prefer newest-mtime-first ordering so the common case reads one header.
- **[D8 makes handoff sensing unavailable for unlisted models]** → Visible unavailability, reported through the existing absence path. Mitigate incrementally by adding presets, not by restoring a fabricated default.
- **[D2's detection path list drifts as Oh My Pi adds config surfaces]** → A missing path only under-detects (no nudge), never mis-installs. Acceptable failure direction.
- **[D5's warning is advisory and can be ignored]** → Yes. The alternative — silently taking over the enclosing tree's instructions — is the worse failure, and it is the current behavior for any tool that creates a config directory.
- **[Generated-skill parity hashes move]** → `src/core/templates/workflows/{_orchestration,auto,handoff,goal-command}.ts` all assert that no context reading exists in an Oh My Pi session. `rasen/specs/workflow-template-parity/spec.md` mandates the order: edit templates, rebuild, run the **built** CLI's update, then recompute both hash maps. Recomputing from source without the rebuild produces hashes that pass locally and fail CI.
- **[The two slices could be split]** → They are independent and could ship separately. Delivered together because the install slice alone leaves the harness's own context unmeasurable, and the probe slice alone leaves a harness Rasen can measure but not install into.

## Migration Plan

No data migration, no configuration migration, no rollback state. Both slices are additive: an existing project that never selects Oh My Pi is byte-identical, and every Claude/Codex probe path is unchanged. The one user-visible reversal is that an implicit `--latest` in an Oh My Pi session stops returning `available: false` and starts returning a reading — the point of the change.

Order within the change: relax the UI mirror (D12) → install slice → probe slice → locale copy (D13) → template prose → rebuild → hash refresh. The install slice is independently verifiable (`rasen init --tools omp` writes `.omp/skills/rasen-*/SKILL.md` and an `omp` session discovers them), so it can be smoke-tested before the probe slice lands.

## Open Questions

1. **`detectionPaths` composition.** The proposed list is drawn from Oh My Pi's documented project surfaces. Is `.omp/skills` alone sufficient (Rasen's own install always creates it), or should the broader list stand so a project that configured Oh My Pi by hand is also detected? The broader list is proposed; the narrow one is defensible.
2. **D5's warning trigger.** Warn only when an enclosing `.omp/AGENTS.md` or `.omp/RULES.md` actually exists (proposed, precise, requires an ancestor walk at init time), or warn unconditionally whenever a nested `.omp/` is newly populated (cheaper, noisier)?
3. **D8 and `MODEL_PRESETS`.** Should this change also add presets for the model families Oh My Pi routes to most often on this machine, or is that a separate data-only change? Proposed: separate, so the honest-unknown behavior is what gets verified here.
