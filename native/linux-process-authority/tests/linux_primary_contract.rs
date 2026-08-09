#![cfg(target_os = "linux")]

use std::collections::BTreeMap;
use std::ffi::OsStr;
use std::fs;
use std::io::{Cursor, Read, Write};
use std::net::Shutdown;
use std::os::unix::fs::PermissionsExt;
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use rasen_linux_process_authority::authority::{ControlOperation, ControlRequest};
use rasen_linux_process_authority::deadline::AbsoluteMonotonicDeadline;
use rasen_linux_process_authority::lifecycle::{GuardianEvent, GuardianEventKind, RootExit};
use rasen_linux_process_authority::linux::{
    read_process_identity, reopen_exact_authority, reopen_or_prove_absent, AuthorityPresence,
};
use rasen_linux_process_authority::primary::AuthorityClient;
use rasen_linux_process_authority::primary::{
    current_executable_digest, prepare_primary, prepare_primary_recoverable_until,
    PreReadinessPermit, PreparedPrimary,
};
use rasen_linux_process_authority::protocol::{
    read_frame, write_frame, Frame, FrameKind, LaunchSpec, NativeFailure, NativeFailureCode,
    PrepareRequest,
};

mod support;

fn request(runtime_root: &Path, cwd: &Path, command: &str, args: Vec<String>) -> PrepareRequest {
    request_with_env(
        runtime_root,
        cwd,
        command,
        args,
        BTreeMap::from([("LANG".to_owned(), "C.UTF-8".to_owned())]),
    )
}

fn request_with_env(
    runtime_root: &Path,
    cwd: &Path,
    command: &str,
    args: Vec<String>,
    env: BTreeMap<String, String>,
) -> PrepareRequest {
    PrepareRequest {
        operation_id: format!("prepare-{}", command.replace('/', "-")),
        runtime_root: runtime_root.to_owned(),
        launch: LaunchSpec {
            command: PathBuf::from(command),
            cwd: cwd.to_owned(),
            args,
            env,
        },
    }
}

fn create_runtime_and_cwd(label: &str) -> (PathBuf, PathBuf, PathBuf) {
    let parent = support::short_private_root(label);
    let runtime = parent.join("runtime");
    let cwd = parent.join("workload");
    fs::create_dir_all(&runtime).unwrap();
    fs::create_dir_all(&cwd).unwrap();
    fs::set_permissions(&runtime, fs::Permissions::from_mode(0o700)).unwrap();
    fs::set_permissions(&cwd, fs::Permissions::from_mode(0o700)).unwrap();
    (parent, runtime, cwd)
}

fn current_test_executable() -> PathBuf {
    fs::canonicalize(std::env::current_exe().unwrap()).unwrap()
}

const RUNTIME_HELPER_NAME: &str = "rasen-linux-process-authority";

fn validate_runtime_helper(profile_dir: &Path) -> Result<PathBuf, String> {
    let canonical_profile = fs::canonicalize(profile_dir)
        .map_err(|error| format!("failed to resolve Cargo profile directory: {error}"))?;
    let candidate = profile_dir.join(RUNTIME_HELPER_NAME);
    if candidate.file_name() != Some(OsStr::new(RUNTIME_HELPER_NAME)) {
        return Err("runtime helper does not have the exact Cargo binary name".to_owned());
    }
    let metadata = fs::symlink_metadata(&candidate)
        .map_err(|error| format!("runtime helper metadata is unavailable: {error}"))?;
    if !metadata.file_type().is_file() || metadata.file_type().is_symlink() {
        return Err("runtime helper is not an exact regular non-symlink file".to_owned());
    }
    if metadata.permissions().mode() & 0o111 == 0 {
        return Err("runtime helper is not executable".to_owned());
    }
    let canonical_candidate = fs::canonicalize(&candidate)
        .map_err(|error| format!("failed to resolve runtime helper: {error}"))?;
    if canonical_candidate.parent() != Some(canonical_profile.as_path()) {
        return Err("runtime helper escaped the Cargo profile directory".to_owned());
    }

    let mut header = [0_u8; 20];
    fs::File::open(&canonical_candidate)
        .and_then(|mut file| file.read_exact(&mut header))
        .map_err(|error| format!("runtime helper ELF header is unreadable: {error}"))?;
    if &header[..4] != b"\x7fELF" || header[4] != 2 || header[5] != 1 {
        return Err("runtime helper is not a 64-bit little-endian ELF".to_owned());
    }
    let expected_machine = match std::env::consts::ARCH {
        "x86_64" => 62,
        "aarch64" => 183,
        architecture => {
            return Err(format!(
                "runtime helper architecture is unsupported: {architecture}"
            ))
        }
    };
    if u16::from_le_bytes([header[18], header[19]]) != expected_machine {
        return Err("runtime helper ELF machine does not match the test executable".to_owned());
    }
    Ok(canonical_candidate)
}

fn runtime_helper_executable() -> PathBuf {
    let test_executable = current_test_executable();
    let deps_dir = test_executable
        .parent()
        .expect("Cargo test executable has no parent directory");
    assert_eq!(
        deps_dir.file_name(),
        Some(OsStr::new("deps")),
        "Cargo test executable is not in the expected target/<profile>/deps layout"
    );
    let profile_dir = deps_dir
        .parent()
        .expect("Cargo deps directory has no profile parent");
    validate_runtime_helper(profile_dir)
        .unwrap_or_else(|error| panic!("invalid runtime helper sibling: {error}"))
}

#[test]
fn runtime_helper_locator_rejects_wrong_type_and_identity() {
    let parent = support::short_private_root("hlp");
    let profile_dir = parent.join("debug");
    let candidate = profile_dir.join(RUNTIME_HELPER_NAME);
    fs::create_dir_all(&candidate).unwrap();
    assert!(validate_runtime_helper(&profile_dir)
        .unwrap_err()
        .contains("regular non-symlink"));

    fs::remove_dir(&candidate).unwrap();
    fs::write(&candidate, [0_u8; 20]).unwrap();
    fs::set_permissions(&candidate, fs::Permissions::from_mode(0o700)).unwrap();
    assert!(validate_runtime_helper(&profile_dir)
        .unwrap_err()
        .contains("64-bit little-endian ELF"));

    fs::remove_file(&candidate).unwrap();
    std::os::unix::fs::symlink("/usr/bin/true", &candidate).unwrap();
    assert!(validate_runtime_helper(&profile_dir)
        .unwrap_err()
        .contains("regular non-symlink"));
    fs::remove_file(&candidate).unwrap();
    fs::remove_dir_all(parent).unwrap();
}

fn test_fixture_request(
    runtime: &Path,
    cwd: &Path,
    fixture: &str,
    extra_env: impl IntoIterator<Item = (String, String)>,
) -> PrepareRequest {
    let executable = current_test_executable();
    let mut env = BTreeMap::from([("LANG".to_owned(), "C.UTF-8".to_owned())]);
    env.extend(extra_env);
    request_with_env(
        runtime,
        cwd,
        executable.to_str().unwrap(),
        vec![
            "--exact".to_owned(),
            fixture.to_owned(),
            "--nocapture".to_owned(),
        ],
        env,
    )
}

fn wait_for_exact_empty(
    runtime: &mut rasen_linux_process_authority::primary::RuntimeChannel,
    timeout: Duration,
) -> Vec<GuardianEvent> {
    let deadline = Instant::now() + timeout;
    loop {
        match runtime.read() {
            Ok(Some(frame)) if frame.kind == FrameKind::ExactScopeEmpty => {
                return GuardianEvent::decode_journal(&frame.payload).unwrap();
            }
            Ok(Some(_)) => {}
            Ok(None) => panic!("runtime closed before exact empty"),
            Err(error)
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                ) && Instant::now() < deadline => {}
            Err(error) => panic!("runtime failed before exact empty: {error}"),
        }
        assert!(Instant::now() < deadline, "exact empty timed out");
    }
}

fn wait_for_marker(path: &Path, label: &str) {
    let deadline = Instant::now() + Duration::from_secs(10);
    while !path.exists() {
        assert!(Instant::now() < deadline, "{label} marker timed out");
        thread::sleep(Duration::from_millis(10));
    }
}

fn scope_socket(runtime: &Path, scope_id: &[u8; 16]) -> PathBuf {
    let mut hex = String::with_capacity(32);
    for byte in scope_id {
        use std::fmt::Write as _;
        write!(&mut hex, "{byte:02x}").unwrap();
    }
    runtime.join(format!("scope-{hex}")).join("control.sock")
}

fn wait_until_absolute_deadline(deadline: AbsoluteMonotonicDeadline) {
    let timer = unsafe {
        libc::timerfd_create(
            libc::CLOCK_MONOTONIC,
            libc::TFD_CLOEXEC | libc::TFD_NONBLOCK,
        )
    };
    assert!(timer >= 0);
    let nanos = deadline.absolute_ns().unwrap();
    let value = libc::itimerspec {
        it_interval: libc::timespec {
            tv_sec: 0,
            tv_nsec: 0,
        },
        it_value: libc::timespec {
            tv_sec: (nanos / 1_000_000_000).try_into().unwrap(),
            tv_nsec: (nanos % 1_000_000_000) as libc::c_long,
        },
    };
    assert_eq!(
        unsafe {
            libc::timerfd_settime(timer, libc::TFD_TIMER_ABSTIME, &value, std::ptr::null_mut())
        },
        0
    );
    let mut poll = libc::pollfd {
        fd: timer,
        events: libc::POLLIN,
        revents: 0,
    };
    assert_eq!(unsafe { libc::poll(&mut poll, 1, -1) }, 1);
    unsafe { libc::close(timer) };
}

#[test]
fn pre_readiness_hook_failure_reaps_the_exact_inert_guardian() {
    let (parent, runtime, cwd) = create_runtime_and_cwd("rhk");
    let artifact_digest = current_executable_digest().unwrap();
    let observed = Arc::new(Mutex::new(None));
    let hook_observed = Arc::clone(&observed);
    let marker = cwd.join("must-not-execute");
    struct RejectPermit(
        Arc<Mutex<Option<rasen_linux_process_authority::authority::PreparedAttestation>>>,
    );
    impl PreReadinessPermit for RejectPermit {
        fn commit_and_release(
            &mut self,
            prepared: &PreparedPrimary,
            _deadline: AbsoluteMonotonicDeadline,
        ) -> std::io::Result<()> {
            *self.0.lock().unwrap() = Some(prepared.attestation.clone());
            Err(std::io::Error::other(
                "injected durable recovery publication failure",
            ))
        }
    }
    let mut permit = RejectPermit(hook_observed);
    let error = match prepare_primary_recoverable_until(
        request(
            &runtime,
            &cwd,
            "/usr/bin/touch",
            vec![marker.display().to_string()],
        ),
        artifact_digest,
        [0x5a; 32],
        AbsoluteMonotonicDeadline::after_ms(10_000).unwrap(),
        &mut permit,
    ) {
        Ok(_) => panic!("ready hook failure unexpectedly prepared an authority"),
        Err(error) => error,
    };
    assert!(error
        .to_string()
        .contains("injected durable recovery publication failure"));
    let attestation = observed
        .lock()
        .unwrap()
        .clone()
        .expect("hook must receive the exact attestation before readiness");
    assert!(matches!(
        reopen_or_prove_absent(&attestation.identity).unwrap(),
        AuthorityPresence::AbsentSameBoot
    ));
    assert!(fs::read_dir(&runtime).unwrap().next().is_none());
    assert!(!marker.exists());
    fs::remove_dir_all(parent).unwrap();
}

#[test]
fn pre_readiness_permit_blocks_journal_creation_until_exact_release() {
    let (parent, runtime, cwd) = create_runtime_and_cwd("rord");
    let (candidate_tx, candidate_rx) = mpsc::sync_channel(1);
    let (release_tx, release_rx) = mpsc::sync_channel(1);
    struct BarrierPermit {
        candidate: mpsc::SyncSender<rasen_linux_process_authority::authority::PreparedAttestation>,
        release: mpsc::Receiver<()>,
    }
    impl PreReadinessPermit for BarrierPermit {
        fn commit_and_release(
            &mut self,
            prepared: &PreparedPrimary,
            deadline: AbsoluteMonotonicDeadline,
        ) -> std::io::Result<()> {
            self.candidate.send(prepared.attestation.clone()).unwrap();
            self.release
                .recv_timeout(deadline.remaining()?)
                .map_err(|_| {
                    std::io::Error::new(
                        std::io::ErrorKind::TimedOut,
                        "pre-readiness barrier exceeded the absolute deadline",
                    )
                })
        }
    }
    let runtime_for_worker = runtime.clone();
    let cwd_for_worker = cwd.clone();
    let worker = thread::spawn(move || {
        let mut permit = BarrierPermit {
            candidate: candidate_tx,
            release: release_rx,
        };
        prepare_primary_recoverable_until(
            request(
                &runtime_for_worker,
                &cwd_for_worker,
                "/usr/bin/true",
                Vec::new(),
            ),
            current_executable_digest().unwrap(),
            [0x5b; 32],
            AbsoluteMonotonicDeadline::after_ms(10_000).unwrap(),
            &mut permit,
        )
    });
    let candidate = candidate_rx.recv().unwrap();
    let scope = runtime.join(format!(
        "scope-{}",
        candidate
            .scope_id
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>()
    ));
    assert!(scope.exists());
    assert!(
        !scope.join("journal.bin").exists(),
        "final readiness crossed before the pre-readiness permit"
    );
    release_tx.send(()).unwrap();
    let prepared = worker.join().unwrap().unwrap();
    assert_eq!(prepared.attestation, candidate);
    assert_eq!(
        prepared.client().unwrap().inspect().unwrap(),
        rasen_linux_process_authority::lifecycle::GuardianObservation::Inert
    );
    prepared.client().unwrap().abort(5_000).unwrap();
    fs::remove_dir_all(parent).unwrap();
}

#[test]
fn activation_permit_at_expiry_never_executes_the_gated_workload() {
    let (parent, runtime, cwd) = create_runtime_and_cwd("agdl");
    let marker = cwd.join("must-not-execute");
    let prepared = prepare_primary(
        request(
            &runtime,
            &cwd,
            "/usr/bin/touch",
            vec![marker.display().to_string()],
        ),
        current_executable_digest().unwrap(),
        [0x5c; 32],
    )
    .unwrap();
    let client = prepared.client().unwrap();
    let _runtime_channel = client.open_runtime().unwrap();
    let deadline = AbsoluteMonotonicDeadline::after_ms(500).unwrap();
    let mut stream =
        UnixStream::connect(scope_socket(&runtime, &prepared.attestation.scope_id)).unwrap();
    stream
        .set_read_timeout(Some(Duration::from_secs(2)))
        .unwrap();
    stream
        .set_write_timeout(Some(Duration::from_secs(2)))
        .unwrap();
    let challenge = read_frame(&mut stream).unwrap().unwrap();
    assert_eq!(challenge.kind, FrameKind::Challenge);
    let control = ControlRequest {
        scope_capability: prepared.attestation.scope_capability,
        control_capability: prepared.attestation.control_capability,
        identity: prepared.attestation.identity.clone(),
        deadline_monotonic_ns: deadline.absolute_ns().unwrap(),
        operation: ControlOperation::Activate,
    };
    write_frame(
        &mut stream,
        &Frame::new(FrameKind::Activate, control.encode().unwrap()).unwrap(),
    )
    .unwrap();
    let ready = read_frame(&mut stream).unwrap().unwrap();
    assert_eq!(ready.kind, FrameKind::ActivationReady);
    assert_eq!(ready.payload, deadline.absolute_ns().unwrap().to_be_bytes());
    wait_until_absolute_deadline(deadline);
    let _ = write_frame(
        &mut stream,
        &Frame::new(
            FrameKind::ReleaseGate,
            deadline.absolute_ns().unwrap().to_be_bytes().to_vec(),
        )
        .unwrap(),
    );
    let response = read_frame(&mut stream);
    assert!(
        !matches!(
            response,
            Ok(Some(Frame {
                kind: FrameKind::Activated,
                ..
            }))
        ),
        "guardian released the workload gate after the absolute deadline"
    );
    assert!(!marker.exists());
    assert_eq!(
        client.inspect().unwrap(),
        rasen_linux_process_authority::lifecycle::GuardianObservation::Inert
    );
    client.abort(5_000).unwrap();
    fs::remove_dir_all(parent).unwrap();
}

#[test]
fn actual_namespace_prepare_is_inert_then_aborts_or_activates_to_exact_empty() {
    let parent = support::short_private_root("pri");
    let runtime = parent.join("runtime");
    let cwd = parent.join("workload");
    fs::create_dir_all(&runtime).unwrap();
    fs::create_dir_all(&cwd).unwrap();
    fs::set_permissions(&runtime, fs::Permissions::from_mode(0o700)).unwrap();
    fs::set_permissions(&cwd, fs::Permissions::from_mode(0o700)).unwrap();
    let artifact_digest = current_executable_digest().unwrap();
    let source_digest = [0x5a; 32];

    let marker = cwd.join("must-not-exist");
    let mut wrong_artifact = artifact_digest;
    wrong_artifact[0] ^= 0xff;
    assert!(prepare_primary(
        request(
            &runtime,
            &cwd,
            "/usr/bin/touch",
            vec![marker.to_string_lossy().into_owned()],
        ),
        wrong_artifact,
        source_digest,
    )
    .is_err());
    assert_eq!(fs::read_dir(&runtime).unwrap().count(), 0);
    assert!(!marker.exists());

    let inert = prepare_primary(
        request(
            &runtime,
            &cwd,
            "/usr/bin/touch",
            vec![marker.to_string_lossy().into_owned()],
        ),
        artifact_digest,
        source_digest,
    )
    .unwrap();
    assert!(!marker.exists(), "prepare executed workload code");
    let mut wrong_scope = inert.attestation.clone();
    wrong_scope.scope_capability[0] ^= 0xff;
    assert!(AuthorityClient::new(&runtime, wrong_scope)
        .unwrap()
        .inspect()
        .is_err());
    let mut wrong_control = inert.attestation.clone();
    wrong_control.control_capability[0] ^= 0xff;
    assert!(AuthorityClient::new(&runtime, wrong_control)
        .unwrap()
        .inspect()
        .is_err());
    let mut wrong_identity = inert.attestation.clone();
    wrong_identity.identity.start_ticks += 1;
    assert!(AuthorityClient::new(&runtime, wrong_identity)
        .unwrap()
        .inspect()
        .is_err());
    assert_eq!(
        inert.client().unwrap().inspect().unwrap().to_string(),
        "inert"
    );
    inert.client().unwrap().abort(5_000).unwrap();
    assert!(!marker.exists(), "inert abort opened the activation gate");

    let active = prepare_primary(
        request(&runtime, &cwd, "/usr/bin/true", Vec::new()),
        artifact_digest,
        source_digest,
    )
    .unwrap();
    let mut runtime_channel = active.client().unwrap().open_runtime().unwrap();
    active.client().unwrap().activate().unwrap();

    let mut terminal_events = None;
    while let Some(frame) = runtime_channel.read().unwrap() {
        if frame.kind == FrameKind::ExactScopeEmpty {
            terminal_events = Some(GuardianEvent::decode_journal(&frame.payload).unwrap());
            break;
        }
    }
    let events = terminal_events.expect("guardian did not emit exact empty");
    assert_eq!(
        events.last().unwrap().kind,
        GuardianEventKind::ExactScopeEmpty
    );
    assert_eq!(
        events.iter().find_map(|event| event.root_exit),
        Some(RootExit::Code(0))
    );
    assert_eq!(
        active.client().unwrap().inspect().unwrap().to_string(),
        "exact-scope-empty"
    );

    // The nested user+PID namespace is created by /usr/bin/unshare rather than
    // in-process: unshare(CLONE_NEWUSER) requires a single-threaded caller and
    // returns EINVAL inside the test harness, which always carries a second
    // thread even at --test-threads=1.
    let recursive_request = request(
        &runtime,
        &cwd,
        "/usr/bin/unshare",
        vec![
            "--user".to_owned(),
            "--pid".to_owned(),
            "--fork".to_owned(),
            "--mount-proc".to_owned(),
            "/bin/sh".to_owned(),
            "-c".to_owned(),
            "setsid /bin/sh -c 'sleep 0.2; printf nested' & wait".to_owned(),
        ],
    );
    let recursive = prepare_primary(recursive_request, artifact_digest, source_digest).unwrap();
    let mut recursive_runtime = recursive.client().unwrap().open_runtime().unwrap();
    recursive.client().unwrap().activate().unwrap();
    let mut root_exit_seen = false;
    let mut recursive_events = None;
    let mut recursive_output = Vec::new();
    while let Some(frame) = recursive_runtime.read().unwrap() {
        if matches!(frame.kind, FrameKind::Output | FrameKind::ErrorOutput) {
            recursive_output.extend_from_slice(&frame.payload);
        }
        if matches!(frame.kind, FrameKind::Event | FrameKind::ExactScopeEmpty) {
            let events = GuardianEvent::decode_journal(&frame.payload).unwrap();
            root_exit_seen |= events
                .iter()
                .any(|event| event.kind == GuardianEventKind::RootExited);
            if frame.kind == FrameKind::ExactScopeEmpty {
                assert!(
                    root_exit_seen,
                    "empty was emitted before the exact root status"
                );
                recursive_events = Some(events);
                break;
            }
        }
    }
    assert!(
        recursive_output
            .windows(b"nested".len())
            .any(|window| window == b"nested"),
        "nested detached descendant was not awaited; workload output: {}",
        String::from_utf8_lossy(&recursive_output)
    );
    assert_eq!(
        recursive_events
            .expect("recursive terminal events absent")
            .iter()
            .find_map(|event| event.root_exit),
        Some(RootExit::Code(0))
    );
    assert_eq!(
        recursive.client().unwrap().inspect().unwrap().to_string(),
        "exact-scope-empty"
    );

    let terminating = prepare_primary(
        request(&runtime, &cwd, "/usr/bin/sleep", vec!["30".to_owned()]),
        artifact_digest,
        source_digest,
    )
    .unwrap();
    let _terminating_runtime = terminating.client().unwrap().open_runtime().unwrap();
    terminating.client().unwrap().activate().unwrap();
    assert!(terminating.client().unwrap().activate().is_err());
    terminating.client().unwrap().terminate(1_000).unwrap();
    assert_eq!(
        terminating.client().unwrap().inspect().unwrap().to_string(),
        "exact-scope-empty"
    );

    fs::remove_dir_all(parent).unwrap();
}

#[test]
fn final_child_exit_orders_root_status_before_exact_empty() {
    enum ReleaseOrder {
        RootFirst,
        ChildrenFirst,
        Simultaneous,
    }

    for (label, order) in [
        ("root-first", ReleaseOrder::RootFirst),
        ("children-first", ReleaseOrder::ChildrenFirst),
        ("simultaneous", ReleaseOrder::Simultaneous),
    ] {
        let (parent, runtime, cwd) = create_runtime_and_cwd(match label {
            "root-first" => "fcr",
            "children-first" => "fcc",
            _ => "fcs",
        });
        let gate = cwd.join("final-child-gates");
        fs::create_dir(&gate).unwrap();
        let prepared = prepare_primary(
            test_fixture_request(
                &runtime,
                &cwd,
                "final_child_order_fixture",
                [(
                    "RPA_FINAL_CHILD_GATE".to_owned(),
                    gate.display().to_string(),
                )],
            ),
            current_executable_digest().unwrap(),
            [0x6e; 32],
        )
        .unwrap();
        let client = prepared.client().unwrap();
        let mut runtime_stream = client.open_runtime().unwrap().into_stream();
        runtime_stream
            .set_read_timeout(Some(Duration::from_secs(10)))
            .unwrap();
        client.activate().unwrap();
        for ready in ["root-ready", "child-a-ready", "child-b-ready"] {
            wait_for_marker(&gate.join(ready), ready);
        }

        let mut root_event_frames = 0;
        let mut exact_empty_frames = 0;
        let terminal_events = match order {
            ReleaseOrder::RootFirst => {
                fs::write(gate.join("release-root"), b"release").unwrap();
                loop {
                    let frame = read_frame(&mut runtime_stream)
                        .unwrap()
                        .expect("runtime closed before root event");
                    if frame.kind == FrameKind::Event {
                        let events = GuardianEvent::decode_journal(&frame.payload).unwrap();
                        if events.last().map(|event| event.kind)
                            == Some(GuardianEventKind::RootExited)
                        {
                            root_event_frames += 1;
                            assert_eq!(
                                events.iter().find_map(|event| event.root_exit),
                                Some(RootExit::Code(23))
                            );
                            break;
                        }
                    }
                }
                assert_eq!(client.inspect().unwrap().to_string(), "root-exited");
                fs::write(gate.join("release-child-a"), b"release").unwrap();
                wait_for_marker(&gate.join("child-a-exiting"), "child-a-exiting");
                assert_eq!(
                    client.inspect().unwrap().to_string(),
                    "root-exited",
                    "{label} reported empty while child B remained held"
                );
                fs::write(gate.join("release-child-b"), b"release").unwrap();
                loop {
                    let frame = read_frame(&mut runtime_stream)
                        .unwrap()
                        .expect("runtime closed before exact empty");
                    if frame.kind == FrameKind::Event {
                        root_event_frames += 1;
                    }
                    if frame.kind == FrameKind::ExactScopeEmpty {
                        exact_empty_frames += 1;
                        break GuardianEvent::decode_journal(&frame.payload).unwrap();
                    }
                }
            }
            ReleaseOrder::ChildrenFirst => {
                fs::write(gate.join("release-child-a"), b"release").unwrap();
                fs::write(gate.join("release-child-b"), b"release").unwrap();
                wait_for_marker(&gate.join("child-a-exiting"), "child-a-exiting");
                wait_for_marker(&gate.join("child-b-exiting"), "child-b-exiting");
                assert_eq!(client.inspect().unwrap().to_string(), "live");
                fs::write(gate.join("release-root"), b"release").unwrap();
                read_ordered_terminal_frames(
                    &mut runtime_stream,
                    &mut root_event_frames,
                    &mut exact_empty_frames,
                )
            }
            ReleaseOrder::Simultaneous => {
                for release in ["release-root", "release-child-a", "release-child-b"] {
                    fs::write(gate.join(release), b"release").unwrap();
                }
                read_ordered_terminal_frames(
                    &mut runtime_stream,
                    &mut root_event_frames,
                    &mut exact_empty_frames,
                )
            }
        };

        assert_eq!(
            root_event_frames, 1,
            "{label} repeated the root event frame"
        );
        assert_eq!(exact_empty_frames, 1, "{label} repeated exact empty");
        let root_index = terminal_events
            .iter()
            .position(|event| event.kind == GuardianEventKind::RootExited)
            .expect("terminal journal omitted root status");
        let empty_index = terminal_events
            .iter()
            .position(|event| event.kind == GuardianEventKind::ExactScopeEmpty)
            .expect("terminal journal omitted exact empty");
        assert!(
            root_index < empty_index,
            "{label} ordered empty before root status"
        );
        assert_eq!(
            terminal_events[root_index].root_exit,
            Some(RootExit::Code(23))
        );
        assert_eq!(client.inspect().unwrap().to_string(), "exact-scope-empty");
        fs::remove_dir_all(parent).unwrap();
    }
}

fn read_ordered_terminal_frames(
    runtime: &mut UnixStream,
    root_event_frames: &mut usize,
    exact_empty_frames: &mut usize,
) -> Vec<GuardianEvent> {
    loop {
        let frame = read_frame(runtime)
            .unwrap()
            .expect("runtime closed before ordered terminal events");
        if frame.kind == FrameKind::Event {
            let events = GuardianEvent::decode_journal(&frame.payload).unwrap();
            if events.last().map(|event| event.kind) == Some(GuardianEventKind::RootExited) {
                *root_event_frames += 1;
                assert_eq!(
                    events.iter().find_map(|event| event.root_exit),
                    Some(RootExit::Code(23))
                );
            }
        }
        if frame.kind == FrameKind::ExactScopeEmpty {
            assert_eq!(
                *root_event_frames, 1,
                "empty arrived before exact root status"
            );
            *exact_empty_frames += 1;
            return GuardianEvent::decode_journal(&frame.payload).unwrap();
        }
    }
}

#[test]
fn workload_mount_cannot_reach_control_or_durable_state() {
    let (parent, runtime, cwd) = create_runtime_and_cwd("atk");
    let artifact_digest = current_executable_digest().unwrap();
    let prepared = prepare_primary(
        test_fixture_request(
            &runtime,
            &cwd,
            "workload_cannot_reach_authority_state_fixture",
            [(
                "RPA_ATTACK_RUNTIME_ROOT".to_owned(),
                runtime.display().to_string(),
            )],
        ),
        artifact_digest,
        [0x31; 32],
    )
    .unwrap();
    let mut runtime_channel = prepared.client().unwrap().open_runtime().unwrap();
    prepared.client().unwrap().activate().unwrap();
    let events = wait_for_exact_empty(&mut runtime_channel, Duration::from_secs(10));
    assert_eq!(
        events.iter().find_map(|event| event.root_exit),
        Some(RootExit::Code(0))
    );
    assert_eq!(
        prepared.client().unwrap().inspect().unwrap().to_string(),
        "exact-scope-empty"
    );
    fs::remove_dir_all(parent).unwrap();
}

#[test]
fn forged_server_receives_no_capability_before_server_first_proof() {
    let (parent, runtime, cwd) = create_runtime_and_cwd("srv");
    let prepared = prepare_primary(
        request(&runtime, &cwd, "/usr/bin/sleep", vec!["30".to_owned()]),
        current_executable_digest().unwrap(),
        [0x32; 32],
    )
    .unwrap();
    let client = prepared.client().unwrap();
    let socket = scope_socket(&runtime, &prepared.attestation.scope_id);
    fs::remove_file(&socket).unwrap();
    let fake = UnixListener::bind(&socket).unwrap();
    fs::set_permissions(&socket, fs::Permissions::from_mode(0o600)).unwrap();
    let fake_server = thread::spawn(move || {
        let (mut stream, _) = fake.accept().unwrap();
        stream
            .set_read_timeout(Some(Duration::from_millis(250)))
            .unwrap();
        let mut first = [0_u8; 1];
        let received = match stream.read(&mut first) {
            Ok(count) => count,
            Err(error)
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                ) =>
            {
                0
            }
            Err(error) => panic!("forged server read failed: {error}"),
        };
        write_frame(
            &mut stream,
            &Frame::new(FrameKind::Challenge, vec![0_u8; 64]).unwrap(),
        )
        .unwrap();
        received
    });
    assert!(client.inspect().is_err());
    assert_eq!(fake_server.join().unwrap(), 0);
    assert!(client.abort(5_000).is_err());
    unsafe {
        libc::kill(
            prepared.attestation.identity.guardian_pid as libc::pid_t,
            libc::SIGKILL,
        );
        libc::waitpid(
            prepared.attestation.identity.guardian_pid as libc::pid_t,
            std::ptr::null_mut(),
            0,
        );
    }
    fs::remove_dir_all(parent).unwrap();
}

#[test]
fn guardian_forced_death_proves_teardown_without_fabricating_root_status() {
    let (parent, runtime, cwd) = create_runtime_and_cwd("gdn");
    let marker = cwd.join("must-remain-absent");
    let prepared = prepare_primary(
        test_fixture_request(
            &runtime,
            &cwd,
            "guardian_death_workload_fixture",
            [(
                "RPA_GUARDIAN_DEATH_MARKER".to_owned(),
                marker.display().to_string(),
            )],
        ),
        current_executable_digest().unwrap(),
        [0x33; 32],
    )
    .unwrap();
    let _runtime_channel = prepared.client().unwrap().open_runtime().unwrap();
    prepared.client().unwrap().activate().unwrap();
    let mut unrelated = Command::new("/usr/bin/sleep").arg("30").spawn().unwrap();
    assert_eq!(
        unsafe {
            libc::kill(
                prepared.attestation.identity.guardian_pid as libc::pid_t,
                libc::SIGKILL,
            )
        },
        0
    );

    let mut helper = Command::new(runtime_helper_executable())
        .args([
            "inspect",
            "--runtime-root",
            runtime.to_str().expect("short test runtime is utf8"),
            "--deadline-ms",
            "5000",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    write_frame(
        helper.stdin.as_mut().unwrap(),
        &Frame::new(FrameKind::Inspect, prepared.attestation.encode().unwrap()).unwrap(),
    )
    .unwrap();
    drop(helper.stdin.take());
    let output = helper.wait_with_output().unwrap();
    assert!(output.status.success(), "helper inspect returned failure");
    let frame = read_frame(&mut Cursor::new(output.stdout))
        .unwrap()
        .unwrap();
    assert_eq!(frame.kind, FrameKind::ExactScopeEmpty);
    let evidence = GuardianEvent::decode_journal(&frame.payload).unwrap();
    assert_eq!(
        evidence.last().map(|event| event.kind),
        Some(GuardianEventKind::ExactScopeEmpty)
    );
    assert!(
        evidence
            .iter()
            .all(|event| event.kind != GuardianEventKind::RootExited),
        "helper fabricated a root result after guardian death"
    );

    assert_eq!(
        prepared.client().unwrap().inspect().unwrap().to_string(),
        "exact-scope-empty"
    );
    assert!(matches!(
        reopen_or_prove_absent(&prepared.attestation.identity).unwrap(),
        AuthorityPresence::AbsentSameBoot
    ));
    let lost_root = prepared.client().unwrap().inspect_events().unwrap_err();
    assert!(lost_root.to_string().contains("event-gap"));
    thread::sleep(Duration::from_millis(1_750));
    assert!(!marker.exists(), "namespace member survived guardian death");
    assert!(unrelated.try_wait().unwrap().is_none());
    unrelated.kill().unwrap();
    unrelated.wait().unwrap();
    fs::remove_dir_all(parent).unwrap();
}

#[test]
fn cli_activate_rejects_a_deadline_outside_the_broker_phase_bound() {
    let (parent, runtime, cwd) = create_runtime_and_cwd("dln");
    let prepared = prepare_primary(
        request(&runtime, &cwd, "/usr/bin/sleep", vec!["30".to_owned()]),
        current_executable_digest().unwrap(),
        [0x41; 32],
    )
    .unwrap();

    // The helper must route --deadline-ms into the activation deadline instead
    // of discarding it. A budget beyond MAX_BROKER_PHASE is therefore rejected
    // by the deadline layer itself. Asserting the exact failure code is what
    // makes this test discriminating: a helper that parses the budget and then
    // throws it away still fails here, but with ReferenceInvalid from the later
    // capability check rather than StateRetained from the deadline bound.
    let mut helper = Command::new(runtime_helper_executable())
        .args([
            "activate",
            "--runtime-root",
            runtime.to_str().expect("short test runtime is utf8"),
            "--deadline-ms",
            "999999999",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    write_frame(
        helper.stdin.as_mut().unwrap(),
        &Frame::new(FrameKind::Activate, prepared.attestation.encode().unwrap()).unwrap(),
    )
    .unwrap();
    drop(helper.stdin.take());
    let output = helper.wait_with_output().unwrap();
    assert!(
        !output.status.success(),
        "out-of-bound activation deadline was accepted"
    );
    let frame = read_frame(&mut Cursor::new(output.stdout))
        .unwrap()
        .unwrap();
    assert_eq!(frame.kind, FrameKind::Failure);
    assert_eq!(
        NativeFailure::decode(&frame.payload).unwrap().code,
        NativeFailureCode::StateRetained,
        "activation deadline was discarded instead of bounded"
    );

    prepared.client().unwrap().abort(2_000).unwrap();
    fs::remove_dir_all(parent).unwrap();
}

#[test]
fn nondumpable_namespace_drift_with_broken_endpoint_never_signals_replacement() {
    let (parent, runtime, cwd) = create_runtime_and_cwd("ndp");
    let prepared = prepare_primary(
        request(&runtime, &cwd, "/usr/bin/sleep", vec!["30".to_owned()]),
        current_executable_digest().unwrap(),
        [0x3b; 32],
    )
    .unwrap();
    let gate = parent.join("replacement-gate");
    fs::create_dir(&gate).unwrap();
    let mut replacement = Command::new(current_test_executable())
        .args(["--exact", "nondumpable_replacement_fixture", "--nocapture"])
        .env("RPA_NONDUMPABLE_GATE", &gate)
        .spawn()
        .unwrap();
    let before = gate.join("before");
    let after = gate.join("after");
    let deadline = Instant::now() + Duration::from_secs(5);
    while !before.exists() {
        assert!(Instant::now() < deadline, "replacement readiness timed out");
        thread::sleep(Duration::from_millis(10));
    }
    let mut replacement_identity = read_process_identity(replacement.id()).unwrap();
    fs::write(gate.join("go"), b"go").unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    while !after.exists() {
        assert!(
            Instant::now() < deadline,
            "nondumpable transition timed out"
        );
        thread::sleep(Duration::from_millis(10));
    }
    assert_eq!(
        fs::metadata(format!("/proc/{}/ns/pid", replacement.id()))
            .unwrap_err()
            .kind(),
        std::io::ErrorKind::PermissionDenied,
        "fixture did not establish the real nondumpable proc boundary"
    );
    replacement_identity.pid_namespace_inode += 1;
    let mut drifted = prepared.attestation.clone();
    drifted.identity = replacement_identity;
    fs::remove_file(scope_socket(&runtime, &prepared.attestation.scope_id)).unwrap();

    let outcome = AuthorityClient::new(&runtime, drifted).unwrap().abort(250);
    let replacement_alive = unsafe { libc::kill(replacement.id() as libc::pid_t, 0) } == 0;

    if replacement_alive {
        replacement.kill().unwrap();
        replacement.wait().unwrap();
    }
    unsafe {
        libc::kill(
            prepared.attestation.identity.guardian_pid as libc::pid_t,
            libc::SIGKILL,
        );
        libc::waitpid(
            prepared.attestation.identity.guardian_pid as libc::pid_t,
            std::ptr::null_mut(),
            0,
        );
    }
    fs::remove_dir_all(parent).unwrap();

    assert!(
        outcome.is_err(),
        "unverified pidfd control did not fail closed"
    );
    assert!(
        replacement_alive,
        "namespace-unverified pidfd signalled replacement"
    );
}

#[test]
fn bounded_nonblocking_stdin_cannot_freeze_output_reaping_or_terminate() {
    let (parent, runtime, cwd) = create_runtime_and_cwd("bkp");
    let prepared = prepare_primary(
        test_fixture_request(
            &runtime,
            &cwd,
            "nonreading_full_output_workload_fixture",
            [("RPA_BACKPRESSURE_FIXTURE".to_owned(), "1".to_owned())],
        ),
        current_executable_digest().unwrap(),
        [0x34; 32],
    )
    .unwrap();
    let mut runtime_channel = prepared.client().unwrap().open_runtime().unwrap();
    prepared.client().unwrap().activate().unwrap();
    for _ in 0..8 {
        if runtime_channel.send_input(vec![0x7a; 64 * 1024]).is_err() {
            break;
        }
    }
    let started = Instant::now();
    prepared.client().unwrap().terminate(250).unwrap();
    assert!(
        started.elapsed() < Duration::from_secs(8),
        "backpressured stdin froze independent termination"
    );
    assert_eq!(
        prepared.client().unwrap().inspect().unwrap().to_string(),
        "exact-scope-empty"
    );
    fs::remove_dir_all(parent).unwrap();
}

#[test]
fn activation_uses_fd_pinned_executable_and_cwd_after_path_replacement() {
    let (parent, runtime, cwd) = create_runtime_and_cwd("pin");
    let moved_cwd = parent.join("prepared-cwd");
    let command = parent.join("prepared-command");
    let replacement = parent.join("replacement-command");
    let marker = parent.join("pinned-marker");
    fs::write(cwd.join("sentinel"), "prepared-object").unwrap();
    fs::copy("/bin/sh", &command).unwrap();
    fs::copy("/bin/false", &replacement).unwrap();
    fs::set_permissions(&command, fs::Permissions::from_mode(0o755)).unwrap();
    fs::set_permissions(&replacement, fs::Permissions::from_mode(0o755)).unwrap();

    let prepared = prepare_primary(
        request(
            &runtime,
            &cwd,
            command.to_str().unwrap(),
            vec![
                "-c".to_owned(),
                format!("cat sentinel > {}", marker.display()),
            ],
        ),
        current_executable_digest().unwrap(),
        [0x35; 32],
    )
    .unwrap();
    fs::rename(&cwd, &moved_cwd).unwrap();
    fs::create_dir(&cwd).unwrap();
    fs::write(cwd.join("sentinel"), "replacement-object").unwrap();
    fs::rename(&replacement, &command).unwrap();

    let mut runtime_channel = prepared.client().unwrap().open_runtime().unwrap();
    prepared.client().unwrap().activate().unwrap();
    let events = wait_for_exact_empty(&mut runtime_channel, Duration::from_secs(10));
    assert_eq!(
        events.iter().find_map(|event| event.root_exit),
        Some(RootExit::Code(0))
    );
    assert_eq!(fs::read_to_string(&marker).unwrap(), "prepared-object");
    fs::remove_dir_all(parent).unwrap();
}

#[test]
fn canonical_system_interpreter_script_launches_without_shell_fallback() {
    let (parent, runtime, cwd) = create_runtime_and_cwd("scr");
    let prepared = prepare_primary(
        request(
            &runtime,
            &cwd,
            "/usr/bin/which.debianutils",
            vec!["/bin/sh".to_owned()],
        ),
        current_executable_digest().unwrap(),
        [0x3c; 32],
    )
    .unwrap();
    let mut runtime_channel = prepared.client().unwrap().open_runtime().unwrap();
    prepared.client().unwrap().activate().unwrap();
    let events = wait_for_exact_empty(&mut runtime_channel, Duration::from_secs(10));
    assert_eq!(
        events.iter().find_map(|event| event.root_exit),
        Some(RootExit::Code(0)),
        "canonical system script did not run through its pinned interpreter"
    );
    fs::remove_dir_all(parent).unwrap();
}

#[test]
fn script_and_interpreter_replacement_cannot_change_pinned_launch() {
    let (parent, runtime, cwd) = create_runtime_and_cwd("sip");
    let interpreter = parent.join("pinned-interpreter");
    let replacement_interpreter = parent.join("replacement-interpreter");
    let script = parent.join("pinned-script");
    let replacement_script = parent.join("replacement-script");
    let marker = parent.join("script-marker");
    fs::copy("/bin/sh", &interpreter).unwrap();
    fs::copy("/bin/false", &replacement_interpreter).unwrap();
    fs::write(
        &script,
        format!(
            "#!{}\nprintf pinned > {}\n",
            interpreter.display(),
            marker.display()
        ),
    )
    .unwrap();
    fs::write(&replacement_script, "#!/bin/sh\nexit 91\n").unwrap();
    for executable in [
        &interpreter,
        &replacement_interpreter,
        &script,
        &replacement_script,
    ] {
        fs::set_permissions(executable, fs::Permissions::from_mode(0o755)).unwrap();
    }
    let prepared = prepare_primary(
        request(&runtime, &cwd, script.to_str().unwrap(), Vec::new()),
        current_executable_digest().unwrap(),
        [0x3e; 32],
    )
    .unwrap();
    fs::rename(&replacement_script, &script).unwrap();
    fs::rename(&replacement_interpreter, &interpreter).unwrap();

    let mut runtime_channel = prepared.client().unwrap().open_runtime().unwrap();
    prepared.client().unwrap().activate().unwrap();
    let events = wait_for_exact_empty(&mut runtime_channel, Duration::from_secs(10));
    assert_eq!(
        events.iter().find_map(|event| event.root_exit),
        Some(RootExit::Code(0))
    );
    assert_eq!(fs::read_to_string(&marker).unwrap(), "pinned");
    fs::remove_dir_all(parent).unwrap();
}

#[test]
fn execute_only_elf_launches_from_its_pinned_descriptor() {
    let (parent, runtime, cwd) = create_runtime_and_cwd("xlf");
    let command = parent.join("execute-only-true");
    fs::copy("/usr/bin/true", &command).unwrap();
    fs::set_permissions(&command, fs::Permissions::from_mode(0o111)).unwrap();
    let prepared = prepare_primary(
        request(&runtime, &cwd, command.to_str().unwrap(), Vec::new()),
        current_executable_digest().unwrap(),
        [0x3d; 32],
    )
    .unwrap();
    let mut runtime_channel = prepared.client().unwrap().open_runtime().unwrap();
    prepared.client().unwrap().activate().unwrap();
    let events = wait_for_exact_empty(&mut runtime_channel, Duration::from_secs(10));
    assert_eq!(
        events.iter().find_map(|event| event.root_exit),
        Some(RootExit::Code(0))
    );
    fs::remove_dir_all(parent).unwrap();
}

#[test]
fn abort_response_failure_cannot_leave_a_terminal_guardian_alive() {
    let (parent, runtime, cwd) = create_runtime_and_cwd("abt");
    let marker = cwd.join("must-not-exist");
    let prepared = prepare_primary(
        request(
            &runtime,
            &cwd,
            "/usr/bin/touch",
            vec![marker.display().to_string()],
        ),
        current_executable_digest().unwrap(),
        [0x36; 32],
    )
    .unwrap();
    let authority = reopen_exact_authority(&prepared.attestation.identity).unwrap();
    let socket = scope_socket(&runtime, &prepared.attestation.scope_id);
    let mut stream = UnixStream::connect(socket).unwrap();
    let challenge = read_frame(&mut stream).unwrap().unwrap();
    assert_eq!(challenge.kind, FrameKind::Challenge);
    let request = ControlRequest {
        scope_capability: prepared.attestation.scope_capability,
        control_capability: prepared.attestation.control_capability,
        identity: prepared.attestation.identity.clone(),
        deadline_monotonic_ns: AbsoluteMonotonicDeadline::after_ms(5_000)
            .unwrap()
            .absolute_ns()
            .unwrap(),
        operation: ControlOperation::Abort,
    };
    write_frame(
        &mut stream,
        &Frame::new(FrameKind::Abort, request.encode().unwrap()).unwrap(),
    )
    .unwrap();
    stream.shutdown(Shutdown::Read).unwrap();
    assert!(
        authority.wait(5_000).unwrap(),
        "guardian remained alive after terminal commit response loss"
    );
    let mut status = 0;
    assert_eq!(
        unsafe {
            libc::waitpid(
                prepared.attestation.identity.guardian_pid as libc::pid_t,
                &mut status,
                0,
            )
        },
        prepared.attestation.identity.guardian_pid as libc::pid_t
    );
    assert!(matches!(
        reopen_or_prove_absent(&prepared.attestation.identity).unwrap(),
        AuthorityPresence::AbsentSameBoot
    ));
    prepared.client().unwrap().abort(1_000).unwrap();
    assert!(!marker.exists());
    fs::remove_dir_all(parent).unwrap();
}

#[test]
fn actual_root_signal_is_preserved_inside_the_closed_linux_range() {
    let (parent, runtime, cwd) = create_runtime_and_cwd("sig");
    let shell = fs::canonicalize("/bin/sh").unwrap();
    let prepared = prepare_primary(
        request(
            &runtime,
            &cwd,
            shell.to_str().unwrap(),
            vec!["-c".to_owned(), "kill -TERM $$".to_owned()],
        ),
        current_executable_digest().unwrap(),
        [0x37; 32],
    )
    .unwrap();
    let mut runtime_channel = prepared.client().unwrap().open_runtime().unwrap();
    prepared.client().unwrap().activate().unwrap();
    let events = wait_for_exact_empty(&mut runtime_channel, Duration::from_secs(10));
    assert_eq!(
        events.iter().find_map(|event| event.root_exit),
        Some(RootExit::Signal(libc::SIGTERM))
    );
    fs::remove_dir_all(parent).unwrap();
}

#[test]
fn setpgid_orphan_keeps_scope_live_until_exact_pidfd_force() {
    let (parent, runtime, cwd) = create_runtime_and_cwd("pgr");
    let marker = cwd.join("setpgid-descendant-escaped");
    let prepared = prepare_primary(
        test_fixture_request(
            &runtime,
            &cwd,
            "setpgid_resistant_descendant_fixture",
            [(
                "RPA_SETPGID_MARKER".to_owned(),
                marker.display().to_string(),
            )],
        ),
        current_executable_digest().unwrap(),
        [0x39; 32],
    )
    .unwrap();
    let mut runtime_channel = prepared.client().unwrap().open_runtime().unwrap();
    prepared.client().unwrap().activate().unwrap();
    let deadline = Instant::now() + Duration::from_secs(10);
    let root_exit = loop {
        match runtime_channel.read() {
            Ok(Some(frame)) if frame.kind == FrameKind::Event => {
                let events = GuardianEvent::decode_journal(&frame.payload).unwrap();
                if let Some(root_exit) = events.iter().find_map(|event| event.root_exit) {
                    break root_exit;
                }
            }
            Ok(Some(frame)) if frame.kind == FrameKind::ExactScopeEmpty => {
                panic!("setpgid descendant did not keep the scope live")
            }
            Ok(Some(_)) => {}
            Ok(None) => panic!("runtime closed before the root exit event"),
            Err(error)
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                ) && Instant::now() < deadline => {}
            Err(error) => panic!("runtime failed before root exit: {error}"),
        }
        assert!(Instant::now() < deadline, "root exit event timed out");
    };
    assert_eq!(root_exit, RootExit::Code(0));
    assert_eq!(
        prepared.client().unwrap().inspect().unwrap().to_string(),
        "root-exited"
    );
    prepared.client().unwrap().terminate(250).unwrap();
    assert_eq!(
        prepared.client().unwrap().inspect().unwrap().to_string(),
        "exact-scope-empty"
    );
    thread::sleep(Duration::from_millis(2_250));
    assert!(!marker.exists(), "setpgid descendant escaped pidfd force");
    fs::remove_dir_all(parent).unwrap();
}

#[test]
fn close_range_enosys_fallback_closes_high_fd_in_guardian_and_workload() {
    let child = unsafe { libc::fork() };
    assert!(child >= 0);
    if child == 0 {
        let passed = std::panic::catch_unwind(|| {
            let (parent, runtime, cwd) = create_runtime_and_cwd("fds");
            let raised = libc::rlimit {
                rlim_cur: 4_097,
                rlim_max: 4_097,
            };
            assert_eq!(unsafe { libc::setrlimit(libc::RLIMIT_NOFILE, &raised) }, 0);
            let source = unsafe { libc::open(c"/dev/null".as_ptr(), libc::O_RDONLY) };
            assert!(source >= 0);
            assert_eq!(unsafe { libc::dup2(source, 4096) }, 4096);
            unsafe { libc::close(source) };
            let limit = libc::rlimit {
                rlim_cur: 64,
                rlim_max: 64,
            };
            assert_eq!(unsafe { libc::setrlimit(libc::RLIMIT_NOFILE, &limit) }, 0);
            install_close_range_enosys_filter().unwrap();
            let prepared = prepare_primary(
                test_fixture_request(
                    &runtime,
                    &cwd,
                    "inherited_high_fd_is_closed_fixture",
                    [("RPA_EXPECT_CLOSED_FD".to_owned(), "4096".to_owned())],
                ),
                current_executable_digest().unwrap(),
                [0x38; 32],
            )
            .unwrap();
            let mut runtime_channel = prepared.client().unwrap().open_runtime().unwrap();
            prepared.client().unwrap().activate().unwrap();
            let events = wait_for_exact_empty(&mut runtime_channel, Duration::from_secs(10));
            assert_eq!(
                events.iter().find_map(|event| event.root_exit),
                Some(RootExit::Code(0))
            );
            fs::remove_dir_all(parent).unwrap();
        })
        .is_ok();
        unsafe { libc::_exit(if passed { 0 } else { 219 }) }
    }
    let mut status = 0;
    assert_eq!(unsafe { libc::waitpid(child, &mut status, 0) }, child);
    assert!(libc::WIFEXITED(status));
    assert_eq!(libc::WEXITSTATUS(status), 0);
}

#[test]
fn unavailable_configuration_matrix_fails_closed_without_global_mutation() {
    for (label, short) in [
        ("namespace", "udn"),
        ("mapping", "udw"),
        ("mount", "udm"),
        ("pidfd", "udp"),
    ] {
        let (parent, runtime, cwd) = create_runtime_and_cwd(short);
        let marker = cwd.join("must-not-execute");
        let mut unrelated = Command::new("/usr/bin/sleep").arg("120").spawn().unwrap();
        let result = Command::new(current_test_executable())
            .args([
                "--exact",
                "unavailable_configuration_fixture",
                "--nocapture",
            ])
            .env("RPA_UNAVAILABLE_SELECTOR", label)
            .env("RPA_UNAVAILABLE_RUNTIME", &runtime)
            .env("RPA_UNAVAILABLE_CWD", &cwd)
            .env("RPA_UNAVAILABLE_MARKER", &marker)
            .output()
            .unwrap();
        assert!(
            result.status.success(),
            "{label} unavailable fixture failed: {}",
            String::from_utf8_lossy(&result.stderr)
        );
        assert!(fs::read_dir(&runtime).unwrap().next().is_none());
        assert!(!marker.exists(), "{label} denial executed workload code");
        assert!(
            unrelated.try_wait().unwrap().is_none(),
            "{label} denial signalled an unrelated process"
        );
        unrelated.kill().unwrap();
        unrelated.wait().unwrap();
        fs::remove_dir_all(parent).unwrap();
    }
}

fn install_prepare_denial_filter(
    syscall: libc::c_long,
    errno: libc::c_int,
    argument_mask: Option<(u32, u32)>,
) -> std::io::Result<()> {
    const BPF_LOAD_WORD_ABSOLUTE: u16 = 0x20;
    const BPF_JUMP_EQUAL: u16 = 0x15;
    const BPF_JUMP_SET: u16 = 0x45;
    const BPF_RETURN: u16 = 0x06;
    const SECCOMP_RETURN_ERRNO: u32 = 0x0005_0000;
    const SECCOMP_RETURN_ALLOW: u32 = 0x7fff_0000;

    let mut filter = if let Some((argument_offset, mask)) = argument_mask {
        vec![
            libc::sock_filter {
                code: BPF_LOAD_WORD_ABSOLUTE,
                jt: 0,
                jf: 0,
                k: 0,
            },
            libc::sock_filter {
                code: BPF_JUMP_EQUAL,
                jt: 0,
                jf: 3,
                k: syscall as u32,
            },
            libc::sock_filter {
                code: BPF_LOAD_WORD_ABSOLUTE,
                jt: 0,
                jf: 0,
                k: argument_offset,
            },
            libc::sock_filter {
                code: BPF_JUMP_SET,
                jt: 0,
                jf: 1,
                k: mask,
            },
            libc::sock_filter {
                code: BPF_RETURN,
                jt: 0,
                jf: 0,
                k: SECCOMP_RETURN_ERRNO | errno as u32,
            },
            libc::sock_filter {
                code: BPF_RETURN,
                jt: 0,
                jf: 0,
                k: SECCOMP_RETURN_ALLOW,
            },
        ]
    } else {
        vec![
            libc::sock_filter {
                code: BPF_LOAD_WORD_ABSOLUTE,
                jt: 0,
                jf: 0,
                k: 0,
            },
            libc::sock_filter {
                code: BPF_JUMP_EQUAL,
                jt: 0,
                jf: 1,
                k: syscall as u32,
            },
            libc::sock_filter {
                code: BPF_RETURN,
                jt: 0,
                jf: 0,
                k: SECCOMP_RETURN_ERRNO | errno as u32,
            },
            libc::sock_filter {
                code: BPF_RETURN,
                jt: 0,
                jf: 0,
                k: SECCOMP_RETURN_ALLOW,
            },
        ]
    };
    let program = libc::sock_fprog {
        len: filter.len() as u16,
        filter: filter.as_mut_ptr(),
    };
    if unsafe { libc::prctl(libc::PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) } < 0
        || unsafe {
            libc::prctl(
                libc::PR_SET_SECCOMP,
                libc::SECCOMP_MODE_FILTER,
                &program as *const libc::sock_fprog,
            )
        } < 0
    {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}

fn install_close_range_enosys_filter() -> std::io::Result<()> {
    const BPF_LOAD_SYSCALL: u16 = 0x20;
    const BPF_JUMP_EQUAL: u16 = 0x15;
    const BPF_RETURN: u16 = 0x06;
    const SECCOMP_RETURN_ERRNO: u32 = 0x0005_0000;
    const SECCOMP_RETURN_ALLOW: u32 = 0x7fff_0000;
    let mut filter = [
        libc::sock_filter {
            code: BPF_LOAD_SYSCALL,
            jt: 0,
            jf: 0,
            k: 0,
        },
        libc::sock_filter {
            code: BPF_JUMP_EQUAL,
            jt: 0,
            jf: 1,
            k: libc::SYS_close_range as u32,
        },
        libc::sock_filter {
            code: BPF_RETURN,
            jt: 0,
            jf: 0,
            k: SECCOMP_RETURN_ERRNO | libc::ENOSYS as u32,
        },
        libc::sock_filter {
            code: BPF_RETURN,
            jt: 0,
            jf: 0,
            k: SECCOMP_RETURN_ALLOW,
        },
    ];
    let program = libc::sock_fprog {
        len: filter.len() as u16,
        filter: filter.as_mut_ptr(),
    };
    if unsafe { libc::prctl(libc::PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) } < 0
        || unsafe {
            libc::prctl(
                libc::PR_SET_SECCOMP,
                libc::SECCOMP_MODE_FILTER,
                &program as *const libc::sock_fprog,
            )
        } < 0
    {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[test]
fn workload_cannot_reach_authority_state_fixture() {
    let Ok(runtime) = std::env::var("RPA_ATTACK_RUNTIME_ROOT") else {
        return;
    };
    let sockets = fs::read_to_string("/proc/net/unix").unwrap();
    let socket = sockets
        .lines()
        .filter_map(|line| line.split_whitespace().last())
        .map(PathBuf::from)
        .find(|path| path.starts_with(&runtime) && path.ends_with("control.sock"))
        .expect("workload did not discover the authority socket in /proc/net/unix");
    assert!(fs::read_dir(&runtime).is_err());
    assert!(UnixStream::connect(&socket).is_err());
    assert!(fs::remove_file(&socket).is_err());
    assert!(UnixListener::bind(&socket).is_err());
    let directory = socket.parent().unwrap();
    assert!(fs::write(directory.join("journal.bin"), b"forged").is_err());
    assert!(fs::write(directory.join("terminal.bin"), b"forged").is_err());
}

#[test]
fn guardian_death_workload_fixture() {
    let Ok(marker) = std::env::var("RPA_GUARDIAN_DEATH_MARKER") else {
        return;
    };
    thread::sleep(Duration::from_millis(1_500));
    fs::write(marker, b"escaped").unwrap();
}

#[test]
fn nonreading_full_output_workload_fixture() {
    if std::env::var("RPA_BACKPRESSURE_FIXTURE").as_deref() != Ok("1") {
        return;
    }
    thread::sleep(Duration::from_millis(100));
    let stdout = thread::spawn(|| {
        std::io::stdout()
            .write_all(&vec![b'o'; 1024 * 1024])
            .unwrap();
    });
    let stderr = thread::spawn(|| {
        std::io::stderr()
            .write_all(&vec![b'e'; 1024 * 1024])
            .unwrap();
    });
    stdout.join().unwrap();
    stderr.join().unwrap();
    thread::sleep(Duration::from_secs(30));
}

#[test]
fn nondumpable_replacement_fixture() {
    let Ok(gate) = std::env::var("RPA_NONDUMPABLE_GATE") else {
        return;
    };
    let gate = PathBuf::from(gate);
    fs::write(gate.join("before"), b"before").unwrap();
    while !gate.join("go").exists() {
        thread::sleep(Duration::from_millis(10));
    }
    assert_eq!(unsafe { libc::prctl(libc::PR_SET_DUMPABLE, 0, 0, 0, 0) }, 0);
    fs::write(gate.join("after"), b"after").unwrap();
    thread::sleep(Duration::from_secs(30));
}

#[test]
fn inherited_high_fd_is_closed_fixture() {
    let Ok(descriptor) = std::env::var("RPA_EXPECT_CLOSED_FD") else {
        return;
    };
    let descriptor = descriptor.parse::<libc::c_int>().unwrap();
    assert_eq!(unsafe { libc::fcntl(descriptor, libc::F_GETFD) }, -1);
    assert_eq!(
        std::io::Error::last_os_error().raw_os_error(),
        Some(libc::EBADF)
    );
}

#[test]
fn final_child_order_fixture() {
    let Ok(gate) = std::env::var("RPA_FINAL_CHILD_GATE") else {
        return;
    };
    let gate = PathBuf::from(gate);
    for child_name in ["a", "b"] {
        let child = unsafe { libc::fork() };
        assert!(child >= 0);
        if child == 0 {
            fs::write(gate.join(format!("child-{child_name}-ready")), b"ready").unwrap();
            wait_for_marker(
                &gate.join(format!("release-child-{child_name}")),
                &format!("release-child-{child_name}"),
            );
            fs::write(gate.join(format!("child-{child_name}-exiting")), b"exiting").unwrap();
            unsafe { libc::_exit(0) }
        }
    }
    fs::write(gate.join("root-ready"), b"ready").unwrap();
    wait_for_marker(&gate.join("release-root"), "release-root");
    unsafe { libc::_exit(23) }
}

#[test]
fn unavailable_configuration_fixture() {
    let Ok(selector) = std::env::var("RPA_UNAVAILABLE_SELECTOR") else {
        return;
    };
    let runtime = PathBuf::from(std::env::var("RPA_UNAVAILABLE_RUNTIME").unwrap());
    let cwd = PathBuf::from(std::env::var("RPA_UNAVAILABLE_CWD").unwrap());
    let marker = PathBuf::from(std::env::var("RPA_UNAVAILABLE_MARKER").unwrap());
    match selector.as_str() {
        "namespace" => install_prepare_denial_filter(libc::SYS_clone, libc::EPERM, None),
        "mapping" => install_prepare_denial_filter(
            libc::SYS_openat,
            libc::EACCES,
            Some((32, (libc::O_WRONLY | libc::O_RDWR) as u32)),
        ),
        "mount" => install_prepare_denial_filter(libc::SYS_mount, libc::EPERM, None),
        "pidfd" => install_prepare_denial_filter(libc::SYS_pidfd_open, libc::ENOSYS, None),
        _ => panic!("unknown unavailable selector"),
    }
    .unwrap();

    let error = prepare_primary(
        request(
            &runtime,
            &cwd,
            "/usr/bin/touch",
            vec![marker.display().to_string()],
        ),
        current_executable_digest().unwrap(),
        [0x6f; 32],
    )
    .err()
    .unwrap_or_else(|| panic!("{selector} denial unexpectedly prepared authority"));
    assert_eq!(
        NativeFailureCode::from_prepare_error(&error),
        NativeFailureCode::Unavailable,
        "{selector} denial did not retain typed unavailable: {error}"
    );
    assert!(fs::read_dir(&runtime).unwrap().next().is_none());
    assert!(!marker.exists());
    let mut status = 0;
    assert_eq!(unsafe { libc::waitpid(-1, &mut status, libc::WNOHANG) }, -1);
    assert_eq!(
        std::io::Error::last_os_error().raw_os_error(),
        Some(libc::ECHILD),
        "{selector} retained an unreaped construction guardian"
    );
}

#[test]
fn setpgid_resistant_descendant_fixture() {
    let Ok(marker) = std::env::var("RPA_SETPGID_MARKER") else {
        return;
    };
    let marker = std::ffi::CString::new(marker).unwrap();
    let child = unsafe { libc::fork() };
    assert!(child >= 0);
    if child == 0 {
        if unsafe { libc::setpgid(0, 0) } < 0 {
            unsafe { libc::_exit(220) }
        }
        unsafe {
            libc::signal(libc::SIGTERM, libc::SIG_IGN);
            libc::sleep(2);
        }
        let descriptor = unsafe {
            libc::open(
                marker.as_ptr(),
                libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL | libc::O_CLOEXEC,
                0o600,
            )
        };
        if descriptor >= 0 {
            unsafe {
                libc::write(descriptor, b"escaped".as_ptr().cast(), b"escaped".len());
                libc::close(descriptor);
            }
        }
        unsafe { libc::_exit(0) }
    }
}
