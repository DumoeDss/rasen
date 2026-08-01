# Saved PR audit traceability

Date: 2026-08-01

Historical input (immutable):
`docs/audits/pr-121-file-placement-0.1.6-review-2026-07-31.md`

The saved audit remains `CHANGES_REQUESTED`; this matrix records remediation
against the current working tree without rewriting that historical verdict.

| Saved finding | Owner | Clean review authority | Focused/static proof | Closure state |
| --- | --- | --- | --- | --- |
| Blocker 1 — standard archive workflows bypass the engine | archive-engine | archive review, Strategy attempt 2: CLEAN | real-Commander single/bulk/in-ship integration plus consumer golden/parity suites | local focused and frozen repository gates pass; native recovery CI pending delivery |
| Blocker 2 — cleaner deletes malformed state / misses source trees | migration-safety | migration final review and review cycle: CLEAN | cleaner, archive ephemera, and engine cases cover malformed/future/recursive source/blocker/exact disposition | local focused and frozen repository gates pass; native recovery CI pending delivery |
| Blocker 3 — migration preview hides recursive deletion | migration-safety + root-routing | both child reviews: CLEAN | one immutable plan reference and visible destructive disposition under drift | local closure gate passed |
| Blocker 4 — never-overwrite migration TOCTOU | migration-safety | migration review and cycle: CLEAN | file/directory concurrent target, copy-child race, exclusive publication, and source-removal failure regressions | local focused and frozen repository gates pass; native recovery CI pending delivery |
| Blocker 5 — `--change` does not scope global phases | migration-safety | migration review and cycle: CLEAN | scope filtering precedes filesystem inspection; unrelated global paths are not probed or mutated | local closure gate passed |
| Major 1 — archive can leave inconsistent half-archive | archive-engine | archive review, Strategy attempt 2: CLEAN | engine/fault matrix covers staging, no-clobber publication, journals, recovery, terminal alerts, and source-last deletion | local focused and frozen repository gates pass; three native recovery jobs pending delivery |
| Major 2 — archived run-state reported discarded but remains | migration-safety | migration review and cycle: CLEAN | archived deletion byte/state assertions, failure accounting, and second-run no-op | local closure gate passed |
| Major 3 — Store execution routing not end-to-end | root-routing | root-routing Round 2: CLEAN | Store/linked-worktree migration/session suites and deterministic path-flavor cases | local focused and frozen repository gates pass; native recovery CI pending delivery |
| Major 4 — archive dry-run incomplete | archive-engine | archive review, Strategy attempt 2: CLEAN | saved-plan CLI cases cover blockers, sidecar/handoff/probes, keep mode, exact disposition, and token apply | local closure gate passed |
| Major 5 — quality capture misses `evidence/` | archive-engine | archive review, Strategy attempt 2: CLEAN | engine/accounting suites recursively inventory finalized evidence and quality metadata before hashing | local closure gate passed |
| Major 6 — sidecar/filesystem errors fail open | migration-safety + archive-engine | both final reviews: CLEAN | typed non-`ENOENT` blockers, strict sidecar/probe/Git validation, and manual-only terminal failure cases | local focused and frozen repository gates pass; native recovery CI pending delivery |
| Minor 1 — authoritative design stale | closure | reconciliation ledger plus strict validation | design-to-main-spec sweep, `208/208` main specs valid, closure change strict-valid | local closure gate passed |

## Acceptance rule

No row is closed by prose alone. The local test-result gate is complete only
because the fresh frozen eight-partition union exactly equals the 341-file
manifest and all summaries/exits/counts pass. Process cleanliness is
`NOT EVALUATED`. Native Ubuntu/macOS/Windows acceptance remains pending until
delivery attaches remote URLs and successful results for all three jobs.
