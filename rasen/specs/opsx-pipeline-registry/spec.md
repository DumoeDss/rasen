# opsx-pipeline-registry Specification

## Purpose
Define the data-driven pipeline registry — pipeline definitions, dual-root extensible resolution (project / user / package), the `rasen pipeline` CLI surface, pipeline validation, and the built-in pipelines.
## Requirements
### Requirement: Data-Driven Pipeline Definitions

The system SHALL define pipelines as data files at `pipelines/<name>/pipeline.yaml`, each an ordered DAG of stages, parsed and validated into typed objects through a loader that mirrors the artifact-graph schema loader.

#### Scenario: Pipeline file shape

- **WHEN** a `pipeline.yaml` is loaded
- **THEN** it SHALL declare a `name`, optional `description`, and a non-empty `stages` array
- **AND** it MAY declare an `origin` field whose only value is `composed`, marking a pipeline assembled by the autopilot LEAD (absent means human-authored); `rasen pipeline show` SHALL surface the field when present
- **AND** each stage SHALL declare an `id` and a `skill`, and MAY declare `role`, `requires`, `gate`, `loop`, `parallelGroup`, `condition`, `leadReview`, and `verifyPolicy`
- **AND** parse or validation failures SHALL raise a typed error identifying the offending file and field

#### Scenario: Stages form a dependency DAG

- **WHEN** a pipeline declares stages with `requires` edges
- **THEN** the registry SHALL expose a stage build order via topological sort
- **AND** SHALL expose, for a set of completed stages, which stages are ready and which are blocked

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

The system SHALL provide a `rasen pipeline` command group with `list`, `show <name>`, `agents <name>`, `classify "<task>"`, `resume <change>`, `init <name>`, `validate <name-or-path>`, `import <path>`, `export <name> <path>`, and `delete <name>` subcommands, each supporting `--json`. Every subcommand SHALL resolve its Rasen root through the shared root-selection layer used by `rasen validate` — the same nearest-root walk, implicit-root fallback, and `--store <id>` selector — so a given directory or store resolves to the identical root across `pipeline` and `validate`. No pipeline subcommand SHALL resolve its root from the current working directory alone. `resume` SHALL locate run-state per the `change-work-dir` capability: the change's external work directory is checked first, falling back to the change directory, and the JSON output SHALL report the directory the run-state (or portfolio state) was actually read from (`runStateDir`) so a resuming orchestrator writes updates where it read them. Locating run-state SHALL NOT write to the repository or the registry.

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
- **AND** the run-state SHALL be read from the change's work directory when present there, falling back to the change directory in the resolved root — never from the current working directory
- **AND** when run-state is found, the JSON SHALL include `runStateDir` naming the directory it was read from

#### Scenario: Resume reads legacy run-state

- **WHEN** `rasen pipeline resume <change> --json` runs for a change whose `auto-run.json` predates the work directory and lives in the change directory
- **THEN** it SHALL read that run-state (`hasRunState: true`) and report the change directory as `runStateDir`

#### Scenario: Root resolution matches validate

- **WHEN** `rasen pipeline list --json` and `rasen validate --pipelines --json` are run from the same subdirectory of a project, or with the same `--store <id>`
- **THEN** both SHALL resolve to the same Rasen root and report the same set of pipelines

#### Scenario: Store selection

- **WHEN** any `pipeline` subcommand is run with `--store <id>` naming a registered store
- **THEN** it SHALL operate on that store's root
- **AND** `pipeline resume <change> --store <id>` SHALL read run-state from that change's work directory (falling back to the store's change directory) and report `hasRunState: true` when that change has recorded run-state

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

#### Scenario: Composed-pipeline quality floor enforced

- **WHEN** a pipeline declaring `origin: composed` is parsed or validated
- **THEN** it SHALL fail unless it contains at least one stage with role `reviewer` and at least one stage with `loop.kind: review-cycle`
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
- **WHEN** `rasen pipeline resume <change> --json` locates an `auto-run.json` (workDir-first, change-dir fallback) that fails to parse even after host-tolerance normalization
- **THEN** the output SHALL report `hasRunState: false` and `invalidRunState: true`
- **AND** SHALL name the file path and the parse/validation reason in the note

#### Scenario: Absent run-state is unchanged
- **WHEN** `rasen pipeline resume <change> --json` finds no `auto-run.json` in either location
- **THEN** the output SHALL report `hasRunState: false` without `invalidRunState`, with the existing "no run-state" note

### Requirement: Machine config supplies per-role agent model layers across project, store, and global scopes

The effective model for a stage SHALL incorporate machine configuration layers below the pipeline's per-role runtime override and above the runtime's own default. A project, an inheriting store (see `store-config-inheritance`), or the machine (global) config MAY declare a base model under `models.default` and per-role model overrides under `models.roles.<role>` for the closed role set (`planner`, `implementer`, `reviewer`, `fixer`, `shipper`). The effective stage model SHALL resolve with precedence: the stage-level `model` first, then the pipeline `agents.<role>.model` role default, then the project config `models.roles.<role>`, then the project config `models.default`, then the inherited store config `models.roles.<role>`, then the inherited store config `models.default`, then the global config `models.roles.<role>`, then the global config `models.default`, then the runtime's built-in default (no configured model). Within each machine config scope a per-role model SHALL win over that scope's `models.default`, and the scopes SHALL rank project > store > global entirely. A model id at any layer SHALL be an opaque string accepted as-is (no allow-list rejection). `rasen pipeline show <name> --json` SHALL report each stage's resolved model with a source distinguishing the store layers (`store-role`, `store-default`) from the project and global layers, and the resolved model SHALL be the one the model-preset (handoff/reuse threshold) layer keys off.

#### Scenario: Store model applies below the project layer

- **WHEN** the inherited store's config sets `models.default: opus`, no project model config or pipeline `agents.<role>.model` applies to a stage, and the stage sets no `model`
- **THEN** the stage's resolved model SHALL be `opus` with a source identifying the store default layer

#### Scenario: Store per-role model beats the store base and the global layer

- **WHEN** the inherited store's config sets `models.default: sonnet` and `models.roles.reviewer: fable`, the global config sets `models.roles.reviewer: opus`, and neither the pipeline nor the stage sets a model for a `reviewer`-role stage
- **THEN** that stage's resolved model SHALL be `fable` (source: store role layer), while a non-reviewer stage resolves to `sonnet`

#### Scenario: Project model config beats the store layer

- **WHEN** the inherited store's config sets `models.roles.reviewer: sonnet` and the project config sets `models.roles.reviewer: fable`
- **THEN** a `reviewer`-role stage resolves to `fable` (the project value wins over the store value)

#### Scenario: Global layer is the store fallback

- **WHEN** neither the project nor the inherited store sets any `models.*` value and the global config sets `models.default: sonnet`
- **THEN** the stage's resolved model SHALL be `sonnet` exactly as before this capability existed

#### Scenario: Pipeline role default beats every machine config layer

- **WHEN** the pipeline declares `agents.reviewer.model: opus` and the project, store, and global configs set other reviewer models
- **THEN** the `reviewer`-role stage resolves to `opus`

#### Scenario: No store layer without inheritance

- **WHEN** the project inherits from no store
- **THEN** model resolution ranks exactly stage > agent > project > global > runtime default as before, and no store source is ever reported

#### Scenario: pipeline show reflects the store-config model

- **WHEN** an inherited store's `models.*` value determines a stage's effective model and the user runs `rasen pipeline show <name> --json`
- **THEN** that stage's reported `model` SHALL be the store-resolved value, with its source identifying the store layer that supplied it

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

Before a pipeline is dispatched for execution, the execution preflight SHALL resolve each stage's effective agent runtime — using the precedence stage runtime, then the pipeline's per-role runtime, then the default — across all stages, including the stages of any decompose child pipeline. When any resolved effective runtime is `codex`, the preflight SHALL probe the codex CLI's availability at most once per invocation through an injectable prober, and SHALL fail before dispatch if codex is required but unavailable. The failure message SHALL name both remedies: overriding the affected role to the default runtime, or installing the codex CLI. When no stage resolves to `codex`, the preflight SHALL NOT probe and SHALL NOT fail on runtime-availability grounds.

#### Scenario: Codex required but unavailable fails before dispatch

- **WHEN** a pipeline has a stage whose effective runtime resolves to `codex`
- **AND** the codex CLI is unavailable
- **THEN** the execution preflight SHALL fail before dispatch
- **AND** the error SHALL name both remedies (override the role to the default runtime, or install codex)

#### Scenario: Decompose child runtime is covered

- **WHEN** a decompose stage's child pipeline has a stage whose effective runtime resolves to `codex`
- **AND** the codex CLI is unavailable
- **THEN** the execution preflight SHALL fail before dispatch

#### Scenario: Pure-default pipeline does not probe

- **WHEN** no stage in the pipeline or its decompose children resolves to `codex`
- **THEN** the preflight SHALL NOT probe codex availability
- **AND** it SHALL NOT fail on runtime-availability grounds

#### Scenario: Probe is injectable and runs at most once

- **WHEN** the preflight runs with an injected availability prober over a pipeline containing several `codex` stages
- **THEN** the prober SHALL be consulted at most once for that invocation

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

