## 1. Registry schema: the type field and namespace keying

- [x] 1.1 In `src/core/store/foundation.ts`, add an optional `type: 'store' | 'project'` to `RegistryEntrySchema` and `StoreRegistryEntryState` / `StoreRegistryEntry` (absent → store). Do NOT touch `validateStoreId` (id grammar is shared).
- [x] 1.2 Realize the on-disk namespace encoding (design D1): project entries keyed under `stores:` with the reserved `project:<id>` key form; `assertValidStoreIds` strips the optional `project:` prefix before validating the id portion as kebab-case. Store keys stay bare ids.
- [x] 1.3 Parse strictly (security): reject a `type` value outside `store|project`, and reject a key-form/`type` disagreement, as `invalid_store_registry`. Never coerce an ambiguous entry to a namespace.
- [x] 1.4 Preserve byte-stability: `serializeStoreRegistryState` MUST NOT inject a `type` key onto a store entry that lacks one; project entries always write `type: 'project'`. Update `listStoreRegistryEntries` to return `{ id, type, backend }` with the bare id.
- [x] 1.5 Tests: legacy no-type file parses as store-typed and re-serializes byte-identically; store `elftia` + project `elftia` coexist; malformed type and key/type-mismatch entries are rejected. Use `path.join` for any path assertions.

## 2. Conflict detection per (type, id) and (type, canonical path)

- [x] 2.1 In `src/core/store/registry.ts`, make `assertNoRegisteredStoreConflict` `(type, id)`-aware (same-id different-type is not a conflict) and `(type, canonical-path)`-aware. Keep the `store_id_conflict` / `store_path_conflict` codes stable.
- [x] 2.2 On the add-project path, extend the id-conflict fix-hint to name the taken id and suggest `--as <id>` with a concrete example.
- [x] 2.3 Tests: same-id/different-type allowed; same-id/same-type rejected with the `--as` hint; same canonical path/same type rejected.

## 3. Root selection: --project parity and mutual exclusion

- [x] 3.1 In `src/core/root-selection.ts`, add `project?: string` to `StoreSelectorOptions`; reject passing both `store` and `project` with a friendly mutual-exclusion error before resolution; resolve `(type, id)` (store id → store namespace, project id → project namespace).
- [x] 3.2 Make `emitStoreRootBanner` and `withStoreFlag` render `--project <id>` for a project-typed resolved root; carry the type on `ResolvedOpenSpecRoot`.
- [x] 3.3 Tests: `--project` resolves a project root with full parity to a store root; both-flags rejected in JSON and human modes; project-root hints carry `--project`.

## 4. Config references: the project: prefix

- [x] 4.1 In `src/core/project-config.ts`, extend `parseDeclarationList` to accept `project:<id>` string entries (and the object form's type), normalizing to a `DeclarationEntry` carrying the id + project marker; validate the id portion against the grammar; drop invalid entries with a warning (resilient parsing). Keep this additive and non-conflicting with the existing `references:` append helper from `store-add-project`.
- [x] 4.2 In `src/core/references.ts`, resolve project-typed declarations against the project namespace; render the entry distinguished by type; keep content non-inlined and the byte budget intact.
- [x] 4.3 Tests: `references: [other-store, project:elftia]` indexes both namespaces; invalid `project:` id drops with a warning; bare id still resolves as a store.

## 5. Fetch recipes and self-reference (security-relevant)

- [x] 5.1 In `src/core/references.ts` `registerFix`, render the project-namespace registration verb for a project-typed unresolved reference so a teammate's checkout lands in the project namespace and the `project:<id>` reference resolves. Preserve `isShellSafeRemote` gating unchanged.
- [x] 5.2 In `src/core/store/operations.ts` `storeAddProject`, register into the project namespace by default, and change the self-reference guard (currently `resolvedProjectId === targetStore.id` at ~line 930) to compare CANONICAL PATHS (same directory = self-reference); same-id/different-path is allowed.
- [x] 5.3 Tests: project recipe names the project verb and round-trips; unsafe remote falls back to checkout wording in the project namespace and never renders an executable command; same-id/different-path add-project succeeds; same-directory add-project is rejected.

## 6. CLI, completions, and display

- [x] 6.1 Register `--project <id>` on every `--store`-bearing command in `src/cli/index.ts` (specs/changes group) and `src/commands/pipeline.ts` (pipeline inspection group); wire the mutual-exclusion check. Commands outside the two groups (e.g. `rasen agent context`) take neither.
- [x] 6.2 In `src/core/completions/command-registry.ts`, add the `--project` flag wherever `--store` appears; add the `--as` flag to `store add-project` if not already present.
- [x] 6.3 In `src/commands/store.ts`, display the entry type in `store list` (a Type column; keep the bare id copy-pasteable) and update `store add-project` output wording to say "project namespace".

## 7. Template parity

- [x] 7.1 Extend `src/core/templates/workflows/store-selection.ts` guidance to cover `--project <id>` alongside `--store <id>` on both command groups, and note mutual exclusion. Update any expert templates that thread `--store` hints.
- [x] 7.2 Run the build→update flow (`node build.js`, then the skill update step) and hand-sync parity hashes per repo convention; run the parity test.

## 8. Validation and cross-platform

- [x] 8.1 Backward-compat golden test: an existing `{ stores: { elftia: { backend } } }` registry parses, resolves via `--store elftia`, and re-serializes byte-identically; existing bare-id `references:` unchanged.
- [x] 8.2 CLI e2e: register a store and a same-named project, select each via `--store` / `--project`, add-project across a name collision, and confirm `store list` differentiates them.
- [x] 8.3 Run `node bin/rasen.js validate store-project-namespace`, `node build.js`, `npx eslint`, and `npx vitest` (single-worker `VITEST_MAX_WORKERS=1` for CLI-spawning files; isolate-rerun the known Windows EBUSY flake before calling a failure real). Confirm no version bump in `package.json` / `CHANGELOG.md`.
