## Why

After upgrading Rasen to a version that adds a new built-in workflow (e.g. `audit` / `rasen-audit`), a user on a `custom` profile — or a project carrying its own workflow override — runs `rasen update` and the new workflow's skill never appears. The stored selection is a frozen snapshot of the catalog as it was when the user last chose, so a workflow added later is silently absent, and nothing on either `rasen update` or the profile editor tells the user it exists. The user is left thinking everything is selected ("38 selected, custom, all checked") while a workflow is quietly missing from disk, and the only way to recover it is to reopen the picker and re-select everything.

## What Changes

- `rasen update` SHALL surface built-in workflows that exist in the current catalog but are absent from the resolved desired selection because they were added after the stored selection was last saved, pointing the user to `rasen profile` — so an upgrade that adds a workflow is honest rather than silent. `full`/`core` profiles already pick up new built-ins automatically (they resolve against the live catalog) and SHALL NOT emit this note; only frozen `custom` selections and project overrides can lag.
- The stored selection SHALL NOT be auto-mutated to absorb new built-ins: a `custom` selection stays exactly what the user chose (the existing "keep custom profiles user-owned" contract), and the new workflow becomes discoverable rather than silently re-added.
- The interactive profile editor SHALL surface, up front, which built-in workflows are available but not in the current selection, so a user opening `rasen profile` can find and add the new workflow without hunting through a paginated list of already-checked rows.
- The profile editor's checkbox state SHALL faithfully reflect the stored selection: a built-in workflow that is not in the stored selection and is not required by any selected workflow SHALL render unchecked. (This is affirmed and regression-locked; the reported "shows checked" perception traces to pagination and the legacy all-experts pre-check, not to a workflow being pre-checked while unstored.)

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `cli-update`: add a requirement that `rasen update` surfaces newly-available built-in workflows that a frozen selection has not absorbed, without mutating the stored selection.
- `profiles`: add a requirement that the interactive profile editor surfaces available-but-unselected built-in workflows, and affirm that checkbox pre-selection faithfully reflects the stored selection (an unselected, non-required built-in renders unchecked).
- `global-config`: record which built-in workflow ids were known when the selection was last saved, so `update` can distinguish a genuinely new workflow from one the user deliberately deselected.

## Impact

- `src/core/update.ts` — new surfacing note after desired-set resolution (reuses `resolveProjectWorkflowSelection`; no new resolution seam).
- `src/commands/profile-editor.ts` — discoverability line before the picker; regression coverage for faithful checked state.
- `src/core/global-config.ts` / `src/core/profiles.ts` — a stored baseline of known built-in workflow ids, written by the same paths that persist a selection (`applyProfileState`, `init`, migration), seeded non-regressively for legacy configs.
- Localized user-facing strings (profile/update message tables).
- No version bump. Cross-platform path discipline preserved.
