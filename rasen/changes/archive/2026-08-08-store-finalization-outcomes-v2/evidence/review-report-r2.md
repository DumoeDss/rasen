# store-finalization-outcomes-v2 — independent review report, round 2

Re-review of the round-1 fix delta. Reviewer wrote none of the code, the review,
or the fixes. Read-only pass over `evidence/review-report.md`,
`evidence/fix-report-r1.md`, the production code, and the test suites.

**Counts: 1 Medium.** Every round-1 finding was re-derived independently and
confirmed closed. The one finding is the LEAD's manual successor.ts completion:
the behavioral gate is sound but has no test.

---

## MEDIUM

### R2-1 — The unreadable-candidate behavioral gate has no discrimination test

**`src/core/store/finalization/successor.ts:330-343`** — the LEAD's manual
completion added a gate inside `requireSingleSuccessor`: when
`result.unreadable.length > 0 && result.matches.length === 0`, refuse with
`successor_scope_unverified` and name every unreadable candidate.

The gate is **correctly designed and placed** (verified below). But no test
exercises it. The test literal at `finalization-successor.test.ts:301` was
updated to include `unreadable: []`, but that is a field-literal update on the
normal zero-match case — it does not seed a malformed blob, does not populate
`unreadable`, and does not assert the gate fires.

**Proof of no coverage:** `grep -rn 'unreadable' test/core/store/finalization*`
returns one match — the `unreadable: []` literal at line 301. No test seeds a
blob that fails `ChangeMetadataSchema`, no test populates
`SuccessorSearchResult.unreadable`, and no test asserts the
`successor_scope_unverified` refusal for the unreadable-zero-match case.

**The infrastructure to test it exists but was not used.**
`finalization-memory-git.ts` seeds arbitrary blob content via `MemoryGitSeed.
blobs`. A test that seeds, say, `instanceSeed: 1234567890123456` (unquoted,
all-numeric — parsed by YAML as a number, rejected by `ChangeMetadataSchema`)
at the successor's blob path would produce a non-empty `unreadable` array,
which the gate must catch. Three properties worth pinning:

1. `result.matches` is `[]` and `result.unreadable` is non-empty after
   `searchSuccessor`.
2. `requireSingleSuccessor(result, …)` throws `successor_scope_unverified`
   with a message naming the unreadable blob and its ref.
3. A negative control: the same blob repaired to valid metadata produces a
   normal match (so the gate is not just refusing everything).

**Failure scenario:** the gate is removed or simplified in a future edit (e.g.,
the `matches.length === 0` branch is collapsed to always throw the generic
"no committed Change metadata" message). No test catches the regression. A
`superseded` finalization naming a Change whose metadata became malformed (the
documented trigger — all-numeric `instanceSeed`) silently concludes "not found"
and publishes the entry. This is the portfolio's recorded pattern: a guard that
does not guard.

**What is needed:** one test case in `finalization-successor.test.ts` that
seeds a malformed blob through the memory git helper, calls `searchSuccessor`,
asserts `result.unreadable` is non-empty, then calls `requireSingleSuccessor`
and pins the refusal code and message. The describe block "unreadable refs"
(line 385) is the natural home — it currently tests only *unsearched* refs,
which is a different failure mode, and its name suggests it should cover
*unreadable* candidates too.

---

## LEAD's manual successor.ts completion — verdict

### Design: SOUND

The `CandidateOutcome` discriminated union (`successor.ts:75-78`) correctly
distinguishes three outcomes:

| Variant | Produced when | `collect` action |
| --- | --- | --- |
| `{ kind: 'match', evidence }` | blob parsed, schema validated, identity derived | `matches.push(evidence)` |
| `{ kind: 'unreadable', reason }` | blob exists but YAML/schema/identity parsing failed | `unreadable.push({ storeRef, blobPath, reason })` |
| `{ kind: 'absent' }` | blob is null (no file at path) | silently skipped |

`candidateFrom` (lines 109-171) dispatches correctly: `text === null` → absent;
YAML parse error → unreadable with the first error line; schema parse error →
unreadable with the first three Zod issues; missing identity block → unreadable
with a specific reason; success → match with full evidence. The `collect`
helper (lines 206-211) dispatches on `outcome.kind` — `match` and `unreadable`
are handled, `absent` is correctly a no-op.

Both call sites in `searchSuccessor` (lines 246, 271) use `collect(candidate,
entry.storeRef, blobPath)` instead of the old `if (candidate !== null)
matches.push(candidate)`. The return object (line 295) includes `unreadable`.
The field was also added to `SuccessorSearchResult` (line 66) and to
`UnreadableCandidate` (lines 56-60).

### Behavioral gate: CORRECTLY PLACED, CORRECTLY MESSAGED

The gate at lines 330-343 sits inside the `result.matches.length === 0`
branch, before the generic "no committed Change metadata" refusal. This is the
right position — it intercepts the zero-match case specifically when unreadable
candidates exist, so the generic message never fires in that situation.

The refusal message names `blobPath`, `storeRef`, and `reason` for each
unreadable candidate — all three pieces an operator needs to locate and
diagnose the problem. The `fix` hint ("Repair or restore the unreadable Change
metadata so the successor can be verified, then retry") is actionable and
specific.

The gate does NOT fire when `result.matches.length > 0` — i.e., the successor
was found and verified, and unrelated unreadable candidates are correctly
ignored. The gate does NOT fire when `result.unreadable.length > 0 &&
result.matches.length > 0` — this is correct because the found match makes the
unreadable candidates irrelevant to the conclusion.

### Tested: NO

This is the finding above. The gate has no discrimination test. Reverting the
`unreadable.length > 0` check would leave every existing test green.

### Discrimination: N/A (untested)

I cannot demonstrate discrimination because no test targets the gate. The
production code is correct, but the guard is currently invisible to the suite.
Closing this gap is R2-1.

---

## Round-1 fixes — independent re-derivation

### M1 — `phase: 'complete'` workspace-index poisoning — CONFIRMED CLOSED

**Fix** (`association.ts:106-107`): phase is now preserved from
`existing?.phase`, and derived only when repairing a missing entry using child
4's own rule (`workspacePairId === undefined ? 'prepared' : 'bound'`). The
five test assertions that previously asserted `toBe('complete')` now assert
`toBe('bound')` (lines 117, 194, 227, 265, 292).

**Class sweep confirmed.** The fixer enumerated every field child 5 writes
into `WorkspaceIndexEntry`. The `planId` field was also corrected: child 5 was
substituting `plan.transactionId` (an archive transaction id) into a field
whose contract is "the workspace plan that created this pair". Changed to `''`,
matching child 4's own repair path (`workspace/module.ts:744`). No reader
resolves a plan file from `entry.planId`, so this is hygiene rather than a live
defect. Every other field (`planning`, `execution`, `version`, `planningScopeId`,
etc.) was checked and is safe.

**Discrimination confirmed.** The new test at
`finalization-association.test.ts:360` ("leaves the workspace pair CLEANABLE")
drives child 4's production `planCleanup` + `applyCleanup` against real Git
after a real finalization. It asserts both worktrees are actually removed
(`result.removed` is non-empty), directories don't exist, and Git registrations
are gone. With `phase: 'complete'` restored, `result.removed` would be empty
and both directories would survive. Ran the suite: 8/8 green.

### M2 — `--apply-plan` reachability re-proof — CONFIRMED CLOSED

**Fix** (`module.ts:922-1007`): the HEAD check now reads
`finalization.record.planning.sourceHead` (line 937-938) rather than
`token.planningHeadOid`, and is no longer gated on
`token !== undefined`. The reachability check (lines 994-1006) now runs
unconditionally when `record.codeMerge !== null`, not gated on
`token?.codeRefOid != null`. The token-only exact-OID check (line 979) is kept
as a stricter assertion that runs first when a token exists.

Traced the full call path: `archive.ts:553` →
`ChangeFinalizationModuleInstance.applyStoredPlan(plan)` (no token) →
`module.ts:399` `this.revalidate(archivePlan, token)` where token is undefined
→ both checks run.

**Discrimination confirmed.** `finalization-plan-token.test.ts:288` ("APPLY-PLAN
(no token) still aborts when the planning worktree HEAD moved") and `:324`
("APPLY-PLAN (no token) re-proves reachability") exercise the no-token surface.
Ran the suite: 17/17 green.

### M3 — Three absent preconditions — CONFIRMED CLOSED

| Precondition | Where | Line |
| --- | --- | --- |
| Target-line catalog text | `revalidation.targetLine.catalogDigest` re-read and compared | `module.ts:1077-1087` |
| Successor evidence | `revalidation.successor` blob re-read and compared | `module.ts:1095-1119` |
| Change source fingerprint | `fingerprintArchiveTree(paths.active).digest` compared | `module.ts:1058-1068` |

The dead `void catalogDigestSource` is gone. The new
`ArchiveFinalizationRevalidation` type (`archive-engine.ts:269-287`) is
**required** on `ArchivePlanFinalization` (line 309, not optional), so an apply
path cannot find it absent and skip. The field is populated at plan creation
time (`module.ts:241-244`).

**Discrimination confirmed.** `finalization-plan-token.test.ts:379` (source
fingerprint), `:409` (catalog), `:482` (successor) each exercise the no-token
surface and assert refusal with the right message.

### M4 — NUL bytes — CONFIRMED CLOSED

**Verification:** `node -e "const buf = fs.readFileSync('successor.ts'); …"`
reports **0 NUL bytes**, file size 14953. The de-duplication key at line 287
uses ` ` escapes — the runtime string is byte-identical to the old raw-NUL
version, but the source file is valid UTF-8 text. `git diff --no-index` now
produces a normal text diff.

The byte hygiene gate (`test/source-byte-hygiene.test.ts`) passed (5/5), and
the fixer's report that it already caught child 6's NUL bytes in
`store/query/module.ts` and forced the entry to be removed on repair is the
exact round-trip that proves the guard is not decorative.

### D1 — Type-level proof — CONFIRMED CLOSED

The fixer's `never`-widening repair is structurally correct. With the
distributive `CarriesSpecActions` kept as-is and `ExactlyFalse` widening to
`never`, a union member gaining `specActions` makes the result `boolean`, which
is not `exactly false`, so the constant's type becomes `never` and `= false`
fails to compile. The reviewer's bracketed repair was correctly rejected: it
asks "do ALL members carry the field" rather than "does ANY", so one offending
member leaves the answer `false` and the constant compiles.

One note: the fix-report's prose claims the bracketed form "would also stop
failing if every member gained the field" — this is wrong (if every member
gained it, the bracketed form returns `true`, and `const X: true = false` still
fails). The in-code comment at `types.ts:280-285` does not repeat this error;
it correctly says "one offending member leaves the answer `false`". Not a
finding — the code and its comment are accurate; only the fix-report's
expansion has the error.

### D2, D3, L1–L7 — all CONFIRMED CLOSED

| Finding | Fix verified |
| --- | --- |
| D2 | Parity suite comment corrected (read the file header at `finalization-surface-parity.test.ts`) |
| D3 | `archive-preconditions.md` §14.5 rewritten to say both instructions are already satisfied |
| L1 | `finalization-record.test.ts:272` now asserts `expect(thrown).toBeUndefined()` |
| L2 | All eight sites pinned: `finalization-outcome.test.ts:237` (code + message regex), `finalization-record.test.ts:433,455` (SCHEMA_REFUSAL constant), `finalization-successor.test.ts` (no bare `.toThrow()` remains), `finalization-windows-paths.test.ts:117,118,149,159-169` (specific regex per case), `finalize-scope.test.ts:475` (identity regex) |
| L3 | Plan-token suite header states fixture clock dependency |
| L4 | Self-supersession refused by name at `successor.ts:184-195`, before any Git access |
| L5 | Scope note added in `finalization-reachability.test.ts` |
| L6 | Journey asserts empty baselines explicitly |
| L7 | `archive-preconditions.md` §14.4 tells shipper to run `git add -A && git diff --cached --check` |

---

## Damage introduced by fixes

**None found.** Each fix changes behavior in a load-bearing path; each was
checked for regressions:

- **M1 (phase preservation):** the only reader of `entry.phase` is
  `phaseReached` in `workspace/cleanup.ts`. With `phase: 'bound'` instead of
  `'complete'`, `phaseReached(entry, target)` is now below the maximum, so
  `revalidateBeforeRemoval` and the removal loop both execute. This is the
  intended fix — the pair stays cleanable rather than being silently skipped.
  No other reader exists in the repository.

- **M2 (reachability re-proof):** the unconditional `isAncestor(commit, current)`
  survives a legitimate fast-forward (the commit remains an ancestor of the
  advanced ref). It fails only on a rewind/revert/reset — which is exactly the
  state the plan should be invalidated for. The token-carrying direct path
  (`archive.ts:1214`) gets the stricter exact-OID check first, then the
  reachability re-proof — both pass on a clean apply.

- **M3 (three preconditions):** each compares the current state against a fact
  frozen at plan time. If nothing changed between plan and apply, all three
  pass. A legitimate apply (no intervening edits) is unaffected.

---

## Guard-discrimination table (round 2 delta)

Only suites whose discrimination status changed from round 1 or that the brief
asked me to re-derive.

| Suite / assertion | Discriminating? | Basis |
| --- | --- | --- |
| `finalization-successor` — `unreadable: []` literal at :301 | **Not a guard** | field-literal update, not a behavioral assertion; no test seeds a malformed blob |
| `finalization-successor` — unreadable gate at `successor.ts:330-343` | **NOT discriminating (no test exists)** | see R2-1 |
| `finalization-successor` — self-supersession refusal (:184-195) | **Sound** | three cases: pins `finalization_outcome_invalid` + "cannot supersede itself" + asserts `git.calls` is empty; negative control proves a different `--by` still searches |
| `finalization-association` — `phase: 'bound'` (5 sites + cleanup case) | **Sound** | cleanup case drives real Git; with `'complete'` restored, `removed` is empty and directories survive |
| `finalization-plan-token` — APPLY-PLAN (no token) HEAD moved (:288) | **Sound** | exercises the surface that ships; previously tested only the token-carrying path |
| `finalization-plan-token` — APPLY-PLAN (no token) reachability (:324) | **Sound** | rewinds the ref, not fast-forwards it |
| `finalization-plan-token` — APPLY-PLAN (no token) source fingerprint (:379) | **Sound** | asserts nothing published and archive-line directory still absent |
| `finalization-plan-token` — APPLY-PLAN (no token) catalog (:409) | **Sound** | re-points the catalog and asserts refusal names "the target-line catalog" |
| `finalization-plan-token` — APPLY-PLAN (no token) successor gone (:482) | **Sound** | deletes successor blob, asserts refusal |
| `finalization-record` — L1 passive pair-id (:272) | **Sound** | `expect(thrown).toBeUndefined()` asserts acceptance directly |
| `finalization-record` — serializer refusals (:433,:455) | **Sound** | pinned to SCHEMA_REFUSAL regex constant |
| `finalization-windows-paths` — reserved names (:149) | **Sound** | pinned to `/reserved as a Windows device name/u` |
| `finalization-windows-paths` — path-flavor cases (:117-118,:159-169) | **Sound** | each case pins a different reason (cwd-independent, traversal, separator, trailing dot) |
| `finalize-scope` — malformed instance (:475) | **Sound** | pinned to `/changeInstanceId: must use ci_<64 lowercase hex/u` |
| `source-byte-hygiene` — repo-wide gate | **Sound** | exception list staleness-checked in both directions; already caught child 6's repair |

---

## Gate results

Every failing file named.

| Gate | Result |
| --- | --- |
| `finalization-successor.test.ts` | 16 passed, 0 failed |
| `finalization-plan-token.test.ts` | 17 passed, 0 failed |
| `finalization-association.test.ts` | 8 passed, 0 failed |
| `source-byte-hygiene.test.ts` | 5 passed, 0 failed |
| NUL-byte sweep of `successor.ts` | 0 NUL bytes (file size 14953) |

`tsc --noEmit` and `eslint` were not re-run: impl-c6b is actively editing
`store-planning/internal/resolver.ts` and `store/query/**`, and the brief
directed me to enumerate failures by file name rather than attempt an
attributable full-repo gate during concurrent edits.

The five environmental failures (`config.test.ts` ×1,
`config-editor.test.ts` ×4) are excluded as instructed.
