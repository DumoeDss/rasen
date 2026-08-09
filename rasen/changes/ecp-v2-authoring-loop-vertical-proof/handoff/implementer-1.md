# Implementer 1 handoff

## Outcome

Sections 1–3 are implemented through the focused green boundary. Tasks 1.1–1.5, 2.1–2.7, and 3.1–3.11 are checked. Tasks 2.8 and 3.12 remain deliberately open because the complete named regression matrices were not rerun in this context. Sections 4–9 were not started.

No commit, push, ship, archive, machine/portfolio mutation, Session executor, worker, automatic observation, or private reducer test driver was added.

## Implemented product behavior

- The sole shared blank-Canvas fixture now contains one executable seven-connection typed route through CompositeRef/BoundedLoop, a two-outcome Choice, FanOut, the required AtomicStage, its paired Join, and Finish.
- Canvas derives real declaration artifact/outcome handles plus FanOut/Join control handles. The mounted journey edits the Choice through its visible node panel, connects every route edge through rendered handles, and sends a Validate/Save request deep-equal to the sole shared fixture.
- The required AtomicStage retains the authored root Gate as its only gate authority; no `execution.gate` field was introduced.
- Real prepare, canonical read/write, profile resolution, and lowering now prove the route dependencies, bounded-loop body, FanOut membership, paired Join, Gate, and Finish. FanOut member lowering was corrected to retain the effective authored Gate.
- `createChangePipelineRuntime.complete()` now dispatches decoded `effect-observation` and `infrastructure-observation` variants to their existing reducer stimuli. Before slot classification or mutation it verifies the canonical change binding, ActorRef identity, actor-attestation identity/binding, non-empty evidence refs, evidence identities, and exact Run/Action/effect bindings.
- Effect observations mutate only the addressed effect and return `advanced`; infrastructure observations retain their distinct classification, adapter artifact digest, evidence, recovery wait, and no domain result. The existing domain-result validation/reconcile/settle path is unchanged.
- Existing completion-slot classification provides identical replay reuse and conflicting-receipt rejection. Domain success remains fail-closed until required effects have been publicly observed.
- `PipelineCommand.complete` now has focused real bounded-file/upload-staging coverage for both observation variants.

## Main files changed in this tranche

- `packages/ui/test/fixtures/canvas-v2-authoring.ts`
- `packages/ui/src/canvas/layout.ts`
- `packages/ui/test/canvas/pipeline-canvas-page.test.tsx`
- `test/core/management-api/pipelines-api.test.ts`
- `src/core/change-run/internal/lowerer.ts`
- `src/core/change-run/internal/facade-runtime.ts`
- `test/core/change-run/facade-settle-completeness.test.ts`
- `test/core/change-run/cli-complete.test.ts`
- `rasen/changes/ecp-v2-authoring-loop-vertical-proof/evidence/implementation-baseline.md`
- `rasen/changes/ecp-v2-authoring-loop-vertical-proof/tasks.md`

## TDD and validation evidence

- RED: public facade rejected both decoded observation variants as non-domain completions.
- RED: mounted Canvas could not find declaration/control handles and the shared fixture had no root connections.
- RED during real lowering: Choice had fewer than two outcomes, then the FanOut member lost its authored Gate.
- GREEN: facade observation matrix, 5/5 (effect, infrastructure, replay/conflict immutability, effect-before-domain ordering, malformed/identity/authority failures).
- GREEN: CLI observation receipt/upload staging, 2/2.
- GREEN: mounted blank-Canvas all-eight journey, 1/1 (70 skipped by focus).
- GREEN: Management prepare/lower/canonical/save/detail/no-op/export/import/typed edit journey, 1/1 (49 skipped by focus).
- GREEN: root `pnpm exec tsc --noEmit`.
- GREEN: UI typecheck after handle/layout changes.
- Frozen `auto-decompose` blob hash remains `6f306544010a8950508f1223acfca5d62de407f5`; its diff is empty.

Canonical baseline and connected fixture digests are recorded in `evidence/implementation-baseline.md`.

## Exact continuation point

1. Run task 2.8's authored-v1, all-eight controls, connection-handle, paired FanOut/Join, lifecycle, and nested-diagnostic regressions; check 2.8 only if all are green.
2. Run task 3.12's reducer, completion, facade, complete CLI, ack-loss, uncertain-effect, evidence, and fault-journey suites; check 3.12 only if all are green.
3. Begin section 4 at the product boundary. Use the saved shared Definition and fresh public CLI processes; do not replace them with a second Definition, hand-built plan, direct reducer mutation, or an automated Session runner.
4. Sections 4–9, full root/UI gates, lint/build, fresh-process vertical journeys, cross-plane proof, independent review, and parent delivery remain outstanding.

## Risk notes

- Observation evidence refs are authority-checked at the facade; actual evidence bytes remain staged and verified by the existing CLI `HostEvidenceWriter` boundary. Do not duplicate that store in the facade.
- `receiptDigest` authenticates the variant payload, while ActorRef/evidence identities and bindings are checked independently before idempotency classification.
- Automatic Session execution and automatic effect capture remain ECP-7; the next vertical driver must stay a manual trusted-host test seam.
