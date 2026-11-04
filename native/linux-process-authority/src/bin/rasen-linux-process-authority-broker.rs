#[cfg(target_os = "linux")]
fn main() {
    use std::io;

    fn run() -> io::Result<()> {
        use std::env;

        let arguments: Vec<String> = env::args().skip(1).collect();
        match arguments.as_slice() {
            [operation] if operation == "probe" => installed::probe(),
            [operation] if operation == "serve" => installed::serve(),
            [operation] if operation == "clean-uninstall-state" => {
                installed::clean_uninstall_state()
            }
            _ => Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "usage: rasen-linux-process-authority-broker <probe|serve|clean-uninstall-state>",
            )),
        }
    }

    if let Err(error) = run() {
        eprintln!("rasen Linux authority broker failed closed: {error}");
        std::process::exit(69);
    }
}

#[cfg(target_os = "linux")]
mod installed {
    use std::fs::{self, File, OpenOptions};
    use std::io;
    use std::os::fd::AsRawFd;
    use std::os::unix::fs::{FileTypeExt, OpenOptionsExt, PermissionsExt};
    use std::os::unix::net::{UnixListener, UnixStream};
    use std::path::PathBuf;
    use zeroize::Zeroize;

    use rasen_linux_process_authority::broker_cgroup::linux::{
        probe_namespace_operations, FsCgroupKernel,
    };
    use rasen_linux_process_authority::broker_cgroup::{BrokerCgroupAuthority, CgroupRequirements};
    use rasen_linux_process_authority::broker_daemon_transaction::BrokerDaemonTransactions;
    use rasen_linux_process_authority::broker_guardian::PrimaryGuardianAuthority;
    use rasen_linux_process_authority::broker_install::{
        validate_root_owned_path, BrokerInstallLayout, BrokerPublicKeyManifest, SecurePathPolicy,
    };
    use rasen_linux_process_authority::broker_lease::DurableLeaseStore;
    use rasen_linux_process_authority::broker_protocol::SigningBrokerIdentity;
    use rasen_linux_process_authority::broker_service::{
        BrokerServiceCore, BrokerServiceIdentity, GuardianAuthority,
    };
    use rasen_linux_process_authority::primary::current_executable_digest;

    struct InstalledBroker {
        layout: BrokerInstallLayout,
        signer: SigningBrokerIdentity,
        service_gid: u32,
        service: BrokerServiceCore<PrimaryGuardianAuthority, FsCgroupKernel>,
        transactions: BrokerDaemonTransactions,
    }

    pub fn probe() -> io::Result<()> {
        let installed = InstalledBroker::load()?;
        installed.probe_features()
    }

    pub fn serve() -> io::Result<()> {
        let installed = InstalledBroker::load()?;
        installed.probe_features()?;
        let (listener, _endpoint) =
            bind_singleton_endpoint(&installed.layout, installed.service_gid)?;
        for connection in listener.incoming() {
            let mut stream = connection?;
            installed.handle_one(&mut stream)?;
        }
        Ok(())
    }

    pub fn clean_uninstall_state() -> io::Result<()> {
        if unsafe { libc::geteuid() } != 0 {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "broker uninstall-state cleanup must run as uid 0",
            ));
        }
        let layout = BrokerInstallLayout::system_default();
        layout.validate()?;
        validate_root_owned_path(&layout.binary, &SecurePathPolicy::root_file(0o755))?;
        validate_root_owned_path(
            &layout.public_key_manifest,
            &SecurePathPolicy::root_file(0o644),
        )?;
        validate_root_owned_path(
            &layout.state_directory,
            &SecurePathPolicy::root_directory(0o700),
        )?;
        let manifest =
            BrokerPublicKeyManifest::decode(&fs::read_to_string(&layout.public_key_manifest)?)?;
        let authority_state_root = layout.state_directory.parent().ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::InvalidInput,
                "broker lease store lacks a private authority-state parent",
            )
        })?;
        validate_root_owned_path(
            authority_state_root,
            &SecurePathPolicy::root_directory(0o700),
        )?;
        let construction_root = authority_state_root.join("guardian-construction");
        if construction_root.exists() {
            validate_root_owned_path(&construction_root, &SecurePathPolicy::root_directory(0o700))?;
            if fs::read_dir(&construction_root)?.next().is_some() {
                return Err(io::Error::new(
                    io::ErrorKind::WouldBlock,
                    "broker uninstall refuses retained guardian-construction state",
                ));
            }
        }
        let store = DurableLeaseStore::open_root_owned(&layout.state_directory)?;
        store.clear_authenticated_terminal_state(current_executable_digest()?, manifest.key_id)?;
        if construction_root.exists() {
            fs::remove_dir(&construction_root)?;
            File::open(authority_state_root)?.sync_all()?;
        }
        Ok(())
    }

    struct BrokerEndpointGuard {
        _lock: File,
        socket: PathBuf,
        socket_device: u64,
        socket_inode: u64,
    }

    impl Drop for BrokerEndpointGuard {
        fn drop(&mut self) {
            let Ok(metadata) = fs::symlink_metadata(&self.socket) else {
                return;
            };
            if metadata.file_type().is_socket()
                && metadata.dev() == self.socket_device
                && metadata.ino() == self.socket_inode
            {
                let _ = fs::remove_file(&self.socket);
            }
        }
    }

    fn bind_singleton_endpoint(
        layout: &BrokerInstallLayout,
        service_gid: u32,
    ) -> io::Result<(UnixListener, BrokerEndpointGuard)> {
        let lock_path = layout
            .socket
            .parent()
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "socket has no parent"))?
            .join("broker.lock");
        let lock = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .mode(0o600)
            .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
            .open(&lock_path)?;
        fs::set_permissions(&lock_path, fs::Permissions::from_mode(0o600))?;
        validate_root_owned_path(&lock_path, &SecurePathPolicy::root_file(0o600))?;
        if unsafe { libc::flock(lock.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } != 0 {
            let error = io::Error::last_os_error();
            return Err(if matches!(error.raw_os_error(), Some(libc::EWOULDBLOCK)) {
                io::Error::new(
                    io::ErrorKind::AlreadyExists,
                    "broker singleton is already held",
                )
            } else {
                error
            });
        }

        if layout.socket.exists() {
            validate_root_owned_path(
                &layout.socket,
                &SecurePathPolicy::root_socket_for_group(service_gid),
            )?;
            match UnixStream::connect(&layout.socket) {
                Ok(_) => {
                    return Err(io::Error::new(
                        io::ErrorKind::AlreadyExists,
                        "broker endpoint is still accepting connections",
                    ))
                }
                Err(error) if error.kind() == io::ErrorKind::ConnectionRefused => {
                    fs::remove_file(&layout.socket)?;
                }
                Err(error) => return Err(error),
            }
        }

        let listener = UnixListener::bind(&layout.socket)?;
        let metadata = fs::symlink_metadata(&layout.socket)?;
        let endpoint = BrokerEndpointGuard {
            _lock: lock,
            socket: layout.socket.clone(),
            socket_device: metadata.dev(),
            socket_inode: metadata.ino(),
        };
        fs::set_permissions(&layout.socket, fs::Permissions::from_mode(0o660))?;
        let socket_path = std::ffi::CString::new(std::os::unix::ffi::OsStrExt::as_bytes(
            layout.socket.as_os_str(),
        ))
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "socket contains nul"))?;
        if unsafe { libc::chown(socket_path.as_ptr(), 0, service_gid) } != 0 {
            return Err(io::Error::last_os_error());
        }
        validate_root_owned_path(
            &layout.socket,
            &SecurePathPolicy::root_socket_for_group(service_gid),
        )?;
        Ok((listener, endpoint))
    }

    impl InstalledBroker {
        fn load() -> io::Result<Self> {
            if unsafe { libc::geteuid() } != 0 {
                return Err(io::Error::new(
                    io::ErrorKind::PermissionDenied,
                    "installed broker must run as uid 0",
                ));
            }
            let layout = BrokerInstallLayout::system_default();
            layout.validate()?;
            validate_root_owned_path(&layout.binary, &SecurePathPolicy::root_file(0o755))?;
            validate_root_owned_path(
                &layout.public_key_manifest,
                &SecurePathPolicy::root_file(0o644),
            )?;
            validate_root_owned_path(&layout.private_key, &SecurePathPolicy::root_file(0o600))?;
            validate_root_owned_path(
                &layout.state_directory,
                &SecurePathPolicy::root_directory(0o700),
            )?;
            validate_root_owned_path(&layout.service_unit, &SecurePathPolicy::root_file(0o644))?;
            let public_value = fs::read_to_string(&layout.public_key_manifest)?;
            let manifest = BrokerPublicKeyManifest::decode(&public_value)?;
            let mut private_value = fs::read(&layout.private_key)?;
            let mut seed: [u8; 32] = private_value.as_slice().try_into().map_err(|_| {
                io::Error::new(
                    io::ErrorKind::InvalidData,
                    "broker private key is not an exact 32-byte seed",
                )
            })?;
            let signer = SigningBrokerIdentity::from_seed(seed);
            seed.zeroize();
            private_value.zeroize();
            let signer = signer?;
            if signer.key_id() != manifest.key_id || signer.public_key() != manifest.public_key {
                return Err(io::Error::new(
                    io::ErrorKind::PermissionDenied,
                    "broker private key does not match its pinned public manifest",
                ));
            }
            let service_gid = fs::metadata(layout.socket.parent().ok_or_else(|| {
                io::Error::new(io::ErrorKind::InvalidInput, "broker socket has no parent")
            })?)?
            .gid();
            if service_gid == 0 {
                return Err(io::Error::new(
                    io::ErrorKind::PermissionDenied,
                    "broker socket directory lacks a dedicated service group",
                ));
            }
            validate_root_owned_path(
                layout.socket.parent().expect("validated parent"),
                &SecurePathPolicy::root_group_directory(0o750, service_gid),
            )?;
            let kernel = FsCgroupKernel::new(
                std::path::PathBuf::from("/sys/fs/cgroup"),
                layout.cgroup_subtree.clone(),
            )?;
            kernel.ensure_service_subtree()?;
            let authority_state_root = layout.state_directory.parent().ok_or_else(|| {
                io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "broker lease store lacks a private authority-state parent",
                )
            })?;
            let service = BrokerServiceCore::new(
                BrokerServiceIdentity {
                    install_id: current_executable_digest()?,
                    key_id: signer.key_id(),
                },
                DurableLeaseStore::open_root_owned(&layout.state_directory)?,
                PrimaryGuardianAuthority::new(authority_state_root)?,
                BrokerCgroupAuthority::new(kernel, CgroupRequirements::broker_default()),
            )?;
            Ok(Self {
                layout,
                signer,
                service_gid,
                service,
                transactions: BrokerDaemonTransactions::new(),
            })
        }

        fn probe_features(&self) -> io::Result<()> {
            probe_namespace_operations()?;
            self.service.guardian().probe()?;
            self.service.cgroups().probe()?;
            self.service.store().load_all()?;
            self.service.store().load_recoveries()?;
            Ok(())
        }

        fn handle_one(&self, stream: &mut UnixStream) -> io::Result<()> {
            self.transactions
                .handle_one(stream, &self.signer, &self.service)
        }
    }

    use std::os::unix::fs::MetadataExt;
}

#[cfg(not(target_os = "linux"))]
fn main() {
    eprintln!("rasen-linux-process-authority-broker is available only on Linux");
    std::process::exit(69);
}
