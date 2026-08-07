use std::fs::{self, DirBuilder, OpenOptions};
use std::io::{self, Read};
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::{DirBuilderExt, MetadataExt};
use std::path::{Path, PathBuf};

const MAX_SOCKET_PATH_BYTES: usize = 100;

#[derive(Clone, Debug)]
pub struct PrivateScope {
    pub directory: PathBuf,
    pub control_socket: PathBuf,
    pub journal: PathBuf,
    pub terminal: PathBuf,
    pub scope_id: [u8; 16],
    pub scope_capability: [u8; 32],
    pub control_capability: [u8; 32],
}

impl PrivateScope {
    pub fn create(runtime_root: &Path, workload_cwd: &Path) -> io::Result<Self> {
        let root = validate_private_directory(runtime_root, "authority runtime root")?;
        let cwd = fs::canonicalize(workload_cwd)?;
        if root.starts_with(&cwd) || cwd.starts_with(&root) {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "authority runtime root is reachable from workload cwd",
            ));
        }

        for _ in 0..16 {
            let scope_id = random_bytes()?;
            let scope_capability = random_bytes()?;
            let control_capability = random_bytes()?;
            if scope_capability == control_capability {
                continue;
            }
            let name = format!("scope-{}", hex(&scope_id));
            let directory = root.join(name);
            let mut builder = DirBuilder::new();
            builder.mode(0o700);
            match builder.create(&directory) {
                Ok(()) => {
                    let result = (|| {
                        let metadata = fs::symlink_metadata(&directory)?;
                        if metadata.file_type().is_symlink()
                            || !metadata.is_dir()
                            || metadata.uid() != unsafe { libc::geteuid() }
                            || metadata.mode() & 0o777 != 0o700
                        {
                            return Err(io::Error::new(
                                io::ErrorKind::PermissionDenied,
                                "authority scope directory ownership or mode is invalid",
                            ));
                        }
                        let control_socket = directory.join("control.sock");
                        if control_socket.as_os_str().as_bytes().len() > MAX_SOCKET_PATH_BYTES {
                            return Err(io::Error::new(
                                io::ErrorKind::InvalidInput,
                                "authority control socket path exceeds its bound",
                            ));
                        }
                        Ok(Self {
                            journal: directory.join("journal.bin"),
                            terminal: directory.join("terminal.bin"),
                            directory: directory.clone(),
                            control_socket,
                            scope_id,
                            scope_capability,
                            control_capability,
                        })
                    })();
                    if result.is_err() {
                        let _ = fs::remove_dir(&directory);
                    }
                    return result;
                }
                Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
                Err(error) => return Err(error),
            }
        }
        Err(io::Error::new(
            io::ErrorKind::AlreadyExists,
            "could not allocate a fresh authority scope id",
        ))
    }
}

pub(crate) fn reopen_scope_directory(
    runtime_root: &Path,
    scope_id: &[u8; 16],
) -> io::Result<PathBuf> {
    let root = validate_private_directory(runtime_root, "authority runtime root")?;
    let expected = root.join(format!("scope-{}", hex(scope_id)));
    let actual = validate_private_directory(&expected, "authority scope directory")?;
    if actual != expected {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "authority scope directory escaped its trusted root",
        ));
    }
    Ok(actual)
}

fn validate_private_directory(path: &Path, label: &str) -> io::Result<PathBuf> {
    let metadata = fs::symlink_metadata(path)?;
    if metadata.file_type().is_symlink()
        || !metadata.is_dir()
        || metadata.uid() != unsafe { libc::geteuid() }
        || metadata.mode() & 0o777 != 0o700
    {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            format!("{label} ownership or mode is invalid"),
        ));
    }
    fs::canonicalize(path)
}

pub(crate) fn random_bytes<const N: usize>() -> io::Result<[u8; N]> {
    let mut file = OpenOptions::new().read(true).open("/dev/urandom")?;
    let mut output = [0_u8; N];
    file.read_exact(&mut output)?;
    if output.iter().all(|byte| *byte == 0) {
        return Err(io::Error::other(
            "kernel random source returned a zero identity",
        ));
    }
    Ok(output)
}

fn hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(DIGITS[(byte >> 4) as usize] as char);
        output.push(DIGITS[(byte & 0x0f) as usize] as char);
    }
    output
}
