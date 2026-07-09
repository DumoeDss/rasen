## Why

When the LEAD drives a portfolio of dependent child changes, a serial child that consumes its predecessor's code benefits from reusing the predecessor's worker (which already holds the relevant context) instead of spawning a cold one. Today a pipeline can tune *handoff* (when a worker should hand off mid-task) but has no way to declare *reuse* policy — whether planners and implementers may be carried across changes, and how much context headroom a worker must have before it takes on a whole new child. This change adds the configuration surface and run-state plumbing that a reuse policy needs; the policy text that consumes it ships separately.

## What Changes

- Add an optional `reuse` configuration block to pipeline definitions, at pipeline level only (a sibling of `handoff`). It carries `planner` and `implementer` mode switches (`auto` | `never`), a `threshold` (context headroom in `(0, 1]`, default `0.25`), and `roles` (per-role `threshold` overrides for `planner` / `implementer`).
- Define built-in reuse defaults (`{ planner: auto, implementer: auto, threshold: 0.25 }`), a resolution order (per-role override > pipeline `threshold` > built-in default), and validation rules (mode enums; threshold in `(0, 1]`; unknown keys rejected).
- Surface the fully-resolved reuse config through `openspec pipeline show <name> --json`, following the same conventions the resolved `handoff` config established.
- Accept an optional `reusedFrom: <child-id>` marker on run-state worker records — a lineage pointer meaning "this worker's transcript already carries the named child's context" — and have `openspec pipeline resume` surface it unchanged so a resumer knows a worker is warm from a prior child.

This is CLI plumbing only. It introduces no playbook, template, or orchestration-policy text — that is a separate follow-up change that depends on this one.

## Capabilities

### New Capabilities
- `worker-reuse-config`: the pipeline-level `reuse` config block (shape, defaults, resolution order, validation), its resolved surfacing in `openspec pipeline show --json`, and the optional `reusedFrom` worker-record lineage field surfaced by `openspec pipeline resume`.

### Modified Capabilities
<!-- None. The reuse block is a new sibling of the handoff block, and `reusedFrom`
     is a new worker-record field — neither changes the existing handoff-config
     requirements (handoff threshold/relays, session/stage handoff records). -->

## Impact

- `src/core/pipeline-registry/types.ts` — new `reuse` schema + resolver (mirrors `HandoffConfigSchema` / `resolveStageHandoffConfig`).
- `src/core/pipeline-registry/run-state.ts` — optional `reusedFrom` on `RunStateWorkerSchema`.
- `src/core/pipeline-registry/index.ts` — barrel exports for the new symbols.
- `src/commands/pipeline.ts` — resolved `reuse` in `pipeline show --json`; `reusedFrom` passthrough in `pipeline resume`.
- Tests under `test/core/pipeline-registry/` and `test/commands/pipeline.test.ts` (CLI e2e run `dist`, so a build precedes them).
- No breaking changes: every new field is optional; existing pipelines and run-states parse unchanged.
