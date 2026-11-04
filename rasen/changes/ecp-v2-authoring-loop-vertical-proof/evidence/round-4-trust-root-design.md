# Round 4 trust-root and publication-recovery design

Status: implementation recommendation for ECP-6 Child 4. This document does not claim that the implementation or its tests already exist.

## Outcome

Round 3 found two independent release blockers:

1. Completion authenticity is derived entirely from public `ActionView` metadata and caller-computable hashes. A caller can therefore create matching actor, evidence, and receipt values without a trusted producer.
2. `FilesystemEvidenceStore` can permanently reject a valid object after a crash between `linkSync(staging, target)` and `unlinkSync(staging)`, because the surviving canonical object has `nlink === 2`.

The minimal portable Round 4 design is:

- freeze an Ed25519 public verification authority from the exact trusted execution Adapter into the capability binding, execution profile, sealed plan, and Action;
- require authenticated EvidenceRef v2 objects for every new executable completion;
- make the actor-attestation object contain a canonical completion claim covering the actor, complete Action binding, all three completion variants, and the exact non-attestation evidence digests;
- verify the entire submission before `HostEvidenceWriter` publishes any object, then re-read and verify it again in the Facade before slot classification or Record mutation;
- recover only the one provable `target + staging companion` hard-link topology produced by the EvidenceStore publication protocol.

If implemented with the RED cases and gates below, this design removes the Round 3 completion-authenticity Blocker and EvidenceStore crash-recovery Major. Until those tests pass, both findings remain open.

## Evidence and constraints

The current repository has hashing and random-ID utilities but no signature, key, credential-provider, verifier-provider, or pinned verifier-Adapter implementation. The existing runtime-adapter table routes capabilities; it is not an authenticity verifier. Reusing the existing public Adapter/evidence digests as if they were secrets would preserve the exploit.

The governing ECP contracts require one of two sources of authority:

- a plan-bound trusted producer attestation; or
- a fresh query to an exact verifier Adapter frozen by the plan.

They also require actor identity, evidence provenance, Action/Run/tree/effect binding, and verification before Record mutation. They do not authorize caller-authored actor fields, logs, paths, or hashes as proof.

The following threat model is in scope:

- the caller can read the complete public `ActionView`, including the public key and expected producer metadata;
- the caller can submit arbitrary completion values, bytes, EvidenceRefs, signatures, receipts, paths, and repeated/replayed requests;
- the caller does not possess the private key and cannot invoke or replace the trusted producer/verifier;
- the caller may try key substitution, public-key path injection, content/ref tampering, result substitution, cross-Run/cross-Action/cross-effect replay, or crash/retry races;
- a hostile process with write access to the trusted host installation or private-key provider is outside this boundary. Such compromise is an installation/host compromise, not a completion-caller capability.

## Design twice

### Design A — plan-bound canonical Ed25519 attestation

The exact trusted execution Adapter has an Ed25519 authority descriptor. Its public half is frozen into the execution profile and every Action derived from that profile. The trusted producer signs canonical bytes. Any fresh CLI process can verify using only the public Action and stored evidence.

Advantages:

- portable Node built-in primitive; no new dependency or daemon;
- deterministic, offline verification in the current kernel;
- shallow operational seam: one host-owned producer interface and one pure verifier;
- old Actions remain independently verifiable after a process restart or key rotation;
- fits the existing immutable profile/plan/Action direction.

Costs:

- the trusted execution host must own a private-key provider;
- canonical byte and key-rotation rules must become versioned contracts;
- possession of a producer key attests the producer, not by itself the truth of an external effect. The trusted Adapter still has to observe that effect.

### Design B — fresh query to a frozen verifier Adapter

The execution profile freezes a verifier binding such as:

```ts
interface FrozenVerifierAdapterBinding {
  readonly format: 'change-run-verifier-adapter/1';
  readonly id: string;
  readonly version: string;
  readonly artifactDigest: Digest;
  readonly protocol: 'local-ipc/1';
  readonly endpointId: string;
}
```

For every stage and Facade commit, the kernel resolves that exact artifact, verifies the artifact digest, sends the canonical completion claim and bytes over the pinned protocol, and accepts only a fresh verdict bound to a request nonce and Action.

Advantages:

- private verification state may remain entirely outside the CLI process;
- suitable for future external-effect observers, HSMs, or remote policy systems.

Costs:

- the repository has no artifact-pinned verifier process, IPC protocol, nonce lifecycle, availability policy, or trusted endpoint resolver;
- an endpoint path from project data, an environment variable, or a CLI argument would create a path-injection/key-substitution authority;
- it adds a second live runtime and new crash/timeout/retry semantics before ECP-7 owns a Session executor;
- a public-only verifier that merely compares the current metadata would not fix the issue.

### Decision

Choose Design A for Round 4. It has the deeper boundary: completion authentication is a pure function of canonical bytes and the immutable public authority in the Action. Design B remains a compatible future Adapter implementation, but is not the minimum trustworthy repair in the current codebase.

## Trust-root ownership and freezing

The authored pipeline Definition and project workspace must not be able to nominate a key. The current capability catalog lacks a trust-authority field, so the minimum canonical addition is a separate host-owned catalog rather than an authorable manifest property:

```ts
interface TrustedExecutionAdapterDescriptor {
  readonly format: 'trusted-execution-adapter/1';
  readonly adapter: {
    readonly id: string;
    readonly version: string;
    readonly contentDigest: Digest;
  };
  readonly attestationAuthority: AttestationAuthority;
}

interface AttestationAuthority {
  readonly format: 'change-run-attestation-authority/1';
  readonly algorithm: 'ed25519';
  readonly keyId: string;
  readonly keyVersion: string;
  readonly publicKey: {
    readonly format: 'spki-der';
    readonly encoding: 'base64';
    readonly value: string;
    readonly digest: Digest;
  };
}
```

`publicKey.digest` is SHA-256 of the decoded DER bytes. Import must use `createPublicKey({ key: der, format: 'der', type: 'spki' })`, export back to SPKI DER, require byte-for-byte canonical equality, and recompute the digest. This rejects alternate encodings and malformed/key-type substitution. `keyId` identifies the producer key family; `keyVersion` identifies an immutable key instance. Neither is authority without the frozen SPKI bytes.

`RuntimeCapabilityBinding.adapter` gains a required `attestationAuthority` for newly prepared executable capabilities:

```ts
interface RuntimeAdapterArtifactBinding {
  readonly id: string;
  readonly version: string;
  readonly contentDigest: Digest;
  readonly attestationAuthority: AttestationAuthority;
}
```

The authority is resolved only by matching the exact `{id, version, contentDigest}` against `TrustedExecutionAdapterDescriptor`. Missing or ambiguous matches fail preparation/launch closed. It is included transitively in:

- the normalized capability binding;
- `capabilityProfileDigest`;
- execution-profile digest;
- sealed-plan digest;
- `CompletionAuthority` in each new Action;
- Action digest and the projected public `ActionView`.

Synthetic evaluator/control capabilities need their own exact trusted Adapter descriptor. They must not fall back to a generic public metadata identity.

This host-owned catalog is a narrow extension of the existing Adapter-artifact binding, not a second execution runtime. Project Definitions may select a capability already admitted by policy; they cannot supply or override its authority.

## Private producer boundary

Private signing material is represented only by a host-internal interface. It is never a schema field:

```ts
interface TrustedCompletionProducer {
  readonly adapter: {
    readonly id: string;
    readonly version: string;
    readonly contentDigest: Digest;
  };
  readonly authority: AttestationAuthority;

  attestCompletion(
    input: TrustedCompletionInput,
  ): Promise<AttestedCompletionSubmission>;
}
```

The interface is deliberately completion-shaped, rather than exposing `sign(arbitraryBytes)`. The implementation holds a Node `KeyObject` or invokes a host credential provider. It must prove that its Adapter and authority exactly match the frozen Action before constructing evidence.

The private key must never appear in:

- Definition, profile, plan, Action, ActionView, Record, EvidenceRef, or evidence content;
- CLI options, request JSON, environment-variable values, logs, diagnostics, snapshots, or handoff artifacts;
- project-local files or the EvidenceStore.

Public-key data may appear in the Action and Record because fresh public-only verification is required.

### Real 0.2 product producer

Test-only dependency injection is not a complete 0.2 product. The production landing path is:

1. trusted Adapter installation/host bootstrap registers `TrustedExecutionAdapterDescriptor` in the host-owned catalog;
2. the same Adapter host supplies a matching `TrustedCompletionProducer` to the Session/worker boundary;
3. planning freezes only the public descriptor;
4. the trusted Adapter observes work, constructs the canonical claim, and returns signed public artifacts;
5. kernel/CLI processes verify them without receiving the private provider.

ECP-6 may exercise this with a manual trusted test host. ECP-7 must wire the interface into the actual Session/worker/effect-observer Adapter before 0.2 ECP is product-complete. If no matching producer is available, the Action is not self-authorized; execution returns a typed `attestation_signer_unavailable` suspension/failure. It must never generate a replacement key, accept an unsigned completion, or silently query the current catalog.

The kernel must not invent a project-file private-key store. If deployment later needs durable local keys, that is a separate protected credential-provider Adapter with an explicit threat model.

### Temporary-project vertical proof without a Session executor

The ECP-6 subprocess proof uses the same product seams without building ECP-7:

1. create an isolated temporary project and isolated host-state root;
2. the trusted test host generates one Ed25519 key pair with `generateKeyPairSync('ed25519')`;
3. before Run launch, provision only the public `TrustedExecutionAdapterDescriptor` into the isolated host-owned catalog through an internal host provisioning helper, not a project command or completion payload;
4. keep the private `KeyObject` in the test-host process for the whole journey;
5. run the built CLI to start/status and read the public Action;
6. the test host constructs and signs the submission, then sends only the signed completion and public evidence bytes to a fresh CLI process;
7. the fresh CLI loads the already-frozen public authority and verifies with no signer and no Session executor.

The host-state root in this proof is application/test bootstrap state. A completion caller cannot replace its contents through the pipeline-complete transport. Provisioning a different authority after the Action exists has no effect on that Action.

## Canonical authenticated evidence

### Backward-compatible schema

Keep the current EvidenceRef as `LegacyEvidenceRefV1` for decoding and diagnostics. Add an explicit authenticated form:

```ts
interface AttestedEvidenceRefV2 {
  readonly format: 'change-run-evidence-ref/2';
  readonly evidenceDigest: Digest;
  readonly contentDigest: Digest;
  readonly mediaType: string;
  readonly sizeBytes: number;
  readonly observationKind: string;
  readonly producer: EvidenceProducer;
  readonly binding: EvidenceBinding;
  readonly proof: {
    readonly format: 'change-run-evidence-proof/1';
    readonly authorityDigest: Digest;
    readonly signature: string; // canonical base64
  };
}
```

`EvidenceRefSchema` becomes a v1/v2 union. A new Action whose `CompletionAuthority` contains `attestationAuthority` requires v2 for the actor attestation and every completion evidence slot. A legacy Action with no frozen authority, a v1 ref, or a missing proof fails executable completion closed with a typed migration error. Historical Records remain readable; they do not acquire authority retroactively.

The filesystem object envelope becomes:

```ts
interface EvidenceObjectEnvelopeV2 {
  readonly format: 'change-run-evidence-object/2';
  readonly ref: AttestedEvidenceRefV2;
  readonly contentBase64: string;
}
```

No key, path, verifier endpoint, or mutable catalog reference is present.

### Canonical evidence-envelope signature

Let `authorityDigest` be:

```text
SHA-256(
  UTF8("rasen/change-run-attestation-authority/1\0") ||
  canonicalJson(attestationAuthority)
)
```

For every evidence object, construct the unsigned envelope identity:

```ts
interface UnsignedEvidenceIdentityV2 {
  readonly format: 'change-run-unsigned-evidence/2';
  readonly authorityDigest: Digest;
  readonly contentDigest: Digest;
  readonly mediaType: string;
  readonly sizeBytes: number;
  readonly observationKind: string;
  readonly producer: EvidenceProducer;
  readonly binding: EvidenceBinding;
}
```

`binding` contains the complete immutable planning and execution identity already required by the governing spec: PlanningSpace, ChangeInstance, project, Change, Run, Action, Effect when applicable, expected tree digest, and schema binding. Omission or `undefined` is not normalized into equivalence; the versioned schema determines the exact present fields.

The signature message is:

```text
UTF8("rasen/change-run-evidence-proof/1\0") ||
canonicalJson(unsignedEvidenceIdentity)
```

The producer calls Node `crypto.sign(null, message, privateKey)`. Verification calls `crypto.verify(null, message, actionPublicKey, signature)`. The signature must be canonical base64 and the Ed25519 signature must be exactly 64 bytes.

After adding `proof`, compute:

```text
evidenceDigest = SHA-256(
  UTF8("rasen/change-run-evidence-ref/2\0") ||
  canonicalJson({ unsignedEvidenceIdentity, proof })
)
```

The verifier also hashes the actual content bytes, compares `contentDigest` and `sizeBytes`, verifies exact required producer/observation/schema/media/binding values from the Action, and rejects an authority descriptor supplied by the submission. The only verification key is the Action's frozen key.

### Canonical actor-attestation claim

An authenticated evidence envelope alone would still allow a caller to reuse real evidence while changing `result`, `observation`, or `error` and recomputing an unkeyed receipt. The actor-attestation content therefore is the canonical JSON bytes of:

```ts
interface CompletionClaimV1 {
  readonly format: 'change-run-completion-claim/1';
  readonly authorityDigest: Digest;
  readonly binding: {
    readonly planningSpaceId: string;
    readonly changeInstanceId: string;
    readonly projectId: string;
    readonly changeId: string;
    readonly runId: string;
    readonly actionId: string;
    readonly expectedTreeDigest: Digest;
  };
  readonly actor: ActorRef;
  readonly completion:
    | {
        readonly kind: 'domain_action_result';
        readonly status: string;
        readonly result: unknown;
        readonly evidence: { readonly domainActionResult: Digest };
      }
    | {
        readonly kind: 'effect_observation';
        readonly effectId: string;
        readonly status: string;
        readonly observation: unknown;
        readonly evidence: { readonly effectObservation: Digest };
      }
    | {
        readonly kind: 'infrastructure_observation';
        readonly status: 'infrastructure_failed';
        readonly error: unknown;
        readonly evidence: { readonly infrastructureObservation: Digest };
      };
}
```

The `evidence` field is a fixed, labeled map, not an order-insensitive caller array. It contains the finalized v2 `evidenceDigest` of each non-attestation evidence slot. The actor-attestation EvidenceRef is deliberately excluded to avoid a digest cycle.

Construction order is fixed:

1. canonicalize and sign the non-attestation evidence refs;
2. construct the exact variant claim using their finalized digests;
3. use `canonicalJson(claim)` as actor-attestation content;
4. construct and sign the actor-attestation EvidenceRef envelope;
5. compute the existing variant-specific completion receipt over the complete payload, actor, actor-attestation ref, and other evidence refs.

The actor-attestation evidence proof signs an envelope whose `contentDigest` commits to the entire claim. The claim commits to the exact semantic completion and all other evidence. The receipt then commits to all finalized refs and signatures. There is no cycle and no caller-recomputable gap.

The verifier reconstructs the claim from the decoded completion and frozen Action, canonicalizes it, and requires exact bytes in the actor-attestation object. Semantically equivalent but differently encoded JSON is not accepted as the attestation content.

### Replay and idempotency

- Changing Run, Action, tree, effect, actor, producer, schema, content, variant, status, result, observation, or error invalidates either an evidence proof or actor claim.
- A signature from another key remains invalid even if the caller substitutes that key and recomputes `authorityDigest`, because the verifier uses the Action authority and requires its digest.
- Cross-Run and cross-Action replay fails before slot classification.
- Replaying the exact same signed request to the same slot retains the current idempotent semantics because its receipt digest is identical.
- A different signed request for an occupied slot retains the current deterministic slot-conflict semantics.
- Receipt equality alone is not authority. Receipt verification occurs only after public-key verification and canonical-claim verification.

## Verification and publication flow

The following order is mandatory:

1. Strictly decode completion and upload bodies.
2. Load Record and exact Action; do not rebuild trust from the current catalog.
3. Derive all expected producer, schema, binding, tree, effect, and authority values from that Action.
4. Decode every upload in memory; recompute content/ref/authority digests and verify all Ed25519 signatures.
5. Reconstruct and byte-compare the actor completion claim.
6. Verify the variant-specific receipt.
7. Only after the complete set passes, publish objects through `FilesystemEvidenceStore`.
8. Enter the Facade. Re-read every referenced object from the store and repeat steps 3–6.
9. Only then classify the completion slot and mutate/commit the Record.

This gives the required negative invariant: exact public metadata plus self-consistent caller bytes, refs, and receipt but no valid private-key proof changes neither EvidenceStore nor Record.

Validation is all-or-nothing before publication. A request with one valid and one invalid upload must publish none. A host crash during later publication may leave a valid unreferenced content-addressed object, but can never make an unauthenticated object authoritative or mutate the Record.

The current CLI path that directly calls `store.stageClaimed` must be replaced by the host writer. There must be no public bypass from transport to raw store publication.

## Module and interface changes

The recommended module seams are:

- `src/core/pipeline-registry/trusted-execution-adapters.ts`
  - owns `TrustedExecutionAdapterDescriptor` decoding and exact artifact lookup;
  - takes host bootstrap input, never pipeline/project author input;
  - returns only public authority to planning/profile resolution.
- `src/core/pipeline-registry/execution-plan-internal.ts`
  - extends the Adapter binding and includes authority in normalized capability/profile/plan digests.
- `src/core/pipeline-registry/profile-resolver.ts`
  - requires an exact trusted descriptor for every executable and synthetic Adapter;
  - fails closed on missing/ambiguous/mismatched authority.
- `src/core/change-run/contracts.ts`
  - adds `AttestationAuthority`, EvidenceRef v2/proof, evidence object v2, and the additive `CompletionAuthority.attestationAuthority` field;
  - preserves legacy decoders but marks legacy authority non-executable.
- `src/core/change-run/internal/attestation.ts`
  - single deep module for canonical authority digest, EvidenceRef v2 preimage/digest, completion claim construction, strict SPKI/base64 parsing, and public verification;
  - exports no private-key API.
- `src/core/change-run/internal/trusted-completion-producer.ts`
  - host-only interface and Node Ed25519 implementation used by trusted Adapter/test host;
  - not imported by the Facade or CLI verification path.
- `src/core/change-run/internal/actions.ts`
  - copies the exact profile authority into new completion authority/Action.
- `src/core/change-run/internal/completion.ts`
  - keeps variant-specific receipt domains and includes finalized v2 refs as today;
  - exposes claim construction through the attestation module rather than duplicating it.
- `src/core/change-run/internal/host-evidence-writer.ts`
  - accepts `{record, action, completion, uploads}`;
  - validates the entire set, then publishes it;
  - is the only complete-transport writer seam.
- `src/core/change-run/internal/facade-runtime.ts`
  - re-reads and calls the same verifier before slot classification/Record mutation.
- `src/core/change-run/internal/runtime-context.ts`
  - wires the public verifier and host writer; never wires a signer into public CLI completion handling.
- `src/commands/pipeline.ts`
  - removes direct staging from `stageTransportUploads` and delegates to the host writer;
  - accepts signed public envelopes but no key/provider/path options.
- `src/core/change-run/internal/evidence-store-fs.ts`
  - stores canonical envelope v2 and implements the strict publication-recovery protocol below.

The attestation module is a high-leverage boundary: producer construction and both host/facade verification use one canonical implementation. Tests may independently construct malicious bytes, but production code must not duplicate preimage logic across CLI and Facade.

## Key rotation and migration

Rotation creates a new immutable `keyVersion`, SPKI, public-key digest, authority digest, capability-profile digest, execution-profile digest, and sealed-plan digest. It affects new Runs only.

Existing Runs and Actions:

- always verify against their stored public authority;
- never consult the current catalog to substitute a newer key;
- may continue producing completions only while the matching old private provider remains available;
- return typed `attestation_signer_unavailable` if that provider is unavailable;
- can always verify already signed stored evidence using the frozen public key.

This design does not define revocation of already frozen keys. Emergency revocation, expiry, threshold signatures, and PKI are later policy work and must not be approximated by silently changing an Action.

Legacy profile/plan/Action decoding remains available for status, audit, and migration diagnostics. Legacy executable completion fails closed. No migration routine manufactures signatures or upgrades an existing public-hash completion.

## EvidenceStore post-link crash recovery

### Canonical namespace

For evidence digest hex `D`:

```text
final:    D.json
staging:  .D.evidence-publish-v1.<32-byte-lowercase-hex-token>.staging
```

The token is generated by the store and is never supplied by the caller. Both names reside directly in the already validated EvidenceStore objects directory. The final name remains content-addressed and stable. A strict staging name is a publication companion, never evidence authority.

### Normal publication

1. Validate the root, objects-directory anchor, and every path component using the existing no-link/no-junction/reparse rules.
2. Encode one canonical `EvidenceObjectEnvelopeV2` byte sequence.
3. Create the strict staging path with exclusive create, regular-file mode, and `nlink === 1`.
4. Write the complete envelope, `fsync` the file, close it, and revalidate anchor/file identity.
5. Hard-link staging to final using no-replace semantics.
6. Verify final and staging are regular files with the same stable `{dev, ino}`, exact same canonical envelope bytes, and `nlink === 2`.
7. `fsync` the objects directory so creation of the final link is durable on platforms that support directory sync.
8. Unlink staging.
9. `fsync` the objects directory again so companion removal is durable.
10. Revalidate final identity, envelope, and `nlink === 1`; return the ref.

The file is synchronized before the first directory entry is published. Directory-entry transitions are synchronized on POSIX. On Windows, the implementation must use the strongest supported closed-file/same-volume link/unlink semantics and test the real platform behavior; it must not claim power-loss guarantees that Node/Windows cannot provide. Unsupported directory `fsync` errors need an explicit platform policy, not silent swallowing of arbitrary I/O errors.

### Provable companion recovery

On entry, on `EEXIST`, or after an `ENOENT` while unlinking a companion, inspect the final path before using the normal `nlink === 1` reader.

If final has `nlink === 2`, recovery may unlink exactly one companion only when all conditions hold at the same validated anchor:

1. final is a regular, non-link file at exact `D.json`;
2. exactly one directory entry matches the strict staging grammar for the same `D`;
3. the candidate is a regular, non-link file;
4. final and candidate have the same stable `{dev, ino}` before and after reading;
5. both report exactly `nlink === 2`;
6. both yield the exact same canonical envelope bytes;
7. the envelope strictly decodes, its ref digest is `D`, and its content/ref hashes match the requested value;
8. objects-directory and root anchor identity remain stable throughout;
9. the two known entries account for both links. There is no third link because `nlink === 2`.

Only then unlink that strict companion, `fsync` the objects directory, and revalidate that final has the same identity, exact envelope, and `nlink === 1`.

Fail closed without deleting anything when:

- final has `nlink > 2`;
- final has `nlink === 2` but no strict companion or more than one candidate;
- a same-name candidate has a different inode, link count, envelope, or anchor;
- an external hard link, symlink, junction/reparse point, unexpected file type, or identity race is observed;
- the final envelope is not exactly canonical for `D`.

This rule deletes only a store-owned publication companion proven by name, location, inode topology, and contents. It never searches outside the anchored objects directory and never deletes an arbitrary external link.

### Retry and concurrency behavior

- Crash before link: no final object is visible. The abandoned `nlink === 1` staging object is not promoted and is not deleted by an unrelated attempt. A later maintenance policy may safely collect pre-publish orphans; that is not required for commit correctness.
- Crash after link and before unlink: same-process or fresh-process retry proves the two-link topology, removes only the companion, and returns the canonical final object.
- Crash after unlink: final is already canonical `nlink === 1`; retry is ordinary idempotent success.
- Concurrent `EEXIST`: the loser removes only its own in-memory attempt staging path after proving that path still has the identity it created. It then validates/recovers the winner's final object.
- If one process recovers a companion while the original publisher resumes, the original may observe `ENOENT`; it succeeds only after proving the same final object is canonical `nlink === 1`.
- A losing writer must never unlink a strict staging path merely because its name shares `D`.

### Fault-injection seam

Add an optional internal test fault injector to `FilesystemEvidenceStore`, with no CLI or public config surface:

```ts
type EvidencePublicationFaultPoint =
  | 'stage.after-staging-file-fsync.before-link'
  | 'stage.after-link-directory-fsync.before-staging-unlink'
  | 'stage.after-staging-unlink-directory-fsync.before-return';

type EvidencePublicationFaultInjector = (
  point: EvidencePublicationFaultPoint,
) => void;
```

The required Round 3 fault is the second point. Tests must simulate an abrupt stop without executing normal `finally` cleanup, otherwise they do not reproduce the crash topology.

## TDD plan

Use one RED → GREEN → refactor slice at a time. Tests assert public or pre-agreed seams: sealed profile/Action, HostEvidenceWriter, Facade, built CLI, EvidenceStore stage/read, and the vertical subprocess journey. They must not assert private helper call counts.

### RED 1 — trust root is frozen

- exact Adapter authority changes capability-profile, profile, sealed-plan, and Action digests;
- project/authored Definition authority fields are rejected or ignored and cannot override the host catalog;
- missing, duplicate, mismatched artifact, malformed SPKI, non-Ed25519 key, or digest mismatch fails closed;
- ActionView exposes only the public descriptor;
- a legacy Action decodes for status but cannot accept completion.

### RED 2 — forged public metadata is inert

- copy exact ActionView actor/authority/producer metadata, invent self-consistent bytes/refs/receipt without a signature, and assert HostEvidenceWriter rejection;
- assert EvidenceStore inventory and Record bytes/digest are unchanged;
- repeat with a caller-generated key plus substituted public key/key id/version;
- repeat with one valid and one invalid upload to prove validation precedes all publication.

### RED 3 — canonical proof and all variants

- valid domain-action-result, effect-observation, and infrastructure-observation submissions pass;
- wrong key, malformed/canonical-base64 violation, bit-flipped signature, changed content, changed ref metadata, changed producer/schema/media/tree/effect, and changed actor fail;
- sign a valid claim, then alter each variant's `status` and `result`/`observation`/`error` and recompute the receipt; each fails;
- actor-attestation content that parses to the same object but is not the exact canonical bytes fails;
- a valid signature created for Run A/Action A cannot complete Run B/Action B or another effect;
- exact signed replay remains idempotent; a conflicting signed receipt remains a slot conflict.

### RED 4 — fresh public-only CLI proof and rotation

- temporary host provisions public authority before launch and retains the private `KeyObject` only in the test process;
- a fresh built CLI process accepts a valid signed submission without signer or Session executor access;
- the same process rejects the exact-metadata/no-proof exploit and leaves store/Record unchanged;
- rotate authority: old Action verifies only old signatures, new Run freezes the new authority/digests, and no current-catalog substitution occurs;
- unavailable old signer returns the typed unavailable result rather than an unsigned fallback.

### RED 5 — publication crash recovery

- inject failure after link-directory-fsync and before staging unlink; assert one final plus one strict companion, same inode/envelope, `nlink === 2`;
- retry in the same process and a fresh process; assert success, only companion removed, final `nlink === 1`;
- inject before link; assert no final visibility;
- inject after unlink; assert retry is idempotent;
- exercise concurrent same-ref writers and `EEXIST`; assert one canonical final and no deletion of another attempt's unproven staging file;
- create an external second hard link with no strict companion and assert fail closed/no deletion;
- exercise `nlink > 2`, two candidates, same-name/different-inode, same-inode/wrong-envelope, symlink, junction/reparse, and anchor-swap cases; all fail closed;
- force file/directory sync errors at each boundary and assert the documented visibility/retry state;
- rerun the matrix on supported Windows and POSIX CI workers.

## Verification gates

Focused gates before full validation:

```text
test/core/change-run/attestation.test.ts
test/core/change-run/facade-settle-completeness.test.ts
test/core/change-run/evidence-store-fs.test.ts
test/core/change-run/cli-complete.test.ts
test/core/change-run/canvas-v2-vertical-proof.test.ts
test/core/pipeline-registry/execution-binding.test.ts
test/core/pipeline-registry/profile-resolver.test.ts
```

Then run the repository-required typecheck, build, lint, strict Change validation, complete root test suite, UI typecheck/tests, built-CLI vertical proof, and auto-decompose hash/integrity gates. Finally inspect `git diff --check` and confirm the negative no-proof journey leaves both EvidenceStore and Record byte-for-byte unchanged.

## Risks and non-goals

Risks to carry explicitly:

- canonical JSON or schema drift can invalidate signatures; all preimages are versioned and need stable golden vectors;
- loss of an old private provider can suspend unfinished old Actions even though verification remains possible;
- platform directory durability differs; tests and claims must match actual supported semantics;
- compromise of the trusted Adapter/private provider defeats producer authenticity and needs separate installation security controls;
- a trusted producer can sign a false statement. For effects, trust depends on the Adapter actually observing the effect, which is an ECP-7 execution responsibility.

Round 4 does not add:

- an automatic Session executor, worker scheduler, or effect-observation engine;
- a network verifier, daemon, HSM, PKI, certificate chain, revocation service, or threshold signatures;
- project-authored keys, CLI key flags, filesystem private-key generation, or trust-on-first-use;
- retrospective authority for legacy unsigned Actions/Records;
- generic staging-orphan garbage collection outside the proven post-link companion case.

## ECP-7 boundary and landing criterion

ECP-6 owns the immutable public trust root, canonical signed submission, public-only verification, safe EvidenceStore publication, and a manual trusted-host vertical proof. ECP-7 owns the real Session/worker Adapter that observes work/effects and invokes `TrustedCompletionProducer` without exposing private material to the caller.

The ECP-6 Child 4 change may close its Round 3 findings after the listed implementation and tests pass. The overall 0.2 ECP must not be called product-complete until ECP-7 demonstrates that a real trusted Adapter—not only a test helper—produces these attestations through the product execution path.
