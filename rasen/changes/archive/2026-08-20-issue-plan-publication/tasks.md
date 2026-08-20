## 1. Core module — compiler and child resolution

- [x] 1.1 Create `src/core/issue-publication/types.ts`: inputs (`issueId`,
  `parent`, store selector, startPath), the refusal taxonomy types, and the
  result shape (the `publishPlan` result plus a `source` block carrying kind,
  parent, located run-state path, child count)
- [x] 1.2 Implement `compiler.ts`: pure portfolio-state → plan-node-inputs
  compile — one change node per child (`nodeId` = child id, `changeAlias` =
  child id, `dependsOn` carried verbatim), no status/pipeline/delivery fields
- [x] 1.3 Implement `resolution.ts`: child-name → committed-instance
  resolution over `gatherReferenceEvidence`, with the named refusals
  (`issue_reference_unresolved` / `_uncommitted` / `_ambiguous` /
  `_foreign_store`, `store_query_ref_unreadable`); archived committed
  Changes count as evidence
- [x] 1.4 Unit tests for compiler + resolution (happy path, missing child,
  worktree-only child, ambiguous same-name children across projects, foreign
  store, unsearched ref), using `createStoreWorkspaceFixture` temp stores and
  `path.join` for every expected path

## 2. Core module — orchestration

- [x] 2.1 Implement `orchestration.ts`: resolve the planning root from the
  working directory, locate the portfolio through the resume seam
  (`resolvePortfolioStateLocation` with ephemera/work-dir options),
  strict-read via `readPortfolioStateDetailed`, enforce parent-name agreement
  and non-empty children, compile, resolve every child, then hand the node
  inputs to `StoreIssues.publishPlan`
- [x] 2.2 Refusals wired and named: `issue_plan_portfolio_root_unresolvable`,
  `issue_plan_portfolio_absent` (locations searched listed),
  `issue_plan_portfolio_invalid`, `issue_plan_portfolio_parent_mismatch`,
  `issue_plan_portfolio_children_empty`
- [x] 2.3 Orchestration tests: absent vs invalid vs mismatch vs empty;
  successful publication mints revision `0001`; re-publish after a child
  status transition mints `0002` with `0001` bytes unchanged; the portfolio
  run-state file is byte-identical across publication; nothing staged

## 3. CLI surface

- [x] 3.1 Extend `rasen store issue plan` in `src/commands/store-issue.ts`
  with `--from-portfolio <parent>`: source exclusivity
  (`issue_plan_source_conflict` / `issue_plan_source_required` replacing
  `issue_plan_from_file_required`), delegation to the orchestration, and the
  `source` block in the `--json` payload plus the matching human line
- [x] 3.2 Locale sync: add the `from-portfolio` option description key for
  the `plan` command in `src/locales/en.json`, `ja.json`, `zh-cn.json`
- [x] 3.3 Completions: add `from-portfolio` (takesValue) to the `plan` flags
  in `src/core/completions/command-registry.ts`
- [x] 3.4 CLI tests (`store-issue-cli.test.ts` or a sibling suite):
  `--from-portfolio` happy path against a seeded temp store with a
  portfolio-shaped run-state; both-sources and no-source refusals; absent and
  invalid run-state refusals; human/JSON parity of the source facts; commit
  suggestion printed and Git index untouched

## 4. Dogfood and evidence

- [x] 4.1 Build a dogfood script under the change's ephemera `research/`
  area: temp store (`store setup` + rename main + `layoutVersion: 2` +
  `add-project` per the trap list), seed two committed children with distinct
  instance identities, author a real portfolio-shaped `portfolio-run.json`
  (parent + children + `dependsOn` edge), create an Issue, publish revision
  `0001` via `--from-portfolio`
- [x] 4.2 Flip one child's status to `done` in the run-state, re-publish,
  confirm revision `0002` appended and `0001` bytes unchanged; capture
  command transcripts and outputs as receipts under
  `rasen/changes/issue-plan-publication/evidence/`
- [x] 4.3 Clean up the temp store completely (OS temp dir removal; no
  registry/config residue — double-clear per the trap list)

## 5. Verification and closeout

- [x] 5.1 `pnpm run build` (CLI tests run dist), then focused suites: the new
  unit tests, `store-issue-cli`, `commander-presentation` locale structure,
  completions registry
- [x] 5.2 Full `pnpm test` locally with the failure list fully enumerated if
  anything reds (CI is the authority; compare against the known
  machine-state cluster before attributing) — affected+store-family set green
  (22 files / 240 tests, exit 0, /tmp/affected-set.log 2026-08-20 09:16); full-suite gate deferred to portfolio delivery (LEAD runs once with 2026-08-17 known-cluster adjudication)
- [x] 5.3 Update the `architecture-index` skill: quick-locate row for
  portfolio→plan publication, module note in the spec-store-engine detail
- [x] 5.4 `rasen validate --change issue-plan-publication` green; spec delta
  scenario titles stable for archive
