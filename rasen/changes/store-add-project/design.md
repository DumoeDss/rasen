## Context

Rasen resolves exactly one Rasen root per command through `resolveOpenSpecRoot` (`src/core/root-selection.ts`). A store root and an in-repo project root are **layout-isomorphic**: `makeRoot` (root-selection.ts:120-124) derives `changesDir`, `specsDir`, and `archiveDir` from `WORKSPACE_DIR_NAME` identically for both. The difference is only in how they are selected (`--store <id>` and a registry lookup for a store; nearest-ancestor `rasen/` for an in-repo project) and that a store carries `.rasen-store/store.yaml` identity metadata plus a machine-registry entry.

Cross-store sharing already exists at the index level: a root's `rasen/config.yaml` may declare `references: [<store-id>, ...]`, and `assembleReferenceIndex` (`src/core/references.ts`) renders an INDEX of each referenced store's specs (id + first Purpose line + a `--store` fetch recipe) into instruction output. Content is never inlined; every failure degrades to a warning diagnostic; root resolution is never affected.

What is missing is a supported bridge from an in-repo project to a store: a way to make a store share-read an in-repo project's specs without externalizing that project's planning. The user's requirement is that this bridge be **non-destructive to the in-repo project** and remain index-level only (no federation). The design direction — register the project as a store and reuse `references:` — was approved in office hours; this document turns it into implementation decisions. See `planning-context.md` for the verbatim intent and converged direction.

## Goals / Non-Goals

**Goals:**
- One command that (a) registers an in-repo project as a store if needed and (b) adds it to a target store's `references:` list.
- Non-destructive to the project repo: the only new file inside it is `.rasen-store/store.yaml`; nothing under `rasen/` is rewritten, moved, or deleted.
- Idempotent: re-running with an already-registered project and an already-present reference reports success and changes nothing.
- Field-preserving config edits: appending to a store's `references:` leaves every other config key untouched and de-duplicates.
- Reuse the existing register and referenced-store primitives without changing their contracts.

**Non-Goals:**
- Federated / union spec resolution (a store surfacing the project's specs as its own in `rasen list --store`). Sharing stays index-level.
- Creating a brand-new store inside `add-project`. Creating a new store is `rasen store setup <id>`; `add-project --to <id>` composes with it but does not duplicate it.
- Any change to the machine-wide project registry (`src/core/project-registry.ts`) or its `ProjectMode`.
- Version bumps of any kind (repo directive, 2026-07-10).

## Decisions

**D1 — `store add-project <project-path> --to <store-id>` is a composition, not a new primitive.**
It calls the existing `registerExistingStore` flow for the project path, then appends the resulting store id to the target store's config `references:`. Rationale: both halves already exist and are tested; composing them keeps the non-destructive and idempotency guarantees the primitives already provide. Alternative considered — a bespoke register path that skips `registerExistingStore` — rejected because it would duplicate the health check, pointer-repo guard, and conflict detection that `registerExistingStore` already enforces.

**D2 — The project's store id.** Resolution order: the project's existing `.rasen-store/store.yaml` id if already a store; else an explicit `--as <id>` flag; else the kebab-cased project folder name (mirrors `inferStoreIdFromPath` used by `registerExistingStore`). Rationale: matches the id-resolution the user already sees from `store register`, so the composite verb has no surprising new naming rule.

**D3 — Non-destructive guarantee is structural, not a post-hoc check.** Registering a project as a store writes exactly one path inside the repo: `.rasen-store/store.yaml` (via `commitStoreRegistration` → `writeStoreMetadataState`). It requires a healthy Rasen root, which an in-repo project already has (its `rasen/specs`/`rasen/changes` give it planning shape), so no scaffolding of `rasen/` occurs. The target store's config edit happens in the **store's** repo, never the project's. Therefore the project repo's only change is one new metadata file — no existing file is read-modify-written. Alternative considered — copying the project's specs into the store — rejected outright as destructive to the single-source-of-truth and explicitly out of scope.

**D4 — Config `references:` append via raw-YAML round-trip.** There is no general `writeProjectConfig`; `references:` is hand-parsed (`parseDeclarationList`, project-config.ts:116). Follow the proven pattern in `src/core/archive.ts:905-915`: read the raw YAML into a `Record<string, unknown>`, read the normalized `references` via `readProjectConfig` to compute the deduped target list, set `rawConfig.references` to the merged list, and `writeFileSync(stringifyYaml(rawConfig))`. This preserves all other keys and comments-as-values the same way the quality-rules append does. De-dup keys on store id (the project's id already present → no-op). Alternative considered — a typed config serializer — rejected as scope creep; a schema-complete writer would drift from the resilient hand-parser and is unnecessary for a single-field append.

**D5 — `--to` names an existing registered store; creation is out of band.** If `<store-id>` is not registered, fail with a friendly error whose fix names `rasen store setup <store-id>` (or `store register`). Rationale: keeps the verb single-purpose and avoids `add-project` silently minting stores. "创建新 store 并加入" is expressed as `store setup <id>` followed by `store add-project <path> --to <id>` — two explicit steps.

**D6 — Project registry left untouched.** `ProjectMode = 'in-repo' | 'store'` (project-registry.ts:40) records machine-local artifact-home identity and is a **separate** registry from the store registry. A project that becomes a store gains a store-registry entry; its project-registry entry (if any) keeps its existing mode. Rationale: the dual-identity the planning context flagged is only a conceptual overlap, not a data conflict — the two registries key on different things and never contend. Touching `ProjectMode` (a new `'both'` value, or forcing a re-registration) would be a behavior change to unrelated self-healing code with no user-visible benefit, and would risk the non-destructive guarantee. Alternative considered — add a `mode: 'both'` — rejected as unnecessary complexity.

**D7 — Self-reference is rejected with a friendly error.** If the resolved project store id equals `--to <store-id>` (the project IS the target store), reject before writing, because a store referencing itself is meaningless. This is belt-and-suspenders: `assembleReferenceIndex` already omits self-references by id and by canonical path (references.ts:306, 361), so an accidental self-reference degrades silently even if it slipped through — but the command should not write it.

**D8 — `.rasen-store/` commit-vs-gitignore is surfaced, not decided.** The command's human output notes that committing `.rasen-store/store.yaml` lets teammates resolve the store id on their own checkouts (the `registerFix` onboarding recipe in references.ts:64-78 assumes the metadata rides in the checkout), while gitignoring keeps it machine-local. We recommend committing but do not edit `.gitignore`. Rationale: this is the user's repo policy to set; silently editing `.gitignore` would violate the non-destructive spirit.

## Risks / Trade-offs

- **Index assembly over a store root is an untested assumption** → `assembleReferenceIndex` reads references from the *resolved root's* config, and a store root resolves through the same `makeRoot` path as an in-repo root, so it should work. Mitigation: add an explicit test that instruction assembly for a `--store`-selected root renders the referenced project's spec index. Covered by a spec scenario and a task.
- **Raw-YAML round-trip can drop YAML comments** → `stringifyYaml` re-emits from the parsed object, so standalone comments in the store's config are lost, exactly as they already are for the quality-rules append in archive.ts. Mitigation: accept parity with existing behavior; document it. No new risk relative to today.
- **A project registered as a store now appears in `store list`** → expected and desired (it is a store), but a user might be surprised their in-repo project shows up there. Mitigation: the command's output states plainly that the project was registered as a store and remains fully usable in-repo.
- **Concurrent config writes to the same store** → two `add-project` runs targeting one store could race on the config file. Mitigation: the append is read-modify-write on a single small file; last-writer-wins with de-dup means the union is eventually consistent per id. Store config is not lock-protected today and this change does not introduce a locking contract; the failure mode is a lost concurrent addition, recoverable by re-running. Noted as acceptable for a low-frequency admin command.

## Migration Plan

No migration. The feature is purely additive: a new subcommand plus one completions entry. Existing stores, existing `references:` declarations, and existing in-repo projects are unaffected until a user runs `store add-project`. Rollback is removing the subcommand; any `.rasen-store/store.yaml` or `references:` entry it wrote remains valid and independently manageable via `store unregister` and manual config edits.

## Open Questions

- Flag name for the project id override: `--as <id>` (chosen in D2) vs `--id <id>` (matches `store register`). Leaning `--as` to read naturally (`add-project ./proj --to team-store --as proj-specs`) and avoid colliding semantics with the target `--to`. Non-blocking; either is a trivial rename.
