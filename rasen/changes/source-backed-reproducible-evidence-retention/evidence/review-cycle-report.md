# Review cycle: source-backed-reproducible-evidence-retention

Status: CLEAN — Blocker:0 Major:0 Minor:0 Trivial:2 (accepted-known).

Three rounds, Tier B, maximum 3. Independent OMP contexts supplied the standards axis (Opus `EvidenceStandardsReview`) and spec axis (Sol `EvidenceSpecReview`). These are host agent identities, not fabricated Claude/Codex CLI session handles. Reviewers were read-only; the parent recorded their returned findings in the canonical reports.

## Resolution ledger

| Round | Findings / action | Author | Non-author confirmation |
| --- | --- | --- | --- |
| 1 | R1-1: retire stale mandatory parity contracts without restoring incidental tests | `SpecAlignment` | Opus round 2; Sol rounds 2/3 |
| 1 | R1-2/R1-3/R1-4: immutable benchmark records, authorized ephemera retention, report-only role boundaries | `GuidanceFix` | Opus and Sol round 2 |
| 1 | R1-5: dismiss request to restore prohibited wording/copy tests | Parent | Opus round 2; no uncovered consumer defect found |
| 2–3 | N1: baseline recency uses observation timestamps, never copy time or ordinary run records | Parent | Opus round 3 |
| 2–3 | N2: goal ship/report citations require a snapshot of the resolved loop spine | Parent | Opus round 3 |
| Verification refinement | Use six explicit REMOVED/ADDED replacements plus one complete MODIFIED block for parity-contract retirement | Parent | Sol round 3 follow-up; strict CLI validation passed |

The verification refinement changed the delta encoding after strict validation demonstrated that MODIFIED preserves existing scenario identities. It did not weaken the validator, restore hash tests, alter runtime code, or change canonical specs. The ADR records the decision. Final mapping: 8 capabilities, 15 active requirements, 6 retirements, 49 scenarios.

Accepted-known: R1-6, the evidence-retention section in `docs/artifact-workflow-guide.md` has no Chinese counterpart; N3, two non-normative canonical Purpose paragraphs await owner-controlled spec synchronization. Explanatory additions in `docs/zh/grill-gstack-absorption.md` are Simplified Chinese. Neither known issue authorizes archive or spec sync in this delivery.

## Verification scope and evidence

Required scope: built CLI generation/installation, template composition, placement, archive consumers, source-byte hygiene, TypeScript and lint, plus strict Change validation. These bound the changed guidance and delivery contracts; no archive engine, parser, dependency, CI, or runtime persistence behavior changes.

Final-round `pnpm run build` passed. Actual isolated CLI init/update and synthetic non-overwrite, legacy-baseline, local-cleaner, and selection checks passed; their original observations and limits are recorded once in `verification-report.md`. `RASEN_LANG=en RASEN_TELEMETRY=0 node bin/rasen.js validate source-backed-reproducible-evidence-retention --strict` passed. No browser performance result is claimed.

These checks ran with reviewed edits uncommitted atop tree `a045b5c26c61bbf7992748c4e57bdd06aadfe2cf` (commit `cf9bdebd078b65ba387dd028b02af30921b5c5bd`); that base fingerprint is not reusable current-tree green evidence. Ship must run fresh scoped automated gates after committing the reviewed content and integrating the verified upstream base. The ship log records those exact commands and tested tree. Earlier CI limitations remain explicit in the verification report.
