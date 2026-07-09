## ADDED Requirements

### Requirement: verifyPolicy Values Are Defined

The auto workflow (`src/core/templates/workflows/auto.ts`, §5) SHALL define the behavior of every `verifyPolicy` enum value carried by pipeline stages — `adaptive`, `standard`, and `light` — not only `adaptive`. `adaptive` SHALL scale the verification passes to the diff size (as today); `standard` SHALL run a single verify pass without the review-cycle loop; `light` SHALL skip verification when the diff is trivial (e.g. docs/tests-only). No `verifyPolicy` value carried by a shipped pipeline SHALL be undefined dead config.

#### Scenario: standard and light have defined semantics

- **WHEN** the generated auto workflow verification section is inspected
- **THEN** it SHALL define `standard` (single verify pass, no loop) and `light` (skip verify on a trivial diff) in addition to `adaptive`
- **AND** no pipeline-carried `verifyPolicy` value SHALL be left without stated behavior
