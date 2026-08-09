# Broker prepared-delivery recovery remediation plan

Date: 2026-08-06\
Mode: read-only design analysis; no source, test, task, or run-state edits\
Input finding: `BRK-R2-B02` from native broker review round 3\
Recommendation: **make preparation operation identity the durable delivery index, protect recovery
with a separate controller-held delivery capability, and retire provisional recovery only after an
explicit durable-controller acknowledgement**

## Problem frame

The product already has the right semantic identity in several places:

- TypeScript sends controller-known `AuthorityOperationContext.operationId` as
  `preparationOperationId`.
- Rust `PrepareRequest.operation_id`, the exact guardian attestation, and `BrokerLease` preserve
  that value.
- The lease also binds caller uid, broker install/key identity, launch digest, guardian identity,
  cgroup identity, lease token, and request capability.

The missing **Seam** is prepared-reference delivery. A broker-client process currently invents a
random `request_id`; request/recovery lookup is keyed by that transient value. The daemon completes
the request record and removes provisional recovery before writing the response socket. A new
client process has the controller-known preparation operation id but not the old random request id,
so a committed lease can become unreachable.

This must be fixed without weakening the existing authentication or turning the preparation
operation id into a bearer secret:

- `request_id` remains useful as one connection/attempt correlation value, but it is not durable
  authority and is never the only delivery lookup.
- `preparationOperationId` is stable identity, not secret authorization. It may appear in trusted
  diagnostics and must not by itself disclose the lease token or request capability.
- The broker's authenticated peer uid, installed broker identity, exact prepare digest, and a
  separate sensitive delivery capability authenticate recovery.
- Once a reference has been delivered, all ordinary control continues to require the existing
  lease token plus request capability. No new weaker control route is introduced.
- The original absolute monotonic prepare deadline governs whether authority may be committed.
  A later recovery call may retrieve a result committed before that deadline, but may not extend
  the original mutation window or cause a new guardian/lease to be created.

## Design it twice

### Design A — make the existing request id stable and controller-supplied

Derive `request_id` from a controller-persisted random value or from an HMAC over
`preparationOperationId + prepareDigest`, then pass it into every replacement broker-client
process. Existing `.request` records become cross-process discoverable.

**Depth:** medium. It reuses current request replay with a small **Interface**, but conflates
transport correlation, idempotency, delivery authorization, and lifecycle ownership in 16 bytes.

**Locality:** superficially good, but every retry must reproduce the original absolute deadline and
request digest because `replay_digest` currently includes both the request id and deadline. A
recovery-only read either conflicts with the old digest or must pretend to be the original mutating
request.

**Failure semantics:** fragile. Returning/logging the stable id risks turning a transport field
into an accidental capability. Pruning a completed request record can again destroy the only
delivery path while the lease remains active. Request-id collision handling also lacks the richer
operation/launch identity needed for safe reconciliation. This is rejected as the durable model;
random request ids remain attempt-local.

### Design B — index delivery directly by caller uid plus preparation operation id

Add `RecoverPreparation { preparation_operation_id }`. The broker scans or indexes leases and
recovery records by `(caller_uid, preparation_operation_id)` and returns the matching prepared
reference after normal socket peer/challenge authentication.

**Depth:** high for the common case: the controller already knows the operation id, and a new
client can recover without an old request id.

**Locality:** good if one delivery record owns the index. It is poor if recovery scans independent
request, recovery, and lease stores and reconstructs state on every call.

**Failure semantics:** insufficient by itself. Operation ids are unique identifiers, not secrets.
A same-uid workload or unrelated process that learns an id must not receive the lease token and
request capability. Exact duplicate operation ids with different launch input must fail closed,
not select an arbitrary lease. This design is retained as the identity index but needs a separate
recovery authenticator and exact prepare binding.

### Design C — server-derived stable recovery key plus explicit delivery capability and ACK
(recommended)

Define one deep prepared-delivery **Module**. Its stable record key is server-derived:

```text
deliveryKey = SHA-256(
  "rasen-broker-prepared-delivery-v1\0" ||
  brokerInstallId || brokerKeyId || callerUid ||
  preparationOperationId || canonicalPrepareDigest
)
```

This is a collision-resistant index, not authorization. The closed record stores and revalidates
all preimage fields, so an injected hash collision is an identity conflict rather than an alias.
Raw operation ids are not used in filenames or routine diagnostics.

Before dispatch, the controller creates a fresh 256-bit `deliveryRecoveryCapability`, persists it
with the exact operation id and prepare digest in its trusted Linux state root, and sends it only in
the framed prepare payload. The broker stores a domain-separated hash of that capability. Recovery
requires:

1. the authenticated broker install/key challenge;
2. exact peer uid equality;
3. exact preparation operation id and canonical prepare digest;
4. the matching delivery capability; and
5. the new recovery call's own absolute deadline for bounded observation.

After recovery returns the exact prepared reference, ordinary acknowledgement and every later
control use the reference's existing lease token plus request capability. Thus the delivery
capability cannot activate, inspect, signal, or terminate authority.

**Depth:** high. Callers learn three operations—prepare, recover prepared delivery, acknowledge
durable delivery—while the module hides request attempts, daemon/client loss, record phases,
collision checks, replay, and cleanup.

**Locality:** high. One delivery record is the authoritative join between request attempt,
provisional recovery, and lease. Request records may be pruned without making an active lease
unreachable.

**Failure semantics:** exact. A lost response leaves `PreparedPendingAck`; a replacement client
uses a different random request id but recovers the byte-identical response. Only an ACK proving
that the controller durably stored that exact reference can retire provisional recovery. This is
the recommended design.

## Public and internal seams

The frozen `ProcessAuthorityProvider` interface does not change.

The Linux bundle gains a narrow recovery **Interface** used by the session/controller recovery
owner:

```ts
interface LinuxBrokerPreparationDeliveryRecovery {
  recover(
    preparationOperationId: string,
    input: AuthorityPrepareInput,
    context: AuthorityOperationContext
  ): Promise<ProviderPreparationResult>;
  reconcileOrphans(context: AuthorityOperationContext): Promise<void>;
}
```

Production `provider.prepare` uses the same module internally. `recover` is not exported as an
unbound raw transport; it can read only records under the exact production state root. A recovered
result still passes the same private-reference decoder, artifact identity, operation id, launch
digest, broker install/key, and publication-ledger checks as a first response.

The native transport adds closed methods:

```ts
prepareDelivery(binding, request, context)
recoverPreparedDelivery(binding, context)
acknowledgePreparedDelivery(reference, binding, context)
abortPreparedDelivery(binding, reason, context)
```

The Rust broker subprotocol adds distinct operations:

- `Prepare` carrying a versioned `PreparationDeliveryBinding` around the existing
  `BrokerPreparePayload`;
- `RecoverPreparation`, which is observational and carries the stable identity plus delivery
  capability but no lease token;
- `AcknowledgePreparation`, which carries the exact reference digest and uses the recovered
  reference's lease token/request capability;
- recovery/abort reconciliation reuses the existing exact guardian/cgroup path and never creates
  another lease.

The internal broker protocol/record version must be bumped or add an explicitly versioned delivery
codec. The manifest-bound provider tuple and common provider protocol remain version 1; helper and
installed broker must still fail closed if their internal delivery protocol versions differ.

## Durable controller record

Add a provider-owned `LinuxBrokerPreparationDeliveryLedger` beneath a new exact production child
directory, sibling to the publication ledger. Its record is sensitive, atomic, fsynced, bounded,
and inaccessible in the workload mount view. The controller commits it before spawning a broker
client:

```text
schema/version
provider tuple + broker expected artifact identity
preparationOperationId
canonical prepare digest + launch digest
deliveryRecoveryCapability (sensitive, never logged)
original controller deadline identity
phase: Intent | ReferenceStored | Acknowledged | Reconciled
optional exact broker private reference + reference digest
integrity digest
```

`ReferenceStored` is committed only after the native response is fully decoded and revalidated.
Only then does the controller invoke `AcknowledgePreparation`. If ACK or its response is lost, a
replacement reads the same local reference and repeats ACK idempotently. If the record contains
only `Intent`, replacement invokes `RecoverPreparation`. A conflicting operation id/prepare digest
is retained as control loss and never starts a second prepare.

The current coordinator defaults to an in-memory random operation id. Cross-controller-process
replay therefore requires the session/controller owner to persist the selected operation id before
calling prepare and to reuse it on replacement. The existing `ProcessAuthorityCoordinatorOptions`
operation-id seam can supply that identity, but a production claim must not rely on its current
ephemeral default. Either the session host provides its durable operation journal, or the Linux
bundle's orphan reconciliation aborts every undelivered entry before accepting a logically new
operation. This is an integration precondition, not permission to change the frozen provider
interface.

## Broker delivery record and state machine

Add one root-owned `BrokerPreparationDeliveryRecord` keyed by `deliveryKey`:

```text
identity:
  deliveryKey, callerUid, preparationOperationId, prepareDigest,
  launchDigest, brokerInstallId, brokerKeyId, capabilityHash,
  originalDeadlineMonotonicNs
state:
  Intent
  Preparing(recoveryId)
  PreparedPendingAck(recoveryId, leaseToken, exactResponseBody, referenceDigest)
  Delivered(leaseToken, referenceDigest)
  Reconciled(terminal disposition)
```

Every transition uses one delivery-key transaction lock plus the existing lease-token lock once a
lease exists. Lock ordering is fixed: delivery key first, token second. Same operation/key plus
same exact binding is idempotent; same operation id with different prepare digest, caller uid,
install/key identity, launch digest, or capability is `identity-drift` and performs no mutation.

Sequence:

1. Controller durably writes `Intent` and spawns a client with a random attempt `request_id`.
2. After peer/challenge authentication the daemon derives the stable key and durably creates
   delivery `Intent` before guardian/cgroup work. `BrokerRecoveryRecord` binds the same delivery key
   and preparation operation id in addition to its current identities.
3. Prepare runs under the original absolute monotonic deadline. Before each irreversible phase and
   before lease commit, the server rechecks that same deadline.
4. Once guardian, leaf, lease, and exact response are durable, the server atomically transitions
   delivery to `PreparedPendingAck`. Provisional recovery remains. Completing a random request
   record does not retire either one.
5. Socket response is best effort. Loss leaves an exact, discoverable pending delivery.
6. Any replacement client presents operation identity, prepare digest, and delivery capability.
   With a fresh challenge, random attempt id, and recovery-call deadline, the daemon returns the
   stored byte-identical response. It does not rerun prepare or extend the original deadline.
7. Controller validates and durably writes `ReferenceStored`, then sends ACK using the exact lease
   token/request capability and reference digest.
8. ACK verifies the pending response, marks `Delivered`, and only then retires provisional
   recovery. Duplicate ACK is idempotent. The controller records `Acknowledged` after response;
   lost ACK responses are resolved by repeat ACK.
9. A `Delivered` tombstone remains while its non-terminal lease exists, preventing operation-id
   reuse. It may drop the response body only because the trusted controller ledger now owns the
   exact reference. It is removed only with authenticated terminal lease cleanup.

## Deadline and client-loss semantics

- The mutating prepare has one original absolute `CLOCK_MONOTONIC` deadline. Replacement clients
  cannot submit `now + another prepare budget` for the same delivery.
- A response committed before the original deadline may be observed after it. Recovery is a read
  with its own bounded call deadline; it cannot create a guardian, leaf, lease, token, or phase
  transition other than delivery ACK/reconciliation.
- If the original deadline expires before `PreparedPendingAck`, the daemon invokes exact
  recovery abort and stores `Reconciled(Timeout)`; later recovery returns the retained disposition,
  never a prepared reference.
- If client death is observed before a prepared commit, the daemon may continue only until the
  original deadline. It must end in the same prepared-pending or exact-reconciled state; client
  death itself is not proof that no authority exists.
- Request-record deadline and digest remain attempt-level replay guards. They are not consulted as
  the only prepared-delivery index.
- A pending/delivered active delivery is never evicted to make capacity. Capacity exhaustion
  refuses a new prepare before authority construction. Only reconciled terminal entries and safely
  redundant completed attempt records are prunable.

## Security and non-disclosure invariants

- Raw random `request_id` is neither returned to TypeScript nor stored in the controller delivery
  ledger. It may differ on every replacement attempt without affecting recovery.
- File names and routine diagnostics use `deliveryKey` or a redacted digest, never raw operation
  id, delivery capability, lease token, request capability, full reference, launch environment, or
  response body.
- Knowing `preparationOperationId` or a leaked attempt request id is insufficient to recover a
  reference. Recovery also requires exact authenticated peer uid, broker identity, prepare digest,
  and delivery capability.
- The delivery capability is domain-separated from scope/control capability and broker request
  capability. It authorizes only `RecoverPreparation`; it cannot satisfy any lease control.
- After recovery, ACK and all lifecycle mutation use the existing lease token/request capability
  and token lock. No operation-id-only activation path exists.
- Hash collision injection must compare the closed record preimage and return identity drift; it
  must not return either colliding response.

## RED oracles

1. **Different request id, same delivery:** prepare reaches `PreparedPendingAck`; discard the socket
   and first client. A new client with a new random request id plus the same durable operation
   binding receives the byte-identical reference.
2. **Production process loss:** kill the broker-client after daemon response commit but before
   stdout delivery. Start a new client process from the controller ledger and recover/ACK.
3. **Controller replacement:** persist `Intent`, kill controller/client, reopen the trusted ledger
   in a fresh process, recover the reference, persist `ReferenceStored`, and ACK.
4. **ACK loss:** kill after broker accepts ACK but before its response. Replacement repeats ACK;
   exactly one lease remains and provisional recovery is retired only once.
5. **No premature retirement:** after completing the random request record but before ACK, assert
   the exact recovery and `PreparedPendingAck` delivery still exist.
6. **Attempt record pruning:** delete/prune the completed random request record, then recover from
   the stable delivery record. The same lease/reference remains reachable.
7. **Binding conflicts:** same uid/operation id with a different launch/prepare digest, capability,
   broker identity, or original deadline fails closed and creates no second lease.
8. **Authentication:** wrong uid, wrong delivery capability, stale broker key/install identity,
   leaked operation id alone, and leaked request id alone cannot recover the response.
9. **Collision:** a test hash adapter forces two preimages to one key; exact preimage comparison
   returns identity drift without disclosing either response.
10. **Deadline before commit:** stall guardian/cgroup until the original deadline. Recovery returns
    reconciled timeout/uncertainty, with no committed unreachable lease.
11. **Response after deadline:** commit `PreparedPendingAck` before the original deadline, lose the
    response, then recover after it. The response is replayed observationally without a second
    prepare or deadline extension.
12. **Bounded capacity:** fill active pending deliveries. A new prepare is rejected before guardian
    construction; no live pending delivery is pruned.

The process-loss tests must execute the real broker-client and daemon framing. The current
`prepared_response_loss_replays_the_same_durable_authority` fixture that reuses one in-memory
`BrokerRequest` remains useful but cannot close this finding alone.

## Exact change map

TypeScript:

- `src/core/session-host/process-authority/linux/preparation-delivery-ledger.ts` (new): closed
  controller ledger, sensitive capability generation/storage, intent/reference/ack/reconcile
  transitions, bounded enumeration, and redaction.
- `src/core/session-host/process-authority/linux/provider.ts`:
  `LinuxAuthorityNativeTransport`, `LinuxProcessAuthorityProviderBundle`, `createBundle`, and
  broker-mode `provider.prepare` begin/recover/store/ACK through the delivery module. Primary mode
  remains unchanged.
- `src/core/session-host/process-authority/linux/native-assembly.ts`:
  encode the delivery binding in stdin frames, add recover/ACK invocations, preserve the original
  prepare deadline identity across client replacement, and never put the capability or operation
  id in argv/env.
- `src/core/session-host/process-authority/coordinator.ts` or the durable SessionHost operation
  owner: production operation-id reservation must be recoverable across controller replacement.
  Do not change `ProcessAuthorityProvider`; use the existing operation-id seam or a narrow durable
  operation-journal adapter.

Rust:

- `native/linux-process-authority/src/broker_protocol.rs`: versioned
  `PreparationDeliveryBinding`, `RecoverPreparation`, and `AcknowledgePreparation` codecs;
  request id remains attempt correlation.
- `native/linux-process-authority/src/broker_guardian.rs`: extend `BrokerPreparePayload` or wrap it
  with the closed delivery binding; guardian/reference semantics do not change.
- `native/linux-process-authority/src/broker_lease.rs`: add
  `BrokerPreparationDeliveryRecord`, stable-key paths/locks, exact transitions and pruning rules;
  extend `BrokerRecoveryRecord` with stable delivery identity.
- `native/linux-process-authority/src/broker_service.rs`:
  `prepare`, `recover_prepared_response`, `reconcile_pending_prepare`, and
  `complete_prepared_delivery` become delivery-key operations; add explicit recover/ACK handlers.
  `complete_prepared_delivery` must run only after ACK, not before socket write.
- `native/linux-process-authority/src/bin/rasen-linux-process-authority-broker.rs`:
  request transaction routing stores attempt response independently, dispatches recover/ACK, and
  removes the current pre-write call to `complete_prepared_delivery`.
- `native/linux-process-authority/src/bin/rasen-linux-process-authority-broker-client.rs`:
  add recover/ACK commands, generate a fresh attempt request id per process, and preserve the
  controller delivery binding through framed stdin only.

Focused tests:

- `native/linux-process-authority/tests/linux_broker_protocol_contract.rs`: closed codecs,
  operation/capability bounds, unknown versions/fields, and redaction.
- `native/linux-process-authority/tests/linux_broker_lease_contract.rs`: delivery transitions,
  collision/conflict, capacity, restart, and pruning.
- `native/linux-process-authority/tests/linux_broker_service_contract.rs`: same-delivery/different
  request ids, no premature recovery retirement, ACK idempotency, deadlines, and auth.
- Add a Linux process-level broker delivery contract or extend the existing package/CLI fixture to
  kill and replace real client/daemon processes. Fixture-only service replay is not terminal.
- TypeScript Linux provider tests cover controller-ledger replacement, reference validation,
  workload-inaccessible state root, ACK loss, and operation-id conflicts.

## GREEN sequence

1. Add RED codec/store tests and the real client-loss oracle.
2. Implement stable delivery key and root delivery state without changing prepare behavior.
3. Make prepare create `Intent` before construction and `PreparedPendingAck` after exact lease and
   response commit; keep provisional recovery.
4. Implement authenticated observational recovery using a different random request id.
5. Add the controller ledger and persist `ReferenceStored` before explicit ACK.
6. Move provisional-recovery retirement behind ACK and retain delivered tombstones through the
   active lease lifetime.
7. Thread the one original absolute deadline through the preparation supervisor from the sibling
   deadline remediation; prove recovery does not extend it.
8. Run fresh process-death, daemon restart, WSL, default-parallel, TypeScript, strict validation,
   and independent security/spec review gates.

## Failure and rollback semantics

- Missing/corrupt/conflicting controller or broker delivery state is retained
  `authority-uncertain`, `identity-drift`, or `control-loss`; it never starts a replacement prepare
  under the same operation id.
- A stale `Intent` with no authority is removed only after exact reconciliation. A pending response
  is returned or exactly aborted; it is never silently pruned.
- If local `ReferenceStored` commit fails, do not ACK. Recover/abort remains possible with the
  controller intent and broker pending delivery.
- If ACK succeeds but local ACK recording fails, the locally durable exact reference still exists;
  repeat ACK is safe.
- Rollback must be atomic across client, daemon, delivery record codec, and controller ledger.
  An older daemon/client must reject the new internal protocol version. Unknown delivery records
  block uninstall and rollback cleanup rather than being deleted.
- Because the broker is not yet a production default, pre-landing rollback may remove only records
  produced by the development fixture after proving every associated lease/guardian/cgroup exact
  empty. It must not revive request-id-only replay.

## Durable findings

1. `preparationOperationId` is already the correct durable semantic identity; random request id is
   only transport correlation and must never again own prepared-reference reachability.
2. Caller uid plus operation id is an index, not sufficient authorization. A separate sensitive
   delivery capability is necessary until the exact lease token/request capability is delivered.
3. Delivery is complete only after the controller durably stores the exact reference and ACKs it.
   Socket write, client decode, and completed request replay are not delivery acknowledgements.
