use std::collections::VecDeque;
use std::ffi::CString;
use std::fs::{self, File};
use std::io::{self, Read};
use std::os::fd::{AsRawFd, FromRawFd, RawFd};
use std::os::unix::fs::{FileTypeExt, MetadataExt, PermissionsExt};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};
use std::time::Duration;

use sha2::{Digest, Sha256};

use crate::authority::{AuthorityIdentity, ControlOperation, ControlRequest, PreparedAttestation};
use crate::deadline::{read_exact_fd_until, write_all_fd_until, AbsoluteMonotonicDeadline};
use crate::journal::{keyed_authentication, DurableJournal, JournalBinding};
use crate::lifecycle::{
    GuardianEvent, GuardianEventKind, GuardianMachine, GuardianObservation, RootExit,
};
use crate::linux::{
    read_process_identity, reopen_exact_authority, reopen_or_prove_absent, AuthorityPresence,
    ReopenedAuthority,
};
use crate::protocol::{
    read_frame, write_frame, Frame, FrameKind, LaunchSpec, NativeFailure, NativeFailureCode,
    PrepareRequest,
};
use crate::runtime::{random_bytes, reopen_scope_directory, PrivateScope};

const PREPARE_TIMEOUT_MS: u32 = 10_000;
const CONTROL_TIMEOUT: Duration = Duration::from_secs(2);
const MAX_RUNTIME_INPUT: usize = 64 * 1024;
const MAX_PENDING_INPUT: usize = 256 * 1024;
const OUTPUT_CHUNK: usize = 16 * 1024;
const MAX_SHEBANG_BYTES: usize = 256;
const SERVER_CHALLENGE_DOMAIN: &[u8] = b"RPA1-server-first-v1";
const CHALLENGE_BYTES: usize = 64;

pub struct PreparedPrimary {
    pub attestation: PreparedAttestation,
    runtime_root: PathBuf,
}

impl PreparedPrimary {
    pub fn client(&self) -> io::Result<AuthorityClient> {
        AuthorityClient::new(&self.runtime_root, self.attestation.clone())
    }
}

pub struct RuntimeChannel {
    stream: UnixStream,
}

impl RuntimeChannel {
    pub fn into_stream(self) -> UnixStream {
        self.stream
    }

    pub fn send_input(&mut self, bytes: Vec<u8>) -> io::Result<()> {
        if bytes.len() > MAX_RUNTIME_INPUT {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "runtime input frame exceeds its bound",
            ));
        }
        write_frame(&mut self.stream, &Frame::new(FrameKind::Input, bytes)?)
    }

    pub fn close_input(&mut self) -> io::Result<()> {
        write_frame(
            &mut self.stream,
            &Frame::new(FrameKind::CloseInput, Vec::new())?,
        )
    }

    pub fn read(&mut self) -> io::Result<Option<Frame>> {
        read_frame(&mut self.stream)
    }
}

#[derive(Clone)]
pub struct AuthorityClient {
    attestation: PreparedAttestation,
    control_socket: PathBuf,
    scope_directory: PathBuf,
}

impl AuthorityClient {
    pub fn new(runtime_root: &Path, attestation: PreparedAttestation) -> io::Result<Self> {
        attestation.encode()?;
        if !runtime_root.is_absolute() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "authority runtime root is not absolute",
            ));
        }
        let directory = reopen_scope_directory(runtime_root, &attestation.scope_id)?;
        Ok(Self {
            control_socket: directory.join("control.sock"),
            scope_directory: directory,
            attestation,
        })
    }

    pub fn open_runtime(&self) -> io::Result<RuntimeChannel> {
        let (_authority, stream, frame) = self.control(ControlOperation::OpenRuntime)?;
        if frame.kind != FrameKind::RuntimeReady || !frame.payload.is_empty() {
            return Err(invalid_response("runtime-ready"));
        }
        Ok(RuntimeChannel { stream })
    }

    pub fn activate(&self) -> io::Result<()> {
        self.activate_until(AbsoluteMonotonicDeadline::after_ms(
            CONTROL_TIMEOUT.as_millis() as u32,
        )?)
    }

    pub fn activate_until(&self, deadline: AbsoluteMonotonicDeadline) -> io::Result<()> {
        let (_authority, _stream, frame) =
            self.control_until(ControlOperation::Activate, deadline)?;
        if frame.kind != FrameKind::Activated || !frame.payload.is_empty() {
            return Err(invalid_response("activated"));
        }
        Ok(())
    }

    pub fn inspect(&self) -> io::Result<GuardianObservation> {
        match self.inspect_evidence()? {
            AuthorityInspection::Events(events) => observation_from_events(&events),
            AuthorityInspection::KernelExactEmptyRootResultLost(_) => {
                Ok(GuardianObservation::ExactScopeEmpty)
            }
        }
    }

    pub fn inspect_events(&self) -> io::Result<Vec<GuardianEvent>> {
        match self.inspect_evidence()? {
            AuthorityInspection::Events(events) => Ok(events),
            AuthorityInspection::KernelExactEmptyRootResultLost(_) => Err(io::Error::new(
                io::ErrorKind::NotFound,
                "event-gap: exact namespace teardown is proven but root result was lost",
            )),
        }
    }

    pub fn inspect_evidence(&self) -> io::Result<AuthorityInspection> {
        match reopen_or_prove_absent(&self.attestation.identity)? {
            AuthorityPresence::Live(mut authority) => {
                match self.control_on(&mut authority, ControlOperation::Inspect) {
                    Ok((_stream, frame)) if frame.kind == FrameKind::Observation => {
                        let events = GuardianEvent::decode_journal(&frame.payload)?;
                        observation_from_events(&events)?;
                        Ok(AuthorityInspection::Events(events))
                    }
                    Ok(_) => Err(invalid_response("observation")),
                    Err(error) if expected_control_loss(&error) => {
                        if !authority.wait(CONTROL_TIMEOUT.as_millis() as i32)? {
                            return Err(error);
                        }
                        reap_if_child(authority.pid());
                        match self.read_terminal_events() {
                            Ok(events) => Ok(AuthorityInspection::Events(events)),
                            Err(terminal) if terminal.kind() == io::ErrorKind::NotFound => {
                                self.kernel_exact_empty_evidence()
                            }
                            Err(terminal) => Err(terminal),
                        }
                    }
                    Err(error) => Err(error),
                }
            }
            AuthorityPresence::AbsentSameBoot => match self.read_terminal_events() {
                Ok(events) => Ok(AuthorityInspection::Events(events)),
                Err(error) if error.kind() == io::ErrorKind::NotFound => {
                    self.kernel_exact_empty_evidence()
                }
                Err(error) => Err(error),
            },
        }
    }

    pub fn abort(&self, timeout_ms: u32) -> io::Result<()> {
        let mut authority = match reopen_or_prove_absent(&self.attestation.identity)? {
            AuthorityPresence::AbsentSameBoot => return Ok(()),
            AuthorityPresence::Live(authority) => authority,
        };
        let (_stream, frame) = match self.control_on(&mut authority, ControlOperation::Abort) {
            Ok(value) => value,
            Err(error) if expected_control_loss(&error) => {
                authority.send_signal(libc::SIGKILL)?;
                wait_or_kill_authority(&authority, timeout_ms)?;
                return Ok(());
            }
            Err(error) => return Err(error),
        };
        if frame.kind != FrameKind::ExactScopeEmpty {
            return Err(invalid_response("exact-scope-empty"));
        }
        let events = GuardianEvent::decode_journal(&frame.payload)?;
        if observation_from_events(&events)? != GuardianObservation::ExactScopeEmpty {
            return Err(invalid_response("exact-scope-empty journal"));
        }
        wait_or_kill_authority(&authority, timeout_ms)
    }

    pub fn terminate(&self, grace_ms: u32) -> io::Result<()> {
        let mut authority = match reopen_or_prove_absent(&self.attestation.identity)? {
            AuthorityPresence::AbsentSameBoot => return Ok(()),
            AuthorityPresence::Live(authority) => authority,
        };
        let (_stream, frame) =
            match self.control_on(&mut authority, ControlOperation::Terminate { grace_ms }) {
                Ok(value) => value,
                Err(error) if expected_control_loss(&error) => {
                    authority.send_signal(libc::SIGKILL)?;
                    wait_or_kill_authority(&authority, grace_ms)?;
                    return Ok(());
                }
                Err(error) => return Err(error),
            };
        if frame.kind != FrameKind::Observation {
            return Err(invalid_response("termination observation"));
        }
        wait_or_kill_authority(&authority, grace_ms)
    }

    fn control(
        &self,
        operation: ControlOperation,
    ) -> io::Result<(ReopenedAuthority, UnixStream, Frame)> {
        self.control_until(
            operation,
            AbsoluteMonotonicDeadline::after_ms(CONTROL_TIMEOUT.as_millis() as u32)?,
        )
    }

    fn control_until(
        &self,
        operation: ControlOperation,
        deadline: AbsoluteMonotonicDeadline,
    ) -> io::Result<(ReopenedAuthority, UnixStream, Frame)> {
        let mut authority = reopen_exact_authority(&self.attestation.identity)?;
        let (stream, response) = self.control_on_until(&mut authority, operation, deadline)?;
        Ok((authority, stream, response))
    }

    fn control_on(
        &self,
        authority: &mut ReopenedAuthority,
        operation: ControlOperation,
    ) -> io::Result<(UnixStream, Frame)> {
        self.control_on_until(
            authority,
            operation,
            AbsoluteMonotonicDeadline::after_ms(CONTROL_TIMEOUT.as_millis() as u32)?,
        )
    }

    fn control_on_until(
        &self,
        authority: &mut ReopenedAuthority,
        operation: ControlOperation,
        deadline: AbsoluteMonotonicDeadline,
    ) -> io::Result<(UnixStream, Frame)> {
        deadline.ensure_live()?;
        validate_control_socket(&self.control_socket)?;
        let mut stream = UnixStream::connect(&self.control_socket)?;
        stream.set_read_timeout(Some(deadline.remaining()?))?;
        stream.set_write_timeout(Some(deadline.remaining()?))?;
        verify_server_challenge(&mut stream, &self.attestation)?;
        authority.authenticate_pid_namespace();
        let kind = operation_frame_kind(operation);
        let request = ControlRequest {
            scope_capability: self.attestation.scope_capability,
            control_capability: self.attestation.control_capability,
            identity: self.attestation.identity.clone(),
            deadline_monotonic_ns: deadline.absolute_ns()?,
            operation,
        };
        write_frame(&mut stream, &Frame::new(kind, request.encode()?)?)?;
        let mut response = read_frame(&mut stream)?.ok_or_else(|| {
            io::Error::new(io::ErrorKind::UnexpectedEof, "guardian closed control")
        })?;
        if operation == ControlOperation::Activate {
            if response.kind != FrameKind::ActivationReady
                || response.payload != deadline.absolute_ns()?.to_be_bytes()
            {
                return Err(invalid_response("activation-ready"));
            }
            deadline.ensure_live()?;
            write_frame(
                &mut stream,
                &Frame::new(
                    FrameKind::ReleaseGate,
                    deadline.absolute_ns()?.to_be_bytes().to_vec(),
                )?,
            )?;
            response = read_frame(&mut stream)?.ok_or_else(|| {
                io::Error::new(
                    io::ErrorKind::UnexpectedEof,
                    "guardian closed activation permit",
                )
            })?;
        }
        if response.kind == FrameKind::Failure {
            let failure = NativeFailure::decode(&response.payload)?;
            return Err(io::Error::other(failure.code.diagnostic_code()));
        }
        Ok((stream, response))
    }

    fn read_terminal_events(&self) -> io::Result<Vec<GuardianEvent>> {
        let directory = open_scope_dir(&self.scope_directory)?;
        let events = DurableJournal::read_bound(
            &directory,
            "terminal.bin",
            &journal_binding(&self.attestation),
        )?;
        let observation = observation_from_events(&events)?;
        if observation == GuardianObservation::ExactScopeEmpty {
            reap_if_child(self.attestation.identity.guardian_pid);
        }
        Ok(events)
    }

    pub fn journal(&self) -> io::Result<Vec<GuardianEvent>> {
        let directory = open_scope_dir(&self.scope_directory)?;
        DurableJournal::read_bound(
            &directory,
            "journal.bin",
            &journal_binding(&self.attestation),
        )
    }

    fn kernel_exact_empty_evidence(&self) -> io::Result<AuthorityInspection> {
        let mut events = self.journal()?;
        match events.last().map(|event| event.kind) {
            Some(GuardianEventKind::Prepared) | Some(GuardianEventKind::Activated) => {
                events.push(GuardianEvent::exact_empty(events.len() as u64 + 1));
            }
            Some(GuardianEventKind::RootExited) => {
                events.push(GuardianEvent::exact_empty(events.len() as u64 + 1));
                GuardianEvent::encode_journal(&events)?;
                return Ok(AuthorityInspection::Events(events));
            }
            Some(GuardianEventKind::ExactScopeEmpty) => {
                return Ok(AuthorityInspection::Events(events));
            }
            None => return Err(invalid_response("kernel exact-empty evidence")),
        }
        GuardianEvent::encode_journal(&events)?;
        if GuardianEvent::root_result_lost(&events) {
            Ok(AuthorityInspection::KernelExactEmptyRootResultLost(events))
        } else {
            Ok(AuthorityInspection::Events(events))
        }
    }
}

pub enum AuthorityInspection {
    Events(Vec<GuardianEvent>),
    KernelExactEmptyRootResultLost(Vec<GuardianEvent>),
}

pub fn current_executable_digest() -> io::Result<[u8; 32]> {
    let mut file = File::open("/proc/self/exe")?;
    let metadata = file.metadata()?;
    if !metadata.is_file() {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "current helper artifact is not an exact regular file",
        ));
    }
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = file.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        digest.update(&buffer[..count]);
    }
    Ok(digest.finalize().into())
}

pub fn prepare_primary(
    request: PrepareRequest,
    expected_artifact_digest: [u8; 32],
    source_digest: [u8; 32],
) -> io::Result<PreparedPrimary> {
    prepare_primary_with_deadline_ms(
        request,
        expected_artifact_digest,
        source_digest,
        PREPARE_TIMEOUT_MS,
    )
}

pub fn prepare_primary_with_deadline_ms(
    request: PrepareRequest,
    expected_artifact_digest: [u8; 32],
    source_digest: [u8; 32],
    deadline_ms: u32,
) -> io::Result<PreparedPrimary> {
    let mut permit = ImmediatePreReadinessPermit;
    prepare_primary_recoverable_until(
        request,
        expected_artifact_digest,
        source_digest,
        AbsoluteMonotonicDeadline::after_ms(deadline_ms)?,
        &mut permit,
    )
}

pub trait PreReadinessPermit {
    fn commit_and_release(
        &mut self,
        candidate: &PreparedPrimary,
        deadline: AbsoluteMonotonicDeadline,
    ) -> io::Result<()>;
}

struct ImmediatePreReadinessPermit;

impl PreReadinessPermit for ImmediatePreReadinessPermit {
    fn commit_and_release(
        &mut self,
        _candidate: &PreparedPrimary,
        deadline: AbsoluteMonotonicDeadline,
    ) -> io::Result<()> {
        deadline.ensure_live()
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ConstructionCheckpoint {
    ScopeCreated,
    ScopeDirectoryOpened,
    PrivateListenerBound,
    HandshakePipesCreated,
    GuardianCloned,
    MappingComplete,
    ChildNamespaceReady,
    ProcessIdentityRevalidated,
    PidfdOpenedAndRevalidated,
    AttestationEncoded,
    PreReadinessPermitHeld,
    IdentityLengthTransferred,
    IdentityBodyTransferred,
    ChildIdentityRevalidated,
    JournalCreated,
    RuntimeHiddenAndNondumpable,
    ChildReadyReceived,
    FinalParentRevalidation,
}

trait ConstructionObserver {
    fn checkpoint(
        &mut self,
        checkpoint: ConstructionCheckpoint,
        identity: Option<&AuthorityIdentity>,
    ) -> io::Result<()>;
}

struct NoopConstructionObserver;

impl ConstructionObserver for NoopConstructionObserver {
    fn checkpoint(
        &mut self,
        _checkpoint: ConstructionCheckpoint,
        _identity: Option<&AuthorityIdentity>,
    ) -> io::Result<()> {
        Ok(())
    }
}

pub fn prepare_primary_recoverable_until(
    request: PrepareRequest,
    expected_artifact_digest: [u8; 32],
    source_digest: [u8; 32],
    deadline: AbsoluteMonotonicDeadline,
    permit: &mut dyn PreReadinessPermit,
) -> io::Result<PreparedPrimary> {
    let mut observer = NoopConstructionObserver;
    prepare_primary_observed_until(
        request,
        expected_artifact_digest,
        source_digest,
        deadline,
        permit,
        &mut observer,
        None,
    )
}

fn prepare_primary_observed_until(
    request: PrepareRequest,
    expected_artifact_digest: [u8; 32],
    source_digest: [u8; 32],
    deadline: AbsoluteMonotonicDeadline,
    permit: &mut dyn PreReadinessPermit,
    observer: &mut dyn ConstructionObserver,
    failure_checkpoint: Option<ConstructionCheckpoint>,
) -> io::Result<PreparedPrimary> {
    deadline.ensure_live()?;
    let immutable = PrepareRequest::decode(&request.encode()?)?;
    let launch_handles = prepare_launch_filesystem(&immutable.launch)?;
    let artifact_digest = current_executable_digest()?;
    if expected_artifact_digest.iter().all(|byte| *byte == 0)
        || source_digest.iter().all(|byte| *byte == 0)
        || artifact_digest != expected_artifact_digest
        || artifact_digest == source_digest
    {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "native helper artifact or source digest is not verified",
        ));
    }
    let launch_digest = immutable.launch.digest()?;
    let scope = PrivateScope::create(&immutable.runtime_root, &immutable.launch.cwd)?;
    if let Err(error) = observer.checkpoint(ConstructionCheckpoint::ScopeCreated, None) {
        cleanup_scope(&scope);
        return Err(error);
    }
    let scope_directory = match open_scope_dir(&scope.directory) {
        Ok(directory) => directory,
        Err(error) => {
            cleanup_scope(&scope);
            return Err(error);
        }
    };
    if let Err(error) = observer.checkpoint(ConstructionCheckpoint::ScopeDirectoryOpened, None) {
        cleanup_scope(&scope);
        return Err(error);
    }
    let listener = match bind_private_listener(&scope) {
        Ok(listener) => listener,
        Err(error) => {
            cleanup_scope(&scope);
            return Err(error);
        }
    };
    if let Err(error) = observer.checkpoint(ConstructionCheckpoint::PrivateListenerBound, None) {
        cleanup_scope(&scope);
        return Err(error);
    }
    if let Err(error) = listener.set_nonblocking(true) {
        cleanup_scope(&scope);
        return Err(error);
    }

    let construction_parent_pidfd =
        unsafe { libc::syscall(libc::SYS_pidfd_open, libc::getpid(), 0) as RawFd };
    if construction_parent_pidfd < 0 {
        let error = io::Error::last_os_error();
        cleanup_scope(&scope);
        return Err(error);
    }

    let (parent_gate_read, parent_gate_write) = match pipe_cloexec() {
        Ok(pipe) => pipe,
        Err(error) => {
            close_fd(construction_parent_pidfd);
            cleanup_scope(&scope);
            return Err(error);
        }
    };
    let (child_ready_read, child_ready_write) = match pipe_cloexec() {
        Ok(pipe) => pipe,
        Err(error) => {
            close_fd(construction_parent_pidfd);
            close_fd(parent_gate_read);
            close_fd(parent_gate_write);
            cleanup_scope(&scope);
            return Err(error);
        }
    };
    if let Err(error) = observer.checkpoint(ConstructionCheckpoint::HandshakePipesCreated, None) {
        close_fd(construction_parent_pidfd);
        close_fd(parent_gate_read);
        close_fd(parent_gate_write);
        close_fd(child_ready_read);
        close_fd(child_ready_write);
        cleanup_scope(&scope);
        return Err(error);
    }
    let context = Box::new(ChildContext {
        request: immutable.clone(),
        launch_handles,
        scope: scope.clone(),
        scope_directory,
        listener_fd: listener.as_raw_fd(),
        parent_gate_read,
        child_ready_write,
        deadline,
        construction_parent_pidfd,
        failure_checkpoint,
    });
    let context_pointer = Box::into_raw(context);
    let mut stack = vec![0_u8; 1024 * 1024];
    let stack_top = ((unsafe { stack.as_mut_ptr().add(stack.len()) } as usize) & !15_usize)
        as *mut libc::c_void;
    let flags = libc::CLONE_NEWUSER | libc::CLONE_NEWPID | libc::CLONE_NEWNS | libc::SIGCHLD;
    let pid = unsafe { libc::clone(child_entry, stack_top, flags, context_pointer.cast()) };
    unsafe {
        drop(Box::from_raw(context_pointer));
    }
    if pid < 0 {
        let error = io::Error::last_os_error();
        close_fd(construction_parent_pidfd);
        close_fd(parent_gate_read);
        close_fd(parent_gate_write);
        close_fd(child_ready_read);
        close_fd(child_ready_write);
        cleanup_scope(&scope);
        return Err(error);
    }
    close_fd(construction_parent_pidfd);
    close_fd(parent_gate_read);
    close_fd(child_ready_write);
    drop(listener);

    let construction = (|| {
        observer.checkpoint(ConstructionCheckpoint::GuardianCloned, None)?;
        deadline.ensure_live()?;
        configure_user_mapping(pid)?;
        observer.checkpoint(ConstructionCheckpoint::MappingComplete, None)?;
        write_all_fd_until(parent_gate_write, b"M", deadline)?;
        expect_byte_until(child_ready_read, b'N', deadline)?;
        observer.checkpoint(ConstructionCheckpoint::ChildNamespaceReady, None)?;
        let identity = read_process_identity(pid as u32)?;
        observer.checkpoint(
            ConstructionCheckpoint::ProcessIdentityRevalidated,
            Some(&identity),
        )?;
        let pidfd_proof = reopen_exact_authority(&identity)?;
        pidfd_proof.send_signal(0)?;
        if pidfd_proof.wait(0)? {
            return Err(io::Error::new(
                io::ErrorKind::UnexpectedEof,
                "guardian exited during pidfd feature proof",
            ));
        }
        observer.checkpoint(
            ConstructionCheckpoint::PidfdOpenedAndRevalidated,
            Some(&identity),
        )?;
        let identity_bytes = encode_identity_bootstrap(&identity)?;
        let prepared = PreparedPrimary {
            attestation: PreparedAttestation {
                helper_protocol_version: crate::protocol::PROTOCOL_VERSION,
                scope_id: scope.scope_id,
                scope_capability: scope.scope_capability,
                control_capability: scope.control_capability,
                preparation_operation_id: immutable.operation_id,
                launch_digest,
                artifact_digest,
                source_digest,
                identity,
            },
            runtime_root: immutable.runtime_root,
        };
        prepared.attestation.encode()?;
        observer.checkpoint(
            ConstructionCheckpoint::AttestationEncoded,
            Some(&prepared.attestation.identity),
        )?;
        // Broker recovery uses this hook to fsync the exact control reference before
        // the guardian receives its final identity and can cross the readiness gate.
        // The ordinary primary path preserves its existing semantics through a no-op hook.
        permit.commit_and_release(&prepared, deadline)?;
        observer.checkpoint(
            ConstructionCheckpoint::PreReadinessPermitHeld,
            Some(&prepared.attestation.identity),
        )?;
        deadline.ensure_live()?;
        write_all_fd_until(
            parent_gate_write,
            &(identity_bytes.len() as u32).to_be_bytes(),
            deadline,
        )?;
        observer.checkpoint(
            ConstructionCheckpoint::IdentityLengthTransferred,
            Some(&prepared.attestation.identity),
        )?;
        write_all_fd_until(parent_gate_write, &identity_bytes, deadline)?;
        observer.checkpoint(
            ConstructionCheckpoint::IdentityBodyTransferred,
            Some(&prepared.attestation.identity),
        )?;
        expect_byte_until(child_ready_read, b'R', deadline)?;
        observer.checkpoint(
            ConstructionCheckpoint::ChildReadyReceived,
            Some(&prepared.attestation.identity),
        )?;
        observer.checkpoint(
            ConstructionCheckpoint::FinalParentRevalidation,
            Some(&prepared.attestation.identity),
        )?;
        revalidate_prepared_candidate(&prepared, deadline)?;
        Ok(prepared)
    })();
    close_fd(parent_gate_write);
    close_fd(child_ready_read);

    match construction {
        Ok(prepared) => Ok(prepared),
        Err(error) => {
            kill_and_reap(pid);
            cleanup_scope(&scope);
            Err(error)
        }
    }
}

struct ChildContext {
    request: PrepareRequest,
    launch_handles: PreparedLaunch,
    scope: PrivateScope,
    scope_directory: File,
    listener_fd: RawFd,
    parent_gate_read: RawFd,
    child_ready_write: RawFd,
    deadline: AbsoluteMonotonicDeadline,
    construction_parent_pidfd: RawFd,
    failure_checkpoint: Option<ConstructionCheckpoint>,
}

extern "C" fn child_entry(argument: *mut libc::c_void) -> libc::c_int {
    let context = unsafe { Box::from_raw(argument.cast::<ChildContext>()) };
    let failure_report = context.child_ready_write;
    let result = child_main(*context);
    if let Err(error) = &result {
        let code = NativeFailureCode::from_prepare_error(error) as u8;
        unsafe {
            libc::write(failure_report, [b'E', code].as_ptr().cast(), 2);
        }
    }
    unsafe { libc::_exit(if result.is_ok() { 0 } else { 71 }) }
}

fn child_main(context: ChildContext) -> io::Result<()> {
    install_parent_death_coupling(context.construction_parent_pidfd)?;
    expect_byte_until(context.parent_gate_read, b'M', context.deadline)?;
    configure_child_namespace()?;
    redirect_guardian_stdio()?;
    let mut guardian_descriptors = vec![
        context.listener_fd,
        context.parent_gate_read,
        context.child_ready_write,
        context.construction_parent_pidfd,
        context.scope_directory.as_raw_fd(),
        context.launch_handles.command.as_raw_fd(),
        context.launch_handles.cwd.as_raw_fd(),
    ];
    if let Some(script) = &context.launch_handles.script {
        guardian_descriptors.push(script.readable.as_raw_fd());
        guardian_descriptors.push(script.interpreter.executable.as_raw_fd());
    }
    strict_close_except(&guardian_descriptors)?;
    if unsafe { libc::getpid() } != 1 {
        return Err(io::Error::other("namespace guardian is not PID 1"));
    }
    verify_namespace_proc()?;
    write_all_fd_until(context.child_ready_write, b"N", context.deadline)?;
    let identity = read_bootstrap_identity_until(context.parent_gate_read, context.deadline)?;
    release_parent_death_coupling(context.construction_parent_pidfd)?;
    verify_child_identity(&identity)?;
    fail_at_construction_checkpoint(
        context.failure_checkpoint,
        ConstructionCheckpoint::ChildIdentityRevalidated,
        context.child_ready_write,
        context.deadline,
    )?;
    let binding = JournalBinding {
        scope_id: context.scope.scope_id,
        scope_capability: context.scope.scope_capability,
        launch_digest: context.request.launch.digest()?,
        identity: identity.clone(),
    };
    let mut journal = DurableJournal::create_in(context.scope_directory, binding)?;
    fail_at_construction_checkpoint(
        context.failure_checkpoint,
        ConstructionCheckpoint::JournalCreated,
        context.child_ready_write,
        context.deadline,
    )?;
    let listener = unsafe { UnixListener::from_raw_fd(context.listener_fd) };
    hide_authority_runtime(&context.request.runtime_root, &context.scope.directory)?;
    set_guardian_nondumpable()?;
    fail_at_construction_checkpoint(
        context.failure_checkpoint,
        ConstructionCheckpoint::RuntimeHiddenAndNondumpable,
        context.child_ready_write,
        context.deadline,
    )?;
    context.deadline.ensure_live()?;
    write_all_fd_until(context.child_ready_write, b"R", context.deadline)?;
    close_fd(context.parent_gate_read);
    close_fd(context.child_ready_write);
    unsafe {
        libc::signal(libc::SIGPIPE, libc::SIG_IGN);
    }
    let mut guardian = Guardian {
        listener,
        launch: context.request.launch,
        launch_handles: context.launch_handles,
        scope_capability: context.scope.scope_capability,
        control_capability: context.scope.control_capability,
        identity,
        machine: GuardianMachine::prepared(),
        journal: &mut journal,
        runtime: None,
        root: None,
        exiting: false,
    };
    guardian.run()
}

fn fail_at_construction_checkpoint(
    selected: Option<ConstructionCheckpoint>,
    actual: ConstructionCheckpoint,
    report_fd: RawFd,
    deadline: AbsoluteMonotonicDeadline,
) -> io::Result<()> {
    if selected == Some(actual) {
        write_all_fd_until(report_fd, b"F", deadline)?;
        Err(io::Error::other(format!(
            "injected construction failure at {actual:?}"
        )))
    } else {
        Ok(())
    }
}

fn revalidate_prepared_candidate(
    prepared: &PreparedPrimary,
    deadline: AbsoluteMonotonicDeadline,
) -> io::Result<()> {
    deadline.ensure_live()?;
    let client = AuthorityClient::new(&prepared.runtime_root, prepared.attestation.clone())?;
    validate_control_socket(&client.control_socket)?;
    let mut authority = reopen_exact_authority(&prepared.attestation.identity)?;
    if authority.wait(0)? {
        return Err(io::Error::new(
            io::ErrorKind::UnexpectedEof,
            "guardian exited before final parent revalidation",
        ));
    }
    let mut stream = UnixStream::connect(&client.control_socket)?;
    stream.set_read_timeout(Some(deadline.remaining()?))?;
    stream.set_write_timeout(Some(deadline.remaining()?))?;
    verify_server_challenge(&mut stream, &prepared.attestation)?;
    authority.authenticate_pid_namespace();
    authority.send_signal(0)?;
    let directory = open_scope_dir(&client.scope_directory)?;
    let events = DurableJournal::read_bound(
        &directory,
        "journal.bin",
        &journal_binding(&prepared.attestation),
    )?;
    if events != [GuardianEvent::prepared()] {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "final prepared journal revalidation differs",
        ));
    }
    deadline.ensure_live()
}

fn install_parent_death_coupling(parent_pidfd: RawFd) -> io::Result<()> {
    if parent_pidfd < 0
        || unsafe { libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGKILL, 0, 0, 0) } != 0
    {
        return Err(io::Error::last_os_error());
    }
    let mut descriptor = libc::pollfd {
        fd: parent_pidfd,
        events: libc::POLLIN,
        revents: 0,
    };
    let polled = unsafe { libc::poll(&mut descriptor, 1, 0) };
    if polled < 0 {
        return Err(io::Error::last_os_error());
    }
    if polled != 0 {
        return Err(io::Error::new(
            io::ErrorKind::BrokenPipe,
            "primary construction parent died before guardian coupling",
        ));
    }
    Ok(())
}

fn release_parent_death_coupling(parent_pidfd: RawFd) -> io::Result<()> {
    if unsafe { libc::prctl(libc::PR_SET_PDEATHSIG, 0, 0, 0, 0) } != 0 {
        return Err(io::Error::last_os_error());
    }
    close_fd(parent_pidfd);
    Ok(())
}

struct RootProcess {
    pid: libc::pid_t,
    exited: bool,
    stdin: Option<File>,
    stdout: File,
    stderr: File,
    pending_input: VecDeque<u8>,
    close_input_pending: bool,
}

struct FileIdentity {
    device: u64,
    inode: u64,
    mode: u32,
}

struct PreparedLaunch {
    command: File,
    cwd: File,
    command_identity: FileIdentity,
    cwd_identity: FileIdentity,
    script: Option<PreparedScript>,
}

struct PreparedScript {
    readable: File,
    interpreter: PreparedInterpreter,
}

struct PreparedInterpreter {
    executable: File,
    identity: FileIdentity,
    canonical_path: PathBuf,
    argument: Option<String>,
}

struct Guardian<'a> {
    listener: UnixListener,
    launch: LaunchSpec,
    launch_handles: PreparedLaunch,
    scope_capability: [u8; 32],
    control_capability: [u8; 32],
    identity: AuthorityIdentity,
    machine: GuardianMachine,
    journal: &'a mut DurableJournal,
    runtime: Option<UnixStream>,
    root: Option<RootProcess>,
    exiting: bool,
}

impl Guardian<'_> {
    fn run(&mut self) -> io::Result<()> {
        while !self.exiting {
            let mut descriptors = vec![libc::pollfd {
                fd: self.listener.as_raw_fd(),
                events: libc::POLLIN,
                revents: 0,
            }];
            let runtime_index = self.runtime.as_ref().map(|runtime| {
                descriptors.push(libc::pollfd {
                    fd: runtime.as_raw_fd(),
                    events: libc::POLLIN | libc::POLLHUP,
                    revents: 0,
                });
                descriptors.len() - 1
            });
            let output_indices = self.root.as_ref().map(|root| {
                descriptors.push(libc::pollfd {
                    fd: root.stdout.as_raw_fd(),
                    events: libc::POLLIN | libc::POLLHUP,
                    revents: 0,
                });
                let stdout = descriptors.len() - 1;
                descriptors.push(libc::pollfd {
                    fd: root.stderr.as_raw_fd(),
                    events: libc::POLLIN | libc::POLLHUP,
                    revents: 0,
                });
                (stdout, descriptors.len() - 1)
            });
            let stdin_index = self.root.as_ref().and_then(|root| {
                if root.stdin.is_some() && !root.pending_input.is_empty() {
                    descriptors.push(libc::pollfd {
                        fd: root.stdin.as_ref().expect("checked").as_raw_fd(),
                        events: libc::POLLOUT | libc::POLLHUP,
                        revents: 0,
                    });
                    Some(descriptors.len() - 1)
                } else {
                    None
                }
            });
            let result = unsafe {
                libc::poll(
                    descriptors.as_mut_ptr(),
                    descriptors.len() as libc::nfds_t,
                    25,
                )
            };
            if result < 0 && io::Error::last_os_error().kind() != io::ErrorKind::Interrupted {
                return Err(io::Error::last_os_error());
            }
            if descriptors[0].revents & libc::POLLIN != 0 {
                self.accept_control()?;
            }
            if let Some(index) = runtime_index {
                if descriptors[index].revents & (libc::POLLIN | libc::POLLHUP) != 0 {
                    if self.receive_runtime_input().is_err() {
                        self.runtime = None;
                    }
                }
            }
            if let Some((stdout, stderr)) = output_indices {
                if descriptors[stdout].revents & (libc::POLLIN | libc::POLLHUP) != 0 {
                    self.relay_output(false)?;
                }
                if descriptors[stderr].revents & (libc::POLLIN | libc::POLLHUP) != 0 {
                    self.relay_output(true)?;
                }
            }
            if let Some(index) = stdin_index {
                if descriptors[index].revents & (libc::POLLOUT | libc::POLLHUP) != 0 {
                    self.flush_runtime_input()?;
                }
            }
            self.reap_children()?;
        }
        Ok(())
    }

    fn accept_control(&mut self) -> io::Result<()> {
        loop {
            let (mut stream, _) = match self.listener.accept() {
                Ok(value) => value,
                Err(error) if error.kind() == io::ErrorKind::WouldBlock => return Ok(()),
                Err(error) => return Err(error),
            };
            stream.set_read_timeout(Some(CONTROL_TIMEOUT))?;
            stream.set_write_timeout(Some(CONTROL_TIMEOUT))?;
            if let Err(error) =
                send_server_challenge(&mut stream, &self.scope_capability, &self.identity)
            {
                if !expected_control_loss(&error) {
                    return Err(error);
                }
                continue;
            }
            match self.handle_control(&mut stream) {
                Ok(true) => self.runtime = Some(stream),
                Ok(false) => {}
                Err(error) => {
                    let failure = NativeFailure {
                        code: NativeFailureCode::from_control_error(&error),
                    };
                    if let Ok(frame) = Frame::new(FrameKind::Failure, failure.encode().to_vec()) {
                        let _ = write_frame(&mut stream, &frame);
                    }
                }
            }
            if self.exiting {
                return Ok(());
            }
        }
    }

    fn handle_control(&mut self, stream: &mut UnixStream) -> io::Result<bool> {
        let frame = read_frame(stream)?.ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::UnexpectedEof,
                "empty guardian control request",
            )
        })?;
        let request = ControlRequest::decode(&frame.payload)?;
        if !capability_equal(&request.scope_capability, &self.scope_capability)
            || !capability_equal(&request.control_capability, &self.control_capability)
            || request.identity != self.identity
            || frame.kind != operation_frame_kind(request.operation)
        {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "guardian control authentication failed",
            ));
        }
        let deadline = AbsoluteMonotonicDeadline::from_absolute_ns(request.deadline_monotonic_ns)?;
        deadline.ensure_live()?;
        match request.operation {
            ControlOperation::OpenRuntime => {
                if self.runtime.is_some() || self.machine.observe() != GuardianObservation::Inert {
                    return Err(io::Error::new(
                        io::ErrorKind::AlreadyExists,
                        "runtime bridge is already open or no longer inert",
                    ));
                }
                write_frame(stream, &Frame::new(FrameKind::RuntimeReady, Vec::new())?)?;
                stream.set_read_timeout(Some(Duration::from_secs(1)))?;
                stream.set_write_timeout(Some(Duration::from_secs(1)))?;
                Ok(true)
            }
            ControlOperation::Activate => {
                if self.runtime.is_none() {
                    return Err(io::Error::new(
                        io::ErrorKind::NotConnected,
                        "runtime bridge must open before activation",
                    ));
                }
                if self.machine.observe() != GuardianObservation::Inert {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidInput,
                        "guardian activation is exactly once",
                    ));
                }
                verify_prepared_launch(&self.launch_handles)?;
                let (root, activation_gate) =
                    spawn_root(&self.launch, &self.launch_handles, deadline)?;
                stream.set_read_timeout(Some(deadline.remaining()?))?;
                stream.set_write_timeout(Some(deadline.remaining()?))?;
                if let Err(error) = write_frame(
                    stream,
                    &Frame::new(
                        FrameKind::ActivationReady,
                        deadline.absolute_ns()?.to_be_bytes().to_vec(),
                    )?,
                ) {
                    close_fd(activation_gate);
                    kill_and_reap(root.pid);
                    return Err(error);
                }
                let permit = match read_frame(stream) {
                    Ok(Some(frame)) => frame,
                    Ok(None) => {
                        close_fd(activation_gate);
                        kill_and_reap(root.pid);
                        return Err(io::Error::new(
                            io::ErrorKind::UnexpectedEof,
                            "activation permit stream closed",
                        ));
                    }
                    Err(error) => {
                        close_fd(activation_gate);
                        kill_and_reap(root.pid);
                        return Err(error);
                    }
                };
                if permit.kind != FrameKind::ReleaseGate
                    || permit.payload != deadline.absolute_ns()?.to_be_bytes()
                    || deadline.is_expired()?
                {
                    close_fd(activation_gate);
                    kill_and_reap(root.pid);
                    return Err(io::Error::new(
                        io::ErrorKind::TimedOut,
                        "activation gate permit missed its absolute deadline",
                    ));
                }
                // This nonblocking one-byte write is the activation linearization point.
                // The gated root independently rechecks the same absolute clock before exec.
                if let Err(error) = write_all_fd_until(activation_gate, b"A", deadline) {
                    close_fd(activation_gate);
                    kill_and_reap(root.pid);
                    return Err(error);
                }
                close_fd(activation_gate);
                let activation_event = GuardianEvent::activated(2);
                if let Err(error) = self.journal.append(activation_event) {
                    kill_and_reap(root.pid);
                    return Err(error);
                }
                self.machine.activate()?;
                self.root = Some(root);
                write_frame(stream, &Frame::new(FrameKind::Activated, Vec::new())?)?;
                self.send_event(FrameKind::Event)?;
                Ok(false)
            }
            ControlOperation::Inspect => {
                write_frame(
                    stream,
                    &Frame::new(
                        FrameKind::Observation,
                        GuardianEvent::encode_journal(self.machine.events())?,
                    )?,
                )?;
                Ok(false)
            }
            ControlOperation::Abort => {
                let event = self.machine.abort_inert()?;
                self.journal.append(event)?;
                self.journal.commit_terminal()?;
                // Terminal durability decides lifecycle. Response delivery is best effort and
                // must never resurrect an exact-empty guardian.
                self.exiting = true;
                let _ = write_frame(
                    stream,
                    &Frame::new(
                        FrameKind::ExactScopeEmpty,
                        GuardianEvent::encode_journal(self.machine.events())?,
                    )?,
                );
                Ok(false)
            }
            ControlOperation::Terminate { .. } => {
                let root = self.root.as_ref().ok_or_else(|| {
                    io::Error::new(io::ErrorKind::InvalidInput, "scope is not activated")
                })?;
                if !root.exited && unsafe { libc::kill(root.pid, libc::SIGTERM) } < 0 {
                    let error = io::Error::last_os_error();
                    if error.kind() != io::ErrorKind::NotFound {
                        return Err(error);
                    }
                }
                write_frame(
                    stream,
                    &Frame::new(
                        FrameKind::Observation,
                        GuardianEvent::encode_journal(self.machine.events())?,
                    )?,
                )?;
                Ok(false)
            }
        }
    }

    fn receive_runtime_input(&mut self) -> io::Result<()> {
        let frame = match self.runtime.as_mut().map(read_frame) {
            Some(Ok(Some(frame))) => frame,
            Some(Ok(None)) => {
                self.runtime = None;
                if let Some(root) = self.root.as_mut() {
                    root.close_input_pending = true;
                }
                return Ok(());
            }
            Some(Err(error)) if error.kind() == io::ErrorKind::WouldBlock => return Ok(()),
            Some(Err(_)) => {
                self.runtime = None;
                if let Some(root) = self.root.as_mut() {
                    root.close_input_pending = true;
                }
                return Ok(());
            }
            None => return Ok(()),
        };
        match frame.kind {
            FrameKind::Input if frame.payload.len() <= MAX_RUNTIME_INPUT => {
                let root = self.root.as_mut().ok_or_else(|| {
                    io::Error::new(io::ErrorKind::BrokenPipe, "root stdin closed")
                })?;
                if root.stdin.is_none() || root.close_input_pending {
                    return Err(io::Error::new(
                        io::ErrorKind::BrokenPipe,
                        "root stdin closed",
                    ));
                }
                if root.pending_input.len() + frame.payload.len() > MAX_PENDING_INPUT {
                    root.pending_input.clear();
                    root.stdin = None;
                    self.runtime = None;
                    return Ok(());
                }
                root.pending_input.extend(frame.payload);
                self.flush_runtime_input()
            }
            FrameKind::CloseInput if frame.payload.is_empty() => {
                if let Some(root) = self.root.as_mut() {
                    root.close_input_pending = true;
                }
                self.flush_runtime_input()
            }
            _ => Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "runtime bridge frame is invalid",
            )),
        }
    }

    fn flush_runtime_input(&mut self) -> io::Result<()> {
        let root = match self.root.as_mut() {
            Some(root) => root,
            None => return Ok(()),
        };
        while !root.pending_input.is_empty() {
            let stdin = match root.stdin.as_mut() {
                Some(stdin) => stdin,
                None => {
                    root.pending_input.clear();
                    return Ok(());
                }
            };
            let (front, _) = root.pending_input.as_slices();
            let written =
                unsafe { libc::write(stdin.as_raw_fd(), front.as_ptr().cast(), front.len()) };
            if written < 0 {
                let error = io::Error::last_os_error();
                if matches!(
                    error.kind(),
                    io::ErrorKind::WouldBlock | io::ErrorKind::Interrupted
                ) {
                    return Ok(());
                }
                if matches!(error.kind(), io::ErrorKind::BrokenPipe) {
                    root.pending_input.clear();
                    root.stdin = None;
                    return Ok(());
                }
                return Err(error);
            }
            root.pending_input.drain(..written as usize);
        }
        if root.close_input_pending {
            root.stdin = None;
        }
        Ok(())
    }

    fn relay_output(&mut self, error_output: bool) -> io::Result<()> {
        let mut buffer = [0_u8; OUTPUT_CHUNK];
        let read = {
            let root = match self.root.as_mut() {
                Some(root) => root,
                None => return Ok(()),
            };
            if error_output {
                root.stderr.read(&mut buffer)
            } else {
                root.stdout.read(&mut buffer)
            }
        };
        match read {
            Ok(0) => Ok(()),
            Ok(count) => self.send_runtime(Frame::new(
                if error_output {
                    FrameKind::ErrorOutput
                } else {
                    FrameKind::Output
                },
                buffer[..count].to_vec(),
            )?),
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => Ok(()),
            Err(error) => Err(error),
        }
    }

    fn reap_children(&mut self) -> io::Result<()> {
        let mut root_exit = None;
        let mut child_set_empty = false;
        loop {
            let mut status = 0;
            let pid = unsafe { libc::waitpid(-1, &mut status, libc::WNOHANG) };
            if pid > 0 {
                if self.root.as_ref().map(|root| root.pid) == Some(pid) {
                    root_exit = Some(decode_wait_status(status)?);
                    if let Some(root) = self.root.as_mut() {
                        root.exited = true;
                        root.stdin = None;
                    }
                }
                continue;
            }
            if pid == 0 {
                break;
            }
            let error = io::Error::last_os_error();
            if error.raw_os_error() == Some(libc::ECHILD) {
                child_set_empty = true;
                break;
            }
            if error.kind() != io::ErrorKind::Interrupted {
                return Err(error);
            }
        }

        if let Some(status) = root_exit {
            let event = self.machine.root_exited(status, !child_set_empty)?;
            self.journal.append(event)?;
            self.send_event(FrameKind::Event)?;
            if child_set_empty {
                let exact = self.machine.descendants_empty()?;
                self.journal.append(exact)?;
                self.finish_exact_empty()?;
            }
        } else if child_set_empty
            && self.machine.events().last().map(|event| event.kind)
                == Some(GuardianEventKind::RootExited)
        {
            let event = self.machine.descendants_empty()?;
            self.journal.append(event)?;
            self.finish_exact_empty()?;
        }
        Ok(())
    }

    fn finish_exact_empty(&mut self) -> io::Result<()> {
        self.drain_closed_outputs()?;
        self.journal.commit_terminal()?;
        self.send_event(FrameKind::ExactScopeEmpty)?;
        self.exiting = true;
        Ok(())
    }

    fn drain_closed_outputs(&mut self) -> io::Result<()> {
        for error_output in [false, true] {
            loop {
                let mut buffer = [0_u8; OUTPUT_CHUNK];
                let count = {
                    let root = match self.root.as_mut() {
                        Some(root) => root,
                        None => break,
                    };
                    if error_output {
                        root.stderr.read(&mut buffer)?
                    } else {
                        root.stdout.read(&mut buffer)?
                    }
                };
                if count == 0 {
                    break;
                }
                self.send_runtime(Frame::new(
                    if error_output {
                        FrameKind::ErrorOutput
                    } else {
                        FrameKind::Output
                    },
                    buffer[..count].to_vec(),
                )?)?;
            }
        }
        Ok(())
    }

    fn send_event(&mut self, kind: FrameKind) -> io::Result<()> {
        self.send_runtime(Frame::new(
            kind,
            GuardianEvent::encode_journal(self.machine.events())?,
        )?)
    }

    fn send_runtime(&mut self, frame: Frame) -> io::Result<()> {
        if let Some(runtime) = self.runtime.as_mut() {
            if write_frame(runtime, &frame).is_err() {
                self.runtime = None;
            }
        }
        Ok(())
    }
}

fn spawn_root(
    launch: &LaunchSpec,
    handles: &PreparedLaunch,
    deadline: AbsoluteMonotonicDeadline,
) -> io::Result<(RootProcess, RawFd)> {
    let mut arguments = Vec::with_capacity(launch.args.len() + 3);
    let executable_fd = if let Some(script) = &handles.script {
        arguments.push(path_cstring(&script.interpreter.canonical_path)?);
        if let Some(argument) = &script.interpreter.argument {
            arguments.push(cstring(argument)?);
        }
        arguments.push(cstring(&format!(
            "/proc/self/fd/{}",
            script.readable.as_raw_fd()
        ))?);
        script.interpreter.executable.as_raw_fd()
    } else {
        arguments.push(path_cstring(&launch.command)?);
        handles.command.as_raw_fd()
    };
    for argument in &launch.args {
        arguments.push(cstring(argument)?);
    }
    let mut argument_pointers: Vec<*const libc::c_char> =
        arguments.iter().map(|value| value.as_ptr()).collect();
    argument_pointers.push(std::ptr::null());
    let environment: io::Result<Vec<CString>> = launch
        .env
        .iter()
        .map(|(key, value)| cstring(&format!("{key}={value}")))
        .collect();
    let environment = environment?;
    let mut environment_pointers: Vec<*const libc::c_char> =
        environment.iter().map(|value| value.as_ptr()).collect();
    environment_pointers.push(std::ptr::null());

    let (stdin_read, stdin_write) = pipe_cloexec()?;
    let (stdout_read, stdout_write) = pipe_cloexec()?;
    let (stderr_read, stderr_write) = pipe_cloexec()?;
    let (gate_read, gate_write) = pipe_cloexec()?;
    let pid = unsafe { libc::fork() };
    if pid < 0 {
        for fd in [
            stdin_read,
            stdin_write,
            stdout_read,
            stdout_write,
            stderr_read,
            stderr_write,
            gate_read,
            gate_write,
        ] {
            close_fd(fd);
        }
        return Err(io::Error::last_os_error());
    }
    if pid == 0 {
        close_fd(stdin_write);
        close_fd(stdout_read);
        close_fd(stderr_read);
        close_fd(gate_write);
        let command_fd = handles.command.as_raw_fd();
        let cwd_fd = handles.cwd.as_raw_fd();
        let mut prepared_descriptors = vec![
            stdin_read,
            stdout_write,
            stderr_write,
            gate_read,
            command_fd,
            cwd_fd,
            executable_fd,
        ];
        if let Some(script) = &handles.script {
            prepared_descriptors.push(script.readable.as_raw_fd());
        }
        let _ = strict_close_except(&prepared_descriptors);
        let mut gate = [0_u8; 1];
        if read_exact_fd(gate_read, &mut gate).is_err() || gate[0] != b'A' {
            unsafe { libc::_exit(126) }
        }
        close_fd(gate_read);
        if deadline.is_expired().unwrap_or(true)
            || unsafe { libc::dup2(stdin_read, libc::STDIN_FILENO) } < 0
            || unsafe { libc::dup2(stdout_write, libc::STDOUT_FILENO) } < 0
            || unsafe { libc::dup2(stderr_write, libc::STDERR_FILENO) } < 0
            || verify_prepared_launch(handles).is_err()
            || unsafe { libc::fchdir(cwd_fd) } < 0
        {
            unsafe { libc::_exit(126) }
        }
        close_fd(stdin_read);
        close_fd(stdout_write);
        close_fd(stderr_write);
        if let Some(script) = &handles.script {
            let script_fd = script.readable.as_raw_fd();
            if set_cloexec(script_fd, false).is_err() {
                unsafe { libc::_exit(126) }
            }
            let _ = strict_close_except(&[executable_fd, script_fd]);
        } else {
            let _ = strict_close_except(&[executable_fd]);
        }
        if drop_workload_privileges().is_err() {
            unsafe { libc::_exit(126) }
        }
        let empty = c"";
        unsafe {
            libc::syscall(
                libc::SYS_execveat,
                executable_fd,
                empty.as_ptr(),
                argument_pointers.as_ptr(),
                environment_pointers.as_ptr(),
                libc::AT_EMPTY_PATH,
            );
            libc::_exit(127)
        }
    }
    close_fd(stdin_read);
    close_fd(stdout_write);
    close_fd(stderr_write);
    close_fd(gate_read);
    set_nonblocking(stdin_write)?;
    set_nonblocking(stdout_read)?;
    set_nonblocking(stderr_read)?;
    if unsafe { libc::kill(pid, 0) } < 0 {
        let error = io::Error::last_os_error();
        close_fd(stdin_write);
        close_fd(stdout_read);
        close_fd(stderr_read);
        close_fd(gate_write);
        return Err(error);
    }
    Ok((
        RootProcess {
            pid,
            exited: false,
            stdin: Some(unsafe { File::from_raw_fd(stdin_write) }),
            stdout: unsafe { File::from_raw_fd(stdout_read) },
            stderr: unsafe { File::from_raw_fd(stderr_read) },
            pending_input: VecDeque::new(),
            close_input_pending: false,
        },
        gate_write,
    ))
}

fn bind_private_listener(scope: &PrivateScope) -> io::Result<UnixListener> {
    let listener = UnixListener::bind(&scope.control_socket)?;
    fs::set_permissions(&scope.control_socket, fs::Permissions::from_mode(0o600))?;
    validate_control_socket(&scope.control_socket)?;
    Ok(listener)
}

fn prepare_launch_filesystem(launch: &LaunchSpec) -> io::Result<PreparedLaunch> {
    let command_metadata = fs::symlink_metadata(&launch.command)?;
    if command_metadata.file_type().is_symlink()
        || !command_metadata.is_file()
        || command_metadata.mode() & 0o111 == 0
        || fs::canonicalize(&launch.command)? != launch.command
    {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "launch executable is not an exact canonical executable file",
        ));
    }
    let command = open_executable_path(&launch.command)?;
    let command_identity = file_identity(&command)?;
    if command_identity.device != command_metadata.dev()
        || command_identity.inode != command_metadata.ino()
        || command_identity.mode != command_metadata.mode()
    {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "launch executable changed while it was prepared",
        ));
    }
    let cwd_metadata = fs::symlink_metadata(&launch.cwd)?;
    if cwd_metadata.file_type().is_symlink()
        || !cwd_metadata.is_dir()
        || fs::canonicalize(&launch.cwd)? != launch.cwd
    {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "launch cwd is not an exact canonical directory",
        ));
    }
    let cwd = open_exact_path(&launch.cwd, true)?;
    let cwd_identity = file_identity(&cwd)?;
    if cwd_identity.device != cwd_metadata.dev()
        || cwd_identity.inode != cwd_metadata.ino()
        || cwd_identity.mode != cwd_metadata.mode()
    {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "launch cwd changed while it was prepared",
        ));
    }
    let script = prepare_script(&launch.command, &command_identity)?;
    let prepared = PreparedLaunch {
        command,
        cwd,
        command_identity,
        cwd_identity,
        script,
    };
    verify_prepared_launch(&prepared)?;
    Ok(prepared)
}

fn open_exact_path(path: &Path, directory: bool) -> io::Result<File> {
    let path = path_cstring(path)?;
    let mut flags = libc::O_RDONLY | libc::O_CLOEXEC | libc::O_NOFOLLOW;
    if directory {
        flags |= libc::O_DIRECTORY;
    }
    let descriptor = unsafe { libc::open(path.as_ptr(), flags) };
    if descriptor < 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(unsafe { File::from_raw_fd(descriptor) })
    }
}

fn open_executable_path(path: &Path) -> io::Result<File> {
    let path = path_cstring(path)?;
    let descriptor = unsafe {
        libc::open(
            path.as_ptr(),
            libc::O_PATH | libc::O_CLOEXEC | libc::O_NOFOLLOW,
        )
    };
    if descriptor < 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(unsafe { File::from_raw_fd(descriptor) })
    }
}

fn prepare_script(
    path: &Path,
    command_identity: &FileIdentity,
) -> io::Result<Option<PreparedScript>> {
    let mut readable = match open_exact_path(path, false) {
        Ok(file) => file,
        Err(error) if error.kind() == io::ErrorKind::PermissionDenied => return Ok(None),
        Err(error) => return Err(error),
    };
    let readable_identity = file_identity(&readable)?;
    if readable_identity.device != command_identity.device
        || readable_identity.inode != command_identity.inode
        || readable_identity.mode != command_identity.mode
    {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "launch script changed while it was prepared",
        ));
    }
    let Some((interpreter_path, argument)) = read_shebang(&mut readable)? else {
        return Ok(None);
    };
    let canonical_path = fs::canonicalize(&interpreter_path)?;
    if !canonical_path.is_absolute()
        || canonical_path.file_name().and_then(|name| name.to_str()) == Some("env")
    {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "launch interpreter must be an exact executable without PATH selection",
        ));
    }
    let metadata = fs::symlink_metadata(&canonical_path)?;
    if metadata.file_type().is_symlink() || !metadata.is_file() || metadata.mode() & 0o111 == 0 {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "launch interpreter is not an exact executable file",
        ));
    }
    let executable = open_executable_path(&canonical_path)?;
    let identity = file_identity(&executable)?;
    if identity.device != metadata.dev()
        || identity.inode != metadata.ino()
        || identity.mode != metadata.mode()
    {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "launch interpreter changed while it was prepared",
        ));
    }
    match open_exact_path(&canonical_path, false) {
        Ok(mut interpreter_reader) => {
            let mut marker = [0_u8; 2];
            if interpreter_reader.read(&mut marker)? == marker.len() && marker == *b"#!" {
                return Err(io::Error::new(
                    io::ErrorKind::PermissionDenied,
                    "recursive launch interpreters are unsupported",
                ));
            }
        }
        Err(error) if error.kind() == io::ErrorKind::PermissionDenied => {}
        Err(error) => return Err(error),
    }
    Ok(Some(PreparedScript {
        readable,
        interpreter: PreparedInterpreter {
            executable,
            identity,
            canonical_path,
            argument,
        },
    }))
}

fn read_shebang(file: &mut File) -> io::Result<Option<(PathBuf, Option<String>)>> {
    let mut bytes = [0_u8; MAX_SHEBANG_BYTES + 1];
    let count = file.read(&mut bytes)?;
    if count < 2 || &bytes[..2] != b"#!" {
        return Ok(None);
    }
    let newline = bytes[..count].iter().position(|byte| *byte == b'\n');
    let end = match newline {
        Some(index) if index <= MAX_SHEBANG_BYTES => index,
        None if count <= MAX_SHEBANG_BYTES => count,
        _ => {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "launch shebang exceeds its bound",
            ))
        }
    };
    let line = std::str::from_utf8(&bytes[2..end])
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "launch shebang is not utf8"))?
        .trim_matches(|character| matches!(character, ' ' | '\t' | '\r'));
    if line.is_empty() || line.contains('\0') {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "launch shebang is malformed",
        ));
    }
    let split = line
        .find(|character: char| matches!(character, ' ' | '\t'))
        .unwrap_or(line.len());
    let interpreter = PathBuf::from(&line[..split]);
    if !interpreter.is_absolute() {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "launch shebang interpreter is not absolute",
        ));
    }
    let remainder = line[split..].trim_matches(|character| matches!(character, ' ' | '\t'));
    let argument = (!remainder.is_empty()).then(|| remainder.to_owned());
    Ok(Some((interpreter, argument)))
}

fn file_identity(file: &File) -> io::Result<FileIdentity> {
    let metadata = file.metadata()?;
    Ok(FileIdentity {
        device: metadata.dev(),
        inode: metadata.ino(),
        mode: metadata.mode(),
    })
}

fn verify_prepared_launch(prepared: &PreparedLaunch) -> io::Result<()> {
    let command = prepared.command.metadata()?;
    let cwd = prepared.cwd.metadata()?;
    let script_valid = prepared.script.as_ref().is_none_or(|script| {
        let Ok(readable) = script.readable.metadata() else {
            return false;
        };
        let Ok(interpreter) = script.interpreter.executable.metadata() else {
            return false;
        };
        readable.is_file()
            && readable.dev() == prepared.command_identity.device
            && readable.ino() == prepared.command_identity.inode
            && readable.mode() == prepared.command_identity.mode
            && interpreter.is_file()
            && interpreter.mode() & 0o111 != 0
            && interpreter.dev() == script.interpreter.identity.device
            && interpreter.ino() == script.interpreter.identity.inode
            && interpreter.mode() == script.interpreter.identity.mode
    });
    if !command.is_file()
        || command.mode() & 0o111 == 0
        || command.dev() != prepared.command_identity.device
        || command.ino() != prepared.command_identity.inode
        || command.mode() != prepared.command_identity.mode
        || !cwd.is_dir()
        || cwd.dev() != prepared.cwd_identity.device
        || cwd.ino() != prepared.cwd_identity.inode
        || cwd.mode() != prepared.cwd_identity.mode
        || !script_valid
    {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "prepared launch descriptors changed identity",
        ));
    }
    Ok(())
}

fn set_cloexec(descriptor: RawFd, enabled: bool) -> io::Result<()> {
    let flags = unsafe { libc::fcntl(descriptor, libc::F_GETFD) };
    if flags < 0 {
        return Err(io::Error::last_os_error());
    }
    let updated = if enabled {
        flags | libc::FD_CLOEXEC
    } else {
        flags & !libc::FD_CLOEXEC
    };
    if unsafe { libc::fcntl(descriptor, libc::F_SETFD, updated) } < 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

fn open_scope_dir(path: &Path) -> io::Result<File> {
    let directory = open_exact_path(path, true)?;
    let metadata = directory.metadata()?;
    if !metadata.is_dir()
        || metadata.uid() != unsafe { libc::geteuid() }
        || metadata.mode() & 0o777 != 0o700
    {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "authority scope dirfd identity is invalid",
        ));
    }
    Ok(directory)
}

fn journal_binding(attestation: &PreparedAttestation) -> JournalBinding {
    JournalBinding {
        scope_id: attestation.scope_id,
        scope_capability: attestation.scope_capability,
        launch_digest: attestation.launch_digest,
        identity: attestation.identity.clone(),
    }
}

fn send_server_challenge(
    stream: &mut UnixStream,
    scope_capability: &[u8; 32],
    identity: &AuthorityIdentity,
) -> io::Result<()> {
    let nonce = random_bytes::<32>()?;
    let identity = identity.encode_standalone()?;
    let authentication = keyed_authentication(
        scope_capability,
        SERVER_CHALLENGE_DOMAIN,
        &[&identity, &nonce],
    );
    let mut payload = Vec::with_capacity(CHALLENGE_BYTES);
    payload.extend_from_slice(&nonce);
    payload.extend_from_slice(&authentication);
    write_frame(stream, &Frame::new(FrameKind::Challenge, payload)?)
}

fn verify_server_challenge(
    stream: &mut UnixStream,
    attestation: &PreparedAttestation,
) -> io::Result<()> {
    let frame = read_frame(stream)?.ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::UnexpectedEof,
            "guardian closed before server-first authentication",
        )
    })?;
    if frame.kind != FrameKind::Challenge || frame.payload.len() != CHALLENGE_BYTES {
        return Err(invalid_response("server-first challenge"));
    }
    let identity = attestation.identity.encode_standalone()?;
    let expected = keyed_authentication(
        &attestation.scope_capability,
        SERVER_CHALLENGE_DOMAIN,
        &[&identity, &frame.payload[..32]],
    );
    if !capability_equal(
        frame.payload[32..]
            .try_into()
            .expect("challenge length checked"),
        &expected,
    ) {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "guardian server-first authentication failed",
        ));
    }
    Ok(())
}

fn hide_authority_runtime(runtime_root: &Path, scope_directory: &Path) -> io::Result<()> {
    let target = path_cstring(runtime_root)?;
    let source = c"rasen-authority-hidden";
    let filesystem = c"tmpfs";
    let options = c"mode=000,size=4096";
    if unsafe {
        libc::mount(
            source.as_ptr(),
            target.as_ptr(),
            filesystem.as_ptr(),
            libc::MS_NOSUID | libc::MS_NODEV | libc::MS_NOEXEC,
            options.as_ptr().cast(),
        )
    } < 0
    {
        return Err(io::Error::last_os_error());
    }
    if fs::symlink_metadata(scope_directory).is_ok() {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "authority scope remains visible after runtime overmount",
        ));
    }
    Ok(())
}

fn set_guardian_nondumpable() -> io::Result<()> {
    if unsafe { libc::prctl(libc::PR_SET_DUMPABLE, 0, 0, 0, 0) } < 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

fn set_nonblocking(descriptor: RawFd) -> io::Result<()> {
    let flags = unsafe { libc::fcntl(descriptor, libc::F_GETFL) };
    if flags < 0 || unsafe { libc::fcntl(descriptor, libc::F_SETFL, flags | libc::O_NONBLOCK) } < 0
    {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

fn drop_workload_privileges() -> io::Result<()> {
    // The workload receives no capabilities in the authority user namespace.
    // Hosts that permit unprivileged user namespaces still allow it to create
    // a further user/PID namespace, where the kernel grants capabilities only
    // over that nested namespace. No host/runtime-tree authority is retained.
    for capability in 0..64 {
        let result = unsafe { libc::prctl(libc::PR_CAPBSET_DROP, capability, 0, 0, 0) };
        if result < 0 && io::Error::last_os_error().raw_os_error() != Some(libc::EINVAL) {
            return Err(io::Error::last_os_error());
        }
    }
    #[repr(C)]
    struct CapabilityHeader {
        version: u32,
        pid: i32,
    }
    #[repr(C)]
    #[derive(Clone, Copy)]
    struct CapabilityData {
        effective: u32,
        permitted: u32,
        inheritable: u32,
    }
    let header = CapabilityHeader {
        version: 0x2008_0522,
        pid: 0,
    };
    let data = [CapabilityData {
        effective: 0,
        permitted: 0,
        inheritable: 0,
    }; 2];
    if unsafe { libc::syscall(libc::SYS_capset, &header, &data) } < 0 {
        return Err(io::Error::last_os_error());
    }
    if unsafe { libc::prctl(libc::PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) } < 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

fn validate_control_socket(path: &Path) -> io::Result<()> {
    let metadata = fs::symlink_metadata(path)?;
    if metadata.file_type().is_symlink()
        || !metadata.file_type().is_socket()
        || metadata.uid() != unsafe { libc::geteuid() }
        || metadata.mode() & 0o777 != 0o600
    {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "authority control socket identity is invalid",
        ));
    }
    Ok(())
}

fn configure_user_mapping(pid: libc::pid_t) -> io::Result<()> {
    let uid = unsafe { libc::geteuid() };
    let gid = unsafe { libc::getegid() };
    let base = format!("/proc/{pid}");
    fs::write(format!("{base}/setgroups"), "deny\n")?;
    fs::write(format!("{base}/uid_map"), format!("0 {uid} 1\n"))?;
    fs::write(format!("{base}/gid_map"), format!("0 {gid} 1\n"))?;
    verify_mapping(&format!("{base}/uid_map"), uid)?;
    verify_mapping(&format!("{base}/gid_map"), gid)?;
    if fs::read_to_string(format!("{base}/setgroups"))?.trim() != "deny" {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "setgroups denial did not persist",
        ));
    }
    Ok(())
}

fn verify_mapping(path: &str, outside: libc::id_t) -> io::Result<()> {
    let mapping = fs::read_to_string(path)?;
    let values: Vec<&str> = mapping.split_whitespace().collect();
    if values != ["0", &outside.to_string(), "1"] {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "user namespace mapping is not exact",
        ));
    }
    Ok(())
}

fn configure_child_namespace() -> io::Result<()> {
    let root = CString::new("/").expect("static path");
    let proc = CString::new("/proc").expect("static path");
    let proc_type = CString::new("proc").expect("static filesystem");
    if unsafe {
        libc::mount(
            std::ptr::null(),
            root.as_ptr(),
            std::ptr::null(),
            libc::MS_REC | libc::MS_PRIVATE,
            std::ptr::null(),
        )
    } < 0
    {
        return Err(io::Error::last_os_error());
    }
    if unsafe {
        libc::mount(
            proc_type.as_ptr(),
            proc.as_ptr(),
            proc_type.as_ptr(),
            libc::MS_NOSUID | libc::MS_NOEXEC | libc::MS_NODEV,
            std::ptr::null(),
        )
    } < 0
    {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

fn verify_namespace_proc() -> io::Result<()> {
    let self_namespace = fs::metadata("/proc/self/ns/pid")?;
    let init_namespace = fs::metadata("/proc/1/ns/pid")?;
    if self_namespace.dev() != init_namespace.dev()
        || self_namespace.ino() != init_namespace.ino()
        || !fs::read_to_string("/proc/self/stat")?.starts_with("1 ")
    {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "proc is not mounted for the guardian PID namespace",
        ));
    }
    Ok(())
}

fn verify_child_identity(expected: &AuthorityIdentity) -> io::Result<()> {
    expected.validate()?;
    let current = crate::linux::current_process_identity()?;
    if current.boot_id != expected.boot_id
        || current.start_ticks != expected.start_ticks
        || current.pid_namespace_device != expected.pid_namespace_device
        || current.pid_namespace_inode != expected.pid_namespace_inode
        || current.guardian_pid != 1
    {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "guardian identity differs across namespace viewpoints",
        ));
    }
    Ok(())
}

fn redirect_guardian_stdio() -> io::Result<()> {
    let path = CString::new("/dev/null").expect("static path");
    let descriptor = unsafe { libc::open(path.as_ptr(), libc::O_RDWR | libc::O_CLOEXEC) };
    if descriptor < 0 {
        return Err(io::Error::last_os_error());
    }
    for target in [libc::STDIN_FILENO, libc::STDOUT_FILENO, libc::STDERR_FILENO] {
        if unsafe { libc::dup2(descriptor, target) } < 0 {
            let error = io::Error::last_os_error();
            close_fd(descriptor);
            return Err(error);
        }
    }
    close_fd(descriptor);
    Ok(())
}

fn strict_close_except(keep: &[RawFd]) -> io::Result<()> {
    let mut exact = keep.to_vec();
    exact.retain(|fd| *fd >= 3);
    exact.sort_unstable();
    exact.dedup();
    let mut first = 3_u32;
    for descriptor in &exact {
        let descriptor = *descriptor as u32;
        if first < descriptor {
            if !try_close_range(first, descriptor - 1)? {
                return close_descriptors_via_proc(&exact);
            }
        }
        first = descriptor.saturating_add(1);
    }
    if !try_close_range(first, u32::MAX)? {
        return close_descriptors_via_proc(&exact);
    }
    verify_exact_descriptor_set(&exact)
}

fn try_close_range(first: u32, last: u32) -> io::Result<bool> {
    if first > last {
        return Ok(true);
    }
    let result = unsafe { libc::syscall(libc::SYS_close_range, first, last, 0_u32) };
    if result == 0 {
        return Ok(true);
    }
    let error = io::Error::last_os_error();
    if error.raw_os_error() == Some(libc::ENOSYS) {
        Ok(false)
    } else {
        Err(error)
    }
}

fn close_descriptors_via_proc(keep: &[RawFd]) -> io::Result<()> {
    for descriptor in proc_descriptor_snapshot()? {
        if descriptor >= 3 && !keep.contains(&descriptor) {
            close_fd(descriptor);
        }
    }
    verify_exact_descriptor_set(keep)
}

fn verify_exact_descriptor_set(keep: &[RawFd]) -> io::Result<()> {
    for descriptor in keep {
        if *descriptor >= 3 && unsafe { libc::fcntl(*descriptor, libc::F_GETFD) } < 0 {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "intended descriptor was lost during exact closure",
            ));
        }
    }
    for descriptor in proc_descriptor_snapshot()? {
        if descriptor >= 3
            && !keep.contains(&descriptor)
            && unsafe { libc::fcntl(descriptor, libc::F_GETFD) } >= 0
        {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "unintended descriptor survived exact closure",
            ));
        }
    }
    Ok(())
}

fn proc_descriptor_snapshot() -> io::Result<Vec<RawFd>> {
    let mut descriptors = Vec::new();
    for entry in fs::read_dir("/proc/self/fd")? {
        let entry = entry?;
        let name = entry.file_name();
        let name = name.to_str().ok_or_else(|| {
            io::Error::new(io::ErrorKind::InvalidData, "proc fd name is not utf8")
        })?;
        if let Ok(descriptor) = name.parse::<RawFd>() {
            descriptors.push(descriptor);
        }
    }
    descriptors.sort_unstable();
    descriptors.dedup();
    Ok(descriptors)
}

fn pipe_cloexec() -> io::Result<(RawFd, RawFd)> {
    let mut descriptors = [0; 2];
    if unsafe { libc::pipe2(descriptors.as_mut_ptr(), libc::O_CLOEXEC) } < 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok((descriptors[0], descriptors[1]))
    }
}

fn read_exact_fd(fd: RawFd, bytes: &mut [u8]) -> io::Result<()> {
    let mut offset = 0;
    while offset < bytes.len() {
        let count = unsafe {
            libc::read(
                fd,
                bytes[offset..].as_mut_ptr().cast(),
                bytes.len() - offset,
            )
        };
        if count == 0 {
            return Err(io::Error::new(io::ErrorKind::UnexpectedEof, "pipe closed"));
        }
        if count < 0 {
            let error = io::Error::last_os_error();
            if error.kind() == io::ErrorKind::Interrupted {
                continue;
            }
            return Err(error);
        }
        offset += count as usize;
    }
    Ok(())
}

fn expect_byte_until(
    fd: RawFd,
    expected: u8,
    deadline: AbsoluteMonotonicDeadline,
) -> io::Result<()> {
    let mut byte = [0];
    read_exact_fd_until(fd, &mut byte, deadline)?;
    if byte[0] == b'E' {
        let mut code = [0];
        read_exact_fd_until(fd, &mut code, deadline)?;
        let failure = NativeFailure::decode(&[
            (crate::protocol::PROTOCOL_VERSION >> 8) as u8,
            crate::protocol::PROTOCOL_VERSION as u8,
            code[0],
        ])?;
        return Err(io::Error::other(failure.code.diagnostic_code()));
    }
    if byte[0] != expected {
        return Err(io::Error::other("guardian handshake failed"));
    }
    Ok(())
}

fn encode_identity_bootstrap(identity: &AuthorityIdentity) -> io::Result<Vec<u8>> {
    identity.encode_standalone()
}

fn read_bootstrap_identity_until(
    fd: RawFd,
    deadline: AbsoluteMonotonicDeadline,
) -> io::Result<AuthorityIdentity> {
    let mut length = [0_u8; 4];
    read_exact_fd_until(fd, &mut length, deadline)?;
    let length = u32::from_be_bytes(length) as usize;
    if length == 0 || length > 1024 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "bootstrap identity length is invalid",
        ));
    }
    let mut bytes = vec![0_u8; length];
    read_exact_fd_until(fd, &mut bytes, deadline)?;
    AuthorityIdentity::decode_standalone(&bytes)
}

fn decode_wait_status(status: i32) -> io::Result<RootExit> {
    if libc::WIFEXITED(status) {
        RootExit::try_from_parts(Some(libc::WEXITSTATUS(status)), None)
    } else if libc::WIFSIGNALED(status) {
        RootExit::try_from_parts(None, Some(libc::WTERMSIG(status)))
    } else {
        Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "root wait status is neither exit nor signal",
        ))
    }
}

fn observation_from_events(events: &[GuardianEvent]) -> io::Result<GuardianObservation> {
    match events.last() {
        Some(event) if event.kind == GuardianEventKind::Prepared => Ok(GuardianObservation::Inert),
        Some(event) if event.kind == GuardianEventKind::Activated => Ok(GuardianObservation::Live),
        Some(event) if event.kind == GuardianEventKind::RootExited => Ok(
            GuardianObservation::RootExited(event.root_exit.ok_or_else(|| {
                io::Error::new(io::ErrorKind::InvalidData, "root status is absent")
            })?),
        ),
        Some(event) if event.kind == GuardianEventKind::ExactScopeEmpty => {
            Ok(GuardianObservation::ExactScopeEmpty)
        }
        _ => Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "guardian observation journal is invalid",
        )),
    }
}

fn wait_or_kill_authority(authority: &ReopenedAuthority, grace_ms: u32) -> io::Result<()> {
    let bounded = grace_ms.min(i32::MAX as u32) as i32;
    if authority.wait(bounded)? {
        reap_if_child(authority.pid());
        return Ok(());
    }
    authority.send_signal(libc::SIGKILL)?;
    if authority.wait(5_000)? {
        reap_if_child(authority.pid());
        Ok(())
    } else {
        Err(io::Error::new(
            io::ErrorKind::TimedOut,
            "exact guardian pidfd did not complete",
        ))
    }
}

fn reap_if_child(pid: u32) {
    let mut status = 0;
    unsafe {
        libc::waitpid(pid as libc::pid_t, &mut status, libc::WNOHANG);
    }
}

fn operation_frame_kind(operation: ControlOperation) -> FrameKind {
    match operation {
        ControlOperation::OpenRuntime => FrameKind::OpenRuntime,
        ControlOperation::Activate => FrameKind::Activate,
        ControlOperation::Inspect => FrameKind::Inspect,
        ControlOperation::Abort => FrameKind::Abort,
        ControlOperation::Terminate { .. } => FrameKind::Terminate,
    }
}

fn capability_equal(left: &[u8; 32], right: &[u8; 32]) -> bool {
    left.iter()
        .zip(right)
        .fold(0_u8, |difference, (left, right)| {
            difference | (left ^ right)
        })
        == 0
}

fn path_cstring(path: &Path) -> io::Result<CString> {
    cstring(
        path.to_str().ok_or_else(|| {
            io::Error::new(io::ErrorKind::InvalidInput, "launch path is not utf8")
        })?,
    )
}

fn cstring(value: &str) -> io::Result<CString> {
    CString::new(value)
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "launch text contains nul"))
}

fn invalid_response(label: &str) -> io::Error {
    io::Error::new(
        io::ErrorKind::InvalidData,
        format!("guardian returned an invalid {label} response"),
    )
}

fn expected_control_loss(error: &io::Error) -> bool {
    matches!(
        error.kind(),
        io::ErrorKind::NotFound
            | io::ErrorKind::ConnectionRefused
            | io::ErrorKind::ConnectionReset
            | io::ErrorKind::BrokenPipe
            | io::ErrorKind::UnexpectedEof
            | io::ErrorKind::TimedOut
            | io::ErrorKind::WouldBlock
    )
}

fn close_fd(fd: RawFd) {
    if fd >= 0 {
        unsafe {
            libc::close(fd);
        }
    }
}

fn kill_and_reap(pid: libc::pid_t) {
    unsafe {
        libc::kill(pid, libc::SIGKILL);
        let mut status = 0;
        while libc::waitpid(pid, &mut status, 0) < 0
            && io::Error::last_os_error().kind() == io::ErrorKind::Interrupted
        {}
    }
}

fn cleanup_scope(scope: &PrivateScope) {
    let _ = fs::remove_file(&scope.control_socket);
    let _ = fs::remove_dir_all(&scope.directory);
}

#[cfg(test)]
mod construction_matrix_tests {
    use std::collections::BTreeMap;
    use std::os::unix::fs::PermissionsExt;
    use std::process::Command;

    use super::*;

    struct FailingObserver {
        selected: ConstructionCheckpoint,
        identity: Option<AuthorityIdentity>,
    }

    impl ConstructionObserver for FailingObserver {
        fn checkpoint(
            &mut self,
            checkpoint: ConstructionCheckpoint,
            identity: Option<&AuthorityIdentity>,
        ) -> io::Result<()> {
            if let Some(identity) = identity {
                self.identity = Some(identity.clone());
            }
            if checkpoint == self.selected {
                Err(io::Error::other(format!(
                    "injected construction failure at {checkpoint:?}"
                )))
            } else {
                Ok(())
            }
        }
    }

    fn child_checkpoint(checkpoint: ConstructionCheckpoint) -> bool {
        matches!(
            checkpoint,
            ConstructionCheckpoint::ChildIdentityRevalidated
                | ConstructionCheckpoint::JournalCreated
                | ConstructionCheckpoint::RuntimeHiddenAndNondumpable
        )
    }

    /// Every construction checkpoint, in the order the transaction reaches
    /// them. Keep in step with `checkpoint_position` below.
    const CONSTRUCTION_CHECKPOINTS: [ConstructionCheckpoint; 18] = [
        ConstructionCheckpoint::ScopeCreated,
        ConstructionCheckpoint::ScopeDirectoryOpened,
        ConstructionCheckpoint::PrivateListenerBound,
        ConstructionCheckpoint::HandshakePipesCreated,
        ConstructionCheckpoint::GuardianCloned,
        ConstructionCheckpoint::MappingComplete,
        ConstructionCheckpoint::ChildNamespaceReady,
        ConstructionCheckpoint::ProcessIdentityRevalidated,
        ConstructionCheckpoint::PidfdOpenedAndRevalidated,
        ConstructionCheckpoint::AttestationEncoded,
        ConstructionCheckpoint::PreReadinessPermitHeld,
        ConstructionCheckpoint::IdentityLengthTransferred,
        ConstructionCheckpoint::IdentityBodyTransferred,
        ConstructionCheckpoint::ChildIdentityRevalidated,
        ConstructionCheckpoint::JournalCreated,
        ConstructionCheckpoint::RuntimeHiddenAndNondumpable,
        ConstructionCheckpoint::ChildReadyReceived,
        ConstructionCheckpoint::FinalParentRevalidation,
    ];

    /// Exhaustiveness binding between `ConstructionCheckpoint` and the matrix.
    /// This match deliberately has no wildcard arm, so adding a checkpoint
    /// variant stops the crate compiling until the new checkpoint is given a
    /// position and injected by `CONSTRUCTION_CHECKPOINTS`. Task 4.7 claims the
    /// matrix covers every injected failure point; without this binding a new
    /// variant would silently escape the matrix and leave that claim false.
    fn checkpoint_position(checkpoint: ConstructionCheckpoint) -> usize {
        match checkpoint {
            ConstructionCheckpoint::ScopeCreated => 0,
            ConstructionCheckpoint::ScopeDirectoryOpened => 1,
            ConstructionCheckpoint::PrivateListenerBound => 2,
            ConstructionCheckpoint::HandshakePipesCreated => 3,
            ConstructionCheckpoint::GuardianCloned => 4,
            ConstructionCheckpoint::MappingComplete => 5,
            ConstructionCheckpoint::ChildNamespaceReady => 6,
            ConstructionCheckpoint::ProcessIdentityRevalidated => 7,
            ConstructionCheckpoint::PidfdOpenedAndRevalidated => 8,
            ConstructionCheckpoint::AttestationEncoded => 9,
            ConstructionCheckpoint::PreReadinessPermitHeld => 10,
            ConstructionCheckpoint::IdentityLengthTransferred => 11,
            ConstructionCheckpoint::IdentityBodyTransferred => 12,
            ConstructionCheckpoint::ChildIdentityRevalidated => 13,
            ConstructionCheckpoint::JournalCreated => 14,
            ConstructionCheckpoint::RuntimeHiddenAndNondumpable => 15,
            ConstructionCheckpoint::ChildReadyReceived => 16,
            ConstructionCheckpoint::FinalParentRevalidation => 17,
        }
    }

    #[test]
    fn partial_construction_failure_matrix_reaps_guardian_and_keeps_workload_inert() {
        let checkpoints = CONSTRUCTION_CHECKPOINTS;
        for (index, checkpoint) in checkpoints.into_iter().enumerate() {
            assert_eq!(
                checkpoint_position(checkpoint),
                index,
                "matrix order drifted from the checkpoint binding at {index}"
            );
        }
        let artifact_digest = current_executable_digest().unwrap();
        let mut unrelated = Command::new("/usr/bin/sleep")
            .arg("120")
            .spawn()
            .expect("unrelated process must start");

        for (index, checkpoint) in checkpoints.into_iter().enumerate() {
            let suffix = random_bytes::<8>()
                .unwrap()
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect::<String>();
            let parent = PathBuf::from(format!("/tmp/rpa-matrix-{index}-{suffix}"));
            let runtime_root = parent.join("runtime");
            let workload_cwd = parent.join("workload");
            fs::create_dir_all(&runtime_root).unwrap();
            fs::create_dir_all(&workload_cwd).unwrap();
            fs::set_permissions(&runtime_root, fs::Permissions::from_mode(0o700)).unwrap();
            fs::set_permissions(&workload_cwd, fs::Permissions::from_mode(0o700)).unwrap();
            let marker = workload_cwd.join("must-not-execute");
            let request = PrepareRequest {
                operation_id: format!("partial-construction-{index}"),
                runtime_root: runtime_root.clone(),
                launch: LaunchSpec {
                    command: PathBuf::from("/usr/bin/touch"),
                    cwd: workload_cwd,
                    args: vec![marker.display().to_string()],
                    env: BTreeMap::from([("LANG".to_owned(), "C.UTF-8".to_owned())]),
                },
            };
            let mut permit = ImmediatePreReadinessPermit;
            let mut observer = FailingObserver {
                selected: checkpoint,
                identity: None,
            };
            let error = prepare_primary_observed_until(
                request,
                artifact_digest,
                [0x6d; 32],
                AbsoluteMonotonicDeadline::after_ms(PREPARE_TIMEOUT_MS).unwrap(),
                &mut permit,
                &mut observer,
                Some(checkpoint),
            )
            .err()
            .unwrap_or_else(|| panic!("{checkpoint:?} unexpectedly returned prepared authority"));

            if child_checkpoint(checkpoint) {
                assert!(
                    error.to_string().contains("guardian handshake failed"),
                    "{checkpoint:?} did not report its child-side failure barrier: {error}"
                );
            } else {
                assert!(
                    error.to_string().contains(&format!("{checkpoint:?}")),
                    "{checkpoint:?} did not execute its exact injected row: {error}"
                );
            }
            if let Some(identity) = observer.identity {
                assert!(matches!(
                    reopen_or_prove_absent(&identity).unwrap(),
                    AuthorityPresence::AbsentSameBoot
                ));
            }
            assert!(
                fs::read_dir(&runtime_root).unwrap().next().is_none(),
                "{checkpoint:?} retained an unaccounted scope"
            );
            assert!(!marker.exists(), "{checkpoint:?} executed workload code");
            assert!(
                unrelated.try_wait().unwrap().is_none(),
                "{checkpoint:?} signalled an unrelated process"
            );
            fs::remove_dir_all(parent).unwrap();
        }

        unrelated.kill().unwrap();
        unrelated.wait().unwrap();
    }
}

#[cfg(test)]
mod actual_fd_tests {
    use super::close_descriptors_via_proc;

    #[test]
    fn proc_fallback_closes_high_fd_after_nofile_limit_is_lowered() {
        let pid = unsafe { libc::fork() };
        assert!(pid >= 0);
        if pid == 0 {
            let raised = libc::rlimit {
                rlim_cur: 4_097,
                rlim_max: 4_097,
            };
            if unsafe { libc::setrlimit(libc::RLIMIT_NOFILE, &raised) } < 0 {
                unsafe { libc::_exit(209) }
            }
            let source = unsafe { libc::open(c"/dev/null".as_ptr(), libc::O_RDONLY) };
            if source < 0 || unsafe { libc::dup2(source, 4096) } != 4096 {
                unsafe { libc::_exit(210) }
            }
            unsafe { libc::close(source) };
            let limit = libc::rlimit {
                rlim_cur: 64,
                rlim_max: 64,
            };
            if unsafe { libc::setrlimit(libc::RLIMIT_NOFILE, &limit) } < 0 {
                unsafe { libc::_exit(211) }
            }
            if close_descriptors_via_proc(&[]).is_err() {
                unsafe { libc::_exit(212) }
            }
            if unsafe { libc::fcntl(4096, libc::F_GETFD) } != -1
                || std::io::Error::last_os_error().raw_os_error() != Some(libc::EBADF)
            {
                unsafe { libc::_exit(213) }
            }
            unsafe { libc::_exit(0) }
        }
        let mut status = 0;
        assert_eq!(unsafe { libc::waitpid(pid, &mut status, 0) }, pid);
        assert!(libc::WIFEXITED(status));
        assert_eq!(libc::WEXITSTATUS(status), 0);
    }
}
