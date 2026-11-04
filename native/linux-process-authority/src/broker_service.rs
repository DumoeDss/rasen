use std::io;

use sha2::Digest;

use crate::authority::AuthorityIdentity;
use crate::broker_cgroup::{BrokerCgroupAuthority, CgroupKernel, MonotonicDeadline};
use crate::broker_lease::{
    BrokerLease, BrokerPreparationDeliveryPhase, BrokerPreparationDeliveryRecord,
    BrokerRecoveryPhase, BrokerRecoveryRecord, DurableLeaseStore, LeasePhase, LeaseTerminal,
    LeaseTerminalHistory, MAX_CLEANUP_TOMBSTONES,
};
use crate::broker_protocol::{
    broker_request_capability, fresh_challenge_nonce, BrokerClientReferenceWire, BrokerOperation,
    BrokerPublicationBinding, BrokerRequest, PeerCredentials, PreparationDeliveryAcknowledgement,
    PreparationDeliveryBinding, PreparationDeliveryRequest,
};
use crate::lifecycle::{GuardianEvent, GuardianEventKind};

const MAX_CLIENT_REFERENCE_BYTES: usize = 32 * 1024;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct BrokerServiceIdentity {
    pub install_id: [u8; 32],
    pub key_id: [u8; 32],
}

impl BrokerServiceIdentity {
    pub fn validate(self) -> io::Result<()> {
        if self.install_id.iter().all(|byte| *byte == 0)
            || self.key_id.iter().all(|byte| *byte == 0)
            || self.install_id == self.key_id
        {
            return Err(invalid_input(
                "broker service identity is zero or conflated",
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PreparedGuardian {
    pub scope_id: [u8; 16],
    pub preparation_operation_id: String,
    pub launch_digest: [u8; 32],
    pub identity: AuthorityIdentity,
    pub client_reference: Vec<u8>,
}

impl PreparedGuardian {
    fn validate(&self) -> io::Result<()> {
        if self.scope_id.iter().all(|byte| *byte == 0)
            || self.preparation_operation_id.is_empty()
            || self.preparation_operation_id.len() > 128
            || self.launch_digest.iter().all(|byte| *byte == 0)
            || self.client_reference.is_empty()
            || self.client_reference.len() > MAX_CLIENT_REFERENCE_BYTES
        {
            return Err(invalid_input("prepared broker guardian is malformed"));
        }
        self.identity.validate()
    }
}

pub trait GuardianAuthority: Send + Sync {
    fn probe(&self) -> io::Result<()>;
    fn prepare_inert(&self, caller_uid: u32, body: &[u8]) -> io::Result<PreparedGuardian>;
    fn prepare_inert_recoverable(
        &self,
        caller_uid: u32,
        _caller_gid: u32,
        body: &[u8],
        _recovery_id: [u8; 32],
    ) -> io::Result<PreparedGuardian> {
        self.prepare_inert(caller_uid, body)
    }
    fn prepare_inert_recoverable_until(
        &self,
        caller_uid: u32,
        caller_gid: u32,
        body: &[u8],
        recovery_id: [u8; 32],
        deadline: MonotonicDeadline,
    ) -> io::Result<PreparedGuardian> {
        deadline.ensure_live()?;
        let prepared = self.prepare_inert_recoverable(caller_uid, caller_gid, body, recovery_id)?;
        deadline.ensure_live()?;
        Ok(prepared)
    }
    fn abort_inert(&self, guardian: &PreparedGuardian) -> io::Result<()>;
    fn abort_recovery(&self, recovery: &BrokerRecoveryRecord) -> io::Result<()> {
        let scope_id = recovery.scope_id.ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::Unsupported,
                "guardian intent recovery requires a production recovery-id lookup",
            )
        })?;
        let identity = recovery.guardian.clone().ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::Unsupported,
                "guardian intent recovery lacks a durable guardian identity",
            )
        })?;
        let guardian = PreparedGuardian {
            scope_id,
            preparation_operation_id: String::from("recovered"),
            launch_digest: [1; 32],
            identity,
            client_reference: recovery.client_reference.clone(),
        };
        guardian.validate()?;
        self.abort_inert(&guardian)
    }
    fn finalize_recovery(&self, _recovery_id: [u8; 32]) -> io::Result<()> {
        Ok(())
    }
    fn reopen(&self, lease: &BrokerLease, client_reference: &[u8]) -> io::Result<()>;
    fn reopen_until(
        &self,
        lease: &BrokerLease,
        client_reference: &[u8],
        _deadline: MonotonicDeadline,
    ) -> io::Result<()> {
        self.reopen(lease, client_reference)
    }
    fn activate(&self, lease: &BrokerLease, client_reference: &[u8]) -> io::Result<()>;
    fn activate_until(
        &self,
        lease: &BrokerLease,
        client_reference: &[u8],
        deadline: MonotonicDeadline,
    ) -> io::Result<()> {
        deadline.ensure_live()?;
        self.activate(lease, client_reference)?;
        deadline.ensure_live()
    }
    fn terminate_gracefully(
        &self,
        _lease: &BrokerLease,
        _client_reference: &[u8],
        _grace_ms: u32,
        _deadline: MonotonicDeadline,
    ) -> io::Result<()> {
        Ok(())
    }
    fn inspect_events(
        &self,
        _lease: &BrokerLease,
        _client_reference: &[u8],
    ) -> io::Result<Option<Vec<GuardianEvent>>> {
        Ok(None)
    }
}

pub trait GuardianRuntimeAuthority: GuardianAuthority {
    type Runtime: io::Read + io::Write + Send;

    fn open_runtime(
        &self,
        lease: &BrokerLease,
        client_reference: &[u8],
    ) -> io::Result<Self::Runtime>;
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BrokerPrepared {
    pub delivery_key: [u8; 32],
    pub recovery_id: [u8; 32],
    pub lease: BrokerLease,
    pub client_reference: Vec<u8>,
}

impl BrokerPrepared {
    /// Exact response codec used by the production daemon and by restart
    /// reconciliation after lease commit but before first socket delivery.
    pub fn encode_client_reference(&self) -> io::Result<Vec<u8>> {
        if self.delivery_key.iter().all(|byte| *byte == 0)
            || self.recovery_id.iter().all(|byte| *byte == 0)
            || self.client_reference.is_empty()
            || self.client_reference.len() > MAX_CLIENT_REFERENCE_BYTES
            || broker_request_capability(&self.client_reference)? != self.lease.request_capability
        {
            return Err(invalid_input(
                "prepared broker delivery response identity is malformed",
            ));
        }
        self.lease.validate()?;
        BrokerClientReferenceWire {
            guardian_reference: self.client_reference.clone(),
            broker_install_id: self.lease.broker_install_id,
            broker_key_id: self.lease.broker_key_id,
            lease_token: self.lease.token,
            cgroup_device: self.lease.cgroup.device,
            cgroup_inode: self.lease.cgroup.inode,
        }
        .encode()
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum BrokerServiceResponse {
    Available,
    Prepared(BrokerPrepared),
    PreparedDelivery(Vec<u8>),
    PreparationAcknowledged,
    Reopened(LeasePhase),
    PublicationRecorded,
    Activated,
    Observed(Vec<u8>),
    ExactScopeEmpty(Vec<u8>),
    EventGap,
}

pub struct BrokerServiceCore<G, K> {
    identity: BrokerServiceIdentity,
    store: DurableLeaseStore,
    guardian: G,
    cgroups: BrokerCgroupAuthority<K>,
}

impl<G: GuardianAuthority, K: CgroupKernel> BrokerServiceCore<G, K> {
    pub fn new(
        identity: BrokerServiceIdentity,
        store: DurableLeaseStore,
        guardian: G,
        cgroups: BrokerCgroupAuthority<K>,
    ) -> io::Result<Self> {
        identity.validate()?;
        guardian.probe()?;
        cgroups.probe()?;
        store.load_all()?;
        store.load_recoveries()?;
        store.load_deliveries()?;
        let service = Self {
            identity,
            store,
            guardian,
            cgroups,
        };
        service.reconcile_startup()?;
        Ok(service)
    }

    pub fn store(&self) -> &DurableLeaseStore {
        &self.store
    }

    pub fn guardian(&self) -> &G {
        &self.guardian
    }

    pub fn cgroups(&self) -> &BrokerCgroupAuthority<K> {
        &self.cgroups
    }

    pub fn commit_prepared_delivery(&self, prepared: &BrokerPrepared) -> io::Result<()> {
        let response_body = prepared.encode_client_reference()?;
        self.store.with_delivery_lock(&prepared.delivery_key, || {
            self.commit_prepared_delivery_locked(prepared, response_body)
        })
    }

    pub fn commit_prepared_delivery_until(
        &self,
        prepared: &BrokerPrepared,
        deadline: MonotonicDeadline,
    ) -> io::Result<()> {
        if let Err(error) = deadline.ensure_live() {
            return self
                .finish_prepared_delivery_failure(prepared, error)
                .map(|_| ());
        }
        self.commit_prepared_delivery(prepared)?;
        if let Err(error) = deadline.ensure_live() {
            return self
                .finish_prepared_delivery_failure(prepared, error)
                .map(|_| ());
        }
        Ok(())
    }

    fn commit_prepared_delivery_locked(
        &self,
        prepared: &BrokerPrepared,
        response_body: Vec<u8>,
    ) -> io::Result<()> {
        let recovery = self
            .store
            .get_recovery(&prepared.recovery_id)?
            .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "prepare recovery is absent"))?;
        if recovery.scope_id != Some(prepared.lease.scope_id)
            || recovery.guardian.as_ref() != Some(&prepared.lease.guardian)
            || recovery.cgroup != Some(prepared.lease.cgroup)
            || recovery.client_reference != prepared.client_reference
        {
            return Err(permission_denied(
                "prepared delivery response differs from provisional recovery",
            ));
        }
        if self.store.get(&prepared.lease.token)? != Some(prepared.lease.clone()) {
            return Err(permission_denied(
                "prepared delivery response differs from durable lease",
            ));
        }
        let delivery = self
            .store
            .get_delivery(&prepared.delivery_key)?
            .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "delivery intent is absent"))?;
        if delivery.phase != BrokerPreparationDeliveryPhase::Preparing
            || delivery.recovery_id != Some(prepared.recovery_id)
        {
            return Err(permission_denied(
                "prepared delivery response is out of durable order",
            ));
        }
        let pending = BrokerPreparationDeliveryRecord {
            phase: BrokerPreparationDeliveryPhase::PreparedPendingAck,
            lease_token: Some(prepared.lease.token),
            reference_digest: Some(sha2::Sha256::digest(&response_body).into()),
            response_body,
            ..delivery.clone()
        };
        self.store.replace_delivery(&delivery, &pending)
    }

    pub fn reconcile_pending_prepare(&self, request: &BrokerRequest) -> io::Result<()> {
        if request.operation != BrokerOperation::Prepare {
            return Err(invalid_input(
                "pending prepare reconciliation requires the exact prepare operation",
            ));
        }
        let digest = request.replay_digest()?;
        let matching: Vec<BrokerRecoveryRecord> = self
            .store
            .load_recoveries()?
            .into_iter()
            .filter(|record| {
                record.request_id == request.request_id
                    && record.request_digest == digest
                    && record.caller_uid == request.caller_uid
            })
            .collect();
        let deliveries = self.store.load_deliveries()?;
        for recovery in matching {
            if let Some(delivery) = deliveries.iter().find(|delivery| {
                delivery.recovery_id == Some(recovery.recovery_id)
                    && delivery.phase == BrokerPreparationDeliveryPhase::Preparing
            }) {
                let deadline =
                    MonotonicDeadline::from_absolute_ns(delivery.original_deadline_monotonic_ns)?;
                if deadline.is_expired()? {
                    if let Some(prepared) = self.prepared_from_delivery(delivery)? {
                        self.reconcile_failed_prepared_delivery(&prepared)?;
                        continue;
                    }
                }
            }
            self.reconcile_recovery(&recovery)?;
        }
        if self.store.load_recoveries()?.iter().any(|record| {
            record.request_id == request.request_id
                && record.request_digest == digest
                && record.caller_uid == request.caller_uid
        }) {
            return Err(io::Error::new(
                io::ErrorKind::WouldBlock,
                "pending prepare recovery remains retained after reconciliation",
            ));
        }
        Ok(())
    }

    pub fn handle(
        &self,
        peer: PeerCredentials,
        authenticated_nonce: [u8; 32],
        request: BrokerRequest,
    ) -> io::Result<BrokerServiceResponse> {
        self.validate_authenticated_request(peer, authenticated_nonce, &request)?;
        let deadline = (!matches!(request.operation, BrokerOperation::Probe))
            .then(|| {
                self.cgroups
                    .deadline_from_absolute_ns(request.deadline_monotonic_ns)
            })
            .transpose()?;
        match request.operation {
            BrokerOperation::Probe => {
                if !request.body.is_empty() {
                    return Err(invalid_input("broker probe body must be empty"));
                }
                self.guardian.probe()?;
                self.cgroups.probe()?;
                self.store.load_all()?;
                Ok(BrokerServiceResponse::Available)
            }
            BrokerOperation::Prepare => self.prepare(
                peer.uid,
                peer.gid,
                &request,
                deadline.expect("mutating request deadline"),
            ),
            BrokerOperation::RecoverPreparation => self.recover_preparation(
                &request,
                deadline.expect("recover-preparation request deadline"),
            ),
            BrokerOperation::AcknowledgePreparation => self.acknowledge_preparation(
                &request,
                deadline.expect("acknowledge-preparation request deadline"),
            ),
            BrokerOperation::Reopen => self.with_request_token(&request, || {
                deadline.expect("reopen request deadline").ensure_live()?;
                let lease = self.reopen_request(&request)?;
                deadline.expect("reopen request deadline").ensure_live()?;
                Ok(BrokerServiceResponse::Reopened(lease.phase))
            }),
            BrokerOperation::Inspect => self.with_request_token(&request, || {
                self.inspect(&request, deadline.expect("inspect request deadline"))
            }),
            BrokerOperation::RecordPublication => self.with_request_token(&request, || {
                self.record_publication(&request, deadline.expect("mutating request deadline"))
            }),
            BrokerOperation::Activate => self.with_request_token(&request, || {
                self.activate(&request, deadline.expect("mutating request deadline"))
            }),
            BrokerOperation::OpenRuntime => Err(io::Error::new(
                io::ErrorKind::Unsupported,
                "broker runtime bridge requires the Linux guardian transport",
            )),
            BrokerOperation::Abort => {
                self.with_request_token(&request, || self.terminate(&request, 0, false))
            }
            BrokerOperation::Terminate { grace_ms } => {
                self.with_request_token(&request, || self.terminate(&request, grace_ms, true))
            }
        }
    }

    fn with_request_token<T>(
        &self,
        request: &BrokerRequest,
        operation: impl FnOnce() -> io::Result<T>,
    ) -> io::Result<T> {
        let token = request
            .lease_token
            .ok_or_else(|| invalid_input("broker lease token is absent"))?;
        if let Some(delivery) = self.store.delivery_for_token(&token)? {
            self.store.with_delivery_lock(&delivery.delivery_key, || {
                self.store.with_token_lock(&token, operation)
            })
        } else {
            self.store.with_token_lock(&token, operation)
        }
    }

    fn prepare(
        &self,
        caller_uid: u32,
        caller_gid: u32,
        request: &BrokerRequest,
        deadline: MonotonicDeadline,
    ) -> io::Result<BrokerServiceResponse> {
        let delivery_request = PreparationDeliveryRequest::decode(&request.body)?;
        let delivery_key = delivery_request.binding.delivery_key(
            caller_uid,
            &self.identity.install_id,
            &self.identity.key_id,
        )?;
        self.store.with_delivery_lock(&delivery_key, || {
            self.prepare_delivery_locked(
                caller_uid,
                caller_gid,
                request,
                delivery_request,
                delivery_key,
                deadline,
            )
        })
    }

    fn prepare_delivery_locked(
        &self,
        caller_uid: u32,
        caller_gid: u32,
        request: &BrokerRequest,
        delivery_request: PreparationDeliveryRequest,
        delivery_key: [u8; 32],
        deadline: MonotonicDeadline,
    ) -> io::Result<BrokerServiceResponse> {
        deadline.ensure_live()?;
        if let Some(existing) = self.store.get_delivery(&delivery_key)? {
            self.require_exact_delivery(&existing, &delivery_request.binding, caller_uid)?;
            if existing.original_deadline_monotonic_ns != request.deadline_monotonic_ns {
                return Err(permission_denied(
                    "prepared delivery original deadline identity drifted",
                ));
            }
            if existing.phase == BrokerPreparationDeliveryPhase::Preparing {
                if let Some(prepared) = self.prepared_from_delivery(&existing)? {
                    let response = prepared.encode_client_reference()?;
                    self.commit_prepared_delivery_locked(&prepared, response.clone())?;
                    if let Err(error) = deadline.ensure_live() {
                        return self.finish_prepared_delivery_failure(&prepared, error);
                    }
                    return Ok(BrokerServiceResponse::PreparedDelivery(response));
                }
            }
            return match existing.phase {
                BrokerPreparationDeliveryPhase::PreparedPendingAck => {
                    deadline.ensure_live()?;
                    Ok(BrokerServiceResponse::PreparedDelivery(
                        existing.response_body,
                    ))
                }
                BrokerPreparationDeliveryPhase::Delivered => Err(permission_denied(
                    "prepared delivery was already acknowledged by its controller",
                )),
                _ => Err(io::Error::new(
                    io::ErrorKind::WouldBlock,
                    "prepared delivery is retained before exact reconciliation",
                )),
            };
        }
        deadline.ensure_live()?;
        let body = delivery_request.prepare_payload.as_slice();
        let request_digest = request.replay_digest()?;
        let recovery_id = fresh_challenge_nonce()?;
        let delivery_intent = BrokerPreparationDeliveryRecord {
            delivery_key,
            caller_uid,
            preparation_operation_id: delivery_request.binding.preparation_operation_id.clone(),
            prepare_digest: delivery_request.binding.prepare_digest,
            launch_digest: delivery_request.binding.launch_digest,
            broker_install_id: self.identity.install_id,
            broker_key_id: self.identity.key_id,
            capability_hash: delivery_request.binding.capability_hash()?,
            original_deadline_monotonic_ns: request.deadline_monotonic_ns,
            phase: BrokerPreparationDeliveryPhase::Intent,
            recovery_id: None,
            lease_token: None,
            response_body: Vec::new(),
            reference_digest: None,
        };
        self.store.put_delivery(&delivery_intent)?;
        if let Err(error) = deadline.ensure_live() {
            return self.finish_failed_delivery(&delivery_intent, None, error);
        }
        let preparing_delivery = BrokerPreparationDeliveryRecord {
            phase: BrokerPreparationDeliveryPhase::Preparing,
            recovery_id: Some(recovery_id),
            ..delivery_intent.clone()
        };
        if let Err(error) = self
            .store
            .replace_delivery(&delivery_intent, &preparing_delivery)
        {
            return self.finish_failed_delivery(&delivery_intent, None, error);
        }
        if let Err(error) = deadline.ensure_live() {
            return self.finish_failed_delivery(&preparing_delivery, None, error);
        }
        let intent = BrokerRecoveryRecord {
            recovery_id,
            request_id: request.request_id,
            request_digest,
            caller_uid,
            broker_install_id: self.identity.install_id,
            broker_key_id: self.identity.key_id,
            phase: BrokerRecoveryPhase::Intent,
            scope_id: None,
            guardian: None,
            client_reference: Vec::new(),
            cgroup: None,
        };
        if let Err(error) = self.store.put_recovery(&intent) {
            return self.finish_failed_delivery(&preparing_delivery, None, error);
        }
        if let Err(error) = deadline.ensure_live() {
            return self.finish_failed_delivery(&preparing_delivery, Some(&intent), error);
        }
        let guardian = match self.guardian.prepare_inert_recoverable_until(
            caller_uid,
            caller_gid,
            body,
            recovery_id,
            deadline,
        ) {
            Ok(value) => value,
            Err(error) => {
                return self.finish_failed_delivery(&preparing_delivery, Some(&intent), error)
            }
        };
        if let Err(error) = deadline.ensure_live() {
            return self.finish_failed_delivery(&preparing_delivery, Some(&intent), error);
        }
        if let Err(error) = guardian.validate() {
            if self.guardian.abort_inert(&guardian).is_ok() {
                let _ = self.store.remove_recovery(&intent);
            }
            return self.finish_failed_delivery(&preparing_delivery, None, error);
        }
        if guardian.preparation_operation_id != delivery_request.binding.preparation_operation_id
            || guardian.launch_digest != delivery_request.binding.launch_digest
        {
            if self.guardian.abort_inert(&guardian).is_ok() {
                let _ = self.store.remove_recovery(&intent);
            }
            return self.finish_failed_delivery(
                &preparing_delivery,
                None,
                permission_denied("prepared guardian differs from delivery operation binding"),
            );
        }
        let guardian_recovery = BrokerRecoveryRecord {
            phase: BrokerRecoveryPhase::GuardianPrepared,
            scope_id: Some(guardian.scope_id),
            guardian: Some(guardian.identity.clone()),
            client_reference: guardian.client_reference.clone(),
            ..intent.clone()
        };
        if let Err(error) = self.store.replace_recovery(&intent, &guardian_recovery) {
            if self.guardian.abort_inert(&guardian).is_ok() {
                let _ = self.store.remove_recovery(&intent);
            }
            return self.finish_failed_delivery(&preparing_delivery, None, error);
        }
        if let Err(error) = deadline.ensure_live() {
            return self.finish_failed_delivery(
                &preparing_delivery,
                Some(&guardian_recovery),
                error,
            );
        }
        if let Err(error) = self.guardian.finalize_recovery(recovery_id) {
            return self.finish_failed_delivery(
                &preparing_delivery,
                Some(&guardian_recovery),
                error,
            );
        }
        let leaf_creating = BrokerRecoveryRecord {
            phase: BrokerRecoveryPhase::LeafCreating,
            ..guardian_recovery.clone()
        };
        if let Err(error) = self
            .store
            .replace_recovery(&guardian_recovery, &leaf_creating)
        {
            return self.finish_failed_delivery(
                &preparing_delivery,
                Some(&guardian_recovery),
                error,
            );
        }
        if let Err(error) = deadline.ensure_live() {
            return self.finish_failed_delivery(&preparing_delivery, Some(&leaf_creating), error);
        }
        let cgroup = match self.cgroups.create_leaf(&guardian.scope_id) {
            Ok(value) => value,
            Err(error) => {
                return self.finish_failed_delivery(
                    &preparing_delivery,
                    Some(&leaf_creating),
                    error,
                )
            }
        };
        if let Err(error) = deadline.ensure_live() {
            return self.finish_failed_delivery(&preparing_delivery, Some(&leaf_creating), error);
        }
        let leaf_recovery = BrokerRecoveryRecord {
            phase: BrokerRecoveryPhase::LeafPrepared,
            cgroup: Some(cgroup),
            ..leaf_creating.clone()
        };
        if let Err(error) = self.store.replace_recovery(&leaf_creating, &leaf_recovery) {
            let cleanup = self.cgroups.force_empty_and_cleanup(cgroup, 5_000);
            let abort = self.guardian.abort_inert(&guardian);
            if cleanup.is_ok() && abort.is_ok() {
                let _ = self.store.remove_recovery(&leaf_creating);
            }
            return self.finish_failed_delivery(&preparing_delivery, None, error);
        }
        if let Err(error) = deadline.ensure_live() {
            return self.finish_failed_delivery(&preparing_delivery, Some(&leaf_recovery), error);
        }
        if let Err(error) = self
            .cgroups
            .place_guardian_exact(cgroup, guardian.identity.guardian_pid)
        {
            return self.finish_failed_delivery(&preparing_delivery, Some(&leaf_recovery), error);
        }
        if let Err(error) = deadline.ensure_live() {
            return self.finish_failed_delivery(&preparing_delivery, Some(&leaf_recovery), error);
        }
        let mut token = match fresh_challenge_nonce() {
            Ok(value) => value,
            Err(error) => {
                return self.finish_failed_delivery(
                    &preparing_delivery,
                    Some(&leaf_recovery),
                    error,
                )
            }
        };
        let mut request_capability = match broker_request_capability(&guardian.client_reference) {
            Ok(value) => value,
            Err(error) => {
                return self.finish_failed_delivery(
                    &preparing_delivery,
                    Some(&leaf_recovery),
                    error,
                )
            }
        };
        if token == request_capability {
            return self.finish_failed_delivery(
                &preparing_delivery,
                Some(&leaf_recovery),
                io::Error::other("OS random source repeatedly conflated broker capabilities"),
            );
        }
        // Keep the bindings mutable only until the record has been durably committed.
        let lease = BrokerLease {
            token,
            request_capability,
            scope_id: guardian.scope_id,
            preparation_operation_id: guardian.preparation_operation_id.clone(),
            launch_digest: guardian.launch_digest,
            caller_uid,
            broker_install_id: self.identity.install_id,
            broker_key_id: self.identity.key_id,
            guardian: guardian.identity.clone(),
            cgroup,
            phase: LeasePhase::Prepared,
            terminal: LeaseTerminal::Retained,
            publication_binding: None,
            terminal_history: LeaseTerminalHistory::None,
        };
        if let Err(error) = self.store.put(&lease) {
            match self.store.get(&lease.token) {
                Ok(Some(existing)) if existing == lease => {}
                Ok(_) | Err(_) => {
                    return self.finish_failed_delivery(
                        &preparing_delivery,
                        Some(&leaf_recovery),
                        error,
                    )
                }
            }
        }
        if let Err(error) = deadline.ensure_live() {
            let prepared = BrokerPrepared {
                delivery_key,
                recovery_id,
                lease: lease.clone(),
                client_reference: guardian.client_reference.clone(),
            };
            return self.finish_prepared_delivery_failure(&prepared, error);
        }
        token.fill(0);
        request_capability.fill(0);
        Ok(BrokerServiceResponse::Prepared(BrokerPrepared {
            delivery_key,
            recovery_id,
            lease,
            client_reference: guardian.client_reference,
        }))
    }

    fn recover_preparation(
        &self,
        request: &BrokerRequest,
        deadline: MonotonicDeadline,
    ) -> io::Result<BrokerServiceResponse> {
        deadline.ensure_live()?;
        let binding = PreparationDeliveryBinding::decode(&request.body)?;
        let delivery_key = binding.delivery_key(
            request.caller_uid,
            &self.identity.install_id,
            &self.identity.key_id,
        )?;
        self.store.with_delivery_lock(&delivery_key, || {
            deadline.ensure_live()?;
            let delivery = self
                .store
                .get_delivery(&delivery_key)?
                .ok_or_else(|| permission_denied("prepared delivery identity is unknown"))?;
            self.require_exact_delivery(&delivery, &binding, request.caller_uid)?;
            if delivery.phase == BrokerPreparationDeliveryPhase::Preparing
                && MonotonicDeadline::from_absolute_ns(delivery.original_deadline_monotonic_ns)?
                    .is_expired()?
            {
                if let Some(prepared) = self.prepared_from_delivery(&delivery)? {
                    self.reconcile_failed_prepared_delivery(&prepared)?;
                    return Err(io::Error::new(
                        io::ErrorKind::TimedOut,
                        "original broker prepare mutation deadline expired and reconciled",
                    ));
                }
                if let Some(recovery_id) = delivery.recovery_id {
                    if let Some(recovery) = self.store.get_recovery(&recovery_id)? {
                        self.reconcile_recovery(&recovery)?;
                    }
                }
                let reconciled = BrokerPreparationDeliveryRecord {
                    phase: BrokerPreparationDeliveryPhase::Reconciled,
                    lease_token: None,
                    response_body: Vec::new(),
                    reference_digest: None,
                    ..delivery.clone()
                };
                self.store.replace_delivery(&delivery, &reconciled)?;
                return Err(io::Error::new(
                    io::ErrorKind::TimedOut,
                    "original broker prepare mutation deadline expired and reconciled",
                ));
            }
            match delivery.phase {
                BrokerPreparationDeliveryPhase::PreparedPendingAck => {
                    deadline.ensure_live()?;
                    Ok(BrokerServiceResponse::PreparedDelivery(
                        delivery.response_body,
                    ))
                }
                BrokerPreparationDeliveryPhase::Delivered => Err(permission_denied(
                    "prepared delivery is already controller-owned",
                )),
                _ => Err(io::Error::new(
                    io::ErrorKind::WouldBlock,
                    "prepared delivery is not yet observationally available",
                )),
            }
        })
    }

    fn acknowledge_preparation(
        &self,
        request: &BrokerRequest,
        deadline: MonotonicDeadline,
    ) -> io::Result<BrokerServiceResponse> {
        deadline.ensure_live()?;
        let acknowledgement = PreparationDeliveryAcknowledgement::decode(&request.body)?;
        let delivery_key = acknowledgement.binding.delivery_key(
            request.caller_uid,
            &self.identity.install_id,
            &self.identity.key_id,
        )?;
        self.store.with_delivery_lock(&delivery_key, || {
            deadline.ensure_live()?;
            let token = request
                .lease_token
                .ok_or_else(|| invalid_input("broker lease token is absent"))?;
            self.store.with_token_lock(&token, || {
                deadline.ensure_live()?;
                let lease = self.exact_lease(request)?;
                let delivery = self
                    .store
                    .get_delivery(&delivery_key)?
                    .ok_or_else(|| permission_denied("prepared delivery identity is unknown"))?;
                self.require_exact_delivery(
                    &delivery,
                    &acknowledgement.binding,
                    request.caller_uid,
                )?;
                if delivery.lease_token != Some(lease.token)
                    || delivery.reference_digest != Some(acknowledgement.reference_digest)
                {
                    return Err(permission_denied(
                        "prepared delivery acknowledgement differs from exact reference",
                    ));
                }
                if delivery.phase == BrokerPreparationDeliveryPhase::Delivered {
                    deadline.ensure_live()?;
                    self.retire_delivery_recovery(&delivery, &lease)?;
                    return Ok(BrokerServiceResponse::PreparationAcknowledged);
                }
                if delivery.phase != BrokerPreparationDeliveryPhase::PreparedPendingAck {
                    return Err(permission_denied(
                        "prepared delivery acknowledgement is out of order",
                    ));
                }
                let delivered = BrokerPreparationDeliveryRecord {
                    phase: BrokerPreparationDeliveryPhase::Delivered,
                    response_body: Vec::new(),
                    ..delivery.clone()
                };
                deadline.ensure_live()?;
                self.store.replace_delivery(&delivery, &delivered)?;
                deadline.ensure_live()?;
                self.retire_delivery_recovery(&delivered, &lease)?;
                Ok(BrokerServiceResponse::PreparationAcknowledged)
            })
        })
    }

    fn require_exact_delivery(
        &self,
        delivery: &BrokerPreparationDeliveryRecord,
        binding: &PreparationDeliveryBinding,
        caller_uid: u32,
    ) -> io::Result<()> {
        let expected_key =
            binding.delivery_key(caller_uid, &self.identity.install_id, &self.identity.key_id)?;
        if delivery.delivery_key != expected_key
            || delivery.caller_uid != caller_uid
            || delivery.preparation_operation_id != binding.preparation_operation_id
            || delivery.prepare_digest != binding.prepare_digest
            || delivery.launch_digest != binding.launch_digest
            || delivery.broker_install_id != self.identity.install_id
            || delivery.broker_key_id != self.identity.key_id
            || !constant_time_eq(&delivery.capability_hash, &binding.capability_hash()?)
        {
            return Err(permission_denied(
                "prepared delivery binding or capability drifted",
            ));
        }
        Ok(())
    }

    fn retire_delivery_recovery(
        &self,
        delivery: &BrokerPreparationDeliveryRecord,
        lease: &BrokerLease,
    ) -> io::Result<()> {
        if !matches!(
            delivery.phase,
            BrokerPreparationDeliveryPhase::PreparedPendingAck
                | BrokerPreparationDeliveryPhase::Delivered
        ) || delivery.lease_token != Some(lease.token)
        {
            return Err(permission_denied(
                "prepared delivery recovery retirement is out of order",
            ));
        }
        let recovery_id = delivery
            .recovery_id
            .ok_or_else(|| invalid_input("prepared delivery recovery identity is absent"))?;
        let Some(recovery) = self.store.get_recovery(&recovery_id)? else {
            return Ok(());
        };
        if recovery.scope_id != Some(lease.scope_id)
            || recovery.guardian.as_ref() != Some(&lease.guardian)
            || recovery.cgroup != Some(lease.cgroup)
            || recovery.caller_uid != lease.caller_uid
            || recovery.broker_install_id != lease.broker_install_id
            || recovery.broker_key_id != lease.broker_key_id
        {
            return Err(permission_denied(
                "prepared delivery recovery differs from delivered lease",
            ));
        }
        self.store.remove_recovery(&recovery)
    }

    fn prepared_from_delivery(
        &self,
        delivery: &BrokerPreparationDeliveryRecord,
    ) -> io::Result<Option<BrokerPrepared>> {
        if delivery.phase != BrokerPreparationDeliveryPhase::Preparing {
            return Ok(None);
        }
        let recovery_id = delivery
            .recovery_id
            .ok_or_else(|| invalid_input("preparing delivery recovery identity is absent"))?;
        let Some(recovery) = self.store.get_recovery(&recovery_id)? else {
            return Ok(None);
        };
        let (Some(scope_id), Some(guardian), Some(cgroup)) = (
            recovery.scope_id,
            recovery.guardian.as_ref(),
            recovery.cgroup,
        ) else {
            return Ok(None);
        };
        let matching: Vec<BrokerLease> = self
            .store
            .load_all()?
            .into_iter()
            .filter(|lease| {
                lease.scope_id == scope_id
                    && &lease.guardian == guardian
                    && lease.cgroup == cgroup
                    && lease.caller_uid == delivery.caller_uid
                    && lease.preparation_operation_id == delivery.preparation_operation_id
                    && lease.launch_digest == delivery.launch_digest
                    && lease.broker_install_id == delivery.broker_install_id
                    && lease.broker_key_id == delivery.broker_key_id
                    && lease.phase == LeasePhase::Prepared
            })
            .collect();
        if matching.len() > 1 {
            return Err(permission_denied(
                "preparing delivery resolves to multiple durable leases",
            ));
        }
        Ok(matching.into_iter().next().map(|lease| BrokerPrepared {
            delivery_key: delivery.delivery_key,
            recovery_id,
            lease,
            client_reference: recovery.client_reference,
        }))
    }

    fn record_publication(
        &self,
        request: &BrokerRequest,
        deadline: MonotonicDeadline,
    ) -> io::Result<BrokerServiceResponse> {
        deadline.ensure_live()?;
        let binding = BrokerPublicationBinding::decode(&request.body)?;
        let lease = self.exact_lease(request)?;
        self.cgroups.bind_recovered(&lease.scope_id, lease.cgroup)?;
        if lease.phase == LeasePhase::Published {
            if lease.publication_binding.as_ref() == Some(&binding) {
                return Ok(BrokerServiceResponse::PublicationRecorded);
            }
            return Err(permission_denied(
                "broker publication digest conflicts with the durable lease",
            ));
        }
        if lease.phase != LeasePhase::Prepared {
            return Err(permission_denied(
                "broker publication is out of lifecycle order",
            ));
        }
        let published = BrokerLease {
            phase: LeasePhase::Published,
            publication_binding: Some(binding),
            ..lease.clone()
        };
        deadline.ensure_live()?;
        self.store.replace(&lease, &published)?;
        Ok(BrokerServiceResponse::PublicationRecorded)
    }

    fn activate(
        &self,
        request: &BrokerRequest,
        deadline: MonotonicDeadline,
    ) -> io::Result<BrokerServiceResponse> {
        deadline.ensure_live()?;
        let lease = self.reopen_request(request)?;
        if lease.phase == LeasePhase::Activated {
            return Ok(BrokerServiceResponse::Activated);
        }
        let pending = match lease.phase {
            LeasePhase::Published => {
                let pending = BrokerLease {
                    phase: LeasePhase::ActivationPending,
                    ..lease.clone()
                };
                deadline.ensure_live()?;
                self.store.replace(&lease, &pending)?;
                pending
            }
            LeasePhase::ActivationPending => lease,
            _ => {
                return Err(permission_denied(
                    "broker activation requires a durable published or pending lease",
                ))
            }
        };
        // The guardian activation seam is exactly-once/idempotent. Replaying it from the
        // durable pending phase closes broker-death and acknowledgement-loss windows.
        self.guardian
            .activate_until(&pending, &request.body, deadline)?;
        deadline.ensure_live()?;
        let activated = BrokerLease {
            phase: LeasePhase::Activated,
            ..pending.clone()
        };
        self.store.replace(&pending, &activated)?;
        Ok(BrokerServiceResponse::Activated)
    }

    fn inspect(
        &self,
        request: &BrokerRequest,
        deadline: MonotonicDeadline,
    ) -> io::Result<BrokerServiceResponse> {
        deadline.ensure_live()?;
        let lease = self.exact_lease(request)?;
        if lease.phase == LeasePhase::CleanupComplete {
            return self.replay_terminal_history(&lease);
        }
        if lease.phase == LeasePhase::ExactScopeEmpty {
            self.finish_terminal_cleanup(&lease)?;
            return self.replay_terminal_history(&lease);
        }
        self.cgroups.bind_recovered(&lease.scope_id, lease.cgroup)?;
        deadline.ensure_live()?;
        self.guardian.reopen(&lease, &request.body)?;
        deadline.ensure_live()?;
        let Some(events) = self.guardian.inspect_events(&lease, &request.body)? else {
            return Ok(BrokerServiceResponse::Reopened(lease.phase));
        };
        let encoded = GuardianEvent::encode_journal(&events)?;
        match events.last().map(|event| event.kind) {
            Some(GuardianEventKind::RootExited) if lease.phase == LeasePhase::Activated => {
                let root_exited = BrokerLease {
                    phase: LeasePhase::RootExited,
                    ..lease.clone()
                };
                deadline.ensure_live()?;
                self.store.replace(&lease, &root_exited)?;
            }
            Some(GuardianEventKind::ExactScopeEmpty) => {
                let terminal = BrokerLease {
                    phase: LeasePhase::ExactScopeEmpty,
                    terminal: LeaseTerminal::ExactEmpty,
                    terminal_history: LeaseTerminalHistory::ClosedJournal(encoded.clone()),
                    ..lease.clone()
                };
                deadline.ensure_live()?;
                self.store.replace(&lease, &terminal)?;
                deadline.ensure_live()?;
                self.finish_terminal_cleanup(&terminal)?;
            }
            _ => {}
        }
        Ok(BrokerServiceResponse::Observed(encoded))
    }

    fn terminate(
        &self,
        request: &BrokerRequest,
        grace_ms: u32,
        graceful: bool,
    ) -> io::Result<BrokerServiceResponse> {
        let deadline = self
            .cgroups
            .deadline_from_absolute_ns(request.deadline_monotonic_ns)?;
        let lease = self.exact_lease(request)?;
        if lease.phase == LeasePhase::CleanupComplete {
            return self.replay_terminal_history(&lease);
        }
        if lease.phase == LeasePhase::ExactScopeEmpty {
            self.finish_terminal_cleanup(&lease)?;
            return self.replay_terminal_history(&lease);
        }
        self.cgroups.bind_recovered(&lease.scope_id, lease.cgroup)?;
        self.guardian
            .reopen_until(&lease, &request.body, deadline)?;
        if deadline.is_expired_at(self.cgroups.kernel().monotonic_now()) {
            return Err(io::Error::new(
                io::ErrorKind::TimedOut,
                "broker control deadline expired while reopening the guardian",
            ));
        }
        if graceful && grace_ms > 0 {
            let bounded_grace = grace_ms.min(
                deadline
                    .remaining_at(self.cgroups.kernel().monotonic_now())
                    .as_millis()
                    .min(u128::from(u32::MAX)) as u32,
            );
            if bounded_grace > 0 {
                self.guardian.terminate_gracefully(
                    &lease,
                    &request.body,
                    bounded_grace,
                    deadline,
                )?;
            }
        }
        self.cgroups.force_empty_until(lease.cgroup, deadline)?;
        let terminal_history = match self.guardian.inspect_events(&lease, &request.body) {
            Ok(Some(events))
                if events
                    .last()
                    .is_some_and(|event| event.kind == GuardianEventKind::ExactScopeEmpty) =>
            {
                LeaseTerminalHistory::ClosedJournal(GuardianEvent::encode_journal(&events)?)
            }
            _ => LeaseTerminalHistory::EventGap,
        };
        let terminal = BrokerLease {
            phase: LeasePhase::ExactScopeEmpty,
            terminal: LeaseTerminal::ExactEmpty,
            terminal_history,
            ..lease.clone()
        };
        self.store.replace(&lease, &terminal)?;
        self.finish_terminal_cleanup(&terminal)?;
        self.replay_terminal_history(&terminal)
    }

    fn replay_terminal_history(&self, terminal: &BrokerLease) -> io::Result<BrokerServiceResponse> {
        match &terminal.terminal_history {
            LeaseTerminalHistory::ClosedJournal(journal) => {
                GuardianEvent::decode_journal(journal)?;
                Ok(BrokerServiceResponse::ExactScopeEmpty(journal.clone()))
            }
            LeaseTerminalHistory::EventGap => Ok(BrokerServiceResponse::EventGap),
            LeaseTerminalHistory::None => Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "broker terminal history is unavailable",
            )),
        }
    }

    fn reopen_request(&self, request: &BrokerRequest) -> io::Result<BrokerLease> {
        let lease = self.exact_lease(request)?;
        self.cgroups.bind_recovered(&lease.scope_id, lease.cgroup)?;
        self.guardian.reopen(&lease, &request.body)?;
        Ok(lease)
    }

    fn exact_lease(&self, request: &BrokerRequest) -> io::Result<BrokerLease> {
        let token = request
            .lease_token
            .ok_or_else(|| invalid_input("broker lease token is absent"))?;
        let request_capability = request
            .request_capability
            .ok_or_else(|| invalid_input("broker request capability is absent"))?;
        let lease = self
            .store
            .get(&token)?
            .ok_or_else(|| permission_denied("broker lease token is unknown"))?;
        if !constant_time_eq(&lease.request_capability, &request_capability)
            || lease.caller_uid != request.caller_uid
            || lease.broker_install_id != self.identity.install_id
            || lease.broker_key_id != self.identity.key_id
        {
            return Err(permission_denied(
                "broker lease capability, caller, install, or key identity drifted",
            ));
        }
        Ok(lease)
    }

    fn validate_authenticated_request(
        &self,
        peer: PeerCredentials,
        authenticated_nonce: [u8; 32],
        request: &BrokerRequest,
    ) -> io::Result<()> {
        request.encode()?;
        peer.validate()?;
        if request.challenge_nonce != authenticated_nonce
            || request.caller_uid != peer.uid
            || authenticated_nonce.iter().all(|byte| *byte == 0)
        {
            return Err(permission_denied(
                "broker request does not match authenticated Unix peer session",
            ));
        }
        Ok(())
    }

    fn reconcile_startup(&self) -> io::Result<()> {
        for lease in self.store.load_all()? {
            if matches!(
                lease.phase,
                LeasePhase::ExactScopeEmpty | LeasePhase::CleanupComplete
            ) {
                self.with_lease_locks(&lease, || self.finish_terminal_cleanup(&lease))?;
            }
        }
        let mut deliveries = self.store.load_deliveries()?;
        for delivery in &deliveries {
            match delivery.phase {
                BrokerPreparationDeliveryPhase::Intent => {
                    let reconciled = BrokerPreparationDeliveryRecord {
                        phase: BrokerPreparationDeliveryPhase::Reconciled,
                        ..delivery.clone()
                    };
                    self.store.replace_delivery(delivery, &reconciled)?;
                }
                BrokerPreparationDeliveryPhase::Delivered => {
                    let token = delivery.lease_token.ok_or_else(|| {
                        invalid_input("delivered preparation lacks a lease token")
                    })?;
                    let lease = self.store.get(&token)?.ok_or_else(|| {
                        permission_denied("delivered preparation lease is absent")
                    })?;
                    self.retire_delivery_recovery(delivery, &lease)?;
                }
                BrokerPreparationDeliveryPhase::Preparing => {
                    if let Some(prepared) = self.prepared_from_delivery(delivery)? {
                        let deadline = MonotonicDeadline::from_absolute_ns(
                            delivery.original_deadline_monotonic_ns,
                        )?;
                        if deadline.is_expired()? {
                            self.reconcile_failed_prepared_delivery(&prepared)?;
                        } else {
                            self.commit_prepared_delivery_until(&prepared, deadline)?;
                        }
                    }
                }
                _ => {}
            }
        }
        deliveries = self.store.load_deliveries()?;
        for recovery in self.store.load_recoveries()? {
            if deliveries.iter().any(|delivery| {
                delivery.recovery_id == Some(recovery.recovery_id)
                    && matches!(
                        delivery.phase,
                        BrokerPreparationDeliveryPhase::PreparedPendingAck
                            | BrokerPreparationDeliveryPhase::Delivered
                    )
            }) {
                continue;
            }
            self.reconcile_recovery(&recovery)?;
        }
        for delivery in self.store.load_deliveries()? {
            if delivery.phase == BrokerPreparationDeliveryPhase::Preparing
                && delivery.recovery_id.is_some_and(|recovery_id| {
                    self.store
                        .get_recovery(&recovery_id)
                        .is_ok_and(|record| record.is_none())
                })
            {
                let reconciled = BrokerPreparationDeliveryRecord {
                    phase: BrokerPreparationDeliveryPhase::Reconciled,
                    lease_token: None,
                    response_body: Vec::new(),
                    reference_digest: None,
                    ..delivery.clone()
                };
                self.store.replace_delivery(&delivery, &reconciled)?;
            }
        }
        self.store.load_requests()?;
        self.store
            .prune_cleanup_tombstones(MAX_CLEANUP_TOMBSTONES)?;
        self.store
            .prune_completed_requests(crate::broker_lease::MAX_REQUEST_RECORDS)?;
        self.store
            .prune_reconciled_deliveries_to_total(crate::broker_lease::MAX_DELIVERY_RECORDS / 2)?;
        Ok(())
    }

    fn with_lease_locks<T>(
        &self,
        lease: &BrokerLease,
        operation: impl FnOnce() -> io::Result<T>,
    ) -> io::Result<T> {
        if let Some(delivery) = self.store.delivery_for_token(&lease.token)? {
            self.store.with_delivery_lock(&delivery.delivery_key, || {
                self.store.with_token_lock(&lease.token, operation)
            })
        } else {
            self.store.with_token_lock(&lease.token, operation)
        }
    }

    fn finish_terminal_cleanup(&self, terminal: &BrokerLease) -> io::Result<()> {
        if !matches!(
            terminal.phase,
            LeasePhase::ExactScopeEmpty | LeasePhase::CleanupComplete
        ) || terminal.terminal != LeaseTerminal::ExactEmpty
        {
            return Err(invalid_input(
                "broker terminal cleanup requires an exact-empty durable phase",
            ));
        }
        let tombstone = if terminal.phase == LeasePhase::ExactScopeEmpty {
            self.cgroups
                .cleanup_empty_recovered_or_absent(&terminal.scope_id, terminal.cgroup)?;
            let tombstone = BrokerLease {
                phase: LeasePhase::CleanupComplete,
                ..terminal.clone()
            };
            self.store.replace(terminal, &tombstone)?;
            tombstone
        } else {
            terminal.clone()
        };
        if let Some(delivery) = self.store.delivery_for_token(&tombstone.token)? {
            self.retire_delivery_recovery(&delivery, &tombstone)?;
        }
        self.store.reconcile_terminal_delivery(&tombstone)?;
        self.store
            .prune_cleanup_tombstones(MAX_CLEANUP_TOMBSTONES)?;
        Ok(())
    }

    fn reconcile_recovery(&self, recovery: &BrokerRecoveryRecord) -> io::Result<()> {
        recovery.validate()?;
        if recovery.broker_install_id != self.identity.install_id
            || recovery.broker_key_id != self.identity.key_id
        {
            return Err(permission_denied(
                "broker provisional recovery install or key identity drifted",
            ));
        }
        if self.store.load_all()?.iter().any(|lease| {
            recovery.scope_id == Some(lease.scope_id)
                && recovery.guardian.as_ref() == Some(&lease.guardian)
                && recovery.cgroup == Some(lease.cgroup)
                && recovery.caller_uid == lease.caller_uid
                && recovery.broker_install_id == lease.broker_install_id
                && recovery.broker_key_id == lease.broker_key_id
        }) {
            let request = self.store.get_request(&recovery.request_id)?;
            if request.as_ref().is_some_and(|record| {
                record.request_digest == recovery.request_digest && record.response_code.is_some()
            }) {
                return self.store.remove_recovery(recovery);
            }
            return Ok(());
        }
        if recovery.phase == BrokerRecoveryPhase::LeafCreating {
            let scope_id = recovery.scope_id.ok_or_else(|| {
                invalid_input("leaf-creating recovery lacks its exact scope identity")
            })?;
            if let Some(cgroup) = self.cgroups.recover_created_leaf(&scope_id)? {
                self.cgroups
                    .cleanup_empty_recovered_or_absent(&scope_id, cgroup)?;
            }
        } else if let (Some(scope_id), Some(cgroup)) = (recovery.scope_id, recovery.cgroup) {
            self.cgroups
                .cleanup_recovered_or_absent(&scope_id, cgroup, 5_000)?;
        }
        self.guardian.abort_recovery(recovery)?;
        self.store.remove_recovery(recovery)
    }

    fn finish_prepared_delivery_failure(
        &self,
        prepared: &BrokerPrepared,
        original: io::Error,
    ) -> io::Result<BrokerServiceResponse> {
        match self.reconcile_failed_prepared_delivery(prepared) {
            Ok(()) => Err(original),
            Err(reconcile) => Err(io::Error::other(format!(
                "broker prepare failed after lease commit and retained exact authority: {original}; reconciliation: {reconcile}"
            ))),
        }
    }

    fn reconcile_failed_prepared_delivery(&self, prepared: &BrokerPrepared) -> io::Result<()> {
        let guardian = PreparedGuardian {
            scope_id: prepared.lease.scope_id,
            preparation_operation_id: prepared.lease.preparation_operation_id.clone(),
            launch_digest: prepared.lease.launch_digest,
            identity: prepared.lease.guardian.clone(),
            client_reference: prepared.client_reference.clone(),
        };
        self.guardian.abort_inert(&guardian)?;
        self.cgroups.cleanup_recovered_or_absent(
            &prepared.lease.scope_id,
            prepared.lease.cgroup,
            5_000,
        )?;
        let terminal = BrokerLease {
            phase: LeasePhase::ExactScopeEmpty,
            terminal: LeaseTerminal::ExactEmpty,
            terminal_history: LeaseTerminalHistory::EventGap,
            ..prepared.lease.clone()
        };
        self.store.replace(&prepared.lease, &terminal)?;
        self.finish_terminal_cleanup(&terminal)?;

        if let Some(recovery) = self.store.get_recovery(&prepared.recovery_id)? {
            self.store.remove_recovery(&recovery)?;
        }
        if let Some(delivery) = self.store.get_delivery(&prepared.delivery_key)? {
            match delivery.phase {
                BrokerPreparationDeliveryPhase::Reconciled => {}
                BrokerPreparationDeliveryPhase::Preparing => {
                    let reconciled = BrokerPreparationDeliveryRecord {
                        phase: BrokerPreparationDeliveryPhase::Reconciled,
                        lease_token: None,
                        response_body: Vec::new(),
                        reference_digest: None,
                        ..delivery.clone()
                    };
                    self.store.replace_delivery(&delivery, &reconciled)?;
                }
                _ => {
                    return Err(io::Error::other(
                        "failed prepared broker authority retained an unexpected delivery phase",
                    ))
                }
            }
        }
        Ok(())
    }

    fn finish_failed_delivery(
        &self,
        delivery: &BrokerPreparationDeliveryRecord,
        recovery: Option<&BrokerRecoveryRecord>,
        original: io::Error,
    ) -> io::Result<BrokerServiceResponse> {
        if let Some(recovery) = recovery {
            if let Err(reconcile) = self.reconcile_recovery(recovery) {
                return Err(io::Error::other(format!(
                    "broker prepare failed and retained provisional recovery: {original}; reconciliation: {reconcile}"
                )));
            }
        }
        let reconciled = BrokerPreparationDeliveryRecord {
            phase: BrokerPreparationDeliveryPhase::Reconciled,
            lease_token: None,
            response_body: Vec::new(),
            reference_digest: None,
            ..delivery.clone()
        };
        match self.store.replace_delivery(delivery, &reconciled) {
            Ok(()) => Err(original),
            Err(reconcile) => Err(io::Error::other(format!(
                "broker prepare failed and retained delivery intent: {original}; delivery reconciliation: {reconcile}"
            ))),
        }
    }
}

impl<G: GuardianRuntimeAuthority, K: CgroupKernel> BrokerServiceCore<G, K> {
    pub fn open_runtime(
        &self,
        peer: PeerCredentials,
        authenticated_nonce: [u8; 32],
        request: BrokerRequest,
    ) -> io::Result<G::Runtime> {
        self.validate_authenticated_request(peer, authenticated_nonce, &request)?;
        if request.operation != BrokerOperation::OpenRuntime {
            return Err(invalid_input(
                "broker runtime opening requires the exact runtime operation",
            ));
        }
        let deadline = self
            .cgroups
            .deadline_from_absolute_ns(request.deadline_monotonic_ns)?;
        self.with_request_token(&request, || {
            let lease = self.exact_lease(&request)?;
            self.cgroups.bind_recovered(&lease.scope_id, lease.cgroup)?;
            self.guardian
                .reopen_until(&lease, &request.body, deadline)?;
            if deadline.is_expired_at(self.cgroups.kernel().monotonic_now()) {
                return Err(io::Error::new(
                    io::ErrorKind::TimedOut,
                    "broker runtime-open deadline expired while reopening the guardian",
                ));
            }
            self.guardian.open_runtime(&lease, &request.body)
        })
    }
}

fn constant_time_eq(left: &[u8; 32], right: &[u8; 32]) -> bool {
    left.iter()
        .zip(right)
        .fold(0_u8, |difference, (a, b)| difference | (a ^ b))
        == 0
}

fn invalid_input(message: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidInput, message)
}

fn permission_denied(message: &str) -> io::Error {
    io::Error::new(io::ErrorKind::PermissionDenied, message)
}
