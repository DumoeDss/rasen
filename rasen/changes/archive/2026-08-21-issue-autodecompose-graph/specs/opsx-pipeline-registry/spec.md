## MODIFIED Requirements

### Requirement: Pipeline content format v1 is backward-readable and future-safe

Rasen SHALL identify the normalized Pipeline definition content format with the
top-level integer `version: 1`. Historical unversioned definitions SHALL remain
readable as v1, while a definition carrying any unsupported explicit version
SHALL fail closed with an actionable diagnostic naming both the received and
supported versions. The Pipeline content version SHALL remain distinct from a
`.rasenpkg` package format version.

#### Scenario: Historical unversioned definition normalizes to v1

- **WHEN** Rasen loads a valid project, user, package, JSON, or YAML Pipeline definition that has no top-level `version`
- **THEN** the normalized definition is accepted as `version: 1` with the same stage DAG and runtime meaning it had before versioning

#### Scenario: Unknown future version fails closed

- **WHEN** a Pipeline definition explicitly declares a content version other than `1`
- **THEN** load, validation, save, and export refuse it without modifying installed content
- **AND** the diagnostic identifies `/version`, the unsupported value, the supported value `1`, and that a newer compatible Rasen version is required

#### Scenario: Canonical outputs expose v1

- **WHEN** Rasen scaffolds, shows, saves, or exports a valid Pipeline definition, including an unversioned legacy definition
- **THEN** the resulting public definition or packaged `pipeline.yaml` explicitly carries `version: 1`
- **AND** save/export preserve all other normalized fields and do not rewrite the source file merely because it was read or exported

#### Scenario: Existing flat DAG and loops remain compatibility inputs

- **WHEN** a v1 definition uses the existing flat `requires` DAG and `stage.loop.kind: review-cycle` or `stage.loop.kind: goal`
- **THEN** it remains readable without user migration and retains its current LEAD-playbook execution meaning
- **AND** the v1 definition remains a supported source input for a future compiled Composite run plan

#### Scenario: Canvas documentation does not imply a runner

- **WHEN** a user reads the Pipeline and Canvas authoring documentation
- **THEN** it states that Canvas views and edits definitions, current loop declarations are interpreted by the LEAD orchestration playbook, and Canvas is not a programmatic Pipeline runner

#### Scenario: A decompose-bearing v1 definition reports its dispatch boundary

- **WHEN** engine-support analysis runs on a v1 definition that contains a `kind: decompose` stage
- **THEN** it reports the definition unsupported on the reconciler engine with the semantics reason — the decompose stage is a Dispatch-domain construct the reconciler does not execute as an engine node — rather than reporting an execution profile as unavailable
- **AND** the definition remains a readable compatibility input whose entry pipeline keeps its recorded successor boundary, with the fail-closed launch outcome unchanged
