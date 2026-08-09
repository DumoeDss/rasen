use std::collections::BTreeMap;
use std::env;
use std::fs::File;
use std::io::{self, Read, Write};
use std::path::Path;
#[cfg(unix)]
use std::process::Child;
use std::process::{self, Command, Stdio};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::thread;
use std::time::{Duration, Instant};

const PROTOCOL_VERSION: u16 = 2;
const MAX_FRAME_BYTES: usize = 2 * 1024 * 1024 + 64 * 1024;

const PREPARE: u8 = 0x01;
const ACTIVATE: u8 = 0x02;
const INPUT: u8 = 0x03;
const TERMINATE: u8 = 0x04;
const INSPECT: u8 = 0x05;

const PREPARED: u8 = 0x81;
const ACTIVATED: u8 = 0x82;
const OUTPUT: u8 = 0x83;
const ERROR_OUTPUT: u8 = 0x84;
const ROOT_EXIT: u8 = 0x85;
const ERROR: u8 = 0x86;
const SCOPE_EMPTY: u8 = 0x87;
const OBSERVATION: u8 = 0x88;
const SUPERVISOR_READY: u8 = 0x90;
const SUPERVISOR_JOB_HANDLE: u8 = 0x91;

#[derive(Clone)]
struct LaunchSpec {
    nonce: String,
    command: String,
    cwd: String,
    #[cfg_attr(not(windows), allow(dead_code))]
    windows_verbatim: bool,
    args: Vec<String>,
    env: BTreeMap<String, String>,
}

fn read_frame<R: Read>(reader: &mut R) -> io::Result<Option<(u8, Vec<u8>)>> {
    let mut header = [0u8; 5];
    let mut offset = 0;
    while offset < header.len() {
        let read = reader.read(&mut header[offset..])?;
        if read == 0 {
            if offset == 0 {
                return Ok(None);
            }
            return Err(io::Error::new(
                io::ErrorKind::UnexpectedEof,
                "truncated frame header",
            ));
        }
        offset += read;
    }
    let length = u32::from_be_bytes(header[1..5].try_into().unwrap()) as usize;
    if length > MAX_FRAME_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "frame exceeds protocol bound",
        ));
    }
    let mut payload = vec![0u8; length];
    reader.read_exact(&mut payload)?;
    Ok(Some((header[0], payload)))
}

fn write_frame<W: Write>(writer: &mut W, kind: u8, payload: &[u8]) -> io::Result<()> {
    if payload.len() > MAX_FRAME_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "frame exceeds protocol bound",
        ));
    }
    writer.write_all(&[kind])?;
    writer.write_all(&(payload.len() as u32).to_be_bytes())?;
    writer.write_all(payload)?;
    writer.flush()
}

fn take_u16(input: &mut &[u8]) -> io::Result<u16> {
    if input.len() < 2 {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "missing u16"));
    }
    let value = u16::from_be_bytes(input[..2].try_into().unwrap());
    *input = &input[2..];
    Ok(value)
}

fn take_u32(input: &mut &[u8]) -> io::Result<u32> {
    if input.len() < 4 {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "missing u32"));
    }
    let value = u32::from_be_bytes(input[..4].try_into().unwrap());
    *input = &input[4..];
    Ok(value)
}

fn take_string(input: &mut &[u8], max: usize) -> io::Result<String> {
    let length = take_u32(input)? as usize;
    if length > max || input.len() < length {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "invalid bounded string",
        ));
    }
    let value = std::str::from_utf8(&input[..length])
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "string is not utf8"))?
        .to_owned();
    *input = &input[length..];
    Ok(value)
}

fn parse_launch(payload: &[u8]) -> io::Result<LaunchSpec> {
    let mut input = payload;
    if take_u16(&mut input)? != PROTOCOL_VERSION {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "protocol mismatch",
        ));
    }
    let nonce = take_string(&mut input, 128)?;
    let command = take_string(&mut input, 32 * 1024)?;
    let cwd = take_string(&mut input, 32 * 1024)?;
    if input.is_empty() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "missing launch flags",
        ));
    }
    let windows_verbatim = input[0] != 0;
    input = &input[1..];
    let arg_count = take_u32(&mut input)? as usize;
    if arg_count > 128 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "too many arguments",
        ));
    }
    let mut args = Vec::with_capacity(arg_count);
    for _ in 0..arg_count {
        args.push(take_string(&mut input, 128 * 1024)?);
    }
    let env_count = take_u32(&mut input)? as usize;
    if env_count > 128 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "too many environment entries",
        ));
    }
    let mut environment = BTreeMap::new();
    for _ in 0..env_count {
        let key = take_string(&mut input, 1024)?;
        let value = take_string(&mut input, 128 * 1024)?;
        if key.is_empty() || key.contains('=') || key.contains('\0') || value.contains('\0') {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "invalid environment entry",
            ));
        }
        environment.insert(key, value);
    }
    if !input.is_empty()
        || nonce.len() < 16
        || !Path::new(&command).is_absolute()
        || !Path::new(&cwd).is_absolute()
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "invalid launch specification",
        ));
    }
    Ok(LaunchSpec {
        nonce,
        command,
        cwd,
        windows_verbatim,
        args,
        env: environment,
    })
}

fn error_and_exit(message: &str, code: i32) -> ! {
    let _ = write_frame(&mut io::stdout().lock(), ERROR, message.as_bytes());
    process::exit(code)
}

fn stream_child_output<R: Read + Send + 'static>(
    mut source: R,
    writer: Arc<Mutex<io::Stdout>>,
    kind: u8,
) {
    thread::spawn(move || {
        let mut buffer = [0u8; 16 * 1024];
        loop {
            match source.read(&mut buffer) {
                Ok(0) => break,
                Ok(count) => {
                    if let Ok(mut output) = writer.lock() {
                        if write_frame(&mut *output, kind, &buffer[..count]).is_err() {
                            break;
                        }
                    }
                }
                Err(_) => break,
            }
        }
    });
}

fn hold_duplicated_job_handle(leaked_job_handle: Option<u64>) -> io::Result<()> {
    // The mutation oracle deliberately keeps this independently owned Job
    // handle open after either EOF or a broken-pipe read from the controller.
    // Windows may report controller death through either outcome.
    let _retained_job_handle = leaked_job_handle
        .ok_or_else(|| io::Error::other("duplicated Job handle was not acknowledged"))?;
    loop {
        thread::sleep(Duration::from_secs(60));
    }
}

fn supervisor_main(hold_on_control_loss: bool) -> io::Result<()> {
    let mut controller_input = io::stdin().lock();
    let leaked_job_handle = if hold_on_control_loss {
        let (kind, payload) = read_frame(&mut controller_input)?.ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::UnexpectedEof,
                "missing duplicated Job-handle mutation",
            )
        })?;
        if kind != SUPERVISOR_JOB_HANDLE || payload.len() != std::mem::size_of::<u64>() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "supervisor expected duplicated Job-handle mutation",
            ));
        }
        let mut raw = [0u8; std::mem::size_of::<u64>()];
        raw.copy_from_slice(&payload);
        let raw = u64::from_be_bytes(raw);
        platform::validate_duplicated_job_handle(raw)?;
        Some(raw)
    } else {
        None
    };
    let (kind, payload) = read_frame(&mut controller_input)?.ok_or_else(|| {
        io::Error::new(io::ErrorKind::UnexpectedEof, "missing supervisor prepare")
    })?;
    if kind != PREPARE {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "supervisor expected prepare",
        ));
    }
    let spec = parse_launch(&payload)?;
    write_frame(
        &mut io::stdout().lock(),
        SUPERVISOR_READY,
        if leaked_job_handle.is_some() {
            &[1]
        } else {
            &[]
        },
    )?;
    let (kind, _) = read_frame(&mut controller_input)?.ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::UnexpectedEof,
            "controller closed before activation",
        )
    })?;
    if kind != ACTIVATE {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "supervisor expected activation",
        ));
    }

    let mut command = Command::new(&spec.command);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        if spec.windows_verbatim {
            for arg in &spec.args {
                command.raw_arg(arg);
            }
        } else {
            command.args(&spec.args);
        }
    }
    #[cfg(not(windows))]
    command.args(&spec.args);
    command
        .current_dir(&spec.cwd)
        .env_clear()
        .envs(&spec.env)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = command.spawn()?;
    let pid = child.id();
    write_frame(&mut io::stdout().lock(), ACTIVATED, &pid.to_be_bytes())?;
    let mut child_input = child
        .stdin
        .take()
        .ok_or_else(|| io::Error::new(io::ErrorKind::BrokenPipe, "backend stdin missing"))?;
    let child_output = child
        .stdout
        .take()
        .ok_or_else(|| io::Error::new(io::ErrorKind::BrokenPipe, "backend stdout missing"))?;
    let child_error = child
        .stderr
        .take()
        .ok_or_else(|| io::Error::new(io::ErrorKind::BrokenPipe, "backend stderr missing"))?;
    let writer = Arc::new(Mutex::new(io::stdout()));
    stream_child_output(child_output, writer.clone(), OUTPUT);
    stream_child_output(child_error, writer.clone(), ERROR_OUTPUT);
    let child = Arc::new(Mutex::new(child));
    let wait_child = child.clone();
    let wait_writer = writer.clone();
    thread::spawn(move || {
        let status = wait_child.lock().ok().and_then(|mut item| item.wait().ok());
        let code = status.and_then(|item| item.code()).unwrap_or(-1);
        if let Ok(mut output) = wait_writer.lock() {
            let _ = write_frame(&mut *output, ROOT_EXIT, &code.to_be_bytes());
        }
        // The supervisor is administrative, not part of the backend scope.
        // Exiting after ROOT_EXIT leaves any descendants in the reserved
        // Job/process group so the controller can observe exact emptiness.
        process::exit(0);
    });

    loop {
        let command = match read_frame(&mut controller_input) {
            Ok(command) => command,
            Err(_error) if hold_on_control_loss => {
                return hold_duplicated_job_handle(leaked_job_handle);
            }
            Err(error) => return Err(error),
        };
        match command {
            Some((INPUT, bytes)) => child_input.write_all(&bytes)?,
            Some((TERMINATE, _)) => {
                let _ = child.lock().map(|mut item| item.kill());
                break;
            }
            Some(_) => {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "unsupported supervisor command",
                ))
            }
            None => {
                if hold_on_control_loss {
                    return hold_duplicated_job_handle(leaked_job_handle);
                }
                terminate_contained_group(pid);
                let _ = child.lock().map(|mut item| item.kill());
                break;
            }
        }
    }
    Ok(())
}

#[cfg(unix)]
fn terminate_contained_group(_pid: u32) {
    unsafe {
        extern "C" {
            fn kill(pid: i32, sig: i32) -> i32;
        }
        const SIGKILL: i32 = 9;
        let _ = kill(0, SIGKILL);
    }
}

#[cfg(windows)]
fn terminate_contained_group(_pid: u32) {}

struct SupervisorScope {
    input: File,
    output: File,
    pid: u32,
    birth: String,
    duplicated_job_handle: Option<u64>,
    containment: Containment,
}

#[cfg(windows)]
mod platform {
    use super::*;
    use std::ffi::{c_void, OsStr};
    use std::mem::{size_of, zeroed};
    use std::os::windows::ffi::OsStrExt;
    use std::os::windows::io::FromRawHandle;
    use std::ptr::{null, null_mut};

    type Handle = *mut c_void;
    type Bool = i32;
    type Dword = u32;

    const FALSE: Bool = 0;
    const TRUE: Bool = 1;
    const HANDLE_FLAG_INHERIT: Dword = 1;
    const STARTF_USESTDHANDLES: Dword = 0x100;
    const CREATE_SUSPENDED: Dword = 0x4;
    const CREATE_NO_WINDOW: Dword = 0x0800_0000;
    const EXTENDED_STARTUPINFO_PRESENT: Dword = 0x0008_0000;
    const PROC_THREAD_ATTRIBUTE_HANDLE_LIST: usize = 0x0002_0002;
    const PROC_THREAD_ATTRIBUTE_JOB_LIST: usize = 0x0002_000d;
    const JOB_OBJECT_EXTENDED_LIMIT_INFORMATION_CLASS: Dword = 9;
    const JOB_OBJECT_BASIC_ACCOUNTING_INFORMATION_CLASS: Dword = 1;
    const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE: Dword = 0x0000_2000;
    const PROCESS_QUERY_LIMITED_INFORMATION: Dword = 0x1000;
    const PROCESS_TERMINATE: Dword = 0x0001;
    const SYNCHRONIZE: Dword = 0x0010_0000;
    const WAIT_OBJECT_0: Dword = 0;

    #[repr(C)]
    struct SecurityAttributes {
        length: Dword,
        descriptor: *mut c_void,
        inherit: Bool,
    }
    #[repr(C)]
    struct StartupInfoW {
        cb: Dword,
        reserved: *mut u16,
        desktop: *mut u16,
        title: *mut u16,
        x: Dword,
        y: Dword,
        x_size: Dword,
        y_size: Dword,
        x_count_chars: Dword,
        y_count_chars: Dword,
        fill_attribute: Dword,
        flags: Dword,
        show_window: u16,
        reserved2_size: u16,
        reserved2: *mut u8,
        stdin: Handle,
        stdout: Handle,
        stderr: Handle,
    }
    #[repr(C)]
    struct StartupInfoExW {
        startup: StartupInfoW,
        attributes: *mut c_void,
    }
    #[repr(C)]
    struct ProcessInformation {
        process: Handle,
        thread: Handle,
        process_id: Dword,
        thread_id: Dword,
    }
    #[repr(C)]
    struct IoCounters {
        read_ops: u64,
        write_ops: u64,
        other_ops: u64,
        read_bytes: u64,
        write_bytes: u64,
        other_bytes: u64,
    }
    #[repr(C)]
    struct BasicLimit {
        per_process: i64,
        per_job: i64,
        flags: Dword,
        min_ws: usize,
        max_ws: usize,
        active_limit: Dword,
        affinity: usize,
        priority: Dword,
        scheduling: Dword,
    }
    #[repr(C)]
    struct ExtendedLimit {
        basic: BasicLimit,
        io: IoCounters,
        process_memory: usize,
        job_memory: usize,
        peak_process: usize,
        peak_job: usize,
    }
    #[repr(C)]
    struct BasicAccounting {
        total_user_time: i64,
        total_kernel_time: i64,
        this_period_user_time: i64,
        this_period_kernel_time: i64,
        total_page_fault_count: Dword,
        total_processes: Dword,
        active_processes: Dword,
        total_terminated_processes: Dword,
    }
    #[repr(C)]
    struct FileTime {
        low: Dword,
        high: Dword,
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn CreatePipe(
            read: *mut Handle,
            write: *mut Handle,
            attrs: *mut SecurityAttributes,
            size: Dword,
        ) -> Bool;
        fn SetHandleInformation(handle: Handle, mask: Dword, flags: Dword) -> Bool;
        fn CreateJobObjectW(attrs: *mut c_void, name: *const u16) -> Handle;
        fn SetInformationJobObject(
            job: Handle,
            class: Dword,
            info: *const c_void,
            length: Dword,
        ) -> Bool;
        fn QueryInformationJobObject(
            job: Handle,
            class: Dword,
            info: *mut c_void,
            length: Dword,
            returned: *mut Dword,
        ) -> Bool;
        fn InitializeProcThreadAttributeList(
            list: *mut c_void,
            count: Dword,
            flags: Dword,
            size: *mut usize,
        ) -> Bool;
        fn UpdateProcThreadAttribute(
            list: *mut c_void,
            flags: Dword,
            attribute: usize,
            value: *mut c_void,
            size: usize,
            previous: *mut c_void,
            returned: *mut usize,
        ) -> Bool;
        fn DeleteProcThreadAttributeList(list: *mut c_void);
        fn CreateProcessW(
            app: *const u16,
            command: *mut u16,
            process_attrs: *mut c_void,
            thread_attrs: *mut c_void,
            inherit: Bool,
            flags: Dword,
            environment: *mut c_void,
            cwd: *const u16,
            startup: *mut StartupInfoW,
            info: *mut ProcessInformation,
        ) -> Bool;
        fn ResumeThread(thread: Handle) -> Dword;
        fn IsProcessInJob(process: Handle, job: Handle, result: *mut Bool) -> Bool;
        fn DuplicateHandle(
            source_process: Handle,
            source: Handle,
            target_process: Handle,
            target: *mut Handle,
            access: Dword,
            inherit: Bool,
            options: Dword,
        ) -> Bool;
        fn GetCurrentProcess() -> Handle;
        fn GetCurrentProcessId() -> Dword;
        fn OpenProcess(access: Dword, inherit: Bool, pid: Dword) -> Handle;
        fn GetProcessTimes(
            process: Handle,
            creation: *mut FileTime,
            exit: *mut FileTime,
            kernel: *mut FileTime,
            user: *mut FileTime,
        ) -> Bool;
        fn TerminateProcess(process: Handle, code: Dword) -> Bool;
        fn TerminateJobObject(job: Handle, code: Dword) -> Bool;
        fn WaitForSingleObject(handle: Handle, millis: Dword) -> Dword;
        fn CloseHandle(handle: Handle) -> Bool;
    }

    fn os_error(message: &str) -> io::Error {
        io::Error::other(format!("{message}: {}", io::Error::last_os_error()))
    }
    fn wide(value: &OsStr) -> Vec<u16> {
        value.encode_wide().chain(Some(0)).collect()
    }

    pub struct WindowsContainment {
        pub job: Handle,
        pub process: Handle,
    }
    unsafe impl Send for WindowsContainment {}
    impl Drop for WindowsContainment {
        fn drop(&mut self) {
            unsafe {
                if !self.process.is_null() {
                    CloseHandle(self.process);
                }
                if !self.job.is_null() {
                    CloseHandle(self.job);
                }
            }
        }
    }
    impl WindowsContainment {
        pub fn is_empty(&mut self) -> io::Result<bool> {
            unsafe {
                if self.job.is_null() {
                    return Ok(true);
                }
                let mut accounting: BasicAccounting = zeroed();
                if QueryInformationJobObject(
                    self.job,
                    JOB_OBJECT_BASIC_ACCOUNTING_INFORMATION_CLASS,
                    &mut accounting as *mut _ as *mut c_void,
                    size_of::<BasicAccounting>() as Dword,
                    null_mut(),
                ) == FALSE
                {
                    return Err(os_error("QueryInformationJobObject"));
                }
                Ok(accounting.active_processes == 0)
            }
        }

        pub fn terminate(&mut self) -> io::Result<()> {
            unsafe {
                if self.job.is_null() {
                    return Ok(());
                }
                if TerminateJobObject(self.job, 137) == FALSE {
                    return Err(os_error("TerminateJobObject"));
                }
                let deadline = Instant::now() + Duration::from_secs(10);
                loop {
                    let mut accounting: BasicAccounting = zeroed();
                    if QueryInformationJobObject(
                        self.job,
                        JOB_OBJECT_BASIC_ACCOUNTING_INFORMATION_CLASS,
                        &mut accounting as *mut _ as *mut c_void,
                        size_of::<BasicAccounting>() as Dword,
                        null_mut(),
                    ) == FALSE
                    {
                        return Err(os_error("QueryInformationJobObject"));
                    }
                    if accounting.active_processes == 0 {
                        break;
                    }
                    if Instant::now() >= deadline {
                        return Err(io::Error::new(
                            io::ErrorKind::TimedOut,
                            "scope-empty observation timed out",
                        ));
                    }
                    thread::sleep(Duration::from_millis(10));
                }
                if CloseHandle(self.job) == FALSE {
                    return Err(os_error("CloseHandle Job"));
                }
                self.job = null_mut();
                Ok(())
            }
        }
    }

    pub fn process_birth(pid: u32) -> Option<String> {
        unsafe {
            let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE, FALSE, pid);
            if process.is_null() {
                return None;
            }
            let mut creation: FileTime = zeroed();
            let mut exit: FileTime = zeroed();
            let mut kernel: FileTime = zeroed();
            let mut user: FileTime = zeroed();
            let ok = GetProcessTimes(process, &mut creation, &mut exit, &mut kernel, &mut user);
            CloseHandle(process);
            if ok == FALSE {
                return None;
            }
            Some(format!("{:08x}{:08x}", creation.high, creation.low))
        }
    }

    pub fn current_pid() -> u32 {
        unsafe { GetCurrentProcessId() }
    }

    pub fn validate_duplicated_job_handle(raw: u64) -> io::Result<()> {
        unsafe {
            let job = raw as usize as Handle;
            if job.is_null() {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "duplicated Job handle is null",
                ));
            }
            let mut in_job = FALSE;
            if IsProcessInJob(GetCurrentProcess(), job, &mut in_job) == FALSE || in_job == FALSE {
                return Err(os_error("duplicated Job handle validation"));
            }
            Ok(())
        }
    }

    pub fn spawn_supervisor(duplicate_job: bool) -> io::Result<SupervisorScope> {
        unsafe {
            let mut attrs = SecurityAttributes {
                length: size_of::<SecurityAttributes>() as u32,
                descriptor: null_mut(),
                inherit: TRUE,
            };
            let mut input_read: Handle = null_mut();
            let mut input_write: Handle = null_mut();
            let mut output_read: Handle = null_mut();
            let mut output_write: Handle = null_mut();
            if CreatePipe(&mut input_read, &mut input_write, &mut attrs, 0) == FALSE
                || CreatePipe(&mut output_read, &mut output_write, &mut attrs, 0) == FALSE
            {
                return Err(os_error("CreatePipe"));
            }
            if SetHandleInformation(input_write, HANDLE_FLAG_INHERIT, 0) == FALSE
                || SetHandleInformation(output_read, HANDLE_FLAG_INHERIT, 0) == FALSE
            {
                return Err(os_error("SetHandleInformation"));
            }
            let job = CreateJobObjectW(null_mut(), null());
            if job.is_null() {
                return Err(os_error("CreateJobObjectW"));
            }
            let mut limit: ExtendedLimit = zeroed();
            limit.basic.flags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            if SetInformationJobObject(
                job,
                JOB_OBJECT_EXTENDED_LIMIT_INFORMATION_CLASS,
                &limit as *const _ as *const c_void,
                size_of::<ExtendedLimit>() as u32,
            ) == FALSE
            {
                return Err(os_error("SetInformationJobObject"));
            }

            let mut bytes = 0usize;
            InitializeProcThreadAttributeList(null_mut(), 2, 0, &mut bytes);
            let mut storage = vec![0u8; bytes];
            let list = storage.as_mut_ptr() as *mut c_void;
            if InitializeProcThreadAttributeList(list, 2, 0, &mut bytes) == FALSE {
                return Err(os_error("InitializeProcThreadAttributeList"));
            }
            let mut job_value = job;
            if UpdateProcThreadAttribute(
                list,
                0,
                PROC_THREAD_ATTRIBUTE_JOB_LIST,
                &mut job_value as *mut _ as *mut c_void,
                size_of::<Handle>(),
                null_mut(),
                null_mut(),
            ) == FALSE
            {
                return Err(os_error("Update job attribute"));
            }
            let mut handles = [input_read, output_write];
            if UpdateProcThreadAttribute(
                list,
                0,
                PROC_THREAD_ATTRIBUTE_HANDLE_LIST,
                handles.as_mut_ptr() as *mut c_void,
                size_of::<Handle>() * handles.len(),
                null_mut(),
                null_mut(),
            ) == FALSE
            {
                return Err(os_error("Update handle attribute"));
            }

            let exe = env::current_exe()?;
            let app = wide(exe.as_os_str());
            let supervisor_mode = if duplicate_job {
                "--supervisor-test-leaked-job-handle"
            } else {
                "--supervisor"
            };
            let mut command = wide(OsStr::new(&format!(
                "\"{}\" {supervisor_mode}",
                exe.display()
            )));
            let mut startup: StartupInfoExW = zeroed();
            startup.startup.cb = size_of::<StartupInfoExW>() as u32;
            startup.startup.flags = STARTF_USESTDHANDLES;
            startup.startup.stdin = input_read;
            startup.startup.stdout = output_write;
            startup.startup.stderr = output_write;
            startup.attributes = list;
            let mut info: ProcessInformation = zeroed();
            let created = CreateProcessW(
                app.as_ptr(),
                command.as_mut_ptr(),
                null_mut(),
                null_mut(),
                TRUE,
                CREATE_SUSPENDED | CREATE_NO_WINDOW | EXTENDED_STARTUPINFO_PRESENT,
                null_mut(),
                null(),
                &mut startup.startup,
                &mut info,
            );
            DeleteProcThreadAttributeList(list);
            CloseHandle(input_read);
            CloseHandle(output_write);
            if created == FALSE {
                CloseHandle(input_write);
                CloseHandle(output_read);
                CloseHandle(job);
                return Err(os_error("CreateProcessW"));
            }
            let mut in_job = FALSE;
            if IsProcessInJob(info.process, job, &mut in_job) == FALSE || in_job == FALSE {
                TerminateProcess(info.process, 74);
                return Err(os_error("supervisor is not in Job"));
            }
            let duplicated_job_handle = if duplicate_job {
                let mut duplicated: Handle = null_mut();
                if DuplicateHandle(
                    GetCurrentProcess(),
                    job,
                    info.process,
                    &mut duplicated,
                    0,
                    FALSE,
                    2,
                ) == FALSE
                {
                    return Err(os_error("DuplicateHandle mutation"));
                }
                Some(duplicated as usize as u64)
            } else {
                None
            };
            if ResumeThread(info.thread) == u32::MAX {
                return Err(os_error("ResumeThread"));
            }
            CloseHandle(info.thread);
            let birth = process_birth(info.process_id)
                .ok_or_else(|| os_error("exact supervisor birth unavailable"))?;
            Ok(SupervisorScope {
                input: File::from_raw_handle(input_write),
                output: File::from_raw_handle(output_read),
                pid: info.process_id,
                birth,
                duplicated_job_handle,
                containment: Containment::Windows(WindowsContainment {
                    job,
                    process: info.process,
                }),
            })
        }
    }

    pub fn inspect_or_terminate(
        pid: u32,
        expected_birth: &str,
        supervisor_pid: u32,
        supervisor_birth: &str,
        _reserved_pgid: u32,
        terminate: bool,
        _allow_absent_controller: bool,
    ) -> u8 {
        unsafe {
            let process = OpenProcess(
                PROCESS_QUERY_LIMITED_INFORMATION
                    | SYNCHRONIZE
                    | if terminate { PROCESS_TERMINATE } else { 0 },
                FALSE,
                pid,
            );
            if process.is_null() {
                return if process_birth(supervisor_pid).as_deref() == Some(supervisor_birth) {
                    4
                } else {
                    2
                };
            }
            let actual = process_birth(pid);
            if actual.as_deref() != Some(expected_birth) {
                CloseHandle(process);
                return 3;
            }
            if terminate {
                if TerminateProcess(process, 137) == FALSE {
                    CloseHandle(process);
                    return 4;
                }
                let wait = WaitForSingleObject(process, 10_000);
                CloseHandle(process);
                if wait != WAIT_OBJECT_0 {
                    return 4;
                }
                let deadline = Instant::now() + Duration::from_secs(10);
                while Instant::now() < deadline {
                    if process_birth(supervisor_pid).as_deref() != Some(supervisor_birth) {
                        return 2;
                    }
                    thread::sleep(Duration::from_millis(10));
                }
                4
            } else {
                CloseHandle(process);
                1
            }
        }
    }
}

#[cfg(unix)]
mod platform {
    use super::*;
    use std::os::fd::{FromRawFd, IntoRawFd};
    use std::os::unix::process::CommandExt;

    extern "C" {
        fn kill(pid: i32, sig: i32) -> i32;
        fn getpid() -> i32;
        fn getpgid(pid: i32) -> i32;
    }
    const SIGTERM: i32 = 15;
    const SIGKILL: i32 = 9;

    pub struct PosixContainment {
        pub child: Child,
        pub pidfd: Option<i32>,
    }
    impl Drop for PosixContainment {
        fn drop(&mut self) {
            if let Some(fd) = self.pidfd.take() {
                unsafe {
                    close(fd);
                }
            }
        }
    }
    extern "C" {
        fn close(fd: i32) -> i32;
    }
    fn process_group_exists(pgid: u32) -> bool {
        let result = unsafe { kill(-(pgid as i32), 0) };
        result == 0 || io::Error::last_os_error().raw_os_error() == Some(1)
    }

    fn process_exists(pid: u32) -> bool {
        let result = unsafe { kill(pid as i32, 0) };
        result == 0 || io::Error::last_os_error().raw_os_error() == Some(1)
    }

    fn inspect_reserved_group(
        supervisor_pid: u32,
        supervisor_birth: &str,
        reserved_pgid: u32,
    ) -> u8 {
        if reserved_pgid == 0 || reserved_pgid != supervisor_pid {
            return 4;
        }
        match process_birth(supervisor_pid) {
            Some(actual) if actual != supervisor_birth => 3,
            Some(_) => {
                let actual_pgid = unsafe { getpgid(supervisor_pid as i32) };
                if actual_pgid < 0 {
                    4
                } else if actual_pgid as u32 != reserved_pgid {
                    3
                } else {
                    1
                }
            }
            None if process_exists(supervisor_pid) => 4,
            None if process_group_exists(reserved_pgid) => 1,
            None => 2,
        }
    }

    fn terminate_reserved_group(
        supervisor_pid: u32,
        supervisor_birth: &str,
        reserved_pgid: u32,
    ) -> u8 {
        let mut state = inspect_reserved_group(supervisor_pid, supervisor_birth, reserved_pgid);
        if state != 1 {
            return state;
        }
        if unsafe { kill(-(reserved_pgid as i32), SIGTERM) } < 0 {
            return if process_group_exists(reserved_pgid) {
                4
            } else {
                2
            };
        }
        let graceful_deadline = Instant::now() + Duration::from_millis(500);
        while Instant::now() < graceful_deadline {
            state = inspect_reserved_group(supervisor_pid, supervisor_birth, reserved_pgid);
            if state != 1 {
                return state;
            }
            thread::sleep(Duration::from_millis(10));
        }
        state = inspect_reserved_group(supervisor_pid, supervisor_birth, reserved_pgid);
        if state != 1 {
            return state;
        }
        if unsafe { kill(-(reserved_pgid as i32), SIGKILL) } < 0 {
            return if process_group_exists(reserved_pgid) {
                4
            } else {
                2
            };
        }
        let forced_deadline = Instant::now() + Duration::from_secs(10);
        while Instant::now() < forced_deadline {
            state = inspect_reserved_group(supervisor_pid, supervisor_birth, reserved_pgid);
            if state != 1 {
                return state;
            }
            thread::sleep(Duration::from_millis(10));
        }
        4
    }
    impl PosixContainment {
        pub fn is_empty(&mut self) -> io::Result<bool> {
            let _ = self.child.try_wait()?;
            Ok(!process_group_exists(self.child.id()))
        }

        pub fn terminate(&mut self) -> io::Result<()> {
            let pgid = self.child.id();
            let _ = self.child.try_wait()?;
            if process_group_exists(pgid) {
                unsafe {
                    kill(-(pgid as i32), SIGTERM);
                }
            }
            let deadline = Instant::now() + Duration::from_millis(500);
            while Instant::now() < deadline {
                let _ = self.child.try_wait()?;
                if !process_group_exists(pgid) {
                    return Ok(());
                }
                thread::sleep(Duration::from_millis(10));
            }
            unsafe {
                kill(-(pgid as i32), SIGKILL);
            }
            let deadline = Instant::now() + Duration::from_secs(10);
            while Instant::now() < deadline {
                let _ = self.child.try_wait()?;
                if !process_group_exists(pgid) {
                    return Ok(());
                }
                thread::sleep(Duration::from_millis(10));
            }
            Err(io::Error::new(
                io::ErrorKind::TimedOut,
                "process-group empty observation timed out",
            ))
        }
    }

    #[cfg(target_os = "linux")]
    fn linux_birth(pid: u32) -> Option<String> {
        let boot = std::fs::read_to_string("/proc/sys/kernel/random/boot_id").ok()?;
        let stat = std::fs::read_to_string(format!("/proc/{}/stat", pid)).ok()?;
        let close = stat.rfind(')')?;
        let fields: Vec<&str> = stat[close + 2..].split_whitespace().collect();
        let start = fields.get(19)?;
        Some(format!("{}-{}", boot.trim(), start))
    }

    #[cfg(target_os = "linux")]
    fn pidfd_open(pid: u32) -> Option<i32> {
        extern "C" {
            fn syscall(number: i64, ...) -> i64;
        }
        const SYS_PIDFD_OPEN: i64 = 434;
        let fd = unsafe { syscall(SYS_PIDFD_OPEN, pid as i32, 0u32) as i32 };
        if fd < 0 {
            None
        } else {
            Some(fd)
        }
    }

    #[cfg(target_os = "macos")]
    // XNU libproc.h `struct proc_uniqidentifierinfo` as shipped by the pinned
    // macOS SDK. The two trailing u64 reserve fields are ABI-significant even
    // though the capsule does not interpret them.
    #[repr(C)]
    struct ProcUniqIdentifierInfo {
        uuid: [u8; 16],
        unique_id: u64,
        parent_unique_id: u64,
        id_version: i32,
        reserve2: u32,
        reserve3: u64,
        reserve4: u64,
    }

    #[cfg(target_os = "macos")]
    const _: () = assert!(std::mem::size_of::<ProcUniqIdentifierInfo>() == 56);
    #[cfg(target_os = "macos")]
    const _: () = assert!(std::mem::align_of::<ProcUniqIdentifierInfo>() == 8);

    #[cfg(target_os = "macos")]
    fn mac_birth(pid: u32) -> Option<String> {
        extern "C" {
            fn proc_pidinfo(
                pid: i32,
                flavor: i32,
                arg: u64,
                buffer: *mut std::ffi::c_void,
                size: i32,
            ) -> i32;
        }
        const PROC_PIDUNIQIDENTIFIERINFO: i32 = 17;
        let mut info = ProcUniqIdentifierInfo {
            uuid: [0; 16],
            unique_id: 0,
            parent_unique_id: 0,
            id_version: 0,
            reserve2: 0,
            reserve3: 0,
            reserve4: 0,
        };
        let result = unsafe {
            proc_pidinfo(
                pid as i32,
                PROC_PIDUNIQIDENTIFIERINFO,
                0,
                &mut info as *mut _ as *mut _,
                std::mem::size_of::<ProcUniqIdentifierInfo>() as i32,
            )
        };
        if result != std::mem::size_of::<ProcUniqIdentifierInfo>() as i32
            || info.unique_id == 0
            || info.id_version <= 0
        {
            None
        } else {
            Some(format!("{:016x}-{:08x}", info.unique_id, info.id_version))
        }
    }

    pub fn process_birth(pid: u32) -> Option<String> {
        #[cfg(target_os = "linux")]
        {
            return linux_birth(pid);
        }
        #[cfg(target_os = "macos")]
        {
            return mac_birth(pid);
        }
        #[allow(unreachable_code)]
        None
    }
    pub fn current_pid() -> u32 {
        unsafe { getpid() as u32 }
    }

    pub fn validate_duplicated_job_handle(_raw: u64) -> io::Result<()> {
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "duplicated Job-handle mutation is Windows-only",
        ))
    }

    pub fn spawn_supervisor(_duplicate_job: bool) -> io::Result<SupervisorScope> {
        let exe = env::current_exe()?;
        let mut command = Command::new(exe);
        command
            .arg("--supervisor")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .process_group(0);
        let mut child = command.spawn()?;
        let pid = child.id();
        let birth = process_birth(pid).ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::Unsupported,
                "exact process birth unavailable",
            )
        })?;
        #[cfg(target_os = "linux")]
        let pidfd = Some(
            pidfd_open(pid)
                .ok_or_else(|| io::Error::new(io::ErrorKind::Unsupported, "pidfd unavailable"))?,
        );
        #[cfg(not(target_os = "linux"))]
        let pidfd = None;
        let input = child.stdin.take().ok_or_else(|| {
            io::Error::new(io::ErrorKind::BrokenPipe, "supervisor stdin unavailable")
        })?;
        let output = child.stdout.take().ok_or_else(|| {
            io::Error::new(io::ErrorKind::BrokenPipe, "supervisor stdout unavailable")
        })?;
        let input = unsafe { File::from_raw_fd(input.into_raw_fd()) };
        let output = unsafe { File::from_raw_fd(output.into_raw_fd()) };
        Ok(SupervisorScope {
            input,
            output,
            pid,
            birth,
            duplicated_job_handle: None,
            containment: Containment::Posix(PosixContainment { child, pidfd }),
        })
    }

    #[cfg(target_os = "linux")]
    pub fn inspect_or_terminate(
        pid: u32,
        expected_birth: &str,
        supervisor_pid: u32,
        supervisor_birth: &str,
        reserved_pgid: u32,
        terminate: bool,
        allow_absent_controller: bool,
    ) -> u8 {
        extern "C" {
            fn syscall(number: i64, ...) -> i64;
        }
        const SYS_PIDFD_SEND_SIGNAL: i64 = 424;
        let group_state = inspect_reserved_group(supervisor_pid, supervisor_birth, reserved_pgid);
        if group_state == 3 || group_state == 4 {
            return group_state;
        }
        match process_birth(pid) {
            Some(actual) if actual != expected_birth => return 3,
            Some(_) if group_state == 2 => return 2,
            Some(_) => {}
            None if process_exists(pid) => return 4,
            None => {
                return if terminate && group_state == 1 && allow_absent_controller {
                    terminate_reserved_group(supervisor_pid, supervisor_birth, reserved_pgid)
                } else if terminate && group_state == 1 {
                    4
                } else {
                    group_state
                };
            }
        }
        let fd = match pidfd_open(pid) {
            Some(value) => value,
            None => return 4,
        };
        if process_birth(pid).as_deref() != Some(expected_birth) {
            unsafe {
                close(fd);
            }
            return 3;
        }
        if !terminate {
            unsafe {
                close(fd);
            }
            return 1;
        }
        if unsafe {
            syscall(
                SYS_PIDFD_SEND_SIGNAL,
                fd,
                SIGTERM,
                std::ptr::null::<std::ffi::c_void>(),
                0u32,
            )
        } < 0
        {
            unsafe {
                close(fd);
            }
            return 4;
        }
        let deadline = Instant::now() + Duration::from_millis(500);
        let mut controller_closed = false;
        while Instant::now() < deadline {
            if process_birth(pid).as_deref() != Some(expected_birth) {
                controller_closed = true;
                break;
            }
            thread::sleep(Duration::from_millis(10));
        }
        if !controller_closed {
            if unsafe {
                syscall(
                    SYS_PIDFD_SEND_SIGNAL,
                    fd,
                    SIGKILL,
                    std::ptr::null::<std::ffi::c_void>(),
                    0u32,
                )
            } < 0
            {
                unsafe {
                    close(fd);
                }
                return 4;
            }
            let deadline = Instant::now() + Duration::from_secs(10);
            while Instant::now() < deadline {
                if process_birth(pid).as_deref() != Some(expected_birth) {
                    controller_closed = true;
                    break;
                }
                thread::sleep(Duration::from_millis(10));
            }
        }
        unsafe {
            close(fd);
        }
        if !controller_closed {
            return 4;
        }
        terminate_reserved_group(supervisor_pid, supervisor_birth, reserved_pgid)
    }

    #[cfg(target_os = "macos")]
    pub fn inspect_or_terminate(
        pid: u32,
        expected_birth: &str,
        supervisor_pid: u32,
        supervisor_birth: &str,
        reserved_pgid: u32,
        terminate: bool,
        allow_absent_controller: bool,
    ) -> u8 {
        let group_state = inspect_reserved_group(supervisor_pid, supervisor_birth, reserved_pgid);
        if group_state == 3 || group_state == 4 {
            return group_state;
        }
        match process_birth(pid) {
            Some(actual) if actual != expected_birth => return 3,
            Some(_) if group_state == 2 => return 2,
            Some(_) => {}
            None if process_exists(pid) => return 4,
            None => {
                return if terminate && group_state == 1 && allow_absent_controller {
                    terminate_reserved_group(supervisor_pid, supervisor_birth, reserved_pgid)
                } else if terminate && group_state == 1 {
                    4
                } else {
                    group_state
                };
            }
        }
        if !terminate {
            return 1;
        }
        // macOS has no pidfd. Re-read the kernel unique identifier immediately
        // before signalling and fail closed whenever it cannot be proven.
        if process_birth(pid).as_deref() != Some(expected_birth) {
            return 3;
        }
        unsafe {
            kill(pid as i32, SIGTERM);
        }
        let graceful_deadline = Instant::now() + Duration::from_millis(500);
        let mut controller_closed = false;
        while Instant::now() < graceful_deadline {
            if !process_exists(pid) || process_birth(pid).as_deref() != Some(expected_birth) {
                controller_closed = true;
                break;
            }
            thread::sleep(Duration::from_millis(10));
        }
        if !controller_closed {
            if process_birth(pid).as_deref() != Some(expected_birth) {
                return 3;
            }
            unsafe {
                kill(pid as i32, SIGKILL);
            }
            let forced_deadline = Instant::now() + Duration::from_secs(10);
            while Instant::now() < forced_deadline {
                if !process_exists(pid) || process_birth(pid).as_deref() != Some(expected_birth) {
                    controller_closed = true;
                    break;
                }
                thread::sleep(Duration::from_millis(10));
            }
        }
        if !controller_closed {
            return 4;
        }
        terminate_reserved_group(supervisor_pid, supervisor_birth, reserved_pgid)
    }
}

enum Containment {
    #[cfg(windows)]
    Windows(platform::WindowsContainment),
    #[cfg(unix)]
    Posix(platform::PosixContainment),
}
impl Containment {
    fn is_empty(&mut self) -> io::Result<bool> {
        match self {
            #[cfg(windows)]
            Self::Windows(value) => value.is_empty(),
            #[cfg(unix)]
            Self::Posix(value) => value.is_empty(),
        }
    }

    fn terminate(&mut self) -> io::Result<()> {
        match self {
            #[cfg(windows)]
            Self::Windows(value) => value.terminate(),
            #[cfg(unix)]
            Self::Posix(value) => value.terminate(),
        }
    }
}

fn make_runtime_ref(
    nonce: &str,
    supervisor_pid: u32,
    supervisor_birth: &str,
) -> io::Result<String> {
    let pid = platform::current_pid();
    let birth = platform::process_birth(pid).ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::Unsupported,
            "exact controller birth unavailable",
        )
    })?;
    let platform_name = if cfg!(windows) {
        "win32"
    } else if cfg!(target_os = "linux") {
        "linux"
    } else if cfg!(target_os = "macos") {
        "darwin"
    } else {
        "unsupported"
    };
    let reserved_pgid = if cfg!(unix) { supervisor_pid } else { 0 };
    Ok(format!(
        "v2|{platform_name}|{pid}|{birth}|{supervisor_pid}|{supervisor_birth}|{reserved_pgid}|{nonce}"
    ))
}

fn parse_runtime_ref(value: &str) -> Option<(&str, u32, &str, u32, &str, u32)> {
    let fields: Vec<&str> = value.split('|').collect();
    if fields.len() != 8 || fields[0] != "v2" {
        return None;
    }
    let pid = fields[2].parse::<u32>().ok()?;
    let supervisor_pid = fields[4].parse::<u32>().ok()?;
    let reserved_pgid = fields[6].parse::<u32>().ok()?;
    if (cfg!(unix) && reserved_pgid != supervisor_pid) || (!cfg!(unix) && reserved_pgid != 0) {
        return None;
    }
    Some((
        fields[1],
        pid,
        fields[3],
        supervisor_pid,
        fields[5],
        reserved_pgid,
    ))
}

fn controller_main(
    duplicate_job: bool,
    early_activation: bool,
    force_birth_unavailable: bool,
    orphan_group_after_controller_death: bool,
    withhold_activate: bool,
    withhold_first_terminate: bool,
) -> io::Result<()> {
    let mut input = io::stdin().lock();
    let (kind, payload) = read_frame(&mut input)?
        .ok_or_else(|| io::Error::new(io::ErrorKind::UnexpectedEof, "missing prepare"))?;
    if kind != PREPARE {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "controller expected prepare",
        ));
    }
    let spec = parse_launch(&payload)?;
    if force_birth_unavailable {
        return Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "test mutation: exact macOS process birth unavailable",
        ));
    }
    let mut supervisor = platform::spawn_supervisor(duplicate_job)?;
    if duplicate_job {
        let raw = supervisor.duplicated_job_handle.ok_or_else(|| {
            io::Error::other("duplicated Job-handle mutation was not established")
        })?;
        write_frame(
            &mut supervisor.input,
            SUPERVISOR_JOB_HANDLE,
            &raw.to_be_bytes(),
        )?;
    }
    write_frame(&mut supervisor.input, PREPARE, &payload)?;
    let ready = read_frame(&mut supervisor.output)?;
    let expected_ready_payload: &[u8] = if duplicate_job { &[1] } else { &[] };
    if !matches!(
        ready.as_ref(),
        Some((kind, payload))
            if *kind == SUPERVISOR_READY && payload.as_slice() == expected_ready_payload
    ) {
        let _ = supervisor.containment.terminate();
        return Err(io::Error::other("supervisor readiness not observed"));
    }
    #[cfg(unix)]
    let _pipe_holder = if orphan_group_after_controller_death {
        use std::os::unix::process::CommandExt;
        Some(
            Command::new(env::current_exe()?)
                .arg("--pipe-holder")
                .stdin(Stdio::from(supervisor.input.try_clone()?))
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .process_group(supervisor.pid as i32)
                .spawn()?,
        )
    } else {
        None
    };
    #[cfg(not(unix))]
    if orphan_group_after_controller_death {
        return Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "POSIX orphan-group mutation is unavailable",
        ));
    }
    if early_activation {
        write_frame(&mut supervisor.input, ACTIVATE, &[])?;
    }
    let runtime_ref = make_runtime_ref(&spec.nonce, supervisor.pid, &supervisor.birth)?;
    let mut prepared = Vec::new();
    prepared.extend_from_slice(&(runtime_ref.len() as u32).to_be_bytes());
    prepared.extend_from_slice(runtime_ref.as_bytes());
    prepared.extend_from_slice(&supervisor.pid.to_be_bytes());
    write_frame(&mut io::stdout().lock(), PREPARED, &prepared)?;

    let output = Arc::new(Mutex::new(io::stdout()));
    let containment = Arc::new(Mutex::new(supervisor.containment));
    let scope_empty_sent = Arc::new(AtomicBool::new(false));
    let mut supervisor_output = supervisor.output.try_clone()?;
    let output_clone = output.clone();
    let containment_clone = containment.clone();
    let scope_empty_clone = scope_empty_sent.clone();
    thread::spawn(move || loop {
        match read_frame(&mut supervisor_output) {
            Ok(Some((kind, payload))) => {
                if let Ok(mut writer) = output_clone.lock() {
                    if write_frame(&mut *writer, kind, &payload).is_err() {
                        process::exit(75);
                    }
                }
                if kind == ROOT_EXIT {
                    loop {
                        let empty = containment_clone
                            .lock()
                            .map_err(|_| ())
                            .and_then(|mut item| item.is_empty().map_err(|_| ()))
                            .unwrap_or_else(|_| process::exit(74));
                        if empty {
                            if !scope_empty_clone.swap(true, Ordering::AcqRel) {
                                if let Ok(mut writer) = output_clone.lock() {
                                    let _ = write_frame(&mut *writer, SCOPE_EMPTY, &[]);
                                }
                            }
                            process::exit(0);
                        }
                        thread::sleep(Duration::from_millis(10));
                    }
                }
            }
            _ => return,
        }
    });

    let mut activated = early_activation;
    let mut terminate_withheld = false;
    loop {
        match read_frame(&mut input)? {
            Some((ACTIVATE, _)) if !activated => {
                if withhold_activate {
                    continue;
                }
                activated = true;
                write_frame(&mut supervisor.input, ACTIVATE, &[])?;
            }
            Some((INPUT, bytes)) if activated => write_frame(&mut supervisor.input, INPUT, &bytes)?,
            Some((TERMINATE, _)) => {
                if withhold_first_terminate && !terminate_withheld {
                    terminate_withheld = true;
                    continue;
                }
                if activated {
                    let _ = write_frame(&mut supervisor.input, TERMINATE, &[]);
                }
                containment
                    .lock()
                    .map_err(|_| io::Error::other("containment lock poisoned"))?
                    .terminate()?;
                if !scope_empty_sent.swap(true, Ordering::AcqRel) {
                    if let Ok(mut writer) = output.lock() {
                        write_frame(&mut *writer, SCOPE_EMPTY, &[])?;
                    }
                }
                return Ok(());
            }
            Some(_) => {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "invalid controller state transition",
                ))
            }
            None => {
                if let Ok(mut item) = containment.lock() {
                    let _ = item.terminate();
                }
                return Ok(());
            }
        }
    }
}

fn probe_main(terminate: bool, allow_absent_controller: bool) -> io::Result<()> {
    let (kind, payload) = read_frame(&mut io::stdin().lock())?
        .ok_or_else(|| io::Error::new(io::ErrorKind::UnexpectedEof, "missing ProcessRef"))?;
    if kind != INSPECT {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "expected inspect request",
        ));
    }
    let value = std::str::from_utf8(&payload)
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "ProcessRef is not utf8"))?;
    let (ref_platform, pid, birth, supervisor_pid, supervisor_birth, reserved_pgid) =
        parse_runtime_ref(value)
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "ProcessRef is malformed"))?;
    let own_platform = if cfg!(windows) {
        "win32"
    } else if cfg!(target_os = "linux") {
        "linux"
    } else {
        "darwin"
    };
    let state = if ref_platform != own_platform {
        3
    } else {
        platform::inspect_or_terminate(
            pid,
            birth,
            supervisor_pid,
            supervisor_birth,
            reserved_pgid,
            terminate,
            allow_absent_controller,
        )
    };
    write_frame(&mut io::stdout().lock(), OBSERVATION, &[state])
}

fn pipe_holder_main() -> io::Result<()> {
    loop {
        thread::sleep(Duration::from_secs(60));
    }
}

fn process_birth_main(pid: &str) -> io::Result<()> {
    let pid = pid
        .parse::<u32>()
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "process PID is invalid"))?;
    let birth = platform::process_birth(pid).ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::NotFound,
            "exact process birth is unavailable",
        )
    })?;
    io::stdout().lock().write_all(birth.as_bytes())
}

fn main() {
    let args: Vec<String> = env::args().skip(1).collect();
    let result = match args.as_slice() {
        [mode] if mode == "--supervisor" => supervisor_main(false),
        [mode] if mode == "--supervisor-test-leaked-job-handle" => supervisor_main(true),
        [mode] if mode == "--controller" => {
            controller_main(false, false, false, false, false, false)
        }
        [mode] if mode == "--controller-test-duplicate-job-handle" => {
            controller_main(true, false, false, false, false, false)
        }
        [mode] if mode == "--controller-test-early-activation" => {
            controller_main(false, true, false, false, false, false)
        }
        [mode] if mode == "--controller-test-macos-birth-unavailable" => {
            controller_main(false, false, true, false, false, false)
        }
        [mode] if mode == "--controller-test-posix-orphan-group" => {
            controller_main(false, false, false, true, false, false)
        }
        [mode] if mode == "--controller-test-withhold-activate" => {
            controller_main(false, false, false, false, true, false)
        }
        [mode] if mode == "--controller-test-withhold-first-terminate" => {
            controller_main(false, false, false, false, false, true)
        }
        [mode] if mode == "--pipe-holder" => pipe_holder_main(),
        [mode, pid] if mode == "--process-birth" => process_birth_main(pid),
        [mode] if mode == "--inspect" => probe_main(false, false),
        [mode] if mode == "--terminate" => probe_main(true, false),
        [mode] if mode == "--terminate-owned" => probe_main(true, true),
        _ => Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "unsupported ProcessCapsule mode",
        )),
    };
    if let Err(error) = result {
        error_and_exit(&error.to_string(), 70);
    }
}
