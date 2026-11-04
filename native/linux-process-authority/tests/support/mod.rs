#![cfg(target_os = "linux")]

use std::fs;
use std::io;
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::{MetadataExt, PermissionsExt};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

static SEQUENCE: AtomicU64 = AtomicU64::new(1);

pub fn short_private_root(label: &str) -> PathBuf {
    assert!(
        !label.is_empty()
            && label.len() <= 4
            && label.bytes().all(|byte| byte.is_ascii_lowercase()),
        "test root label must stay short and closed"
    );
    for _ in 0..32 {
        let path = PathBuf::from("/tmp").join(format!(
            "rpa-{}-{}-{label}",
            std::process::id(),
            SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        match fs::create_dir(&path) {
            Ok(()) => {
                if let Err(error) = fs::set_permissions(&path, fs::Permissions::from_mode(0o700)) {
                    let _ = fs::remove_dir(&path);
                    panic!("could not make short test root private: {error}");
                }
                let metadata = fs::symlink_metadata(&path)
                    .expect("short private test root metadata must remain readable");
                assert!(metadata.is_dir() && !metadata.file_type().is_symlink());
                assert_eq!(metadata.uid(), unsafe { libc::geteuid() });
                assert_eq!(metadata.mode() & 0o777, 0o700);
                assert!(path.as_os_str().as_bytes().len() <= 48);
                return path;
            }
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => panic!("could not create short private test root: {error}"),
        }
    }
    panic!("could not allocate a collision-free short private test root")
}
