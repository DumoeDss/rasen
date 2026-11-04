# Review report — issue-revision-history-preservation (reviewer-1, 2026-08-22)

Independent verifier, VERIFY stage. All runs on the `feat/issue-phase5` worktree
at `.claude/worktrees/issue-layer`, delta uncommitted on `abc2ad14`. Exit codes
taken from the spawning shell's child-status (never a pipe tail); full logs in
`%TEMP%\rev-issue2\*.log` on this machine.

## Verdict

**APPROVE — no Blocker, no Major. 2 Minor, 2 Info.**

| Severity | Count |
| --- | --- |
| Blocker | 0 |
| Major | 0 |
| Minor | 2 |
| Info | 2 |

## 1. Unit-test gate (re-run with real exit codes)

Build first (`pnpm run build`) — exit 0 (also re-verifies the implementer's
build gate myself).

| Run | Files | Tests | Exit | Matches claim |
| --- | --- | --- | --- | --- |
| focused-1 (`test/core/issue-status/` + `test/core/issue-acceptance/`) | 17 | 99 | 0 | yes (local-gates row 1) |
| focused-2b (record-schema store suites + plan/start/target CLI) | 11 | 144 | 0 | yes (local-gates row 3) |
| focused-2a (store-issue CLI suites) | 7 | 33 passed / 1 failed | 1 | 34 claimed; the 1 failure adjudicated ambient (below) |
| solo `issue-status-projection` (LEAD-adjudication spot-check) | 1 | 25 | 0 | yes (binned adjudication: 25/25) |
| new suites standalone (the 5 new files, one process) | 5 | 17 | 0 | yes (5+4+1+6+1) |

**focused-2a adjudication (full enumeration from the captured log, not a
tail).** Exactly one failing test:
`store-issue-status-cli.test.ts` > "degrades to a labelled visibility-none
answer from an unrelated directory" (33.9s — a filesystem-scan timeout shape).
Every other file/test in the group passed, including the change-surface
`store-issue-acceptance-exclusions-cli` (green in-group AND again standalone
in the new-suites run). My two chains ran concurrently and both spawn
dist-building CLI processes — the implementer's machine note names exactly
this hazard. Baseline comparison: the failed file re-run SOLO after all other
runs finished — **1 file / 6 tests / exit 0**. Not attributable to this
change's delta (the failed test is a prior-touch suite's unrelated-directory
degradation row; the delta touches accept/show rendering only). CI remains
authoritative at portfolio.

Tree fingerprint before mutation checks (diff vs `abc2ad14` + status, sha256):
`09e12c3e78ad38efde67e99da54a12a7d584a242e5091250d73ea9e0403dd3bf`.

## 2. Claim sweep

### 2.1 Exclusions-carry

- **Optional field, absent-omitted from the digest body — verified in source.**
  `IssueAcceptedRecordV1.exclusions?` (`src/core/store/issues/types.ts:333`),
  `.strict()` schema with `exclusions: z.array(RecordExclusionSchema).optional()`
  (`src/core/store/issues/acceptance.ts:140`), digest body omits the key when
  the array is empty (`acceptance.ts` `acceptedRecordDigestBody`), serializer
  omits identically (`serializeAcceptedRecord`), and `StoreIssues.accept`
  canonicalizes `[] → undefined` before the draft (`module.ts:487-496`) — the
  empty array never reaches bytes from the mutation path.
- **Empty-exclusion accept byte-identical to pre-field shape — pinned twice.**
  Symmetric (this change): `store-issue-acceptance-exclusions.test.ts` test 1
  hand-writes the exact no-`exclusions` YAML and asserts the file text equals
  it, plus the digest over the absent body. Non-symmetric (predates the
  change, tracked file untouched): `store-issue-acceptance-content.test.ts:210`
  asserts `acceptedRecordDigest(no-exclusion draft) === '3487ff00…'` — a
  hand-copied literal whose bytes this change did not regenerate. Green in my
  focused-2b re-run ⇒ the no-exclusion digest body is byte-stable across the
  change.
- **Pre-field records on the REAL store read unchanged — re-read myself
  (read-only, bytes read directly, no store writes).** All three accepted
  records in `issue-registry` (`rasen-issue-store`) parse under the NEW parser
  with `verifyDigest: true`, digests verify, no `exclusions` key in bytes,
  parsed as absence: `issue-multi-change-execution` (3/3),
  `issue-cross-project-execution` (4/4), `issue-autodecompose-uplift` (2/2) —
  Issues #1/#3 included; script exit 0. Incidentally corroborates
  implementer-finding #1: all three freeze `health: waiting-human`, never
  `healthy`.
- **Exclusion entries carry node+reason (and lifecycle)** — schema + gate
  shape agree (`{nodeId, lifecycle, reason}` from `lifecycleAccounting`,
  `gate.ts:69`), carried verbatim (`orchestration.ts:254`), re-validated at the
  record layer (`parseChangeId` node, `assertPortableIssueText` reason,
  duplicate-node refusal in `validateAcceptedRecord`).
- **`reason` `min(1)` is unreachable-broken:** plan publication refuses a
  `cancelled`/`superseded` node without a recorded reason
  (`src/core/store/issues/plans.ts:209-215`), so the gate's `reason ?? ''`
  fallback cannot produce an empty reason through any published plan.

### 2.2 Continuity + retarget pins (anti-theater)

- Continuity mutation check (task 1.5) is a live test, not a comment:
  `issue-revision-continuity.test.ts` "mutation check: the continuity pin
  detects a real run-state change between readings" perturbs run-state between
  readings, asserts detection (`in-flight` + row inequality), then restores and
  re-verifies. Passed in focused-1.
- Retarget group's teeth-path is the refusal pin (2.1): old instance under new
  project → `issue_reference_scope_conflict` naming both scopes, and no
  revision file created. Fresh-lineage (2.2), evidence-carrying (2.3,
  attribution pinned to the NEW alias's run-state path), and intent-node (2.4)
  pins all assert the designed rule; prior-revision readability goes through
  `resolveExecutionPlan` on the prior ordinal — the same read
  `confirm --review` composes. Passed in focused-1.
- Reviewer-executed mutation checks (below, section 4): two source mutations,
  both seen to bite.

### 2.3 No overreach

- `git diff abc2ad14 -- src/core/pipeline-registry pipelines packages/ui
  package.json` — byte-empty. No version bumps anywhere.
- `git diff abc2ad14 -- src/core/issue-status/` — byte-empty: no projection
  code change; the invariants are stated + pinned, not re-derived. The only
  command-layer change is render-only (`renderAcceptWrite`,
  `renderAcceptanceSection` — additive exclusion lines over `?? []`); no new
  subcommand or parser change (verified by filtering the added lines).
- Prior touches strength-argued (local-gates.md): no tracked test file is
  modified by the delta (git status: only 6 src/doc files changed, 5 new
  untracked suites) — the pre-change suites pass unedited, so their green is
  genuine strength for byte-compatibility.
- Task 5.3 wire-mirror check: no `packages/ui` wire type mirrors the accepted
  record (grep: zero hits; the UI does not consume the Issue store layer);
  `issue-acceptance/types.ts` reuses `IssueAcceptedRecordV1` itself (import,
  not a mirror), so it widened automatically. Architecture-index updated in
  the sanctioned way (`spec-store-engine.md` one line).

### 2.4 Spec deltas

- `issue-status-projection` ADDED ×2: both titles novel (no collision with the
  8 existing requirement titles); each requirement's first line carries its
  SHALL; scenarios are new (no rename of existing scenario titles).
- `issue-acceptance-close` MODIFIED: title byte-stable against
  `rasen/specs/issue-acceptance-close/spec.md:141`; both pre-existing
  scenarios retained byte-stable ("The record freezes what was accepted",
  "A tampered record never presents as done") — no implicit scenario delete;
  the requirement's purpose (durable, never-rewritten, digest-verified close
  evidence) is retained verbatim and extended, not replaced; the refusal
  sentence is preserved word-for-word.
- `node bin/rasen.js validate issue-revision-history-preservation` — exit 0
  (re-run myself).
- New files whitespace-clean (no trailing WS, no tabs); CRLF-on-disk is
  normalized to LF blobs by the default autocrlf on a normal `git add` (the
  memory trap is only `core.autocrlf=false add` — shipper note, not a defect).

## 3. LEAD-executed gate adjudication — spot-check

The decisive claim — the change's own surface green solo — is CONFIRMED:
`issue-status-projection.test.ts` re-run solo by me: **1 file / 25 tests /
exit 0**. The adjudication's failure enumeration is fully itemized (13 files:
6 known machine-state cluster + 7 ambient/spawn-family each adjudicated solo),
consistent with the known-cluster memory; zero failures attributable to this
delta is credible given focused-1/-2b re-greens and the record-family greens
in focused-2b (144/144, which includes `store-issue-acceptance-cli` — one of
the adjudicated ambient families).

## 4. Reviewer-executed mutation checks (the documented set, run by me)

Two source mutations, each landing-site-count-verified (exactly 1), run in
isolation, then restored by byte-copy (the delta is uncommitted — restore is
never `git checkout`). Tree fingerprint before and after BOTH mutations is
byte-identical (`09e12c3e…dd3bf`), so the reviewed delta is exactly what was
verified.

- **M1 — the digest-body omission is guarded, not decorative.** Patched
  `acceptedRecordDigestBody` to include `exclusions` unconditionally (even
  empty). Result: `store-issue-acceptance-content.test.ts` 2 tests failed —
  decisively the pre-existing hand-copied anchor
  `expected '1f9446f9…' to be '3487ff0093d3…'` — vitest exit 1. The
  non-symmetric anchor genuinely predates the change and genuinely bites on
  digest-body drift for the no-exclusion form. (The new exclusions suite stays
  green under M1 — its identity assertions are symmetric, exactly as
  local-gates.md argues; the content anchor is the one that catches it.)
- **M2 — the carry is real, not decorative.** Patched `acceptIssue` to drop
  `exclusions: gate.exclusions`. Result:
  `store-issue-acceptance-exclusions.test.ts` failed at the verbatim-carry
  test — `expected undefined to deeply equal [ { nodeId: 'g-sup', …(2) } ]` —
  vitest exit 1. The record genuinely writes the evaluation's exclusions.
- The two in-suite mutation checks (task 1.5 continuity detection with
  restore-and-reverify; task 3.7 hand-edited reason refusing the digest) ran
  green inside focused-1/focused-2b — their assertions are themselves the
  bite-proofs (they assert DETECTION, so a green pass is the demonstration).

## 5. Findings

- **[Minor-1] `evidence/local-gates.md` carries a stale self-reference.**
  Line 6 promises summaries in "`focused-summaries.txt` and `bin-summaries.txt`
  beside this file" — no `bin-summaries.txt` exists — and line 47 still reads
  `BINNED-TABLE-PENDING`, a placeholder the LEAD-executed
  `binned-suite-adjudication.md` superseded. Failure scenario: an auditor
  reading local-gates.md for task 5.2's record hits a dead end / an unfilled
  placeholder and cannot tell whether the binned gate ran. Fix: replace the
  placeholder section with a pointer to `binned-suite-adjudication.md` and drop
  the `bin-summaries.txt` mention. Evidence-shape only; the gate itself was
  executed and is adjudicated.
- **[Minor-2] Proposal Impact file list under-names the touched surface.**
  `proposal.md` Impact names `acceptance.ts`+`types.ts` and
  `orchestration.ts`; the delta also touches `src/core/store/issues/module.ts`
  (the `StoreIssues.accept` seam where the field is actually written) and
  `src/commands/store-issue.ts` (the two renderers). The design (D3) describes
  both surfaces, so substance and delta agree — the Impact enumeration is
  merely incomplete. Failure scenario: a future reader diffing Impact against
  the delta sees two unexplained files. Fix: one-line Impact addition naming
  both.
- **[Info-1] Task 3.3 named `store issue acceptance` as a record read surface;
  it is publish-only.** The implementer found this, corrected to the real
  surfaces (`accept`'s write result + `show`'s acceptance block, human and
  `--json`), and documented it in `implementer-findings.md` #3; the spec delta
  is phrased surface-agnostically ("a read surface that presents the record").
  Task checked with an honestly documented deviation — no action needed.
- **[Info-2] Worktree hygiene for the shipper.** The worktree root carries
  untracked LEAD tooling (`scripts-tmp-binned-suite.py`, `.rasen/run-bins.mjs`,
  `.rasen/*.json` probe files) that must NOT ride along in the ship commit;
  commit with a narrow pathspec (the shared-tree discipline). Not part of this
  change's delta.

## 6. Numbers I ran (all exit codes from the spawn status)

- `pnpm run build` — exit 0.
- vitest groups (exit / files / tests): focused-1 0/17/99; focused-2b 0/11/144;
  focused-2a 1/7/34 (1 ambient, adjudicated); solo `issue-status-projection`
  0/1/25; new-suites 0/5/17; solo `store-issue-status-cli` (adjudication
  re-run) 0/1/6.
- Real-store read-only re-read (3 accepted records, new parser,
  `verifyDigest: true`) — exit 0, all three verify, none carry exclusions.
- `node bin/rasen.js validate issue-revision-history-preservation` — exit 0.
- Mutations: M1 exit 1 (content anchor red), M2 exit 1 (carry test red);
  restores verified by tree fingerprint `09e12c3e…dd3bf` unchanged.
- Fences: `git diff abc2ad14 -- src/core/pipeline-registry pipelines
  packages/ui package.json` empty; `git diff --check` clean; no version bumps;
  `src/core/issue-status/` byte-untouched.

## 7. Round-1 re-review (reviewer-1, 2026-08-22)

**CLEAN — APPROVE stands.** Both Minors fixed as claimed:
- Minor-1: `local-gates.md` 5.2 section now names `binned-suite-adjudication.md`
  as the record of authority (whole-file grep: zero `bin-summaries` hits, zero
  `PENDING`; the dead end is gone).
- Minor-2: `proposal.md` Impact now carries the
  `src/core/store/issues/module.ts` + `src/commands/store-issue.ts` bullet,
  described accurately per D3 (accept seam with empty→absent canonicalization
  + the two renderers).
The two Info items stand as dispositioned (documented deviation; shipper
note).

## 8. Conclusion

Every claim in the proposal/design/tasks that this review could execute or
inspect held up: the carry is durable and guarded on both compatibility edges
(byte-identity pinned twice, pre-field records re-verified against the REAL
store by me), the continuity/retarget/totality pins are live tests whose
mutation paths bite (two reviewer-executed plus two in-suite), the fences are
byte-empty, the spec deltas are clean against the synced truth with no
scenario renames and the MODIFIED purpose retained, and the LEAD's binned
adjudication spot-check (the change's own surface, solo) reproduces 25/25
green. The two Minors are evidence-shape and proposal-enumeration hygiene
only — neither blocks ship.
