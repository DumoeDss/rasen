## Why

Rasen currently repeats runtime allow-lists across context probing, token auditing, management wire types, and pipeline runtime validation. Those lists already disagree in meaningful ways—Zed is auditable but neither probeable nor dispatchable—and they will drift further as runtime support expands, blocking the approved threshold-binding design from safely using runtime identity as a configuration key.

## What Changes

- Add one runtime adapter registry whose entries declare independent `canProbeContext`, `canAudit`, and `canDispatch` capabilities.
- Register the existing capability matrix: Claude and Codex support all three capabilities; Zed supports audit only.
- Derive capability-specific runtime types, value lists, guards, and validation choices from that registry.
- Convert context-probe runtime validation, both token-audit runtime definitions, audit management/wire types, and pipeline runtime schema/config validation to consume the registry instead of maintaining local allow-lists.
- Preserve existing command values, defaults, wire values, and rejection behavior while making future runtime additions flow through one source of truth.
- Add focused registry and consumer regression tests, including Zed's audit-only boundary.

## Capabilities

### New Capabilities

- `runtime-adapter-registry`: Defines the capability-based runtime registry and the contract by which probe, audit, dispatch, configuration, and wire consumers derive their supported runtime sets.

### Modified Capabilities

None. Existing context, audit, pipeline, configuration, and management API behavior keeps the same supported values in this slice; only their source of truth changes.

## Impact

- Affected core areas: agent context probing, token-audit CLI/service types and validation, pipeline runtime schemas and stage overrides, configuration-key metadata/parsing, and management API wire types.
- The existing broad `AI_TOOLS` installation registry remains separate; runtime execution capabilities have a narrower lifecycle-specific meaning.
- No new dependency, configuration key, runtime implementation, UI surface, threshold scheme, or runtime binding is introduced here.
- Package version and keepalive runtime settings remain unchanged.
