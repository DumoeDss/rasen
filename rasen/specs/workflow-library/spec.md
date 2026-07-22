# workflow-library Specification

## Purpose

Define the ownership and localization boundary for installable user workflows in the user-wide workflow library.
## Requirements
### Requirement: CLI locale does not rewrite user-authored workflow content

Rasen SHALL treat user-authored workflow content as a single source authored in the user's chosen language. Locale resolution SHALL apply only to Rasen-owned presentation and SHALL NOT translate, replace, or select locale variants for user-authored workflow content.

User-authored content includes the `SKILL.md` frontmatter, description, instructions, sidecars, and `workflow.yaml` command metadata. Existing tool-adapter and configuration transformations that are unrelated to locale remain permitted.

#### Scenario: Switching the CLI locale preserves user-authored content

- **WHEN** a valid user workflow is installed with a user-authored name, description, instructions, command metadata, or sidecar content
- **AND** the resolved CLI locale changes among English, Japanese, and Simplified Chinese
- **THEN** Rasen-owned labels, prompts, results, and diagnostics SHALL use the resolved locale
- **AND** every user-authored workflow value SHALL remain in its original language
- **AND** generated skill and command artifacts SHALL NOT change solely because the CLI locale changed

#### Scenario: User workflow package round-trip preserves authored language

- **WHEN** a user workflow is exported and imported through a workflow or profile package
- **THEN** its user-authored content SHALL be preserved without translation or locale-based substitution
- **AND** package identity and digest calculation SHALL NOT depend on the importing machine's CLI locale

#### Scenario: Initial schema rejects locale variants

- **WHEN** a user workflow declares an unsupported `locales` field or locale-specific file mapping in `workflow.yaml` or `SKILL.md` frontmatter
- **THEN** strict workflow validation SHALL reject the unknown field
- **AND** Rasen SHALL NOT silently select, merge, or ignore a locale variant

### Requirement: Workflow machine contracts are locale-neutral

Workflow IDs, skill names, command IDs, dependency IDs, enum values, paths, digests, and JSON field names SHALL remain stable machine values and SHALL NOT be translated.

#### Scenario: Machine-readable workflow output is stable across locales

- **WHEN** the same workflow command is run with `--json` under different CLI locales
- **THEN** machine contract values SHALL remain unchanged
- **AND** any user-authored strings included in the payload SHALL be returned verbatim

### Requirement: Rasen-owned workflow presentation is localized

Rasen SHALL localize its own workflow-library help, option descriptions, prompts, result text, diagnostics, source labels, and built-in workflow presentation metadata through the English, Japanese, and Simplified Chinese locale catalogs.

#### Scenario: User workflow appears in a localized picker

- **WHEN** a user workflow is displayed in the profile picker under any supported CLI locale
- **THEN** the picker prompt, instructions, dependency messages, and user-source label SHALL use the resolved CLI locale
- **AND** the workflow's user-authored name and description SHALL be presented without translation
- **AND** the picker MAY apply the bounded display-only truncation defined by the `profiles` specification without modifying the authored source

#### Scenario: Workflow machine output remains locale-neutral

- **WHEN** a workflow library command emits JSON under English, Japanese, or Simplified Chinese
- **THEN** field names, IDs, source and kind enum values, paths, digests, diagnostic codes, and user-authored values SHALL be identical across locales

### Requirement: Workflow definitions carry a kind classification

Every workflow definition SHALL carry a `kind` classifying its role, drawn from the values `task`, `driver`, and `internal`. `task` denotes an inner-loop operation a user or agent invokes directly; `driver` denotes an outer-loop engine that consumes pipelines; `internal` denotes a sub-unit invoked by a driver rather than directly by a user. The kind set is extensible (a future `expert` kind is anticipated) and SHALL be represented so that additional values can be introduced without breaking existing definitions.

Built-in workflows SHALL be classified as follows: the pipeline-driving engines (`auto-command`, `goal-command`) are `driver`; the goal sub-units (`goal-plan`, `goal-iterate`, `goal-report`) are `internal`; all other built-ins are `task`.

`kind` is catalog/presentation metadata: it SHALL NOT participate in workflow digest computation (neither the built-in digest nor the user-workflow file digest). Adding or changing a definition's `kind` SHALL NOT change its digest, and SHALL NOT by itself trigger drift-healing of an installed workflow.

#### Scenario: Built-in workflows expose their kind

- **WHEN** the built-in workflow catalog is enumerated
- **THEN** `auto-command` and `goal-command` SHALL have kind `driver`
- **AND** `goal-plan`, `goal-iterate`, and `goal-report` SHALL have kind `internal`
- **AND** every other built-in SHALL have kind `task`

#### Scenario: Kind does not affect digest

- **WHEN** a workflow definition's kind is set or changed
- **THEN** its computed digest SHALL be unchanged
- **AND** an already-installed copy SHALL NOT be flagged for drift solely because of its kind

### Requirement: User workflows default to task kind and may declare kind in the manifest

A user (packaged or installed) workflow SHALL default to kind `task` when its `workflow.yaml` manifest does not declare a kind. The manifest MAY optionally declare a `kind` restricted to `task` or `internal`; `driver` is reserved for built-in engines and SHALL NOT be a valid user-declared kind. A manifest declaring an out-of-range kind SHALL fail strict validation. The declared kind SHALL NOT introduce a new serialized package field or require a manifest version bump — it is carried within the existing manifest file content.

#### Scenario: Manifest without kind defaults to task

- **WHEN** a user workflow whose `workflow.yaml` omits `kind` is loaded
- **THEN** its definition kind SHALL be `task`

#### Scenario: Manifest declares an allowed kind

- **WHEN** a user workflow's `workflow.yaml` declares `kind: internal`
- **THEN** its definition kind SHALL be `internal`

#### Scenario: Manifest declares a disallowed kind

- **WHEN** a user workflow's `workflow.yaml` declares a kind that is not `task` or `internal`
- **THEN** strict workflow validation SHALL reject it with a manifest schema error

### Requirement: Workflow list groups by kind and hides internal workflows by default

The human-readable `rasen workflow list` output SHALL group workflows by kind, presenting the `task` and `driver` groups under localized headings, and SHALL hide `internal` workflows by default. A `--all` flag SHALL additionally reveal the `internal` group; `--all` SHALL affect only the human-readable output. Group headings SHALL be Rasen-owned localized presentation, not translations of user-authored content.

#### Scenario: Default list hides internal sub-units

- **WHEN** a user runs `rasen workflow list` without `--all`
- **THEN** the output SHALL present the task and driver groups under localized headings
- **AND** the internal goal sub-units SHALL NOT appear

#### Scenario: List with --all reveals internal group

- **WHEN** a user runs `rasen workflow list --all`
- **THEN** the internal group SHALL additionally appear under its localized heading

### Requirement: Workflow JSON output always exposes all workflows with kind

The `--json` output of `rasen workflow list` SHALL include every workflow — `task`, `driver`, and `internal` — regardless of whether `--all` is passed, and SHALL annotate each entry with its `kind` as a stable machine value. Grouping and internal-hiding SHALL apply only to the human-readable output, never to JSON. The `kind` value SHALL be locale-neutral.

#### Scenario: JSON lists internal workflows without --all

- **WHEN** a user runs `rasen workflow list --json` without `--all`
- **THEN** the payload SHALL include internal workflows alongside task and driver workflows
- **AND** each entry SHALL carry its `kind`

#### Scenario: Kind is stable across locales

- **WHEN** `rasen workflow list --json` is run under different CLI locales
- **THEN** each entry's `kind` value SHALL be identical and untranslated

### Requirement: Workflow dependencies are declared in four slots

A workflow definition's `requires` SHALL carry four dependency slots: `workflows`, `skills`, `pipelines`, and `schemas`. The `workflow.yaml` manifest MAY declare any of the four; an omitted slot SHALL default to empty. Each entry SHALL be a stable machine identifier. The `schemas` slot is existence-only in the current round (it declares a dependency to be validated for presence, and does not drive installation). Dependency declarations SHALL NOT participate in workflow digest computation, and adding or changing a `requires` slot SHALL NOT change a workflow's digest.

Built-in workflows SHALL declare their real dependencies: `review-cycle` requires the `rasen-review` skill; `verify-enhanced-command` requires the `rasen-review`, `rasen-cso`, `rasen-qa`, `rasen-design-review`, and `rasen-qa-only` skills; `auto-command` requires the `rasen-review` skill and the `small-feature`, `full-feature`, `bug-fix`, and `auto-decompose` pipelines; `goal-command` requires the `goal-loop-measure`, `goal-loop-evaluate`, and `goal-loop-research` pipelines.

#### Scenario: Manifest omitting a slot defaults to empty

- **WHEN** a user workflow's `workflow.yaml` omits `requires.pipelines` or `requires.schemas`
- **THEN** that slot SHALL resolve to an empty list
- **AND** validation SHALL NOT fail for the omission

#### Scenario: Built-in dependency edges are declared

- **WHEN** the built-in workflow catalog is enumerated
- **THEN** each built-in's `requires` SHALL match its real dependency edges (as above)
- **AND** every declared built-in `requires.skills` and `requires.pipelines` entry SHALL resolve to an existing skill or pipeline

#### Scenario: Dependencies do not affect digest

- **WHEN** a workflow's `requires` slots are populated or changed
- **THEN** its computed digest SHALL be unchanged

### Requirement: Dependency slots are validated for presence

When a workflow is imported or selected, each of its `requires` slots SHALL be validated: `requires.workflows` SHALL be resolved transitively and co-installed (existing selection closure), while `requires.skills`, `requires.pipelines`, and `requires.schemas` SHALL be validated for presence — the named skill SHALL exist in the installed or expert skill set, the named pipeline SHALL resolve among available pipelines, and the named schema SHALL resolve among available schemas. A missing referent SHALL produce a clear validation error naming the missing dependency. Presence-validated slots (skills, pipelines, schemas) SHALL NOT be added to the workflow selection set and SHALL NOT trigger installation in this round.

#### Scenario: User workflow requires a missing pipeline

- **WHEN** a user workflow declares `requires.pipelines` naming a pipeline that does not resolve
- **THEN** validation SHALL fail with an error naming the missing pipeline

#### Scenario: Required workflow is co-installed via closure

- **WHEN** a selected workflow declares `requires.workflows` naming another workflow not otherwise selected
- **THEN** the required workflow SHALL be resolved and installed as part of the selection closure

### Requirement: Workflow delete refcount guard supports a force override

`rasen workflow delete` SHALL, by default, refuse to delete a user workflow that is still referenced — by another workflow's `requires.workflows`, by a pipeline stage's skill reference, by a global or named-profile selection, or by the project artifact ledger — and SHALL name the referrers. Built-in workflows SHALL never be deletable regardless of any flag. A `--force` flag SHALL bypass only the referrer guard: the delete proceeds, a warning naming every referrer left dangling SHALL be emitted, and (in `--json`) the forced referrers SHALL be reported. Confirmation (`-y`/`--yes` or interactive prompt) SHALL still be required.

#### Scenario: Delete refused when referenced

- **WHEN** a user runs `rasen workflow delete <id>` without `--force` and the workflow is referenced
- **THEN** the deletion SHALL be refused with an error naming the referrers

#### Scenario: Force override deletes and warns

- **WHEN** a user runs `rasen workflow delete <id> --force --yes` and the workflow is referenced
- **THEN** the workflow SHALL be deleted
- **AND** a warning naming every dangling referrer SHALL be emitted

#### Scenario: Force never deletes a built-in

- **WHEN** a user runs `rasen workflow delete <built-in-id> --force`
- **THEN** the deletion SHALL still be refused because built-in workflows cannot be deleted

### Requirement: Dependency validation resolves project-layer referents

When a workflow's `requires.pipelines` and `requires.schemas` are validated for presence, the validation SHALL accept an optional project context and, when present, resolve referents across the package, user, AND project layers — so a dependency naming a project-layer pipeline or schema is recognized as present. When no project context is supplied, validation SHALL resolve across the package and user layers as before, without regression. The CLI commands that validate or import workflows SHALL supply the resolved project root as the project context.

#### Scenario: Project-layer pipeline dependency resolves

- **WHEN** a workflow declares `requires.pipelines` naming a pipeline that exists only in the project layer
- **AND** validation is run with the project context
- **THEN** the dependency SHALL be recognized as present and validation SHALL pass

#### Scenario: Validation without project context is unchanged

- **WHEN** a workflow directory is validated without a project context
- **THEN** package- and user-layer referents SHALL still resolve as before
- **AND** no regression SHALL occur for workflows whose dependencies resolve at those layers

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

### Requirement: Experts are first-class catalog units

The 21 built-in experts SHALL be members of the unified workflow catalog with `kind: 'expert'` and `source: 'built-in'`, carrying no command. Each expert SHALL carry a digest computed over its template and its sidecar directory tree, and SHALL preserve its sidecar source alias (an expert may materialize its sidecars from another expert's directory). `workflow list` SHALL present an `expert` group, shown by default alongside `task` and `driver`; `--json` SHALL expose experts with `kind: 'expert'` like any other unit. Enumerating the built-in catalog SHALL include the expert units.

#### Scenario: Experts appear in the catalog with kind expert

- **WHEN** the built-in catalog is enumerated
- **THEN** each of the 21 experts SHALL appear with `kind: 'expert'`, `source: 'built-in'`, no command, and a digest
- **AND** an expert that borrows another expert's sidecar directory SHALL retain that alias

#### Scenario: Experts listed by default

- **WHEN** a user runs `rasen workflow list` without `--all`
- **THEN** the `expert` group SHALL be shown
- **AND** `rasen workflow list --json` SHALL include experts annotated with `kind: 'expert'`

#### Scenario: Expert digest covers template and sidecars

- **WHEN** an expert's template or a sidecar file changes
- **THEN** its digest SHALL change
- **AND** two experts sharing one sidecar directory SHALL have distinct digests

### Requirement: Delete guard protects skills referenced by requires.skills

The workflow delete refcount guard SHALL additionally refuse to delete a unit whose skill is referenced by any installed workflow's `requires.skills` (in addition to `requires.workflows` and pipeline stage skill references), naming the referrers. Built-in units, including experts, SHALL remain non-deletable regardless of any flag.

#### Scenario: Skill referenced by requires.skills is protected

- **WHEN** a unit's skill is named in another workflow's `requires.skills`
- **AND** a user attempts to delete that unit without `--force`
- **THEN** the deletion SHALL be refused, naming the referrers

#### Scenario: Built-in expert cannot be deleted

- **WHEN** a user attempts to delete a built-in expert, even with `--force`
- **THEN** the deletion SHALL be refused because built-in units cannot be deleted

### Requirement: Expert installation is profile-default plus dependency closure

The set of experts installed into a project SHALL be the experts named by the resolved profile selection, together with the dependency closure of every selected workflow's `requires.skills`. Experts SHALL NOT be installed unconditionally. A workflow's `requires.skills` reference SHALL be resolved through either skill identity form (the colon `template.name` form or the hyphen `dirName` form) so a required expert is pulled regardless of which form the workflow declares.

#### Scenario: Profile-default experts are installed

- **WHEN** a profile resolving to a given expert set is installed via `rasen init` or `rasen update`
- **THEN** exactly the experts in that profile's default expert set (plus any pulled by dependency closure) SHALL be installed
- **AND** experts outside that set SHALL NOT be installed, unless a selected workflow requires them

#### Scenario: Dependency closure pulls required experts

- **WHEN** a selected workflow declares an expert in its `requires.skills` (for example `auto-command`, `review-cycle`, or `verify-enhanced-command` requiring `review`)
- **AND** the resolved profile does not otherwise name that expert
- **THEN** the required expert SHALL still be installed
- **AND** this SHALL hold whether the workflow declares the colon or hyphen skill-identity form

#### Scenario: Deselected expert is installed only when referenced

- **WHEN** an expert is neither in the resolved profile's expert set nor pulled by any selected workflow's `requires.skills`
- **THEN** that expert SHALL NOT be installed
- **AND** an install already present on disk SHALL be removable on the next update (subject to the deletion/refcount guard)

### Requirement: A referenced expert cannot be pruned

An expert that is referenced by any selected workflow's dependency closure SHALL remain installed even when the active profile does not name it, and SHALL be protected from deletion by the workflow refcount guard. Built-in experts SHALL remain non-deletable regardless of any flag.

#### Scenario: Closure-required expert survives a lean profile

- **WHEN** a lean profile omits an expert that a selected workflow requires
- **THEN** the expert SHALL be installed and retained
- **AND** an attempt to delete it while the referring workflow is installed SHALL be refused, naming the referrer

### Requirement: The `ff` workflow is not a built-in

The built-in workflow set SHALL NOT include a workflow with id `ff`. The `propose` workflow is the canonical entry point for generating a change and all its artifacts in one step; no built-in adapter, skill template, or command template for `ff` SHALL be registered.

#### Scenario: ff absent from the built-in registry

- **WHEN** the built-in workflow definitions are enumerated
- **THEN** no definition SHALL have id `ff`
- **AND** no built-in skill directory named `rasen-ff-change` SHALL be produced

### Requirement: Stored workflow selections tolerate unknown ids

When a stored workflow selection read from global config (a `custom` profile's workflow list) references a workflow id that is not present in the current catalog, resolution of that stored selection SHALL drop the unknown id with a warning rather than failing. This tolerance applies to selections read from persisted configuration; explicitly authored named-profile files retain strict validation with immediate errors.

#### Scenario: Stored selection lists a retired id

- **WHEN** a stored `custom` profile selection lists an id (such as a retired `ff`) that is not in the catalog
- **THEN** the unknown id SHALL be dropped from the resolved selection
- **AND** a warning naming the dropped id SHALL be emitted
- **AND** resolution SHALL succeed for the remaining known ids

