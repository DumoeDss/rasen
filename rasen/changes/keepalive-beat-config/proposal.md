## Why

Measured cost data (token-cost-audit, 2026-07) pinned the keepalive economics: subagent prompt caches live 5 minutes with sliding refresh on every read, a beat costs ~0.1x of the prefix regardless of beat length, so a 270-second beat is near the theoretical optimum refresh cadence — yet `rasen agent wait` hard-defaults to 100 seconds (chosen only to fit the Bash tool's 120-second *default* timeout, which is explicitly raisable to 600s). Users cannot select the economic cadence without editing every dispatch prompt, and the playbook lacks the discipline items that make longer beats safe: pairing the beat with a raised tool timeout, keeping parked workers silent between beats, standing workers down promptly, and keeping caches warm during long foreground commands.

## What Changes

- New global config key `keepalive.beatSeconds` (integer 90–280, registry default 270). `rasen agent wait` resolves its beat as: explicit `--beat-seconds` flag > resolved `keepalive.beatSeconds` (the registry default 270 when unset) > built-in fuse `DEFAULT_BEAT_SECONDS` (100, unchanged — applies only when configuration is unavailable or the on-disk value is out of range). The 300-second hard cap still applies.
- Orchestration playbook (Step B.4 and the long-task discipline), shared by rasen-auto / rasen-goal / review-cycle templates:
  - **A. Economy dispatch wording**: every park dispatch names the Bash tool `timeout: 330000` (ms) in the same sentence as the wait call — a fixed constant covering the maximum 280s beat plus margin, so a configured beat can never be killed by the default 120s tool timeout.
  - **B. Beat silence**: on a `{beat}` outcome the worker emits no text and no thinking — it immediately re-issues the identical wait call, keeping the continuation a pure tool-result cache extension.
  - **C. Prompt stand-down**: the LEAD writes a `standDown` signal the moment a parked worker is no longer needed; the 12-beat cap is a stop-loss backstop, not the retirement mechanism.
  - **D. Long-command warming**: commands expected to run >~2 minutes (or of unknown duration — tests, builds) run with `run_in_background` plus bounded foreground polling at intervals ≤270s (each poll return refreshes the cache); short commands stay foreground. Merged with the existing wait-discipline prose (original rationale: lost-wakeup prevention; new rationale added: cache warming).
- Pipelines page (packages/ui): a Keepalive control in the Defaults section for `keepalive.beatSeconds` — two built-in presets (100 "compatible/fast", 270 "economy", the default) plus a custom 90–280 input, with an informational derived tool-timeout hint (beat + 50s). Writes go through the existing config HTTP API; no new endpoint.
- Locales: en / zh-cn / ja strings for the new key description and CLI help.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `cli-agent-wait`: the "Beat semantics" requirement gains config-driven beat resolution (`--beat-seconds` > `keepalive.beatSeconds` > 100), keeping the 300s hard cap and the unconfigured-default-fits-timeout behavior.
- `config-key-registry`: the "Keepalive keys are registered" requirement adds `keepalive.beatSeconds` (global, integer 90–280, default 270).
- `pipelines-ui`: new requirement — the Defaults section offers a keepalive beat control with presets, custom input, and the derived tool-timeout hint.
- `worker-reuse-orchestration`: new requirement — parked-worker beat economy discipline in the generated playbook (fixed 330000ms tool timeout in park dispatches, beat silence, prompt LEAD stand-down, long-command background-plus-bounded-polling warming).

## Impact

- `src/core/keepalive/index.ts` (KeepaliveConfig/resolveKeepaliveConfig + beatSeconds), `src/commands/agent.ts` `wait()`, `src/cli/index.ts` flag help, `src/core/config-keys.ts`, `src/core/config-schema.ts`.
- `src/core/templates/workflows/_orchestration.ts` (shared playbook — embedded in rasen-auto, rasen-goal, review-cycle skills; parity hash tables must be refilled).
- `packages/ui/src/components/PipelinesPage.tsx` + API-driven config write path (existing `ConfigEntryRow` machinery), UI tests.
- Locale catalogs (en/zh-cn/ja). Locale files carry unrelated uncommitted edits from another session — commits must use explicit pathspecs.
- Tests: `test/commands/agent-wait.test.ts`, `test/core/keepalive.test.ts`, config-keys round-trip, `test/core/templates/skill-templates-parity.test.ts` (both hash tables), UI tests.
- Behavior change (deliberate, not breaking): with the registry default 270, an unconfigured machine's beat moves from 100s to 270s — safe because the same change lands the playbook discipline that every park dispatch carries a fixed Bash tool `timeout: 330000`; bare `rasen agent wait` calls outside the playbook keep working because a beat is just longer, never over the 300s TTL cap. The 100s fuse remains for environments where config cannot be read. See design.md D1.
