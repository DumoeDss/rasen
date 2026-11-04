# Review: source-backed-reproducible-evidence-retention

## Round 1

Reviewed commit: `cf9bdebd078b65ba387dd028b02af30921b5c5bd` against `upstream/dev/0.1.8` (`f0ae20d19a30c265ad3f3ffaaa5bb3cd148d12dd`). Independent OMP reviewer contexts: `EvidenceStandardsReview` (Opus) and `EvidenceSpecReview` (Sol). No reviewer modified code or ran tests. Unrelated dirty packaging-script and project-config changes were excluded.

## Standards axis

| ID | Severity | Finding | Disposition |
| --- | --- | --- | --- |
| R1-1 | Major | Six accepted capabilities and absorption documentation still mandate the deleted parity hash test. | Accepted. Add scoped delta requirements and reconcile affected docs; do not restore incidental assertions or modify canonical specs before archive. |
| R1-2 | Major | A fixed standalone baseline locator cannot identify earlier observations after recapture; date-only report names can collide. | Accepted. New records need immutable collision-free identifiers, while preserving existing directories and current-baseline compatibility. |
| R1-3 | Major | Required ephemera observations need a concrete retention action before saved archive planning; local keep-ephemera alone does not deliver them. | Accepted. Specify authorized, verified evidence snapshots or explicitly approved local-only retention; never silently authorize destructive cleanup. |
| R1-4 | Minor | Shared dispatched-report-only wording also reaches implementer/planner/ship workers with broader write authority. | Accepted. Limit it to report-only experts and define LEAD handling of their retention notices. |
| R1-5 | Minor | Deleting the parity file removes registry-wide text/copy assertions as well as hashes. | Dismissed under the explicit repository testing policy: permanent wording, wiring, copy, and source-text assertions must not be retained or re-pinned. Real generation/install and downstream consumer checks remain. |
| R1-6 | Trivial | The Chinese workflow guide has no counterpart to the new evidence-retention section in `docs/artifact-workflow-guide.md`. | Accepted-known translation coverage gap for that section. Explanatory additions already present in `docs/zh/grill-gstack-absorption.md` are Simplified Chinese. |

The reviewer checked all changed source and composition paths, including orchestration header splitting, seven full-preamble experts, investigate's direct inclusion, twelve direct workflows, three inherited orchestration consumers, archive cleaner behavior, and dispatch restrictions.

## Spec axis

The initial Spec axis found no findings across 8 requirements and 30 scenarios. The final independent mapping covers 8 capabilities, 15 active requirements (11 ADDED, 4 MODIFIED), 6 explicit requirement retirements, and 49 scenarios. Generated-skill delivery requirements replace obsolete hash-gate mechanisms while preserving substantive behavior. Strict validation passed; canonical specs and the reconciliation parser are unchanged.

## Final dispositions

- R1-1 through R1-4: fixed by `SpecAlignment` / `GuidanceFix` and independently confirmed by Opus and Sol.
- R1-5: dismissal independently confirmed; no uncovered consumer defect was identified.
- R1-6: accepted-known missing Chinese counterpart to the evidence-retention section in `docs/artifact-workflow-guide.md`, not permission to leave English explanatory prose in `docs/zh/`.
- Round 2 N1 (Minor), baseline recency ambiguity: fixed by the parent; Opus round 3 confirmed observation-timestamp selection restricted to baseline records.
- Round 2 N2 (Minor), code-producing goal-spine retention: fixed by the parent; Opus round 3 confirmed snapshot routing before saved archive planning without changing live-state ownership.
- Round 2 N3 (Trivial), two non-normative Purpose descriptions: accepted-known for the upstream spec-sync owner.
- Verification refinement: the parent encoded intentional hash-scenario retirement as REMOVED plus ADDED replacements, rather than dropping scenario identities inside MODIFIED. Sol independently confirmed semantic preservation and the final requirement/scenario mapping.

## Gate

CLEAN — Blocker:0 Major:0 Minor:0 Trivial:2 (accepted-known). Three bounded review rounds, with one recorded delta-encoding strategy refinement during verification. No automatic execution, archive mutation, or new storage/executor design is introduced. Reviewers ran no tests; actual check results and limitations are recorded separately in `verification-report.md` and the ship gate.
