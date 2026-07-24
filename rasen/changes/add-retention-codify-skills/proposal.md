## Why

Rasen can preserve retrospective reports and can append `[RULE]` lines into project `quality-rules`, but neither path turns evidence from a completed change into a bounded, maintainable skill that reliably improves future agent behavior. A first-class retention policy is needed so users can choose historical reporting or procedural codification without running both, while preventing generated knowledge from becoming stale, duplicated, over-broad, or unsafe.

## What Changes

- Add a `rasen-retain` workflow with one active retention mode: `off`, `report`, or `codify`.
- Preserve retrospective reporting behind `report`; add change-scoped `codify` that may create, rewrite, retire, or decline to create managed learned skills from planning, review, verification, shipping, and regression-test evidence.
- Store learned skills in separate project and global registries rather than as user workflows or named-profile workflow entries. Project scope is the default; global promotion requires matching evidence from multiple projects and explicit user approval.
- Add a localized `rasen knowledge` command group so retain submits strict candidates through deterministic plan/apply, list/show, retirement, locking, ownership, and atomic-write behavior instead of editing skill directories directly.
- Materialize only applicable learned skills into already-configured AI-tool skill directories through Rasen's managed generation and artifact-ledger paths.
- Add a profile retention dimension so `rasen profile`, `profile new`, and `profile update` present report and codify as a mutually exclusive choice. Migrate existing retro selections to report mode.
- **BREAKING**: write current and named profiles as strict definition version 2 with `retention`; version 1 remains readable, but newly written thin YAML/JSON profiles require a Rasen version that supports v2.
- Change the full-feature delivery tail to `ship → retain → archive`, allowing archive to preserve the selected retention result.
- Retire `rasen-retro` as a profile-selectable/model-invoked workflow and keep a user-invoked compatibility alias during migration.
- **BREAKING**: archive no longer extracts `[RULE]` lines and appends them automatically to `quality-rules`. Existing user-authored and previously generated `quality-rules` remain intact and continue to be injected; codification also checks them when avoiding duplicate learned guidance.
- Treat zero accepted lessons as a successful codify result; the workflow never creates a skill merely to prove it ran.

## Capabilities

### New Capabilities
- `learned-skills`: Covers evidence-gated codification, project/global scope decisions, naming and applicability, managed storage, safe create/update/retire operations, provenance, validation, and tool-specific materialization.

### Modified Capabilities
- `profiles`: Adds the mutually exclusive retention mode to current and named profiles, including migration, import/export, and picker behavior.
- `opsx-retro-command`: Replaces the standalone model-invoked retro workflow with the report branch of `rasen-retain` and defines compatibility behavior.
- `opsx-auto-command`: Runs retention between ship and archive in the full-feature pipeline and respects the active retention mode.
- `workflow-library`: Registers the retain workflow and retires retro as a selectable workflow identity without leaving dangling profile or pipeline references.
- `cli-init`: Installs the retain workflow and applicable learned skills for newly configured projects and tools.
- `cli-update`: Reconciles applicable learned skills, removes retired managed copies, and reports learned-skill changes without touching human-authored skills.
- `archive-quality-capture`: Stops turning `[RULE]` markers into project configuration while preserving archive quality summaries.
- `cli-archive`: Stops automatically appending extracted rules and archives after the selected retention operation.
- `navigator-router-skill`: Presents `rasen-retain` and its report/codify choice in the main workflow map instead of `rasen-retro`.

## Impact

- Code: profile schema and prompts, workflow templates/catalog, full-feature pipeline definition and resume artifact hints, learned-skill registry and candidate-validation modules, project/global machine-home resolution, init/update generation and artifact ledgers, archive quality capture, navigator/help text, and localized CLI messages.
- Data: named profile format gains a retention field with backward-compatible migration; learned skills gain managed manifests and canonical project/global stores. Existing `quality-rules` data is preserved.
- Security: generated skill content becomes persistent instruction, so source artifacts are treated as untrusted data; global promotion is approval-gated; only Rasen-managed learned skills may be rewritten or retired automatically.
- Compatibility: `rasen-retro` remains a temporary user-invoked alias for report mode, while existing profiles and project installs are migrated on read/update.
- Tests/docs: profile round trips, scope decisions, candidate rejection, deduplication, safe ownership, cross-platform paths, materialization/pruning, pipeline ordering/resume, archive behavior, locale parity, package contents, and skill-authoring guidance.
- Dependencies: no new runtime dependency is expected.
