# Design — ui-space-workflow-toggle

## Context

The Workflows page (`packages/ui/src/components/WorkflowsPage.tsx`) manages the user-wide workflow library through the workflow-http-api endpoints, but has no per-space enablement surface. On the CLI side:

- The desired workflow selection is stored ONLY in the global config (`profile` + `workflows` keys, both `scopes: ['global']` in `src/core/config-keys.ts`).
- `rasen profile` mutates that global selection (`applyProfileState` → `saveGlobalConfig`), then `rasen update` run inside a project resolves the desired set (`resolveDesiredWorkflowSelection` in `src/core/profiles.ts` — profile defaults + closure over `requires.workflows`/`requires.skills`) and installs/removes skill directories in that project. Drift detection (`src/core/profile-sync-drift.ts`) compares a project's installed set against the same globally-resolved desired closure.
- Consequence: two spaces cannot intentionally differ — any per-project difference is "drift" and the next `update` erases it. A truly per-space toggle therefore needs a per-project selection layer, not just a UI affordance over the global one.

The infrastructure for that layer already exists: the unified config system supports project-scope keys resolved with precedence project > store > global (`src/core/effective-config.ts`), written through a comment-preserving path into the project's `rasen/config.yaml`, and exposed over HTTP (config-http-api). The management server also already has a bounded-CLI mutation bridge for workflow ops (`src/core/management-api/workflow-submit.ts`) with an admission whitelist, cap-1 concurrency, timeout, and verbatim CLI error pass-through.

## Goals / Non-Goals

**Goals**
- A space can carry its own workflow selection that overrides the user-wide profile for that space only; spaces without an override behave exactly as today.
- `update` and drift detection honor the per-project effective selection.
- The UI's Workflows page can enable/disable a workflow per space and reset a space to follow the user-wide profile, with immediate application (skills installed/removed in that space).
- Core wire types and the UI mirror move together.

**Non-Goals**
- No new CLI subcommand (`rasen profile enable/disable`). The CLI already expresses the same operations via `rasen config set workflows ... --project` + `rasen update`; adding sugar is out of scope.
- No store-scope selection override (project scope only; store scope can be added later if demanded).
- No per-space named profiles, and no change to what `rasen profile` edits (it remains the user-wide selection editor).
- No version bump.

## Decisions

### D1 — Per-space enablement is a project-scope `workflows` override, not a global mutate-and-apply

Alternative considered: keep selection global and have the UI toggle mutate the global selection then run `update` only in the chosen space. Rejected: that silently changes the desired state of every other space (they all flag drift and lose the workflow on their next `update`) — the opposite of "per-space". Instead, `workflows` becomes settable at project scope. Semantics: a project-level `workflows` array is a **verbatim selection list** (like a custom profile) that **replaces** the user-wide resolved selection for that project; closure over `requires.workflows`/`requires.skills` still applies on top. `profile` stays global-only — the project layer stores an explicit list, never a profile name, so there is exactly one override shape.

### D2 — First toggle materializes the override as a snapshot of the current effective selection

Enabling W in a space that follows the user-wide profile writes project `workflows` = (current resolved user-wide selection base ids) + W; disabling writes it minus W. From then on the space is pinned to its own list (it no longer tracks later user-wide profile edits) until the user resets, which unsets the project key. This is the same mental model as `custom` profile derivation in the CLI picker, and it is visible in the UI ("this space uses its own selection" + reset affordance). The snapshot uses the stored (un-expanded) selection base, not the closure expansion, mirroring how profiles are stored un-expanded (profiles spec).

### D3 — Resolution seam: one helper, used by update and drift

`resolveDesiredWorkflowSelection` gains a per-project entry point (or a thin wrapper) that reads the project's effective `workflows` value via the unified config layer: project override present → treat as custom list with `expertSelectionExplicit` semantics = true (verbatim list + closure); absent → today's global path unchanged (including the `expertSelectionExplicit` migration behavior). `update.ts` (line ~177) and `profile-sync-drift.ts` both switch to this per-project resolution so install, removal, and drift can never disagree. The CLI picker's `maybeWarnProjectConfigDrift` note and `update`'s "extra workflows" note should name the override when one is active so CLI users aren't confused by a space that intentionally differs.

### D4 — HTTP read: in-process, fresh per request

New endpoint `GET /api/v1/workflow-enablement?root=<absolute space root>` computed in-process (like `workflows.ts` reads): loads the catalog, resolves the space's effective selection (D3 helper), reads the installed state (`getConfiguredToolsForProfileSync` / skill-dir presence), and returns per selectable unit `{ id, kind, title, skillName, source, enabled, installed, requiredByClosure }` plus `{ mode: 'profile' | 'override' }`. `requiredByClosure` marks units present only because a selected workflow's closure pulls them in — the UI disables the toggle-off affordance for those honestly instead of offering a toggle that `update` would immediately undo. The `root` is validated: absolute path AND a registered space root (project registry / spaces inventory), 400/404 otherwise — the server never probes arbitrary client paths.

### D5 — HTTP mutation: config write in-process, apply via the bounded CLI bridge

`POST /api/v1/workflow-enablement` with `{ root, op: 'enable' | 'disable' | 'reset', id? }`:
1. Guards: root as in D4; `id` required for enable/disable and must be a known catalog unit id (same identifier guard as existing ops); unknown `op` → 400, nothing spawned.
2. Selection write: through the unified config layer's project-scope set/unset (the exact code path config-http-api uses — comment-preserving, registry-validated). No new config logic in the handler.
3. Apply: spawn the CLI's own `update` (`node dist/cli/index.js update`) with `cwd = root` through the existing workflow-submit bridge machinery — new whitelist bounded-CLI entry, same cap-1 slot, timeout, SIGTERM/SIGKILL discipline. `update` prints human output, not JSON, so this op's success contract is exit code 0 (stdout is not parsed as JSON); on failure the CLI's stderr/stdout message passes through as 422 verbatim.
4. Response: the fresh enablement read (D4) after apply, so the UI renders the actual resulting state — including a closure-re-added expert after a disable attempt.

Alternative considered: run `update` in-process. Rejected: `update` is interactive-adjacent, chatty, and process-global (cwd, exit codes); the bridge pattern already exists precisely to keep mutations in the CLI's own process, and the server stays a non-writer of workspace files except through the audited config write path.

### D6 — UI: enablement lives on the Workflows page, scoped by an explicit space picker

The page keeps its user-wide library role. A new enablement control row lets the user pick a space (from the existing spaces API data); once picked, each workflow card in the driver/task/expert sections shows that space's enabled state and a toggle (internal units and invalid entries get no toggle; closure-required units show "required by an enabled workflow" instead of an active off-toggle). A banner states whether the space follows the user-wide profile or its own selection, with "Reset to profile" in the latter case (confirm dialog — it discards the space's own list). While a toggle/reset is in flight the page blocks further enablement mutations (mirrors the existing cap-1 bridge). Wire types added to `src/core/management-api/wire-types.ts` and mirrored into `packages/ui/src/api/types.ts` + `client.ts` in the same commit (ui-workflow-title-sync lesson).

## Risks / Trade-offs

- [Override snapshot goes stale versus later profile edits] → By design (D2); the UI banner + reset affordance make the pinning visible and reversible. CLI `update` note names the active override (D3).
- [`update` spawned per toggle is slow (~seconds)] → Acceptable for a deliberate toggle; the UI shows in-flight state; cap-1 already serializes. No optimistic UI — the response is the post-apply truth.
- [Disabling a closure-required expert silently comes back] → Prevented up front: D4 exposes `requiredByClosure` and the UI doesn't offer the off-toggle; if raced, the post-apply read shows it still enabled.
- [Project-scope `workflows` interacts with `expertSelectionExplicit` migration] → Override path bypasses the migration flag entirely (verbatim list, D3); the legacy behavior remains only on the no-override path, unchanged.
- [Existing tests assert `workflows` is global-only] → config-key-registry scope-assignment test and scenario must move with the scope change (spec delta included).
- [Windows path forms for `root`] → Same guard family as existing mutations: `path.isAbsolute` accepts both native forms; comparison against registered roots uses canonicalized paths, never string equality on raw separators.

## Migration Plan

Purely additive: no existing config file changes shape; a project without a `workflows` key behaves exactly as before. Rollback = revert; a leftover project `workflows` key in `rasen/config.yaml` would then be ignored by the registry (unknown-at-scope), which is safe.

## Open Questions

- None blocking. (Store-scope override and CLI sugar `rasen profile --project` are deliberate non-goals; revisit on demand.)
