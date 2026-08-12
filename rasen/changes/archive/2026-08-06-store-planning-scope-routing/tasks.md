## 1. Foundation integration and caller baseline

- [x] 1.1 Make the archived `store-planning-foundation-v2` public contracts available on the implementation branch and add a compile-time consumer fixture that imports only the supported Foundation entry point.
- [x] 1.2 Record the complete production caller inventory for `ResolvedOpenSpecRoot`, `PlanningHome`, `changesDir`/`specsDir`/`archiveDir`, design-doc resolution, and planning-root joins; classify every hit as scope-seam work, standalone-only adapter, later-slice owner, fixture, or defect.
- [x] 1.3 Add a bounded source guard that rejects new Store business-code joins for `rasen/projects`, `rasen/changes`, `rasen/specs`, and Store/project design-doc paths outside the Foundation/routing adapters.
- [x] 1.4 Capture current standalone, registered-project, pointer-project, legacy Store, CLI JSON, and management-read behavior in focused compatibility tests before replacing the resolver.

## 2. StorePlanning Interface and diagnostics

- [x] 2.1 Add the `StorePlanning.open()` overloads and immutable `StoreAggregateReadScope`, `ProjectReadScope`, and `ChangeCreationScope` capability types behind one public Store-planning entry point.
- [x] 2.2 Define closed Store-read and project-read address unions, branded scoped locations, stable planning refs, Change selectors, and non-serializable capability tokens without exposing arbitrary relative paths.
- [x] 2.3 Implement the unified typed diagnostic envelope and stable scope-routing error codes, preserving Foundation error families and retiring `store_project_mutually_exclusive`.
- [x] 2.4 Define `PlanningScopeDescription`, deterministic evidence/notices, stable follow-up selection, and read-only compatibility projection types; document that descriptions and paths are locators rather than replayable authority.
- [x] 2.5 Export the Module Interface through core entry points while keeping filesystem, registry, context, Git, clock, and entropy seams internal.

## 3. Evidence collection and scope resolution

- [x] 3.1 Implement read-only adapters for Store/project registry snapshots, canonical filesystem inspection, Store/project/target-line catalogs, session/association/marker facts, and Git checkout/worktree role inspection with deterministic test adapters.
- [x] 3.2 Implement explicit `--store`/`--project`/`--target-line` validation and namespace resolution, including Store alias/UID disambiguation and project alias/permanent-id validation.
- [x] 3.3 Implement the precedence reducer (explicit selectors, session, execution association, planning marker, project binding, standalone discovery) so weak facts only fill gaps and every overlap conflict fails closed.
- [x] 3.4 Treat selected Change metadata as a relationship constraint, verifying Store/project/target-line and v2 identity without allowing flags or ambient facts to rewrite it.
- [x] 3.5 Classify explicit standalone, legacy flat Store, Store v2 aggregate, and Store v2 project layouts from metadata; never infer layout v2 from directory presence.
- [x] 3.6 Verify project catalog membership/planning binding, target-line catalog entries, planning checkout role, and Store UID/project identity on every Store v2 scope.
- [x] 3.7 Detect bound-project residual local planning as `split_planning_truth`; route ordinary reads only to Store truth and block every project mutation.
- [x] 3.8 Apply intent guards for Store aggregate read, project read, and Change creation, including `project_scope_required`, `target_line_required`, `planning_worktree_required`, and legacy-flat migration refusal.
- [x] 3.9 Freeze scope evidence fingerprints and implement mutation-time stale detection without silently re-resolving to a different scope.

## 4. Typed location and configuration routing

- [x] 4.1 Map every Store v2 project address through the Foundation layout contract and add only the missing collection/project-config variants behind the same validators and containment rules.
- [x] 4.2 Implement standalone and legacy-read address adapters that preserve current locations while returning the same semantic scoped-location shape.
- [x] 4.3 Implement Store aggregate locations for Store-level design docs and metadata only; ensure no project home, specs, Changes, or Archive path is fabricated without a project scope.
- [x] 4.4 Route project planning configuration/schema lookup to the resolved project config (Store partition for bound projects, local config for standalone), retaining Store/global inheritance precedence without a second planning-root algorithm.
- [x] 4.5 Add pure `win32`, `posix`, and native mapping tests covering mixed-case drives, separators, device names, symlink/containment attempts, Unicode, long paths, and deterministic repeated location lookup.

## 5. Scope-owned Change creation

- [x] 5.1 Move minimal Change creation behind `ChangeCreationScope.createChange()` and validate Change id, schema, implementation intent, and caller metadata before any write.
- [x] 5.2 For Store v2 creation, mint one Foundation seed, derive/verify planning-scope and Change-instance identities, reject caller-controlled identity fields, and serialize complete v2 metadata.
- [x] 5.3 Publish the minimal Change through sibling staging plus no-clobber rename, read back and verify metadata, and guarantee cleanup leaves either no target or one complete target.
- [x] 5.4 Preserve standalone metadata and seeded README/proposal/goal behavior without injecting Store or target-line facts.
- [x] 5.5 Keep initial pipeline run-state execution-owned and worktree-isolated after creation; prove Store planning location is never used as an ephemera fallback.
- [x] 5.6 Add stale-scope, duplicate, invalid-schema, identity-tamper, interrupted-publish, and Windows rename/error-path tests for Change creation.

## 6. CLI selection and compatibility adapters

- [x] 6.1 Register `--target-line` on every project-scoped planning command and pipeline inspection/resume surface, allow it with `--store` and `--project`, and update option types/completion/help snapshots.
- [x] 6.2 Convert `root-selection.ts` into the CLI invocation adapter: snapshot cwd, map flags/intents, render the shared diagnostic/notices, and preserve JSON failure envelopes without resolving paths itself.
- [x] 6.3 Replace `PlanningHome` as an authority with a read-only scope-derived view; prohibit aggregate and mutation projection and derive every compatibility field through typed locations.
- [x] 6.4 Update root/context JSON and human banners to report scope kind, stable Store/project/target-line facts, layout, intent, evidence/notices, and complete reproducible follow-up selectors.
- [x] 6.5 Constrain version-warning and registry self-healing side effects to the actual standalone/execution project so a Store checkout or project partition is never registered as a project by scope selection.
- [x] 6.6 Update doctor diagnostics to inspect unavailable, legacy-flat, split-truth, and aggregate scopes read-only without turning diagnostic access into repair or mutation authority.

## 7. Workflow and read-command consumers

- [x] 7.1 Route `new change`, status, artifact/apply instructions, workflow shared helpers, artifact graph/context loading, and schema selection through one opened scope per invocation.
- [x] 7.2 Make status/instructions payloads derive Change root, artifacts, evidence, handoff, Archive line, planning write roots, execution roots, and compatibility fields from the same scope/context pair.
- [x] 7.3 Refactor list, Change/spec show, and validate to accept scoped collection/item locations rather than a physical root and prove Store aggregate/project-required behavior explicitly.
- [x] 7.4 Refactor item discovery, Change parsing, task progress, references, and relationship/status helpers so project content enumeration begins at a scoped location and never reconstructs a Store path.
- [x] 7.5 Replace old root-join unit tests for migrated readers with Module-interface and cross-command contract tests; delete tests that assert the obsolete flat Store algorithm.

## 8. Lifecycle, orchestration, placement, and guidance consumers

- [x] 8.1 Route pipeline Change lookup, run recovery/resume selection, pipeline-library planning reads, and agent Change lookup through project scopes while keeping run-state and execution behavior in their existing owner Modules.
- [x] 8.2 Route direct Archive entry, bulk/ship adapters, work, and doctor through scope intent guards; preserve supported standalone behavior and refuse legacy-flat or Store v2 finalization paths not yet owned by `ChangeFinalizationModule`.
- [x] 8.3 Update file-placement resolvers and action-context construction to consume the frozen planning scope plus explicit execution context, including unavailable execution authority and Store/project design-doc distinction.
- [x] 8.4 Update office-hours, design, propose, sync-specs, archive, direction, onboard, auto/gauntlet, and other generated workflow guidance to consume CLI-reported typed locations without teaching sibling/root path algorithms.
- [x] 8.5 Add generated-template guards proving no template constructs flat Store Changes/specs/design-docs/Archive paths or treats visibility/current directory as write authority.

## 9. Management and session read models

- [x] 9.1 Change `project:<selector>` management resolution to return the project's effective local or Store-backed project scope and `store:<id>` to return a Store aggregate scope.
- [x] 9.2 Resolve omitted-space fallback from the launch project identity/binding instead of assuming the launch checkout is the planning root; preserve the launch checkout only as execution context.
- [x] 9.3 Refactor changes, archive, task detail, runs, workflow submission, and related management handlers to accept scoped project locations and return `project_scope_required` for Store aggregate input where project content is required.
- [x] 9.4 Update session launch/context and working-directory attribution to consume the shared scope description without creating worktree pairing or persisting capability tokens/absolute planning paths.
- [x] 9.5 Add management contract tests for unbound and bound projects, Store aggregate input, same-id namespaces, worktree path selectors, split truth, unavailable bindings, Windows canonical paths, and zero-write resolution.

## 10. Integration gates and cross-platform verification

- [x] 10.1 Add a combined selector/layout/intent matrix covering standalone, registered project, configuration-only inheritance, bound Store v2 project, Store aggregate, legacy flat Store, split truth, conflicting facts, and integration-checkout mutation refusal.
- [x] 10.2 Add CLI E2E journeys proving list/show/validate/status/instructions/new/context/pipeline consistency, complete follow-up flags, v2 Change identity, and no writes outside the selected project partition.
- [x] 10.3 Run affected legacy Store/project/config/session/archive/pipeline/management compatibility suites and attribute any baseline failures without weakening fail-closed scope behavior.
- [x] 10.4 Add or update Windows CI verification for native path construction, canonical path aliases, Unicode, long paths, containment, no-clobber publication, and deterministic diagnostics; run equivalent POSIX fixtures.
- [x] 10.5 Re-run the production caller inventory and source guard, resolving every remaining planning-root join or documenting it as a standalone adapter/later-slice owner with an explicit test.
- [x] 10.6 Run focused tests, TypeScript typecheck, lint, build, strict Change validation, and `git diff --check`; strictly decode every changed text file as UTF-8 and audit BOM, replacement characters, mojibake, and unrelated worktree changes.
