# Post-merge review: store-v2-onto-020

Written in English deliberately: the Write tool corrupts multibyte text in this repo.

Scope: the bounded, claim-swept review proposed after lead-5 declared the workstream
terminal. Four audit items, executed 2026-08-16 against dev/0.2.0 tip `222eb0f6` (this
worktree's tree, on `chore/store-v2-l4-tail` @ `6aa7e1b4` = tip + the lead-5 handoff doc):

1. Dropped-file reconciliation (0.1.7 tip vs 0.2.0 tip over the ported surface).
2. Coverage audit of the retired `archive-validate-defects.test.ts` (B1-B6 classes).
3. Verification of every claim in `handoff/lead-5.md` against the tree.
4. Adversarial pass over the three collision zones (archive-engine replacement,
   finalization bridge, L7 seams).

Verdict up front: **NO DEFECTS FOUND. All four items close CLEAN.** One observation
(pre-existing, out of the port's declared scope) is recorded at the end for the operator.

Reference points used throughout:

- 0.1.7 tip = `a3f49007` (2026-08-12, predates the port window 08-13..16 - no
  reference-line drift to account for).
- 0.2.0 tip = `222eb0f6` (merge of #162).
- Port line = `e9b9c695` (post-#159) .. `222eb0f6`: 215 files, +67,516/-4,685,
  exactly ONE deletion (`test/core/archive-validate-defects.test.ts`).
- Slice-1 line = `e2e5e7b8`..`e9b9c695` (PR #157/#158/#159).

## 1. Dropped-file reconciliation - CLEAN

Method: compare file sets and content between the two tips per module, then classify
every divergence by the commit that introduced it on the 0.2.0 line.

- `src/core/store/**`: file sets IDENTICAL (88 files each way; zero dropped, zero
  added). The port line's 41-file store diff (+14,683) brought the L2/L8/L3+L5 modules
  up to byte-parity with the 0.1.7 tip for everything not in the classified list below.
- All of `src/core`: the only 0.1.7 files absent on 0.2.0 are six
  `templates/experts/*` files (codebase-design, navigator, prototype, qa-only, tdd,
  workflow-review) - the deliberate 0.2.0-side single-host expert consolidation
  (`68b3d7da`, PR #126), never in this port's scope. Not a loss.
- Archive-path sources (`archive*.ts`, `management-api/archive.ts`): path sets
  identical; `archive-engine.ts` is byte-identical between tips (the "wholesale
  replacement" claim means 0.2.0 now runs 0.1.7's engine verbatim - confirmed).

Content divergence: exactly 15 files in `src/core/store`, +429/-91, ALL classified:

| Divergence | Files | Origin commit | Class |
|---|---|---|---|
| Uncommitted-Change refusal (`issue_reference_uncommitted`) | issues/reference-verification.ts, issues/types.ts | `10b74431` (slice-1 BLOCKER-1) | slice-1 fix #1, kept |
| Declared-empty-line groups + unreadable-item reporting (AggregateProblem, presentedDiagnostic) | query/module.ts, query/refs.ts, query/issues-read.ts, query/types.ts, query/index.ts | `f46ffc13` (B-V1/B-V2) | slice-1 fix #2, kept; strictly additive |
| Plan-node canonical order + NodeSchema enforcement | issues/plans.ts | `9ece8b5d` (MAJOR-1) | slice-1 fix #3, kept |
| Ambiguity tightening (two committed candidates are ambiguous even in one scope) | query/references.ts | tips AGREE; the port line re-applied the tightened form during the L-slice collisions | slice-1 fix #4, kept through collision |
| reason permitted in any state; non-throwing `findPlanNodeSchemaProblems` | issues/types.ts, issues/plans.ts | `10b74431`, `9ece8b5d` | 0.2.0 daemon-surface additions |
| `u0000` -> `\x00` escape style | planning-catalogs, planning-identity, planning-validation, issues/records, finalization-v2 | slice-1 landing (`eaefc01b`, `af6f3e9d`) | style normalization, semantically identical |
| `isAbsoluteStoreRoot` (current-drive-rooted `/store` no longer "absolute" under win32 semantics) | planning-layout-v2.ts | `eaefc01b` | slice-1 strictness, 0.2.0-side |
| Orphan doc-comment deletion | project-records.ts | slice-1 line | benign; the reserved-names list and its enforcement live in planning-validation.ts on BOTH tips (verified at the call sites) |

Nothing removes 0.1.7 behavior on 0.2.0 except the classified slice-1 strictness items,
each of which is a deliberate fix lead-5 named. No unexplained drift anywhere in the
ported surface.

## 2. Retired-suite coverage audit - CLEAN

The retired `archive-validate-defects.test.ts` (0.2.0's own B-fix contract suite, PR
#153) encoded five defect classes across 19 tests. Class-by-class mapping on the tip:

| Class (retired tests) | Live coverage on 0.2.0 |
|---|---|
| B1 apply-time merge confirmation / timing gate (5 tests incl. a mutation test) | `archive-engine.test.ts:742` (apply-time consumption, saved plan stays byte-identical), `:775` (token identity), `:887` (confirmation cannot bypass an unrelated blocker); `finalization-plan-token.test.ts`; `store-finalize-api.test.ts` (12 mergeConfirmed refs) |
| B2 scenario preservation, strict vs warn split (2 tests) | `validator.ts` escalates `spec_modified_scenarios_missing` ERROR-strict / WARNING-plain with `missingScenarios` carried; asserted WARNING + exitCode 0 at `store-add-project.test.ts:285-303`; ERROR path in the finalization suites |
| B3 all failing requirements in one pass (1 test) | `store-finalize-api.test.ts:736-749` (two requirements' dropped scenarios reported in one payload); fault-matrix asserts all four sidecar blockers in one plan |
| B4 strict-intent rejections name the offending constraint (7 tests) | `archive-engine.test.ts:2010-2056` (unexpected key + accepted-keys list, exact `#/...` paths); `archive-fault-matrix.test.ts:1505-1545` (missing change/handoff/probes/schemaVersion keys, typed codes, exact paths, all in one pass) |
| B6 reserved ship-log heading rejection (3 tests incl. a mutation test) | `archive-engine.test.ts:3406` (reserved section is a typed planning blocker); fault-matrix sidecar rows |

The supersession claim holds at the class level: every defect class the retired suite
guarded is guarded on the tip, mostly by the ported 0.1.7 suites that encode the same
contracts more deeply (fault injection instead of hand-built breakage). One nuance,
recorded for honesty: the retired suite's two explicit MUTATION TESTS have no 1:1
twins; the fault-matrix's injected-fault design exercises the same guards, which we
accept as subsumption, not identity.

## 3. Lead-5 claim verification - ALL VERIFIED

- Port ledger: all 14 commits exist with matching subjects (`964acecc` `4bdb53ba`
  `4dfebd59` `789643c0` `a675dd43` `7cb155c9` `9cc328bf` `ed301828` `73c3fc94`
  `8a62be08` `3bd1513b` `6fcd75b7` `2a9e904a` `e61c499d`).
- `finalization_outcome_required`: `store/finalization/outcome.ts:50` + types + CLI/e2e
  tests; the single/bulk/in-ship generated consumers all route through the one pure
  resolver (`archive-consumer-invocation.ts`), so no consumer can express a refused
  combination.
- `--store X --project Y` pairing: the finalize route's documented invocation
  (`management-api/finalize.ts:13`) and the L6 `session-launch-context` module.
- Legacy flat stores read-only until migration: `store/layout-write-guard.ts` (design
  D12, no-dual-write) refuses partition writes on flat stores and names
  `rasen store migrate-layout <store-id>`.
- uid-addressed Store HTTP route family: `management-api/stores-routes.ts`
  (GET issues / issue plans / projects / lines / changes; POST issues / plans) plus
  `POST .../changes/:instance/finalize`.
- omp fourth runtime with context reader: `runtimes/context-readers.ts:30`,
  `runtimes/session-stores.ts:112`.
- Wholesale archive-engine replacement: `archive-engine.ts` byte-identical to 0.1.7's;
  `archive.ts` = 0.1.7 body + the ECP association-ledger hook (capture block and
  ledger-update block diffed against the pre-port 0.2.0 file: CODE identical, comments
  expanded only - "re-grafted verbatim" holds at the code level) + the stored-plan
  wrapper, which is the L3+L5 port itself.
- Retired suite = the port line's only file deletion (verified above).
- `GIT_OPTIONAL_LOCKS=0` in the finalize bridge child env: `management-api/finalize.ts:281`.
- finalize-api 36/36 zero skips: LIVE-VERIFIED on this NTFS Windows machine (the
  original flake platform): 36 passed / 36, 0 skipped, 283.98s, `vitest run
  test/core/management-api/store-finalize-api.test.ts`.
- L4 tail: `e61c499d` routes claude-print availability facts through
  DISPATCH_ADAPTERS (3 refs in `commands/agent.ts`); codex keeps `RASEN_CODEX_BIN`
  precisely because the registry's codex entry declares no `binaryEnvVar`
  (`agent.ts:452-457`, `runtimes/dispatch-adapters.ts:28,40`).
- CI-round fixes present: `.gitattributes` pins `test/fixtures/** text eol=lf`;
  `test/helpers/fs-snapshot.ts:21` skips `.git/objects/maintenance.lock`.

## 4. Collision-zone adversarial pass - SOUND

- Archive replacement zone: engine bytes identical; the only graft points are the ECP
  hook (code-verbatim, post-transaction, best-effort - the same contract the replaced
  file carried) and the stored-plan operation wrap. B1 coexistence (`mergeConfirmed`)
  is pinned by the ported engine tests (742/775/887) and the finalize-api suite.
- Finalization bridge: optional-locks env fix present; the whole route suite re-run
  green locally on the platform that produced the original flake.
- L7 seams: route family present with typed refusals; `spec_modified_scenarios_missing`
  and aggregate-completeness surface through both HTTP and CLI; `complete` is false on
  unsearched refs AND unread items, neither silently omits.
- Bulk path: no engine gap - every consumer kind passes the one outcome resolver, so
  the leaner bulk skill text cannot bypass the gate (see observation below for the UX
  side of this).

## Observations (not defects - operator decisions)

1. **Skill-text parity gap, pre-existing and out of the port's scope.** 0.1.7's
   `templates/workflows/archive-change.ts` and `bulk-archive-change.ts` carry
   agent-facing guidance the 0.2.0 versions lack: the store-finalization hard gate
   (ask for `--outcome` BEFORE planning), typed `root.scope.paths` addressing, the
   reserved-heading pre-check, and the per-item PR merge-gate discipline. The port line
   made ZERO commits to these files (verified); the divergence predates it, and on
   0.2.0 the same gates are enforced by the ENGINE instead. Consequence: an agent
   driving archive through the 0.2.0 skill will learn the outcome gate from a runtime
   refusal rather than from its instructions (extra round-trip; the bulk flow loses the
   refuse-the-whole-batch courtesy). If that agent-UX parity matters, back-porting the
   richer skill text is a small, separate decision - it was correctly not smuggled into
   the port.
2. The retired suite's explicit mutation tests are subsumed by the fault-matrix's
   injected-fault design, not replaced one-for-one (see item 2 nuance).
3. Housekeeping: this worktree carries an untracked `.tmp-ci-watch.sh` (session
   residue, safe to delete) and the un-merged lead-5 handoff commit `6aa7e1b4`.

## Bottom line

The terminal declaration stands on verified ground: no dropped files, no lost defect
classes, no false claims in the handoff, no holes in the collision zones. The two
operator-owned items from lead-5 (direction bookkeeping; 0.1.7 back-port decision)
remain the only open questions, now joined by the optional skill-text parity decision
above.

**Addendum (same day):** observation 1 was executed after this review, with the
operator's go-ahead, as a selective graft onto the 0.2.0 templates: the
finalization hard-gate paragraph (single + bulk, adapted to 0.2.0's observable
`--project` / `--store <id> --project <id>` selection instead of 0.1.7's
`root.scope.kind` payload, which 0.2.0 does not emit), the bulk reserved-heading and
recorded-PR-delivery pre-checks (3d/3e), and the per-item merge-gate resolution
(new 8a). 0.2.0's own additions (task-loop guard, leaner engine-era sync text) were
kept. The pipeline capability pins for `skill:rasen-archive-change` in the five
shipped pipelines and the builtin package-audit/parity hashes were re-baselined to
the new content digests (same coordination pattern as `34d91322`). Templates dir
100/100, adjacent suites 667/667, tsc and eslint clean; local generated skills
regenerated via `rasen update` (gitignored artifacts, not committed).
