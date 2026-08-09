use std::collections::VecDeque;
use std::fs;
use std::io;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Barrier, Mutex};
use std::thread;
use std::time::Duration;

#[cfg(target_os = "linux")]
use std::os::unix::net::{UnixListener, UnixStream};
#[cfg(target_os = "linux")]
use std::process::{Child, Command, Stdio};

use sha2::{Digest, Sha256};

use rasen_linux_process_authority::authority::AuthorityIdentity;
use rasen_linux_process_authority::broker_cgroup::{
    BrokerCgroupAuthority, CgroupKernel, CgroupRequirements, MonotonicDeadline,
};
#[cfg(target_os = "linux")]
use rasen_linux_process_authority::broker_client_transaction::{
    parse_client_command, parse_prepared_delivery_response, BrokerClientCommand,
    BrokerClientEndpoint,
};
#[cfg(target_os = "linux")]
use rasen_linux_process_authority::broker_daemon_transaction::{
    BrokerDaemonTransactions, BrokerTransactionObserver,
};
use rasen_linux_process_authority::broker_lease::{
    BrokerLease, BrokerPreparationDeliveryPhase, BrokerPreparationDeliveryRecord,
    BrokerRecoveryPhase, BrokerRecoveryRecord, BrokerRequestRecord, CgroupLeafIdentity,
    DurableLeaseStore, LeasePhase, LeaseTerminal, LeaseTerminalHistory,
};
#[cfg(target_os = "linux")]
use rasen_linux_process_authority::broker_protocol::{
    broker_request_capability, BrokerClientReferenceWire, BrokerFrame, BrokerFrameKind,
    BrokerResponse, BrokerResponseCode, ClientHello, PinnedBrokerIdentity, SigningBrokerIdentity,
};
use rasen_linux_process_authority::broker_protocol::{
    BrokerOperation, BrokerPublicationBinding, BrokerRequest, PeerCredentials,
    PreparationDeliveryAcknowledgement, PreparationDeliveryBinding, PreparationDeliveryRequest,
};
#[cfg(target_os = "linux")]
use rasen_linux_process_authority::broker_service::GuardianRuntimeAuthority;
use rasen_linux_process_authority::broker_service::{
    BrokerPrepared, BrokerServiceCore, BrokerServiceIdentity, BrokerServiceResponse,
    GuardianAuthority, PreparedGuardian,
};
#[cfg(target_os = "linux")]
use rasen_linux_process_authority::broker_transport::authenticate_broker_for_uid;
use rasen_linux_process_authority::lifecycle::{GuardianEvent, RootExit};

static NEXT: AtomicU64 = AtomicU64::new(1);

fn temp_root(label: &str) -> PathBuf {
    let path = std::env::temp_dir().join(format!(
        "rasen-broker-service-{}-{}-{label}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    fs::create_dir(&path).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o700)).unwrap();
    }
    path
}

#[derive(Default)]
struct GuardianState {
    prepared: usize,
    aborted: usize,
    reopened: usize,
    activated: usize,
    fail_next_activation: bool,
    events: Option<Vec<GuardianEvent>>,
    prepare_deadline: Option<u64>,
    activation_deadline: Option<u64>,
}

#[derive(Clone)]
struct GuardianFixture {
    state: Arc<Mutex<GuardianState>>,
}

impl GuardianFixture {
    fn new() -> Self {
        Self {
            state: Arc::new(Mutex::new(GuardianState::default())),
        }
    }
}

impl GuardianAuthority for GuardianFixture {
    fn probe(&self) -> io::Result<()> {
        Ok(())
    }

    fn prepare_inert(&self, caller_uid: u32, body: &[u8]) -> io::Result<PreparedGuardian> {
        assert_eq!(caller_uid, 1000);
        assert_eq!(body, b"launch");
        self.state.lock().unwrap().prepared += 1;
        Ok(PreparedGuardian {
            scope_id: [3; 16],
            preparation_operation_id: "prepare-1".to_owned(),
            launch_digest: [6; 32],
            identity: AuthorityIdentity {
                boot_id: "7dc44f16-8f9d-4ad8-a233-44bbd0704848".to_owned(),
                guardian_pid: 4242,
                start_ticks: 777,
                pid_namespace_device: 4,
                pid_namespace_inode: 99,
            },
            client_reference: b"guardian-ref".to_vec(),
        })
    }

    fn abort_inert(&self, _guardian: &PreparedGuardian) -> io::Result<()> {
        self.state.lock().unwrap().aborted += 1;
        Ok(())
    }

    fn prepare_inert_recoverable_until(
        &self,
        caller_uid: u32,
        _caller_gid: u32,
        body: &[u8],
        _recovery_id: [u8; 32],
        deadline: MonotonicDeadline,
    ) -> io::Result<PreparedGuardian> {
        self.state.lock().unwrap().prepare_deadline = Some(deadline.absolute_ns()?);
        self.prepare_inert(caller_uid, body)
    }

    fn reopen(
        &self,
        _lease: &rasen_linux_process_authority::broker_lease::BrokerLease,
        body: &[u8],
    ) -> io::Result<()> {
        if body != b"guardian-ref" {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "identity-drift",
            ));
        }
        self.state.lock().unwrap().reopened += 1;
        Ok(())
    }

    fn activate(
        &self,
        _lease: &rasen_linux_process_authority::broker_lease::BrokerLease,
        body: &[u8],
    ) -> io::Result<()> {
        self.reopen(_lease, body)?;
        let mut state = self.state.lock().unwrap();
        if state.fail_next_activation {
            state.fail_next_activation = false;
            return Err(io::Error::new(
                io::ErrorKind::Interrupted,
                "injected broker death after activation became pending",
            ));
        }
        state.activated += 1;
        Ok(())
    }

    fn activate_until(
        &self,
        lease: &BrokerLease,
        body: &[u8],
        deadline: MonotonicDeadline,
    ) -> io::Result<()> {
        self.state.lock().unwrap().activation_deadline = Some(deadline.absolute_ns()?);
        self.activate(lease, body)
    }

    fn inspect_events(
        &self,
        _lease: &BrokerLease,
        body: &[u8],
    ) -> io::Result<Option<Vec<GuardianEvent>>> {
        if body != b"guardian-ref" {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "identity-drift",
            ));
        }
        Ok(self.state.lock().unwrap().events.clone())
    }
}

#[cfg(target_os = "linux")]
impl GuardianRuntimeAuthority for GuardianFixture {
    type Runtime = UnixStream;

    fn open_runtime(
        &self,
        _lease: &BrokerLease,
        _client_reference: &[u8],
    ) -> io::Result<Self::Runtime> {
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "process delivery fixture does not open a workload runtime",
        ))
    }
}

#[derive(Clone)]
struct CgroupFixture {
    state: Arc<Mutex<CgroupState>>,
}

struct CgroupState {
    exists: bool,
    created: usize,
    killed: bool,
    cleaned: bool,
    populated: VecDeque<bool>,
    fail_place_once: bool,
    fail_kill_once: bool,
}

impl CgroupFixture {
    fn new() -> Self {
        Self {
            state: Arc::new(Mutex::new(CgroupState {
                exists: false,
                created: 0,
                killed: false,
                cleaned: false,
                populated: VecDeque::from([true, false]),
                fail_place_once: false,
                fail_kill_once: false,
            })),
        }
    }
}

impl CgroupKernel for CgroupFixture {
    fn probe(&self, _: &CgroupRequirements) -> io::Result<()> {
        Ok(())
    }

    fn create_unique_leaf(&self, _: &[u8; 16]) -> io::Result<CgroupLeafIdentity> {
        let mut state = self.state.lock().unwrap();
        state.exists = true;
        state.created += 1;
        Ok(CgroupLeafIdentity {
            device: 8,
            inode: 9,
        })
    }

    fn recover_created_leaf(&self, _scope_id: &[u8; 16]) -> io::Result<Option<CgroupLeafIdentity>> {
        let state = self.state.lock().unwrap();
        Ok(state.exists.then_some(CgroupLeafIdentity {
            device: 8,
            inode: 9,
        }))
    }

    fn place_guardian(&self, _: CgroupLeafIdentity, _: u32) -> io::Result<()> {
        let mut state = self.state.lock().unwrap();
        if state.fail_place_once {
            state.fail_place_once = false;
            return Err(io::Error::new(
                io::ErrorKind::Interrupted,
                "injected placement failure",
            ));
        }
        Ok(())
    }

    fn reopen_leaf(&self, _: CgroupLeafIdentity) -> io::Result<()> {
        if self.state.lock().unwrap().exists {
            Ok(())
        } else {
            Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "identity-drift",
            ))
        }
    }

    fn recursive_kill(&self, _: CgroupLeafIdentity) -> io::Result<()> {
        let mut state = self.state.lock().unwrap();
        if state.fail_kill_once {
            state.fail_kill_once = false;
            return Err(io::Error::new(
                io::ErrorKind::Interrupted,
                "injected cgroup kill failure",
            ));
        }
        state.killed = true;
        Ok(())
    }

    fn populated(&self, _: CgroupLeafIdentity) -> io::Result<bool> {
        Ok(self
            .state
            .lock()
            .unwrap()
            .populated
            .pop_front()
            .unwrap_or(false))
    }

    fn cleanup_leaf(&self, _: CgroupLeafIdentity) -> io::Result<()> {
        let mut state = self.state.lock().unwrap();
        state.cleaned = true;
        state.exists = false;
        Ok(())
    }

    fn bind_recovered_leaf(
        &self,
        _scope_id: &[u8; 16],
        expected: CgroupLeafIdentity,
    ) -> io::Result<()> {
        if !self.state.lock().unwrap().exists {
            return Err(io::ErrorKind::NotFound.into());
        }
        self.reopen_leaf(expected)
    }
}

fn request(operation: BrokerOperation, body: &[u8]) -> BrokerRequest {
    let control = !matches!(
        operation,
        BrokerOperation::Probe | BrokerOperation::Prepare | BrokerOperation::RecoverPreparation
    );
    let now = CgroupFixture::new().monotonic_now();
    let body = if operation == BrokerOperation::Prepare {
        let binding = PreparationDeliveryBinding::for_prepare(
            "prepare-1".to_owned(),
            [6; 32],
            [10; 32],
            body,
        )
        .unwrap();
        PreparationDeliveryRequest {
            binding,
            prepare_payload: body.to_vec(),
        }
        .encode()
        .unwrap()
    } else {
        body.to_vec()
    };
    BrokerRequest {
        request_id: [7; 16],
        challenge_nonce: [8; 32],
        caller_uid: 1000,
        deadline_monotonic_ns: (now + Duration::from_secs(30))
            .as_nanos()
            .try_into()
            .unwrap(),
        operation,
        lease_token: control.then_some([1; 32]),
        request_capability: control.then_some([2; 32]),
        body,
    }
}

fn prepare_binding(request: &BrokerRequest) -> PreparationDeliveryBinding {
    PreparationDeliveryRequest::decode(&request.body)
        .unwrap()
        .binding
}

fn publication_binding(lease: &BrokerLease) -> Vec<u8> {
    BrokerPublicationBinding {
        reference_digest: [9; 32],
        preparation_operation_id: lease.preparation_operation_id.clone(),
        generation: lease.scope_id,
        launch_digest: lease.launch_digest,
        publication_operation_id: "publish-1".to_owned(),
    }
    .encode()
    .unwrap()
}

fn peer() -> PeerCredentials {
    PeerCredentials {
        pid: 3000,
        uid: 1000,
        gid: 1000,
    }
}

fn identity() -> BrokerServiceIdentity {
    BrokerServiceIdentity {
        install_id: [4; 32],
        key_id: [5; 32],
    }
}

#[test]
fn prepare_is_inert_cgroup_bound_and_durable_before_response() {
    let root = temp_root("prepare");
    let store = DurableLeaseStore::open_for_current_owner(&root).unwrap();
    let guardian = GuardianFixture::new();
    let state = Arc::clone(&guardian.state);
    let service = BrokerServiceCore::new(
        identity(),
        store,
        guardian,
        BrokerCgroupAuthority::new(CgroupFixture::new(), CgroupRequirements::broker_default()),
    )
    .unwrap();
    let prepare_request = request(BrokerOperation::Prepare, b"launch");
    let expected_deadline = prepare_request.deadline_monotonic_ns;
    let response = service.handle(peer(), [8; 32], prepare_request).unwrap();
    let prepared = match response {
        BrokerServiceResponse::Prepared(value) => value,
        other => panic!("unexpected response: {other:?}"),
    };
    assert_eq!(prepared.lease.phase, LeasePhase::Prepared);
    assert_eq!(prepared.lease.cgroup.inode, 9);
    assert_eq!(prepared.client_reference, b"guardian-ref");
    assert_eq!(
        state.lock().unwrap().prepare_deadline,
        Some(expected_deadline)
    );
    assert_eq!(
        service.store().get(&prepared.lease.token).unwrap(),
        Some(prepared.lease)
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn expired_prepared_delivery_commit_exactly_reconciles_guardian_leaf_and_lease() {
    let root = temp_root("prepare-commit-deadline");
    let guardian = GuardianFixture::new();
    let guardian_state = Arc::clone(&guardian.state);
    let cgroups = CgroupFixture::new();
    let cgroup_state = Arc::clone(&cgroups.state);
    let service = BrokerServiceCore::new(
        identity(),
        DurableLeaseStore::open_for_current_owner(&root).unwrap(),
        guardian,
        BrokerCgroupAuthority::new(cgroups, CgroupRequirements::broker_default()),
    )
    .unwrap();
    let prepared = match service
        .handle(
            peer(),
            [8; 32],
            request(BrokerOperation::Prepare, b"launch"),
        )
        .unwrap()
    {
        BrokerServiceResponse::Prepared(value) => value,
        other => panic!("unexpected response: {other:?}"),
    };

    let error = service
        .commit_prepared_delivery_until(
            &prepared,
            MonotonicDeadline::from_duration(Duration::from_nanos(1)).unwrap(),
        )
        .unwrap_err();
    assert_eq!(error.kind(), io::ErrorKind::TimedOut);
    assert_eq!(guardian_state.lock().unwrap().aborted, 1);
    let cgroup = cgroup_state.lock().unwrap();
    assert!(cgroup.killed);
    assert!(cgroup.cleaned);
    assert!(!cgroup.exists);
    drop(cgroup);
    assert!(service.store().load_recoveries().unwrap().is_empty());
    assert_eq!(
        service
            .store()
            .get_delivery(&prepared.delivery_key)
            .unwrap()
            .unwrap()
            .phase,
        BrokerPreparationDeliveryPhase::Reconciled
    );
    let terminal = service.store().get(&prepared.lease.token).unwrap().unwrap();
    assert_eq!(terminal.phase, LeasePhase::CleanupComplete);
    assert_eq!(terminal.terminal, LeaseTerminal::ExactEmpty);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn publish_gate_survives_restart_and_activation_is_exactly_after_it() {
    let root = temp_root("restart");
    let store = DurableLeaseStore::open_for_current_owner(&root).unwrap();
    let service = BrokerServiceCore::new(
        identity(),
        store,
        GuardianFixture::new(),
        BrokerCgroupAuthority::new(CgroupFixture::new(), CgroupRequirements::broker_default()),
    )
    .unwrap();
    let prepared = match service
        .handle(
            peer(),
            [8; 32],
            request(BrokerOperation::Prepare, b"launch"),
        )
        .unwrap()
    {
        BrokerServiceResponse::Prepared(value) => value,
        other => panic!("unexpected response: {other:?}"),
    };
    let mut activate = request(BrokerOperation::Activate, b"guardian-ref");
    let activation_deadline = activate.deadline_monotonic_ns;
    activate.lease_token = Some(prepared.lease.token);
    activate.request_capability = Some(prepared.lease.request_capability);
    assert!(service.handle(peer(), [8; 32], activate.clone()).is_err());

    let mut publish = request(
        BrokerOperation::RecordPublication,
        &publication_binding(&prepared.lease),
    );
    publish.lease_token = Some(prepared.lease.token);
    publish.request_capability = Some(prepared.lease.request_capability);
    service.handle(peer(), [8; 32], publish).unwrap();
    drop(service);

    let replacement_guardian = GuardianFixture::new();
    let replacement_state = Arc::clone(&replacement_guardian.state);
    let replacement = BrokerServiceCore::new(
        identity(),
        DurableLeaseStore::open_for_current_owner(&root).unwrap(),
        replacement_guardian,
        BrokerCgroupAuthority::new(CgroupFixture::new(), CgroupRequirements::broker_default()),
    )
    .unwrap();
    // The fixture models the same surviving leaf after broker owner death.
    replacement.cgroups().kernel().state.lock().unwrap().exists = true;
    replacement.handle(peer(), [8; 32], activate).unwrap();
    assert_eq!(
        replacement_state.lock().unwrap().activation_deadline,
        Some(activation_deadline)
    );
    assert_eq!(
        replacement
            .store()
            .get(&prepared.lease.token)
            .unwrap()
            .unwrap()
            .phase,
        LeasePhase::Activated
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn inspection_durably_orders_exact_root_exit_then_natural_empty_and_replay() {
    let root = temp_root("natural-empty");
    let service = BrokerServiceCore::new(
        identity(),
        DurableLeaseStore::open_for_current_owner(&root).unwrap(),
        GuardianFixture::new(),
        BrokerCgroupAuthority::new(CgroupFixture::new(), CgroupRequirements::broker_default()),
    )
    .unwrap();
    let prepared = match service
        .handle(
            peer(),
            [8; 32],
            request(BrokerOperation::Prepare, b"launch"),
        )
        .unwrap()
    {
        BrokerServiceResponse::Prepared(value) => value,
        other => panic!("unexpected response: {other:?}"),
    };
    let mut publish = request(
        BrokerOperation::RecordPublication,
        &publication_binding(&prepared.lease),
    );
    publish.lease_token = Some(prepared.lease.token);
    publish.request_capability = Some(prepared.lease.request_capability);
    service.handle(peer(), [8; 32], publish).unwrap();
    let mut activate = request(BrokerOperation::Activate, b"guardian-ref");
    activate.lease_token = Some(prepared.lease.token);
    activate.request_capability = Some(prepared.lease.request_capability);
    service.handle(peer(), [8; 32], activate).unwrap();

    let mut inspect = request(BrokerOperation::Inspect, b"guardian-ref");
    inspect.lease_token = Some(prepared.lease.token);
    inspect.request_capability = Some(prepared.lease.request_capability);
    let root_events = vec![
        GuardianEvent::prepared(),
        GuardianEvent::activated(2),
        GuardianEvent::root_exited(3, RootExit::Signal(15)),
    ];
    service.guardian().state.lock().unwrap().events = Some(root_events.clone());
    let BrokerServiceResponse::Observed(encoded_root) =
        service.handle(peer(), [8; 32], inspect.clone()).unwrap()
    else {
        panic!("root exit inspection was not observed");
    };
    assert_eq!(
        GuardianEvent::decode_journal(&encoded_root).unwrap(),
        root_events
    );
    assert_eq!(
        service
            .store()
            .get(&prepared.lease.token)
            .unwrap()
            .unwrap()
            .phase,
        LeasePhase::RootExited
    );

    let empty_events = vec![
        GuardianEvent::prepared(),
        GuardianEvent::activated(2),
        GuardianEvent::root_exited(3, RootExit::Signal(15)),
        GuardianEvent::exact_empty(4),
    ];
    service.guardian().state.lock().unwrap().events = Some(empty_events.clone());
    let BrokerServiceResponse::Observed(encoded_empty) =
        service.handle(peer(), [8; 32], inspect.clone()).unwrap()
    else {
        panic!("natural empty inspection was not observed");
    };
    assert_eq!(
        GuardianEvent::decode_journal(&encoded_empty).unwrap(),
        empty_events
    );
    assert_eq!(
        service
            .store()
            .get(&prepared.lease.token)
            .unwrap()
            .unwrap()
            .phase,
        LeasePhase::CleanupComplete
    );
    assert_eq!(
        service.handle(peer(), [8; 32], inspect).unwrap(),
        BrokerServiceResponse::ExactScopeEmpty(encoded_empty)
    );

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn activation_pending_replays_after_broker_death_without_republishing() {
    let root = temp_root("activation-pending");
    let service = BrokerServiceCore::new(
        identity(),
        DurableLeaseStore::open_for_current_owner(&root).unwrap(),
        GuardianFixture::new(),
        BrokerCgroupAuthority::new(CgroupFixture::new(), CgroupRequirements::broker_default()),
    )
    .unwrap();
    let prepared = match service
        .handle(
            peer(),
            [8; 32],
            request(BrokerOperation::Prepare, b"launch"),
        )
        .unwrap()
    {
        BrokerServiceResponse::Prepared(value) => value,
        other => panic!("unexpected response: {other:?}"),
    };
    let mut publish = request(
        BrokerOperation::RecordPublication,
        &publication_binding(&prepared.lease),
    );
    publish.lease_token = Some(prepared.lease.token);
    publish.request_capability = Some(prepared.lease.request_capability);
    service.handle(peer(), [8; 32], publish).unwrap();

    let mut activate = request(BrokerOperation::Activate, b"guardian-ref");
    activate.lease_token = Some(prepared.lease.token);
    activate.request_capability = Some(prepared.lease.request_capability);
    service
        .guardian()
        .state
        .lock()
        .unwrap()
        .fail_next_activation = true;
    assert!(service.handle(peer(), [8; 32], activate.clone()).is_err());
    assert_eq!(
        service
            .store()
            .get(&prepared.lease.token)
            .unwrap()
            .unwrap()
            .phase,
        LeasePhase::ActivationPending
    );
    drop(service);

    let replacement = BrokerServiceCore::new(
        identity(),
        DurableLeaseStore::open_for_current_owner(&root).unwrap(),
        GuardianFixture::new(),
        BrokerCgroupAuthority::new(CgroupFixture::new(), CgroupRequirements::broker_default()),
    )
    .unwrap();
    replacement.cgroups().kernel().state.lock().unwrap().exists = true;
    assert_eq!(
        replacement.handle(peer(), [8; 32], activate).unwrap(),
        BrokerServiceResponse::Activated
    );
    assert_eq!(
        replacement
            .store()
            .get(&prepared.lease.token)
            .unwrap()
            .unwrap()
            .phase,
        LeasePhase::Activated
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn caller_capability_or_install_drift_performs_no_control() {
    let root = temp_root("auth");
    let store = DurableLeaseStore::open_for_current_owner(&root).unwrap();
    let service = BrokerServiceCore::new(
        identity(),
        store,
        GuardianFixture::new(),
        BrokerCgroupAuthority::new(CgroupFixture::new(), CgroupRequirements::broker_default()),
    )
    .unwrap();
    let prepared = match service
        .handle(
            peer(),
            [8; 32],
            request(BrokerOperation::Prepare, b"launch"),
        )
        .unwrap()
    {
        BrokerServiceResponse::Prepared(value) => value,
        other => panic!("unexpected response: {other:?}"),
    };
    let mut reopen = request(BrokerOperation::Reopen, b"guardian-ref");
    reopen.lease_token = Some(prepared.lease.token);
    reopen.request_capability = Some([99; 32]);
    assert!(service.handle(peer(), [8; 32], reopen).is_err());
    assert_eq!(service.guardian().state.lock().unwrap().reopened, 0);
    assert!(!service.cgroups().kernel().state.lock().unwrap().killed);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn termination_records_exact_empty_before_leaf_and_lease_cleanup() {
    let root = temp_root("terminate");
    let store = DurableLeaseStore::open_for_current_owner(&root).unwrap();
    let service = BrokerServiceCore::new(
        identity(),
        store,
        GuardianFixture::new(),
        BrokerCgroupAuthority::new(CgroupFixture::new(), CgroupRequirements::broker_default()),
    )
    .unwrap();
    let prepared = match service
        .handle(
            peer(),
            [8; 32],
            request(BrokerOperation::Prepare, b"launch"),
        )
        .unwrap()
    {
        BrokerServiceResponse::Prepared(value) => value,
        other => panic!("unexpected response: {other:?}"),
    };
    let terminal_events = vec![GuardianEvent::prepared(), GuardianEvent::exact_empty(2)];
    service.guardian().state.lock().unwrap().events = Some(terminal_events.clone());
    let encoded_terminal = GuardianEvent::encode_journal(&terminal_events).unwrap();
    let mut abort = request(BrokerOperation::Abort, b"guardian-ref");
    abort.lease_token = Some(prepared.lease.token);
    abort.request_capability = Some(prepared.lease.request_capability);
    assert_eq!(
        service.handle(peer(), [8; 32], abort).unwrap(),
        BrokerServiceResponse::ExactScopeEmpty(encoded_terminal.clone())
    );
    let state = service.cgroups().kernel().state.lock().unwrap();
    assert!(state.killed);
    assert!(state.cleaned);
    drop(state);
    let tombstone = service.store().get(&prepared.lease.token).unwrap().unwrap();
    assert_eq!(tombstone.phase, LeasePhase::CleanupComplete);
    assert_eq!(tombstone.terminal, LeaseTerminal::ExactEmpty);

    let mut repeated = request(BrokerOperation::Terminate { grace_ms: 0 }, b"guardian-ref");
    repeated.lease_token = Some(prepared.lease.token);
    repeated.request_capability = Some(prepared.lease.request_capability);
    assert_eq!(
        service.handle(peer(), [8; 32], repeated).unwrap(),
        BrokerServiceResponse::ExactScopeEmpty(encoded_terminal)
    );
    assert_eq!(
        service.store().get(&prepared.lease.token).unwrap(),
        Some(tombstone)
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn authenticated_terminal_cleanup_converts_delivered_ownership_to_a_prunable_tombstone() {
    let root = temp_root("delivered-terminal-reclaim");
    let service = BrokerServiceCore::new(
        identity(),
        DurableLeaseStore::open_for_current_owner(&root).unwrap(),
        GuardianFixture::new(),
        BrokerCgroupAuthority::new(CgroupFixture::new(), CgroupRequirements::broker_default()),
    )
    .unwrap();
    let prepare = request(BrokerOperation::Prepare, b"launch");
    let binding = prepare_binding(&prepare);
    let prepared = match service.handle(peer(), [8; 32], prepare).unwrap() {
        BrokerServiceResponse::Prepared(value) => value,
        other => panic!("unexpected response: {other:?}"),
    };
    let response_body = prepared.encode_client_reference().unwrap();
    service.commit_prepared_delivery(&prepared).unwrap();
    let acknowledgement = PreparationDeliveryAcknowledgement {
        binding,
        reference_digest: Sha256::digest(&response_body).into(),
    };
    let mut ack = request(
        BrokerOperation::AcknowledgePreparation,
        &acknowledgement.encode().unwrap(),
    );
    ack.lease_token = Some(prepared.lease.token);
    ack.request_capability = Some(prepared.lease.request_capability);
    assert_eq!(
        service.handle(peer(), [8; 32], ack).unwrap(),
        BrokerServiceResponse::PreparationAcknowledged
    );
    assert_eq!(
        service
            .store()
            .get_delivery(&prepared.delivery_key)
            .unwrap()
            .unwrap()
            .phase,
        BrokerPreparationDeliveryPhase::Delivered
    );

    let terminal_events = vec![GuardianEvent::prepared(), GuardianEvent::exact_empty(2)];
    let encoded_terminal = GuardianEvent::encode_journal(&terminal_events).unwrap();
    service.guardian().state.lock().unwrap().events = Some(terminal_events);
    let mut abort = request(BrokerOperation::Abort, b"guardian-ref");
    abort.lease_token = Some(prepared.lease.token);
    abort.request_capability = Some(prepared.lease.request_capability);
    assert_eq!(
        service.handle(peer(), [8; 32], abort.clone()).unwrap(),
        BrokerServiceResponse::ExactScopeEmpty(encoded_terminal.clone())
    );
    let tombstone = service
        .store()
        .get_delivery(&prepared.delivery_key)
        .unwrap()
        .unwrap();
    assert_eq!(tombstone.phase, BrokerPreparationDeliveryPhase::Reconciled);
    assert_eq!(tombstone.lease_token, None);
    assert!(service.store().load_recoveries().unwrap().is_empty());
    assert_eq!(
        service.handle(peer(), [8; 32], abort).unwrap(),
        BrokerServiceResponse::ExactScopeEmpty(encoded_terminal)
    );

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn authenticated_abort_before_ack_reconciles_pending_delivery_and_recovery() {
    let root = temp_root("pending-ack-abort-reclaim");
    let service = BrokerServiceCore::new(
        identity(),
        DurableLeaseStore::open_for_current_owner(&root).unwrap(),
        GuardianFixture::new(),
        BrokerCgroupAuthority::new(CgroupFixture::new(), CgroupRequirements::broker_default()),
    )
    .unwrap();
    let prepared = match service
        .handle(
            peer(),
            [8; 32],
            request(BrokerOperation::Prepare, b"launch"),
        )
        .unwrap()
    {
        BrokerServiceResponse::Prepared(value) => value,
        other => panic!("unexpected response: {other:?}"),
    };
    service.commit_prepared_delivery(&prepared).unwrap();
    assert_eq!(
        service
            .store()
            .get_delivery(&prepared.delivery_key)
            .unwrap()
            .unwrap()
            .phase,
        BrokerPreparationDeliveryPhase::PreparedPendingAck
    );
    assert_eq!(service.store().load_recoveries().unwrap().len(), 1);

    let terminal_events = vec![GuardianEvent::prepared(), GuardianEvent::exact_empty(2)];
    let encoded_terminal = GuardianEvent::encode_journal(&terminal_events).unwrap();
    service.guardian().state.lock().unwrap().events = Some(terminal_events);
    let mut abort = request(BrokerOperation::Abort, b"guardian-ref");
    abort.lease_token = Some(prepared.lease.token);
    abort.request_capability = Some(prepared.lease.request_capability);
    assert_eq!(
        service.handle(peer(), [8; 32], abort).unwrap(),
        BrokerServiceResponse::ExactScopeEmpty(encoded_terminal)
    );
    let delivery = service
        .store()
        .get_delivery(&prepared.delivery_key)
        .unwrap()
        .unwrap();
    assert_eq!(delivery.phase, BrokerPreparationDeliveryPhase::Reconciled);
    assert_eq!(delivery.lease_token, None);
    assert!(delivery.response_body.is_empty());
    assert_eq!(delivery.reference_digest, None);
    assert!(service.store().load_recoveries().unwrap().is_empty());

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn fresh_broker_recovers_terminal_crashes_before_or_after_leaf_removal() {
    for leaf_was_removed in [false, true] {
        let root = temp_root(if leaf_was_removed {
            "terminal-after-leaf-removal"
        } else {
            "terminal-before-leaf-removal"
        });
        let guardian = GuardianFixture::new();
        let cgroup = CgroupFixture::new();
        let service = BrokerServiceCore::new(
            identity(),
            DurableLeaseStore::open_for_current_owner(&root).unwrap(),
            guardian.clone(),
            BrokerCgroupAuthority::new(cgroup.clone(), CgroupRequirements::broker_default()),
        )
        .unwrap();
        let prepared = match service
            .handle(
                peer(),
                [8; 32],
                request(BrokerOperation::Prepare, b"launch"),
            )
            .unwrap()
        {
            BrokerServiceResponse::Prepared(value) => value,
            other => panic!("unexpected response: {other:?}"),
        };
        let terminal = BrokerLease {
            phase: LeasePhase::ExactScopeEmpty,
            terminal: LeaseTerminal::ExactEmpty,
            terminal_history: LeaseTerminalHistory::EventGap,
            ..prepared.lease.clone()
        };
        service.store().replace(&prepared.lease, &terminal).unwrap();
        if leaf_was_removed {
            cgroup.state.lock().unwrap().exists = false;
        }
        drop(service);

        let replacement = BrokerServiceCore::new(
            identity(),
            DurableLeaseStore::open_for_current_owner(&root).unwrap(),
            guardian,
            BrokerCgroupAuthority::new(cgroup, CgroupRequirements::broker_default()),
        )
        .unwrap();
        let tombstone = replacement
            .store()
            .get(&prepared.lease.token)
            .unwrap()
            .unwrap();
        assert_eq!(tombstone.phase, LeasePhase::CleanupComplete);
        assert_eq!(tombstone.terminal, LeaseTerminal::ExactEmpty);

        let mut repeated = request(BrokerOperation::Abort, b"guardian-ref");
        repeated.lease_token = Some(prepared.lease.token);
        repeated.request_capability = Some(prepared.lease.request_capability);
        assert_eq!(
            replacement.handle(peer(), [8; 32], repeated).unwrap(),
            BrokerServiceResponse::EventGap
        );

        fs::remove_dir_all(root).unwrap();
    }
}

#[test]
fn ambiguous_prepare_cleanup_retains_recovery_until_a_fresh_broker_proves_empty() {
    let root = temp_root("prepare-recovery");
    let guardian = GuardianFixture::new();
    let cgroup = CgroupFixture::new();
    {
        let mut state = cgroup.state.lock().unwrap();
        state.fail_place_once = true;
        state.fail_kill_once = true;
    }
    let service = BrokerServiceCore::new(
        identity(),
        DurableLeaseStore::open_for_current_owner(&root).unwrap(),
        guardian.clone(),
        BrokerCgroupAuthority::new(cgroup.clone(), CgroupRequirements::broker_default()),
    )
    .unwrap();
    assert!(service
        .handle(
            peer(),
            [8; 32],
            request(BrokerOperation::Prepare, b"launch"),
        )
        .is_err());
    assert_eq!(service.store().load_recoveries().unwrap().len(), 1);
    assert!(cgroup.state.lock().unwrap().exists);
    assert_eq!(guardian.state.lock().unwrap().aborted, 0);
    drop(service);

    let replacement = BrokerServiceCore::new(
        identity(),
        DurableLeaseStore::open_for_current_owner(&root).unwrap(),
        guardian.clone(),
        BrokerCgroupAuthority::new(cgroup.clone(), CgroupRequirements::broker_default()),
    )
    .unwrap();
    assert!(replacement.store().load_recoveries().unwrap().is_empty());
    assert_eq!(
        replacement.store().load_deliveries().unwrap()[0].phase,
        BrokerPreparationDeliveryPhase::Reconciled
    );
    assert!(!cgroup.state.lock().unwrap().exists);
    assert_eq!(guardian.state.lock().unwrap().aborted, 1);

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn prepared_response_loss_replays_the_same_durable_authority() {
    let root = temp_root("prepared-response-loss");
    let prepare_request = request(BrokerOperation::Prepare, b"launch");
    let pending = BrokerRequestRecord {
        request_id: prepare_request.request_id,
        request_digest: prepare_request.replay_digest().unwrap(),
        caller_uid: prepare_request.caller_uid,
        deadline_monotonic_ns: prepare_request.deadline_monotonic_ns,
        response_code: None,
        response_body: Vec::new(),
    };
    let service = BrokerServiceCore::new(
        identity(),
        DurableLeaseStore::open_for_current_owner(&root).unwrap(),
        GuardianFixture::new(),
        BrokerCgroupAuthority::new(CgroupFixture::new(), CgroupRequirements::broker_default()),
    )
    .unwrap();
    service.store().put_request(&pending).unwrap();
    let prepared = match service
        .handle(peer(), [8; 32], prepare_request.clone())
        .unwrap()
    {
        BrokerServiceResponse::Prepared(value) => value,
        other => panic!("unexpected response: {other:?}"),
    };
    service.commit_prepared_delivery(&prepared).unwrap();
    let prepared_wire = prepared.encode_client_reference().unwrap();
    drop(service);

    let replacement = BrokerServiceCore::new(
        identity(),
        DurableLeaseStore::open_for_current_owner(&root).unwrap(),
        GuardianFixture::new(),
        BrokerCgroupAuthority::new(CgroupFixture::new(), CgroupRequirements::broker_default()),
    )
    .unwrap();
    replacement.cgroups().kernel().state.lock().unwrap().exists = true;
    let mut recover = request(
        BrokerOperation::RecoverPreparation,
        &prepare_binding(&prepare_request).encode().unwrap(),
    );
    recover.request_id = [17; 16];
    assert_eq!(
        replacement.handle(peer(), [8; 32], recover).unwrap(),
        BrokerServiceResponse::PreparedDelivery(prepared_wire)
    );
    assert_eq!(replacement.store().load_recoveries().unwrap().len(), 1);

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn replacement_recovers_pending_delivery_with_a_new_attempt_and_ack_retires_recovery() {
    let root = temp_root("stable-prepared-delivery");
    let mut prepare = request(BrokerOperation::Prepare, b"launch");
    prepare.request_id = [31; 16];
    let binding = prepare_binding(&prepare);
    let service = BrokerServiceCore::new(
        identity(),
        DurableLeaseStore::open_for_current_owner(&root).unwrap(),
        GuardianFixture::new(),
        BrokerCgroupAuthority::new(CgroupFixture::new(), CgroupRequirements::broker_default()),
    )
    .unwrap();
    let prepared = match service.handle(peer(), [8; 32], prepare).unwrap() {
        BrokerServiceResponse::Prepared(value) => value,
        other => panic!("unexpected response: {other:?}"),
    };
    let response_body = prepared.encode_client_reference().unwrap();
    let mismatched = BrokerPrepared {
        lease: BrokerLease {
            token: [77; 32],
            ..prepared.lease.clone()
        },
        ..prepared.clone()
    };
    assert!(service.commit_prepared_delivery(&mismatched).is_err());
    service.commit_prepared_delivery(&prepared).unwrap();
    drop(service);

    let guardian = GuardianFixture::new();
    let replacement = BrokerServiceCore::new(
        identity(),
        DurableLeaseStore::open_for_current_owner(&root).unwrap(),
        guardian.clone(),
        BrokerCgroupAuthority::new(CgroupFixture::new(), CgroupRequirements::broker_default()),
    )
    .unwrap();
    replacement.cgroups().kernel().state.lock().unwrap().exists = true;
    let mut recover = request(
        BrokerOperation::RecoverPreparation,
        &binding.encode().unwrap(),
    );
    recover.request_id = [32; 16];
    let replay = replacement.handle(peer(), [8; 32], recover).unwrap();
    assert_eq!(
        replay,
        BrokerServiceResponse::PreparedDelivery(response_body.clone())
    );
    assert_eq!(guardian.state.lock().unwrap().prepared, 0);

    let wrong_binding = PreparationDeliveryBinding {
        recovery_capability: [99; 32],
        ..binding.clone()
    };
    let wrong = request(
        BrokerOperation::RecoverPreparation,
        &wrong_binding.encode().unwrap(),
    );
    assert!(replacement.handle(peer(), [8; 32], wrong).is_err());

    let reference_digest: [u8; 32] = Sha256::digest(&response_body).into();
    let acknowledgement = PreparationDeliveryAcknowledgement {
        binding,
        reference_digest,
    };
    let mut ack = request(
        BrokerOperation::AcknowledgePreparation,
        &acknowledgement.encode().unwrap(),
    );
    ack.lease_token = Some(prepared.lease.token);
    ack.request_capability = Some(prepared.lease.request_capability);
    assert_eq!(
        replacement.handle(peer(), [8; 32], ack.clone()).unwrap(),
        BrokerServiceResponse::PreparationAcknowledged
    );
    assert_eq!(
        replacement.handle(peer(), [8; 32], ack).unwrap(),
        BrokerServiceResponse::PreparationAcknowledged
    );
    assert!(replacement.store().load_recoveries().unwrap().is_empty());

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn restart_reconciles_the_exact_empty_leaf_created_before_leaf_identity_commit() {
    let root = temp_root("leaf-create-before-identity-commit");
    let prepare = request(BrokerOperation::Prepare, b"launch");
    let binding = prepare_binding(&prepare);
    let delivery_key = binding
        .delivery_key(1000, &identity().install_id, &identity().key_id)
        .unwrap();
    let recovery_id = [44; 32];
    let store = DurableLeaseStore::open_for_current_owner(&root).unwrap();
    let preparing = BrokerPreparationDeliveryRecord {
        delivery_key,
        caller_uid: 1000,
        preparation_operation_id: binding.preparation_operation_id.clone(),
        prepare_digest: binding.prepare_digest,
        launch_digest: binding.launch_digest,
        broker_install_id: identity().install_id,
        broker_key_id: identity().key_id,
        capability_hash: binding.capability_hash().unwrap(),
        original_deadline_monotonic_ns: prepare.deadline_monotonic_ns,
        phase: BrokerPreparationDeliveryPhase::Preparing,
        recovery_id: Some(recovery_id),
        lease_token: None,
        response_body: Vec::new(),
        reference_digest: None,
    };
    store.put_delivery(&preparing).unwrap();
    let leaf_creating = BrokerRecoveryRecord {
        recovery_id,
        request_id: prepare.request_id,
        request_digest: prepare.replay_digest().unwrap(),
        caller_uid: 1000,
        broker_install_id: identity().install_id,
        broker_key_id: identity().key_id,
        phase: BrokerRecoveryPhase::LeafCreating,
        scope_id: Some([3; 16]),
        guardian: Some(AuthorityIdentity {
            boot_id: "7dc44f16-8f9d-4ad8-a233-44bbd0704848".to_owned(),
            guardian_pid: 4242,
            start_ticks: 777,
            pid_namespace_device: 4,
            pid_namespace_inode: 99,
        }),
        client_reference: b"guardian-ref".to_vec(),
        cgroup: None,
    };
    store.put_recovery(&leaf_creating).unwrap();
    drop(store);

    let guardian = GuardianFixture::new();
    let cgroup = CgroupFixture::new();
    {
        let mut state = cgroup.state.lock().unwrap();
        state.exists = true;
        state.created = 1;
        state.populated = VecDeque::from([false]);
    }
    let replacement = BrokerServiceCore::new(
        identity(),
        DurableLeaseStore::open_for_current_owner(&root).unwrap(),
        guardian.clone(),
        BrokerCgroupAuthority::new(cgroup.clone(), CgroupRequirements::broker_default()),
    )
    .unwrap();
    let state = cgroup.state.lock().unwrap();
    assert!(state.cleaned);
    assert!(!state.exists);
    assert_eq!(state.created, 1);
    drop(state);
    assert_eq!(guardian.state.lock().unwrap().aborted, 1);
    assert!(replacement.store().load_recoveries().unwrap().is_empty());
    assert!(replacement.store().load_all().unwrap().is_empty());
    assert_eq!(
        replacement
            .store()
            .get_delivery(&delivery_key)
            .unwrap()
            .unwrap()
            .phase,
        BrokerPreparationDeliveryPhase::Reconciled
    );

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn broker_operation_index_rejects_prepare_digest_drift_before_second_authority_across_restart() {
    let root = temp_root("operation-index-digest-drift");
    let guardian = GuardianFixture::new();
    let cgroup = CgroupFixture::new();
    let first = request(BrokerOperation::Prepare, b"launch");
    let original_deadline = first.deadline_monotonic_ns;
    let service = BrokerServiceCore::new(
        identity(),
        DurableLeaseStore::open_for_current_owner(&root).unwrap(),
        guardian.clone(),
        BrokerCgroupAuthority::new(cgroup.clone(), CgroupRequirements::broker_default()),
    )
    .unwrap();
    assert!(matches!(
        service.handle(peer(), [8; 32], first).unwrap(),
        BrokerServiceResponse::Prepared(_)
    ));
    assert_eq!(guardian.state.lock().unwrap().prepared, 1);
    assert_eq!(cgroup.state.lock().unwrap().created, 1);
    assert_eq!(service.store().load_deliveries().unwrap().len(), 1);
    assert_eq!(service.store().load_recoveries().unwrap().len(), 1);
    assert_eq!(service.store().load_all().unwrap().len(), 1);

    let mut conflicting = request(BrokerOperation::Prepare, b"launch-drift");
    conflicting.deadline_monotonic_ns = original_deadline;
    assert_eq!(
        service
            .handle(peer(), [8; 32], conflicting.clone())
            .unwrap_err()
            .kind(),
        io::ErrorKind::PermissionDenied
    );
    drop(service);

    let replacement = BrokerServiceCore::new(
        identity(),
        DurableLeaseStore::open_for_current_owner(&root).unwrap(),
        guardian.clone(),
        BrokerCgroupAuthority::new(cgroup.clone(), CgroupRequirements::broker_default()),
    )
    .unwrap();
    assert_eq!(
        replacement
            .handle(peer(), [8; 32], conflicting)
            .unwrap_err()
            .kind(),
        io::ErrorKind::PermissionDenied
    );
    assert_eq!(guardian.state.lock().unwrap().prepared, 1);
    assert_eq!(cgroup.state.lock().unwrap().created, 1);
    assert_eq!(replacement.store().load_deliveries().unwrap().len(), 1);
    assert_eq!(replacement.store().load_recoveries().unwrap().len(), 1);
    assert_eq!(replacement.store().load_all().unwrap().len(), 1);

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn daemon_restart_after_lease_commit_reconstructs_pending_delivery_before_replay() {
    let root = temp_root("lease-before-pending-crash");
    let prepare = request(BrokerOperation::Prepare, b"launch");
    let binding = prepare_binding(&prepare);
    let service = BrokerServiceCore::new(
        identity(),
        DurableLeaseStore::open_for_current_owner(&root).unwrap(),
        GuardianFixture::new(),
        BrokerCgroupAuthority::new(CgroupFixture::new(), CgroupRequirements::broker_default()),
    )
    .unwrap();
    let prepared = match service.handle(peer(), [8; 32], prepare).unwrap() {
        BrokerServiceResponse::Prepared(value) => value,
        other => panic!("unexpected response: {other:?}"),
    };
    assert_eq!(
        service
            .store()
            .get_delivery(&prepared.delivery_key)
            .unwrap()
            .unwrap()
            .phase,
        BrokerPreparationDeliveryPhase::Preparing
    );
    let exact_response = prepared.encode_client_reference().unwrap();
    drop(service);

    let replacement = BrokerServiceCore::new(
        identity(),
        DurableLeaseStore::open_for_current_owner(&root).unwrap(),
        GuardianFixture::new(),
        BrokerCgroupAuthority::new(CgroupFixture::new(), CgroupRequirements::broker_default()),
    )
    .unwrap();
    let pending = replacement
        .store()
        .get_delivery(&prepared.delivery_key)
        .unwrap()
        .unwrap();
    assert_eq!(
        pending.phase,
        BrokerPreparationDeliveryPhase::PreparedPendingAck
    );
    assert_eq!(pending.response_body, exact_response);
    assert_eq!(replacement.store().load_recoveries().unwrap().len(), 1);
    let mut recover = request(
        BrokerOperation::RecoverPreparation,
        &binding.encode().unwrap(),
    );
    recover.request_id = [55; 16];
    assert_eq!(
        replacement.handle(peer(), [8; 32], recover).unwrap(),
        BrokerServiceResponse::PreparedDelivery(exact_response)
    );

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn delivered_restart_finishes_provisional_recovery_retirement_before_duplicate_ack() {
    let root = temp_root("delivered-ack-crash");
    let prepare = request(BrokerOperation::Prepare, b"launch");
    let binding = prepare_binding(&prepare);
    let service = BrokerServiceCore::new(
        identity(),
        DurableLeaseStore::open_for_current_owner(&root).unwrap(),
        GuardianFixture::new(),
        BrokerCgroupAuthority::new(CgroupFixture::new(), CgroupRequirements::broker_default()),
    )
    .unwrap();
    let prepared = match service.handle(peer(), [8; 32], prepare).unwrap() {
        BrokerServiceResponse::Prepared(value) => value,
        other => panic!("unexpected response: {other:?}"),
    };
    let response_body = prepared.encode_client_reference().unwrap();
    service.commit_prepared_delivery(&prepared).unwrap();
    let pending = service
        .store()
        .get_delivery(&prepared.delivery_key)
        .unwrap()
        .unwrap();
    let delivered = BrokerPreparationDeliveryRecord {
        phase: BrokerPreparationDeliveryPhase::Delivered,
        response_body: Vec::new(),
        ..pending.clone()
    };
    service
        .store()
        .replace_delivery(&pending, &delivered)
        .unwrap();
    assert_eq!(service.store().load_recoveries().unwrap().len(), 1);
    drop(service);

    let replacement = BrokerServiceCore::new(
        identity(),
        DurableLeaseStore::open_for_current_owner(&root).unwrap(),
        GuardianFixture::new(),
        BrokerCgroupAuthority::new(CgroupFixture::new(), CgroupRequirements::broker_default()),
    )
    .unwrap();
    replacement.cgroups().kernel().state.lock().unwrap().exists = true;
    assert!(replacement.store().load_recoveries().unwrap().is_empty());
    let acknowledgement = PreparationDeliveryAcknowledgement {
        binding,
        reference_digest: Sha256::digest(&response_body).into(),
    };
    let mut ack = request(
        BrokerOperation::AcknowledgePreparation,
        &acknowledgement.encode().unwrap(),
    );
    ack.lease_token = Some(prepared.lease.token);
    ack.request_capability = Some(prepared.lease.request_capability);
    assert_eq!(
        replacement.handle(peer(), [8; 32], ack).unwrap(),
        BrokerServiceResponse::PreparationAcknowledged
    );

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn concurrent_publish_and_abort_cannot_resurrect_a_terminal_lease() {
    let root = temp_root("publish-abort-race");
    let service = Arc::new(
        BrokerServiceCore::new(
            identity(),
            DurableLeaseStore::open_for_current_owner(&root).unwrap(),
            GuardianFixture::new(),
            BrokerCgroupAuthority::new(CgroupFixture::new(), CgroupRequirements::broker_default()),
        )
        .unwrap(),
    );
    let prepared = match service
        .handle(
            peer(),
            [8; 32],
            request(BrokerOperation::Prepare, b"launch"),
        )
        .unwrap()
    {
        BrokerServiceResponse::Prepared(value) => value,
        other => panic!("unexpected response: {other:?}"),
    };
    service.guardian().state.lock().unwrap().events = Some(vec![
        GuardianEvent::prepared(),
        GuardianEvent::exact_empty(2),
    ]);
    let mut publish = request(
        BrokerOperation::RecordPublication,
        &publication_binding(&prepared.lease),
    );
    publish.lease_token = Some(prepared.lease.token);
    publish.request_capability = Some(prepared.lease.request_capability);
    let mut abort = request(BrokerOperation::Abort, b"guardian-ref");
    abort.lease_token = Some(prepared.lease.token);
    abort.request_capability = Some(prepared.lease.request_capability);
    let barrier = Arc::new(Barrier::new(3));
    let publish_worker = {
        let service = Arc::clone(&service);
        let barrier = Arc::clone(&barrier);
        thread::spawn(move || {
            barrier.wait();
            service.handle(peer(), [8; 32], publish)
        })
    };
    let abort_worker = {
        let service = Arc::clone(&service);
        let barrier = Arc::clone(&barrier);
        thread::spawn(move || {
            barrier.wait();
            service.handle(peer(), [8; 32], abort)
        })
    };
    barrier.wait();
    let _ = publish_worker.join().unwrap();
    abort_worker.join().unwrap().unwrap();
    let terminal = service.store().get(&prepared.lease.token).unwrap().unwrap();
    assert_eq!(terminal.phase, LeasePhase::CleanupComplete);
    assert_eq!(terminal.terminal, LeaseTerminal::ExactEmpty);

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn concurrent_activate_and_terminate_converge_without_phase_resurrection() {
    let root = temp_root("activate-terminate-race");
    let service = Arc::new(
        BrokerServiceCore::new(
            identity(),
            DurableLeaseStore::open_for_current_owner(&root).unwrap(),
            GuardianFixture::new(),
            BrokerCgroupAuthority::new(CgroupFixture::new(), CgroupRequirements::broker_default()),
        )
        .unwrap(),
    );
    let prepared = match service
        .handle(
            peer(),
            [8; 32],
            request(BrokerOperation::Prepare, b"launch"),
        )
        .unwrap()
    {
        BrokerServiceResponse::Prepared(value) => value,
        other => panic!("unexpected response: {other:?}"),
    };
    let mut publish = request(
        BrokerOperation::RecordPublication,
        &publication_binding(&prepared.lease),
    );
    publish.lease_token = Some(prepared.lease.token);
    publish.request_capability = Some(prepared.lease.request_capability);
    service.handle(peer(), [8; 32], publish).unwrap();
    service.guardian().state.lock().unwrap().events = Some(vec![
        GuardianEvent::prepared(),
        GuardianEvent::exact_empty(2),
    ]);
    let mut activate = request(BrokerOperation::Activate, b"guardian-ref");
    activate.lease_token = Some(prepared.lease.token);
    activate.request_capability = Some(prepared.lease.request_capability);
    let mut terminate = request(BrokerOperation::Terminate { grace_ms: 0 }, b"guardian-ref");
    terminate.lease_token = Some(prepared.lease.token);
    terminate.request_capability = Some(prepared.lease.request_capability);
    let barrier = Arc::new(Barrier::new(3));
    let activate_worker = {
        let service = Arc::clone(&service);
        let barrier = Arc::clone(&barrier);
        thread::spawn(move || {
            barrier.wait();
            service.handle(peer(), [8; 32], activate)
        })
    };
    let terminate_worker = {
        let service = Arc::clone(&service);
        let barrier = Arc::clone(&barrier);
        thread::spawn(move || {
            barrier.wait();
            service.handle(peer(), [8; 32], terminate)
        })
    };
    barrier.wait();
    let _ = activate_worker.join().unwrap();
    terminate_worker.join().unwrap().unwrap();
    let terminal = service.store().get(&prepared.lease.token).unwrap().unwrap();
    assert_eq!(terminal.phase, LeasePhase::CleanupComplete);
    assert_eq!(terminal.terminal, LeaseTerminal::ExactEmpty);

    fs::remove_dir_all(root).unwrap();
}

#[cfg(target_os = "linux")]
const PROCESS_FIXTURE_ROLE: &str = "RASEN_BROKER_DELIVERY_PROCESS_ROLE";

#[cfg(target_os = "linux")]
fn fixture_path(name: &str) -> PathBuf {
    PathBuf::from(std::env::var(name).expect("process fixture path is required"))
}

#[cfg(target_os = "linux")]
fn wait_for_fixture_path(path: &std::path::Path) -> io::Result<()> {
    for _ in 0..1_000 {
        if path.exists() {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(10));
    }
    Err(io::Error::new(
        io::ErrorKind::TimedOut,
        format!("process fixture marker did not arrive: {}", path.display()),
    ))
}

#[cfg(target_os = "linux")]
fn process_fixture_service(
    state_root: &std::path::Path,
) -> io::Result<BrokerServiceCore<GuardianFixture, CgroupFixture>> {
    BrokerServiceCore::new(
        identity(),
        DurableLeaseStore::open_for_current_owner(state_root)?,
        GuardianFixture::new(),
        BrokerCgroupAuthority::new(CgroupFixture::new(), CgroupRequirements::broker_default()),
    )
}

#[cfg(target_os = "linux")]
fn run_process_fixture_daemon() -> io::Result<()> {
    let state_root = fixture_path("RASEN_BROKER_DELIVERY_STATE_ROOT");
    let socket = fixture_path("RASEN_BROKER_DELIVERY_SOCKET");
    let marker_root = fixture_path("RASEN_BROKER_DELIVERY_MARKER_ROOT");
    let _ = fs::remove_file(&socket);
    let listener = UnixListener::bind(&socket)?;
    listener.set_nonblocking(true)?;
    let service = process_fixture_service(&state_root)?;
    let signer = SigningBrokerIdentity::from_seed([42; 32])?;
    let transactions = BrokerDaemonTransactions::new();
    let observer = DeliveryCommitObserver {
        marker_root: marker_root.clone(),
    };
    fs::write(marker_root.join("daemon-ready"), b"ready")?;

    while !marker_root.join("daemon-stop").exists() {
        let (mut stream, _) = match listener.accept() {
            Ok(value) => value,
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(5));
                continue;
            }
            Err(error) => return Err(error),
        };
        stream.set_read_timeout(Some(Duration::from_secs(5)))?;
        stream.set_write_timeout(Some(Duration::from_secs(5)))?;
        let _ = transactions.handle_one_observed(&mut stream, &signer, &service, &observer);
        if marker_root.join("prepare-committed").exists()
            && marker_root.join("allow-prepare-response").exists()
            && !marker_root.join("prepare-response-attempted").exists()
        {
            fs::write(marker_root.join("prepare-response-attempted"), b"attempted")?;
        }
        if marker_root.join("ack-committed").exists()
            && marker_root.join("allow-ack-response").exists()
            && !marker_root.join("ack-response-attempted").exists()
        {
            fs::write(marker_root.join("ack-response-attempted"), b"attempted")?;
        }
    }
    Ok(())
}

#[cfg(target_os = "linux")]
struct DeliveryCommitObserver {
    marker_root: PathBuf,
}

#[cfg(target_os = "linux")]
impl BrokerTransactionObserver for DeliveryCommitObserver {
    fn before_response(
        &self,
        operation: BrokerOperation,
        _request_id: [u8; 16],
        code: BrokerResponseCode,
        body: &[u8],
    ) -> io::Result<()> {
        match (operation, code) {
            (BrokerOperation::Prepare, BrokerResponseCode::Prepared) => {
                let reference = BrokerClientReferenceWire::decode(body)?;
                fs::write(self.marker_root.join("committed-reference.bin"), body)?;
                fs::write(
                    self.marker_root.join("lease-token.bin"),
                    reference.lease_token,
                )?;
                fs::write(
                    self.marker_root.join("request-capability.bin"),
                    broker_request_capability(&reference.guardian_reference)?,
                )?;
                fs::write(self.marker_root.join("prepare-committed"), b"committed")?;
                wait_for_fixture_path(&self.marker_root.join("allow-prepare-response"))
            }
            (
                BrokerOperation::AcknowledgePreparation,
                BrokerResponseCode::PreparationAcknowledged,
            ) => {
                fs::write(self.marker_root.join("ack-committed"), b"committed")?;
                wait_for_fixture_path(&self.marker_root.join("allow-ack-response"))
            }
            _ => Ok(()),
        }
    }
}

#[cfg(target_os = "linux")]
fn run_process_fixture_client() -> io::Result<()> {
    let socket = fixture_path("RASEN_BROKER_DELIVERY_SOCKET");
    let payload_path = fixture_path("RASEN_BROKER_DELIVERY_PAYLOAD");
    let response_path = fixture_path("RASEN_BROKER_DELIVERY_RESPONSE");
    let command = parse_client_command(
        &std::env::var("RASEN_BROKER_DELIVERY_OPERATION")
            .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "client operation absent"))?,
    )?;
    let payload = fs::read(payload_path)?;
    let signer = SigningBrokerIdentity::from_seed([42; 32])?;
    let endpoint = BrokerClientEndpoint::new(
        socket,
        PinnedBrokerIdentity::from_public_key(signer.public_key())?,
        unsafe { libc::geteuid() },
    )?;
    let response = match command {
        BrokerClientCommand::Prepare => {
            PreparationDeliveryRequest::decode(&payload)?;
            let response = endpoint.call(BrokerOperation::Prepare, None, None, payload, 10_000)?;
            parse_prepared_delivery_response(&response)?;
            response
        }
        BrokerClientCommand::RecoverPreparation => {
            PreparationDeliveryBinding::decode(&payload)?;
            let response = endpoint.call(
                BrokerOperation::RecoverPreparation,
                None,
                None,
                payload,
                10_000,
            )?;
            parse_prepared_delivery_response(&response)?;
            response
        }
        BrokerClientCommand::AcknowledgePreparation => {
            PreparationDeliveryAcknowledgement::decode(&payload)?;
            let token = exact_bytes(&fixture_path("RASEN_BROKER_DELIVERY_LEASE_TOKEN"));
            let capability = exact_bytes(&fixture_path("RASEN_BROKER_DELIVERY_REQUEST_CAPABILITY"));
            let response = endpoint.call(
                BrokerOperation::AcknowledgePreparation,
                Some(token),
                Some(capability),
                payload,
                10_000,
            )?;
            if response.code != BrokerResponseCode::PreparationAcknowledged {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "client acknowledgement parser received an unexpected disposition",
                ));
            }
            response
        }
        _ => {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "process fixture operation is outside prepared delivery",
            ))
        }
    };
    fs::write(response_path, response.encode()?)
}

#[cfg(target_os = "linux")]
#[test]
#[ignore = "test-only subprocess entrypoint"]
fn broker_delivery_process_fixture() {
    let Ok(role) = std::env::var(PROCESS_FIXTURE_ROLE) else {
        return;
    };
    let result = match role.as_str() {
        "daemon" => run_process_fixture_daemon(),
        "client" => run_process_fixture_client(),
        _ => Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "process fixture role is unsupported",
        )),
    };
    result.unwrap();
}

#[cfg(target_os = "linux")]
struct FixtureChild(Option<Child>);

#[cfg(target_os = "linux")]
impl FixtureChild {
    fn kill_and_wait(&mut self) {
        if let Some(mut child) = self.0.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }

    fn wait_success(&mut self) {
        let mut child = self.0.take().expect("fixture child is present");
        let status = child.wait().expect("fixture child wait succeeds");
        assert!(status.success(), "fixture child failed: {status:?}");
    }
}

#[cfg(target_os = "linux")]
impl Drop for FixtureChild {
    fn drop(&mut self) {
        self.kill_and_wait();
    }
}

#[cfg(target_os = "linux")]
fn spawn_process_fixture(
    role: &str,
    state_root: &std::path::Path,
    socket: &std::path::Path,
    marker_root: &std::path::Path,
    operation: Option<&str>,
    payload: Option<&std::path::Path>,
    response: Option<&std::path::Path>,
) -> FixtureChild {
    let mut command = Command::new(std::env::current_exe().unwrap());
    command
        .args([
            "--ignored",
            "--exact",
            "broker_delivery_process_fixture",
            "--nocapture",
        ])
        .env(PROCESS_FIXTURE_ROLE, role)
        .env("RASEN_BROKER_DELIVERY_STATE_ROOT", state_root)
        .env("RASEN_BROKER_DELIVERY_SOCKET", socket)
        .env("RASEN_BROKER_DELIVERY_MARKER_ROOT", marker_root)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::inherit());
    if let Some(operation) = operation {
        command.env("RASEN_BROKER_DELIVERY_OPERATION", operation);
    }
    if let Some(payload) = payload {
        command.env("RASEN_BROKER_DELIVERY_PAYLOAD", payload);
    }
    if let Some(response) = response {
        command.env("RASEN_BROKER_DELIVERY_RESPONSE", response);
    }
    command
        .env(
            "RASEN_BROKER_DELIVERY_LEASE_TOKEN",
            marker_root.join("lease-token.bin"),
        )
        .env(
            "RASEN_BROKER_DELIVERY_REQUEST_CAPABILITY",
            marker_root.join("request-capability.bin"),
        );
    FixtureChild(Some(command.spawn().unwrap()))
}

#[cfg(target_os = "linux")]
fn exact_bytes<const N: usize>(path: &std::path::Path) -> [u8; N] {
    fs::read(path).unwrap().try_into().unwrap()
}

#[cfg(target_os = "linux")]
#[test]
fn client_and_daemon_process_loss_recover_and_ack_one_prepared_delivery() {
    let root = temp_root("delivery-process-loss");
    let state_root = root.join("state");
    fs::create_dir(&state_root).unwrap();
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(&state_root, fs::Permissions::from_mode(0o700)).unwrap();
    let socket = root.join("broker.sock");
    let daemon_ready = root.join("daemon-ready");

    let mut daemon = spawn_process_fixture("daemon", &state_root, &socket, &root, None, None, None);
    wait_for_fixture_path(&daemon_ready).unwrap();

    let prepare = request(BrokerOperation::Prepare, b"launch");
    let binding = prepare_binding(&prepare);
    let prepare_payload = root.join("prepare.delivery");
    let lost_prepare_response = root.join("prepare.response");
    fs::write(&prepare_payload, &prepare.body).unwrap();
    let mut first_client = spawn_process_fixture(
        "client",
        &state_root,
        &socket,
        &root,
        Some("prepare"),
        Some(&prepare_payload),
        Some(&lost_prepare_response),
    );
    wait_for_fixture_path(&root.join("prepare-committed")).unwrap();
    assert!(!lost_prepare_response.exists());
    first_client.kill_and_wait();
    fs::write(root.join("allow-prepare-response"), b"release").unwrap();
    wait_for_fixture_path(&root.join("prepare-response-attempted")).unwrap();
    let committed_reference = fs::read(root.join("committed-reference.bin")).unwrap();
    daemon.kill_and_wait();

    fs::remove_file(&daemon_ready).unwrap();
    daemon = spawn_process_fixture("daemon", &state_root, &socket, &root, None, None, None);
    wait_for_fixture_path(&daemon_ready).unwrap();
    let recover_payload = root.join("recover.delivery");
    let recover_response = root.join("recover.response");
    fs::write(&recover_payload, binding.encode().unwrap()).unwrap();
    let mut recovery_client = spawn_process_fixture(
        "client",
        &state_root,
        &socket,
        &root,
        Some("recover-preparation"),
        Some(&recover_payload),
        Some(&recover_response),
    );
    wait_for_fixture_path(&recover_response).unwrap();
    recovery_client.wait_success();
    let recovered = BrokerResponse::decode(&fs::read(&recover_response).unwrap()).unwrap();
    assert_ne!(recovered.request_id, [0; 16]);
    assert_eq!(recovered.code, BrokerResponseCode::Prepared);
    assert_eq!(recovered.body, committed_reference);

    let acknowledgement = PreparationDeliveryAcknowledgement {
        binding: binding.clone(),
        reference_digest: Sha256::digest(&committed_reference).into(),
    };
    let ack_payload = root.join("ack.delivery");
    let lost_ack_response = root.join("ack.response");
    fs::write(&ack_payload, acknowledgement.encode().unwrap()).unwrap();
    let mut first_ack_client = spawn_process_fixture(
        "client",
        &state_root,
        &socket,
        &root,
        Some("acknowledge-preparation"),
        Some(&ack_payload),
        Some(&lost_ack_response),
    );
    wait_for_fixture_path(&root.join("ack-committed")).unwrap();
    assert!(!lost_ack_response.exists());
    first_ack_client.kill_and_wait();
    fs::write(root.join("allow-ack-response"), b"release").unwrap();
    wait_for_fixture_path(&root.join("ack-response-attempted")).unwrap();
    daemon.kill_and_wait();

    fs::remove_file(&daemon_ready).unwrap();
    daemon = spawn_process_fixture("daemon", &state_root, &socket, &root, None, None, None);
    wait_for_fixture_path(&daemon_ready).unwrap();
    let duplicate_ack_response = root.join("duplicate-ack.response");
    let mut replacement_ack_client = spawn_process_fixture(
        "client",
        &state_root,
        &socket,
        &root,
        Some("acknowledge-preparation"),
        Some(&ack_payload),
        Some(&duplicate_ack_response),
    );
    wait_for_fixture_path(&duplicate_ack_response).unwrap();
    replacement_ack_client.wait_success();
    let acknowledged = BrokerResponse::decode(&fs::read(&duplicate_ack_response).unwrap()).unwrap();
    assert_ne!(acknowledged.request_id, [0; 16]);
    assert_ne!(acknowledged.request_id, recovered.request_id);
    assert_eq!(
        acknowledged.code,
        BrokerResponseCode::PreparationAcknowledged
    );
    daemon.kill_and_wait();

    let store = DurableLeaseStore::open_for_current_owner(&state_root).unwrap();
    assert_eq!(store.load_all().unwrap().len(), 1);
    assert_eq!(store.load_deliveries().unwrap().len(), 1);
    assert_eq!(
        store.load_deliveries().unwrap()[0].phase,
        BrokerPreparationDeliveryPhase::Delivered
    );
    assert!(store.load_recoveries().unwrap().is_empty());
    fs::remove_dir_all(root).unwrap();
}

#[cfg(target_os = "linux")]
#[test]
fn shipping_daemon_observes_client_hup_and_prevents_late_prepare_mutation() {
    use std::os::fd::RawFd;

    struct BlockingGuardian {
        entered: RawFd,
        release: RawFd,
        late_marker: PathBuf,
    }

    impl GuardianAuthority for BlockingGuardian {
        fn probe(&self) -> io::Result<()> {
            Ok(())
        }

        fn prepare_inert(&self, _caller_uid: u32, _body: &[u8]) -> io::Result<PreparedGuardian> {
            let one = 1_u64;
            assert_eq!(
                unsafe {
                    libc::write(
                        self.entered,
                        (&one as *const u64).cast(),
                        std::mem::size_of::<u64>(),
                    )
                },
                std::mem::size_of::<u64>() as isize
            );
            let mut released = 0_u64;
            let _ = unsafe {
                libc::read(
                    self.release,
                    (&mut released as *mut u64).cast(),
                    std::mem::size_of::<u64>(),
                )
            };
            fs::write(&self.late_marker, b"late")?;
            Err(io::Error::other("late prepare must be quarantined"))
        }

        fn abort_inert(&self, _guardian: &PreparedGuardian) -> io::Result<()> {
            Ok(())
        }

        fn reopen(&self, _lease: &BrokerLease, _client_reference: &[u8]) -> io::Result<()> {
            Err(io::ErrorKind::Unsupported.into())
        }

        fn activate(&self, _lease: &BrokerLease, _client_reference: &[u8]) -> io::Result<()> {
            Err(io::ErrorKind::Unsupported.into())
        }
    }

    impl GuardianRuntimeAuthority for BlockingGuardian {
        type Runtime = UnixStream;

        fn open_runtime(
            &self,
            _lease: &BrokerLease,
            _client_reference: &[u8],
        ) -> io::Result<Self::Runtime> {
            Err(io::ErrorKind::Unsupported.into())
        }
    }

    let root = temp_root("daemon-deadline-hup");
    let state_root = root.join("state");
    fs::create_dir(&state_root).unwrap();
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(&state_root, fs::Permissions::from_mode(0o700)).unwrap();
    let entered = unsafe { libc::eventfd(0, libc::EFD_CLOEXEC) };
    let release = unsafe { libc::eventfd(0, libc::EFD_CLOEXEC) };
    assert!(entered >= 0 && release >= 0);
    let late_marker = root.join("late-mutation");
    let service = Arc::new(
        BrokerServiceCore::new(
            identity(),
            DurableLeaseStore::open_for_current_owner(&state_root).unwrap(),
            BlockingGuardian {
                entered,
                release,
                late_marker: late_marker.clone(),
            },
            BrokerCgroupAuthority::new(CgroupFixture::new(), CgroupRequirements::broker_default()),
        )
        .unwrap(),
    );
    let signer = SigningBrokerIdentity::from_seed([0x77; 32]).unwrap();
    let pinned = PinnedBrokerIdentity::from_public_key(signer.public_key()).unwrap();
    let listener = UnixListener::bind(root.join("deadline.sock")).unwrap();
    let service_for_server = Arc::clone(&service);
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        BrokerDaemonTransactions::new()
            .handle_one(&mut stream, &signer, service_for_server.as_ref())
            .unwrap();
    });
    let mut client = UnixStream::connect(root.join("deadline.sock")).unwrap();
    let mut prepare = request(BrokerOperation::Prepare, b"launch");
    prepare.deadline_monotonic_ns =
        rasen_linux_process_authority::deadline::AbsoluteMonotonicDeadline::after_ms(2_000)
            .unwrap()
            .absolute_ns()
            .unwrap();
    let hello = ClientHello {
        nonce: prepare.challenge_nonce,
        claimed_uid: prepare.caller_uid,
    };
    authenticate_broker_for_uid(&mut client, &pinned, &hello, unsafe { libc::geteuid() }).unwrap();
    BrokerFrame::new(BrokerFrameKind::Request, prepare.encode().unwrap())
        .unwrap()
        .write_to(&mut client)
        .unwrap();
    let mut observed = 0_u64;
    assert_eq!(
        unsafe {
            libc::read(
                entered,
                (&mut observed as *mut u64).cast(),
                std::mem::size_of::<u64>(),
            )
        },
        std::mem::size_of::<u64>() as isize
    );
    drop(client);
    server.join().unwrap();
    let one = 1_u64;
    let _ = unsafe {
        libc::write(
            release,
            (&one as *const u64).cast(),
            std::mem::size_of::<u64>(),
        )
    };
    unsafe {
        libc::close(entered);
        libc::close(release);
    }
    assert!(!late_marker.exists());
    fs::remove_dir_all(root).unwrap();
}
