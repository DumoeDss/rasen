#![cfg(target_os = "linux")]

use std::fs;
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::{MetadataExt, PermissionsExt};

use rasen_linux_process_authority::runtime::PrivateScope;

mod support;

#[test]
fn private_scope_derives_owned_paths_and_capability_outside_workload() {
    let parent = support::short_private_root("pos");
    let runtime = parent.join("runtime");
    let cwd = parent.join("workload");
    fs::create_dir_all(&runtime).unwrap();
    fs::create_dir_all(&cwd).unwrap();
    fs::set_permissions(&runtime, fs::Permissions::from_mode(0o700)).unwrap();
    fs::set_permissions(&cwd, fs::Permissions::from_mode(0o700)).unwrap();

    let scope = PrivateScope::create(&runtime, &cwd).unwrap();
    assert_eq!(
        fs::metadata(&scope.directory).unwrap().mode() & 0o777,
        0o700
    );
    assert_eq!(fs::metadata(&scope.directory).unwrap().uid(), unsafe {
        libc::geteuid()
    });
    assert_eq!(scope.scope_id.len(), 16);
    assert_eq!(scope.scope_capability.len(), 32);
    assert_eq!(scope.control_capability.len(), 32);
    assert_ne!(scope.scope_capability, scope.control_capability);
    assert_eq!(scope.control_socket.file_name().unwrap(), "control.sock");
    assert!(scope.control_socket.as_os_str().as_bytes().len() <= 100);
    assert!(scope.control_socket.starts_with(&scope.directory));
    assert!(scope.journal.starts_with(&scope.directory));
    assert!(scope.terminal.starts_with(&scope.directory));

    fs::remove_dir_all(parent).unwrap();
}

#[test]
fn private_scope_rejects_insecure_or_workload_reachable_roots() {
    let parent = support::short_private_root("rej");
    let cwd = parent.join("workload");
    let inside = cwd.join("authority");
    fs::create_dir_all(&inside).unwrap();
    fs::set_permissions(&cwd, fs::Permissions::from_mode(0o700)).unwrap();
    fs::set_permissions(&inside, fs::Permissions::from_mode(0o700)).unwrap();
    assert!(PrivateScope::create(&inside, &cwd).is_err());

    let insecure = parent.join("insecure");
    fs::create_dir_all(&insecure).unwrap();
    fs::set_permissions(&insecure, fs::Permissions::from_mode(0o755)).unwrap();
    assert!(PrivateScope::create(&insecure, &cwd).is_err());

    fs::remove_dir_all(parent).unwrap();
}

#[test]
fn failed_socket_derivation_removes_its_partial_scope_directory() {
    let parent = support::short_private_root("lng");
    let runtime = parent.join("r".repeat(72));
    let cwd = parent.join("workload");
    fs::create_dir_all(&runtime).unwrap();
    fs::create_dir_all(&cwd).unwrap();
    fs::set_permissions(&runtime, fs::Permissions::from_mode(0o700)).unwrap();
    fs::set_permissions(&cwd, fs::Permissions::from_mode(0o700)).unwrap();

    let representative_socket = runtime
        .join(format!("scope-{}", "0".repeat(32)))
        .join("control.sock");
    assert!(representative_socket.as_os_str().as_bytes().len() > 100);
    assert!(PrivateScope::create(&runtime, &cwd).is_err());
    assert_eq!(fs::read_dir(&runtime).unwrap().count(), 0);
    fs::remove_dir_all(parent).unwrap();
}
