## 1. Start refusals name project and state

- [x] 1.1 In `src/core/issue-execution/binding.ts`, compose the `--node`
  fresh-launch blocker refusal from the projection facts the resolver already
  holds: each non-terminal dependency renders `<nodeId>@<project> (<state>)`,
  a `not-started` dependency with `locatedBy === null` renders `not-started,
  no local run-state`, and an `unknown` dependency renders `unknown
  (<diagnostic>)`; the refusal taxonomy and the work-complete/isRunnable
  rules stay byte-identical in behavior
- [x] 1.2 Apply the same enrichment to the derived-frontier "no node is
  runnable" explanation (`awaits …` reasons), keeping every candidate and
  lifecycle reason shape unchanged
- [x] 1.3 Update `refusalFix` only if the completion guidance needs the
  cross-project phrasing (name the member project whose work must finish);
  no new refusal code, no CLI envelope change (message carries the facts
  both forms print)

## 2. Projection dependency facts on the work-complete basis

- [x] 2.1 Widen `IssueNodeStatus.blockedBy` in
  `src/core/issue-status/types.ts` to a structured entry
  (`{ nodeId, projectId, observation }`) with the basis documented at the
  field (work-complete, the rule `start` enforces — NOT the plan read's
  archive-based list)
- [x] 2.2 In `projection.ts`, derive the entries in a post-pass over the
  built node statuses: filter each node's `dependsOn` by the dependency's
  observation (`workComplete` false ⇒ listed), carrying the dependency's
  `projectId` and observation; the store query's own
  `blockedBy`/`readiness` stays archive-based and untouched
- [x] 2.3 Render the enriched segment in `renderStatusNode`
  (`src/commands/store-issue.ts`): `(blockedBy y@elftia: in-flight, …)` —
  same position as today's segment, structured entries; confirm `--json`
  carries the structured array; no new command/option/locale key/completion
  entry (three-way sync N/A — note in the PR description)

## 3. Tests — cross-project gate, naming, degradation

- [x] 3.1 Binding tests (extend `test/core/issue-execution/`): cross-project
  dependency in-flight → `--node` refusal names node + project + observation;
  cross-project dependency run-terminal but NOT archived → downstream launch
  contract emitted (release on work); unknown/unresolved dependency → gates
  and is named with project + diagnostic; not-started dependency with no
  located run-state → named `no local run-state`; frontier explanation
  carries the same enrichment
- [x] 3.2 Projection tests (extend `test/core/issue-status/`): structured
  blocker entries with project + observation on the work-complete basis;
  a run-terminal-but-unarchived dependency absent from the downstream's
  blocker list while its own line still reports run-terminal; intent-node
  dependency named with its project and not-started observation
- [x] 3.3 CLI tests (`store-issue-status`/`store-issue-start` suites, dist
  built first): show node line renders the enriched `(blockedBy …)` segment;
  start refusal message names project + state in human and `--json` forms;
  update existing bare-id render assertions in the same commit
- [x] 3.4 Degradation suite: a Phase-2-era revision (single project, serial
  chain) reads with identical phase/health/progress before/after the change
  and its digest verifies; a two-project revision's axes equal the
  single-project derivation rules (dependency facts drive no axis)
- [x] 3.5 Store-family regression: `store` query suites
  (`identity*.test.ts`, aggregate-query suites) green untouched — proving the
  archive-based readiness basis did not move

## 4. Dogfood and evidence

- [x] 4.1 Temp-store dogfood (script under the change's ephemera `research/`):
  layout-2 temp store with two planning members, a multi-project plan with a
  cross-project edge (downstream in member A depending on upstream in member
  B); while B's upstream is in-flight, `store issue start --node <downstream>`
  refuses naming `upstream@<B> (in-flight)`; `store issue show` displays the
  cross-project blocker with project and state; capture receipts under
  `evidence/`
- [x] 4.2 Drive B's upstream run-state to terminal WITHOUT archiving; re-run
  start on the downstream → launch contract emitted for member A's checkout
  (release on work, not archive); show no longer lists the dependency as a
  blocker while the upstream's own line still reports run-terminal; capture
  receipts; clean up the temp store completely (double-clear per the trap
  list)
- [x] 4.3 Degradation receipt on the same temp store: publish a
  Phase-2-shaped single-project serial revision, read before/after — axes
  identical, digest verified; persistent `issue-registry` store untouched
  (Issue #2 stays g-003's)

## 5. Verification and closeout

- [x] 5.1 `pnpm run build` first (CLI tests run dist), then focused suites:
  binding, projection, store-issue CLI suites, `commander-presentation`
  (locale structure unchanged — prove no drift), completions registry
- [x] 5.2 Affected + store-family set green with the failure list fully
  enumerated if anything reds (CI is the authority; compare against the known
  machine-state cluster before attributing); full-suite gate at portfolio
  level per the 08-17 adjudication
- [x] 5.3 Update the `architecture-index` skill: quick-locate row adjustment
  for the enriched blocker naming/display, module note in the
  spec-store-engine detail (no new top-level module)
- [x] 5.4 `rasen validate issue-cross-project-gating` green (positional
  form); delta scenario titles stable for archive; planner findings appended
  to the portfolio planning context (dated g-002)
