# acceptance-evidence-reconciliation Specification

## Purpose
Provides an independent, traceable reconciliation of a review-fix portfolio's completion evidence: per change, the findings addressed, the commit, the review verdict, and the test result, so acceptance claims are auditable rather than self-asserted. It does not retroactively alter prior ledgers.
## Requirements
### Requirement: A portfolio acceptance round ships an independent evidence reconciliation

Every multi-child acceptance portfolio SHALL ship an evidence reconciliation artifact that lists each child, its finding IDs, its artifact paths, its review-report path (produced by an independent reviewer stage), and its real test verdict. The artifact SHALL NOT retroactively modify or fake-check previously archived ledgers. The artifact SHALL be traceable: each claim links to a file path or test output that a reviewer can independently verify.

#### Scenario: A round-2 portfolio ships its evidence reconciliation

- **WHEN** the round-2 acceptance portfolio is submitted for re-review
- **THEN** an evidence reconciliation artifact exists listing every child
- **AND** each child's entry names its finding IDs, artifact paths, review-report path, and test verdict
- **AND** the artifact does not retroactively modify archived ledgers from a prior round

#### Scenario: A reviewer can trace each claim

- **WHEN** a reviewer reads the evidence reconciliation artifact
- **THEN** every path referenced in the artifact exists on disk or in the PR diff
- **AND** every test verdict is backed by an actual test run, not a self-reported assertion
