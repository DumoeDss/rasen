## Why

ECP-6 has independently closed Definition v2 defaults, bounded-loop lifecycle semantics, and Canvas authoring parity, but it has not yet proven that one definition created from a blank Canvas can survive the complete product path and drive a recoverable canonical Run. The final merge-node proof is needed now because a valid disconnected fixture and unit-level reducer evidence can both look complete while bypassing the executable graph, public completion boundary, durable store, or Operations projection users actually depend on.

## What Changes

- Extend the single shared blank-Canvas fixture and its mounted visible-control journey with executable typed connections for its `BoundedLoop` and paired `FanOut`/`Join`; the exact Management-saved object remains the only Definition oracle used by preparation, lowering, runtime, and projection tests.
- Drive that saved Definition through authoritative preparation, canonical serialization and stable source/capability/plan digests, immutable lowering, the public CLI/facade, and the real filesystem-backed canonical Run store.
- Close the existing public completion inconsistency: the versioned completion wire contract and CLI already admit trusted `effect-observation` receipts, so the runtime facade will commit those receipts through the canonical reducer instead of rejecting them. This is a manual trusted-host completion seam, not an agent Session executor.
- Prove a successful Run with stable Definition/plan digests, `RunId`/`ActionId`, effect/evidence receipts, state transitions, terminal outcome, and one consistent `ChangeRunView` across CLI status, Management Run detail, and Operations.
- Prove fresh-process recovery by stopping at a committed boundary and continuing through new CLI processes that reload the plan and Record from disk without a second model or in-memory shortcut.
- Prove fail-closed behavior for malformed completion/effect receipts and a required parallel-member failure, including no false success, no silent optionalization, and consistent failure projection.
- Keep automated agent dispatch, Session lifecycle, automatic effect observation, worker reuse/handoff/usage accounting, and ECP self-hosting in ECP-7. Child delivery remains local; ship/archive and CI are delegated to the parent portfolio.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `ecp-change-run-runtime`: A Canvas-authored connected v2 Custom Composite can be launched and completed as one real filesystem-backed canonical Run; the public trusted completion seam accepts its already-declared effect-observation receipts, fresh processes recover it deterministically, required parallel failures close safely, and every product plane consumes the same canonical projection.

## Impact

- **Shared authoring oracle:** `packages/ui/test/fixtures/canvas-v2-authoring.ts` and the mounted Canvas journey gain only the executable wiring produced by real controls; no second Definition fixture or serializer is introduced.
- **Canonical execution:** the completion facade, existing reducer stimulus, immutable plan/store wiring, and focused runtime/CLI tests are exercised and minimally repaired where the public contract currently disagrees with the facade.
- **Cross-plane evidence:** CLI subprocess journeys, Management pipeline save/detail and Run detail endpoints, and Operations tests assert the same Definition/plan digests, Run identifiers, transitions, sections, and terminal meaning.
- **Verification:** positive, fresh-process, malformed-receipt, and required-member-failure journeys run with focused UI/root tests plus full root/UI typecheck, lint, build, strict Change validation, independent review, and parent PR CI.
