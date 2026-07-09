# expert-dispatch-contract Specification

## Purpose
The dispatched vs standalone mode contract for generic expert skills (review, cso, qa, qa-only, benchmark, design-review) — report-only gating (no fix/ask/commit/subagent) when orchestrated by the LEAD, the canonical report-file convention reconciling orchestration Step B with the skills' real save behavior, and denied-edit honesty.

## Requirements

### Requirement: Dispatched vs standalone mode contract in the shared expert PREAMBLE

The shared expert PREAMBLE (`src/core/templates/experts/_shared.ts`, the `PREAMBLE` constant) SHALL carry a **Dispatched vs standalone mode** section governing every generic expert skill that embeds the PREAMBLE (review, cso, qa, qa-only, benchmark, design-review). The section SHALL define two modes and their trigger: the skill is in **dispatched (report-only) mode** when its invocation instructs it to do a single unit of work, to not spawn subagents, and states that a LEAD owns orchestration (the orchestration Step B dispatch signature); otherwise it is in **standalone mode** (direct human invocation).

In **dispatched mode** the skill SHALL: apply no AUTO-FIX and make no code edits; issue no `AskUserQuestion`; make no git commit; spawn no subagents; return classified findings tagged with a canonical severity; and write the canonical `<skill>-report.md` in the change's work directory (the `workDir` reported by the CLI per the `change-work-dir` capability, with the change directory as the sticky-legacy fallback). ASK-class and fix-class items SHALL be reported as unresolved findings for the LEAD's triage, never resolved by the skill itself. In **standalone mode** the skill SHALL retain its richer behavior (fix loop, batched questions, commits, adversarial subagent, native report paths) as adjudicated in the change's design.

#### Scenario: Dispatched-mode contract present in generated preamble

- **WHEN** any generic expert skill that embeds the PREAMBLE is regenerated and its `SKILL.md` inspected
- **THEN** the output SHALL contain a section defining a dispatched (report-only) mode versus a standalone mode
- **AND** SHALL state the dispatched trigger as the single-unit-of-work / no-subagents / LEAD-owns-orchestration dispatch signature
- **AND** SHALL state that dispatched mode does no AUTO-FIX, no AskUserQuestion, no git commit, and no self-spawned subagents
- **AND** SHALL state that dispatched mode returns classified findings and writes the canonical report file to the work directory (with the change-directory fallback)

### Requirement: Mutating expert skills gate fix/commit/clean-tree behavior by mode

The `qa`, `design-review`, and `review` skills SHALL, in dispatched mode, suppress their mutating behavior: `qa` and `design-review` SHALL NOT run their fix loop, SHALL NOT `git commit`, and SHALL NOT enforce a clean-working-tree gate; `review` SHALL NOT auto-apply Fix-First edits and SHALL NOT issue the batched or Greptile `AskUserQuestion`. The corresponding shared blocks SHALL gate their mutating steps by mode: `ADVERSARIAL_STEP` (`_shared.ts`) SHALL NOT dispatch a subagent in dispatched mode (adversarial independence is provided by the LEAD's parallel reviewers and non-author re-review), and `TEST_COVERAGE_AUDIT_REVIEW` (`_shared.ts`) SHALL NOT generate or commit tests in dispatched mode (coverage gaps are reported as findings only). Standalone mode SHALL retain all of these behaviors.

#### Scenario: qa fix/commit/clean-tree gated in generated skill

- **WHEN** the generated `qa` `SKILL.md` is inspected
- **THEN** its clean-tree gate, fix loop, and per-fix commit SHALL be scoped to standalone mode
- **AND** SHALL state that in dispatched mode qa reports findings only and does not fix, commit, or require a clean tree

#### Scenario: design-review fix/commit/clean-tree gated in generated skill

- **WHEN** the generated `design-review` `SKILL.md` is inspected
- **THEN** its clean-tree gate, fix loop, and per-fix commit SHALL be scoped to standalone mode
- **AND** SHALL state that in dispatched mode design-review reports findings only

#### Scenario: review Fix-First and questions gated in generated skill

- **WHEN** the generated `review` `SKILL.md` is inspected
- **THEN** the Fix-First AUTO-FIX and the batched/Greptile AskUserQuestion flows SHALL be scoped to standalone mode
- **AND** SHALL state that in dispatched mode review returns findings only, routing fixes and questions to the LEAD

#### Scenario: adversarial and coverage steps gated in generated review skill

- **WHEN** the generated `review` `SKILL.md` (which embeds ADVERSARIAL_STEP and TEST_COVERAGE_AUDIT_REVIEW) is inspected
- **THEN** the adversarial subagent dispatch SHALL be gated so it does not run in dispatched mode
- **AND** the test-coverage generate-and-commit step SHALL be gated so it reports gaps as findings only in dispatched mode

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

### Requirement: Denied-edit honesty in Fix-First flows

The Fix-First / fix-loop guidance carried in the PREAMBLE SHALL state that when an Edit or Write is denied by an active edit boundary (`/freeze` or `/guard` with a target outside the boundary), the fix did NOT land and SHALL be reported as an un-applied finding — never as `[AUTO-FIXED]` — and SHALL NOT be silently dropped.

#### Scenario: Denied-edit honesty stated in generated preamble

- **WHEN** the generated PREAMBLE section on fixes is inspected
- **THEN** it SHALL state that a freeze/guard-denied edit is reported as un-applied, not `[AUTO-FIXED]`

### Requirement: Golden-master parity preserved for affected templates

Changes to the PREAMBLE, `ADVERSARIAL_STEP`, `TEST_COVERAGE_AUDIT_REVIEW`, the affected expert templates, and the orchestration playbook SHALL keep the parity golden master (`test/core/templates/skill-templates-parity.test.ts`) passing. The `EXPECTED_FUNCTION_HASHES` and `EXPECTED_GENERATED_SKILL_CONTENT_HASHES` entries for every affected template SHALL be recomputed and updated so the suite passes, and only the expected templates' hashes SHALL move.

#### Scenario: Parity suite passes after the template changes

- **WHEN** `npx vitest run test/core/templates/` is executed after the changes and hash updates
- **THEN** the suite SHALL pass with updated hashes for exactly the affected templates

### Requirement: Solo proactive-fix disposition is scoped to interactive/standalone sessions

The shared expert PREAMBLE (`src/core/templates/experts/_shared.ts`) SHALL scope its `solo` "investigate and offer to fix proactively / Default to action" disposition, and the "notice something during ANY workflow step … Never let a noticed issue silently pass" rule, to interactive / standalone sessions. Using the enumerate-and-gate idiom, the PREAMBLE SHALL name these absolutes and carve out dispatched leaf workers: a dispatched leaf worker (one-unit-of-work dispatch; see the dispatched-mode contract) that notices an out-of-scope issue SHALL record it in its `DONE` durable-findings for the LEAD to triage, and SHALL NOT investigate or fix it itself. The proactive "offer to fix" disposition SHALL apply where the worker can actually reach the user (interactive/standalone), not to orchestrated leaf workers.

#### Scenario: dispatched worker reports out-of-scope issues instead of fixing them

- **WHEN** the generated PREAMBLE (solo mode / "see something say something") is inspected
- **THEN** it SHALL scope the "Default to action" / proactive-fix disposition to interactive/standalone sessions
- **AND** SHALL state that a dispatched leaf worker records out-of-scope issues in its DONE durable-findings for the LEAD, rather than investigating or fixing them
- **AND** the scoping SHALL be consistent with the dispatched-mode one-unit-of-work contract
