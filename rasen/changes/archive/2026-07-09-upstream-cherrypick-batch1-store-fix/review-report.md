# Review Report — upstream-cherrypick-batch1-store-fix

**VERDICT: APPROVE** — faithful port of upstream `93e27a7` (fix empty store registration, #1328); 0 Blocker / 0 Major / 0 Minor / 1 Trivial. Build green, 132/132 tests green across all 6 touched files, change delta valid.

Reviewer: reviewer-d (did not author). Diff scope: uncommitted working-tree changes to exactly 10 files (4 src + 6 test). Ignored `telemetry-backend/**` (other session). No git mutations, no product edits, no subagents.

---

## Per-lens confirmations

### Lens 1 — Faithfulness (vs `git show 93e27a7`)
PASS. Every functional hunk is present; the only omissions are the 3 intentionally-dropped `docs/**` hunks (`docs/agent-contract.md`, `docs/cli.md`, `docs/stores-beta/user-guide.md`).

Source, byte-for-byte identical to upstream on all added lines:
- `archive.ts`: `isMissingPathError`, `listActiveChangeNames` catch-rethrow, `selectChange` rewrite — verbatim. The deleted `fs.access` throw block was the fork's rasen-worded variant (`"No Rasen changes directory found. Run 'rasen init' first."`); upstream deletes the OpenSpec-worded variant. Correct hand-fix (a): the block is *removed*, so the wording difference is irrelevant.
- `list.ts`: `type Dirent` import, `isMissingPathError`, `readChangeDirectoryEntries`, readdir swap, EOF newline — verbatim; same rasen-worded throw-block deletion.
- `openspec-root.ts`: comment reword, `inspectOptionalPlanningDirectory`, loop replacement, health-criterion change — verbatim.
- `operations.ts`: `classifyOpenSpecDir`/`storePointerProblem` import, `assertNotConfigOnlyPointerRoot`, both call sites — verbatim.

Test hand-fixes match upstream intent:
- (a) `archive.test.ts`: test renamed to "should report no active changes…" and expectation updated to `"Change 'any-change' not found. No active changes exist in this root."` — identical to upstream (only diff vs upstream is trailing-whitespace cleanup on a blank line, cosmetic).
- (b) `list.test.ts`: "missing changes dir" test converted from `rejects.toThrow(...)` to a no-throw asserting `logOutput === ['No active changes found.']`; new malformed-path test added — both verbatim.
- No upstream-added test silently dropped: store-git (+2), store-root-selection (+2), store.test.ts (+4 new + the `openspec_archive_missing`→`openspec_archive_not_directory` guard rewrite), openspec-root (+2), list (+1 malformed-path) — all present.

### Lens 2 — Behavior semantics
PASS on all three target behaviors, and the deleted `fs.access` guard does **not** worsen error UX.
- (a) Store with planning shape but no `changes/` yet is healthy: `inspection.healthy = present && config.present && diagnostics.length === 0`; a missing planning dir records `{ present: false }` without pushing a diagnostic. Confirmed by `openspec-root.test.ts` "accepts roots before changes… exist" and store.test.ts "registers a team store before any changes exist".
- (b) Config-only pointer rejected: `assertNotConfigOnlyPointerRoot` runs in `prepareSetupPlan` (directory branch) and in `registerExistingStore` before the health check; throws `store_root_pointer_declared` / `invalid_store_pointer`. Confirmed by store.test.ts "refuses to convert a config-only store pointer repo" and "refuses malformed…".
- (c) `archive`/`list` tolerate a missing `changes/`: `listActiveChangeNames` and `readChangeDirectoryEntries` swallow ENOENT and return `[]`, **rethrow non-ENOENT**. No cryptic ENOENT leak — removing the pre-check routes an empty store through the friendly `archive_change_not_found` message ("Change 'x' not found. No active changes exist in this root.", exit 1) or list's "No active changes found." (exit 0). A non-directory `changes` path yields ENOTDIR, which is rethrown (not treated as empty) — confirmed by list.test.ts "should not report a malformed openspec/changes path as empty" and store-root-selection.test.ts "reports no active changes for a selected empty store".

### Lens 3 — Fork-correctness
PASS. No brand regression (added lines brand-neutral; rasen wording only on deleted/renamed lines). No `docs/**` touched. No `project-config.ts` drift — and its existing exports actually satisfy the applied code: `classifyOpenSpecDir` returns `{ hasPlanningShape, pointer }` with `pointer.{filePath,value,malformed}`, and `pointer.malformed` is `'unparseable' | 'non_string'`, exactly the type `storePointerProblem(...)` accepts. Workspace conventions (`openspec/`, `.openspec-store/store.yaml`, `config.yaml`) intact. `git diff --name-only` = exactly the 10 files; grep for `docs/`/`project-config` returns none.

### Lens 4 — Tests
PASS. `node build.js` clean, then `vitest run` on all 6 files: **6 files / 132 tests passed** (~40s). Renamed tests genuinely exercise the new behavior (assert on `logOutput` / the not-found message, not the old init-error throw). No flake observed.

### Lens 5 — Spec deltas
PASS. `store-registration` ADDED (3 requirements: optional planning dirs, reject config-only/malformed pointer, commands tolerate missing changes dir) + `cli-list` MODIFIED (Error Handling). The MODIFIED requirement reproduces the **full** current requirement — it keeps the "Missing tasks.md" scenario and only rewrites the "Missing changes directory" scenario (throw/exit 1 → "No active changes found."/exit 0), honoring the self-consistency rule so the sibling archive-drift fix won't abort archival. Deltas accurately mirror the code. Does **not** claim `cli-archive` (owned by sibling A) — only `cli-list` + `store-registration` deltas exist. `rasen validate` green.

---

## Findings

**[Trivial / informational] Health now hinges on `diagnostics.length === 0`.** The refactor makes root health a pure function of "zero diagnostics" rather than the explicit specs/changes/archive presence conjunction. This is upstream intent (only real problems are diagnostics) and is already flagged in the change's design.md risk section — noting it as the one load-bearing semantic shift a future reader should keep in mind: any new diagnostic pushed during inspection will now flip a root to unhealthy. No action required.

No other findings. This is a clean, faithful cherry-pick.
