# Design — ui-profile-workflow-split

## Context

Three threads converge here:

1. **Named profiles already exist in the backend, invisible to the UI.** `src/core/named-profiles.ts` implements the full entity: saved definitions at `<global-config>/profiles/<name>.yaml` (atomic writes, 1 MiB cap, name pattern `^[a-z0-9][a-z0-9._-]{0,63}$`, reserved names `full`/`core`/`custom`), list/read/save/delete/import/export, and normalization through `parseProfileDefinition` (unknown-workflow rejection + `resolveWorkflowSelection` closure expansion). The CLI (`rasen profile new/use/update/list/delete/import/export`) is a thin shell over it. Two activation seams exist today:
   - **User-wide**: `rasen profile use <name>` *copies* the definition into global config (`profile: 'full'|'core'|'custom'` + `workflows`) via `applyProfileState` — there is no persistent "active named profile" pointer.
   - **Per-space**: project config's `profile` key is a **lock** naming `full`, `core`, or a saved profile (`init-profile-lock`); `resolveProjectWorkflowSelection` (src/core/profiles.ts) resolves it via `resolveLockedProfileBase`, with a per-space `workflows` override shadowing the lock, and an unresolvable lock degrading to the user-wide profile with a warning. The config-key registry already enumerates saved profile names for the project-scope `profile` key (`enumValuesForScope` in src/core/config-keys.ts).

2. **The UI's enablement surface conflates library and selection.** The Workflows page hosts both library management and a per-space picker + per-card switches that write the space's `workflows` override through `POST /api/v1/workflow-enablement` (write config via `updateProjectConfigKey`, apply via a bounded spawned `rasen update` — `src/core/management-api/workflow-enablement.ts`). The Config page's Local **General** tab shows the raw `profile`/`workflows` rows.

3. **The canvas viewport lock is broken in real browsers.** Empirically root-caused this planning round (headless Chrome measurement, four variants — see Decisions D8): the shipped `.app-content--canvas { height: calc(100vh - 60px); overflow: hidden }` is dead code because the element also carries `.app-content`'s `flex: 1` (= `flex-basis: 0%`) inside `.app-shell`, whose height is **indefinite** (`min-height: 100vh` only). An unresolvable percentage basis makes the flex base size fall back to content size, and in flex layout the `height` property does not constrain the flexed main size — the main grows to its content (measured 1930px), the shell's `min-height` is only a floor, so the document scrolls. jsdom performs no layout, which is exactly why the previous fix's class-presence tests passed.

Baseline note: this design targets dev/0.1.5 at d0d7d5c1, which merges PR #53 (`init-profile-lock`, commit 1629beb5) — the profile-lock precedence (override > lock > user-wide), the widened `mode: 'locked-profile'` in BOTH wire-type mirrors, and `rasen profile update` are all already on the branch and are the foundation the decisions below build on. #53's own change dir (`rasen/changes/init-profile-lock/`) is pending archive; its delta specs (profiles, config-key-registry, cli-init, cli-update, config-loading) do not overlap this change's six capabilities, so the two spec syncs cannot conflict. What #53 did NOT add — and this change does — is the `lockedProfile` name in the enablement read, the profile-switch mutations, and any `/api/v1/profiles` surface.

Constraints (from planning-context): keep the ui-design-overhaul component system (`src/components/ui/`), token-only styling, Preact (not React), wire-type mirror discipline (core `wire-types.ts` ↔ `packages/ui/src/api/types.ts`), version untouched.

## Goals / Non-Goals

**Goals**
- Expose named profiles in the UI: a Profile page for creating/selecting/editing/deleting profile definitions (membership lists), and a Config-page selector that actually switches a space (lock + install/uninstall apply).
- Return the Workflows page to pure library management, extracting the shared card presentation instead of copying it.
- Config page: default Global, no raw Profile rows in Local mode, Profile selector atop the Local Project tab.
- Fix the canvas full-page scroll at the named broken link in the height chain, with a real-layout verification path.

**Non-Goals**
- No change to profile storage format, resolution semantics (`resolveProjectWorkflowSelection`), or the CLI.
- No user-wide "activate profile" action in the UI (see D3 semantic decision).
- No retirement of the per-space `workflows` override or the existing enable/disable/reset enablement ops — the backend contract stays; only the UI stops offering per-workflow space toggles.
- No i18n of management-API error strings (module follows `workflow-enablement.ts`'s existing English-only pattern).

## Decisions

### D1 — Named-profile HTTP API is an in-process wrapper over `named-profiles.ts`
New `src/core/management-api/profiles.ts`:
- `GET /api/v1/profiles` → `{ profiles: WireProfileEntry[] }` from `listAvailableProfiles()`: `{ name, builtIn, workflows?, error? }` (built-ins `full`/`core` carry their computed definitions; a saved file that fails to parse surfaces `error` instead of `workflows`).
- `POST /api/v1/profiles` discriminated by `op`:
  - `{ op: 'create', name, workflows }` — rejects an existing name (409-mapped `already_exists`).
  - `{ op: 'update', name, workflows }` — rejects a missing or built-in name.
  - `{ op: 'delete', name }` — `deleteNamedProfile`; built-ins rejected by the reserved-name validation.
  Create/update validate through `parseProfileDefinition` (unknown ids → 400 with the library's message) and persist with `saveNamedProfile`; the response returns the **normalized** definition (closure-expanded), which is what the editor re-renders (D5).

Rationale: unlike workflow import/delete, profile writes touch only a YAML file under the global config dir — no artifact installation, no subprocess needed. Calling the library directly is the same code path the CLI uses, so validation and atomicity are inherited, and the whitelist/bridge machinery (which exists to bound *CLI* work) is unnecessary. `NamedProfileError.code` maps to HTTP: `invalid_name`/`invalid_file`/`unsupported_format` → 400, `reserved_name` → 400, `not_found` → 404, `already_exists` → 409.

Deleting a profile that some space locks is allowed (matches CLI): resolution already degrades gracefully (`lockWarning: unresolvable` → user-wide fallback). The UI delete dialog states this consequence.

### D2 — Per-space profile switching extends the existing enablement module, not a new bridge
`workflow-enablement.ts` gains:
- Read: `WorkflowEnablementResponse.lockedProfile?: string` — populated from the same `resolveProjectWorkflowSelection` result that already computes `mode` (it returns `lockedProfile` today; the wire type just never carried it).
- Mutations: `{ root, op: 'set-profile', profile: string }` and `{ root, op: 'clear-profile' }`. `set-profile` validates via `resolveProfileDefinition(profile)` (accepts `full`, `core`, or a saved name; rejects `custom` and unknowns), writes the project-scope `profile` key through `updateProjectConfigKey`, **and clears the `workflows` override in the same write step** (D4); `clear-profile` unsets the `profile` key only. Both then run the same bounded `update` apply and return fresh state — identical shape, concurrency slot (cap-1 `inFlight`), timeout, and error contract (`422 cli_error` with post-write `state`) as enable/disable/reset.

Rationale: switching a space's profile IS a workflow-enablement mutation — same root validation, same config-write path, same apply bridge. A parallel module would duplicate the cap-1 slot and let the two writers interleave.

### D3 — Semantic decision: "switching a profile" in Config is the per-space profile lock
The user's flow ("在 config 的 Profile 页面用于选择 Profile，此时会真正的切换用户选择的 Profile 来进行安装卸载 workflow") is implemented as the **project profile lock**, not the user-wide `rasen profile use` copy, because:
- The selector lives in Config → **Local** → Project — a space-scoped surface; installs/uninstalls are per-project-root operations (`isInstalledInAnyConfiguredTool` checks the space's tool dirs), so "real switching that installs/uninstalls" is inherently per-space.
- The lock is the existing, resolution-honored seam; `update` applies it with no new semantics.
- The Profile page's "切换" is therefore *selection for viewing/editing* (a picker), not activation. User-wide activation from the UI is a deliberate non-goal; the Global config scope still shows the user-wide `profile` enum row as today. **Called out per planning contract — if the user intended user-wide activation, only the POST target changes (a `use-profile` op calling `applyProfileState`), the page structure is unaffected.**

### D4 — Setting a profile clears the space's `workflows` override
An override shadows the lock (`resolveProjectWorkflowSelection` checks `workflows` first), so writing a lock under an existing override would silently do nothing. `set-profile` therefore unsets `workflows` in the same mutation. The Config selector makes this legible: when the read reports `mode: 'override'`, the selector shows the existing "this space uses its own selection" banner state and the confirm copy for picking a profile says the space's own selection will be replaced. `clear-profile` does NOT touch the override (it only returns the space to "follow global").

### D5 — Profile page edits the stored (normalized) list; closure honesty after save
The editor's switches toggle a draft membership set seeded from the stored definition. Save posts the draft; the server normalizes (dependency closure may re-add ids) and the response re-seeds the switches — so a dependency the user tried to drop while a dependent stays enabled visibly snaps back ON after save. No client-side closure simulation (that would require every workflow's `requires` graph client-side and could drift from `resolveWorkflowSelection`). Dirty tracking + Discard mirror the pipeline editor's draft pattern; built-in profiles render read-only with "Duplicate to edit…" (pipelines-page precedent). Saving a definition never triggers an apply anywhere — spaces locked to the profile pick the change up on their next apply, matching the contract PR #53's `rasen profile update` spec pinned (`init-profile-lock` specs/profiles: "Editing a definition SHALL leave the current user-wide selection and all project files unchanged"); the page states this after a save of a profile.

### D6 — Shared card presentation extracted, parameterized by a toggle context
`WorkflowSection` / `WorkflowCard` / `InternalDisclosure` move from `WorkflowsPage.tsx` into a shared module (`components/workflow-cards.tsx`), keeping their DOM/classes/testids. The per-card corner Switch is driven by an optional generic `ToggleContext { stateFor(id): { checked, disabled, reason? } | null; onToggle(id, checked): void }`:
- Workflows page: passes none — pure library view (open/export/delete/detail unchanged).
- Profile page: passes the draft-membership context (internal-kind units still get no toggle — existing rule preserved).
The Workflows page's `EnablementControls` (space picker, mode banner, reset, mutate wiring) is deleted outright, not moved — its reset affordance reappears inside the Config selector (D4), backed by the same `reset` op.

### D7 — Config page changes stay inside the existing grouping/controls seams
- Default scope: `useState<ConfigMode>('global')` (one line + doc comment referencing this change).
- Local-mode Profile rows: `tabbedEntries` (src/config/grouping.ts) excludes the `Profile` registry group when `mode === 'local'`. The General tab then has no local-visible entries (verified: `profile`/`workflows` are the only project-scope keys in the General tab's groups) and disappears via the existing empty-tab omission rule. Global mode is untouched.
- Profile selector: a dedicated `SpaceProfileSelector` component rendered by ConfigPage above the group sections when `mode === 'local' && spaceType === 'project' && currentTab is Project`. It resolves the space root by joining `listSpaces()` against the current space selector (the same client-side join the Workflows page used), then reads `getWorkflowEnablement(root)` for `mode`/`lockedProfile` and `listProfiles()` for options. Dropdown: "Follow global profile" (clear-profile) + `full` + `core` + saved names → set-profile. Store spaces don't render the selector (enablement addresses project roots; store members are configured from their own spaces).

### D8 — Canvas lock: definite height on the shell, minimum-content chain below (empirically verified)
Broken link (named): `.app-content` `flex: 1` ⇒ `flex-basis: 0%`; `.app-shell` height is indefinite (`min-height: 100vh` only) ⇒ the percentage basis cannot resolve ⇒ flex base size = content size; `height: calc(100vh - 60px)` on a flex item does not constrain the flexed main size ⇒ main = content height (1930px measured), shell grows past its `min-height` floor, document scrolls. The palette then never overflows, so it shows no inner scrollbar — matching the user's screenshot exactly.

Fix (variant `c-shell-locked`, verified in headless Chrome 1600×900: shell = exactly viewport height, palette scrolls internally):
- `Layout.tsx`: the shell div becomes `app-shell${onCanvas ? ' app-shell--canvas' : ''}` (the existing `onCanvas` predicate; `isPipelineCanvasPath` itself is correct and unchanged).
- `style.css`: add `.app-shell--canvas { height: 100vh; }`; rewrite `.app-content--canvas` to `max-width: none; flex: 1; min-height: 0; padding: var(--space-4) var(--gutter); display: flex; flex-direction: column; overflow: hidden;` — the `calc(100vh - 60px)` is deleted (it was load-bearing-looking dead code and couples to the header height). Everything below (`.pipeline-canvas`, `__body`, `__flow-column`, panels) already carries `flex: 1; min-height: 0` and needs no change.
- Every other route is untouched (`.app-shell` base keeps `min-height: 100vh`; the modifier applies only on the canvas route).

Verification strategy (three layers, because jsdom cannot catch this class of bug):
1. jsdom structure test: canvas route ⇒ BOTH `app-shell--canvas` and `app-content--canvas` present; non-canvas route ⇒ absent.
2. CSS contract pin (string-level against `style.css`): `.app-shell--canvas` sets `height: 100vh`; the `.app-content--canvas` block contains `min-height: 0` and `overflow: hidden` and does NOT contain `calc(100vh` — a narrow pin that fails if someone reverts to the broken pattern.
3. Real-layout smoke (tasks 5.4): measure `document.documentElement.scrollHeight <= clientHeight` on the canvas editor with a populated palette in real Chrome (chrome-use/CDP against `rasen ui`, or the headless-Chrome `--dump-dom` measurement harness used to verify this design; evidence recorded in the work dir).

### D9 — Wire-type mirror discipline
Every wire change lands in BOTH `src/core/management-api/wire-types.ts` and `packages/ui/src/api/types.ts` in the same task: `WireProfileEntry`, `ProfileListResponse`, `ProfileMutationRequest/Response`, `WorkflowEnablementResponse.lockedProfile`, `WorkflowEnablementMutationRequest` new ops. Client functions (`listProfiles`, `mutateProfile`) follow the existing `client.ts` patterns (workflows-ui-cleanup lesson: a core-only wire addition silently drifts the UI mirror).

## Risks / Trade-offs

- [Normalization surprise: saving a profile silently re-adds closure dependencies] → the response-driven re-seed makes it visible immediately (switches snap back ON); card meta shows the same "Required by an enabled workflow"-style reason where derivable server-side (`requiredByClosure`-equivalent computed by comparing posted vs normalized lists is NOT attempted — the snap-back is the honest signal).
- [set-profile clears a space's hand-crafted `workflows` override] → explicit confirm step in the selector when `mode === 'override'`, with copy naming the replacement; `clear-profile` never touches the override; the backend still honors overrides created via CLI.
- [Two writers to project config (`set-profile` and enable/disable) could interleave] → both live behind the same module's cap-1 `inFlight` slot (D2), same as today's enable/disable/reset.
- [Profile deletion while locked by a space] → existing graceful degradation (warning + user-wide fallback) — delete dialog copy states it; no referrer scan (matches CLI behavior).
- [Profile YAML write races an in-flight enablement apply] → ACCEPTED (graceful degradation, no coordination added). The profile HTTP surface (`/api/v1/profiles`) writes only a YAML file in-process with no cap-1 slot, so a `create`/`update`/`delete` can interleave with an enablement apply that is reading the same profile (`resolveProfileDefinition` at `set-profile` validate time, or a `deleteNamedProfile` racing a lock resolution). The worst case is exactly the already-specified unresolvable-lock degradation (`lockWarning: unresolvable` → user-wide fallback + warning), identical to running the CLI's `rasen profile` and `rasen update` concurrently. No new failure mode is introduced; the two-writer hazard that DOES need coordination — two writers to the SAME project `config.yaml` — stays behind the enablement module's single cap-1 `inFlight` slot (D2), and `set-profile`'s lock+override edit is one atomic `updateProjectConfigKeys` write (D4), never two.
- [100vh vs. mobile dynamic viewports] → desktop management UI; consistent with the codebase's existing `100vh` usage; not a regression vector here.
- [CSS string-pin test is brittle to benign refactors] → scoped to exactly the two selectors and three properties that encode this root cause; comment links it to this change's evidence.
- [User intended user-wide activation, not per-space lock (D3)] → surfaced as an explicit semantic decision; the POST target is the only thing that would change.

## Migration Plan

Pure additive UI/API work on dev/0.1.5; no data migration. Per-space `workflows` overrides written by the old UI keep working and remain resettable from the Config selector. Rollback = revert the commit; profile YAML files created via the new API remain valid CLI artifacts either way.

## Open Questions

None blocking. Deferred (recorded, not designed): user-wide profile activation from the Profile page (D3 alternative); surfacing `lockWarning` (shadowed/unresolvable) details in the selector beyond the mode banner.
