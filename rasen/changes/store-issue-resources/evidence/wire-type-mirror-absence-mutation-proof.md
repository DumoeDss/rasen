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

`test/core/management-api/store-aggregate-wire-mirror.test.ts` (13 tests:
1 sanity check + `it.each` over 12 named wire types) parses **source text**
of both files for `export (type|interface) <Name>` declarations, and asserts
every one of this child's 12 new Store-aggregate wire types
(`StoreProjectsResponse`, `StoreTargetLinesResponse`, `StoreChangesResponse`,
`StoreIssuesResponse`, `StoreIssueDetailResponse`,
`StoreIssueReferencesResponse`, `StoreExecutionPlanResponse`,
`StoreIssueRecordResponse`, `StoreExecutionPlanPublishResponse`,
`StoreIssueCreateRequest`, `StoreIssueSetStateRequest`,
`StoreExecutionPlanPublishRequest`) has a same-named export in the mirror
file. It is text-based rather than `tsc`-based deliberately: types are
erased at runtime, and a text-presence check is the only mechanism that can
fail on "the mirror was never written" rather than "the mirror doesn't
type-check."

## Mutation proof

- **Mutation**: renamed one UI mirror type in `packages/ui/src/api/types.ts`
  (`StoreIssueDetailResponse` → a different name), simulating "the mirror
  was never written under the expected name."
- **RED**: 12/13 tests failed — the one sanity test stayed green (it only
  checks the core file), and all 12 `it.each` cases collapsed to exactly the
  ONE test naming the renamed type failing, with the assertion message
  naming `StoreIssueDetailResponse` explicitly as the type missing its
  mirror.
- **Revert**: restored from an out-of-repo snapshot (never `git checkout --`,
  per the autocrlf-corruption rule), verified byte-exact via sha256 match
  against the pre-mutation file.
- **GREEN**: 13/13 passed.

This is a discriminating mutation, not an incidental one: it targets exactly
the property the test exists to prove (a mirror export under the exact
expected name), the same way `store-issue-digest-anchors.test.ts`'s five
anchors each target the specific property their format anchor exists to
prove (see `evidence/digest-anchor-mutation-proof.md`).
