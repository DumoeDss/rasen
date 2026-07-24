## Context

`rasen agent wait` (cli-agent-wait spec) beats default to `DEFAULT_BEAT_SECONDS = 100` in `src/core/keepalive/index.ts`, sized to the Bash tool's default 120s timeout. Token-cost experiments established: 5-minute cache TTL with sliding refresh, per-beat cost ≈ 0.1x prefix independent of beat length, so ~270s is the near-optimal refresh cadence; the tool timeout is raisable to 600000ms per call. The keepalive config block (`keepalive.runtimes.*`, `keepalive.contextFloor`) already flows registry (`src/core/config-keys.ts`) → zod schema (`src/core/config-schema.ts`) → `resolveKeepaliveConfig` → `AgentCommand.wait()` (`src/commands/agent.ts:305`). The orchestration playbook (`src/core/templates/workflows/_orchestration.ts`, Step B.4 at ~line 104–115) is embedded into the rasen-auto, rasen-goal, and review-cycle generated skills, all pinned by the parity test's two hash tables. In the web UI, keepalive keys (group `Pipelines`) are excluded from the Config page (`packages/ui/src/config/grouping.ts` `EXCLUDED_GROUPS`) and are claimed by the Pipelines page (`packages/ui/src/components/PipelinesPage.tsx`), which today renders only the role matrix and `AUTOPILOT_KEYS` — the existing keepalive keys render nowhere, an accepted gap this change partially fills for `beatSeconds` only.

## Goals / Non-Goals

**Goals:**
- Config-driven beat length with a safe resolution chain and unchanged hard limits.
- Playbook discipline (A–D) that makes long beats safe and cache-efficient in orchestration.
- A usable preset control on the Pipelines page for the new key.

**Non-Goals:**
- No documentation-only corrections (per user scope).
- No UI surface for `keepalive.runtimes.*` / `keepalive.contextFloor` (existing gap stays).
- No change to beat cap (12), MAX_BEAT_SECONDS (300), poll interval, or signal protocol.
- The D-item polling interval does not track `beatSeconds` — fixed "≤270s" wording.

## Decisions

**D1 — Resolution chain and where the 270 default lives.** `wait()` resolves beat as: explicit `--beat-seconds` > `keepalive.beatSeconds` from resolved global config (registry default 270 applies when the key is unset, matching what `rasen config get` and the UI report as effective) > `DEFAULT_BEAT_SECONDS` (100) as the fuse when config is unreadable or the value is out of range. Implementation: extend `KeepaliveConfig` with `beatSeconds: number` defaulting to 270 in `DEFAULT_KEEPALIVE_CONFIG`; `resolveKeepaliveConfig` accepts 90–280 integers and falls back to the default otherwise. In `wait()`, `options.beatSeconds ?? keepalive.beatSeconds` replaces `options.beatSeconds ?? DEFAULT_BEAT_SECONDS`, still clamped by `MAX_BEAT_SECONDS`. Rationale for effective-default-270 (vs raw-file-read defaulting to 100): the user decision is "default preset = 270", and two surfaces reporting different effective values (UI says 270, wait uses 100) would be a silent contradiction. The unconfigured-machine behavior change is covered by discipline A. Alternative rejected: making `DEFAULT_BEAT_SECONDS` 270 outright — keeps no fuse for bare calls under a 120s tool timeout when config is broken.

**D2 — Fixed dispatch timeout, not per-preset.** Park dispatch wording mandates Bash `timeout: 330000` unconditionally (280 max + 50s margin). Workers cannot read config, so any beat-dependent instruction would desynchronize; one constant eliminates the "config says 270, dispatch left default 120s" failure by construction. The UI's "tool timeout ≈ beat + 50s" line is informational only.

**D3 — Presets are UI interaction, not config.** No new preset key. Two buttons (100 "fast/compatible", 270 "economy") write `keepalive.beatSeconds` via the existing config API family write path used by `ConfigEntryRow`/Defaults cells; a bounded numeric input covers 90–280 custom. Selected state derives from the entry's effective value (100 → fast preset active, 270 → economy active, anything else → custom). Unset action follows the page's existing scope-mode rules; the key is global-only so it renders in Global mode only (consistent with `isVisibleInMode`).

**D4 — Where the control lives.** A "Keepalive" block in the Pipelines page Defaults section, after the autopilot keys, implemented as a dedicated `KeepaliveBeatControl` component using the same `WireConfigEntry` + write/refresh plumbing as `AUTOPILOT_KEYS` rows (`byKey('keepalive.beatSeconds')`). This honors the config-ui-package rule that the Pipelines group renders on the Pipelines page.

**D5 — Playbook edits are concentrated in Step B.4 plus the long-task clause.** A/B/C edit Step B.4 prose; D merges into the existing long-task discipline sentence (Step B.4 area + wherever the "禁后台+闲置等唤醒" long-task wording lives in the shared template), stating both rationales (notification loss, cache refresh) and the `run_in_background` + bounded foreground polling (interval ≤270s) rule for commands >~2 minutes or unknown duration. One shared template edit propagates to all three consumers; parity hash tables (`EXPECTED_FUNCTION_HASHES` and `EXPECTED_GENERATED_SKILL_CONTENT_HASHES` in `test/core/templates/skill-templates-parity.test.ts`) are refilled from a test run after the edit.

**D6 — Spec surface.** Deltas: cli-agent-wait (MODIFIED Beat semantics — the "default fits 120s tool timeout" scenario is superseded by the configured-beat + fuse scenarios), config-key-registry (MODIFIED Keepalive keys registered), pipelines-ui (ADDED beat control requirement), worker-reuse-orchestration (ADDED parked-worker beat economy requirement covering A–D). No spec governs template wording directly beyond parity hashing, which is a test artifact, not a requirement change.

## Risks / Trade-offs

- [Unconfigured machines jump 100→270 and a bare wait under a 120s tool timeout gets killed mid-beat] → Playbook-driven callers always pass `timeout: 330000` (discipline A); ad-hoc callers can pass `--beat-seconds 100` or set the config; the CLI flag help documents the pairing. The kill failure mode is silent-degrade (beat dies, worker retries), not data loss.
- [Config read cost/perf in wait()] → `getGlobalConfig()` is already called in `wait()`; only the resolved shape widens.
- [Locale files contain another session's uncommitted edits] → commit with explicit pathspecs and diff-audit ownership before staging (shared-index discipline).
- [Parity hash churn colliding with concurrent template work] → refill both hash tables in the same commit as the template edit; run the parity test to harvest new hashes rather than hand-computing.

## Migration Plan

Pure additive config key; no data migration. Rollback = revert. `pnpm build` required before CLI verification (`bin/rasen.js` runs dist).

## Open Questions

(none — design decisions were locked by the LEAD in planning-context.md)
