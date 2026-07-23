# Planning context — ui-space-workflow-toggle

## User intent (verbatim)
当前ui的workflows页面是只读的，没办法针对某个space进行启用或关闭workflow，需要添加这个功能，这样就像用户通过rasen profile命令去安装卸载一样。

## LEAD's known context
- The UI lives in `packages/ui`. The Workflows page currently shows driver/task/expert sections and is display-only (no mutation actions).
- The CLI equivalent is the `rasen profile` command family, which installs/uninstalls (enables/disables) workflows for a given scope. The UI feature should mirror that capability per space.
- "Space" is the UI's top-level unit: one project = one space (worktree-aware spaces shipped recently). Enabling/disabling a workflow should be scoped to the selected space's project.
- The UI talks to the backend over an HTTP API (workflow-http-api spec exists; note a known spec field debt there). Any new mutation endpoint must be added to core wire types AND mirrored in the UI types — past lesson: core wire-type additions silently drift if the UI mirror is not updated (ui-workflow-title-sync).
- Cross-platform (Windows/macOS/Linux) rules apply per rasen/config.yaml: always path.join, no hardcoded slashes.
- Specs must be written in user-facing product behavior language (see rasen/config.yaml context).

## Constraints / decisions already made
- Pipeline: small-feature. Single change, no decompose.
- Do not bump package version (user owns versioning).
- Investigate how `rasen profile` performs enable/disable in core (likely a profile/ledger mutation) and reuse the same core logic from the HTTP layer rather than duplicating it.

## Planner findings (durable — appended by planner-1, 2026-07-23)

- **Core reality:** workflow selection is machine-global ONLY. `rasen profile` writes `profile`/`workflows` in the GLOBAL config (`applyProfileState` in `src/commands/profile-editor.ts:327`); per-project effect comes from `rasen update` resolving `resolveDesiredWorkflowSelection` (`src/core/profiles.ts`) from `globalConfig.workflows` (`src/core/update.ts:177`). There is NO per-project selection layer today — any per-space difference is "drift" and the next update erases it. So a global-mutate-and-apply toggle would silently change every other space; rejected.
- **Chosen design (D1):** make the `workflows` config key project-scoped (`src/core/config-keys.ts:142` currently `scopes: ['global']`; also pinned by the config-key-registry spec's scope-assignment requirement, which the delta MODIFIES). A project `workflows` array = verbatim selection override (custom-list semantics + closure, bypassing `expertSelectionExplicit` migration). `profile` stays global-only. Unified config layer + comment-preserving project write path + config HTTP API already support project-scope keys — no new config machinery.
- **Apply path:** reuse the workflow-submit bounded-CLI bridge pattern (`src/core/management-api/workflow-submit.ts` — whitelist, cap-1, timeout, verbatim 422) to spawn `update` with cwd = space root. NOTE: `update` prints human output, not JSON — the new op's success contract is exit 0, do NOT reuse the pure-JSON stdout parser.
- **Closure gotcha:** disabling a closure-required expert gets re-added by `resolveWorkflowSelection(..., { includeSkillDependencies: true })`; the enablement read exposes `requiredByClosure` and the UI offers no disable toggle for those.
- **Drift + editor seams must move together:** `src/core/profile-sync-drift.ts` and `maybeWarnProjectConfigDrift` both compare against the global selection today; both must switch to the per-project resolution or an overridden space is falsely flagged/reverted.
- **Space root guard:** enablement endpooints validate `root` = absolute AND a registered space root, canonicalized comparison (Windows separators), never raw string equality.
- Artifacts: proposal/design/specs (space-workflow-enablement NEW; config-key-registry MODIFIED; profiles/workflow-http-api/workflows-ui ADDED deltas)/tasks all written; `rasen validate --strict` passes.
