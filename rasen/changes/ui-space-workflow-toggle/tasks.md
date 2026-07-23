# Tasks — ui-space-workflow-toggle

## 1. Core: project-scope selection override

- [x] 1.1 Make `workflows` settable at project scope in `src/core/config-keys.ts` (scopes `['global','project']`), and update the registry/scope tests and config-key-registry scenario coverage (project accepted, store rejected)
- [x] 1.2 Add the per-project resolution seam: extend `resolveDesiredWorkflowSelection` (or add a project-aware wrapper in `src/core/profiles.ts`) that reads the project's effective `workflows` via the unified config layer — override present → verbatim list + closure, bypassing the `expertSelectionExplicit` migration; absent → unchanged global path. Unit tests for both paths and closure-over-override
- [x] 1.3 Switch `src/core/update.ts` to the per-project resolution and make its profile notes name an active override; ensure install/removal both use the same resolved set
- [x] 1.4 Switch `src/core/profile-sync-drift.ts` to the per-project resolution (intentional difference is not drift; drift against the override still detected) with tests
- [x] 1.5 Make the profile editor's project-drift warning (`maybeWarnProjectConfigDrift` in `src/commands/profile-editor.ts`) name an active override instead of reporting it as unapplied global config

## 2. HTTP API: enablement read + mutations

- [x] 2.1 Add enablement wire types to `src/core/management-api/wire-types.ts` (request ops enable/disable/reset, response with mode profile|override and per-unit id/kind/source/title/skillName/enabled/installed/requiredByClosure)
- [x] 2.2 Implement `GET /api/v1/workflow-enablement?root=...` in-process (fresh catalog + per-project resolution + installed-state read); guard: absolute path AND registered space root (canonicalized comparison, no raw-separator string equality); wire into the router with tests
- [x] 2.3 Implement `POST /api/v1/workflow-enablement`: guards (op/id/root, nothing written or spawned on failure), project-scope config set/unset through the unified config layer's existing write path, then apply via a bounded `update` subprocess (new whitelist entry, cwd = space root, cap-1 slot, timeout/kill discipline, success = exit 0 without JSON parsing), response = fresh post-apply enablement state; apply-failure path returns the CLI message verbatim plus actual state
- [x] 2.4 Server tests: enable materializes override snapshot, disable removes, reset unsets and reconciles, concurrent mutation → busy, unknown op/id → 400 with no write/spawn, unregistered root rejected

## 3. UI: Workflows page enablement controls

- [x] 3.1 Mirror the new wire types into `packages/ui/src/api/types.ts` and add `getWorkflowEnablement` / `mutateWorkflowEnablement` to `packages/ui/src/api/client.ts` (same commit discipline as core wire types)
- [x] 3.2 Add the space picker + mode banner (follows profile vs own selection, reset with confirmation) to `packages/ui/src/components/WorkflowsPage.tsx`; no space picked → page unchanged
- [x] 3.3 Add per-card enablement state and toggle for the picked space; no toggle on internal/invalid/closure-required units (closure-required shows "required by an enabled workflow"); block concurrent enablement mutations; render post-apply state from the response; surface CLI errors verbatim
- [x] 3.4 UI tests covering the four workflows-ui delta scenarios (toggle scoped to picked space, override banner + confirmed reset, closure-required has no disable, no-space unchanged page)

## 4. Verification

- [x] 4.1 Run the full test suite (isolate any Windows EBUSY/spawn flakes per known list) and `rasen validate ui-space-workflow-toggle --strict` — all touched-area tests green (616/616 core + management-api + 259/259 UI); two pre-existing baseline failures unrelated to this change isolated and confirmed (cli-e2e locale skillVersionMismatch env flake; skill-templates-parity hash drift in untouched files, zero diff from HEAD)
- [ ] 4.2 Manual smoke: two local spaces — enable/disable in one, confirm the other's skills and drift status untouched; reset restores profile-following; CLI `rasen update` in the overridden space keeps the override
