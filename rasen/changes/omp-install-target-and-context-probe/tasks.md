## 1. UI wire mirror relaxed first

- [x] 1.1 Widen `ThresholdBindingRow` in `packages/ui/src/api/types.ts:163` to include `'omp'`, per design D12 and this project's `management-api-wire-mirror-field-relaxation` rule — before any server-side widening, so the mirror is never the stale side.
- [x] 1.2 Add a parity assertion in `packages/ui/test/` that the mirrored `ThresholdBindingRow` union equals `[...PROBE_RUNTIMES, 'default']`, in the preset→mirror direction that `FU-5` records as missing for the model-preset mirror. Note in the test why `packages/ui` sits outside the root vitest include.

## 2. Install slice — registry entry

- [x] 2.1 Insert the `omp` entry into `AI_TOOLS` (`src/core/config.ts`, alphabetically after `Mistral Vibe`): `{ name: 'Oh My Pi', value: 'omp', available: true, successLabel: 'Oh My Pi', skillsDir: '.omp', adapted: true, detectionPaths: [...] }`. Populate `detectionPaths` per design D2 and Open Question 1.
- [x] 2.2 Verify by inspection that `getToolsWithSkillsDir()` now returns `claude, codex, hermes, omp` and that no other function in `src/core/shared/tool-detection.ts` needed an edit — every consumer is registry-derived (design D1).
- [x] 2.3 Confirm no per-tool branch is added to `src/core/init.ts` or `src/core/update.ts`: no config reconciler (design D3), no settings writer, no hyphen transform, and no command-path builder (design D4). Record this as a deliberate absence in the implementation record, since the absence is the decision.

## 3. Install slice — nested-install disclosure

- [x] 3.1 Add the enclosing-context check that design D5 requires: when init is about to newly populate `<dir>/.omp/` and an ancestor between `<dir>` and the repository root carries `.omp/AGENTS.md` or `.omp/RULES.md`, name those files in the output as no longer loading. Resolve the trigger shape from Open Question 2 first.
- [x] 3.2 Add a locale key for the disclosure in `src/locales/{en,ja,zh-cn}.json` with matching placeholders, or reuse an existing warning channel if one fits. Keep `test/locales/catalog.test.ts` key-set and placeholder parity green.

## 4. Install slice — tests

- [x] 4.1 Update `test/core/shared/tool-detection.test.ts:58-67`: rename the test away from the literal "(claude, codex, hermes)" and add `expect(tools).toContain('omp')`.
- [x] 4.2 Add a positive path assertion to `test/core/shared/tool-detection.test.ts` that `resolveToolSkillsRoot` for `omp` is `<project>/.omp/skills` and does not depend on `HERMES_HOME` — the assertion design D1 identifies as the one that would have caught a global-home misdirection.
- [x] 4.3 Extend `test/core/init.test.ts:283-303` and `test/cli-e2e/basic.test.ts:406-432` (`--tools all`) to assert `.omp/skills/rasen-*/SKILL.md` exists. Both suites set `HERMES_HOME`; assert the omp path explicitly so a wrong root fails instead of passing silently.
- [x] 4.4 Add a test that an empty `.omp/` directory is NOT reported by `getAvailableTools` and does NOT trigger the `detectNewTools` nudge, and that a populated one is (design D2, `omp-integration` detection scenarios).
- [x] 4.5 Add a test for the nested-install disclosure: warns when an ancestor `.omp/AGENTS.md` or `.omp/RULES.md` exists, silent when neither does, and the install completes either way.
- [x] 4.6 Add an update-side test that skills already installed under `<project>/.omp/skills` make `omp` configured and get refreshed in place.

## 5. Probe slice — Oh My Pi home resolution

- [x] 5.1 Create `src/core/omp/omp-home.ts` mirroring `src/core/hermes/hermes-home.ts`: resolve the active agent directory honoring `PI_CODING_AGENT_DIR` (default profile only), `OMP_PROFILE`/`PI_PROFILE` → `~/.omp/profiles/<name>/agent`, and `PI_CONFIG_DIR`; default `~/.omp/agent`. Always return an absolute path built with `path.join`/`path.resolve` (design D10).
- [x] 5.2 Add unit tests for each override and the default, including a named profile and a relocated agent directory, with Windows-safe path assertions.

## 6. Probe slice — session locator

- [x] 6.1 Implement the locator per design D6: enumerate every bucket under `<agentDir>/sessions`, take each bucket's newest `.jsonl`, read only enough leading bytes to reach the `type: "session"` header, keep candidates whose header `cwd` equals the requested cwd, and return the newest of those. Order buckets newest-mtime-first so the common case reads one header.
- [x] 6.2 Throw `AgentContextUnavailableError` when no candidate exists, so absence flows through the established environmental-absence path rather than surfacing as an unexpected error.
- [x] 6.3 Register `locateLatest` on `SESSION_STORES.omp` (`src/core/runtimes/session-stores.ts`) and rewrite its doc comment — it currently states "No `locateLatest`, no reader" as a design decision of the previous change.
- [x] 6.4 Add a regression test that reproduces the live finding: two buckets for one cwd, the newer session in the legacy-named bucket, and assert the locator returns the newer one. Include a bucket whose header records a different cwd and assert it is rejected even when its name suggests a match.
- [x] 6.5 Add a test that a bucket derived from the current hashed naming scheme is not privileged over other layouts — the locator must not special-case a derived name.

## 7. Probe slice — occupancy reader

- [x] 7.1 Implement `computeContextFromOmpSession(path, { limit })` in `src/core/agent-context.ts`: skip the fixed-width `title` row, scan for the last `type: "message"` entry carrying `message.usage`, and compute occupancy as `input + cacheRead + cacheWrite` (design D7). Tolerate malformed lines the way the Claude reader does.
- [x] 7.2 Resolve the model from that message's `model`, falling back to the last `model_change` entry, then `'unknown'` (design D9).
- [x] 7.3 Resolve `limit` as `options.limit ?? resolveModelPreset(model)?.contextWindow ?? 0`, and report `pct: 0` when `limit === 0` — deliberately NOT `resolveModelLimit`, whose 200 000 fallback would fabricate a window (design D8). Add a comment naming the Codex `limit: 0` branch as the precedent.
- [x] 7.4 Throw an actionable error naming the file when no usage-bearing message exists, matching the Claude reader's behavior rather than the Codex young-rollout zero.
- [x] 7.5 Register the reader in `CONTEXT_READERS` (`src/core/runtimes/context-readers.ts`) as `omp`.
- [x] 7.6 Add unit tests using a fixture captured from a real session shape: occupancy arithmetic, the explicit assertion that `totalTokens` is NOT the reported figure, an unknown model reporting `limit: 0` / `pct: 0`, a known model reporting its preset window, an explicit `--limit` overriding both, and the no-usage refusal.

## 8. Probe slice — capability flip and its forced consequences

- [x] 8.1 Flip `canProbeContext: true` on the `omp` row in `src/core/runtime-adapters.ts`.
- [x] 8.2 Build and work the compiler errors the flip forces — the missing `CONTEXT_READERS.omp` key and the `SESSION_STORES[runtime].locateLatest` index in `resolveTranscriptPath` — confirming tasks 6.3 and 7.5 satisfy both rather than casting past them.
- [x] 8.3 Update the capability-matrix string mirror inside the compiler fixture at `test/core/runtimes/registry-enforcement.test.ts:26-30`. It is a hand-written copy, so it drifts silently rather than failing; the file's own comment requires it to mirror the registry.
- [x] 8.4 Remove `expect(SESSION_STORES.omp.locateLatest).toBeUndefined()` (`test/core/runtimes/registry-enforcement.test.ts:120`) and assert it is defined instead.
- [x] 8.5 Update the three exact-equality assertions in `test/core/runtime-adapters.test.ts:14-35`, `:39-47`, `:49-51` for the new matrix and the widened probe tuple. Keep the audit and dispatch tuples untouched — a diff there means a capability outside this change's scope was flipped.

## 9. Probe slice — CLI contract tests

- [x] 9.1 Rework `test/core/agent-context.test.ts:452-470` (implicit `--latest` refusal) into the positive case: an Oh My Pi host with a session reports occupancy; with no session, reports the existing no-transcript unavailable result.
- [x] 9.2 Remove `'omp'` from the non-probe `--runtime` rejection table (`test/core/agent-context.test.ts:655-663`), keeping `zed` and `bogus`.
- [x] 9.3 Invert `test/core/agent-context.test.ts:736-741`, `:743-746`, `:748-751`: an explicitly named Oh My Pi session file is read rather than refused, and `tryContextEstimate` returns an estimate rather than `undefined`. The advice-text assertion becomes the widened `PROBE_RUNTIMES` join.
- [x] 9.4 Rework `test/cli-e2e/agent-context.test.ts:148-160` and `:166-189` to the positive e2e outcomes against the built CLI.
- [x] 9.5 Rework `test/commands/agent-command.context.test.ts:359-398`, whose describe block and comment cite the previous change by name; both need to state the new behavior.
- [x] 9.6 Verify `test/core/management-api/threshold-schemes-api.test.ts:188-189` stays green unmodified — it derives from `PROBE_RUNTIMES` and its `not.toContain('zed')` still holds. Record the non-edit so nobody "fixes" it.
- [x] 9.7 Confirm by inspection that `test/core/config-keys.test.ts:470-482` (`toEqual(['claude','codex'])`) is untouched. A diff there means a dispatch capability was flipped, contradicting this change's scope.

## 10. Locale and template copy

- [x] 10.1 Drop the "also lifts the context-probe refusal" clause from `hostRuntimeWithoutDispatchAdapterWarning` in `src/locales/{en,ja,zh-cn}.json:433` (design D13), keeping the key and its placeholders so catalog parity holds.
- [x] 10.2 Update all three exact expected strings in `test/commands/pipeline-messages.test.ts:105-135`. Preserve the comment explaining why exact strings are used instead of `toContain('omp')`.
- [x] 10.3 Correct the Oh My Pi claims in orchestration copy: `src/core/templates/workflows/_orchestration.ts:348,350` (H.1 / H.1b arms), `auto.ts:28,30`, and check `handoff.ts:26` and `goal-command.ts:30` whose wording is generic but whose premise weakens. Leave `_orchestration.ts:45` (dispatch routes) alone — Oh My Pi still has no dispatch adapter.
- [x] 10.4 Keep the exact substrings that `test/core/templates/orchestration-bundles.test.ts:102-113,345-370` and `test/commands/handoff.test.ts:128-168` anchor on.
- [x] 10.5 Compile the templates, rebuild, run the BUILT CLI's update to regenerate skills, then refresh both hash maps in `test/core/templates/skill-templates-parity.test.ts:58-131` — in that order, as `rasen/specs/workflow-template-parity/spec.md` requires. Only the affected skills' hashes may move.

## 11. Documentation

- [x] 11.1 Add the Oh My Pi row and tool id to `docs/supported-tools.md:26-56,:77` and `docs/cli.md:116-118`. Both lists are already stale — add the long-missing `hermes` in the same pass.
- [x] 11.2 Mirror both into `docs/zh/supported-tools.md:25-76,:78` and `docs/zh/cli.md:108-110`. The zh table still carries a column for the retired command surface; correct or drop it.
- [x] 11.3 Document the nested-install context capture (design D5) in `docs/troubleshooting.md` so a user who hits it without reading the init output can find it.
- [x] 11.4 Confirm no separate `website/` edit is needed — `website/docs.sync.config.mjs:62` syncs `docs/supported-tools.md` into the site.

## 12. Verification

- [x] 12.1 Install smoke test: run `rasen init --tools omp` in a scratch project, confirm `.omp/skills/rasen-*/SKILL.md` exists with non-empty `description` front matter, then start `omp` in that directory and confirm the Rasen skills appear in its discovered skill list and resolve through `skill://rasen-<workflow>`.
- [x] 12.2 Probe smoke test: from a live Oh My Pi session in this repository, run the built CLI's `agent context --latest --json` and confirm `runtime: "omp"`, a `contextTokens` figure consistent with the session's own last-turn usage, and a `transcript` path pointing at the session file actually in use — specifically the bucket holding today's session, not another layout's.
- [x] 12.3 Regression check: from a Claude Code session and a Codex session, confirm `agent context --latest --json` output is unchanged.
- [x] 12.4 Confirm the keepalive fail-safe is untouched: `test/core/keepalive.test.ts:171-183` passes unmodified, and no `keepalive.runtimes.omp` key exists.
- [x] 12.5 Run lint, typecheck, the root suite, and `packages/ui`'s suite (outside the root include). Record which gates ran.
- [x] 12.6 Write `evidence/verification-report.md` with the smoke-test transcripts, the bucket-layout evidence, and a `VERIFY VERDICT:` line.

## 13. Follow-up carrier

- [x] 13.1 Write `evidence/deferred-followups-report.md` recording the audit slice and the dispatch slice as open work, each with one `Findings:` line so `rasen archive` counts them into `quality.metrics`. Cross-reference the four `runtime-adapter-interface-extraction` follow-ups this change does NOT close (FU-1 dispatch spawn enforcement, FU-2 audit zero-report, FU-3 audit wire mirror, FU-4 viewer allow-list) and name their owning slice.
- [x] 13.2 Cross-reference that file from `evidence/verification-report.md`, so the archiving agent is pointed at it at the `VERIFY VERDICT:` hard gate.
