## MODIFIED Requirements

### Requirement: One-time brand config migration
On startup, before any command runs, the system SHALL perform a one-time, lossless adoption of machine data into the resolved locations, covering both the brand rename and the root relocation as one chain. When no environment override (`RASEN_HOME`, or the respective XDG variable) is in effect and the target (`~/.rasen`) lacks the corresponding content, the system SHALL adopt from old-scheme locations computed explicitly — the pre-relocation `rasen` directories (`%LOCALAPPDATA%\rasen` / `~/.local/share/rasen` for data; `%APPDATA%\rasen` / `~/.config/rasen` for config) first, else their legacy `openspec` brand siblings — by copying, never deleting or modifying the source.

Adoption granularity SHALL be fine enough that a target subtree that already exists does not skip the corresponding source subtree:
- For a top-level child that does NOT yet exist at the target, the child SHALL be copied all-or-nothing (temp-then-rename), never overwriting existing target content.
- For the `projects/` subtree specifically, when the target `projects/` already exists, the system SHALL recurse and adopt each old per-project home directory individually, still never overwriting an existing target home, so that a `projects/` directory created by another session does not cause the entire legacy `projects/` subtree to be skipped.

When adopting a per-project home directory under `projects/`, the system SHALL map the old home directory name to the CURRENTLY-referenced home name for the same `projectId`: it SHALL read the old-scheme `projects/registry.json` to find the `projectId` recorded for the old home, read the target `projects/registry.json` to find the current home name for that `projectId`, and copy the old home's content into the current home. When either registry lookup is missing or unreadable, the system SHALL fall back to copying under the old home name (still lossless), relying on `rasen doctor --gc`'s unreferenced-home sweep as the backstop. The target `projects/registry.json` SHALL NEVER be overwritten by adoption — the old registry is read for mapping only.

Telemetry `anonymousId` and `noticeSeen` SHALL survive adoption verbatim. Adoption SHALL be idempotent, and failures SHALL print a loud warning naming the source, target, and manual remedy while never breaking CLI startup. When an environment override is set, no adoption occurs — an explicit location is the user's choice.

#### Scenario: Old-scheme rasen data adopted into ~/.rasen

- **WHEN** the CLI starts with no env overrides, `~/.rasen` absent, and a pre-relocation `rasen` data directory containing `projects/` and `stores/`
- **THEN** the contents SHALL be copied into `~/.rasen`
- **AND** the registered project homes and registries SHALL be readable from the new location without any rewrite (registry keys are project paths; home entries are names)
- **AND** the old directory SHALL remain untouched

#### Scenario: Pre-existing target projects/ does not skip the legacy subtree

- **WHEN** the CLI starts with no env overrides, the target `~/.rasen/projects/` already exists (e.g. another session created it) but is missing a per-project home present in the old-scheme `projects/`
- **THEN** the system SHALL recurse into `projects/` and adopt the missing per-project home individually
- **AND** existing target home directories SHALL NOT be overwritten

#### Scenario: Old home name mapped to the currently-referenced home

- **WHEN** the old-scheme `projects/registry.json` records home `openspec-code-1e42477e` for a `projectId`, and the target registry references home `autonomy-ladder-1e42477e` for that same `projectId`
- **THEN** the old home's content SHALL be copied into the target's `autonomy-ladder-1e42477e` home directory
- **AND** no unreferenced `openspec-code-1e42477e` directory SHALL be created under the target `projects/`
- **AND** the target `projects/registry.json` SHALL NOT be overwritten

#### Scenario: Unmappable old home falls back to name-based copy

- **WHEN** an old per-project home cannot be mapped to a current home (the old or target registry is absent or unreadable, or no current entry shares the `projectId`)
- **THEN** the old home SHALL be copied under its original name (lossless)
- **AND** adoption SHALL NOT fail or overwrite the target registry

#### Scenario: Ancient openspec install chains in one hop

- **WHEN** the CLI starts with no env overrides, `~/.rasen` absent, no pre-relocation `rasen` directory, and a legacy `openspec` directory at the old-scheme location
- **THEN** the legacy contents SHALL be adopted into `~/.rasen` directly, preserving `anonymousId` and `noticeSeen`

#### Scenario: No adoption over existing content

- **WHEN** `~/.rasen` already contains the corresponding content
- **THEN** the system performs no adoption and overwrites nothing

#### Scenario: Env override disables adoption

- **WHEN** `RASEN_HOME` or the respective XDG variable is set
- **THEN** no adoption occurs for that resolution

#### Scenario: Adoption failure is loud but never fatal

- **WHEN** the adoption copy fails partway (e.g. a filesystem error)
- **THEN** the partially-copied child is cleaned up, a warning names the source, target, and the manual command to finish by hand
- **AND** CLI startup proceeds
- **AND** the next startup re-attempts (idempotent)
