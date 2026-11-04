# ADR: Retain observations through existing ownership seams

Status: Accepted for this Change.

## Source evidence

This decision uses direct source inspection, not a runtime retention experiment:

- `src/core/templates/experts/_shared.ts`, `DISPATCH_CONTRACT`, restricts dispatched report-only experts to their canonical report. Ordinary stage writers have different write permissions; the shared evidence module must not turn every dispatched writer into a reviewer.
- `src/core/archive-engine.ts:2904-2917,2951-2959,3250-3268` fingerprints and copies the active Change payload separately from execution-local ephemera cleanup. `projectArchiveCleaner` at lines 1331-1374 makes `keepEphemera` preserve local candidates and empty `effectiveDelete`; it does not add their bytes to the archive payload.
- `src/core/archive.ts:1430-1439` records `keepEphemera` in plan inputs. `applyStoredPlan` at lines 939-974 rejects planning options, including `keepEphemera`, on token application. `src/core/archive-consumer-invocation.ts:55-60` separates saved preview from token-only apply.
- `src/core/templates/experts/benchmark.ts` owns the standalone `.rasen/benchmark-reports/` and `baselines/` instructions and the metrics JSON shape. `src/core/templates/workflows/goal-report.ts` reads the authoritative `goal-run.json`; a fresh gate execution cannot establish its past judgments.

## Decision

Keep the implementation in source guidance. A report-only expert records unresolved retention in its canonical report; the LEAD routes that work to an authorized writer before cleanup or saved-plan creation.

For required observations in ephemera, the writer creates a new, non-overwriting snapshot under the resolved `evidenceDir`, retains the original base/locator, byte size and SHA-256, verifies the saved snapshot against those captured bytes, and updates the report reference. This includes the resolved `loop.runArtifact` when a ship log or report cites goal-gate judgments, for code-producing and research pipelines. Live run-state stays at its authoritative location until the existing cleaner decision. Access and destination write/publication authorization are required; a reference never authorizes copying private bytes.

Explicitly approved LOCAL-only retention may instead use `--keep-ephemera` on `--dry-run --save-plan`, never on `--apply-plan`. This preserves local availability, not archive delivery. If neither retention path is authorized and available, report the missing disposition and do not authorize cleanup. Missing legacy recipes alone introduce no gate.

New standalone benchmark originals use collision-free, Windows-safe timestamp/UUID tokens in the existing filename forms and directories. Completed reports cite immutable baseline/run records by locator, byte size and SHA-256. Baseline capture remains a normal supported operation. Automatic comparison considers only applicable baseline records ordered by their recorded observation timestamp, not newer filenames from copying old bytes or non-baseline runs; unknown ordering is reported.

## Compatibility and trade-offs

`baseline.json` can remain a byte-identical current WORKING metrics snapshot for existing readers: a disposable compatibility cache, not a pointer schema or a second authoritative observation. Before replacing bytes still required by a historical report, preserve and byte-verify their immutable original and record `old locator + captured SHA-256 -> retained locator`, with byte size, in the new report. Do not imply the working locator is immutable. If source or authorization is unavailable, state that retention limitation and leave the working file in place. If a historical report requires the old locator unchanged, leave it there as well; new capture uses its new immutable baseline directly. Keep legacy reads and historical report names; do not rewrite historical reports or archives. Baseline-capture reports reference the baseline original without another measurement copy.

This accepts one regenerable working copy for compatibility and an authorized evidence snapshot where a live legacy location must stay in place. It adds no runtime helper, executor, schema, configuration, cleaner override, hand-edited manifest, or new report hierarchy. Canonical verdicts, `TEST EVIDENCE`, Store selectors, sticky-legacy state, and archive ownership remain unchanged.

## Delta encoding

`src/core/specs-apply.ts:657-672` requires a MODIFIED requirement to preserve current scenario identities. Retiring a hash-gate requirement and its hash-specific scenarios therefore uses explicit REMOVED plus ADDED replacement requirements with migration notes, not renamed scenarios inside MODIFIED. The reference-cleanliness requirement keeps its existing scenario identities and remains MODIFIED. This uses existing delta semantics without weakening the validator or changing canonical specs directly.
