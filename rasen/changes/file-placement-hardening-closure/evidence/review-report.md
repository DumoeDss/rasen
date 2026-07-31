# Independent closure review report

Date: 2026-08-01

Mode: dispatched, report-only, independent non-author review

Baseline / current committed HEAD: `04cea87ae5bea9af2d90f526455b6ea513cd57e8`

Branch: `fix/pr121-file-placement-hardening`

## Current verdict

**CLEAN — 0 Blockers, 0 Majors, 0 Minors, 0 Trivial.**

All four initial findings and the documentation-traceability Minor exposed in
remediation round 1 are closed. No new finding was identified in round 2.

Scope check: the implementation remains directed at the approved 0.1.6 file-placement hardening and its closure gates. The Windows legacy-lock correction is separately owned and evidenced, not hidden closure scope. No unrelated product feature was identified.

## Initial findings (historical; all closed in remediation round 1)

### [CLOSED] Blocker 1 — the discovered Windows-lock child was absent from the normative and durable contract union

**Location:** `rasen/changes/file-placement-hardening-windows-lock-contention/specs/opsx-pipeline-registry/spec.md:3-24`; omission visible at `rasen/specs/opsx-pipeline-registry/spec.md:711`, `rasen/changes/file-placement-hardening-closure/evidence/contract-reconciliation.md:5-64`, `rasen/changes/file-placement-hardening-closure/tasks.md:14`, `rasen/changes/file-placement-hardening/planning-context.md:102-105`, `rasen/changes/file-placement-hardening/decomposition-plan.md:5-13`, and `docs/zh/file-placement-and-planning-roots.md:19-21`.

**Confidence:** 100%.

**Impact:** the implemented and independently reviewed behavior for bounded Windows `EPERM`/`EACCES`/`EBUSY` legacy-lock contention exists only in an active child delta. The main `opsx-pipeline-registry` spec contains none of the child's requirement or three scenarios, while the closure ledger/task claim that no child requirement was dropped and the durable parent/design text still describe only the original three implementation children. Shipping or later retiring the portfolio in this state would leave the normative main-spec graph and durable decomposition record incomplete.

**Evidence:** exact requirement/scenario comparison found every requirement and scenario from migration-safety, archive-engine, root-routing, and closure in its destination main spec (allowing the documented semantic rename of archive bookkeeping), but found all four headings from the Windows-lock delta absent from the main spec. The parent portfolio and changed-path inventory already recognize this fourth implementation child, so this is not an intentionally external change.

**Required remediation:** semantically merge the Windows-lock requirement and its three scenarios into `rasen/specs/opsx-pipeline-registry/spec.md`; add the child to the reconciliation ledger, parent DAG/durable context, authoritative-design status, and affected-path inventory; then re-run strict main-spec validation and the semantic-union check.

### [CLOSED] Major 1 — `test-partitions.md` contradicted the accepted frozen partition snapshot

**Location:** `rasen/changes/file-placement-hardening-closure/evidence/test-partitions.md:1-67` versus `rasen/changes/file-placement-hardening-closure/evidence/fresh-final-test-snapshot.json:2070-2167` and `rasen/changes/file-placement-hardening-closure/evidence/direct-partition-results.md:9-24`.

**Confidence:** 100%.

**Impact:** `test-partitions.md` is titled “Deterministic Vitest partition manifest,” reports 341 files, and is not marked historical or superseded, yet it does not describe the reports accepted by closure. An auditor following that file cannot reproduce the accepted per-partition runs and can reach a different membership conclusion despite the correct authoritative snapshot.

**Evidence:** partition 1 matches, but partitions 2–8 differ from the frozen snapshot by respectively 40, 35, 31, 27, 20, 30, and 28 assignments in each direction — 211 of 341 assignments are placed differently. For example, its P2 begins with `test/commands/change-initiative-link.test.ts`, while frozen P2 begins with `test/cli-e2e/agent-context.test.ts`. Independent parsing confirmed that each accepted raw report matches the snapshot's own partition exactly, so the snapshot/reports are coherent and this Markdown manifest is stale pre-freeze evidence.

**Required remediation:** regenerate `test-partitions.md` directly from `fresh-final-test-snapshot.json` (preferred, because tasks 6.3/6.4 require the recorded per-partition manifest), or rename and label every section unambiguously as invalid/superseded pre-freeze history and remove any implication that it describes the accepted sequence.

### [CLOSED] Minor 1 — snapshot field and digest semantics were not fully reproducible from the evidence text

**Location:** `rasen/changes/file-placement-hardening-closure/evidence/fresh-final-test-snapshot.json:9-19`, `:2070-2072`, and `:2459`; `rasen/changes/file-placement-hardening-closure/evidence/direct-partition-results.md:16-24`.

**Confidence:** 100%.

**Impact:** the evidence correctly distinguishes the raw snapshot-file hash from the declared canonical-content hash, but it does not define the canonical bytes. In addition, every `partitions[].count` is `8`; without an explanation, that field can be mistaken for a per-partition file count even though the actual file counts are the top-level `partitionCounts` values `43,43,43,43,43,42,42,42` (or each `files.length`). This is audit friction rather than a failed gate because the attached files allow independent recomputation.

**Evidence:** independent recomputation established that `manifestSha256` is the SHA-256 of the UTF-8/LF/trailing-newline bytes in `test-manifest.txt`, and `snapshotSha256` is the SHA-256 of compact `JSON.stringify` output for the snapshot object with only `snapshotSha256` omitted. The current report states neither formula, and never says `partitions[].count` is the `N` denominator/total partition count paired with `index`.

**Required remediation:** document those exact byte formulas and explicitly define `partitions[].count` as the total partition denominator, with `partitionCounts`/`files.length` as the per-partition file counts.

### [CLOSED] Minor 2 — the final changed-path inventory did not account for this required review artifact

**Location:** `rasen/changes/file-placement-hardening-closure/evidence/changed-path-inventory.md:135-190`; `rasen/changes/file-placement-hardening-closure/evidence/release-evidence.md:102-109`.

**Confidence:** 100%.

**Impact:** the inventory and release evidence say all 39 modified tracked paths and 111 untracked paths are classified, but the dispatched workflow requires this canonical `evidence/review-report.md` and the closure-owned list does not include it. Once this report exists, the final untracked count is one higher and the “all paths classified” statement is stale.

**Required remediation:** add `rasen/changes/file-placement-hardening-closure/evidence/review-report.md` to the closure-owned inventory and refresh the final status counts after all review/fix rounds, while continuing to exclude the seven untracked `.rasen/.../ephemera/*.json` files from deliverables.

## Verified surfaces

- The dedicated `file_placement_recovery` job uses `ubuntu-latest`, `macos-latest`, and `windows-latest`, Node `20.19.0`, `VITEST_MAX_WORKERS: 1`, and the explicit archive engine/fault/path/accounting/ephemera/cleaner files. `test_pr_required`, `required-checks-pr`, and `required-checks-main` all depend on both the general matrix and this native matrix. Independent focused run: `test/ci-workflow-contract.test.ts`, 3/3 passed.
- Independent parsing of the frozen snapshot and eight accepted JSON reports proved 341 assignments and 341 unique report paths, exact per-partition membership, zero duplicate/missing/extra paths, zero size/SHA drift, 1,492/1,492 passed suites, and `5,946 = 5,912 passed + 34 pending + 0 failed + 0 todo`. All raw report byte lengths and SHA-256 values match `direct-partition-results.md`.
- The old `6,050 = 6,012 + 38` aggregate is consistently marked **INVALID / SUPERSEDED**. The P4, P6, and P8 initial failures and fixed-report hashes are retained. P6 remediation preserves the five exact 0.1.6 diagnostic projections with `archive: null`, adds the immutable top-level plan, and tests zero apply for malformed-sidecar and target-`EACCES` blockers; its independent re-review is recorded CLEAN. P4 is owned by the separate Windows-lock child; P8 preserves the runtime `windowsHide: true` call and changes only type syntax.
- The retired kill-capable runner and ownership helper are absent and untracked. Searches found no executable residual reference or replacement kill capability. The incident record preserves the unrelated Vite-process terminations and later PID-reuse/runner failures; all runner outputs are superseded. The accepted protocol performs no custom/manual termination and states process cleanliness as `NOT EVALUATED`.
- Package version is `0.1.6`, the Node engine floor is `>=20.19.0`, and `package.json`/lockfile are unchanged. Archive JSON compatibility is additive, existing CLI forms and the hidden `experimental -> init` alias remain present.
- Remote Linux/macOS/Windows native recovery URLs/results, required aggregate result, commit, push, PR update, and archive are explicitly pending in `handoff/delivery.md`; closure does not claim delivery. `git ls-files -- .rasen` returns no tracked path.
- Independent static gates: closure strict validation 1/1 valid; main-spec strict validation 208/208 valid (INFO-only long-text suggestions); `git diff --check` exit 0 with only checkout line-ending warnings.

## Standards axis

No additional implementation-standard finding was identified in the closure-owned CI/evidence delta beyond the evidence-consistency findings above. Child implementation safety/correctness remains supported by its role-isolated review records and the independently reconciled focused/frozen results.

## Spec axis

Initial conclusion: the discovered Windows-lock child had not been incorporated into the main/durable contract union. The original three implementation-child deltas and the closure CI delta otherwise reconciled to their named main requirements/scenarios without an exact-title omission; the evidence package was NOT CLEAN until the stale manifest and auditability findings were corrected.

## Remediation round 1 re-review

### Initial finding closure

- **Blocker 1 — CLOSED.** `rasen/specs/opsx-pipeline-registry/spec.md:712-733`
  now contains the Windows-lock requirement and all three child scenarios once,
  byte-equivalent in substance to the delta. The fourth implementation child is
  also present in the closure proposal/design/tasks/ledger, parent DAG and
  durable context, Chinese design status, and changed-path inventory. These
  records continue to distinguish the four implementation children from the
  three native OS recovery legs.
- **Major 1 — CLOSED.** `evidence/test-partitions.md:1-18` now labels the whole
  document INVALID/SUPERSEDED pre-freeze history, forbids its use for accepted
  reproduction/audit/aggregation, and names only
  `fresh-final-test-snapshot.json` `partitions[].files` plus the matching raw
  reports as accepted. All eight section headings repeat the invalid/superseded
  classification.
- **Minor 1 — CLOSED.** `evidence/direct-partition-results.md:28-37` defines
  `partitions[].count` as denominator `N=8`, file counts as
  `partitionCounts`/`files.length`, and both digest byte formulas. Independent
  recomputation matched manifest
  `144d2e51bf03e05443fc70f9e1ecdb44a1ebc53e28f3dfc35ec460e651fc2b6a`
  and canonical snapshot
  `1b6a03a720da5688b3e370076049de0d7bdb9fb67924736ba658563a3b0d4f09`.
- **Minor 2 — CLOSED.** The canonical review report is now listed at
  `evidence/changed-path-inventory.md:187`. Independent status reconciliation
  produced 40 modified + 112 untracked paths, seven excluded `.rasen` run-state
  paths, 145 deliverables, and zero deliverable paths missing from the
  inventory, matching `evidence/release-evidence.md:117-123`.

### [CLOSED] Minor 1 — three canonical child IDs remain misspelled in the closure design

**Location:** `rasen/changes/file-placement-hardening-closure/design.md:5-7`.

**Confidence:** 100%.

**Impact:** the design's new “four implementation children” list correctly names
the Windows-lock child, but the other three backticked identifiers omit the
`hardening-` segment (`file-placement-migration-safety`,
`file-placement-archive-engine`, and `file-placement-root-routing`). Those
change IDs do not exist, so the otherwise repaired durable traceability list
still cannot be followed literally. This is documentation traceability only;
the ledger, parent DAG, main specs, implementation, and accepted test evidence
are unaffected.

**Required remediation:** change the three identifiers to
`file-placement-hardening-migration-safety`,
`file-placement-hardening-archive-engine`, and
`file-placement-hardening-root-routing`, then re-run the exact child-ID sweep.

### Round 1 verification

- Closure strict validation: 1/1 valid, zero issues.
- Main specs strict validation: 208/208 valid, zero failures; the Windows-lock
  requirement and each scenario heading occur exactly once in the destination
  main spec.
- Snapshot formulas, denominator/file counts, status counts, deliverable set,
  inventory membership, `git diff --check`, and absence of tracked `.rasen`
  paths independently rechecked clean.
- No partition or full-suite test was run in this review round; no frozen test
  input was modified.

## Remediation round 2 re-review

### Round 1 finding closure

- **Minor 1 — CLOSED.** `rasen/changes/file-placement-hardening-closure/design.md:5-8`
  now names `file-placement-hardening-migration-safety`,
  `file-placement-hardening-archive-engine`,
  `file-placement-hardening-root-routing`, and
  `file-placement-hardening-windows-lock-contention` exactly once. All four
  canonical change directories exist. An exact old-ID sweep found zero uses of
  `file-placement-migration-safety`, `file-placement-archive-engine`, or
  `file-placement-root-routing` outside this report's required historical
  finding text.

### Final regression scan

- The Windows-lock delta's requirement and three scenario headings each remain
  present exactly once in the destination main `opsx-pipeline-registry` spec.
  The four-implementation-child scope remains represented across the closure
  artifacts, parent decomposition/context, Chinese design, and changed-path
  inventory, while the delivery records still correctly describe three native
  OS recovery legs.
- `evidence/test-partitions.md` remains globally marked INVALID/SUPERSEDED and
  all eight partition headings repeat that classification. It identifies only
  `fresh-final-test-snapshot.json` `partitions[].files` and matching raw reports
  as accepted evidence.
- Independent digest recomputation still matches manifest
  `144d2e51bf03e05443fc70f9e1ecdb44a1ebc53e28f3dfc35ec460e651fc2b6a`
  and canonical snapshot
  `1b6a03a720da5688b3e370076049de0d7bdb9fb67924736ba658563a3b0d4f09`.
  The denominator fields remain eight, with per-partition file counts
  `43,43,43,43,43,42,42,42`.
- Fresh `git status --short --untracked-files=all` reconciliation remains 40
  modified tracked + 112 untracked paths; seven `.rasen` invocation-state
  paths are excluded, leaving 145 deliverables and zero missing inventory
  entries. No `.rasen` path is tracked. The retired runner/helper remain absent,
  and `git diff --check` exits zero apart from checkout line-ending warnings.
- Closure strict validation is 1/1 valid with zero issues. Main-spec strict
  validation is 208/208 valid with zero failures and INFO-only long-text
  suggestions.
- Remote Linux/macOS/Windows native recovery URLs and results, the required
  aggregate result, commit, push, PR delivery/update, and archive remain
  explicitly PENDING in `handoff/delivery.md` and `evidence/release-evidence.md`.
  These are delivery-time gates, not review findings, and closure still makes
  no delivery claim.
- No partition or full-suite test was run in round 2; no frozen test input was
  modified.
