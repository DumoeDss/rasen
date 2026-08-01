# Direction Projection Context

- Workstream: `executable-composite-pipelines`
- Active Slice: `v2-authoring-loop-contract-closure` (ECP-6)
- Direction source: `rasen/work/issue-centered-automation-platform/executable-composite-pipelines/slices/v2-authoring-loop-contract-closure/`
- Parent portfolio: `ecp-v2-authoring-loop-contract-closure`
- DAG node: `ecp6-003`; depends on `ecp-v2-default-authoring-and-builtins` being review-clean.

Make blank Canvas consume the canonical v2 factory and complete create/edit/save/reload parity for
CompositeRef, BoundedLoop, Choice, FanOut/Join, Gate, Finish, declaration/body, typed outcomes,
limits, exits, capability and the final shared loop lifecycle policy. Reuse existing declaration/body
CRUD, diagnostics, save/export and digest implementations; do not create a second model or serializer.

Read the parent planning context and all prerequisite artifacts/durable findings first. Append durable
cross-child findings to the parent planning context after proposal.
