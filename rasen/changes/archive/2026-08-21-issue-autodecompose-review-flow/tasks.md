# Tasks: issue-autodecompose-review-flow

## 1. Intent-node lifecycle + authored-input strictness

- [x] 1.1 `src/core/store/issues/types.ts` + `plans.ts`: intent nodes admit `lifecycle:
  'required' | 'optional'` (input + stored + intent schema); absent omitted canonically (old
  revisions byte-stable, pinned test); `cancelled`/`superseded` on an intent node refused naming
  the kind and directing to omission-from-next-revision; the lifecycle-value refusal names the
  values defined for the node's kind.
- [x] 1.2 `planNodeCandidate` extra-keys check: an authored field outside the known per-kind set
  is refused BY NAME (node + field) on both consumers — the throwing `parsePlanNode` path and
  the reporting `findPlanNodeSchemaProblems` path (design D3). Test: a misspelled suggestion key
  is refused, never silently dropped.
- [x] 1.3 `src/core/issue-publication/`: the decomposition compilation carries the authored
  lifecycle ONTO the intent node; the document stays byte-identical (existing test unchanged);
  g-002's sole-record wording is superseded by this change's delta.

## 2. Suggestion-aware launch contracts

- [x] 2.1 `src/core/issue-execution/binding.ts`: the fresh-node pipeline chain becomes
  `--pipeline` > run-state recording > node `suggestedPipeline`; the contract names the source
  of its pipeline; the already-running chain and its disagreement refusal are byte-unchanged;
  an explicit flag over a suggestion does not refuse. Tests pin all three fresh sources and the
  unchanged running behavior.

## 3. The confirm verb

- [x] 3.1 `src/commands/store-issue.ts` + the binding module: `rasen store issue confirm
  <issue-id> [--revision <id>]` — resolve revision (default latest readable; toward-planning
  refusal for none); verify every Change node's instance against committed Store evidence; compose
  per-node launch contracts for the launchable frontier (same resolution as start); report intent
  nodes as pending Change creation (target, line, suggestion); refuse defects by name; write
  nothing (byte-identical receipt test); human + `--json` parity.

## 4. Read surface: intent lifecycle + revision delta

- [x] 4.1 `src/core/issue-status/projection.ts`: node lines name a non-required lifecycle
  whatever the node's kind; an optional intent node counts in no progress pair (either part);
  `show` derives the node-level delta of the latest revision vs its `supersedes` predecessor —
  added / removed / retargeted / re-edged / lifecycle-changed / suggestion-changed — persisted
  nowhere, driving no axis, first revisions report no delta; both forms agree. Tests: the
  three-node predecessor fixture (removed/retargeted/re-edged + added), axes-unchanged, and
  JSON parity.

## 5. Playbook continuation

- [x] 5.1 `src/core/templates/workflows/auto.ts` + `_orchestration.ts`: the Issue-dispatch
  branch's post-confirmation continuation — after `rasen store issue confirm`, the LEAD drives
  each launchable node through its `store issue start` contract, frontier-gated, never outside
  the confirmed revision's wanted work; a revision published after confirmation is confirmed in
  turn before its new work starts. Template discipline: skill hash pins, parity tests, dist
  rebuild.

## 6. Dogfood: Issue issue-autodecompose-uplift, review → revise → confirm (persistent store, LEAD-coordinated)

- [x] 6.1 Review revision 0002 on the persistent store; author revision 0003 through the
  existing publication channels exercising the revision vocabulary: bind the landed g-002 child
  as a Change node from its archived committed instance, lifecycle-mark the remaining intent
  node, adjust one edge — capture the delta report receipt showing exactly those changes.
  Evidence: `evidence/dogfood-staged-starts.md` §1–3 (seed store commit 8c65d14, fresh v2
  identity `ci_96db06e1…`; authored `evidence/issue-3-revision-0003-nodes.yaml`; publish receipt
  `evidence/dogfood-issue3-publish-human-0003.txt`; delta receipts
  `evidence/dogfood-issue3-show-human-0003.txt` + `-json-0003.json` — exactly one edge change
  (review-flow −graph), kind flip on the node lines, no lifecycle-changed line by canonical
  omission, LEAD's explicit-`required` decision recorded in the note).
- [x] 6.2 Run `store issue confirm` over revision 0003; capture the launch-contract set (with
  the suggestion-sourced pipeline named) and the pending-Change report for the intent node.
  Stage — document, do NOT execute — the actual pipeline starts for the launchable node(s) in
  the receipt note (they are this portfolio's own children). Close/accept actions appear only
  in evidence, never as tasks.
  Evidence: `evidence/dogfood-issue3-confirm-store-root.txt` + `-.json` + `evidence/dogfood-issue3-confirm-worktree.txt`
  (dual-root; both compose the graph node fresh with `pipeline: small-feature (from the plan's
  suggestion)` / `pipelineSource: "suggestion"` and report the review-flow intent as pending
  Change creation with `lifecycle: required`; the worktree-side in-flight read the plan
  anticipated did not materialize — no run-state file exists for the alias, and the legacy seed
  record carries no v2 outcome; surfaced honestly in `evidence/dogfood-staged-starts.md` §4–5,
  where the staged start is documented and deliberately not executed).

## 7. Validation

- [x] 7.1 Focused suites green locally (issues plans schema/digest, publication, binding, projection,
  store-issue CLI, template parity), then the full local suite with every failure enumerated
  honestly; CI (including the Windows leg) is the authoritative gate.
  Evidence: `evidence/local-gates.md` — build exit 0 (dist rebuilt); focused sets all exit 0
  (plans schema/digest 45, publication 30, binding+confirm 53, projection 61, CLI+parity with one
  ambient timeout disproven by a solo rerun); store family sharded ×3 exit 0 (1505 passed /
  2 pre-existing skips); full local suite attempted single-process and died incomplete at ~60 min
  (no summary; box 5-10x slow on CLI tests) — the partial log's 45 failures across 15 files fully
  enumerated and classified: 23 documented machine-state cluster, 6 ambient timeouts, 15 under-load
  casualties each disproven by solo rerun the same night (pipeline 107/107, ECP-5 pair 16/16,
  journey 1/1, start/status CLI green), 0 attributable to this change.
- [x] 7.2 `rasen validate` the change; confirm every delta requirement header matches its
  `rasen/specs/<capability>/spec.md` title exactly and existing scenario titles are unchanged
  (validate does not apply deltas; archive-time sync is the closure proof).
  Evidence: `evidence/validate.txt` (exit 0). Header audit: all six MODIFIED requirement headers
  byte-match their main-spec titles (issue-execution-binding ×1, issue-plan-publication ×1,
  issue-status-projection ×1, opsx-auto-command ×1, store-issue-resources ×2); every requirement
  block's first line carries SHALL (incl. the ADDED confirm requirement); scenario-title
  comparison shows only additions (11→13, 5→6, 13→16, 3→4, 6→8, 3→4), zero renames or
  deletions of existing scenarios.
