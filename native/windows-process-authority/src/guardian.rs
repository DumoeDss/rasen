//! The guardian: lifecycle, membership events and exact empty (Section 6).
//!
//! The guardian lives **outside** the Job and holds its only handle. That is forced, not
//! preferred. A Node controller cannot hold it, because `KILL_ON_JOB_CLOSE` means the Job dies
//! when its last handle closes, so the controller's exit would destroy the scope and no
//! replacement could ever recover one. Dropping `KILL_ON_JOB_CLOSE` is worse: the Job would be
//! destroyed while its processes keep running, producing exactly the orphaned uncontainable
//! scope this provider exists to prevent.
//!
//! The precise property is *no reachable state has a live scope with no controllable
//! authority*. The last-handle rule protects against the **guardian** dying. It deliberately
//! does **not** protect against the controller dying: the controller crashing must leave the
//! scope alive, or replacement recovery is impossible.
//!
//! Because the guardian must be the sole handle holder, the guardian — not the helper —
//! creates the Job. Any other split would require duplicating the handle into the guardian,
//! and Decision 4 forbids duplication outright.

use std::collections::BTreeSet;
use std::io::{self, Read, Write};
use std::process::ExitCode;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

use crate::activation::{
    self, ActivationMutations, RootStdio, SuspendedRoot, TerminationOutcome,
};
use crate::attestation::PrepareAttestation;
use crate::boot;
use crate::construction::ConstructionCheckpoint;
use crate::endpoint::ControlEndpointServer;
use crate::job::{AccountingSnapshot, JobAuthority, JobMutations, PortMessage};
use crate::journal::{root_exit_detail, Journal};
use crate::launch::LaunchSnapshot;
use crate::protocol::*;
use crate::sha256;
use crate::stateroot::TrustedStateRoot;
use crate::sys::{Dword, Handle};
use crate::win::{self, OwnedHandle};

/// Write a diagnostic line to the guardian's own standard error, tolerating a closed channel.
///
/// `eprintln!` **panics** when the write fails, and the guardian's standard error is a pipe to
/// the short-lived helper that launched it. Once that helper exits the pipe is broken, so the
/// first diagnostic afterwards aborted the guardian — which closes the Job's only handle and
/// destroys a live authority. Measured on the real kernel: a controller whose control
/// capability was rejected received a closed endpoint instead of the typed `reference-invalid`
/// frame, because the guardian died while logging the rejection.
///
/// Diagnostics carry no capability, no endpoint path and no reference bytes.
fn diagnose(message: &str) {
    let mut stderr = std::io::stderr();
    let _ = stderr.write_all(message.as_bytes());
    let _ = stderr.write_all(b"\n");
    let _ = stderr.flush();
}

/// Exit code used for authority-forced termination.
pub const AUTHORITY_TERMINATION_EXIT_CODE: Dword = 137;
const ROOT_UNPROVEN_EXIT_CODE: Dword = 74;

// ---------------------------------------------------------------------------------------------
// Shared state
// ---------------------------------------------------------------------------------------------

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u8)]
pub enum Phase {
    PreparedInert = 1,
    Live = 2,
    RootExited = 3,
    ExactScopeEmpty = 4,
    Retained = 5,
}

#[derive(Default)]
pub struct AuthorityState {
    pub live_members: BTreeSet<u32>,
    pub activated: bool,
    pub root_process_id: Option<u32>,
    pub root_status: Option<RootStatus>,
    pub exact_empty: bool,
    pub accounting_at_empty: Option<AccountingSnapshot>,
    /// Set once and never cleared. An event gap can never be rewritten as exact empty.
    pub event_gap: Option<String>,
    pub control_loss: Option<String>,
    pub membership_sequence: u64,
}

impl AuthorityState {
    pub fn phase(&self) -> Phase {
        if self.event_gap.is_some() || self.control_loss.is_some() {
            return Phase::Retained;
        }
        if self.exact_empty {
            return Phase::ExactScopeEmpty;
        }
        if self.root_status.is_some() {
            return Phase::RootExited;
        }
        if self.activated {
            return Phase::Live;
        }
        Phase::PreparedInert
    }

    /// `exact-scope-empty` may be emitted **only** from the authority's own
    /// `ACTIVE_PROCESS_ZERO` message with a complete event history. Root exit, transport
    /// closure, guardian absence, a sampled active-process count and a quiet polling interval
    /// are all explicitly insufficient.
    pub fn may_emit_exact_empty(&self) -> bool {
        self.exact_empty && self.event_gap.is_none() && self.control_loss.is_none()
    }

    fn record_membership(&mut self, message: MembershipMessage) {
        self.membership_sequence += 1;
        match message {
            MembershipMessage::NewProcess(id) => {
                if !self.live_members.insert(id) {
                    self.note_gap(format!("duplicate new-process message for {id}"));
                }
            }
            MembershipMessage::ExitProcess(id) | MembershipMessage::AbnormalExitProcess(id) => {
                if !self.live_members.remove(&id) {
                    self.note_gap(format!("exit message for unknown member {id}"));
                }
            }
            MembershipMessage::ActiveProcessZero => {
                if !self.live_members.is_empty() {
                    self.note_gap(format!(
                        "active-process-zero while {} members were still tracked",
                        self.live_members.len()
                    ));
                }
            }
        }
    }

    fn note_gap(&mut self, reason: String) {
        if self.event_gap.is_none() {
            self.event_gap = Some(reason);
        }
    }
}

pub struct Guardian {
    pub job: JobAuthority,
    pub state: Mutex<AuthorityState>,
    pub signal: Condvar,
    pub journal: Mutex<Journal>,
    pub attestation: Mutex<PrepareAttestation>,
    pub launch: LaunchSnapshot,
    pub mutations: GuardianMutations,
    /// Retained so the guardian can withdraw the sole-handle corroboration the instant the
    /// invariant stops holding.
    pub state_root: TrustedStateRoot,
    pub scope_id: String,
    root: Mutex<Option<SuspendedRoot>>,
    root_stdin: Mutex<Option<OwnedHandle>>,
    pending_runtime: Mutex<Option<PendingRuntime>>,
    /// The writer of the currently connected control session, so the event reader and the root
    /// observer can push terminal frames rather than leaving the controller to infer them.
    session_writer: Mutex<Option<SharedWriter>>,
    endpoint_handle: Mutex<Option<win::SendHandle>>,
    /// Output pumps still draining. The authority must not report exact empty while the
    /// workload's own output is still in flight, or a controller sees a truncated stream and a
    /// terminal receipt in the same breath.
    active_pumps: AtomicUsize,
    /// Root exit is recorded exactly once and delivered exactly once. The journal was already
    /// guarded; the wire was not, and the first working end-to-end run delivered two
    /// `root-exited` frames — one from the root observer and one from the terminal sequence.
    /// A duplicated terminal event is precisely what the event-completeness semantic forbids.
    root_exit_delivered: AtomicBool,
    finished: AtomicBool,
}

/// The runtime bridge is opened before the resume (Decision 3 / task 5.5): standard I/O and the
/// root and empty event streams all exist before the workload's initial thread runs.
struct PendingRuntime {
    stdio: RootStdio,
    stdin_write: OwnedHandle,
    stdout_read: OwnedHandle,
    stderr_read: OwnedHandle,
}

/// Deliberate breakages. **Never set on any production path.** The TypeScript provider has no
/// way to reach them: they arrive only in the prepare frame the helper composes, and the
/// helper only sets them when its own mutation flags are passed.
#[derive(Clone, Copy, Debug, Default)]
pub struct GuardianMutations {
    pub job: JobMutations,
    pub activation: ActivationMutations,
    /// Duplicate the Job handle into the created root, breaking the sole-handle invariant
    /// (task 9.2). With this set, killing the guardian no longer destroys the authority.
    pub duplicate_job_into_root: bool,
    pub fail_at: Option<ConstructionCheckpoint>,
}

impl GuardianMutations {
    pub fn any(&self) -> bool {
        self.job.any()
            || self.duplicate_job_into_root
            || self.fail_at.is_some()
            || self.activation.omit_job_list
            || self.activation.skip_membership_proof
            || self.activation.resume_before_membership_event
    }

    pub fn encode(&self) -> u32 {
        let mut bits = 0_u32;
        if self.job.allow_breakaway {
            bits |= 1 << 0;
        }
        if self.job.allow_silent_breakaway {
            bits |= 1 << 1;
        }
        if self.job.associate_port_late {
            bits |= 1 << 2;
        }
        if self.activation.omit_job_list {
            bits |= 1 << 3;
        }
        if self.activation.skip_membership_proof {
            bits |= 1 << 4;
        }
        if self.activation.resume_before_membership_event {
            bits |= 1 << 5;
        }
        if self.duplicate_job_into_root {
            bits |= 1 << 6;
        }
        bits
    }

    pub fn decode(bits: u32) -> Self {
        Self {
            job: JobMutations {
                allow_breakaway: bits & (1 << 0) != 0,
                allow_silent_breakaway: bits & (1 << 1) != 0,
                associate_port_late: bits & (1 << 2) != 0,
            },
            activation: ActivationMutations {
                omit_job_list: bits & (1 << 3) != 0,
                skip_membership_proof: bits & (1 << 4) != 0,
                resume_before_membership_event: bits & (1 << 5) != 0,
            },
            duplicate_job_into_root: bits & (1 << 6) != 0,
            fail_at: None,
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Prepare request, carried to the guardian over its inherited stdin
// ---------------------------------------------------------------------------------------------

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PrepareRequest {
    pub operation_id: String,
    pub state_root: String,
    pub launch: LaunchSnapshot,
    pub mutation_bits: u32,
    pub fail_at: String,
    /// SHA-256 of the helper artifact, measured by the helper hashing its own executable.
    pub artifact_sha256: String,
    /// Crate source digest compiled into the helper by the build script; empty in a
    /// development build, and then omitted from the canonical projection.
    pub source_sha256: String,
}

impl PrepareRequest {
    pub fn encode(&self) -> io::Result<Vec<u8>> {
        self.launch.validate()?;
        let mut output = Vec::new();
        output.extend_from_slice(&PROTOCOL_VERSION.to_be_bytes());
        put_string(&mut output, &self.operation_id, MAX_OPERATION_BYTES, false)?;
        put_string(&mut output, &self.state_root, MAX_PATH_BYTES, false)?;
        put_string(&mut output, &self.launch.executable, MAX_PATH_BYTES, false)?;
        put_string(
            &mut output,
            &self.launch.working_directory,
            MAX_PATH_BYTES,
            false,
        )?;
        output.push(u8::from(self.launch.verbatim_arguments));
        output.extend_from_slice(&(self.launch.arguments.len() as u32).to_be_bytes());
        for argument in &self.launch.arguments {
            put_string(&mut output, argument, MAX_ARGUMENT_BYTES, true)?;
        }
        output.extend_from_slice(&canonical_environment(&self.launch.environment)?);
        output.extend_from_slice(&self.mutation_bits.to_be_bytes());
        put_string(&mut output, &self.fail_at, 128, true)?;
        put_string(&mut output, &self.artifact_sha256, 128, true)?;
        put_string(&mut output, &self.source_sha256, 128, true)?;
        Ok(output)
    }

    pub fn decode(bytes: &[u8]) -> io::Result<Self> {
        let mut input = bytes;
        if take_u16(&mut input)? != PROTOCOL_VERSION {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "prepare protocol version is unsupported",
            ));
        }
        let operation_id = take_string(&mut input, MAX_OPERATION_BYTES, false)?;
        validate_operation_id(&operation_id)?;
        let state_root = take_string(&mut input, MAX_PATH_BYTES, false)?;
        let executable = take_string(&mut input, MAX_PATH_BYTES, false)?;
        let working_directory = take_string(&mut input, MAX_PATH_BYTES, false)?;
        if input.is_empty() {
            return Err(io::Error::new(
                io::ErrorKind::UnexpectedEof,
                "prepare payload is truncated",
            ));
        }
        let verbatim_arguments = input[0] != 0;
        input = &input[1..];
        let argument_count = take_u32(&mut input)? as usize;
        if argument_count > MAX_ARGUMENTS {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "too many arguments",
            ));
        }
        let mut arguments = Vec::with_capacity(argument_count);
        for _ in 0..argument_count {
            arguments.push(take_string(&mut input, MAX_ARGUMENT_BYTES, true)?);
        }
        let environment_count = take_u32(&mut input)? as usize;
        if environment_count > MAX_ENVIRONMENT {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "too many environment entries",
            ));
        }
        let mut environment = std::collections::BTreeMap::new();
        for _ in 0..environment_count {
            let key = take_string(&mut input, MAX_ENV_KEY_BYTES, false)?;
            let value = take_string(&mut input, MAX_ENV_VALUE_BYTES, true)?;
            if key.contains('=') || environment.insert(key, value).is_some() {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "environment entry is malformed or duplicated",
                ));
            }
        }
        let mutation_bits = take_u32(&mut input)?;
        let fail_at = take_string(&mut input, 128, true)?;
        let artifact_sha256 = take_string(&mut input, 128, true)?;
        let source_sha256 = take_string(&mut input, 128, true)?;
        if !input.is_empty() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "prepare payload contains trailing bytes",
            ));
        }
        Ok(Self {
            operation_id,
            state_root,
            launch: LaunchSnapshot {
                executable,
                working_directory,
                arguments,
                environment,
                verbatim_arguments,
            },
            mutation_bits,
            fail_at,
            artifact_sha256,
            source_sha256,
        })
    }
}

// ---------------------------------------------------------------------------------------------
// Pipe stream adapters
// ---------------------------------------------------------------------------------------------

/// A framed stream over one direction of the control endpoint. Each instance owns its own
/// overlapped context, so a read in the session loop and a write from the event reader are
/// independent operations on the same handle rather than serialized ones.
pub struct PipeStream {
    handle: Handle,
    overlapped: Option<win::OverlappedContext>,
}

unsafe impl Send for PipeStream {}
unsafe impl Sync for PipeStream {}

impl PipeStream {
    /// For anonymous pipes and inherited standard handles, which are synchronous and are only
    /// ever used in one direction by one thread.
    pub fn new(handle: Handle) -> Self {
        Self {
            handle,
            overlapped: None,
        }
    }

    /// For the control endpoint, which is overlapped on both ends.
    pub fn overlapped(handle: Handle) -> io::Result<Self> {
        Ok(Self {
            handle,
            overlapped: Some(win::OverlappedContext::new()?),
        })
    }
}

impl Read for PipeStream {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        match &self.overlapped {
            Some(context) => context.read(self.handle, buffer),
            None => win::read_handle(self.handle, buffer),
        }
    }
}

impl Write for PipeStream {
    fn write(&mut self, buffer: &[u8]) -> io::Result<usize> {
        match &self.overlapped {
            Some(context) => context.write(self.handle, buffer)?,
            None => win::write_handle(self.handle, buffer)?,
        }
        Ok(buffer.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

// ---------------------------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------------------------

fn injected(mutations: &GuardianMutations, checkpoint: ConstructionCheckpoint) -> io::Result<()> {
    if mutations.fail_at == Some(checkpoint) {
        return Err(io::Error::other(format!(
            "authority-unavailable: injected failure at {}",
            checkpoint.name()
        )));
    }
    Ok(())
}

pub struct PreparedGuardian {
    pub guardian: Arc<Guardian>,
    pub endpoint: ControlEndpointServer,
    pub state_root: TrustedStateRoot,
}

/// The complete prepare construction. Every step is a named [`ConstructionCheckpoint`]; a
/// failure anywhere returns an error and the caller's reconciliation drops every partial
/// object by exiting, which closes the Job handle and destroys the Job by the last-handle rule.
pub fn construct(request: &PrepareRequest) -> io::Result<PreparedGuardian> {
    let mut mutations = GuardianMutations::decode(request.mutation_bits);
    if !request.fail_at.is_empty() {
        mutations.fail_at = Some(crate::construction::parse_checkpoint(&request.fail_at)?);
    }

    injected(&mutations, ConstructionCheckpoint::ArgumentValidation)?;
    request.launch.validate()?;

    injected(&mutations, ConstructionCheckpoint::TrustedStateRootValidation)?;
    let owner = win::current_user_sid()?;
    let state_root = TrustedStateRoot::create_or_open(&request.state_root, &owner)?;

    injected(&mutations, ConstructionCheckpoint::ScopeIdentityGeneration)?;
    let scope_bytes: [u8; 16] = win::random_array()?;
    let scope_id = sha256::hex(&scope_bytes);
    let scope_capability: [u8; 32] = win::random_array()?;
    let control_capability: [u8; 32] = win::random_array()?;
    let generation: [u8; 16] = win::random_array()?;

    injected(&mutations, ConstructionCheckpoint::BootIdentityAcquisition)?;
    let probe = boot::probe();
    let boot_identity = probe.selected_or_unavailable()?;

    injected(&mutations, ConstructionCheckpoint::ScopeDirectoryCreation)?;
    let scope_directory = state_root.create_scope_directory(&scope_id)?;
    let _ = scope_directory;

    injected(&mutations, ConstructionCheckpoint::JobCreation)?;
    injected(&mutations, ConstructionCheckpoint::JobLimitConfiguration)?;
    injected(&mutations, ConstructionCheckpoint::JobLimitReadback)?;
    injected(&mutations, ConstructionCheckpoint::CompletionPortAssociation)?;
    let job = JobAuthority::create_with(mutations.job)?;

    injected(&mutations, ConstructionCheckpoint::JobHandleDiscipline)?;
    if !job.attestation().sole_handle_holds() {
        return Err(io::Error::other(
            "authority-unavailable: the Job handle is not solely held at prepare",
        ));
    }

    injected(&mutations, ConstructionCheckpoint::ControlEndpointCreation)?;
    let endpoint = ControlEndpointServer::create(&scope_id, &owner)?;

    injected(&mutations, ConstructionCheckpoint::JournalCreation)?;
    let journal = Journal::create(
        &state_root.journal_path(&scope_id)?,
        &state_root.terminal_record_path(&scope_id)?,
    )?;

    let sole_handle_token: [u8; 32] = win::random_array()?;
    // Recorded only while the invariant actually holds. `job.attestation().sole_handle_holds()`
    // was proven above; if it were ever false the corroboration would never be written, and a
    // replacement asking the trusted state root would get `None`.
    state_root.record_sole_handle(&scope_id, &sole_handle_token)?;

    let guardian_process_id = win::current_process_id();
    let guardian_birth = win::process_birth(guardian_process_id).ok_or_else(|| {
        io::Error::other("authority-unavailable: the guardian birth identity is unreadable")
    })?;

    let attestation = PrepareAttestation {
        scope_id: scope_id.clone(),
        generation,
        scope_capability,
        control_capability,
        operation_id: request.operation_id.clone(),
        launch_digest: request.launch.digest()?,
        boot_identity: boot_identity.value,
        boot_identity_source: boot_identity.source.name().to_owned(),
        boot_probe: probe.describe(),
        guardian_process_id,
        guardian_birth,
        endpoint_name: endpoint.name().to_owned(),
        endpoint_owner_sid: endpoint.owner().to_text()?,
        state_root_owner_sid: state_root.owner().to_text()?,
        sole_handle_token,
        job: job.attestation(),
        artifact_sha256: request.artifact_sha256.clone(),
        helper_source_digest: request.source_sha256.clone(),
        protocol_version: PROTOCOL_VERSION,
        reference_version: REFERENCE_VERSION,
        // Prepare creates no workload process object at all.
        workload_process_exists: false,
    };

    let guardian = Arc::new(Guardian {
        job,
        state: Mutex::new(AuthorityState::default()),
        signal: Condvar::new(),
        journal: Mutex::new(journal),
        attestation: Mutex::new(attestation),
        launch: request.launch.clone(),
        mutations,
        state_root: state_root.clone(),
        scope_id: scope_id.clone(),
        root: Mutex::new(None),
        root_stdin: Mutex::new(None),
        pending_runtime: Mutex::new(None),
        session_writer: Mutex::new(None),
        endpoint_handle: Mutex::new(None),
        active_pumps: AtomicUsize::new(0),
        root_exit_delivered: AtomicBool::new(false),
        finished: AtomicBool::new(false),
    });

    injected(&mutations, ConstructionCheckpoint::PreparedRecord)?;
    guardian
        .journal
        .lock()
        .expect("journal")
        .append(EventKind::Prepared, "inert")?;

    injected(&mutations, ConstructionCheckpoint::AttestationEmission)?;

    injected(&mutations, ConstructionCheckpoint::FinalRevalidation)?;
    // Revalidate every attested fact against the live kernel rather than the recorded copy.
    if !mutations.any() {
        let live_mask = guardian.job.limit_mask()?;
        let attestation = guardian.attestation.lock().expect("attestation").clone();
        if live_mask != attestation.job.observed_limit_mask {
            return Err(io::Error::other(
                "authority-unavailable: the Job limit mask changed during prepare",
            ));
        }
        let violations = attestation.violations();
        if !violations.is_empty() {
            return Err(io::Error::other(format!(
                "authority-unavailable: prepare attestation violations {violations:?}"
            )));
        }
        if guardian.job.accounting()?.active_processes != 0 {
            return Err(io::Error::other(
                "authority-unavailable: the prepared authority is not empty",
            ));
        }
    }

    Ok(PreparedGuardian {
        guardian,
        endpoint,
        state_root,
    })
}

// ---------------------------------------------------------------------------------------------
// Event reader
// ---------------------------------------------------------------------------------------------

impl Guardian {
    /// The completion-port reader (task 6.1). Closed message vocabulary, monotonic sequence,
    /// per-process-id correlation. Runs until the authority reports empty or the port breaks.
    pub fn run_event_reader(self: &Arc<Self>) {
        loop {
            match self.job.poll(250) {
                Ok(Some(PortMessage::Membership(message))) => {
                    let mut state = self.state.lock().expect("state");
                    state.record_membership(message);
                    if message == MembershipMessage::ActiveProcessZero {
                        // The one and only source of `exact-scope-empty`. The accounting read
                        // below is recorded alongside it as corroboration, never as the oracle.
                        let accounting = self.job.accounting().ok();
                        state.accounting_at_empty = accounting;
                        state.exact_empty = true;
                        let detail = accounting
                            .map(|snapshot| {
                                format!(
                                    "active={} total={} corroborates={}",
                                    snapshot.active_processes,
                                    snapshot.total_processes,
                                    snapshot.corroborates_empty()
                                )
                            })
                            .unwrap_or_else(|| "active=unavailable".to_owned());
                        drop(state);
                        let _ = self
                            .journal
                            .lock()
                            .expect("journal")
                            .append(EventKind::ExactScopeEmpty, &detail);
                        self.signal.notify_all();
                        self.finished.store(true, Ordering::SeqCst);
                        self.finish_and_exit();
                        return;
                    }
                    drop(state);
                    self.signal.notify_all();
                }
                Ok(Some(PortMessage::Unexplained {
                    message,
                    process_id,
                })) => {
                    let mut state = self.state.lock().expect("state");
                    state.note_gap(format!(
                        "unexplained completion message {message} for {process_id}"
                    ));
                    drop(state);
                    self.signal.notify_all();
                }
                Ok(None) => {
                    if self.finished.load(Ordering::SeqCst) {
                        return;
                    }
                }
                Err(error) => {
                    let mut state = self.state.lock().expect("state");
                    state.control_loss = Some(error.to_string());
                    drop(state);
                    self.signal.notify_all();
                    return;
                }
            }
        }
    }

    /// Deliver `root-exited` at most once for the lifetime of the authority.
    fn deliver_root_exit(&self, status: RootStatus) {
        if self
            .root_exit_delivered
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok()
        {
            self.broadcast(FrameKind::RootExited, status.encode());
        }
    }

    pub fn root_exit_was_delivered(&self) -> bool {
        self.root_exit_delivered.load(Ordering::SeqCst)
    }

    fn broadcast(&self, kind: FrameKind, payload: Vec<u8>) {
        let guard = self.session_writer.lock().expect("session writer");
        match guard.as_ref() {
            Some(writer) => {
                if let Err(error) = send(writer, kind, payload) {
                    diagnose(&format!("guardian broadcast {} failed: {error}", kind.name()));
                }
            }
            None => diagnose(&format!(
                "guardian broadcast {} dropped: no session",
                kind.name()
            )),
        }
    }

    /// The terminal sequence. Drain the workload's own output first, deliver the terminal
    /// frames, flush the endpoint so the controller actually receives them, and only then
    /// exit — which closes the last Job handle on a Job that is already empty.
    ///
    /// The drain matters: without it the controller sees `exact-scope-empty` while the
    /// workload's final bytes are still in a pipe, and would then have to treat end-of-stream
    /// as if it were a receipt. End-of-stream is never a receipt.
    fn finish_and_exit(&self) {
        let until = Instant::now() + Duration::from_secs(5);
        while self.active_pumps.load(Ordering::SeqCst) > 0 && Instant::now() < until {
            std::thread::sleep(Duration::from_millis(5));
        }
        let status = self.state.lock().expect("state").root_status;
        if let Some(status) = status {
            self.deliver_root_exit(status);
        }
        let payload = {
            let state = self.state.lock().expect("state");
            encode_observation(&state)
        };
        self.broadcast(FrameKind::ExactScopeEmpty, payload);
        if let Some(handle) = *self.endpoint_handle.lock().expect("endpoint") {
            let _ = win::flush_file(handle.get());
        }
        std::process::exit(0);
    }

    /// Wait for `JOB_OBJECT_MSG_NEW_PROCESS` for exactly this process id.
    pub fn await_new_process(&self, process_id: u32, timeout: Duration) -> bool {
        let deadline = Instant::now() + timeout;
        let mut state = self.state.lock().expect("state");
        loop {
            if state.live_members.contains(&process_id) {
                return true;
            }
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return false;
            }
            let (next, timed_out) = self
                .signal
                .wait_timeout(state, remaining)
                .expect("condvar");
            state = next;
            if timed_out.timed_out() && !state.live_members.contains(&process_id) {
                return false;
            }
        }
    }

    /// Wait on the root handle to completion, then read its exit status. Recorded exactly once
    /// and explicitly **not** an emptiness signal.
    pub fn run_root_observer(self: &Arc<Self>, process: Handle) {
        match activation::wait_then_read_exit_status(process, crate::sys::INFINITE) {
            Ok(Some(code)) => {
                let status = RootStatus { code };
                let mut state = self.state.lock().expect("state");
                if state.root_status.is_none() {
                    state.root_status = Some(status);
                    drop(state);
                    let _ = self
                        .journal
                        .lock()
                        .expect("journal")
                        .append(EventKind::RootExited, &root_exit_detail(status));
                    self.signal.notify_all();
                    // Root exit is reported as it happens and is explicitly not an emptiness
                    // signal: descendants may still be live and the authority stays owned.
                    self.deliver_root_exit(status);
                }
            }
            Ok(None) => {}
            Err(error) => {
                let mut state = self.state.lock().expect("state");
                state.control_loss = Some(error.to_string());
            }
        }
    }

    /// Withdraw the on-disk sole-handle corroboration. Idempotent.
    pub fn revoke_sole_handle_corroboration(&self) {
        if let Err(error) = self.state_root.revoke_sole_handle(&self.scope_id) {
            diagnose(&format!("sole-handle revocation failed: {error}"));
        }
    }

    pub fn is_finished(&self) -> bool {
        self.finished.load(Ordering::SeqCst)
    }

    pub fn set_root(&self, root: SuspendedRoot, stdin: Option<OwnedHandle>) {
        *self.root.lock().expect("root") = Some(root);
        *self.root_stdin.lock().expect("root stdin") = stdin;
    }

    pub fn close_root_stdin(&self) {
        let mut guard = self.root_stdin.lock().expect("root stdin");
        if let Some(handle) = guard.take() {
            let _ = handle.close();
        }
    }

    pub fn write_root_stdin(&self, bytes: &[u8]) -> io::Result<()> {
        let guard = self.root_stdin.lock().expect("root stdin");
        match guard.as_ref() {
            Some(handle) => win::write_handle(handle.raw(), bytes),
            None => Err(io::Error::new(
                io::ErrorKind::BrokenPipe,
                "root standard input is closed",
            )),
        }
    }

    pub fn root_process_handle(&self) -> Option<Handle> {
        self.root
            .lock()
            .expect("root")
            .as_ref()
            .map(|root| root.process.raw())
    }

    /// Activation, exactly once. Creates the root suspended and assigned at creation, runs the
    /// pre-resume proof, and resumes only when all three facts hold.
    pub fn activate(self: &Arc<Self>, stdio: RootStdio) -> io::Result<u32> {
        {
            let state = self.state.lock().expect("state");
            if state.activated {
                return Err(io::Error::other(
                    "native-ordering-conflict: the authority was already activated",
                ));
            }
        }
        let expected_mask = self.attestation.lock().expect("attestation").job.observed_limit_mask;
        let mut root = activation::create_root_suspended(
            &self.job,
            &self.launch,
            &stdio,
            self.mutations.activation,
        )?;

        if self.mutations.duplicate_job_into_root {
            // Task 9.2 RED: break the sole-handle invariant deliberately.
            self.job.duplicate_into_for_mutation(root.process.raw())?;
            let mut attestation = self.attestation.lock().expect("attestation");
            attestation.job = self.job.attestation();
            drop(attestation);
            // Withdraw the corroboration the moment the invariant stops holding. Without this
            // the trusted state root would keep asserting a property the kernel no longer has,
            // and a replacement would infer exact-scope-empty for a workload that is still
            // running — the exact fabrication the last-handle rule is supposed to prevent.
            self.revoke_sole_handle_corroboration();
        }

        let proof = activation::prove_before_resume(
            &self.job,
            &root,
            expected_mask,
            self.mutations.activation,
            |process_id, timeout| self.await_new_process(process_id, timeout),
        )?;
        if !proof.is_complete() {
            let missing = proof.missing();
            root.terminate_unresumed(ROOT_UNPROVEN_EXIT_CODE)?;
            return Err(io::Error::other(format!(
                "native-uncertain: the workload root failed its pre-resume proof {missing:?}"
            )));
        }

        root.resume()?;
        let process_id = root.process_id;
        let process = root.process.raw();
        {
            let mut state = self.state.lock().expect("state");
            state.activated = true;
            state.root_process_id = Some(process_id);
        }
        self.journal
            .lock()
            .expect("journal")
            .append(EventKind::Activated, &format!("root={process_id}"))?;
        self.set_root(root, None);

        let observer = Arc::clone(self);
        let process = win::SendHandle(process);
        std::thread::spawn(move || observer.run_root_observer(process.get()));
        Ok(process_id)
    }

    /// Authority-wide forced termination with the bounded re-terminate loop. A graceful step,
    /// when requested, is bounded and **never** produces an empty receipt by itself.
    pub fn terminate(
        &self,
        grace: Duration,
        deadline: Instant,
    ) -> io::Result<TerminationOutcome> {
        if !grace.is_zero() {
            // The only graceful mechanism available: close the root's standard input and wait.
            // Windows has no SIGTERM; `GenerateConsoleCtrlEvent` needs a shared console and a
            // process group, which is the mechanism ECP-7 disproved. Neither is used.
            self.close_root_stdin();
            let until = Instant::now() + grace;
            while Instant::now() < until {
                if self.state.lock().expect("state").exact_empty {
                    break;
                }
                std::thread::sleep(Duration::from_millis(10));
            }
        }
        if self.state.lock().expect("state").exact_empty {
            return Ok(TerminationOutcome::ExactEmpty { reterminations: 0 });
        }

        // A prepared authority that was never activated has no zero-transition to wait for:
        // the kernel reports `ACTIVE_PROCESS_ZERO` when the member count *falls* to zero, and
        // a Job that never had a member never falls. Waiting for it is what an earlier version
        // of this code did, and a prepared abort then always expired its deadline.
        //
        // The receipt here is still positive, not a quiet interval: `TotalProcesses == 0` is
        // the kernel's own statement that no process has ever been a member, and the prepare
        // attestation independently records that no workload process was created. Decision 8
        // names exactly this path.
        let never_activated = !self.state.lock().expect("state").activated;
        if never_activated {
            let accounting = self.job.accounting()?;
            if accounting.total_processes == 0 && accounting.active_processes == 0 {
                self.job.terminate(AUTHORITY_TERMINATION_EXIT_CODE)?;
                let confirmed = self.job.accounting()?;
                if confirmed.total_processes != 0 || confirmed.active_processes != 0 {
                    return Err(io::Error::other(
                        "native-uncertain: a member appeared during a prepared abort",
                    ));
                }
                {
                    let mut state = self.state.lock().expect("state");
                    state.exact_empty = true;
                    state.accounting_at_empty = Some(confirmed);
                }
                self.journal.lock().expect("journal").append(
                    EventKind::ExactScopeEmpty,
                    &format!(
                        "never-activated active={} total={}",
                        confirmed.active_processes, confirmed.total_processes
                    ),
                )?;
                self.finished.store(true, Ordering::SeqCst);
                return Ok(TerminationOutcome::ExactEmpty { reterminations: 0 });
            }
        }

        // The reader thread owns the port, so drive convergence from shared state rather than
        // polling the port from here; a second poller would steal the reader's messages.
        self.job.terminate(AUTHORITY_TERMINATION_EXIT_CODE)?;
        let mut reterminations = 0_u32;
        let mut observed_members = 0_usize;
        loop {
            let state = self.state.lock().expect("state");
            if state.exact_empty {
                return Ok(TerminationOutcome::ExactEmpty { reterminations });
            }
            let current = state.live_members.len();
            drop(state);
            if current > observed_members {
                self.job.terminate(AUTHORITY_TERMINATION_EXIT_CODE)?;
                reterminations += 1;
            }
            observed_members = current;
            if Instant::now() >= deadline {
                return Ok(TerminationOutcome::Timeout { reterminations });
            }
            std::thread::sleep(Duration::from_millis(10));
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Observation encoding
// ---------------------------------------------------------------------------------------------

pub fn encode_observation(state: &AuthorityState) -> Vec<u8> {
    let mut output = Vec::new();
    output.push(state.phase() as u8);
    let mut flags = 0_u8;
    if state.activated {
        flags |= 1 << 0;
    }
    if state.root_status.is_some() {
        flags |= 1 << 1;
    }
    if state.may_emit_exact_empty() {
        flags |= 1 << 2;
    }
    if state.event_gap.is_some() {
        flags |= 1 << 3;
    }
    if state.control_loss.is_some() {
        flags |= 1 << 4;
    }
    output.push(flags);
    output.extend_from_slice(&state.root_process_id.unwrap_or(0).to_be_bytes());
    match state.root_status {
        Some(status) => {
            output.push(1);
            output.extend_from_slice(&status.encode());
        }
        None => {
            output.push(0);
            output.extend_from_slice(&[0_u8; 5]);
        }
    }
    let accounting = state.accounting_at_empty.unwrap_or_default();
    output.extend_from_slice(&accounting.active_processes.to_be_bytes());
    output.extend_from_slice(&accounting.total_processes.to_be_bytes());
    output.extend_from_slice(&(state.live_members.len() as u32).to_be_bytes());
    output.extend_from_slice(&state.membership_sequence.to_be_bytes());
    output
}

// ---------------------------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------------------------

/// Guardian process entry point. Reads the prepare request from its inherited standard input,
/// constructs the authority, writes the attestation to its inherited standard output, then
/// serves the private control endpoint until the authority reports exact empty.
pub fn run() -> ExitCode {
    match run_inner() {
        Ok(code) => code,
        Err(error) => {
            // The failure is written as a typed frame on standard output so the helper can
            // classify it; the diagnostic text carries no capability and no endpoint path.
            let code = classify(&error);
            let mut stdout = std::io::stdout();
            let _ = write_frame(
                &mut stdout,
                &Frame {
                    kind: FrameKind::Failure,
                    payload: code.encode().to_vec(),
                },
            );
            diagnose(&format!("guardian: {error}"));
            ExitCode::from(70)
        }
    }
}

fn classify(error: &io::Error) -> NativeFailureCode {
    let text = error.to_string();
    for code in FAILURE_VOCABULARY {
        if text.starts_with(code.diagnostic_code()) || text.contains(code.diagnostic_code()) {
            return code;
        }
    }
    match error.kind() {
        io::ErrorKind::TimedOut => NativeFailureCode::Timeout,
        io::ErrorKind::PermissionDenied | io::ErrorKind::InvalidData => {
            NativeFailureCode::ReferenceInvalid
        }
        io::ErrorKind::NotFound | io::ErrorKind::BrokenPipe | io::ErrorKind::UnexpectedEof => {
            NativeFailureCode::ControlLoss
        }
        io::ErrorKind::AlreadyExists => NativeFailureCode::Unavailable,
        _ => NativeFailureCode::Uncertain,
    }
}

fn run_inner() -> io::Result<ExitCode> {
    let mut stdin = std::io::stdin();
    let frame = read_frame(&mut stdin)?.ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::UnexpectedEof,
            "guardian received no prepare frame",
        )
    })?;
    if frame.kind != FrameKind::Attest {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "guardian expected a prepare frame",
        ));
    }
    let request = PrepareRequest::decode(&frame.payload)?;
    let prepared = construct(&request)?;
    let attestation = prepared.guardian.attestation.lock().expect("attestation").clone();

    let mut stdout = std::io::stdout();
    write_frame(
        &mut stdout,
        &Frame {
            kind: FrameKind::Attestation,
            payload: attestation.encode()?,
        },
    )?;
    drop(stdout);

    let reader = Arc::clone(&prepared.guardian);
    std::thread::spawn(move || reader.run_event_reader());

    serve(prepared)?;
    Ok(ExitCode::SUCCESS)
}

fn serve(prepared: PreparedGuardian) -> io::Result<()> {
    let PreparedGuardian {
        guardian,
        mut endpoint,
        state_root: _state_root,
    } = prepared;
    let control_capability = guardian
        .attestation
        .lock()
        .expect("attestation")
        .control_capability;

    *guardian.endpoint_handle.lock().expect("endpoint") = Some(win::SendHandle(endpoint.raw()));
    let accept_context = win::OverlappedContext::new()?;

    while !guardian.is_finished() {
        if endpoint.accept(&accept_context).is_err() {
            continue;
        }
        let authenticated = endpoint.authenticate_client().is_ok();
        let mut reader = PipeStream::overlapped(endpoint.raw())?;
        let writer = Arc::new(Mutex::new(PipeStream::overlapped(endpoint.raw())?));
        *guardian.session_writer.lock().expect("session writer") = Some(Arc::clone(&writer));
        let session = session_loop(
            &guardian,
            &mut reader,
            &writer,
            &control_capability,
            authenticated,
        );
        if let Err(error) = session {
            let code = classify(&error);
            // Diagnostic text goes to the guardian's own stderr, never onto the control
            // stream: the wire carries the typed code only, and the text carries no
            // capability, no endpoint path and no reference bytes.
            diagnose(&format!("guardian session: {code:?} {error}"));
            let _ = send(&writer, FrameKind::Failure, code.encode().to_vec());
        }
        *guardian.session_writer.lock().expect("session writer") = None;
        let _ = endpoint.disconnect();
    }

    // The terminal record is already durably flushed by the event reader. Exiting now closes
    // the last Job handle on an already-empty Job.
    Ok(())
}

type SharedWriter = Arc<Mutex<PipeStream>>;

fn send(writer: &SharedWriter, kind: FrameKind, payload: Vec<u8>) -> io::Result<()> {
    let mut guard = writer.lock().expect("writer");
    write_frame(&mut *guard, &Frame { kind, payload })
}

fn session_loop(
    guardian: &Arc<Guardian>,
    stream: &mut PipeStream,
    writer: &SharedWriter,
    control_capability: &[u8; 32],
    authenticated_peer: bool,
) -> io::Result<()> {
    if !authenticated_peer {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "identity-drift: the endpoint client failed authentication",
        ));
    }
    let mut capability_proven = false;
    loop {
        let frame = match read_frame(stream)? {
            Some(frame) => frame,
            None => return Ok(()),
        };
        if !capability_proven {
            if frame.kind != FrameKind::Attest {
                return Err(io::Error::new(
                    io::ErrorKind::PermissionDenied,
                    "reference-invalid: the session did not present its capability first",
                ));
            }
            if frame.payload.len() != 32 || frame.payload != control_capability {
                return Err(io::Error::new(
                    io::ErrorKind::PermissionDenied,
                    "reference-invalid: the control capability was rejected",
                ));
            }
            capability_proven = true;
            let attestation = guardian.attestation.lock().expect("attestation").clone();
            send(writer, FrameKind::Attestation, attestation.encode()?)?;
            continue;
        }
        match frame.kind {
            FrameKind::Inspect => {
                let state = guardian.state.lock().expect("state");
                let payload = encode_observation(&state);
                drop(state);
                send(writer, FrameKind::Observation, payload)?;
            }
            FrameKind::Abort | FrameKind::Terminate => {
                let mut input = frame.payload.as_slice();
                let grace_ms = take_u32(&mut input)?;
                let deadline_ms = take_u32(&mut input)?;
                let deadline = Instant::now() + Duration::from_millis(u64::from(deadline_ms));
                let outcome = guardian.terminate(
                    if frame.kind == FrameKind::Abort {
                        Duration::ZERO
                    } else {
                        Duration::from_millis(u64::from(grace_ms))
                    },
                    deadline,
                )?;
                match outcome {
                    TerminationOutcome::ExactEmpty { .. } => {
                        let state = guardian.state.lock().expect("state");
                        let payload = encode_observation(&state);
                        drop(state);
                        send(writer, FrameKind::ExactScopeEmpty, payload)?;
                        return Ok(());
                    }
                    TerminationOutcome::Timeout { .. } => {
                        send(
                            writer,
                            FrameKind::Failure,
                            NativeFailureCode::Timeout.encode().to_vec(),
                        )?;
                    }
                }
            }
            FrameKind::OpenRuntime => {
                open_runtime(guardian, writer)?;
            }
            FrameKind::Activate => {
                run_activation(guardian, writer)?;
            }
            FrameKind::Input => {
                guardian.write_root_stdin(&frame.payload)?;
            }
            FrameKind::CloseInput => {
                guardian.close_root_stdin();
            }
            other => {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    format!("native-ordering-conflict: unexpected request frame {}", other.name()),
                ));
            }
        }
    }
}

/// Open the runtime bridge. Standard I/O exists before the root does, so nothing the workload
/// writes can be lost between creation and the resume.
fn open_runtime(guardian: &Arc<Guardian>, writer: &SharedWriter) -> io::Result<()> {
    if guardian.pending_runtime.lock().expect("runtime").is_some() {
        return Err(io::Error::other(
            "native-ordering-conflict: the runtime bridge is already open",
        ));
    }
    let (stdin_read, stdin_write) = win::create_anonymous_pipe(true)?;
    let (stdout_read, stdout_write) = win::create_anonymous_pipe(false)?;
    let (stderr_read, stderr_write) = win::create_anonymous_pipe(false)?;
    *guardian.pending_runtime.lock().expect("runtime") = Some(PendingRuntime {
        stdio: RootStdio {
            stdin_read,
            stdout_write,
            stderr_write,
        },
        stdin_write,
        stdout_read,
        stderr_read,
    });
    send(writer, FrameKind::RuntimeReady, Vec::new())
}

fn run_activation(guardian: &Arc<Guardian>, writer: &SharedWriter) -> io::Result<()> {
    let pending = guardian
        .pending_runtime
        .lock()
        .expect("runtime")
        .take()
        .ok_or_else(|| {
            io::Error::other(
                "native-ordering-conflict: activation was requested before the runtime bridge",
            )
        })?;
    let PendingRuntime {
        stdio,
        stdin_write,
        stdout_read,
        stderr_read,
    } = pending;

    // `activate` consumes the child ends, so the guardian's copies close on return and the
    // pumps below see end-of-file when the last writer in the authority exits.
    let process_id = guardian.activate(stdio)?;
    *guardian.root_stdin.lock().expect("root stdin") = Some(stdin_write);
    send(
        writer,
        FrameKind::Activated,
        process_id.to_be_bytes().to_vec(),
    )?;

    for (source, kind) in [
        (stdout_read, FrameKind::Output),
        (stderr_read, FrameKind::ErrorOutput),
    ] {
        let writer = Arc::clone(writer);
        let guardian = Arc::clone(guardian);
        guardian.active_pumps.fetch_add(1, Ordering::SeqCst);
        std::thread::spawn(move || {
            pump(source, kind, writer);
            guardian.active_pumps.fetch_sub(1, Ordering::SeqCst);
        });
    }
    Ok(())
}

/// Pump one of the root's output streams onto the control stream until it closes. The only
/// writers of that pipe are Job members, so the stream ends exactly when the authority does.
fn pump(source: OwnedHandle, kind: FrameKind, writer: SharedWriter) {
    let mut buffer = vec![0_u8; 16 * 1024];
    loop {
        match win::read_handle(source.raw(), &mut buffer) {
            Ok(0) | Err(_) => return,
            Ok(count) => {
                if send(&writer, kind, buffer[..count].to_vec()).is_err() {
                    return;
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::construction::CONSTRUCTION_CHECKPOINTS;
    use std::collections::BTreeMap;

    fn launch() -> LaunchSnapshot {
        LaunchSnapshot {
            executable: "C:\\Windows\\System32\\cmd.exe".to_owned(),
            working_directory: "C:\\Windows".to_owned(),
            arguments: vec!["/c".to_owned(), "exit".to_owned()],
            environment: BTreeMap::new(),
            verbatim_arguments: false,
        }
    }

    #[test]
    fn prepare_requests_round_trip_and_reject_tampering() {
        let request = PrepareRequest {
            operation_id: "op-1".to_owned(),
            state_root: "C:\\rasen\\state".to_owned(),
            launch: launch(),
            mutation_bits: 0,
            fail_at: String::new(),
            artifact_sha256: "b".repeat(64),
            source_sha256: String::new(),
        };
        let encoded = request.encode().expect("encode");
        assert_eq!(PrepareRequest::decode(&encoded).expect("decode"), request);
        assert!(PrepareRequest::decode(&encoded[..encoded.len() - 1]).is_err());
        let mut extended = encoded.clone();
        extended.push(7);
        assert!(PrepareRequest::decode(&extended).is_err());
    }

    #[test]
    fn a_prepare_request_with_a_relative_executable_is_refused_at_decode() {
        let mut request = PrepareRequest {
            operation_id: "op-1".to_owned(),
            state_root: "C:\\rasen\\state".to_owned(),
            launch: launch(),
            mutation_bits: 0,
            fail_at: String::new(),
            artifact_sha256: "b".repeat(64),
            source_sha256: String::new(),
        };
        request.launch.executable = "cmd.exe".to_owned();
        assert!(request.encode().is_err());
    }

    #[test]
    fn mutation_bits_round_trip_and_default_to_none() {
        assert!(!GuardianMutations::decode(0).any());
        for bit in 0..7 {
            let decoded = GuardianMutations::decode(1 << bit);
            assert!(decoded.any(), "bit {bit} decoded to no mutation");
            assert_eq!(decoded.encode(), 1 << bit);
        }
    }

    #[test]
    fn exact_empty_is_never_reachable_from_root_exit_or_transport_loss_alone() {
        // The contract requires `exact-scope-empty` to come only from the authority's own
        // empty event with a complete history. These are the four substitutes the contract
        // names, and none of them may produce it.
        let mut state = AuthorityState {
            activated: true,
            root_status: Some(RootStatus { code: 0 }),
            ..Default::default()
        };
        assert!(!state.may_emit_exact_empty());
        assert_eq!(state.phase(), Phase::RootExited);

        state.control_loss = Some("transport".to_owned());
        assert!(!state.may_emit_exact_empty());
        assert_eq!(state.phase(), Phase::Retained);

        let mut sampled = AuthorityState {
            activated: true,
            accounting_at_empty: Some(AccountingSnapshot {
                active_processes: 0,
                total_processes: 3,
            }),
            ..Default::default()
        };
        assert!(
            !sampled.may_emit_exact_empty(),
            "a sampled zero active count produced exact empty"
        );

        sampled.exact_empty = true;
        assert!(sampled.may_emit_exact_empty());
        assert_eq!(sampled.phase(), Phase::ExactScopeEmpty);
    }

    #[test]
    fn an_event_gap_can_never_be_rewritten_as_exact_empty() {
        let mut state = AuthorityState {
            activated: true,
            exact_empty: true,
            ..Default::default()
        };
        assert!(state.may_emit_exact_empty());
        state.note_gap("missing exit message".to_owned());
        assert!(
            !state.may_emit_exact_empty(),
            "an event gap did not suppress exact empty"
        );
        assert_eq!(state.phase(), Phase::Retained);
        // A second gap must not overwrite the first, so the original cause survives.
        state.note_gap("second".to_owned());
        assert_eq!(state.event_gap.as_deref(), Some("missing exit message"));
    }

    #[test]
    fn membership_correlation_detects_duplicates_unknown_exits_and_premature_zero() {
        let mut state = AuthorityState::default();
        state.record_membership(MembershipMessage::NewProcess(10));
        assert!(state.event_gap.is_none());
        state.record_membership(MembershipMessage::NewProcess(10));
        assert!(state.event_gap.is_some(), "duplicate new-process accepted");

        let mut state = AuthorityState::default();
        state.record_membership(MembershipMessage::ExitProcess(99));
        assert!(state.event_gap.is_some(), "exit for unknown member accepted");

        let mut state = AuthorityState::default();
        state.record_membership(MembershipMessage::NewProcess(10));
        state.record_membership(MembershipMessage::ActiveProcessZero);
        assert!(
            state.event_gap.is_some(),
            "active-process-zero while a member was tracked was accepted"
        );

        let mut clean = AuthorityState::default();
        clean.record_membership(MembershipMessage::NewProcess(10));
        clean.record_membership(MembershipMessage::ExitProcess(10));
        clean.record_membership(MembershipMessage::ActiveProcessZero);
        assert!(clean.event_gap.is_none(), "{:?}", clean.event_gap);
        assert_eq!(clean.membership_sequence, 3);
    }

    #[test]
    fn observation_encoding_reports_every_distinct_phase() {
        let mut seen = Vec::new();
        for state in [
            AuthorityState::default(),
            AuthorityState {
                activated: true,
                ..Default::default()
            },
            AuthorityState {
                activated: true,
                root_status: Some(RootStatus { code: 3 }),
                ..Default::default()
            },
            AuthorityState {
                activated: true,
                exact_empty: true,
                ..Default::default()
            },
            AuthorityState {
                activated: true,
                event_gap: Some("gap".to_owned()),
                ..Default::default()
            },
        ] {
            seen.push(encode_observation(&state)[0]);
        }
        assert_eq!(
            seen,
            vec![
                Phase::PreparedInert as u8,
                Phase::Live as u8,
                Phase::RootExited as u8,
                Phase::ExactScopeEmpty as u8,
                Phase::Retained as u8,
            ]
        );
    }

    #[test]
    fn every_construction_checkpoint_is_reachable_by_name_from_a_prepare_request() {
        for checkpoint in CONSTRUCTION_CHECKPOINTS {
            let request = PrepareRequest {
                operation_id: "op".to_owned(),
                state_root: "C:\\rasen\\state".to_owned(),
                launch: launch(),
                mutation_bits: 0,
                fail_at: checkpoint.name().to_owned(),
                artifact_sha256: "b".repeat(64),
                source_sha256: String::new(),
            };
            let encoded = request.encode().expect("encode");
            let decoded = PrepareRequest::decode(&encoded).expect("decode");
            assert_eq!(
                crate::construction::parse_checkpoint(&decoded.fail_at).expect("parse"),
                checkpoint
            );
        }
    }
}
