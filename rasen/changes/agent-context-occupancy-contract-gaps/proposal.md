## Why

`rasen agent context` now answers honestly when it cannot measure a session's context window: it withholds the handoff verdict and reports `window: "unknown"` instead of comparing against placeholder zeros. Three consumers of that same occupancy contract were not brought along, so the confusion the fix removed from one surface still exists on the others.

This is filed as a proposal rather than a fix because all three turn on a judgement the repository owner should make, not the reviewer: two of them change a published contract, and the third trades correctness against a rewrite of the function a recent review already found a Blocker in. Each is stated below with the evidence and the alternatives, so the decision can be taken without re-deriving it.

Found during the pre-landing review of `omp-install-target-and-context-probe`; the full evidence, including the reproductions, is in that change's `evidence/review-report.md`. Nothing here is speculative — the two contract gaps were traced to their consumers, and the third is grounded in Oh My Pi's own published session semantics.

## What Changes

### 1. The unmeasurable-window marker reaches only one of two occupancy surfaces

Rasen publishes occupancy twice. `rasen agent context --json` emits the full receipt, and it now carries the marker. `ContextEstimate` — the three-field estimate attached to every worker by `rasen pipeline resume --json` as `workers.<id>.contextEstimate` — does not: it has no `window` field and no way to express "measured occupancy, unknown window", so it emits a bare `pct: 0` and `remainingTokens: 0` for a session whose real occupancy is large.

That surface is not decorative. The orchestration playbook compares it directly (`pct ≤ threshold` → warm reuse) while telling the LEAD that the tell for an unmeasurable window is `"window": "unknown"` plus an omitted `shouldHandoff` — neither of which this surface can emit. A LEAD following the playbook exactly is told to look for a signal the surface never sends.

- Make an unmeasurable window observable on the resume surface as well as the receipt, so a warm-reuse decision is never taken on a placeholder.

### 2. A shipped requirement the code no longer satisfies

`rasen/specs/cli-agent-context/spec.md` requires the command to report "a `shouldHandoff` flag alongside occupancy". The shipped command deliberately OMITS that flag when the window is unmeasurable, and a test pins the omission. No delta spec in the originating change modifies this requirement, so archiving it lands a main spec that the shipped code contradicts.

The same defect class — spec prose broader than the code — was graded Major twice during that change's own verification and repaired there. This instance was missed because it lives in the main spec rather than in a delta.

The new `window` field has the mirror problem: it is part of the published receipt and the playbook instructs consumers to branch on it, but no requirement anywhere names it.

- State the withheld-verdict contract in the requirement that currently contradicts it, and name the `window` field the receipt already emits.
- **BREAKING** for any consumer that reads `shouldHandoff` as always-present. This is already true of the shipped build; the change here is that the contract would finally say so.

### 3. Occupancy is measured in file order, not in context order

An Oh My Pi session journal is an append-only TREE, and the context actually sent to the model is the `parentId` chain from the current leaf — not the file's line order. Two documented markers rewrite what that chain contains: `compaction` replaces the history before it with a summary, and branch navigation moves `leafId` so an abandoned branch's entries stay in the file while contributing nothing.

The reader honours neither. It scans in file order and takes the last measuring row, so a post-compaction probe reports the occupancy of the history the compaction just replaced, and a session whose active branch is not the last-written one reports the abandoned branch's figure. Both over-report, which is the opposite direction from the under-report already fixed, and both are silent.

`reset_boundary` — the `/clear` marker, the third member of this family — is already handled, so the reader is currently correct for one of three epoch markers.

- Measure occupancy over the entries Oh My Pi would actually send, so a compacted or branched session reports the context it really has.

## Capabilities

### New Capabilities

None. All three are corrections to contracts that already exist.

### Modified Capabilities

- `cli-agent-context`: two edits. The handoff-threshold requirement is narrowed to the measurable case and extended to name the withheld verdict and the `window` field the receipt already emits (item 2). A new requirement makes the per-worker occupancy estimate able to express the same unmeasurable state as the receipt (item 1) — placed here rather than in a new capability because no existing spec names `contextEstimate`, and this capability already owns the occupancy contract that both surfaces publish.
- `omp-session-probe`: the occupancy definition, extended from "the last measuring row in file order" to the entries the harness would actually send (item 3). **This capability does not exist in `rasen/specs/` yet** — it arrives when `omp-install-target-and-context-probe` is archived, so this change is sequenced after it.

The delta specs are written for the RECOMMENDED option in each decision below. They are a concrete contract to evaluate, not a settled one: choosing a different option for item 1 or item 3 changes the corresponding delta, and the proposal should be re-read as the source of intent in that case. They deliberately state the observable contract only — none of them names a field name, a data structure, or a traversal strategy, so an implementer stays free on the how.

## Impact

- `src/core/agent-context.ts` — `ContextEstimate`, `tryContextEstimate`, and the Oh My Pi reader's row selection.
- `src/commands/pipeline.ts` — the `resume --json` worker payload that publishes `contextEstimate`.
- `packages/ui/src/api/types.ts` — the hand-maintained wire mirror, if item 1 widens the payload. The repo's mirror-relaxation rule applies: the mirror is widened before the server.
- `src/core/templates/workflows/_orchestration.ts` — the warm-reuse guard's prose, if item 1 is solved by documenting the discriminator instead of widening the shape.
- `rasen/specs/cli-agent-context/spec.md` — the requirement in item 2.
- No dependency changes.

## Decisions for the repository owner

Each item has a cheaper option and a more complete one. They are independent — any mix is coherent.

**Item 1 — widen the payload, or document the discriminator?** Adding `window?: 'unknown'` to `ContextEstimate` makes the resume surface self-describing and matches the receipt, at the cost of a wire-shape change plus its UI mirror. Naming the existing discriminator (`limit === 0` with `contextTokens > 0`) in the playbook instead costs one paragraph and no contract change, but leaves two occupancy surfaces that must be read differently. Recommendation: widen it — the playbook already tells the LEAD to look for `window`, and a second reading rule for the same quantity is how this class of bug recurs.

**Item 2 — narrow the requirement, or restore the flag?** Narrowing matches the shipped, tested, deliberate behaviour. Restoring an always-present `shouldHandoff` would mean choosing a value for the unmeasurable case, and `false` is indistinguishable from a real below-threshold reading, which is the defect the omission exists to prevent. Recommendation: narrow. This one is close to mechanical; it is here only because it edits a shipped contract.

**Item 3 — follow the tree, or document the limitation?** Following `parentId` from the leaf and honouring the latest `compaction` is the correct reading and the one that matches the harness. It is also a rewrite of the selection logic in the function the review already found a Blocker in, so it wants its own tests and its own risk budget. The alternative is to state the limitation and leave it. Weighing this: the failure is silent and over-reports, so it retires sessions early rather than running them past their limit — the safe direction, unlike the under-report that was a Blocker. That argues for doing it properly but not urgently. Note also that neither marker was observed in real journals on the machine where this was investigated (0 occurrences across 23 sessions), so the reachability is documented rather than measured, and a maintainer with different usage may weigh it differently.
