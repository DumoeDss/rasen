# expert-dispatch-contract Specification (delta)

## MODIFIED Requirements

### Requirement: Dispatched vs standalone mode contract in the shared expert PREAMBLE

The shared expert PREAMBLE (`src/core/templates/experts/_shared.ts`, the `PREAMBLE` constant) SHALL carry a **Dispatched vs standalone mode** section governing every generic expert skill that embeds the PREAMBLE (review, cso, qa, qa-only, benchmark, design-review). The section SHALL define two modes and their trigger: the skill is in **dispatched (report-only) mode** when its invocation instructs it to do a single unit of work, to not spawn subagents, and states that a LEAD owns orchestration (the orchestration Step B dispatch signature); otherwise it is in **standalone mode** (direct human invocation).

In **dispatched mode** the skill SHALL: apply no AUTO-FIX and make no code edits; issue no `AskUserQuestion`; make no git commit; spawn no subagents; return classified findings tagged with a canonical severity; and write the canonical `<skill>-report.md` in the change's work directory (the `workDir` reported by the CLI per the `change-work-dir` capability, with the change directory as the sticky-legacy fallback). ASK-class and fix-class items SHALL be reported as unresolved findings for the LEAD's triage, never resolved by the skill itself. In **standalone mode** the skill SHALL retain its richer behavior (fix loop, batched questions, commits, adversarial subagent, native report paths) as adjudicated in the change's design.

#### Scenario: Dispatched-mode contract present in generated preamble

- **WHEN** any generic expert skill that embeds the PREAMBLE is regenerated and its `SKILL.md` inspected
- **THEN** the output SHALL contain a section defining a dispatched (report-only) mode versus a standalone mode
- **AND** SHALL state the dispatched trigger as the single-unit-of-work / no-subagents / LEAD-owns-orchestration dispatch signature
- **AND** SHALL state that dispatched mode does no AUTO-FIX, no AskUserQuestion, no git commit, and no self-spawned subagents
- **AND** SHALL state that dispatched mode returns classified findings and writes the canonical report file to the work directory (with the change-directory fallback)

### Requirement: Canonical report-file convention reconciled with orchestration Step B

In dispatched mode each generic expert SHALL write its findings to the canonical report file in the change's work directory (with the change directory as the sticky-legacy fallback) — `review-report.md` (review), `cso-report.md` (cso), `qa-report.md` (qa and qa-only), `benchmark-report.md` (benchmark), `design-review-report.md` (design-review) — using canonical severities, and SHALL NOT write to its standalone `.rasen/*-reports/` or `~/.rasen/projects/` paths. Standalone mode SHALL retain the native paths. The orchestration Step B report-contract sentence in `src/core/templates/workflows/_orchestration.ts` SHALL be corrected: it SHALL NOT claim the generic experts "save NOTHING"; it SHALL state that dispatched experts run report-only and write the canonical `<skill>-report.md` themselves, and that the dispatching worker verifies the report is present before returning.

#### Scenario: dispatched expert writes only the canonical report

- **WHEN** the generated `cso`, `qa`, `qa-only`, `benchmark`, or `design-review` `SKILL.md` is inspected
- **THEN** it SHALL state that in dispatched mode it writes the canonical `<skill>-report.md` in the work directory (change-directory fallback)
- **AND** SHALL state that the standalone `.rasen/*-reports/` and `~/.rasen/projects/` paths apply to standalone mode only

#### Scenario: Step B no longer claims experts save nothing

- **WHEN** the generated orchestration playbook (Step B) is inspected
- **THEN** it SHALL NOT contain the claim that the generic expert skills "save NOTHING"
- **AND** SHALL state that dispatched experts write the canonical `<skill>-report.md` and the worker verifies its presence
