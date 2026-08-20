## 1. Projection — per-project lanes

- [x] 1.1 Add `IssueProjectLane` (`projectId`, `alias: string | null`,
  `nodeIds`, `progress`) and `IssueStatus.projects` in
  `src/core/issue-status/types.ts`; resolve the `projectId` field comment's
  "later capability" pointer to this derivation
- [x] 1.2 Derive lanes in `projection.ts` as a post-pass over the built node
  statuses: one lane per distinct node `projectId`, `nodeIds` in the
  revision's canonical node order, lane order by project identity
  code-point; no lanes when the revision does not read back
- [x] 1.3 Compute each lane's progress with the projection's EXISTING
  completion predicate scoped to the lane's `required` change nodes — share
  the function, never restate the rule; zero required nodes reports `0/0`;
  optional/cancelled/superseded and intent nodes count nowhere but list in
  the lane

## 2. CLI — lanes and per-project summary

- [x] 2.1 Extend `resolveStoreWideningContext` in `src/commands/store-issue.ts`
  to read the Store's project catalogs (`listProjectEntries` over the
  resolved store root) and supply `projectId -> display alias` as a
  projection input; null/fallback to the raw id, never a guess
- [x] 2.2 Render lanes in `renderIssueDetail`: one header per project
  (`project <alias|id> (<id>): <completed>/<total>`) followed by that
  project's existing node lines unchanged; render the per-project summary
  beside the Issue-level pair in `renderIssueList` (same lane order,
  omitted when no lanes derive); confirm `--json` carries
  `status.projects` beside the untouched `nodes` — no new
  command/option/locale key/completion entry (three-way sync N/A; note in
  the PR description)

## 3. Tests — derivation, rendering, degradation

- [x] 3.1 Projection tests (extend `test/core/issue-status/`): two-project
  revision derives two lanes with per-lane pairs summing to the Issue pair
  over required nodes; single-project revision derives one lane equal to
  the Issue pair; work-complete basis per lane (terminal-but-unarchived
  counts, in-flight does not); optional/cancelled listed but uncounted;
  unreadable revision reports no lanes; lanes drive no axis (axes identical
  with and without lane derivation)
- [x] 3.2 CLI tests (`store-issue-status` suite, dist built first): `show`
  renders lane headers over unchanged node lines; `list` renders the
  per-project summary; human/JSON parity on the same lane facts; alias
  fallback to the raw id when no catalog resolves
- [x] 3.3 Degradation suite: a Phase-2-era single-project revision reads
  with identical phase/health/progress and exactly one lane; existing
  render-asserting suites updated in this commit

## 4. Dogfood — Issue #2 on the persistent store

- [x] 4.1 Store prerequisites (real, durable mutations, committed):
  re-run `rasen store add-project <rasen-repo> --to issue-registry` to
  OR-widen the rasen member to planning; add `rasen-site` as a member
  (its workspace carries `projectId 6ca78b98-…`); extend `line-0.2`'s
  `projects` map with the site's `refs/heads/main`; capture receipts under
  `evidence/`
- [x] 4.2 Author the site node's real change in the Store's site partition
  (`rasen new change document-multi-project-issues --project 6ca78b98-…`
  from the store-scoped planning root): a `docs/` page in `rasen-site`
  documenting multi-project Issue execution; run its propose flow
  (small-feature) and commit the change metadata to the store's main
  (committed-优先)
- [x] 4.3 Verify the store's rasen partition carries committed evidence for
  `issue-target-project-binding` and `issue-cross-project-gating`
  (portfolio ship bookkeeping; any gap surfaces as a named publication
  refusal — record and resolve, do not force)
- [x] 4.4 Create `issue-cross-project-execution` on the persistent store
  and publish plan revision `0001` via `--from-file`: the two shipped
  children as rasen change nodes, `issue-project-grouped-views` as a rasen
  INTENT node, `document-multi-project-issues` as a site change node with
  `dependsOn: [issue-project-grouped-views]`
- [x] 4.5 Drive the read loop and capture receipts: multi-lane `show`
  (rasen `2/2`, site `0/1`), `list` per-project summary, the cross-project
  gating refusal (`start --node document-multi-project-issues` naming the
  intent node@rasen `not-started`), and the degradation receipt on Issue #1
  (single lane, axes identical to the g-001 persistent receipts)
- [x] 4.6 Write the staged-close document under `evidence/` (the Phase-2
  close precedent): revision `0002` promoting the intent node to a change
  node once this change's store bookkeeping commits; the released site
  node's real pipeline run from the site's checkout to terminal; the
  acceptance gate-holds receipt; the exact `acceptance --from-file` +
  `accept` steps for the portfolio close — execution sequenced at portfolio
  close, never as engine task checkboxes

## 5. Verification and closeout

- [x] 5.1 `pnpm run build` first (CLI tests run dist), then focused suites:
  projection, store-issue CLI suites, `commander-presentation` (locale
  structure unchanged — prove no drift), completions registry
- [x] 5.2 Affected + store-family set green with the failure list fully
  enumerated if anything reds (CI is the authority; compare against the
  known machine-state cluster before attributing); full-suite gate at
  portfolio level per the 08-17 adjudication
- [x] 5.3 Update the `architecture-index` skill: quick-locate row for
  per-project lanes/grouped views, module note in the spec-store-engine
  detail (no new top-level module)
- [x] 5.4 `rasen validate issue-project-grouped-views` green (positional
  form); delta scenario titles stable for archive; final Phase-3 planner
  findings appended to the portfolio planning context (dated g-003)
