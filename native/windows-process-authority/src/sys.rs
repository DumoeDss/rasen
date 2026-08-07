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

// ===== TEMPORARY TASK 9.6 INSTRUMENTATION -- NOT PART OF THE FROZEN SOURCE =====
// Every hand-declared foreign item is reached through a forwarding wrapper that records its
// first real call. Restored byte-exact after the measurement; the crate source digest is
// re-measured to prove the freeze is intact.
#[allow(non_snake_case)]
mod imports {
    use super::*;

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
}

pub mod ffi_trace {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Mutex;

    pub const NAMES: [&str; 56] = [
        "kernel32::CreateJobObjectW",
        "kernel32::SetInformationJobObject",
        "kernel32::QueryInformationJobObject",
        "kernel32::TerminateJobObject",
        "kernel32::IsProcessInJob",
        "kernel32::CreateIoCompletionPort",
        "kernel32::GetQueuedCompletionStatus",
        "kernel32::PostQueuedCompletionStatus",
        "kernel32::CreateProcessW",
        "kernel32::InitializeProcThreadAttributeList",
        "kernel32::UpdateProcThreadAttribute",
        "kernel32::DeleteProcThreadAttributeList",
        "kernel32::ResumeThread",
        "kernel32::OpenProcess",
        "kernel32::GetProcessTimes",
        "kernel32::GetExitCodeProcess",
        "kernel32::TerminateProcess",
        "kernel32::GetCurrentProcess",
        "kernel32::GetCurrentProcessId",
        "kernel32::GetCurrentThread",
        "kernel32::WaitForSingleObject",
        "kernel32::CreateEventW",
        "kernel32::GetOverlappedResult",
        "kernel32::CloseHandle",
        "kernel32::DuplicateHandle",
        "kernel32::SetHandleInformation",
        "kernel32::GetHandleInformation",
        "kernel32::CreatePipe",
        "kernel32::CreateNamedPipeW",
        "kernel32::ConnectNamedPipe",
        "kernel32::DisconnectNamedPipe",
        "kernel32::GetNamedPipeServerProcessId",
        "kernel32::GetNamedPipeClientProcessId",
        "kernel32::CreateFileW",
        "kernel32::ReadFile",
        "kernel32::WriteFile",
        "kernel32::FlushFileBuffers",
        "kernel32::MoveFileExW",
        "kernel32::LocalFree",
        "advapi32::ImpersonateNamedPipeClient",
        "advapi32::RevertToSelf",
        "advapi32::OpenProcessToken",
        "advapi32::OpenThreadToken",
        "advapi32::GetTokenInformation",
        "advapi32::InitializeSecurityDescriptor",
        "advapi32::SetSecurityDescriptorDacl",
        "advapi32::InitializeAcl",
        "advapi32::AddAccessAllowedAce",
        "advapi32::GetLengthSid",
        "advapi32::CopySid",
        "advapi32::EqualSid",
        "advapi32::ConvertSidToStringSidW",
        "advapi32::GetSecurityInfo",
        "advapi32::GetNamedSecurityInfoW",
        "advapi32::SystemFunction036",
        "ntdll::NtQuerySystemInformation",
    ];

    const NOT_HIT: AtomicBool = AtomicBool::new(false);
    static HIT: [AtomicBool; 56] = [NOT_HIT; 56];
    static SINK: Mutex<Option<std::fs::File>> = Mutex::new(None);

    /// Append on first call only. The guardian is force-killed in several rows, so anything
    /// buffered until exit would be lost for exactly the process that matters most.
    ///
    /// Two recorder defects had to be removed before this measurement meant anything, and both
    /// were found by the measurement disagreeing with the code rather than by inspection.
    ///
    /// 1. Opening the file per record dropped records silently: several guardian threads open
    ///    the same path concurrently, Windows refuses the second open with a sharing violation,
    ///    and the HIT bit was already set -- so the item was lost forever and read as "never
    ///    called".
    /// 2. Opening the file per record was **blind inside the impersonation window**. Between
    ///    'ImpersonateNamedPipeClient' and 'RevertToSelf' the thread carries an
    ///    identification-level token, which permits identity queries and no file access at all,
    ///    so every open in that window fails. Exactly the three items called there read as
    ///    unexercised.
    ///
    /// The sink is therefore opened **once**, on the first record, and reused: the access check
    /// happens at open time, so writes through an already-open handle survive impersonation.
    pub fn record(index: usize) {
        if HIT[index].load(Ordering::SeqCst) {
            return;
        }
        let directory = match std::env::var("RWPA_FFI_TRACE") {
            Ok(value) => value,
            Err(_) => return,
        };
        let mut sink = match SINK.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        if HIT[index].load(Ordering::SeqCst) {
            return;
        }
        if sink.is_none() {
            let path = std::path::Path::new(&directory).join(format!("{}.txt", std::process::id()));
            let mut attempt = 0;
            while attempt < 200 && sink.is_none() {
                match std::fs::OpenOptions::new().create(true).append(true).open(&path) {
                    Ok(file) => *sink = Some(file),
                    Err(_) => {
                        attempt += 1;
                        std::thread::sleep(std::time::Duration::from_millis(2));
                    }
                }
            }
        }
        use std::io::Write;
        if let Some(file) = sink.as_mut() {
            if writeln!(file, "{}", NAMES[index]).is_ok() && file.flush().is_ok() {
                HIT[index].store(true, Ordering::SeqCst);
            }
        }
    }
}

#[inline]
#[allow(non_snake_case)]
#[allow(clippy::too_many_arguments)]
pub unsafe fn CreateJobObjectW(attributes: *mut SecurityAttributes, name: *const u16) -> Handle {
    ffi_trace::record(0);
    imports::CreateJobObjectW(attributes, name)
}

#[inline]
#[allow(non_snake_case)]
#[allow(clippy::too_many_arguments)]
pub unsafe fn SetInformationJobObject(job: Handle, class: Dword, information: *const c_void, length: Dword) -> Bool {
    ffi_trace::record(1);
    imports::SetInformationJobObject(job, class, information, length)
}

#[inline]
#[allow(non_snake_case)]
#[allow(clippy::too_many_arguments)]
pub unsafe fn QueryInformationJobObject(job: Handle, class: Dword, information: *mut c_void, length: Dword, returned: *mut Dword) -> Bool {
    ffi_trace::record(2);
    imports::QueryInformationJobObject(job, class, information, length, returned)
}

#[inline]
#[allow(non_snake_case)]
#[allow(clippy::too_many_arguments)]
pub unsafe fn TerminateJobObject(job: Handle, exit_code: Dword) -> Bool {
    ffi_trace::record(3);
    imports::TerminateJobObject(job, exit_code)
}

#[inline]
#[allow(non_snake_case)]
#[allow(clippy::too_many_arguments)]
pub unsafe fn IsProcessInJob(process: Handle, job: Handle, result: *mut Bool) -> Bool {
    ffi_trace::record(4);
    imports::IsProcessInJob(process, job, result)
}

#[inline]
#[allow(non_snake_case)]
#[allow(clippy::too_many_arguments)]
pub unsafe fn CreateIoCompletionPort(file: Handle, existing_port: Handle, completion_key: UlongPtr, concurrent_threads: Dword) -> Handle {
    ffi_trace::record(5);
    imports::CreateIoCompletionPort(file, existing_port, completion_key, concurrent_threads)
}

#[inline]
#[allow(non_snake_case)]
#[allow(clippy::too_many_arguments)]
pub unsafe fn GetQueuedCompletionStatus(port: Handle, bytes: *mut Dword, completion_key: *mut UlongPtr, overlapped: *mut *mut Overlapped, milliseconds: Dword) -> Bool {
    ffi_trace::record(6);
    imports::GetQueuedCompletionStatus(port, bytes, completion_key, overlapped, milliseconds)
}

#[inline]
#[allow(non_snake_case)]
#[allow(clippy::too_many_arguments)]
pub unsafe fn PostQueuedCompletionStatus(port: Handle, bytes: Dword, completion_key: UlongPtr, overlapped: *mut Overlapped) -> Bool {
    ffi_trace::record(7);
    imports::PostQueuedCompletionStatus(port, bytes, completion_key, overlapped)
}

#[inline]
#[allow(non_snake_case)]
#[allow(clippy::too_many_arguments)]
pub unsafe fn CreateProcessW(application: *const u16, command_line: *mut u16, process_attributes: *mut SecurityAttributes, thread_attributes: *mut SecurityAttributes, inherit_handles: Bool, creation_flags: Dword, environment: *mut c_void, current_directory: *const u16, startup: *mut StartupInfoW, information: *mut ProcessInformation) -> Bool {
    ffi_trace::record(8);
    imports::CreateProcessW(application, command_line, process_attributes, thread_attributes, inherit_handles, creation_flags, environment, current_directory, startup, information)
}

#[inline]
#[allow(non_snake_case)]
#[allow(clippy::too_many_arguments)]
pub unsafe fn InitializeProcThreadAttributeList(list: *mut c_void, count: Dword, flags: Dword, size: *mut usize) -> Bool {
    ffi_trace::record(9);
    imports::InitializeProcThreadAttributeList(list, count, flags, size)
}

#[inline]
#[allow(non_snake_case)]
#[allow(clippy::too_many_arguments)]
pub unsafe fn UpdateProcThreadAttribute(list: *mut c_void, flags: Dword, attribute: usize, value: *mut c_void, size: usize, previous: *mut c_void, returned: *mut usize) -> Bool {
    ffi_trace::record(10);
    imports::UpdateProcThreadAttribute(list, flags, attribute, value, size, previous, returned)
}

#[inline]
#[allow(non_snake_case)]
#[allow(clippy::too_many_arguments)]
pub unsafe fn DeleteProcThreadAttributeList(list: *mut c_void) {
    ffi_trace::record(11);
    imports::DeleteProcThreadAttributeList(list)
}

#[inline]
#[allow(non_snake_case)]
#[allow(clippy::too_many_arguments)]
pub unsafe fn ResumeThread(thread: Handle) -> Dword {
    ffi_trace::record(12);
    imports::ResumeThread(thread)
}

#[inline]
#[allow(non_snake_case)]
#[allow(clippy::too_many_arguments)]
pub unsafe fn OpenProcess(access: Dword, inherit: Bool, process_id: Dword) -> Handle {
    ffi_trace::record(13);
    imports::OpenProcess(access, inherit, process_id)
}

#[inline]
#[allow(non_snake_case)]
#[allow(clippy::too_many_arguments)]
pub unsafe fn GetProcessTimes(process: Handle, creation: *mut FileTime, exit: *mut FileTime, kernel: *mut FileTime, user: *mut FileTime) -> Bool {
    ffi_trace::record(14);
    imports::GetProcessTimes(process, creation, exit, kernel, user)
}

#[inline]
#[allow(non_snake_case)]
#[allow(clippy::too_many_arguments)]
pub unsafe fn GetExitCodeProcess(process: Handle, exit_code: *mut Dword) -> Bool {
    ffi_trace::record(15);
    imports::GetExitCodeProcess(process, exit_code)
}

#[inline]
#[allow(non_snake_case)]
#[allow(clippy::too_many_arguments)]
pub unsafe fn TerminateProcess(process: Handle, exit_code: Dword) -> Bool {
    ffi_trace::record(16);
    imports::TerminateProcess(process, exit_code)
}

#[inline]
#[allow(non_snake_case)]
#[allow(clippy::too_many_arguments)]
pub unsafe fn GetCurrentProcess() -> Handle {
    ffi_trace::record(17);
    imports::GetCurrentProcess()
}

#[inline]
#[allow(non_snake_case)]
#[allow(clippy::too_many_arguments)]
pub unsafe fn GetCurrentProcessId() -> Dword {
    ffi_trace::record(18);
    imports::GetCurrentProcessId()
}

#[inline]
#[allow(non_snake_case)]
#[allow(clippy::too_many_arguments)]
pub unsafe fn GetCurrentThread() -> Handle {
    ffi_trace::record(19);
    imports::GetCurrentThread()
}

#[inline]
#[allow(non_snake_case)]
#[allow(clippy::too_many_arguments)]
pub unsafe fn WaitForSingleObject(handle: Handle, milliseconds: Dword) -> Dword {
    ffi_trace::record(20);
    imports::WaitForSingleObject(handle, milliseconds)
}

#[inline]
#[allow(non_snake_case)]
#[allow(clippy::too_many_arguments)]
pub unsafe fn CreateEventW(attributes: *mut SecurityAttributes, manual_reset: Bool, initial_state: Bool, name: *const u16) -> Handle {
    ffi_trace::record(21);
    imports::CreateEventW(attributes, manual_reset, initial_state, name)
}

#[inline]
#[allow(non_snake_case)]
#[allow(clippy::too_many_arguments)]
pub unsafe fn GetOverlappedResult(file: Handle, overlapped: *mut Overlapped, transferred: *mut Dword, wait: Bool) -> Bool {
    ffi_trace::record(22);
    imports::GetOverlappedResult(file, overlapped, transferred, wait)
}

#[inline]
#[allow(non_snake_case)]
#[allow(clippy::too_many_arguments)]
pub unsafe fn CloseHandle(handle: Handle) -> Bool {
    ffi_trace::record(23);
    imports::CloseHandle(handle)
}

#[inline]
#[allow(non_snake_case)]
#[allow(clippy::too_many_arguments)]
pub unsafe fn DuplicateHandle(source_process: Handle, source: Handle, target_process: Handle, target: *mut Handle, access: Dword, inherit: Bool, options: Dword) -> Bool {
    ffi_trace::record(24);
    imports::DuplicateHandle(source_process, source, target_process, target, access, inherit, options)
}

#[inline]
#[allow(non_snake_case)]
#[allow(clippy::too_many_arguments)]
pub unsafe fn SetHandleInformation(handle: Handle, mask: Dword, flags: Dword) -> Bool {
    ffi_trace::record(25);
    imports::SetHandleInformation(handle, mask, flags)
}

#[inline]
#[allow(non_snake_case)]
#[allow(clippy::too_many_arguments)]
pub unsafe fn GetHandleInformation(handle: Handle, flags: *mut Dword) -> Bool {
    ffi_trace::record(26);
    imports::GetHandleInformation(handle, flags)
}

#[inline]
#[allow(non_snake_case)]
#[allow(clippy::too_many_arguments)]
pub unsafe fn CreatePipe(read: *mut Handle, write: *mut Handle, attributes: *mut SecurityAttributes, size: Dword) -> Bool {
    ffi_trace::record(27);
    imports::CreatePipe(read, write, attributes, size)
}

#[inline]
#[allow(non_snake_case)]
#[allow(clippy::too_many_arguments)]
pub unsafe fn CreateNamedPipeW(name: *const u16, open_mode: Dword, pipe_mode: Dword, max_instances: Dword, out_buffer_size: Dword, in_buffer_size: Dword, default_timeout: Dword, attributes: *mut SecurityAttributes) -> Handle {
    ffi_trace::record(28);
    imports::CreateNamedPipeW(name, open_mode, pipe_mode, max_instances, out_buffer_size, in_buffer_size, default_timeout, attributes)
}

#[inline]
#[allow(non_snake_case)]
#[allow(clippy::too_many_arguments)]
pub unsafe fn ConnectNamedPipe(pipe: Handle, overlapped: *mut Overlapped) -> Bool {
    ffi_trace::record(29);
    imports::ConnectNamedPipe(pipe, overlapped)
}

#[inline]
#[allow(non_snake_case)]
#[allow(clippy::too_many_arguments)]
pub unsafe fn DisconnectNamedPipe(pipe: Handle) -> Bool {
    ffi_trace::record(30);
    imports::DisconnectNamedPipe(pipe)
}

#[inline]
#[allow(non_snake_case)]
#[allow(clippy::too_many_arguments)]
pub unsafe fn GetNamedPipeServerProcessId(pipe: Handle, process_id: *mut Dword) -> Bool {
    ffi_trace::record(31);
    imports::GetNamedPipeServerProcessId(pipe, process_id)
}

#[inline]
#[allow(non_snake_case)]
#[allow(clippy::too_many_arguments)]
pub unsafe fn GetNamedPipeClientProcessId(pipe: Handle, process_id: *mut Dword) -> Bool {
    ffi_trace::record(32);
    imports::GetNamedPipeClientProcessId(pipe, process_id)
}

#[inline]
#[allow(non_snake_case)]
#[allow(clippy::too_many_arguments)]
pub unsafe fn CreateFileW(name: *const u16, access: Dword, share: Dword, attributes: *mut SecurityAttributes, disposition: Dword, flags: Dword, template: Handle) -> Handle {
    ffi_trace::record(33);
    imports::CreateFileW(name, access, share, attributes, disposition, flags, template)
}

#[inline]
#[allow(non_snake_case)]
#[allow(clippy::too_many_arguments)]
pub unsafe fn ReadFile(file: Handle, buffer: *mut c_void, to_read: Dword, read: *mut Dword, overlapped: *mut Overlapped) -> Bool {
    ffi_trace::record(34);
    imports::ReadFile(file, buffer, to_read, read, overlapped)
}

#[inline]
#[allow(non_snake_case)]
#[allow(clippy::too_many_arguments)]
pub unsafe fn WriteFile(file: Handle, buffer: *const c_void, to_write: Dword, written: *mut Dword, overlapped: *mut Overlapped) -> Bool {
    ffi_trace::record(35);
    imports::WriteFile(file, buffer, to_write, written, overlapped)
}

#[inline]
#[allow(non_snake_case)]
#[allow(clippy::too_many_arguments)]
pub unsafe fn FlushFileBuffers(file: Handle) -> Bool {
    ffi_trace::record(36);
    imports::FlushFileBuffers(file)
}

#[inline]
#[allow(non_snake_case)]
#[allow(clippy::too_many_arguments)]
pub unsafe fn MoveFileExW(existing: *const u16, new: *const u16, flags: Dword) -> Bool {
    ffi_trace::record(37);
    imports::MoveFileExW(existing, new, flags)
}

#[inline]
#[allow(non_snake_case)]
#[allow(clippy::too_many_arguments)]
pub unsafe fn LocalFree(memory: *mut c_void) -> *mut c_void {
    ffi_trace::record(38);
    imports::LocalFree(memory)
}

#[inline]
#[allow(non_snake_case)]
#[allow(clippy::too_many_arguments)]
pub unsafe fn ImpersonateNamedPipeClient(pipe: Handle) -> Bool {
    ffi_trace::record(39);
    imports::ImpersonateNamedPipeClient(pipe)
}

#[inline]
#[allow(non_snake_case)]
#[allow(clippy::too_many_arguments)]
pub unsafe fn RevertToSelf() -> Bool {
    ffi_trace::record(40);
    imports::RevertToSelf()
}

#[inline]
#[allow(non_snake_case)]
#[allow(clippy::too_many_arguments)]
pub unsafe fn OpenProcessToken(process: Handle, access: Dword, token: *mut Handle) -> Bool {
    ffi_trace::record(41);
    imports::OpenProcessToken(process, access, token)
}

#[inline]
#[allow(non_snake_case)]
#[allow(clippy::too_many_arguments)]
pub unsafe fn OpenThreadToken(thread: Handle, access: Dword, open_as_self: Bool, token: *mut Handle) -> Bool {
    ffi_trace::record(42);
    imports::OpenThreadToken(thread, access, open_as_self, token)
}

#[inline]
#[allow(non_snake_case)]
#[allow(clippy::too_many_arguments)]
pub unsafe fn GetTokenInformation(token: Handle, class: Dword, information: *mut c_void, length: Dword, returned: *mut Dword) -> Bool {
    ffi_trace::record(43);
    imports::GetTokenInformation(token, class, information, length, returned)
}

#[inline]
#[allow(non_snake_case)]
#[allow(clippy::too_many_arguments)]
pub unsafe fn InitializeSecurityDescriptor(descriptor: *mut c_void, revision: Dword) -> Bool {
    ffi_trace::record(44);
    imports::InitializeSecurityDescriptor(descriptor, revision)
}

#[inline]
#[allow(non_snake_case)]
#[allow(clippy::too_many_arguments)]
pub unsafe fn SetSecurityDescriptorDacl(descriptor: *mut c_void, present: Bool, acl: *mut c_void, defaulted: Bool) -> Bool {
    ffi_trace::record(45);
    imports::SetSecurityDescriptorDacl(descriptor, present, acl, defaulted)
}

#[inline]
#[allow(non_snake_case)]
#[allow(clippy::too_many_arguments)]
pub unsafe fn InitializeAcl(acl: *mut c_void, length: Dword, revision: Dword) -> Bool {
    ffi_trace::record(46);
    imports::InitializeAcl(acl, length, revision)
}

#[inline]
#[allow(non_snake_case)]
#[allow(clippy::too_many_arguments)]
pub unsafe fn AddAccessAllowedAce(acl: *mut c_void, revision: Dword, access: Dword, sid: *mut c_void) -> Bool {
    ffi_trace::record(47);
    imports::AddAccessAllowedAce(acl, revision, access, sid)
}

#[inline]
#[allow(non_snake_case)]
#[allow(clippy::too_many_arguments)]
pub unsafe fn GetLengthSid(sid: *mut c_void) -> Dword {
    ffi_trace::record(48);
    imports::GetLengthSid(sid)
}

#[inline]
#[allow(non_snake_case)]
#[allow(clippy::too_many_arguments)]
pub unsafe fn CopySid(length: Dword, destination: *mut c_void, source: *mut c_void) -> Bool {
    ffi_trace::record(49);
    imports::CopySid(length, destination, source)
}

#[inline]
#[allow(non_snake_case)]
#[allow(clippy::too_many_arguments)]
pub unsafe fn EqualSid(left: *mut c_void, right: *mut c_void) -> Bool {
    ffi_trace::record(50);
    imports::EqualSid(left, right)
}

#[inline]
#[allow(non_snake_case)]
#[allow(clippy::too_many_arguments)]
pub unsafe fn ConvertSidToStringSidW(sid: *mut c_void, text: *mut *mut u16) -> Bool {
    ffi_trace::record(51);
    imports::ConvertSidToStringSidW(sid, text)
}

#[inline]
#[allow(non_snake_case)]
#[allow(clippy::too_many_arguments)]
pub unsafe fn GetSecurityInfo(handle: Handle, object_type: Dword, information: Dword, owner: *mut *mut c_void, group: *mut *mut c_void, dacl: *mut *mut c_void, sacl: *mut *mut c_void, descriptor: *mut *mut c_void) -> Dword {
    ffi_trace::record(52);
    imports::GetSecurityInfo(handle, object_type, information, owner, group, dacl, sacl, descriptor)
}

#[inline]
#[allow(non_snake_case)]
#[allow(clippy::too_many_arguments)]
pub unsafe fn GetNamedSecurityInfoW(name: *const u16, object_type: Dword, information: Dword, owner: *mut *mut c_void, group: *mut *mut c_void, dacl: *mut *mut c_void, sacl: *mut *mut c_void, descriptor: *mut *mut c_void) -> Dword {
    ffi_trace::record(53);
    imports::GetNamedSecurityInfoW(name, object_type, information, owner, group, dacl, sacl, descriptor)
}

#[inline]
#[allow(non_snake_case)]
#[allow(clippy::too_many_arguments)]
pub unsafe fn SystemFunction036(buffer: *mut c_void, length: Dword) -> Boolean {
    ffi_trace::record(54);
    imports::SystemFunction036(buffer, length)
}

#[inline]
#[allow(non_snake_case)]
#[allow(clippy::too_many_arguments)]
pub unsafe fn NtQuerySystemInformation(class: Dword, information: *mut c_void, length: Dword, returned: *mut Dword) -> NtStatus {
    ffi_trace::record(55);
    imports::NtQuerySystemInformation(class, information, length, returned)
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
