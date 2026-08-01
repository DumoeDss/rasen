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
