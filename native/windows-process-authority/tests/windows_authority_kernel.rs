//! Actual-Windows kernel oracles for the Job Object authority.
//!
//! Every test here drives **production** types — `JobAuthority`, `activation::*`,
//! `LaunchSnapshot` — against the real kernel. Nothing is a recording stand-in and nothing is
//! a `...ForTesting` twin.
//!
//! ## Gated entry points (accounting, per `F-L2-07`)
//!
//! `fixture_entrypoint` is a **gated** test: it early-returns unless `RWPA_FIXTURE` is set, and
//! asserts nothing at top level. It exists so this test binary can be re-executed as a workload
//! *inside* the authority, which is the only way to have a Job member attempt a breakaway or
//! create a nested Job. It must be excluded from any asserting-test count.
//!
//! Every other test in this file asserts.

#![cfg(windows)]

use std::collections::BTreeMap;

use std::path::PathBuf;
use std::time::{Duration, Instant};

use rasen_windows_process_authority::activation::{
    self, ActivationMutations, RootStdio, TerminationOutcome,
};
use rasen_windows_process_authority::job::{JobAuthority, JobMutations, PortMessage, EXPECTED_LIMIT_MASK};
use rasen_windows_process_authority::launch::LaunchSnapshot;
use rasen_windows_process_authority::protocol::MembershipMessage;
use rasen_windows_process_authority::sys::*;
use rasen_windows_process_authority::win::{self, OwnedHandle};

const COMSPEC: &str = "C:\\Windows\\System32\\cmd.exe";

// ---------------------------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------------------------

fn scratch(tag: &str) -> PathBuf {
    let mut base = std::env::temp_dir();
    base.push(format!("rasen-wpa-kernel-{tag}-{}", win::current_process_id()));
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
    environment.insert("RWPA_FIXTURE".to_owned(), role.to_owned());
    LaunchSnapshot {
        executable: std::env::current_exe()
            .expect("test binary")
            .to_string_lossy()
            .into_owned(),
        working_directory: "C:\\Windows".to_owned(),
        // `--nocapture` matters: libtest captures `println!` by default, so without it the
        // fixture runs correctly inside the authority and reports nothing at all.
        arguments: vec![
            "fixture_entrypoint".to_owned(),
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

    /// Release the guardian-side copies of the child ends so the reader sees end-of-file.
    fn release_child_ends(&mut self) {
        self.stdio = None;
    }

    fn read_all(&self) -> String {
        let mut collected = Vec::new();
        let mut buffer = [0_u8; 4096];
        loop {
            match win::read_handle(self.stdout_read.raw(), &mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(count) => collected.extend_from_slice(&buffer[..count]),
            }
        }
        String::from_utf8_lossy(&collected).into_owned()
    }

    /// Read until `needle` appears. Used for fixtures that report and then keep running.
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

/// Ask the authority itself whether a process id is one of its members. This is the only
/// trustworthy form of the question: a process inside the Job cannot answer it, because
/// `IsProcessInJob(handle, NULL)` reports membership of *any* Job and the test runner is often
/// inside an ambient one.
fn authority_contains(job: &JobAuthority, process_id: u32) -> bool {
    match win::open_process(PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE, process_id) {
        Ok(handle) => job.contains(handle.raw()).expect("IsProcessInJob"),
        Err(_) => false,
    }
}

/// Drain membership messages until `predicate` is satisfied or the deadline expires.
fn drain_until(
    job: &JobAuthority,
    log: &mut Vec<MembershipMessage>,
    deadline: Instant,
    mut predicate: impl FnMut(&[MembershipMessage]) -> bool,
) -> bool {
    loop {
        if predicate(log) {
            return true;
        }
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return predicate(log);
        }
        match job.poll(remaining.as_millis().min(200) as Dword) {
            Ok(Some(PortMessage::Membership(message))) => log.push(message),
            Ok(Some(PortMessage::Unexplained { message, .. })) => {
                panic!("unexplained completion message {message}")
            }
            Ok(None) => {}
            Err(error) => panic!("completion port failed: {error}"),
        }
    }
}

fn deadline(seconds: u64) -> Instant {
    Instant::now() + Duration::from_secs(seconds)
}

// ---------------------------------------------------------------------------------------------
// 8.2 prepare
// ---------------------------------------------------------------------------------------------

#[test]
fn actual_prepare_creates_an_exact_empty_authority_with_no_workload_process() {
    let job = JobAuthority::create().expect("create authority");
    let attestation = job.attestation();

    // The contract requires kill-on-job-close set, both breakaway permissions clear, and every
    // other limit clear. That is a bit-exact requirement, not "the flags we care about".
    assert_eq!(
        attestation.observed_limit_mask, EXPECTED_LIMIT_MASK,
        "observed mask {:#010x} is not the exact expected mask",
        attestation.observed_limit_mask
    );
    assert_eq!(
        attestation.observed_limit_mask & JOB_OBJECT_LIMIT_BREAKAWAY_OK,
        0
    );
    assert_eq!(
        attestation.observed_limit_mask & JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK,
        0
    );
    assert_ne!(
        attestation.observed_limit_mask & JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        0
    );
    assert!(attestation.port_was_associated_on_an_empty_job());
    assert!(attestation.sole_handle_holds());

    let accounting = job.accounting().expect("accounting");
    assert_eq!(accounting.active_processes, 0);
    assert_eq!(
        accounting.total_processes, 0,
        "prepare created a workload process object"
    );
    assert_eq!(job.poll(50).expect("poll"), None);
}

// ---------------------------------------------------------------------------------------------
// 8.3 suspended assign-before-run
// ---------------------------------------------------------------------------------------------

#[test]
fn actual_root_is_a_member_before_its_first_instruction_and_only_runs_after_the_resume() {
    let directory = scratch("assign-before-run");
    let marker = directory.join("marker.txt");
    let job = JobAuthority::create().expect("job");
    let mut streams = Streams::new();
    // No inner quotes: `cmd /c` receives this as one already-quoted argument, and a nested
    // quote would be escaped for `CommandLineToArgvW` in a way `cmd` does not unwrap.
    let launch = shell(&format!("echo ran> {}", marker.display()));

    let mut root = activation::create_root_suspended(
        &job,
        &launch,
        streams.stdio(),
        ActivationMutations::default(),
    )
    .expect("create root");

    // Membership exists as part of creation: before any resume, before loader init.
    assert!(
        job.contains(root.process.raw()).expect("IsProcessInJob"),
        "the root was created outside the authority"
    );
    assert_eq!(job.accounting().expect("accounting").active_processes, 1);

    // The membership event for exactly this process id must arrive before the resume.
    let mut log = Vec::new();
    let expected = root.process_id;
    assert!(
        drain_until(&job, &mut log, deadline(10), |messages| {
            messages.contains(&MembershipMessage::NewProcess(expected))
        }),
        "no new-process message for {expected}; observed {log:?}"
    );

    // The workload has executed nothing: its only observable side effect does not exist.
    assert!(
        !marker.exists(),
        "the suspended root produced an observable side effect before the resume"
    );
    std::thread::sleep(Duration::from_millis(150));
    assert!(!marker.exists(), "side effect appeared without a resume");

    root.resume().expect("resume");
    streams.release_child_ends();
    let deadline = deadline(15);
    while Instant::now() < deadline && !marker.exists() {
        std::thread::sleep(Duration::from_millis(20));
    }
    assert!(marker.exists(), "the resumed root never ran");
    let _ = job.terminate(1);
    let _ = std::fs::remove_dir_all(&directory);
}

#[test]
fn red_a_root_created_without_the_job_list_is_not_a_member_and_fails_its_proof() {
    // RED counterpart for assign-before-run. With `PROC_THREAD_ATTRIBUTE_JOB_LIST` omitted the
    // process object exists outside the authority — which is exactly the window the
    // `CREATE_SUSPENDED` -> `AssignProcessToJobObject` sequence leaves open, and why the design
    // rejects it. The pre-resume proof must refuse to let such a root execute.
    let directory = scratch("omit-job-list");
    let marker = directory.join("marker.txt");
    let job = JobAuthority::create().expect("job");
    let streams = Streams::new();
    let launch = shell(&format!("echo ran> {}", marker.display()));

    let mut root = activation::create_root_suspended(
        &job,
        &launch,
        streams.stdio(),
        ActivationMutations {
            omit_job_list: true,
            ..ActivationMutations::default()
        },
    )
    .expect("create root");

    assert!(
        !job.contains(root.process.raw()).expect("IsProcessInJob"),
        "a root created without the job list was somehow a member"
    );
    assert_eq!(job.accounting().expect("accounting").active_processes, 0);

    let proof = activation::prove_before_resume(
        &job,
        &root,
        EXPECTED_LIMIT_MASK,
        ActivationMutations {
            omit_job_list: true,
            ..ActivationMutations::default()
        },
        |_, _| false,
    )
    .expect("proof");
    assert!(!proof.is_complete());
    assert!(proof
        .missing()
        .contains(&"membership-not-confirmed-for-this-process"));

    root.terminate_unresumed(74).expect("terminate");
    std::thread::sleep(Duration::from_millis(200));
    assert!(
        !marker.exists(),
        "an unproven root executed its workload command"
    );
    let _ = std::fs::remove_dir_all(&directory);
}

// ---------------------------------------------------------------------------------------------
// 8.8 / 9.4 exit-status fidelity and the wait-before-status rule
// ---------------------------------------------------------------------------------------------

fn run_to_exit(command: &str) -> u32 {
    let job = JobAuthority::create().expect("job");
    let mut streams = Streams::new();
    let mut root = activation::create_root_suspended(
        &job,
        &shell(command),
        streams.stdio(),
        ActivationMutations::default(),
    )
    .expect("create root");
    root.resume().expect("resume");
    streams.release_child_ends();
    activation::wait_then_read_exit_status(root.process.raw(), 20_000)
        .expect("wait")
        .expect("exit status")
}

#[test]
fn actual_exit_status_is_the_exact_unsigned_value_including_the_still_running_sentinel() {
    assert_eq!(run_to_exit("exit /b 0"), 0);
    assert_eq!(run_to_exit("exit /b 7"), 7);
    // 259 is `STILL_ACTIVE`. A process that legitimately exits with it must be reported as
    // exited with 259, never as live. That is only possible because the wait completes first.
    assert_eq!(run_to_exit("exit /b 259"), STILL_ACTIVE);
    // A high-bit status must survive as an unsigned value with no sign extension.
    let high_bit = run_to_exit("exit /b -1073741819");
    assert_eq!(high_bit, 0xC000_0005);
    assert_eq!(high_bit.to_string(), "3221225477");
}

#[test]
fn actual_authority_forced_termination_sets_the_exact_unsigned_status() {
    let job = JobAuthority::create().expect("job");
    let mut streams = Streams::new();
    let mut root = activation::create_root_suspended(
        &job,
        &shell("ping -n 30 127.0.0.1 > nul"),
        streams.stdio(),
        ActivationMutations::default(),
    )
    .expect("create root");
    root.resume().expect("resume");
    streams.release_child_ends();
    job.terminate(0xC000_0005).expect("terminate");
    let status = activation::wait_then_read_exit_status(root.process.raw(), 20_000)
        .expect("wait")
        .expect("status");
    assert_eq!(status, 0xC000_0005);
    assert_eq!(status.to_string(), "3221225477");
    assert_ne!(format!("{}", status as i32), status.to_string());
}

#[test]
fn red_reading_the_status_without_a_completed_wait_cannot_distinguish_live_from_exited_259() {
    // The contract requires the provider never to report an exited root as live. This shows the
    // assertion discriminates: read without a wait and the two states are literally the same
    // number, so a product that skipped the wait would be wrong in a way no value can reveal.
    let job = JobAuthority::create().expect("job");
    let mut running_streams = Streams::new();
    let mut running = activation::create_root_suspended(
        &job,
        &shell("ping -n 30 127.0.0.1 > nul"),
        running_streams.stdio(),
        ActivationMutations::default(),
    )
    .expect("create running root");
    running.resume().expect("resume");
    running_streams.release_child_ends();
    std::thread::sleep(Duration::from_millis(300));

    let exited_job = JobAuthority::create().expect("job");
    let mut exited_streams = Streams::new();
    let mut exited = activation::create_root_suspended(
        &exited_job,
        &shell("exit /b 259"),
        exited_streams.stdio(),
        ActivationMutations::default(),
    )
    .expect("create exiting root");
    exited.resume().expect("resume");
    exited_streams.release_child_ends();
    activation::wait_then_read_exit_status(exited.process.raw(), 20_000)
        .expect("wait")
        .expect("status");

    let live_without_wait =
        activation::read_exit_status_without_waiting(running.process.raw()).expect("read");
    let dead_without_wait =
        activation::read_exit_status_without_waiting(exited.process.raw()).expect("read");
    assert_eq!(live_without_wait, STILL_ACTIVE);
    assert_eq!(dead_without_wait, STILL_ACTIVE);
    assert_eq!(
        live_without_wait, dead_without_wait,
        "the RED did not reproduce: the two states were distinguishable without a wait"
    );

    // GREEN: with the wait completed, the exited root reports its real status and the running
    // one is still running.
    assert_eq!(
        activation::wait_then_read_exit_status(exited.process.raw(), 5_000).expect("wait"),
        Some(STILL_ACTIVE)
    );
    assert_eq!(
        activation::wait_then_read_exit_status(running.process.raw(), 100).expect("wait"),
        None,
        "a live root was reported as exited"
    );
    let _ = job.terminate(1);
    let _ = exited_job.terminate(1);
}

// ---------------------------------------------------------------------------------------------
// 8.5 / 8.7 / 8.9 descendants, root exit, natural empty
// ---------------------------------------------------------------------------------------------

#[test]
fn actual_root_exit_is_distinct_from_exact_empty_while_a_detached_descendant_lives() {
    let job = JobAuthority::create().expect("job");
    let mut streams = Streams::new();
    // `start /b` detaches the descendant from the parent's lifetime; the parent then exits.
    let launch = shell("start /b ping -n 20 127.0.0.1 > nul & exit /b 0");
    let mut root = activation::create_root_suspended(
        &job,
        &launch,
        streams.stdio(),
        ActivationMutations::default(),
    )
    .expect("create root");
    root.resume().expect("resume");
    streams.release_child_ends();

    let status = activation::wait_then_read_exit_status(root.process.raw(), 20_000)
        .expect("wait")
        .expect("status");
    assert_eq!(status, 0);

    // Root exit does not imply emptiness. The authority still owns a live descendant.
    let mut log = Vec::new();
    let saw_zero = drain_until(&job, &mut log, deadline(3), |messages| {
        messages.contains(&MembershipMessage::ActiveProcessZero)
    });
    let accounting = job.accounting().expect("accounting");
    assert!(
        !saw_zero,
        "the authority reported empty while a detached descendant was live: {log:?}"
    );
    assert!(
        accounting.active_processes > 0,
        "no member survived the root; the fixture did not detach"
    );

    // Authority-wide termination reaches it without enumerating any descendant identifier.
    let outcome =
        activation::terminate_until_empty(&job, 137, deadline(20)).expect("terminate");
    assert!(
        matches!(outcome, TerminationOutcome::ExactEmpty { .. }),
        "termination did not converge: {outcome:?}"
    );
    assert_eq!(job.accounting().expect("accounting").active_processes, 0);
}

#[test]
fn actual_natural_empty_comes_from_the_active_process_zero_message_with_a_complete_history() {
    let job = JobAuthority::create().expect("job");
    let mut streams = Streams::new();
    let mut root = activation::create_root_suspended(
        &job,
        &shell("exit /b 0"),
        streams.stdio(),
        ActivationMutations::default(),
    )
    .expect("create root");
    let root_id = root.process_id;
    root.resume().expect("resume");
    streams.release_child_ends();

    let mut log = Vec::new();
    assert!(
        drain_until(&job, &mut log, deadline(25), |messages| {
            messages.contains(&MembershipMessage::ActiveProcessZero)
        }),
        "no active-process-zero message; observed {log:?}"
    );

    // Complete history: every member that was announced also departed, and the zero message is
    // last. Note the real kernel puts more than the root in the Job — `CREATE_NO_WINDOW` still
    // yields a console host member — so this asserts the invariant, not a member count of one.
    let announced: Vec<u32> = log
        .iter()
        .filter_map(|message| match message {
            MembershipMessage::NewProcess(id) => Some(*id),
            _ => None,
        })
        .collect();
    let departed: Vec<u32> = log
        .iter()
        .filter_map(|message| match message {
            MembershipMessage::ExitProcess(id) | MembershipMessage::AbnormalExitProcess(id) => {
                Some(*id)
            }
            _ => None,
        })
        .collect();
    assert!(announced.contains(&root_id), "the root was never announced");
    for id in &announced {
        assert!(departed.contains(id), "member {id} never departed: {log:?}");
    }
    assert_eq!(
        log.last(),
        Some(&MembershipMessage::ActiveProcessZero),
        "the empty message was not the last event: {log:?}"
    );

    // Accounting is recorded alongside as corroboration only.
    let accounting = job.accounting().expect("accounting");
    assert!(accounting.corroborates_empty());
    assert!(
        accounting.total_processes >= 1,
        "total_processes never counted the root, so it cannot be an emptiness input either"
    );
}

// ---------------------------------------------------------------------------------------------
// 8.10 recursive termination under a create storm
// ---------------------------------------------------------------------------------------------

#[test]
fn actual_recursive_termination_converges_while_members_keep_creating_processes() {
    let job = JobAuthority::create().expect("job");
    let mut streams = Streams::new();
    // A member that keeps creating processes for the whole teardown window.
    let launch = shell("for /l %i in (1,1,400) do @start /b cmd /c ping -n 2 127.0.0.1 > nul");
    let mut root = activation::create_root_suspended(
        &job,
        &launch,
        streams.stdio(),
        ActivationMutations::default(),
    )
    .expect("create root");
    root.resume().expect("resume");
    streams.release_child_ends();

    // Let the storm actually populate the authority before the sweep starts, and record how
    // far it got. A receipt that only says "more than one member" would not distinguish a real
    // create storm from a workload that spawned twice, so the peak is measured and printed.
    let until = Instant::now() + Duration::from_millis(2500);
    let mut peak_active = 0_u32;
    while Instant::now() < until {
        let snapshot = job.accounting().expect("accounting");
        peak_active = peak_active.max(snapshot.active_processes);
        if peak_active >= 12 {
            break;
        }
        std::thread::sleep(Duration::from_millis(25));
    }
    let populated = job.accounting().expect("accounting");
    println!(
        "storm peak-active={peak_active} active-at-sweep={} total-ever={}",
        populated.active_processes, populated.total_processes
    );
    assert!(
        peak_active > 4,
        "the storm never populated the authority (peak active={peak_active})"
    );

    let outcome =
        activation::terminate_until_empty(&job, 137, deadline(30)).expect("terminate");
    match outcome {
        TerminationOutcome::ExactEmpty { reterminations } => {
            let settled = job.accounting().expect("accounting");
            assert_eq!(settled.active_processes, 0);
            println!(
                "converged after {reterminations} re-terminations; total-ever={} \
                 (every one of those was created inside the authority and reached by \
                 authority-wide force, with no descendant identifier enumerated)",
                settled.total_processes
            );
            // The storm must have produced processes *after* the first terminate, otherwise the
            // bounded re-terminate loop was never exercised and this row would be vacuous.
            assert!(
                reterminations > 0,
                "no re-termination was needed, so the bounded loop was not exercised"
            );
        }
        TerminationOutcome::Timeout { .. } => {
            panic!("termination did not converge within the deadline: {outcome:?}")
        }
    }
}

#[test]
fn deadline_expiry_retains_timeout_and_never_reports_empty() {
    // The contract requires deadline expiry to be `timeout` with authority retained, not a
    // pessimistic empty and not an optimistic one. A zero-length deadline against a live
    // authority is the exact discriminating case.
    let job = JobAuthority::create().expect("job");
    let mut streams = Streams::new();
    let mut root = activation::create_root_suspended(
        &job,
        &shell("ping -n 30 127.0.0.1 > nul"),
        streams.stdio(),
        ActivationMutations::default(),
    )
    .expect("create root");
    root.resume().expect("resume");
    streams.release_child_ends();
    std::thread::sleep(Duration::from_millis(200));

    let outcome = activation::terminate_until_empty(&job, 137, Instant::now())
        .expect("terminate with an expired deadline");
    assert!(
        matches!(outcome, TerminationOutcome::Timeout { .. }),
        "an expired deadline produced {outcome:?} instead of a retained timeout"
    );
    let _ = job.terminate(137);
}

// ---------------------------------------------------------------------------------------------
// 8.4 / 9.1 breakaway, and 8.6 nested authority — driven from inside the Job
// ---------------------------------------------------------------------------------------------

fn run_fixture_in(job: &JobAuthority, role: &str) -> String {
    let mut streams = Streams::new();
    let mut root =
        activation::create_root_suspended(job, &fixture(role), streams.stdio(), ActivationMutations::default())
            .expect("create fixture root");
    root.resume().expect("resume");
    streams.release_child_ends();
    activation::wait_then_read_exit_status(root.process.raw(), 30_000)
        .expect("wait")
        .expect("status");
    streams.read_all()
}

/// Start a fixture inside the authority and read its report while it keeps running.
fn start_fixture_in(job: &JobAuthority, role: &str, needle: &str) -> String {
    let mut streams = Streams::new();
    let mut root = activation::create_root_suspended(
        job,
        &fixture(role),
        streams.stdio(),
        ActivationMutations::default(),
    )
    .expect("create fixture root");
    root.resume().expect("resume");
    streams.release_child_ends();
    let report = streams.read_until(needle);
    std::mem::forget(root);
    report
}

#[test]
fn actual_breakaway_is_refused_by_the_operating_system_and_permitted_when_the_limit_allows_it() {
    // GREEN: with both breakaway permissions clear, a member's `CREATE_BREAKAWAY_FROM_JOB`
    // attempt is refused by the kernel and no process is created outside the authority.
    let contained = JobAuthority::create().expect("job");
    let refused = run_fixture_in(&contained, "breakaway");
    assert!(
        refused.contains("breakaway=refused"),
        "the authority permitted a breakaway: {refused}"
    );
    assert!(
        refused.contains(&format!("os-error={ERROR_ACCESS_DENIED}")),
        "breakaway was refused for the wrong reason: {refused}"
    );

    // RED (task 9.1): enable `JOB_OBJECT_LIMIT_BREAKAWAY_OK` and the identical attempt
    // succeeds, creating a live process outside the authority. Without this the GREEN above
    // would not discriminate between "the kernel refuses breakaway" and "the fixture never
    // asked".
    let permissive = JobAuthority::create_with(JobMutations {
        allow_breakaway: true,
        ..JobMutations::default()
    })
    .expect("job");
    let escaped = run_fixture_in(&permissive, "breakaway");
    assert!(
        escaped.contains("breakaway=created"),
        "the RED did not reproduce; breakaway stayed refused with the permission set: {escaped}"
    );
    let escaped_id = field(&escaped, "pid=").expect("escaped pid");
    assert!(
        !authority_contains(&permissive, escaped_id),
        "the escaping process {escaped_id} was still a member of the permissive authority"
    );
    // And the same question, asked of the contained authority, is what makes the GREEN mean
    // something: there was no process to ask about at all.
    assert!(!refused.contains("pid="), "{refused}");
    let _ = permissive.terminate(1);
}

#[test]
fn actual_nested_job_members_stay_inside_the_outer_authority() {
    let job = JobAuthority::create().expect("job");
    let output = start_fixture_in(&job, "nested-job", "nested=");
    assert!(
        output.contains("nested=created"),
        "the fixture could not create a nested Job: {output}"
    );
    assert!(
        output.contains("in-nested=true"),
        "the descendant is not in the nested Job, so this proves nothing: {output}"
    );

    // The authority itself is asked whether the nested-Job member is one of its own.
    let nested_child = field(&output, "child=").expect("nested child pid");
    assert!(
        authority_contains(&job, nested_child),
        "nested-Job member {nested_child} left the outer authority"
    );

    // The outer authority cannot report empty while nested members live.
    let mut log = Vec::new();
    let saw_zero = drain_until(&job, &mut log, deadline(3), |messages| {
        messages.contains(&MembershipMessage::ActiveProcessZero)
    });
    assert!(
        !saw_zero,
        "the outer authority reported empty with nested members live: {log:?}"
    );
    assert!(job.accounting().expect("accounting").active_processes > 0);

    let outcome = activation::terminate_until_empty(&job, 137, deadline(20)).expect("terminate");
    assert!(
        matches!(outcome, TerminationOutcome::ExactEmpty { .. }),
        "outer termination did not reach the nested hierarchy: {outcome:?}"
    );
}

// ---------------------------------------------------------------------------------------------
// 9.3 completion-port ordering
// ---------------------------------------------------------------------------------------------

#[test]
fn actual_late_port_association_still_announces_members_that_are_currently_alive() {
    // **Design correction, measured rather than assumed.** `design.md` Decision 3 states that
    // associating the completion port after a member exists "silently loses that member's
    // NEW_PROCESS message". On this kernel that is **not** what happens: associating the port
    // to a Job that already has live members announces each of them with a `NEW_PROCESS`
    // message at association time. The design's stated mechanism does not reproduce.
    //
    // This test records what the kernel actually does, so that nobody later reads the design
    // sentence as an established fact. The real hazard is the sibling test below.
    let mut job = JobAuthority::create_with(JobMutations {
        associate_port_late: true,
        ..JobMutations::default()
    })
    .expect("job");
    assert!(!job.attestation().port_was_associated_on_an_empty_job());

    let mut streams = Streams::new();
    let mut root = activation::create_root_suspended(
        &job,
        &shell("ping -n 6 127.0.0.1 > nul"),
        streams.stdio(),
        ActivationMutations::default(),
    )
    .expect("create root");
    let root_id = root.process_id;
    root.resume().expect("resume");
    streams.release_child_ends();
    assert!(job.accounting().expect("accounting").active_processes >= 1);

    job.associate_port().expect("late association");
    assert!(
        !job.attestation().port_was_associated_on_an_empty_job(),
        "late association was not visible in the attestation"
    );
    assert!(
        job.attestation().active_processes_after_port_association >= 1,
        "the attestation did not record that a member already existed"
    );

    let mut log = Vec::new();
    drain_until(&job, &mut log, deadline(25), |messages| {
        messages.contains(&MembershipMessage::ActiveProcessZero)
    });
    assert!(
        log.contains(&MembershipMessage::NewProcess(root_id)),
        "this kernel did not announce the live member at association time: {log:?}"
    );
}

#[test]
fn red_a_member_that_exits_before_the_port_is_associated_is_lost_and_empty_never_arrives() {
    // This is the loss that **is** real, and it is why the port must be associated while the
    // Job is empty. A member that has already departed cannot be announced retroactively, and
    // the `ACTIVE_PROCESS_ZERO` transition it caused has already happened — so the exact-empty
    // oracle can never fire for that authority, no matter how long it waits.
    //
    // The GREEN counterpart is `actual_natural_empty_comes_from_the_active_process_zero_message`,
    // where the same workload, on a port associated while empty, does deliver the message.
    let mut job = JobAuthority::create_with(JobMutations {
        associate_port_late: true,
        ..JobMutations::default()
    })
    .expect("job");

    let mut streams = Streams::new();
    let mut root = activation::create_root_suspended(
        &job,
        &shell("exit /b 0"),
        streams.stdio(),
        ActivationMutations::default(),
    )
    .expect("create root");
    let root_id = root.process_id;
    root.resume().expect("resume");
    streams.release_child_ends();
    activation::wait_then_read_exit_status(root.process.raw(), 20_000)
        .expect("wait")
        .expect("status");
    // Let the authority actually reach zero before the port exists.
    let until = Instant::now() + Duration::from_secs(10);
    while Instant::now() < until && job.accounting().expect("accounting").active_processes > 0 {
        std::thread::sleep(Duration::from_millis(25));
    }
    assert_eq!(
        job.accounting().expect("accounting").active_processes,
        0,
        "the authority never emptied, so the RED would be measuring the wrong thing"
    );

    job.associate_port().expect("late association");

    let mut log = Vec::new();
    let saw_zero = drain_until(&job, &mut log, deadline(4), |messages| {
        messages.contains(&MembershipMessage::ActiveProcessZero)
    });
    assert!(
        !saw_zero,
        "the RED did not reproduce: a port associated after the authority emptied still \
         delivered the empty message: {log:?}"
    );
    assert!(
        !log.contains(&MembershipMessage::NewProcess(root_id)),
        "a departed member was announced retroactively: {log:?}"
    );
    assert!(
        log.is_empty(),
        "expected a permanently silent event stream, observed {log:?}"
    );
    // Accounting says zero, but accounting is corroboration and never the oracle — which is
    // exactly why this authority must be rejected rather than observed.
    assert!(job.accounting().expect("accounting").corroborates_empty());
}

// ---------------------------------------------------------------------------------------------
// Gated fixture entry point — asserts nothing, runs inside the authority
// ---------------------------------------------------------------------------------------------

#[test]
fn fixture_entrypoint() {
    let role = match std::env::var("RWPA_FIXTURE") {
        Ok(role) => role,
        Err(_) => return,
    };
    match role.as_str() {
        "breakaway" => fixture_breakaway(),
        "nested-job" => fixture_nested_job(),
        // A set-but-unrecognised role is the one path that could pass silently: the fixture
        // would exit 0 having done nothing. Panic instead, so a renamed role fails here rather
        // than turning its consumer's assertion into a mystery about empty output.
        other => panic!("unknown fixture role {other}"),
    }
    use std::io::Write;
    std::io::stdout().flush().expect("flush");
    // Leave promptly so the harness is never waiting on this process.
    std::process::exit(0);
}

/// Attempt to create a process that breaks away from the authority.
fn fixture_breakaway() {
    use std::mem::{size_of, zeroed};
    use std::ptr::null_mut;

    let application = win::wide(COMSPEC);
    let mut command_line = win::wide("cmd.exe /c ping -n 8 127.0.0.1 > nul");
    let mut startup: StartupInfoW = unsafe { zeroed() };
    startup.cb = size_of::<StartupInfoW>() as Dword;
    let mut information: ProcessInformation = unsafe { zeroed() };
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
    if created == FALSE {
        println!(
            "breakaway=refused os-error={}",
            std::io::Error::last_os_error().raw_os_error().unwrap_or(0)
        );
        return;
    }
    // Report only the identifier. Whether it escaped **our** authority is a question only the
    // holder of that authority can answer: `IsProcessInJob(handle, NULL)` asks whether the
    // process is in *any* Job, and the test runner itself is frequently inside an ambient one,
    // so it answers TRUE for a process that did break away. The parent checks membership
    // against the actual Job handle.
    println!("breakaway=created pid={}", information.process_id);
    unsafe { CloseHandle(information.thread) };
    unsafe { CloseHandle(information.process) };
}

/// Create a nested Job Object and place a live descendant inside it.
fn fixture_nested_job() {
    use std::ffi::c_void;
    use std::mem::{size_of, zeroed};
    use std::ptr::{null, null_mut};

    let nested = unsafe { CreateJobObjectW(null_mut(), null()) };
    if nested.is_null() {
        println!("nested=unavailable");
        return;
    }
    let mut limits = JobObjectExtendedLimitInformation::default();
    limits.basic_limit_information.limit_flags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    unsafe {
        SetInformationJobObject(
            nested,
            JOB_OBJECT_EXTENDED_LIMIT_INFORMATION,
            &limits as *const _ as *const c_void,
            size_of::<JobObjectExtendedLimitInformation>() as Dword,
        )
    };

    let mut bytes = 0_usize;
    unsafe { InitializeProcThreadAttributeList(null_mut(), 1, 0, &mut bytes) };
    let mut storage = vec![0_u8; bytes];
    let list = storage.as_mut_ptr() as *mut c_void;
    unsafe { InitializeProcThreadAttributeList(list, 1, 0, &mut bytes) };
    let mut nested_handle = nested;
    unsafe {
        UpdateProcThreadAttribute(
            list,
            0,
            PROC_THREAD_ATTRIBUTE_JOB_LIST,
            &mut nested_handle as *mut _ as *mut c_void,
            size_of::<Handle>(),
            null_mut(),
            null_mut(),
        )
    };

    let application = win::wide(COMSPEC);
    let mut command_line = win::wide("cmd.exe /c ping -n 25 127.0.0.1 > nul");
    let mut startup: StartupInfoExW = unsafe { zeroed() };
    startup.startup.cb = size_of::<StartupInfoExW>() as Dword;
    startup.attributes = list;
    let mut information: ProcessInformation = unsafe { zeroed() };
    let created = unsafe {
        CreateProcessW(
            application.as_ptr(),
            command_line.as_mut_ptr(),
            null_mut(),
            null_mut(),
            FALSE,
            CREATE_NO_WINDOW | EXTENDED_STARTUPINFO_PRESENT,
            null_mut(),
            null_mut(),
            &mut startup.startup,
            &mut information,
        )
    };
    unsafe { DeleteProcThreadAttributeList(list) };
    if created == FALSE {
        println!(
            "nested=child-refused os-error={}",
            std::io::Error::last_os_error().raw_os_error().unwrap_or(0)
        );
        return;
    }
    let mut in_nested: Bool = FALSE;
    unsafe { IsProcessInJob(information.process, nested, &mut in_nested) };
    println!(
        "nested=created child={} in-nested={}",
        information.process_id,
        in_nested != FALSE
    );
    use std::io::Write;
    std::io::stdout().flush().expect("flush");
    unsafe { CloseHandle(information.thread) };
    unsafe { CloseHandle(information.process) };
    // Stay alive while the parent inspects. The nested Job carries KILL_ON_JOB_CLOSE and this
    // process holds its only handle, so exiting here would destroy the nested descendant and
    // there would be nothing left to observe.
    std::thread::sleep(Duration::from_secs(12));
}
