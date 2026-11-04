use std::io;
use std::os::fd::{AsRawFd, RawFd};
use std::os::unix::net::UnixDatagram;
use std::os::unix::net::UnixStream;
use std::time::Duration;

use crate::deadline::AbsoluteMonotonicDeadline;

const MAX_RESULT_BYTES: usize = 128 * 1024;
const CLEANUP_RESERVE: Duration = Duration::from_millis(100);

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SupervisedBrokerDisposition {
    Completed,
    TimedOut,
    ClientGone,
}

pub struct SupervisedBrokerResult {
    pub disposition: SupervisedBrokerDisposition,
    pub bytes: Vec<u8>,
}

pub struct BrokerMutationSupervisor;

impl BrokerMutationSupervisor {
    pub fn execute_without_client<F>(
        deadline: AbsoluteMonotonicDeadline,
        operation: F,
    ) -> io::Result<SupervisedBrokerResult>
    where
        F: FnOnce() -> io::Result<Vec<u8>>,
    {
        let (client, _peer) = UnixStream::pair()?;
        Self::execute(deadline, client.as_raw_fd(), operation)
    }

    pub fn execute<F>(
        deadline: AbsoluteMonotonicDeadline,
        client_fd: RawFd,
        operation: F,
    ) -> io::Result<SupervisedBrokerResult>
    where
        F: FnOnce() -> io::Result<Vec<u8>>,
    {
        Self::execute_with_cleanup_reserve(deadline, client_fd, CLEANUP_RESERVE, operation)
    }

    pub fn execute_with_cleanup_reserve<F>(
        deadline: AbsoluteMonotonicDeadline,
        client_fd: RawFd,
        cleanup_reserve: Duration,
        operation: F,
    ) -> io::Result<SupervisedBrokerResult>
    where
        F: FnOnce() -> io::Result<Vec<u8>>,
    {
        Self::execute_internal(deadline, client_fd, None, cleanup_reserve, operation)
    }

    pub fn execute_for_client<F>(
        deadline: AbsoluteMonotonicDeadline,
        client_fd: RawFd,
        client_pid: u32,
        cleanup_reserve: Duration,
        operation: F,
    ) -> io::Result<SupervisedBrokerResult>
    where
        F: FnOnce() -> io::Result<Vec<u8>>,
    {
        if client_pid == 0 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "broker client pid is zero",
            ));
        }
        let client_pidfd = pidfd_open(client_pid as libc::pid_t)?;
        let result = Self::execute_internal(
            deadline,
            client_fd,
            Some(client_pidfd),
            cleanup_reserve,
            operation,
        );
        unsafe { libc::close(client_pidfd) };
        result
    }

    fn execute_internal<F>(
        deadline: AbsoluteMonotonicDeadline,
        client_fd: RawFd,
        client_pidfd: Option<RawFd>,
        cleanup_reserve: Duration,
        operation: F,
    ) -> io::Result<SupervisedBrokerResult>
    where
        F: FnOnce() -> io::Result<Vec<u8>>,
    {
        deadline.ensure_live()?;
        let mutation_cutoff = deadline.reserve(cleanup_reserve)?;
        let (parent, child) = UnixDatagram::pair()?;
        let pid = unsafe { libc::fork() };
        if pid < 0 {
            return Err(io::Error::last_os_error());
        }
        if pid == 0 {
            drop(parent);
            let packet = encode_child_result(operation());
            let _ = child.send(&packet);
            unsafe { libc::_exit(0) }
        }
        drop(child);
        let pidfd = match pidfd_open(pid) {
            Ok(value) => value,
            Err(error) => {
                unsafe {
                    libc::kill(pid, libc::SIGKILL);
                }
                reap_blocking(pid);
                return Err(error);
            }
        };
        let outcome = wait_for_result(
            &parent,
            pid,
            pidfd,
            client_fd,
            client_pidfd,
            mutation_cutoff,
            deadline,
        );
        unsafe {
            libc::close(pidfd);
        }
        outcome
    }
}

fn wait_for_result(
    result: &UnixDatagram,
    pid: libc::pid_t,
    pidfd: RawFd,
    client_fd: RawFd,
    client_pidfd: Option<RawFd>,
    mutation_cutoff: AbsoluteMonotonicDeadline,
    final_deadline: AbsoluteMonotonicDeadline,
) -> io::Result<SupervisedBrokerResult> {
    loop {
        if client_closed_or_sent_unexpected_data(client_fd)? {
            kill_pidfd(pidfd)?;
            reap_until(pid, pidfd, final_deadline)?;
            return Ok(SupervisedBrokerResult {
                disposition: SupervisedBrokerDisposition::ClientGone,
                bytes: Vec::new(),
            });
        }
        if mutation_cutoff.is_expired()? {
            kill_pidfd(pidfd)?;
            reap_until(pid, pidfd, final_deadline)?;
            return Ok(SupervisedBrokerResult {
                disposition: SupervisedBrokerDisposition::TimedOut,
                bytes: Vec::new(),
            });
        }
        let mut descriptors = vec![
            libc::pollfd {
                fd: result.as_raw_fd(),
                events: libc::POLLIN,
                revents: 0,
            },
            libc::pollfd {
                fd: pidfd,
                events: libc::POLLIN,
                revents: 0,
            },
            libc::pollfd {
                fd: client_fd,
                events: libc::POLLIN | libc::POLLHUP | libc::POLLERR | libc::POLLRDHUP,
                revents: 0,
            },
        ];
        if let Some(client_pidfd) = client_pidfd {
            descriptors.push(libc::pollfd {
                fd: client_pidfd,
                events: libc::POLLIN,
                revents: 0,
            });
        }
        let polled = unsafe {
            libc::poll(
                descriptors.as_mut_ptr(),
                descriptors.len() as libc::nfds_t,
                mutation_cutoff.poll_timeout_ms()?.min(50),
            )
        };
        if polled < 0 {
            let error = io::Error::last_os_error();
            if error.kind() == io::ErrorKind::Interrupted {
                continue;
            }
            kill_pidfd(pidfd)?;
            reap_until(pid, pidfd, final_deadline)?;
            return Err(error);
        }
        if descriptors[2].revents
            & (libc::POLLIN | libc::POLLHUP | libc::POLLERR | libc::POLLNVAL | libc::POLLRDHUP)
            != 0
        {
            kill_pidfd(pidfd)?;
            reap_until(pid, pidfd, final_deadline)?;
            return Ok(SupervisedBrokerResult {
                disposition: SupervisedBrokerDisposition::ClientGone,
                bytes: Vec::new(),
            });
        }
        if client_pidfd.is_some() && descriptors[3].revents & libc::POLLIN != 0 {
            kill_pidfd(pidfd)?;
            reap_until(pid, pidfd, final_deadline)?;
            return Ok(SupervisedBrokerResult {
                disposition: SupervisedBrokerDisposition::ClientGone,
                bytes: Vec::new(),
            });
        }
        if descriptors[0].revents & libc::POLLIN != 0 {
            let mut packet = vec![0_u8; MAX_RESULT_BYTES + 8];
            let length = result.recv(&mut packet)?;
            packet.truncate(length);
            reap_until(pid, pidfd, final_deadline)?;
            if final_deadline.is_expired()? {
                return Ok(SupervisedBrokerResult {
                    disposition: SupervisedBrokerDisposition::TimedOut,
                    bytes: Vec::new(),
                });
            }
            return decode_child_result(&packet).map(|bytes| SupervisedBrokerResult {
                disposition: SupervisedBrokerDisposition::Completed,
                bytes,
            });
        }
        if descriptors[1].revents & libc::POLLIN != 0 {
            reap_until(pid, pidfd, final_deadline)?;
            return Err(io::Error::new(
                io::ErrorKind::ConnectionReset,
                "broker mutation worker exited without an exact result",
            ));
        }
    }
}

fn client_closed_or_sent_unexpected_data(fd: RawFd) -> io::Result<bool> {
    let mut byte = 0_u8;
    let received = unsafe {
        libc::recv(
            fd,
            (&mut byte as *mut u8).cast(),
            1,
            libc::MSG_PEEK | libc::MSG_DONTWAIT,
        )
    };
    if received >= 0 {
        return Ok(true);
    }
    let error = io::Error::last_os_error();
    if error.kind() == io::ErrorKind::WouldBlock {
        Ok(false)
    } else if matches!(
        error.kind(),
        io::ErrorKind::ConnectionReset | io::ErrorKind::BrokenPipe
    ) {
        Ok(true)
    } else {
        Err(error)
    }
}

fn encode_child_result(result: io::Result<Vec<u8>>) -> Vec<u8> {
    match result {
        Ok(bytes) if bytes.len() <= MAX_RESULT_BYTES => {
            let mut packet = Vec::with_capacity(5 + bytes.len());
            packet.push(0);
            packet.extend_from_slice(&(bytes.len() as u32).to_be_bytes());
            packet.extend_from_slice(&bytes);
            packet
        }
        Ok(_) => encode_error(&io::Error::new(
            io::ErrorKind::InvalidData,
            "broker supervised result exceeds its bound",
        )),
        Err(error) => encode_error(&error),
    }
}

fn encode_error(error: &io::Error) -> Vec<u8> {
    let message = error.to_string();
    let message = &message.as_bytes()[..message.len().min(MAX_RESULT_BYTES - 6)];
    let mut packet = Vec::with_capacity(6 + message.len());
    packet.push(1);
    packet.push(error_kind_code(error.kind()));
    packet.extend_from_slice(&(message.len() as u32).to_be_bytes());
    packet.extend_from_slice(message);
    packet
}

fn decode_child_result(packet: &[u8]) -> io::Result<Vec<u8>> {
    match packet.first().copied() {
        Some(0) if packet.len() >= 5 => {
            let length =
                u32::from_be_bytes(packet[1..5].try_into().expect("length checked")) as usize;
            if length > MAX_RESULT_BYTES || packet.len() != 5 + length {
                return Err(invalid_data("broker mutation result length is invalid"));
            }
            Ok(packet[5..].to_vec())
        }
        Some(1) if packet.len() >= 6 => {
            let kind = error_kind_from_code(packet[1])?;
            let length =
                u32::from_be_bytes(packet[2..6].try_into().expect("length checked")) as usize;
            if length > MAX_RESULT_BYTES || packet.len() != 6 + length {
                return Err(invalid_data("broker mutation error length is invalid"));
            }
            let message = std::str::from_utf8(&packet[6..])
                .map_err(|_| invalid_data("broker mutation error is not utf8"))?;
            Err(io::Error::new(kind, message.to_owned()))
        }
        _ => Err(invalid_data("broker mutation result header is invalid")),
    }
}

fn pidfd_open(pid: libc::pid_t) -> io::Result<RawFd> {
    let fd = unsafe { libc::syscall(libc::SYS_pidfd_open, pid, 0) as RawFd };
    if fd < 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(fd)
    }
}

fn kill_pidfd(pidfd: RawFd) -> io::Result<()> {
    let result = unsafe {
        libc::syscall(
            libc::SYS_pidfd_send_signal,
            pidfd,
            libc::SIGKILL,
            std::ptr::null::<libc::siginfo_t>(),
            0,
        )
    };
    if result == 0 {
        Ok(())
    } else {
        let error = io::Error::last_os_error();
        if error.kind() == io::ErrorKind::NotFound {
            Ok(())
        } else {
            Err(error)
        }
    }
}

fn reap_until(
    pid: libc::pid_t,
    pidfd: RawFd,
    deadline: AbsoluteMonotonicDeadline,
) -> io::Result<()> {
    loop {
        let mut status = 0;
        let result = unsafe { libc::waitpid(pid, &mut status, libc::WNOHANG) };
        if result == pid
            || (result < 0 && io::Error::last_os_error().kind() == io::ErrorKind::NotFound)
        {
            return Ok(());
        }
        if result < 0 && io::Error::last_os_error().kind() != io::ErrorKind::Interrupted {
            return Err(io::Error::last_os_error());
        }
        let mut descriptor = libc::pollfd {
            fd: pidfd,
            events: libc::POLLIN,
            revents: 0,
        };
        let polled = unsafe { libc::poll(&mut descriptor, 1, deadline.poll_timeout_ms()?) };
        if polled == 0 {
            return Err(io::Error::new(
                io::ErrorKind::TimedOut,
                "broker mutation worker did not reap before the absolute deadline",
            ));
        }
        if polled < 0 && io::Error::last_os_error().kind() != io::ErrorKind::Interrupted {
            return Err(io::Error::last_os_error());
        }
    }
}

fn reap_blocking(pid: libc::pid_t) {
    let mut status = 0;
    while unsafe { libc::waitpid(pid, &mut status, 0) } < 0
        && io::Error::last_os_error().kind() == io::ErrorKind::Interrupted
    {}
}

fn error_kind_code(kind: io::ErrorKind) -> u8 {
    match kind {
        io::ErrorKind::InvalidInput => 1,
        io::ErrorKind::InvalidData => 2,
        io::ErrorKind::PermissionDenied => 3,
        io::ErrorKind::TimedOut => 4,
        io::ErrorKind::NotFound => 5,
        io::ErrorKind::Unsupported => 6,
        io::ErrorKind::WouldBlock => 7,
        io::ErrorKind::ConnectionReset => 8,
        _ => 255,
    }
}

fn error_kind_from_code(code: u8) -> io::Result<io::ErrorKind> {
    Ok(match code {
        1 => io::ErrorKind::InvalidInput,
        2 => io::ErrorKind::InvalidData,
        3 => io::ErrorKind::PermissionDenied,
        4 => io::ErrorKind::TimedOut,
        5 => io::ErrorKind::NotFound,
        6 => io::ErrorKind::Unsupported,
        7 => io::ErrorKind::WouldBlock,
        8 => io::ErrorKind::ConnectionReset,
        255 => io::ErrorKind::Other,
        _ => return Err(invalid_data("broker mutation error kind is invalid")),
    })
}

fn invalid_data(message: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message)
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::os::unix::net::UnixStream;
    use std::sync::atomic::{AtomicU64, Ordering};

    use super::*;

    static NEXT: AtomicU64 = AtomicU64::new(1);

    fn marker(label: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "rasen-broker-supervisor-{}-{}-{label}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ))
    }

    fn eventfd() -> RawFd {
        let fd = unsafe { libc::eventfd(0, libc::EFD_CLOEXEC) };
        assert!(fd >= 0);
        fd
    }

    fn block_on_counter(fd: RawFd) {
        let mut value = 0_u64;
        let _ = unsafe {
            libc::read(
                fd,
                (&mut value as *mut u64).cast(),
                std::mem::size_of::<u64>(),
            )
        };
    }

    #[test]
    fn deadline_kills_and_reaps_the_exact_worker_before_late_mutation() {
        let (client, _peer) = UnixStream::pair().unwrap();
        let barrier = eventfd();
        let late_marker = marker("late");
        let worker_marker = late_marker.clone();
        let outcome = BrokerMutationSupervisor::execute(
            AbsoluteMonotonicDeadline::after_ms(350).unwrap(),
            client.as_raw_fd(),
            move || {
                block_on_counter(barrier);
                fs::write(worker_marker, b"late")?;
                Ok(b"late-result".to_vec())
            },
        )
        .unwrap();
        assert_eq!(outcome.disposition, SupervisedBrokerDisposition::TimedOut);
        let one = 1_u64;
        let _ = unsafe {
            libc::write(
                barrier,
                (&one as *const u64).cast(),
                std::mem::size_of::<u64>(),
            )
        };
        unsafe { libc::close(barrier) };
        assert!(!late_marker.exists());
    }

    #[test]
    fn authenticated_client_hup_cancels_the_worker_before_commit() {
        let (client, peer) = UnixStream::pair().unwrap();
        let barrier = eventfd();
        drop(peer);
        let outcome = BrokerMutationSupervisor::execute(
            AbsoluteMonotonicDeadline::after_ms(1_000).unwrap(),
            client.as_raw_fd(),
            move || {
                block_on_counter(barrier);
                Ok(Vec::new())
            },
        )
        .unwrap();
        unsafe { libc::close(barrier) };
        assert_eq!(outcome.disposition, SupervisedBrokerDisposition::ClientGone);
    }

    #[test]
    fn authenticated_client_pidfd_death_cancels_the_worker_before_commit() {
        let (client, _peer) = UnixStream::pair().unwrap();
        let barrier = eventfd();
        let client_pid = unsafe { libc::fork() };
        assert!(client_pid >= 0);
        if client_pid == 0 {
            unsafe { libc::_exit(0) }
        }
        let outcome = BrokerMutationSupervisor::execute_for_client(
            AbsoluteMonotonicDeadline::after_ms(1_000).unwrap(),
            client.as_raw_fd(),
            client_pid as u32,
            Duration::from_millis(100),
            move || {
                block_on_counter(barrier);
                Ok(Vec::new())
            },
        )
        .unwrap();
        assert_eq!(outcome.disposition, SupervisedBrokerDisposition::ClientGone);
        let mut status = 0;
        assert_eq!(
            unsafe { libc::waitpid(client_pid, &mut status, 0) },
            client_pid
        );
        unsafe { libc::close(barrier) };
    }

    #[test]
    fn operation_longer_than_two_seconds_succeeds_under_the_original_deadline() {
        let (client, _peer) = UnixStream::pair().unwrap();
        let timer = unsafe { libc::timerfd_create(libc::CLOCK_MONOTONIC, libc::TFD_CLOEXEC) };
        assert!(timer >= 0);
        let value = libc::itimerspec {
            it_interval: libc::timespec {
                tv_sec: 0,
                tv_nsec: 0,
            },
            it_value: libc::timespec {
                tv_sec: 2,
                tv_nsec: 100_000_000,
            },
        };
        assert_eq!(
            unsafe { libc::timerfd_settime(timer, 0, &value, std::ptr::null_mut()) },
            0
        );
        let outcome = BrokerMutationSupervisor::execute(
            AbsoluteMonotonicDeadline::after_ms(3_000).unwrap(),
            client.as_raw_fd(),
            move || {
                block_on_counter(timer);
                Ok(b"committed".to_vec())
            },
        )
        .unwrap();
        unsafe { libc::close(timer) };
        assert_eq!(outcome.disposition, SupervisedBrokerDisposition::Completed);
        assert_eq!(outcome.bytes, b"committed");
    }
}
