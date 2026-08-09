use std::io;
use std::os::fd::RawFd;
use std::time::Duration;

pub const MAX_BROKER_PHASE: Duration = Duration::from_secs(300);

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct AbsoluteMonotonicDeadline {
    expires_at_ns: u64,
}

impl AbsoluteMonotonicDeadline {
    pub fn from_absolute_ns(value: u64) -> io::Result<Self> {
        if value == 0 {
            return Err(invalid_input("monotonic deadline is zero"));
        }
        Ok(Self {
            expires_at_ns: value,
        })
    }

    pub fn after_ms(value: u32) -> io::Result<Self> {
        if value == 0 || Duration::from_millis(u64::from(value)) > MAX_BROKER_PHASE {
            return Err(invalid_input("broker phase budget is malformed"));
        }
        let expires_at_ns = monotonic_now_ns()?
            .checked_add(u64::from(value) * 1_000_000)
            .ok_or_else(|| io::Error::other("monotonic deadline overflowed"))?;
        Ok(Self { expires_at_ns })
    }

    pub fn from_duration(value: Duration) -> io::Result<Self> {
        let expires_at_ns = value
            .as_nanos()
            .try_into()
            .map_err(|_| invalid_input("monotonic deadline exceeds its wire bound"))?;
        Self::from_absolute_ns(expires_at_ns)
    }

    pub fn absolute_ns(self) -> io::Result<u64> {
        Ok(self.expires_at_ns)
    }

    pub fn remaining(self) -> io::Result<Duration> {
        Ok(Duration::from_nanos(
            self.expires_at_ns.saturating_sub(monotonic_now_ns()?),
        ))
    }

    pub fn remaining_at(self, now: Duration) -> Duration {
        Duration::from_nanos(self.expires_at_ns).saturating_sub(now)
    }

    pub fn is_expired_at(self, now: Duration) -> bool {
        now >= Duration::from_nanos(self.expires_at_ns)
    }

    pub fn is_expired(self) -> io::Result<bool> {
        Ok(monotonic_now_ns()? >= self.expires_at_ns)
    }

    pub fn ensure_live(self) -> io::Result<()> {
        if self.is_expired()? {
            Err(io::Error::new(
                io::ErrorKind::TimedOut,
                "absolute monotonic deadline expired",
            ))
        } else {
            Ok(())
        }
    }

    pub fn poll_timeout_ms(self) -> io::Result<i32> {
        let remaining = self.remaining()?;
        if remaining.is_zero() {
            return Ok(0);
        }
        let rounded = remaining
            .as_millis()
            .saturating_add(u128::from(remaining.subsec_nanos() % 1_000_000 != 0));
        Ok(rounded.min(i32::MAX as u128) as i32)
    }

    pub fn reserve(self, cleanup: Duration) -> io::Result<Self> {
        let cleanup_ns: u64 = cleanup
            .as_nanos()
            .try_into()
            .map_err(|_| invalid_input("deadline cleanup reserve exceeds its bound"))?;
        let cutoff = self
            .expires_at_ns
            .checked_sub(cleanup_ns)
            .ok_or_else(|| invalid_input("deadline cannot contain its cleanup reserve"))?;
        let value = Self {
            expires_at_ns: cutoff,
        };
        value.ensure_live()?;
        Ok(value)
    }
}

pub fn monotonic_now_ns() -> io::Result<u64> {
    let mut value = libc::timespec {
        tv_sec: 0,
        tv_nsec: 0,
    };
    if unsafe { libc::clock_gettime(libc::CLOCK_MONOTONIC, &mut value) } != 0 {
        return Err(io::Error::last_os_error());
    }
    u64::try_from(value.tv_sec)
        .ok()
        .and_then(|seconds| seconds.checked_mul(1_000_000_000))
        .and_then(|seconds| seconds.checked_add(value.tv_nsec.max(0) as u64))
        .ok_or_else(|| io::Error::other("monotonic clock exceeds its wire bound"))
}

pub fn poll_fd(fd: RawFd, events: i16, deadline: AbsoluteMonotonicDeadline) -> io::Result<i16> {
    loop {
        deadline.ensure_live()?;
        let mut descriptor = libc::pollfd {
            fd,
            events,
            revents: 0,
        };
        let result = unsafe { libc::poll(&mut descriptor, 1, deadline.poll_timeout_ms()?) };
        if result > 0 {
            return Ok(descriptor.revents);
        }
        if result == 0 {
            return Err(io::Error::new(
                io::ErrorKind::TimedOut,
                "absolute monotonic deadline expired while polling",
            ));
        }
        let error = io::Error::last_os_error();
        if error.kind() != io::ErrorKind::Interrupted {
            return Err(error);
        }
    }
}

pub fn read_exact_fd_until(
    fd: RawFd,
    bytes: &mut [u8],
    deadline: AbsoluteMonotonicDeadline,
) -> io::Result<()> {
    let mut offset = 0;
    while offset < bytes.len() {
        let revents = poll_fd(fd, libc::POLLIN, deadline)?;
        if revents & (libc::POLLERR | libc::POLLNVAL) != 0 {
            return Err(io::Error::new(
                io::ErrorKind::BrokenPipe,
                "deadline-bound input descriptor failed",
            ));
        }
        let count = unsafe {
            libc::read(
                fd,
                bytes[offset..].as_mut_ptr().cast(),
                bytes.len() - offset,
            )
        };
        if count == 0 {
            return Err(io::Error::new(io::ErrorKind::UnexpectedEof, "pipe closed"));
        }
        if count < 0 {
            let error = io::Error::last_os_error();
            if matches!(
                error.kind(),
                io::ErrorKind::Interrupted | io::ErrorKind::WouldBlock
            ) {
                continue;
            }
            return Err(error);
        }
        offset += count as usize;
    }
    Ok(())
}

pub fn write_all_fd_until(
    fd: RawFd,
    bytes: &[u8],
    deadline: AbsoluteMonotonicDeadline,
) -> io::Result<()> {
    let mut offset = 0;
    while offset < bytes.len() {
        let revents = poll_fd(fd, libc::POLLOUT, deadline)?;
        if revents & (libc::POLLERR | libc::POLLHUP | libc::POLLNVAL) != 0 {
            return Err(io::Error::new(
                io::ErrorKind::BrokenPipe,
                "deadline-bound output descriptor failed",
            ));
        }
        let count =
            unsafe { libc::write(fd, bytes[offset..].as_ptr().cast(), bytes.len() - offset) };
        if count < 0 {
            let error = io::Error::last_os_error();
            if matches!(
                error.kind(),
                io::ErrorKind::Interrupted | io::ErrorKind::WouldBlock
            ) {
                continue;
            }
            return Err(error);
        }
        offset += count as usize;
    }
    Ok(())
}

fn invalid_input(message: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidInput, message)
}
