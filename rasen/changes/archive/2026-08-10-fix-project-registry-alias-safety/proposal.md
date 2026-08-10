## Why

Machine registry aliases can currently preserve the wrong fixed home metadata, recreate state during a read-only repair, or make project-home and planning selection resolve the same checkout differently. A normalized project selector can also silently adopt a drifted config identity, so these read paths need one fail-closed ownership contract before the follow-up branch can be verified.

## What Changes

- Collapse canonical registry aliases deterministically: preserve the direct claimant when present, otherwise the unique live claimant, and refuse mutation when live aliases disagree on fixed identity/home metadata.
- Keep read-only self-heal genuinely non-creating, including alias-only canonical repair when the recorded machine home is absent.
- Route non-ensuring project-home probes through the same canonical main-entry lookup used by registry owner and planning resolution, with the surviving-worktree fallback only when no main entry is available.
- Verify normalized project selection against both machine-registry identity and the selected root's current config identity; report the established planning-selection conflict before accessing planning content when they drift.
- Add focused registry, project-home, root-selection, and Store-planning resolver regressions, including Windows/case/path aliases and byte-level no-mutation assertions.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `project-registry`: Define deterministic canonical-alias ownership, non-creating read-only repair, and one canonical main-entry lookup for project-home probes.
- `store-project-namespace`: Require a normalized project selector's registry identity to agree with the selected root's config identity before the planning resolver adopts it.

## Impact

Later implementation is owned by `src/core/project-registry.ts`, project-home lookup surfaces, `src/core/store-planning/internal/resolver.ts`, and focused registry/project-home/root-selection/planning tests. Workspace claim/fsync recovery, archive engine recovery, spec reconciliation, and Store finalization remain outside this change; no runtime dependency is added.
