## ADDED Requirements

### Requirement: Package authoring and review experts cover pipelines

The workflow-author and workflow-review experts SHALL cover pipeline authoring and review in addition to workflows. The author expert SHALL guide creating a `pipeline.yaml` (stages, role, gate, loop, decompose/child-pipeline, per-role runtime) and using the pipeline authoring CLI loop (init, validate, import). The review expert SHALL review a pipeline for stage-DAG acyclicity, unique stage ids, decompose recursion bound, runtime/model resolvability, and skill enablement, applying the same static-validate-first discipline it applies to workflows.

#### Scenario: Author expert guides pipeline creation

- **WHEN** the workflow-author expert is used for a pipeline
- **THEN** it SHALL guide authoring a valid `pipeline.yaml` and running the pipeline authoring CLI loop before installation

#### Scenario: Review expert reviews a pipeline

- **WHEN** the workflow-review expert reviews a pipeline
- **THEN** it SHALL check stage-DAG acyclicity, unique stage ids, decompose recursion bound, runtime/model resolvability, and skill enablement

### Requirement: Package trust boundary is documented

The documentation SHALL state the community-package trust boundary honestly: a community package is a set of executable prompts; the mitigations are transactional install, content digest verification, structural validation, and the author/review experts; there is no signature system and no marketplace. The documentation SHALL state the limitations plainly — a digest verifies byte integrity, not safety; validation is structural, not behavioral; the review expert is a mitigation, not a guarantee.

#### Scenario: Trust boundary and its limits are stated

- **WHEN** the workflow-packages documentation is read
- **THEN** it SHALL state that community packages are executable prompts
- **AND** it SHALL list the mitigations (transactional install, digest, validation, review experts) and that there is no signature system or marketplace
- **AND** it SHALL state that a digest verifies integrity but not safety and that validation is structural, not behavioral
