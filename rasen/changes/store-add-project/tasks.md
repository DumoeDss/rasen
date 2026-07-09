## 1. Config references append helper

- [x] 1.1 Add a `references:` append helper (in `src/core/references.ts` or `src/core/project-config.ts`) that, given a store root and a store id, reads the raw `rasen/config.yaml`, computes the de-duplicated `references` list via `readProjectConfig`, sets `rawConfig.references`, and writes it back with `stringifyYaml` — preserving all other fields. Follow the established round-trip pattern in `src/core/archive.ts:905-915`. Resolve `config.yaml`/`config.yml` and all paths with `path.join`/`path.resolve` (cross-platform).
- [x] 1.2 Make the helper idempotent: when the id is already present, write nothing and report "unchanged"; when the config file is absent, create a minimal `rasen/config.yaml` containing only the `references:` list.
- [x] 1.3 Unit-test the helper: append to a config with existing fields (assert other fields survive), append a duplicate (assert no-op), append when no config exists (assert minimal file created). Use `path.join` for all expected paths.

## 2. Core add-project operation

- [x] 2.1 Add a `storeAddProject` core operation (in `src/core/store/operations.ts` or a sibling module) taking `{ projectPath, targetStoreId, id? }`. Resolve the project store id per design D2 (existing `.rasen-store` id → explicit id → kebab-cased folder basename via the same inference `registerExistingStore` uses).
- [x] 2.2 Resolve and validate the target store: use `resolveRegisteredStore`; on `store_not_found` re-throw a diagnostic whose fix names `rasen store setup <store-id>` then rerun (spec: unknown target store rejected with a setup hint).
- [x] 2.3 Reject self-reference: if the resolved project store id equals the target store id, throw a friendly diagnostic before writing anything (spec: adding a store to itself is rejected).
- [x] 2.4 Register the project as a store by composing `registerExistingStore` (reuse its health check, pointer-repo guard, and conflict detection). Capture whether metadata was newly created (for the commit-guidance output) and whether it was already registered (for idempotency reporting).
- [x] 2.5 Append the project store id to the target store's config via the helper from task 1. Assemble a result payload carrying: project store id, project root, target store id, `metadataCreated`, `alreadyRegistered`, and `referenceAdded` vs `referenceAlreadyPresent`.

## 3. CLI surface

- [x] 3.1 Add `store add-project <path>` to `src/commands/store.ts` with `--to <store-id>` (required), an id-override flag (`--as <id>`, see design open question), and `--json`. Wire it to the core operation and reuse the existing store-command failure handling (`handleFailure`/`emitFailure`).
- [x] 3.2 Human-mode output: report the project store id, the target store, that the project remains usable in-repo, and — when `.rasen-store/store.yaml` was newly created — the commit-vs-gitignore guidance (do not edit `.gitignore`, do not commit). JSON mode: emit one structured payload including the diagnostics/status array.
- [x] 3.3 Register the `add-project` subcommand in `src/core/completions/command-registry.ts` under the `store` group (positional `path` of type `path`; flags `to` takesValue, `as` takesValue, `json`).

## 4. Referenced-index-over-store-root verification

- [x] 4.1 Add a test proving referenced-store index assembly works when the resolved root is a store root: assemble instructions for a `--store`-selected store whose config references an added project, and assert the project's spec ids and Purpose lines appear in the rendered index, with no inlined content (design risk + spec scenario "Target store's instructions index the project's specs").

## 5. Integration and cross-platform coverage

- [x] 5.1 End-to-end test of `store add-project`: a healthy in-repo project added to a registered store — assert the project gains only `.rasen-store/store.yaml` (nothing under its `rasen/` changes), the store config gains the reference, and re-running is a no-op. Use an isolated `globalDataDir`/registry so the machine registry is not touched.
- [x] 5.2 Test the non-destructive guarantee explicitly: snapshot the project's `rasen/` tree before and after and assert byte-for-byte equality; assert the project's own `rasen/config.yaml` is untouched (the reference lands in the store's config).
- [x] 5.3 Verify on Windows CI (path resolution of `<project-path>`, config file discovery, and `.rasen-store` writes) — all paths via `path.join`/`path.resolve`; account for the known Windows EBUSY flake in CLI-spawning tests by isolate-rerunning if it surfaces.
- [x] 5.4 Run `rasen validate store-add-project`, `pnpm build`, `pnpm lint`, and the test suite; confirm no version bump crept into `package.json`.
