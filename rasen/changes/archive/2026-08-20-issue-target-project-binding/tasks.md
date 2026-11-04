## 1. Membership gate at the shared publication verifier

- [x] 1.1 Extend `IssueReferenceCatalogs` in
  `src/core/store/issues/reference-verification.ts` to carry each project's
  planning-role fact (keep `projectIds` derived from it), and add the
  planning-member gate beside the existing project-catalog check: a node whose
  `projectId` is recorded with `planning: false` is refused with the new
  `issue_reference_target_not_planning_member` code, naming the node, the
  project, its recorded roles, the Store's planning members, and the
  `rasen store add-project` repair; intent nodes pass the same gate
- [x] 1.2 Add `issue_reference_target_not_planning_member` to the closed
  `StoreIssueErrorCode` taxonomy in `src/core/store/issues/types.ts` with the
  one-taxonomy comment extended to say why role-failure and record-absence are
  distinct conditions
- [x] 1.3 Update the two verifier callers: `module.ts` `verifyReferences`
  passes role facts from the parsed `listProjectEntries` catalogs (both CLI
  publication sources inherit the gate through `publishPlan` — no
  `issue-publication` code change for the gate);
  `layout-migration/plan.ts` passes its frozen member set as
  planning-eligible so the migration replay stays exactly as permissive as
  today
- [x] 1.4 Pin the one-Change-one-primary-project rule: add a test that two
  nodes naming one `changeInstanceId` in one revision are refused by the graph
  checker (rule exists in `checkExecutionPlanGraph`; this gives it spec
  backing), and a re-publication test that retargeting a node's `projectId`
  mints a new revision with the earlier revision's bytes unchanged

## 2. Read surface — per-node target project

- [x] 2.1 Add `projectId` and `targetLineId` to `IssueNodeStatus` in
  `src/core/issue-status/types.ts` and populate them in `projection.ts` from
  the revision node the projection already holds (no defaulting — every node
  carries both; the one projection-seam widening)
- [x] 2.2 Render the target project on the show node line in
  `renderStatusNode` (`src/commands/store-issue.ts`) beside kind/alias, and
  confirm the `--json` form carries the new fields; `list` stays untouched
  (grouping is g-003); no new command/option/locale key/completion entry —
  note the three-way-sync N/A in the PR description

## 3. Tests — gate, degradation, goldens

- [x] 3.1 Verifier unit tests: knowledge-only target refused (change node and
  intent node separately), unknown project still refused under the existing
  code, refusal message names roles + planning members + repair, planning
  member in a second project accepted
- [x] 3.2 Both publication sources through the CLI-level/module-level suites:
  `--from-file` with a knowledge-only target node refused; `--from-portfolio`
  with a child resolving into a knowledge-only member's committed Change
  refused naming child + roles; a portfolio spanning two planning members
  publishes with per-node projects (extend
  `test/core/issue-publication/*` and `test/commands/store-issue-*`;
  knowledge-only fixture member added to the temp-store fixture setup)
- [x] 3.3 Degradation suite: hand-craft a Phase-2-era revision file (bytes as
  Phase 2 wrote them, digest by the unchanged formula) naming a target whose
  roles are knowledge-only; assert it reads back with digest verified,
  identical phase/health/progress derivation, and membership never re-checked
  on read; plus the persistent-store-shaped case (roles flipped after
  publication) reads unchanged
- [x] 3.4 Golden serialization pin: publishing the same node inputs produces
  byte-identical revision YAML before/after this change (no schema field
  added — assert exact bytes at the serialization landing site, not
  round-trip equality)
- [x] 3.5 Migration replay regression: a layout-migration test whose member
  roles are knowledge-only with an existing plan still migrates (the frozen
  member set remains eligible)

## 4. Dogfood and evidence

- [x] 4.1 Temp-store dogfood (script under the change's ephemera `research/`):
  layout-2 temp store with two planning members carrying committed Changes, a
  knowledge-only third member, and a portfolio run-state naming children in
  both planning members; publish a multi-project revision via `--from-file`
  and via `--from-portfolio`; capture receipts under
  `evidence/` (multi-project publications, per-node projects visible in
  `store issue show`)
- [x] 4.2 Refusal receipts on the same temp store: knowledge-only target and
  unknown project refusals on both sources, with the repair text visible;
  clean up the temp store completely (double-clear registry/config residue per
  the trap list)
- [x] 4.3 Persistent-store READ-ONLY receipts on `issue-registry`
  (no writes of any kind): `store issue show issue-multi-change-execution`
  human + `--json` — axes unchanged, node lines now name the project, and the
  revision file's sha256 identical before/after the read

## 5. Verification and closeout

- [x] 5.1 `pnpm run build` first (CLI tests run dist), then focused suites:
  new verifier/projection tests, `store-issue-*` CLI suites,
  `commander-presentation` (locale structure unchanged — prove no drift),
  completions registry, layout-migration suites
- [x] 5.2 Affected + store-family set green with the failure list fully
  enumerated if anything reds (CI is the authority; compare against the known
  machine-state cluster before attributing); full-suite gate at portfolio
  level per the 08-17 adjudication
- [x] 5.3 Update the `architecture-index` skill: quick-locate row adjustment
  for the target-project gate + per-node project display, module note in the
  spec-store-engine detail (no new top-level module)
- [x] 5.4 `rasen validate issue-target-project-binding` green (positional
  form); delta scenario titles stable for archive; degradation receipts and
  the g-003 prerequisite (widen `issue-registry` roles; add `rasen-site`)
  recorded in the portfolio planning context
