# workflow-http-api Delta

## ADDED Requirements

### Requirement: Per-space enablement read endpoint

The management server SHALL serve `GET /api/v1/workflow-enablement?root=<absolute space root>` returning, from a fresh read at request time, the addressed space's workflow enablement state: whether the space follows the user-wide profile or its own selection override, and for every selectable catalog unit its id, kind, source, display title (with the skill-name fallback), whether it is enabled in that space's resolved desired set, whether its skill artifacts are currently installed in the space, and whether it is enabled only because an enabled workflow's dependency closure requires it. The `root` SHALL be required to be an absolute path that matches a registered space; any other value SHALL be rejected without probing the filesystem location. The read SHALL create, write, and install nothing.

#### Scenario: Enablement state for a space with an override

- **WHEN** a client requests enablement for a space carrying its own selection override
- **THEN** the response marks the space as using its own selection, and each unit's enabled state reflects the override's resolved closure, not the user-wide profile

#### Scenario: Closure-required units are marked

- **WHEN** an enabled workflow's dependency closure requires an expert the space's stored selection does not list
- **THEN** that expert's entry is enabled and marked as required by the closure

#### Scenario: Unregistered or relative root rejected

- **WHEN** the `root` value is a relative path, or an absolute path that matches no registered space
- **THEN** the response is an error and no filesystem probe of that location occurs

### Requirement: Per-space enablement mutations

`POST /api/v1/workflow-enablement` SHALL accept exactly three operations, discriminated by an `op` field, each addressed at a registered space root: `enable` (a catalog unit id) — add the unit to the space's selection, materializing a project-scope override from the space's current effective selection when none exists; `disable` (a catalog unit id) — remove the unit the same way; and `reset` — remove the space's override so it follows the user-wide profile again. The selection write SHALL go through the unified configuration layer's project-scope write path (registry-validated, comment-preserving), and the new selection SHALL then be applied to the space by running the CLI's own update flow as a bounded subprocess in the space's root under the shared admission whitelist — the server itself SHALL NOT install or remove workflow artifacts. The response SHALL carry the space's fresh post-apply enablement state. Guards mirror the existing mutation bridge: an unknown `op` or an id that is not a known catalog unit SHALL be rejected without any write or subprocess; at most one enablement mutation runs at a time (a concurrent request is refused as busy); the subprocess is bounded by a timeout; and an apply failure SHALL surface the CLI's own error message verbatim while reporting the state the space was actually left in.

#### Scenario: Enable in one space leaves others untouched

- **WHEN** a client enables a workflow for space A while space B carries no override
- **THEN** space A's config gains (or updates) its override including the workflow and its skill artifacts are installed in space A, and space B's config, desired set, and installed artifacts are unchanged

#### Scenario: Disable applies removal in that space

- **WHEN** a client disables a workflow that is installed in the addressed space and not required by any remaining enabled workflow's closure
- **THEN** the space's override omits it and its skill artifacts are removed from that space, and the response's enablement state shows it disabled and not installed

#### Scenario: Reset returns the space to the profile

- **WHEN** a client submits `reset` for a space carrying an override
- **THEN** the override is removed, the update flow reconciles the space to the user-wide profile's resolved set, and the response marks the space as following the profile

#### Scenario: Unknown unit or op writes nothing

- **WHEN** a client submits an `op` outside the three operations, or an enable/disable id that is not a known catalog unit
- **THEN** the response is a validation error, no configuration is written, and no subprocess is spawned

#### Scenario: Apply failure is honest

- **WHEN** the spawned update flow fails after the selection write succeeded
- **THEN** the response carries the CLI's own error message and the space's actual current enablement state, so the client can see the selection changed but the apply did not complete
