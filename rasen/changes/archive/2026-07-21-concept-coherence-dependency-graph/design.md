## Context

Portfolio decision #3: replace the "experts are always installed, no questions asked" axiom with an explicit dependency graph. Today `WorkflowDefinition.requires` exists but every built-in ships `{ workflows: [], skills: [] }` (`builtins.ts:153`), and the real dependency edges live implicitly in two places: machine-readable `skill:` fields in `pipelines/*/pipeline.yaml`, and prose in skill template bodies (e.g. `review-cycle` delegates to the `rasen-review` engine). This change audits those edges, makes the `requires` slot able to hold all four edge kinds, populates the built-ins, validates the new slots, and adds a `--force` override to the (already-existing) delete refcount guard.

Two facts from reading the current tree materially shrink this change versus its worst-case framing:
- **`requires.workflows` closure already works**: `resolveWorkflowSelection` (`selection.ts:38`) already visits `definition.requires.workflows` transitively, for built-in and user workflows alike, and composes with profiles/`workflowFilter`.
- **The delete refcount guard already exists**: `deleteWorkflow` (`workflow-library.ts:525`) refuses built-in deletion and throws `workflow_in_use` when `scanWorkflowUsage` finds any referrer, and `createWorkflowUsageContext` (`:421`) already scans user workflows' `requires.workflows`, pipeline stage `skill:` references (via `workflowIdBySkillName`), global config, named profiles, and the artifact ledger.

So the genuinely new surface is: (b) two more `requires` sub-slots, (a-populate) the audited built-in edges, (c) presence-validation of the new slots, and (d) a `--force` escape hatch on delete. No new co-install engine and no new usage scanner are needed.

## The audited dependency graph (the heart of this change)

Reviewers should check this inventory against the cited sources. `→skill` = machine-readable pipeline stage edge; `⇒` = prose dispatch edge in a skill body.

### Pipeline → skill edges (machine-readable, from `pipelines/*/pipeline.yaml`)

| Pipeline | Stage skills referenced | Child pipeline |
|---|---|---|
| `auto-decompose` | rasen-propose, rasen-apply-change, rasen:review, rasen-review-cycle, rasen-ship, rasen-archive-change | **small-feature** (`auto-decompose/pipeline.yaml:15`) |
| `small-feature` | rasen-propose, rasen-apply-change, rasen:review, rasen-review-cycle, rasen-ship, rasen-archive-change | — |
| `bug-fix` | rasen-propose, rasen-apply-change, rasen:review, rasen-ship, rasen-archive-change | — |
| `full-feature` | rasen-office-hours-command, rasen-propose, rasen-apply-change, rasen:review, rasen:cso, rasen:benchmark, rasen:design-review, rasen:qa, rasen:qa-only, rasen-review-cycle, rasen-ship, rasen-archive-change, rasen-retro | — |
| `goal-loop-measure` | rasen-goal-plan, rasen-goal-iterate, rasen-ship, rasen-archive-change | — |
| `goal-loop-evaluate` | rasen-goal-plan, rasen-goal-iterate, rasen-ship, rasen-archive-change | — |
| `goal-loop-research` | rasen-goal-plan, rasen-goal-iterate, rasen-goal-report | — |

(`rasen:review`/`rasen:cso`/etc. resolve to the expert skills `rasen-review`, `rasen-cso`, `rasen-benchmark`, `rasen-design-review`, `rasen-qa`, `rasen-qa-only`.)

### Prose dispatch edges (from skill bodies, `src/core/templates/workflows/*.ts`)

| Workflow | Dispatches | Source |
|---|---|---|
| `review-cycle` | ⇒ rasen-review (every pass) | `review-cycle.ts:21,80`; also embeds `_orchestration` |
| `auto` (driver) | ⇒ rasen-review (via `_orchestration`); consumes pipelines small-feature/full-feature/bug-fix/auto-decompose | `auto.ts:56-58,72,84,131` |
| `goal-command` (driver) | consumes pipelines goal-loop-measure/evaluate/research | `goal-command.ts:8-10,39-42` |
| `verify-enhanced-command` | ⇒ rasen-review, rasen-cso, rasen-qa, rasen-design-review, rasen-qa-only | `verify-enhanced.ts:36-38,64-75` |
| `_orchestration` (shared, embedded in auto/goal-command/review-cycle) | ⇒ rasen-review | `_orchestration.ts:131` |

Navigation edges (a body suggesting `/rasen:<x>` as a next step, e.g. `help`, `apply`→`verify`→`ship`) are soft and are NOT modeled as `requires` — they are at most `recommends` and are left out this round to keep the graph honest (a hard `requires` should mean "cannot function without").

### Derived built-in `requires` population

| Workflow | requires.skills | requires.pipelines |
|---|---|---|
| `review-cycle` | rasen-review | — |
| `verify-enhanced-command` | rasen-review, rasen-cso, rasen-qa, rasen-design-review, rasen-qa-only | — |
| `auto-command` | rasen-review | small-feature, full-feature, bug-fix, auto-decompose |
| `goal-command` | — | goal-loop-measure, goal-loop-evaluate, goal-loop-research |
| all others | — | — |

`requires.workflows` stays empty for every built-in: the propose→apply→ship sequencing is expressed by pipeline stages, not by workflow-to-workflow hard edges. `requires.schemas` stays empty for every built-in this round (the pipeline→`spec-driven` edge is implicit and the slot is existence-only, reserved). The expert skills named above are members of the always-installed expert set, so these declarations are satisfied by construction today — their value is (1) making the edge explicit for the refcount model and (2) the foundation child 6 uses to flip "always install" into "protected because depended-upon".

## Goals / Non-Goals

**Goals**
- Extend `requires` to `{ workflows, skills, pipelines, schemas }` on the type, the manifest, and the validator.
- Populate the built-in edges per the table above.
- Validate presence of the new slots (pipelines/schemas/skills) at load/selection time; keep the existing `requires.workflows` transitive closure.
- Add a `--force` override to `workflow delete` with explicit semantics.
- Document how the quality-floor shift completes in child 6.

**Non-Goals**
- No change to expert installation behavior — experts remain always-installed this round (child 6 owns the flip).
- No new co-install machinery for pipelines/schemas (they are data, not on-demand-installed units this round; pipeline packaging is child 5).
- No `manifestVersion` bump; no digest/golden-fixture churn (`requires` is outside both digest preimages — verified empirically by the kind-taxonomy sibling).

## Decisions

### D1. Four-slot `requires`, all outside the digest

`WorkflowDependencySet` becomes `{ workflows: string[]; skills: string[]; pipelines: string[]; schemas: string[] }`. Neither `digestBuiltIn` nor `computeWorkflowDigest` includes `requires`, so populating slots produces zero digest change, zero `builtins-v1.json` change, and zero parity-SHA change (the fixture projects only id/skillName/dirName/commandId). The deep-equal tests that construct a full `WorkflowDefinition` (`validator.test.ts`, `workflow-package/codec.test.ts`) must add the two new empty sub-slots to their expected objects.

### D2. Manifest gains two optional slots, strictly validated

`WorkflowManifestSchema.requires` (`manifest.ts:34`) gains `pipelines: PortableStringArraySchema` and `schemas: PortableStringArraySchema` (default `[]`). This is old→new compatible (omitted → empty). The `strictObject` means a new-field package is rejected by an older CLI; that forward-compat gap is child 5's version gate and is accepted here. The validator (`validator.ts:292-313`) extends its portability + existence checks to the two new arrays.

### D3. Presence-validation, not co-install, for the new slots

- `requires.workflows`: unchanged — `resolveWorkflowSelection` closes it transitively and co-installs, composing with the profile/`workflowFilter` roots.
- `requires.skills`: validate the named skill is present in the installed/expert set. Experts are always installed, so built-in declarations always pass; a user workflow naming a non-existent skill is a validation error. No on-demand expert install (they are already all installed).
- `requires.pipelines`: validate each named pipeline resolves via `listPipelines(projectRoot)` / `resolvePipelinePath`. No pipeline co-install this round.
- `requires.schemas`: validate each named schema resolves via `listSchemas(projectRoot)`. Existence-only.
- **Known gap (accepted this round):** directory-level validation (`validateWorkflowDirectory`) has no project context, so these checks actually run WITHOUT a `projectRoot` — only package built-in and user-override pipelines/schemas satisfy them; project-local ones do not. Recorded as a durable finding for the pipeline-library change, which must either thread a `projectRoot` into directory validation or move the check to catalog-time.

Built-in edges are additionally guarded by a unit test asserting every built-in `requires.{skills,pipelines}` entry resolves to a real skill/pipeline — so the audit can never silently rot.

**Built-in vs user closure semantics (as asked):** built-in requires are declarations over units that are always present (experts always installed; built-in pipelines/schemas always on disk), so closure is a no-op guarantee. User requires are validated for presence at import/selection; `requires.workflows` additionally co-installs via the existing selection closure. Neither adds skills/pipelines/schemas to the *workflow selection set* — those slots are validated, not selected.

### D4. Delete refcount guard keeps its default; add `--force`

The guard already refuses deletion when `scanWorkflowUsage` finds referrers (user `requires.workflows`, pipeline stage `skill:` references, global/profile selection, ledger) and names them in the `workflow_in_use` error. This change adds a `--force` flag to `rasen workflow delete` that bypasses **only** the `workflow_in_use` referrer guard (never the built-in-delete prohibition, which stays hard). Semantics: with `--force`, the delete proceeds but prints a loud warning naming every referrer that will be left dangling; the `-y/--yes` confirmation is still required in non-interactive mode. `--json` reports the forced referrers under a `forcedReferrers` field. Without `--force`, behavior is unchanged (hard error).

### D5. Quality-floor shift is documented, not implemented (e)

Experts stay always-installed this round (`skill-generation.ts:140` unchanged). The dependency data this change lands is exactly what child 6 needs to complete the shift: child 6 will (1) stop unconditionally installing every expert, (2) instead install the union of experts named by any selected workflow's `requires.skills` plus a default-profile set, and (3) rely on the refcount guard so a depended-upon expert cannot be removed while a referrer exists. This is recorded here so child 6 does not re-derive the model. No behavior in the current change depends on it.

## Risks / Trade-offs

- **Declarations without teeth this round**: built-in `requires.skills` are satisfied trivially because experts are always installed, so the population looks inert until child 6. Accepted — it is the deliberate seam, and the audit test keeps it honest.
- **`--force` foot-gun**: forcing a delete can strand referrers. Mitigated by the loud, referrer-naming warning and by keeping the guard as the default.
- **Scope**: this is the largest code child, but the pre-existing closure and guard keep it to slot-extension + data + validation + one flag. If reviewers still want it smaller, the clean fissure is (i) slots + audit-populate + validation, then (ii) the `--force` override — the override is independently shippable once the slots exist. Flagged in the DONE report.

## Migration Plan

Additive. Existing user manifests without the new slots default to empty and keep validating. No config or artifact rewrite. `workflow delete` behaves identically unless `--force` is passed.

## Open Questions

None blocking. The only judgment call — model soft navigation edges as `recommends` or omit them — is resolved as omit this round (keep `requires`/`recommends` honest; revisit if a concrete consumer needs the soft edges).
