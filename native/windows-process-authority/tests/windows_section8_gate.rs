//! The Section 8 rows the two existing kernel suites do not reach.
//!
//! `windows_authority_kernel.rs` and `windows_guardian_lifecycle.rs` between them cover 8.2,
//! 8.3, 8.4, 8.6, 8.7, 8.8, 8.9, 8.10, 8.11, the prepared-abort half of 8.14, and two of the
//! five 8.13 drift cases. This file exists for the remainder:
//!
//! * **8.5** — four descendant creation shapes (detached, new console, new process group,
//!   double-forked) surviving their parents, each still a member, all reached by
//!   authority-wide force.
//! * **8.12** — controller replacement driven by **separate real helper processes**: the
//!   controller that activated the workload is killed, and a fresh process authenticates,
//!   rereads the tuple, inspects and terminates the same authority.
//! * **8.13** — the three drift cases the existing suite does not take, plus its two, all
//!   against live authorities on the real kernel.
//! * **8.16** — the proxied-creation boundary through a pre-existing out-of-authority service.
//!
//! This file is **new**, so the two test-file digests recorded in the Windows freeze marker
//! remain exactly true; neither existing test file is modified. `tests/` is outside
//! `sourceDigest()`'s input set, so nothing here can move the crate source digest.
//!
//! ## Gated entry points (accounting, per `F-L2-07`)
//!
//! `s8_fixture_entrypoint` is a **gated** test: it early-returns unless `RWPA_S8_FIXTURE` is
//! set and asserts nothing at top level. It exists so this test binary can be re-executed as a
//! workload *inside* the authority, which is the only way a Job member can create descendants
//! with specific creation flags or reach an out-of-authority service. Exclude it from any
//! asserting-test count. A set-but-unrecognised role panics rather than exiting quietly.
//!
//! Every other test in this file asserts.

#![cfg(windows)]

use std::collections::BTreeMap;
use std::fs::File;
use std::io::Write;
use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use rasen_windows_process_authority::activation::{
    self, ActivationMutations, RootStdio, TerminationOutcome,
};
use rasen_windows_process_authority::attestation::PrepareAttestation;
use rasen_windows_process_authority::boot;
use rasen_windows_process_authority::endpoint::ControlEndpointClient;
use rasen_windows_process_authority::job::{JobAuthority, JobMutations, EXPECTED_LIMIT_MASK};
use rasen_windows_process_authority::launch::LaunchSnapshot;
use rasen_windows_process_authority::sha256;
use rasen_windows_process_authority::sys::*;
use rasen_windows_process_authority::win::{self, OwnedHandle};

const COMSPEC: &str = "C:\\Windows\\System32\\cmd.exe";
const PING: &str = "C:\\Windows\\System32\\PING.EXE";
const POWERSHELL: &str = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";

// ---------------------------------------------------------------------------------------------
// Shipped-artifact identity: the same discipline as windows_guardian_lifecycle.rs
// ---------------------------------------------------------------------------------------------

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

/// Self-describing receipt for a row that executes a binary. The equality is a real oracle: it
/// compares the hash the test took of the file it invoked against the hash the helper took of
/// its own executable at prepare.
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
         executedSha256        = {executed}\n  selfMeasuredArtifact  = {}\n  \
         sourceSha256          = {source_digest}",
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

/// Stated rather than left implicit for a row that runs entirely in-process.
fn record_in_process_row(row: &str) {
    println!(
        "ROW {row}\n  helper                = <none: this row executes no binary>\n  \
         binding               = source identity only"
    );
}

// ---------------------------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------------------------

fn scratch(tag: &str) -> PathBuf {
    let mut base = std::env::temp_dir();
    base.push(format!("rasen-wpa-s8-{tag}-{}", win::current_process_id()));
    let _ = std::fs::remove_dir_all(&base);
    std::fs::create_dir_all(&base).expect("scratch");
    base
}

fn environment() -> BTreeMap<String, String> {
    let mut environment = BTreeMap::new();
    environment.insert("SystemRoot".to_owned(), "C:\\Windows".to_owned());
    environment.insert(
        "PATH".to_owned(),
        "C:\\Windows\\System32;C:\\Windows".to_owned(),
    );
    environment
}

/// This test binary, re-executed as a workload inside the authority.
fn fixture(role: &str, scratch_directory: &PathBuf) -> LaunchSnapshot {
    let mut environment = environment();
    environment.insert("RWPA_S8_FIXTURE".to_owned(), role.to_owned());
    environment.insert(
        "RWPA_S8_SCRATCH".to_owned(),
        scratch_directory.to_string_lossy().into_owned(),
    );
    LaunchSnapshot {
        executable: std::env::current_exe()
            .expect("test binary")
            .to_string_lossy()
            .into_owned(),
        working_directory: "C:\\Windows".to_owned(),
        // `--nocapture` matters: libtest captures `println!`, so without it the fixture runs
        // correctly inside the authority and reports nothing at all.
        arguments: vec![
            "s8_fixture_entrypoint".to_owned(),
            "--exact".to_owned(),
            "--nocapture".to_owned(),
            "--test-threads".to_owned(),
            "1".to_owned(),
        ],
        environment,
        verbatim_arguments: false,
    }
}

struct Streams {
    stdio: Option<RootStdio>,
    stdout_read: OwnedHandle,
    _stdin_write: OwnedHandle,
    _stderr_read: OwnedHandle,
}

impl Streams {
    fn new() -> Self {
        let (stdin_read, stdin_write) = win::create_anonymous_pipe(true).expect("stdin pipe");
        let (stdout_read, stdout_write) = win::create_anonymous_pipe(false).expect("stdout pipe");
        let (stderr_read, stderr_write) = win::create_anonymous_pipe(false).expect("stderr pipe");
        Self {
            stdio: Some(RootStdio {
                stdin_read,
                stdout_write,
                stderr_write,
            }),
            stdout_read,
            _stdin_write: stdin_write,
            _stderr_read: stderr_read,
        }
    }

    fn stdio(&self) -> &RootStdio {
        self.stdio.as_ref().expect("stdio")
    }

    fn release_child_ends(&mut self) {
        self.stdio = None;
    }

    /// Read until `needle` appears rather than until end-of-file.
    ///
    /// End-of-file is **not** available here, and finding that out cost a full debugging pass.
    /// `Command::spawn` creates its children with `bInheritHandles = TRUE` and no explicit
    /// handle list, so every long-lived descendant the fixture creates inherits the fixture's
    /// own inheritable stdout handle and holds this pipe open for its whole 90-second lifetime.
    /// A reader that waited for end-of-file would therefore return only *after* every
    /// descendant had died, and every liveness assertion downstream would be asking about
    /// processes that no longer existed. That is exactly the shape of a row that looks green
    /// and measures nothing.
    fn read_until(&self, needle: &str) -> String {
        let mut collected = Vec::new();
        let mut buffer = [0_u8; 4096];
        loop {
            match win::read_handle(self.stdout_read.raw(), &mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(count) => {
                    collected.extend_from_slice(&buffer[..count]);
                    if String::from_utf8_lossy(&collected).contains(needle) {
                        break;
                    }
                }
            }
        }
        String::from_utf8_lossy(&collected).into_owned()
    }
}

/// Parse `key=<u32>` out of a fixture report.
fn field(text: &str, key: &str) -> Option<u32> {
    text.split_whitespace()
        .find_map(|token| token.strip_prefix(key))
        .and_then(|value| value.trim().parse().ok())
}

fn deadline(seconds: u64) -> Instant {
    Instant::now() + Duration::from_secs(seconds)
}

/// Open a live process and keep the handle, so "did it die" stays an exact question after the
/// identifier could have been reused.
fn hold(process_id: u32) -> Option<OwnedHandle> {
    win::open_process(PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE, process_id).ok()
}

fn exited_within(handle: &OwnedHandle, window: Duration) -> bool {
    unsafe { WaitForSingleObject(handle.raw(), window.as_millis() as Dword) == WAIT_OBJECT_0 }
}

fn is_member(job: &JobAuthority, handle: &OwnedHandle) -> bool {
    job.contains(handle.raw()).expect("IsProcessInJob")
}

fn run_fixture_in(job: &JobAuthority, role: &str, directory: &PathBuf, needle: &str) -> String {
    run_fixture_with(job, role, directory, needle, ActivationMutations::default())
}

/// Run the fixture, read its report while it is still alive, then wait for it to exit. The
/// report must be read before end-of-file (see [`Streams::read_until`]), and the root must be
/// confirmed exited before any "the descendants outlived their parent" claim is made.
fn run_fixture_with(
    job: &JobAuthority,
    role: &str,
    directory: &PathBuf,
    needle: &str,
    mutations: ActivationMutations,
) -> String {
    let mut streams = Streams::new();
    let mut root =
        activation::create_root_suspended(job, &fixture(role, directory), streams.stdio(), mutations)
            .expect("create fixture root");
    root.resume().expect("resume");
    streams.release_child_ends();
    let report = streams.read_until(needle);
    assert!(
        activation::wait_then_read_exit_status(root.process.raw(), 60_000)
            .expect("wait")
            .is_some(),
        "the fixture root never exited, so its descendants have not outlived their parent"
    );
    report
}

// ---------------------------------------------------------------------------------------------
// Real helper processes
// ---------------------------------------------------------------------------------------------

fn unhex(value: &str) -> Vec<u8> {
    (0..value.len() / 2)
        .map(|index| u8::from_str_radix(&value[index * 2..index * 2 + 2], 16).expect("hex"))
        .collect()
}

fn state_root(tag: &str) -> PathBuf {
    let mut base = std::env::temp_dir();
    base.push(format!("rasen-wpa-s8root-{tag}-{}", win::current_process_id()));
    let _ = std::fs::remove_dir_all(&base);
    std::fs::create_dir_all(&base).expect("state root");
    base
}

/// Run the production `prepare` verb in its own process and decode the attestation it emits.
fn prepare(tag: &str, workload: &str) -> (PrepareAttestation, PathBuf) {
    let root = state_root(tag);
    let output = Command::new(helper_path())
        .arg("prepare")
        .args(["--operation", &format!("s8-{tag}")])
        .args(["--state-root", &root.to_string_lossy()])
        .args(["--executable", COMSPEC])
        .args(["--cwd", "C:\\Windows"])
        .args(["--arg", "/c"])
        .args(["--arg", workload])
        .args(["--env", "SystemRoot=C:\\Windows"])
        .args(["--env", "PATH=C:\\Windows\\System32;C:\\Windows"])
        .output()
        .expect("prepare");
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

struct Reference {
    scope: String,
    guardian_pid: String,
    guardian_birth: String,
    owner: String,
    capability: String,
    sole_handle_token: String,
    state_root: String,
}

impl Reference {
    fn of(attestation: &PrepareAttestation, root: &PathBuf) -> Self {
        Self {
            scope: attestation.scope_id.clone(),
            guardian_pid: attestation.guardian_process_id.to_string(),
            guardian_birth: attestation.guardian_birth.to_string(),
            owner: attestation.endpoint_owner_sid.clone(),
            capability: sha256::hex(&attestation.control_capability),
            sole_handle_token: sha256::hex(&attestation.sole_handle_token),
            state_root: root.to_string_lossy().into_owned(),
        }
    }

    fn control(&self, verb: &str, deadline_ms: &str) -> Vec<String> {
        vec![
            "control".to_owned(),
            "--verb".to_owned(),
            verb.to_owned(),
            "--scope".to_owned(),
            self.scope.clone(),
            "--guardian-pid".to_owned(),
            self.guardian_pid.clone(),
            "--guardian-birth".to_owned(),
            self.guardian_birth.clone(),
            "--owner-sid".to_owned(),
            self.owner.clone(),
            "--capability".to_owned(),
            self.capability.clone(),
            "--deadline-ms".to_owned(),
            deadline_ms.to_owned(),
        ]
    }

    fn probe(&self, stage: &str) -> Vec<String> {
        vec![
            "probe-identity".to_owned(),
            "--stage".to_owned(),
            stage.to_owned(),
            "--scope".to_owned(),
            self.scope.clone(),
            "--guardian-pid".to_owned(),
            self.guardian_pid.clone(),
            "--guardian-birth".to_owned(),
            self.guardian_birth.clone(),
            "--owner-sid".to_owned(),
            self.owner.clone(),
            "--sole-handle-token".to_owned(),
            self.sole_handle_token.clone(),
            "--state-root".to_owned(),
            self.state_root.clone(),
        ]
    }
}

#[derive(Debug)]
struct HelperRun {
    ok: bool,
    stdout: String,
    stderr: String,
}

fn run_helper(arguments: &[String]) -> HelperRun {
    let output = Command::new(helper_path())
        .args(arguments)
        .stdin(Stdio::null())
        .output()
        .expect("helper");
    HelperRun {
        ok: output.status.success(),
        stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
    }
}

/// The endpoint serves one session at a time, so a fresh controller arriving immediately after
/// the previous one died can land on `ERROR_PIPE_BUSY` before the guardian has re-armed
/// `ConnectNamedPipe`. That is a real retained failure of the product, so the retry lives here
/// in the harness rather than being hidden inside the helper.
fn run_helper_retrying(arguments: &[String]) -> HelperRun {
    let until = Instant::now() + Duration::from_secs(15);
    loop {
        let run = run_helper(arguments);
        if run.ok || Instant::now() >= until {
            return run;
        }
        if !run.stderr.contains("os error 231") {
            return run;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

/// The endpoint is a single-instance pipe, so a connect attempt that reached it and was then
/// rejected leaves the guardian re-arming `ConnectNamedPipe`. The next attempt can therefore
/// land on `ERROR_PIPE_BUSY`, which is `WouldBlock` and is **not** a drift verdict. Retrying on
/// exactly that kind — and on nothing else — keeps each mutation's classification exact.
fn connect_expecting_refusal(
    scope: &str,
    guardian_process_id: u32,
    guardian_birth: u64,
    owner: &str,
) -> std::io::Error {
    let until = Instant::now() + Duration::from_secs(15);
    loop {
        match ControlEndpointClient::connect(scope, guardian_process_id, guardian_birth, owner) {
            Ok(_) => panic!("a mutated reference was accepted"),
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                assert!(Instant::now() < until, "endpoint stayed busy: {error}");
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(error) => return error,
        }
    }
}

fn connect_expecting_success(
    scope: &str,
    guardian_process_id: u32,
    guardian_birth: u64,
    owner: &str,
) -> ControlEndpointClient {
    let until = Instant::now() + Duration::from_secs(15);
    loop {
        match ControlEndpointClient::connect(scope, guardian_process_id, guardian_birth, owner) {
            Ok(client) => return client,
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                assert!(Instant::now() < until, "endpoint stayed busy: {error}");
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(error) => panic!("the authentic reference was refused: {error}"),
        }
    }
}

fn kill(process_id: u32) {
    if let Ok(handle) = win::open_process(PROCESS_TERMINATE | SYNCHRONIZE, process_id) {
        unsafe { TerminateProcess(handle.raw(), 1) };
        unsafe { WaitForSingleObject(handle.raw(), 10_000) };
    }
}

// ---------------------------------------------------------------------------------------------
// 8.5 descendants of four creation shapes
// ---------------------------------------------------------------------------------------------

struct Descendants {
    detached: u32,
    new_console: u32,
    new_group: u32,
    middle: u32,
    grandchild: u32,
}

fn parse_descendants(report: &str) -> Descendants {
    Descendants {
        detached: field(report, "detached=").unwrap_or_else(|| panic!("detached: {report}")),
        new_console: field(report, "newconsole=").unwrap_or_else(|| panic!("newconsole: {report}")),
        new_group: field(report, "newgroup=").unwrap_or_else(|| panic!("newgroup: {report}")),
        middle: field(report, "middle=").unwrap_or_else(|| panic!("middle: {report}")),
        grandchild: field(report, "grandchild=").unwrap_or_else(|| panic!("grandchild: {report}")),
    }
}

#[test]
fn actual_detached_new_console_new_group_and_double_forked_descendants_stay_members() {
    // Task 8.5. Four creation shapes that each break a different naive containment assumption:
    // no console, its own console, its own process group, and a grandchild whose creator is
    // already gone. All four outlive the root, all four must still be members, and all four
    // must be reached by authority-wide force with no descendant identifier passed to the
    // product.
    record_in_process_row("descendants-survive-and-stay-members");
    let directory = scratch("descendants");
    let job = JobAuthority::create().expect("job");
    let report = run_fixture_in(&job, "descendants", &directory, "grandchild=");
    println!("descendants report: {}", report.trim());
    let ids = parse_descendants(&report);

    // Handles taken while the processes are definitely alive, so the death check below cannot
    // be fooled by identifier reuse.
    let detached = hold(ids.detached).expect("detached descendant");
    let new_console = hold(ids.new_console).expect("new-console descendant");
    let new_group = hold(ids.new_group).expect("new-process-group descendant");
    let grandchild = hold(ids.grandchild).expect("double-forked grandchild");
    let middle = hold(ids.middle);

    for (name, handle) in [
        ("detached", &detached),
        ("new-console", &new_console),
        ("new-process-group", &new_group),
        ("double-forked", &grandchild),
    ] {
        assert!(
            !exited_within(handle, Duration::from_millis(0)),
            "the {name} descendant did not outlive the root"
        );
        assert!(
            is_member(&job, handle),
            "the {name} descendant left the authority"
        );
    }

    // The double fork is only a double fork if its creator is gone. Otherwise this row would be
    // testing an ordinary grandchild.
    if let Some(middle) = &middle {
        assert!(
            exited_within(middle, Duration::from_secs(20)),
            "the middle process of the double fork never exited, so the grandchild was never \
             orphaned and this row would not be testing a double fork at all"
        );
    }

    // The authority cannot be empty while any of them lives.
    assert!(
        job.accounting().expect("accounting").active_processes > 0,
        "the authority reported no active members while four descendants were live"
    );

    // Authority-wide force. No descendant identifier is supplied to the product: the only
    // argument is the exit status.
    let outcome = activation::terminate_until_empty(&job, 137, deadline(30)).expect("terminate");
    assert!(
        matches!(outcome, TerminationOutcome::ExactEmpty { .. }),
        "authority-wide termination did not converge: {outcome:?}"
    );
    for (name, handle) in [
        ("detached", &detached),
        ("new-console", &new_console),
        ("new-process-group", &new_group),
        ("double-forked", &grandchild),
    ] {
        assert!(
            exited_within(handle, Duration::from_secs(10)),
            "the {name} descendant survived authority-wide termination"
        );
    }
    assert_eq!(job.accounting().expect("accounting").active_processes, 0);
    let _ = std::fs::remove_dir_all(&directory);
}

#[test]
fn red_descendants_of_a_root_created_outside_the_authority_are_not_members() {
    // RED counterpart for 8.5. Without it the GREEN above does not distinguish "descendants of
    // every shape are contained" from "`IsProcessInJob` says yes to everything". Omitting
    // `PROC_THREAD_ATTRIBUTE_JOB_LIST` puts the identical fixture, creating the identical four
    // descendants, outside the authority — and the authority then reports itself EMPTY while
    // all four are alive.
    record_in_process_row("descendants-red-outside-the-authority");
    let directory = scratch("descendants-red");
    let job = JobAuthority::create().expect("job");
    let report = run_fixture_with(
        &job,
        "descendants",
        &directory,
        "grandchild=",
        ActivationMutations {
            omit_job_list: true,
            ..ActivationMutations::default()
        },
    );
    println!("descendants RED report: {}", report.trim());
    let ids = parse_descendants(&report);

    let held: Vec<(&str, OwnedHandle)> = [
        ("detached", ids.detached),
        ("new-console", ids.new_console),
        ("new-process-group", ids.new_group),
        ("double-forked", ids.grandchild),
    ]
    .into_iter()
    .filter_map(|(name, id)| hold(id).map(|handle| (name, handle)))
    .collect();
    assert_eq!(held.len(), 4, "not every RED descendant was still alive");

    for (name, handle) in &held {
        assert!(
            !is_member(&job, handle),
            "the RED did not reproduce: the {name} descendant of a root outside the authority \
             was still reported as a member"
        );
    }
    assert_eq!(
        job.accounting().expect("accounting").active_processes,
        0,
        "the authority counted members it does not own"
    );

    // What the authority does here is worth recording exactly, because the obvious guess is
    // wrong. A Job that never had a member cannot emit `ACTIVE_PROCESS_ZERO` — the transition
    // never happens — so this authority does **not** report a false exact-empty. It retains
    // `timeout`, which is the correct fail-closed answer. The RED's content is therefore the
    // membership answers above and the accounting below, not a fabricated empty receipt.
    let outcome = activation::terminate_until_empty(&job, 137, deadline(10)).expect("terminate");
    assert!(
        matches!(outcome, TerminationOutcome::Timeout { .. }),
        "an authority that never had a member reported {outcome:?} rather than retaining timeout"
    );
    for (name, handle) in &held {
        assert!(
            !exited_within(handle, Duration::from_millis(500)),
            "the {name} descendant died anyway, so the RED proves nothing: authority-wide force \
             reached a process the authority does not own"
        );
    }

    // Clean up the processes this RED deliberately orphaned.
    for id in [
        ids.detached,
        ids.new_console,
        ids.new_group,
        ids.grandchild,
        ids.middle,
    ] {
        kill(id);
    }
    let _ = std::fs::remove_dir_all(&directory);
}

// ---------------------------------------------------------------------------------------------
// 8.12 controller replacement, driven by separate real helper processes
// ---------------------------------------------------------------------------------------------

#[test]
fn actual_controller_replacement_authenticates_rereads_inspects_and_terminates() {
    // Task 8.12. Controller A activates the workload and is then killed outright. Every
    // subsequent step is a **separate fresh process** running production code: identity probe
    // at both stages, inspect, and terminate. Nothing in this test opens the endpoint itself.
    let directory = scratch("replacement");
    let (attestation, root_directory) = prepare("replacement", "ping -n 90 127.0.0.1 > nul");
    let reference = Reference::of(&attestation, &root_directory);

    let out = File::create(directory.join("controller-a.out")).expect("out");
    let err_path = directory.join("controller-a.err");
    let err = File::create(&err_path).expect("err");
    let mut controller_a = Command::new(helper_path())
        .args(reference.control("run", "180000"))
        .stdin(Stdio::null())
        .stdout(Stdio::from(out))
        .stderr(Stdio::from(err))
        .spawn()
        .expect("controller A");

    let until = Instant::now() + Duration::from_secs(30);
    let mut root_id = None;
    while Instant::now() < until && root_id.is_none() {
        let text = std::fs::read_to_string(&err_path).unwrap_or_default();
        root_id = field(&text, "root=");
        if root_id.is_none() {
            std::thread::sleep(Duration::from_millis(50));
        }
    }
    let root_id = root_id.unwrap_or_else(|| {
        panic!(
            "controller A never activated: {}",
            std::fs::read_to_string(&err_path).unwrap_or_default()
        )
    });
    let root = hold(root_id).expect("activated root");

    // The controller stack dies. The authority is the guardian, not the controller, so the
    // workload must survive.
    let _ = controller_a.kill();
    let _ = controller_a.wait();
    assert!(
        !exited_within(&root, Duration::from_millis(500)),
        "the workload root died with its controller; there is no authority to replace"
    );

    // RED first, so the GREEN below is not "anything that connects wins". A replacement whose
    // guardian birth identity is wrong must be refused, and must leave the authority intact.
    let mut drifted = reference.control("terminate", "20000");
    let birth_index = drifted
        .iter()
        .position(|value| value == "--guardian-birth")
        .expect("--guardian-birth");
    drifted[birth_index + 1] = (attestation.guardian_birth ^ 0xff).to_string();
    let refused = run_helper(&drifted);
    assert!(!refused.ok, "a drifted replacement was accepted: {refused:?}");
    assert!(
        refused.stderr.contains("identity-drift"),
        "wrong refusal reason: {}",
        refused.stderr
    );
    assert!(
        !exited_within(&root, Duration::from_millis(500)),
        "a refused replacement still terminated the authority"
    );

    // And a replacement holding the right identity but the wrong capability observes nothing.
    let mut wrong_capability = reference.control("inspect", "20000");
    let capability_index = wrong_capability
        .iter()
        .position(|value| value == "--capability")
        .expect("--capability");
    let mut bytes = attestation.control_capability;
    bytes[0] ^= 0x01;
    wrong_capability[capability_index + 1] = sha256::hex(&bytes);
    let refused = run_helper_retrying(&wrong_capability);
    assert!(
        !refused.ok,
        "a replacement with the wrong capability was accepted: {refused:?}"
    );
    assert!(
        !exited_within(&root, Duration::from_millis(500)),
        "a refused capability still destroyed the authority"
    );

    // GREEN: the replacement sequence, one fresh process per step.
    let pre_open = run_helper(&reference.probe("pre-open"));
    assert!(pre_open.ok, "pre-open probe failed: {}", pre_open.stderr);
    println!("probe pre-open: {}", pre_open.stdout.trim());
    assert!(
        pre_open.stdout.contains("state=authority-present"),
        "{}",
        pre_open.stdout
    );
    assert!(
        pre_open.stdout.contains("endpointPresent=true"),
        "{}",
        pre_open.stdout
    );

    let post_open = run_helper_retrying(&reference.probe("post-open"));
    assert!(post_open.ok, "post-open probe failed: {}", post_open.stderr);
    println!("probe post-open: {}", post_open.stdout.trim());
    assert!(
        post_open.stdout.contains("state=authority-present"),
        "{}",
        post_open.stdout
    );
    assert!(
        post_open
            .stdout
            .contains("endpointAuthentication=authenticated"),
        "{}",
        post_open.stdout
    );
    // The reread names the same guardian as the reference, and it names it by asking the
    // endpoint through the handles it has already opened.
    assert!(
        post_open.stdout.contains(&format!(
            "endpointServerProcessId={}",
            attestation.guardian_process_id
        )),
        "the replacement authenticated an endpoint served by a different process: {}",
        post_open.stdout
    );
    assert!(
        post_open.stdout.contains(&format!(
            "guardianCreationTime={}",
            attestation.guardian_birth
        )),
        "{}",
        post_open.stdout
    );

    let inspect = run_helper_retrying(&reference.control("inspect", "20000"));
    assert!(inspect.ok, "replacement inspect failed: {}", inspect.stderr);
    let observation = inspect
        .stdout
        .lines()
        .find_map(|line| line.strip_prefix("RWA1-OBSERVATION "))
        .unwrap_or_else(|| panic!("no observation: {}", inspect.stdout));
    let decoded = unhex(observation.trim());
    println!("replacement inspect phase={} raw={observation}", decoded[0]);
    assert_ne!(
        decoded[0], 1,
        "a live authority was inspected as prepared-inert by its replacement controller"
    );

    // Terminate. **This is where the row stops being clean, and the defect is recorded rather
    // than engineered around.**
    //
    // `cli.rs:643` reads exactly one frame after writing `Terminate` and rejects anything that
    // is not `ExactScopeEmpty` or `Failure`. Terminating a *live* authority necessarily kills
    // the root first, so the guardian emits `RootExited` before `ExactScopeEmpty` and the
    // control verb fails with `unexpected frame root-exited` — on a termination that actually
    // converged. `run_workload` drains in a loop; `abort`/`terminate` do not. The prepared-abort
    // path in `windows_guardian_lifecycle.rs` never sees this because it has no root to kill.
    //
    // Consequence: a replacement controller's `terminate` against a live authority always
    // returns an error, so the caller retains uncertainty for an authority that is in fact
    // empty. **Fixed** in the post-freeze wave: `cli.rs` now drains frames in a loop. It is
    // reported as a finding, not fixed here.
    //
    // **Rewritten under task 9.9.** This assertion previously asserted the *defect* -- that the
    // verb fails with `unexpected frame root-exited`. That is a restatement of observed
    // behaviour, it states nothing the contract requires, and it was measured to be unstable:
    // over 7 runs of this row on the identical packaged helper, identical crate source and an
    // identical test file, the defect reproduced **once**. The old assertion was therefore red
    // six times in seven, for a product that was behaving *better* than the assertion demanded.
    //
    // What the contract requires (`design.md` Decision 8, and the Record-must-not-lie
    // invariant): terminate drives the authority to its own `ACTIVE_PROCESS_ZERO` and returns
    // that receipt; deadline expiry returns typed `timeout` with the authority retained. An
    // ad-hoc `unexpected frame <name>` is neither, and it is returned for a termination that
    // actually converged -- so the caller retains uncertainty about an authority that is empty.
    //
    // This is `S9-F1`. The underlying race is that `guardian.rs:673 deliver_root_exit`
    // broadcasts on the shared session writer while `guardian.rs:1218` sends `ExactScopeEmpty`
    // on the same writer, and `cli.rs:643` reads exactly one frame.
    let terminate = run_helper_retrying(&reference.control("terminate", "30000"));
    assert!(
        terminate.ok && terminate.stdout.contains("RWA1-OBSERVATION "),
        "terminate did not return the authority's own exact-empty receipt. If this says \
         `unexpected frame root-exited`, S9-F1 has reproduced: the authority converged and the \
         receipt was lost to a frame race. stdout={} stderr={}",
        terminate.stdout,
        terminate.stderr
    );
    assert!(
        exited_within(&root, Duration::from_secs(20)),
        "the replacement controller's terminate neither reported nor achieved convergence: the \
         root is still alive"
    );

    let _ = std::fs::remove_dir_all(&root_directory);
    let _ = std::fs::remove_dir_all(&directory);
}

// ---------------------------------------------------------------------------------------------
// 8.13 identity-drift mutations on the real kernel
// ---------------------------------------------------------------------------------------------

#[test]
fn actual_identity_drift_mutations_are_refused_before_any_control_is_issued() {
    // Task 8.13. Two live authorities exist for the whole test, so every refusal below is a
    // refusal against a *real, reachable, correctly serving* endpoint rather than against
    // something that was never there.
    let (a, a_root) = prepare("drift-a", "ping -n 90 127.0.0.1 > nul");
    let (b, b_root) = prepare("drift-b", "ping -n 90 127.0.0.1 > nul");
    assert_ne!(
        a.guardian_process_id, b.guardian_process_id,
        "the two authorities share a guardian, so nothing below discriminates"
    );
    assert_ne!(
        a.guardian_birth, b.guardian_birth,
        "the two guardians report the same birth identity"
    );
    let a_guardian = hold(a.guardian_process_id).expect("guardian A");
    let b_guardian = hold(b.guardian_process_id).expect("guardian B");

    // An unrelated live process, outside both authorities, to check that nothing destructive
    // leaks onto a bystander.
    let mut bystander = Command::new(PING)
        .args(["-n", "90", "127.0.0.1"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .expect("bystander");
    let bystander_handle = hold(bystander.id()).expect("bystander handle");

    // (1) The guardian identifier is live but occupied by a process with a different birth
    //     identity. This is the pid-reuse shape: the number resolves, the identity does not.
    let error = connect_expecting_refusal(
        &a.scope_id,
        b.guardian_process_id,
        a.guardian_birth,
        &a.endpoint_owner_sid,
    );
    println!("drift reused-identifier: {error}");
    assert!(
        error.to_string().contains("identity-drift"),
        "wrong classification: {error}"
    );

    // (2) The same shape stated the other way: the authentic guardian, a corrupted birth.
    let error = connect_expecting_refusal(
        &a.scope_id,
        a.guardian_process_id,
        a.guardian_birth ^ 0xff,
        &a.endpoint_owner_sid,
    );
    println!("drift birth-identity: {error}");
    assert!(error.to_string().contains("identity-drift"), "{error}");

    // (3) The endpoint is served by a different process: authority A's endpoint, authority B's
    //     complete and entirely authentic guardian identity. Both halves are real and live, so
    //     only the *binding between them* is wrong.
    let error = connect_expecting_refusal(
        &a.scope_id,
        b.guardian_process_id,
        b.guardian_birth,
        &b.endpoint_owner_sid,
    );
    println!("drift endpoint-server: {error}");
    assert!(
        error
            .to_string()
            .contains("the endpoint is served by a different process"),
        "wrong classification: {error}"
    );

    // (4) Wrong endpoint owner.
    let error = connect_expecting_refusal(
        &a.scope_id,
        a.guardian_process_id,
        a.guardian_birth,
        "S-1-5-21-0-0-0-500",
    );
    println!("drift endpoint-owner: {error}");
    assert!(
        error
            .to_string()
            .contains("the endpoint owner differs from the reference"),
        "wrong classification: {error}"
    );

    // GREEN: the authentic tuples still connect, so the four refusals above are discriminating
    // rather than "the endpoint refuses everyone".
    drop(connect_expecting_success(
        &a.scope_id,
        a.guardian_process_id,
        a.guardian_birth,
        &a.endpoint_owner_sid,
    ));
    drop(connect_expecting_success(
        &b.scope_id,
        b.guardian_process_id,
        b.guardian_birth,
        &b.endpoint_owner_sid,
    ));

    // No destructive operation reached a replacement or an unrelated process.
    assert!(
        !exited_within(&a_guardian, Duration::from_millis(0)),
        "guardian A died during the drift mutations"
    );
    assert!(
        !exited_within(&b_guardian, Duration::from_millis(0)),
        "guardian B died during the drift mutations"
    );
    assert!(
        !exited_within(&bystander_handle, Duration::from_millis(0)),
        "an unrelated process died during the drift mutations"
    );

    // (5) The tuple changes between the pre-open read and the post-open read. Both reads are
    //     performed by **separate production processes**; the authority is destroyed between
    //     them, which is exactly the window the post-open reread exists to close.
    let reference = Reference::of(&a, &a_root);
    let pre_open = run_helper(&reference.probe("pre-open"));
    println!("tuple-change pre-open: {}", pre_open.stdout.trim());
    assert!(
        pre_open.stdout.contains("state=authority-present"),
        "{}",
        pre_open.stdout
    );

    kill(a.guardian_process_id);
    assert!(
        exited_within(&a_guardian, Duration::from_secs(10)),
        "guardian A did not die"
    );

    // Two post-open reads, because the difference between them is real and is not obvious.
    //
    // (5a) While **any** handle to the terminated guardian remains open, the process object
    //      survives as a zombie: the identifier still resolves and still reports its original
    //      creation time, so the pre-open identity check passes and the failure surfaces one
    //      step later, at the endpoint, as `control-loss`. That is fail-closed and correct, but
    //      it is a different classification from the one the reference's absence would suggest,
    //      and a reviewer who assumed `authority-absent` here would be wrong.
    let zombie = run_helper(&reference.probe("post-open"));
    println!("tuple-change post-open (handle retained): {}", zombie.stdout.trim());
    assert!(
        zombie.stdout.contains("state=control-loss"),
        "a retained handle to a dead guardian produced {} rather than control-loss",
        zombie.stdout
    );
    assert!(
        !zombie.stdout.contains("endpointAuthentication=authenticated"),
        "a dead authority was still authenticated: {}",
        zombie.stdout
    );

    // (5b) Release the last handle and the identity behind the reference is genuinely gone.
    drop(a_guardian);
    let post_open = run_helper(&reference.probe("post-open"));
    println!("tuple-change post-open (handle released): {}", post_open.stdout.trim());
    assert!(
        post_open.stdout.contains("state=authority-absent"),
        "the post-open read did not notice that the identity behind the reference changed: {}",
        post_open.stdout
    );
    assert!(
        !post_open.stdout.contains("endpointAuthentication=authenticated"),
        "an authority whose identity changed was still authenticated: {}",
        post_open.stdout
    );

    // Authority B is untouched by everything done to A.
    assert!(
        !exited_within(&b_guardian, Duration::from_millis(0)),
        "destroying authority A reached authority B"
    );
    assert!(
        !exited_within(&bystander_handle, Duration::from_millis(0)),
        "destroying authority A reached an unrelated process"
    );

    kill(b.guardian_process_id);
    let _ = bystander.kill();
    let _ = bystander.wait();
    let _ = std::fs::remove_dir_all(&a_root);
    let _ = std::fs::remove_dir_all(&b_root);
}

// ---------------------------------------------------------------------------------------------
// 8.16 the proxied-creation boundary
// ---------------------------------------------------------------------------------------------

#[test]
fn actual_proxied_creation_leaves_the_authority_and_is_neither_claimed_nor_counted() {
    // Task 8.16. A member asks a pre-existing out-of-authority service — the WMI provider host,
    // which was running before this authority existed — to create a process. The created
    // process is demonstrably outside the authority, and the authority's exact-empty receipt
    // stays exact **for its actual members**.
    //
    // The direct descendant created in the same fixture run is what makes the negative
    // assertion mean something: it proves the membership question can still answer "yes".
    record_in_process_row("proxied-creation-boundary");
    let directory = scratch("proxy");
    let job = JobAuthority::create().expect("job");
    let report = run_fixture_in(&job, "proxy", &directory, "direct=");
    println!("proxy report: {}", report.trim());
    assert!(
        report.contains("proxy rc=0"),
        "the out-of-authority service refused the creation request, so this row measured \
         nothing: {report}"
    );
    let proxied = field(&report, "pid=").unwrap_or_else(|| panic!("no proxied pid: {report}"));
    let direct = field(&report, "direct=").unwrap_or_else(|| panic!("no direct pid: {report}"));

    let proxied_handle = hold(proxied).expect("the proxied process is not alive");
    let direct_handle = hold(direct).expect("the direct descendant is not alive");
    assert!(
        !exited_within(&proxied_handle, Duration::from_millis(0)),
        "the proxied process exited before it could be classified"
    );

    // The discriminating pair, asked of the same authority, in the same run.
    assert!(
        is_member(&job, &direct_handle),
        "the direct descendant is not a member, so the negative result below proves nothing"
    );
    assert!(
        !is_member(&job, &proxied_handle),
        "the proxied process was claimed as a member of the authority"
    );

    let outcome = activation::terminate_until_empty(&job, 137, deadline(30)).expect("terminate");
    assert!(
        matches!(outcome, TerminationOutcome::ExactEmpty { .. }),
        "termination of the actual members did not converge: {outcome:?}"
    );
    assert_eq!(job.accounting().expect("accounting").active_processes, 0);
    assert!(
        exited_within(&direct_handle, Duration::from_secs(10)),
        "authority-wide force did not reach the direct descendant"
    );

    // Recorded, not softened: the authority reports exact empty while a process the workload
    // caused to exist is still running. That is the Windows analogue of the Linux sibling's
    // `F-L2-17` and it is a property of `workload-non-escape`, not a defect in this receipt.
    let still_alive = !exited_within(&proxied_handle, Duration::from_millis(500));
    println!("proxied process {proxied} alive after exact-scope-empty: {still_alive}");
    assert!(
        still_alive,
        "the proxied process died with the authority, so this row does not demonstrate the \
         boundary it claims to"
    );

    kill(proxied);
    let _ = std::fs::remove_dir_all(&directory);
}

// ---------------------------------------------------------------------------------------------
// 8.2 the prepare oracles, shown to discriminate
// ---------------------------------------------------------------------------------------------

#[test]
fn red_each_prepare_oracle_has_a_configuration_that_makes_it_fail() {
    // Task 8.2's GREEN asserts three things about a healthy authority: the limit mask is
    // bit-exact, the completion port was associated while the Job was empty, and the Job handle
    // is solely held. Three assertions that are true of every Job would be worth nothing, so
    // each one is shown here to have a reachable configuration in which it is false — using the
    // product's own mutation switches, on the real kernel.
    record_in_process_row("prepare-oracles-red");

    let healthy = JobAuthority::create().expect("job");
    assert_eq!(healthy.attestation().observed_limit_mask, EXPECTED_LIMIT_MASK);
    assert!(healthy.attestation().port_was_associated_on_an_empty_job());
    assert!(healthy.attestation().sole_handle_holds());

    // (1) The mask oracle. With breakaway permitted the mask is a different exact value, so
    //     "the mask equals EXPECTED_LIMIT_MASK" is a real discriminator and not a tautology.
    let permissive = JobAuthority::create_with(JobMutations {
        allow_breakaway: true,
        ..JobMutations::default()
    })
    .expect("job");
    let mask = permissive.attestation().observed_limit_mask;
    println!("red mask expected={EXPECTED_LIMIT_MASK:#010x} observed={mask:#010x}");
    assert_ne!(
        mask, EXPECTED_LIMIT_MASK,
        "the RED did not reproduce: permitting breakaway left the mask bit-identical"
    );
    assert_ne!(mask & JOB_OBJECT_LIMIT_BREAKAWAY_OK, 0);

    // (2) The port-association oracle.
    let late = JobAuthority::create_with(JobMutations {
        associate_port_late: true,
        ..JobMutations::default()
    })
    .expect("job");
    assert!(
        !late.attestation().port_was_associated_on_an_empty_job(),
        "the RED did not reproduce: a late-associated port still attested association on empty"
    );

    // (3) The sole-handle oracle is falsified in `windows_guardian_lifecycle.rs`'s
    //     `red_duplicating_the_job_handle_lets_members_survive_the_guardian`, which duplicates
    //     the handle into a live root and shows both the attestation and the trusted state
    //     root withdraw. It is named here rather than duplicated, because that RED needs a real
    //     guardian process to die and this row holds no guardian.
    let mut duplicated = healthy.attestation();
    duplicated.job_handle_duplications = 1;
    assert!(
        !duplicated.sole_handle_holds(),
        "the sole-handle predicate ignores duplications, so it asserts nothing"
    );

    let _ = permissive.terminate(1);
    let _ = late.terminate(1);
    let _ = healthy.terminate(1);
}

// ---------------------------------------------------------------------------------------------
// 8.15 the unavailable-configuration census, for the causes that need Win32 to decide
// ---------------------------------------------------------------------------------------------

#[test]
fn actual_unavailable_configuration_census_on_this_host() {
    // Task 8.15, the half that cannot be decided from a shell. The other half — reparse-pointed
    // state root, wrongly owned state root, uncreatable state root, absent adjacent guardian,
    // and the injected construction checkpoints — is driven through the real packaged helper
    // and recorded in the evidence file.
    //
    // The rule this row is written against: a verdict may not be generalised from a single
    // probe. So ambient-Job membership is measured **and** the whole authority is then built
    // from inside it, because membership alone is not an unavailability verdict — nested Jobs
    // are supported and the only honest test is the real construction.
    record_in_process_row("unavailable-configuration-census");

    let me = win::open_process(
        PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE,
        win::current_process_id(),
    )
    .expect("open this process");
    let mut ambient: Bool = FALSE;
    assert_ne!(
        unsafe { IsProcessInJob(me.raw(), std::ptr::null_mut(), &mut ambient) },
        FALSE,
        "IsProcessInJob failed against this process, so the census has no measurement at all"
    );
    println!("census ambient-job-membership={}", ambient != FALSE);

    // "The host is inside an ambient Job that refuses nesting" is decided here, by construction.
    let job = JobAuthority::create()
        .expect("Job creation is denied on this host; the enumerated cause is REACHABLE");
    let attestation = job.attestation();
    assert_eq!(
        attestation.observed_limit_mask, EXPECTED_LIMIT_MASK,
        "the exact limit mask could not be set and read back on this host"
    );
    assert!(
        attestation.port_was_associated_on_an_empty_job(),
        "completion-port association on an empty Job is unavailable on this host"
    );
    println!(
        "census job-creation=ok limit-mask={:#010x} port-association-on-empty=ok",
        attestation.observed_limit_mask
    );

    // Boot identity: every candidate source is probed and its result recorded, so "the boot
    // identity source is unobtainable" is answered from the probe rather than from prose.
    let probe = boot::probe();
    for (source, result) in &probe.attempts {
        println!(
            "census boot-candidate {} -> {}",
            source.name(),
            match result {
                Ok(_) => "obtainable".to_owned(),
                Err(error) => format!("unobtainable: {error}"),
            }
        );
    }
    assert!(
        probe.selected.is_some(),
        "no boot identity source is obtainable on this host; the enumerated cause is REACHABLE"
    );
    println!(
        "census boot-selected={} rejected-tick-derivations={:?}",
        probe.selected.as_ref().expect("selected").source.name(),
        boot::REJECTED_TICK_DERIVATIONS
    );
    let _ = job.terminate(1);
}

// ---------------------------------------------------------------------------------------------
// Gated fixture entry point — asserts nothing, runs inside the authority
// ---------------------------------------------------------------------------------------------

#[test]
fn s8_fixture_entrypoint() {
    let role = match std::env::var("RWPA_S8_FIXTURE") {
        Ok(role) => role,
        Err(_) => return,
    };
    match role.as_str() {
        "descendants" => fixture_descendants(),
        "double-fork-middle" => fixture_double_fork_middle(),
        "proxy" => fixture_proxy(),
        // A set-but-unrecognised role is the one path that could pass silently. Panic instead,
        // so a renamed role fails here rather than turning its consumer's assertion into a
        // mystery about empty output.
        other => panic!("unknown fixture role {other}"),
    }
    std::io::stdout().flush().expect("flush");
    std::process::exit(0);
}

fn fixture_scratch() -> PathBuf {
    PathBuf::from(std::env::var("RWPA_S8_SCRATCH").expect("RWPA_S8_SCRATCH"))
}

/// A long-lived descendant with an exact creation shape. Its standard streams are detached from
/// the fixture's, so it never holds the report pipe open.
///
/// The liveness check is not decoration. A descendant that exited immediately would still yield
/// a plausible-looking identifier, and every membership assertion downstream would then be
/// asking about a process that no longer exists — a green row measuring nothing.
fn spawn_descendant(flags: Dword) -> u32 {
    let mut child = Command::new(PING)
        .args(["-n", "90", "127.0.0.1"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .creation_flags(flags)
        .spawn()
        .expect("spawn descendant");
    let id = child.id();
    std::thread::sleep(Duration::from_millis(250));
    if let Ok(Some(status)) = child.try_wait() {
        panic!("descendant {id} (flags {flags:#x}) exited immediately with {status}");
    }
    std::mem::forget(child);
    id
}

fn fixture_descendants() {
    let scratch = fixture_scratch();
    let detached = spawn_descendant(DETACHED_PROCESS);
    let new_console = spawn_descendant(CREATE_NEW_CONSOLE);
    let new_group = spawn_descendant(CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW);

    // The double fork: this middle process creates the grandchild and exits immediately, so the
    // grandchild's creator is gone before the parent test ever looks at it.
    let middle = Command::new(std::env::current_exe().expect("test binary"))
        .args([
            "s8_fixture_entrypoint",
            "--exact",
            "--nocapture",
            "--test-threads",
            "1",
        ])
        .env("RWPA_S8_FIXTURE", "double-fork-middle")
        .env("RWPA_S8_SCRATCH", scratch.to_string_lossy().into_owned())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .expect("spawn the middle of the double fork")
        .id();

    let marker = scratch.join("grandchild.txt");
    let until = Instant::now() + Duration::from_secs(30);
    while Instant::now() < until && !marker.exists() {
        std::thread::sleep(Duration::from_millis(25));
    }
    let grandchild = std::fs::read_to_string(&marker)
        .unwrap_or_default()
        .trim()
        .to_owned();
    println!(
        "descendants detached={detached} newconsole={new_console} newgroup={new_group} \
         middle={middle} grandchild={grandchild}"
    );
}

fn fixture_double_fork_middle() {
    let scratch = fixture_scratch();
    let grandchild = spawn_descendant(DETACHED_PROCESS);
    let marker = scratch.join("grandchild.txt");
    let temporary = scratch.join("grandchild.tmp");
    std::fs::write(&temporary, format!("{grandchild}")).expect("write the grandchild marker");
    std::fs::rename(&temporary, &marker).expect("publish the grandchild marker");
}

/// Ask a pre-existing out-of-authority service to create a process. The WMI provider host is
/// already running and is not a descendant of this authority, so the process it creates is
/// parented outside the Job entirely.
fn fixture_proxy() {
    let direct = spawn_descendant(CREATE_NO_WINDOW);
    let output = Command::new(POWERSHELL)
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments \
             @{CommandLine='C:\\Windows\\System32\\ping.exe -n 90 127.0.0.1'}; \
             Write-Output ('rc=' + $r.ReturnValue + ' pid=' + $r.ProcessId)",
        ])
        .stdin(Stdio::null())
        .output()
        .expect("the out-of-authority service could not be reached at all");
    let text = String::from_utf8_lossy(&output.stdout).into_owned();
    let line = text
        .lines()
        .find(|line| line.contains("rc="))
        .unwrap_or("rc=absent pid=0");
    println!("proxy {line} direct={direct}");
}
