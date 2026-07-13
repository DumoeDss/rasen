## Context

Child 1 (autonomy-ladder-classify, shipped 9d73c83, archive pending) established the selection-policy axis: `autopilot.selection: classify | manual`, `--auto-select` flag, `resolveAutopilotSelectionPolicy()` in `src/core/project-config.ts`, and an auto-template section 1 whose policy sub-list is a flat bullet list deliberately left ready for a third bullet (implementer's durable finding: "third bullet + enum value, no restructure").

The pipeline registry already provides everything composition needs except the floor guard: `getProjectPipelinesDir()` (project pipelines land at `<root>/rasen/pipelines/<name>/pipeline.yaml` and win precedence), `parsePipeline()` (Zod `PipelineYamlSchema` + structural validators: duplicate ids, missing requires, cycles, parallel-group independence, decompose placement), and `rasen validate <name> --type pipeline` which additionally runs `validatePipelineSkills` (known-skill check) and `validateDecomposeChildPipelines` (recursion guard). The `agents` subcommand already demonstrates the write-then-parse project-override path (`writeProjectPipelineOverride` parses before writing).

This is rung 2 of the ladder decided with the user on 2026-07-10. Rung 3 (runtime free-form DAG) was rejected in that decision and is recorded below as a Non-Goal.

## Goals / Non-Goals

**Goals:**
- Let an opted-in LEAD compose a pipeline from the known stage library when no registered pipeline fits, as a registered, validated, resumable project pipeline.
- Machine-enforce the quality floor: a composed pipeline always contains verification and a review loop — the LEAD cannot compose itself an inspection-free path.
- Preserve every rung-1 invariant: default OFF, explicit selector above the policy, `small-feature` fallback.

**Non-Goals:**
- **Rung 3 — runtime free-form DAGs: rejected, not deferred.** The LEAD never executes an in-memory, unregistered DAG. Rationale: an unregistered DAG has no `pipeline.yaml` for `rasen pipeline show/resume` to load, so interruption strands the run (resume works by loading the persisted pipeline *name* from run-state) and the audit trail loses its referent. Runtime dynamism is already covered by decompose (runtime fan-out to child changes) and goal-loop (runtime iteration).
- No composed-pipeline lifecycle management (GC/expiry): composed pipelines persist as ordinary project pipelines — listable, inspectable, deletable by the user. Accumulation is bounded by how rarely composition fires (default-basis AND no-fit AND opt-in).
- No version bump; no default flips.
- No new stage kinds or skills: composition recombines the existing stage vocabulary.

## Decisions

### D1. Third policy value `compose` + separate `--auto-compose` boolean flag

Config: `autopilot.selection` enum widens to `classify | manual | compose`. Flag: new boolean `--auto-compose` (→ `compose`, source `flag`), sitting ahead of `--auto-select` (→ `classify`) in the resolver: **`--auto-compose` > `--auto-select` > config > default `manual`** — compose is a superset of classify (see D2), so when both flags appear the superset wins. `resolveAutopilotSelectionPolicy` keeps its single-resolver contract; its flag input widens to carry both booleans.

- *Why a separate boolean flag rather than `--auto-select compose`*: a value-taking flag in a skill-invocation line is ambiguous — in `/rasen:auto --auto-select compose the settings page`, "compose" could be the flag value or the first task token, and `compose` could someday collide with a pipeline name. Boolean flags (`--no-gate`, `--auto-select`) are the established invocation grammar; a second boolean is unambiguous and back-compatible.
- *Why one axis, not a second config key*: rung 1 chose the `classify | manual` value space explicitly so compose could join it (recorded child-1 finding); a sibling key (`autopilot.compose: on`) would create two keys whose combinations need a matrix of rules.

### D2. Compose policy is classify-first; composition fires only on no-fit

Under `compose`: (1) run classify exactly as the `classify` policy does; (2) a `keyword`-basis suggestion in `available` is adopted as-is — composition never overrides an affirmative match; (3) on a `default` basis, the LEAD judges fit: if `small-feature` (or any registered pipeline) fits the task's stage needs, use it; only when NO registered pipeline fits MAY it compose; (4) any failure anywhere (classify unavailable, composition invalid after one fix attempt, floor unmet) falls back to `small-feature`.

- *Why classify-first*: keeps `compose` a strict superset of `classify` — a project can move up the ladder by changing one config value without changing what happens on well-classified tasks; composition stays the rare path for genuinely novel task shapes.
- *Why "MAY compose", not "SHALL compose"*: no-fit is a judgment call; making composition an obligation would force composition on every unmatched task, and `small-feature` is a fine general-purpose default. Permission, not obligation.

### D3. Validation path = existing `rasen validate <name> --type pipeline`; no new CLI

The composition flow is: write the YAML to `<projectPipelinesDir>/<name>/pipeline.yaml`, then run `rasen validate <name> --type pipeline --json` as the gate; execute only on `valid: true`. One bounded fix attempt on failure, then fall back to `small-feature` (the invalid directory is removed so it does not shadow anything).

- *Rejected alternative — new `rasen pipeline validate <file>` subcommand*: duplicates an existing surface. `validate --type pipeline` already runs the complete guard stack (parse + Zod + structural validators + known-skill check + decompose child guards) with a machine-readable issue report; a file-path variant would only save the write-first step, and writing first is needed anyway (the pipeline must exist in the registry to be executed and resumed). Planning-context leaned minimal-CLI-surface; this confirms it.
- *Rejected alternative — template-only gate via `rasen pipeline show <name> --json`*: `show` proves loadability but its failure output is not an issue report, and the validate path is the one specced to enforce structural rules. `show` remains the DAG-fetch step (section 2 of the template) after validation passes.

### D4. Quality floor enforced at parse time via an `origin: composed` marker

`PipelineYamlSchema` gains an optional `origin` field (single literal value `composed`; absent = human-authored). `parsePipeline` gains `validateComposedPolicyFloor`: when `origin === 'composed'`, the pipeline MUST contain at least one stage with `role: reviewer` (verification) and at least one stage with `loop.kind: 'review-cycle'` (review loop), else `PipelineValidationError`. The LEAD template REQUIRES stamping `origin: composed` on everything it composes. `rasen pipeline show` surfaces `origin` for provenance.

- *Why a marker instead of a blanket rule*: the floor is a policy on the **composition act**, not on pipelines in general — the built-in `bug-fix` has no review-loop stage and user-authored project pipelines are free-form; a blanket guard would reject both. The marker scopes the guard to exactly the LEAD-composed population.
- *Why parse-time enforcement*: it is the hardest available guarantee — a floor-violating composed pipeline cannot be loaded, shown, resumed, or executed at all, rather than relying on the validate step having been run. A LEAD that "forgets" the stamp is violating the same template contract that all other guardrails rest on, and the stamp is also what gives the audit trail its provenance value — same trust model, strictly more enforcement than prose alone.
- *Floor operationalization* (`role: reviewer` + `loop.kind: review-cycle`): matches exactly how the built-ins express verification (`verify` stage, role `reviewer`) and the review loop (`review-loop` stage, `loop.kind: review-cycle`); both are existing schema fields — no new detection mechanism, per project rules.

### D5. Composed pipelines are ordinary project pipelines; naming and collision rules

Name = `composed-` prefix + a short kebab slug of the task (LEAD-derived); before writing, the LEAD checks `rasen pipeline list --json` and MUST NOT reuse an existing name (append a numeric suffix on collision — never overwrite, which registry precedence would turn into shadowing). Stages are drawn from the registered pipelines' stage vocabulary (inspected via `rasen pipeline show` on the built-ins): stage blocks reuse known skills, roles, gates, loops, and verifyPolicy values; `requires` edges are the LEAD's to draw and the structural validators check them.

- *Why the `composed-` prefix*: instant provenance in `pipeline list`, greppable audit, and a guaranteed non-collision namespace with the built-ins (none are prefixed).
- *Resume/audit inheritance is free*: run-state records the pipeline *name*; `rasen pipeline resume` loads it through the registry, project dir first. No run-state schema change (child-1 finding, re-verified: `readRunState`/`loadPipelineByName` path in `src/commands/pipeline.ts` resume).

### D6. No new human gate on composition; display is mandatory

The composed pipeline is displayed at the existing selection display point — name, full stage list with the floor stages called out, and the validate verdict — and the user can change or reject it before anything runs, exactly like an adopted classify suggestion. Gate behavior during execution then follows the composed YAML's own `gate:` fields plus the resolved gate policy (rung-1 machinery, including the `vet` exemption).

- *Rejected alternative — a mandatory `vet`-style pause on every composition*: it would make composition unusable in unattended runs, which are the main consumers of the autonomy ladder; the user has already explicitly opted in (flag or config), the floor is machine-enforced, and every stage-level gate in the composed pipeline still applies. The opt-in IS the consent.

## Risks / Trade-offs

- **[LEAD composes a poorly-shaped pipeline]** Structural validity does not guarantee a sensible stage order. → Mitigation: stage vocabulary limited to known skills/roles; floor guarantees verification + review loop are present regardless of shape; display point exposes the full DAG before execution; fallback to `small-feature` is one decision away.
- **[Unstamped composition dodges the floor]** A LEAD that omits `origin: composed` gets no parse-time floor. → Mitigation: stamping is a template guardrail with the same standing as author≠verifier; the `composed-` name prefix makes an unstamped composed pipeline visibly anomalous in `pipeline list`; trust model unchanged from every other template rule.
- **[Composed-pipeline accumulation]** Repeated compositions accrete project pipelines. → Mitigation: rare trigger path (opt-in AND default-basis AND no-fit); ordinary deletable files; explicitly a Non-Goal to manage lifecycle now — revisit if real usage shows accumulation.
- **[Archive-ordering hazard]** This change's delta MODIFIES `autopilot-selection-policy`, which exists only in child 1's unarchived delta. → Mitigation: flagged prominently in the proposal; the portfolio's serial order (child 1 archives before this change's archive) makes the MODIFIED headers match the main spec at this change's archive time; the sync engine's verbatim-header guard would loudly fail on any reorder rather than corrupt anything.
- **[Windows paths]** Composed YAML lands via `path.join(getProjectPipelinesDir(root), name, 'pipeline.yaml')` — same cross-platform path discipline as `writeProjectPipelineOverride`; no hand-built separators anywhere in the flow.

## Migration Plan

Purely additive. Existing pipeline YAML (built-in, user, project) has no `origin` field and parses byte-identically; absent the new flag/config value, selection behavior is unchanged from child 1 (and from 0.1.x when neither rung is opted in). Rollback = revert the commit; any already-composed pipelines remain valid project pipelines (their `origin` field would fail Zod's strict schema only if the field were removed from the schema — rollback should keep `origin` tolerated or the user deletes the composed directories; noted as the single rollback caveat).

## Open Questions

None. The ladder decisions (2026-07-10) bind rungs 1-3; the validation-path and flag-shape decisions above record their rejected alternatives.
