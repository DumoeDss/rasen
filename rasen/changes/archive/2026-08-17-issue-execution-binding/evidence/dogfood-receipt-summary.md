# Dogfood receipt summary — issue-execution-binding (design D9)

Date: 2026-08-17. Machine: win32. CLI: `node bin/rasen.js` from the portfolio
worktree (branch `feat/issue-layer`, tip `a176026f`).

## Which D9 path ran

D9's primary path ("`--execution-worktree` 复用本 worktree") was **refused by
the pair machinery's own validation**, and D9's named fallback ran instead:

- `execution-root-outside-repository` — the worktree
  `…\OpenSpec-code\.claude\worktrees\issue-layer` is INSIDE the execution
  repository's own checkout (`…\OpenSpec-code`), so reuse is refused ("a
  worktree nested in its repository shows up there as untracked content …").
  D9's first fallback (repointing the target-line code ref) does not address
  nesting — the code ref was already `refs/heads/feat/issue-layer` and the
  ref precondition was satisfied. The second fallback applied: **fresh
  execution worktrees E (temp, outside the repository) + real
  `initializeRunState`-born run-state in E** (pending stages; no progression
  signal fabricated).

A second, design-level deviation was required BEFORE that, in Phase B:

- The design Context's premise "this worktree is registered as machine
  project `issue-layer`" was **not true on this machine** (registry holds the
  main checkout under `e2ee72ed-04a1-4395-86aa-7e77d2b83ec7`), and cannot be
  made true: the project registry's worktree-share rule pierces a linked
  worktree to its main checkout, so registering the worktree re-places the
  MAIN checkout's real identity rather than minting `issue-layer`
  (`registerProject` → `resolveRegistrationRoot` pierces; clobbering the real
  registration was out of the question). The dogfood instead used the REAL
  project identity `e2ee72ed-…` as the member project: its registered
  checkout is the main checkout, so the L6 route is live against real machine
  truth. The "cwd is this very worktree" half of the closed loop is carried by
  the workspace-pair route, which by design D4 "needs no machine project
  registry — the index records the root".

## Phase A — rebuild (C1 recipe + traps)

- Store at `%LOCALAPPDATA%\Temp\rasen-issue-layer-dogfood`, uid
  `4aca0cec-3c58-4d4d-8f3d-c40508905700`; store registry entry created.
- Hand-declared `layoutVersion: 2` (the migrate-layout-on-empty-store trap)
  and retired the empty flat `rasen/` tree, one commit; branch renamed
  `master` → `main` (store setup still inits `master`; the target line
  declares `refs/heads/main` — unrenamed, every plan publish fails with
  `store_query_ref_unreadable`, which is exactly how that was found).
- `store add-project . --to issue-layer-dogfood` — membership keyed
  `e2ee72ed-…`; expected config double-write (`rasen/config.yaml` hint +
  `.rasen-store/store.yaml` residue in the worktree) both cleaned at teardown.
- `store target-line add main` with `--code-ref refs/heads/feat/issue-layer`
  (full ref required — a bare branch name is refused).
- Three child changes seeded under `rasen/projects/e2ee72ed-…/changes/` with
  `.openspec.yaml` v2 identity blocks, ALL scalars quoted (the C1 trap),
  committed on the store's `main`.
- `store issue new issue-layer-phase1` + three-node plan `0001`
  (`g-001..g-003`, serial `dependsOn`), committed.

## Phase B — receipt 1: fresh launch through the L6 checkout route

`evidence/dogfood-receipt-1-fresh-launch.json` — from the STORE ROOT,
`store issue start issue-layer-phase1 --store issue-layer-dogfood --json`:

- frontier `g-001`, mode `fresh`, launch `project-checkout`;
- `cwd` = `E:\…\OpenSpec-code` — the member project's REGISTERED checkout,
  resolved through the real `resolveSessionLaunchContext` composition with
  the Store's own membership record vouching (route 2, live);
- `attachedRoots` = the dogfood Store planning root;
- pipeline null ("chosen at launch") — no run-state located yet, honestly.

## Phase C — receipts 2/2b/2c: the workspace-index closed loop

Two pairs bound (both via `store workspace plan --existing-change …
--execution-worktree <temp>` + `apply`, the sanctioned writer):
`issue-status-projection` → E1 `Temp\rasen-dogfood-exec-g001`,
`issue-execution-binding` → E2 `Temp\rasen-dogfood-exec-g002`.
`initializeRunState` (the frozen single-writer seam) seeded real
`auto-run.json` in each E — pending stages, pipeline `small-feature`.

- `evidence/dogfood-receipt-2-show-from-store-root.txt` — from the STORE
  ROOT, `store issue show`: the Issue-level label honestly says `run-state:
  none visible from this directory`, while `g-001` and `g-002` each carry
  `pipeline: small-feature (located by workspace-index)` — run-state located
  through the index entries from a directory that resolves no execution root,
  plus store-side evidence locators on every node.
- `evidence/dogfood-receipt-2b-start-pair-launch.json` — `store issue start`
  (no `--node`): frontier `g-001`, mode `fresh`, launch `workspace-pair`,
  cwd = E1, attached = the pair's planning root, pipeline `small-feature`
  (the D5 fallback: the pipeline the located run-state records), runStatePath
  + `locatedBy: workspace-index`.
- `evidence/dogfood-receipt-2c-start-blocked-refusal.json` —
  `store issue start --node g-002`: honest refusal
  `issue_start_node_not_runnable` naming `g-001` by the observation rule.

**Not proven in this dogfood** (fallback limitation, recorded per D9's
anti-theater rule): the already-running mode with this change's own live
in-flight run-state. The reuse refusal prevents an index entry whose
execution root is this worktree (where the real in-flight
`issue-execution-binding` run-state lives), and progressing a run-state by
hand would fabricate the signal. The mode is proven over real writer bytes by
`test/core/issue-execution/issue-execution-binding.test.ts` (3 units) and
`test/commands/store-issue-start-cli.test.ts` (2 CLI cases over a real
fixture index document + `writeRunState` bytes).

## Phase D — teardown

- `store workspace cleanup` (preview + `--include-untracked --apply-plan`)
  for both pairs: index entries, association files, planning worktrees, and
  both execution worktrees removed by the machinery itself.
- `store remove issue-layer-dogfood --yes` — registry entry removed
  (`removed: true`).
- `git restore rasen/config.yaml` (the membership hint); `.rasen-store/`
  residue in the worktree deleted; all temp trees verified gone.
- Branch footprint verified: `git status` lists exactly the change's own
  files (the new module/tests, the widened seam, locales, command registry,
  and the portfolio's change directories). The main checkout and the
  canvas-ir-compiler worktree were never touched (the two temp execution
  worktrees were created/removed by the pair machinery's own sanctioned
  writer, outside both trees).
- The machine project registry was left as found (the worktree-share rule
  made the `issue-layer` registration impossible without clobbering; nothing
  was written to it).
