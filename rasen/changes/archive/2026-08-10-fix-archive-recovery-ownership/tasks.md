## 1. Lock the recovery regressions

- [x] 1.1 Add an archive-engine crash injection immediately after canonical spec target publication and before progress/phase persistence; prove stored abort returns `archive_abort_phase_unsafe`, preserves canonical/source/stage/journal/token bytes, and exact-token retry completes.
- [x] 1.2 Add actual `abortArchivePlan` Windows cases for drive-letter case, mixed separators, and dot segments, asserting that accepted aliases remove only canonical plan-derived transaction targets.
- [x] 1.3 Add actual abort-dispatch sibling and traversal cases that assert an ownership/plan-mismatch blocker and byte preservation for outside sentinels.
- [x] 1.4 Add focused cleaner authority tests that model exact stat identities beyond JavaScript's safe integer range and distinguish unchanged, replaced, missing-authority, and no-delete legacy plans.

## 2. Persist and enforce exact cleaner authority

- [x] 2.1 Extend the archive plan in `src/core/archive-engine.ts` with a deterministically ordered, path-keyed cleaner deletion authority containing exact decimal stat identity and content digest, and include it in plan hashing/parsing validation.
- [x] 2.2 Capture each new authority record through the stable no-follow handle read during planning, require one-to-one agreement with `effectiveDelete` and the classification digest, and block planning on a capture race or incomplete authority.
- [x] 2.3 Change cleaner apply/resume to authorize the source and private claim against the exact plan record without bigint-to-number coercion, while keeping the numeric cleaner candidate only as adapter compatibility data.
- [x] 2.4 Make legacy plans with effective deletes but no trustworthy exact authority fail closed with retained recovery evidence, while allowing legacy plans with no effective deletes to continue.

## 3. Close abort ownership gaps

- [x] 3.1 Select one explicit native path-identity flavor at abort dispatch and thread it through tombstone, journal, progress, association-carrier, source-quarantine, stage, final, and retained-cleanup binding checks.
- [x] 3.2 Ensure equivalent carrier spellings are used only as ownership evidence and that every cleanup operand remains derived from the immutable plan/transaction identifiers.
- [x] 3.3 Make abort safety account for per-action mutation progress and durable publication carriers before aggregate phase advancement, adjusting the engine only where the publication-window regression demonstrates a gap.

## 4. Verify the live Windows recovery matrix

- [x] 4.1 Update the focused archive fault-matrix/planning-recovery helpers so late fault assertions prove cleaner processing completed and the requested accounting or source-removal fault was actually reached.
- [x] 4.2 Run the focused archive-engine, archive fault-matrix, and archive planning-recovery tests on the local platform, then run the Windows file-placement CI job and confirm unchanged candidates no longer cascade into `archive_cleaner_ownership_unverified`.
- [x] 4.3 Confirm a source-removal injection reports its intended error, retained recovery evidence is correct, and exact-token retry completes after the injected fault is removed.
- [x] 4.4 Run the relevant cross-platform archive suites plus strict change validation, and verify the diff remains limited to `src/core/archive-engine.ts`, focused archive recovery tests/helpers, and this change's artifacts.
