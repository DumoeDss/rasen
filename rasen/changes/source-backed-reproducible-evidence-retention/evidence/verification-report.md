# Source-backed evidence retention verification

## Status

All 17 Change tasks are complete. The final generated guidance passed isolated CLI installation/update and synthetic retention checks. Local automated checks and Windows/Linux CI results from implementation are recorded below with their scope; the ship gate runs fresh checks against the committed delivery tree. The earlier CI run is not fully green: two macOS jobs were cancelled before acquiring a hosted runner.

| Dimension | Result |
| --- | --- |
| Completeness | 17/17 tasks; 8 capabilities; 15 active requirements (11 ADDED, 4 MODIFIED), with 6 explicit retirements |
| Correctness | 15/15 active requirements and 49 scenarios assessed through source/spec inspection and the applicable smoke evidence below; this is not a claim of 49 runtime tests |
| Coherence | Shared guidance, existing ownership/report contracts, and the retention ADR align; canonical specs remain unchanged pending owner-controlled synchronization |

VERIFY VERDICT: CLEAN — Blocker:0 Major:0 Minor:0 Trivial:2

### Findings

- **Blocker / Major / Minor:** none open.
- **Trivial — accepted-known:** the evidence-retention section in `docs/artifact-workflow-guide.md` has no Chinese counterpart. Explanatory additions in `docs/zh/grill-gstack-absorption.md` are Simplified Chinese; code identifiers and English reference targets are preserved. Recommendation: extend translation coverage to the separate retention section when requested.
- **Trivial — accepted-known:** two canonical spec Purpose paragraphs still describe historical parity machinery. Recommendation: the upstream spec-sync owner updates these non-normative descriptions; the explicit retirement/replacement deltas change their active requirements.

## Delivered surface

`src/core/templates/evidence-retention.ts` supplies one shared instruction block. The explicit consumer list is in design Decision 1. A normal built-CLI `init --tools omp --profile full` into an isolated project with spaces in its absolute path installed all 23 affected consumers with exactly one block each. `update` reported those installations up to date. Inspection of the installed planning, benchmark, verification, archive, and review-cycle skills confirmed Store selectors, report-only dispatch, standalone destinations, and existing verdict/test-evidence boundaries remain present.

This changes generated agent guidance, not enforcement: there is no recipe executor, validator, data migration, or new archive gate. No claim is made that every model will follow the instructions.

## Executed checks

Environment: macOS arm64; Node `v24.18.0`.

- `pnpm run build` — passed.
- `pnpm exec tsc --noEmit && pnpm lint` — passed.
- `env -u ZSH pnpm exec vitest run test/core/templates test/core/shared/skill-generation.test.ts test/core/shared/skill-sidecar-install.test.ts test/core/workflow-generation-integration.test.ts test/core/file-placement.test.ts test/core/workflow-chain.test.ts test/core/archive-consumer-integration.test.ts` — 16 files, 135 tests passed. Includes real init/update installation and generated archive argv executed through Commander.
- `env -u ZSH pnpm exec vitest run test/source-byte-hygiene.test.ts` — 5 tests passed; the removed template file has no remaining byte-hygiene exception.
- `RASEN_LANG=en node bin/rasen.js validate source-backed-reproducible-evidence-retention --strict` — valid.
- Actual CLI init/update and recipe commands used an isolated HOME/XDG scope and an explicit temporary repository base containing spaces. No host install was refreshed.
- Frozen template hashes and wording/copy assertions were removed from `skill-templates-parity.test.ts`, not re-pinned. No new permanent prompt-string tests were added.

## CI result

[CI run 40917684178](https://github.com/pashifika/rasen/actions/runs/40917684178) tested commit `dcaca6f88842e690e0a1c58df339ef2e6f916807`.

| Surface | Result |
| --- | --- |
| Windows PowerShell tests, shards 1/3, 2/3, 3/3 | Passed, including the focused Windows path checks in shard 1 |
| Windows file-placement recovery and layout migration | Passed |
| Linux full suites, Node 20.19.0 and Node 24 | Passed |
| Linux file-placement recovery and layout migration | Passed |
| macOS layout migration | Passed |
| macOS full suite and file-placement recovery | Cancelled before execution: hosted runner unavailable |
| Lint/type check, UI package build/tests, Nix validation | Passed |

GitHub's cancellation annotation was `The job was not acquired by Runner of type hosted even after multiple attempts`, with macOS arm64 capacity warnings. The run conclusion is `failure`; aggregate gates were skipped. Local macOS checks are reported separately and are not substitutes for the cancelled remote jobs.

## Scenario evidence

| Scenarios | Delivered guidance / exercised check |
| --- | --- |
| Deterministic fixture; explicit claim and stopping scope | Shared claim-first/mode clauses. A disposable committed generator ran twice with seed `evidence-v1`; both outputs had SHA-256 `132b22bbad2d1bbb1c2c30bd9dd42eaa172f0219d4d29e6df0fe56dc65bce3bc`. A different seed changed the output. |
| Historical reanalysis; aggregates, failures and incomplete attempts | Four synthetic observations were retained once: three numeric observations and one timeout. Two analyses returned `observed=3`, `failed=2`, `mean=15`, `max=20`, `verdict=fail`. The 70-byte summary contained no observation array; input bytes stayed unchanged. These are fixture values, not product performance measurements. |
| Distribution evidence | Guidance explicitly retains samples and exclusion meanings; aggregates are not substitutes for required samples. No percentile benchmark was claimed or run. |
| Separate analysis/measured identities; dirty source | Recipe guidance and the documentation template name both identities. A local source deviation left the fixture HEAD unchanged; its diff digest was `74803784907ceb78a9745fd59a8f908e0492c5dc3d6a9afef53c394d81a01288`. A commit alone therefore did not identify the executed source. |
| Changed, missing and private inputs | Changing the observation input changed its digest and mean to 45. An unavailable input produced `ENOENT`. An inspection-only private-reference example explicitly reported unavailable receiver access and unverified reproduction; no real private payload was used. |
| Variable metadata; new timing observations | Two fresh 10,000-hash timing runs produced distinct run IDs and elapsed values (10.072416 ms and 10.388917 ms). Only `stable.iterations=10000` was compared as stable; neither run replaced the historical fixture input. This illustrates mode separation, not a performance claim. |
| Recorded commands are data | Read an untrusted recipe containing a harmless file-creation canary command without executing it; the canary remained absent. This is a manual read-only inspection smoke, not a sandbox or automatic-execution guarantee. |
| Path bases and platform meaning | Actual generation and recipe execution succeeded from an explicit macOS repository path containing spaces. Documentation uses argument-vector boundaries, not an assumed POSIX shell. Windows generation/installation, path, and placement coverage ran in the successful CI shards; the disposable recipe itself ran only on macOS. |
| Dispatched/standalone reports; legacy reports and immutable archives | Installed benchmark guidance retains canonical `benchmark-report.md` only for dispatched workers, with no standalone baseline writes. Standalone directories and legacy reads remain; new originals have immutable collision-free names, with `baseline.json` a disposable compatibility cache. Shared guidance adds no legacy recipe gate or archive mutation permission; real archive-consumer integration tests passed. |
| File classes, Store split, planning-only roots, handoff and sticky legacy | Resolver code is unchanged; file-placement tests passed. Shared guidance and orchestration distinguish required observations from disposable scratch and use CLI-resolved roots. Store selection remains in installed skills; no live Store was created. |
| Raw JSON, mutable fetched inputs, regenerable detail, source and legacy ephemera | Propose/explore and expert instructions preserve required originals once, identify availability, reference committed generators, and resolve required legacy-ephemera retention before cleanup. Existing verification-harness classification remains unchanged. |

## Availability and boundaries

The recipe fixture was an isolated disposable repository at commit `2d3191fa496657ed33000b0c75ea0118b2bb770a`; original synthetic input was 200 bytes with SHA-256 `5d4c38969111afb9caef4fbde7b1a391eb122927089ea102d02f42cb4550a46e`. Temporary source, installed skills, and data were removed after the smoke. This receipt records the check performed; that temporary commit is not a published reproduction dependency.

The MadoPilot archive and collectors, archive journal cost, generated relative-link defect, already-synchronized ADDED validation defect, existing archive bytes, and unrelated working-tree edits were not changed. No archive-performance improvement or storage-reduction measurement is claimed. The full test suite was not run locally; the Linux full suites and Windows shards ran in CI. Local verification targeted generation, installation, placement, workflow composition, archive consumers, and byte hygiene.

## Review follow-up verification

The final source was built with `pnpm run build`. In a disposable project with spaces in its path and isolated HOME/XDG directories, the actual CLI executed `init --tools omp --profile full`, `update`, `new change retained-observation-smoke`, `status --change retained-observation-smoke --json`, and `update --force`. The last command installed the final baseline-selection and goal-spine instructions after the same-version development build. All 23 affected consumers contained the shared block once; emitted benchmark, apply, review-cycle, and goal instructions retained their role and placement boundaries.

A disposable `node --input-type=module -e` harness manually exercised the documented operations, using paths returned by the fixture's status:

- An authorized 66-byte snapshot had SHA-256 `00b0425be461fa4175e49d3a5584c338bd0e215c0851cd1129edcfb0ff66a991`. Exclusive creation refused an overwrite; the snapshot remained unchanged after the live source gained a new observation, and the live source stayed in place.
- Actual built `classifyEphemera` and `projectArchiveCleaner` selected `raw-samples.json` for ordinary cleanup and selected no deletion with `keepEphemera=true`. This runtime check confirms local preservation, not archive delivery; payload separation and saved-plan option ownership were independently source-reviewed.
- Two synthetic baseline captures with the same timestamp prefix received distinct Windows-safe UUID-suffixed filenames. Their immutable records and reports coexisted; the prior working baseline and historical report bytes stayed unchanged. The retained legacy bytes had SHA-256 `ff4e21e391053ec59bc15efcac792a3e0df7eeeda617d3472147d40b7aa23ff6`.
- A manual three-record selection example chose the newer baseline observation, excluding a later-named copy of an older baseline and a newer non-baseline run. The emitted goal bundle explicitly requires a snapshot of the resolved `loop.runArtifact` when a ship log/report cites its gate judgments.

These are synthetic manual executions of agent instructions, not browser performance measurements, a recipe executor, or proof that an agent will obey every clause. Snapshot/selection source and input were disposable, not published reproduction dependencies. No live archive was planned or applied.

`RASEN_LANG=en RASEN_TELEMETRY=0 node bin/rasen.js validate source-backed-reproducible-evidence-retention --strict` passed with explicit retirement/replacement deltas. The ADR records why hash-specific scenario retirement uses REMOVED plus ADDED rather than incomplete MODIFIED blocks. Independent review dispositions are in `review-cycle-report.md`. Current-tree automated ship-gate results belong to `ship-log.md`; the earlier CI results above must not be represented as a final-tree CI run.
