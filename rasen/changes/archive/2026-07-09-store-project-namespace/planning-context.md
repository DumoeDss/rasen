# Planning context — store-project-namespace

## User intent (converged over discussion, 2026-07-10)

User asked whether a store and a project can share the same name (e.g. store `elftia`, client project folder `elftia`, plus siblings `elftia-website`, `elftia-plugins`). Initial LEAD recommendation was "use --as, keep flat namespace"; the user pushed back with "store 和 project 本来就需要分开吧？" and the LEAD conceded: the type separation is the more truthful model — "project registered AS a store" (shipped yesterday as store-add-project, commit 2af26ba) was a reuse expedience, and its leaks are already visible (misleading self-reference error on name collision; projects listed undifferentiated in `rasen store list`).

**Approved design (user confirmed both forks):**

1. **One registry + type field, NOT a second registry.** Store registry entries gain `type: 'store' | 'project'` (default/absent = `'store'` for backward compat — every existing entry keeps meaning store). Uniqueness becomes the (type, id) pair — `elftia` store and `elftia` project coexist. Do NOT reuse src/core/project-registry.ts (machine-home identity; keyed by canonical path, auto-generated projectIds — no user-chosen name space there; it stays untouched, same as D6 of store-add-project).
2. **Syntax (user-decided fork):** CLI gets a `--project <id>` flag (NOT `--store project:elftia` — user rejected as too long). Config YAML `references:` entries use the `project:` prefix string form: `references: [other-store, project:elftia]` (minimal intrusion into parseDeclarationList's string-list shape). Bare id = store everywhere; prefix/flag = project namespace.
3. **Capability stays uniform.** A `project:`-typed reference / `--project`-selected root resolves to a normal Rasen root; list/show/instructions/context etc. work identically. Type distinguishes NAMESPACE and DISPLAY, never capability. `--store` and `--project` are mutually exclusive on one invocation (friendly error if both).
4. **`store add-project` re-pointed:** registers the project into the PROJECT namespace by default (inferred name colliding with a store name is no longer a conflict). `--as` retained — collisions WITHIN the project namespace are still possible (two checkouts with the same basename).
5. **Old "project-as-store" entries: permanently compatible, NO migration verb** (user accepted YAGNI recommendation). Entries registered pre-split stay plain store entries and keep working forever.
6. **Fold in the pending error-message follow-up** (from the elftia discussion, pre-dating this change):
   - Self-reference detection in storeAddProject (operations.ts:930) compares IDS today — change to compare canonical PATHS (true self = same directory). Same-name-different-path must NOT report "cannot be added to itself".
   - Name-collision errors (vs the target store, vs any registered entry in the same namespace) must name the taken id and suggest `--as <id>` with a concrete example (e.g. `--as elftia-client`). The registry conflict fix-hints (`store_id_conflict` in registry.ts) should mention `--as` where the add-project path surfaces them.

## Cross-machine / teammate story

Fetch recipes in the references index (references.ts registerFix) currently render `rasen store register <path> --id <id>`. For project-typed entries render the project-namespace equivalent (whatever registration verb the design lands on — likely `store add-project` or a `--type project` on register; the recipe must round-trip: a teammate following it ends up with the entry in the PROJECT namespace so the reference resolves). Hints printed by commands for a project-selected root must say `--project <id>`, not `--store <id>`.

## Implementation surface (from the LEAD's earlier reading; planner verify/extend)

- src/core/store/foundation.ts — registry entry schema (`type` field), validateStoreId unchanged (id syntax same in both namespaces).
- src/core/store/registry.ts — conflict checks become (type, id)-aware and (type, path)-aware; error messages per item 6.
- src/core/store/operations.ts — storeAddProject: project-namespace registration, canonical-path self-ref check, error messages.
- src/core/root-selection.ts — resolve (type, id); `--project` plumbing parallel to `--store`.
- src/core/references.ts — parse `project:` prefix in declaration entries; index rendering shows the type; fetch recipes per namespace.
- src/core/project-config.ts — parseDeclarationList accepts prefixed entries (validation: `project:` + valid id).
- src/commands/*.ts + src/cli/index.ts — `--project` flag on every command that takes `--store` (the two groups documented in the skills preamble: specs/changes commands + pipeline inspection group); mutual-exclusion check.
- src/core/completions/command-registry.ts — flag registration.
- src/commands/store.ts — `store list` displays type; add-project output wording.
- Templates mentioning `--store` hints (store-selection.ts workflow template and any experts that thread the flag) — extend wording to cover `--project`; parity hashes hand-synced (edit template → node build.js → run parity test → paste hashes).
- Tests throughout (registry, references, root-selection, CLI e2e, completions, add-project, parity).

## Constraints

- Backward compatibility is ABSOLUTE: absent `type` field = store; every existing registry file, config.yaml, and command line keeps working unchanged.
- Version discipline: NO version bumps (package.json/CHANGELOG.md untouchable — user directive on file).
- `pnpm run` is broken repo-wide (malformed pnpm-workspace.yaml two dirs up) — use `node build.js`, `npx eslint`, `npx vitest`; single-worker (VITEST_MAX_WORKERS=1) for CLI-spawning test files (known Windows EBUSY flake; isolate-rerun before calling a failure real).
- Shared working tree with other sessions — ship/archive commits use explicit pathspec + `git show --stat` verification.
- Relevant shipped context: store-add-project (2af26ba/42910df — the verb being re-pointed; its spec rasen/specs/store-add-project/spec.md will need delta MODIFICATIONS, not just ADDED), auto-skip-gates (692c1d4/8f7b242 — gatePolicy machinery, unrelated surface).
- Gate policy for this run: no-gate (user directive continues from previous run).

## Durable findings (appended by planner, 2026-07-10)

- **The registry is keyed by BARE ID, and every key is kebab-validated.** `stores: Record<string, {backend}>` (`foundation.ts:187`); `assertValidStoreIds(Object.keys(...))` (`foundation.ts:236,258,296`) rejects any non-kebab key. This is THE crux: a plain id-keyed record physically cannot hold store `elftia` AND project `elftia`. The `(type,id)` model therefore forces the on-disk KEY to disambiguate the namespace — the `type` field alone on the entry value is insufficient. Design D1 decides: project entries keyed `project:<id>` under the same `stores:` map (`:` is not a kebab char → zero collision with any store id/future id), with the entry's `type` authoritative and key-handling stripping the prefix before id validation. Alternative (sibling `projects:` map) noted but rejected for duplicating the lock/parse/write paths. **This on-disk shape was NOT pinned by the user** — only the observable `(type,id)`/type-field/backward-compat contract was; the encoding is the design's call and the implementer may revisit provided the contract holds.
- **Backward-compat is byte-level, not just parse-level.** Existing files have `{stores:{elftia:{backend}}}` with no `type`. Requirement + task 1.4/8.1: re-serialize MUST NOT inject a `type` key onto a store entry that lacked one; project entries always write `type:'project'`. A golden byte-identical round-trip test is the highest-value guard.
- **Self-reference guard compares IDs today** (`operations.ts:930`: `resolvedProjectId === targetStore.id`). Follow-up flips it to canonical-PATH comparison (same directory = self). Same-id/different-path store+project is legitimate. The reference index ALREADY omits self-refs by canonical path (`references.ts:361`) — this aligns the write-time guard with the assembly-time guard.
- **`--store` threading surface (for `--project` parity), verified:** two groups only. (1) specs/changes commands in `src/cli/index.ts` (`.option('--store <id>', STORE_OPTION_DESCRIPTION)` on list/show/validate/archive/status/instructions/new-change/context — ~10 sites) all funnel through `resolveRootForCommand` → `resolveOpenSpecRoot` (`root-selection.ts`), whose `StoreSelectorOptions` has `store?`/`storePath?`. (2) the `pipeline` inspection group (`src/commands/pipeline.ts:150` calls `resolveRootForCommand`). Banner/hint helpers to mirror: `emitStoreRootBanner` ("Using Rasen root: <id> (<path>)") and `withStoreFlag` (appends `--store <id>`), both in `root-selection.ts:458,468`. Template wording lives in ONE constant: `STORE_SELECTION_GUIDANCE` (`src/core/templates/workflows/store-selection.ts`), interpolated into every workflow — extend it once for `--project`. `rasen agent context` is NOT in either group (explicitly excluded in the guidance).
- **`parseDeclarationList` (`project-config.ts:116`) is the reference-prefix surface**: it already normalizes string entries and `{id,remote}` objects to `DeclarationEntry[]`, dedups by id, drops invalid entries with a warning. Adding a `project:` prefix is additive — parse the prefix, validate the id portion, carry a project marker. Non-conflicting with store-add-project's `appendStoreReference` (a different function/round-trip helper in the same file terrain).
- **Spec-delta placement decision:** registry `(type,id)` uniqueness/conflict behavior was NEVER specced as a requirement in `store-registration` (it lives only in code `assertNoRegisteredStoreConflict`), so it lands as ADDED in the NEW `store-project-namespace` capability, NOT as a MODIFIED delta on store-registration (no matching requirement to modify). Proposal's Modified Capabilities lists ONLY `store-add-project`. MODIFIED delta headers must match the synced spec EXACTLY (kept "The project's store id is resolved predictably" verbatim).

## Artifacts produced (planner, 2026-07-10)
- proposal.md, design.md (6 decisions D1-D6, security-surface risks called out for cso), specs/store-project-namespace/spec.md (6 ADDED requirements incl. registry parsing + shell-safe fetch-recipe security requirements), specs/store-add-project/spec.md (3 MODIFIED requirements: project-namespace registration, project:<id> reference, canonical-path self-ref), tasks.md (8 groups, ~25 tasks). `rasen validate store-project-namespace` → valid. 4/4 artifacts complete.
