## Why

rasen's loop pipelines (`goal-loop`, `task-loop`) borrowed the Gauntlet Loop's *review technique* (builder + fresh-context critic + one-gap feedback) but dropped its *loop structure*: per-wave piece-decomposition against a reference exemplar, open-ended creation, and human-judged convergence. Creative work — games, UI, code, writing — where "done" is judged against an exemplar rather than a checkable criterion checklist has no rasen pipeline today. This change adds one, deliberately designed to fit the engine **as built** (no core surgery): a phased, per-wave creation loop with reference blind-A/B judgment, serial build + parallel criticism, and a human-convergence delivery bridge.

## What Changes

- Add a built-in `gauntlet-loop` Pipeline, explicit-only (like `task-loop`): never returned by the classifier, never auto-substituted; selected via `rasen-auto gauntlet-loop <goal>` or `rasen-auto --pipeline gauntlet-loop <goal>`.
- **Phased model**: Phase 0 serial foundation loop over the whole artifact → lead-driven phase transition → Phase 1+ per-wave **one-level** decomposition (re-applied each wave, not infinite nesting) with **serial piece-builders + parallel piece-critics/meta-critic** → optional smoothing pass → user convergence.
- New **bounded-loop body kind** (`gauntlet-wave`) for the wave-orchestration layer; piece-loops reuse GoalCycle as **non-nested children**, respecting the engine's `NESTED_LOOP` and `COMPOSITE_RECURSION` guards.
- **Reference blind-A/B bar** behind a pluggable `BarAdapter` seam; v1 ships a code/runnable inspector (other domains arrive via additional adapters — no engine change).
- Per-wave **two-sub-phase staging** (all piece-builders admitted serially, then all critics + meta-critic admitted together as read-only) to actually realize critic parallelism under the single-writer workspace lock.
- Decomposition modeled as **replayable committed Actions** (the ReviewCycle model), so the sealed RuntimePlan invariant is preserved and resume reconstructs wave structure.
- **Human-convergence delivery bridge**: a convergence attestation flows **through a final convergence-judge** that records an auditable satisfied result (semantically "user-converged via attestation," **not** "reference bar reached") → unlocks ship/archive via the **existing** delivery guards. Backstop cap = **suspend-and-prompt** (work preserved, never destroyed).
- Localization (en/ja/zh-cn), registry/profile/init-update parity, and the auto driver's dependency closure updated by explicit name.

## Capabilities

### New Capabilities

- `gauntlet-loop-pipeline`: the phased per-wave creation loop — explicit-only selection; frozen reference bar (BarAdapter); serial+parallel phased execution with the two-sub-phase staging rule; fresh-critic + blind-A/B judgment; one-level per-wave decomposition as replayable Actions; convergence-through-judge satisfaction and backstop-suspend; terminal honesty. Sibling to `task-loop-pipeline` and the goal-loop capabilities.

### Modified Capabilities

None at the spec-contract level. gauntlet-loop reuses GoalCycle, the Canonical Run, the reconciler, delivery guards, and the registry additively. The auto driver gains `gauntlet-loop` as an explicit selector and a dependency-closure member; that integration is captured in the new capability's spec, not as a change to existing requirements.

## Impact

- **New code**: `pipelines/gauntlet-loop/pipeline.yaml`; an internal `rasen-gauntlet-loop` skill (lead + piece-builder + piece-critic + meta-critic + smoothing contracts); a wave-orchestration module (the new `gauntlet-wave` bounded-loop body kind + parent/child piece-loop accounting via the Run DAG); the `BarAdapter` seam and a v1 code/runnable inspector; the convergence-judge + backstop-suspend terminal path.
- **Reused unchanged**: GoalCycle bounded loop + fresh-critic enforcement, CanonicalRun (inputs/evidence/identity/resume), reconciler next-action, profile resolution, dispatch, the ReviewCycle action-replay pattern, and the ship/archive delivery guards.
- **Engine constraints respected (no relaxation)**: `COMPOSITE_RECURSION` (`definition.ts:1071`), `NESTED_LOOP` (`definition.ts:1406`), single-writer serialization (`selectCompatibleAdmissions`, `reconciler.ts:1086-1101`).
- **Touched**: workflow-registry builtins, the auto workflow template + dependency closure, locale catalogs, pipeline-registry validation, profile/init/update generated-skill parity.
- **No** new public command; **no** automatic classifier route into gauntlet-loop; **no** fallback/conversion from a terminal gauntlet outcome to any other pipeline.
- **Lead Open Question (resolved during implementation)**: the concrete blind-A/B presentation for the code domain.
