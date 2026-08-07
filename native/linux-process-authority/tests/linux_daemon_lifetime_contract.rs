#![cfg(target_os = "linux")]
//! Daemon-lifetime teardown: the scope lives exactly as long as the daemon that owns it.
//!
//! The oracle runs the real three-process topology rather than a stand-in. A DAEMON process owns
//! one endpoint of a lifetime channel and nothing else holds it; it spawns a HELPER process that
//! inherits the peer endpoint, prepares and activates a real user+PID+mount namespace scope, and
//! then exits. The workload root forks descendants that deliberately resist ordinary termination
//! (`setsid`, double fork, nested PID namespace). The test then ends the daemon - by killing it,
//! and separately by making it close only its endpoint while staying alive - and requires that no
//! workload process survives while an unrelated process outside the scope does.
//!
//! Every "did it die?" assertion is paired with a positive liveness marker taken before the
//! teardown, so an empty result cannot be produced by a workload that never ran.

use std::collections::BTreeMap;
use std::ffi::CString;
use std::fs;
use std::os::fd::RawFd;
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use rasen_linux_process_authority::primary::{
    current_executable_digest, prepare_primary_with_daemon_lifetime_ms,
    DAEMON_LIFETIME_ENDPOINT_ABSENT,
};
use rasen_linux_process_authority::protocol::{LaunchSpec, PrepareRequest};

mod support;

/// Descriptor number the daemon hands its lifetime endpoint to the helper on.
const LIFETIME_ENDPOINT_FD: RawFd = 3;
/// How long every survivor candidate waits before recording that it outlived the teardown.
const ESCAPE_AFTER: Duration = Duration::from_secs(6);
/// Slack added after `ESCAPE_AFTER` before the absence assertions are taken.
const ESCAPE_SLACK: Duration = Duration::from_secs(4);
/// Bound on every "wait for a marker" step.
const MARKER_TIMEOUT: Duration = Duration::from_secs(45);

const LIVE_MARKERS: [&str; 3] = ["live-root", "live-setsid", "live-doublefork"];
const ESCAPE_MARKERS: [&str; 3] = ["escaped-root", "escaped-setsid", "escaped-doublefork"];
/// The nested pair report by content, not by existence - see `Scene::state_contains`.
const NESTED_STATE_FILES: [&str; 2] = ["nested-init.state", "nested-child.state"];

// ---------------------------------------------------------------------------------------------
// Oracles
// ---------------------------------------------------------------------------------------------

/// Variant 1: the owning daemon is killed outright. Its endpoint closes because the process is
/// gone, which is the production failure this requirement exists for.
#[test]
fn owning_daemon_death_tears_down_every_resistant_descendant() {
    let scene = Scene::start("dlk", DaemonMode::Killed);
    scene.require_scope_live();
    let unrelated_started = Instant::now();
    scene.end_the_daemon();
    scene.settle(unrelated_started);
    scene.require_zero_workload_orphans();
    scene.require_unrelated_process_survived();
    scene.finish();
}

/// Variant 2: the daemon closes only its endpoint and stays alive. This separates the mechanism
/// from process parenthood: nothing about the daemon's own death can explain this teardown, and a
/// `PR_SET_PDEATHSIG`-shaped implementation would not fire here at all.
#[test]
fn closing_only_the_daemon_endpoint_tears_down_every_resistant_descendant() {
    let mut scene = Scene::start("dlc", DaemonMode::EndpointClosedOnly);
    scene.require_scope_live();
    let unrelated_started = Instant::now();
    scene.end_the_daemon();
    scene.settle(unrelated_started);
    scene.require_zero_workload_orphans();
    scene.require_unrelated_process_survived();
    scene.require_daemon_still_alive();
    scene.finish();
}

// ---------------------------------------------------------------------------------------------
// Deterministic state-machine coverage of the endpoint contract
// ---------------------------------------------------------------------------------------------

/// A named endpoint that is not an open descriptor above stdio is refused, so a caller that
/// intends the binding can never be handed a scope whose binding is vacuous.
#[test]
fn a_malformed_daemon_lifetime_endpoint_is_refused_before_any_namespace_is_built() {
    let (parent, runtime, cwd) = create_runtime_and_cwd("dlv");
    let artifact = current_executable_digest().unwrap();
    for (endpoint, reason) in [
        (0 as RawFd, "above standard stdio"),
        (2 as RawFd, "above standard stdio"),
        (closed_descriptor(), "open inherited descriptor"),
    ] {
        let outcome = prepare_primary_with_daemon_lifetime_ms(
            inert_request(&runtime, &cwd),
            artifact,
            [0x4d; 32],
            10_000,
            endpoint,
        );
        let Err(error) = outcome else {
            panic!("a malformed daemon-lifetime endpoint must not prepare a scope")
        };
        assert!(
            error.to_string().contains(reason),
            "endpoint {endpoint} was refused for the wrong reason: {error}"
        );
    }
    assert_eq!(
        fs::read_dir(&runtime).unwrap().count(),
        0,
        "a refused endpoint must leave no scope state behind"
    );
    fs::remove_dir_all(parent).unwrap();
}

/// The absent sentinel keeps the pre-Section-12 behaviour exactly: a scope with no daemon-lifetime
/// binding still prepares, activates and reaches its own terminal state. This is what makes the
/// teardown a binding a caller opts into rather than a change of the existing lifecycle.
#[test]
fn an_absent_endpoint_leaves_the_existing_lifecycle_unchanged() {
    let (parent, runtime, cwd) = create_runtime_and_cwd("dla");
    let prepared = prepare_primary_with_daemon_lifetime_ms(
        inert_request(&runtime, &cwd),
        current_executable_digest().unwrap(),
        [0x4e; 32],
        10_000,
        DAEMON_LIFETIME_ENDPOINT_ABSENT,
    )
    .expect("an absent endpoint must still prepare an inert scope");
    // `inert` is the native helper's own state name; mapping it to prepared or published is the
    // ledger's job above this seam, so this test asserts what the crate actually reports.
    assert_eq!(
        prepared.client().unwrap().inspect().unwrap().to_string(),
        "inert"
    );
    prepared.client().unwrap().abort(2_000).unwrap();
    assert_eq!(
        prepared.client().unwrap().inspect().unwrap().to_string(),
        "exact-scope-empty"
    );
    fs::remove_dir_all(parent).unwrap();
}

// ---------------------------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------------------------

#[derive(Clone, Copy, Eq, PartialEq)]
enum DaemonMode {
    Killed,
    EndpointClosedOnly,
}

impl DaemonMode {
    fn as_env(self) -> &'static str {
        match self {
            DaemonMode::Killed => "killed",
            DaemonMode::EndpointClosedOnly => "endpoint-closed-only",
        }
    }
}

struct Scene {
    mode: DaemonMode,
    parent: PathBuf,
    markers: PathBuf,
    daemon: Child,
    unrelated: Child,
}

impl Scene {
    fn start(label: &str, mode: DaemonMode) -> Self {
        let (parent, runtime, cwd) = create_runtime_and_cwd(label);
        let markers = cwd.clone();
        let unrelated = Command::new(current_test_executable())
            .args(["--exact", "unrelated_bystander_fixture", "--nocapture"])
            .env("RPA_DL_MARKERS", &markers)
            .stdin(Stdio::null())
            .stdout(diagnostic_log(&markers, "unrelated"))
            .stderr(diagnostic_log(&markers, "unrelated"))
            .spawn()
            .expect("the unrelated bystander must start");
        let daemon = Command::new(current_test_executable())
            .args(["--exact", "owning_daemon_fixture", "--nocapture"])
            .env("RPA_DL_MARKERS", &markers)
            .env("RPA_DL_RUNTIME", &runtime)
            .env("RPA_DL_CWD", &cwd)
            .env("RPA_DL_MODE", mode.as_env())
            .env("RPA_DL_HELPER", current_test_executable())
            .stdin(Stdio::null())
            .stdout(diagnostic_log(&markers, "daemon"))
            .stderr(diagnostic_log(&markers, "daemon"))
            .spawn()
            .expect("the owning daemon must start");
        Scene {
            mode,
            parent,
            markers,
            daemon,
            unrelated,
        }
    }

    fn marker(&self, name: &str) -> PathBuf {
        self.markers.join(name)
    }

    /// Positive control. Nothing below means anything unless the whole resistant workload really
    /// reached a live state first, and unless the daemon really owns the endpoint alone.
    fn require_scope_live(&self) {
        self.wait_for("unrelated-live");
        self.wait_for("daemon-ready");
        assert!(
            !self.marker("nested-unavailable").exists(),
            "nested PID namespace creation failed inside the scope: {}",
            fs::read_to_string(self.marker("nested-unavailable")).unwrap_or_default()
        );
        for name in LIVE_MARKERS {
            self.wait_for(name);
        }
        for name in NESTED_STATE_FILES {
            self.wait_for_state(name, "live");
        }
        for name in ESCAPE_MARKERS {
            assert!(
                !self.marker(name).exists(),
                "{name} was recorded before the teardown was triggered"
            );
        }
        for name in NESTED_STATE_FILES {
            assert!(
                !self.state_contains(name, "escaped"),
                "{name} recorded an escape before the teardown was triggered"
            );
        }
    }

    fn end_the_daemon(&self) {
        match self.mode {
            DaemonMode::Killed => {
                assert_eq!(
                    unsafe { libc::kill(self.daemon.id() as libc::pid_t, libc::SIGKILL) },
                    0,
                    "the owning daemon must be killable"
                );
            }
            DaemonMode::EndpointClosedOnly => {
                fs::write(self.marker("close-endpoint"), b"close").unwrap();
                self.wait_for("daemon-endpoint-closed");
            }
        }
    }

    /// Wait past the point at which every survivor candidate would have recorded its escape.
    fn settle(&self, started: Instant) {
        let target = started + ESCAPE_AFTER + ESCAPE_SLACK;
        while Instant::now() < target {
            thread::sleep(Duration::from_millis(100));
        }
    }

    fn require_zero_workload_orphans(&self) {
        let mut escaped: Vec<&str> = ESCAPE_MARKERS
            .into_iter()
            .filter(|name| self.marker(name).exists())
            .collect();
        escaped.extend(
            NESTED_STATE_FILES
                .into_iter()
                .filter(|name| self.state_contains(name, "escaped")),
        );
        assert!(
            escaped.is_empty(),
            "workload processes outlived the owning daemon: {escaped:?}"
        );
    }

    /// The nested pair report by appending to descriptors opened before they entered their nested
    /// user namespace, so their state is the file's content and never its existence.
    fn state_contains(&self, name: &str, needle: &str) -> bool {
        fs::read_to_string(self.marker(name))
            .unwrap_or_default()
            .contains(needle)
    }

    fn wait_for_state(&self, name: &str, needle: &str) {
        let deadline = Instant::now() + MARKER_TIMEOUT;
        while !self.state_contains(name, needle) {
            assert!(
                Instant::now() < deadline,
                "{name} never reported {needle}; recorded markers: {:?}",
                recorded_markers(&self.markers)
            );
            thread::sleep(Duration::from_millis(25));
        }
    }

    fn require_unrelated_process_survived(&self) {
        assert!(
            self.marker("unrelated-survived").exists(),
            "an unrelated process outside the scope was affected by the teardown"
        );
    }

    /// Two independent checks, because either alone is weak. `try_wait` is race-free but a zombie
    /// would still answer a bare signal probe, and the marker proves the daemon was actually
    /// running code after the teardown rather than merely un-reaped.
    fn require_daemon_still_alive(&mut self) {
        let exited = self.daemon.try_wait().expect("the daemon must be waitable");
        assert!(
            exited.is_none(),
            "the daemon exited ({exited:?}) instead of surviving the close, so this variant \
             proved nothing beyond the kill variant"
        );
        assert!(
            self.marker("daemon-alive-after-close").exists(),
            "the daemon never recorded running past the teardown it caused"
        );
    }

    fn wait_for(&self, name: &str) {
        let path = self.marker(name);
        let deadline = Instant::now() + MARKER_TIMEOUT;
        while !path.exists() {
            assert!(
                Instant::now() < deadline,
                "marker {name} never appeared; recorded markers: {:?}",
                recorded_markers(&self.markers)
            );
            thread::sleep(Duration::from_millis(25));
        }
    }

    fn finish(mut self) {
        let _ = unsafe { libc::kill(self.daemon.id() as libc::pid_t, libc::SIGKILL) };
        let _ = self.daemon.wait();
        let _ = unsafe { libc::kill(self.unrelated.id() as libc::pid_t, libc::SIGKILL) };
        let _ = self.unrelated.wait();
        let _ = fs::remove_dir_all(&self.parent);
    }
}

/// Fixture children never inherit the test harness's own stdout or stderr. A long-lived child
/// holding the harness pipe keeps that pipe open after the harness exits, which reads to whatever
/// is consuming the run as a hang rather than as a result. Their output goes to files beside the
/// markers instead, so diagnostics survive without anybody waiting on them.
fn diagnostic_log(markers: &Path, name: &str) -> Stdio {
    Stdio::from(
        fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(markers.join(format!("{name}.log")))
            .expect("fixture diagnostics must be writable"),
    )
}

fn recorded_markers(directory: &Path) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(directory)
        .map(|entries| {
            entries
                .flatten()
                .map(|entry| entry.file_name().to_string_lossy().into_owned())
                .collect()
        })
        .unwrap_or_default();
    names.sort();
    names
}

// ---------------------------------------------------------------------------------------------
// Fixtures - re-executions of this test binary that play the daemon, the helper, the workload and
// the unrelated bystander. Each returns immediately when its environment is absent, so an ordinary
// `cargo test` run executes them as no-ops.
// ---------------------------------------------------------------------------------------------

/// The owning daemon. It creates the lifetime channel, hands one endpoint to the helper it spawns,
/// and is then the only holder of the peer endpoint for the rest of the scope's life.
#[test]
fn owning_daemon_fixture() {
    let (Ok(markers), Ok(runtime), Ok(cwd), Ok(mode), Ok(helper)) = (
        std::env::var("RPA_DL_MARKERS"),
        std::env::var("RPA_DL_RUNTIME"),
        std::env::var("RPA_DL_CWD"),
        std::env::var("RPA_DL_MODE"),
        std::env::var("RPA_DL_HELPER"),
    ) else {
        return;
    };
    let markers = PathBuf::from(markers);

    let mut endpoints = [0 as RawFd; 2];
    assert_eq!(
        unsafe { libc::pipe2(endpoints.as_mut_ptr(), libc::O_CLOEXEC) },
        0,
        "the daemon must be able to create its lifetime channel"
    );
    let (helper_endpoint, daemon_endpoint) = (endpoints[0], endpoints[1]);

    let mut child = {
        let mut command = Command::new(&helper);
        command
            .args(["--exact", "preparing_helper_fixture", "--nocapture"])
            .env("RPA_DLH_MARKERS", &markers)
            .env("RPA_DLH_RUNTIME", &runtime)
            .env("RPA_DLH_CWD", &cwd)
            .stdin(Stdio::null())
            .stdout(diagnostic_log(&markers, "helper"))
            .stderr(diagnostic_log(&markers, "helper"));
        unsafe {
            command.pre_exec(move || {
                if libc::dup2(helper_endpoint, LIFETIME_ENDPOINT_FD) < 0 {
                    return Err(std::io::Error::last_os_error());
                }
                // `dup2` onto the same number is a no-op, so the inheritable flag is cleared
                // explicitly rather than assumed.
                if libc::fcntl(LIFETIME_ENDPOINT_FD, libc::F_SETFD, 0) < 0 {
                    return Err(std::io::Error::last_os_error());
                }
                Ok(())
            });
        }
        command.spawn().expect("the helper must start")
    };
    // From here the guardian and this daemon hold the two endpoints, and nothing else does.
    unsafe { libc::close(helper_endpoint) };
    let status = child.wait().expect("the helper must be waitable");

    fs::write(
        markers.join("daemon-ready"),
        format!("daemon {} helper {status}\n", std::process::id()),
    )
    .unwrap();

    if mode == "endpoint-closed-only" {
        let trigger = markers.join("close-endpoint");
        while !trigger.exists() {
            thread::sleep(Duration::from_millis(25));
        }
        assert_eq!(
            unsafe { libc::close(daemon_endpoint) },
            0,
            "the daemon must be able to release its endpoint"
        );
        fs::write(markers.join("daemon-endpoint-closed"), b"closed").unwrap();
        // Deliberately the same window the orphan candidates get, and strictly shorter than the
        // test's settle deadline: the daemon's survival and the workload's death are then measured
        // on one clock, and the marker cannot race the assertion that reads it.
        thread::sleep(ESCAPE_AFTER);
        fs::write(markers.join("daemon-alive-after-close"), b"alive").unwrap();
    }
    loop {
        thread::sleep(Duration::from_secs(1));
    }
}

/// The preparing helper. It receives the guardian's endpoint by inheritance, builds the real
/// namespace scope, activates it, waits until the resistant workload is provably live, and exits -
/// exactly as a short-lived control helper does in production.
#[test]
fn preparing_helper_fixture() {
    let (Ok(markers), Ok(runtime), Ok(cwd)) = (
        std::env::var("RPA_DLH_MARKERS"),
        std::env::var("RPA_DLH_RUNTIME"),
        std::env::var("RPA_DLH_CWD"),
    ) else {
        return;
    };
    let markers = PathBuf::from(&markers);
    let mut env = BTreeMap::from([("LANG".to_owned(), "C.UTF-8".to_owned())]);
    env.insert("RPA_DLW_MARKERS".to_owned(), markers.display().to_string());
    let prepared = prepare_primary_with_daemon_lifetime_ms(
        PrepareRequest {
            operation_id: "prepare-daemon-lifetime".to_owned(),
            runtime_root: PathBuf::from(&runtime),
            launch: LaunchSpec {
                command: current_test_executable(),
                cwd: PathBuf::from(&cwd),
                args: vec![
                    "--exact".to_owned(),
                    "resistant_workload_fixture".to_owned(),
                    "--nocapture".to_owned(),
                ],
                env,
            },
        },
        current_executable_digest().unwrap(),
        [0x4c; 32],
        30_000,
        LIFETIME_ENDPOINT_FD,
    )
    .expect("the helper must prepare a daemon-bound scope");
    let runtime_channel = prepared.client().unwrap().open_runtime().unwrap();
    prepared.client().unwrap().activate().unwrap();
    let deadline = Instant::now() + MARKER_TIMEOUT;
    let workload_is_live = || {
        LIVE_MARKERS
            .into_iter()
            .all(|name| markers.join(name).exists())
            && NESTED_STATE_FILES.into_iter().all(|name| {
                fs::read_to_string(markers.join(name))
                    .unwrap_or_default()
                    .contains("live")
            })
    };
    while !workload_is_live() {
        assert!(
            Instant::now() < deadline && !markers.join("nested-unavailable").exists(),
            "the resistant workload did not reach a live state"
        );
        thread::sleep(Duration::from_millis(25));
    }
    // The helper leaves. Only the daemon's endpoint now stands between the scope and teardown.
    drop(runtime_channel);
}

/// The scope root. It stays alive and forks the three descendants that resist ordinary
/// termination, then records its own survival if it is still running after the escape window.
#[test]
fn resistant_workload_fixture() {
    let Ok(markers) = std::env::var("RPA_DLW_MARKERS") else {
        return;
    };
    let markers = PathBuf::from(markers);
    let paths = MarkerPaths::build(&markers);

    fork_child(|| {
        // setsid: a new session and process group, immune to any group-directed signal.
        unsafe { libc::setsid() };
        record(&paths.live_setsid);
        wait_out_escape_window();
        record(&paths.escaped_setsid);
    });

    fork_child(|| {
        // Double fork: the grandchild is orphaned immediately and reparented to namespace init.
        let grandchild = unsafe { libc::fork() };
        if grandchild != 0 {
            unsafe { libc::_exit(0) }
        }
        unsafe { libc::setsid() };
        record(&paths.live_doublefork);
        wait_out_escape_window();
        record(&paths.escaped_doublefork);
    });

    fork_child(|| {
        // Nested PID namespace: its init is not a descendant the outer authority can signal
        // individually, and its children are invisible from the outer namespace's process table.
        //
        // The authority drops the capability bounding set, calls `capset` and sets
        // `NO_NEW_PRIVS` before launching the workload (`drop_workload_privileges`), so the
        // workload holds no `CAP_SYS_ADMIN` and `CLONE_NEWPID` alone is refused. An unprivileged
        // user namespace needs no capability and grants a full set inside itself, which is the
        // ordinary way a confined process nests namespaces - and the crate's own comment names it
        // as the retained shape - so that is what this branch does.
        //
        // Inside that nested user namespace this process is unmapped, and re-mapping its identity
        // is not needed: filesystem permission is decided at `open`, so both nested processes
        // report through descriptors opened out here, before the `unshare`. Their state is the
        // file's CONTENT rather than its existence, because the file exists from the moment it is
        // opened.
        let states = match NestedStateFiles::open(&paths) {
            Some(states) => states,
            None => {
                record_text(&paths.nested_unavailable, "nested state files unavailable");
                unsafe { libc::_exit(0) }
            }
        };
        let mut report = [0 as RawFd; 2];
        if unsafe { libc::pipe2(report.as_mut_ptr(), libc::O_CLOEXEC) } < 0 {
            record_text(&paths.nested_unavailable, "report pipe unavailable");
            unsafe { libc::_exit(0) }
        }
        let nested = unsafe { libc::fork() };
        if nested == 0 {
            unsafe { libc::close(report[0]) };
            enter_nested_namespaces(report[1]);
            append(states.init, NESTED_LIVE);
            let nested_child = unsafe { libc::fork() };
            if nested_child == 0 {
                append(states.child, NESTED_LIVE);
                wait_out_escape_window();
                append(states.child, NESTED_ESCAPED);
                unsafe { libc::_exit(0) }
            }
            wait_out_escape_window();
            append(states.init, NESTED_ESCAPED);
            unsafe { libc::_exit(0) }
        }
        unsafe { libc::close(report[1]) };
        report_nested_failure(&paths, report[0]);
    });

    record(&paths.live_root);
    wait_out_escape_window();
    record(&paths.escaped_root);
}

/// A process outside the scope entirely. Its survival is what separates "the scope was torn down"
/// from "something killed everything in sight".
#[test]
fn unrelated_bystander_fixture() {
    let Ok(markers) = std::env::var("RPA_DL_MARKERS") else {
        return;
    };
    let markers = PathBuf::from(markers);
    fs::create_dir_all(&markers).unwrap();
    fs::write(markers.join("unrelated-live"), b"live").unwrap();
    thread::sleep(ESCAPE_AFTER);
    fs::write(markers.join("unrelated-survived"), b"survived").unwrap();
    thread::sleep(ESCAPE_AFTER + ESCAPE_SLACK);
}

// ---------------------------------------------------------------------------------------------
// Fork-safe fixture primitives
// ---------------------------------------------------------------------------------------------

struct MarkerPaths {
    live_root: CString,
    escaped_root: CString,
    live_setsid: CString,
    escaped_setsid: CString,
    live_doublefork: CString,
    escaped_doublefork: CString,
    nested_init_state: CString,
    nested_child_state: CString,
    nested_unavailable: CString,
}

impl MarkerPaths {
    /// Every path is converted before the first `fork`, so the forked children only ever call
    /// async-signal-safe libc functions on already-built buffers.
    fn build(markers: &Path) -> Self {
        let at = |name: &str| CString::new(markers.join(name).display().to_string()).unwrap();
        MarkerPaths {
            live_root: at("live-root"),
            escaped_root: at("escaped-root"),
            live_setsid: at("live-setsid"),
            escaped_setsid: at("escaped-setsid"),
            live_doublefork: at("live-doublefork"),
            escaped_doublefork: at("escaped-doublefork"),
            nested_init_state: at("nested-init.state"),
            nested_child_state: at("nested-child.state"),
            nested_unavailable: at("nested-unavailable"),
        }
    }
}

/// Descriptors the nested processes report through. They are opened before the `unshare`, because
/// inside an unmapped nested user namespace no new `open` under the marker directory would be
/// permitted, while writes to an already-open descriptor are unaffected.
#[derive(Clone, Copy)]
struct NestedStateFiles {
    init: RawFd,
    child: RawFd,
}

impl NestedStateFiles {
    fn open(paths: &MarkerPaths) -> Option<Self> {
        let init = open_state_file(&paths.nested_init_state)?;
        let child = open_state_file(&paths.nested_child_state)?;
        Some(NestedStateFiles { init, child })
    }
}

fn open_state_file(path: &CString) -> Option<RawFd> {
    let descriptor = unsafe {
        libc::open(
            path.as_ptr(),
            libc::O_WRONLY | libc::O_CREAT | libc::O_TRUNC | libc::O_APPEND | libc::O_CLOEXEC,
            0o600,
        )
    };
    if descriptor < 0 {
        None
    } else {
        Some(descriptor)
    }
}

const NESTED_LIVE: &[u8] = b"live\n";
const NESTED_ESCAPED: &[u8] = b"escaped\n";

fn append(descriptor: RawFd, bytes: &[u8]) {
    unsafe {
        libc::write(descriptor, bytes.as_ptr().cast(), bytes.len());
    }
}

/// Stage identifiers reported back through the nested branch's private pipe, for the steps that
/// happen where no marker can be written.
const NESTED_STAGE_UNSHARE: u8 = 1;
const NESTED_STAGE_FORK: u8 = 2;

/// Enter a nested user + PID namespace. On failure the stage and errno go down `report` and this
/// process leaves without pretending to be nested, so the caller only ever continues as a genuine
/// nested init.
fn enter_nested_namespaces(report: RawFd) {
    let fail = |stage: u8| -> ! {
        let errno = unsafe { *libc::__errno_location() } as u8;
        unsafe {
            libc::write(report, [stage, errno].as_ptr().cast(), 2);
            libc::_exit(0)
        }
    };
    if unsafe { libc::unshare(libc::CLONE_NEWUSER | libc::CLONE_NEWPID) } < 0 {
        fail(NESTED_STAGE_UNSHARE);
    }
    // The `unshare` above puts children, not this process, into the new PID namespace.
    let nested_init = unsafe { libc::fork() };
    if nested_init < 0 {
        fail(NESTED_STAGE_FORK);
    }
    if nested_init != 0 {
        unsafe { libc::_exit(0) }
    }
    unsafe { libc::close(report) };
}

/// Wait briefly for the nested branch to report a failure. Silence is not read as success - the
/// `live` content in the nested state files is what proves the nested namespace exists - but a
/// reported failure turns an unexplained timeout into a named cause.
fn report_nested_failure(paths: &MarkerPaths, report: RawFd) {
    let mut descriptor = libc::pollfd {
        fd: report,
        events: libc::POLLIN,
        revents: 0,
    };
    let polled = unsafe { libc::poll(&mut descriptor, 1, 5_000) };
    if polled <= 0 || descriptor.revents & libc::POLLIN == 0 {
        return;
    }
    let mut reported = [0_u8; 2];
    if unsafe { libc::read(report, reported.as_mut_ptr().cast(), 2) } != 2 {
        return;
    }
    record_text(
        &paths.nested_unavailable,
        &format!(
            "nested stage {} failed with errno {}",
            reported[0], reported[1]
        ),
    );
}

fn fork_child(body: impl FnOnce()) {
    let child = unsafe { libc::fork() };
    assert!(child >= 0, "the workload must be able to fork");
    if child == 0 {
        body();
        unsafe { libc::_exit(0) }
    }
}

fn record(path: &CString) {
    record_bytes(path, b"x");
}

fn record_text(path: &CString, text: &str) {
    record_bytes(path, text.as_bytes());
}

fn record_bytes(path: &CString, bytes: &[u8]) {
    let descriptor = unsafe {
        libc::open(
            path.as_ptr(),
            libc::O_WRONLY | libc::O_CREAT | libc::O_TRUNC | libc::O_CLOEXEC,
            0o600,
        )
    };
    if descriptor >= 0 {
        unsafe {
            libc::write(descriptor, bytes.as_ptr().cast(), bytes.len());
            libc::close(descriptor);
        }
    }
}

fn wait_out_escape_window() {
    let mut remaining = ESCAPE_AFTER.as_millis() as u64;
    while remaining > 0 {
        let slice = remaining.min(200);
        unsafe { libc::usleep((slice * 1_000) as libc::useconds_t) };
        remaining -= slice;
    }
}

// ---------------------------------------------------------------------------------------------
// Shared scaffolding
// ---------------------------------------------------------------------------------------------

fn current_test_executable() -> PathBuf {
    fs::canonicalize(std::env::current_exe().unwrap()).unwrap()
}

fn create_runtime_and_cwd(label: &str) -> (PathBuf, PathBuf, PathBuf) {
    use std::os::unix::fs::PermissionsExt;
    let parent = support::short_private_root(label);
    let runtime = parent.join("runtime");
    let cwd = parent.join("workload");
    fs::create_dir_all(&runtime).unwrap();
    fs::create_dir_all(&cwd).unwrap();
    fs::set_permissions(&runtime, fs::Permissions::from_mode(0o700)).unwrap();
    fs::set_permissions(&cwd, fs::Permissions::from_mode(0o700)).unwrap();
    (parent, runtime, cwd)
}

/// A launch the authority accepts: the canonical test executable, invoked on a fixture that is a
/// no-op without its environment. Launch validation refuses any path with a symlinked component,
/// so a convenience path like `/bin/true` is rejected before these tests reach what they measure.
fn inert_request(runtime_root: &Path, cwd: &Path) -> PrepareRequest {
    PrepareRequest {
        operation_id: "prepare-daemon-lifetime-guard".to_owned(),
        runtime_root: runtime_root.to_owned(),
        launch: LaunchSpec {
            command: current_test_executable(),
            cwd: cwd.to_owned(),
            args: vec![
                "--exact".to_owned(),
                "unrelated_bystander_fixture".to_owned(),
                "--nocapture".to_owned(),
            ],
            env: BTreeMap::from([("LANG".to_owned(), "C.UTF-8".to_owned())]),
        },
    }
}

/// A descriptor number that is open long enough to be allocated and then closed, so the value is
/// syntactically plausible and semantically dead.
fn closed_descriptor() -> RawFd {
    let mut endpoints = [0 as RawFd; 2];
    assert_eq!(
        unsafe { libc::pipe2(endpoints.as_mut_ptr(), libc::O_CLOEXEC) },
        0
    );
    unsafe {
        libc::close(endpoints[0]);
        libc::close(endpoints[1]);
    }
    endpoints[0]
}
