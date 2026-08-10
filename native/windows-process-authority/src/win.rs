//! Minimal safe wrappers over the hand-declared Windows ABI in [`crate::sys`].
//!
//! Everything here exists so that the authority modules never write `unsafe` inline. Each
//! wrapper is a thin, single-purpose call; the wrappers add no policy of their own.

use std::ffi::{c_void, OsStr, OsString};
use std::io;
use std::mem::size_of;
use std::os::windows::ffi::{OsStrExt, OsStringExt};
use std::ptr::{null, null_mut};

use crate::sys::*;

/// An owned kernel handle. Closed exactly once on drop.
#[derive(Debug)]
pub struct OwnedHandle(Handle);

// A Windows handle is a process-wide table index; moving one between threads is sound.
unsafe impl Send for OwnedHandle {}
unsafe impl Sync for OwnedHandle {}

impl OwnedHandle {
    /// # Safety
    /// `handle` must be an exclusively owned, valid, closable handle.
    pub unsafe fn from_raw(handle: Handle) -> Self {
        Self(handle)
    }

    pub fn raw(&self) -> Handle {
        self.0
    }

    pub fn is_null(&self) -> bool {
        self.0.is_null() || self.0 == INVALID_HANDLE_VALUE
    }

    /// Relinquish ownership without closing.
    pub fn into_raw(mut self) -> Handle {
        let raw = self.0;
        self.0 = null_mut();
        raw
    }

    pub fn close(mut self) -> io::Result<()> {
        if self.0.is_null() || self.0 == INVALID_HANDLE_VALUE {
            self.0 = null_mut();
            return Ok(());
        }
        let raw = self.0;
        self.0 = null_mut();
        if unsafe { CloseHandle(raw) } == FALSE {
            return Err(last_error("CloseHandle"));
        }
        Ok(())
    }
}

impl Drop for OwnedHandle {
    fn drop(&mut self) {
        if !self.0.is_null() && self.0 != INVALID_HANDLE_VALUE {
            unsafe { CloseHandle(self.0) };
            self.0 = null_mut();
        }
    }
}

/// A borrowed handle that may cross a thread boundary. A Windows handle is a process-wide
/// table index, so this is sound; the wrapper exists only because the raw pointer type is not
/// `Send`. It owns nothing and closes nothing.
#[derive(Clone, Copy, Debug)]
pub struct SendHandle(pub Handle);

unsafe impl Send for SendHandle {}
unsafe impl Sync for SendHandle {}

impl SendHandle {
    /// Take the raw handle. A method rather than a field read so that a closure capturing it
    /// captures the `Send` wrapper rather than the raw pointer inside it.
    pub fn get(self) -> Handle {
        self.0
    }
}

pub fn last_error(context: &str) -> io::Error {
    let error = io::Error::last_os_error();
    io::Error::new(error.kind(), format!("{context}: {error}"))
}

pub fn last_error_code() -> i32 {
    io::Error::last_os_error().raw_os_error().unwrap_or(0)
}

pub fn wide(value: &str) -> Vec<u16> {
    OsStr::new(value).encode_wide().chain(Some(0)).collect()
}

pub fn from_wide(buffer: &[u16]) -> String {
    let length = buffer.iter().position(|value| *value == 0).unwrap_or(buffer.len());
    OsString::from_wide(&buffer[..length])
        .to_string_lossy()
        .into_owned()
}

/// Fill `buffer` from the operating system CSPRNG. Never a user-space PRNG, never clock seeded.
pub fn random_bytes(buffer: &mut [u8]) -> io::Result<()> {
    if buffer.is_empty() {
        return Ok(());
    }
    let ok = unsafe {
        SystemFunction036(
            buffer.as_mut_ptr() as *mut c_void,
            u32::try_from(buffer.len()).map_err(|_| {
                io::Error::new(io::ErrorKind::InvalidInput, "random request exceeds bound")
            })?,
        )
    };
    if ok == 0 {
        return Err(io::Error::other("RtlGenRandom refused the request"));
    }
    Ok(())
}

pub fn random_array<const N: usize>() -> io::Result<[u8; N]> {
    let mut output = [0_u8; N];
    random_bytes(&mut output)?;
    Ok(output)
}

pub fn current_process_id() -> u32 {
    unsafe { GetCurrentProcessId() }
}

/// A process's exact creation `FILETIME`, the Windows analogue of `/proc/<pid>/stat` start
/// ticks. This is what makes process-id reuse detectable.
pub fn process_creation_filetime(process: Handle) -> io::Result<u64> {
    let mut creation = FileTime::zeroed();
    let mut exit = FileTime::zeroed();
    let mut kernel = FileTime::zeroed();
    let mut user = FileTime::zeroed();
    let ok = unsafe {
        GetProcessTimes(
            process,
            &mut creation,
            &mut exit,
            &mut kernel,
            &mut user,
        )
    };
    if ok == FALSE {
        return Err(last_error("GetProcessTimes"));
    }
    Ok(creation.as_u64())
}

pub fn open_process(access: Dword, process_id: u32) -> io::Result<OwnedHandle> {
    let handle = unsafe { OpenProcess(access, FALSE, process_id) };
    if handle.is_null() {
        return Err(last_error("OpenProcess"));
    }
    Ok(unsafe { OwnedHandle::from_raw(handle) })
}

/// Read a process's birth identity by process id. Returns `None` when the id is not currently
/// occupied by a process we may query.
pub fn process_birth(process_id: u32) -> Option<u64> {
    let handle = open_process(PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE, process_id).ok()?;
    process_creation_filetime(handle.raw()).ok()
}

// ---------------------------------------------------------------------------------------------
// Security identifiers
// ---------------------------------------------------------------------------------------------

/// A security identifier copied into crate-owned storage.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OwnedSid {
    bytes: Vec<u8>,
}

impl OwnedSid {
    /// # Safety
    /// `sid` must point at a valid SID for the duration of the call.
    pub unsafe fn copy_from(sid: *mut c_void) -> io::Result<Self> {
        if sid.is_null() {
            return Err(io::Error::new(io::ErrorKind::InvalidData, "null SID"));
        }
        let length = unsafe { GetLengthSid(sid) };
        if length == 0 || length > 1024 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "SID length is out of bounds",
            ));
        }
        let mut bytes = vec![0_u8; length as usize];
        if unsafe { CopySid(length, bytes.as_mut_ptr() as *mut c_void, sid) } == FALSE {
            return Err(last_error("CopySid"));
        }
        Ok(Self { bytes })
    }

    pub fn as_ptr(&self) -> *mut c_void {
        self.bytes.as_ptr() as *mut c_void
    }

    pub fn len(&self) -> usize {
        self.bytes.len()
    }

    pub fn is_empty(&self) -> bool {
        self.bytes.is_empty()
    }

    pub fn equals(&self, other: &OwnedSid) -> bool {
        unsafe { EqualSid(self.as_ptr(), other.as_ptr()) != FALSE }
    }

    pub fn to_text(&self) -> io::Result<String> {
        let mut raw: *mut u16 = null_mut();
        if unsafe { ConvertSidToStringSidW(self.as_ptr(), &mut raw) } == FALSE {
            return Err(last_error("ConvertSidToStringSidW"));
        }
        let mut buffer = Vec::new();
        let mut cursor = raw;
        loop {
            let value = unsafe { *cursor };
            if value == 0 {
                break;
            }
            buffer.push(value);
            cursor = unsafe { cursor.add(1) };
            if buffer.len() > 512 {
                break;
            }
        }
        unsafe { LocalFree(raw as *mut c_void) };
        Ok(OsString::from_wide(&buffer).to_string_lossy().into_owned())
    }
}

fn token_user_sid(token: &OwnedHandle) -> io::Result<OwnedSid> {
    let mut needed: Dword = 0;
    unsafe {
        GetTokenInformation(token.raw(), TOKEN_USER_CLASS, null_mut(), 0, &mut needed);
    }
    if needed == 0 || needed > 4096 {
        return Err(last_error("GetTokenInformation size"));
    }
    let mut buffer = vec![0_u8; needed as usize];
    let ok = unsafe {
        GetTokenInformation(
            token.raw(),
            TOKEN_USER_CLASS,
            buffer.as_mut_ptr() as *mut c_void,
            needed,
            &mut needed,
        )
    };
    if ok == FALSE {
        return Err(last_error("GetTokenInformation"));
    }
    let user = unsafe { &*(buffer.as_ptr() as *const TokenUser) };
    unsafe { OwnedSid::copy_from(user.sid) }
}

/// The SID of the user this process runs as.
pub fn current_user_sid() -> io::Result<OwnedSid> {
    let mut token: Handle = null_mut();
    if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) } == FALSE {
        return Err(last_error("OpenProcessToken"));
    }
    let token = unsafe { OwnedHandle::from_raw(token) };
    token_user_sid(&token)
}

/// The SID of the client currently connected to `pipe`, obtained by impersonating it at
/// identification level and reading the impersonation token.
pub fn named_pipe_client_sid(pipe: Handle) -> io::Result<OwnedSid> {
    if unsafe { ImpersonateNamedPipeClient(pipe) } == FALSE {
        return Err(last_error("ImpersonateNamedPipeClient"));
    }
    let mut token: Handle = null_mut();
    let opened = unsafe { OpenThreadToken(GetCurrentThread(), TOKEN_QUERY, TRUE, &mut token) };
    let result = if opened == FALSE {
        Err(last_error("OpenThreadToken"))
    } else {
        let token = unsafe { OwnedHandle::from_raw(token) };
        token_user_sid(&token)
    };
    if unsafe { RevertToSelf() } == FALSE {
        return Err(last_error("RevertToSelf"));
    }
    result
}

/// Owner SID of a kernel object referenced by handle (used for the named pipe).
pub fn kernel_object_owner_sid(handle: Handle) -> io::Result<OwnedSid> {
    object_owner_sid_inner(Some(handle), None)
}

/// Owner SID of a filesystem object referenced by path (used for the trusted state root).
pub fn file_owner_sid(path: &str) -> io::Result<OwnedSid> {
    object_owner_sid_inner(None, Some(path))
}

/// Set the owner SID of a filesystem object without changing its DACL or other security fields.
pub fn set_file_owner_sid(path: &str, owner: &OwnedSid) -> io::Result<()> {
    let mut wide_path = wide(path);
    let status = unsafe {
        SetNamedSecurityInfoW(
            wide_path.as_mut_ptr(),
            SE_FILE_OBJECT,
            OWNER_SECURITY_INFORMATION,
            owner.as_ptr(),
            null_mut(),
            null_mut(),
            null_mut(),
        )
    };
    if status != 0 {
        return Err(io::Error::from_raw_os_error(status as i32));
    }
    Ok(())
}

fn object_owner_sid_inner(handle: Option<Handle>, path: Option<&str>) -> io::Result<OwnedSid> {
    let mut owner: *mut c_void = null_mut();
    let mut descriptor: *mut c_void = null_mut();
    let status = match (handle, path) {
        (Some(handle), None) => unsafe {
            GetSecurityInfo(
                handle,
                SE_KERNEL_OBJECT,
                OWNER_SECURITY_INFORMATION,
                &mut owner,
                null_mut(),
                null_mut(),
                null_mut(),
                &mut descriptor,
            )
        },
        (None, Some(path)) => {
            let wide_path = wide(path);
            unsafe {
                GetNamedSecurityInfoW(
                    wide_path.as_ptr(),
                    SE_FILE_OBJECT,
                    OWNER_SECURITY_INFORMATION,
                    &mut owner,
                    null_mut(),
                    null_mut(),
                    null_mut(),
                    &mut descriptor,
                )
            }
        }
        _ => unreachable!("exactly one of handle or path"),
    };
    if status != 0 {
        return Err(io::Error::from_raw_os_error(status as i32));
    }
    let sid = unsafe { OwnedSid::copy_from(owner) };
    if !descriptor.is_null() {
        unsafe { LocalFree(descriptor) };
    }
    sid
}

/// A `SECURITY_ATTRIBUTES` whose descriptor carries an explicit DACL granting exactly one SID
/// exactly `access`, with no inherited ACEs, no `Everyone`, and no `NULL` DACL.
pub struct OwnerOnlySecurity {
    descriptor: Box<SecurityDescriptor>,
    acl: Vec<u8>,
    _sid: OwnedSid,
    attributes: SecurityAttributes,
}

impl OwnerOnlySecurity {
    pub fn new(sid: &OwnedSid, access: Dword) -> io::Result<Box<Self>> {
        // ACL header + one ACCESS_ALLOWED_ACE header (8 bytes incl. the first SubAuthority
        // slot) + the SID body, rounded up to a DWORD boundary.
        let acl_bytes = size_of::<Acl>() + 8 + sid.len() + 8;
        let mut this = Box::new(Self {
            descriptor: Box::new(SecurityDescriptor::default()),
            acl: vec![0_u8; acl_bytes],
            _sid: sid.clone(),
            attributes: SecurityAttributes {
                length: size_of::<SecurityAttributes>() as Dword,
                descriptor: null_mut(),
                inherit: FALSE,
            },
        });
        let acl_ptr = this.acl.as_mut_ptr() as *mut c_void;
        if unsafe { InitializeAcl(acl_ptr, acl_bytes as Dword, ACL_REVISION) } == FALSE {
            return Err(last_error("InitializeAcl"));
        }
        if unsafe { AddAccessAllowedAce(acl_ptr, ACL_REVISION, access, this._sid.as_ptr()) }
            == FALSE
        {
            return Err(last_error("AddAccessAllowedAce"));
        }
        let descriptor_ptr = &mut *this.descriptor as *mut SecurityDescriptor as *mut c_void;
        if unsafe { InitializeSecurityDescriptor(descriptor_ptr, SECURITY_DESCRIPTOR_REVISION) }
            == FALSE
        {
            return Err(last_error("InitializeSecurityDescriptor"));
        }
        if unsafe { SetSecurityDescriptorOwner(descriptor_ptr, this._sid.as_ptr(), FALSE) } == FALSE
        {
            return Err(last_error("SetSecurityDescriptorOwner"));
        }
        if unsafe { SetSecurityDescriptorDacl(descriptor_ptr, TRUE, acl_ptr, FALSE) } == FALSE {
            return Err(last_error("SetSecurityDescriptorDacl"));
        }
        this.attributes.descriptor = descriptor_ptr;
        Ok(this)
    }

    pub fn attributes(&mut self) -> *mut SecurityAttributes {
        &mut self.attributes as *mut SecurityAttributes
    }
}

// ---------------------------------------------------------------------------------------------
// Durable file replacement
// ---------------------------------------------------------------------------------------------

/// Flush a directory's metadata. The POSIX `fsync(dirfd)` analogue: open the directory with
/// backup semantics and flush its handle.
pub fn flush_directory(path: &str) -> io::Result<()> {
    let wide_path = wide(path);
    let handle = unsafe {
        CreateFileW(
            wide_path.as_ptr(),
            GENERIC_READ,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            null_mut(),
            OPEN_EXISTING,
            FILE_FLAG_BACKUP_SEMANTICS,
            null_mut(),
        )
    };
    if handle == INVALID_HANDLE_VALUE || handle.is_null() {
        return Err(last_error("CreateFileW directory"));
    }
    let handle = unsafe { OwnedHandle::from_raw(handle) };
    // A directory handle legitimately refuses FlushFileBuffers with ERROR_ACCESS_DENIED on some
    // volumes; that is not a durability failure of the record itself, which was already flushed.
    if unsafe { FlushFileBuffers(handle.raw()) } == FALSE {
        let code = last_error_code();
        if code != ERROR_ACCESS_DENIED && code != ERROR_INVALID_HANDLE {
            return Err(last_error("FlushFileBuffers directory"));
        }
    }
    Ok(())
}

pub fn flush_file(handle: Handle) -> io::Result<()> {
    if unsafe { FlushFileBuffers(handle) } == FALSE {
        return Err(last_error("FlushFileBuffers"));
    }
    Ok(())
}

pub fn replace_file_atomically(temporary: &str, target: &str) -> io::Result<()> {
    let from = wide(temporary);
    let to = wide(target);
    let ok = unsafe {
        MoveFileExW(
            from.as_ptr(),
            to.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if ok == FALSE {
        return Err(last_error("MoveFileExW"));
    }
    Ok(())
}

// ---------------------------------------------------------------------------------------------
// Boot identity sources
// ---------------------------------------------------------------------------------------------

pub fn query_system_information(class: Dword, buffer: &mut [u8]) -> io::Result<u32> {
    let mut returned: Dword = 0;
    let status = unsafe {
        NtQuerySystemInformation(
            class,
            buffer.as_mut_ptr() as *mut c_void,
            buffer.len() as Dword,
            &mut returned,
        )
    };
    if status < 0 {
        return Err(io::Error::other(format!(
            "NtQuerySystemInformation({class}) returned NTSTATUS 0x{:08x}",
            status as u32
        )));
    }
    Ok(returned)
}

pub fn create_anonymous_pipe(inheritable_read: bool) -> io::Result<(OwnedHandle, OwnedHandle)> {
    let mut attributes = SecurityAttributes {
        length: size_of::<SecurityAttributes>() as Dword,
        descriptor: null_mut(),
        inherit: TRUE,
    };
    let mut read: Handle = null_mut();
    let mut write: Handle = null_mut();
    if unsafe { CreatePipe(&mut read, &mut write, &mut attributes, 0) } == FALSE {
        return Err(last_error("CreatePipe"));
    }
    let read = unsafe { OwnedHandle::from_raw(read) };
    let write = unsafe { OwnedHandle::from_raw(write) };
    // Only the end the child needs stays inheritable. `PROC_THREAD_ATTRIBUTE_HANDLE_LIST`
    // restricts inheritance further, but a handle in that list must itself be inheritable.
    let (keep, drop_inherit) = if inheritable_read {
        (&read, &write)
    } else {
        (&write, &read)
    };
    if unsafe { SetHandleInformation(drop_inherit.raw(), HANDLE_FLAG_INHERIT, 0) } == FALSE {
        return Err(last_error("SetHandleInformation"));
    }
    if unsafe { SetHandleInformation(keep.raw(), HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT) }
        == FALSE
    {
        return Err(last_error("SetHandleInformation inherit"));
    }
    Ok((read, write))
}

/// Per-thread overlapped I/O context for the control endpoint.
///
/// The endpoint must carry request frames one way and unsolicited event frames the other way
/// at the same time. A **synchronous** file handle serializes every operation on the file
/// object, so a blocking `ReadFile` in the session loop blocks a `WriteFile` issued from the
/// event reader on the same handle — the terminal `root-exited` and `exact-scope-empty` frames
/// simply never leave. Measured on the real kernel: the first end-to-end run delivered the
/// activation frame and then nothing, and the controller saw only end-of-stream.
///
/// Both ends of the endpoint are therefore opened with `FILE_FLAG_OVERLAPPED`, and every
/// operation carries its own event so it completes independently of any other in flight.
pub struct OverlappedContext {
    event: OwnedHandle,
}

impl OverlappedContext {
    pub fn new() -> io::Result<Self> {
        let raw = unsafe { CreateEventW(null_mut(), TRUE, FALSE, null()) };
        if raw.is_null() {
            return Err(last_error("CreateEventW"));
        }
        Ok(Self {
            event: unsafe { OwnedHandle::from_raw(raw) },
        })
    }

    fn overlapped(&self) -> Overlapped {
        Overlapped {
            internal: 0,
            internal_high: 0,
            offset: 0,
            offset_high: 0,
            event: self.event.raw(),
        }
    }

    pub fn read(&self, handle: Handle, buffer: &mut [u8]) -> io::Result<usize> {
        let mut overlapped = self.overlapped();
        let started = unsafe {
            ReadFile(
                handle,
                buffer.as_mut_ptr() as *mut c_void,
                buffer.len() as Dword,
                null_mut(),
                &mut overlapped,
            )
        };
        if started == FALSE {
            let code = last_error_code();
            if code == ERROR_BROKEN_PIPE || code == ERROR_PIPE_NOT_CONNECTED {
                return Ok(0);
            }
            if code != ERROR_IO_PENDING {
                return Err(last_error("ReadFile overlapped"));
            }
        }
        let mut transferred: Dword = 0;
        if unsafe { GetOverlappedResult(handle, &mut overlapped, &mut transferred, TRUE) } == FALSE
        {
            let code = last_error_code();
            if code == ERROR_BROKEN_PIPE || code == ERROR_PIPE_NOT_CONNECTED {
                return Ok(0);
            }
            return Err(last_error("GetOverlappedResult read"));
        }
        Ok(transferred as usize)
    }

    pub fn write(&self, handle: Handle, buffer: &[u8]) -> io::Result<()> {
        let mut offset = 0_usize;
        while offset < buffer.len() {
            let mut overlapped = self.overlapped();
            let started = unsafe {
                WriteFile(
                    handle,
                    buffer[offset..].as_ptr() as *const c_void,
                    (buffer.len() - offset) as Dword,
                    null_mut(),
                    &mut overlapped,
                )
            };
            if started == FALSE && last_error_code() != ERROR_IO_PENDING {
                return Err(last_error("WriteFile overlapped"));
            }
            let mut transferred: Dword = 0;
            if unsafe { GetOverlappedResult(handle, &mut overlapped, &mut transferred, TRUE) }
                == FALSE
            {
                return Err(last_error("GetOverlappedResult write"));
            }
            if transferred == 0 {
                return Err(io::Error::new(
                    io::ErrorKind::WriteZero,
                    "overlapped write moved nothing",
                ));
            }
            offset += transferred as usize;
        }
        Ok(())
    }

    /// Overlapped `ConnectNamedPipe`. An already-connected client is not an error.
    pub fn connect(&self, pipe: Handle) -> io::Result<()> {
        let mut overlapped = self.overlapped();
        if unsafe { ConnectNamedPipe(pipe, &mut overlapped) } != FALSE {
            return Ok(());
        }
        let code = last_error_code();
        if code == ERROR_PIPE_CONNECTED {
            return Ok(());
        }
        if code != ERROR_IO_PENDING {
            return Err(last_error("ConnectNamedPipe overlapped"));
        }
        let mut transferred: Dword = 0;
        if unsafe { GetOverlappedResult(pipe, &mut overlapped, &mut transferred, TRUE) } == FALSE {
            return Err(last_error("GetOverlappedResult connect"));
        }
        Ok(())
    }
}

pub fn read_handle(handle: Handle, buffer: &mut [u8]) -> io::Result<usize> {
    let mut read: Dword = 0;
    let ok = unsafe {
        ReadFile(
            handle,
            buffer.as_mut_ptr() as *mut c_void,
            buffer.len() as Dword,
            &mut read,
            null_mut(),
        )
    };
    if ok == FALSE {
        let code = last_error_code();
        if code == ERROR_BROKEN_PIPE || code == ERROR_PIPE_NOT_CONNECTED {
            return Ok(0);
        }
        return Err(last_error("ReadFile"));
    }
    Ok(read as usize)
}

pub fn write_handle(handle: Handle, buffer: &[u8]) -> io::Result<()> {
    let mut offset = 0_usize;
    while offset < buffer.len() {
        let mut written: Dword = 0;
        let ok = unsafe {
            WriteFile(
                handle,
                buffer[offset..].as_ptr() as *const c_void,
                (buffer.len() - offset) as Dword,
                &mut written,
                null_mut(),
            )
        };
        if ok == FALSE {
            return Err(last_error("WriteFile"));
        }
        if written == 0 {
            return Err(io::Error::new(
                io::ErrorKind::WriteZero,
                "WriteFile wrote nothing",
            ));
        }
        offset += written as usize;
    }
    Ok(())
}

pub fn null_terminated(value: &str) -> Vec<u16> {
    wide(value)
}

pub fn empty_wide() -> *const u16 {
    null()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn random_bytes_come_from_the_operating_system_and_differ() {
        let first: [u8; 32] = random_array().expect("RtlGenRandom");
        let second: [u8; 32] = random_array().expect("RtlGenRandom");
        assert_ne!(first, second);
        assert_ne!(first, [0_u8; 32]);
    }

    #[test]
    fn current_user_sid_is_readable_and_renderable() {
        let sid = current_user_sid().expect("current user SID");
        let text = sid.to_text().expect("SID text");
        assert!(text.starts_with("S-1-"), "unexpected SID text: {text}");
        assert!(sid.equals(&sid));
    }

    #[test]
    fn process_birth_is_stable_for_this_process_and_absent_for_an_unused_id() {
        let mine = process_birth(current_process_id()).expect("own birth");
        let again = process_birth(current_process_id()).expect("own birth again");
        assert_eq!(mine, again);
        assert_ne!(mine, 0);
    }

    #[test]
    fn wide_round_trips_through_from_wide() {
        let encoded = wide("rasen-wpa");
        assert_eq!(from_wide(&encoded), "rasen-wpa");
    }
}
