//! The helper command-line surface.
//!
//! The helper is a short-lived process the controller invokes. It never holds the Job handle
//! and never becomes the authority: `prepare` launches the guardian and returns its
//! attestation, and every other verb reaches the guardian through the authenticated private
//! endpoint.
//!
//! Task 4.6: the guardian is launched with an explicit `PROC_THREAD_ATTRIBUTE_HANDLE_LIST`
//! naming exactly the two anonymous-pipe ends it needs. Nothing else is inheritable, so the
//! guardian cannot receive a stray handle and the workload — three creation steps further
//! down — can reach neither the endpoint, the Job handle, nor the trusted state root.

use std::collections::BTreeMap;
use std::ffi::c_void;
use std::io::{self, Write};
use std::mem::{size_of, zeroed};
use std::path::PathBuf;
use std::process::ExitCode;
use std::ptr::null_mut;
use std::time::{Duration, Instant};

use crate::guardian::{GuardianMutations, PipeStream, PrepareRequest};
use crate::attestation::PrepareAttestation;
use crate::launch::LaunchSnapshot;
use crate::protocol::*;
use crate::sha256;
use crate::sys::*;
use crate::endpoint::ControlEndpointClient;
use crate::win::{self, last_error, OwnedHandle};

pub const GUARDIAN_EXECUTABLE: &str = "rasen-windows-process-authority-guardian.exe";
pub const ATTESTATION_PREFIX: &str = "RWA1-ATTESTATION ";
pub const OBSERVATION_PREFIX: &str = "RWA1-OBSERVATION ";

const EXIT_USAGE: u8 = 64;
const EXIT_FAILURE: u8 = 70;

pub fn run() -> ExitCode {
    let arguments: Vec<String> = std::env::args().skip(1).collect();
    let verb = match arguments.first() {
        Some(verb) => verb.clone(),
        None => {
            eprintln!("usage: rasen-windows-process-authority <prepare|control|self-identity>");
            return ExitCode::from(EXIT_USAGE);
        }
    };
    let options = match parse_options(&arguments[1..]) {
        Ok(options) => options,
        Err(error) => {
            eprintln!("argument error: {error}");
            return ExitCode::from(EXIT_USAGE);
        }
    };
    let result = match verb.as_str() {
        "prepare" => prepare(&options),
        "probe-identity" => probe_identity(&options),
        "control" => control(&options),
        "dogfood" => dogfood(&options),
        "self-identity" => self_identity(),
        other => Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("unknown verb {other}"),
        )),
    };
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("rasen-windows-process-authority: {error}");
            ExitCode::from(EXIT_FAILURE)
        }
    }
}

#[derive(Default)]
pub struct Options {
    pub values: BTreeMap<String, Vec<String>>,
}

impl Options {
    fn one(&self, key: &str) -> io::Result<&str> {
        self.values
            .get(key)
            .and_then(|values| values.first())
            .map(String::as_str)
            .ok_or_else(|| {
                io::Error::new(io::ErrorKind::InvalidInput, format!("missing --{key}"))
            })
    }

    fn optional(&self, key: &str) -> Option<&str> {
        self.values
            .get(key)
            .and_then(|values| values.first())
            .map(String::as_str)
    }

    fn many(&self, key: &str) -> Vec<String> {
        self.values.get(key).cloned().unwrap_or_default()
    }

    fn flag(&self, key: &str) -> bool {
        self.values.contains_key(key)
    }

    fn number(&self, key: &str, fallback: u32) -> io::Result<u32> {
        match self.optional(key) {
            None => Ok(fallback),
            Some(value) => value.parse().map_err(|_| {
                io::Error::new(io::ErrorKind::InvalidInput, format!("--{key} is not a number"))
            }),
        }
    }
}

fn parse_options(arguments: &[String]) -> io::Result<Options> {
    let mut options = Options::default();
    let mut index = 0;
    while index < arguments.len() {
        let argument = &arguments[index];
        let key = argument.strip_prefix("--").ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::InvalidInput,
                format!("unexpected positional argument {argument}"),
            )
        })?;
        let takes_value = index + 1 < arguments.len() && !arguments[index + 1].starts_with("--");
        let entry = options.values.entry(key.to_owned()).or_default();
        if takes_value {
            entry.push(arguments[index + 1].clone());
            index += 2;
        } else {
            entry.push(String::new());
            index += 1;
        }
    }
    Ok(options)
}

// ---------------------------------------------------------------------------------------------
// prepare
// ---------------------------------------------------------------------------------------------

fn launch_from(options: &Options) -> io::Result<LaunchSnapshot> {
    let mut environment = BTreeMap::new();
    for entry in options.many("env") {
        let (key, value) = entry.split_once('=').ok_or_else(|| {
            io::Error::new(io::ErrorKind::InvalidInput, "--env expects KEY=VALUE")
        })?;
        environment.insert(key.to_owned(), value.to_owned());
    }
    Ok(LaunchSnapshot {
        executable: options.one("executable")?.to_owned(),
        working_directory: options.one("cwd")?.to_owned(),
        arguments: options
            .many("arg")
            .into_iter()
            .filter(|value| !value.is_empty())
            .collect(),
        environment,
        verbatim_arguments: options.flag("verbatim-arguments"),
    })
}

fn mutations_from(options: &Options) -> GuardianMutations {
    let mut mutations = GuardianMutations::default();
    for name in options.many("mutate") {
        match name.as_str() {
            "allow-breakaway" => mutations.job.allow_breakaway = true,
            "allow-silent-breakaway" => mutations.job.allow_silent_breakaway = true,
            "associate-port-late" => mutations.job.associate_port_late = true,
            "omit-job-list" => mutations.activation.omit_job_list = true,
            "skip-membership-proof" => mutations.activation.skip_membership_proof = true,
            "resume-before-membership-event" => {
                mutations.activation.resume_before_membership_event = true
            }
            "duplicate-job-into-root" => mutations.duplicate_job_into_root = true,
            _ => {}
        }
    }
    mutations
}

/// SHA-256 of the helper artifact the provider resolved, measured by hashing this executable.
///
/// Measured rather than compiled in, so the value cannot disagree with the file that actually
/// ran. `F-L2-14` applies on Windows too: two builds of different source produced identical
/// byte lengths with different digests, so only the hash carries the information.
pub fn measure_own_artifact() -> io::Result<String> {
    let path = std::env::current_exe()?;
    Ok(sha256::digest_hex(&std::fs::read(path)?))
}

/// The crate source digest the build script compiled in, or the empty string in a development
/// build. Empty means the canonical projection omits `sourceSha256` entirely and the consuming
/// codec fails closed, which is correct: a development helper has no build to bind a receipt to.
pub fn compiled_source_digest() -> &'static str {
    option_env!("RASEN_WPA_SOURCE_SHA256").unwrap_or("")
}

pub fn guardian_path() -> io::Result<PathBuf> {
    let helper = std::env::current_exe()?;
    let directory = helper.parent().ok_or_else(|| {
        io::Error::new(io::ErrorKind::NotFound, "helper has no parent directory")
    })?;
    let path = directory.join(GUARDIAN_EXECUTABLE);
    // Adjacent, absolute, and a real file. No path search, no shell, no download, no compile.
    let metadata = std::fs::symlink_metadata(&path)?;
    if !metadata.is_file() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "the adjacent guardian artifact is not a regular file",
        ));
    }
    crate::stateroot::reject_reparse_points_along(&path)?;
    Ok(path)
}

pub struct SpawnedGuardian {
    pub process: OwnedHandle,
    pub process_id: u32,
    pub to_guardian: OwnedHandle,
    pub from_guardian: OwnedHandle,
}

/// Launch the guardian with exactly two inherited handles.
pub fn spawn_guardian() -> io::Result<SpawnedGuardian> {
    let executable = guardian_path()?;
    let (request_read, request_write) = win::create_anonymous_pipe(true)?;
    let (response_read, response_write) = win::create_anonymous_pipe(false)?;

    let application = win::wide(&executable.to_string_lossy());
    let mut command_line = win::wide(&format!("\"{}\"", executable.to_string_lossy()));

    let mut bytes = 0_usize;
    unsafe { InitializeProcThreadAttributeList(null_mut(), 1, 0, &mut bytes) };
    if bytes == 0 {
        return Err(last_error("InitializeProcThreadAttributeList size"));
    }
    let mut storage = vec![0_u8; bytes];
    let list = storage.as_mut_ptr() as *mut c_void;
    if unsafe { InitializeProcThreadAttributeList(list, 1, 0, &mut bytes) } == FALSE {
        return Err(last_error("InitializeProcThreadAttributeList"));
    }
    let mut handles = [request_read.raw(), response_write.raw()];
    let ok = unsafe {
        UpdateProcThreadAttribute(
            list,
            0,
            PROC_THREAD_ATTRIBUTE_HANDLE_LIST,
            handles.as_mut_ptr() as *mut c_void,
            size_of::<Handle>() * handles.len(),
            null_mut(),
            null_mut(),
        )
    };
    if ok == FALSE {
        unsafe { DeleteProcThreadAttributeList(list) };
        return Err(last_error("UpdateProcThreadAttribute guardian handles"));
    }

    let mut startup: StartupInfoExW = unsafe { zeroed() };
    startup.startup.cb = size_of::<StartupInfoExW>() as Dword;
    startup.startup.flags = STARTF_USESTDHANDLES;
    startup.startup.stdin = request_read.raw();
    startup.startup.stdout = response_write.raw();
    startup.startup.stderr = response_write.raw();
    startup.attributes = list;

    let mut information: ProcessInformation = unsafe { zeroed() };
    let created = unsafe {
        CreateProcessW(
            application.as_ptr(),
            command_line.as_mut_ptr(),
            null_mut(),
            null_mut(),
            TRUE,
            CREATE_NO_WINDOW | EXTENDED_STARTUPINFO_PRESENT,
            null_mut(),
            null_mut(),
            &mut startup.startup,
            &mut information,
        )
    };
    unsafe { DeleteProcThreadAttributeList(list) };
    if created == FALSE {
        return Err(last_error("CreateProcessW guardian"));
    }
    let process = unsafe { OwnedHandle::from_raw(information.process) };
    unsafe { OwnedHandle::from_raw(information.thread) };

    // Close the ends the guardian owns so we see end-of-file when it exits.
    request_read.close()?;
    response_write.close()?;

    Ok(SpawnedGuardian {
        process,
        process_id: information.process_id,
        to_guardian: request_write,
        from_guardian: response_read,
    })
}

/// The production prepare transaction: compose the request, launch the guardian with exactly
/// two inherited handles, and return its attestation. Used by both the `prepare` verb and the
/// `dogfood` verb, so neither is a testing-only twin of the other.
pub fn prepare_authority(
    options: &Options,
) -> io::Result<(PrepareAttestation, Vec<u8>, SpawnedGuardian)> {
    let request = PrepareRequest {
        operation_id: options.one("operation")?.to_owned(),
        state_root: options.one("state-root")?.to_owned(),
        launch: launch_from(options)?,
        mutation_bits: mutations_from(options).encode(),
        fail_at: options.optional("fail-at").unwrap_or_default().to_owned(),
        artifact_sha256: measure_own_artifact()?,
        source_sha256: compiled_source_digest().to_owned(),
    };
    let spawned = spawn_guardian()?;
    let mut to_guardian = PipeStream::new(spawned.to_guardian.raw());
    write_frame(
        &mut to_guardian,
        &Frame {
            kind: FrameKind::Attest,
            payload: request.encode()?,
        },
    )?;
    let mut from_guardian = PipeStream::new(spawned.from_guardian.raw());
    let frame = read_frame(&mut from_guardian)?.ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::UnexpectedEof,
            "native-transport-lost: the guardian produced no attestation",
        )
    })?;
    match frame.kind {
        FrameKind::Attestation => {
            let attestation = PrepareAttestation::decode(&frame.payload)?;
            let violations = attestation.violations();
            if !violations.is_empty() {
                return Err(io::Error::other(format!(
                    "authority-unavailable: attestation violations {violations:?}"
                )));
            }
            Ok((attestation, frame.payload, spawned))
        }
        FrameKind::Failure => {
            let code = NativeFailureCode::decode(&frame.payload)?;
            Err(io::Error::other(code.diagnostic_code().to_owned()))
        }
        other => Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("unexpected guardian frame {}", other.name()),
        )),
    }
}

fn prepare(options: &Options) -> io::Result<()> {
    let (attestation, payload, _spawned) = prepare_authority(options)?;
    let mut stdout = io::stdout();
    writeln!(stdout, "{ATTESTATION_PREFIX}{}", sha256::hex(&payload))?;
    writeln!(stdout, "{ATTESTATION_PREFIX}payload {}", hex(&payload))?;
    writeln!(
        stdout,
        "{ATTESTATION_PREFIX}canonical {}",
        attestation.to_canonical_json()
    )?;
    stdout.flush()?;
    eprintln!("prepared: {}", attestation.redacted_summary());
    Ok(())
}


// ---------------------------------------------------------------------------------------------
// probe-identity
// ---------------------------------------------------------------------------------------------

pub const PROBE_PREFIX: &str = "RWA1-PROBE ";

/// Read the live identity of a referenced authority, at either stage of the reopen sequence.
///
/// Every value here is unobtainable from Node: owner SIDs, process creation `FILETIME`, and the
/// serving process id of a named pipe all require Win32 calls with no Node equivalent
/// (`stat.uid` is 0 on Windows). If this verb does not report them, those checks do not exist.
///
/// `soleHandleAttestation` is reported only when the **trusted state root corroborates** it, and
/// is `null` otherwise. That null is load-bearing: "the reference carries an attestation" is
/// vacuous, because the codec requires one in every valid reference, so a recovery rule keyed on
/// presence can never be falsified and would fabricate exact-empty receipts for live workloads.
fn probe_identity(options: &Options) -> io::Result<()> {
    let scope = crate::stateroot::normalize_scope_id(options.one("scope")?)?;
    let stage = options.one("stage")?.to_owned();
    if stage != "pre-open" && stage != "post-open" {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "--stage must be pre-open or post-open",
        ));
    }
    let guardian_process_id: u32 = options
        .one("guardian-pid")?
        .parse()
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "--guardian-pid"))?;
    let guardian_birth: u64 = options
        .one("guardian-birth")?
        .parse()
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "--guardian-birth"))?;
    let owner = options.one("owner-sid")?.to_owned();
    let expected_token = unhex(options.one("sole-handle-token")?)?;
    let expected_token: [u8; 32] = expected_token.try_into().map_err(|_| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            "--sole-handle-token must be 32 bytes",
        )
    })?;

    let mut fields: Vec<String> = Vec::new();
    fields.push(format!("stage={stage}"));

    // Boot identity is read fresh every time and is never inferred from the endpoint. The two
    // proofs stay separate on purpose (Decision 5).
    let boot = crate::boot::probe();
    match boot.selected {
        Some(identity) => {
            fields.push(format!("bootIdentity={}", sha256::hex(&identity.value)));
            fields.push(format!("bootIdentitySource={}", identity.source.name()));
        }
        None => {
            println!("{PROBE_PREFIX}state=authority-unavailable diagnosticCode=boot-identity-unobtainable");
            return Ok(());
        }
    }

    // Corroboration comes from the trusted state root, whose ownership and reparse status are
    // revalidated on every probe rather than trusted from prepare.
    let sole_handle = match options.optional("state-root") {
        Some(path) => {
            let expected_owner = win::current_user_sid()?;
            match crate::stateroot::TrustedStateRoot::open(path, &expected_owner) {
                Ok(root) => root.corroborate_sole_handle(&scope, &expected_token)?,
                Err(_) => None,
            }
        }
        None => None,
    };
    fields.push(match &sole_handle {
        Some(_) => format!(
            "soleHandleAttestation={}",
            crate::encoding::base64url(&expected_token)
        ),
        None => "soleHandleAttestation=null".to_owned(),
    });

    let live_birth = win::process_birth(guardian_process_id);
    if live_birth != Some(guardian_birth) {
        // Absent, or occupied by a different process. These are different classifications and
        // the caller must not collapse them.
        let state = if live_birth.is_none() {
            "authority-absent"
        } else {
            "identity-drift"
        };
        let terminal = options
            .optional("state-root")
            .and_then(|path| {
                std::fs::read_to_string(
                    PathBuf::from(path)
                        .join("scopes")
                        .join(&scope)
                        .join("terminal.record"),
                )
                .ok()
            })
            .map(|text| text.trim().to_owned());
        fields.push(format!("endpointPresent={}", endpoint_present(&scope)));
        fields.push(match terminal {
            Some(record) => format!("terminalRecord={}", record.replace(' ', "\u{1}")),
            None => "terminalRecord=null".to_owned(),
        });
        println!("{PROBE_PREFIX}state={state} {}", fields.join(" "));
        return Ok(());
    }

    if stage == "pre-open" {
        fields.push(format!("guardianProcessId={guardian_process_id}"));
        fields.push(format!("guardianCreationTime={guardian_birth}"));
        fields.push(format!("endpointPresent={}", endpoint_present(&scope)));
        println!("{PROBE_PREFIX}state=authority-present {}", fields.join(" "));
        return Ok(());
    }

    // post-open: open every handle, then reread the complete tuple through them.
    match ControlEndpointClient::connect(&scope, guardian_process_id, guardian_birth, &owner) {
        Ok(client) => {
            let tuple = client.tuple();
            fields.push(format!("guardianProcessId={}", tuple.guardian_process_id));
            fields.push(format!("guardianCreationTime={}", tuple.guardian_birth));
            fields.push(format!(
                "endpointServerProcessId={}",
                tuple.endpoint_server_process_id
            ));
            fields.push(format!(
                "endpointOwnerSid={}",
                tuple.endpoint_owner_sid_text
            ));
            fields.push("endpointAuthentication=authenticated".to_owned());
            println!("{PROBE_PREFIX}state=authority-present {}", fields.join(" "));
            Ok(())
        }
        Err(error) => {
            let text = error.to_string();
            let state = if text.contains("identity-drift") {
                "identity-drift"
            } else if error.kind() == io::ErrorKind::WouldBlock {
                "authority-uncertain"
            } else {
                "control-loss"
            };
            fields.push("endpointAuthentication=rejected".to_owned());
            println!("{PROBE_PREFIX}state={state} {}", fields.join(" "));
            Ok(())
        }
    }
}

/// Does the control endpoint exist in the object namespace? The namespace does not survive a
/// reboot, which is the **independent** second boot proof of Decision 5 — deliberately not
/// merged with the boot-identity value above.
fn endpoint_present(scope: &str) -> bool {
    match crate::stateroot::endpoint_name(scope) {
        Ok(name) => std::fs::metadata(&name).is_ok() || pipe_name_exists(&name),
        Err(_) => false,
    }
}

fn pipe_name_exists(name: &str) -> bool {
    // Opening with no access requests neither read nor write, so it answers existence without
    // consuming the single pipe instance for a real session.
    let wide_name = win::wide(name);
    let handle = unsafe {
        CreateFileW(
            wide_name.as_ptr(),
            0,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            null_mut(),
            OPEN_EXISTING,
            0,
            null_mut(),
        )
    };
    if handle == INVALID_HANDLE_VALUE || handle.is_null() {
        // A busy pipe exists; it is simply serving someone else.
        return win::last_error_code() == ERROR_PIPE_BUSY;
    }
    unsafe { OwnedHandle::from_raw(handle) };
    true
}

// ---------------------------------------------------------------------------------------------
// control
// ---------------------------------------------------------------------------------------------

fn control(options: &Options) -> io::Result<()> {
    let scope = crate::stateroot::normalize_scope_id(options.one("scope")?)?;
    let guardian_process_id: u32 = options
        .one("guardian-pid")?
        .parse()
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "--guardian-pid"))?;
    let guardian_birth: u64 = options
        .one("guardian-birth")?
        .parse()
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "--guardian-birth"))?;
    let owner = options.one("owner-sid")?.to_owned();
    let capability = unhex(options.one("capability")?)?;
    if capability.len() != 32 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "--capability must be 32 bytes",
        ));
    }
    let deadline_ms = options.number("deadline-ms", 30_000)?;
    let grace_ms = options.number("grace-ms", 0)?;
    let verb = options.one("verb")?.to_owned();

    let client =
        ControlEndpointClient::connect(&scope, guardian_process_id, guardian_birth, &owner)?;
    let mut stream = PipeStream::overlapped(client.raw())?;

    write_frame(
        &mut stream,
        &Frame {
            kind: FrameKind::Attest,
            payload: capability,
        },
    )?;
    let attestation_frame = expect_frame(&mut stream)?;
    if attestation_frame.kind != FrameKind::Attestation {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "reference-invalid: the guardian refused the control capability",
        ));
    }

    // Reread the complete identity tuple through the open handles before issuing anything.
    let reread = client.read_identity_tuple(guardian_process_id)?;
    if &reread != client.tuple() {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "identity-drift: the identity tuple changed after handles were opened",
        ));
    }

    let deadline = Instant::now() + Duration::from_millis(u64::from(deadline_ms));
    match verb.as_str() {
        "inspect" => {
            write_frame(
                &mut stream,
                &Frame {
                    kind: FrameKind::Inspect,
                    payload: Vec::new(),
                },
            )?;
            let frame = expect_frame(&mut stream)?;
            println!("{OBSERVATION_PREFIX}{}", hex(&frame.payload));
            Ok(())
        }
        "abort" | "terminate" => {
            let mut payload = Vec::new();
            payload.extend_from_slice(&grace_ms.to_be_bytes());
            payload.extend_from_slice(&deadline_ms.to_be_bytes());
            write_frame(
                &mut stream,
                &Frame {
                    kind: if verb == "abort" {
                        FrameKind::Abort
                    } else {
                        FrameKind::Terminate
                    },
                    payload,
                },
            )?;
            // Drain until the authority reports its own outcome, exactly as `run_workload`
            // already does.
            //
            // The guardian broadcasts unsolicited frames onto the session writer from other
            // threads -- `deliver_root_exit` (`guardian.rs:673`) is the one that matters here,
            // because terminating a live authority kills the root and that broadcast races the
            // terminate handler's `ExactScopeEmpty` on the same writer. Reading exactly one
            // frame therefore returned `unexpected frame root-exited` for a termination that had
            // actually converged, and the caller retained uncertainty about an authority that
            // was empty. Measured before this fix: the receipt was lost in 19 of 20 direct runs
            // (`S9-F1`).
            //
            // `RootExited` is not special-cased: any frame that is not the authority's own
            // verdict is drained, so a later broadcast added to the guardian cannot reintroduce
            // this defect.
            loop {
                if Instant::now() >= deadline {
                    return Err(io::Error::new(
                        io::ErrorKind::TimedOut,
                        NativeFailureCode::Timeout.diagnostic_code().to_owned(),
                    ));
                }
                let frame = expect_frame(&mut stream)?;
                match frame.kind {
                    FrameKind::ExactScopeEmpty => {
                        println!("{OBSERVATION_PREFIX}{}", hex(&frame.payload));
                        return Ok(());
                    }
                    FrameKind::Failure => {
                        return Err(io::Error::other(
                            NativeFailureCode::decode(&frame.payload)?
                                .diagnostic_code()
                                .to_owned(),
                        ))
                    }
                    FrameKind::RootExited => {
                        let status = RootStatus::decode(&frame.payload)?;
                        eprintln!("root-exited code={} signal=null", status.unsigned_text());
                    }
                    FrameKind::Output => io::stdout().write_all(&frame.payload)?,
                    FrameKind::ErrorOutput => io::stderr().write_all(&frame.payload)?,
                    _ => {}
                }
            }
        }
        "run" => run_workload(&mut stream, deadline),
        "bridge" => bridge_runtime(&mut stream, client.raw()),
        other => Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("unknown verb {other}"),
        )),
    }
}

/// Frame-preserving production runtime bridge.
///
/// Unlike `run`, this verb never writes workload bytes or authority receipts as
/// text. It forwards only the closed RWA1 frame vocabulary. The controller-side
/// adapter therefore demultiplexes `Output`/`ErrorOutput` from `RootExited` and
/// `ExactScopeEmpty` by authenticated frame kind; a workload printing receipt-
/// looking bytes remains only an `Output` payload.
fn bridge_runtime(endpoint_reader: &mut PipeStream, handle: Handle) -> io::Result<()> {
    let mut endpoint_writer = PipeStream::overlapped(handle)?;
    write_frame(
        &mut endpoint_writer,
        &Frame {
            kind: FrameKind::OpenRuntime,
            payload: Vec::new(),
        },
    )?;
    let ready = expect_frame(endpoint_reader)?;
    if ready.kind != FrameKind::RuntimeReady || !ready.payload.is_empty() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "the guardian did not open the frame-preserving runtime bridge",
        ));
    }
    write_frame(&mut io::stdout().lock(), &ready)?;

    // Input owns a distinct overlapped context on the same authenticated pipe,
    // so it cannot block authority events travelling in the other direction.
    std::thread::spawn(move || {
        let mut input = io::stdin().lock();
        while let Ok(Some(frame)) = read_frame(&mut input) {
            if !matches!(
                frame.kind,
                FrameKind::Activate
                    | FrameKind::Inspect
                    | FrameKind::Abort
                    | FrameKind::Terminate
                    | FrameKind::Input
                    | FrameKind::CloseInput
            ) {
                // Closed controller vocabulary: never forward control/outcome
                // kinds from standard input into the authority.
                break;
            }
            if write_frame(&mut endpoint_writer, &frame).is_err() {
                break;
            }
        }
    });

    let mut output = io::stdout().lock();
    loop {
        let frame = expect_frame(endpoint_reader)?;
        match frame.kind {
            FrameKind::Activated
            | FrameKind::Output
            | FrameKind::ErrorOutput
            | FrameKind::Event
            | FrameKind::RootExited
            | FrameKind::ExactScopeEmpty
            | FrameKind::Failure => {
                let terminal =
                    matches!(frame.kind, FrameKind::ExactScopeEmpty | FrameKind::Failure);
                write_frame(&mut output, &frame)?;
                if terminal {
                    return Ok(());
                }
            }
            _ => {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "the guardian emitted an unexpected runtime frame",
                ))
            }
        }
    }
}

/// Open the runtime bridge, activate, and stream until the authority reports exact empty.
fn run_workload(stream: &mut PipeStream, deadline: Instant) -> io::Result<()> {
    write_frame(
        stream,
        &Frame {
            kind: FrameKind::OpenRuntime,
            payload: Vec::new(),
        },
    )?;
    let ready = expect_frame(stream)?;
    if ready.kind != FrameKind::RuntimeReady {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "the guardian did not open the runtime bridge",
        ));
    }
    write_frame(
        stream,
        &Frame {
            kind: FrameKind::Activate,
            payload: Vec::new(),
        },
    )?;
    let mut stdout = io::stdout();
    loop {
        if Instant::now() >= deadline {
            return Err(io::Error::new(io::ErrorKind::TimedOut, "native-operation-timeout"));
        }
        // End of stream is **never** a receipt. The authority reporting empty is a frame the
        // guardian sends; the endpoint closing means the guardian vanished, which is
        // `control-loss` and must be reconciled against the durable terminal record and the
        // last-handle rule rather than reported as success. The first real end-to-end run of
        // this crate returned `Ok(())` here and printed an exact-empty line off a bare EOF.
        let frame = match read_frame(stream)? {
            Some(frame) => frame,
            None => {
                return Err(io::Error::new(
                    io::ErrorKind::UnexpectedEof,
                    NativeFailureCode::ControlLoss.diagnostic_code(),
                ))
            }
        };
        match frame.kind {
            FrameKind::Activated => {
                let id = u32::from_be_bytes(frame.payload[..4].try_into().unwrap_or([0; 4]));
                eprintln!("activated root={id}");
            }
            FrameKind::Output => stdout.write_all(&frame.payload)?,
            FrameKind::ErrorOutput => io::stderr().write_all(&frame.payload)?,
            FrameKind::RootExited => {
                let status = RootStatus::decode(&frame.payload)?;
                eprintln!("root-exited code={} signal=null", status.unsigned_text());
            }
            FrameKind::ExactScopeEmpty => {
                println!("{OBSERVATION_PREFIX}{}", hex(&frame.payload));
                return Ok(());
            }
            FrameKind::Failure => {
                return Err(io::Error::other(
                    NativeFailureCode::decode(&frame.payload)?
                        .diagnostic_code()
                        .to_owned(),
                ))
            }
            _ => {}
        }
    }
}

// ---------------------------------------------------------------------------------------------
// dogfood: production code against the real kernel, end to end, with no test harness
// ---------------------------------------------------------------------------------------------

/// Task 9.8. Prepare, reopen through the full replacement-recovery sequence, inspect, open the
/// runtime bridge, activate, stream, and converge on the authority's own empty event — using
/// exactly the production entry points, with no fixture, no injected transport, and no test
/// framework in the loop.
fn dogfood(options: &Options) -> io::Result<()> {
    let (attestation, payload, spawned) = prepare_authority(options)?;
    println!("dogfood prepare ok");
    println!("dogfood attestation-digest {}", sha256::hex(&payload));
    println!("dogfood {}", attestation.redacted_summary());

    // The reopen sequence a replacement controller runs: guardian identity first, endpoint
    // second, full tuple reread third.
    let client = ControlEndpointClient::connect(
        &attestation.scope_id,
        attestation.guardian_process_id,
        attestation.guardian_birth,
        &attestation.endpoint_owner_sid,
    )?;
    println!("dogfood reopen ok tuple={:?}", client.tuple());
    let mut stream = PipeStream::overlapped(client.raw())?;
    write_frame(
        &mut stream,
        &Frame {
            kind: FrameKind::Attest,
            payload: attestation.control_capability.to_vec(),
        },
    )?;
    let echoed = expect_frame(&mut stream)?;
    if echoed.kind != FrameKind::Attestation {
        return Err(io::Error::other("the guardian refused the capability"));
    }
    println!("dogfood capability accepted");

    write_frame(
        &mut stream,
        &Frame {
            kind: FrameKind::Inspect,
            payload: Vec::new(),
        },
    )?;
    let observation = expect_frame(&mut stream)?;
    println!(
        "dogfood inspect phase={} payload={}",
        observation.payload.first().copied().unwrap_or(0),
        hex(&observation.payload)
    );

    if options.flag("abort") {
        let mut payload = Vec::new();
        payload.extend_from_slice(&0_u32.to_be_bytes());
        payload.extend_from_slice(&10_000_u32.to_be_bytes());
        write_frame(
            &mut stream,
            &Frame {
                kind: FrameKind::Abort,
                payload,
            },
        )?;
        let frame = expect_frame(&mut stream)?;
        println!(
            "dogfood abort frame={} payload={}",
            frame.kind.name(),
            hex(&frame.payload)
        );
        return Ok(());
    }

    let deadline = Instant::now()
        + Duration::from_millis(u64::from(options.number("deadline-ms", 30_000)?));
    match run_workload(&mut stream, deadline) {
        Ok(()) => {
            println!("dogfood exact-scope-empty reached");
            Ok(())
        }
        Err(error) => {
            // The guardian's diagnostic channel is the only place its own failure text lands.
            // Draining it here is what turns "failed to fill whole buffer" into a cause.
            let handle = win::SendHandle(spawned.from_guardian.raw());
            let (sender, receiver) = std::sync::mpsc::channel();
            std::thread::spawn(move || {
                let mut buffer = vec![0_u8; 8192];
                let count = win::read_handle(handle.get(), &mut buffer).unwrap_or(0);
                let _ = sender.send(String::from_utf8_lossy(&buffer[..count]).into_owned());
            });
            if let Ok(text) = receiver.recv_timeout(Duration::from_millis(1500)) {
                if !text.is_empty() {
                    eprintln!("dogfood guardian-diagnostics: {text}");
                }
            }
            Err(error)
        }
    }
}

fn expect_frame(stream: &mut PipeStream) -> io::Result<Frame> {
    read_frame(stream)?.ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::UnexpectedEof,
            "native-transport-lost: the guardian closed the endpoint",
        )
    })
}

fn self_identity() -> io::Result<()> {
    println!("providerId rasen.windows.job-object");
    println!("capabilityId rasen-recursive-process-scope/1");
    println!("protocolVersion {PROTOCOL_VERSION}");
    println!("commonContractVersion {COMMON_CONTRACT_VERSION}");
    println!("providerReferenceVersion {REFERENCE_VERSION}");
    println!("declaredForeignItems {}", DECLARED_FOREIGN_ITEMS.len());
    println!("guardian {}", guardian_path()?.display());
    Ok(())
}

pub fn hex(bytes: &[u8]) -> String {
    sha256::hex(bytes)
}

pub fn unhex(value: &str) -> io::Result<Vec<u8>> {
    if value.len() % 2 != 0 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "hex value has an odd length",
        ));
    }
    (0..value.len() / 2)
        .map(|index| {
            u8::from_str_radix(&value[index * 2..index * 2 + 2], 16).map_err(|_| {
                io::Error::new(io::ErrorKind::InvalidInput, "value is not hexadecimal")
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn options_parse_repeated_and_flag_arguments() {
        let arguments: Vec<String> = [
            "--executable",
            "C:\\a.exe",
            "--arg",
            "one",
            "--arg",
            "two",
            "--verbatim-arguments",
            "--deadline-ms",
            "500",
        ]
        .iter()
        .map(|value| (*value).to_owned())
        .collect();
        let options = parse_options(&arguments).expect("parse");
        assert_eq!(options.one("executable").expect("exe"), "C:\\a.exe");
        assert_eq!(options.many("arg"), vec!["one", "two"]);
        assert!(options.flag("verbatim-arguments"));
        assert_eq!(options.number("deadline-ms", 1).expect("number"), 500);
        assert_eq!(options.number("absent", 7).expect("number"), 7);
        assert!(options.one("absent").is_err());
    }

    #[test]
    fn positional_arguments_are_refused() {
        let arguments = vec!["oops".to_owned()];
        assert!(parse_options(&arguments).is_err());
    }

    #[test]
    fn hex_round_trips_and_rejects_malformed_input() {
        let bytes = vec![0_u8, 1, 15, 16, 255];
        assert_eq!(unhex(&hex(&bytes)).expect("unhex"), bytes);
        assert!(unhex("abc").is_err());
        assert!(unhex("zz").is_err());
    }

    #[test]
    fn no_mutation_is_selected_unless_it_is_named() {
        let options = parse_options(&[]).expect("parse");
        assert!(!mutations_from(&options).any());
        let named: Vec<String> = ["--mutate", "duplicate-job-into-root"]
            .iter()
            .map(|value| (*value).to_owned())
            .collect();
        let options = parse_options(&named).expect("parse");
        assert!(mutations_from(&options).duplicate_job_into_root);
        // An unrecognised mutation name must not silently enable anything.
        let unknown: Vec<String> = ["--mutate", "not-a-mutation"]
            .iter()
            .map(|value| (*value).to_owned())
            .collect();
        let options = parse_options(&unknown).expect("parse");
        assert!(!mutations_from(&options).any());
    }
}
