## 1. Product delta — `store setup --layout 2`

- [x] 1.1 Add the `--layout <version>` option to `rasen store setup`
  (value-validated: only `2`; anything else refused naming the accepted
  value), plumbing it to the bootstrap writer: `layoutVersion: 2` beside
  `version: 2` in `store.yaml`, no flat planning scaffold created
- [x] 1.2 Locale sync (en/ja/zh-cn option key) + completions registry entry
  for the option; three-way-sync trio diff expected to be exactly the option
  addition
- [x] 1.3 Tests: with `--layout 2` the created store declares v2 and creates
  no flat planning tree; an immediate `add-project` against it passes with
  no `store_layout_mixed_residue`; without the flag, setup output is
  unchanged (legacy declaration absent, flat scaffold as today); invalid
  values refused naming `2`

## 2. The persistent store

- [x] 2.1 `pnpm run build`, then `rasen store setup issue-registry --path
  E:\AI\ChatAI\Agents\VibeCodingProjects\workflow\Reference\rasen-issue-store
  --layout 2` (durable path verified outside every Git repo and outside
  temp); confirm registration + uid; record store.yaml in the receipts
- [x] 2.2 `rasen store add-project E:\...\Reference\OpenSpec-code --to
  issue-registry --as rasen` (the MAIN checkout, never the worktree);
  commit the store-side membership record; coordinate the main-checkout
  hint commit with the operator/LEAD (flagged cross-checkout write)
- [x] 2.3 `rasen store target-line add line-0.2` with `storeRef
  refs/heads/main` and codeRef `refs/heads/dev/0.2.0`; commit on the store

## 3. Seeding the real children (explicit list, shipped helpers)

- [x] 3.1 Author the seeding script under the change's ephemera `research/`:
  mint identities via `derivePlanningScopeId` + `deriveChangeInstanceId`,
  record seed→instanceId mappings; every YAML scalar quoted
- [x] 3.2 Seed `issue-plan-publication` and `issue-node-lifecycle` as
  archive entries (mirror the repo archive dirs + identity-carrying
  `.openspec.yaml` + the repo's `archive.json` as legacy record) under
  `rasen/projects/<projectId>/changes/archive/line-0.2/<dated-entry>/`
- [x] 3.3 Seed `issue-persistent-baseline` as a metadata-only active entry;
  verify exactly one committed copy per instance (no M-1 shape); commit the
  seeding on the store's target-line ref

## 4. Issue #1 — the real loop

- [x] 4.1 `rasen store issue new issue-multi-change-execution --store
  issue-registry --title ...`; publish revision 0001 via
  `--from-portfolio issue-multi-change-execution` with cwd = the worktree
  (real run-state through the resume seam); commit on the store
- [x] 4.2 Publish acceptance conditions (`--from-file`, the portfolio's
  real completion criteria); `rasen store issue show --store issue-registry`
  from the worktree captures the live tri-axis (2/3, dependencies
  respected); commit
<!-- 4.3/4.4 staged for LEAD portfolio close (design D5; apply staged UP TO
     the gate-holds receipt 4-2-tri-axis-gate-holds.json and did NOT accept).
     Ready-to-run commands + capture steps in evidence/4-issue-loop.md. -->
- [ ] 4.3 Drive g-003 to ship/archive (the LEAD's loop); capture the
  projection moving to 3/3 and `review`
- [ ] 4.4 At portfolio close: evaluate the gate (all required nodes
  run-terminal or finalized; per-child run-state visible from the worktree),
  `rasen store issue accept`, confirm the Issue reads resolved and `done`;
  commit the acceptance record on the store

## 5. Receipts, durability, closeout

- [x] 5.1 Receipts under `evidence/`: store bootstrap + store.yaml,
  membership + hint commits (both sides), target line, seeding (script,
  seed→instanceId map, store tree listing), publication 0001, conditions,
  the tri-axis captures, the acceptance; plus the durability statement
  (path, uid, registry entry, how future sessions use it, backup follow-up)
  and the follow-up notes (seeding as product surface; stray `rasen-store`
  retirement)
- [x] 5.2 Focused gates for the product delta (setup tests, bootstrap
  family, three-way-sync trio) + store family; full-suite reds fully
  enumerated and classified against the known machine cluster (CI is the
  authority)
- [x] 5.3 `rasen validate issue-persistent-baseline` green (positional
  form); MODIFIED scenario titles verified byte-stable against the synced
  spec; no `architecture-index` update needed (no module moves; one option
  on an existing command — quick-locate row only if the reviewer disagrees)
