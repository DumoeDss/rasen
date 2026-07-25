# Planning Context

## User intent

> `$rasen-auto auto-decompose 阅读这个文档：C:\Users\Sayo\.rasen\projects\autonomy-ladder-1e42477e\design-docs\Sayo-dev-0.1.5-design-20260725-031804.md 开始实现这个需求。使用worktree创建新的开发分支，完成开发后提pr到dev/0.1.5`

The referenced design is APPROVED rev 2. Implement it fully without changing the package version. Development must happen in a new worktree/branch, and the final delivery is one PR targeting `dev/0.1.5`.

## Source design

Read this file before proposing any child:

`C:\Users\Sayo\.rasen\projects\autonomy-ladder-1e42477e\design-docs\Sayo-dev-0.1.5-design-20260725-031804.md`

Key locked decisions:

- Threshold schemes contain thresholds only, never models.
- Schemes include both handoff and reuse families in the same release.
- Runtime bindings are keyed by a capability-based runtime adapter registry.
- The factory binding map is empty; no default binding is pre-created.
- Binding precedence is below stage overrides but above pipeline-level and legacy scope values.
- Resolvers stay synchronous and pure; callers inject pre-resolved layers.
- Schemes are machine-level in this release.
- Keepalive runtime booleans remain separate advanced settings.
- Package version remains user-controlled.

## Decomposition plan

The task is decomposed because it contains three independently reviewable capability slices with a strict interface dependency:

1. `threshold-schemes-runtime-bindings-runtime-registry`
   - Build the single runtime adapter registry with `canProbeContext`, `canAudit`, and `canDispatch`.
   - Convert the existing scattered runtime enums/types/validation consumers to derive from the registry.
2. `threshold-schemes-runtime-bindings-threshold-core`
   - Depends on child 1.
   - Add machine-level scheme storage/validation, runtime binding config keys and placeholder validation, unified threshold resolution, handoff/reuse integration, runtime reporting, CLI scheme list/show, and core tests.
3. `threshold-schemes-runtime-bindings-threshold-surfaces`
   - Depends on child 2.
   - Add management API/wire/UI support, the Pipelines page schemes/bindings/advanced-overrides redesign, preset display/seeding, migration guidance, three-language i18n, orchestration-template parity update, and end-to-end compatibility tests.

All children run serially. The serial policy is deliberate: child 2 consumes the registry API from child 1, and child 3 consumes the scheme/config/resolver contracts from child 2. No child may ship a PR independently; child ship stages are local commits only. The parent performs the single push/PR after all children are review-clean.

## Repository constraints discovered

- TypeScript, Node.js >=20.19, ESM, pnpm.
- Cross-platform paths must use `path.join`/`path.resolve`; Windows behavior needs coverage.
- Tests under `test/` follow `test/AGENTS.md`.
- The original checkout is dirty; all implementation is isolated in:
  `E:\AI\ChatAI\Agents\VibeCodingProjects\workflow\Reference\OpenSpec-code-threshold-schemes-runtime-bindings`
- Development branch:
  `feat/threshold-schemes-runtime-bindings`
- Base:
  `origin/dev/0.1.5` at `1d821debfbe23d70c371d2cf85cd78a661c827dc`

## Durable planner findings

Append only cross-child decisions, discovered constraints, stable interfaces, and dead ends here.

- The runtime registry is a dependency-leaf core contract, separate from both `AI_TOOLS` (installation/adaptation metadata) and keepalive's `claude|codex|unknown` lifecycle gate. Do not derive threshold-binding eligibility from either of those surfaces; the approved initial capability matrix remains Claude/Codex = probe+audit+dispatch and Zed = audit only.
- The runtime-registry slice will expose capability-derived probe/audit/dispatch types, ordered value lists, and a shared capability guard. The threshold-core child must consume the probe-capable view for `thresholds.bindings.<runtime>` placeholder validation; `default` is a reserved fallback binding row accepted separately, not a registered runtime id.
- Dispatch migration must propagate beyond the config-key literal into `AgentRuntimeSchema`, pipeline/config parsing and stage override types, and management wire types; audit wire types likewise consume the shared audit contract. Later children can therefore depend on registry-derived contracts instead of reintroducing local `'claude' | 'codex'` or `'claude' | 'codex' | 'zed'` unions.
- A valid machine-level threshold scheme is a complete threshold policy: `handoff` and `reuse` scalars are required dual-form values, `handoffRoles` is optional for the five pipeline roles, and `reuseRoles` is optional for planner/implementer. Scheme name `default` is reserved for the binding row. The core scheme library should expose read/list/save/delete with atomic writes so the surfaces child can build management APIs without inventing a second storage contract.
- Binding resolution is row-first: recognized runtime's explicit row across project/store/global, then the `default` row across project/store/global. Thus a store runtime row beats a project default row. Missing/invalid scheme references warn, skip, and continue through remaining binding candidates before legacy layers. Config parsing must preserve syntactically valid dangling scheme strings; registry-mediated writes dynamically enumerate local scheme filenames.
- The shared resolver contract is synchronous and pure over caller-injected layers. It returns threshold/source plus binding metadata (scope, selected row, scheme name) and non-fatal diagnostics. Child 3 should consume this stable metadata for management wire/UI status instead of recomputing binding selection.
- Per-role reuse uses each role's effective runtime, but the top-level reuse `.threshold` has no runtime identity and therefore considers only the `default` binding row before pipeline scalar/default. Agent context passes its detected runtime to the handoff resolver but deliberately passes no role, stage, pipeline, or preset layers.
- Threshold scheme management is installation-wide at `/api/v1/threshold-schemes` and delegates CRUD to the core scheme library. Runtime binding writes remain on the existing space-scoped config API; the surfaces slice must not create a second binding mutation path.
- The scheme management response exposes the core scheme list, complete read-only preset seeds, and the server's probe-capable binding-row vocabulary. Preset suggestions fall back to built-in threshold defaults, while seeding only opens an unsaved editable draft.
- Management wire and UI must consume resolver-produced binding metadata, sources, and diagnostics without reimplementing precedence. Pipeline payloads mirror effective handoff metadata and add effective reuse metadata using each role's effective runtime.
- Legacy migration guidance is detection-only in this release: explain coexistence and precedence, preserve legacy values under Advanced overrides, and never auto-convert or delete them. Keepalive runtime booleans remain a separate advanced control.
- Every new or changed threshold-management string must have complete English, Simplified Chinese, and Japanese catalog entries; runtime ids, scheme names, and source tokens remain untranslated data.
- Orchestration Step H must be changed in the canonical `_orchestration.ts` source and its feature-reduced replacements, then propagated with `pnpm build` followed by `node dist/cli/index.js update`. Refresh only affected entries in both function and generated-skill parity hash maps; never edit generated skill copies directly.
