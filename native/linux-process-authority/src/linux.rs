use std::fs::{self, File, OpenOptions};
use std::io;
use std::os::fd::{AsRawFd, FromRawFd, RawFd};
use std::os::unix::fs::MetadataExt;

use crate::authority::AuthorityIdentity;

pub enum AuthorityPresence {
    Live(ReopenedAuthority),
    AbsentSameBoot,
}

pub struct ReopenedAuthority {
    pid: u32,
    pidfd: File,
    pid_namespace_proof: PidNamespaceProof,
}

enum PidNamespaceProof {
    Kernel { _handle: File },
    GenerationOnly,
    Authenticated,
}

impl ReopenedAuthority {
    pub fn pid(&self) -> u32 {
        self.pid
    }

    pub fn pidfd(&self) -> RawFd {
        self.pidfd.as_raw_fd()
    }

    pub(crate) fn authenticate_pid_namespace(&mut self) {
        if matches!(self.pid_namespace_proof, PidNamespaceProof::GenerationOnly) {
            self.pid_namespace_proof = PidNamespaceProof::Authenticated;
        }
    }

    pub fn send_signal(&self, signal: i32) -> io::Result<()> {
        if matches!(self.pid_namespace_proof, PidNamespaceProof::GenerationOnly) {
            return Err(io::Error::new(
                io::ErrorKind::AlreadyExists,
                "native-state-retained",
            ));
        }
        let result = unsafe {
            libc::syscall(
                libc::SYS_pidfd_send_signal,
                self.pidfd.as_raw_fd(),
                signal,
                std::ptr::null::<libc::siginfo_t>(),
                0_u32,
            )
        };
        if result < 0 {
            Err(io::Error::last_os_error())
        } else {
            Ok(())
        }
    }

    pub fn wait(&self, timeout_ms: i32) -> io::Result<bool> {
        let mut descriptor = libc::pollfd {
            fd: self.pidfd.as_raw_fd(),
            events: libc::POLLIN,
            revents: 0,
        };
        let result = unsafe { libc::poll(&mut descriptor, 1, timeout_ms) };
        if result < 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(result > 0 && descriptor.revents & libc::POLLIN != 0)
    }
}

pub fn current_process_identity() -> io::Result<AuthorityIdentity> {
    let pid = unsafe { libc::getpid() };
    if pid <= 0 {
        return Err(io::Error::other("getpid returned an invalid pid"));
    }
    read_process_identity(pid as u32)
}

pub fn read_process_identity(pid: u32) -> io::Result<AuthorityIdentity> {
    if pid == 0 {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "pid is zero"));
    }
    let boot_id = fs::read_to_string("/proc/sys/kernel/random/boot_id")?
        .trim()
        .to_owned();
    let stat = fs::read_to_string(format!("/proc/{pid}/stat"))?;
    let namespace = fs::metadata(format!("/proc/{pid}/ns/pid"))?;
    let identity = AuthorityIdentity {
        boot_id,
        guardian_pid: pid,
        start_ticks: parse_proc_start_ticks(&stat)?,
        pid_namespace_device: namespace.dev(),
        pid_namespace_inode: namespace.ino(),
    };
    identity.validate()?;
    Ok(identity)
}

pub fn current_boot_id() -> io::Result<String> {
    let boot_id = fs::read_to_string("/proc/sys/kernel/random/boot_id")?
        .trim()
        .to_owned();
    if boot_id.is_empty() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "kernel boot identity is empty",
        ));
    }
    Ok(boot_id)
}

/// Reopens the exact authority or proves that its PID is absent on the same
/// boot. A live process with a different generation is identity drift, never
/// absence.
pub fn reopen_or_prove_absent(expected: &AuthorityIdentity) -> io::Result<AuthorityPresence> {
    expected.validate()?;
    if current_boot_id()? != expected.boot_id {
        return Err(identity_drift());
    }
    match read_process_generation(expected.guardian_pid) {
        Ok((boot_id, start_ticks))
            if boot_id != expected.boot_id || start_ticks != expected.start_ticks =>
        {
            Err(identity_drift())
        }
        Ok(_) => reopen_exact_authority(expected).map(AuthorityPresence::Live),
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            if current_boot_id()? != expected.boot_id {
                Err(identity_drift())
            } else {
                Ok(AuthorityPresence::AbsentSameBoot)
            }
        }
        Err(error) => Err(error),
    }
}

pub fn parse_proc_start_ticks(stat: &str) -> io::Result<u64> {
    let closing = stat.rfind(')').ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidData,
            "proc stat command is unterminated",
        )
    })?;
    let remainder = stat
        .get(closing + 1..)
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "proc stat is truncated"))?;
    let fields: Vec<&str> = remainder.split_whitespace().collect();
    let value = fields
        .get(19)
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "proc stat lacks start time"))?;
    value
        .parse::<u64>()
        .ok()
        .filter(|ticks| *ticks > 0)
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "proc start time is invalid"))
}

pub fn reopen_exact_authority(expected: &AuthorityIdentity) -> io::Result<ReopenedAuthority> {
    expected.validate()?;
    let before = read_process_generation(expected.guardian_pid)?;
    if before.0 != expected.boot_id || before.1 != expected.start_ticks {
        return Err(identity_drift());
    }
    let pidfd = pidfd_open(expected.guardian_pid)?;
    let pid_namespace_proof = match OpenOptions::new()
        .read(true)
        .open(format!("/proc/{}/ns/pid", expected.guardian_pid))
    {
        Ok(namespace) => {
            let metadata = namespace.metadata()?;
            if metadata.dev() != expected.pid_namespace_device
                || metadata.ino() != expected.pid_namespace_inode
            {
                return Err(identity_drift());
            }
            PidNamespaceProof::Kernel { _handle: namespace }
        }
        // A nondumpable guardian intentionally denies proc namespace handles to
        // its workload. Generation-only reopening permits observation and a
        // server-first challenge, but never pidfd signalling by itself.
        Err(error) if error.kind() == io::ErrorKind::PermissionDenied => {
            PidNamespaceProof::GenerationOnly
        }
        Err(error) => return Err(error),
    };
    let after = read_process_generation(expected.guardian_pid)?;
    if after != before {
        return Err(identity_drift());
    }
    Ok(ReopenedAuthority {
        pid: expected.guardian_pid,
        pidfd,
        pid_namespace_proof,
    })
}

fn read_process_generation(pid: u32) -> io::Result<(String, u64)> {
    if pid == 0 {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "pid is zero"));
    }
    let boot_id = current_boot_id()?;
    let stat = fs::read_to_string(format!("/proc/{pid}/stat"))?;
    Ok((boot_id, parse_proc_start_ticks(&stat)?))
}

fn pidfd_open(pid: u32) -> io::Result<File> {
    let descriptor = unsafe { libc::syscall(libc::SYS_pidfd_open, pid as libc::pid_t, 0_u32) };
    if descriptor < 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(unsafe { File::from_raw_fd(descriptor as RawFd) })
}

fn identity_drift() -> io::Error {
    io::Error::new(io::ErrorKind::PermissionDenied, "identity-drift")
}
