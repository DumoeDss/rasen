# ecp-definition-v2 — Planning Context

## Portfolio

- Parent: `executable-composite-pipelines`
- Dependency position: first child
- Pipeline: `small-feature`
- Delivery: local commit only; parent portfolio owns the final PR

Read these parent artifacts first:

- `rasen/changes/executable-composite-pipelines/planning-context.md`
- `rasen/changes/executable-composite-pipelines/decomposition-plan.md`
- `rasen/changes/executable-composite-pipelines/interface-decision.md`
- `rasen/work/issue-centered-automation-platform/deterministic-pipeline-kernel-research.md`

## This Change owns

- Pipeline Definition v2 envelope and closed node vocabulary
- stable definition/node/source identity and typed inputs/artifacts/outcomes
- non-recursive Composite/BoundedLoop declaration contracts and limits/exits
- v1/unversioned normalization into a v2 semantic model
- trusted versioned capability catalog snapshot
- `EcpDefinitionModule.prepare(source, catalog)`
- immutable opaque `ChangeRunPlan` contract, source/capability/plan digests
- complete static validation and path-addressed diagnostics
- management wire v1/v2 detail/save/export/validation parity
- Canvas v2 root graph editing/rendering for the vocabulary enabled in this slice
- explicit executable/capability reporting so v2 cannot enter an incomplete runtime

## This Change does not own

- canonical Run Record storage
- `ChangePipelineRuntime.start/resume/complete/inspect/control`
- Pipeline Reconciler or result commit reducers
- Operations run controls
- ReviewCycle/GoalLoop domain reducers
- real Custom Composite execution
- FanOut/Join runtime
- launcher convergence

Those belong to dependent child Changes.

## Locked design constraints

- Deep Definition Module; do not add a sibling parser beside `PipelineYamlSchema`.
- One `prepare` Interface serves registry load, Canvas validation, save preflight,
  export parity, and launch compilation.
- The control vocabulary is closed; extensibility is through typed capabilities
  and declarative Composite definitions.
- Built-in and Custom definitions use the same v2 semantic model.
- Unknown versions, ordinary cycles, recursive Composite calls, nested loops,
  missing exits, port mismatches, invalid limits, unknown/forbidden capabilities,
  and impossible budgets fail closed.
- Canvas owns a full Definition draft but never a separate executable graph.
- v1 remains readable and its source is not rewritten on read.
- `ChangeRunPlan` is serializable/digestible but opaque to ordinary callers.
- Until `ecp-run-spine` lands, capability reporting must prevent a v2 definition
  from being run through partial reconciler ownership.

## Acceptance evidence

- existing v1 tests remain green
- v1/unversioned -> normalized v2 -> compiled plan is deterministic
- explicit unknown version fails closed with upgrade guidance
- v2 save/detail/export round-trip is semantic-lossless
- server and Canvas diagnostics agree for invalid graphs
- built-in and Custom Composite declaration forms compile through one path
- recursive calls and nested loops are rejected
- plan/source/capability digests are stable under semantically identical input
- root Canvas can edit/render/save the enabled v2 vocabulary
- build, focused registry/API/Canvas tests and cross-plane parity tests pass
