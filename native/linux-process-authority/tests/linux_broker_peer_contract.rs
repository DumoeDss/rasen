#[cfg(target_os = "linux")]
mod linux {
    use std::fs;
    use std::os::unix::fs::PermissionsExt;
    use std::os::unix::net::{UnixListener, UnixStream};
    use std::sync::atomic::{AtomicU64, Ordering};

    use rasen_linux_process_authority::broker_transport::peer_credentials;

    static NEXT: AtomicU64 = AtomicU64::new(1);

    #[test]
    fn unix_peer_credentials_come_from_the_connected_socket() {
        let root = std::path::PathBuf::from(format!(
            "/tmp/rpa-peer-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&root).unwrap();
        fs::set_permissions(&root, fs::Permissions::from_mode(0o700)).unwrap();
        let socket = root.join("broker.sock");
        let listener = UnixListener::bind(&socket).unwrap();
        let thread = std::thread::spawn(move || UnixStream::connect(socket).unwrap());
        let (accepted, _) = listener.accept().unwrap();
        let peer = peer_credentials(&accepted).unwrap();
        assert_eq!(peer.pid, std::process::id());
        assert_eq!(peer.uid, unsafe { libc::geteuid() });
        assert_eq!(peer.gid, unsafe { libc::getegid() });
        drop(thread.join().unwrap());
        drop(accepted);
        drop(listener);
        fs::remove_dir_all(root).unwrap();
    }
}
