//! Section 9: oracle discrimination and anti-vacuity.
//!
//! Every test here exists because a green assertion elsewhere had no demonstrated failing
//! counterpart, or had one that did not reach the property it named. Each drives **production**
//! types against the real kernel; nothing here is a recording stand-in.
//!
//! ## Gated entry points (accounting, per `F-L2-07`)
//!
//! `s9_fixture_entrypoint` is a **gated** test: it early-returns unless `RWPA_S9_FIXTURE` is
//! set and asserts nothing at top level. It exists so this binary can be re-executed as a
//! workload *inside* the authority and again one level deeper, which is the only way to have a
//! genuine descendant -- not the root -- attempt a breakaway. Exclude it from asserting counts.
//! A set-but-unrecognised role panics, so a renamed role fails loudly here rather than turning
//! its consumer's assertion into a mystery about empty output.
//!
//! Every other test in this file asserts.

#![cfg(windows)]

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::time::{Duration, Instant};

use rasen_windows_process_authority::activation::{self, ActivationMutations, RootStdio};
use rasen_windows_process_authority::endpoint::{ControlEndpointClient, ControlEndpointServer};
use rasen_windows_process_authority::job::{JobAuthority, JobMutations};
use rasen_windows_process_authority::launch::LaunchSnapshot;
use rasen_windows_process_authority::protocol::{
    RootStatus, ROOT_STATUS_BOTH, ROOT_STATUS_NEITHER, ROOT_STATUS_SIGNAL_ONLY,
};
use rasen_windows_process_authority::sys::*;
use rasen_windows_process_authority::win::{self, OwnedHandle};

const COMSPEC: &str = "C:\\Windows\\System32\\cmd.exe";

// ---------------------------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------------------------

fn scratch(tag: &str) -> PathBuf {
    let mut base = std::env::temp_dir();
    base.push(format!("rasen-wpa-s9-{tag}-{}", win::current_process_id()));
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

fn shell(command: &str) -> LaunchSnapshot {
    LaunchSnapshot {
        executable: COMSPEC.to_owned(),
        working_directory: "C:\\Windows".to_owned(),
        arguments: vec!["/c".to_owned(), command.to_owned()],
        environment: environment(),
        verbatim_arguments: false,
    }
}

/// This test binary, re-executed as a workload inside the authority.
fn fixture(role: &str) -> LaunchSnapshot {
    let mut environment = environment();
    environment.insert("RWPA_S9_FIXTURE".to_owned(), role.to_owned());
    LaunchSnapshot {
        executable: std::env::current_exe()
            .expect("test binary")
            .to_string_lossy()
            .into_owned(),
        working_directory: "C:\\Windows".to_owned(),
        // `--nocapture` matters: libtest captures `println!` by default, so without it the
        // fixture runs correctly inside the authority and reports nothing at all.
        arguments: vec![
            "s9_fixture_entrypoint".to_owned(),
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

    /// Read until `needle` appears. Never read to end-of-file here: every long-lived descendant
    /// inherits this pipe, so end-of-file arrives only after the last of them dies and every
    /// liveness assertion downstream would then be asking about processes that no longer exist
    /// (`S8-F5`).
    fn read_until(&self, needle: &str, deadline: Instant) -> String {
        let mut collected = Vec::new();
        let mut buffer = [0_u8; 4096];
        while Instant::now() < deadline {
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

fn field(text: &str, key: &str) -> Option<u32> {
    text.split_whitespace()
        .find_map(|token| token.strip_prefix(key))
        .and_then(|value| value.trim().parse().ok())
}

/// Ask the authority itself whether a process id is one of its members. A process inside the Job
/// cannot answer this: `IsProcessInJob(handle, NULL)` reports membership of *any* Job and this
/// runner is itself inside an ambient one.
fn authority_contains(job: &JobAuthority, process_id: u32) -> bool {
    match win::open_process(PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE, process_id) {
        Ok(handle) => job.contains(handle.raw()).expect("IsProcessInJob"),
        Err(_) => false,
    }
}

fn hold(process_id: u32) -> Option<OwnedHandle> {
    win::open_process(PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE, process_id).ok()
}

fn is_alive(handle: &OwnedHandle) -> bool {
    unsafe { WaitForSingleObject(handle.raw(), 0) != WAIT_OBJECT_0 }
}

fn kill(process_id: u32) {
    if let Ok(handle) = win::open_process(PROCESS_TERMINATE | SYNCHRONIZE, process_id) {
        unsafe { TerminateProcess(handle.raw(), 1) };
    }
}

/// Start the two-level breakaway fixture inside `job` and return its report plus the handles
/// that keep the reported identifiers meaningful.
fn run_descendant_breakaway(job: &JobAuthority) -> String {
    let _directory = scratch("descendant-breakaway");
    let mut streams = Streams::new();
    let mut root = activation::create_root_suspended(
        job,
        &fixture("breakaway-parent"),
        streams.stdio(),
        ActivationMutations::default(),
    )
    .expect("create fixture root");
    root.resume().expect("resume");
    streams.release_child_ends();
    let report = streams.read_until("s9-child-end", Instant::now() + Duration::from_secs(45));
    // The root is deliberately leaked: it is still inside the authority and will be removed by
    // the authority-wide terminate at the end of the test, not by a handle close here.
    std::mem::forget(root);
    report
}

// ---------------------------------------------------------------------------------------------
// 9.1 breakaway containment, demonstrated from a genuine descendant rather than from the root
// ---------------------------------------------------------------------------------------------

#[test]
fn red_a_descendant_of_a_member_breaks_away_only_when_the_limit_permits_it() {
    // Task 9.1. The pre-existing oracle
    // (`windows_authority_kernel::actual_breakaway_is_refused_by_the_operating_system_and_...`)
    // has the **root** attempt the breakaway. The root is a member, but it is not a descendant,
    // so that pair leaves the transitive claim -- "membership is inherited at creation and
    // cannot be renounced from anywhere in the tree" -- resting on documentation.
    //
    // Here the attempt is made by a grandchild-generation process: the root creates a child
    // inside the authority, and the *child* calls `CreateProcessW` with
    // `CREATE_BREAKAWAY_FROM_JOB`.
    //
    // GREEN: with both breakaway permissions clear the kernel refuses, and the refusal is
    // `ERROR_ACCESS_DENIED` rather than any other failure.
    let contained = JobAuthority::create().expect("job");
    let started = Instant::now();
    let refused = run_descendant_breakaway(&contained);
    // Print the raw report and the wall time. A test that spawns a root, a descendant and a
    // would-be escapee cannot be honest in single-digit milliseconds, and this file exists
    // precisely because assertions that pass without doing anything are the failure mode.
    println!(
        "GREEN report ({} ms): {}",
        started.elapsed().as_millis(),
        refused.trim()
    );
    let child_id = field(&refused, "child-pid=").unwrap_or_else(|| {
        panic!("the descendant never reported: {refused}");
    });
    assert!(
        refused.contains("s9-parent-spawned"),
        "the root fixture never reported spawning a descendant, so the line below may have come \
         from somewhere else: {refused}"
    );
    assert!(
        refused.contains("child-breakaway=refused"),
        "a descendant escaped a breakaway-disabled authority: {refused}"
    );
    assert!(
        refused.contains(&format!("os-error={ERROR_ACCESS_DENIED}")),
        "the descendant's breakaway was refused for the wrong reason: {refused}"
    );
    // The membership question must be able to answer *yes* in this run, otherwise "not a member"
    // below would be indistinguishable from "the question is broken".
    assert!(
        authority_contains(&contained, child_id),
        "the descendant {child_id} was not a member, so this run proves nothing"
    );
    assert!(
        !refused.contains("escaped="),
        "a refused breakaway still reported a created process: {refused}"
    );

    // RED (task 9.1): set `JOB_OBJECT_LIMIT_BREAKAWAY_OK` and the identical descendant, running
    // the identical code, succeeds -- and the process it creates is outside the authority.
    let permissive = JobAuthority::create_with(JobMutations {
        allow_breakaway: true,
        ..JobMutations::default()
    })
    .expect("job");
    let escaped_report = run_descendant_breakaway(&permissive);
    println!("RED report: {}", escaped_report.trim());
    let escaping_child = field(&escaped_report, "child-pid=").unwrap_or_else(|| {
        panic!("the descendant never reported: {escaped_report}");
    });
    assert_ne!(
        escaping_child, child_id,
        "both halves reported the same descendant identifier, so one of the two fixture runs \
         did not happen"
    );
    assert!(
        escaped_report.contains("child-breakaway=created"),
        "the RED did not reproduce; the descendant's breakaway stayed refused with the \
         permission set: {escaped_report}"
    );
    let escaped_id = field(&escaped_report, "escaped=").expect("escaped pid");
    let escaped_handle = hold(escaped_id).expect("the escaped process was already gone");
    assert!(
        is_alive(&escaped_handle),
        "the escaped process {escaped_id} was dead when membership was asked, so the answer \
         below would be about nothing"
    );
    assert!(
        authority_contains(&permissive, escaping_child),
        "the descendant that performed the breakaway was not itself a member"
    );
    assert!(
        !authority_contains(&permissive, escaped_id),
        "the escaping process {escaped_id} was still a member of the permissive authority"
    );

    kill(escaped_id);
    let _ = permissive.terminate(1);
    let _ = contained.terminate(1);
}

// ---------------------------------------------------------------------------------------------
// 9.4 status fidelity: the sign-extension and truncation counterparts
// ---------------------------------------------------------------------------------------------

#[test]
fn red_a_sign_extended_or_truncated_status_is_a_different_value_on_the_wire_and_in_the_text() {
    // Task 9.4, second half. The wait-before-status RED lives in
    // `windows_authority_kernel::red_reading_the_status_without_a_completed_wait_...`; this is
    // the fidelity half, which had a green assertion and no failing counterpart.
    //
    // What the contract requires (`design.md` Decision 7): the `DWORD` is carried unsigned, so
    // `0xC0000005` arrives as `3221225477` -- never `-1073741819`, never truncated -- and a
    // payload carrying both branches or neither is rejected as control-loss rather than
    // repaired.
    //
    // GREEN, against the real kernel rather than a literal: a root that really exits with the
    // high-bit status round-trips through the production codec unchanged.
    let job = JobAuthority::create().expect("job");
    let mut streams = Streams::new();
    let mut root = activation::create_root_suspended(
        &job,
        &shell("exit /b -1073741819"),
        streams.stdio(),
        ActivationMutations::default(),
    )
    .expect("create root");
    root.resume().expect("resume");
    streams.release_child_ends();
    let code = activation::wait_then_read_exit_status(root.process.raw(), 20_000)
        .expect("wait")
        .expect("status");
    assert_eq!(code, 0xC000_0005);

    let status = RootStatus { code };
    let encoded = status.encode();
    let decoded = RootStatus::decode(&encoded).expect("decode");
    assert_eq!(decoded.code, 0xC000_0005);
    assert_eq!(decoded.unsigned_text(), "3221225477");

    // RED 1 -- sign extension at the rendering boundary. This is the exact defect the contract
    // names, and it is invisible in the `u32`: only the text differs.
    let sign_extended = format!("{}", code as i32);
    assert_eq!(sign_extended, "-1073741819");
    assert_ne!(
        sign_extended,
        decoded.unsigned_text(),
        "the RED did not reproduce: a sign-extended rendering was indistinguishable from the \
         unsigned one, so the GREEN assertion above discriminates nothing"
    );

    // RED 2 -- truncation. A producer that carried the status in 16 bits would report 5.
    let truncated = u32::from(code as u16);
    assert_eq!(truncated, 5);
    assert_ne!(
        truncated, decoded.code,
        "the RED did not reproduce: truncation left the value unchanged"
    );

    // RED 3 -- truncation on the wire. The production decoder must reject a short payload rather
    // than reconstruct a plausible value from what survived.
    let short = RootStatus::decode(&encoded[..4]);
    assert!(
        short.is_err(),
        "a truncated status payload decoded to {:?} instead of failing closed",
        short.ok()
    );

    // RED 4 -- the branch discipline. Both branches, or neither, must be control-loss, not a
    // repaired code. These are the two shapes a Windows producer can never legitimately emit.
    for tag in [ROOT_STATUS_BOTH, ROOT_STATUS_NEITHER, ROOT_STATUS_SIGNAL_ONLY] {
        let mut payload = encoded.clone();
        payload[0] = tag;
        let outcome = RootStatus::decode(&payload);
        assert!(
            outcome.is_err(),
            "branch tag {tag:#04x} decoded to {:?} instead of failing closed",
            outcome.ok()
        );
    }

    // And the GREEN is still green after the REDs, so none of the above corrupted the codec.
    assert_eq!(
        RootStatus::decode(&status.encode()).expect("decode").code,
        0xC000_0005
    );
    let _ = job.terminate(1);
}

// ---------------------------------------------------------------------------------------------
// 9.5 the mandatory post-open reread
// ---------------------------------------------------------------------------------------------

#[test]
fn red_a_cached_identity_tuple_is_still_believed_after_the_target_changed_unless_the_reread_runs() {
    // Task 9.5. `endpoint.rs:276` and `cli.rs:606` both reread the complete tuple through the
    // handles that are already open and refuse to issue anything if it differs. The question is
    // whether that step is load-bearing or decorative.
    //
    // GREEN: a healthy authority passes the reread, so the refusals below are not "nothing ever
    // matches".
    let owner = win::current_user_sid().expect("owner sid");
    let owner_text = owner.to_text().expect("owner text");
    let scope = format!("{:032x}", 0x5901_u128 << 96 | u128::from(win::current_process_id()));
    let mut server = ControlEndpointServer::create(&scope, &owner).expect("endpoint");
    let self_id = win::current_process_id();
    let self_handle = hold(self_id).expect("self handle");
    let self_birth = win::process_creation_filetime(self_handle.raw()).expect("birth");

    let accept = win::OverlappedContext::new().expect("overlapped");
    let scope_for_client = scope.clone();
    let connector = std::thread::spawn(move || {
        ControlEndpointClient::connect(&scope_for_client, self_id, self_birth, &owner_text)
    });
    let _ = server.accept(&accept);
    let client = connector
        .join()
        .expect("connector thread")
        .expect("the healthy reopen sequence must succeed");
    let captured = client.tuple().clone();
    assert_eq!(captured.guardian_process_id, self_id);
    assert_eq!(captured.guardian_birth, self_birth);
    assert_eq!(
        client
            .read_identity_tuple(self_id)
            .expect("reread a healthy authority"),
        captured,
        "the reread disagreed with the pre-open tuple on an authority nothing had touched"
    );

    // The identity behind the reference now changes: a different, genuinely live process takes
    // the place the reference names. This is the shape of process-id reuse -- same slot in the
    // reference, different process -- without pretending to force a real identifier reuse.
    let mut other = std::process::Command::new(COMSPEC)
        .args(["/c", "ping -n 20 127.0.0.1 > nul"])
        .spawn()
        .expect("second process");
    let other_id = other.id();
    let other_handle = hold(other_id).expect("second process handle");
    let other_birth = win::process_creation_filetime(other_handle.raw()).expect("other birth");
    assert_ne!(
        other_birth, self_birth,
        "the two processes were born at the same instant, so this run cannot discriminate"
    );

    // GREEN: the reread reports the change, and the production comparison rejects it. This is
    // the exact comparison at `endpoint.rs:277` and `cli.rs:607`.
    let reread = client
        .read_identity_tuple(other_id)
        .expect("reread against the changed target");
    assert_ne!(
        reread, captured,
        "the reread could not tell a changed target from the original"
    );
    assert_ne!(reread.guardian_birth, captured.guardian_birth);

    // RED: skip the reread and the only thing left is the cached tuple -- which still reports
    // the original identity, in full, with every field it was validated with. A controller that
    // trusts it proceeds to authenticate and issue control against the changed target.
    assert_eq!(
        client.tuple(),
        &captured,
        "the cached tuple is what a controller that skips the reread would act on"
    );
    assert_eq!(
        client.tuple().guardian_process_id,
        self_id,
        "the RED did not reproduce: the cached tuple noticed the change by itself, which would \
         make the reread redundant"
    );

    // The endpoint half, and the boundary of what the reread promises. Destroying the endpoint
    // **object** while its server **process** stays alive leaves the reread answering exactly
    // as before: `GetNamedPipeServerProcessId` still names the live server through our retained
    // handle, and the owner SID is still readable.
    //
    // This is recorded as a measured boundary rather than asserted as a defect. The reread's
    // contract (`design.md` Decision 9) is that the *identity tuple* is unchanged before any
    // control is issued -- and here it genuinely is unchanged, because the identity did not
    // change; only the object's liveness did. It is the same shape as `S8-F6`: a retained
    // handle keeps a dead thing resolvable. Anyone writing a recovery expectation against
    // "the endpoint is gone" must not expect the reread to be the step that reports it.
    drop(server);
    let after_server = client.read_identity_tuple(self_id);
    match after_server {
        Err(error) => println!(
            "boundary: after the endpoint object was destroyed the reread failed: {error}"
        ),
        Ok(tuple) => {
            assert_eq!(
                tuple, captured,
                "the reread changed its answer for a reason this test did not create"
            );
            println!(
                "boundary: the reread still confirms the tuple after the endpoint object was \
                 destroyed, because the server process is alive and the handle is retained -- \
                 the reread proves identity, never liveness"
            );
        }
    }
    assert_eq!(
        client.tuple(),
        &captured,
        "and the cached tuple still says everything is fine"
    );

    let _ = other.kill();
    let _ = other.wait();
}

// ---------------------------------------------------------------------------------------------
// Gated fixture entry point -- asserts nothing, runs inside the authority
// ---------------------------------------------------------------------------------------------

#[test]
fn s9_fixture_entrypoint() {
    let role = match std::env::var("RWPA_S9_FIXTURE") {
        Ok(role) => role,
        Err(_) => return,
    };
    match role.as_str() {
        "breakaway-parent" => fixture_breakaway_parent(),
        "breakaway-child" => fixture_breakaway_child(),
        other => panic!("unknown fixture role {other}"),
    }
    use std::io::Write;
    std::io::stdout().flush().expect("flush");
    std::process::exit(0);
}

/// The authority's root. It creates one ordinary child inside the authority and stays alive
/// long enough for the parent test to ask its membership questions.
fn fixture_breakaway_parent() {
    let executable = std::env::current_exe().expect("test binary");
    let child = std::process::Command::new(executable)
        .args([
            "s9_fixture_entrypoint",
            "--exact",
            "--nocapture",
            "--test-threads",
            "1",
        ])
        .env("RWPA_S9_FIXTURE", "breakaway-child")
        .spawn();
    match child {
        Ok(child) => println!("s9-parent-spawned child={}", child.id()),
        Err(error) => println!("s9-parent-spawn-failed error={error}"),
    }
    use std::io::Write;
    let _ = std::io::stdout().flush();
    // Outlive the parent test's membership questions. The test terminates the whole authority.
    std::thread::sleep(Duration::from_secs(30));
}

/// A genuine descendant -- not the root -- attempting to leave the authority.
fn fixture_breakaway_child() {
    use std::mem::{size_of, zeroed};
    use std::ptr::null_mut;

    let application = win::wide(COMSPEC);
    let mut command_line = win::wide("cmd.exe /c ping -n 25 127.0.0.1");
    let mut startup: StartupInfoW = unsafe { zeroed() };
    startup.cb = size_of::<StartupInfoW>() as Dword;
    let mut information: ProcessInformation = unsafe { zeroed() };
    // `inherit_handles = FALSE` is load-bearing: an escaping process that inherited this
    // fixture's stdout would hold the report pipe open for its whole life and every downstream
    // read would block (`S8-F5`).
    let created = unsafe {
        CreateProcessW(
            application.as_ptr(),
            command_line.as_mut_ptr(),
            null_mut(),
            null_mut(),
            FALSE,
            CREATE_BREAKAWAY_FROM_JOB | CREATE_NO_WINDOW | DETACHED_PROCESS,
            null_mut(),
            null_mut(),
            &mut startup,
            &mut information,
        )
    };
    let self_id = win::current_process_id();
    if created == FALSE {
        println!(
            "child-pid={self_id} child-breakaway=refused os-error={} s9-child-end",
            std::io::Error::last_os_error().raw_os_error().unwrap_or(0)
        );
    } else {
        // Report only the identifier. Whether it escaped **our** authority is a question only
        // the holder of that authority can answer.
        println!(
            "child-pid={self_id} child-breakaway=created escaped={} s9-child-end",
            information.process_id
        );
        unsafe { CloseHandle(information.thread) };
        unsafe { CloseHandle(information.process) };
    }
    use std::io::Write;
    let _ = std::io::stdout().flush();
    // Stay alive so the parent test's membership question is about a live process.
    std::thread::sleep(Duration::from_secs(25));
}
