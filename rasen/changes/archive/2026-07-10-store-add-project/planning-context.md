# Planning context — store-add-project

## User intent (verbatim, 2026-07-10)

> 当前我们有两种形态，单项目的in-repo与多项目的store。我希望能够增加一个功能，为store添加单项目的引用，即把原本的单项目添加或升级到store，不管是添加到已存在的store还是创建新的store，都能够不破坏单项目的in-repo的同时，让store能够共享读取到in-repo的spec内容。因此需要添加到store/升级为store等功能。

User approved the LEAD's design direction in the office-hours discussion: **index-level sharing via existing primitives, NOT federation**.

## Converged design (approved by user)

Key code fact discovered: **store roots and in-repo project roots are layout-isomorphic** — both are "a git repo containing `rasen/{specs,changes}`" (see `src/core/root-selection.ts:122-124`, store root resolution joins `WORKSPACE_DIR_NAME`). Therefore:

1. **"升级为 store"** is mechanically `rasen store register <repo-path> --id <id>` on the project repo itself. It only writes `.rasen-store/` metadata + a machine-registry entry (`src/core/store/registry.ts` `registerStore`), touching nothing under `rasen/`. Zero copy, zero destruction; in-repo workflows continue unchanged.
2. **"共享读取"** reuses the existing `references:` mechanism (`src/core/references.ts`, slice 3.1): a root's config.yaml declares `references: [<store-id>]`; instructions output carries an INDEX of the referenced store's specs (id + one-line summary + `--store` fetch recipe). Content never inlined; problems degrade to warning diagnostics.
3. **New composite verb (the actual feature):** something like `rasen store add-project <path> --to <store-id>`:
   - (a) registers the project as a store if not already registered (reuse `registerStore`),
   - (b) appends that id to the TARGET store's config.yaml `references:` list,
   - (c) records the relationship where appropriate (project registry `src/core/project-registry.ts` has `mode: 'in-repo' | 'store'` — dual identity needs reconciling).
   - "创建新 store 并加入" = register the new store first, then same path.

## Edges to resolve in the proposal

- `.rasen-store/` metadata lands in the user's project repo root — surface commit-vs-gitignore guidance (LEAD leans commit: cross-machine identity rides on it; teammate flow in `references.ts` `registerFix` assumes metadata exists in the checkout).
- `project-registry.ts` `ProjectMode` is `'in-repo' | 'store'` exclusive — a project that is both needs a decision (new mode value? allow dual registration? keep registry untouched?).
- VERIFY (and add a test): references assembly works when the ROOT is a store root (references.ts reads the root's config.yaml; a store root is a root, should be through, but untested assumption).
- `assertNoRegisteredStoreConflict` guards (one checkout per id, path conflict) — friendly error paths for add-project.
- CLI command surface lives in `src/commands/store.ts`; completions in `src/core/completions/command-registry.ts`.

## Constraints

- Non-destructive to in-repo is the HARD requirement (user emphasized).
- Index-level sharing only — do NOT build union/federated spec resolution (`rasen list --store` showing in-repo specs as the store's own is out of scope).
- Version discipline: NO version bumps (user directive 2026-07-10); release-agnostic wording.
- Windows dev machine; test suite has known EBUSY flake in CLI-spawning tests (isolate-rerun to confirm).
- Independent sibling change `auto-skip-gates` runs after this one in the same working tree — keep diffs scoped; ship with explicit pathspec commits.

## Durable findings (appended by planner, 2026-07-10)

- **Config-write mechanism resolved.** There is NO general `writeProjectConfig`; `references:` is hand-parsed (`parseDeclarationList`, project-config.ts:116). The append path reuses the proven raw-YAML round-trip in `src/core/archive.ts:905-915` (read raw YAML → mutate one field → `writeFileSync(stringifyYaml(rawConfig))`), which preserves other fields. Known parity cost: `stringifyYaml` drops standalone YAML comments (same as the existing quality-rules append) — accepted, not new.
- **Edges decided in artifacts:**
  - `project-registry.ts` `ProjectMode` LEFT UNTOUCHED (design D6). The project registry and store registry key on different things and never contend; the "dual identity" is conceptual, not a data conflict. No `'both'` mode.
  - `--to <store-id>` names an EXISTING registered store only (design D5). "创建新 store 并加入" = `store setup <id>` then `add-project --to <id>` (two explicit steps). `add-project` never mints stores.
  - Project store id resolution: existing `.rasen-store` id → explicit `--as <id>` → kebab-cased folder basename (design D2). Flag name `--as` chosen over `--id` (open question, non-blocking rename).
  - `.rasen-store/` commit-vs-gitignore is SURFACED in output, never auto-edited (design D8, non-destructive spirit).
  - Self-reference rejected before write (design D7), even though `assembleReferenceIndex` already omits self-refs by id (references.ts:306) and by canonical path (references.ts:361).
- **`registerExistingStore` reuse is clean** (operations.ts:737): requires a healthy Rasen root (an in-repo project passes via its planning shape), rejects config-only pointer repos, writes only `.rasen-store/store.yaml`, handles already-registered idempotently. The composite verb should compose it, not reimplement.
- **Layout isomorphism confirmed in code**: `makeRoot` (root-selection.ts:120-124) builds changes/specs/archive dirs from `WORKSPACE_DIR_NAME` identically for store and in-repo roots — a store root IS a root, so index assembly over a store root is an existing-contract VERIFICATION (task 4.1 + spec scenario), not a requirement change. That is why the proposal lists NO modified capabilities.

## Artifacts produced (planner, 2026-07-10)
- proposal.md, design.md (8 decisions D1-D8), specs/store-add-project/spec.md (6 requirements, ADDED only), tasks.md (5 groups, ~15 tasks). `rasen validate store-add-project` → valid. 4/4 artifacts complete.
