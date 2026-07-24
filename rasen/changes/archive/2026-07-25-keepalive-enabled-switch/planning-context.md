# Planning context: keepalive-enabled-switch

## User intent

> beat（rasen await）是需要能够开关的，因为目前是 Claude 会有这个情况，如果用户用 ClaudeCode 配其他 llm 就不需要这个操作，看看是如何设计这个开关

The user asked the autopilot to read `rasen/handoff/keepalive-enabled-switch.md` and finish the task end-to-end. They subsequently corrected the scope: the UI toggle MUST be included in this change.

## Locked design

- Add `keepalive.enabled`, a boolean defaulting to `true`.
- Support both global and project scope, with project configuration overriding global configuration. This keeps the switch consistent with the existing project-scoped `keepalive.beatSeconds` and lets projects using non-Claude models opt out independently.
- L2 dispatch rule: the LEAD reads the effective switch once at run start. Only `enabled=true` plus a Claude stage runtime may receive a reusable parking horizon. Disabled or non-Claude workers are dispatched `ONE_SHOT`, and their prompt must not teach the park protocol. Do not pass the raw enabled value to leaf workers.
- L3 safety gate: `rasen agent wait` must immediately return `standDown` with reason `keepalive-disabled` when the effective switch is false.
- Preserve the existing runtime gate. The explicit enabled switch is needed because Claude Code can host a non-Claude model while runtime detection still identifies the harness as Claude.
- Keep the configured beat default at 270 seconds. Keep the internal 100-second fallback used only when configuration cannot be read.

## Required artifacts and implementation areas

- Config registry/schema/effective project override and localized key descriptions.
- Keepalive config resolution and `agent wait` disabled gate.
- Orchestration playbook Step B.4 dispatch decision.
- UI control for `keepalive.enabled`, integrated with the existing keepalive settings surface and localized UI framework.
- Focused config and agent-wait tests.
- Delta specs for `cli-agent-wait`, `config-key-registry`, and `pipelines-ui`. For MODIFIED requirements, reuse the exact main-spec requirement heading and preserve every existing scenario verbatim before adding the new one.

## Constraints and scope

- Include the UI toggle and its directly required localized copy, styling, wiring, and tests. Existing dirty UI/i18n work may belong to a parallel `ui-i18n` change: inspect and preserve its unrelated portions, and identify any dependency explicitly rather than silently absorbing the whole change.
- The worktree is shared and dirty. Preserve all unrelated edits and untracked files.
- Any commit must use explicit pathspecs and be inspected afterward.
- Before shipping, trial-run the archive/spec-sync path because ordinary delta validation does not catch a mismatched MODIFIED target or dropped scenarios.
- The repository is cross-platform; follow `test/AGENTS.md` for test paths.

## Durable codebase findings

- `src/core/effective-config.ts` already provides registry-scope-aware `project > store > global > default` resolution, but `AgentCommand.wait()` currently reads its keepalive block directly from global config. The enabled switch therefore needs an explicit effective-project lookup at the command boundary.
- The Pipelines page already owns a dedicated `KeepaliveBeatControl` and scope helpers (`modeScope` / `isVisibleInMode`); the current page looks up only `keepalive.beatSeconds`, so the switch should extend that surface and reuse the existing config API write/unset flow.
- At planning time the keepalive component, `packages/ui/src/style.css`, and UI locale catalogs had no working-tree diff against `HEAD`. The Simplified Chinese `keepalive.preset_economy_title` value already contains replacement characters in the baseline; it is pre-existing copy damage, not part of the enabled-switch implementation unless handled explicitly.
