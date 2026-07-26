## Why

A Store's knowledge is shared the moment someone clones the Store — it lives in Git. A project's own learned knowledge is not: it lives on the machine that learned it, under the project's identity, and a second machine that clones the same project starts empty. That is the correct default. `~/.rasen` is not a directory anyone should synchronize wholesale, and a project's knowledge is entangled with what a specific machine generated, owns, and can verify.

Explicit bundle export, Store transport, and conflict-safe import now exist, but preparing a machine still cannot offer a bundle that the project or one of its Stores deliberately declared. This change adds that final, separately confirmed preparation step without turning setup into automatic synchronization.

## What Changes

- **A declaration is the only source of a bundle offer.** A project's committed configuration and a Store's project record may each name a portable bundle. With no declaration, preparation lists and imports nothing.
- **Bundle import is a distinct preparation action.** Preparation reports each declared bundle separately from obtaining repositories, registering them, and preparing the empty knowledge location.
- **Confirmation keeps the existing trust asymmetry.** A blanket `--yes` may cover a bundle named by the project's own committed configuration. A bundle named only by a Store's project record is listed but requires an explicit choice and is never imported under blanket confirmation alone.
- **Unavailable bundles degrade rather than stop preparation.** A missing, unreadable, unsafe, or conflicting declared bundle is reported with a repair while the remaining preparation work continues.
- **Preparation reuses the landed import authority.** A confirmed action calls the F3 core importer directly, so complete validation, all-or-nothing conflict handling, project ownership, empty transport sources, and add-only behavior remain unchanged.

Out of scope: doctor/readiness changes; any Phase E implementation; Store mutation or publication; import-policy redesign; interactive conflict reconciliation; automatic synchronization; and portable run checkpoints.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `portable-project-knowledge`: add the original declared-bundle preparation requirement, with seven scenarios and no modification to any existing requirement.

## Impact

- **Project configuration:** one optional project-root-relative portable-bundle locator.
- **Store project records:** one optional Store-root-relative portable-bundle locator; it remains a locator only and grants no ownership, source, evidence, membership, or publication authority.
- **Machine preparation:** a distinct bundle action/result in the bootstrap report and consent surface. Existing `BootstrapReport.knowledge` continues to mean only knowledge-directory hydration.
- **Code:** project-config parsing, strict Store project-record serialization, Store membership projection, `src/core/store/bootstrap.ts`, `src/commands/bootstrap{,-messages}.ts`, completion/help text if affected, and focused tests.
- **Docs and locales:** declaration syntax, precedence and confirmation behavior, degraded repairs, JSON examples, and the `en` / `zh-cn` / `ja` CLI catalogs.
- **Compatibility:** additive. Existing configurations and Store records without a bundle declaration behave exactly as before.
- **Depends on:** F3's archived `importKnowledgeBundle` seam and E2's acting preparation flow; both are present at this change's base.
