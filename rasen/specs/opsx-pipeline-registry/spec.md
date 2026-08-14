# opsx-pipeline-registry Specification

## Purpose
Define the data-driven pipeline registry — pipeline definitions, dual-root extensible resolution (project / user / package), the `rasen pipeline` CLI surface, pipeline validation, and the built-in pipelines.
## Requirements
### Requirement: Data-Driven Pipeline Definitions

The system SHALL define pipelines as content-versioned data files at `pipelines/<name>/pipeline.yaml`, each an ordered DAG of stages, parsed and validated into typed objects through a loader that mirrors the artifact-graph schema loader.

#### Scenario: Pipeline file shape

- **WHEN** a `pipeline.yaml` is loaded
- **THEN** its normalized definition SHALL declare `version: 1`, a `name`, optional `description`, and a non-empty `stages` array
- **AND** a historical file with no `version` SHALL be accepted and normalized to `version: 1`
- **AND** it MAY declare an `origin` field whose values are `composed` (a pipeline assembled by the autopilot LEAD) or `ui` (a pipeline assembled in the management UI's canvas); absent means human-authored; `rasen pipeline show` SHALL surface the field when present
- **AND** each stage SHALL declare an `id` and a `skill`, and MAY declare `role`, `requires`, `gate`, `loop`, `parallelGroup`, `condition`, `leadReview`, and `verifyPolicy`
- **AND** parse or validation failures SHALL raise a typed error identifying the offending file and field

#### Scenario: Stages form a dependency DAG

- **WHEN** a pipeline declares stages with `requires` edges
- **THEN** the registry SHALL expose a stage build order via topological sort
- **AND** SHALL expose, for a set of completed stages, which stages are ready and which are blocked

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

### Requirement: Pipeline save subcommand installs a definition into the user layer

The `rasen pipeline` command group SHALL provide `save <name> --from <file>` (with `--force` and `--json`), reading the file as a pipeline definition (JSON or YAML), validating it through the full structural chain plus the skill known/enabled checks, and installing it as the named USER pipeline, emitting canonical YAML. Without `--force` an existing user pipeline of that name SHALL be refused; a built-in name SHALL be refused regardless of `--force`. The subcommand SHALL preserve the definition's `origin` field verbatim and stamp none itself, and SHALL resolve its root through the same shared root-selection layer as every other pipeline subcommand. A definition saved and then read back (via `pipeline show` or export) SHALL be semantically identical to the input after loader normalization.

#### Scenario: Save installs a valid definition

- **WHEN** `rasen pipeline save my-pipe --from <absolute path to a valid definition file>` runs
- **THEN** the pipeline is installed under the user pipelines layer and `rasen pipeline list --json` reports it with source `user`

#### Scenario: Overwrite requires force, built-ins refused

- **WHEN** `save` targets an existing user pipeline without `--force`, or a built-in pipeline name with `--force`
- **THEN** the former is refused naming the overwrite flag and the latter is refused naming the built-in protection, and no file is modified in either case

#### Scenario: Invalid definition never installs

- **WHEN** `save` is given a definition failing any structural or skill rule
- **THEN** the command fails reporting the violation and the user layer is unchanged

#### Scenario: Round-trip fidelity

- **WHEN** a definition containing optional fields (agents, handoff, loop configuration, parallel groups) is saved and read back
- **THEN** every field survives with equal values after loader normalization

### Requirement: Dual-Root Extensible Resolution

Pipelines SHALL resolve from package built-ins, a user directory, and a project directory using the same precedence Rasen uses for schemas (project ⊃ user ⊃ package).

#### Scenario: Project overrides user overrides package

- **WHEN** a pipeline `<name>` exists in more than one root
- **THEN** the project copy (`<projectRoot>/rasen/pipelines/<name>/pipeline.yaml`) SHALL win over the user copy (`${XDG_DATA_HOME}/rasen/pipelines/...`), which SHALL win over the package built-in
- **AND** listing SHALL report each resolved pipeline's `source` (`project` | `user` | `package`)

#### Scenario: Adding a task type requires only data

- **WHEN** a new pipeline definition file is added under any pipelines root
- **THEN** it SHALL become available to listing, show, classification, and orchestration with no change to TypeScript source

### Requirement: Pipeline CLI Surface

The system SHALL provide a `rasen pipeline` command group with `list`, `show <name>`, `agents <name>`, `classify "<task>"`, `resume <change>`, `init <name>`, `validate <name-or-path>`, `import <path>`, `export <name> <path>`, and `delete <name>` subcommands, each supporting `--json`. Every subcommand SHALL resolve its Rasen root through the shared root-selection layer used by `rasen validate` — the same nearest-root walk, implicit-root fallback, and `--store <id>` selector — so a given directory or store resolves to the identical root across `pipeline` and `validate`. No pipeline subcommand SHALL resolve its root from the current working directory alone. `resume` SHALL locate run-state per the `file-placement` capability's sticky-legacy chain: the execution root's ephemera directory is checked first, then the legacy machine-home work directory, then the change directory — and the JSON output SHALL report the directory the run-state (or portfolio state) was actually read from (`runStateDir`) so a resuming orchestrator writes updates where it read them. Locating run-state SHALL NOT write to the repository or the registry.

The `init`, `validate`, `import`, `export`, and `delete` subcommands SHALL mirror the corresponding `rasen workflow` verbs in behavior and UX: `init` scaffolds a minimal pipeline draft; `validate` runs structural pipeline validation; `import`/`export` round-trip a `.rasenpkg` pipeline package; `delete` removes a user pipeline subject to the refcount guard.

#### Scenario: List and show

- **WHEN** `rasen pipeline list --json` runs
- **THEN** it SHALL print the resolved pipelines with name, description, and source
- **WHEN** `rasen pipeline show <name> --json` runs
- **THEN** it SHALL print the pipeline's full stage DAG including all stage metadata

#### Scenario: Classify

- **WHEN** `rasen pipeline classify "<task description>" --json` runs
- **THEN** it SHALL return a suggested pipeline name plus the indicators that drove the suggestion
- **AND** it SHALL report the suggestion's basis: `keyword` when indicators matched, `default` when the suggestion is the fallback default with no matched indicators
- **AND** the suggestion SHALL be overridable by the caller

#### Scenario: Resume

- **WHEN** `rasen pipeline resume <change> --json` runs
- **THEN** it SHALL return the next incomplete stage and the remaining stages, derived from the change's artifacts and run-state
- **AND** the run-state SHALL be read from the execution root's ephemera directory when present there, then the legacy machine-home work directory, then the change directory in the resolved root — never from the current working directory alone
- **AND** when run-state is found, the JSON SHALL include `runStateDir` naming the directory it was read from

#### Scenario: Resume reads legacy run-state

- **WHEN** `rasen pipeline resume <change> --json` runs for a change whose `auto-run.json` predates the ephemera directory and lives in the machine-home work directory or the change directory
- **THEN** it SHALL read that run-state (`hasRunState: true`) and report that legacy directory as `runStateDir`

#### Scenario: Root resolution matches validate

- **WHEN** `rasen pipeline list --json` and `rasen validate --pipelines --json` are run from the same subdirectory of a project, or with the same `--store <id>`
- **THEN** both SHALL resolve to the same Rasen root and report the same set of pipelines

#### Scenario: Store selection

- **WHEN** any `pipeline` subcommand is run with `--store <id>` naming a registered store
- **THEN** it SHALL operate on that store's root
- **AND** `pipeline resume <change> --store <id>` SHALL read run-state per the same sticky-legacy chain (the execution root's ephemera directory, the legacy work directory, then the store's change directory) and report `hasRunState: true` when that change has recorded run-state

#### Scenario: Init and validate

- **WHEN** `rasen pipeline init <name> --output <dir>` runs
- **THEN** it SHALL scaffold a minimal valid `pipeline.yaml` draft at the output location without installing it
- **WHEN** `rasen pipeline validate <name-or-path>` runs
- **THEN** it SHALL apply the structural pipeline validation rules and report pass/fail

### Requirement: Pipeline Validation

`rasen validate` SHALL validate pipeline definitions for structural integrity.

#### Scenario: Structural rules enforced

- **WHEN** a pipeline is validated
- **THEN** validation SHALL fail if stage ids are not unique, if any `requires` references a missing stage, if the dependency graph contains a cycle, if a `skill` is not a registered skill, or if a `role` is unknown
- **AND** `parallelGroup` members SHALL be mutually independent in the DAG

#### Scenario: Origin-stamped quality floor enforced

- **WHEN** a pipeline declaring an `origin` (`composed` or `ui`) is parsed or validated
- **THEN** it SHALL fail unless it contains at least one stage with role `reviewer` and at least one stage with `loop.kind: review-cycle`, with the failure message naming the pipeline's actual origin value
- **AND** pipelines without an `origin` field SHALL be entirely unaffected by this rule — existing built-in, user, and project pipelines parse and validate unchanged

### Requirement: Built-In Pipelines

The package SHALL ship built-in pipelines for the initial task types and the goal-loop family. Each SHALL be included in the published package files.

#### Scenario: Initial built-ins present

- **WHEN** no user or project pipelines are defined
- **THEN** `full-feature`, `small-feature`, and `bug-fix` SHALL resolve from the package
- **AND** they SHALL be included in the published package files

#### Scenario: Goal-loop built-ins present

- **WHEN** no user or project pipelines are defined
- **THEN** `goal-loop-measure`, `goal-loop-evaluate`, and `goal-loop-research` SHALL resolve from the package
- **AND** they SHALL be included in the published package files
- **AND** they SHALL be auto-discovered from `pipelines/goal-loop-*/pipeline.yaml` with no TypeScript registration

### Requirement: Decompose 阶段类型

流水线 stage schema SHALL 支持一个 `kind` 字段，取值为 `standard`（默认）与 `decompose`，并作为一个具名 enum 常量跟踪。`kind: decompose` 的阶段是一个由 LEAD 解释的扇出点，而非单次 skill 调用；对于这样的阶段，`skill` 字段 SHALL 为可选，且一个可选的 `childPipeline` 字段 SHALL 指明每个子 change 运行的流水线。

#### Scenario: 解析一个 decompose 阶段

- **WHEN** 某条流水线 YAML 声明了一个带 `kind: decompose` 与 `childPipeline: small-feature` 且无 `skill` 的阶段
- **THEN** 注册表 SHALL 接受它，并在解析出的阶段上暴露 `kind = 'decompose'` 和 `childPipeline = 'small-feature'`

#### Scenario: 标准阶段不受新字段影响

- **WHEN** 某条既有流水线声明了一个不带 `kind` 字段的阶段
- **THEN** 解析出的阶段 SHALL 默认为 `kind = 'standard'`
- **AND** 它必填的 `skill` 字段 SHALL 仍像以前一样被强制要求

### Requirement: Decompose 阶段校验

流水线校验 SHALL 强制每条流水线**至多包含一个** `decompose` 阶段，且当存在时，它 SHALL 是 build order 中的**第一个**阶段。违反者 SHALL 使 `rasen validate --type pipeline` 以确定性错误失败。

#### Scenario: 多于一个 decompose 阶段

- **WHEN** 某条流水线声明了两个 `kind: decompose` 的阶段
- **THEN** 校验 SHALL 失败，并给出指明重复 decompose 阶段的错误

#### Scenario: decompose 阶段不在首位

- **WHEN** 某条流水线声明的 `decompose` 阶段不在 build-order 索引 0
- **THEN** 校验 SHALL 失败，并给出说明 decompose 阶段必须位于首位的错误

### Requirement: Decompose 子流水线解析

decompose 阶段的 `childPipeline` SHALL 通过显式的注册表查找（project > user > package）来解析，绝不通过对名称的模式匹配。解析出的子流水线本身 MUST **不含 decompose**（传递地不包含任何 `decompose` 阶段），从而强制单一层级的扇出。当 `childPipeline` 被省略时，它 SHALL 默认为一条有文档记载的、不含 decompose 的内置流水线（`small-feature`）。

#### Scenario: childPipeline 解析不到

- **WHEN** 某个 decompose 阶段指定了一个没有任何注册表条目能提供的 `childPipeline`
- **THEN** 校验 SHALL 失败，并给出子流水线无法解析的错误

#### Scenario: childPipeline 会导致递归

- **WHEN** 某个 decompose 阶段解析出的 `childPipeline` 自身包含一个 `decompose` 阶段
- **THEN** 校验 SHALL 以递归防护错误失败
- **AND** 该错误 SHALL 指明违规的子流水线

#### Scenario: 省略的 childPipeline 使用默认值

- **WHEN** 某个 decompose 阶段省略了 `childPipeline`
- **THEN** 解析 SHALL 选用默认的、不含 decompose 的内置流水线 `small-feature`

#### Scenario: show 呈现 decompose 阶段

- **WHEN** 对一条首阶段为 `kind: decompose` 的流水线运行 `rasen pipeline show <name> --json`
- **THEN** 输出 SHALL 包含该阶段，并带上其 `kind` 与解析后的 `childPipeline`

### Requirement: Stage Loop Is a Discriminated Union

The `loop` field of a stage SHALL be a Zod discriminated union on a `kind` discriminator with two variants: `review-cycle` (the existing single-round-cap review→fix loop) and `goal` (a goal-driven iteration loop). The union SHALL parse the existing `review-cycle` shape unchanged so existing pipelines validate identically. The `goal` variant SHALL carry a required `gate` that is itself a discriminated union on `kind` with variants `measure` and `evaluate`, plus `maxRounds` (default 5) and `loopStallLimit` (default 2, gate-neutral). A `goal` loop SHALL be rejected if its `measure` gate declares neither `threshold` nor `target`.

#### Scenario: Review-cycle shape parses unchanged under the union

- **WHEN** a stage declares `loop: { kind: review-cycle }` (or with an explicit `maxRounds`)
- **THEN** the discriminated union SHALL parse it to `{ kind: 'review-cycle', maxRounds: 3 }` (default applied when omitted)
- **AND** the parsed shape SHALL equal the pre-union `{ kind: 'review-cycle', maxRounds: 3 }` value

#### Scenario: Goal loop with a measure gate parses

- **WHEN** a stage declares `loop: { kind: goal, gate: { kind: measure, threshold: 90, direction: gte } }`
- **THEN** the union SHALL accept it and expose `loop.kind === 'goal'` with the gate narrowed to the measure variant

#### Scenario: Goal loop with an evaluate gate parses

- **WHEN** a stage declares `loop: { kind: goal, gate: { kind: evaluate, goal: '<text>' } }`
- **THEN** the union SHALL accept it and expose `loop.kind === 'goal'` with the gate narrowed to the evaluate variant

#### Scenario: Measure gate missing a stop condition is rejected

- **WHEN** a goal loop declares `gate: { kind: measure }` with neither `threshold` nor `target`
- **THEN** validation SHALL fail with an error indicating the measure gate needs a threshold or target

#### Scenario: Unknown loop kind is rejected

- **WHEN** a stage declares `loop: { kind: unknown-kind }`
- **THEN** the discriminated union SHALL reject it at parse

### Requirement: Goal-Loop Gate Metadata Rendered in Pipeline Show

The human-readable `rasen pipeline show <name>` output SHALL render a stage's loop metadata for both loop kinds. For a `review-cycle` loop the meta line SHALL remain `loop=review-cycle(max <N>)`. For a `goal` loop the meta line SHALL name the gate kind and both bounds: `loop=goal[<gate-kind>](max <N>, stall <L>)`, where `<gate-kind>` is `measure` or `evaluate`, `<N>` is the goal variant's `maxRounds`, and `<L>` is its `loopStallLimit`. This generalizes the review-cycle-only label that preceded the goal-loop addition.

#### Scenario: Measure gate rendered in show

- **WHEN** `rasen pipeline show goal-loop-measure` renders the `iterate` stage
- **THEN** the stage meta SHALL include `loop=goal[measure](max <maxRounds>, stall <loopStallLimit>)`

#### Scenario: Evaluate gate rendered in show

- **WHEN** `rasen pipeline show goal-loop-evaluate` (or `goal-loop-research`) renders the `iterate` stage
- **THEN** the stage meta SHALL include `loop=goal[evaluate](max <maxRounds>, stall <loopStallLimit>)`

#### Scenario: Review-cycle label unchanged

- **WHEN** `rasen pipeline show <pipeline>` renders a stage with a `review-cycle` loop
- **THEN** the stage meta SHALL include `loop=review-cycle(max <N>)` and SHALL NOT include the goal-loop bracket format

### Requirement: Host-tolerant run-state parsing
Run-state parsing SHALL be host-runtime-neutral: before schema validation, `parseRunState` SHALL normalize worker records (per-stage workers and the portfolio planner record, which share the worker shape) so legitimate variance from a non-Claude LEAD does not reject the file. Normalization SHALL: (1) treat a JSON `null` on an optional string field of the worker record (e.g. `transcript`, `agentId`, `threadId`) as the field being absent, removing the key; (2) when `runtime` carries a string outside `claude|codex`, preserve the original value under the passthrough key `runtimeRaw` and remove `runtime`, rather than rejecting the record or coercing the value to a runtime the worker did not use. The canonical write contract SHALL remain strict: `writeRunState` continues to validate against the unwidened schema.

#### Scenario: Codex-LEAD-written worker record parses
- **WHEN** `parseRunState` reads a run-state whose stage worker carries `"transcript": null` and `"runtime": "codex-host-fallback"`
- **THEN** parsing SHALL succeed
- **AND** the parsed worker SHALL have no `transcript` and no `runtime` field
- **AND** the parsed worker SHALL carry `runtimeRaw: "codex-host-fallback"`

#### Scenario: Canonical records are untouched
- **WHEN** `parseRunState` reads a run-state whose workers carry only canonical values (`runtime` in `claude|codex`, string `transcript`)
- **THEN** the parsed state SHALL be identical to today's parse (no `runtimeRaw`, no removed fields)

#### Scenario: Write contract stays strict
- **WHEN** `writeRunState` is given a state whose worker carries `transcript: null` or a non-enum `runtime`
- **THEN** it SHALL reject the state (validation error) — tolerance is a read-boundary property, not a license to write non-canonical values

### Requirement: Resume distinguishes invalid run-state from absent run-state
`rasen pipeline resume` SHALL report a located-but-unparseable `auto-run.json` (malformed JSON, or schema validation failure after normalization) distinctly from the no-file case, so the failure is diagnosable instead of masquerading as "no run-state found". The JSON output SHALL keep `hasRunState: false` for both cases (additive compatibility) and, for the invalid case, SHALL additionally carry `invalidRunState: true`, the file path, and a note naming the validation reason.

#### Scenario: Invalid run-state file is reported with its reason
- **WHEN** `rasen pipeline resume <change> --json` locates an `auto-run.json` (via the ephemera-first sticky-legacy chain) that fails to parse even after host-tolerance normalization
- **THEN** the output SHALL report `hasRunState: false` and `invalidRunState: true`
- **AND** SHALL name the file path and the parse/validation reason in the note

#### Scenario: Absent run-state is unchanged
- **WHEN** `rasen pipeline resume <change> --json` finds no `auto-run.json` in any location of the chain
- **THEN** the output SHALL report `hasRunState: false` without `invalidRunState`, with the existing "no run-state" note

### Requirement: Per-stage configured models top the stage model resolution chain

The effective model for a stage SHALL resolve with precedence: a `pipelines.<name>.models.<stage>` configuration instance first (itself resolving project over store over global), then the stage-level `model`, then the pipeline `agents.<role>.model` role default, then the project config `models.roles.<role>`, then the project config `models.default`, then the inherited store config `models.roles.<role>`, then the inherited store config `models.default`, then the global config `models.roles.<role>`, then the global config `models.default`, then the runtime's built-in default. Within each machine config scope a per-role model SHALL win over that scope's `models.default`, the machine scopes SHALL rank project > store > global entirely, and the store layers apply only where configuration inheritance is active (see `store-config-inheritance`). A model id at any layer SHALL be an opaque string accepted as-is (no allow-list rejection). `rasen pipeline show <name> --json` SHALL report each stage's resolved model with a source distinguishing the per-stage configured layers (scope-qualified) from the stage, pipeline, project, store, and global layers, and the resolved model SHALL be the one the model-preset (handoff/reuse threshold) layer keys off. Setting a per-stage instance SHALL NOT write any pipeline definition file.

#### Scenario: Per-stage instance beats the stage-level YAML model

- **WHEN** a stage declares `model: sonnet` in its pipeline definition and `pipelines.<name>.models.<that stage>` is set to `fable` at project scope
- **THEN** the stage's resolved model is `fable` with a per-stage project source, and the pipeline definition file is unmodified

#### Scenario: Per-stage instances rank project over store over global

- **WHEN** the same per-stage instance is set to different values at global and project scope
- **THEN** the project value wins, and with only store and global set, the store value wins

#### Scenario: Chain below the top layer is unchanged

- **WHEN** no per-stage instance exists for a stage
- **THEN** resolution ranks stage > pipeline role default > project role > project default > store role > store default > global role > global default > runtime default, byte-identically to before this capability, including all store-layer and no-store behaviors

#### Scenario: pipeline show reports the per-stage source

- **WHEN** a per-stage instance determines a stage's effective model and the user runs `rasen pipeline show <name> --json`
- **THEN** that stage's reported model is the instance value with a source identifying the per-stage configured layer and its scope

### Requirement: Effective stage runtime resolves independently from other stage fields

The effective runtime for a stage SHALL resolve independently from model, sandbox, effort, and session-reuse fields. Runtime precedence SHALL be: the per-role runtime configuration instance (project over store over global), then an explicit stage runtime, then an explicit pipeline `agents.<role>.runtime`, then the detected LEAD host, then the legacy Claude fallback when the host is unknown. A declaration that configures only a non-runtime field SHALL NOT count as an explicit runtime source.

#### Scenario: Model-only stage inherits the Codex host

- **WHEN** a stage declares `model` but no runtime and the detected LEAD host is Codex
- **THEN** the stage resolves runtime `codex` with runtime source `host`
- **AND** its model retains the stage model source

#### Scenario: Model-only role object does not manufacture Claude

- **WHEN** `agents.reviewer` is an object containing a model or lifecycle field but no `runtime`
- **AND** no higher runtime configuration instance or stage runtime exists
- **THEN** reviewer stages inherit the detected host
- **AND** do not treat the object’s omitted runtime as an explicit Claude declaration

#### Scenario: Explicit runtime layers retain precedence

- **WHEN** a configured role runtime, stage runtime, pipeline role runtime, and host default provide different values
- **THEN** the configured role runtime wins over the stage runtime
- **AND** the stage runtime wins over the pipeline role runtime
- **AND** every explicit layer wins over host inheritance

#### Scenario: Unknown host uses the annotated legacy default

- **WHEN** no explicit runtime layer exists and host detection returns unknown
- **THEN** the stage resolves runtime `claude`
- **AND** reports runtime source `legacy-default`

### Requirement: Pipeline execution inspection reports host and dispatch provenance

`rasen pipeline show` and `rasen pipeline agents` SHALL report the detected host runtime and its source, and SHALL report each resolved stage runtime with its independent runtime source and dispatch mode. JSON output SHALL use stable locale-neutral values; human output SHALL present the same facts in the active locale. These fields SHALL be additive to the existing pipeline output.

#### Scenario: Codex-native default is observable

- **WHEN** a Codex-hosted user inspects a pipeline stage with no explicit runtime
- **THEN** output reports host runtime `codex` with its detection source
- **AND** the stage reports runtime `codex`, runtime source `host`, and dispatch mode `native`

#### Scenario: Cross-runtime bridge is observable

- **WHEN** a Claude-hosted pipeline stage explicitly resolves to Codex
- **THEN** the stage reports runtime `codex`
- **AND** reports its explicit runtime source and dispatch mode `exec-bridge`

#### Scenario: Unknown host is not presented as native

- **WHEN** pipeline inspection runs outside a recognized host
- **THEN** output reports host runtime `unknown`
- **AND** implicit stages report runtime source `legacy-default` and dispatch mode `legacy-fallback`

#### Scenario: Existing JSON consumers keep established fields

- **WHEN** a client ignores host and dispatch provenance fields
- **THEN** every pre-existing pipeline and stage field retains its established type and meaning

### Requirement: Per-role runtime updates persist as configuration, not pipeline copies

`rasen pipeline agents <name>` SHALL keep its command surface (per-role runtime flags, `--json`, root selection) while persisting per-role runtime updates as `pipelines.<name>.runtimes.<role>` configuration instances written to the resolved root's configuration through the standard config write path — it SHALL NOT write a pipeline definition file. The effective runtime for a role SHALL resolve: the per-role runtime family instance (project over store over global) first, then an explicit pipeline `agents.<role>.runtime`, then the detected host runtime, then the legacy Claude fallback when the host is unknown. Reads SHALL report each role's resolved runtime with the layer that supplied it and its host × target dispatch mode. A pipeline definition copy previously frozen into a project by the old behavior SHALL remain untouched and SHALL keep resolving as that project's definition (the project layer of pipeline resolution) — the inspection surface's source badge makes the frozen copy visible, and removing it is the user's explicit action, never an automatic migration.

#### Scenario: Setting a runtime writes config, not YAML

- **WHEN** the user runs `rasen pipeline agents small-feature --reviewer codex` in a project
- **THEN** a `pipelines.small-feature.runtimes.reviewer` instance is written to the project's configuration, no `pipeline.yaml` is created or modified, and subsequent upstream changes to the built-in pipeline keep applying in that project

#### Scenario: Runtime chain resolves config over declaration and host

- **WHEN** a pipeline declares `agents.reviewer.runtime: claude`, the detected host is Codex, and the project sets the reviewer runtime instance to `codex`
- **THEN** reviewer-role stages resolve to `codex` with a config-layer source
- **AND** unsetting the instance reverts to the explicit Claude declaration rather than the host

#### Scenario: Undeclared role runtime inherits the host

- **WHEN** no runtime configuration instance or explicit pipeline role runtime exists
- **THEN** the role resolves to the detected host with a host source
- **AND** an unknown host resolves to the visibly labelled legacy default

#### Scenario: Existing frozen copies stay visible, not silently migrated

- **WHEN** a project carries a full pipeline copy written by the old `agents` behavior
- **THEN** that copy still resolves as the project's definition with its project source badge shown, and no automatic deletion or rewrite occurs

### Requirement: Pipeline packages

A `.rasenpkg` package SHALL support a `pipeline` kind that carries one or more pipelines, each as `{ name, digest, files }` where `files` includes the pipeline's `pipeline.yaml`. Packaging and importing a pipeline SHALL reuse the transactional install machinery used for workflow and profile packages: import SHALL stage to a temporary location, re-verify each pipeline's digest after staging, and atomically install into the user pipeline layer, rolling back completely on any failure. Import SHALL display the package's provenance (source path) and the verified digest, and SHALL surface them in `--json`. Pipeline packages SHALL install only into the user layer; the project layer SHALL remain file-based. Structural validation of an imported pipeline SHALL accept skill references in both `rasen-<name>` and `rasen:<name>` forms.

#### Scenario: Round-trip a user pipeline

- **WHEN** a user exports a user pipeline to a `.rasenpkg` and imports it on another machine
- **THEN** the pipeline SHALL be installed into the user pipeline layer with its content preserved
- **AND** the import SHALL report the source path and verified digest

#### Scenario: Import rejects a tampered package

- **WHEN** a pipeline package's contents do not match its recorded digest
- **THEN** import SHALL fail and install nothing

#### Scenario: Wrong-kind package rejected

- **WHEN** `rasen pipeline import <path>` is given a workflow or profile package
- **THEN** import SHALL fail with a kind-mismatch error

### Requirement: Pipeline delete refcount guard

`rasen pipeline delete` SHALL, by default, refuse to delete a user pipeline that is still referenced — by any installed workflow's `requires.pipelines`, or by another pipeline's `decompose` `childPipeline` — and SHALL name the referrers. Package-layer (built-in) pipelines SHALL never be deletable regardless of any flag. A `--force` flag SHALL bypass only the referrer guard: the delete proceeds, a warning naming every dangling referrer SHALL be emitted, and the forced referrers SHALL be reported in `--json`. Confirmation SHALL still be required in non-interactive mode.

#### Scenario: Delete refused when referenced

- **WHEN** a user runs `rasen pipeline delete <name>` without `--force` and the pipeline is referenced by a workflow's `requires.pipelines` or another pipeline's `childPipeline`
- **THEN** the deletion SHALL be refused with an error naming the referrers

#### Scenario: Force override deletes and warns

- **WHEN** a user runs `rasen pipeline delete <name> --force` (with confirmation) and the pipeline is referenced
- **THEN** the pipeline SHALL be deleted and a warning naming every dangling referrer SHALL be emitted

#### Scenario: Built-in pipeline never deleted

- **WHEN** a user runs `rasen pipeline delete <built-in-name> --force`
- **THEN** the deletion SHALL be refused because package-layer pipelines cannot be deleted

### Requirement: Package version gating

A `.rasenpkg` package MAY declare an optional `minRasenVersion`. When decoding any package, the reader SHALL check the package's format version and `minRasenVersion` before strict schema validation, and SHALL reject — with a clear, actionable message naming the required version — any package whose format version exceeds the supported version or whose `minRasenVersion` is newer than the running CLI. The running CLI version SHALL be read from the package metadata (version-agnostic), not hard-coded. Packages within the supported range SHALL import normally.

#### Scenario: Package newer than the CLI is rejected clearly

- **WHEN** a package declares a `minRasenVersion` newer than the running CLI
- **THEN** decoding SHALL fail with a message stating the required version and that the CLI should be upgraded
- **AND** nothing SHALL be installed

#### Scenario: Supported package imports normally

- **WHEN** a package declares a `minRasenVersion` at or below the running CLI version (or omits it)
- **THEN** decoding SHALL proceed to normal validation and import

### Requirement: Runtime preflight probes agent-runtime availability

Before a pipeline is dispatched for execution, the execution preflight SHALL detect the LEAD host once, resolve every stage's effective target runtime with all configured runtime layers, and resolve the host × target dispatch mode and bridge across all stages, including stages of any decompose child pipeline. A known `unsupported` route SHALL fail before dispatch with an actionable error naming the host, target, affected stage or role, and a supported override. For every required `exec-bridge`, preflight SHALL probe that bridge's CLI availability at most once per bridge kind per invocation through injectable probers and SHALL fail before dispatch if the required bridge is unavailable. Native stages SHALL NOT require or probe an external CLI bridge. An unknown host SHALL retain the legacy fallback with an actionable diagnostic rather than being represented as a verified native route.

#### Scenario: Claude-to-Codex bridge unavailable fails before dispatch

- **WHEN** a Claude-hosted pipeline has a stage whose effective runtime resolves to Codex
- **AND** the Codex CLI is unavailable
- **THEN** execution preflight fails before dispatch
- **AND** the error names both remedies: use a supported runtime override or install the Codex CLI

#### Scenario: Codex-to-Claude bridge unavailable fails before dispatch

- **WHEN** a Codex-hosted pipeline has a stage whose effective runtime resolves to Claude
- **AND** the Claude CLI is unavailable
- **THEN** execution preflight fails before dispatch
- **AND** the error names both remedies: use a supported runtime override or install Claude Code

#### Scenario: Native pipeline does not probe an external bridge

- **WHEN** every stage resolves to the recognized host runtime
- **THEN** each stage resolves dispatch mode `native`
- **AND** neither the Codex nor Claude bridge availability prober is called

#### Scenario: Configured runtime instances participate in preflight

- **WHEN** project, store, global, or invocation runtime configuration changes a role's effective target
- **THEN** preflight validates the route and required bridge for that configured target
- **AND** it does not validate a different target obtained by ignoring configuration

#### Scenario: Decompose child routes are covered

- **WHEN** a decompose child pipeline contains an exec-bridge or unsupported route after effective runtime resolution
- **THEN** the parent execution preflight applies the same bridge availability or rejection rule before fan-out

#### Scenario: Each required bridge probe is injectable and runs at most once

- **WHEN** preflight runs with injected availability probers over a pipeline containing several stages that use the same exec bridge
- **THEN** the required bridge's prober is consulted at most once for that invocation
- **AND** a prober for an unused bridge is not called

#### Scenario: Unknown host keeps compatibility with a diagnostic

- **WHEN** host detection returns unknown
- **THEN** execution retains the legacy runtime/bridge behavior
- **AND** reports how to select a deterministic host with `RASEN_AGENT_RUNTIME`

### Requirement: Pipeline human presentation is localized

Rasen SHALL render its own `rasen pipeline` command help, headings, labels, summaries, empty states, prompts, confirmations, warnings, validation summaries, and error framing in the resolved English, Japanese, or Simplified Chinese CLI locale. This requirement SHALL apply to `list`, `show`, `agents`, `classify`, `resume`, `init`, `validate`, `import`, `export`, and `delete`.

#### Scenario: Every pipeline subcommand uses the resolved locale

- **WHEN** a user runs any pipeline subcommand without `--json` under a supported CLI locale
- **THEN** all Rasen-owned human-facing text for that command SHALL use the resolved locale
- **AND** command names, flag names, pipeline and stage IDs, role/runtime/source enum values, paths, filenames, and user-authored values SHALL remain unchanged

#### Scenario: Japanese runtime output is localized as well as help

- **WHEN** the resolved CLI locale is Japanese and a pipeline command emits human output, a prompt, a warning, or an error summary
- **THEN** the runtime presentation SHALL be Japanese rather than limiting localization to command help

#### Scenario: Simplified Chinese pipeline help is complete

- **WHEN** the resolved CLI locale is `zh-cn` and the user requests help for `rasen pipeline` or any of its ten subcommands
- **THEN** help titles, command descriptions, and flag descriptions SHALL be displayed in Simplified Chinese
- **AND** the command and flag structure and ordering SHALL remain identical to English

#### Scenario: Pipeline failure detail remains diagnosable

- **WHEN** a pipeline operation fails with a core validation or parser diagnostic that has no translated detail
- **THEN** Rasen-owned error framing SHALL use the resolved locale
- **AND** the original diagnostic code and raw detail SHALL remain available without translation or omission

### Requirement: Pipeline presentation preserves content ownership

Package-owned built-in pipeline descriptions SHALL be localized in human views by stable built-in identity and package provenance. Project and user pipeline names and descriptions SHALL be presented verbatim, including when a project or user pipeline overrides the ID of a built-in pipeline.

#### Scenario: Built-in description is localized for humans

- **WHEN** `pipeline list` or `pipeline show` renders a package-layer built-in pipeline under Japanese or Simplified Chinese
- **THEN** the human-readable description SHALL use the resolved locale's catalog entry for that built-in ID

#### Scenario: Same-name override remains user-authored

- **WHEN** a project or user pipeline has the same ID as a package built-in and wins registry resolution
- **THEN** its name and description SHALL be displayed verbatim rather than replaced by the built-in translation
- **AND** no presentation-only provenance metadata SHALL become an enumerable JSON field

### Requirement: Pipeline machine contracts are locale-neutral

Pipeline JSON payloads, registry values, raw descriptions, raw diagnostics, and classifier semantics SHALL remain identical across English, Japanese, and Simplified Chinese. Human localization SHALL NOT change machine-readable behavior.

#### Scenario: Pipeline JSON is stable across locales

- **WHEN** equivalent `list`, `show`, `agents`, `classify`, `resume`, `init`, `validate`, `import`, `export`, or `delete` operations emit JSON under different supported locales
- **THEN** field names, IDs, enum values, codes, paths, digests, raw package descriptions, raw diagnostic detail, and user-authored content SHALL be identical across locales

#### Scenario: Classification semantics are stable across locales

- **WHEN** the same task text is passed to `pipeline classify` under English, Japanese, and Simplified Chinese
- **THEN** keyword matching, `suggested`, `matched`, and `basis` values SHALL be identical
- **AND** only human-facing labels and explanatory Rasen-owned text MAY differ by locale

#### Scenario: Built-in JSON description remains raw

- **WHEN** a package-layer built-in pipeline is shown with `--json` under Japanese or Simplified Chinese
- **THEN** its description SHALL remain the raw package-authored value used by the existing JSON contract
- **AND** localized human presentation metadata SHALL NOT alter the serialized shape

### Requirement: A decomposed parent's remaining work is answered from its portfolio record

When a change was split into child changes, `rasen pipeline resume` SHALL answer
from that change's portfolio record and report the children that can be worked on
next, rather than from the parent's own stage list. A parent that still has any
child which has not reached a finished state SHALL NOT be reported as ready to
deliver, and SHALL NOT present delivery as its next step or as available work,
regardless of what its own stage list says. Delivery SHALL become available only
once every child has reached a finished state, and a change recorded as split
while listing no children at all SHALL NOT be reported as complete — a record
naming nothing that finished is not evidence that anything did.

#### Scenario: A split change listing no children is not complete

- **WHEN** a change is recorded as split into children but its portfolio lists none
- **THEN** it SHALL NOT be reported as complete
- **AND** delivery SHALL NOT be offered

#### Scenario: A parent with children remaining never offers delivery

- **WHEN** a user resumes a parent change whose portfolio still lists children that have not finished
- **THEN** the next step SHALL be the child work that remains
- **AND** delivery SHALL NOT appear as the next step or as available work

#### Scenario: A parent whose children have all finished can deliver

- **WHEN** a user resumes a parent change and every child in its portfolio has reached a finished state
- **THEN** the portfolio SHALL be reported as complete
- **AND** delivery SHALL be available

#### Scenario: A parent's own stage list cannot overrule its children

- **WHEN** a parent change's own stage list shows nothing outstanding but its portfolio still lists unfinished children
- **THEN** the children SHALL decide the answer
- **AND** delivery SHALL NOT be offered

### Requirement: An unreadable portfolio record is reported, never read as absent

`rasen pipeline resume` SHALL report a portfolio record it located but cannot
read — malformed, or failing validation after normalization — distinctly from the
case where a change has no portfolio record at all, so the failure is diagnosable
instead of masquerading as "this change was never split". A change whose
portfolio record cannot be read SHALL NOT be answered as though it were an
ordinary undivided change, because that substitution can present delivery as the
next step for work that is not finished. The report SHALL name the record's
location and the reason it could not be read, and SHALL offer no next step until
the record is repaired.

#### Scenario: An unreadable portfolio record is reported with its reason

- **WHEN** a user resumes a change whose portfolio record is present but cannot be read
- **THEN** the result SHALL state that the portfolio record is unreadable
- **AND** SHALL name the record's location and the reason it could not be read

#### Scenario: An unreadable portfolio record never offers a next step

- **WHEN** a user resumes a change whose portfolio record is present but cannot be read
- **THEN** no next step SHALL be offered, and delivery in particular SHALL NOT be offered
- **AND** the change SHALL NOT be answered as though it had never been split

#### Scenario: A change that was never split is unaffected

- **WHEN** a user resumes a change that has no portfolio record at all
- **THEN** the answer SHALL come from that change's own stages exactly as before
- **AND** nothing SHALL be reported as unreadable

### Requirement: Work handed to children is recorded as delegated, not skipped

A parent SHALL be able to record that a stage was handed to its children, as a
state distinct from a stage that was deliberately not needed. Delegated work
SHALL count as outstanding, so a parent that delegated its work is never mistaken
for one that finished it. A stage recorded as deliberately not needed SHALL keep
counting as settled, and records written before this distinction existed SHALL
keep being readable and keep their current meaning.

#### Scenario: Delegated work keeps a parent unfinished

- **WHEN** a parent records stages as delegated to its children
- **THEN** those stages SHALL count as outstanding work
- **AND** the parent SHALL NOT be reported as having finished them

#### Scenario: Deliberately skipped work still counts as settled

- **WHEN** a stage is recorded as deliberately not needed
- **THEN** it SHALL count as settled, exactly as before

#### Scenario: Existing records keep their meaning

- **WHEN** a record written before delegation could be expressed is read
- **THEN** it SHALL be readable
- **AND** its stages SHALL keep the meaning they had when written

### Requirement: Child progress covers proposed work, and an unrecognized state counts as unfinished

A child's recorded progress SHALL be able to say that its proposal is complete
while its implementation has not started, and that state SHALL count as
unfinished. A child progress state the system does not recognize SHALL be
preserved as recorded and treated as unfinished, and SHALL NOT cause the
portfolio it belongs to to become unreadable or to be treated as absent. An
unrecognized state SHALL never be able to make a portfolio appear complete.

#### Scenario: A proposed child keeps the portfolio unfinished

- **WHEN** a child's progress records that its proposal is complete but its implementation has not started
- **THEN** that child SHALL count as unfinished
- **AND** the portfolio SHALL NOT be reported as complete

#### Scenario: An unrecognized child state is kept and counted as unfinished

- **WHEN** a portfolio record describes a child's progress in a way the system does not recognize
- **THEN** the recorded value SHALL be preserved as written
- **AND** that child SHALL count as unfinished

#### Scenario: An unrecognized child state does not hide the portfolio

- **WHEN** a portfolio record describes a child's progress in a way the system does not recognize
- **THEN** the portfolio SHALL still be recognized as a portfolio
- **AND** the change SHALL NOT be answered as though it had never been split

#### Scenario: An unrecognized child state cannot complete a portfolio

- **WHEN** every other child has finished and one child carries an unrecognized progress state
- **THEN** the portfolio SHALL NOT be reported as complete
- **AND** delivery SHALL NOT be offered

### Requirement: Registry resolution supports Definition v1 and v2 through preparation

The Pipeline registry SHALL accept unversioned, version 1, and version 2
definitions from project, user, and package layers through the same Definition
Module preparation seam. It SHALL preserve the winning source's authored
content while exposing normalized semantic definition, diagnostics, digests,
and capability status to consumers.

#### Scenario: v1 and v2 resolve from every registry layer

- **WHEN** a valid v1 or v2 definition wins normal project, user, or package precedence
- **THEN** registry load returns its authored version and one prepared semantic result
- **AND** preparation behavior does not vary by the filesystem layer or by Windows, macOS, or Linux path separators

#### Scenario: Registry rejects an unsupported version

- **WHEN** the winning source declares an unsupported explicit version
- **THEN** the registry fails closed with the preparation diagnostic and does not fall through to a lower-precedence definition of the same name

### Requirement: Registry capability status separates validity from execution

Registry list and detail results SHALL report the authored definition version,
whether preparation produced a valid plan, and whether an installed runtime can
execute that plan. A valid v2 plan SHALL remain non-executable in this slice
with an actionable stable reason code.

#### Scenario: Valid v2 definition is visible but non-executable

- **WHEN** a registry consumer lists or shows a valid version 2 Pipeline
- **THEN** it sees that the definition is valid and plan-capable
- **AND** it sees that execution is unavailable until the reconciler runtime lands

#### Scenario: Legacy capability remains explicit

- **WHEN** a version 1 Pipeline retains legacy execution support
- **THEN** registry capability reporting identifies legacy execution separately from v2 plan preparation
- **AND** it does not imply that the prepared plan has a reconciler owner

### Requirement: Built-in and Custom definitions use one registry path

Built-in and Custom Composite declarations SHALL be loaded, normalized,
validated, and compiled by the same registry-to-preparation integration.
Registry source provenance MAY differ, but declaration kind SHALL NOT select a
parallel parser or compiler.

#### Scenario: Equivalent declarations have parity

- **WHEN** equivalent built-in and Custom Composite definitions resolve from different registry layers
- **THEN** they produce the same semantic validation result and compiled plan digest
- **AND** only their registry provenance differs

### Requirement: Concurrent pipeline imports survive transient Windows registry-lock sharing errors

When pipeline imports contend for a shared legacy registry lock on Windows, Rasen SHALL treat `EPERM`, `EACCES`, and `EBUSY` results from opening that lock as transient contention within the existing bounded lock deadline. If the transient condition clears, the import SHALL continue through the existing transaction and report its semantic result. If it persists to the deadline, the import SHALL return the registry's existing busy/timeout diagnostic. Other errors, and the existing behavior on non-Windows platforms, SHALL continue to return the registry's create-failed diagnostic.

#### Scenario: Concurrent same-name imports reach the semantic winner and loser results

- **WHEN** two Windows callers concurrently import different packages that install the same pipeline name
- **AND** opening the shared workflow or pipeline registry lock temporarily reports `EPERM`, `EACCES`, or `EBUSY`
- **THEN** Rasen SHALL retry within the existing lock deadline
- **AND** exactly one import SHALL install the complete pipeline while the other reports `pipeline_already_exists`
- **AND** no partial or mixed pipeline content SHALL be installed

#### Scenario: Persistent Windows sharing contention remains bounded

- **WHEN** opening a legacy registry lock on Windows continues to report `EPERM`, `EACCES`, or `EBUSY` until the existing lock deadline
- **THEN** Rasen SHALL stop retrying at that deadline
- **AND** it SHALL return the registry's existing busy/timeout diagnostic

#### Scenario: Genuine lock creation failures retain their existing diagnosis

- **WHEN** opening a legacy registry lock fails with another error, or fails on a non-Windows platform
- **THEN** Rasen SHALL return the registry's existing create-failed diagnostic without reclassifying it as transient Windows contention

### Requirement: Pipeline stages declare credential-free inference intent
The version 1 Pipeline stage schema SHALL accept an optional `inference` object with broker `omnicross` and an upstream discriminated union of `provider`, `account`, `account-group`, or `account-pool`. The declaration SHALL contain stable resource identifiers only and SHALL use the stage's existing effective model resolution; it SHALL reject route tokens, Provider credentials, control credentials, arbitrary ingress formats, and transformer settings. Omitting `inference` SHALL preserve existing Pipeline parsing and execution behavior.

#### Scenario: Stage selects a Provider upstream
- **WHEN** a stage declares `inference.broker: omnicross` and upstream `{ kind: provider, providerId: deepseek-api }`
- **THEN** the registry SHALL preserve that typed inference declaration with the stage
- **AND** the stage's effective model SHALL continue to resolve through the existing model precedence chain

#### Scenario: Stage selects a subscription account group
- **WHEN** a stage declares an `account-group` upstream with a Provider id and group name
- **THEN** the registry SHALL preserve both identifiers without reducing the target to a Provider-only value

#### Scenario: Stage declares routing secrets
- **WHEN** a Pipeline inference declaration includes a token, API key, credential, custom base URL, arbitrary ingress, or transformer field
- **THEN** validation SHALL reject the Pipeline with an actionable closed-schema diagnostic

#### Scenario: Legacy stage omits inference
- **WHEN** a valid Pipeline written before this capability is parsed
- **THEN** its normalized stage and execution behavior SHALL remain unchanged

### Requirement: Execution inspection exposes effective inference without secrets
The execution view returned by `rasen pipeline show --for-execution --json` SHALL report each stage's resolved inference intent together with the effective runtime and model that will be frozen. It SHALL report absence explicitly for unconfigured stages and SHALL fail execution preflight when an OmniCross-routed stage has no non-empty effective model. Human and management projections SHALL expose only the broker and credential-free upstream identifiers.

#### Scenario: Routed stage is inspected
- **WHEN** execution inspection resolves a Codex stage with an OmniCross Provider target and an effective model
- **THEN** the stage output SHALL identify broker `omnicross`, the safe upstream target, runtime `codex`, and the effective model with its existing source
- **AND** SHALL contain no daemon control credential or route token

#### Scenario: Routed stage has no effective model
- **WHEN** an OmniCross-routed stage reaches execution preflight without a non-empty effective model
- **THEN** preflight SHALL fail before dispatch with a diagnostic naming the stage and missing model
