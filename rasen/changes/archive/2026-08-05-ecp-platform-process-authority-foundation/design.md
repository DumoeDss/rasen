## Context

The current Session host already exposes an opaque `ProcessScope`/`ProcessRef` seam and a native ProcessCapsule helper. Its first implementation correctly separated preparation from activation and introduced root-exit versus scope-empty receipts, but independent review disproved its shared POSIX process-group authority: a workload can leave that group, so numeric PID/PGID observations cannot establish recursive containment, exact empty, or exact kill. The same review also showed why lifecycle and transport failures need one vocabulary across every platform rather than adapter-specific interpretations.

The Direction replan splits the fault domain into this common foundation, separate Linux and Windows providers, a decision-deferred macOS provider, and later integration in `ecp-native-process-capsule-closure`. This Change must therefore create a deep common module that is complete and reviewable with deterministic evidence while containing no operating-system authority. It must preserve the cumulative ProcessScope work and its open findings as history, not retrofit the old PGID implementation behind a new name.

The foundation runs in TypeScript/Node.js 20.19+ and must remain platform-neutral. Paths and package identities use `node:path` and exact constant-driven lookup. Its contract sits below Session policy and above future native providers; it is not a Run, completion, signer, or release-support boundary.

## Goals / Non-Goals

**Goals:**

- Freeze one `ProcessAuthorityProvider` contract with exact provider/capability/protocol identity and no platform-native control fields at its public seam.
- Enforce a bounded `prepare -> publish -> activate` state machine and bounded inspect, terminate, and abort operations.
- Make exact-scope-empty the only successful authority-release fact and preserve the opaque reference for every unavailable, uncertain, drifted, gapped, timed-out, or control-lost result after authority creation.
- Reject protocol, capability, provider, manifest, envelope-version, integrity, and rollback mismatches before dispatch or activation.
- Supply one deterministic conformance/mutation harness that each later platform provider can consume unchanged in addition to its actual-OS tests.
- Add an additive migration seam from `ProcessScope` without selecting, wrapping, or registering an operating-system provider in this Change.

**Non-Goals:**

- Linux user/PID namespaces, guardians, cgroup v2, broker installation or authentication.
- Windows Job creation, assignment, breakaway policy, handle ownership, or runtime oracles.
- Any macOS Endpoint Security, VM, minimum-version, entitlement, signing, notarization, installer, unsupported-platform, or support decision.
- Fixing the current ProcessCapsule review findings, changing its native protocol/manifest, or claiming that the old POSIX process group satisfies the new contract.
- Frozen Action admission/execution, trusted producer keys, EvidenceStore publication, canonical Run/Record mutation, Session policy/control parity, self-hosting, or ECP-8 release work.

## Decisions

### 1. Separate the common authority contract from `ProcessScope` compatibility

Create a common module under `src/core/session-host/process-authority/` whose exported surface is intentionally smaller than any native adapter:

```ts
interface ProcessAuthorityProvider {
  readonly descriptor: ProcessAuthorityProviderDescriptor;
  prepare(input: AuthorityPrepareInput, context: AuthorityOperationContext): Promise<ProviderPreparedAuthority>;
  inspect(reference: ProviderAuthorityReference, context: AuthorityOperationContext): Promise<ProviderObservation>;
  terminate(reference: ProviderAuthorityReference, intent: AuthorityTerminationIntent, context: AuthorityOperationContext): Promise<ProviderControlOutcome>;
  abort(reference: ProviderAuthorityReference, reason: string, context: AuthorityOperationContext): Promise<ProviderControlOutcome>;
}
```

The common lifecycle coordinator, not each provider, owns registration, selection, state transitions, deadlines, single settlement, envelope parsing, and late-result suppression. A provider owns only exact native authority and returns the common result vocabulary. Provider inputs never include PID, PGID, Job, broker, handle, namespace, or platform-native identity supplied by Session code.

Add `createProviderBackedProcessScope(...)` as an opt-in compatibility adapter. It maps common outcomes to the existing opaque `ProcessScope` shape without exposing provider details, but this Change does not install it as the Management/Session default and does not register the existing native capsule as a provider. Later platform Changes implement providers; the resumed closure Change performs production wiring and deletes or hard-disables the old PGID path.

Alternative considered: extend `ProcessScope` independently in every platform adapter. Rejected because provider selection, mismatch handling, deadlines, and terminal truth would drift. Alternative considered: immediately wrap the current ProcessCapsule. Rejected because that would falsely make the disproven POSIX authority conformant.

### 2. Use explicit exact provider selection and a closed registry

Preparation takes an explicit immutable selection containing `providerId`, `capabilityId`, and `protocolVersion`. The registry is constructed from a finite list, validates every descriptor once, rejects duplicate tuple or provider identities, and performs exact map lookup. It never pattern-matches a platform, tries providers in order, or falls back after an unavailable or uncertain result.

The initial required capability is a named, versioned recursive-scope contract whose descriptor commits to all of these inseparable semantics: workload non-escape, publish-before-activate, exact root-exit distinction, exact natural empty, exact recursive terminate/abort, replacement reopen/retention, bounded controls, exact identity drift, and event-completeness reporting. Providers may publish additional capabilities under separate identifiers, but a caller cannot negotiate a subset that omits one of these properties and still call it the recursive-scope capability.

The production registry is empty in this Change. The deterministic provider exists only in test/support code and is passed explicitly. Linux, Windows, and future macOS Changes add exact descriptors and actual authority; one provider cannot satisfy another provider's runtime receipt.

Every non-empty registry is constructed with the exact closed provider manifest and package root. The public coordinator accepts only such a registry; it has no raw-provider construction path. The deterministic fixture uses a test-only manifest factory but exercises the same operational registry gate as future platform providers.

Operational selection does not call a public virtual method. Registry construction installs a module-private provenance brand only after descriptor/manifest validation, and the coordinator uses a captured base implementation that accepts only an exact base instance. Subclasses, proxies, structural lookalikes, and public selector overrides therefore fail before provider dispatch.

Alternative considered: select by `process.platform` and use the first registered provider. Rejected because registration order becomes hidden policy and can silently activate a weaker adapter. Alternative considered: capability intersection. Rejected because it creates a lowest-common-denominator escape hatch.

### 3. Make the authority reference an opaque, versioned, self-describing envelope

The branded public value has the lexical form `rasen-process-authority/1:<base64url>` and is opaque to Session/backend callers. Only the internal codec may decode its canonical closed-schema body:

```text
schemaVersion
providerId
capabilityId
protocolVersion
providerReferenceVersion
providerReferenceBytes
integrityAlgorithm
integrityDigest
```

Provider reference bytes contain all native authority material and are never exposed as public fields. The common integrity digest detects truncation, accidental mutation, and non-canonical re-encoding; the provider remains responsible for exact native identity and any authentication required by its threat model. This Change does not claim an unkeyed digest authenticates a same-user attacker and does not add signer custody.

The complete durable reference is classified as a sensitive replayable control capability. Diagnostic/API/UI projections use only a redacted schema/provider tuple plus a one-way digest of the complete reference; the public view never contains the reference itself or reversible provider-owned bytes.

The codec accepts only the one known schema and exact field set, bounds every string and byte field, canonicalizes before digest verification, and rejects duplicate/unknown fields. Unknown future versions and malformed/tampered bytes are returned as typed non-dispatchable facts while the original string is preserved byte-for-byte for later recovery. No parser exports native payloads to public API/View/registry projection code.

Alternative considered: store provider identity beside an opaque blob in multiple registry fields. Rejected because the tuple can drift across writes. Alternative considered: make PID/PGID/Job fields common. Rejected because it leaks control mechanisms upward and makes a weak cross-platform denominator part of the contract.

### 4. Represent publication as a real runtime state between prepare and activate

The common coordinator exposes three runtime-checked capabilities:

```text
PREPARING
  -> PREPARED_INERT
       -> PUBLISHING -> PUBLISHED_INERT
            -> ACTIVATING -> LIVE
       -> ABORTING -> EXACT_SCOPE_EMPTY | RETAINED_FAILURE
  -> AUTHORITY_UNAVAILABLE                 (no workload and no live ref)

LIVE
  -> ROOT_EXITED                          (authority retained)
  -> TERMINATING -> EXACT_SCOPE_EMPTY | RETAINED_FAILURE
  -> RETAINED_FAILURE
```

`prepare` may create an inert authority and returns the common envelope. `publish` receives the trusted durable-writer callback and runs that callback itself under the common publish operation id, monotonic deadline, and `AbortSignal`; only its exact acknowledgment permits `published-inert`. Publication does not mean execution. Only the resulting `PublishedProcessAuthority.activate()` method exists at the type seam; runtime guards also reject a forged or duplicated activation attempt. `publish`, `activate`, and `abort` are exactly once.

Invoking the durable-writer callback consumes the publication capability even when its acknowledgement is missing or mismatched, because the write may already have committed. That path enters retained `publication-uncertain`, forbids another publisher callback, and leaves only bounded abort or exact-reference reconciliation.

The ProcessScope adapter acquires and structurally validates its runtime transport bridge while authority is still `published-inert`. A bridge-open failure therefore uses bounded published abort before workload activation. If activation itself times out or loses control after bridge acquisition, the adapter performs one bounded exact-reference termination/reconciliation and retains authority unless that control returns an authentic exact-empty receipt.

The publication acknowledgment is host-lifecycle metadata only: an exact digest/version token sufficient to bind the prepared reference to the durable write. It contains no Action, Run, signer, completion, prompt, result, or platform-native control material. The foundation tests the ordering and token binding but does not implement the durable Session registry transaction itself.

Alternative considered: retain `PreparedProcessScope.activate()` and rely on call ordering. Rejected because the existing early-activation mutation proved ordering must be enforceable. Alternative considered: let providers write the Session registry. Rejected because that would mix native authority with host persistence and create a second Run/state owner.

### 5. Use one exhaustive observation and control-result vocabulary

All common results are discriminated unions and include the exact reference once one exists. The non-terminal positive observations are `prepared-inert`, `published-inert`, `live`, and `root-exited`. The sole clean terminal fact is `exact-scope-empty`.

Retained failure reasons are distinct and never normalized into one another:

- `authority-unavailable`: the exact provider or underlying authority cannot currently be opened or supplied;
- `authority-uncertain`: exact live/empty/control truth cannot be established for a reason not represented more narrowly;
- `identity-drift`: the reopened native identity differs from the reference, so control is forbidden;
- `event-gap`: an event-backed provider cannot prove a complete observation interval;
- `timeout`: the bounded phase did not settle in time and may have taken effect;
- `control-loss`: the provider/control channel was lost before exact completion.

`root-exited` carries the backend status but remains controllable/retained until exact-scope-empty. `inspect`, `terminate`, and `abort` may return `exact-scope-empty` only from provider evidence satisfying the selected capability. Identity drift and event gap are not aliases for closed or foreign. Duplicate outcomes are accepted only when byte/semantic-identical to the already recorded terminal receipt; conflicting or late outcomes become diagnostic evidence and cannot mutate state.

Root-exit status is a closed non-empty union: the code or signal may individually be null, but never both. A null/null value is statusless and fails closed as control loss.

Recovery observations preserve `prepared-inert` and `published-inert` as distinct common facts. They remain retained and eligible for exact-reference termination/reconciliation; compatibility projection may expose them as legacy prepared/controllable state but cannot turn either into live, closed, or control loss. Every `root-exited` observation or control outcome carries the exact `code` and `signal` fields; statusless provider values fail closed.

Alternative considered: keep `closed | foreign | uncertain`. Rejected because it erases whether recovery is unavailable, unsafe due to identity drift, incomplete due to an event gap, or ambiguous after a timeout. Those distinctions determine whether any signal or retry is safe.

### 6. Enforce bounded calls in the coordinator and retain authority after ambiguity

Every provider call receives an `AbortSignal`, operation id, monotonic deadline, and phase. The coordinator races the provider result against that deadline, clears each timer once, records one outcome, and ignores/quarantines later resolution. Timeout and cancellation do not imply that the provider operation did not occur.

If `prepare` fails before a reference is minted, no workload may run and the caller receives `authority-unavailable` or a typed prepare failure. Once a reference exists, every unavailable, uncertain, identity-drift, event-gap, timeout, or control-loss outcome returns that exact reference and leaves it eligible only for later inspect/terminate reconciliation. The compatibility adapter never releases Session ownership, writer capacity, or durable process facts from those outcomes.

The coordinator uses injected monotonic time/deadline dependencies for deterministic tests. Provider Changes still must prove their native actions settle or become safely typed on actual systems; the common timeout wrapper cannot manufacture native closure.

The coordinator compares monotonic time again at settlement, so a delayed scheduler callback cannot admit a result delivered on or after the recorded deadline. Selection, prepare input, termination intent, and abort reason are validated against closed bounds, copied, and frozen once; the same immutable snapshot supplies both operation identity and provider dispatch. Hostile accessors and malformed runtime values become typed no-dispatch failures.

Both fulfillment and rejection pass through that same monotonic settlement guard. Provider preparation results are likewise read once into a closed immutable reference/activation snapshot; diagnostic fingerprinting treats the provider value as opaque and cannot trigger its accessors.

Provider references are one-use lifecycle generations. A coordinator retains active and retired reference identities in a fixed-size tombstone ledger, rejects any collision before publication or activation, and refuses all further preparation when the ledger is full rather than evicting a tombstone and permitting replay. Providers must mint a fresh exact-generation reference for every preparation.

Local preparation atomically reserves ledger capacity before provider dispatch and releases the reservation only when no reference is minted. Valid recovered references enter the same ledger before their first observation/control dispatch, so a recovered exact-empty receipt cannot be replayed after local generation reuse and concurrent calls cannot exceed the 1,024-generation bound.

Alternative considered: kill the provider/controller after timeout and assume closure. Rejected because a lost acknowledgment cannot distinguish not-started from completed-but-unobserved, and provider death is not necessarily scope death.

### 7. Bind runtime dispatch to a closed manifest and reject rollback

Define a platform-neutral provider manifest schema with an explicit constant list of allowed keys and bounded values. Each artifact/provider entry binds the same provider id, capability id, protocol version, provider-reference version, and common contract version advertised by the runtime descriptor. Registry construction or resolution fails before preparation when the manifest and runtime descriptor differ, contain unknown fields, omit a required capability, or attempt to roll back a persisted reference to an older protocol.

Recovery dispatches from the envelope's exact tuple. If the installed registry lacks that tuple, the operation returns retained `authority-unavailable`; it never substitutes a different provider or protocol. An older runtime encountering a future envelope preserves the original bytes and refuses inspect/terminate rather than rewriting it as legacy v1. A newer runtime may host explicit migration adapters, but migrations must be named exact version-to-version transforms and cannot strengthen PID/PGID facts.

This foundation specifies and tests the common descriptor/manifest validator but does not revise the current ProcessCapsule manifest. Each platform provider Change declares its entry; the closure Change performs the atomic private protocol/manifest integration.

Alternative considered: semver-compatible ranges. Rejected because lifecycle and terminal semantics are security-critical; exact protocol identity is required. Alternative considered: use manifest hash alone. Rejected because two self-consistent but semantically different provider artifacts could otherwise dispatch.

### 8. Ship a provider-neutral conformance and mutation harness

Create a reusable suite factory in `test/helpers/process-authority-provider-conformance.ts`. A provider supplies a fixture factory implementing a named setup/control contract; the suite body and expected common outcomes remain unchanged. The foundation runs it against a deterministic provider with an injected clock and explicit mutation modes. Later provider Changes import the same suite factory and add actual-OS fixtures plus provider-specific escape, owner-death, recovery, natural-empty, recursive-kill, and unavailable oracles.

The common harness covers at least: inert prepare, publish-before-activate, exact tuple dispatch, root-exit retention, natural exact empty, terminate/abort exactness, unknown/tampered reference, provider/capability/protocol mismatch, manifest mismatch/rollback, unavailable/uncertain retention, identity drift, event gap, phase timeout, control loss, duplicate/late outcomes, and adapter authority loss. Mutation tests must first demonstrate a false positive or invariant violation, then go green only through production contract behavior rather than private call counts.

Prepared and published abort each have a positive authentic exact-empty assertion in addition to retained negative cases. A named broken-abort mutation must make the unchanged measured snapshot RED, preventing an abort-incapable platform fixture from claiming the indivisible recursive-abort semantic.

No injected branch, deterministic provider, cross-target compile, or Windows-host run is labelled Linux/macOS runtime acceptance. The common Change closes locally from contract evidence only.

Alternative considered: copy test cases into every platform Change. Rejected because drift would let one provider weaken the common assertions. Alternative considered: mock private provider calls. Rejected because that would test implementation choreography rather than the public authority seam.

## Risks / Trade-offs

- **[Risk] The common contract becomes too weak for a future platform.** -> The recursive-scope capability is indivisible and versioned, provider payloads remain opaque, and new stronger capabilities get new ids rather than weakening existing requirements.
- **[Risk] The common timeout wrapper is mistaken for native safety.** -> Timeout always retains authority; provider Changes still require real escape/death/empty/kill/unavailable receipts on their actual OS.
- **[Risk] A self-describing envelope is mistaken for cryptographic authorization.** -> The design states the common digest is corruption detection only; exact native identity and broker authentication remain provider responsibilities, while signer/Run authority is excluded.
- **[Risk] Additive compatibility leaves two seams temporarily present.** -> Production wiring remains unchanged in this Change; named later migrations and closure integration remove/hard-disable the old POSIX path only after providers are terminal.
- **[Risk] A future runtime cannot inspect a newer reference.** -> Unknown bytes are retained exactly and dispatch returns unavailable; no destructive action or optimistic closure occurs.
- **[Risk] macOS deferral is read as implicit unsupported support.** -> No macOS provider, descriptor, acceptance, minimum version, packaging, or support claim is added; closure and ECP-8 remain decision-gated.

## Migration Plan

1. Add the common types, codec, registry, coordinator, descriptor/manifest validator, compatibility adapter, and deterministic conformance harness with no production provider registered.
2. Keep existing `rasen-process-scope/1` registry values and the current ProcessCapsule default path byte-identical in behavior. The foundation may recognize them only as legacy opaque values and must not translate them into the new capability.
3. In separate Changes, implement Linux and Windows providers against the frozen descriptor and unchanged conformance harness, and run their actual-OS gates. Add macOS only after an explicit Direction decision.
4. After all three provider Changes are terminal, resume `ecp-native-process-capsule-closure`: atomically wire provider-backed ProcessScope, update the private helper protocol/manifest, remove or hard-disable PGID fallback, migrate only exact known versions, and close the retained review/security findings.
5. Rollback before production wiring is file-level removal of the additive common module. After provider wiring, rollback must preserve every new envelope byte-for-byte and fail closed under an older runtime; it may not downgrade or infer authority from PID/PGID data.

## Open Questions

- Which macOS authority, minimum-version, installation, entitlement/signing, and support contract will be approved? This remains a future Direction decision and has no default answer here.
- Which exact Linux broker packaging/installation policy will be approved when unprivileged namespaces are unavailable? The Linux provider Change owns that decision without changing the common lifecycle contract.
- Which release manifest aggregates separately shipped provider descriptors? ECP-8 owns final package/release truth after provider and closure delivery; this Change freezes only the validator contract.
