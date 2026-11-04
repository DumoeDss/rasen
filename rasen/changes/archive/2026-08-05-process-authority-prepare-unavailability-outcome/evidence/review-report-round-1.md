# Fresh non-author review report — round 1

## Verdict

**NOT CLEAN — 0 Blocker, 1 Major, 0 Minor, 0 Trivial.**

The intended unavailable result, rejection distinction, reference-reservation release, exact-provider selection, and shared publisher seam are present. One malformed-result classification gap can nevertheless turn an invalid unavailable lookalike into live authority.

## Findings

### MAJOR-1 — A hybrid malformed unavailable result is accepted as prepared authority

Locations:

- `src/core/session-host/process-authority/coordinator.ts:472-493`
- `src/core/session-host/process-authority/coordinator.ts:495-510`
- `src/core/session-host/process-authority/coordinator.ts:1050-1066`
- `test/core/session-host/process-authority-prepare-unavailable.test.ts:131-144`

The coordinator first attempts the exact unavailable snapshot. That snapshot correctly rejects extra keys. It then passes the same rejected object to `snapshotProviderPreparedAuthority()`, whose structural check accepts any object with a string `reference` and callable `activate` and does not reject `state: 'authority-unavailable'` or `diagnostic` fields.

Consequently, this provider result is rejected as an unavailable result but accepted as prepared authority:

```ts
{
  state: 'authority-unavailable',
  diagnostic: 'must fail closed',
  reference: validProviderReference,
  activate: async () => ({ state: 'live' }),
}
```

A read-only in-memory probe through the current registry/coordinator implementation produced:

```json
{
  "preparationState": "prepared-inert",
  "hasReference": true,
  "hasPublish": true,
  "activationsBeforePublish": 0,
  "publicationState": "published-inert",
  "activationState": "live",
  "activationsAfterActivate": 1
}
```

This violates the change contract that malformed unavailable lookalikes fail closed without a common reference, activation capability, publication, fallback, or workload start. It is also a trust-boundary regression: a buggy, JavaScript, or cast provider can smuggle authority-bearing fields through a result explicitly labeled unavailable.

The focused malformed mutations do not expose the gap. Their extra-field case supplies a string `reference` but no callable `activate`, so it fails both snapshots. The assertions also check only the generic result state and absence of a reference; they do not require the invalid-preparation diagnostic or prove that activation stayed unreachable.

Required remediation:

1. Make result classification closed. Once a value declares or otherwise matches the unavailable discriminant, failure of the exact unavailable snapshot must terminate as invalid preparation; it must not fall through to prepared-authority capture. An equivalent closed prepared-result shape is acceptable if it preserves existing prepared-provider compatibility.
2. Add a hybrid mutation containing a valid provider reference and callable `activate`. Assert the generic invalid-preparation outcome, no common reference or publish function, zero activation/workload starts, and no fallback probe.
3. Retain accessor-safe handling and the diagnostic bound while implementing the closed classification.

## Other contract checks

- Exact typed unavailable output is snapshotted before reference encoding, returns the selected descriptor and provider diagnostic, releases its reservation, does not probe fallback providers, and exposes no reference.
- Provider rejection remains a `control-loss` outcome for phase `prepare`; it is not collapsed into typed unavailability.
- The repeated-unavailability test exercises reservation release through the tombstone bound before a later successful preparation.
- Every exact shared-suite publication now calls `fixture.publisher`. The identity-mismatch wrapper still delegates to that seam before corrupting the digest, and timeout behavior remains exercised through the seam.
- The new union and public exports are consistent, and TypeScript accepts the scoped changes.
- No Linux provider file was inspected or tested as part of this review.

## Verification

- `pnpm exec vitest run test/core/session-host/process-authority-prepare-unavailable.test.ts test/core/session-host/process-authority-conformance.test.ts --maxWorkers=1 --minWorkers=1 --reporter=verbose`: PASS (`2` files, `48/48` tests).
- `pnpm exec tsc --noEmit`: PASS.
- `pnpm exec rasen validate process-authority-prepare-unavailability-outcome --strict`: PASS.
- Path-scoped `git diff --check`: PASS; Git emitted only the repository's LF-to-CRLF working-copy warnings.
- Direct malformed-hybrid registry/coordinator probe: reproduced the Major with a minted reference, publish capability, and one successful activation.

## Scope and completion

Review scope was limited to the Change artifacts, the three shared process-authority files, the two shared test helpers, and the focused unavailable test named in the dispatch. This review made no product, test, spec, task, run-state, or Linux-provider changes.

`DONE`: round-1 review completed with one Major finding.
