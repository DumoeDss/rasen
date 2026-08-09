## Context

Exact provider selection and platform prepare availability are different facts. A provider can be registered with an exact tuple and artifact while the current runtime still denies a required native operation. The existing API has no typed branch for that second fact.

## Goals / Non-Goals

**Goals:**

- Represent selected-provider prepare unavailability without exceptions or invalid sentinels.
- Preserve exact selection, bounded diagnostics, no-reference truth, reservation release, and no fallback.
- Keep exceptions and malformed provider values distinguishable from intentional unavailability.

**Non-Goals:**

- Add provider negotiation or fallback.
- Change post-reference retained outcomes.
- Modify any platform provider or native artifact in this Change.

## Decisions

### Add one closed prepare-only result

`ProcessAuthorityProvider.prepare()` returns `ProviderPreparationResult`, the union of `ProviderPreparedAuthority` and an exact `{ state: 'authority-unavailable', diagnostic }` object. The unavailable object carries no reference, activation capability, platform field, or alternate provider hint.

The coordinator captures it with exact-key, accessor-safe, diagnostic-bound validation after the bounded provider call settles and before it snapshots a prepared authority or encodes a reference. It releases its reserved reference slot and returns the existing public preparation-unavailable shape with the exact selected tuple.

Alternative: introduce a branded exception. Rejected because expected platform unavailability is a semantic result, while provider rejection and exception must remain `control-loss`.

Alternative: return an invalid prepared object. Rejected because it relies on validation failure, loses the provider diagnostic, and makes the type system lie.

### Extend the reusable conformance scenario

The shared harness gains a prepare-unavailable fixture scenario. It asserts the exact public result, zero workload starts, and no prepared/publication capability. The deterministic fixture returns the new typed branch only for that scenario. Existing rejection, timeout, late-result, and post-reference unavailable cases remain separate.

The fixture also supplies an exact `ProcessAuthorityPublisher`. The deterministic fixture uses the canonical acknowledgement helper, while a platform fixture can provide its production durable publisher. Every suite publication call uses that fixture seam. This preserves one unchanged assertion body without allowing activation to write publication state or forcing a platform production factory to accept a fake ledger.

Provider-neutral retained assertions compare the closed common state, exact reference retention, and a non-empty bounded diagnostic. They do not require a platform adapter to reproduce arbitrary deterministic fixture wording: a closed native diagnostic code may be safely projected to provider-owned text before the common coordinator receives it. Exact coordinator preservation of a provider-returned diagnostic remains covered by the focused foundation test.

Recovered inert-phase assertions construct the phase they claim: `prepared-inert` is inspected before publication, while `published-inert` is inspected only after the fixture publisher durably acknowledges the exact reference. The suite never deletes or rewrites publication truth to manufacture a prior phase.

Alternative: keep the suite's hard-coded acknowledgement callback. Rejected because it cannot commit a platform provider's required durable publication truth, so production activation must correctly refuse it.

Alternative: wrap a platform fixture to rewrite production diagnostics or add arbitrary native-text passthrough. Rejected because that would either stop testing the production adapter or unnecessarily expand the native protocol/log-injection surface.

Alternative: publish both inert recovery fixtures and ask the provider to report prepared for one. Rejected because authentic durable publication is monotonic; a real ledger must continue reporting published.

## Risks / Trade-offs

- Provider implementations now handle a result union. Exhaustive TypeScript narrowing makes this explicit.
- Existing conformance fixture factories add one publisher field; the deterministic helper centralizes the default.
- A malformed lookalike is still rejected by coordinator validation and cannot smuggle a reference or activation callable.

## Migration Plan

This is additive at the TypeScript source level and changes no persisted data. Dependent platform changes update their frozen common-suite digest only after the authoritative archive records the new accepted input.

## Open Questions

None.
