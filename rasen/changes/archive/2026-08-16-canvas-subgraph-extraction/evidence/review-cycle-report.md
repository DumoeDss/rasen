# Review-cycle report — canvas-subgraph-extraction

## Round 1 (m1 fix re-review)

- Re-reviewer: reviewer-1 (author of the round-0 findings; fixer is impl-3 — non-author status holds).
  Dispatched report-only: no fixes, no commits, no subagents, no working-tree edits.
- Scope per dispatch: the m1 delta only. Round-0 full findings live in `review-report.md`
  (0 Blocker / 0 Major / 2 Minor / 1 Trivial); m2 and t1 were out of this round's instructions
  and are untouched, recorded there as accepted-known.

### m1 — duplicate React keys when two refusal strings are byte-identical: RESOLVED

- Fix verified in the working tree: the refusal list now keys by INDEX
  (`packages/ui/src/canvas/V2SelectionPanel.tsx:88`, `key={index}`) with a comment naming the
  exact duplicate-string shape (two consultation bindings on one stage) that rules a string key
  out. Keys are unique by construction — the duplicate-key defect class (Preact warning;
  possible dropped line under keyed reconciliation) is removed. Blast radius: the map callback's
  key expression and its comment; nothing else in the panel changed.
- Pinning test verified: `pipeline-canvas-page.test.tsx:5537` "renders byte-identical refusals
  as distinct lines with index keys (review m1)" — two consultation bindings on `work-c` produce
  two byte-identical refusal strings and the test asserts BOTH lines render (length 2, identical
  texts), then churns the list `[x, x]` → `[kind-refusal, x, x]` → `[x, x]` by augmenting the
  finish node in and out, asserting exact line counts and texts at every step — i.e. it pins the
  user-visible no-dropped-line contract through the keyed-reconciliation churn where a broken
  diff would drop a line.
- **Test-limitation note judged ACCEPTABLE.** The fixer honestly recorded that reverting the key
  to the string form does NOT fail this test (they ran the mutated code green, then restored):
  Preact tolerates duplicate keys on this path and keys never reach the DOM, so no DOM-level
  assertion can discriminate the key form. I agree with that analysis: the DOM-observable half
  of m1 (dropped lines) is pinned; the non-observable half (the warning / future strictness) is
  removed by construction. A stronger seam (asserting the vnode `key` prop, e.g. via a
  jsx-runtime/h spy) would be new test infrastructure for a Trivial-grade residual — not
  required; index keys on a pure-text list are a complete fix.
- Gate: focused file re-run by this reviewer — `test/canvas/pipeline-canvas-page.test.tsx`
  **99/99 passed, exit 0** (98 round-0 tests + 1 new). Full-suite 67 files / 795 tests exit 0
  already run on this exact tree state by implementer and fixer; not re-run per dispatch.

### Overall round-1 verdict: CLEAN

m1 resolved with a correct one-line fix plus a contract-pinning test; nothing new introduced in
the delta's blast radius. Remaining round-0 records (m2 cross-child box-select observation,
t1 trivial coverage note) stay as accepted-known in `review-report.md`. Ready for ship.
