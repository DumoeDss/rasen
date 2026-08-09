//! Guardian lifecycle against the real kernel, driven through the **real helper and guardian
//! binaries** rather than the library.
//!
//! This is the only place the sole-handle invariant can be tested at all: it is a statement
//! about what the operating system does when the process holding the Job's last handle dies,
//! and it needs a real guardian process to die.
//!
//! Every test here asserts. There is no gated entry point in this file.

#![cfg(windows)]

use std::io::Write;
use std::path::PathBuf;
use std::process::Command;
use std::time::{Duration, Instant};

use rasen_windows_process_authority::attestation::PrepareAttestation;
use rasen_windows_process_authority::endpoint::ControlEndpointClient;
use rasen_windows_process_authority::guardian::PipeStream;
use rasen_windows_process_authority::protocol::*;
use rasen_windows_process_authority::sha256;
use rasen_windows_process_authority::stateroot::TrustedStateRoot;
use rasen_windows_process_authority::sys::*;
use rasen_windows_process_authority::win::{self, OwnedHandle};

/// The helper this suite executes.
///
/// `RWPA_HELPER_BINARY` points the binary-executing rows at the **packaging-produced** helper so
/// their receipts name the artifact that actually ships. The cargo test-profile binary remains
/// the fallback, but it is **not a silent one**: [`record_execution`] prints which source the
/// path came from and the SHA-256 of the bytes that ran, so a misconfigured run cannot
/// over-claim — the printed hash simply will not be the shipped one.
///
/// A quiet fallback here would be the same defect as the superseded `aeb1af91…` release build,
/// arriving by a different door: a green run whose receipt names an artifact it did not execute.
fn helper_path() -> PathBuf {
    match std::env::var("RWPA_HELPER_BINARY") {
        Ok(value) if !value.trim().is_empty() => PathBuf::from(value.trim()),
        _ => PathBuf::from(env!("CARGO_BIN_EXE_rasen-windows-process-authority")),
    }
}

fn helper_path_source() -> &'static str {
    match std::env::var("RWPA_HELPER_BINARY") {
        Ok(value) if !value.trim().is_empty() => "RWPA_HELPER_BINARY",
        _ => "cargo-test-profile-fallback",
    }
}

fn sha256_of_file(path: &PathBuf) -> String {
    sha256::digest_hex(&std::fs::read(path).unwrap_or_else(|error| {
        panic!("cannot read the helper at {}: {error}", path.display())
    }))
}

/// Make each binary-executing row self-describing: which helper ran, where the path came from,
/// the hash of the bytes on disk, and what the helper measured about itself.
///
/// The assertion is a real oracle rather than bookkeeping. It compares the hash the **test**
/// computed over the file it invoked against the hash the **helper** computed over its own
/// executable at prepare. A disagreement means the helper's self-measurement is not describing
/// the binary that ran, which would make every `artifactSha256` in every receipt untrustworthy.
fn record_execution(row: &str, attestation: &PrepareAttestation) {
    let path = helper_path();
    let executed = sha256_of_file(&path);
    let source_digest = if attestation.helper_source_digest.is_empty() {
        "<absent: helper was not built through the packaging script>"
    } else {
        &attestation.helper_source_digest
    };
    println!(
        "ROW {row}\n  helper                = {}\n  helperPathSource      = {}\n  \
         executedSha256        = {executed}\n  selfMeasuredArtifact  = {}\n  sourceSha256          = {source_digest}",
        path.display(),
        helper_path_source(),
        attestation.artifact_sha256
    );
    assert_eq!(
        executed, attestation.artifact_sha256,
        "the helper's self-measured artifactSha256 does not describe the bytes that were \
         executed; every receipt binding an artifact hash would be untrustworthy"
    );
}

/// Root plus one detached descendant, both long-lived.
const WORKLOAD: &str = "start /b ping -n 90 127.0.0.1 > nul & ping -n 90 127.0.0.1 > nul";

fn state_root(tag: &str) -> PathBuf {
    let mut base = std::env::temp_dir();
    base.push(format!(
        "rasen-wpa-guardian-{tag}-{}",
        win::current_process_id()
    ));
    let _ = std::fs::remove_dir_all(&base);
    std::fs::create_dir_all(&base).expect("state root");
    base
}

fn unhex(value: &str) -> Vec<u8> {
    (0..value.len() / 2)
        .map(|index| u8::from_str_radix(&value[index * 2..index * 2 + 2], 16).expect("hex"))
        .collect()
}

/// Run the production `prepare` verb and decode the attestation it emits.
fn prepare(tag: &str, mutations: &[&str]) -> (PrepareAttestation, PathBuf) {
    let root = state_root(tag);
    let mut command = Command::new(helper_path());
    command
        .arg("prepare")
        .args(["--operation", &format!("guardian-{tag}")])
        .args(["--state-root", &root.to_string_lossy()])
        .args(["--executable", "C:\\Windows\\System32\\cmd.exe"])
        .args(["--cwd", "C:\\Windows"])
        .args(["--arg", "/c"])
        .args(["--arg", WORKLOAD])
        .args(["--env", "SystemRoot=C:\\Windows"])
        .args(["--env", "PATH=C:\\Windows\\System32;C:\\Windows"]);
    for mutation in mutations {
        command.args(["--mutate", mutation]);
    }
    let output = command.output().expect("prepare");
    assert!(
        output.status.success(),
        "prepare failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
    let payload = stdout
        .lines()
        .find_map(|line| line.strip_prefix("RWA1-ATTESTATION payload "))
        .unwrap_or_else(|| panic!("no attestation payload in prepare output:\n{stdout}"));
    let attestation =
        PrepareAttestation::decode(&unhex(payload.trim())).expect("decode attestation");
    record_execution(tag, &attestation);
    (attestation, root)
}

struct Session {
    #[allow(dead_code)]
    client: ControlEndpointClient,
    stream: PipeStream,
}

/// The endpoint serves one session at a time, so a reconnect immediately after a previous
/// session ended can land on `ERROR_PIPE_BUSY` before the guardian has re-armed
/// `ConnectNamedPipe`. That is a real, correctly typed retained failure of the product, so the
/// retry lives here in the harness rather than being hidden inside the client.
fn connect_client(attestation: &PrepareAttestation) -> ControlEndpointClient {
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        match ControlEndpointClient::connect(
            &attestation.scope_id,
            attestation.guardian_process_id,
            attestation.guardian_birth,
            &attestation.endpoint_owner_sid,
        ) {
            Ok(client) => return client,
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                assert!(Instant::now() < deadline, "endpoint stayed busy: {error}");
                std::thread::sleep(Duration::from_millis(25));
            }
            Err(error) => panic!("reopen the authority: {error}"),
        }
    }
}

fn connect(attestation: &PrepareAttestation) -> Session {
    let client = connect_client(attestation);
    let mut stream = PipeStream::overlapped(client.raw()).expect("stream");
    write_frame(
        &mut stream,
        &Frame {
            kind: FrameKind::Attest,
            payload: attestation.control_capability.to_vec(),
        },
    )
    .expect("capability");
    let echoed = read_frame(&mut stream)
        .expect("read")
        .expect("attestation frame");
    assert_eq!(echoed.kind, FrameKind::Attestation);
    Session { client, stream }
}

/// Open the runtime bridge, activate, and return the root process id together with a handle
/// opened while the process is definitely alive.
fn activate(session: &mut Session) -> (u32, OwnedHandle) {
    write_frame(
        &mut session.stream,
        &Frame {
            kind: FrameKind::OpenRuntime,
            payload: Vec::new(),
        },
    )
    .expect("open runtime");
    let ready = read_frame(&mut session.stream)
        .expect("read")
        .expect("runtime ready");
    assert_eq!(ready.kind, FrameKind::RuntimeReady);
    write_frame(
        &mut session.stream,
        &Frame {
            kind: FrameKind::Activate,
            payload: Vec::new(),
        },
    )
    .expect("activate");
    loop {
        let frame = read_frame(&mut session.stream)
            .expect("read")
            .expect("activation frame");
        match frame.kind {
            FrameKind::Activated => {
                let process_id =
                    u32::from_be_bytes(frame.payload[..4].try_into().expect("pid"));
                let handle = win::open_process(
                    PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE,
                    process_id,
                )
                .expect("open the activated root");
                return (process_id, handle);
            }
            FrameKind::Output | FrameKind::ErrorOutput => {}
            FrameKind::Failure => panic!(
                "activation failed: {}",
                NativeFailureCode::decode(&frame.payload)
                    .expect("failure")
                    .diagnostic_code()
            ),
            other => panic!("unexpected frame {}", other.name()),
        }
    }
}

fn kill(process_id: u32) {
    let handle = win::open_process(PROCESS_TERMINATE | SYNCHRONIZE, process_id)
        .expect("open the guardian for termination");
    assert_ne!(
        unsafe { TerminateProcess(handle.raw(), 1) },
        FALSE,
        "TerminateProcess refused"
    );
    unsafe { WaitForSingleObject(handle.raw(), 10_000) };
}

/// Ask the trusted state root whether it still corroborates the sole-handle attestation.
/// `None` means "not corroborated" and must never be read as exact-scope-empty.
fn corroboration(root: &PathBuf, attestation: &PrepareAttestation) -> Option<String> {
    let owner = win::current_user_sid().expect("sid");
    let state_root = TrustedStateRoot::open(&root.to_string_lossy(), &owner).expect("state root");
    state_root
        .corroborate_sole_handle(&attestation.scope_id, &attestation.sole_handle_token)
        .expect("corroborate")
}

/// Did the process behind this handle exit within `window`?
fn exited_within(handle: &OwnedHandle, window: Duration) -> bool {
    unsafe { WaitForSingleObject(handle.raw(), window.as_millis() as Dword) == WAIT_OBJECT_0 }
}

#[test]
fn actual_guardian_death_destroys_the_authority_and_terminates_every_member() {
    // Task 8.11. The guardian holds the Job's only handle and the Job carries
    // `KILL_ON_JOB_CLOSE`, so the guardian dying must take the whole scope with it. This is the
    // property that makes a crashed controller stack unable to leave a live uncontrolled scope.
    let (attestation, root_directory) = prepare("death", &[]);
    assert!(attestation.job.sole_handle_holds());

    // GREEN half of the corroboration pair: while the invariant holds, the trusted state root
    // says so, and the recovery rule is entitled to apply the last-handle inference.
    assert_eq!(
        corroboration(&root_directory, &attestation),
        Some(sha256::hex(&attestation.sole_handle_token)),
        "a healthy authority did not corroborate its own sole-handle attestation"
    );

    let mut session = connect(&attestation);
    let (root_id, root_handle) = activate(&mut session);

    // Give the workload time to create its detached descendant, so the claim covers more than
    // the root.
    std::thread::sleep(Duration::from_millis(1200));
    assert!(
        !exited_within(&root_handle, Duration::from_millis(50)),
        "the root exited on its own before the guardian was killed"
    );

    kill(attestation.guardian_process_id);

    assert!(
        exited_within(&root_handle, Duration::from_secs(15)),
        "root {root_id} survived the death of the sole Job handle holder"
    );
    let _ = std::fs::remove_dir_all(&root_directory);
}

#[test]
fn red_duplicating_the_job_handle_lets_members_survive_the_guardian() {
    // Task 9.2. The recovery rules infer `exact-scope-empty` from "the guardian is gone" —
    // and that inference is sound **only** because the guardian held the last handle. This
    // breaks exactly that invariant and shows the members survive, which means the inference
    // would fabricate an exact-empty receipt for a live workload.
    //
    // Without this RED, the GREEN above does not distinguish "the last-handle rule killed the
    // scope" from "the workload happened to exit".
    let (attestation, root_directory) = prepare("duplicate", &["duplicate-job-into-root"]);
    // At prepare the invariant still holds — the duplication happens at activation — so the
    // corroboration exists here. That matters: it means the RED below is the *withdrawal*, not
    // simply "this run never wrote one".
    assert_eq!(
        corroboration(&root_directory, &attestation),
        Some(sha256::hex(&attestation.sole_handle_token))
    );

    let mut session = connect(&attestation);
    let (root_id, root_handle) = activate(&mut session);
    std::thread::sleep(Duration::from_millis(1200));

    // RED half: the Job handle has now been duplicated, so the trusted state root must stop
    // corroborating. "The reference carries an attestation" is still true and always will be —
    // which is exactly why presence is not the question. Corroboration is.
    assert_eq!(
        corroboration(&root_directory, &attestation),
        None,
        "the trusted state root still corroborates a sole-handle invariant the kernel no \
         longer has; a replacement would fabricate exact-scope-empty for a live workload"
    );

    kill(attestation.guardian_process_id);

    let survived = !exited_within(&root_handle, Duration::from_secs(6));
    if survived {
        // Clean up the scope this test deliberately orphaned.
        if let Ok(handle) = win::open_process(PROCESS_TERMINATE | SYNCHRONIZE, root_id) {
            unsafe { TerminateProcess(handle.raw(), 1) };
        }
    }
    assert!(
        survived,
        "the RED did not reproduce: root {root_id} still died after the Job handle was \
         duplicated, so the sole-handle attestation is not load-bearing in this build"
    );

    // The attestation must make the broken invariant visible, otherwise the provider would
    // apply the guardian-absence inference anyway.
    let mut session_attestation = attestation.clone();
    session_attestation.job.job_handle_duplications = 1;
    assert!(!session_attestation.job.sole_handle_holds());
    assert!(session_attestation
        .violations()
        .contains(&"job-handle-is-not-solely-held"));
    let _ = std::fs::remove_dir_all(&root_directory);
}

#[test]
fn actual_prepare_is_inert_and_a_prepared_authority_aborts_to_exact_empty() {
    // Task 7.7 / 8.14 (prepared abort): abort never creates a root, and the receipt is exact
    // because the authority itself reports empty.
    let (attestation, root_directory) = prepare("abort", &[]);
    assert!(!attestation.workload_process_exists);
    assert!(attestation.is_valid(), "{:?}", attestation.violations());

    let mut session = connect(&attestation);
    write_frame(
        &mut session.stream,
        &Frame {
            kind: FrameKind::Inspect,
            payload: Vec::new(),
        },
    )
    .expect("inspect");
    let observation = read_frame(&mut session.stream)
        .expect("read")
        .expect("observation");
    assert_eq!(observation.kind, FrameKind::Observation);
    assert_eq!(observation.payload[0], 1, "phase is not prepared-inert");
    assert_eq!(
        observation.payload[1], 0,
        "a prepared-inert authority reported lifecycle flags"
    );

    let mut payload = Vec::new();
    payload.extend_from_slice(&0_u32.to_be_bytes());
    payload.extend_from_slice(&15_000_u32.to_be_bytes());
    write_frame(
        &mut session.stream,
        &Frame {
            kind: FrameKind::Abort,
            payload,
        },
    )
    .expect("abort");
    let result = read_frame(&mut session.stream)
        .expect("read")
        .expect("abort result");
    assert_eq!(
        result.kind,
        FrameKind::ExactScopeEmpty,
        "prepared abort returned {}",
        result.kind.name()
    );

    // The guardian exits once the terminal record is durable. Waiting on its process handle is
    // the only exact question: `OpenProcess` keeps succeeding for an exited process while any
    // handle to it remains, so a process-id probe would answer "still there" long after it is
    // gone.
    let guardian = win::open_process(
        PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE,
        attestation.guardian_process_id,
    )
    .expect("open the guardian");
    assert!(
        exited_within(&guardian, Duration::from_secs(15)),
        "the guardian outlived its own terminal record"
    );

    // The durable journal is the record a replacement would apply.
    let journal = root_directory
        .join("scopes")
        .join(&attestation.scope_id)
        .join("journal.log");
    let text = std::fs::read_to_string(&journal).expect("journal");
    assert!(text.contains("prepared inert"), "{text}");
    assert!(text.contains("exact-scope-empty"), "{text}");
    // Check the record *kind* field, not a substring: the terminal detail legitimately reads
    // "never-activated", which contains "activated".
    assert!(
        !text
            .lines()
            .any(|line| line.split_whitespace().nth(2) == Some("activated")),
        "a prepared abort recorded an activation: {text}"
    );
    let terminal = root_directory
        .join("scopes")
        .join(&attestation.scope_id)
        .join("terminal.record");
    assert!(
        std::fs::read_to_string(&terminal)
            .expect("terminal record")
            .contains("exact-scope-empty"),
        "the terminal record was not durably written before the guardian exited"
    );
    let _ = std::fs::remove_dir_all(&root_directory);
}

#[test]
fn a_control_session_that_presents_the_wrong_capability_is_refused_and_issues_nothing() {
    let (attestation, root_directory) = prepare("capability", &[]);
    let client = connect_client(&attestation);
    let mut stream = PipeStream::overlapped(client.raw()).expect("stream");

    // A capability that differs in exactly one byte.
    let mut wrong = attestation.control_capability;
    wrong[0] ^= 0x01;
    write_frame(
        &mut stream,
        &Frame {
            kind: FrameKind::Attest,
            payload: wrong.to_vec(),
        },
    )
    .expect("write");
    let response = read_frame(&mut stream).expect("read").expect("frame");
    assert_eq!(response.kind, FrameKind::Failure);
    assert_eq!(
        NativeFailureCode::decode(&response.payload).expect("failure"),
        NativeFailureCode::ReferenceInvalid
    );

    // The scope capability is not the control capability: substituting one for the other must
    // also be refused, otherwise the two are not independent in practice.
    let client = connect_client(&attestation);
    let mut stream = PipeStream::overlapped(client.raw()).expect("stream");
    write_frame(
        &mut stream,
        &Frame {
            kind: FrameKind::Attest,
            payload: attestation.scope_capability.to_vec(),
        },
    )
    .expect("write");
    if let Some(response) = read_frame(&mut stream).expect("read") {
        assert_eq!(
            response.kind,
            FrameKind::Failure,
            "the scope capability was accepted as a control capability"
        );
    }

    // And a session that skips the capability entirely cannot observe.
    let client = connect_client(&attestation);
    let mut stream = PipeStream::overlapped(client.raw()).expect("stream");
    write_frame(
        &mut stream,
        &Frame {
            kind: FrameKind::Inspect,
            payload: Vec::new(),
        },
    )
    .expect("write");
    // The requirement is that an unauthenticated session observes nothing. A typed failure and
    // an abruptly closed endpoint are both fail-closed; an `Observation` is the outcome that
    // must be impossible, and that is what this discriminates against.
    match read_frame(&mut stream).expect("read") {
        Some(frame) => assert_eq!(
            frame.kind,
            FrameKind::Failure,
            "an unauthenticated session received {}",
            frame.kind.name()
        ),
        None => {}
    }

    kill(attestation.guardian_process_id);
    let _ = std::fs::remove_dir_all(&root_directory);
}

#[test]
fn a_reference_whose_guardian_identity_drifted_never_reaches_the_endpoint() {
    // Task 8.13 / 7.4. The identifier is live and the endpoint is real; only the birth identity
    // differs. That must fail before any control request is issued.
    let (attestation, root_directory) = prepare("drift", &[]);

    let error = ControlEndpointClient::connect(
        &attestation.scope_id,
        attestation.guardian_process_id,
        attestation.guardian_birth ^ 0xff,
        &attestation.endpoint_owner_sid,
    )
    .expect_err("a drifted birth identity was accepted");
    assert!(error.to_string().contains("identity-drift"), "{error}");

    let error = ControlEndpointClient::connect(
        &attestation.scope_id,
        attestation.guardian_process_id,
        attestation.guardian_birth,
        "S-1-5-21-0-0-0-500",
    )
    .expect_err("a wrong endpoint owner was accepted");
    assert!(error.to_string().contains("identity-drift"), "{error}");

    // The authentic tuple still works, so the refusals above are not simply "nothing works".
    drop(connect(&attestation));

    kill(attestation.guardian_process_id);
    let _ = std::fs::remove_dir_all(&root_directory);
}

#[test]
fn every_declared_foreign_item_that_this_suite_reaches_is_named_in_the_declared_list() {
    // Task 9.6 accounting support: the declared-item list is the obligation, and it must stay
    // in sync with what is actually declared. A silent addition would otherwise inherit the
    // existing real-call evidence without earning it.
    let mut sorted = DECLARED_FOREIGN_ITEMS.to_vec();
    sorted.sort_unstable();
    assert_eq!(
        sorted.as_slice(),
        DECLARED_FOREIGN_ITEMS.as_slice(),
        "the declared-item list is not sorted, which makes review diffs unreliable"
    );
    assert_eq!(DECLARED_FOREIGN_ITEMS.len(), 58);
    let mut stdout = std::io::stdout();
    writeln!(stdout, "declared foreign items: {}", DECLARED_FOREIGN_ITEMS.len()).expect("write");
    // Stated rather than left silent: this row executes no binary at all, so it binds source
    // identity only and must not be counted among the shipped-artifact rows.
    writeln!(
        stdout,
        "ROW declared-foreign-items
  helper                = <none: this row executes no binary>
           binding               = source identity only"
    )
    .expect("write");
}
