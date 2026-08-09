# Change: Add typed provider prepare unavailability

## Why

The process-authority foundation can return `authority-unavailable` when exact provider selection fails, but an already selected provider's `prepare()` contract can only return a prepared authority or reject. Rejection becomes `control-loss`, while returning an invalid prepared sentinel only happens to become `authority-unavailable` after structural validation and is not a truthful typed contract.

Linux must report denied or unsupported namespace prerequisites as exact-provider unavailability without contacting another provider, executing workload code, or disguising the result as a crash. This is a platform-neutral foundation gap and must be closed before the Linux provider is integrated.

## What Changes

- Add a closed typed `ProviderPreparationUnavailable` result to the provider prepare contract.
- Snapshot and validate that result in the common coordinator before any reference is minted, preserving the exact selection and bounded diagnostic.
- Keep provider rejection, timeout, malformed values, and exceptions on their existing fail-closed paths.
- Extend the unchanged-role provider conformance harness and deterministic fixture to prove no workload start, publication, fallback, or reference is produced.
- Let a conformance fixture supply its real durable publisher so a platform provider can run the unchanged suite without hidden publication or a test-only production bypass.
- Rebaseline dependent Linux common-input hashes only after this Change ships and archives.

## Capabilities

### Modified Capabilities

- `process-authority-provider`: exact selected providers can report bounded preparation unavailability as a first-class typed outcome.

## Impact

- Affected product code: process-authority provider types and coordinator normalization.
- Affected tests: common provider conformance harness and deterministic fixture, including its publisher injection seam.
- No platform provider, native helper, manifest schema, reference schema, production default, macOS decision, or release claim changes.
