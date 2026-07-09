## Context

The store registry is a single YAML file, `stores: Record<string, { backend }>`, keyed by a bare kebab id, with every key validated as a kebab id (`assertValidStoreIds`, `src/core/store/foundation.ts:187,236`). `listStoreRegistryEntries` maps `[id, entry] → { id, backend }`. Root selection resolves a store by looking that id up (`resolveStoreRoot`, `src/core/root-selection.ts:143`); a store root and an in-repo project root are layout-isomorphic (both `makeRoot` from `WORKSPACE_DIR_NAME`). `store add-project` (shipped) registers a project via `registerExistingStore` into that same flat id space, which is why a store and a project cannot share a name.

The user converged on a type split: registry entries carry `type: 'store' | 'project'` (absent = store), uniqueness is the `(type, id)` pair, the CLI gains `--project <id>` (mutually exclusive with `--store`), config references use a `project:` prefix, `store add-project` re-points to the project namespace, and pre-split entries stay valid forever with no migration verb. Backward compatibility is absolute. See `planning-context.md` for the full converged decision and the folded-in error-message follow-up.

The observable contract is pinned by the user. What this design must decide is the **on-disk encoding** of the second namespace (the user pinned the type field and `(type,id)` semantics, not the storage shape), and the precise `(type, id)` / `(type, path)` conflict semantics — both are security-relevant parsing surfaces the cso stage will review.

## Goals / Non-Goals

**Goals:**
- `(type, id)` uniqueness in one registry file: store `elftia` and project `elftia` coexist.
- Absolute backward compatibility: every existing registry file, `config.yaml`, and command line keeps working, with absent type meaning store.
- `--project <id>` selector at full parity with `--store <id>` (resolution, banner, hints, completions), mutually exclusive with it.
- `project:`-prefixed config references resolve to a normal Rasen root; type affects namespace and display only, never capability.
- Path-based self-reference detection and concrete `--as` collision hints.
- Cross-machine round-trip: a project-typed reference's fetch recipe lands a teammate's entry in the project namespace.

**Non-Goals:**
- A second registry module or file (the machine-home `project-registry.ts` stays untouched).
- A migration verb or any rewrite of pre-split entries.
- Any capability difference between store and project roots.
- Changing `validateStoreId` / the id grammar (identical in both namespaces).
- Version bumps (`package.json` / `CHANGELOG.md` untouchable).

## Decisions

**D1 — On-disk encoding: an explicit `type` field on the entry, plus a reserved key form for the project namespace.**
`RegistryEntrySchema` gains `type: z.enum(['store','project']).optional()` (absent → store). Store-namespace entries stay keyed by their bare id under `stores:` (existing files are byte-compatible and reparse as stores). Project-namespace entries live in the same `stores:` map under a reserved `project:<id>` key form; the entry's `type` is the authoritative source of truth and MUST agree with the key form. Rationale: the `:` separator cannot appear in a kebab id, so a `project:` key can never collide with any existing or future store key — coexistence is structural, not convention. Key handling strips the optional `project:` prefix before validating the id portion as a kebab id, so `assertValidStoreIds` still rejects a malformed id in either namespace.
Alternatives considered: (a) a sibling `projects:` map in the same file — clean, but the user's language ("entries gain a type field", "one registry") reads as one collection with a discriminator, and two maps duplicate the lock/parse/write paths; (b) keying purely by bare id with only the `type` field — rejected because a plain id-keyed record physically cannot hold two entries named `elftia`, which is the whole feature. D1 keeps a single map, a single lock, a single parse path, and a discriminator field, at the cost of prefix-aware key handling — the smallest change that satisfies `(type, id)`.

**D2 — `(type, id)` and `(type, canonical-path)` conflict semantics.**
`assertNoRegisteredStoreConflict` widens: an id conflict fires only within the *same type* (store `elftia` vs project `elftia` is NOT a conflict); a path conflict fires when the same canonical path is already registered under the same type. A project and a store MAY point at different paths under the same name; a project and a store pointing at the *same* path is allowed only insofar as the existing single-checkout-per-(type,id) rule permits, and is reported with the taken id and a concrete `--as <id>` suggestion. Rationale: uniqueness is `(type, id)`, so conflict detection must key on the pair, not the id alone. Reusing the existing `store_id_conflict` / `store_path_conflict` codes keeps the JSON contract stable; only the messages/fixes gain the `--as` hint on the add-project path.

**D3 — `--project` mirrors `--store` through one selector.**
`StoreSelectorOptions` gains `project?: string`. `resolveOpenSpecRoot` rejects passing both `store` and `project` with a friendly mutual-exclusion error before any resolution, then resolves `(type, id)` — `--store x` → `(store, x)`, `--project x` → `(project, x)`. `emitStoreRootBanner` and `withStoreFlag` render `--project <id>` when the resolved root is project-typed so pasted follow-up hints carry the right flag. Rationale: one resolution path, one banner path — never fork store vs project capability. The two flag-bearing command groups (specs/changes commands in `src/cli/index.ts`; the `pipeline` inspection group in `src/commands/pipeline.ts`) both register `--project`; commands outside those groups (e.g. `rasen agent context`) keep taking neither.

**D4 — Config `project:` prefix in `parseDeclarationList`.**
A `references:` string entry of the form `project:<id>` normalizes to a `DeclarationEntry` carrying the id plus a project-namespace marker; a bare `<id>` stays a store reference; the object form (`{id, remote}`) may also carry the type. Validation: the id portion after the prefix must pass the id grammar, else the entry drops with a warning like other resilient fields. Rationale: minimal intrusion on the existing string-list shape (item 2 of the converged design); a prefix is additive and old configs (bare ids) are unaffected.

**D5 — Fetch recipes and self-reference fix per namespace (security-relevant).**
`registerFix` (references.ts) renders the recipe that round-trips a referenced entry onto a teammate's machine. For a project-typed reference it renders the project-namespace registration verb (the re-pointed `store add-project` form, or the project-typed register), so the teammate's resulting entry is project-typed and the `project:<id>` reference resolves. The existing `isShellSafeRemote` gate on the pasted clone command is preserved unchanged — the recipe must never emit an unsafe remote or a namespace-ambiguous command. Rationale: the index renders into agent-executed guidance; a recipe that landed the entry in the wrong namespace would silently fail to resolve, and an unsafe recipe is a shell-injection surface the cso stage will check.

**D6 — Self-reference compares canonical paths, not ids (folded-in follow-up).**
`storeAddProject` currently rejects when `resolvedProjectId === targetStore.id` (`operations.ts:930`). Change it to canonicalize the project root and the target store root and reject only when they are the same directory. Rationale: with the type split, a project named `elftia` added to a store named `elftia` at a different path is legitimate, not a self-reference; true self-reference is same-directory, and the reference index already omits by canonical path (references.ts:361), so this aligns the write-time guard with the assembly-time guard.

## Risks / Trade-offs

- **Registry parse ambiguity (security-relevant)** → a hostile or corrupt registry could carry a key/type mismatch (e.g. a `project:` key with `type: store`). Mitigation: parse strictly — the entry's `type` is authoritative, and a key-form/type disagreement is an `invalid_store_registry` diagnostic, not a silent coercion. Add tests for mismatched key/type, unknown type value, and a bare id with `type: project`.
- **Backward-compat regression** → the highest-value risk. Mitigation: a golden test that an existing `{ stores: { elftia: { backend } } }` file parses to a single store-typed entry, re-serializes byte-identically (no injected `type` key when absent), and resolves via `--store elftia` exactly as before.
- **Shell-pasted fetch recipe injection** → project recipes are new command strings rendered into agent guidance. Mitigation: keep `isShellSafeRemote`; unit-test that an unsafe remote falls back to the teammate-checkout wording in the project namespace too; assert the recipe names the project verb so it round-trips.
- **`--store` / `--project` both passed** → ambiguous target. Mitigation: reject up front with a friendly error naming both flags; test the mutual-exclusion path in JSON and human modes.
- **Template parity drift** → `store-selection.ts` guidance and any expert templates threading `--store` must gain `--project` wording and be recompiled. Mitigation: run the build→update flow and hand-sync parity hashes; a task covers it.
- **Prefix leaking into display** → a `project:<id>` registry key must never surface to the user as the id. Mitigation: `listStoreRegistryEntries` returns `{ id, type, backend }` with the bare id; `store list` shows id + a type column.

## Migration Plan

None required — that is the point. Pre-split entries (bare-id keys, no `type`) parse as store-typed and keep resolving under `--store`. New project entries are additive (`project:<id>` keys with `type: 'project'`). A registry written by this version is still readable by it after any project entries are removed. Rollback is reverting the schema/selector/reference changes; a registry that already contains project entries would, on an older binary, fail strict parse of the unknown `project:` key — acceptable because rollback implies removing project entries first, and the change ships as one unit.

## Open Questions

- Whether the entry should store `type: 'store'` explicitly when writing a store entry, or continue omitting it (absent = store). Leaning omit-on-write for store entries to keep existing files byte-stable and the diff minimal; project entries always write `type: 'project'`. Non-blocking.
- Display spelling in `store list`: a `Type` column vs. a `project:` prefix on the id. Leaning a separate column so the bare id stays copy-pasteable. Cosmetic; the `--json` output carries `type` regardless.
