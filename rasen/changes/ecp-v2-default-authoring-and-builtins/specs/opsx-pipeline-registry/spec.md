# opsx-pipeline-registry Specification Delta

## MODIFIED Requirements

### Requirement: Data-Driven Pipeline Definitions

The system SHALL define pipelines as content-versioned data files at `pipelines/<name>/pipeline.yaml`, each containing either a v1 compatibility definition or a canonical v2 typed graph and parsed through the authoritative preparation seam. Newly scaffolded definitions and Change-level package built-ins SHALL be authored at v2; valid unversioned and v1 sources SHALL remain compatibility inputs.

#### Scenario: Native v2 pipeline file shape

- **WHEN** a newly scaffolded or Change-level built-in `pipeline.yaml` is loaded
- **THEN** its authored definition SHALL declare `version: 2`, stable definition/source identities, typed contracts, declarations, and a root graph
- **AND** each AtomicStage SHALL declare an exact trusted capability plus its closed execution contract
- **AND** parse or validation failures SHALL identify the offending file and JSON Pointer path

#### Scenario: Historical stage DAG remains readable

- **WHEN** a historical file with no `version` or with `version: 1` is loaded
- **THEN** it SHALL be accepted as authored v1 when valid and normalized through preparation without rewriting its source

#### Scenario: Definitions expose a deterministic dependency graph

- **WHEN** a v1 stage DAG or a v2 typed graph declares dependency connections
- **THEN** the registry SHALL expose one deterministic build order and ready/blocked execution view from the prepared definition

### Requirement: Pipeline content format v1 is backward-readable and future-safe

Rasen SHALL accept top-level Pipeline content versions `1` and `2`. Version 2 SHALL be the canonical authored form for new public definitions and Change-level built-ins; historical unversioned definitions SHALL remain readable as v1 compatibility inputs. Any unsupported explicit version SHALL fail closed with an actionable diagnostic naming the received and supported versions. Pipeline content versions SHALL remain distinct from a `.rasenpkg` package format version.

#### Scenario: Historical unversioned definition normalizes to v1 compatibility

- **WHEN** Rasen loads a valid project, user, package, JSON, or YAML Pipeline definition that has no top-level `version`
- **THEN** the authored definition is accepted as version 1 with the same compatibility meaning it had before versioning
- **AND** preparation exposes its normalized v2 plan without rewriting the source

#### Scenario: Unknown future version fails closed

- **WHEN** a Pipeline definition explicitly declares a content version other than `1` or `2`
- **THEN** load, validation, save, and export refuse it without modifying installed content
- **AND** the diagnostic identifies `/version`, the unsupported value, the supported values, and that a newer compatible Rasen version is required

#### Scenario: Canonical new outputs expose v2

- **WHEN** Rasen scaffolds a Pipeline or returns a fresh public blank definition
- **THEN** the resulting definition explicitly carries `version: 2` and the complete blank v2 envelope
- **AND** saving or exporting an authored v2 definition preserves all semantic fields and digests

#### Scenario: Existing v1 sources stay v1 compatibility inputs

- **WHEN** Rasen shows, saves, or exports a valid authored v1 definition, including an unversioned legacy definition
- **THEN** its public authored definition or packaged `pipeline.yaml` carries version 1
- **AND** no read operation rewrites its source or relabels it as natively authored v2

#### Scenario: Existing flat DAG and loops remain compatibility inputs

- **WHEN** a v1 definition uses the existing flat `requires` DAG and `stage.loop.kind: review-cycle` or `stage.loop.kind: goal`
- **THEN** it remains readable without user migration and prepares to its equivalent immutable v2 plan where supported
- **AND** its compatibility status remains observable

#### Scenario: Canvas documentation distinguishes authoring from Run state

- **WHEN** a user reads Pipeline and Canvas authoring documentation
- **THEN** it states that Canvas edits Definition v2, the reconciler executes supported Change-level definitions, and the canonical Run Record owns runtime state
- **AND** it identifies authored v1 as compatibility input rather than the default authoring format

### Requirement: Built-In Pipelines

The package SHALL ship six native Definition v2 Change-level built-ins and the separately labeled v1 `auto-decompose` compatibility fixture. Every named file SHALL be included in the published package; membership SHALL be tracked by explicit constants rather than a filename pattern.

#### Scenario: Change-level built-ins are authored v2

- **WHEN** no user or project pipelines are defined
- **THEN** `bug-fix`, `small-feature`, `full-feature`, `goal-loop-measure`, `goal-loop-evaluate`, and `goal-loop-research` SHALL resolve from the package as authored version 2
- **AND** each SHALL prepare as reconciler-executable with exact capability bindings and no authored legacy runtime fields

#### Scenario: Goal-loop built-ins remain explicitly registered package files

- **WHEN** the package built-in list is inspected
- **THEN** the three named goal-loop pipelines SHALL be present in the explicit Change-level built-in set
- **AND** their package files SHALL not depend on wildcard discovery for correctness

#### Scenario: auto-decompose remains a labeled v1 compatibility fixture

- **WHEN** `auto-decompose` resolves from the package
- **THEN** its authored manifest remains version 1 and byte-identical to the pre-migration fixture
- **AND** list/show/API identify its `issue-dispatch-0.3.0` compatibility boundary
- **AND** it is absent from the Change-level v2 migration set

## ADDED Requirements

### Requirement: Pipeline init authors the canonical blank v2 definition

`rasen pipeline init <name> --output <dir>` SHALL write a minimal valid Definition v2 envelope through the canonical serializer without installing it. The output directory safety rules and identifier matching SHALL remain unchanged.

#### Scenario: Init creates an empty executable-language draft

- **WHEN** a user initializes a new pipeline into an empty matching directory
- **THEN** `pipeline.yaml` contains version 2, stable id/source identity, empty typed contracts/declarations, and an empty root graph
- **AND** validation accepts it as a blank authoring draft without adding hidden stages

#### Scenario: Init is cross-platform and collision safe

- **WHEN** init runs with a valid absolute Windows or POSIX output path
- **THEN** it writes only the named target using platform path resolution
- **AND** an occupied or mismatched directory is refused without overwriting content

### Requirement: Registry and CLI share one v2 execution projection

Registry listing, `pipeline show`, CLI execution preflight, and Management consumers SHALL use one prepared execution projection for both authored versions. For native v2 it SHALL include logical build order, nodes/stages, requirements, exact capability, authored and effective execution policy, bounded-loop lifecycle, and engine support; human and JSON output SHALL not fall back to raw definition JSON or an empty stage list.

#### Scenario: V2 show is as actionable as v1 show

- **WHEN** `rasen pipeline show small-feature --json` and human-readable show inspect the native v2 built-in
- **THEN** both expose its build order, roles, gates, verification policy, capabilities, ReviewCycle lifecycle, and reconciler engine support from the same projection
- **AND** the ordinary v1-normalization warning is absent

#### Scenario: Execution view and launch profile agree

- **WHEN** a v2 definition is inspected and then launched under unchanged configuration
- **THEN** every capability path and effective policy fact reported by inspection agrees with the frozen launch profile
- **AND** missing or mismatched capability pins fail before Run creation

#### Scenario: Native v2 host route is preflighted before selection

- **WHEN** a native v2 stage resolves to a runtime different from the detected Codex or Claude host
- **THEN** execution preflight probes the same bridge named by the shared prepared projection before selecting an engine or creating a Run
- **AND** an unsupported route or unavailable bridge fails with a stable preflight error instead of reaching runtime dispatch

### Requirement: Effective workflow selection enables every reachable pipeline capability

The install, removal, drift, and execution-enablement selection SHALL transitively include every workflow or expert that owns a capability reachable through a selected workflow's `requires.pipelines`. The closure SHALL include root stages, Composite declaration bodies, bounded-loop strategies, conditional branches, downstream tails, and compatibility decompose children. Dependency-only internal workflows SHALL remain absent from selectable profile roots and the built-in upgrade baseline.

#### Scenario: Core auto pipelines prepare under the installed catalog

- **WHEN** the production core profile resolves `auto-command`
- **THEN** every pipeline listed by that driver prepares with all referenced skill capabilities enabled
- **AND** transitive capability owners are installed without becoming new profile-picker roots

#### Scenario: Custom goal driver prepares its goal pipeline

- **WHEN** a custom profile selects only `goal-command`
- **THEN** `goal-loop-measure` prepares with its plan, work, judge, strategy, ship, retain, and archive capabilities enabled
- **AND** `goal-judge` remains an internal dependency rather than a selectable built-in id
