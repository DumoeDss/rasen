## Context

`src/core/templates/workflows/_orchestration.ts` currently exports one approximately 78 KB `ORCHESTRATION_PLAYBOOK` string. The auto, goal-command, and review-cycle templates each interpolate that string in full. This is easy to keep consistent, but it gives the two narrow workflows instructions for orchestration modes they cannot enter.

The three entry workflows do not normally coexist as active lead modes in one session, so this change is not intended to eliminate same-session duplicate loading. Its target is the eager installed/generated skill corpus and the prompt body of whichever narrow workflow is invoked.

The current playbook is not a set of independent headings. Shared sections, especially dispatch, keepalive, run-state, and context handoff, refer to optional loop and portfolio sections. Module extraction therefore has to preserve reference closure as well as text order.

## Goals / Non-Goals

**Goals:**

- Retain one canonical source for every orchestration rule.
- Inline only the applicable semantic modules into each generated entry skill.
- Preserve `rasen-auto`'s complete, generic pipeline semantics and byte-stable content where practical.
- Keep goal and review-cycle behavior unchanged while removing instructions for modes they cannot execute.
- Make bundle membership, reference integrity, parity changes, and generated size mechanically testable.

**Non-Goals:**

- Moving orchestration text to sidecar files or loading it lazily at runtime.
- Changing workflow digest calculation, `rasen init`, or `rasen update`.
- Redesigning any orchestration rule or changing loop, handoff, worker, gate, or resume behavior.
- Reducing `rasen-auto` to roughly 27 KB or the eager skill corpus to roughly 705 KB. Those estimates require externalization or a more aggressive behavioral split.
- Deduplicating text across separately installed files at the filesystem layer.

## Decisions

### 1. Use a typed bundle composer over semantic source modules

`_orchestration.ts` will expose a small feature model and three named generated bundles:

- `AUTO_ORCHESTRATION_PLAYBOOK`
- `GOAL_ORCHESTRATION_PLAYBOOK`
- `REVIEW_CYCLE_ORCHESTRATION_PLAYBOOK`

The composer will assemble canonical sections in their existing relative order:

1. header
2. capability tier (`A`, `A.1`)
3. dispatch core (`B`)
4. persistent planner (`B.1`, optional)
5. Codex lifecycle and project context (`B.2`, `B.3`)
6. parked-worker keepalive (`B.4`)
7. author/verifier isolation (`C`)
8. stage metadata (`D`, optional)
9. review loop (`E`, optional)
10. goal loop (`L`, optional)
11. run-state and resume (`F`, `F.1`)
12. portfolio and cross-child reuse (`G`, `G.1`, optional)
13. context sensing and handoff (`H`)

Named exports make every generated artifact explicit and discoverable, while a single composer keeps ordering and feature selection centralized. Whole-section source text remains canonical instead of being copied into each consumer.

Alternative considered: export only many string constants and concatenate them independently in each workflow template. Rejected because the membership policy and ordering could drift across consumers.

### 2. Select bundle features by workflow capability, not by expected session overlap

The bundle matrix is:

| Module | Auto | Goal | Review cycle |
|---|---:|---:|---:|
| Header, A/A.1, B, B.2/B.3/B.4, C, F/F.1, H | yes | yes | yes |
| B.1 persistent planner | yes | no | no |
| D stage metadata | yes | yes | no |
| E review loop | yes | no | yes |
| L goal loop | yes | yes | no |
| G/G.1 portfolio | yes | no | no |

Auto retains every module because it executes arbitrary registered pipelines, including review loops, goal loops, and decomposition. Goal retains stage metadata and the goal loop. Review-cycle retains the review loop but does not need generic stage metadata or goal/portfolio rules.

Alternative considered: give auto only the small-feature subset because that is the default pipeline. Rejected because pipeline selection is dynamic and custom pipelines may use the omitted features.

### 3. Render shared modules with feature-aware cross-reference fragments

Several otherwise-shared modules contain references to optional sections. The composer will pass its feature set to the affected section renderers and include only the relevant clauses, examples, counter rows, and cross-references. Examples include:

- the header's Step E.2 trivial-fix exception;
- keepalive clauses that distinguish review-loop and portfolio reuse;
- the Step H counter rows and escalation references for review, goal, planner, and portfolio behavior;
- session-relay references to decomposition and cross-child reuse.

The full auto feature set must render all existing clauses in their current order. Narrow bundles must neither refer readers to an omitted step nor lose the general handoff/run-state rule that the optional example was illustrating.

Tests will assert both heading membership and reference closure for excluded step identifiers. Where a shared sentence mixes a core rule with an optional reference, it will be split into canonical core and optional fragments rather than duplicated as workflow-specific prose.

Alternative considered: cut only at heading boundaries and tolerate references to missing steps. Rejected because the resulting skill would be smaller but internally incomplete.

### 4. Keep selective inline as a template-only change

Consumers will replace the old common import with the named bundle matching the workflow. Generated `SKILL.md` files remain self-contained. No source sidecar is installed, read, hashed, or synchronized.

Alternative considered: install one orchestration sidecar and reference it from all workflows. Rejected for this tranche because it would require defining loading behavior and extending digest/init/update propagation; it also changes the runtime prompt-loading contract.

### 5. Test exact composition and conservative byte budgets

Unit tests will check:

- required and forbidden step markers for every named bundle;
- absence of references to omitted step identifiers;
- existing command/template behavioral assertions;
- template parity hashes, with only expected generated templates changing;
- full generated `SKILL.md` UTF-8 byte size at or below:
  - auto: 106 KB
  - goal: 70 KB
  - review-cycle: 60 KB

The budgets are regression ceilings, not promised final sizes. Auto's ceiling intentionally permits its current approximately 104 KB output. Goal and review-cycle targets reflect selective removal while allowing front matter and small composition scaffolding.

## Risks / Trade-offs

- **[Cross-reference coupling]** A shared paragraph can mention an excluded module even when its heading is removed. → Use feature-aware fragments and explicit omitted-reference tests.
- **[Canonical-source fragmentation]** Overly small constants could make the prose harder to edit safely. → Keep semantic sections coarse and split only mixed core/optional clauses.
- **[Parity churn]** Recomposition changes generated hashes even when semantics do not change. → Regenerate only the affected golden entries and retain ordinary content assertions.
- **[Auto regression]** A new optional module could be added to the source but omitted from auto. → Centralize the full feature set and assert all known module markers in the auto bundle.
- **[Concurrent keepalive edits]** The original worktree has separate Step B.4 work that is not part of this branch's base. → Keep this branch isolated and reconcile the latest B.4 text before integration; composition/reference tests must be rerun after that reconciliation.
- **[Modest aggregate reduction]** Selective inline cannot reach sidecar-level corpus savings. → Report measured outputs honestly and keep the more aggressive optimization as a separate future change.

## Migration Plan

1. Add the module model, section composer, and named bundle exports while preserving the complete auto rendering.
2. Switch the three workflow templates to their named bundles.
3. Add composition, reference-closure, and size tests; update affected parity hashes.
4. Run focused workflow-template tests, then the broader unit/typecheck suite.
5. If rollback is needed, restore the single export and the three original imports; no persisted data or installed-file migration is involved.

## Open Questions

None. Bundle membership, size ceilings, and the no-sidecar boundary are fixed for this change.
