#![cfg(target_os = "linux")]

use std::collections::BTreeMap;
use std::fs;
use std::io::Read;
use std::os::fd::FromRawFd;
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::ptr;
use std::sync::atomic::{AtomicPtr, Ordering};
use std::thread;
use std::time::{Duration, Instant};

use rasen_linux_process_authority::lifecycle::{GuardianEvent, RootExit};
use rasen_linux_process_authority::primary::{
    current_executable_digest, prepare_primary, RuntimeChannel,
};
use rasen_linux_process_authority::protocol::{FrameKind, LaunchSpec, PrepareRequest};

mod support;

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

fn test_fixture_request(
    runtime: &Path,
    cwd: &Path,
    fixture: &str,
    extra_env: impl IntoIterator<Item = (String, String)>,
) -> PrepareRequest {
    let executable = fs::canonicalize(std::env::current_exe().unwrap()).unwrap();
    let mut env = BTreeMap::from([("LANG".to_owned(), "C.UTF-8".to_owned())]);
    env.extend(extra_env);
    PrepareRequest {
        operation_id: format!("prepare-{fixture}"),
        runtime_root: runtime.to_owned(),
        launch: LaunchSpec {
            command: executable,
            cwd: cwd.to_owned(),
            args: vec![
                "--exact".to_owned(),
                fixture.to_owned(),
                "--nocapture".to_owned(),
            ],
            env,
        },
    }
}

fn wait_for_root_exit(runtime: &mut RuntimeChannel, timeout: Duration) -> RootExit {
    let deadline = Instant::now() + timeout;
    loop {
        match runtime.read() {
            Ok(Some(frame)) if frame.kind == FrameKind::Event => {
                let events = GuardianEvent::decode_journal(&frame.payload).unwrap();
                if let Some(root_exit) = events.iter().find_map(|event| event.root_exit) {
                    return root_exit;
                }
            }
            Ok(Some(frame)) if frame.kind == FrameKind::ExactScopeEmpty => {
                panic!("scope became exact-empty before the held descendant was released")
            }
            Ok(Some(_)) => {}
            Ok(None) => panic!("runtime closed before root exit"),
            Err(error)
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                ) && Instant::now() < deadline => {}
            Err(error) => panic!("runtime failed before root exit: {error}"),
        }
        assert!(Instant::now() < deadline, "root exit timed out");
    }
}

fn wait_for_exact_empty(runtime: &mut RuntimeChannel, timeout: Duration) -> Vec<GuardianEvent> {
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

fn wait_until(path: &Path, timeout: Duration, label: &str) {
    let deadline = Instant::now() + timeout;
    while !path.exists() {
        assert!(Instant::now() < deadline, "{label} timed out");
        thread::sleep(Duration::from_millis(10));
    }
}

#[derive(Debug)]
struct DoubleForkFacts {
    root_pid: i32,
    root_sid: i32,
    root_pgid: i32,
    session_leader_pid: i32,
    descendant_pid: i32,
    descendant_parent_pid: i32,
    descendant_sid: i32,
    descendant_pgid: i32,
}

fn parse_double_fork_facts(path: &Path) -> DoubleForkFacts {
    let contents = fs::read_to_string(path).unwrap();
    let mut fields = BTreeMap::new();
    for line in contents.lines() {
        let (key, value) = line
            .split_once('=')
            .unwrap_or_else(|| panic!("invalid double-fork fact: {line}"));
        assert!(
            fields.insert(key, value.parse::<i32>().unwrap()).is_none(),
            "duplicate double-fork fact: {key}"
        );
    }
    assert_eq!(
        fields.keys().copied().collect::<Vec<_>>(),
        vec![
            "descendant_parent_pid",
            "descendant_pgid",
            "descendant_pid",
            "descendant_sid",
            "root_pgid",
            "root_pid",
            "root_sid",
            "session_leader_pid",
        ]
    );
    DoubleForkFacts {
        root_pid: fields["root_pid"],
        root_sid: fields["root_sid"],
        root_pgid: fields["root_pgid"],
        session_leader_pid: fields["session_leader_pid"],
        descendant_pid: fields["descendant_pid"],
        descendant_parent_pid: fields["descendant_parent_pid"],
        descendant_sid: fields["descendant_sid"],
        descendant_pgid: fields["descendant_pgid"],
    }
}

fn assert_fifo_has_no_reader(path: &Path) {
    let path = std::ffi::CString::new(path.as_os_str().as_bytes()).unwrap();
    let descriptor = unsafe {
        libc::open(
            path.as_ptr(),
            libc::O_WRONLY | libc::O_NONBLOCK | libc::O_CLOEXEC,
        )
    };
    if descriptor >= 0 {
        unsafe { libc::close(descriptor) };
        panic!("double-fork descendant retained the explicit escape gate after exact empty");
    }
    assert_eq!(
        std::io::Error::last_os_error().raw_os_error(),
        Some(libc::ENXIO),
        "escape gate failed for a reason other than having no surviving reader"
    );
}

#[test]
fn setsid_double_fork_survives_root_exit_until_exact_guardian_force() {
    let (parent, runtime, cwd) = create_runtime_and_cwd("sid");
    let ready = cwd.join("double-fork-ready");
    let escape_gate = cwd.join("double-fork-escape-gate");
    let escape = cwd.join("double-fork-escaped");
    let individual_signal = cwd.join("double-fork-individual-signal");
    let escape_gate_c = std::ffi::CString::new(escape_gate.as_os_str().as_bytes()).unwrap();
    assert_eq!(unsafe { libc::mkfifo(escape_gate_c.as_ptr(), 0o600) }, 0);
    let mut unrelated = Command::new("/bin/sleep").arg("30").spawn().unwrap();

    let prepared = prepare_primary(
        test_fixture_request(
            &runtime,
            &cwd,
            "setsid_double_fork_resistant_descendant_fixture",
            [
                (
                    "RPA_DOUBLE_FORK_READY".to_owned(),
                    ready.display().to_string(),
                ),
                (
                    "RPA_DOUBLE_FORK_ESCAPE_GATE".to_owned(),
                    escape_gate.display().to_string(),
                ),
                (
                    "RPA_DOUBLE_FORK_ESCAPE".to_owned(),
                    escape.display().to_string(),
                ),
                (
                    "RPA_DOUBLE_FORK_SIGNAL".to_owned(),
                    individual_signal.display().to_string(),
                ),
            ],
        ),
        current_executable_digest().unwrap(),
        [0x51; 32],
    )
    .unwrap();
    let mut runtime_channel = prepared.client().unwrap().open_runtime().unwrap();
    prepared.client().unwrap().activate().unwrap();

    wait_until(&ready, Duration::from_secs(10), "double-fork ready barrier");
    let facts = parse_double_fork_facts(&ready);
    assert!(facts.root_pid > 1);
    assert!(facts.session_leader_pid > 1);
    assert!(facts.descendant_pid > 1);
    assert_ne!(facts.root_pid, facts.session_leader_pid);
    assert_ne!(facts.root_pid, facts.descendant_pid);
    assert_eq!(facts.descendant_parent_pid, 1);
    assert_eq!(facts.descendant_sid, facts.session_leader_pid);
    assert_eq!(facts.descendant_pgid, facts.session_leader_pid);
    assert_ne!(facts.descendant_sid, facts.root_sid);
    assert_ne!(facts.descendant_pgid, facts.root_pgid);
    assert_eq!(
        wait_for_root_exit(&mut runtime_channel, Duration::from_secs(10)),
        RootExit::Code(0)
    );
    assert_eq!(
        prepared.client().unwrap().inspect().unwrap().to_string(),
        "root-exited"
    );

    prepared.client().unwrap().terminate(250).unwrap();
    assert_eq!(
        prepared.client().unwrap().inspect().unwrap().to_string(),
        "exact-scope-empty"
    );
    assert!(unrelated.try_wait().unwrap().is_none());
    assert_fifo_has_no_reader(&escape_gate);
    assert!(
        !escape.exists(),
        "double-fork descendant escaped guardian force"
    );
    assert!(
        !individual_signal.exists(),
        "provider signalled the resistant descendant individually"
    );

    unrelated.kill().unwrap();
    unrelated.wait().unwrap();
    fs::remove_dir_all(parent).unwrap();
}

fn parse_nested_pidns_facts(path: &Path) -> (i32, i32, i32) {
    let contents = fs::read_to_string(path).unwrap();
    let mut fields = BTreeMap::new();
    for line in contents.lines() {
        let (key, value) = line
            .split_once('=')
            .unwrap_or_else(|| panic!("invalid nested-pidns fact: {line}"));
        assert!(
            fields.insert(key, value.parse::<i32>().unwrap()).is_none(),
            "duplicate nested-pidns fact: {key}"
        );
    }
    assert_eq!(
        fields.keys().copied().collect::<Vec<_>>(),
        vec![
            "nested_descendant_parent_pid",
            "nested_descendant_pid",
            "nested_init_pid",
        ]
    );
    (
        fields["nested_init_pid"],
        fields["nested_descendant_pid"],
        fields["nested_descendant_parent_pid"],
    )
}

#[test]
fn nested_pid_namespace_remains_live_after_root_exit_until_release() {
    let (parent, runtime, cwd) = create_runtime_and_cwd("nst");
    let ready = cwd.join("nested-pidns-ready");
    let release = cwd.join("nested-pidns-release");
    let prepared = prepare_primary(
        test_fixture_request(
            &runtime,
            &cwd,
            "nested_pidns_parent_exits_fixture",
            [
                (
                    "RPA_NESTED_PIDNS_READY".to_owned(),
                    ready.display().to_string(),
                ),
                (
                    "RPA_NESTED_PIDNS_RELEASE".to_owned(),
                    release.display().to_string(),
                ),
            ],
        ),
        current_executable_digest().unwrap(),
        [0x52; 32],
    )
    .unwrap();
    let mut runtime_channel = prepared.client().unwrap().open_runtime().unwrap();
    prepared.client().unwrap().activate().unwrap();

    wait_until(
        &ready,
        Duration::from_secs(10),
        "nested PID namespace ready barrier",
    );
    let (nested_init_pid, nested_descendant_pid, nested_descendant_parent_pid) =
        parse_nested_pidns_facts(&ready);
    assert_eq!(nested_init_pid, 1);
    assert!(nested_descendant_pid > 1);
    assert_eq!(nested_descendant_parent_pid, nested_init_pid);
    assert_eq!(
        wait_for_root_exit(&mut runtime_channel, Duration::from_secs(10)),
        RootExit::Code(0)
    );
    assert_eq!(
        prepared.client().unwrap().inspect().unwrap().to_string(),
        "root-exited"
    );

    fs::write(&release, b"release").unwrap();
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
fn nested_pidns_parent_exits_fixture() {
    let Ok(ready) = std::env::var("RPA_NESTED_PIDNS_READY") else {
        return;
    };
    let release = std::env::var("RPA_NESTED_PIDNS_RELEASE").unwrap();
    let executable = fs::canonicalize(std::env::current_exe().unwrap()).unwrap();
    let mut nested = Command::new("/usr/bin/unshare")
        .args(["--user", "--pid", "--fork", "--mount-proc"])
        .arg(executable)
        .args([
            "--exact",
            "nested_pidns_descendant_gate_fixture",
            "--nocapture",
        ])
        .env_clear()
        .env("LANG", "C.UTF-8")
        .env("RPA_NESTED_PIDNS_READY", &ready)
        .env("RPA_NESTED_PIDNS_RELEASE", release)
        .spawn()
        .unwrap();
    let ready = PathBuf::from(ready);
    let deadline = Instant::now() + Duration::from_secs(10);
    while !ready.exists() {
        assert!(
            nested.try_wait().unwrap().is_none(),
            "nested unshare child exited before the ready barrier"
        );
        assert!(Instant::now() < deadline, "nested unshare ready timed out");
        thread::sleep(Duration::from_millis(10));
    }
    drop(nested);
}

#[test]
fn nested_pidns_descendant_gate_fixture() {
    let Ok(ready) = std::env::var("RPA_NESTED_PIDNS_READY") else {
        return;
    };
    let release = PathBuf::from(std::env::var("RPA_NESTED_PIDNS_RELEASE").unwrap());
    assert_eq!(unsafe { libc::getpid() }, 1);
    let descendant = unsafe { libc::fork() };
    assert!(descendant >= 0);
    if descendant == 0 {
        let descendant_pid = unsafe { libc::getpid() };
        let nested_init_pid = unsafe { libc::getppid() };
        if nested_init_pid != 1 {
            unsafe { libc::_exit(224) }
        }
        let ready = PathBuf::from(ready);
        let staged = ready.with_extension("staged");
        let facts = format!(
            "nested_init_pid={nested_init_pid}\nnested_descendant_pid={descendant_pid}\n\
             nested_descendant_parent_pid={}\n",
            unsafe { libc::getppid() },
        );
        let mut staged_file = fs::File::create(&staged).unwrap();
        std::io::Write::write_all(&mut staged_file, facts.as_bytes()).unwrap();
        staged_file.sync_all().unwrap();
        fs::rename(&staged, &ready).unwrap();
        wait_until(
            &release,
            Duration::from_secs(30),
            "nested descendant release barrier",
        );
        unsafe { libc::_exit(0) }
    }

    let mut status = 0;
    assert_eq!(
        unsafe { libc::waitpid(descendant, &mut status, 0) },
        descendant
    );
    assert!(libc::WIFEXITED(status));
    assert_eq!(libc::WEXITSTATUS(status), 0);
}

static DOUBLE_FORK_SIGNAL_PATH: AtomicPtr<libc::c_char> = AtomicPtr::new(ptr::null_mut());

extern "C" fn note_direct_descendant_signal(_signal: libc::c_int) {
    let path = DOUBLE_FORK_SIGNAL_PATH.load(Ordering::Relaxed);
    if path.is_null() {
        return;
    }
    let descriptor = unsafe {
        libc::open(
            path,
            libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL | libc::O_CLOEXEC,
            0o600,
        )
    };
    if descriptor >= 0 {
        unsafe {
            libc::write(
                descriptor,
                b"direct-signal".as_ptr().cast(),
                b"direct-signal".len(),
            );
            libc::close(descriptor);
        }
    }
}

fn install_resistant_signal_observer(path: &Path) {
    let path = std::ffi::CString::new(path.as_os_str().as_bytes())
        .unwrap()
        .into_raw();
    DOUBLE_FORK_SIGNAL_PATH.store(path, Ordering::Relaxed);
    let mut action = unsafe { std::mem::zeroed::<libc::sigaction>() };
    action.sa_sigaction = note_direct_descendant_signal as usize;
    assert_eq!(unsafe { libc::sigemptyset(&mut action.sa_mask) }, 0);
    assert_eq!(
        unsafe { libc::sigaction(libc::SIGTERM, &action, ptr::null_mut()) },
        0
    );
}

#[test]
fn setsid_double_fork_resistant_descendant_fixture() {
    let Ok(ready) = std::env::var("RPA_DOUBLE_FORK_READY") else {
        return;
    };
    let escape_gate = PathBuf::from(std::env::var("RPA_DOUBLE_FORK_ESCAPE_GATE").unwrap());
    let escape = PathBuf::from(std::env::var("RPA_DOUBLE_FORK_ESCAPE").unwrap());
    let signal = PathBuf::from(std::env::var("RPA_DOUBLE_FORK_SIGNAL").unwrap());
    let root_pid = unsafe { libc::getpid() };
    let root_sid = unsafe { libc::getsid(0) };
    let root_pgid = unsafe { libc::getpgid(0) };
    assert!(root_pid > 1 && root_sid >= 0 && root_pgid >= 0);

    let mut ready_pipe = [-1; 2];
    assert_eq!(
        unsafe { libc::pipe2(ready_pipe.as_mut_ptr(), libc::O_CLOEXEC) },
        0
    );
    let first_child = unsafe { libc::fork() };
    assert!(first_child >= 0);
    if first_child == 0 {
        unsafe { libc::close(ready_pipe[0]) };
        if unsafe { libc::setsid() } < 0 {
            unsafe { libc::_exit(220) }
        }
        let session_leader_pid = unsafe { libc::getpid() };
        let second_child = unsafe { libc::fork() };
        if second_child < 0 {
            unsafe { libc::_exit(221) }
        }
        if second_child > 0 {
            unsafe {
                libc::close(ready_pipe[1]);
                libc::_exit(0);
            }
        }

        install_resistant_signal_observer(&signal);
        let escape_gate_c = std::ffi::CString::new(escape_gate.as_os_str().as_bytes()).unwrap();
        let escape_gate_fd =
            unsafe { libc::open(escape_gate_c.as_ptr(), libc::O_RDWR | libc::O_CLOEXEC) };
        if escape_gate_fd < 0 {
            unsafe { libc::_exit(222) }
        }
        for _ in 0..1_000 {
            if unsafe { libc::getppid() } == 1 {
                break;
            }
            unsafe { libc::usleep(10_000) };
        }
        let descendant_parent_pid = unsafe { libc::getppid() };
        if descendant_parent_pid != 1 {
            unsafe { libc::_exit(223) }
        }
        let facts = format!(
            "root_pid={root_pid}\nroot_sid={root_sid}\nroot_pgid={root_pgid}\n\
             session_leader_pid={session_leader_pid}\ndescendant_pid={}\n\
             descendant_parent_pid={descendant_parent_pid}\ndescendant_sid={}\n\
             descendant_pgid={}\n",
            unsafe { libc::getpid() },
            unsafe { libc::getsid(0) },
            unsafe { libc::getpgid(0) },
        );
        let ready = PathBuf::from(ready);
        let staged = ready.with_extension("staged");
        let mut staged_file = fs::File::create(&staged).unwrap();
        std::io::Write::write_all(&mut staged_file, facts.as_bytes()).unwrap();
        staged_file.sync_all().unwrap();
        fs::rename(&staged, &ready).unwrap();
        assert_eq!(
            unsafe { libc::write(ready_pipe[1], b"R".as_ptr().cast(), 1) },
            1
        );
        unsafe { libc::close(ready_pipe[1]) };

        let mut release = [0_u8; 1];
        if unsafe { libc::read(escape_gate_fd, release.as_mut_ptr().cast(), 1) } == 1 {
            fs::write(escape, b"escaped").unwrap();
        }
        unsafe {
            libc::close(escape_gate_fd);
            libc::_exit(0);
        }
    }

    unsafe { libc::close(ready_pipe[1]) };
    let mut pipe = unsafe { fs::File::from_raw_fd(ready_pipe[0]) };
    let mut ready_byte = [0_u8; 1];
    pipe.read_exact(&mut ready_byte).unwrap();
    assert_eq!(ready_byte, *b"R");
}
