## ADDED Requirements

### Requirement: Relocation is the recommended surface for destination changes
When the user changes `archive.destination` via the config-only path while existing archives remain at the previous location, the CLI SHALL note that existing archives stay where they are and point to `rasen archive relocate` as the way to move data and config together. The config-only flip remains valid; union-read semantics are unchanged.

#### Scenario: Config flip hints at relocate
- **WHEN** the user runs `rasen config set archive.destination external` and the repo archive directory is non-empty
- **THEN** the command succeeds and the output mentions that existing archives remain in the repo and `rasen archive relocate --to external` moves them
