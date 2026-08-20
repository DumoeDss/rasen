# Fix round 1 — issue-plan-publication (implementer disposition)

Date: 2026-08-20. Disposition of the two items routed to the implementer from
`review-report.md` (round 1: PASS, 0 Blocker / 0 Major / 1 Minor / 4 Trivial).

## M-1 — pinning test added (the only Minor)

`test/core/issue-publication/issue-plan-publication-resolution.test.ts` gains
one test, beside the existing resolver tests and following their fixture
conventions:

**"pins the M-1 layer divergence: active+archived copies of ONE instance
resolve by name, then the under-lock instance verification refuses."**

What it pins, in order:

1. **Layer 1 (this channel's name resolution) resolves.** A Change whose ONE
   instance is committed both active (`shared-fate`) and archived
   (`2026-08-07-shared-fate`, a COPY so the active directory stays — the
   fork/migration anomaly, not the normal archive flow) shares one identity
   triple, so `resolveChildByName` answers `resolved` with the active copy's
   identity. Correct at its layer: the name names one Change.
2. **Layer 2 (the mutation's under-lock instance verification) refuses.**
   `publishPlanFromPortfolio` over a portfolio naming that child throws
   `issue_reference_ambiguous`: `collectCommittedChanges` dedups on identity
   PLUS `changeId`, so the pair is two committed entries for one instance id,
   and `resolveChangeReference` lists both — the test asserts BOTH copies in
   the refusal message (`shared-fate at refs/heads/main` and
   `2026-08-07-shared-fate at refs/heads/main`) and that no `0001.yaml`
   exists.
3. **The combined outcome is the fail-safe one, pinned as intended behavior.**
   The test's own comment says "never make it 'work'": a later change that
   made this store state publish would fail this test on the no-throw path,
   and one that made the name layer refuse would fail the first assertion —
   it discriminates in both directions. The refusal is also the same answer
   the manual `--from-file` path gives on the same store state, so the pin
   documents layer divergence, not channel-specific behavior.

Gates (real exit codes, never piped):

- `pnpm run build` → exit 0.
- `pnpm exec vitest run test/core/issue-publication/` → **2 files / 21 tests
  passed, exit 0** (`/tmp/fix-round1-tests.log`, 2026-08-20). The touched
  file's count moves 11 → 12; the orchestration sibling stays 9/9.

No production code changed for M-1: the reviewer's verdict was that the
refusal is honest behavior worth a pin, not a rework, and the test confirms it
reproduces exactly as analyzed.

## T-2 — residue deleted

`.rasen-pipeline-command-g4roIW/` removed from the repo root
(`rm -rf`; verified no `.rasen-pipeline-command-*` remains). Test-leak residue
from the gate run, not this change's code.

## Post-fix state

- Fences byte-empty unchanged: `git diff -- src/core/pipeline-registry/
  packages/ui package.json` = 0 bytes; no version bumps; tracked-file diff
  still exactly the 7 files from the implementation round.
- Trailing-whitespace scan of the touched test file: clean.
