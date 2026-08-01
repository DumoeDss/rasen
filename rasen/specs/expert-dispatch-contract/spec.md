# expert-dispatch-contract Specification

## Purpose
The dispatched vs standalone mode contract for generic expert skills (review, cso, qa, qa-only, benchmark, design-review) — report-only gating (no fix/ask/commit/subagent) when orchestrated by the LEAD, the canonical report-file convention reconciling orchestration Step B with the skills' real save behavior, and denied-edit honesty.
## Requirements
### Requirement: Dispatched vs standalone mode contract in the shared expert PREAMBLE

The shared expert PREAMBLE SHALL carry a **Dispatched vs standalone mode** section governing every generic expert skill that embeds it: `review`, `cso`, `qa`, `benchmark`, and `design-review`. A skill is in dispatched report-only mode when its invocation instructs it to do one unit of work, not spawn subagents, and states that a LEAD owns orchestration; otherwise it is in standalone mode. `rasen-qa` SHALL additionally recognize an explicit report-only/non-UI request as a no-edit mode even outside a LEAD dispatch.

In dispatched or explicitly requested report-only mode, the skill SHALL apply no AUTO-FIX, make no code edits, issue no fix-oriented user questions, make no git commit, spawn no subagents, and SHALL return classified findings tagged with canonical severity. In dispatched mode it SHALL write the canonical report in the change's work directory with the existing sticky-legacy fallback. ASK-class and fix-class items SHALL remain unresolved findings for the LEAD. Standalone default mode SHALL retain the richer behavior of each surviving expert.

#### Scenario: Dispatched-mode contract present in generated preamble

- **WHEN** any surviving generic expert skill is regenerated and its `SKILL.md` inspected
- **THEN** it SHALL define dispatched report-only mode versus standalone mode
- **AND** SHALL identify the LEAD dispatch signature
- **AND** SHALL state that dispatched mode performs no AUTO-FIX, user question, git commit, or self-spawned subagent
- **AND** SHALL state that dispatched mode returns classified findings and writes the canonical report file

#### Scenario: QA can be explicitly report-only without a second skill

- **WHEN** `rasen-qa` is invoked with a report-only/non-UI instruction
- **THEN** it SHALL follow the no-edit report path even outside a LEAD dispatch
- **AND** SHALL NOT require or redirect to `rasen-qa-only`

### Requirement: Mutating expert skills gate fix/commit/clean-tree behavior by mode

The `qa`, `design-review`, and `review` skills SHALL suppress mutating behavior in dispatched mode. `qa` SHALL also suppress mutation in explicit report-only/non-UI mode. In those modes, `qa` and `design-review` SHALL NOT run a fix loop, commit, or enforce a clean-working-tree gate; `review` SHALL NOT auto-apply Fix-First edits or issue batched/Greptile questions. Shared adversarial and test-coverage blocks SHALL not spawn or generate/commit tests in dispatched mode. Standalone default mode SHALL retain these richer behaviors.

#### Scenario: qa fix/commit/clean-tree gated in generated skill

- **WHEN** the generated `rasen-qa` skill is inspected
- **THEN** its clean-tree gate, fix loop, and per-fix commit SHALL be scoped to default standalone mode
- **AND** SHALL state that dispatched and explicit report-only/non-UI modes report findings only and do not fix, commit, or require a clean tree

#### Scenario: design-review fix/commit/clean-tree gated in generated skill

- **WHEN** the generated `design-review` `SKILL.md` is inspected
- **THEN** its clean-tree gate, fix loop, and per-fix commit SHALL be scoped to standalone mode
- **AND** SHALL state that in dispatched mode design-review reports findings only

#### Scenario: review Fix-First and questions gated in generated skill

- **WHEN** the generated `review` `SKILL.md` is inspected
- **THEN** Fix-First AUTO-FIX and batched/Greptile question flows SHALL be scoped to standalone mode
- **AND** SHALL state that dispatched review returns findings only, routing fixes and questions to the LEAD

#### Scenario: adversarial and coverage steps gated in generated review skill

- **WHEN** the generated `review` `SKILL.md` is inspected
- **THEN** adversarial subagent dispatch SHALL not run in dispatched mode
- **AND** test-coverage generation and commit SHALL be replaced by report-only coverage findings in dispatched mode

### Requirement: Canonical report-file convention reconciled with orchestration Step B

In dispatched mode each surviving generic expert SHALL write findings to the canonical report file in the change's work directory with the change-directory sticky-legacy fallback: `review-report.md`, `cso-report.md`, `qa-report.md`, `benchmark-report.md`, or `design-review-report.md`. Both UI QA and non-UI/report-only QA SHALL use `qa-report.md`. Dispatched experts SHALL NOT also write standalone report paths. Standalone modes SHALL retain native paths. Orchestration Step B SHALL state that dispatched experts run report-only, write the canonical report themselves, and that the dispatching worker verifies its presence before returning.

#### Scenario: dispatched expert writes only the canonical report

- **WHEN** the generated `cso`, `qa`, `benchmark`, or `design-review` skill is inspected
- **THEN** it SHALL state that dispatched mode writes its canonical report in the work directory with the change-directory fallback
- **AND** SHALL scope standalone `.rasen/*-reports/` and project report paths to standalone mode
- **AND** QA SHALL name one `qa-report.md` contract for every QA mode

#### Scenario: Step B no longer claims experts save nothing

- **WHEN** the generated orchestration playbook Step B is inspected
- **THEN** it SHALL state that dispatched experts write their canonical report and the worker verifies its presence
- **AND** SHALL refer to `qa` and its modes rather than a `qa-only` expert

### Requirement: Denied-edit honesty in Fix-First flows

The Fix-First / fix-loop guidance carried in the PREAMBLE SHALL verify whether
each attempted write actually landed by inspecting the tool result and current
diff. A write that did not land SHALL be reported as an un-applied finding,
never as `[AUTO-FIXED]`, and SHALL NOT be silently dropped. Before a mutating
standalone expert reports completion, it SHALL inspect the changed-file set
against the task's declared scope and SHALL report an unexplained unexpected
file as unresolved out-of-scope work. This contract SHALL use observable write
and diff evidence without requiring or claiming a freeze/guard/runtime
edit-boundary.

#### Scenario: Failed write is not reported as fixed

- **WHEN** a standalone Fix-First flow attempts a write and the tool result or
  current diff shows that the intended change did not land
- **THEN** the generated PREAMBLE SHALL require the fix to be reported as
  un-applied
- **AND** SHALL prohibit `[AUTO-FIXED]` and silent omission

#### Scenario: Unexpected changed file remains unresolved

- **WHEN** a mutating standalone expert's final changed-file inspection finds
  a file outside the declared task scope without a recorded justification
- **THEN** the generated PREAMBLE SHALL require it to be reported as unresolved
  out-of-scope work
- **AND** SHALL NOT infer safety or completion from an absent boundary denial

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
