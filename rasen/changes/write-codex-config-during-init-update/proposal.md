## Why

Rasen's Codex-native orchestration already asks the LEAD to use one long, event-driven `wait_agent` join, but Codex's generic 60-second wait guidance can still drive repeated polling. A live session produced 85 consecutive `60000ms` waits; after the project-level Codex wait bounds were raised, the resolved tool schema required `3600000ms` and the same path used one wait that was woken early by the worker's completion after 100.814 seconds.

## What Changes

- When Codex is selected during `rasen init`, reconcile Rasen-managed multi-agent wait bounds into the project's `.codex/config.toml`.
- When Codex is already present in the authoritative project tool manifest, make `rasen update` detect and repair drift in those managed settings even when every generated skill is otherwise current.
- Configure the Codex V2 `min`, `default`, and `max` wait timeouts to `3600000ms`.
- Leave `multi_agent_mode_hint_text` and all other delegation prompts unmanaged so normal Codex multi-agent behavior remains intact.
- Preserve unrelated Codex configuration and user-authored content; refuse to overwrite an unreadable or structurally ambiguous file and report an actionable error.
- Scope the mutation to the project-local `.codex/config.toml`; do not change the user's global Codex configuration.
- **BREAKING**: In a Rasen-configured Codex project, intentional short `wait_agent` timeouts become invalid because the configured minimum is one hour. Waits still return immediately on agent mailbox activity or user steer.

## Capabilities

### New Capabilities

- `codex-project-config`: Manage the three project-local Codex multi-agent wait bounds safely, idempotently, and without overwriting unrelated Codex settings.

### Modified Capabilities

- `cli-init`: Codex tool setup also installs or refreshes the project-local Codex orchestration configuration and reports its outcome.
- `cli-update`: Codex configuration drift participates in update planning and is repaired for manifest-configured Codex projects before the up-to-date decision.

## Impact

- Affects Codex setup and refresh paths in `src/core/init.ts` and `src/core/update.ts`, plus a shared project-config reconciler for `.codex/config.toml`.
- Adds focused fixtures/tests for absent, existing, conflicting, malformed, CRLF, and cross-platform path cases, plus init/update integration coverage.
- Uses the existing `tools:` project manifest as the authority for whether update may touch Codex; it does not onboard Codex from directory detection.
- Requires generated documentation and update summaries to explain the project-local wait bounds, restart requirement, preserved native delegation behavior, and short-timeout compatibility change.
- Overlaps active work currently touching `src/core/init.ts` and `src/core/update.ts`; implementation must preserve unrelated worktree changes and coordinate those seams carefully.
