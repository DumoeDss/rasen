# Fix round 1 — canvas-subgraph-extraction (reviewer-1 findings)

## m1 — duplicate React keys when two refusal strings are byte-identical

- **What**: `subgraphExtractionRefusals` emits one refusal per consultation
  binding without naming the binding, so two bindings on the same selected
  stage produce byte-identical strings — and `V2SelectionPanel` keyed the
  refusal list by the string (`key={refusal}`), i.e. duplicate keys.
- **Where**: `packages/ui/src/canvas/V2SelectionPanel.tsx:88` — the refusal
  list now keys by **index** (`key={index}`), with a comment naming the
  duplicate-string shape that rules the string key out.
- **Pinning test**: `pipeline-canvas-page.test.tsx`, "renders byte-identical
  refusals as distinct lines with index keys (review m1)" — two consultation
  bindings on the same stage, both lines rendered, then the list churned
  [x, x] → [kind-refusal, x, x] → [x, x] by augmenting the finish node in and
  out, asserting the exact line count and text at every step.
- **Mutation honesty**: reverting the key to the string form does NOT fail
  the test — verified by running it against the mutated code (green), then
  restoring the fix. Preact's keyed diff tolerates duplicate keys on this
  path and keys never reach the DOM, so no DOM-level assertion can
  discriminate; the test pins the user-visible contract (no dropped refusal
  line, exact counts across keyed reconciliation), while the fix itself
  removes the duplicate-key defect per the reviewer's direction (the React
  warning class, and any future Preact strictness).

Counts: focused file 99/99; full suite (CI-canonical
`pnpm --dir packages/ui exec vitest run`, run 2026-08-17 after the fix):
**67 files / 795 tests, exit 0** — 794 + this round's 1 new test.

## Result

- m1: FIXED as above. m2 (box-select under-selection, cross-child driver
  observation) and t1: not in this round's instructions — untouched.
