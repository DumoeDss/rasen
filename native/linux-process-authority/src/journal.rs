use std::ffi::CString;
use std::fs::File;
use std::io::{self, Read, Write};
use std::os::fd::AsRawFd;
use std::os::unix::fs::MetadataExt;
use std::sync::atomic::{AtomicU64, Ordering};

use sha2::{Digest, Sha256};

use crate::authority::AuthorityIdentity;
use crate::lifecycle::{GuardianEvent, GuardianEventKind};

const BOUND_MAGIC: &[u8; 4] = b"RPD1";
const BOUND_VERSION: u16 = 1;
const JOURNAL_NAME: &str = "journal.bin";
const TERMINAL_NAME: &str = "terminal.bin";
const MAX_JOURNAL_BYTES: u64 = 4096;
const HMAC_BYTES: usize = 32;
static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum AtomicWriteCheckpoint {
    BeforeTempCreation,
    AfterTempWrite,
    AfterFileSync,
    AfterRename,
    AfterDirectorySync,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct JournalBinding {
    pub scope_id: [u8; 16],
    pub scope_capability: [u8; 32],
    pub launch_digest: [u8; 32],
    pub identity: AuthorityIdentity,
}

impl JournalBinding {
    fn validate(&self) -> io::Result<()> {
        if self.scope_id.iter().all(|byte| *byte == 0)
            || self.scope_capability.iter().all(|byte| *byte == 0)
            || self.launch_digest.iter().all(|byte| *byte == 0)
        {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "durable journal binding contains a zero field",
            ));
        }
        self.identity.validate()
    }
}

pub struct DurableJournal {
    directory: File,
    binding: JournalBinding,
    events: Vec<GuardianEvent>,
}

impl DurableJournal {
    pub fn create_in(directory: File, binding: JournalBinding) -> io::Result<Self> {
        validate_directory(&directory)?;
        binding.validate()?;
        let events = vec![GuardianEvent::prepared()];
        atomic_write_at(&directory, JOURNAL_NAME, &encode_bound(&binding, &events)?)?;
        Ok(Self {
            directory,
            binding,
            events,
        })
    }

    pub fn events(&self) -> &[GuardianEvent] {
        &self.events
    }

    pub fn append(&mut self, event: GuardianEvent) -> io::Result<()> {
        self.append_observed(event, |_| false)
    }

    fn append_observed<F>(&mut self, event: GuardianEvent, observer: F) -> io::Result<()>
    where
        F: FnMut(AtomicWriteCheckpoint) -> bool,
    {
        let mut candidate = self.events.clone();
        candidate.push(event);
        let bytes = encode_bound(&self.binding, &candidate)?;
        atomic_write_at_observed(&self.directory, JOURNAL_NAME, &bytes, observer)?;
        self.events = candidate;
        Ok(())
    }

    pub fn commit_terminal(&self) -> io::Result<()> {
        self.commit_terminal_observed(|_| false)
    }

    fn commit_terminal_observed<F>(&self, observer: F) -> io::Result<()>
    where
        F: FnMut(AtomicWriteCheckpoint) -> bool,
    {
        let last = self.events.last().ok_or_else(|| {
            io::Error::new(io::ErrorKind::InvalidData, "guardian journal is empty")
        })?;
        if last.kind != GuardianEventKind::ExactScopeEmpty {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "terminal state requires exact scope empty",
            ));
        }
        atomic_write_at_observed(
            &self.directory,
            TERMINAL_NAME,
            &encode_bound(&self.binding, &self.events)?,
            observer,
        )
    }

    pub fn read_bound(
        directory: &File,
        name: &str,
        binding: &JournalBinding,
    ) -> io::Result<Vec<GuardianEvent>> {
        validate_directory(directory)?;
        binding.validate()?;
        if !matches!(name, JOURNAL_NAME | TERMINAL_NAME) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "durable journal name is not closed",
            ));
        }
        let file = openat_file(directory, name, libc::O_RDONLY, 0)?;
        validate_regular_file(&file)?;
        let metadata = file.metadata()?;
        if metadata.len() > MAX_JOURNAL_BYTES {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "guardian journal exceeds its bound",
            ));
        }
        let mut bytes = Vec::with_capacity(metadata.len() as usize);
        file.take(MAX_JOURNAL_BYTES + 1).read_to_end(&mut bytes)?;
        if bytes.len() as u64 > MAX_JOURNAL_BYTES {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "guardian journal exceeds its bound",
            ));
        }
        decode_bound(binding, &bytes)
    }
}

fn encode_bound(binding: &JournalBinding, events: &[GuardianEvent]) -> io::Result<Vec<u8>> {
    binding.validate()?;
    let identity = binding.identity.encode_standalone()?;
    let journal = GuardianEvent::encode_journal(events)?;
    if identity.len() > u16::MAX as usize || journal.len() > u16::MAX as usize {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "bound durable journal component exceeds its bound",
        ));
    }
    let mut output = Vec::with_capacity(128 + journal.len());
    output.extend_from_slice(BOUND_MAGIC);
    output.extend_from_slice(&BOUND_VERSION.to_be_bytes());
    output.extend_from_slice(&binding.scope_id);
    output.extend_from_slice(&binding.launch_digest);
    output.extend_from_slice(&(identity.len() as u16).to_be_bytes());
    output.extend_from_slice(&identity);
    output.extend_from_slice(&(journal.len() as u16).to_be_bytes());
    output.extend_from_slice(&journal);
    let authentication = hmac_sha256(&binding.scope_capability, &output);
    output.extend_from_slice(&authentication);
    if output.len() as u64 > MAX_JOURNAL_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "bound durable journal exceeds its bound",
        ));
    }
    Ok(output)
}

fn decode_bound(binding: &JournalBinding, bytes: &[u8]) -> io::Result<Vec<GuardianEvent>> {
    if bytes.len() < 4 + 2 + 16 + 32 + 2 + 2 + HMAC_BYTES
        || &bytes[..4] != BOUND_MAGIC
        || u16::from_be_bytes([bytes[4], bytes[5]]) != BOUND_VERSION
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "bound durable journal header is malformed",
        ));
    }
    let authenticated_length = bytes.len() - HMAC_BYTES;
    let expected = hmac_sha256(&binding.scope_capability, &bytes[..authenticated_length]);
    if !constant_time_equal(&bytes[authenticated_length..], &expected) {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "bound durable journal authentication failed",
        ));
    }
    let mut input = &bytes[6..authenticated_length];
    let scope_id = take_array::<16>(&mut input)?;
    let launch_digest = take_array::<32>(&mut input)?;
    let identity_length = take_u16(&mut input)? as usize;
    if input.len() < identity_length {
        return Err(io::Error::new(
            io::ErrorKind::UnexpectedEof,
            "bound identity is truncated",
        ));
    }
    let identity = AuthorityIdentity::decode_standalone(&input[..identity_length])?;
    input = &input[identity_length..];
    let journal_length = take_u16(&mut input)? as usize;
    if input.len() != journal_length {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "bound event journal length is malformed",
        ));
    }
    if scope_id != binding.scope_id
        || launch_digest != binding.launch_digest
        || identity != binding.identity
    {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "durable journal binding differs from the authority reference",
        ));
    }
    GuardianEvent::decode_journal(input)
}

fn atomic_write_at(directory: &File, name: &str, bytes: &[u8]) -> io::Result<()> {
    atomic_write_at_observed(directory, name, bytes, |_| false)
}

fn atomic_write_at_observed<F>(
    directory: &File,
    name: &str,
    bytes: &[u8],
    mut observer: F,
) -> io::Result<()>
where
    F: FnMut(AtomicWriteCheckpoint) -> bool,
{
    if bytes.len() as u64 > MAX_JOURNAL_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "bound durable journal exceeds its bound",
        ));
    }
    if let Ok(existing) = openat_file(directory, name, libc::O_RDONLY, 0) {
        validate_regular_file(&existing)?;
    }
    if observer(AtomicWriteCheckpoint::BeforeTempCreation) {
        return Err(interrupted_atomic_write());
    }
    let temp_name = format!(
        ".{name}.tmp-{}-{}",
        unsafe { libc::getpid() },
        TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    );
    let mut temp = openat_file(
        directory,
        &temp_name,
        libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL,
        0o600,
    )?;
    let mut interrupted = false;
    let result = (|| {
        temp.write_all(bytes)?;
        if observer(AtomicWriteCheckpoint::AfterTempWrite) {
            interrupted = true;
            return Err(interrupted_atomic_write());
        }
        temp.sync_all()?;
        if observer(AtomicWriteCheckpoint::AfterFileSync) {
            interrupted = true;
            return Err(interrupted_atomic_write());
        }
        renameat(directory, &temp_name, name)?;
        if observer(AtomicWriteCheckpoint::AfterRename) {
            interrupted = true;
            return Err(interrupted_atomic_write());
        }
        directory.sync_all()?;
        if observer(AtomicWriteCheckpoint::AfterDirectorySync) {
            interrupted = true;
            return Err(interrupted_atomic_write());
        }
        Ok(())
    })();
    if result.is_err() && !interrupted {
        let _ = unlinkat(directory, &temp_name);
    }
    result
}

fn interrupted_atomic_write() -> io::Error {
    io::Error::new(
        io::ErrorKind::Interrupted,
        "durable write stopped at a test checkpoint",
    )
}

fn openat_file(directory: &File, name: &str, flags: i32, mode: u32) -> io::Result<File> {
    use std::os::fd::FromRawFd;

    if name.is_empty() || name.contains('/') || name.contains('\0') {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "dirfd-relative file name is malformed",
        ));
    }
    let name = CString::new(name).expect("validated name");
    let descriptor = unsafe {
        libc::openat(
            directory.as_raw_fd(),
            name.as_ptr(),
            flags | libc::O_CLOEXEC | libc::O_NOFOLLOW,
            mode,
        )
    };
    if descriptor < 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(unsafe { File::from_raw_fd(descriptor) })
    }
}

fn renameat(directory: &File, from: &str, to: &str) -> io::Result<()> {
    let from = CString::new(from).expect("internal temporary name");
    let to = CString::new(to).expect("closed durable name");
    if unsafe {
        libc::renameat(
            directory.as_raw_fd(),
            from.as_ptr(),
            directory.as_raw_fd(),
            to.as_ptr(),
        )
    } < 0
    {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

fn unlinkat(directory: &File, name: &str) -> io::Result<()> {
    let name = CString::new(name).expect("internal temporary name");
    if unsafe { libc::unlinkat(directory.as_raw_fd(), name.as_ptr(), 0) } < 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

fn validate_directory(directory: &File) -> io::Result<()> {
    let metadata = directory.metadata()?;
    if !metadata.is_dir()
        || metadata.uid() != unsafe { libc::geteuid() }
        || metadata.mode() & 0o777 != 0o700
    {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "durable state dirfd ownership or mode is invalid",
        ));
    }
    Ok(())
}

fn validate_regular_file(file: &File) -> io::Result<()> {
    let metadata = file.metadata()?;
    if !metadata.is_file()
        || metadata.uid() != unsafe { libc::geteuid() }
        || metadata.mode() & 0o777 != 0o600
    {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "durable state file ownership or mode is invalid",
        ));
    }
    Ok(())
}

fn hmac_sha256(key: &[u8; 32], message: &[u8]) -> [u8; 32] {
    let mut inner_key = [0x36_u8; 64];
    let mut outer_key = [0x5c_u8; 64];
    for (index, byte) in key.iter().enumerate() {
        inner_key[index] ^= byte;
        outer_key[index] ^= byte;
    }
    let mut inner = Sha256::new();
    inner.update(inner_key);
    inner.update(message);
    let inner = inner.finalize();
    let mut outer = Sha256::new();
    outer.update(outer_key);
    outer.update(inner);
    outer.finalize().into()
}

pub(crate) fn keyed_authentication(key: &[u8; 32], domain: &[u8], parts: &[&[u8]]) -> [u8; 32] {
    let mut message =
        Vec::with_capacity(domain.len() + parts.iter().map(|part| part.len()).sum::<usize>());
    message.extend_from_slice(domain);
    for part in parts {
        message.extend_from_slice(part);
    }
    hmac_sha256(key, &message)
}

fn constant_time_equal(left: &[u8], right: &[u8]) -> bool {
    left.len() == right.len()
        && left
            .iter()
            .zip(right)
            .fold(0_u8, |difference, (left, right)| {
                difference | (left ^ right)
            })
            == 0
}

fn take_u16(input: &mut &[u8]) -> io::Result<u16> {
    if input.len() < 2 {
        return Err(io::Error::new(io::ErrorKind::UnexpectedEof, "missing u16"));
    }
    let value = u16::from_be_bytes(input[..2].try_into().expect("length checked"));
    *input = &input[2..];
    Ok(value)
}

fn take_array<const N: usize>(input: &mut &[u8]) -> io::Result<[u8; N]> {
    if input.len() < N {
        return Err(io::Error::new(
            io::ErrorKind::UnexpectedEof,
            "bound durable field is truncated",
        ));
    }
    let value = input[..N].try_into().expect("length checked");
    *input = &input[N..];
    Ok(value)
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::os::unix::fs::PermissionsExt;
    use std::path::PathBuf;

    use super::*;
    use crate::lifecycle::RootExit;

    #[derive(Clone, Copy, Debug)]
    enum CrashPoint {
        BeforeJournalTemp,
        AfterJournalTempWrite,
        AfterJournalFileSync,
        AfterJournalRename,
        BeforeTerminalTemp,
        AfterTerminalFileSync,
        AfterTerminalRename,
        AfterTerminalDirectorySync,
    }

    impl CrashPoint {
        fn journal_was_renamed(self) -> bool {
            matches!(
                self,
                Self::AfterJournalRename
                    | Self::BeforeTerminalTemp
                    | Self::AfterTerminalFileSync
                    | Self::AfterTerminalRename
                    | Self::AfterTerminalDirectorySync
            )
        }

        fn terminal_was_renamed(self) -> bool {
            matches!(
                self,
                Self::AfterTerminalRename | Self::AfterTerminalDirectorySync
            )
        }
    }

    #[test]
    fn atomic_write_crash_checkpoints_reopen_retained_or_authentic_terminal() {
        for (index, crash_point) in [
            CrashPoint::BeforeJournalTemp,
            CrashPoint::AfterJournalTempWrite,
            CrashPoint::AfterJournalFileSync,
            CrashPoint::AfterJournalRename,
            CrashPoint::BeforeTerminalTemp,
            CrashPoint::AfterTerminalFileSync,
            CrashPoint::AfterTerminalRename,
            CrashPoint::AfterTerminalDirectorySync,
        ]
        .into_iter()
        .enumerate()
        {
            let path = private_test_directory(index);
            let directory = File::open(&path).unwrap();
            let binding = test_binding(index);
            let mut journal =
                DurableJournal::create_in(directory.try_clone().unwrap(), binding.clone()).unwrap();
            journal.append(GuardianEvent::activated(2)).unwrap();
            journal
                .append(GuardianEvent::root_exited(3, RootExit::Code(23)))
                .unwrap();

            let interrupted = match crash_point {
                CrashPoint::BeforeJournalTemp => journal.append_observed(
                    GuardianEvent::exact_empty(4),
                    stop_at(AtomicWriteCheckpoint::BeforeTempCreation),
                ),
                CrashPoint::AfterJournalTempWrite => journal.append_observed(
                    GuardianEvent::exact_empty(4),
                    stop_at(AtomicWriteCheckpoint::AfterTempWrite),
                ),
                CrashPoint::AfterJournalFileSync => journal.append_observed(
                    GuardianEvent::exact_empty(4),
                    stop_at(AtomicWriteCheckpoint::AfterFileSync),
                ),
                CrashPoint::AfterJournalRename => journal.append_observed(
                    GuardianEvent::exact_empty(4),
                    stop_at(AtomicWriteCheckpoint::AfterRename),
                ),
                CrashPoint::BeforeTerminalTemp => {
                    journal.append(GuardianEvent::exact_empty(4)).unwrap();
                    journal.commit_terminal_observed(stop_at(
                        AtomicWriteCheckpoint::BeforeTempCreation,
                    ))
                }
                CrashPoint::AfterTerminalFileSync => {
                    journal.append(GuardianEvent::exact_empty(4)).unwrap();
                    journal.commit_terminal_observed(stop_at(AtomicWriteCheckpoint::AfterFileSync))
                }
                CrashPoint::AfterTerminalRename => {
                    journal.append(GuardianEvent::exact_empty(4)).unwrap();
                    journal.commit_terminal_observed(stop_at(AtomicWriteCheckpoint::AfterRename))
                }
                CrashPoint::AfterTerminalDirectorySync => {
                    journal.append(GuardianEvent::exact_empty(4)).unwrap();
                    journal.commit_terminal_observed(stop_at(
                        AtomicWriteCheckpoint::AfterDirectorySync,
                    ))
                }
            };
            assert_eq!(
                interrupted.unwrap_err().kind(),
                io::ErrorKind::Interrupted,
                "writer did not stop at {crash_point:?}"
            );

            let journal_events =
                DurableJournal::read_bound(&directory, JOURNAL_NAME, &binding).unwrap();
            let expected_last = if crash_point.journal_was_renamed() {
                GuardianEventKind::ExactScopeEmpty
            } else {
                GuardianEventKind::RootExited
            };
            assert_eq!(
                journal_events.last().map(|event| event.kind),
                Some(expected_last),
                "journal reopen at {crash_point:?}"
            );
            assert_eq!(
                journal_events.iter().find_map(|event| event.root_exit),
                Some(RootExit::Code(23)),
                "root status changed at {crash_point:?}"
            );

            let terminal = DurableJournal::read_bound(&directory, TERMINAL_NAME, &binding);
            if crash_point.terminal_was_renamed() {
                let terminal_events = terminal.expect("renamed terminal must authenticate");
                assert_eq!(
                    terminal_events.last().map(|event| event.kind),
                    Some(GuardianEventKind::ExactScopeEmpty)
                );
                assert_eq!(
                    terminal_events.iter().find_map(|event| event.root_exit),
                    Some(RootExit::Code(23))
                );
            } else {
                assert_eq!(terminal.unwrap_err().kind(), io::ErrorKind::NotFound);
            }
            fs::remove_dir_all(path).unwrap();
        }
    }

    fn stop_at(target: AtomicWriteCheckpoint) -> impl FnMut(AtomicWriteCheckpoint) -> bool {
        move |checkpoint| checkpoint == target
    }

    fn private_test_directory(index: usize) -> PathBuf {
        let path = PathBuf::from("/tmp").join(format!(
            "rpa-journal-crash-{}-{}-{index}",
            std::process::id(),
            TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&path).unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o700)).unwrap();
        path
    }

    fn test_binding(index: usize) -> JournalBinding {
        JournalBinding {
            scope_id: [0x21 + index as u8; 16],
            scope_capability: [0x31 + index as u8; 32],
            launch_digest: [0x41 + index as u8; 32],
            identity: AuthorityIdentity {
                boot_id: "11111111-2222-3333-4444-555555555555".to_owned(),
                guardian_pid: 6000 + index as u32,
                start_ticks: 2000 + index as u64,
                pid_namespace_device: 4,
                pid_namespace_inode: 200 + index as u64,
            },
        }
    }
}
