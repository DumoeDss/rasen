# Task 5.2 — the mirror-absence gap in the repo's wire-type drift guard

## The gap this closes

This repo already runs a drift tripwire between core wire types and their
`packages/ui` mirrors: `packages/ui/test/api/fixtures.test.ts` builds sample
fixtures that `satisfies <ResponseType>` the mirror type. That proves an
**existing** mirror type is shape-compatible with a sample value.

It is silent on a different failure mode: a wire type added to
`src/core/management-api/wire-types.ts` whose mirror in
`packages/ui/src/api/types.ts` was **never written at all**. A `satisfies`
check has nothing to assert against if the mirror type does not exist — the
omission simply compiles as "nobody wrote a fixture for that type yet,"
which is indistinguishable from "the type doesn't need a mirror."

## The substitute

`test/core/management-api/store-aggregate-wire-mirror.test.ts` (15 tests:
1 sanity check + 1 completeness check + `it.each` over 13 named wire types)
parses **source text**
of both files for `export (type|interface) <Name>` declarations, and asserts
every one of this child's 13 new Store-aggregate wire types
(`StoreProjectsResponse`, `StoreTargetLinesResponse`, `StoreChangesResponse`,
`StoreIssuesResponse`, `StoreIssueDetailResponse`,
`StoreIssueReferencesResponse`, `StoreExecutionPlanResponse`,
`StoreIssueRecordResponse`, `StoreExecutionPlanPublishResponse`,
`StoreIssueCreateRequest`, `StoreIssueSetStateRequest`,
`StoreExecutionPlanNodeInput`, `StoreExecutionPlanPublishRequest`) has a
same-named export in the mirror
file. It is text-based rather than `tsc`-based deliberately: types are
erased at runtime, and a text-presence check is the only mechanism that can
fail on "the mirror was never written" rather than "the mirror doesn't
type-check."

## Round-1 correction: the list was 12, the section was 13

As first written, this record and the guard both said **12** types, and the
list omitted `StoreExecutionPlanNodeInput`. Both of the guard's assertions
iterate the list, so there was no direction in which a type present in the
core file and absent from the list could ever be noticed: round 1's reviewer
renamed that type's UI mirror and the guard stayed **13/13 green**, i.e. the
guard passed while the exact condition it exists to catch was true. Since
`ci.yml` never type-checks `packages/ui`, deleting that mirror type outright
would also have been fully green.

The repair is two parts, because adding the name alone would have left the
next added type just as uncovered:

1. `StoreExecutionPlanNodeInput` added to `STORE_AGGREGATE_WIRE_TYPES`.
2. A **completeness direction**: `sectionExportNames()` slices the core
   file's own "Store aggregate" section (banner line to the next `// -----`
   rule) and the guard asserts the list carries everything that section
   exports. The hardcoded list stays — it is still the legible acceptance
   criterion, now a floor rather than the whole guard — and it throws rather
   than returning an empty set if the banner cannot be found, so a renamed
   section cannot make the check pass vacuously.

## Mutation proof

### Direction 1 — list to mirror (a listed type whose mirror goes missing)

- **Mutation**: renamed one UI mirror type in `packages/ui/src/api/types.ts`
  (`StoreIssueDetailResponse` → a different name), simulating "the mirror
  was never written under the expected name."
- **RED**: exactly **1 of 13** tests failed — the one `it.each` case naming
  the renamed type, with the assertion message naming
  `StoreIssueDetailResponse` explicitly as the type missing its mirror. The
  sanity test stayed green (it only checks the core file) and the other 11
  `it.each` cases stayed green. (As first recorded this line said "12/13
  failed", contradicting its own next clause; the re-run in round 1 and the
  re-run below both show one failure.)
- **Revert**: restored from an out-of-repo snapshot (never `git checkout --`,
  per the autocrlf-corruption rule), verified byte-exact via sha256 match
  against the pre-mutation file.
- **GREEN**: 13/13 passed.

Re-run after the repair, against the type that was blind:
`StoreExecutionPlanNodeInput`'s mirror renamed in
`packages/ui/src/api/types.ts` (pre-mutation sha256 `18d36de4…`).
**RED 1/15**, naming
`StoreExecutionPlanNodeInput has a same-named export in the UI mirror` —
the same mutation that was 13/13 GREEN before the repair. Restored
byte-exact (sha256 back to `18d36de4…`, `git diff` empty); **GREEN 15/15**.

### Direction 2 — section to list (a wire type the list never learned about)

- **Mutation**: appended
  `export interface StoreMutationBProbe { probe?: string }` to the core
  file's Store-aggregate section (pre-mutation sha256 `78aa5825…`).
- **RED**: **1/15**, the completeness test, message
  `StoreMutationBProbe is exported from the "Store aggregate" section … but
  is absent from STORE_AGGREGATE_WIRE_TYPES, so no mirror assertion covers
  it.` The 13 mirror cases stayed green, which is the point: they cannot see
  it, and now something else can.
- **Revert**: restored from an out-of-repo snapshot; sha256 back to
  `78aa5825…`, `git diff` empty. **GREEN**: 15/15.

This is a discriminating mutation, not an incidental one: it targets exactly
the property the test exists to prove (a mirror export under the exact
expected name), the same way `store-issue-digest-anchors.test.ts`'s five
anchors each target the specific property their format anchor exists to
prove (see `evidence/digest-anchor-mutation-proof.md`).
