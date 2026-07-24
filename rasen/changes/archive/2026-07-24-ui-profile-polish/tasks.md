# Tasks: ui-profile-polish

## 0. Worktree & install preamble

- [x] 0.1 Confirm worktree `E:\AI\ChatAI\Agents\VibeCodingProjects\workflow\Reference\OpenSpec-polish-wt` exists on branch `feat/ui-profile-polish` (base `origin/dev/0.1.5@bf07dc22`) and the change artifacts are copied in; all implementation edits happen in the worktree
- [x] 0.2 `pnpm install` at the worktree root AND inside `packages/ui` (the UI package is NOT a workspace member — it installs independently)
- [x] 0.3 Baseline sanity: `pnpm build` at root; `pnpm typecheck && pnpm test && pnpm build` inside `packages/ui` — record any pre-existing failures before touching code (baseline: root build green; UI typecheck clean, 351 tests pass, build green — no pre-existing failures)

## 1. Nav active-state fix

- [x] 1.1 In `packages/ui/src/components/Layout.tsx`, derive `section` only when the URL itself carries a space (`routeSpace ? spaceSection(path) : null`) so Board/Archive/Config/Pipelines get no `aria-current` on `/profiles`, `/workflows`, `/spaces`, `/`; do NOT change `spaceSection()` itself (SpaceSwitcher relies on its `'board'` default)
- [x] 1.2 Add/extend the Layout test (`packages/ui/test/`): on `/profiles` (with a recent space making the space block render), only the Profiles entry has `aria-current="page"`; same for `/workflows`; a space route still highlights its own section

## 2. Profile value domains (core + wire + UI dropdowns)

- [x] 2.1 `src/core/config-keys.ts`: extend the `profile` entry's `enumValuesForScope` so global returns `['full','core','custom', ...listSavedProfileNames()]` (project unchanged: `['full','core', ...saved]`); update the entry description; update `test/core` registry/config tests for the new global domain
- [x] 2.2 `src/core/profiles.ts`: add `resolveUserWideProfileBase(profile, customWorkflows, expertSelectionExplicit)` (design D2 — reserved literals delegate to `getProfileWorkflows`; other names read the saved definition; unresolvable → warning descriptor + `full` fallback, mirroring `resolveLockedProfileBase`); route `resolveDesiredWorkflowSelection` through it and surface the warning as a config diagnostic like the lock warnings
- [x] 2.3 Disposition every direct consumer: grep `getProfileWorkflows(` and `globalConfig.profile` across `src/`; switch the two `workflow-enablement.ts` base-selection call sites (~:124, ~:335) to the new seam; widen `GlobalConfig['profile']` to `string` (keep the `Profile` union type for the reserved literals); verify update/init/drift paths compile against the widened type
- [x] 2.4 Core tests: saved-name user-wide profile resolves its stored list (update/enablement read paths); unresolvable name falls back to `full` with the warning; `full`/`core`/`custom` byte-identical to before (regression pin)
- [x] 2.5 Wire per-scope enums: add optional `enumValuesByScope` to the config wire definition/constraints (`src/core/config-api/wire-types.ts`), populate in `serialize.ts` via `resolveEnumValues(definition, scope)` for each declared scope; mirror the field in `packages/ui/src/api/types.ts` (wire-type mirror discipline); serializer test: profile entry carries both scope domains, scope-invariant enums unchanged
- [x] 2.6 UI Global dropdown: `packages/ui/src/config/controls.ts` + `ConfigEntryRow.tsx` pick `enumValuesByScope[writeScope] ?? enumValues`; render a current-value-not-in-domain option annotated "(not found)" (design D3); UI tests for saved names offered in Global mode and the not-found annotation
- [x] 2.7 UI Local selector honesty: when `enablement.mode === 'override'`, the SpaceProfileSelector select shows a selected, disabled synthetic option `custom (this space's own selection)` instead of "Follow global profile" (design D4); UI test

## 3. Explicit Update flow for SpaceProfileSelector

- [x] 3.1 Rework `SpaceProfileSelector` (`packages/ui/src/components/ConfigPage.tsx`): selection only stages `draftPick`; add primary Update button (disabled when no effective draft; single-flight preserved); inline `role="status"` unapplied-change reminder naming the staged profile; fold the existing override-replace confirmation into the Update click; clearing/apply-failure semantics unchanged
- [x] 3.2 Lift dirty state to `ConfigPage` (`onDirtyChange` callback): Global/Local mode buttons and section tab buttons open a discard/stay confirm dialog (reuse `.workflow-dialog__overlay` convention) when a profile draft is unapplied; confirm discards the draft then switches; stay does nothing
- [x] 3.3 Route-leave guard while dirty (design D5): capture-phase document click listener intercepting unmodified left-clicks on same-origin `<a>` with a different path → same discard/stay dialog, confirm routes via `location.route`; plus `beforeunload` for hard navigation; listener/handler removed on undirty/unmount
- [x] 3.4 UI tests (`packages/ui/test/`, jsdom): pick stages without mutating (no API call until Update); Update applies and re-renders applied state; reminder shows/clears; tab-switch and mode-switch guard dialogs (discard vs stay); route-leave interception via simulated anchor click; override-replace confirm at Update time; note `beforeunload` as a manual-check item (untestable in jsdom)

## 4. windowsHide sweep

- [x] 4.1 Add `windowsHide: true` at every non-interactive child-process call site per the design D6 inventory (management-api bridges incl. `workflow-enablement.ts` runUpdate, `supervisor.ts` spawnAgentCli both branches, submit/pipeline-submit/workflow-submit/create-space, daemon.ts [already `windowsHide: IS_WINDOWS`], ui-launch.ts, agent.ts, codex/availability.ts, archive.ts, store/migration.ts, store/operations.ts, feedback.ts, locale.ts, profile-editor.ts); leave `commands/config.ts` editor spawn alone
- [x] 4.2 Extend existing spawn-stubbing unit tests (supervisor asserts `windowsHide: true`; enablement runs the real update subprocess with no stub, so the source-guard covers workflow-enablement.ts statically)
- [x] 4.3 Add the source-guard test (pattern of the `gate: 'vet'` literal guard): scan `src/**` for `spawn(`/`spawnSync(`/`exec*(` call sites, fail any that neither passes `windowsHide` nor sits on the explicit allowlist (`commands/config.ts` editor spawn only); verify it catches a seeded violation, then remove the seed

## 5. Dependency graph backend

- [x] 5.1 New `src/core/workflow-registry/dependency-graph.ts` implementing design D7: strong direct edges (`requires.workflows` ∪ skill-owner(`requires.skills`) ∪ unconditional-stage skill owners across `requires.pipelines`, following decompose `childPipeline` one level), weak edges (condition ≠ absent/`always` stage skill owners, minus strong), dual-identity skill→unit mapping via `portablePathCollisionKey`; cycle-tolerant transitive strong closure; self-references dropped; unloadable pipeline / unowned skill skipped; export per-unit `{ id, requires, enhances }`
- [x] 5.2 Unit tests against the shipped built-ins with exact sets: `auto-command.requires` ⊇ {propose, apply, review-cycle, ship-command, archive, retro-command, office-hours-command, review}; `goal-command.requires` ⊇ {goal-plan, goal-iterate, goal-report}; `verify-enhanced-command.requires` ⊇ the five required experts; `cso`/`benchmark`/`design-review`/`qa`/`qa-only`.enhances ∋ auto-command; review NOT in weak sets; plus edge-case tests (missing pipeline, unowned skill, synthetic cycle)
- [x] 5.3 Endpoint `GET /api/v1/workflow-dependencies`: wire types in `src/core/management-api/wire-types.ts`, handler module (fresh catalog per request, read-only), route + auth in `router.ts` beside the workflows listing; router test (auth required, shape, degrades silently on broken user data); mirror wire types in `packages/ui/src/api/types.ts` + client function in `packages/ui/src/api/client.ts`

## 6. Cascade UI + bulk actions

- [x] 6.1 `ProfilesPage.tsx`: fetch the dependency graph alongside profiles+workflows; on toggle ON of an editable draft, union in `requires[id]` minus present members and set a transient editbar note naming auto-added ids and the trigger (design D8); toggle OFF removes only the id (never cascades); note cleared on next edit/selection change
- [x] 6.2 Weak hints: thread an optional per-entry hint map through `WorkflowSection`/`WorkflowCard` (only Profiles page supplies it — Workflows page render byte-identical); expert cards whose `enhances` intersects the draft show the "enhances <workflow>" chip (+N overflow in `title`)
- [x] 6.3 Bulk actions in the membership toolbar (editable profiles only): Select all (all non-internal units into draft) and Invert (flip all non-internal units); wired to the same dirty tracking
- [x] 6.4 UI tests: enable-cascade adds the closure + note; already-satisfied enable adds nothing extra; disable never cascades; hint chips appear only when the enhanced workflow is in the draft and only on the Profiles surface; Select all / Invert semantics (invert-after-select-all clears); bulk actions absent on built-in/broken profiles

## 7. Consistency & gates

- [x] 7.1 Wire-mirror audit: every core wire-type change from tasks 2.5/5.3 mirrored in `packages/ui/src/api/types.ts` (`enumValuesByScope` on `WireConstraints`; `WorkflowDependencyEntryWire`/`WorkflowDependenciesResponse`); UI typecheck (`satisfies`-based drift tripwire) green
- [x] 7.2 Localization: new `userWideProfileUnresolvable` diagnostic added to `src/locales/en.json`, `zh-cn.json`, `ja.json` and the `ConfigDiagnosticKey` union; locale catalog parity test green; UI copy stays English
- [x] 7.3 Gates — UI: inside `packages/ui` run `pnpm typecheck && pnpm test && pnpm build`, all green (366 tests, up from 351 baseline)
- [x] 7.4 Gates — root subset for touched core: management-api (enablement, workflows-api, router, supervisor), config keys/registry, config-api serialize, profiles/named-profiles/init-lock/drift, workflow-registry (selection + dependency-graph), source-guard — 275 passed / 1 skipped; supervisor isolated separately (22 pass)
- [x] 7.5 Full `npx vitest run` at the worktree root — 4146 passed, 29 skipped, 1 failed. Complete FAIL disposition: (a) `test/specs/source-specs-normalization.test.ts` — PRE-EXISTING baseline: `rasen/specs/profile-http-api/spec.md` and `rasen/specs/profiles-ui/spec.md` carry PR #55's archive Purpose placeholder; `git status rasen/specs/` is clean (I touched no main spec). (b) `test/commands/config-profile.test.ts` — MINE (windowsHide added to profile-editor apply); FIXED by extending the execSync assertion, now green. (c) `test/core/management-api/sessions-api.test.ts` DELETE-idempotent (202 vs 200) — FLAKE: appeared once, passed on both subsequent full runs; timing-sensitive session lifecycle, unrelated to the windowsHide-only supervisor change. No version bump anywhere.
- [x] 7.6 Manual Windows smoke — deferred to a human (a console-window flash is only observable on a real Windows desktop, not in jsdom/CI). The code paths are covered automatically: the windowsHide source-guard + the supervisor and config-profile spawn-option assertions pin the no-flash behavior; the Update-draft reminder, tab/mode-switch dialog, and route-leave interception are covered by the jsdom ConfigPage tests. `beforeunload` remains the one untestable-in-jsdom manual item (design D5 / task 3.4).
