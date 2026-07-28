# Phase 1 Skill Plan

## Change Boundary

One Change, `add-direction-workflow`, owns the canonical skill template,
built-in catalog/profile/localization integration, help/navigator routing,
focused generation and parity tests, the approved development guide, and this
dogfood record.

## Dependencies

- Existing `SkillTemplate`, Store-selection guidance, built-in workflow
  registry, profile resolver, locale catalogs, init/update generation, and
  template parity surfaces.
- Existing Change lifecycle for implementation, verification, review, ship,
  PR, merge, and archive.

## Parallelism

The implementation is one reviewable Change. Automated test groups may execute
in parallel, but there is one Slice-level acceptance contract and one active
Slice.

## Dogfood Path

1. Build the local CLI.
2. Generate the selected Direction skill in an isolated temporary project
   through normal init/update machinery.
3. Inspect the installed file and absence of generated Direction workstream
   artifacts.
4. Read this manifest and its references from the workstream id alone to check
   discoverability.
5. Run focused, lint, build, and repository tests.
6. Return independent review and real PR/merge/CI evidence through Reconcile.

## Evidence to Return

- Exact commands and pass/fail counts for build and tests.
- Installed skill path, file set, and absence of `rasen/work/` in the isolated
  project.
- Discoverability observation from durable files only.
- Review findings and their disposition.
- PR, merge, and cross-platform CI links/status only after those events exist.

## Direction Source

- Workstream: `rasen/work/direction-workflow/work.yaml`
- Slice: `rasen/work/direction-workflow/slices/phase-1-skill/`
- Target State: `rasen/work/direction-workflow/target-state.md`
- Roadmap: `rasen/work/direction-workflow/roadmap.md`
- Planning baseline revision:
  `3e8d1d389cc6612c2bbd8c051cbf8b256189fe03`
