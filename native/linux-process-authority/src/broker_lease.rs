use std::collections::BTreeMap;
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::SystemTime;

use sha2::{Digest, Sha256};

use crate::authority::AuthorityIdentity;
use crate::broker_install::hex;
use crate::broker_protocol::fresh_challenge_nonce;
use crate::broker_protocol::BrokerPublicationBinding;

const LEASE_MAGIC: &[u8; 4] = b"RBL1";
const LEASE_VERSION: u16 = 2;
const RECOVERY_MAGIC: &[u8; 4] = b"RBR1";
const RECOVERY_VERSION: u16 = 3;
const REQUEST_MAGIC: &[u8; 4] = b"RBQ1";
const REQUEST_VERSION: u16 = 1;
const DELIVERY_MAGIC: &[u8; 4] = b"RBD1";
const DELIVERY_VERSION: u16 = 1;
const MAX_LEASE_BYTES: usize = 8 * 1024;
const MAX_RECOVERY_BYTES: usize = 40 * 1024;
const MAX_LEASES: usize = 4096;
pub const MAX_REQUEST_RECORDS: usize = 4096;
pub const MAX_DELIVERY_RECORDS: usize = 64;
pub const MAX_CLEANUP_TOMBSTONES: usize = 1024;

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub struct CgroupLeafIdentity {
    pub device: u64,
    pub inode: u64,
}

impl CgroupLeafIdentity {
    pub fn validate(self) -> io::Result<()> {
        if self.inode == 0 {
            return Err(invalid_input("cgroup leaf inode is zero"));
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd)]
#[repr(u8)]
pub enum LeasePhase {
    Prepared = 1,
    Published = 2,
    ActivationPending = 3,
    Activated = 4,
    RootExited = 5,
    ExactScopeEmpty = 6,
    CleanupComplete = 7,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u8)]
pub enum LeaseTerminal {
    Retained = 0,
    ExactEmpty = 1,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum LeaseTerminalHistory {
    None,
    ClosedJournal(Vec<u8>),
    EventGap,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BrokerLease {
    pub token: [u8; 32],
    pub request_capability: [u8; 32],
    pub scope_id: [u8; 16],
    pub preparation_operation_id: String,
    pub launch_digest: [u8; 32],
    pub caller_uid: u32,
    pub broker_install_id: [u8; 32],
    pub broker_key_id: [u8; 32],
    pub guardian: AuthorityIdentity,
    pub cgroup: CgroupLeafIdentity,
    pub phase: LeasePhase,
    pub terminal: LeaseTerminal,
    pub publication_binding: Option<BrokerPublicationBinding>,
    pub terminal_history: LeaseTerminalHistory,
}

impl BrokerLease {
    pub fn validate(&self) -> io::Result<()> {
        for (label, bytes) in [
            ("lease token", self.token.as_slice()),
            ("request capability", self.request_capability.as_slice()),
            ("scope id", self.scope_id.as_slice()),
            ("broker install id", self.broker_install_id.as_slice()),
            ("broker key id", self.broker_key_id.as_slice()),
        ] {
            if bytes.iter().all(|byte| *byte == 0) {
                return Err(invalid_input(&format!("broker {label} is zero")));
            }
        }
        if self.token == self.request_capability {
            return Err(invalid_input(
                "broker lease token and request capability are conflated",
            ));
        }
        if self.preparation_operation_id.is_empty()
            || self.preparation_operation_id.len() > 128
            || !self.preparation_operation_id.bytes().all(|byte| {
                byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b':' | b'-')
            })
            || self.launch_digest.iter().all(|byte| *byte == 0)
        {
            return Err(invalid_input("broker lease launch identity is malformed"));
        }
        self.guardian.validate()?;
        self.cgroup.validate()?;
        if (self.phase == LeasePhase::Prepared && self.publication_binding.is_some())
            || (matches!(
                self.phase,
                LeasePhase::Published
                    | LeasePhase::ActivationPending
                    | LeasePhase::Activated
                    | LeasePhase::RootExited
            ) && self.publication_binding.is_none())
        {
            return Err(invalid_input(
                "broker lease publication binding is inconsistent with its phase",
            ));
        }
        if let Some(binding) = &self.publication_binding {
            binding.encode()?;
            if binding.generation != self.scope_id
                || binding.preparation_operation_id != self.preparation_operation_id
                || binding.launch_digest != self.launch_digest
            {
                return Err(invalid_input(
                    "broker publication binding differs from the lease guardian",
                ));
            }
        }
        match (self.phase, self.terminal) {
            (
                LeasePhase::ExactScopeEmpty | LeasePhase::CleanupComplete,
                LeaseTerminal::ExactEmpty,
            ) if !matches!(self.terminal_history, LeaseTerminalHistory::None) => Ok(()),
            (_, LeaseTerminal::Retained)
                if !matches!(
                    self.phase,
                    LeasePhase::ExactScopeEmpty | LeasePhase::CleanupComplete
                ) && matches!(self.terminal_history, LeaseTerminalHistory::None) =>
            {
                Ok(())
            }
            _ => Err(invalid_input("broker lease terminal state is inconsistent")),
        }
    }

    pub fn encode(&self) -> io::Result<Vec<u8>> {
        self.validate()?;
        let guardian = self.guardian.encode_standalone()?;
        if guardian.len() > u16::MAX as usize {
            return Err(invalid_input("broker guardian identity exceeds its bound"));
        }
        let mut output = Vec::with_capacity(512);
        output.extend_from_slice(LEASE_MAGIC);
        output.extend_from_slice(&LEASE_VERSION.to_be_bytes());
        output.extend_from_slice(&self.token);
        output.extend_from_slice(&self.request_capability);
        output.extend_from_slice(&self.scope_id);
        output.extend_from_slice(&(self.preparation_operation_id.len() as u16).to_be_bytes());
        output.extend_from_slice(self.preparation_operation_id.as_bytes());
        output.extend_from_slice(&self.launch_digest);
        output.extend_from_slice(&self.caller_uid.to_be_bytes());
        output.extend_from_slice(&self.broker_install_id);
        output.extend_from_slice(&self.broker_key_id);
        output.extend_from_slice(&(guardian.len() as u16).to_be_bytes());
        output.extend_from_slice(&guardian);
        output.extend_from_slice(&self.cgroup.device.to_be_bytes());
        output.extend_from_slice(&self.cgroup.inode.to_be_bytes());
        output.push(self.phase as u8);
        output.push(self.terminal as u8);
        let publication = self
            .publication_binding
            .as_ref()
            .map(BrokerPublicationBinding::encode)
            .transpose()?
            .unwrap_or_default();
        output.extend_from_slice(&(publication.len() as u16).to_be_bytes());
        output.extend_from_slice(&publication);
        match &self.terminal_history {
            LeaseTerminalHistory::None => output.push(0),
            LeaseTerminalHistory::ClosedJournal(journal) => {
                if journal.is_empty() || journal.len() > 4096 {
                    return Err(invalid_input("broker terminal journal exceeds its bound"));
                }
                output.push(1);
                output.extend_from_slice(&(journal.len() as u16).to_be_bytes());
                output.extend_from_slice(journal);
            }
            LeaseTerminalHistory::EventGap => output.push(2),
        }
        let checksum: [u8; 32] = Sha256::digest(&output).into();
        output.extend_from_slice(&checksum);
        if output.len() > MAX_LEASE_BYTES {
            return Err(invalid_input("broker lease record exceeds its bound"));
        }
        Ok(output)
    }

    pub fn decode(bytes: &[u8]) -> io::Result<Self> {
        if bytes.len() < 230 || bytes.len() > MAX_LEASE_BYTES {
            return Err(invalid_data("broker lease record length is invalid"));
        }
        let checksum_offset = bytes.len() - 32;
        let expected: [u8; 32] = Sha256::digest(&bytes[..checksum_offset]).into();
        if !constant_time_eq(&expected, &bytes[checksum_offset..]) {
            return Err(invalid_data("broker lease record checksum is invalid"));
        }
        let mut input = &bytes[..checksum_offset];
        if take_array::<4>(&mut input)? != *LEASE_MAGIC || take_u16(&mut input)? != LEASE_VERSION {
            return Err(invalid_data("broker lease record header is invalid"));
        }
        let token = take_array(&mut input)?;
        let request_capability = take_array(&mut input)?;
        let scope_id = take_array(&mut input)?;
        let operation_length = take_u16(&mut input)? as usize;
        if operation_length == 0 || operation_length > 128 || input.len() < operation_length + 32 {
            return Err(invalid_data("broker lease operation id length is invalid"));
        }
        let preparation_operation_id = std::str::from_utf8(&input[..operation_length])
            .map_err(|_| invalid_data("broker lease operation id is not utf8"))?
            .to_owned();
        input = &input[operation_length..];
        let launch_digest = take_array(&mut input)?;
        let caller_uid = take_u32(&mut input)?;
        let broker_install_id = take_array(&mut input)?;
        let broker_key_id = take_array(&mut input)?;
        let guardian_length = take_u16(&mut input)? as usize;
        if guardian_length == 0 || guardian_length > 256 || input.len() < guardian_length {
            return Err(invalid_data("broker guardian identity length is invalid"));
        }
        let guardian = AuthorityIdentity::decode_standalone(&input[..guardian_length])?;
        input = &input[guardian_length..];
        let cgroup = CgroupLeafIdentity {
            device: take_u64(&mut input)?,
            inode: take_u64(&mut input)?,
        };
        let phase = match take_u8(&mut input)? {
            1 => LeasePhase::Prepared,
            2 => LeasePhase::Published,
            3 => LeasePhase::ActivationPending,
            4 => LeasePhase::Activated,
            5 => LeasePhase::RootExited,
            6 => LeasePhase::ExactScopeEmpty,
            7 => LeasePhase::CleanupComplete,
            _ => return Err(invalid_data("broker lease phase is unsupported")),
        };
        let terminal = match take_u8(&mut input)? {
            0 => LeaseTerminal::Retained,
            1 => LeaseTerminal::ExactEmpty,
            _ => return Err(invalid_data("broker lease terminal state is unsupported")),
        };
        let publication_length = take_u16(&mut input)? as usize;
        if publication_length > 1024 || input.len() < publication_length + 1 {
            return Err(invalid_data("broker publication binding length is invalid"));
        }
        let publication_binding = if publication_length == 0 {
            None
        } else {
            let value = BrokerPublicationBinding::decode(&input[..publication_length])?;
            input = &input[publication_length..];
            Some(value)
        };
        let terminal_history = match take_u8(&mut input)? {
            0 => LeaseTerminalHistory::None,
            1 => {
                let length = take_u16(&mut input)? as usize;
                if length == 0 || length > 4096 || input.len() < length {
                    return Err(invalid_data("broker terminal journal length is invalid"));
                }
                let journal = input[..length].to_vec();
                input = &input[length..];
                LeaseTerminalHistory::ClosedJournal(journal)
            }
            2 => LeaseTerminalHistory::EventGap,
            _ => return Err(invalid_data("broker terminal history is unsupported")),
        };
        if !input.is_empty() {
            return Err(invalid_data(
                "broker lease record has trailing or reserved data",
            ));
        }
        let value = Self {
            token,
            request_capability,
            scope_id,
            preparation_operation_id,
            launch_digest,
            caller_uid,
            broker_install_id,
            broker_key_id,
            guardian,
            cgroup,
            phase,
            terminal,
            publication_binding,
            terminal_history,
        };
        value
            .validate()
            .map_err(|_| invalid_data("broker lease record is malformed"))?;
        Ok(value)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd)]
#[repr(u8)]
pub enum BrokerRecoveryPhase {
    Intent = 1,
    GuardianPrepared = 2,
    LeafCreating = 3,
    LeafPrepared = 4,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BrokerRecoveryRecord {
    pub recovery_id: [u8; 32],
    pub request_id: [u8; 16],
    pub request_digest: [u8; 32],
    pub caller_uid: u32,
    pub broker_install_id: [u8; 32],
    pub broker_key_id: [u8; 32],
    pub phase: BrokerRecoveryPhase,
    pub scope_id: Option<[u8; 16]>,
    pub guardian: Option<AuthorityIdentity>,
    pub client_reference: Vec<u8>,
    pub cgroup: Option<CgroupLeafIdentity>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BrokerRequestRecord {
    pub request_id: [u8; 16],
    pub request_digest: [u8; 32],
    pub caller_uid: u32,
    pub deadline_monotonic_ns: u64,
    pub response_code: Option<u8>,
    pub response_body: Vec<u8>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd)]
#[repr(u8)]
pub enum BrokerPreparationDeliveryPhase {
    Intent = 1,
    Preparing = 2,
    PreparedPendingAck = 3,
    Delivered = 4,
    Reconciled = 5,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BrokerPreparationDeliveryRecord {
    pub delivery_key: [u8; 32],
    pub caller_uid: u32,
    pub preparation_operation_id: String,
    pub prepare_digest: [u8; 32],
    pub launch_digest: [u8; 32],
    pub broker_install_id: [u8; 32],
    pub broker_key_id: [u8; 32],
    pub capability_hash: [u8; 32],
    pub original_deadline_monotonic_ns: u64,
    pub phase: BrokerPreparationDeliveryPhase,
    pub recovery_id: Option<[u8; 32]>,
    pub lease_token: Option<[u8; 32]>,
    pub response_body: Vec<u8>,
    pub reference_digest: Option<[u8; 32]>,
}

impl BrokerPreparationDeliveryRecord {
    pub fn validate(&self) -> io::Result<()> {
        for (label, value) in [
            ("delivery key", self.delivery_key.as_slice()),
            ("prepare digest", self.prepare_digest.as_slice()),
            ("launch digest", self.launch_digest.as_slice()),
            ("broker install id", self.broker_install_id.as_slice()),
            ("broker key id", self.broker_key_id.as_slice()),
            ("capability hash", self.capability_hash.as_slice()),
        ] {
            if value.iter().all(|byte| *byte == 0) {
                return Err(invalid_input(&format!(
                    "broker preparation {label} is zero"
                )));
            }
        }
        if self.broker_install_id == self.broker_key_id
            || self.original_deadline_monotonic_ns == 0
            || self.preparation_operation_id.is_empty()
            || self.preparation_operation_id.len() > 128
            || !self.preparation_operation_id.bytes().all(|byte| {
                byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b':' | b'-')
            })
            || self.response_body.len() > 32 * 1024
            || self
                .recovery_id
                .is_some_and(|value| value.iter().all(|byte| *byte == 0))
            || self
                .lease_token
                .is_some_and(|value| value.iter().all(|byte| *byte == 0))
            || self
                .reference_digest
                .is_some_and(|value| value.iter().all(|byte| *byte == 0))
        {
            return Err(invalid_input(
                "broker preparation delivery identity or bound is malformed",
            ));
        }
        match self.phase {
            BrokerPreparationDeliveryPhase::Intent
                if self.recovery_id.is_none()
                    && self.lease_token.is_none()
                    && self.response_body.is_empty()
                    && self.reference_digest.is_none() =>
            {
                Ok(())
            }
            BrokerPreparationDeliveryPhase::Preparing
                if self.recovery_id.is_some()
                    && self.lease_token.is_none()
                    && self.response_body.is_empty()
                    && self.reference_digest.is_none() =>
            {
                Ok(())
            }
            BrokerPreparationDeliveryPhase::PreparedPendingAck
                if self.recovery_id.is_some()
                    && self.lease_token.is_some()
                    && !self.response_body.is_empty()
                    && self.reference_digest.is_some() =>
            {
                Ok(())
            }
            BrokerPreparationDeliveryPhase::Delivered
                if self.recovery_id.is_some()
                    && self.lease_token.is_some()
                    && self.response_body.is_empty()
                    && self.reference_digest.is_some() =>
            {
                Ok(())
            }
            BrokerPreparationDeliveryPhase::Reconciled
                if self.lease_token.is_none()
                    && self.response_body.is_empty()
                    && self.reference_digest.is_none() =>
            {
                Ok(())
            }
            _ => Err(invalid_input(
                "broker preparation delivery fields differ from durable phase",
            )),
        }
    }

    pub fn encode(&self) -> io::Result<Vec<u8>> {
        self.validate()?;
        let operation = self.preparation_operation_id.as_bytes();
        let mut output = Vec::with_capacity(300 + self.response_body.len());
        output.extend_from_slice(DELIVERY_MAGIC);
        output.extend_from_slice(&DELIVERY_VERSION.to_be_bytes());
        output.extend_from_slice(&self.delivery_key);
        output.extend_from_slice(&self.caller_uid.to_be_bytes());
        output.extend_from_slice(&(operation.len() as u16).to_be_bytes());
        output.extend_from_slice(operation);
        output.extend_from_slice(&self.prepare_digest);
        output.extend_from_slice(&self.launch_digest);
        output.extend_from_slice(&self.broker_install_id);
        output.extend_from_slice(&self.broker_key_id);
        output.extend_from_slice(&self.capability_hash);
        output.extend_from_slice(&self.original_deadline_monotonic_ns.to_be_bytes());
        output.push(self.phase as u8);
        output.extend_from_slice(&[0; 3]);
        output.extend_from_slice(&self.recovery_id.unwrap_or([0; 32]));
        output.extend_from_slice(&self.lease_token.unwrap_or([0; 32]));
        output.extend_from_slice(&(self.response_body.len() as u32).to_be_bytes());
        output.extend_from_slice(&self.response_body);
        output.extend_from_slice(&self.reference_digest.unwrap_or([0; 32]));
        let checksum: [u8; 32] = Sha256::digest(&output).into();
        output.extend_from_slice(&checksum);
        if output.len() > MAX_RECOVERY_BYTES {
            return Err(invalid_input(
                "broker preparation delivery record exceeds its bound",
            ));
        }
        Ok(output)
    }

    pub fn decode(bytes: &[u8]) -> io::Result<Self> {
        if bytes.len() < 347 || bytes.len() > MAX_RECOVERY_BYTES {
            return Err(invalid_data(
                "broker preparation delivery record length is invalid",
            ));
        }
        let checksum_offset = bytes.len() - 32;
        let expected: [u8; 32] = Sha256::digest(&bytes[..checksum_offset]).into();
        if !constant_time_eq(&expected, &bytes[checksum_offset..]) {
            return Err(invalid_data(
                "broker preparation delivery checksum is invalid",
            ));
        }
        let mut input = &bytes[..checksum_offset];
        if take_array::<4>(&mut input)? != *DELIVERY_MAGIC
            || take_u16(&mut input)? != DELIVERY_VERSION
        {
            return Err(invalid_data(
                "broker preparation delivery header is invalid",
            ));
        }
        let delivery_key = take_array(&mut input)?;
        let caller_uid = take_u32(&mut input)?;
        let operation_length = take_u16(&mut input)? as usize;
        if operation_length == 0 || operation_length > 128 || input.len() < operation_length {
            return Err(invalid_data(
                "broker preparation delivery operation length is invalid",
            ));
        }
        let preparation_operation_id = std::str::from_utf8(&input[..operation_length])
            .map_err(|_| invalid_data("broker preparation delivery operation is not utf8"))?
            .to_owned();
        input = &input[operation_length..];
        let prepare_digest = take_array(&mut input)?;
        let launch_digest = take_array(&mut input)?;
        let broker_install_id = take_array(&mut input)?;
        let broker_key_id = take_array(&mut input)?;
        let capability_hash = take_array(&mut input)?;
        let original_deadline_monotonic_ns = take_u64(&mut input)?;
        let phase = match take_u8(&mut input)? {
            1 => BrokerPreparationDeliveryPhase::Intent,
            2 => BrokerPreparationDeliveryPhase::Preparing,
            3 => BrokerPreparationDeliveryPhase::PreparedPendingAck,
            4 => BrokerPreparationDeliveryPhase::Delivered,
            5 => BrokerPreparationDeliveryPhase::Reconciled,
            _ => {
                return Err(invalid_data(
                    "broker preparation delivery phase is unsupported",
                ))
            }
        };
        if take_array::<3>(&mut input)? != [0; 3] {
            return Err(invalid_data(
                "broker preparation delivery reserved bytes are nonzero",
            ));
        }
        let raw_recovery = take_array::<32>(&mut input)?;
        let recovery_id = (!raw_recovery.iter().all(|byte| *byte == 0)).then_some(raw_recovery);
        let raw_token = take_array::<32>(&mut input)?;
        let lease_token = (!raw_token.iter().all(|byte| *byte == 0)).then_some(raw_token);
        let response_length = take_u32(&mut input)? as usize;
        if response_length > 32 * 1024 || input.len() < response_length + 32 {
            return Err(invalid_data(
                "broker preparation delivery response length is invalid",
            ));
        }
        let response_body = input[..response_length].to_vec();
        input = &input[response_length..];
        let raw_reference_digest = take_array::<32>(&mut input)?;
        let reference_digest =
            (!raw_reference_digest.iter().all(|byte| *byte == 0)).then_some(raw_reference_digest);
        if !input.is_empty() {
            return Err(invalid_data(
                "broker preparation delivery record has trailing data",
            ));
        }
        let value = Self {
            delivery_key,
            caller_uid,
            preparation_operation_id,
            prepare_digest,
            launch_digest,
            broker_install_id,
            broker_key_id,
            capability_hash,
            original_deadline_monotonic_ns,
            phase,
            recovery_id,
            lease_token,
            response_body,
            reference_digest,
        };
        value
            .validate()
            .map_err(|_| invalid_data("broker preparation delivery record is malformed"))?;
        Ok(value)
    }
}

impl BrokerRequestRecord {
    pub fn validate(&self) -> io::Result<()> {
        if self.request_id.iter().all(|byte| *byte == 0)
            || self.request_digest.iter().all(|byte| *byte == 0)
            || self.deadline_monotonic_ns == 0
            || self.response_body.len() > 32 * 1024
            || (self.response_code.is_none() && !self.response_body.is_empty())
            || self.response_code == Some(0)
        {
            return Err(invalid_input("broker request replay record is malformed"));
        }
        Ok(())
    }

    pub fn encode(&self) -> io::Result<Vec<u8>> {
        self.validate()?;
        let mut output = Vec::with_capacity(100 + self.response_body.len());
        output.extend_from_slice(REQUEST_MAGIC);
        output.extend_from_slice(&REQUEST_VERSION.to_be_bytes());
        output.extend_from_slice(&self.request_id);
        output.extend_from_slice(&self.request_digest);
        output.extend_from_slice(&self.caller_uid.to_be_bytes());
        output.extend_from_slice(&self.deadline_monotonic_ns.to_be_bytes());
        output.push(self.response_code.unwrap_or(0));
        output.extend_from_slice(&[0; 3]);
        output.extend_from_slice(&(self.response_body.len() as u32).to_be_bytes());
        output.extend_from_slice(&self.response_body);
        let checksum: [u8; 32] = Sha256::digest(&output).into();
        output.extend_from_slice(&checksum);
        Ok(output)
    }

    pub fn decode(bytes: &[u8]) -> io::Result<Self> {
        if bytes.len() < 104 || bytes.len() > 40 * 1024 {
            return Err(invalid_data(
                "broker request replay record length is invalid",
            ));
        }
        let checksum_offset = bytes.len() - 32;
        let expected: [u8; 32] = Sha256::digest(&bytes[..checksum_offset]).into();
        if !constant_time_eq(&expected, &bytes[checksum_offset..]) {
            return Err(invalid_data("broker request replay checksum is invalid"));
        }
        let mut input = &bytes[..checksum_offset];
        if take_array::<4>(&mut input)? != *REQUEST_MAGIC
            || take_u16(&mut input)? != REQUEST_VERSION
        {
            return Err(invalid_data("broker request replay header is invalid"));
        }
        let request_id = take_array(&mut input)?;
        let request_digest = take_array(&mut input)?;
        let caller_uid = take_u32(&mut input)?;
        let deadline_monotonic_ns = take_u64(&mut input)?;
        let code = take_u8(&mut input)?;
        if take_array::<3>(&mut input)? != [0; 3] {
            return Err(invalid_data(
                "broker request replay reserved bytes are nonzero",
            ));
        }
        let body_length = take_u32(&mut input)? as usize;
        if body_length > 32 * 1024 || input.len() != body_length {
            return Err(invalid_data("broker request replay body length is invalid"));
        }
        let value = Self {
            request_id,
            request_digest,
            caller_uid,
            deadline_monotonic_ns,
            response_code: (code != 0).then_some(code),
            response_body: input.to_vec(),
        };
        value
            .validate()
            .map_err(|_| invalid_data("broker request replay record is malformed"))?;
        Ok(value)
    }
}

impl BrokerRecoveryRecord {
    pub fn validate(&self) -> io::Result<()> {
        for (label, bytes) in [
            ("recovery id", self.recovery_id.as_slice()),
            ("request id", self.request_id.as_slice()),
            ("request digest", self.request_digest.as_slice()),
            ("broker install id", self.broker_install_id.as_slice()),
            ("broker key id", self.broker_key_id.as_slice()),
        ] {
            if bytes.iter().all(|byte| *byte == 0) {
                return Err(invalid_input(&format!("broker {label} is zero")));
            }
        }
        if self.broker_install_id == self.broker_key_id || self.client_reference.len() > 32 * 1024 {
            return Err(invalid_input(
                "broker recovery identity is conflated or exceeds its bound",
            ));
        }
        if self
            .scope_id
            .is_some_and(|scope_id| scope_id.iter().all(|byte| *byte == 0))
        {
            return Err(invalid_input("broker recovery scope id is zero"));
        }
        if let Some(guardian) = &self.guardian {
            guardian.validate()?;
        }
        if let Some(cgroup) = self.cgroup {
            cgroup.validate()?;
        }
        match self.phase {
            BrokerRecoveryPhase::Intent
                if self.scope_id.is_none()
                    && self.guardian.is_none()
                    && self.client_reference.is_empty()
                    && self.cgroup.is_none() =>
            {
                Ok(())
            }
            BrokerRecoveryPhase::GuardianPrepared | BrokerRecoveryPhase::LeafCreating
                if self.scope_id.is_some()
                    && self.guardian.is_some()
                    && !self.client_reference.is_empty()
                    && self.cgroup.is_none() =>
            {
                Ok(())
            }
            BrokerRecoveryPhase::LeafPrepared
                if self.scope_id.is_some()
                    && self.guardian.is_some()
                    && !self.client_reference.is_empty()
                    && self.cgroup.is_some() =>
            {
                Ok(())
            }
            _ => Err(invalid_input(
                "broker recovery fields are inconsistent with their durable phase",
            )),
        }
    }

    pub fn encode(&self) -> io::Result<Vec<u8>> {
        self.validate()?;
        let guardian = match &self.guardian {
            Some(value) => value.encode_standalone()?,
            None => Vec::new(),
        };
        if guardian.len() > u16::MAX as usize {
            return Err(invalid_input("broker recovery guardian exceeds its bound"));
        }
        let mut output = Vec::with_capacity(256 + guardian.len() + self.client_reference.len());
        output.extend_from_slice(RECOVERY_MAGIC);
        output.extend_from_slice(&RECOVERY_VERSION.to_be_bytes());
        output.extend_from_slice(&self.recovery_id);
        output.extend_from_slice(&self.request_id);
        output.extend_from_slice(&self.request_digest);
        output.extend_from_slice(&self.caller_uid.to_be_bytes());
        output.extend_from_slice(&self.broker_install_id);
        output.extend_from_slice(&self.broker_key_id);
        output.push(self.phase as u8);
        output.extend_from_slice(&[0; 3]);
        output.extend_from_slice(&self.scope_id.unwrap_or([0; 16]));
        output.extend_from_slice(&(guardian.len() as u16).to_be_bytes());
        output.extend_from_slice(&guardian);
        output.extend_from_slice(&(self.client_reference.len() as u32).to_be_bytes());
        output.extend_from_slice(&self.client_reference);
        let cgroup = self.cgroup.unwrap_or(CgroupLeafIdentity {
            device: 0,
            inode: 0,
        });
        output.extend_from_slice(&cgroup.device.to_be_bytes());
        output.extend_from_slice(&cgroup.inode.to_be_bytes());
        let checksum: [u8; 32] = Sha256::digest(&output).into();
        output.extend_from_slice(&checksum);
        if output.len() > MAX_RECOVERY_BYTES {
            return Err(invalid_input("broker recovery record exceeds its bound"));
        }
        Ok(output)
    }

    pub fn decode(bytes: &[u8]) -> io::Result<Self> {
        if bytes.len() < 224 || bytes.len() > MAX_RECOVERY_BYTES {
            return Err(invalid_data("broker recovery record length is invalid"));
        }
        let checksum_offset = bytes.len() - 32;
        let expected: [u8; 32] = Sha256::digest(&bytes[..checksum_offset]).into();
        if !constant_time_eq(&expected, &bytes[checksum_offset..]) {
            return Err(invalid_data("broker recovery checksum is invalid"));
        }
        let mut input = &bytes[..checksum_offset];
        if take_array::<4>(&mut input)? != *RECOVERY_MAGIC
            || take_u16(&mut input)? != RECOVERY_VERSION
        {
            return Err(invalid_data("broker recovery header is invalid"));
        }
        let recovery_id = take_array(&mut input)?;
        let request_id = take_array(&mut input)?;
        let request_digest = take_array(&mut input)?;
        let caller_uid = take_u32(&mut input)?;
        let broker_install_id = take_array(&mut input)?;
        let broker_key_id = take_array(&mut input)?;
        let phase = match take_u8(&mut input)? {
            1 => BrokerRecoveryPhase::Intent,
            2 => BrokerRecoveryPhase::GuardianPrepared,
            3 => BrokerRecoveryPhase::LeafCreating,
            4 => BrokerRecoveryPhase::LeafPrepared,
            _ => return Err(invalid_data("broker recovery phase is unsupported")),
        };
        if take_array::<3>(&mut input)? != [0; 3] {
            return Err(invalid_data("broker recovery reserved bytes are nonzero"));
        }
        let raw_scope = take_array::<16>(&mut input)?;
        let scope_id = (!raw_scope.iter().all(|byte| *byte == 0)).then_some(raw_scope);
        let guardian_length = take_u16(&mut input)? as usize;
        if guardian_length > 256 || input.len() < guardian_length {
            return Err(invalid_data("broker recovery guardian length is invalid"));
        }
        let guardian = if guardian_length == 0 {
            None
        } else {
            let value = AuthorityIdentity::decode_standalone(&input[..guardian_length])?;
            input = &input[guardian_length..];
            Some(value)
        };
        let client_length = take_u32(&mut input)? as usize;
        if client_length > 32 * 1024 || input.len() < client_length + 16 {
            return Err(invalid_data(
                "broker recovery client reference length is invalid",
            ));
        }
        let client_reference = input[..client_length].to_vec();
        input = &input[client_length..];
        let raw_cgroup = CgroupLeafIdentity {
            device: take_u64(&mut input)?,
            inode: take_u64(&mut input)?,
        };
        let cgroup = (raw_cgroup.device != 0 || raw_cgroup.inode != 0).then_some(raw_cgroup);
        if !input.is_empty() {
            return Err(invalid_data("broker recovery record has trailing data"));
        }
        let value = Self {
            recovery_id,
            request_id,
            request_digest,
            caller_uid,
            broker_install_id,
            broker_key_id,
            phase,
            scope_id,
            guardian,
            client_reference,
            cgroup,
        };
        value
            .validate()
            .map_err(|_| invalid_data("broker recovery record is malformed"))?;
        Ok(value)
    }
}

pub struct DurableLeaseStore {
    root: PathBuf,
    expected_owner_uid: Option<u32>,
    token_locks: Arc<Mutex<BTreeMap<u8, Arc<Mutex<()>>>>>,
    delivery_locks: Arc<Mutex<BTreeMap<u8, Arc<Mutex<()>>>>>,
    delivery_store_lock: Arc<Mutex<()>>,
}

impl DurableLeaseStore {
    #[cfg(target_os = "linux")]
    pub fn open_root_owned(root: &Path) -> io::Result<Self> {
        Self::open(root, Some(0))
    }

    pub fn open_for_current_owner(root: &Path) -> io::Result<Self> {
        #[cfg(target_os = "linux")]
        let owner = Some(unsafe { libc::geteuid() });
        #[cfg(not(target_os = "linux"))]
        let owner = None;
        Self::open(root, owner)
    }

    fn open(root: &Path, expected_owner_uid: Option<u32>) -> io::Result<Self> {
        if !root.is_absolute() {
            return Err(invalid_input("broker lease-store root is not absolute"));
        }
        validate_store_directory(root, expected_owner_uid)?;
        let store = Self {
            root: fs::canonicalize(root)?,
            expected_owner_uid,
            token_locks: Arc::new(Mutex::new(BTreeMap::new())),
            delivery_locks: Arc::new(Mutex::new(BTreeMap::new())),
            delivery_store_lock: Arc::new(Mutex::new(())),
        };
        store.recover_stale_temps()?;
        store.load_all()?;
        store.load_recoveries()?;
        store.load_requests()?;
        store.load_deliveries()?;
        Ok(store)
    }

    pub fn path_for_token(&self, token: &[u8; 32]) -> PathBuf {
        self.root.join(format!("{}.lease", hex(token)))
    }

    pub fn path_for_recovery(&self, recovery_id: &[u8; 32]) -> PathBuf {
        self.root.join(format!("{}.recovery", hex(recovery_id)))
    }

    pub fn path_for_request(&self, request_id: &[u8; 16]) -> PathBuf {
        self.root.join(format!("{}.request", hex(request_id)))
    }

    pub fn path_for_delivery(&self, delivery_key: &[u8; 32]) -> PathBuf {
        self.root.join(format!("{}.delivery", hex(delivery_key)))
    }

    fn path_for_token_lock(&self, token: &[u8; 32]) -> PathBuf {
        self.root.join(format!(".lock-{:02x}", token[0]))
    }

    fn path_for_delivery_lock(&self, delivery_key: &[u8; 32]) -> PathBuf {
        self.root
            .join(format!(".delivery-lock-{:02x}", delivery_key[0]))
    }

    fn path_for_delivery_store_lock(&self) -> PathBuf {
        self.root.join(".delivery-store.lock")
    }

    fn with_delivery_store_lock<T>(
        &self,
        operation: impl FnOnce() -> io::Result<T>,
    ) -> io::Result<T> {
        let _process = self
            .delivery_store_lock
            .lock()
            .expect("broker delivery-store lock");
        let path = self.path_for_delivery_store_lock();
        let mut options = OpenOptions::new();
        options.read(true).write(true).create(true);
        #[cfg(target_os = "linux")]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options
                .mode(0o600)
                .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC);
        }
        let lock_file = options.open(&path)?;
        validate_lease_file_shape(&path, self.expected_owner_uid)?;
        #[cfg(not(target_os = "linux"))]
        let _ = &lock_file;
        #[cfg(target_os = "linux")]
        if unsafe { libc::flock(std::os::fd::AsRawFd::as_raw_fd(&lock_file), libc::LOCK_EX) } != 0 {
            return Err(io::Error::last_os_error());
        }
        let result = operation();
        #[cfg(target_os = "linux")]
        if unsafe { libc::flock(std::os::fd::AsRawFd::as_raw_fd(&lock_file), libc::LOCK_UN) } != 0
            && result.is_ok()
        {
            return Err(io::Error::last_os_error());
        }
        result
    }

    /// Serializes the stable delivery identity.  Callers that also need a lease
    /// token lock must acquire this lock first.
    pub fn with_delivery_lock<T>(
        &self,
        delivery_key: &[u8; 32],
        operation: impl FnOnce() -> io::Result<T>,
    ) -> io::Result<T> {
        if delivery_key.iter().all(|byte| *byte == 0) {
            return Err(invalid_input("broker delivery lock identity is zero"));
        }
        let process_lock = self
            .delivery_locks
            .lock()
            .expect("broker delivery-lock registry")
            .entry(delivery_key[0])
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone();
        let _process = process_lock.lock().expect("broker delivery lock");
        let path = self.path_for_delivery_lock(delivery_key);
        let mut options = OpenOptions::new();
        options.read(true).write(true).create(true);
        #[cfg(target_os = "linux")]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options
                .mode(0o600)
                .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC);
        }
        let lock_file = options.open(&path)?;
        validate_lease_file_shape(&path, self.expected_owner_uid)?;
        #[cfg(not(target_os = "linux"))]
        let _ = &lock_file;
        #[cfg(target_os = "linux")]
        if unsafe { libc::flock(std::os::fd::AsRawFd::as_raw_fd(&lock_file), libc::LOCK_EX) } != 0 {
            return Err(io::Error::last_os_error());
        }
        let result = operation();
        #[cfg(target_os = "linux")]
        if unsafe { libc::flock(std::os::fd::AsRawFd::as_raw_fd(&lock_file), libc::LOCK_UN) } != 0
            && result.is_ok()
        {
            return Err(io::Error::last_os_error());
        }
        result
    }

    pub fn with_token_lock<T>(
        &self,
        token: &[u8; 32],
        operation: impl FnOnce() -> io::Result<T>,
    ) -> io::Result<T> {
        if token.iter().all(|byte| *byte == 0) {
            return Err(invalid_input("broker token lock identity is zero"));
        }
        let process_lock = self
            .token_locks
            .lock()
            .expect("broker token-lock registry")
            .entry(token[0])
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone();
        let _process = process_lock.lock().expect("broker token lock");
        let path = self.path_for_token_lock(token);
        let mut options = OpenOptions::new();
        options.read(true).write(true).create(true);
        #[cfg(target_os = "linux")]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options
                .mode(0o600)
                .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC);
        }
        let lock_file = options.open(&path)?;
        validate_lease_file_shape(&path, self.expected_owner_uid)?;
        #[cfg(not(target_os = "linux"))]
        let _ = &lock_file;
        #[cfg(target_os = "linux")]
        if unsafe { libc::flock(std::os::fd::AsRawFd::as_raw_fd(&lock_file), libc::LOCK_EX) } != 0 {
            return Err(io::Error::last_os_error());
        }
        let result = operation();
        #[cfg(target_os = "linux")]
        if unsafe { libc::flock(std::os::fd::AsRawFd::as_raw_fd(&lock_file), libc::LOCK_UN) } != 0
            && result.is_ok()
        {
            return Err(io::Error::last_os_error());
        }
        result
    }

    pub fn put_request(&self, request: &BrokerRequestRecord) -> io::Result<()> {
        let path = self.path_for_request(&request.request_id);
        match self.read_request_path(&path) {
            Ok(existing) if existing == *request => Ok(()),
            Ok(_) => Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "broker request id already binds different replay state",
            )),
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                if self.load_requests()?.len() >= MAX_REQUEST_RECORDS {
                    self.prune_completed_requests(MAX_REQUEST_RECORDS - 1)?;
                    if self.load_requests()?.len() >= MAX_REQUEST_RECORDS {
                        return Err(io::Error::new(
                            io::ErrorKind::OutOfMemory,
                            "broker request replay store has no safely prunable capacity",
                        ));
                    }
                }
                self.write_atomic(&path, &request.encode()?, false)
            }
            Err(error) => Err(error),
        }
    }

    pub fn complete_request(
        &self,
        pending: &BrokerRequestRecord,
        response_code: u8,
        response_body: Vec<u8>,
    ) -> io::Result<BrokerRequestRecord> {
        if pending.response_code.is_some() || !pending.response_body.is_empty() {
            return Err(invalid_input("broker request is already complete"));
        }
        let complete = BrokerRequestRecord {
            response_code: Some(response_code),
            response_body,
            ..pending.clone()
        };
        complete.validate()?;
        let path = self.path_for_request(&pending.request_id);
        if self.read_request_path(&path)? != *pending {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "broker request replay changed before completion",
            ));
        }
        self.write_atomic(&path, &complete.encode()?, true)?;
        Ok(complete)
    }

    pub fn get_request(&self, request_id: &[u8; 16]) -> io::Result<Option<BrokerRequestRecord>> {
        match self.read_request_path(&self.path_for_request(request_id)) {
            Ok(value) => Ok(Some(value)),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(error),
        }
    }

    pub fn load_requests(&self) -> io::Result<Vec<BrokerRequestRecord>> {
        validate_store_directory(&self.root, self.expected_owner_uid)?;
        let mut output = Vec::new();
        for entry in fs::read_dir(&self.root)? {
            let entry = entry?;
            let name = entry
                .file_name()
                .into_string()
                .map_err(|_| invalid_data("broker lease-store entry is not utf8"))?;
            if valid_lease_name(&name)
                || valid_recovery_name(&name)
                || valid_delivery_name(&name)
                || valid_lock_name(&name)
                || valid_delivery_lock_name(&name)
                || valid_delivery_store_lock_name(&name)
            {
                continue;
            }
            if !valid_request_name(&name) {
                return Err(invalid_data("broker lease-store contains an unknown entry"));
            }
            output.push(self.read_request_path(&entry.path())?);
            if output.len() > MAX_REQUEST_RECORDS {
                return Err(invalid_data(
                    "broker request replay store exceeds its record bound",
                ));
            }
        }
        output.sort_by_key(|request| request.request_id);
        Ok(output)
    }

    pub fn prune_completed_requests(&self, retain: usize) -> io::Result<usize> {
        if retain == 0 || retain > MAX_REQUEST_RECORDS {
            return Err(invalid_input(
                "broker request replay retention bound is invalid",
            ));
        }
        let mut completed: Vec<(SystemTime, BrokerRequestRecord)> = self
            .load_requests()?
            .into_iter()
            .filter(|request| request.response_code.is_some())
            .map(|request| {
                let path = self.path_for_request(&request.request_id);
                validate_lease_file(&path, self.expected_owner_uid)?;
                Ok((fs::metadata(path)?.modified()?, request))
            })
            .collect::<io::Result<_>>()?;
        if completed.len() <= retain {
            return Ok(0);
        }
        completed.sort_by(|left, right| {
            left.0
                .cmp(&right.0)
                .then_with(|| left.1.request_id.cmp(&right.1.request_id))
        });
        let remove = completed.len() - retain;
        for (_, request) in completed.into_iter().take(remove) {
            let path = self.path_for_request(&request.request_id);
            if self.read_request_path(&path)? != request || request.response_code.is_none() {
                return Err(io::Error::new(
                    io::ErrorKind::PermissionDenied,
                    "broker request replay changed before bounded pruning",
                ));
            }
            fs::remove_file(path)?;
        }
        sync_directory(&self.root)?;
        Ok(remove)
    }

    pub fn put_delivery(&self, delivery: &BrokerPreparationDeliveryRecord) -> io::Result<()> {
        self.with_delivery_store_lock(|| self.put_delivery_unlocked(delivery))
    }

    fn put_delivery_unlocked(&self, delivery: &BrokerPreparationDeliveryRecord) -> io::Result<()> {
        let destination = self.path_for_delivery(&delivery.delivery_key);
        match self.read_delivery_path(&destination) {
            Ok(existing) if existing == *delivery => return Ok(()),
            Ok(_) => {
                return Err(io::Error::new(
                    io::ErrorKind::AlreadyExists,
                    "broker delivery key already binds different preparation",
                ))
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(error),
        }
        if self.load_deliveries()?.len() >= MAX_DELIVERY_RECORDS {
            self.prune_reconciled_deliveries_unlocked(MAX_DELIVERY_RECORDS - 1)?;
        }
        if self.load_deliveries()?.len() >= MAX_DELIVERY_RECORDS {
            return Err(io::Error::new(
                io::ErrorKind::OutOfMemory,
                "broker delivery store has no safely prunable capacity",
            ));
        }
        match self.write_atomic(&destination, &delivery.encode()?, false) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
                match self.read_delivery_path(&destination) {
                    Ok(existing) if existing == *delivery => Ok(()),
                    Ok(_) => Err(io::Error::new(
                        io::ErrorKind::AlreadyExists,
                        "broker delivery key already binds different preparation",
                    )),
                    Err(read_error) => Err(read_error),
                }
            }
            Err(error) => Err(error),
        }
    }

    pub fn replace_delivery(
        &self,
        expected: &BrokerPreparationDeliveryRecord,
        next: &BrokerPreparationDeliveryRecord,
    ) -> io::Result<()> {
        self.with_delivery_store_lock(|| self.replace_delivery_unlocked(expected, next))
    }

    fn replace_delivery_unlocked(
        &self,
        expected: &BrokerPreparationDeliveryRecord,
        next: &BrokerPreparationDeliveryRecord,
    ) -> io::Result<()> {
        expected.validate()?;
        next.validate()?;
        if !same_delivery_identity(expected, next) || !valid_delivery_transition(expected, next) {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "broker delivery replacement changes identity or phase out of order",
            ));
        }
        let destination = self.path_for_delivery(&expected.delivery_key);
        if self.read_delivery_path(&destination)? != *expected {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "broker delivery changed before atomic replacement",
            ));
        }
        self.write_atomic(&destination, &next.encode()?, true)
    }

    pub fn get_delivery(
        &self,
        delivery_key: &[u8; 32],
    ) -> io::Result<Option<BrokerPreparationDeliveryRecord>> {
        match self.read_delivery_path(&self.path_for_delivery(delivery_key)) {
            Ok(value) => Ok(Some(value)),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(error),
        }
    }

    pub fn load_deliveries(&self) -> io::Result<Vec<BrokerPreparationDeliveryRecord>> {
        validate_store_directory(&self.root, self.expected_owner_uid)?;
        let mut output = Vec::new();
        for entry in fs::read_dir(&self.root)? {
            let entry = entry?;
            let name = entry
                .file_name()
                .into_string()
                .map_err(|_| invalid_data("broker lease-store entry is not utf8"))?;
            if valid_lease_name(&name)
                || valid_recovery_name(&name)
                || valid_request_name(&name)
                || valid_lock_name(&name)
                || valid_delivery_lock_name(&name)
                || valid_delivery_store_lock_name(&name)
            {
                continue;
            }
            if !valid_delivery_name(&name) {
                return Err(invalid_data("broker lease-store contains an unknown entry"));
            }
            output.push(self.read_delivery_path(&entry.path())?);
            if output.len() > MAX_DELIVERY_RECORDS {
                return Err(invalid_data(
                    "broker preparation delivery store exceeds its record bound",
                ));
            }
        }
        output.sort_by_key(|delivery| delivery.delivery_key);
        Ok(output)
    }

    /// Prunes only delivery records whose exact reconciliation has already
    /// completed. Active phases and a Delivered record are never candidates.
    /// A terminal CleanupComplete lease may remain as the bounded authenticated
    /// lifecycle tombstone; any non-terminal lease or provisional recovery
    /// keeps the operation tombstone pinned.
    pub fn prune_reconciled_deliveries_to_total(&self, retain_total: usize) -> io::Result<usize> {
        if retain_total > MAX_DELIVERY_RECORDS {
            return Err(invalid_input(
                "broker reconciled delivery retention bound is invalid",
            ));
        }
        self.with_delivery_store_lock(|| self.prune_reconciled_deliveries_unlocked(retain_total))
    }

    fn prune_reconciled_deliveries_unlocked(&self, retain_total: usize) -> io::Result<usize> {
        let deliveries = self.load_deliveries()?;
        if deliveries.len() <= retain_total {
            return Ok(0);
        }
        let recoveries = self.load_recoveries()?;
        let leases = self.load_all()?;
        let mut candidates: Vec<(SystemTime, BrokerPreparationDeliveryRecord)> = deliveries
            .into_iter()
            .filter(|delivery| {
                delivery.phase == BrokerPreparationDeliveryPhase::Reconciled
                    && delivery.recovery_id.is_none_or(|recovery_id| {
                        !recoveries
                            .iter()
                            .any(|recovery| recovery.recovery_id == recovery_id)
                    })
                    && !leases.iter().any(|lease| {
                        lease.caller_uid == delivery.caller_uid
                            && lease.preparation_operation_id == delivery.preparation_operation_id
                            && lease.launch_digest == delivery.launch_digest
                            && lease.broker_install_id == delivery.broker_install_id
                            && lease.broker_key_id == delivery.broker_key_id
                            && !(lease.phase == LeasePhase::CleanupComplete
                                && lease.terminal == LeaseTerminal::ExactEmpty
                                && !matches!(lease.terminal_history, LeaseTerminalHistory::None))
                    })
            })
            .map(|delivery| {
                let path = self.path_for_delivery(&delivery.delivery_key);
                validate_lease_file(&path, self.expected_owner_uid)?;
                Ok((fs::metadata(path)?.modified()?, delivery))
            })
            .collect::<io::Result<_>>()?;
        candidates.sort_by(|left, right| {
            left.0
                .cmp(&right.0)
                .then_with(|| left.1.delivery_key.cmp(&right.1.delivery_key))
        });
        let remove = (self.load_deliveries()?.len() - retain_total).min(candidates.len());
        for (_, delivery) in candidates.into_iter().take(remove) {
            let path = self.path_for_delivery(&delivery.delivery_key);
            if self.read_delivery_path(&path)? != delivery
                || delivery.phase != BrokerPreparationDeliveryPhase::Reconciled
            {
                return Err(io::Error::new(
                    io::ErrorKind::PermissionDenied,
                    "broker reconciled delivery changed before bounded pruning",
                ));
            }
            fs::remove_file(path)?;
        }
        if remove > 0 {
            sync_directory(&self.root)?;
        }
        Ok(remove)
    }

    pub fn delivery_for_token(
        &self,
        token: &[u8; 32],
    ) -> io::Result<Option<BrokerPreparationDeliveryRecord>> {
        if token.iter().all(|byte| *byte == 0) {
            return Err(invalid_input("broker delivery lease token is zero"));
        }
        let mut matching = self
            .load_deliveries()?
            .into_iter()
            .filter(|delivery| delivery.lease_token.as_ref() == Some(token));
        let first = matching.next();
        if matching.next().is_some() {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "broker lease token is owned by multiple preparation deliveries",
            ));
        }
        Ok(first)
    }

    /// Converts the exact pending-or-delivered record into a prunable operation
    /// tombstone only after authenticated terminal lease cleanup has completed.
    pub fn reconcile_terminal_delivery(&self, terminal: &BrokerLease) -> io::Result<bool> {
        terminal.validate()?;
        if terminal.phase != LeasePhase::CleanupComplete
            || terminal.terminal != LeaseTerminal::ExactEmpty
            || matches!(terminal.terminal_history, LeaseTerminalHistory::None)
        {
            return Err(invalid_input(
                "broker terminal delivery reconciliation requires cleanup-complete exact empty",
            ));
        }
        self.with_delivery_store_lock(|| {
            let Some(delivery) = self.delivery_for_token(&terminal.token)? else {
                return Ok(false);
            };
            if !matches!(
                delivery.phase,
                BrokerPreparationDeliveryPhase::PreparedPendingAck
                    | BrokerPreparationDeliveryPhase::Delivered
            ) || delivery.caller_uid != terminal.caller_uid
                || delivery.preparation_operation_id != terminal.preparation_operation_id
                || delivery.launch_digest != terminal.launch_digest
                || delivery.broker_install_id != terminal.broker_install_id
                || delivery.broker_key_id != terminal.broker_key_id
            {
                return Err(io::Error::new(
                    io::ErrorKind::PermissionDenied,
                    "broker terminal lease differs from its pending or delivered preparation",
                ));
            }
            let reconciled = BrokerPreparationDeliveryRecord {
                phase: BrokerPreparationDeliveryPhase::Reconciled,
                lease_token: None,
                response_body: Vec::new(),
                reference_digest: None,
                ..delivery.clone()
            };
            self.replace_delivery_unlocked(&delivery, &reconciled)?;
            Ok(true)
        })
    }

    pub fn clear_authenticated_terminal_state(
        &self,
        broker_install_id: [u8; 32],
        broker_key_id: [u8; 32],
    ) -> io::Result<(usize, usize, usize)> {
        if broker_install_id.iter().all(|byte| *byte == 0)
            || broker_key_id.iter().all(|byte| *byte == 0)
            || broker_install_id == broker_key_id
        {
            return Err(invalid_input(
                "broker uninstall identity is zero or conflated",
            ));
        }
        if !self.load_recoveries()?.is_empty() {
            return Err(io::Error::new(
                io::ErrorKind::WouldBlock,
                "broker uninstall refuses retained recovery state",
            ));
        }
        self.prune_reconciled_deliveries_to_total(0)?;
        if !self.load_deliveries()?.is_empty() {
            return Err(io::Error::new(
                io::ErrorKind::WouldBlock,
                "broker uninstall refuses retained preparation delivery state",
            ));
        }
        let leases = self.load_all()?;
        if leases.iter().any(|lease| {
            lease.broker_install_id != broker_install_id
                || lease.broker_key_id != broker_key_id
                || lease.phase != LeasePhase::CleanupComplete
                || lease.terminal != LeaseTerminal::ExactEmpty
                || matches!(lease.terminal_history, LeaseTerminalHistory::None)
        }) {
            return Err(io::Error::new(
                io::ErrorKind::WouldBlock,
                "broker uninstall refuses retained or unauthenticated lease state",
            ));
        }
        let requests = self.load_requests()?;
        if requests
            .iter()
            .any(|request| request.response_code.is_none())
        {
            return Err(io::Error::new(
                io::ErrorKind::WouldBlock,
                "broker uninstall refuses incomplete request replay state",
            ));
        }

        for lease in &leases {
            let path = self.path_for_token(&lease.token);
            if self.read_path(&path)? != *lease {
                return Err(io::Error::new(
                    io::ErrorKind::PermissionDenied,
                    "broker uninstall lease changed before deletion",
                ));
            }
            fs::remove_file(path)?;
        }
        for request in &requests {
            let path = self.path_for_request(&request.request_id);
            if self.read_request_path(&path)? != *request || request.response_code.is_none() {
                return Err(io::Error::new(
                    io::ErrorKind::PermissionDenied,
                    "broker uninstall request replay changed before deletion",
                ));
            }
            fs::remove_file(path)?;
        }
        let mut removed_locks = 0;
        for entry in fs::read_dir(&self.root)? {
            let entry = entry?;
            let name = entry
                .file_name()
                .into_string()
                .map_err(|_| invalid_data("broker lease-store entry is not utf8"))?;
            if valid_lock_name(&name)
                || valid_delivery_lock_name(&name)
                || valid_delivery_store_lock_name(&name)
            {
                validate_lease_file_shape(&entry.path(), self.expected_owner_uid)?;
                fs::remove_file(entry.path())?;
                removed_locks += 1;
            }
        }
        sync_directory(&self.root)?;
        Ok((leases.len(), requests.len(), removed_locks))
    }

    pub fn put(&self, lease: &BrokerLease) -> io::Result<()> {
        let bytes = lease.encode()?;
        let destination = self.path_for_token(&lease.token);
        match self.read_path(&destination) {
            Ok(existing) if existing == *lease => return Ok(()),
            Ok(_) => {
                return Err(io::Error::new(
                    io::ErrorKind::AlreadyExists,
                    "broker lease token already binds different authority",
                ))
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(error),
        }
        match self.write_atomic(&destination, &bytes, false) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
                match self.read_path(&destination) {
                    Ok(existing) if existing == *lease => Ok(()),
                    Ok(_) => Err(io::Error::new(
                        io::ErrorKind::AlreadyExists,
                        "broker lease token already binds different authority",
                    )),
                    Err(read_error) => Err(read_error),
                }
            }
            Err(error) => Err(error),
        }
    }

    pub fn replace(&self, expected: &BrokerLease, next: &BrokerLease) -> io::Result<()> {
        expected.validate()?;
        next.validate()?;
        if expected.token != next.token
            || expected.request_capability != next.request_capability
            || expected.scope_id != next.scope_id
            || expected.preparation_operation_id != next.preparation_operation_id
            || expected.launch_digest != next.launch_digest
            || expected.caller_uid != next.caller_uid
            || expected.broker_install_id != next.broker_install_id
            || expected.broker_key_id != next.broker_key_id
            || expected.guardian != next.guardian
            || expected.cgroup != next.cgroup
            || !valid_transition(expected.phase, next.phase)
            || !valid_publication_transition(expected, next)
        {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "broker lease replacement changes identity or lifecycle out of order",
            ));
        }
        let destination = self.path_for_token(&expected.token);
        if self.read_path(&destination)? != *expected {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "broker lease changed before atomic replacement",
            ));
        }
        self.write_atomic(&destination, &next.encode()?, true)
    }

    pub fn get(&self, token: &[u8; 32]) -> io::Result<Option<BrokerLease>> {
        match self.read_path(&self.path_for_token(token)) {
            Ok(value) => Ok(Some(value)),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(error),
        }
    }

    pub fn load_all(&self) -> io::Result<Vec<BrokerLease>> {
        validate_store_directory(&self.root, self.expected_owner_uid)?;
        let mut output = Vec::new();
        for entry in fs::read_dir(&self.root)? {
            let entry = entry?;
            let name = entry
                .file_name()
                .into_string()
                .map_err(|_| invalid_data("broker lease-store entry is not utf8"))?;
            if valid_recovery_name(&name)
                || valid_request_name(&name)
                || valid_delivery_name(&name)
                || valid_lock_name(&name)
                || valid_delivery_lock_name(&name)
                || valid_delivery_store_lock_name(&name)
            {
                continue;
            }
            if !valid_lease_name(&name) {
                return Err(invalid_data("broker lease-store contains an unknown entry"));
            }
            output.push(self.read_path(&entry.path())?);
            if output.len() > MAX_LEASES {
                return Err(invalid_data("broker lease-store exceeds its record bound"));
            }
        }
        output.sort_by_key(|lease| lease.token);
        Ok(output)
    }

    pub fn put_recovery(&self, recovery: &BrokerRecoveryRecord) -> io::Result<()> {
        let bytes = recovery.encode()?;
        let destination = self.path_for_recovery(&recovery.recovery_id);
        match self.read_recovery_path(&destination) {
            Ok(existing) if existing == *recovery => return Ok(()),
            Ok(_) => {
                return Err(io::Error::new(
                    io::ErrorKind::AlreadyExists,
                    "broker recovery id already binds different authority",
                ))
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(error),
        }
        match self.write_atomic(&destination, &bytes, false) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
                match self.read_recovery_path(&destination) {
                    Ok(existing) if existing == *recovery => Ok(()),
                    Ok(_) => Err(io::Error::new(
                        io::ErrorKind::AlreadyExists,
                        "broker recovery id already binds different authority",
                    )),
                    Err(read_error) => Err(read_error),
                }
            }
            Err(error) => Err(error),
        }
    }

    pub fn replace_recovery(
        &self,
        expected: &BrokerRecoveryRecord,
        next: &BrokerRecoveryRecord,
    ) -> io::Result<()> {
        expected.validate()?;
        next.validate()?;
        if expected.recovery_id != next.recovery_id
            || expected.request_id != next.request_id
            || expected.request_digest != next.request_digest
            || expected.caller_uid != next.caller_uid
            || expected.broker_install_id != next.broker_install_id
            || expected.broker_key_id != next.broker_key_id
            || !valid_recovery_transition(expected, next)
        {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "broker recovery replacement changes identity or phase out of order",
            ));
        }
        let destination = self.path_for_recovery(&expected.recovery_id);
        if self.read_recovery_path(&destination)? != *expected {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "broker recovery changed before atomic replacement",
            ));
        }
        self.write_atomic(&destination, &next.encode()?, true)
    }

    pub fn load_recoveries(&self) -> io::Result<Vec<BrokerRecoveryRecord>> {
        validate_store_directory(&self.root, self.expected_owner_uid)?;
        let mut output = Vec::new();
        for entry in fs::read_dir(&self.root)? {
            let entry = entry?;
            let name = entry
                .file_name()
                .into_string()
                .map_err(|_| invalid_data("broker lease-store entry is not utf8"))?;
            if valid_lease_name(&name)
                || valid_request_name(&name)
                || valid_delivery_name(&name)
                || valid_lock_name(&name)
                || valid_delivery_lock_name(&name)
                || valid_delivery_store_lock_name(&name)
            {
                continue;
            }
            if !valid_recovery_name(&name) {
                return Err(invalid_data("broker lease-store contains an unknown entry"));
            }
            output.push(self.read_recovery_path(&entry.path())?);
            if output.len() > MAX_LEASES {
                return Err(invalid_data(
                    "broker recovery store exceeds its record bound",
                ));
            }
        }
        output.sort_by_key(|recovery| recovery.recovery_id);
        Ok(output)
    }

    pub fn get_recovery(&self, recovery_id: &[u8; 32]) -> io::Result<Option<BrokerRecoveryRecord>> {
        match self.read_recovery_path(&self.path_for_recovery(recovery_id)) {
            Ok(value) => Ok(Some(value)),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(error),
        }
    }

    pub fn remove_recovery(&self, recovery: &BrokerRecoveryRecord) -> io::Result<()> {
        recovery.validate()?;
        let path = self.path_for_recovery(&recovery.recovery_id);
        if self.read_recovery_path(&path)? != *recovery {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "broker recovery changed before deletion",
            ));
        }
        fs::remove_file(path)?;
        sync_directory(&self.root)
    }

    pub fn remove_terminal(&self, terminal: &BrokerLease) -> io::Result<()> {
        terminal.validate()?;
        if terminal.phase != LeasePhase::ExactScopeEmpty
            || terminal.terminal != LeaseTerminal::ExactEmpty
        {
            return Err(invalid_input(
                "broker lease cannot be deleted before exact empty",
            ));
        }
        let path = self.path_for_token(&terminal.token);
        if self.read_path(&path)? != *terminal {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "broker terminal lease changed before deletion",
            ));
        }
        fs::remove_file(path)?;
        sync_directory(&self.root)
    }

    pub fn prune_cleanup_tombstones(&self, retain: usize) -> io::Result<usize> {
        if retain == 0 || retain > MAX_CLEANUP_TOMBSTONES {
            return Err(invalid_input(
                "broker cleanup tombstone retention bound is invalid",
            ));
        }
        let mut tombstones: Vec<(SystemTime, BrokerLease)> = self
            .load_all()?
            .into_iter()
            .filter(|lease| lease.phase == LeasePhase::CleanupComplete)
            .map(|lease| {
                let path = self.path_for_token(&lease.token);
                validate_lease_file(&path, self.expected_owner_uid)?;
                Ok((fs::metadata(path)?.modified()?, lease))
            })
            .collect::<io::Result<_>>()?;
        if tombstones.len() <= retain {
            return Ok(0);
        }
        tombstones.sort_by(|left, right| {
            left.0
                .cmp(&right.0)
                .then_with(|| left.1.token.cmp(&right.1.token))
        });
        let remove = tombstones.len() - retain;
        for (_, tombstone) in tombstones.into_iter().take(remove) {
            let path = self.path_for_token(&tombstone.token);
            if self.read_path(&path)? != tombstone
                || tombstone.phase != LeasePhase::CleanupComplete
                || tombstone.terminal != LeaseTerminal::ExactEmpty
            {
                return Err(io::Error::new(
                    io::ErrorKind::PermissionDenied,
                    "broker cleanup tombstone changed before bounded pruning",
                ));
            }
            fs::remove_file(path)?;
        }
        sync_directory(&self.root)?;
        Ok(remove)
    }

    fn read_path(&self, path: &Path) -> io::Result<BrokerLease> {
        validate_lease_file(path, self.expected_owner_uid)?;
        let bytes = fs::read(path)?;
        BrokerLease::decode(&bytes)
    }

    fn read_recovery_path(&self, path: &Path) -> io::Result<BrokerRecoveryRecord> {
        validate_lease_file(path, self.expected_owner_uid)?;
        let bytes = fs::read(path)?;
        BrokerRecoveryRecord::decode(&bytes)
    }

    fn read_request_path(&self, path: &Path) -> io::Result<BrokerRequestRecord> {
        validate_lease_file(path, self.expected_owner_uid)?;
        BrokerRequestRecord::decode(&fs::read(path)?)
    }

    fn read_delivery_path(&self, path: &Path) -> io::Result<BrokerPreparationDeliveryRecord> {
        validate_lease_file(path, self.expected_owner_uid)?;
        BrokerPreparationDeliveryRecord::decode(&fs::read(path)?)
    }

    fn write_atomic(&self, destination: &Path, bytes: &[u8], replace: bool) -> io::Result<()> {
        validate_store_directory(&self.root, self.expected_owner_uid)?;
        for _ in 0..16 {
            let temp = self
                .root
                .join(format!(".tmp-{}", hex(&fresh_challenge_nonce()?)));
            let mut options = OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(target_os = "linux")]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            let mut file = match options.open(&temp) {
                Ok(file) => file,
                Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
                Err(error) => return Err(error),
            };
            let result = (|| {
                file.write_all(bytes)?;
                file.sync_all()?;
                drop(file);
                if replace {
                    #[cfg(target_os = "windows")]
                    if destination.exists() {
                        // This crate's production store is Linux-only. This branch keeps the
                        // platform-neutral codec/store contract executable on Windows hosts.
                        fs::remove_file(destination)?;
                    }
                    fs::rename(&temp, destination)?;
                } else {
                    // Linking is an atomic no-replace create on the same filesystem. A crash
                    // after this succeeds may leave the temporary name too; startup recovery
                    // validates and removes that alias without losing the durable destination.
                    fs::hard_link(&temp, destination)?;
                    fs::remove_file(&temp)?;
                }
                sync_directory(&self.root)
            })();
            if result.is_err() {
                let _ = fs::remove_file(&temp);
            }
            return result;
        }
        Err(io::Error::new(
            io::ErrorKind::AlreadyExists,
            "broker lease-store could not allocate an atomic temporary file",
        ))
    }

    fn recover_stale_temps(&self) -> io::Result<()> {
        for entry in fs::read_dir(&self.root)? {
            let entry = entry?;
            let name = entry.file_name();
            let Some(name) = name.to_str() else {
                return Err(invalid_data("broker lease-store entry is not utf8"));
            };
            if valid_temp_name(name) {
                validate_lease_file_shape(&entry.path(), self.expected_owner_uid)?;
                fs::remove_file(entry.path())?;
            }
        }
        sync_directory(&self.root)
    }
}

fn valid_transition(before: LeasePhase, after: LeasePhase) -> bool {
    before == after
        || matches!(
            (before, after),
            (LeasePhase::Prepared, LeasePhase::Published)
                | (LeasePhase::Published, LeasePhase::ActivationPending)
                | (LeasePhase::ActivationPending, LeasePhase::Activated)
                | (LeasePhase::Activated, LeasePhase::RootExited)
                | (LeasePhase::Prepared, LeasePhase::ExactScopeEmpty)
                | (LeasePhase::Published, LeasePhase::ExactScopeEmpty)
                | (LeasePhase::ActivationPending, LeasePhase::ExactScopeEmpty)
                | (LeasePhase::Activated, LeasePhase::ExactScopeEmpty)
                | (LeasePhase::RootExited, LeasePhase::ExactScopeEmpty)
                | (LeasePhase::ExactScopeEmpty, LeasePhase::CleanupComplete)
        )
}

fn valid_publication_transition(before: &BrokerLease, after: &BrokerLease) -> bool {
    if before.phase == LeasePhase::Prepared && after.phase == LeasePhase::Published {
        before.publication_binding.is_none() && after.publication_binding.is_some()
    } else {
        before.publication_binding == after.publication_binding
    }
}

fn valid_recovery_transition(before: &BrokerRecoveryRecord, after: &BrokerRecoveryRecord) -> bool {
    match (before.phase, after.phase) {
        (BrokerRecoveryPhase::Intent, BrokerRecoveryPhase::GuardianPrepared) => {
            before.scope_id.is_none()
                && before.guardian.is_none()
                && before.client_reference.is_empty()
                && before.cgroup.is_none()
                && after.scope_id.is_some()
                && after.guardian.is_some()
                && !after.client_reference.is_empty()
                && after.cgroup.is_none()
        }
        (BrokerRecoveryPhase::GuardianPrepared, BrokerRecoveryPhase::LeafPrepared) => false,
        (BrokerRecoveryPhase::GuardianPrepared, BrokerRecoveryPhase::LeafCreating) => {
            before.scope_id == after.scope_id
                && before.guardian == after.guardian
                && before.client_reference == after.client_reference
                && before.cgroup.is_none()
                && after.cgroup.is_none()
        }
        (BrokerRecoveryPhase::LeafCreating, BrokerRecoveryPhase::LeafPrepared) => {
            before.scope_id == after.scope_id
                && before.guardian == after.guardian
                && before.client_reference == after.client_reference
                && before.cgroup.is_none()
                && after.cgroup.is_some()
        }
        _ => before == after,
    }
}

fn same_delivery_identity(
    before: &BrokerPreparationDeliveryRecord,
    after: &BrokerPreparationDeliveryRecord,
) -> bool {
    before.delivery_key == after.delivery_key
        && before.caller_uid == after.caller_uid
        && before.preparation_operation_id == after.preparation_operation_id
        && before.prepare_digest == after.prepare_digest
        && before.launch_digest == after.launch_digest
        && before.broker_install_id == after.broker_install_id
        && before.broker_key_id == after.broker_key_id
        && before.capability_hash == after.capability_hash
        && before.original_deadline_monotonic_ns == after.original_deadline_monotonic_ns
}

fn valid_delivery_transition(
    before: &BrokerPreparationDeliveryRecord,
    after: &BrokerPreparationDeliveryRecord,
) -> bool {
    match (before.phase, after.phase) {
        (BrokerPreparationDeliveryPhase::Intent, BrokerPreparationDeliveryPhase::Preparing) => {
            before.recovery_id.is_none()
                && after.recovery_id.is_some()
                && after.lease_token.is_none()
                && after.response_body.is_empty()
                && after.reference_digest.is_none()
        }
        (
            BrokerPreparationDeliveryPhase::Preparing,
            BrokerPreparationDeliveryPhase::PreparedPendingAck,
        ) => {
            before.recovery_id == after.recovery_id
                && after.lease_token.is_some()
                && !after.response_body.is_empty()
                && after.reference_digest.is_some()
        }
        (
            BrokerPreparationDeliveryPhase::PreparedPendingAck,
            BrokerPreparationDeliveryPhase::Delivered,
        ) => {
            before.recovery_id == after.recovery_id
                && before.lease_token == after.lease_token
                && before.reference_digest == after.reference_digest
                && !before.response_body.is_empty()
                && after.response_body.is_empty()
        }
        (_, BrokerPreparationDeliveryPhase::Reconciled) => {
            after.recovery_id == before.recovery_id
                && after.lease_token.is_none()
                && after.response_body.is_empty()
                && after.reference_digest.is_none()
        }
        _ => before == after,
    }
}

fn valid_lease_name(name: &str) -> bool {
    let Some(token) = name.strip_suffix(".lease") else {
        return false;
    };
    token.len() == 64
        && token
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn valid_recovery_name(name: &str) -> bool {
    let Some(recovery_id) = name.strip_suffix(".recovery") else {
        return false;
    };
    recovery_id.len() == 64
        && recovery_id
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn valid_request_name(name: &str) -> bool {
    let Some(request_id) = name.strip_suffix(".request") else {
        return false;
    };
    request_id.len() == 32
        && request_id
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn valid_delivery_name(name: &str) -> bool {
    let Some(delivery_key) = name.strip_suffix(".delivery") else {
        return false;
    };
    delivery_key.len() == 64
        && delivery_key
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn valid_lock_name(name: &str) -> bool {
    let Some(token) = name.strip_prefix(".lock-") else {
        return false;
    };
    token.len() == 2
        && token
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn valid_delivery_lock_name(name: &str) -> bool {
    let Some(key) = name.strip_prefix(".delivery-lock-") else {
        return false;
    };
    key.len() == 2
        && key
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn valid_delivery_store_lock_name(name: &str) -> bool {
    name == ".delivery-store.lock"
}

fn valid_temp_name(name: &str) -> bool {
    let Some(token) = name.strip_prefix(".tmp-") else {
        return false;
    };
    token.len() == 64
        && token
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn validate_store_directory(path: &Path, expected_uid: Option<u32>) -> io::Result<()> {
    #[cfg(not(target_os = "linux"))]
    let _ = expected_uid;
    let metadata = fs::symlink_metadata(path)?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "broker lease-store root is not a real directory",
        ));
    }
    #[cfg(target_os = "linux")]
    {
        use std::os::unix::fs::MetadataExt;
        if Some(metadata.uid()) != expected_uid || metadata.mode() & 0o7777 != 0o700 {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "broker lease-store root ownership or mode is invalid",
            ));
        }
    }
    Ok(())
}

fn validate_lease_file(path: &Path, expected_uid: Option<u32>) -> io::Result<()> {
    validate_lease_file_shape(path, expected_uid)?;
    let length = fs::metadata(path)?.len() as usize;
    if length == 0 || length > MAX_RECOVERY_BYTES {
        return Err(invalid_data("broker durable record length is invalid"));
    }
    Ok(())
}

fn validate_lease_file_shape(path: &Path, expected_uid: Option<u32>) -> io::Result<()> {
    #[cfg(not(target_os = "linux"))]
    let _ = expected_uid;
    let metadata = fs::symlink_metadata(path)?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "broker lease entry is not a real file",
        ));
    }
    #[cfg(target_os = "linux")]
    {
        use std::os::unix::fs::MetadataExt;
        if Some(metadata.uid()) != expected_uid || metadata.mode() & 0o7777 != 0o600 {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "broker lease entry ownership or mode is invalid",
            ));
        }
    }
    Ok(())
}

fn sync_directory(path: &Path) -> io::Result<()> {
    #[cfg(target_os = "linux")]
    {
        fs::File::open(path)?.sync_all()
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = path;
        Ok(())
    }
}

fn constant_time_eq(expected: &[u8; 32], actual: &[u8]) -> bool {
    actual.len() == expected.len()
        && expected
            .iter()
            .zip(actual)
            .fold(0_u8, |difference, (left, right)| {
                difference | (left ^ right)
            })
            == 0
}

fn take_u8(input: &mut &[u8]) -> io::Result<u8> {
    let value = *input
        .first()
        .ok_or_else(|| io::Error::new(io::ErrorKind::UnexpectedEof, "missing u8"))?;
    *input = &input[1..];
    Ok(value)
}

fn take_u16(input: &mut &[u8]) -> io::Result<u16> {
    Ok(u16::from_be_bytes(take_array(input)?))
}

fn take_u32(input: &mut &[u8]) -> io::Result<u32> {
    Ok(u32::from_be_bytes(take_array(input)?))
}

fn take_u64(input: &mut &[u8]) -> io::Result<u64> {
    Ok(u64::from_be_bytes(take_array(input)?))
}

fn take_array<const N: usize>(input: &mut &[u8]) -> io::Result<[u8; N]> {
    if input.len() < N {
        return Err(io::Error::new(
            io::ErrorKind::UnexpectedEof,
            "broker lease record is truncated",
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
