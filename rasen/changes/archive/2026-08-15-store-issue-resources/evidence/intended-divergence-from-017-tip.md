# Task 8.4 — intended divergence from `origin/dev/0.1.7`, confirmed against the actual diff

## Method

`git diff origin/dev/0.1.7 -- src/core/store/issues/` and the same for `query/`, read in
full, every hunk attributed to either (a) the deliberate `f4a48a36` exclusion (design.md
Context, "Attribution: a third distinct answer") or (b) something else.

Note on this document itself: an earlier draft of this file embedded literal
backslash-escape sequences for control characters inline in prose text, and the write
pipeline silently converted several of them into the raw control bytes they described —
the exact corruption class this change's own `evidence/nul-byte-corruption-and-detection.md`
documents. Rewritten below describing control-character ranges in words instead of
backslash-escape syntax, to avoid reintroducing that corruption in this file.

## `src/core/store/issues/` — non-empty by design

```
src/core/store/issues/index.ts                  |  10 --
src/core/store/issues/locks.ts                  |  70 +-------
src/core/store/issues/migration-compiler.ts     | 110 -------------
src/core/store/issues/module.ts                 | 205 ++++++++++++++++--------
src/core/store/issues/records.ts                |   2 +-
src/core/store/issues/reference-verification.ts | 156 ------------------
6 files changed, 147 insertions(+), 406 deletions(-)
```

All six files fall entirely under the known exclusion:

- `migration-compiler.ts` (110 lines removed, whole file) and `reference-verification.ts`
  (156 lines removed, whole file) — the two `f4a48a36` additions this child never ports at
  all.
- `locks.ts` (70 net lines removed) — the batch-locking surface (`withIssueLockBatch`,
  `issueLockCanonicalBytes`, `heldIssueLockKeys`, the `onAcquired` seam) `f4a48a36` added,
  absent here by design.
- `index.ts` (10 lines removed) — the barrel's export list shrinks by exactly the two
  exclusions above: the migration-compiler re-export block and the four batch-locking
  names.
- `module.ts` (net growth to the 520-line squash size vs the tip's 441-line extracted
  size) — this IS the named departure from design.md's Context section: reference
  verification stays inline here rather than being extracted to
  `reference-verification.ts` and extended for the coordinator bridge. Confirmed this is
  the ONLY reason for the size difference by reading the diff: no hunk touches
  Issue-mutation, plan, or lock behavior — every hunk is the extraction boundary.
- `records.ts` (2 lines) — **not** an `f4a48a36` divergence. `CONTROL_PATTERN` is a
  character-class regex naming the C0 control range (the null character through unit
  separator, codepoints 0 through 31) plus DEL (codepoint 127). The tip and this branch
  spell that same 33-codepoint range with two different regex escape notations for the
  identical set of code points — confirmed functionally identical by inspection of both
  notations' meaning, not by re-deriving either from the other. Cosmetic, not a
  behavioral divergence.

## `src/core/store/query/` — NOT only `references.ts`, as design.md predicted; a second,
## cosmetic-only file also differs

```
src/core/store/query/module.ts     | 4 ++--
src/core/store/query/references.ts | 5 +----
2 files changed, 3 insertions(+), 6 deletions(-)
```

design.md's Decision/Context said this directory "should differ only by `references.ts`
+5." The actual diff has a second file. Read both in full:

- `module.ts` (4 lines, 2 hunks) — the bucket key is built by joining `projectId` and
  `targetLineId` with a single-character separator that is the null character; the two
  branches spell that one-character separator with two different escape notations in the
  source (both are recognized JavaScript string-escape spellings for the same single null
  character), and the corresponding `.split(...)` call on the read side uses the matching
  notation. Both spellings produce the identical single-character string at runtime; this
  is the same cosmetic-spelling class as `records.ts` above, not a behavioral divergence.
  Corrected observation for the record: design.md's "should differ only by references.ts"
  underweighted this file by one cosmetic hunk — noted here rather than silently treated
  as met.

- `references.ts` (5 lines, exactly as predicted) — this IS the `f4a48a36`-attributed
  divergence design.md named, and it is genuinely behavioral, not cosmetic. Upstream tip's
  `resolveChangeReference` reports `ambiguous` whenever more than one committed candidate
  is found, full stop. This branch (squash base, `f4a48a36` excluded) additionally
  requires the candidates' scopes to be distinct before reporting `ambiguous` — two
  committed candidates found in the very same project/target-line scope are no longer
  automatically `ambiguous` here.

  The removed comment on the tip explains why the refinement exists: reaching the same
  Change through several refs is collapsed earlier by identity, alias, and blob digest, so
  by the time this function runs, two remaining committed candidates are genuinely two
  claimant trees even when they repeat the same scope — the tip assumes an earlier
  collapse step already removed byte-identical same-scope duplicates before this function
  runs.

  **This function (`resolveChangeReference` in `references.ts`) is Issue plan-node
  reference resolution — checking whether an Issue's plan node names a Change that
  actually exists — and is architecturally separate from the aggregate query's OWN
  collapse/de-dup logic in `query/refs.ts` that task 7.1's anchor 5b covers**
  (`CommittedChangeEvidence.digest`, confirmed in that anchor's evidence to be "a purely
  internal de-dup key, never surfaced in any public return type"). The two files solve a
  structurally similar problem (do two refs pointing at the same Change collapse to one,
  or count as two) independently, for two different callers. On this branch,
  `references.ts` uses the cruder, squash-base-native condition — requiring distinct
  scopes before reporting `ambiguous` is enough to avoid a false ambiguous result when the
  same Change is reached twice through the same scope's two refs (for example `main` and
  a release branch pointing at the same commit), matching the local, un-extended behavior
  it always had.

  **Known gap, inherited from the exclusion, not newly introduced here:** this child's own
  reference-verification test surface (task 2.5) exercises unresolvable and
  wrong-identity references, but no test constructs two committed candidates in the SAME
  scope reachable via two refs specifically through the plan-node reference-RESOLUTION
  path (as opposed to anchor 5b's aggregate-LISTING path, which does cover that scenario
  for `listChanges`). Recorded here as the accepted shape of the `f4a48a36` exclusion
  design.md's Context section already named as a deliberate departure — not a new defect,
  and not silently absorbed into "no divergence found."

## Summary for a reviewer

| File | Divergence | Cause | Behavioral? |
| --- | --- | --- | --- |
| `issues/index.ts` | 10 lines removed | `f4a48a36` exclusion (export list) | No — dead code removed |
| `issues/locks.ts` | 70 net lines removed | `f4a48a36` exclusion (batch surface) | No — unused surface removed |
| `issues/migration-compiler.ts` | 110 lines removed (whole file) | `f4a48a36` exclusion | No — whole feature excluded |
| `issues/module.ts` | grows to 520 vs tip's 441 lines | `f4a48a36` exclusion (extraction reverted) | No — same behavior, inline vs extracted |
| `issues/records.ts` | 2 lines | Cosmetic (regex escape notation) | No |
| `issues/reference-verification.ts` | 156 lines removed (whole file) | `f4a48a36` exclusion | No — whole feature excluded |
| `query/module.ts` | 4 lines | Cosmetic (string escape notation) | No |
| `query/references.ts` | 5 lines | `f4a48a36` exclusion (ambiguity refinement) | **Yes** — narrower `ambiguous` classification for same-scope duplicates, gap not independently tested by this child |
