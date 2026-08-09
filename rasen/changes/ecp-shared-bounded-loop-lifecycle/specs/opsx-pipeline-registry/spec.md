# opsx-pipeline-registry Specification Delta

## ADDED Requirements

### Requirement: Pipeline validation exposes bounded-loop lifecycle diagnostics

Registry load, `pipeline validate`, save preflight, export preflight, and launch preflight SHALL use the same authoritative preparation result for bounded-loop lifecycle validation. Machine output SHALL preserve stable diagnostic code, severity, and JSON Pointer path. Human output SHALL summarize the same error without hiding additional independent diagnostics.

#### Scenario: CLI reports an incomplete authored v2 policy

- **WHEN** `rasen pipeline validate --json` receives an authored v2 bounded loop missing its blocked disposition
- **THEN** it reports the same preparation diagnostic code and lifecycle path returned by the registry seam
- **AND** launch preflight refuses the definition

#### Scenario: Text and JSON validation agree

- **WHEN** a lifecycle policy has several independent invalid fields
- **THEN** JSON output contains every deterministic diagnostic
- **AND** localized text output represents the same validity result and does not discard the machine contract

### Requirement: Pipeline inspection shows the sealed lifecycle policy

Pipeline inspection SHALL expose the normalized and sealed bounded-loop lifecycle policy used for execution, including all loop-local limits, thresholds, strategy-attempt allowance and capability binding, and every lifecycle disposition with typed outcome. JSON output SHALL preserve the versioned machine shape exactly. Text output SHALL present a concise localized summary derived from the same prepared definition. Legacy v1 definitions SHALL display their materialized compatibility policy without rewriting their source.

#### Scenario: Show reveals authored v2 lifecycle behavior

- **WHEN** `rasen pipeline show --json` inspects a valid authored v2 loop
- **THEN** the response includes the exact normalized lifecycle policy and loop-local limits used by its plan
- **AND** the values agree with the plan digest input

#### Scenario: Show identifies materialized v1 compatibility

- **WHEN** pipeline show inspects a legacy v1 review or goal loop
- **THEN** it exposes the normalized compatibility lifecycle separately from the authored source representation
- **AND** no invented strategy capability is displayed

### Requirement: Pipeline status consumes canonical loop lifecycle projection

Pipeline status SHALL render bounded-loop runtime mechanics only from `ChangeRunView`'s versioned lifecycle sections. JSON status SHALL pass through the exact section. Human status SHALL summarize state, limits, streaks, strategy, wait, and typed outcome without reading or mutating report files, `goal-run.json`, or launcher-owned counters.

#### Scenario: Status reports a human-required loop

- **WHEN** a canonical Run has a bounded loop at a human-required wait
- **THEN** JSON status includes the lifecycle section's loop path, blocker streak, WaitId, reason, strategy count, and outcome policy
- **AND** text status derives the same waiting state from that section

#### Scenario: Unknown additive lifecycle version remains visible

- **WHEN** a newer server supplies a lifecycle section version unknown to an older generic status renderer
- **THEN** machine output preserves the section
- **AND** human output degrades safely without fabricating loop counters or terminal meaning
