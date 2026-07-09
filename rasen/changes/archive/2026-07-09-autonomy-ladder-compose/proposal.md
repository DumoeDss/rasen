## Why

Rung 1 (autonomy-ladder-classify, shipped 9d73c83) lets the LEAD adopt a classify suggestion — but the suggestion space is limited to registered pipelines. When a task fits none of them (classify reports a `default` basis and the task's shape genuinely doesn't match `small-feature`), the LEAD's only options are a poor fit or a manual escalation. Rung 2 (composed pipelines) closes that gap safely: the LEAD assembles a pipeline YAML from the known stage library, validated and registered like any project pipeline — the safe version of "dynamic DAG", behind the same opt-in discipline as rung 1.

**Archive-ordering dependency (flag for the LEAD):** this change's delta spec MODIFIES the `autopilot-selection-policy` capability that child 1 ADDED. Child 1's specs are not yet archived; the MODIFIED headers here match child 1's **post-archive** main-spec text. Child 1 MUST be archived (deltas synced into `rasen/specs/`) before this change is archived — the portfolio's serial order already guarantees this, but do not reorder.

## What Changes

- **Third selection-policy value `compose`**: `autopilot.selection: classify | manual | compose` in `rasen/config.yaml`, plus a new `--auto-compose` run flag. Precedence extends rung 1's axis: explicit pipeline selector above everything, then `--auto-compose` > `--auto-select` > config > built-in default `manual`. Default remains OFF — absent flags and config key, behavior is exactly 0.1.x.
- **Compose policy semantics (classify-first)**: under `compose`, the LEAD first runs classify exactly as under the `classify` policy. A keyword-basis suggestion is adopted as-is — composition never overrides an affirmative classify match. Only when classify reports a `default` basis AND no registered pipeline fits the task's shape MAY the LEAD compose; otherwise it falls back to `small-feature` as usual. Composition is permission, not obligation.
- **Composed pipelines are ordinary registered project pipelines**: the LEAD assembles stages drawn from the registered pipelines' stage library into a `pipeline.yaml` named with a `composed-` prefix (collision-checked against `rasen pipeline list`), stamped `origin: composed`, and written to the project pipelines directory. From there `rasen pipeline list/show/resume` and run-state inherit for free — no run-state schema change (the persisted pipeline name suffices, per child 1's finding).
- **Validation gate, no new CLI**: before executing a composed pipeline, the LEAD MUST pass `rasen validate <composed-name> --type pipeline --json` — the existing command already runs the full guard stack (PipelineYamlSchema, structural validators, known-skill check, decompose recursion guard). Validation failure after a bounded fix attempt falls back to `small-feature`.
- **Quality floor, machine-enforced**: a pipeline stamped `origin: composed` MUST contain a verification stage (role `reviewer`) and a review-loop stage (`loop.kind: review-cycle`) — the LEAD never composes itself an inspection-free pipeline. Enforced at parse time so a floor-violating composed pipeline cannot even load. Human-authored pipelines (no `origin` field) are completely unaffected — the built-in `bug-fix` (which has no review-loop) stays valid.
- **`origin` field in the pipeline schema**: new optional field (only value `composed`); surfaced in `rasen pipeline show` output for provenance/audit.
- **Auto template update**: section 0.6 gains the third policy value and flag; section 1's policy sub-list gains a `compose` bullet (no restructure — the flat sub-list was left extension-ready by child 1); Guardrails gain the composition invariants. Build → update flow, parity hash re-pasted.
- **Non-Goal, recorded explicitly (rung 3 rejected)**: runtime free-form DAGs are NOT built — the LEAD only ever executes registered, validated pipelines, never an in-memory unregistered DAG. Rejected because it breaks resume and the audit trail; runtime dynamism is already covered by decompose (runtime fan-out) and goal-loop (runtime iteration).
- **NOT in scope**: no version bump (flipping any default is the user's 0.2.0 decision); no composed-pipeline garbage collection (they persist as ordinary, deletable project pipelines); no changes to the classify heuristic.

## Capabilities

### New Capabilities
- `autopilot-composed-pipelines`: the compose rung — `compose` policy semantics, composition rules (stage library, naming, `origin` stamp, project-dir landing), the validation gate, the machine-enforced quality floor, display/override behavior, and the registered-pipelines-only execution boundary.

### Modified Capabilities
- `autopilot-selection-policy`: the "Opt-in automatic pipeline selection with defined precedence" requirement widens the value space to `classify | manual | compose` and adds `--auto-compose` to the precedence chain. **Depends on child 1's post-archive spec text** (see Why).
- `opsx-pipeline-registry`: "Data-Driven Pipeline Definitions" gains the optional `origin` field in the file shape; "Pipeline Validation" gains the composed-pipeline quality-floor rule. (Both requirements are untouched by child 1 — no same-requirement collision; child 1 only modified "Pipeline CLI Surface".)

## Impact

- `src/core/pipeline-registry/types.ts` — optional `origin` field on `PipelineYamlSchema`.
- `src/core/pipeline-registry/pipeline.ts` — `validateComposedPolicyFloor` alongside the existing structural validators inside `parsePipeline`.
- `src/commands/pipeline.ts` — `show` surfaces `origin`.
- `src/core/project-config.ts` — `selection` enum widens to include `compose`; `resolveAutopilotSelectionPolicy` accepts the `--auto-compose` flag ahead of `--auto-select`.
- `src/core/templates/workflows/auto.ts` — sections 0.6 and 1, Guardrails; regenerated templates; parity hash.
- Tests: `test/core/pipeline-registry/*` (schema + floor), `test/commands/pipeline.test.ts` (show origin), `test/core/project-config.test.ts` (enum + resolver), `test/commands/auto.test.ts` (template content), parity test.
- No dependency changes; existing pipeline YAML (built-in, user, project) parses unchanged.
