use std::ffi::OsString;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::os::fd::{AsRawFd, RawFd};
use std::os::unix::net::UnixStream;
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

use crate::authority::PreparedAttestation;
use crate::broker_lease::{BrokerLease, CgroupLeafIdentity};
use crate::broker_protocol::{broker_request_capability, BrokerClientReferenceWire};
use crate::broker_service::{GuardianAuthority, GuardianRuntimeAuthority, PreparedGuardian};
use crate::deadline::{read_exact_fd_until, write_all_fd_until, AbsoluteMonotonicDeadline};
use crate::lifecycle::GuardianEvent;
use crate::linux::reopen_exact_authority;
use crate::primary::{
    current_executable_digest, prepare_primary_recoverable_until, AuthorityClient,
    PreReadinessPermit, PreparedPrimary,
};
use crate::protocol::PrepareRequest;

const PREPARE_MAGIC: &[u8; 4] = b"BGP1";
const CLIENT_REFERENCE_MAGIC: &[u8; 4] = b"BGR1";
const CODEC_VERSION: u16 = 1;
const MAX_PATH_BYTES: usize = 32 * 1024;
const MAX_ATTESTATION_BYTES: usize = 32 * 1024;
const MAX_PREPARE_BYTES: usize = 32 * 1024;
const MAX_CHILD_RESULT_BYTES: usize = 64 * 1024;
const CONSTRUCTION_MAGIC: &[u8; 4] = b"BGC1";
const MAX_CONSTRUCTION_BYTES: usize = 64 * 1024;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BrokerPreparePayload {
    pub client_artifact_digest: [u8; 32],
    pub client_source_digest: [u8; 32],
    pub request: PrepareRequest,
}

impl BrokerPreparePayload {
    pub fn encode(&self) -> io::Result<Vec<u8>> {
        if self.client_artifact_digest.iter().all(|byte| *byte == 0)
            || self.client_source_digest.iter().all(|byte| *byte == 0)
            || self.client_artifact_digest == self.client_source_digest
        {
            return Err(invalid_input("broker prepare artifact identity is invalid"));
        }
        let request = self.request.encode()?;
        if request.is_empty() || request.len() > MAX_PREPARE_BYTES {
            return Err(invalid_input("broker prepare request exceeds its bound"));
        }
        let mut output = Vec::with_capacity(74 + request.len());
        output.extend_from_slice(PREPARE_MAGIC);
        output.extend_from_slice(&CODEC_VERSION.to_be_bytes());
        output.extend_from_slice(&self.client_artifact_digest);
        output.extend_from_slice(&self.client_source_digest);
        output.extend_from_slice(&(request.len() as u32).to_be_bytes());
        output.extend_from_slice(&request);
        Ok(output)
    }

    pub fn decode(bytes: &[u8]) -> io::Result<Self> {
        let mut input = bytes;
        if take_array::<4>(&mut input)? != *PREPARE_MAGIC || take_u16(&mut input)? != CODEC_VERSION
        {
            return Err(invalid_data("broker prepare payload header is invalid"));
        }
        let client_artifact_digest = take_array(&mut input)?;
        let client_source_digest = take_array(&mut input)?;
        let length = take_u32(&mut input)? as usize;
        if length == 0 || length > MAX_PREPARE_BYTES || input.len() != length {
            return Err(invalid_data("broker prepare payload length is invalid"));
        }
        let value = Self {
            client_artifact_digest,
            client_source_digest,
            request: PrepareRequest::decode(input)?,
        };
        value
            .encode()
            .map_err(|_| invalid_data("broker prepare payload is malformed"))?;
        Ok(value)
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GuardianClientReference {
    pub runtime_root: PathBuf,
    pub attestation: PreparedAttestation,
}

impl GuardianClientReference {
    pub fn encode(&self) -> io::Result<Vec<u8>> {
        let runtime = self
            .runtime_root
            .to_str()
            .ok_or_else(|| invalid_input("broker runtime root is not utf8"))?
            .as_bytes();
        if !self.runtime_root.is_absolute()
            || runtime.is_empty()
            || runtime.len() > MAX_PATH_BYTES
            || runtime.contains(&0)
        {
            return Err(invalid_input("broker runtime root is malformed"));
        }
        let attestation = self.attestation.encode()?;
        if attestation.is_empty() || attestation.len() > MAX_ATTESTATION_BYTES {
            return Err(invalid_input(
                "broker guardian attestation exceeds its bound",
            ));
        }
        let mut output = Vec::with_capacity(14 + runtime.len() + attestation.len());
        output.extend_from_slice(CLIENT_REFERENCE_MAGIC);
        output.extend_from_slice(&CODEC_VERSION.to_be_bytes());
        output.extend_from_slice(&(runtime.len() as u32).to_be_bytes());
        output.extend_from_slice(runtime);
        output.extend_from_slice(&(attestation.len() as u32).to_be_bytes());
        output.extend_from_slice(&attestation);
        Ok(output)
    }

    pub fn decode(bytes: &[u8]) -> io::Result<Self> {
        let mut input = bytes;
        if take_array::<4>(&mut input)? != *CLIENT_REFERENCE_MAGIC
            || take_u16(&mut input)? != CODEC_VERSION
        {
            return Err(invalid_data("broker guardian reference header is invalid"));
        }
        let runtime_length = take_u32(&mut input)? as usize;
        if runtime_length == 0 || runtime_length > MAX_PATH_BYTES || input.len() < runtime_length {
            return Err(invalid_data("broker runtime root length is invalid"));
        }
        let runtime = std::str::from_utf8(&input[..runtime_length])
            .map_err(|_| invalid_data("broker runtime root is not utf8"))?;
        input = &input[runtime_length..];
        let attestation_length = take_u32(&mut input)? as usize;
        if attestation_length == 0
            || attestation_length > MAX_ATTESTATION_BYTES
            || input.len() != attestation_length
        {
            return Err(invalid_data(
                "broker guardian attestation length is invalid",
            ));
        }
        let value = Self {
            runtime_root: PathBuf::from(runtime),
            attestation: PreparedAttestation::decode(input)?,
        };
        value
            .encode()
            .map_err(|_| invalid_data("broker guardian reference is malformed"))?;
        Ok(value)
    }

    pub fn request_capability(&self) -> io::Result<[u8; 32]> {
        broker_request_capability(&self.encode()?)
    }

    fn validate_lease(&self, lease: &BrokerLease) -> io::Result<()> {
        if self.attestation.scope_id != lease.scope_id
            || self.attestation.identity != lease.guardian
            || self.request_capability()? != lease.request_capability
        {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "broker guardian reference differs from the durable lease",
            ));
        }
        Ok(())
    }

    fn client(&self) -> io::Result<AuthorityClient> {
        AuthorityClient::new(&self.runtime_root, self.attestation.clone())
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BrokerClientReference {
    pub guardian: GuardianClientReference,
    pub broker_install_id: [u8; 32],
    pub broker_key_id: [u8; 32],
    pub lease_token: [u8; 32],
    pub cgroup: CgroupLeafIdentity,
}

impl BrokerClientReference {
    pub fn encode(&self) -> io::Result<Vec<u8>> {
        for bytes in [
            self.broker_install_id.as_slice(),
            self.broker_key_id.as_slice(),
            self.lease_token.as_slice(),
        ] {
            if bytes.iter().all(|byte| *byte == 0) {
                return Err(invalid_input("broker client reference identity is zero"));
            }
        }
        self.cgroup.validate()?;
        BrokerClientReferenceWire {
            guardian_reference: self.guardian.encode()?,
            broker_install_id: self.broker_install_id,
            broker_key_id: self.broker_key_id,
            lease_token: self.lease_token,
            cgroup_device: self.cgroup.device,
            cgroup_inode: self.cgroup.inode,
        }
        .encode()
    }

    pub fn decode(bytes: &[u8]) -> io::Result<Self> {
        let wire = BrokerClientReferenceWire::decode(bytes)?;
        let value = Self {
            guardian: GuardianClientReference::decode(&wire.guardian_reference)?,
            broker_install_id: wire.broker_install_id,
            broker_key_id: wire.broker_key_id,
            lease_token: wire.lease_token,
            cgroup: CgroupLeafIdentity {
                device: wire.cgroup_device,
                inode: wire.cgroup_inode,
            },
        };
        value
            .encode()
            .map_err(|_| invalid_data("broker client reference is malformed"))?;
        Ok(value)
    }

    pub fn request_capability(&self) -> io::Result<[u8; 32]> {
        self.guardian.request_capability()
    }
}

pub struct PrimaryGuardianAuthority {
    broker_artifact_digest: [u8; 32],
    construction_root: PathBuf,
}

impl PrimaryGuardianAuthority {
    pub fn new(state_root: &Path) -> io::Result<Self> {
        if !state_root.is_absolute() {
            return Err(invalid_input(
                "broker construction state root is not absolute",
            ));
        }
        let construction_root = state_root.join("guardian-construction");
        match fs::create_dir(&construction_root) {
            Ok(()) => {}
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
            Err(error) => return Err(error),
        }
        #[cfg(target_os = "linux")]
        {
            use std::os::unix::fs::{MetadataExt, PermissionsExt};
            fs::set_permissions(&construction_root, fs::Permissions::from_mode(0o700))?;
            let metadata = fs::symlink_metadata(&construction_root)?;
            if metadata.file_type().is_symlink()
                || !metadata.is_dir()
                || metadata.uid() != 0
                || metadata.mode() & 0o7777 != 0o700
            {
                return Err(io::Error::new(
                    io::ErrorKind::PermissionDenied,
                    "broker guardian construction root is not root-owned mode 0700",
                ));
            }
        }
        Ok(Self {
            broker_artifact_digest: current_executable_digest()?,
            construction_root: fs::canonicalize(construction_root)?,
        })
    }

    fn construction_path(&self, recovery_id: &[u8; 32]) -> PathBuf {
        self.construction_root.join(format!(
            "{}.guardian",
            crate::broker_install::hex(recovery_id)
        ))
    }

    fn begin_construction(&self, recovery_id: [u8; 32]) -> io::Result<File> {
        let path = self.construction_path(&recovery_id);
        let mut options = OpenOptions::new();
        options.read(true).write(true).create_new(true);
        #[cfg(target_os = "linux")]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options
                .mode(0o600)
                .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC);
        }
        let mut file = options.open(path)?;
        write_construction_record(&mut file, recovery_id, None)?;
        Ok(file)
    }

    fn read_construction(&self, recovery_id: [u8; 32]) -> io::Result<Option<Vec<u8>>> {
        let mut options = OpenOptions::new();
        options.read(true);
        #[cfg(target_os = "linux")]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC);
        }
        let mut file = options.open(self.construction_path(&recovery_id))?;
        read_construction_record(&mut file, recovery_id)
    }

    fn remove_construction(&self, recovery_id: [u8; 32]) -> io::Result<()> {
        fs::remove_file(self.construction_path(&recovery_id))?;
        File::open(&self.construction_root)?.sync_all()
    }

    fn decode_for_lease(
        &self,
        lease: &BrokerLease,
        client_reference: &[u8],
    ) -> io::Result<GuardianClientReference> {
        let reference = GuardianClientReference::decode(client_reference)?;
        reference.validate_lease(lease)?;
        Ok(reference)
    }
}

impl GuardianAuthority for PrimaryGuardianAuthority {
    fn probe(&self) -> io::Result<()> {
        if self.broker_artifact_digest.iter().all(|byte| *byte == 0) {
            return Err(io::Error::other("broker executable digest is zero"));
        }
        Ok(())
    }

    fn prepare_inert(&self, _caller_uid: u32, _body: &[u8]) -> io::Result<PreparedGuardian> {
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "broker guardian preparation requires exact peer uid and gid",
        ))
    }

    fn prepare_inert_recoverable(
        &self,
        caller_uid: u32,
        caller_gid: u32,
        body: &[u8],
        recovery_id: [u8; 32],
    ) -> io::Result<PreparedGuardian> {
        self.prepare_inert_recoverable_until(
            caller_uid,
            caller_gid,
            body,
            recovery_id,
            AbsoluteMonotonicDeadline::after_ms(30_000)?,
        )
    }

    fn prepare_inert_recoverable_until(
        &self,
        caller_uid: u32,
        caller_gid: u32,
        body: &[u8],
        recovery_id: [u8; 32],
        deadline: AbsoluteMonotonicDeadline,
    ) -> io::Result<PreparedGuardian> {
        deadline.ensure_live()?;
        let payload = BrokerPreparePayload::decode(body)?;
        let construction = self.begin_construction(recovery_id)?;
        let (parent, child) = UnixStream::pair()?;
        let pid = unsafe { libc::fork() };
        if pid < 0 {
            return Err(io::Error::last_os_error());
        }
        if pid == 0 {
            drop(parent);
            let result = prepare_as_caller(
                caller_uid,
                caller_gid,
                payload,
                self.broker_artifact_digest,
                child.as_raw_fd(),
                construction.as_raw_fd(),
                recovery_id,
                deadline,
            );
            unsafe { libc::_exit(if result.is_ok() { 0 } else { 71 }) };
        }
        drop(child);
        let result = read_child_result_until(parent, deadline);
        let status = match wait_worker_until(pid, deadline) {
            Ok(status) => status,
            Err(error) => {
                let _ = kill_worker_until(pid, deadline);
                return Err(error);
            }
        };
        if !libc::WIFEXITED(status) || libc::WEXITSTATUS(status) != 0 {
            return Err(result.err().unwrap_or_else(|| {
                io::Error::other("broker caller-mapped guardian worker failed closed")
            }));
        }
        let reference = GuardianClientReference::decode(&result?)?;
        Ok(PreparedGuardian {
            scope_id: reference.attestation.scope_id,
            preparation_operation_id: reference.attestation.preparation_operation_id.clone(),
            launch_digest: reference.attestation.launch_digest,
            identity: reference.attestation.identity.clone(),
            client_reference: reference.encode()?,
        })
    }

    fn abort_recovery(
        &self,
        recovery: &crate::broker_lease::BrokerRecoveryRecord,
    ) -> io::Result<()> {
        match self.read_construction(recovery.recovery_id)? {
            Some(bytes) => {
                let reference = GuardianClientReference::decode(&bytes)?;
                if let Err(control_error) =
                    reference.client().and_then(|client| client.abort(5_000))
                {
                    match reopen_exact_authority(&reference.attestation.identity) {
                        Ok(authority) => {
                            authority.send_signal(libc::SIGKILL)?;
                            if !authority.wait(5_000)? {
                                return Err(io::Error::new(
                                    io::ErrorKind::TimedOut,
                                    format!(
                                        "broker construction guardian did not exit after exact pidfd kill; control failure: {control_error}"
                                    ),
                                ));
                            }
                        }
                        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
                        Err(error) => {
                            return Err(io::Error::other(format!(
                                "broker construction control failed and exact pidfd recovery was retained: {control_error}; pidfd: {error}"
                            )))
                        }
                    }
                }
                self.remove_construction(recovery.recovery_id)
            }
            None if recovery.scope_id.is_some() => {
                let scope_id = recovery.scope_id.expect("checked");
                let identity = recovery
                    .guardian
                    .clone()
                    .ok_or_else(|| invalid_data("broker recovery guardian identity is absent"))?;
                self.abort_inert(&PreparedGuardian {
                    scope_id,
                    preparation_operation_id: String::from("recovered"),
                    launch_digest: [1; 32],
                    identity,
                    client_reference: recovery.client_reference.clone(),
                })
            }
            None => Err(io::Error::new(
                io::ErrorKind::WouldBlock,
                "broker guardian construction has not durably exposed a control reference",
            )),
        }
    }

    fn finalize_recovery(&self, recovery_id: [u8; 32]) -> io::Result<()> {
        self.remove_construction(recovery_id)
    }

    fn abort_inert(&self, guardian: &PreparedGuardian) -> io::Result<()> {
        let reference = GuardianClientReference::decode(&guardian.client_reference)?;
        if reference.attestation.scope_id != guardian.scope_id
            || reference.attestation.identity != guardian.identity
        {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "provisional guardian reference identity drifted",
            ));
        }
        reference.client()?.abort(5_000)
    }

    fn reopen(&self, lease: &BrokerLease, client_reference: &[u8]) -> io::Result<()> {
        self.decode_for_lease(lease, client_reference)?.client()?;
        Ok(())
    }

    fn activate(&self, lease: &BrokerLease, client_reference: &[u8]) -> io::Result<()> {
        self.decode_for_lease(lease, client_reference)?
            .client()?
            .activate()
    }

    fn activate_until(
        &self,
        lease: &BrokerLease,
        client_reference: &[u8],
        deadline: AbsoluteMonotonicDeadline,
    ) -> io::Result<()> {
        self.decode_for_lease(lease, client_reference)?
            .client()?
            .activate_until(deadline)
    }

    fn inspect_events(
        &self,
        lease: &BrokerLease,
        client_reference: &[u8],
    ) -> io::Result<Option<Vec<GuardianEvent>>> {
        Ok(Some(
            self.decode_for_lease(lease, client_reference)?
                .client()?
                .inspect_events()?,
        ))
    }
}

impl GuardianRuntimeAuthority for PrimaryGuardianAuthority {
    type Runtime = UnixStream;

    fn open_runtime(
        &self,
        lease: &BrokerLease,
        client_reference: &[u8],
    ) -> io::Result<Self::Runtime> {
        Ok(self
            .decode_for_lease(lease, client_reference)?
            .client()?
            .open_runtime()?
            .into_stream())
    }
}

fn prepare_as_caller(
    caller_uid: u32,
    caller_gid: u32,
    payload: BrokerPreparePayload,
    broker_artifact_digest: [u8; 32],
    result_fd: RawFd,
    construction_fd: RawFd,
    recovery_id: [u8; 32],
    deadline: AbsoluteMonotonicDeadline,
) -> io::Result<()> {
    deadline.ensure_live()?;
    close_inherited_descriptors(&[result_fd, construction_fd])?;
    let groups = [caller_gid as libc::gid_t];
    if unsafe { libc::setgroups(1, groups.as_ptr()) } != 0
        || unsafe { libc::setresgid(caller_gid, caller_gid, caller_gid) } != 0
        || unsafe { libc::setresuid(caller_uid, caller_uid, caller_uid) } != 0
    {
        return Err(io::Error::last_os_error());
    }
    if unsafe { libc::geteuid() } != caller_uid || unsafe { libc::getegid() } != caller_gid {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "broker caller uid/gid mapping did not become exact",
        ));
    }
    clear_ambient_environment();
    let runtime_root = payload.request.runtime_root.clone();
    let client_artifact_digest = payload.client_artifact_digest;
    let client_source_digest = payload.client_source_digest;
    let mut construction = unsafe { File::from_raw_fd(construction_fd) };
    let mut persisted_reference = None;
    let mut permit = ConstructionPreReadinessPermit {
        construction: &mut construction,
        recovery_id,
        runtime_root: &runtime_root,
        client_artifact_digest,
        client_source_digest,
        persisted_reference: &mut persisted_reference,
    };
    let mut prepared = prepare_primary_recoverable_until(
        payload.request,
        broker_artifact_digest,
        client_source_digest,
        deadline,
        &mut permit,
    )?;
    prepared.attestation.artifact_digest = client_artifact_digest;
    prepared.attestation.source_digest = client_source_digest;
    prepared.attestation.encode()?;
    let reference = GuardianClientReference {
        runtime_root,
        attestation: prepared.attestation,
    };
    let encoded = reference.encode()?;
    if persisted_reference.as_deref() != Some(encoded.as_slice()) {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "broker guardian result differs from its pre-readiness durable reference",
        ));
    }
    write_child_result_until(result_fd, &encoded, deadline)
}

struct ConstructionPreReadinessPermit<'a> {
    construction: &'a mut File,
    recovery_id: [u8; 32],
    runtime_root: &'a Path,
    client_artifact_digest: [u8; 32],
    client_source_digest: [u8; 32],
    persisted_reference: &'a mut Option<Vec<u8>>,
}

impl PreReadinessPermit for ConstructionPreReadinessPermit<'_> {
    fn commit_and_release(
        &mut self,
        candidate: &PreparedPrimary,
        deadline: AbsoluteMonotonicDeadline,
    ) -> io::Result<()> {
        deadline.ensure_live()?;
        let mut attestation = candidate.attestation.clone();
        attestation.artifact_digest = self.client_artifact_digest;
        attestation.source_digest = self.client_source_digest;
        attestation.encode()?;
        let reference = GuardianClientReference {
            runtime_root: self.runtime_root.to_path_buf(),
            attestation,
        };
        let encoded = reference.encode()?;
        write_construction_record(self.construction, self.recovery_id, Some(&encoded))?;
        deadline.ensure_live()?;
        // Reopen and byte-compare before the primary may transfer identity or emit R.
        if read_construction_record(self.construction, self.recovery_id)?.as_deref()
            != Some(encoded.as_slice())
        {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "broker pre-readiness construction commit did not reopen byte-identically",
            ));
        }
        *self.persisted_reference = Some(encoded);
        Ok(())
    }
}

fn write_construction_record(
    file: &mut File,
    recovery_id: [u8; 32],
    reference: Option<&[u8]>,
) -> io::Result<()> {
    let reference = reference.unwrap_or_default();
    if reference.len() > MAX_CONSTRUCTION_BYTES {
        return Err(invalid_input(
            "broker guardian construction reference exceeds its bound",
        ));
    }
    let mut bytes = Vec::with_capacity(80 + reference.len());
    bytes.extend_from_slice(CONSTRUCTION_MAGIC);
    bytes.extend_from_slice(&CODEC_VERSION.to_be_bytes());
    bytes.extend_from_slice(&recovery_id);
    bytes.push(u8::from(!reference.is_empty()));
    bytes.push(0);
    bytes.extend_from_slice(&(reference.len() as u32).to_be_bytes());
    bytes.extend_from_slice(reference);
    let checksum: [u8; 32] = Sha256::digest(&bytes).into();
    bytes.extend_from_slice(&checksum);
    file.set_len(0)?;
    file.seek(SeekFrom::Start(0))?;
    file.write_all(&bytes)?;
    file.sync_all()
}

fn read_construction_record(file: &mut File, recovery_id: [u8; 32]) -> io::Result<Option<Vec<u8>>> {
    file.seek(SeekFrom::Start(0))?;
    let mut bytes = Vec::new();
    file.take((MAX_CONSTRUCTION_BYTES + 80) as u64)
        .read_to_end(&mut bytes)?;
    if bytes.len() < 76 || bytes.len() > MAX_CONSTRUCTION_BYTES + 76 {
        return Err(invalid_data(
            "broker guardian construction record length is invalid",
        ));
    }
    let checksum_offset = bytes.len() - 32;
    let expected: [u8; 32] = Sha256::digest(&bytes[..checksum_offset]).into();
    if expected.as_slice() != &bytes[checksum_offset..] {
        return Err(invalid_data(
            "broker guardian construction checksum is invalid",
        ));
    }
    let mut input = &bytes[..checksum_offset];
    if take_array::<4>(&mut input)? != *CONSTRUCTION_MAGIC
        || take_u16(&mut input)? != CODEC_VERSION
        || take_array::<32>(&mut input)? != recovery_id
    {
        return Err(invalid_data(
            "broker guardian construction identity is invalid",
        ));
    }
    let complete = match input.first().copied() {
        Some(0) => false,
        Some(1) => true,
        _ => {
            return Err(invalid_data(
                "broker guardian construction phase is invalid",
            ))
        }
    };
    input = &input[1..];
    if input.first().copied() != Some(0) {
        return Err(invalid_data(
            "broker guardian construction reserved byte is nonzero",
        ));
    }
    input = &input[1..];
    let length = take_u32(&mut input)? as usize;
    if length > MAX_CONSTRUCTION_BYTES || input.len() != length || complete != (length > 0) {
        return Err(invalid_data(
            "broker guardian construction payload is malformed",
        ));
    }
    Ok(complete.then(|| input.to_vec()))
}

fn close_inherited_descriptors(keep: &[RawFd]) -> io::Result<()> {
    let mut descriptors = Vec::new();
    for entry in fs::read_dir("/proc/self/fd")? {
        let name: OsString = entry?.file_name();
        if let Some(name) = name.to_str() {
            if let Ok(descriptor) = name.parse::<RawFd>() {
                descriptors.push(descriptor);
            }
        }
    }
    descriptors.sort_unstable();
    descriptors.dedup();
    for descriptor in descriptors {
        if descriptor >= 3 && !keep.contains(&descriptor) {
            unsafe { libc::close(descriptor) };
        }
    }
    for descriptor in keep {
        if *descriptor < 3 || unsafe { libc::fcntl(*descriptor, libc::F_GETFD) } < 0 {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "broker guardian worker lost its exact result descriptor",
            ));
        }
    }
    Ok(())
}

fn clear_ambient_environment() {
    let keys: Vec<OsString> = std::env::vars_os().map(|(key, _)| key).collect();
    for key in keys {
        std::env::remove_var(key);
    }
}

fn write_child_result_until(
    descriptor: RawFd,
    bytes: &[u8],
    deadline: AbsoluteMonotonicDeadline,
) -> io::Result<()> {
    if bytes.is_empty() || bytes.len() > MAX_CHILD_RESULT_BYTES {
        return Err(invalid_input(
            "broker guardian child result exceeds its bound",
        ));
    }
    write_all_fd_until(descriptor, &(bytes.len() as u32).to_be_bytes(), deadline)?;
    write_all_fd_until(descriptor, bytes, deadline)
}

fn read_child_result_until(
    input: UnixStream,
    deadline: AbsoluteMonotonicDeadline,
) -> io::Result<Vec<u8>> {
    let mut length = [0; 4];
    read_exact_fd_until(input.as_raw_fd(), &mut length, deadline)?;
    let length = u32::from_be_bytes(length) as usize;
    if length == 0 || length > MAX_CHILD_RESULT_BYTES {
        return Err(invalid_data(
            "broker guardian child result length is invalid",
        ));
    }
    let mut output = vec![0; length];
    read_exact_fd_until(input.as_raw_fd(), &mut output, deadline)?;
    Ok(output)
}

fn wait_worker_until(pid: libc::pid_t, deadline: AbsoluteMonotonicDeadline) -> io::Result<i32> {
    let pidfd = unsafe { libc::syscall(libc::SYS_pidfd_open, pid, 0) as RawFd };
    if pidfd < 0 {
        return Err(io::Error::last_os_error());
    }
    let result = (|| loop {
        let mut status = 0;
        let waited = unsafe { libc::waitpid(pid, &mut status, libc::WNOHANG) };
        if waited == pid {
            return Ok(status);
        }
        if waited < 0 {
            let error = io::Error::last_os_error();
            if error.kind() == io::ErrorKind::Interrupted {
                continue;
            }
            return Err(error);
        }
        crate::deadline::poll_fd(pidfd, libc::POLLIN, deadline)?;
    })();
    unsafe {
        libc::close(pidfd);
    }
    result
}

fn kill_worker_until(pid: libc::pid_t, deadline: AbsoluteMonotonicDeadline) -> io::Result<()> {
    let pidfd = unsafe { libc::syscall(libc::SYS_pidfd_open, pid, 0) as RawFd };
    if pidfd < 0 {
        let error = io::Error::last_os_error();
        if error.kind() == io::ErrorKind::NotFound {
            return Ok(());
        }
        return Err(error);
    }
    let sent = unsafe {
        libc::syscall(
            libc::SYS_pidfd_send_signal,
            pidfd,
            libc::SIGKILL,
            std::ptr::null::<libc::siginfo_t>(),
            0,
        )
    };
    if sent != 0 && io::Error::last_os_error().kind() != io::ErrorKind::NotFound {
        unsafe {
            libc::close(pidfd);
        }
        return Err(io::Error::last_os_error());
    }
    let result = (|| loop {
        let mut status = 0;
        let waited = unsafe { libc::waitpid(pid, &mut status, libc::WNOHANG) };
        if waited == pid
            || (waited < 0 && io::Error::last_os_error().kind() == io::ErrorKind::NotFound)
        {
            return Ok(());
        }
        if waited < 0 && io::Error::last_os_error().kind() != io::ErrorKind::Interrupted {
            return Err(io::Error::last_os_error());
        }
        crate::deadline::poll_fd(pidfd, libc::POLLIN, deadline)?;
    })();
    unsafe {
        libc::close(pidfd);
    }
    result
}

fn take_u16(input: &mut &[u8]) -> io::Result<u16> {
    Ok(u16::from_be_bytes(take_array(input)?))
}

fn take_u32(input: &mut &[u8]) -> io::Result<u32> {
    Ok(u32::from_be_bytes(take_array(input)?))
}

fn take_array<const N: usize>(input: &mut &[u8]) -> io::Result<[u8; N]> {
    if input.len() < N {
        return Err(io::Error::new(
            io::ErrorKind::UnexpectedEof,
            "broker guardian codec is truncated",
        ));
    }
    let value = input[..N].try_into().expect("length checked");
    *input = &input[N..];
    Ok(value)
}

fn invalid_input(message: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidInput, message)
}

fn invalid_data(message: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message)
}

use std::os::fd::FromRawFd;

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use super::*;
    use crate::authority::AuthorityIdentity;
    use crate::protocol::{LaunchSpec, PROTOCOL_VERSION};

    fn request() -> PrepareRequest {
        PrepareRequest {
            operation_id: "prepare-broker-codec".to_owned(),
            runtime_root: PathBuf::from("/run/user/1000/rasen/linux-authority/runtime"),
            launch: LaunchSpec {
                command: PathBuf::from("/usr/bin/printf"),
                cwd: PathBuf::from("/tmp"),
                args: vec!["hello".to_owned()],
                env: BTreeMap::from([("LANG".to_owned(), "C".to_owned())]),
            },
        }
    }

    fn guardian() -> GuardianClientReference {
        GuardianClientReference {
            runtime_root: request().runtime_root,
            attestation: PreparedAttestation {
                helper_protocol_version: PROTOCOL_VERSION,
                scope_id: [1; 16],
                scope_capability: [2; 32],
                control_capability: [3; 32],
                preparation_operation_id: "prepare-broker-codec".to_owned(),
                launch_digest: [4; 32],
                artifact_digest: [5; 32],
                source_digest: [6; 32],
                identity: AuthorityIdentity {
                    boot_id: "7dc44f16-8f9d-4ad8-a233-44bbd0704848".to_owned(),
                    guardian_pid: 4242,
                    start_ticks: 777,
                    pid_namespace_device: 4,
                    pid_namespace_inode: 99,
                },
            },
        }
    }

    #[test]
    fn broker_prepare_and_reference_codecs_are_closed_and_bounded() {
        let payload = BrokerPreparePayload {
            client_artifact_digest: [7; 32],
            client_source_digest: [8; 32],
            request: request(),
        };
        assert_eq!(
            BrokerPreparePayload::decode(&payload.encode().unwrap()).unwrap(),
            payload
        );
        let mut trailing = payload.encode().unwrap();
        trailing.push(0);
        assert!(BrokerPreparePayload::decode(&trailing).is_err());

        let reference = BrokerClientReference {
            guardian: guardian(),
            broker_install_id: [9; 32],
            broker_key_id: [10; 32],
            lease_token: [11; 32],
            cgroup: CgroupLeafIdentity {
                device: 33,
                inode: 9081726354,
            },
        };
        let encoded = reference.encode().unwrap();
        let shared = BrokerClientReferenceWire {
            guardian_reference: reference.guardian.encode().unwrap(),
            broker_install_id: reference.broker_install_id,
            broker_key_id: reference.broker_key_id,
            lease_token: reference.lease_token,
            cgroup_device: reference.cgroup.device,
            cgroup_inode: reference.cgroup.inode,
        }
        .encode()
        .unwrap();
        assert_eq!(encoded, shared);
        assert_eq!(BrokerClientReference::decode(&encoded).unwrap(), reference);
        assert_ne!(
            reference.request_capability().unwrap(),
            reference.lease_token
        );
        let mut wrong_magic = encoded.clone();
        wrong_magic[..4].copy_from_slice(b"BAD!");
        assert!(BrokerClientReference::decode(&wrong_magic).is_err());
        let mut trailing = encoded;
        trailing.push(0);
        assert!(BrokerClientReference::decode(&trailing).is_err());
        assert!(BrokerClientReference {
            broker_key_id: [0; 32],
            ..reference
        }
        .encode()
        .is_err());
    }
}
