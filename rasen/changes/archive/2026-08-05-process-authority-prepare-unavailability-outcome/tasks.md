## 1. Baseline and RED contract

- [x] 1.1 Record the foundation revision, current provider prepare type, coordinator mapping, and dependent Linux blocker without normalizing unrelated worktree state.
- [x] 1.2 Add RED tests for a selected provider returning exact typed prepare unavailability with its diagnostic, zero workload starts, no reference/publication capability, and no alternate provider dispatch.
- [x] 1.3 Add RED mutations for provider rejection and malformed unavailable lookalikes so neither is accepted as the typed semantic result.

## 2. Typed common implementation

- [x] 2.1 Add and export the closed `ProviderPreparationUnavailable` and `ProviderPreparationResult` types.
- [x] 2.2 Snapshot the unavailable result accessor-safely and within existing diagnostic bounds before prepared-authority capture and reference encoding.
- [x] 2.3 Return the existing public preparation-unavailable shape with exact selection and provider diagnostic while releasing the reserved reference slot.
- [x] 2.4 Preserve timeout, rejection/exception, invalid prepared value, reference collision, bounded settlement, and no-fallback behavior.

## 3. Shared conformance and verification

- [x] 3.1 Extend the provider-neutral conformance fixture and deterministic provider with one prepare-unavailable scenario without weakening existing mutation cases.
- [x] 3.2 Add a fixture-supplied exact publisher and route every shared-suite publication through it so durable providers use their real publisher with no activation-side publish.
- [x] 3.3 Keep retained conformance provider-neutral by asserting exact state/reference, bounded diagnostic, and no release without requiring deterministic diagnostic wording or a platform wrapper.
- [x] 3.4 Make recovered inert fixtures phase-exact: inspect prepared before publication and inspect published only after the real fixture publisher commits.
- [x] 3.5 Run focused RED/GREEN tests, complete process-authority tests, TypeScript no-emit, build, lint/diff checks, and strict Change validation.
- [x] 3.6 Run a fresh independent code/spec/security review and resolve every Blocker/Major.

## 4. Local lifecycle and Linux resume

- [x] 4.1 Ship a path-scoped local commit with no push, child PR, platform code, or unrelated retained file.
- [ ] 4.2 Archive through the authoritative engine, sync the delta spec, and record transaction/accounting evidence.
- [ ] 4.3 Rebaseline the Linux provider's frozen common spec/suite hashes and resume its provider integration only from the archived common contract.
