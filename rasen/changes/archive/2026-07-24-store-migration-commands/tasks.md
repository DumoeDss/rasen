## 1. Shared migration core

- [x] 1.1 Create `core/store/migration.ts`: adoption manifest schema (`adoptions.yaml`, version 1, keyed by projectId: spec names, change names, source path, timestamp) with read/write/validate helpers under the store metadata dir
- [x] 1.2 Implement copy → verify (count + size, optional `--verify-hash`) → delete move engine with resume detection, all paths via `path.join`, no `fs.rename` across roots
- [x] 1.3 Implement case-insensitive name-collision precheck (specs and changes) shared by adopt and relocate
- [x] 1.4 Implement suggested-git-commands renderer (pathspec-scoped, per repo, never executed) and uncommitted-file detection for moved paths

## 2. store adopt

- [x] 2.1 Add `rasen store adopt [path] --to <store-id> [--archive move|leave|external] [--dry-run] [--json] [--verify-hash]` command wiring in `commands/store.ts`
- [x] 2.2 Implement prechecks: store registered + doctor-healthy, source has planning shape, no existing `store:` pointer, no collisions; aggregate and report all failures at once
- [x] 2.3 Implement the adopt sequence per design D2 (copy, verify, delete, targeted-YAML pointer write preserving comments, empty-dir cleanup)
- [x] 2.4 Implement `--archive` modes including `external` (move to machine home archive + set project-scope `archive.destination external`)
- [x] 2.5 Integrate registration: add-project semantics if unregistered, `registerProject` refresh so mode is `store` immediately
- [x] 2.6 Implement resume path: manifest entry present + partial state detected → complete idempotently
- [x] 2.7 Unit + integration tests: happy path, collision abort, pointer-already-set, dry-run inertness, interrupted-adopt resume, cross-drive copy semantics, case-only collision

## 3. store eject

- [x] 3.1 Add `rasen store eject <project-id> [--from <store-id>] [--all] [--force] [--dry-run] [--json]` command wiring
- [x] 3.2 Implement manifest-driven restore: copy back, remove pointer via targeted YAML edit, remove manifest entry, registry refresh to `in-repo`
- [x] 3.3 Implement manifest-less `--all` fallback with interactive listing + confirmation
- [x] 3.4 Implement drift fail-closed (missing manifest files block; `--force` proceeds and reports gaps)
- [x] 3.5 Tests: round-trip adopt→eject restores identical tree, missing-manifest refusal, drift block and `--force`, dry-run inertness

## 4. archive relocate

- [x] 4.1 Add `rasen archive relocate --to <in-repo|external|store> [--dry-run] [--json]` command wiring
- [x] 4.2 Implement union enumeration of archived changes across repo dir, machine home, and store archive
- [x] 4.3 Implement move-with-timestamp-suffix collision handling and config flip in the same operation; reject `--to prune` and `--to store` outside store mode with actionable errors
- [x] 4.4 Add the relocate hint to `rasen config set archive.destination` when existing archives remain at the old location
- [x] 4.5 Tests: each direction, split-archive consolidation, collision suffixing, interruption + rerun completion, hint emission

## 5. home prune

- [x] 5.1 Add `rasen home prune [--apply] [--json]` command: orphan class (a) registry entries with missing paths, class (b) unreferenced home dirs; report with sizes by default
- [x] 5.2 Implement `--apply` deletion under the registry lock; worktree piercing counts as live; lastSeen age never a criterion
- [x] 5.3 Tests: report-only default, apply removes exactly the reported set, live-but-stale survives, worktree-referenced home survives

## 6. doctor drift diagnostics

- [x] 6.1 Extend `store doctor` with the three drift checks (unregistered pointer target = error; shape+pointer ambiguity = warning; manifest-vs-store mismatch = warning), each with a `fix:` line
- [x] 6.2 Surface the checks through top-level `rasen doctor` aggregation
- [x] 6.3 Tests for each drift state and its fix message

## 7. Finishing

- [x] 7.1 Update CLI help texts, locales (en/ja/zh-cn), and command-registry completions for all new commands and flags
- [x] 7.2 Update rasen-help skill/docs routing (store selection section) to mention adopt/eject/relocate/prune
- [x] 7.3 Verify Windows CI passes (path handling, case-insensitivity tests) and run full test suite
