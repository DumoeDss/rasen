## Why

Definition v2 is the executable Change-level language, but every public blank authoring path and all six Change-level built-ins still author v1. Users therefore receive compatibility normalization and a legacy warning even when the reconciler owns execution, while v2 registry and CLI views omit the stage-level execution meaning that v1 views already expose.

## What Changes

- Make Definition v2 the canonical authored output of `rasen pipeline init`, fresh public blank definitions, and the Canvas empty-draft seed; retain v1 only as accepted compatibility input.
- Define one canonical serializer for authored v2 definitions so init, save, detail, export, package digests, semantic source digests, and plan digests preserve the same meaning across Windows, Linux, and macOS.
- Add a closed v2 AtomicStage execution contract for capability identity plus role, verification, runtime-policy, and workspace facts, with Gate nodes as the sole authored gate authority required to lower and inspect a runnable Change pipeline without consulting v1 `legacy` payloads or synthetic placeholder policy.
- Project authored v2 definitions through registry, CLI, and Management API as a truthful execution graph with build order, effective stages, capabilities, bounded-loop policy, and engine support, rather than raw definition JSON or empty stage lists.
- Reauthor `bug-fix`, `small-feature`, `full-feature`, `goal-loop-measure`, `goal-loop-evaluate`, and `goal-loop-research` as explicit v2 definitions using the shared bounded-loop lifecycle, frozen capability contracts, and the already-supported ReviewCycle, GoalLoop, Choice, FanOut/Join, Gate, and Finish lowering paths.
- Preserve the six pipelines' product behavior, role separation, gates, conditions, adaptive/standard verification, parallel membership, goal variants, report tail, retention/archive tail, and effective configuration overrides while removing the misleading v1-normalization warning from their normal views.
- Keep `auto-decompose` byte-for-byte authored as Definition v1 and label it explicitly as a 0.3.0 Issue/Dispatch compatibility fixture; this Change does not migrate decompose or portfolio execution.

## Capabilities

### New Capabilities

- `rasen-review-fix`: internal write-capable ReviewCycle fix Action capability; it returns `review-cycle/fix-result/1` and cannot certify its own fix.
- `rasen-goal-judge`: internal read-only GoalLoop judge Action capability; it is the sole emitter of the measure/evaluate/research judge-result contracts and is actor-separated from work.

### Modified Capabilities

- `ecp-definition-preparation`: Definition v2 gains the closed execution metadata and canonical serialization/digest contract required for authored defaults and built-ins.
- `opsx-pipeline-registry`: public scaffolding, built-in inventory, validation, show/list, and execution inspection use v2 as the canonical authored Change-level form while preserving explicit v1 compatibility.
- `pipeline-http-api`: detail, inventory, validation, save, and blank-definition consumers receive one round-trippable v2 definition and truthful execution projection.
- `pipelines-ui`: a fresh Canvas draft starts from the canonical blank v2 envelope; v2 primitive and loop editing parity remains a later Change.
- `executable-review-cycle`: the ReviewCycle-bearing Change-level built-ins author explicit v2 bodies, lifecycle policies, capabilities, and tails through the existing reconciler contract.
- `executable-goal-loop`: all three GoalLoop built-ins author explicit v2 goal bodies, lifecycle policies, variants, and truthful terminal tails.
- `executable-parallel-pipelines`: `full-feature` authors its condition/FanOut/Join graph directly in v2 without changing established parallel execution semantics.

## Impact

- **Authoring and serialization:** `src/core/pipeline-library.ts`, Definition codecs/canonicalization, package save/export, CLI init, Canvas empty-draft construction, and their wire mirrors.
- **Execution preparation and views:** pipeline registry resolution, transitive installation/enablement of capability owners reached through required pipelines, host-aware route/bridge preflight, profile binding/policy resolution, v2 lowering inputs, CLI list/show/start projections, Management API inventory/detail, and engine-support reporting.
- **Built-in data:** six `pipelines/*/pipeline.yaml` manifests plus lifecycle/capability revision fixtures; `pipelines/auto-decompose/pipeline.yaml` remains v1.
- **Tests:** scaffold/save/export/digest round trips, registry/CLI/API parity, capability and policy fail-closed cases, six built-in plan-shape matrices, default-engine warning behavior, v1 compatibility, and explicit `auto-decompose` exclusion.
- **Excluded:** Canvas primitive/loop authoring parity, final vertical dogfood, Session executor/worker lifecycle, Issue/Dispatch/portfolio semantics, and release audit.
