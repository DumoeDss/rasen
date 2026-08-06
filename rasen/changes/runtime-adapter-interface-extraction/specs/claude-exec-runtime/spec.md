## ADDED Requirements

### Requirement: A bridged worker identifies itself as its own runtime

A worker Rasen starts through a bridge SHALL identify itself as the runtime it is, to every Rasen command it subsequently runs, regardless of which harness spawned it. Rasen SHALL establish that identity when it starts the worker rather than relying on the worker's own environment fingerprints, because a child process inherits the spawning harness's fingerprints and would otherwise report its parent's identity as its own.

This identity SHALL be established for every bridge Rasen starts, not only the bridge that needs it today, so a bridge added later inherits the guarantee instead of having to re-derive it.

#### Scenario: A Claude worker started from a Codex host reports Claude

- **WHEN** Rasen starts a Claude worker through the print-mode bridge from a host whose environment carries Codex fingerprints
- **THEN** a Rasen command run inside that worker SHALL report its host runtime as `claude`
- **AND** SHALL NOT report the spawning host's runtime

#### Scenario: A Claude worker started from a harness that sets Claude's own fingerprints reports Claude

- **WHEN** Rasen starts a Claude worker from a harness that sets Claude environment values of its own
- **THEN** a Rasen command run inside that worker SHALL report its host runtime as `claude`

#### Scenario: Establishing identity changes nothing else about the worker environment

- **WHEN** Rasen starts a bridged worker
- **THEN** every other inherited environment value SHALL reach the worker unchanged
- **AND** the worker's invocation, prompt transport, session continuation, and completion contract SHALL be identical to their behavior before this capability
