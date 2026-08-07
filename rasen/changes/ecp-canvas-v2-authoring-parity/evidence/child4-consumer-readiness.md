# Child 4 consumer readiness

Status: **READY**

Child 4, `ecp-v2-authoring-loop-vertical-proof`, can consume the exact saved
loop-plus-parallel Canvas definition established by Child 3. This check did not
add another fixture, Definition model, serializer, lifecycle policy, prepared
execution view, or projector, and it did not claim the canonical Run proof that
belongs to Child 4.

## One shared authored Definition

The sole cross-boundary oracle is:

`packages/ui/test/fixtures/canvas-v2-authoring.ts`

It exports `CANVAS_V2_AUTHORING_DEFINITION`, a single
`WirePipelineDefinitionV2` containing:

- `bounded-loop`, whose body is `work-body`, with positive iteration/action/
  budget limits, a complete `bounded-loop-lifecycle/1` policy, all six
  mechanical dispositions, and the domain exit `done -> exit(done)`;
- `fan-out`, whose member is `atomic-stage`, with its hierarchical path,
  required status, condition, cap, budget, and `joinNodeId: join`; and
- its paired `join`, with the same input/member identity, exact required and
  optional partitions, and distinct proceed/failed outcomes.

The mounted Canvas journey imports that exact value through
`../fixtures/canvas-v2-authoring.js` in
`packages/ui/test/canvas/pipeline-canvas-page.test.tsx`. Starting from a real
blank Canvas, it uses visible controls to create the definition and declaration
contracts plus all eight root kinds. Its final Validate and Save assertions
compare the outbound request directly to `CANVAS_V2_AUTHORING_DEFINITION`, so
the fixture is the captured authored value rather than a server-side lookalike.

The root consumer imports the same symbol through
`../../../packages/ui/test/fixtures/canvas-v2-authoring.js` in
`test/core/management-api/pipelines-api.test.ts`. Child 4 can use this same
repository import instead of inventing a second vertical-proof definition.

## Real preparation, canonical persistence, and digest evidence

The root test
`round-trips the exact blank-Canvas all-eight request through Management, canonical bytes, portable export/import, and one intentional edit`
performs the following checks against the shared object:

1. The fixture's exact `rasen-apply-change` capability revision equals the
   production workflow catalog digest.
2. `EcpDefinitionModule.prepare(definition, canvasCatalog)` accepts the object
   with no diagnostics. This is the existing authoritative Definition
   preparation path.
3. `serializeAuthoredPipelineDefinition(prepared)` writes canonical LF bytes;
   preparing those bytes again produces identical source, capability, and plan
   digests.
4. The real Management API validates the same object with zero issues, saves
   it, and returns the same preparation digests. The stored `pipeline.yaml` is
   byte-equal to the canonical writer output.
5. Detail reload retains all eight root kinds and the same digests; a forced
   no-op save retains them again.
6. Native-path export/import retains canonical bytes, authored meaning, and
   preparation digests.
7. The intentional budget edit changes only source/plan meaning, retains the
   capability digest, and stabilizes on the next save/detail cycle.

Fresh narrow re-check on 2026-08-02:

- `pnpm --dir packages/ui exec vitest run test/canvas/pipeline-canvas-page.test.tsx -t "authors the shared all-eight v2 request from a real blank Canvas and submits it unchanged to validate and save" --reporter=dot`
  — **PASS**, 1 passed / 70 skipped.
- `pnpm exec vitest run test/core/management-api/pipelines-api.test.ts -t "round-trips the exact blank-Canvas all-eight request through Management, canonical bytes, portable export/import, and one intentional edit" --reporter=dot --maxWorkers=1 --minWorkers=1`
  — **PASS**, 1 passed / 49 skipped.

This proves that the saved Canvas object is already a legal input to the real
preparation and canonical persistence seams. Child 4 does not need to translate
or reconstruct it before exercising the compiler, reconciler, recovery,
failure-closure, CLI/API, and Operations paths.

## Dependency and scope handoff

Child 4's `planning-context.md` identifies DAG node `ecp6-004`, depends on
Child 3, states that it consumes all prior children, and requires reading the
parent and every prerequisite before proposal. Concretely, the three inputs are:

1. `ecp-shared-bounded-loop-lifecycle` — the shared lifecycle contract and
   mechanics used verbatim by the fixture;
2. `ecp-v2-default-authoring-and-builtins` — canonical blank-v2, capability,
   serializer, and prepared execution contracts; and
3. `ecp-canvas-v2-authoring-parity` — the saved shared definition and the
   authoring/preparation/persistence evidence above.

The following boundary remains deliberate:

- Child 3 proves authoring, preparation, canonical persistence, and digest
  stability.
- Child 4 owns the canonical Run proof for this same saved loop-plus-parallel
  definition, including compiler/reconciler, fresh-process recovery,
  failure-closed behavior, and cross-plane Operations consistency.
- Session execution and public effect observation are still ECP-7 work. Child
  4 must not introduce a private Session executor or claim that boundary as
  closed.

No readiness gap was found.
