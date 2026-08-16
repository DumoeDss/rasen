# Result: finalization + stored-plan (L3+L5, one slice)

**Status:** passed
**Outcome:** Archive stored-plan apply runs through the Store finalization Module on 0.2.0
(locked decision D4): `withStoredArchivePlanOperation` wraps the archive transaction with the
persisted-plan token, `src/core/store/finalization/module.ts` carries the TOCTOU fix, a Store v2
change ends in exactly one explicitly declared terminal outcome (`finalization_outcome_required`,
`--outcome landed|superseded|cancelled|abandoned`), and the B1 apply-time `mergeConfirmed` gate
coexists intact. The 0.1.7 archive-engine replaced 0.2.0's independent B-fix re-implementation
wholesale; the 0.2.0-only contract suite `archive-validate-defects.test.ts` was retired on that
explicit supersession.

Delivered as a direct git port: `a675dd43` ("the outcome gate lands") + CI reconciliation
`7cb155c9` (which also landed the L4 core), in PR #160 (merge `958b75dd`).

## Evidence

- B1 coexistence (the D4 hard requirement): `test/core/archive-engine.test.ts` — apply-time
  consumption of merge confirmation with the saved plan staying byte-identical (line ~742),
  token identity (~775), and confirmation unable to bypass an unrelated blocker (~887);
  `test/core/store/finalization-plan-token.test.ts`; `store-finalize-api.test.ts` carries 12
  mergeConfirmed references.
- TOCTOU / fault coverage: the ported archive-engine fault matrix (injected-fault design:
  blocked-before-mutation, deterministic replans, all sidecar blockers in one pass).
- Retired-suite coverage audit (2026-08-16 post-merge review): every B1-B6 defect class the
  retired `archive-validate-defects.test.ts` guarded is covered live on the tip — B2/B3 via
  `spec_modified_scenarios_missing` (strict ERROR / plain WARNING split, all failing
  requirements in one pass), B4 via typed sidecar codes with exact `#/...` paths, B6 via the
  reserved ship-log section typed planning blocker.
- Live re-verification 2026-08-16 on Windows/NTFS (the platform that produced the original
  byte-snapshot flake): `test/core/management-api/store-finalize-api.test.ts` 36/36 passed,
  zero skips, after the `GIT_OPTIONAL_LOCKS=0` fix (`2a9e904a`, finalize bridge child env).

## Attempts / history

- 2026-08-13..16 - Ported in PR #160; the finalize-api byte-snapshot closure (read-only
  `git status` refreshing the planning worktree index on NTFS) was root-caused and fixed in the
  product, not the tests.
- 2026-08-16 - Post-merge review: archive-engine byte-identical to 0.1.7, ECP association-ledger
  hook re-grafted code-verbatim, coverage audit clean; slice closed `passed`.
