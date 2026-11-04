#![cfg(target_os = "linux")]

use std::process::Command;
use std::thread;
use std::time::Duration;

use rasen_linux_process_authority::linux::{
    current_process_identity, parse_proc_start_ticks, reopen_exact_authority,
};

#[test]
fn proc_stat_parser_handles_spaces_and_closing_parentheses_in_comm() {
    let stat = "42 (worker ) with spaces) S 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 987654 20";
    assert_eq!(parse_proc_start_ticks(stat).unwrap(), 987_654);
    assert!(parse_proc_start_ticks("42 malformed").is_err());
}

#[test]
fn pidfd_reopen_revalidates_the_complete_current_identity() {
    let expected = current_process_identity().unwrap();
    let reopened = reopen_exact_authority(&expected).unwrap();
    reopened.send_signal(0).unwrap();

    let mut drift = expected;
    drift.start_ticks += 1;
    assert!(reopen_exact_authority(&drift).is_err());
}

#[test]
fn boot_pid_start_and_namespace_drift_never_target_a_replacement() {
    let exact = current_process_identity().unwrap();

    let mut boot = exact.clone();
    boot.boot_id = "00000000-0000-0000-0000-000000000000".to_owned();
    assert!(reopen_exact_authority(&boot).is_err());

    let mut start = exact.clone();
    start.start_ticks += 1;
    assert!(reopen_exact_authority(&start).is_err());

    let mut namespace_device = exact.clone();
    namespace_device.pid_namespace_device += 1;
    assert!(reopen_exact_authority(&namespace_device).is_err());

    let mut namespace_inode = exact.clone();
    namespace_inode.pid_namespace_inode += 1;
    assert!(reopen_exact_authority(&namespace_inode).is_err());

    thread::sleep(Duration::from_millis(50));
    let mut unrelated = Command::new("/usr/bin/sleep").arg("30").spawn().unwrap();
    let mut replacement = exact;
    replacement.guardian_pid = unrelated.id();
    assert!(reopen_exact_authority(&replacement).is_err());
    assert!(unrelated.try_wait().unwrap().is_none());
    unrelated.kill().unwrap();
    unrelated.wait().unwrap();
}
