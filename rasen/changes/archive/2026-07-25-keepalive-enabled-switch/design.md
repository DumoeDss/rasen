## Context

Rasen currently controls parked-worker beats through per-runtime gates, an optional context floor, and a configurable beat duration. Those settings do not distinguish a Claude Code harness that is actually running a non-Claude model, so orchestration may still teach workers to park and hold slots even when prompt-cache keepalive is not useful.

The config registry and effective-config resolver already support fixed keys with `project > store > global > default` precedence constrained by each key's declared scopes. `rasen agent wait` currently resolves its keepalive input directly from global config, while the orchestration playbook teaches every reusable worker the parking protocol and relies on the command's runtime gate as the final guard.

The Pipelines Defaults section already has a dedicated `KeepaliveBeatControl`, keepalive styling, English/Japanese/Simplified Chinese copy, and component tests. It writes through the ordinary config API and uses `modeScope()`/`isVisibleInMode()` for scope-aware behavior. The implementation must extend that surface narrowly and preserve unrelated UI/i18n work in the shared worktree.

## Goals / Non-Goals

**Goals:**

- Provide one explicit `keepalive.enabled` boolean, defaulting to `true`, at global and project scope with project override precedence.
- Prevent disabled runs from dispatching parking instructions and prevent direct `rasen agent wait` calls from blocking or mutating beat state.
- Preserve the runtime gate as a second, independent condition.
- Show the effective switch and its source in the existing Pipelines keepalive surface and allow global or project-local writes and unsets.
- Localize the new registry description and UI copy in all shipped locales and cover the behavior with focused tests.

**Non-Goals:**

- Removing or replacing `keepalive.runtimes.*`, `keepalive.contextFloor`, beat caps, or signal-file semantics.
- Changing the configured 270-second beat default, the 90–280 validation range, the 300-second hard cap, or the internal 100-second unreadable/invalid-config fuse.
- Adding a store-scoped override.
- Passing the raw enabled value to leaf workers or letting leaf workers make the dispatch decision.
- Redesigning the Pipelines Defaults page or absorbing unrelated UI polish/localization edits.

## Decisions

### 1. Register a fixed global/project boolean with a compatibility-preserving default

Add `keepalive.enabled` to the declarative registry as a boolean in the `Pipelines` group, with scopes `global` and `project` and default `true`. Add the field to both the global and project keepalive schemas, to the typed keepalive input/resolved value, and to the localized config-description catalogs.

The generic effective-config resolver will therefore expose the value, its source, and raw scope values through the CLI/config API with normal project-over-global precedence. Store writes remain invalid because `store` is absent from the registry scopes.

Defaulting to `true` preserves all existing installations and generated workflows until a user opts out. An opt-in default was rejected because it would silently remove an existing cache optimization on upgrade.

### 2. Resolve the enabled gate at the owner project, then enforce it first in `agent wait`

After resolving the current planning home and change root, `AgentCommand.wait()` will obtain the effective `keepalive.enabled` entry for that project through the existing effective-config path using an explicit key lookup. The value will be folded into `resolveKeepaliveConfig`; an unset value resolves to `true`.

The command will check `enabled` before runtime, context-floor, beat-cap, signal, or polling work. When false it emits exactly:

```json
{ "standDown": true, "reason": "keepalive-disabled" }
```

and returns with exit code 0 without creating, reading, incrementing, or clearing beat state. Runtime detection remains the next gate, so enabled keepalive still parks only on allowed runtimes. The existing beat-duration resolver remains unchanged, preserving the 270-second configured default and 100-second failure fuse.

Using the effective-config lookup was chosen over reading only global config because the switch explicitly supports project override. Adding a new command flag was rejected because callers should not have to duplicate configuration and could bypass policy accidentally.

### 3. Make the LEAD decide once and omit parking knowledge from ineligible prompts

The generated orchestration playbook will add a run-start read of the effective `keepalive.enabled` value from the current planning context. The LEAD caches that boolean for the run and combines it with the already-resolved stage runtime:

- `enabled=true` and runtime `claude`: the existing lifecycle rules may assign `LOOP_BOUND` or `MILESTONE_BOUND`.
- `enabled=false` or any non-Claude runtime: assign `ONE_SHOT`.

For `ONE_SHOT` dispatches produced by this gate, the worker prompt will not contain the `rasen agent wait` loop, signal-file resume protocol, parking timeout, or the raw enabled value. This avoids spending prompt tokens teaching an unavailable behavior and prevents a Claude harness running another model from parking merely because harness fingerprinting says Claude.

The command-side disabled and runtime gates remain defense in depth for manual calls, stale generated prompts, and mis-dispatches. Reading the setting per worker was rejected because it could change policy mid-run and leak orchestration policy into leaf roles.

### 4. Extend the existing keepalive control instead of adding a generic row

`PipelinesPage` will explicitly look up both `keepalive.enabled` and `keepalive.beatSeconds` and pass them to the dedicated keepalive component when visible in the active mode. The component will add an accessible boolean toggle that:

- renders from the effective value and source returned by the config API;
- writes via `putKey` at `modeScope(mode, spaceType)`;
- unsets only the enabled key via `deleteKey`;
- appears in Global mode and Local mode for project spaces, but not Local mode for store spaces.

The existing beat value remains independently editable and is not erased when keepalive is disabled, so a user can preconfigure the cadence before re-enabling it. Minimal modifier styling will make the disabled effective state clear without restructuring the card. New labels, descriptions, state text, and accessible names will use `useT()` keys present in all three UI catalogs.

A separate generic `ConfigEntryRow` was rejected because it would split one keepalive concept across two Defaults surfaces and duplicate source/reset/error behavior. Broad CSS or copy cleanup is excluded; implementation must inspect the then-current diff before editing and preserve unrelated concurrent changes.

### 5. Pin each policy boundary with focused tests

Config tests will cover registry metadata, schema round-trips, default/source resolution, project-over-global precedence, store rejection, and registry count/parity expectations. Keepalive unit tests will cover default/explicit resolution, while command tests will assert an immediate `keepalive-disabled` outcome and no beat-state mutation for global and project overrides.

Orchestration-template tests will assert the run-start read, the Claude-plus-enabled dispatch condition, `ONE_SHOT` fallback, and omission of the park protocol from ineligible dispatch prompts. UI component/page tests will cover effective rendering, global and project writes/unsets, store-local invisibility, API re-resolution, accessibility, and locale catalog parity.

## Risks / Trade-offs

- [Risk] A caller resolves the switch without the owning project and silently ignores a project override. → Resolve the current planning root once and test opposite global/project values through both effective-config and `agent wait`.
- [Risk] The playbook's L2 decision and the command's L3 gate drift. → Use the same key/default semantics and keep independent tests for both boundaries.
- [Risk] Disabling keepalive after a run starts does not change already-dispatched policy. → Deliberately snapshot at run start for deterministic prompts; `agent wait` still reads effective configuration and provides the immediate safety gate.
- [Risk] Existing keepalive UI/i18n files receive concurrent polish edits. → Restrict edits to named toggle regions, inspect diffs before and after, and avoid wholesale formatting or locale rewrites.
- [Risk] A disabled project inherits an unrelated store value. → The registry excludes store scope, so effective resolution can only choose project, global, or default.

## Migration Plan

No config migration is required. Existing files without `keepalive.enabled` resolve to `true`, preserving current behavior. Users can opt out globally and selectively re-enable a project, or keep the global default and disable individual projects.

Rollback removes the new registry/schema/UI field and orchestration/command gates; existing config parsers tolerate the additive field according to their normal forward-compatible behavior. No signal or beat-state format changes are introduced.

## Open Questions

None.
