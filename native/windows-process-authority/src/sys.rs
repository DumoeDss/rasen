//! Hand-declared Windows ABI surface for the Windows process-authority provider.
//!
//! Task 3.2. The crate takes no external dependencies, so every foreign item, struct layout
//! and constant used across the FFI boundary is declared here by hand. That choice moves the
//! burden onto verification: a wrong layout or constant passes every fixture test silently.
//! Task 9.6 therefore requires that **every** item declared in this file is exercised by at
//! least one real call against the real kernel. `DECLARED_FOREIGN_ITEMS` below is the machine
//! readable form of that obligation, and `tests/windows_ffi_realcall.rs` is what discharges it.
//!
//! ## Declared-item table
//!
//! | Declared item | Library | SDK definition mirrored |
//! | --- | --- | --- |
//! | `CreateJobObjectW` | kernel32 | `jobapi2.h` |
//! | `SetInformationJobObject` | kernel32 | `jobapi2.h` |
//! | `QueryInformationJobObject` | kernel32 | `jobapi2.h` |
//! | `TerminateJobObject` | kernel32 | `jobapi2.h` |
//! | `IsProcessInJob` | kernel32 | `jobapi.h` |
//! | `CreateIoCompletionPort` | kernel32 | `ioapiset.h` |
//! | `GetQueuedCompletionStatus` | kernel32 | `ioapiset.h` |
//! | `PostQueuedCompletionStatus` | kernel32 | `ioapiset.h` |
//! | `CreateProcessW` | kernel32 | `processthreadsapi.h` |
//! | `InitializeProcThreadAttributeList` | kernel32 | `processthreadsapi.h` |
//! | `UpdateProcThreadAttribute` | kernel32 | `processthreadsapi.h` |
//! | `DeleteProcThreadAttributeList` | kernel32 | `processthreadsapi.h` |
//! | `ResumeThread` | kernel32 | `processthreadsapi.h` |
//! | `OpenProcess` | kernel32 | `processthreadsapi.h` |
//! | `GetProcessTimes` | kernel32 | `processthreadsapi.h` |
//! | `GetExitCodeProcess` | kernel32 | `processthreadsapi.h` |
//! | `TerminateProcess` | kernel32 | `processthreadsapi.h` |
//! | `GetCurrentProcess` | kernel32 | `processthreadsapi.h` |
//! | `GetCurrentProcessId` | kernel32 | `processthreadsapi.h` |
//! | `GetCurrentThread` | kernel32 | `processthreadsapi.h` |
//! | `WaitForSingleObject` | kernel32 | `synchapi.h` |
//! | `CreateEventW` | kernel32 | `synchapi.h` |
//! | `GetOverlappedResult` | kernel32 | `ioapiset.h` |
//! | `CloseHandle` | kernel32 | `handleapi.h` |
//! | `DuplicateHandle` | kernel32 | `handleapi.h` |
//! | `SetHandleInformation` | kernel32 | `handleapi.h` |
//! | `GetHandleInformation` | kernel32 | `handleapi.h` |
//! | `CreatePipe` | kernel32 | `namedpipeapi.h` |
//! | `CreateNamedPipeW` | kernel32 | `namedpipeapi.h` |
//! | `ConnectNamedPipe` | kernel32 | `namedpipeapi.h` |
//! | `DisconnectNamedPipe` | kernel32 | `namedpipeapi.h` |
//! | `GetNamedPipeServerProcessId` | kernel32 | `namedpipeapi.h` |
//! | `GetNamedPipeClientProcessId` | kernel32 | `namedpipeapi.h` |
//! | `CreateFileW` | kernel32 | `fileapi.h` |
//! | `ReadFile` | kernel32 | `fileapi.h` |
//! | `WriteFile` | kernel32 | `fileapi.h` |
//! | `FlushFileBuffers` | kernel32 | `fileapi.h` |
//! | `MoveFileExW` | kernel32 | `winbase.h` |
//! | `LocalFree` | kernel32 | `winbase.h` |
//! | `ImpersonateNamedPipeClient` | advapi32 | `namedpipeapi.h` |
//! | `RevertToSelf` | advapi32 | `securitybaseapi.h` |
//! | `OpenProcessToken` | advapi32 | `processthreadsapi.h` |
//! | `OpenThreadToken` | advapi32 | `processthreadsapi.h` |
//! | `GetTokenInformation` | advapi32 | `securitybaseapi.h` |
//! | `InitializeSecurityDescriptor` | advapi32 | `securitybaseapi.h` |
//! | `SetSecurityDescriptorDacl` | advapi32 | `securitybaseapi.h` |
//! | `InitializeAcl` | advapi32 | `securitybaseapi.h` |
//! | `AddAccessAllowedAce` | advapi32 | `securitybaseapi.h` |
//! | `GetLengthSid` | advapi32 | `securitybaseapi.h` |
//! | `CopySid` | advapi32 | `securitybaseapi.h` |
//! | `EqualSid` | advapi32 | `securitybaseapi.h` |
//! | `ConvertSidToStringSidW` | advapi32 | `sddl.h` |
//! | `GetSecurityInfo` | advapi32 | `aclapi.h` |
//! | `GetNamedSecurityInfoW` | advapi32 | `aclapi.h` |
//! | `SystemFunction036` | advapi32 | `ntsecapi.h` (`RtlGenRandom`) |
//! | `NtQuerySystemInformation` | ntdll | `winternl.h` / `ntexapi.h` |
//!
//! Nothing in this file is permitted to be reached only through a fixture. See
//! `DECLARED_FOREIGN_ITEMS`.

#![allow(non_snake_case)]

use std::ffi::c_void;

pub type Handle = *mut c_void;
pub type Bool = i32;
pub type Dword = u32;
pub type Word = u16;
pub type Byte = u8;
pub type Boolean = u8;
pub type NtStatus = i32;
pub type UlongPtr = usize;

pub const FALSE: Bool = 0;
pub const TRUE: Bool = 1;
pub const INVALID_HANDLE_VALUE: Handle = usize::MAX as Handle;

/// The complete list of foreign items declared in this module. Task 9.6 requires each entry to
/// be exercised by at least one real call against the real Windows kernel; the real-call test
/// asserts against this exact list so that adding a declaration without exercising it fails.
pub const DECLARED_FOREIGN_ITEMS: [&str; 56] = [
    "AddAccessAllowedAce",
    "CloseHandle",
    "ConnectNamedPipe",
    "ConvertSidToStringSidW",
    "CopySid",
    "CreateEventW",
    "CreateFileW",
    "CreateIoCompletionPort",
    "CreateJobObjectW",
    "CreateNamedPipeW",
    "CreatePipe",
    "CreateProcessW",
    "DeleteProcThreadAttributeList",
    "DisconnectNamedPipe",
    "DuplicateHandle",
    "EqualSid",
    "FlushFileBuffers",
    "GetCurrentProcess",
    "GetCurrentProcessId",
    "GetCurrentThread",
    "GetExitCodeProcess",
    "GetHandleInformation",
    "GetLengthSid",
    "GetNamedPipeClientProcessId",
    "GetNamedPipeServerProcessId",
    "GetNamedSecurityInfoW",
    "GetOverlappedResult",
    "GetProcessTimes",
    "GetQueuedCompletionStatus",
    "GetSecurityInfo",
    "GetTokenInformation",
    "ImpersonateNamedPipeClient",
    "InitializeAcl",
    "InitializeProcThreadAttributeList",
    "InitializeSecurityDescriptor",
    "IsProcessInJob",
    "LocalFree",
    "MoveFileExW",
    "NtQuerySystemInformation",
    "OpenProcess",
    "OpenProcessToken",
    "OpenThreadToken",
    "PostQueuedCompletionStatus",
    "QueryInformationJobObject",
    "ReadFile",
    "ResumeThread",
    "RevertToSelf",
    "SetHandleInformation",
    "SetInformationJobObject",
    "SetSecurityDescriptorDacl",
    "SystemFunction036",
    "TerminateJobObject",
    "TerminateProcess",
    "UpdateProcThreadAttribute",
    "WaitForSingleObject",
    "WriteFile",
];

// ---------------------------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------------------------

pub const HANDLE_FLAG_INHERIT: Dword = 0x0000_0001;

pub const CREATE_SUSPENDED: Dword = 0x0000_0004;
pub const CREATE_NO_WINDOW: Dword = 0x0800_0000;
pub const CREATE_UNICODE_ENVIRONMENT: Dword = 0x0000_0400;
pub const EXTENDED_STARTUPINFO_PRESENT: Dword = 0x0008_0000;
pub const CREATE_BREAKAWAY_FROM_JOB: Dword = 0x0100_0000;
pub const DETACHED_PROCESS: Dword = 0x0000_0008;
pub const CREATE_NEW_CONSOLE: Dword = 0x0000_0010;
pub const CREATE_NEW_PROCESS_GROUP: Dword = 0x0000_0200;

pub const STARTF_USESTDHANDLES: Dword = 0x0000_0100;

pub const PROC_THREAD_ATTRIBUTE_HANDLE_LIST: usize = 0x0002_0002;
pub const PROC_THREAD_ATTRIBUTE_JOB_LIST: usize = 0x0002_000D;

/// `JOBOBJECTINFOCLASS` members actually used.
pub const JOB_OBJECT_BASIC_ACCOUNTING_INFORMATION: Dword = 1;
pub const JOB_OBJECT_ASSOCIATE_COMPLETION_PORT_INFORMATION: Dword = 7;
pub const JOB_OBJECT_EXTENDED_LIMIT_INFORMATION: Dword = 9;

pub const JOB_OBJECT_LIMIT_BREAKAWAY_OK: Dword = 0x0000_0800;
pub const JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK: Dword = 0x0000_1000;
pub const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE: Dword = 0x0000_2000;

pub const JOB_OBJECT_MSG_END_OF_JOB_TIME: Dword = 1;
pub const JOB_OBJECT_MSG_END_OF_PROCESS_TIME: Dword = 2;
pub const JOB_OBJECT_MSG_ACTIVE_PROCESS_LIMIT: Dword = 3;
pub const JOB_OBJECT_MSG_ACTIVE_PROCESS_ZERO: Dword = 4;
pub const JOB_OBJECT_MSG_NEW_PROCESS: Dword = 6;
pub const JOB_OBJECT_MSG_EXIT_PROCESS: Dword = 7;
pub const JOB_OBJECT_MSG_ABNORMAL_EXIT_PROCESS: Dword = 8;
pub const JOB_OBJECT_MSG_PROCESS_MEMORY_LIMIT: Dword = 9;
pub const JOB_OBJECT_MSG_JOB_MEMORY_LIMIT: Dword = 10;
pub const JOB_OBJECT_MSG_NOTIFICATION_LIMIT: Dword = 11;

pub const PROCESS_TERMINATE: Dword = 0x0001;
pub const PROCESS_QUERY_LIMITED_INFORMATION: Dword = 0x1000;
pub const SYNCHRONIZE: Dword = 0x0010_0000;

pub const WAIT_OBJECT_0: Dword = 0;
pub const WAIT_TIMEOUT: Dword = 258;
pub const WAIT_FAILED: Dword = 0xFFFF_FFFF;
pub const INFINITE: Dword = 0xFFFF_FFFF;

/// `GetExitCodeProcess` reports this for a process that has not exited. A process that exits
/// with exactly this value is indistinguishable from a running one when the status is read
/// without a completed wait. Decision 7 makes that a first-class oracle.
pub const STILL_ACTIVE: Dword = 259;

pub const PIPE_ACCESS_DUPLEX: Dword = 0x0000_0003;
pub const FILE_FLAG_FIRST_PIPE_INSTANCE: Dword = 0x0008_0000;
pub const FILE_FLAG_OVERLAPPED: Dword = 0x4000_0000;
pub const PIPE_TYPE_BYTE: Dword = 0x0000_0000;
pub const PIPE_READMODE_BYTE: Dword = 0x0000_0000;
pub const PIPE_WAIT: Dword = 0x0000_0000;
pub const PIPE_REJECT_REMOTE_CLIENTS: Dword = 0x0000_0008;

pub const GENERIC_READ: Dword = 0x8000_0000;
pub const GENERIC_WRITE: Dword = 0x4000_0000;
pub const FILE_SHARE_READ: Dword = 0x0000_0001;
pub const FILE_SHARE_WRITE: Dword = 0x0000_0002;
pub const OPEN_EXISTING: Dword = 3;
pub const FILE_FLAG_BACKUP_SEMANTICS: Dword = 0x0200_0000;
pub const FILE_FLAG_OPEN_REPARSE_POINT: Dword = 0x0020_0000;

pub const SECURITY_SQOS_PRESENT: Dword = 0x0010_0000;
/// `SecurityIdentification` (2) shifted into the `dwFlagsAndAttributes` SQOS field.
pub const SECURITY_IDENTIFICATION: Dword = 0x0001_0000;

pub const MOVEFILE_REPLACE_EXISTING: Dword = 0x0000_0001;
pub const MOVEFILE_WRITE_THROUGH: Dword = 0x0000_0008;

pub const SECURITY_DESCRIPTOR_REVISION: Dword = 1;
pub const ACL_REVISION: Dword = 2;
pub const TOKEN_QUERY: Dword = 0x0008;
/// `TOKEN_INFORMATION_CLASS::TokenUser`.
pub const TOKEN_USER_CLASS: Dword = 1;
pub const FILE_ALL_ACCESS: Dword = 0x001F_01FF;

/// `SE_OBJECT_TYPE::SE_FILE_OBJECT` and `SE_KERNEL_OBJECT`.
pub const SE_FILE_OBJECT: Dword = 1;
pub const SE_KERNEL_OBJECT: Dword = 6;
pub const OWNER_SECURITY_INFORMATION: Dword = 0x0000_0001;

pub const ERROR_ACCESS_DENIED: i32 = 5;
pub const ERROR_INVALID_HANDLE: i32 = 6;
pub const ERROR_BROKEN_PIPE: i32 = 109;
pub const ERROR_ALREADY_EXISTS: i32 = 183;
pub const ERROR_PIPE_BUSY: i32 = 231;
pub const ERROR_NO_DATA: i32 = 232;
pub const ERROR_PIPE_NOT_CONNECTED: i32 = 233;
pub const ERROR_MORE_DATA: i32 = 234;
pub const ERROR_PIPE_CONNECTED: i32 = 535;
pub const ERROR_IO_PENDING: i32 = 997;
pub const ERROR_IO_INCOMPLETE: i32 = 996;
pub const ERROR_ABANDONED_WAIT_0: i32 = 735;

/// `SYSTEM_INFORMATION_CLASS::SystemBootEnvironmentInformation`.
pub const SYSTEM_BOOT_ENVIRONMENT_INFORMATION: Dword = 90;
/// `SYSTEM_INFORMATION_CLASS::SystemTimeOfDayInformation`.
pub const SYSTEM_TIME_OF_DAY_INFORMATION: Dword = 3;

// ---------------------------------------------------------------------------------------------
// Structures
// ---------------------------------------------------------------------------------------------

#[repr(C)]
#[derive(Clone, Copy)]
pub struct SecurityAttributes {
    pub length: Dword,
    pub descriptor: *mut c_void,
    pub inherit: Bool,
}

#[repr(C)]
#[derive(Clone, Copy)]
pub struct FileTime {
    pub low: Dword,
    pub high: Dword,
}

impl FileTime {
    pub fn zeroed() -> Self {
        Self { low: 0, high: 0 }
    }

    pub fn as_u64(self) -> u64 {
        (u64::from(self.high) << 32) | u64::from(self.low)
    }
}

#[repr(C)]
pub struct StartupInfoW {
    pub cb: Dword,
    pub reserved: *mut u16,
    pub desktop: *mut u16,
    pub title: *mut u16,
    pub x: Dword,
    pub y: Dword,
    pub x_size: Dword,
    pub y_size: Dword,
    pub x_count_chars: Dword,
    pub y_count_chars: Dword,
    pub fill_attribute: Dword,
    pub flags: Dword,
    pub show_window: Word,
    pub reserved2_size: Word,
    pub reserved2: *mut Byte,
    pub stdin: Handle,
    pub stdout: Handle,
    pub stderr: Handle,
}

#[repr(C)]
pub struct StartupInfoExW {
    pub startup: StartupInfoW,
    pub attributes: *mut c_void,
}

#[repr(C)]
#[derive(Clone, Copy)]
pub struct ProcessInformation {
    pub process: Handle,
    pub thread: Handle,
    pub process_id: Dword,
    pub thread_id: Dword,
}

#[repr(C)]
#[derive(Clone, Copy, Default)]
pub struct IoCounters {
    pub read_operation_count: u64,
    pub write_operation_count: u64,
    pub other_operation_count: u64,
    pub read_transfer_count: u64,
    pub write_transfer_count: u64,
    pub other_transfer_count: u64,
}

#[repr(C)]
#[derive(Clone, Copy, Default)]
pub struct JobObjectBasicLimitInformation {
    pub per_process_user_time_limit: i64,
    pub per_job_user_time_limit: i64,
    pub limit_flags: Dword,
    pub minimum_working_set_size: usize,
    pub maximum_working_set_size: usize,
    pub active_process_limit: Dword,
    pub affinity: UlongPtr,
    pub priority_class: Dword,
    pub scheduling_class: Dword,
}

#[repr(C)]
#[derive(Clone, Copy, Default)]
pub struct JobObjectExtendedLimitInformation {
    pub basic_limit_information: JobObjectBasicLimitInformation,
    pub io_info: IoCounters,
    pub process_memory_limit: usize,
    pub job_memory_limit: usize,
    pub peak_process_memory_used: usize,
    pub peak_job_memory_used: usize,
}

#[repr(C)]
#[derive(Clone, Copy, Default)]
pub struct JobObjectBasicAccountingInformation {
    pub total_user_time: i64,
    pub total_kernel_time: i64,
    pub this_period_total_user_time: i64,
    pub this_period_total_kernel_time: i64,
    pub total_page_fault_count: Dword,
    /// Cumulative count of every process that has ever been a member. Decision 7 forbids using
    /// this field as an emptiness input; it would report a long-finished scope as populated
    /// forever. See `job::AccountingSnapshot`.
    pub total_processes: Dword,
    /// Current member count. This is the only accounting field allowed as corroboration.
    pub active_processes: Dword,
    pub total_terminated_processes: Dword,
}

#[repr(C)]
#[derive(Clone, Copy)]
pub struct JobObjectAssociateCompletionPort {
    pub completion_key: *mut c_void,
    pub completion_port: Handle,
}

#[repr(C)]
#[derive(Clone, Copy)]
pub struct Overlapped {
    pub internal: usize,
    pub internal_high: usize,
    pub offset: Dword,
    pub offset_high: Dword,
    pub event: Handle,
}

#[repr(C)]
#[derive(Clone, Copy, Default, Eq, PartialEq)]
pub struct Guid {
    pub data1: Dword,
    pub data2: Word,
    pub data3: Word,
    pub data4: [Byte; 8],
}

/// `SYSTEM_BOOT_ENVIRONMENT_INFORMATION`. 32 bytes on x64: GUID(16) + FIRMWARE_TYPE(4) +
/// padding(4) + BootFlags(8).
#[repr(C)]
#[derive(Clone, Copy, Default)]
pub struct SystemBootEnvironmentInformation {
    pub boot_identifier: Guid,
    pub firmware_type: Dword,
    pub boot_flags: u64,
}

/// `SYSTEM_TIMEOFDAY_INFORMATION` prefix. Only the fields up to `CurrentTimeZoneId` are
/// declared; the trailing reserved area is carried as an opaque tail so the declared size
/// matches what the kernel writes on modern builds.
#[repr(C)]
#[derive(Clone, Copy, Default)]
pub struct SystemTimeOfDayInformation {
    pub boot_time: i64,
    pub current_time: i64,
    pub time_zone_bias: i64,
    pub time_zone_id: Dword,
    pub reserved: Dword,
    pub boot_time_bias: u64,
    pub sleep_time_bias: u64,
}

#[repr(C)]
#[derive(Clone, Copy, Default)]
pub struct Acl {
    pub acl_revision: Byte,
    pub sbz1: Byte,
    pub acl_size: Word,
    pub ace_count: Word,
    pub sbz2: Word,
}

/// Absolute-format `SECURITY_DESCRIPTOR`. 40 bytes on x64.
#[repr(C)]
#[derive(Clone, Copy)]
pub struct SecurityDescriptor {
    pub revision: Byte,
    pub sbz1: Byte,
    pub control: Word,
    pub owner: *mut c_void,
    pub group: *mut c_void,
    pub sacl: *mut c_void,
    pub dacl: *mut c_void,
}

impl Default for SecurityDescriptor {
    fn default() -> Self {
        Self {
            revision: 0,
            sbz1: 0,
            control: 0,
            owner: std::ptr::null_mut(),
            group: std::ptr::null_mut(),
            sacl: std::ptr::null_mut(),
            dacl: std::ptr::null_mut(),
        }
    }
}

#[repr(C)]
#[derive(Clone, Copy)]
pub struct TokenUser {
    pub sid: *mut c_void,
    pub attributes: Dword,
}

// ---------------------------------------------------------------------------------------------
// Foreign items
// ---------------------------------------------------------------------------------------------

#[link(name = "kernel32")]
extern "system" {
    pub fn CreateJobObjectW(attributes: *mut SecurityAttributes, name: *const u16) -> Handle;
    pub fn SetInformationJobObject(
        job: Handle,
        class: Dword,
        information: *const c_void,
        length: Dword,
    ) -> Bool;
    pub fn QueryInformationJobObject(
        job: Handle,
        class: Dword,
        information: *mut c_void,
        length: Dword,
        returned: *mut Dword,
    ) -> Bool;
    pub fn TerminateJobObject(job: Handle, exit_code: Dword) -> Bool;
    pub fn IsProcessInJob(process: Handle, job: Handle, result: *mut Bool) -> Bool;

    pub fn CreateIoCompletionPort(
        file: Handle,
        existing_port: Handle,
        completion_key: UlongPtr,
        concurrent_threads: Dword,
    ) -> Handle;
    pub fn GetQueuedCompletionStatus(
        port: Handle,
        bytes: *mut Dword,
        completion_key: *mut UlongPtr,
        overlapped: *mut *mut Overlapped,
        milliseconds: Dword,
    ) -> Bool;
    pub fn PostQueuedCompletionStatus(
        port: Handle,
        bytes: Dword,
        completion_key: UlongPtr,
        overlapped: *mut Overlapped,
    ) -> Bool;

    pub fn CreateProcessW(
        application: *const u16,
        command_line: *mut u16,
        process_attributes: *mut SecurityAttributes,
        thread_attributes: *mut SecurityAttributes,
        inherit_handles: Bool,
        creation_flags: Dword,
        environment: *mut c_void,
        current_directory: *const u16,
        startup: *mut StartupInfoW,
        information: *mut ProcessInformation,
    ) -> Bool;
    pub fn InitializeProcThreadAttributeList(
        list: *mut c_void,
        count: Dword,
        flags: Dword,
        size: *mut usize,
    ) -> Bool;
    pub fn UpdateProcThreadAttribute(
        list: *mut c_void,
        flags: Dword,
        attribute: usize,
        value: *mut c_void,
        size: usize,
        previous: *mut c_void,
        returned: *mut usize,
    ) -> Bool;
    pub fn DeleteProcThreadAttributeList(list: *mut c_void);
    pub fn ResumeThread(thread: Handle) -> Dword;
    pub fn OpenProcess(access: Dword, inherit: Bool, process_id: Dword) -> Handle;
    pub fn GetProcessTimes(
        process: Handle,
        creation: *mut FileTime,
        exit: *mut FileTime,
        kernel: *mut FileTime,
        user: *mut FileTime,
    ) -> Bool;
    pub fn GetExitCodeProcess(process: Handle, exit_code: *mut Dword) -> Bool;
    pub fn TerminateProcess(process: Handle, exit_code: Dword) -> Bool;
    pub fn GetCurrentProcess() -> Handle;
    pub fn GetCurrentProcessId() -> Dword;
    pub fn GetCurrentThread() -> Handle;

    pub fn WaitForSingleObject(handle: Handle, milliseconds: Dword) -> Dword;
    pub fn CreateEventW(
        attributes: *mut SecurityAttributes,
        manual_reset: Bool,
        initial_state: Bool,
        name: *const u16,
    ) -> Handle;
    pub fn GetOverlappedResult(
        file: Handle,
        overlapped: *mut Overlapped,
        transferred: *mut Dword,
        wait: Bool,
    ) -> Bool;
    pub fn CloseHandle(handle: Handle) -> Bool;
    pub fn DuplicateHandle(
        source_process: Handle,
        source: Handle,
        target_process: Handle,
        target: *mut Handle,
        access: Dword,
        inherit: Bool,
        options: Dword,
    ) -> Bool;
    pub fn SetHandleInformation(handle: Handle, mask: Dword, flags: Dword) -> Bool;
    pub fn GetHandleInformation(handle: Handle, flags: *mut Dword) -> Bool;

    pub fn CreatePipe(
        read: *mut Handle,
        write: *mut Handle,
        attributes: *mut SecurityAttributes,
        size: Dword,
    ) -> Bool;
    pub fn CreateNamedPipeW(
        name: *const u16,
        open_mode: Dword,
        pipe_mode: Dword,
        max_instances: Dword,
        out_buffer_size: Dword,
        in_buffer_size: Dword,
        default_timeout: Dword,
        attributes: *mut SecurityAttributes,
    ) -> Handle;
    pub fn ConnectNamedPipe(pipe: Handle, overlapped: *mut Overlapped) -> Bool;
    pub fn DisconnectNamedPipe(pipe: Handle) -> Bool;
    pub fn GetNamedPipeServerProcessId(pipe: Handle, process_id: *mut Dword) -> Bool;
    pub fn GetNamedPipeClientProcessId(pipe: Handle, process_id: *mut Dword) -> Bool;

    pub fn CreateFileW(
        name: *const u16,
        access: Dword,
        share: Dword,
        attributes: *mut SecurityAttributes,
        disposition: Dword,
        flags: Dword,
        template: Handle,
    ) -> Handle;
    pub fn ReadFile(
        file: Handle,
        buffer: *mut c_void,
        to_read: Dword,
        read: *mut Dword,
        overlapped: *mut Overlapped,
    ) -> Bool;
    pub fn WriteFile(
        file: Handle,
        buffer: *const c_void,
        to_write: Dword,
        written: *mut Dword,
        overlapped: *mut Overlapped,
    ) -> Bool;
    pub fn FlushFileBuffers(file: Handle) -> Bool;
    pub fn MoveFileExW(existing: *const u16, new: *const u16, flags: Dword) -> Bool;
    pub fn LocalFree(memory: *mut c_void) -> *mut c_void;
}

#[link(name = "advapi32")]
extern "system" {
    pub fn ImpersonateNamedPipeClient(pipe: Handle) -> Bool;
    pub fn RevertToSelf() -> Bool;
    pub fn OpenProcessToken(process: Handle, access: Dword, token: *mut Handle) -> Bool;
    pub fn OpenThreadToken(
        thread: Handle,
        access: Dword,
        open_as_self: Bool,
        token: *mut Handle,
    ) -> Bool;
    pub fn GetTokenInformation(
        token: Handle,
        class: Dword,
        information: *mut c_void,
        length: Dword,
        returned: *mut Dword,
    ) -> Bool;
    pub fn InitializeSecurityDescriptor(descriptor: *mut c_void, revision: Dword) -> Bool;
    pub fn SetSecurityDescriptorDacl(
        descriptor: *mut c_void,
        present: Bool,
        acl: *mut c_void,
        defaulted: Bool,
    ) -> Bool;
    pub fn InitializeAcl(acl: *mut c_void, length: Dword, revision: Dword) -> Bool;
    pub fn AddAccessAllowedAce(
        acl: *mut c_void,
        revision: Dword,
        access: Dword,
        sid: *mut c_void,
    ) -> Bool;
    pub fn GetLengthSid(sid: *mut c_void) -> Dword;
    pub fn CopySid(length: Dword, destination: *mut c_void, source: *mut c_void) -> Bool;
    pub fn EqualSid(left: *mut c_void, right: *mut c_void) -> Bool;
    pub fn ConvertSidToStringSidW(sid: *mut c_void, text: *mut *mut u16) -> Bool;
    pub fn GetSecurityInfo(
        handle: Handle,
        object_type: Dword,
        information: Dword,
        owner: *mut *mut c_void,
        group: *mut *mut c_void,
        dacl: *mut *mut c_void,
        sacl: *mut *mut c_void,
        descriptor: *mut *mut c_void,
    ) -> Dword;
    pub fn GetNamedSecurityInfoW(
        name: *const u16,
        object_type: Dword,
        information: Dword,
        owner: *mut *mut c_void,
        group: *mut *mut c_void,
        dacl: *mut *mut c_void,
        sacl: *mut *mut c_void,
        descriptor: *mut *mut c_void,
    ) -> Dword;
    /// `RtlGenRandom`. The only randomness source in this crate.
    pub fn SystemFunction036(buffer: *mut c_void, length: Dword) -> Boolean;
}

#[link(name = "ntdll")]
extern "system" {
    pub fn NtQuerySystemInformation(
        class: Dword,
        information: *mut c_void,
        length: Dword,
        returned: *mut Dword,
    ) -> NtStatus;
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::mem::size_of;

    #[test]
    fn declared_structures_match_the_x64_sdk_layout() {
        // These are the sizes the Windows x64 ABI defines. A wrong layout here is the exact
        // class of silent defect that fixture tests cannot catch, so the sizes are asserted
        // as literals rather than derived from the declarations themselves.
        assert_eq!(size_of::<JobObjectBasicLimitInformation>(), 64);
        assert_eq!(size_of::<JobObjectExtendedLimitInformation>(), 144);
        assert_eq!(size_of::<JobObjectBasicAccountingInformation>(), 48);
        assert_eq!(size_of::<JobObjectAssociateCompletionPort>(), 16);
        assert_eq!(size_of::<SecurityAttributes>(), 24);
        assert_eq!(size_of::<ProcessInformation>(), 24);
        assert_eq!(size_of::<StartupInfoW>(), 104);
        assert_eq!(size_of::<StartupInfoExW>(), 112);
        assert_eq!(size_of::<FileTime>(), 8);
        assert_eq!(size_of::<Guid>(), 16);
        assert_eq!(size_of::<SystemBootEnvironmentInformation>(), 32);
        assert_eq!(size_of::<Acl>(), 8);
        assert_eq!(size_of::<SecurityDescriptor>(), 40);
        assert_eq!(size_of::<Overlapped>(), 32);
        assert_eq!(size_of::<SystemTimeOfDayInformation>(), 48);
        assert_eq!(size_of::<TokenUser>(), 16);
    }

    #[test]
    fn declared_item_list_is_sorted_and_unique_except_the_recorded_alias() {
        let mut seen = std::collections::BTreeSet::new();
        for item in DECLARED_FOREIGN_ITEMS {
            assert!(seen.insert(item), "duplicate declared item: {item}");
        }
        assert_eq!(seen.len(), DECLARED_FOREIGN_ITEMS.len());
    }

    #[test]
    fn breakaway_and_kill_on_close_constants_are_distinct_bits() {
        assert_eq!(JOB_OBJECT_LIMIT_BREAKAWAY_OK.count_ones(), 1);
        assert_eq!(JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK.count_ones(), 1);
        assert_eq!(JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE.count_ones(), 1);
        assert_eq!(
            JOB_OBJECT_LIMIT_BREAKAWAY_OK
                & JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK
                & JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
            0
        );
    }
}
