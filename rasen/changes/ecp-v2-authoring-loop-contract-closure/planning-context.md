# Planning Context: ECP-6

## User intent

The user explicitly asked to run `rasen-auto auto-decompose`, continue in the current worktree,
drive every Direction slice until the 0.2.0 ECP is genuinely complete, and create a PR only after
the complete portfolio is verified. The user then explicitly required that execution start by
enabling the slice from Direction.

## Direction source of truth

- Workstream: `rasen/work/issue-centered-automation-platform/executable-composite-pipelines`
- Active Slice: `slices/v2-authoring-loop-contract-closure`
- Slice id: ECP-6, v2 Authoring and Loop Contract Closure
- Selection baseline: `dev/0.2.0` @ `14ed62bc088197294f4a219ff20e946a6a99691d`
- Read the Slice `spec.md` and `plan.md` before proposing any child Change.
- ECP-7 and ECP-8 are later Direction slices. They must not be silently pulled into ECP-6.
- Issue/Execution Plan/Dispatch and product `auto-decompose` migration belong to 0.3.0.

## Observed baseline

- Definition v2, v1 normalization, immutable plans, canonical Records, and the deterministic
  reconciler exist.
- Six Change-level built-ins select the reconciler under the default engine policy.
- `auto-decompose` remains a v1 legacy-LEAD portfolio mechanism and is not part of Change-level
  ECP 0.2.0 acceptance.
- Built-ins, `pipeline init`, and blank Canvas still author v1 by default.
- Canvas cannot yet fully author every supported v2 primitive and loop policy.
- The public shared bounded-loop lifecycle does not yet completely cover stall, blocked,
  strategy exhaustion, human escalation, and typed terminal outcomes.
- Current worktree contains pre-existing uncommitted documentation and unrelated user changes.
  Preserve them; never reset or rewrite unrelated work.

## Audited portfolio and dependency rationale

1. `ecp-shared-bounded-loop-lifecycle`.
2. `ecp-v2-default-authoring-and-builtins`, depends on 1.
3. `ecp-canvas-v2-authoring-parity`, depends on 2.
4. `ecp-v2-authoring-loop-vertical-proof`, depends on 3 and consumes all prior results.

An independent read-only reviewer audited this split against current code and existing ECP Changes.
No positive independence proof exists: lifecycle/default share Definition and runtime contracts;
default/Canvas share blank-definition, wire, serializer, and round-trip contracts. The portfolio is
therefore strictly serial. Vertical dogfood is the final merge node.

Do not absorb or reopen `ecp-run-spine`, `ecp-association-registry-wiring`, or
`ecp-settle-completeness`. Their implementation is already merged; remaining artifact/checklist
state is evidence/closure input, not authorization to reimplement settle/reservation/association.

Durable audit findings:

- The hidden gap is not merely YAML version numbers: v2 authored definitions still lack a reliable
  CLI/registry execution projection.
- The shared bounded-loop lifecycle must land before built-in migration to prevent duplicate
  migrations and digest/fixture churn.
- Existing Change artifact status is not completion evidence by itself; inspect source, tests, and
  merged revisions.

## Bootstrap dogfood evidence

The first child was launched as a real reconciler Run
`run:7db97fdc0a562f1824d5a866807ab67035587c81c63fe8a214688304e558efa4` and granted the
`rasen-propose` action. The planner completed valid artifacts, but the public executor seam could not
settle the action:

- `pipeline complete` rejected an `effect-observation` because the facade only accepts domain
  results;
- the domain success was then correctly rejected because the required workspace effect remained
  open;
- the convenience `pipeline cancel` command emitted an obsolete control body and was rejected;
- the general typed `pipeline control` path accepted a correct `change-run-control/1` request and
  cancelled the Run without mutating it through a side door.

This is fail-closed evidence for ECP-7/ECP-8. ECP-6 implementation continues under one explicit
legacy owner; no canonical Run and legacy state advance concurrently. ECP self-hosting must be
retested after the Session executor/public effect-observation seam lands.

## Execution constraints

- Parent pipeline: `auto-decompose`; child pipeline default: `small-feature`.
- Parent gate base: off (global). Child checkpoints auto-continue unless a per-stage override
  explicitly restores a gate.
- Host/tier: Codex native, Tier A.
- Every child has its own canonical run-state and independent reviewer.
- Child delivery is local only. The parent performs one portfolio-level PR delivery.
- No Slice is `passed` from task checkboxes or file presence; only the Slice acceptance evidence
  in Direction is authoritative.

## Shared lifecycle dependency contract

- Authored v2 `BoundedLoop` sources must declare the complete versioned lifecycle policy; v1
  normalization is compatibility-only and must not invent a strategy capability. The built-in
  migration child must author explicit policies and frozen strategy bindings after this contract lands.
- `bounded-loop-lifecycle/1` is the canonical cross-plane mechanics projection. The Canvas child
  must edit the same definition shape and consume server preparation diagnostics rather than create
  a UI-local lifecycle variant or counter model.
- Current loop adapters can select the first stale action after a blocked retry. The lifecycle child
  must land latest-attempt selection and fresh retry identity before the vertical proof treats
  blocked resume, strategy recovery, or human guidance as complete.
- Domain semantics remain split: ReviewCycle owns findings and clean ship safety; GoalLoop owns
  scores/gaps and satisfaction. Dependent children must not merge them or equate a lifecycle `exit`
  (including a research report tail) with domain success.

## Child 2 durable planning findings: v2 defaults and built-ins

- The default gap is structural, not a version literal: `pipeline init` and Canvas empty drafts author
  v1, while v2 CLI/detail currently return raw definition JSON or empty execution stages. Child 2 must
  land a canonical blank/serializer and one prepared execution view before migrating manifests.
- Native v2 AtomicStages need a closed execution declaration (role, explicit workspace access, gate,
  verification and existing policy intent) so inspection, config overrides, profile freezing and lowering
  do not depend on review-oriented synthetic defaults or v1 `legacy` payloads. Session limit selection and
  worker enforcement remain ECP-7.
- The migration set is exactly `bug-fix`, `small-feature`, `full-feature`, and the three `goal-loop-*`
  pipelines. Their capability versions are exact trusted catalog pins; pin drift must fail at a named path.
- Review strategies bind `rasen-review-cycle`; Goal strategies bind `rasen-goal-iterate`, subject to
  failure-first invocation/result-contract verification. Research iteration exhaustion must enter its
  report tail as a truthful non-success lifecycle exit, never as goal satisfaction.
- `auto-decompose` remains byte-identical authored v1 and is separately labeled
  `issue-dispatch-0.3.0`; it is not a partial v2 Change pipeline and is absent from the six-item set.
- Child 3 may rely on a fresh blank v2 draft and lossless wire/serializer contract, but still owns all
  Composite/loop/parallel authoring panels and round-trip parity. Child 4 owns final vertical proof.

## Child 2 review-clean durable findings

- Native-v2 authored Gate is the sole authority (`target`, decisions/outcomes, dispositions); the retired AtomicStage boolean gate must never reappear. V1 normalization alone preserves historical gate ids and `approve | reject` compatibility.
- Inspection and execution must share the host-aware prepared execution view and route/bridge preflight. A UI-local execution model or inferred capability profile is not authoritative.
- ReviewCycle fix and GoalLoop judge require distinct exact capabilities (`rasen-review-fix`, `rasen-goal-judge`) with role/workspace validation; phase labels cannot make an incompatible skill safe.
- Installation/execution capability closure and public workflow selection are different sets. Internal dependency workflows may be enabled transitively but must not appear as picker roots or next-workflow suggestions.
- Child 2 passed a three-round non-author review cycle. Final local evidence combines 432/432 clean non-local-version files with two hermetic 7/7 local-version runs and UI 611/611; the shared-TEMP concurrent local-version interference remains documented rather than hidden.
- Canvas Child 3 must consume these contracts losslessly and expose the full supported v2 authoring surface without migrating `auto-decompose`, inventing a serializer, or claiming the Child 4 vertical proof.

## Child 3 planner durable findings: Canvas v2 authoring parity

- `ecp-canvas-v2-authoring-parity` is proposal-complete and strict-valid with proposal/design, a complete `pipelines-ui` delta, and 67 ordered apply/review tasks.
- The observed product gap is not only read-only preservation: FanOut/Join are explicitly outside the editable vocabulary; AtomicStage creation omits required execution; Gate target/dispositions and full loop lifecycle are unauthorable; declaration diagnostics and `/limits/budget` are unmapped.
- Implementation is constrained to the existing complete wire Definition draft, declaration CRUD, graph mutation layer, Management validation/save/detail seams, and canonical server serializer/preparation. No second Canvas model, serializer, execution view, lifecycle policy, or capability inference may be introduced.
- FanOut/Join must be authored and mutated as one paired contract. Reference-aware rename/delete must also cover Gate targets, parallel member/Join identities, CompositeRef declaration ids, BoundedLoop bodies, and typed connections.
- Acceptance distinguishes creation through real controls from lossless preservation, and requires positive/negative authoring matrices plus save/reload and source/capability/plan digest evidence. V1 open/edit/save/duplicate remains source-version-preserving compatibility.
- Child 3 does not claim the loop-plus-parallel canonical Run; Child 4 consumes the saved Canvas definition for that vertical proof. Session/effect execution, release closure, Issue/Dispatch/portfolio, and `auto-decompose` migration remain outside Child 3.

## Child 4 planner durable findings: vertical proof seams

- The sole shared fixture is preparation-valid and canonically persistent, but its root graph currently has no connections. It is not yet sufficient evidence for the authored execution order of a loop-plus-parallel Run. Child 4 must extend that same fixture through visible Canvas connection controls and feed the exact Management-saved value forward; a second runtime fixture is forbidden.
- The public `change-run-completion/1` contract and CLI decoder already accept `effect-observation`, while `createChangePipelineRuntime.complete()` rejects every non-`domain-action-result` request. Private reducer injection would make a green test without proving the product. Child 4 therefore owns the minimal contract-conforming facade closure that commits trusted effect receipts; ECP-7 still owns automatic observation and Session/worker execution.
- The real proof seam is Management save/detail, production preparation/profile/lowering, CLI `start`/`resume-run`/`complete`/`status`/`control`, the filesystem-backed canonical store across fresh processes, and Management/Operations consumption of the same `ChangeRunView` projector.
- Success, fresh-process resume, malformed receipt rejection, and required FanOut member failure are distinct acceptance journeys. Each must retain stable source/capability/plan digests and exact Run/Action identities and must never use a private reducer-only path as its completion evidence.
