# Direction Projection Context

- Workstream: `executable-composite-pipelines`
- Active Slice: `v2-authoring-loop-contract-closure` (ECP-6)
- Direction source: `rasen/work/issue-centered-automation-platform/executable-composite-pipelines/slices/v2-authoring-loop-contract-closure/`
- Parent portfolio: `ecp-v2-authoring-loop-contract-closure`
- DAG node: `ecp6-002`; depends on `ecp-shared-bounded-loop-lifecycle` being review-clean.

Make Definition v2 the canonical authored truth for `pipeline init`, public blank-definition paths,
registry/CLI execution projection, and the six Change-level built-ins. Preserve v1 normalization as
compatibility input. Keep `auto-decompose` as an explicitly labeled v1 compatibility fixture for the
0.3.0 Issue/Dispatch boundary. Do not perform a version-number-only migration: v2 execution views,
serializer/digest, capability contracts and built-in lowering must remain coherent.

Read the parent planning context and the prerequisite's final artifacts/durable findings first.
Append durable cross-child findings to the parent planning context after proposal.
