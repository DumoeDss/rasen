# Review Report: issue-operations-and-unlinked

## Summary

| Dimension | Result |
|---|---|
| Scope | CLEAN — delta-only re-review covered the three selector-ownership components and two A→B regression files; unrelated `.rasen/` debris, g-003, and all other changes were excluded |
| Standards | CLEAN — Store selector and exact member selector are now explicit synchronous ownership boundaries for retained state and deferred results |
| Spec | CLEAN — old Store rows/dialog state cannot render or write as the new Store, and late Operations results cannot cross the Store/member boundary |

REVIEW VERDICT: CLEAN — Blocker:0 Major:0 Minor:0 Trivial:0

Re-review baseline: the live working tree at `bb0dc13dd9444d25a950dce7a20b23b0b008a7a6`, HEAD tree `bfacf34d3bbf9ecb673099e18c062505a4065ebc`, plus the five-file reviewed delta bundle SHA-256 `b15f72b2f8c030c4a00eb798548f7a1695ed9df4f9b99884eb75ad28fe718d4f`.

## Findings

None.

## Resolved findings

1. **RESOLVED — Store route reuse can no longer submit an old Store's Change graph to the new Store.**
   - `UnlinkedChangesPage` now renders all state inside a selector-keyed child (`packages/ui/src/components/UnlinkedChangesPage.tsx:73-204`). Changing `:storeId` replaces rows, filters, errors, Issues, and dialog synchronously during render instead of waiting for an effect. Dialog creation also captures its owner selector, and rendering requires that owner to match (`:162`, `:180-188`).
   - `LinkChangeDialog` freezes `{entry, selector, initialMode}` as its immutable owner (`packages/ui/src/components/LinkChangeDialog.tsx:95-119`). All Issue/link reads and create/publish writes use `owner.selector` and `owner.entry`, fail closed after scope retirement, and re-check ownership after awaits (`:121-165`). Attach freezes detail/node confirmation facts (`:167-210`); create freezes Issue id/title/node (`:212-256`). A reused mismatched dialog returns `null` (`:266-269`).
   - `OperationsPage` likewise keys its stateful child by Store selector (`packages/ui/src/components/OperationsPage.tsx:164-190`, `:445-453`). Initial fan-out, retry, and load-more discard results after Store retirement; retry/load-more additionally require the exact captured member selector before replacing a same-project member (`:334-383`).
   - Real `preact-iso` Router regressions exercise same-component Store A→B transitions. The Unlinked test holds A's confirmed write preflight unresolved and proves A rows/dialog disappear and no create/publish targets B (`packages/ui/test/components/unlinked-changes-page.test.tsx:216-279`). The Operations test uses overlapping project ids, different exact member selectors, and late retry/load-more responses, proving only Store B remains (`packages/ui/test/components/operations-page.test.tsx:428-522`).

## Coverage audit

```text
CODE PATH COVERAGE
==================
[+] Immediate Store ownership boundary
    |-- [*** TESTED] same route component transitions Store A -> Store B
    |-- [*** TESTED] A rows and confirmed dialog are retired
    `-- [DIFF-READ] selector-keyed children synchronously retire rows, filters, errors, and dialog state

[+] Dialog read/write provenance
    |-- [*** TESTED] unresolved A preflight cannot reach create or publish after navigation
    |-- [DIFF-READ] link/detail reads use immutable owner selector
    `-- [DIFF-READ] attach/create use frozen confirmation snapshots

[+] Operations deferred results
    |-- [*** TESTED] late A retry is discarded with overlapping project ids
    |-- [*** TESTED] late A load-more page is discarded
    `-- [DIFF-READ] Store owner + exact member selector gate every update
```

## Checks run

- Independent delta gate: `pnpm --filter @atelierai/rasen-ui test test/components/unlinked-changes-page.test.tsx test/components/operations-page.test.tsx` — PASS, 2 files / 10 tests.
- Independent compile/bundle gate: `pnpm --filter @atelierai/rasen-ui build` — PASS, 566 modules transformed.
- Fixer-reported focused gate: the six Operations/Unlinked/model/control files — PASS, 6 files / 36 tests.
- Fixer-reported full UI gate: PASS, 76 files / 985 tests; UI build also passed before independent re-review.
- Strict UTF-8 validation of the five reviewed files — PASS; no BOM or U+FFFD.
- HEAD tree fingerprint from `git rev-parse HEAD^{tree}`: `bfacf34d3bbf9ecb673099e18c062505a4065ebc`. Because all five g-002 files are untracked relative to HEAD, the exact tested delta is additionally pinned by bundle SHA-256 `b15f72b2f8c030c4a00eb798548f7a1695ed9df4f9b99884eb75ad28fe718d4f`.

## Durable review notes

- `preact-iso` retains a route component across parameter-only navigation; selector-keyed stateful children are the synchronous Store boundary.
- Revision CAS protects one Issue's history but not cross-Store provenance, so dialogs must freeze owner selector, entry, and confirmation facts before any await.
- Aggregate async updates require both the outer Store owner and exact member selector; project id alone cannot authorize replacement.
- The sole round-one Blocker is independently confirmed resolved; there are no accepted-known Minor or Trivial findings.
