# Design: ui-profile-polish

## Context

PR #55 (ui-profile-workflow-split) landed the Profiles page, the shared workflow-card presentation, and the Config Local Project tab's SpaceProfileSelector. Four gaps remain, verified against the code at `dev/0.1.5@bf07dc22`:

1. **Nav highlight** — `Layout.tsx` computes `section = spaceSection(path)`, and `spaceSection()` (`packages/ui/src/store/use-space.ts:63`) defaults to `'board'` for any path without a space prefix. On `/profiles` or `/workflows` the space-scoped nav block still renders (recent-space fallback, `Layout.tsx:38`), so Board gets `aria-current="page"` alongside the correct Profiles/Workflows highlight.
2. **Dropdown domains** — The Global profile row is a plain enum control fed by `WireConfigEntry.definition.enumValues`, which `config-api/serialize.ts:31,63` copies from the **static** `enumValues: ['full','core','custom']`; the scope-aware `enumValuesForScope` (`config-keys.ts:175`, added by #53 for project scope only) never reaches the wire. Deeper: the user-wide profile **cannot** be a saved name today — `getProfileWorkflows()` (`profiles.ts:102`) only understands `full`/`core`/`custom` and silently treats anything else as `full`. The Local SpaceProfileSelector already lists `full`/`core` + saved names via `/api/v1/profiles`, but when the space is in `override` mode the `<select>` shows "Follow global profile" — dishonest.
3. **Immediate apply + cmd flash** — `SpaceProfileSelector.onPick` mutates immediately (`ConfigPage.tsx:269`). The apply spawns `node <cli> update` at `workflow-enablement.ts:365` with no `windowsHide`, so a console window flashes on Windows. The same omission exists at ~14 other spawn/exec sites (only `store/git.ts:24` sets `windowsHide: true`).
4. **No dependency awareness** — Built-in workflows have empty `requires.workflows`; real dependencies live in `requires.skills` (e.g. `auto-command` → `rasen-review`) and `requires.pipelines` (e.g. `auto-command` → `small-feature`/`full-feature`/`bug-fix`/`auto-decompose`; `goal-command` → the three goal-loop pipelines). Pipeline YAML stages name skills (`full-feature` stages → `rasen-propose`, `rasen-apply-change`, `rasen-review-cycle`, `rasen-ship`, `rasen-archive-change`, `rasen-retro`, plus six expert stages), and the existing install closure (`resolveWorkflowSelection` with `includeSkillDependencies`) walks only `requires.workflows` + `requires.skills` — **not** pipeline stages. So enabling `auto-command` in a custom profile does not bring `ship-command`, `archive`, `review-cycle`, etc., and the user must know the graph by heart.

Constraints (locked): implementation in worktree `OpenSpec-polish-wt` (branch `feat/ui-profile-polish`, base `origin/dev/0.1.5@bf07dc22`, PR delivery); keep token/theme/component system; reuse existing dialog conventions (`.workflow-dialog__overlay` pattern); dependency-graph computation lives in core behind the HTTP face; no version bump; wire-type mirror discipline (`packages/ui/src/api/types.ts`).

## Goals / Non-Goals

**Goals:**
- Each nav entry highlights only on its own route.
- One coherent, documented value domain per profile dropdown; saved profiles usable at global scope end-to-end (config write, validation, resolution, UI).
- Space profile switching becomes draft → explicit Update, with unsaved-state reminder and leave/tab-switch confirmation; no visible console window on Windows for any background child process.
- Profile membership editing understands strong/weak workflow dependencies (cascade on enable, hints for enhancers) and offers bulk selection.

**Non-Goals:**
- No change to install/apply semantics: profile save-time normalization keeps today's `requires.workflows`-only closure; the new pipeline-derived graph is a UI/editing aid, not a new install closure (changing the install set silently would alter every existing profile's meaning).
- No cascade on disable (user decision: manual cleanup).
- No redesign of the Workflows page enablement flow (per-space toggles keep applying immediately; only the profile selector gains the draft/Update flow).
- No migration of existing config files; a global `profile: <saved-name>` is simply newly-valid.
- Store spaces still don't render the profile selector.

## Decisions

### D1 — Nav: active-state derives from the route's own space, not the fallback

`Layout.tsx` changes `const section = spaceSection(path)` to derive the section **only when `routeSpace` is non-null** (`routeSpace ? spaceSection(path) : null`). The space-scoped block keeps rendering from the recent-space fallback (reachability is a feature, per the module comment), but with `section === null` none of Board/Archive/Config/Pipelines matches, so no `aria-current` is set on them for `/profiles`, `/workflows`, `/spaces`, and `/`. Alternative considered: making `spaceSection` return `null` on non-space paths — rejected because `SpaceSwitcher` uses `spaceSection`'s `'board'` default for section-preserving navigation and must keep it.

### D2 — Global profile dropdown: saved names become first-class user-wide profile values

Three layers, all required (the enum list alone would write values resolution ignores):

1. **Registry** (`config-keys.ts`): `enumValuesForScope('global')` returns `['full', 'core', 'custom', ...listSavedProfileNames()]`; project scope stays `['full', 'core', ...saved]` (`custom` remains non-lockable). `validateConfigValue` already threads scope, so CLI `config set` and the config HTTP write accept saved names at global scope with no further work. The stale spec sentence claiming `profile` is global-only is corrected in the delta.
2. **Resolution** (`profiles.ts`): new seam `resolveUserWideProfileBase(profile, customWorkflows, expertSelectionExplicit)` mirroring `resolveLockedProfileBase`: `full`/`core`/`custom` behave exactly as today (via `getProfileWorkflows`); any other string reads the saved definition (`readNamedProfile`) and returns its stored ids verbatim; an unresolvable name returns a warning descriptor and callers fall back to the **default profile (`full`)** — the same graceful-degradation shape the project lock already has (`profiles.ts:170`). `resolveDesiredWorkflowSelection` routes through the seam; the two direct `getProfileWorkflows(globalConfig.profile …)` call sites in `workflow-enablement.ts` (:124, :335) switch to the seam too. All other consumers go through `resolveDesiredWorkflowSelection` (verified by grepping `getProfileWorkflows` callers during implementation; the picker's own three-preset UI is untouched). The `GlobalConfig.profile` TS type widens from the `Profile` union to `string` at the field (the `Profile` type itself stays for the three reserved literals; the YAML parser already accepts any string).
3. **Wire** (`config-api`): see D3.

Rationale for full/core/custom **plus** saved at global vs. dropping `custom`: `custom` at global scope has a real referent (the global `workflows` list) and existing users depend on it; the project scope correctly excludes it because a lock needs a stable referent. This asymmetry is intentional and now documented in the registry description.

A saved name that exists but whose file is broken behaves like an unresolvable name at resolution time (warning + `full` fallback) and renders annotated in the dropdown (D3).

### D3 — Wire: per-scope enum domains, not a smarter client

`WireConfigConstraints`/definition gain an optional `enumValuesByScope?: Partial<Record<'global'|'store'|'project', string[]>>`, computed in `serialize.ts` via the existing `resolveEnumValues(definition, scope)` for each scope in `definition.scopes`. The static `enumValues` stays for compatibility. `packages/ui` mirrors the field (`api/types.ts`), and `selectControl`/`ConfigEntryRow` pick `enumValuesByScope?.[writeScope] ?? enumValues`. When the entry's current value is not in the active scope's list (e.g. a saved profile deleted after being set, or a hand-edited value), the select renders it as an extra annotated, disabled-selection-preserving option (`<current> (not found)`) so the state is visible rather than snapping to a wrong value — matching the Local selector's existing "(broken)" convention. Alternative considered: having the UI fetch `/api/v1/profiles` for the Global row — rejected: special-cases one key in a generic registry-driven editor; the registry already owns scope-aware domains.

### D4 — Local selector: honest override display, domain otherwise unchanged

The Local dropdown keeps `Follow global profile` + `full` + `core` + saved names (broken ones annotated and non-selectable, as today). `custom` is **not** added as a pickable option — a `custom` lock has no stable referent and the API refuses it (`workflow-enablement.ts:239`, design D2 of #55). Instead, when `enablement.mode === 'override'`, the select renders and selects a synthetic disabled option `custom (this space's own selection)`, so the control reflects reality; the existing mode text and reset-to-profile affordance remain. This answers the user's "Local has no custom" observation with honest semantics: the space-scoped analogue of `custom` *is* the override, entered by toggling workflows, not by picking a dropdown value.

### D5 — Explicit Update flow for SpaceProfileSelector

State model: `applied` (from enablement read: `''` for follow-global, lock name, or override sentinel) vs `draftPick: string | null` (null = no draft). Behavior:

- `onChange` only sets `draftPick`; nothing mutates.
- An **Update** button (primary, disabled when `draftPick` is null or equals applied state, single-flight `mutating` as today) performs `set-profile`/`clear-profile`. When the space is in `override` mode, the existing replace-confirmation renders before mutating — folded into the Update click rather than the pick.
- While `draftPick` differs from applied: inline reminder text (`role="status"`): "Profile changed to X — not applied yet. Click Update to install/remove workflows."
- **Leave guards** (both via the existing `.workflow-dialog__overlay` dialog convention, "Discard draft / Stay" actions; discarding never applies):
  - *In-page*: `ConfigPage` owns a `profileDraftDirty` flag (lifted from the selector via an `onDirtyChange` callback). The Global/Local mode buttons and the section tab buttons check it and open the confirm dialog instead of switching; confirming discards the draft and switches.
  - *Route-leave*: while dirty, the selector (or a small `useNavigationGuard` hook in `packages/ui/src/store/`) registers a **capture-phase** `click` listener on `document` that intercepts same-origin anchor navigation (`preventDefault` + `stopPropagation` — capture on `document` runs before preact-iso's bubble-phase router listener), stashes the intended href, and opens the same dialog; confirm discards the draft and routes via `location.route(href)`. A `beforeunload` handler covers hard navigation/close with the browser-native prompt. Listener removed on undirty/unmount.

Alternative considered: applying on leave-confirm ("Apply and leave") — rejected: apply is a mutation that can take up to 60s and fail; a leave dialog should never kick off installs.

### D6 — windowsHide sweep

Add `windowsHide: true` to every non-interactive child-process call site in `src/` (grep-verified inventory):

| File | Site | Notes |
|---|---|---|
| `core/management-api/workflow-enablement.ts:365` | apply `update` spawn | the reported cmd flash |
| `core/management-api/workflow-submit.ts:233`, `submit.ts:219`, `pipeline-submit.ts:316`, `create-space.ts:291` | CLI bridge spawns | UI-daemon reachable |
| `core/management-api/supervisor.ts:194,200` | agent CLI spawn (both branches) | set in `spawnAgentCli` |
| `commands/daemon.ts:179` | daemon respawn | detached |
| `commands/ui-launch.ts:72`, `commands/agent.ts:109` | detached launches | |
| `core/codex/availability.ts:23` | `codex --version` probe | spawnSync |
| `core/archive.ts`, `core/store/migration.ts`, `core/store/operations.ts` | `execFile('git', …)` helpers | follow `store/git.ts:24` precedent |
| `commands/feedback.ts`, `utils/locale.ts`, `commands/profile-editor.ts:460` | exec/execSync helpers | hygiene; parent console contexts |

**Documented exception**: `commands/config.ts:835` spawns the user's `$EDITOR` interactively — must NOT be hidden. Regression protection: a source-guard test (same pattern as the `gate: 'vet'` literal guard) scans `src/**` for `spawn(`/`spawnSync(`/`execFile(`/`execSync(`/`exec(` call sites and asserts each passes `windowsHide` except an explicit allowlist containing only the editor spawn — cheaper and more complete than per-site behavioral tests, and it catches future sites. Where an existing unit test already stubs a spawn (enablement, supervisor), extend its assertion to include `windowsHide: true`.

### D7 — Dependency graph: computed in core, transitive closure served over HTTP

**Rules** (per workflow definition U in the catalog, global context — user + package pipeline resolution, no project root):

- *Strong direct deps of U* = `U.requires.workflows` ∪ owner(`U.requires.skills`) ∪ { owner(stage.skill) : stage ∈ stages(p), p ∈ `U.requires.pipelines`, stage unconditional }. A stage is **unconditional** when it has no `condition` or `condition: 'always'` (e.g. full-feature's `review` stage — parallelGroup membership alone does not weaken it).
- *Weak direct deps of U* = { owner(stage.skill) : stage condition-gated (`condition` present and ≠ `'always'`) } minus U's strong set.
- owner(skillName) resolves through the same dual-identity map as `resolveWorkflowSelection` (`portablePathCollisionKey` over `template.name`/`dirName`).

**Edge cases**: self-references dropped; a pipeline that fails to load or a skill with no owning catalog unit is skipped silently (the graph is advisory — it must never make the page error on a broken user pipeline); cycles are tolerated (BFS with visited set — unlike `resolveWorkflowSelection`, which throws, this walker just unions); `decompose` stages contribute their `childPipeline` (or the default) as a further pipeline to walk, bounded by the existing one-level recursion guard.

**Shape served**: per unit `{ id, requires: string[], enhances: string[] }` where `requires` is the **transitive strong closure** (computed server-side so the UI does no graph walking — cascade = `draft ∪ requires[id]`) and `enhances` lists the workflow ids this unit weakly enhances (the chip's render direction, precomputed by inverting weak edges). New module `src/core/workflow-registry/dependency-graph.ts`; endpoint `GET /api/v1/workflow-dependencies` (authenticated, read-only, fresh catalog per request like the enablement read). Alternatives considered: embedding in `GET /api/v1/workflows` (bloats a hot listing used by surfaces that don't need it) or in `/api/v1/profiles` (a profile listing has nothing to do with the catalog graph); a sibling endpoint keeps both contracts stable.

### D8 — Cascade and bulk actions in the Profiles membership editor

- **Cascade on enable only**: toggling a workflow ON adds `id` + `requires[id]` (minus already-present) to the draft; the editbar shows a transient note naming what was auto-added ("Also enabled: ship-command, review-cycle (required by auto-command)"). Toggling OFF removes only that id — never cascades — matching the user's explicit ask and the save-time reality that normalization may re-add closure members visibly (existing "closure snap-back" behavior stays the final authority for `requires.workflows`/`requires.skills` deps).
- **Weak hints**: expert cards whose `enhances` intersects the current draft render a hint chip ("enhances auto-command"; multiple → "enhances auto-command +2", full list in `title`). Threaded as an optional per-entry hint map prop on `WorkflowSection`/`WorkflowCard` — only the Profiles page supplies it, so the Workflows page render is byte-identical. A weak-only expert is never auto-enabled; one that is also in some enabled workflow's strong closure arrives via the cascade like any strong dep.
- **Bulk actions**: two buttons in the membership toolbar, **Select all** and **Invert** — exactly the user's ask (全选/反选). Select all = every toggleable (non-internal) unit into the draft; Invert = flip every toggleable unit (which doubles as clear-all right after Select all, so a third button isn't needed). Internal-kind units stay switch-less and are governed by save-time normalization, as today. Both act on the draft only; Save/Discard semantics unchanged.

## Risks / Trade-offs

- **[Global saved-name resolution misses a consumer]** → the seam replaces `getProfileWorkflows` at exactly the call sites that pass `globalConfig.profile`; tasks include a repo-wide grep for `getProfileWorkflows(` and `globalConfig.profile` with each site dispositioned. Silent-fallback-to-full remains the worst-case failure mode — which is today's behavior for any non-literal value, so no regression is possible, only unfixed sites.
- **[Capture-phase click interception fights the router]** → the guard only intercepts unmodified left-clicks on same-origin `<a>` targeting a different path, and only while dirty; covered by a jsdom test simulating the click. `beforeunload` is untestable in jsdom — documented manual-check item.
- **[Dependency graph mislabels strong vs weak]** → rules are data-driven from pipeline YAML, unit-tested against the shipped built-ins with exact expected sets (e.g. `auto-command.requires` ⊇ {`propose`, `apply`, `review-cycle`, `ship-command`, `archive`, `retro-command`, `office-hours-command`, `review`}, `cso.enhances` ∋ `auto-command`); a wrong edge is a visible one-line rule fix, and disable-never-cascades bounds the blast radius (cascade can only over/under-*suggest* additions the user sees before saving).
- **[windowsHide on a site that needed a window]** → the only interactive spawn is the editor (excluded); `windowsHide` is a no-op on POSIX. Sweep is mechanical and guarded by the source test.
- **[Enum-domain wire addition drifts from the UI mirror]** → wire-type mirror discipline task + the existing parity conventions; the field is optional so an older UI build degrades to today's static list.

## Migration Plan

No data migration. All wire changes are additive (optional field + new endpoint). Rollback = revert the PR; a global config already set to a saved name would degrade to the pre-change silent-`full` behavior, which is acceptable.

## Open Questions

None blocking. One deliberate deferral: whether save-time normalization should ALSO close over the pipeline-derived strong graph (making the install set match the cascade exactly) is left out — it would change the meaning of every existing profile and belongs to a future decision with the user.
