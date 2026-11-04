# Independent review report: process-authority-scope-semantics-wording (task 7.5)

Reviewer: non-author. Reviewed the committed state (`cf60b208` propose, `e31d297d` apply) plus the
working tree as of 2026-08-07 evening. Method: every load-bearing claim re-derived from git, bytes,
or a live mutation run rather than accepted from the implementer's record. Three production checks
were mutation-tested (neutralise the check, run the named tests, restore byte-identical from HEAD);
the working tree was returned to a verified-clean, all-green state after each.

## Verdict summary

No Blocker. One Major (committed-tree guard/helper split), four Minor, three Trivial. All five
delegated claims verify; both retained behaviours survived, one of them now with the first
discriminating guard it has ever had. The change does what it says: a contract-text narrowing with
no behaviour change, and the machinery the two removals could have taken with them is demonstrably
still present and still (or newly) asserted.

## Findings by severity

### Major

**M1. The 4.2 hash rebaseline and the 4.1 rename are split across the commit boundary, leaving the
committed tree knowingly red.** Commit `e31d297d` updates `FROZEN_COMMON_INPUTS` in both guard
files (`test/core/session-host/linux-process-authority-boundary-guards.test.ts:11` and
`test/core/session-host/windows-process-authority-package-ci.test.ts:39`) from `2e952cde...` to
`b9d8bd4f...`, but does NOT contain the conformance-helper edit that produces those bytes: the
task 4.1 rename (`preserves %s during replacement recovery` -> `preserves %s under inspection
through the same coordinator`, `test/helpers/process-authority-provider-conformance.ts:250`) exists
only as an uncommitted working-tree modification. Verified: helper blob at `e31d297d` hashes
`2e952cde...`; working-tree bytes hash `b9d8bd4f...`. A clean checkout of `e31d297d` therefore
fails both frozen-input guards. This contradicts the ticked text of task 4.2, "in the same commit
as 4.1 so the tree is never knowingly left red." The working tree is currently consistent (both
guards green in my run), but the fix rides on an uncommitted file in a shared worktree with heavy
concurrent churn. The 8.1 ship commit MUST include
`test/helpers/process-authority-provider-conformance.ts`, and the 4.2 tick's same-commit claim is
false as recorded.

### Minor

**m1. The new task-2.2 descriptor-rejection cases do not discriminate the registry-level check by
itself.** With the registry semantics comparison (`registry.ts:108-116`) neutralised, all 8 tests
in `process-authority-scope-semantics-contract.test.ts` stay green, because the test constructs the
registry with a manifest carrying the same retired array and its `toThrow` regex accepts the
manifest validator's message (`capability is incomplete`) as an alternative. The claimed behaviour
(rejection at registry construction before any dispatch) does still hold under that mutation, and
the pre-existing message-pinned case at `process-authority-registry.test.ts:127-133` DOES fail, so
the check is guarded overall - but by the old suite, not the new one. If the new suite is ever
treated as the sole contract guard, the registry-level check is unprotected.

**m2. Task 5.3's required record does not exist.** The task says "record where each is asserted";
the tick carries no annotation, `evidence/` holds only `receipt-disposition.md`, and there is no
handoff directory. Only the adapter-test discovery made it into the `e31d297d` commit message. The
verification itself appears to have happened (the adapter test exists and bites; see R2 below),
but the durable record the task demanded was not produced.

**m3. Task 5.1's own pass-condition is unsatisfiable as written and the tick glosses it.** 5.1
declares any retired-token hit in "the main specs" a defect, but
`rasen/specs/process-authority-provider/spec.md:7` still enumerates `publish-before-activate` and
replacement recovery - correctly, by the design's own sequencing (the main spec changes only at
archive, and its bytes are hash-pinned by the same frozen-input guards until 8.4). Same shape for
"tests": `process-authority-scope-semantics-contract.test.ts` deliberately contains all three
retired tokens as rejection fixtures. Both classes are legitimate, but the task text does not
carve them out, so the tick is true only under an unstated reading.

**m4. `design.md:139` (Migration Plan) says rebuilding re-emits "the nine-element array."** The
array is eight elements. Stale residue from the draft in which `publish-before-activate` was still
an open question. Text-only, but it sits in the section a future operator would follow.

### Trivial

**t1.** The `windows_section8_gate.rs:1091` anchor recorded in task 1.3's correction has drifted to
line 1104 - the concurrent native wave modified that file after the record was made. The comment
itself is intact and byte-relevant reasoning survives the rename.

**t2.** Task 7.5 says "the two replacement-controller scenarios named in the design," but
`design.md` never names them. The two removed scenarios are `Replacement first observes a recovered
generation` and `Replacement observes inert authority` (main spec :102-104, :110-112); only task
8.3 refers to them, generically.

**t3.** `.rasen/changes/process-authority-scope-semantics-wording/ephemera/auto-run.json` exists
and carries the retired tokens (5 hits). This is engine-written run-state, not a worker write, so
task 5.5's tick is defensible - noted so nobody reads my token sweep as contradicting it.

## The five delegated claims

**Claim 1 - the falsifier (task 1.2): CONFIRMED.** Re-derived, not read: `npm view @atelierai/rasen
time` returns exactly 0.1.1 (2026-07-10) through 0.1.6 (2026-08-01T10:34Z), nothing later.
`git log --follow --diff-filter=A -- src/core/session-host/process-authority/types.ts` returns one
commit: `222eac50`, 2026-08-05 08:48 +0800. The emitting code postdates every release; the
load-bearing conversion from "probably unused" to "cannot have been used" holds. No
`providers.json` exists anywhere in the tree; `dist/native/` contains only the legacy capsule
manifest (`rasen-process-capsule-manifest/1`, whose `publish-before-activate` is the legacy
contract's token and correct). My own sweep of `C:\Users\Sayo\.rasen` for
`rasen-recursive-process-scope` found zero hits - corroboration of the store check, not a
reproduction of the implementer's 23,380-file sweep.

**Claim 2 - ProcessCapsule boundary: CONFIRMED on bytes.** SHA-256 of all four consumers -
`src/core/session-host/process-capsule/resolver.ts`, `scripts/build-process-capsule.mjs`,
`test/core/session-host/process-capsule-package.test.ts`, and the spec-level
`rasen/changes/ecp-native-process-capsule-closure/specs/durable-process-scope-authority/spec.md` -
identical to their `e31d297d~1` blobs, and all four unmodified in the working tree. The
`LEGACY_PROCESS_CAPSULE_INPUTS` guard and both legacy-shape tests pass in my runs. The wider
seven-file pinned set is covered indirectly by that green guard rather than hashed by me
individually.

**Claim 3 - the two slices: the implementer's corrected claim is true.** Both the ten-element and
eight-element arrays end in `event-completeness`, so `.slice(0,-1)`
(`process-authority-registry.test.ts:130`) drops the same element before and after - its meaning
did NOT change; the initial claim was wrong and the correction (design.md:76, commit message)
stands. `.slice(1)` (`process-authority-manifest.test.ts:112`) drops the first element - renamed,
positionally identical. Present-tense discrimination proven by mutation: neutralising the registry
comparison fails the registry case; neutralising `exactSemantics` (`manifest.ts:59-63`) fails both
the manifest `missing semantic` case and the new contract test's fail-closed manifest case. The
historical half of the claim - RED/GREEN demonstrated at TEN elements, before the constant edit -
is not verifiable from git (tests and fix land together in `e31d297d`); it rests on the
implementer's transcript.

**Claim 4 - the guard rebaseline: hash CONFIRMED, provenance flawed.** Recomputed SHA-256 of the
working-tree `test/helpers/process-authority-provider-conformance.ts` is exactly
`b9d8bd4fb63910ed1626c0d9f2bda258803a8f3a191f98c57509e837cc58d2f0`, matching both guard files, and
the working-tree diff to that helper is the single title line and nothing else. But the bytes that
produce this hash are uncommitted - see M1.

**Claim 5 - win32 early return: CONFIRMED, substitute adequate.**
`linux-process-authority-package-ci.test.ts:259-262` asserts a POSIX-only throw and returns on
win32; the edited providers literal at :341-372 sits inside that same test and never executes on
this host. The substitute (evaluating each build script's own `semantics` const) is adequate for
content, and shape-identity follows from the 4-line diffs being confined to the array literals in
both `scripts/build-linux-process-authority.mjs` and `scripts/build-windows-process-authority.mjs`.
Residual: the literal is truly guarded only on Linux CI, as the commit message itself states.

## The two retained behaviours

**Exactly-once explicit activation: SURVIVED, and its new guard discriminates.** The adapter guard
is exactly where claimed (`process-scope-adapter.ts:180-183`: `activated` check throws
`activation-failed` before `activated = true` at :183 and the publish call at :184). Mutation run:
with the guard neutralised, exactly one test fails - the new
`refuses a repeated activation before any publication or provider dispatch`
(`process-authority-process-scope-adapter.test.ts:132-151`) - and its failure mode is the proof:
the error becomes `authority-persist-failed` from the downstream publish path, i.e. the second
activation reached the publisher once the adapter refusal was gone. No other adapter test failed
under the mutation, which independently corroborates the implementer's report that adapter-level
exactly-once had no test before this change. Coordinator-level exactly-once settlement is
separately asserted (`process-authority-lifecycle.test.ts` ordering-conflict assertions at :321,
:346, :388 among others) and untouched.

**Per-operation authority revalidation: SURVIVED.** The apply diff touches exactly one file under
`src/` (`types.ts`), so nothing was removed by construction; verified independently that
`src/core/session-host/process-authority/` is clean against HEAD and that the envelope codec
(`reference-codec.ts`), reference resolution, coordinator, and both platform providers are intact.
`identity-drift` appears in 8 source files and is asserted across 15 test files (46 occurrences),
none touched by this change. The main spec's `Versioned opaque authority-reference envelope`
requirement is deliberately absent from the delta (unmodified), and the delta adds the standalone
revalidation requirement with the retrigger of `Identity drift forbids control` from "recovery
finds" to "an operation finds". The conformance-helper edit is one title line; its body still
prepares, optionally publishes, and inspects through the same coordinator - the rename removes an
overclaim, not an assertion.

## Delta-spec scenario parity

Checked title-by-title and body-by-body against `rasen/specs/process-authority-provider/spec.md`.
Selection requirement: all five scenarios verbatim plus the new
`Provider advertises a retired semantic`. Ordering requirement: all seven scenarios verbatim, prose
reframed as retained coordinator mechanics. Lifecycle requirement: exactly two scenarios do not
survive - `Replacement first observes a recovered generation` (removed) and
`Replacement observes inert authority` (rebuilt as `Inspect preserves an inert phase`, trigger
narrowed from "exact recovery reports" to inspection by the current controller); the tombstone
scenario drops the words "or recovered dispatch" consistently with the deferral; the new
`Controller death does not leave resumable authority` scenario is present. No other scenario was
lost. The requirement demanded by 7.5 is met.

## Other verifications

- Guard-state run: `linux-process-authority-boundary-guards.test.ts` 2/2 green;
  `windows-process-authority-package-ci.test.ts` 20/21 with the single failure being
  `leaves the frozen Linux native tree at its recorded source digest` - the known, expected 5.4
  tree-level breakage from the concurrent native wave, per the LEAD's instruction not graded here.
- Baseline and post-mutation runs of the four focused test files: 39/39 green before and after.
- Whitespace on bytes: all 16 files this change touches (change directory, `types.ts`, both build
  scripts, six test files, the helper) are LF-only, no trailing whitespace, no trailing blank line
  at EOF.
- Retired-token sweep (exhaustive over the gitignore-respecting tracked tree, 47 files, 129 hits):
  every hit classifies as historical evidence/handoff/design docs, the archive, the three legacy
  ProcessCapsule files, the two native prose comments (`cli.rs:741`, `windows_section8_gate.rs`,
  now :1104), the new test's deliberate rejection fixtures, the main spec awaiting archive, and
  engine run-state under `.rasen/`. No stray hit in product code or build scripts.
- Descriptor derivation (task 3.5): Linux primary (`linux/contracts.ts:26`), Linux broker (spread
  of primary, :29-33), Windows (`windows/contracts.ts:31`) all read the constant; validators
  compare against it at `registry.ts:110-113` and `manifest.ts:61-62`.

## Disagreements with the implementer

- Task 4.2's tick: "in the same commit as 4.1 so the tree is never knowingly left red" - the
  contradicting fact is that `e31d297d` contains the hash update and not the helper edit (M1).
- Task 5.1's tick as literally worded fails on the main spec and on the new test's fixtures (m3).
- No disagreement on the corrected slice claim, the falsifier, the boundary, or the win32 finding:
  each was re-derived and each holds.

## Not verified, and why

- Historical RED states at ten elements (tasks 2.1-2.4, 7.1 "RED before the section 3 edits"):
  tests and production fix land in one commit, so git cannot attest the ordering; I verified
  present-tense discrimination by mutation instead, which is the stronger property going forward.
- The 23,380-file machine-store sweep as performed: corroborated by an independent zero-hit grep
  of `C:\Users\Sayo\.rasen` only (sampled, not exhaustive over whatever the implementer swept).
- Task 7.2's full-suite figures (607 passed / 7 skipped): not re-run; targeted runs only (62 tests
  across six files). With two native crates mid-flight in this shared worktree, a full-suite
  number would not be attributable to this change anyway.
- Task 7.4 (`rasen validate --strict`): not re-run; the CLI may write run-state and the recorded
  result is low-risk to accept.
- Linux-only behaviour (actual `providers.json` emission through `assemble()`): wrong host;
  guarded on Linux CI only, as the change itself records.

## Required before archive

1. (M1) Include `test/helpers/process-authority-provider-conformance.ts` in the 8.1 ship commit,
   or amend history so no commit pins `b9d8bd4f...` without the bytes that produce it.
2. (m4) Fix "nine-element" at `design.md:139`.
3. (m2) Land the 5.3 assertion-location record somewhere durable, even as a short evidence note -
   this report's "Other verifications" section can serve as its substance if the LEAD accepts it.
