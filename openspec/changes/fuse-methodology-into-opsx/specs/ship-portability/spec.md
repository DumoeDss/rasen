## REMOVED Requirements

### Requirement: Runtime-agnostic test execution in ship
**Reason**: The `ship` expert skill was removed in change `remove-gstack-parallel-lifecycle`; this requirement describes a `skills/gstack/ship/SKILL.md.tmpl` that no longer exists, so it can no longer be true of the live system.
**Migration**: The release contract now lives in the `/opsx:ship` workflow template, which runs the project's detected test command (see the `opsx-ship-command` capability). The historical record of this cleanup remains in `openspec/changes/archive/2026-07-06-phase0a-cleanse/`.

### Requirement: Eval suites step is optional and project-declared
**Reason**: The `ship` expert skill was removed in change `remove-gstack-parallel-lifecycle`; the eval-step requirement targets a deleted `skills/gstack/ship/SKILL.md.tmpl`.
**Migration**: No successor expert exists; `/opsx:ship` does not hardcode an eval harness. Historical record in `openspec/changes/archive/2026-07-06-phase0a-cleanse/`.

### Requirement: Commit co-author trailer is not model-pinned
**Reason**: Both the `ship` and `document-release` expert skills were removed in change `remove-gstack-parallel-lifecycle`; this requirement constrains two deleted `.tmpl` files.
**Migration**: Commit/trailer behavior is governed by the `/opsx:ship` workflow template; no expert skill hardcodes a model-version-specific trailer. Historical record in `openspec/changes/archive/2026-07-06-phase0a-cleanse/`.
