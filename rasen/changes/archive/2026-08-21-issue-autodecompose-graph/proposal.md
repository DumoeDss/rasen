# Proposal: issue-autodecompose-graph

## Why

`auto-decompose` is the one built-in pipeline left fail-closed by the 0.2.0 ECP cutover
(`pipeline show auto-decompose` reports `execution_profile_unavailable`; `pipeline start` is the
reconciler-only door and cannot admit it). The cutover direction reserved exactly this crossing for
0.3.0 under a pinned successor name — `issue-dispatch-0.3.0` (`src/core/pipeline-registry/builtins.ts`)
— because the designed uplift moves decomposition from a Change-pipeline stage into the
Issue/Dispatch layer: the decomposer's output becomes a reviewable, target-project-bound Execution
Plan revision on the Issue, and each child Change keeps its own independent pipeline run. Phase 4 of
the issue-layer roadmap requires exactly that: after a user files an Issue, the system produces a
reviewable execution graph — target project, dependency edges, required/optional, suggested
pipeline, decomposition rationale/uncertainty — as one revisable Dispatch, not a continuous
LLM-decided run. Phase 1–3 already built the carrier: immutable plan revisions, `publishPlan`,
intent nodes, the planning-member target gate, per-node read surface, and `store issue start`. What
is missing is the decomposition output channel onto that carrier.

## What Changes

- **The decomposition channel** — a third plan-publication source: `rasen store issue plan
  <issue-id> --from-decomposition <path>` reads a decomposition document and publishes it as the
  Issue's next Execution Plan revision: one INTENT node per proposed piece of work (each naming its
  target project and line, dependency edges, a suggested pipeline, and decomposition
  rationale and/or uncertainty; an authored `required`/`optional` lifecycle is recorded in the
  document alone — the sole durable record of that proposal, since the plan schema forbids a
  lifecycle on an intent node — and how the confirm flow consumes it is that flow's decision). The
  document is read-only input; existing gates apply unchanged
  (planning-member target rule, DAG/cycle/duplicate checks, immutable ordinal revisions).
- **Plan nodes carry decomposition guidance** — both node kinds gain three optional fields:
  `suggestedPipeline` (validated against the pipeline registry at publication), `rationale`, and
  `uncertainty` (portable durable text). Absent fields are omitted in the canonical form, so every
  revision published before these fields existed re-derives its digest byte-for-byte.
- **The read surface makes a decomposition reviewable** — `store issue show`/`list` node lines carry
  a node's recorded suggested pipeline and rationale/uncertainty in both human and `--json` forms;
  the fields drive no phase/health/progress value (like target project, they are facts to read).
- **The fail-close resolves by the uplift, not by faking support** — the v1 `auto-decompose`
  fixture stays byte-identical with its `issue-dispatch-0.3.0` boundary label; what changes is that
  its reconciler verdict becomes truthful: a v1 definition carrying a decompose stage reports
  `unsupported_pipeline_semantics` (the decompose stage is a Dispatch-domain construct the
  reconciler engine does not execute) instead of the misleading `execution_profile_unavailable`
  that implies a resolvable profile. The fail-closed OUTCOME is unchanged — only the stated reason.
- **The LEAD playbook gains the Issue-dispatch path** — when the dispatch target is a Store Issue,
  the LEAD decomposes into the document, publishes the revision, reports review-ready, and STOPS:
  it does not fan out and does not start children. Human revision and confirm-to-start are g-003's
  flow. The change-level decompose stage's LEAD-self-audit behavior is untouched.
- **Dogfood staging on the persistent store** — the real Issue #3 (this portfolio) walks decompose
  → decomposition document → published revision → review-ready, with receipts; nothing closes
  (close acts only in evidence).

No new auto-routing: target projects in a decomposition are the decomposer's PROPOSAL, gated by the
planning-member rule at publication; choosing and revising targets is human (g-003). No UI, no
version bumps, `packages/ui/**` frozen, `pipelines/*.yaml` byte-identical.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `store-issue-resources`: plan nodes (both kinds) may carry an execution suggestion and
  decomposition rationale/uncertainty — registry-validated pipeline name, portable durable text,
  canonical omission when absent, old revisions' digests unchanged.
- `issue-plan-publication`: a third publication source `--from-decomposition` with intent-only,
  suggestion-complete shape and its own refusals; the exactly-one-source rule covers three sources;
  the publication report carries the decomposition source facts.
- `issue-status-projection`: node lines on the Issue read surface carry the recorded suggestion and
  rationale/uncertainty in both forms, driving no axis.
- `opsx-pipeline-registry`: a v1 definition carrying a decompose stage reports its true boundary —
  `unsupported_pipeline_semantics` from engine-support analysis — while remaining a readable
  compatibility input with its pinned boundary label.
- `session-host-lifecycle`: the acceptance expectation for `auto-decompose` moves from "returns
  `execution_profile_unavailable`" to the same fail-closed refusal under the truthful reason.
- `opsx-auto-command`: the LEAD playbook gains the Issue-dispatch decompose path — decompose,
  publish, report review-ready, stop before execution; distinct from the change-level decompose
  stage the auto command already defines.

## Impact

- Code: `src/core/store/issues/types.ts` + `plans.ts` (node fields, validation, canonical form,
  portable-text checks beside the existing `assertPortableIssueText` seam);
  `src/core/issue-publication/` (the decomposition document schema + publication orchestration
  beside `publishPlanFromPortfolio`); `src/commands/store-issue.ts` (the `--from-decomposition`
  flag, three-way source rule, report facts); `src/core/issue-status/projection.ts` (node-line
  fields); `src/core/pipeline-registry/execution-plan-internal.ts` (ONE analyzer branch: decompose-
  bearing v1 definitions report unsupported semantics; no other registry semantics move);
  `src/core/templates/workflows/auto.ts` + `_orchestration.ts` (the Issue-dispatch playbook branch —
  generated-skill changes follow the hash-pinning and dist-rebuild discipline).
- Tests: plan node schema/digest suites, publication suites (new source + three-way rule),
  projection suites, `test/acceptance/session-cache/pipeline-binding.test.ts` and
  `test/core/change-run/engine-product-surface.test.ts` (pinned reason updates), playbook template
  parity tests.
- Specs: six capabilities synced at archive from this change's deltas.
- Dogfood: persistent-store Issue #3 staging receipts into this change's `evidence/` (LEAD-
  coordinated writes; close acts only in evidence).
- Fences honored: `pipelines/*/pipeline.yaml` untouched; no UI; no version bumps; manual target
  selection only.
