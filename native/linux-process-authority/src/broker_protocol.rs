use std::io;

use ed25519_dalek::{Signature, Signer, SigningKey, VerifyingKey};
use sha2::{Digest, Sha256};
use zeroize::Zeroize;

pub const BROKER_PROTOCOL_VERSION: u16 = 1;
pub const MAX_BROKER_FRAME_BYTES: usize = 64 * 1024;
pub const MAX_BROKER_TIMEOUT_MS: u32 = 5 * 60 * 1000;
const MAX_BROKER_BODY_BYTES: usize = 32 * 1024;
const FRAME_HEADER_BYTES: usize = 12;
const FRAME_MAGIC: &[u8; 4] = b"RPB1";
const CHALLENGE_DOMAIN: &[u8] = b"rasen-linux-process-authority/broker-challenge/v1\0";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u8)]
pub enum BrokerFrameKind {
    ClientHello = 1,
    BrokerHello = 2,
    Request = 3,
    Response = 4,
    Failure = 5,
}

impl BrokerFrameKind {
    fn decode(value: u8) -> io::Result<Self> {
        match value {
            1 => Ok(Self::ClientHello),
            2 => Ok(Self::BrokerHello),
            3 => Ok(Self::Request),
            4 => Ok(Self::Response),
            5 => Ok(Self::Failure),
            _ => Err(invalid_data("broker frame kind is unsupported")),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BrokerFrame {
    pub kind: BrokerFrameKind,
    pub payload: Vec<u8>,
}

impl BrokerFrame {
    pub fn new(kind: BrokerFrameKind, payload: Vec<u8>) -> io::Result<Self> {
        if payload.len() > MAX_BROKER_FRAME_BYTES {
            return Err(invalid_input("broker frame exceeds its bound"));
        }
        Ok(Self { kind, payload })
    }

    pub fn encode(&self) -> io::Result<Vec<u8>> {
        if self.payload.len() > MAX_BROKER_FRAME_BYTES {
            return Err(invalid_input("broker frame exceeds its bound"));
        }
        let mut output = Vec::with_capacity(FRAME_HEADER_BYTES + self.payload.len());
        output.extend_from_slice(FRAME_MAGIC);
        output.extend_from_slice(&BROKER_PROTOCOL_VERSION.to_be_bytes());
        output.push(self.kind as u8);
        output.push(0);
        output.extend_from_slice(&(self.payload.len() as u32).to_be_bytes());
        output.extend_from_slice(&self.payload);
        Ok(output)
    }

    pub fn decode(bytes: &[u8]) -> io::Result<Self> {
        if bytes.len() < FRAME_HEADER_BYTES || &bytes[..4] != FRAME_MAGIC {
            return Err(invalid_data("broker frame header is malformed"));
        }
        if u16::from_be_bytes([bytes[4], bytes[5]]) != BROKER_PROTOCOL_VERSION {
            return Err(invalid_data("broker protocol version is unsupported"));
        }
        let kind = BrokerFrameKind::decode(bytes[6])?;
        if bytes[7] != 0 {
            return Err(invalid_data("broker frame reserved byte is nonzero"));
        }
        let length = u32::from_be_bytes(bytes[8..12].try_into().expect("fixed header")) as usize;
        if length > MAX_BROKER_FRAME_BYTES || bytes.len() != FRAME_HEADER_BYTES + length {
            return Err(invalid_data("broker frame length is invalid"));
        }
        Ok(Self {
            kind,
            payload: bytes[FRAME_HEADER_BYTES..].to_vec(),
        })
    }

    pub fn read_from(reader: &mut impl io::Read) -> io::Result<Option<Self>> {
        let mut header = [0_u8; FRAME_HEADER_BYTES];
        let mut offset = 0;
        while offset < header.len() {
            let count = reader.read(&mut header[offset..])?;
            if count == 0 {
                if offset == 0 {
                    return Ok(None);
                }
                return Err(io::Error::new(
                    io::ErrorKind::UnexpectedEof,
                    "broker frame header is truncated",
                ));
            }
            offset += count;
        }
        if &header[..4] != FRAME_MAGIC {
            return Err(invalid_data("broker frame header is malformed"));
        }
        let length = u32::from_be_bytes(header[8..12].try_into().expect("fixed header")) as usize;
        if length > MAX_BROKER_FRAME_BYTES {
            return Err(invalid_data("broker frame exceeds its bound"));
        }
        let mut bytes = Vec::with_capacity(FRAME_HEADER_BYTES + length);
        bytes.extend_from_slice(&header);
        bytes.resize(FRAME_HEADER_BYTES + length, 0);
        reader.read_exact(&mut bytes[FRAME_HEADER_BYTES..])?;
        Self::decode(&bytes).map(Some)
    }

    pub fn write_to(&self, writer: &mut impl io::Write) -> io::Result<()> {
        writer.write_all(&self.encode()?)?;
        writer.flush()
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct PeerCredentials {
    pub pid: u32,
    pub uid: u32,
    pub gid: u32,
}

impl PeerCredentials {
    pub fn root_broker(pid: u32) -> Self {
        Self {
            pid,
            uid: 0,
            gid: 0,
        }
    }

    pub fn validate(self) -> io::Result<()> {
        if self.pid == 0 {
            return Err(invalid_input("Unix peer pid is zero"));
        }
        Ok(())
    }

    fn encode_into(self, output: &mut Vec<u8>) -> io::Result<()> {
        self.validate()?;
        output.extend_from_slice(&self.pid.to_be_bytes());
        output.extend_from_slice(&self.uid.to_be_bytes());
        output.extend_from_slice(&self.gid.to_be_bytes());
        Ok(())
    }

    fn decode_from(input: &mut &[u8]) -> io::Result<Self> {
        let value = Self {
            pid: take_u32(input)?,
            uid: take_u32(input)?,
            gid: take_u32(input)?,
        };
        value
            .validate()
            .map_err(|_| invalid_data("Unix peer credentials are malformed"))?;
        Ok(value)
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ClientHello {
    pub nonce: [u8; 32],
    pub claimed_uid: u32,
}

impl ClientHello {
    pub fn new(nonce: [u8; 32], claimed_uid: u32) -> io::Result<Self> {
        if nonce.iter().all(|byte| *byte == 0) {
            return Err(invalid_input("broker challenge nonce is zero"));
        }
        Ok(Self { nonce, claimed_uid })
    }

    pub fn encode(&self) -> io::Result<Vec<u8>> {
        Self::new(self.nonce, self.claimed_uid)?;
        let mut output = Vec::with_capacity(38);
        output.extend_from_slice(&BROKER_PROTOCOL_VERSION.to_be_bytes());
        output.extend_from_slice(&self.nonce);
        output.extend_from_slice(&self.claimed_uid.to_be_bytes());
        Ok(output)
    }

    pub fn decode(bytes: &[u8]) -> io::Result<Self> {
        let mut input = bytes;
        if take_u16(&mut input)? != BROKER_PROTOCOL_VERSION {
            return Err(invalid_data("client hello version is unsupported"));
        }
        let value = Self::new(take_array(&mut input)?, take_u32(&mut input)?)
            .map_err(|_| invalid_data("client hello is malformed"))?;
        require_empty(input, "client hello")?;
        Ok(value)
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BrokerHello {
    pub nonce: [u8; 32],
    pub key_id: [u8; 32],
    pub observed_client: PeerCredentials,
    pub signature: [u8; 64],
}

impl BrokerHello {
    pub fn encode(&self) -> io::Result<Vec<u8>> {
        if self.nonce.iter().all(|byte| *byte == 0) || self.key_id.iter().all(|byte| *byte == 0) {
            return Err(invalid_input("broker hello identity is zero"));
        }
        let mut output = Vec::with_capacity(142);
        output.extend_from_slice(&BROKER_PROTOCOL_VERSION.to_be_bytes());
        output.extend_from_slice(&self.nonce);
        output.extend_from_slice(&self.key_id);
        self.observed_client.encode_into(&mut output)?;
        output.extend_from_slice(&self.signature);
        Ok(output)
    }

    pub fn decode(bytes: &[u8]) -> io::Result<Self> {
        let mut input = bytes;
        if take_u16(&mut input)? != BROKER_PROTOCOL_VERSION {
            return Err(invalid_data("broker hello version is unsupported"));
        }
        let value = Self {
            nonce: take_array(&mut input)?,
            key_id: take_array(&mut input)?,
            observed_client: PeerCredentials::decode_from(&mut input)?,
            signature: take_array(&mut input)?,
        };
        require_empty(input, "broker hello")?;
        value
            .encode()
            .map_err(|_| invalid_data("broker hello is malformed"))?;
        Ok(value)
    }
}

pub struct SigningBrokerIdentity {
    key: SigningKey,
    key_id: [u8; 32],
}

impl SigningBrokerIdentity {
    pub fn from_seed(mut seed: [u8; 32]) -> io::Result<Self> {
        if seed.iter().all(|byte| *byte == 0) {
            seed.zeroize();
            return Err(invalid_input("broker signing seed is zero"));
        }
        let key = SigningKey::from_bytes(&seed);
        seed.zeroize();
        let key_id = key_id(&key.verifying_key().to_bytes());
        Ok(Self { key, key_id })
    }

    pub fn public_key(&self) -> [u8; 32] {
        self.key.verifying_key().to_bytes()
    }

    pub fn key_id(&self) -> [u8; 32] {
        self.key_id
    }

    pub fn answer_challenge(
        &self,
        hello: &ClientHello,
        observed_client: PeerCredentials,
    ) -> io::Result<BrokerHello> {
        hello.encode()?;
        observed_client.validate()?;
        if hello.claimed_uid != observed_client.uid {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "claimed caller uid differs from Unix peer credentials",
            ));
        }
        let signature = self
            .key
            .sign(&challenge_message(hello, observed_client))
            .to_bytes();
        Ok(BrokerHello {
            nonce: hello.nonce,
            key_id: self.key_id,
            observed_client,
            signature,
        })
    }
}

pub struct PinnedBrokerIdentity {
    key: VerifyingKey,
    key_id: [u8; 32],
}

impl PinnedBrokerIdentity {
    pub fn from_public_key(public_key: [u8; 32]) -> io::Result<Self> {
        let key = VerifyingKey::from_bytes(&public_key)
            .map_err(|_| invalid_input("pinned Ed25519 public key is invalid"))?;
        Ok(Self {
            key,
            key_id: key_id(&public_key),
        })
    }

    pub fn key_id(&self) -> [u8; 32] {
        self.key_id
    }

    pub fn verify_challenge(
        &self,
        hello: &ClientHello,
        answer: &BrokerHello,
        expected_client: PeerCredentials,
        broker_peer: PeerCredentials,
    ) -> io::Result<()> {
        self.verify_challenge_for_broker_uid(hello, answer, expected_client, broker_peer, 0)
    }

    pub fn verify_challenge_for_broker_uid(
        &self,
        hello: &ClientHello,
        answer: &BrokerHello,
        expected_client: PeerCredentials,
        broker_peer: PeerCredentials,
        expected_broker_uid: u32,
    ) -> io::Result<()> {
        hello.encode()?;
        expected_client.validate()?;
        broker_peer.validate()?;
        if broker_peer.uid != expected_broker_uid
            || answer.nonce != hello.nonce
            || answer.key_id != self.key_id
            || answer.observed_client != expected_client
            || hello.claimed_uid != expected_client.uid
        {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "broker challenge identity does not match the pinned peer",
            ));
        }
        self.key
            .verify_strict(
                &challenge_message(hello, expected_client),
                &Signature::from_bytes(&answer.signature),
            )
            .map_err(|_| {
                io::Error::new(
                    io::ErrorKind::PermissionDenied,
                    "broker challenge signature is invalid",
                )
            })
    }
}

pub fn fresh_challenge_nonce() -> io::Result<[u8; 32]> {
    let mut nonce = [0_u8; 32];
    getrandom::fill(&mut nonce)
        .map_err(|error| io::Error::other(format!("OS random source failed: {error}")))?;
    if nonce.iter().all(|byte| *byte == 0) {
        return Err(io::Error::other("OS random source returned a zero nonce"));
    }
    Ok(nonce)
}

pub fn broker_request_capability(client_reference: &[u8]) -> io::Result<[u8; 32]> {
    if client_reference.is_empty() || client_reference.len() > MAX_BROKER_BODY_BYTES {
        return Err(invalid_input(
            "broker client reference is empty or exceeds its bound",
        ));
    }
    let mut digest = Sha256::new();
    digest.update(b"rasen-broker-request-capability-v1\0");
    digest.update(client_reference);
    let capability: [u8; 32] = digest.finalize().into();
    if capability.iter().all(|byte| *byte == 0) {
        return Err(io::Error::other(
            "broker client reference derived a zero request capability",
        ));
    }
    Ok(capability)
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BrokerPublicationBinding {
    pub reference_digest: [u8; 32],
    pub preparation_operation_id: String,
    pub generation: [u8; 16],
    pub launch_digest: [u8; 32],
    pub publication_operation_id: String,
}

/// Controller-owned identity and authorization for one prepared-reference delivery.
///
/// The operation id plus authenticated caller/install/key identity form the
/// broker-owned stable index. The prepare and launch digests, original deadline,
/// and independently generated capability are immutable values checked against
/// the indexed record; none may select a second record for the same operation.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PreparationDeliveryBinding {
    pub preparation_operation_id: String,
    pub prepare_digest: [u8; 32],
    pub launch_digest: [u8; 32],
    pub recovery_capability: [u8; 32],
}

impl PreparationDeliveryBinding {
    pub fn for_prepare(
        preparation_operation_id: String,
        launch_digest: [u8; 32],
        recovery_capability: [u8; 32],
        prepare_payload: &[u8],
    ) -> io::Result<Self> {
        if prepare_payload.is_empty() || prepare_payload.len() > MAX_BROKER_BODY_BYTES {
            return Err(invalid_input(
                "broker preparation delivery payload exceeds its bound",
            ));
        }
        let value = Self {
            preparation_operation_id,
            prepare_digest: preparation_payload_digest(prepare_payload),
            launch_digest,
            recovery_capability,
        };
        value.encode()?;
        Ok(value)
    }
    pub fn encode(&self) -> io::Result<Vec<u8>> {
        let operation = bounded_operation(&self.preparation_operation_id)?;
        for (label, value) in [
            ("prepare digest", self.prepare_digest.as_slice()),
            ("launch digest", self.launch_digest.as_slice()),
            ("recovery capability", self.recovery_capability.as_slice()),
        ] {
            if value.iter().all(|byte| *byte == 0) {
                return Err(invalid_input(&format!(
                    "broker preparation delivery {label} is zero"
                )));
            }
        }
        let mut output = Vec::with_capacity(104 + operation.len());
        output.extend_from_slice(b"BDB1");
        output.extend_from_slice(&BROKER_PROTOCOL_VERSION.to_be_bytes());
        output.extend_from_slice(&(operation.len() as u16).to_be_bytes());
        output.extend_from_slice(operation);
        output.extend_from_slice(&self.prepare_digest);
        output.extend_from_slice(&self.launch_digest);
        output.extend_from_slice(&self.recovery_capability);
        Ok(output)
    }

    pub fn decode(bytes: &[u8]) -> io::Result<Self> {
        let mut input = bytes;
        if take_array::<4>(&mut input)? != *b"BDB1"
            || take_u16(&mut input)? != BROKER_PROTOCOL_VERSION
        {
            return Err(invalid_data(
                "broker preparation delivery binding header is invalid",
            ));
        }
        let preparation_operation_id = take_operation(&mut input)?;
        let prepare_digest = take_array(&mut input)?;
        let launch_digest = take_array(&mut input)?;
        let recovery_capability = take_array(&mut input)?;
        if !input.is_empty() {
            return Err(invalid_data(
                "broker preparation delivery binding has trailing data",
            ));
        }
        let value = Self {
            preparation_operation_id,
            prepare_digest,
            launch_digest,
            recovery_capability,
        };
        value
            .encode()
            .map_err(|_| invalid_data("broker preparation delivery binding is malformed"))?;
        Ok(value)
    }

    pub fn delivery_key(
        &self,
        caller_uid: u32,
        broker_install_id: &[u8; 32],
        broker_key_id: &[u8; 32],
    ) -> io::Result<[u8; 32]> {
        self.encode()?;
        if broker_install_id.iter().all(|byte| *byte == 0)
            || broker_key_id.iter().all(|byte| *byte == 0)
            || broker_install_id == broker_key_id
        {
            return Err(invalid_input(
                "broker preparation delivery installation identity is malformed",
            ));
        }
        let operation = self.preparation_operation_id.as_bytes();
        let mut digest = Sha256::new();
        digest.update(b"rasen-broker-prepared-delivery-v1\0");
        digest.update(broker_install_id);
        digest.update(broker_key_id);
        digest.update(caller_uid.to_be_bytes());
        digest.update((operation.len() as u16).to_be_bytes());
        digest.update(operation);
        Ok(digest.finalize().into())
    }

    pub fn capability_hash(&self) -> io::Result<[u8; 32]> {
        self.encode()?;
        let mut digest = Sha256::new();
        digest.update(b"rasen-broker-prepared-delivery-capability-v1\0");
        digest.update(self.recovery_capability);
        Ok(digest.finalize().into())
    }
}

fn preparation_payload_digest(payload: &[u8]) -> [u8; 32] {
    let mut digest = Sha256::new();
    digest.update(b"rasen-broker-prepared-delivery-payload-v1\0");
    digest.update((payload.len() as u32).to_be_bytes());
    digest.update(payload);
    digest.finalize().into()
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PreparationDeliveryRequest {
    pub binding: PreparationDeliveryBinding,
    pub prepare_payload: Vec<u8>,
}

impl PreparationDeliveryRequest {
    pub fn encode(&self) -> io::Result<Vec<u8>> {
        let binding = self.binding.encode()?;
        if binding.len() > u16::MAX as usize
            || self.prepare_payload.is_empty()
            || self.prepare_payload.len() > MAX_BROKER_BODY_BYTES
            || preparation_payload_digest(&self.prepare_payload) != self.binding.prepare_digest
        {
            return Err(invalid_input(
                "broker preparation delivery request binding differs from payload",
            ));
        }
        let mut output = Vec::with_capacity(12 + binding.len() + self.prepare_payload.len());
        output.extend_from_slice(b"BDR1");
        output.extend_from_slice(&BROKER_PROTOCOL_VERSION.to_be_bytes());
        output.extend_from_slice(&(binding.len() as u16).to_be_bytes());
        output.extend_from_slice(&binding);
        output.extend_from_slice(&(self.prepare_payload.len() as u32).to_be_bytes());
        output.extend_from_slice(&self.prepare_payload);
        if output.len() > MAX_BROKER_BODY_BYTES {
            return Err(invalid_input(
                "broker preparation delivery request exceeds its bound",
            ));
        }
        Ok(output)
    }

    pub fn decode(bytes: &[u8]) -> io::Result<Self> {
        let mut input = bytes;
        if take_array::<4>(&mut input)? != *b"BDR1"
            || take_u16(&mut input)? != BROKER_PROTOCOL_VERSION
        {
            return Err(invalid_data(
                "broker preparation delivery request header is invalid",
            ));
        }
        let binding_length = take_u16(&mut input)? as usize;
        if binding_length == 0 || input.len() < binding_length + 4 {
            return Err(invalid_data(
                "broker preparation delivery binding length is invalid",
            ));
        }
        let binding = PreparationDeliveryBinding::decode(&input[..binding_length])?;
        input = &input[binding_length..];
        let payload_length = take_u32(&mut input)? as usize;
        if payload_length == 0
            || payload_length > MAX_BROKER_BODY_BYTES
            || input.len() != payload_length
        {
            return Err(invalid_data(
                "broker preparation delivery payload length is invalid",
            ));
        }
        let value = Self {
            binding,
            prepare_payload: input.to_vec(),
        };
        value.encode().map_err(|_| {
            invalid_data("broker preparation delivery request binding differs from payload")
        })?;
        Ok(value)
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PreparationDeliveryAcknowledgement {
    pub binding: PreparationDeliveryBinding,
    pub reference_digest: [u8; 32],
}

/// Shared closed wire representation for the reference delivered by the
/// broker daemon.  Semantic guardian decoding remains in `broker_guardian`,
/// while delivery persistence can reproduce these exact bytes without a
/// module cycle.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BrokerClientReferenceWire {
    pub guardian_reference: Vec<u8>,
    pub broker_install_id: [u8; 32],
    pub broker_key_id: [u8; 32],
    pub lease_token: [u8; 32],
    pub cgroup_device: u64,
    pub cgroup_inode: u64,
}

impl BrokerClientReferenceWire {
    pub fn encode(&self) -> io::Result<Vec<u8>> {
        if self.guardian_reference.is_empty()
            || self.guardian_reference.len() > MAX_BROKER_BODY_BYTES - 122
            || self.cgroup_inode == 0
            || [
                self.broker_install_id.as_slice(),
                self.broker_key_id.as_slice(),
                self.lease_token.as_slice(),
            ]
            .into_iter()
            .any(|value| value.iter().all(|byte| *byte == 0))
            || self.broker_install_id == self.broker_key_id
        {
            return Err(invalid_input(
                "broker client reference wire identity is malformed",
            ));
        }
        let mut output = Vec::with_capacity(122 + self.guardian_reference.len());
        output.extend_from_slice(b"BCR1");
        output.extend_from_slice(&BROKER_PROTOCOL_VERSION.to_be_bytes());
        output.extend_from_slice(&(self.guardian_reference.len() as u32).to_be_bytes());
        output.extend_from_slice(&self.guardian_reference);
        output.extend_from_slice(&self.broker_install_id);
        output.extend_from_slice(&self.broker_key_id);
        output.extend_from_slice(&self.lease_token);
        output.extend_from_slice(&self.cgroup_device.to_be_bytes());
        output.extend_from_slice(&self.cgroup_inode.to_be_bytes());
        Ok(output)
    }

    pub fn decode(bytes: &[u8]) -> io::Result<Self> {
        let mut input = bytes;
        if take_array::<4>(&mut input)? != *b"BCR1"
            || take_u16(&mut input)? != BROKER_PROTOCOL_VERSION
        {
            return Err(invalid_data(
                "broker client reference wire header is invalid",
            ));
        }
        let guardian_length = take_u32(&mut input)? as usize;
        if guardian_length == 0
            || guardian_length > MAX_BROKER_BODY_BYTES - 122
            || input.len() != guardian_length + 112
        {
            return Err(invalid_data(
                "broker client reference wire length is invalid",
            ));
        }
        let guardian_reference = input[..guardian_length].to_vec();
        input = &input[guardian_length..];
        let value = Self {
            guardian_reference,
            broker_install_id: take_array(&mut input)?,
            broker_key_id: take_array(&mut input)?,
            lease_token: take_array(&mut input)?,
            cgroup_device: take_u64(&mut input)?,
            cgroup_inode: take_u64(&mut input)?,
        };
        if !input.is_empty() {
            return Err(invalid_data(
                "broker client reference wire has trailing data",
            ));
        }
        value
            .encode()
            .map_err(|_| invalid_data("broker client reference wire is malformed"))?;
        Ok(value)
    }
}

impl PreparationDeliveryAcknowledgement {
    pub fn encode(&self) -> io::Result<Vec<u8>> {
        let binding = self.binding.encode()?;
        if binding.len() > u16::MAX as usize || self.reference_digest.iter().all(|byte| *byte == 0)
        {
            return Err(invalid_input(
                "broker preparation delivery acknowledgement is malformed",
            ));
        }
        let mut output = Vec::with_capacity(40 + binding.len());
        output.extend_from_slice(b"BDA1");
        output.extend_from_slice(&BROKER_PROTOCOL_VERSION.to_be_bytes());
        output.extend_from_slice(&(binding.len() as u16).to_be_bytes());
        output.extend_from_slice(&binding);
        output.extend_from_slice(&self.reference_digest);
        Ok(output)
    }

    pub fn decode(bytes: &[u8]) -> io::Result<Self> {
        let mut input = bytes;
        if take_array::<4>(&mut input)? != *b"BDA1"
            || take_u16(&mut input)? != BROKER_PROTOCOL_VERSION
        {
            return Err(invalid_data(
                "broker preparation delivery acknowledgement header is invalid",
            ));
        }
        let binding_length = take_u16(&mut input)? as usize;
        if binding_length == 0 || input.len() != binding_length + 32 {
            return Err(invalid_data(
                "broker preparation delivery acknowledgement length is invalid",
            ));
        }
        let binding = PreparationDeliveryBinding::decode(&input[..binding_length])?;
        input = &input[binding_length..];
        let value = Self {
            binding,
            reference_digest: take_array(&mut input)?,
        };
        value.encode().map_err(|_| {
            invalid_data("broker preparation delivery acknowledgement is malformed")
        })?;
        Ok(value)
    }
}

impl BrokerPublicationBinding {
    pub fn encode(&self) -> io::Result<Vec<u8>> {
        for (label, value) in [
            ("reference digest", self.reference_digest.as_slice()),
            ("generation", self.generation.as_slice()),
            ("launch digest", self.launch_digest.as_slice()),
        ] {
            if value.iter().all(|byte| *byte == 0) {
                return Err(invalid_input(&format!(
                    "broker publication {label} is zero"
                )));
            }
        }
        let preparation = bounded_operation(&self.preparation_operation_id)?;
        let publication = bounded_operation(&self.publication_operation_id)?;
        let mut output = Vec::with_capacity(118 + preparation.len() + publication.len());
        output.extend_from_slice(b"BPB1");
        output.extend_from_slice(&BROKER_PROTOCOL_VERSION.to_be_bytes());
        output.extend_from_slice(&self.reference_digest);
        output.extend_from_slice(&(preparation.len() as u16).to_be_bytes());
        output.extend_from_slice(preparation);
        output.extend_from_slice(&self.generation);
        output.extend_from_slice(&self.launch_digest);
        output.extend_from_slice(&(publication.len() as u16).to_be_bytes());
        output.extend_from_slice(publication);
        Ok(output)
    }

    pub fn decode(bytes: &[u8]) -> io::Result<Self> {
        let mut input = bytes;
        if take_array::<4>(&mut input)? != *b"BPB1"
            || take_u16(&mut input)? != BROKER_PROTOCOL_VERSION
        {
            return Err(invalid_data("broker publication binding header is invalid"));
        }
        let reference_digest = take_array(&mut input)?;
        let preparation_operation_id = take_operation(&mut input)?;
        let generation = take_array(&mut input)?;
        let launch_digest = take_array(&mut input)?;
        let publication_operation_id = take_operation(&mut input)?;
        if !input.is_empty() {
            return Err(invalid_data("broker publication binding has trailing data"));
        }
        let value = Self {
            reference_digest,
            preparation_operation_id,
            generation,
            launch_digest,
            publication_operation_id,
        };
        value
            .encode()
            .map_err(|_| invalid_data("broker publication binding is malformed"))?;
        Ok(value)
    }
}

fn bounded_operation(value: &str) -> io::Result<&[u8]> {
    let bytes = value.as_bytes();
    if bytes.is_empty()
        || bytes.len() > 128
        || !bytes
            .iter()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(*byte, b'.' | b'_' | b':' | b'-'))
    {
        return Err(invalid_input(
            "broker publication operation id is malformed",
        ));
    }
    Ok(bytes)
}

fn take_operation(input: &mut &[u8]) -> io::Result<String> {
    let length = take_u16(input)? as usize;
    if length == 0 || length > 128 || input.len() < length {
        return Err(invalid_data(
            "broker publication operation id length is invalid",
        ));
    }
    let value = std::str::from_utf8(&input[..length])
        .map_err(|_| invalid_data("broker publication operation id is not utf8"))?
        .to_owned();
    *input = &input[length..];
    bounded_operation(&value)
        .map_err(|_| invalid_data("broker publication operation id is malformed"))?;
    Ok(value)
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum BrokerOperation {
    Probe,
    Prepare,
    RecoverPreparation,
    AcknowledgePreparation,
    Reopen,
    RecordPublication,
    Activate,
    Inspect,
    OpenRuntime,
    Abort,
    Terminate { grace_ms: u32 },
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BrokerRequest {
    pub request_id: [u8; 16],
    pub challenge_nonce: [u8; 32],
    pub caller_uid: u32,
    /// Absolute CLOCK_MONOTONIC deadline chosen once by the client.  A value of
    /// zero is reserved for the non-blocking probe operation.
    pub deadline_monotonic_ns: u64,
    pub operation: BrokerOperation,
    pub lease_token: Option<[u8; 32]>,
    pub request_capability: Option<[u8; 32]>,
    pub body: Vec<u8>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u8)]
pub enum BrokerResponseCode {
    Available = 1,
    Prepared = 2,
    Reopened = 3,
    PublicationRecorded = 4,
    Activated = 5,
    ExactScopeEmpty = 6,
    PreparationAcknowledged = 7,
    AuthorityUnavailable = 16,
    IdentityDrift = 17,
    ControlLoss = 18,
    Timeout = 19,
    AuthorityUncertain = 20,
    EventGap = 21,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BrokerResponse {
    pub request_id: [u8; 16],
    pub code: BrokerResponseCode,
    pub body: Vec<u8>,
}

impl BrokerResponse {
    pub fn encode(&self) -> io::Result<Vec<u8>> {
        if self.request_id.iter().all(|byte| *byte == 0) || self.body.len() > MAX_BROKER_BODY_BYTES
        {
            return Err(invalid_input("broker response identity or body is invalid"));
        }
        let mut output = Vec::with_capacity(24 + self.body.len());
        output.extend_from_slice(&BROKER_PROTOCOL_VERSION.to_be_bytes());
        output.extend_from_slice(&self.request_id);
        output.push(self.code as u8);
        output.push(0);
        output.extend_from_slice(&(self.body.len() as u32).to_be_bytes());
        output.extend_from_slice(&self.body);
        Ok(output)
    }

    pub fn decode(bytes: &[u8]) -> io::Result<Self> {
        let mut input = bytes;
        if take_u16(&mut input)? != BROKER_PROTOCOL_VERSION {
            return Err(invalid_data("broker response version is unsupported"));
        }
        let request_id = take_array(&mut input)?;
        let code = match take_u8(&mut input)? {
            1 => BrokerResponseCode::Available,
            2 => BrokerResponseCode::Prepared,
            3 => BrokerResponseCode::Reopened,
            4 => BrokerResponseCode::PublicationRecorded,
            5 => BrokerResponseCode::Activated,
            6 => BrokerResponseCode::ExactScopeEmpty,
            7 => BrokerResponseCode::PreparationAcknowledged,
            16 => BrokerResponseCode::AuthorityUnavailable,
            17 => BrokerResponseCode::IdentityDrift,
            18 => BrokerResponseCode::ControlLoss,
            19 => BrokerResponseCode::Timeout,
            20 => BrokerResponseCode::AuthorityUncertain,
            21 => BrokerResponseCode::EventGap,
            _ => return Err(invalid_data("broker response code is unsupported")),
        };
        if take_u8(&mut input)? != 0 {
            return Err(invalid_data("broker response reserved byte is nonzero"));
        }
        let length = take_u32(&mut input)? as usize;
        if length > MAX_BROKER_BODY_BYTES || input.len() != length {
            return Err(invalid_data("broker response body length is invalid"));
        }
        let value = Self {
            request_id,
            code,
            body: input.to_vec(),
        };
        value
            .encode()
            .map_err(|_| invalid_data("broker response is malformed"))?;
        Ok(value)
    }
}

impl BrokerRequest {
    pub fn replay_digest(&self) -> io::Result<[u8; 32]> {
        self.encode()?;
        let mut digest = Sha256::new();
        digest.update(b"rasen-broker-request-replay-v1\0");
        digest.update(self.request_id);
        digest.update(self.caller_uid.to_be_bytes());
        digest.update(self.deadline_monotonic_ns.to_be_bytes());
        let operation = match self.operation {
            BrokerOperation::Probe => [1, 0, 0, 0, 0],
            BrokerOperation::Prepare => [2, 0, 0, 0, 0],
            BrokerOperation::RecoverPreparation => [10, 0, 0, 0, 0],
            BrokerOperation::AcknowledgePreparation => [11, 0, 0, 0, 0],
            BrokerOperation::Reopen => [3, 0, 0, 0, 0],
            BrokerOperation::RecordPublication => [4, 0, 0, 0, 0],
            BrokerOperation::Activate => [5, 0, 0, 0, 0],
            BrokerOperation::Inspect => [6, 0, 0, 0, 0],
            BrokerOperation::OpenRuntime => [7, 0, 0, 0, 0],
            BrokerOperation::Abort => [8, 0, 0, 0, 0],
            BrokerOperation::Terminate { grace_ms } => {
                let bytes = grace_ms.to_be_bytes();
                [9, bytes[0], bytes[1], bytes[2], bytes[3]]
            }
        };
        digest.update(operation);
        digest.update(self.lease_token.unwrap_or([0; 32]));
        digest.update(self.request_capability.unwrap_or([0; 32]));
        digest.update((self.body.len() as u32).to_be_bytes());
        digest.update(&self.body);
        Ok(digest.finalize().into())
    }

    pub fn encode(&self) -> io::Result<Vec<u8>> {
        if self.request_id.iter().all(|byte| *byte == 0)
            || self.challenge_nonce.iter().all(|byte| *byte == 0)
            || self.body.len() > MAX_BROKER_BODY_BYTES
        {
            return Err(invalid_input("broker request identity or body is invalid"));
        }
        let requires_lease = !matches!(
            self.operation,
            BrokerOperation::Probe | BrokerOperation::Prepare | BrokerOperation::RecoverPreparation
        );
        if requires_lease != self.lease_token.is_some()
            || requires_lease != self.request_capability.is_some()
        {
            return Err(invalid_input(
                "broker control request requires exact lease token and request capability",
            ));
        }
        if self
            .lease_token
            .iter()
            .chain(self.request_capability.iter())
            .any(|bytes| bytes.iter().all(|byte| *byte == 0))
        {
            return Err(invalid_input("broker request capability is zero"));
        }
        let mut output = Vec::with_capacity(128 + self.body.len());
        output.extend_from_slice(&BROKER_PROTOCOL_VERSION.to_be_bytes());
        output.extend_from_slice(&self.request_id);
        output.extend_from_slice(&self.challenge_nonce);
        output.extend_from_slice(&self.caller_uid.to_be_bytes());
        let (tag, grace_ms) = match self.operation {
            BrokerOperation::Probe => (1, 0),
            BrokerOperation::Prepare => (2, 0),
            BrokerOperation::RecoverPreparation => (10, 0),
            BrokerOperation::AcknowledgePreparation => (11, 0),
            BrokerOperation::Reopen => (3, 0),
            BrokerOperation::RecordPublication => (4, 0),
            BrokerOperation::Activate => (5, 0),
            BrokerOperation::Inspect => (6, 0),
            BrokerOperation::OpenRuntime => (7, 0),
            BrokerOperation::Abort => (8, 0),
            BrokerOperation::Terminate { grace_ms } => (9, grace_ms),
        };
        if !matches!(self.operation, BrokerOperation::Probe) && self.deadline_monotonic_ns == 0 {
            return Err(invalid_input("broker request deadline is absent"));
        }
        if matches!(self.operation, BrokerOperation::Probe) && self.deadline_monotonic_ns != 0 {
            return Err(invalid_input("broker probe carries a deadline"));
        }
        if grace_ms > MAX_BROKER_TIMEOUT_MS {
            return Err(invalid_input("broker graceful interval exceeds its bound"));
        }
        output.push(tag);
        output.extend_from_slice(&grace_ms.to_be_bytes());
        output.extend_from_slice(&self.deadline_monotonic_ns.to_be_bytes());
        let mut flags = 0_u8;
        if self.lease_token.is_some() {
            flags |= 1;
        }
        if self.request_capability.is_some() {
            flags |= 2;
        }
        output.push(flags);
        if let Some(value) = self.lease_token {
            output.extend_from_slice(&value);
        }
        if let Some(value) = self.request_capability {
            output.extend_from_slice(&value);
        }
        output.extend_from_slice(&(self.body.len() as u32).to_be_bytes());
        output.extend_from_slice(&self.body);
        Ok(output)
    }

    pub fn decode(bytes: &[u8]) -> io::Result<Self> {
        let mut input = bytes;
        if take_u16(&mut input)? != BROKER_PROTOCOL_VERSION {
            return Err(invalid_data("broker request version is unsupported"));
        }
        let request_id = take_array(&mut input)?;
        let challenge_nonce = take_array(&mut input)?;
        let caller_uid = take_u32(&mut input)?;
        let tag = take_u8(&mut input)?;
        let grace_ms = take_u32(&mut input)?;
        let deadline_monotonic_ns = take_u64(&mut input)?;
        let operation = match (tag, grace_ms) {
            (1, 0) => BrokerOperation::Probe,
            (2, 0) => BrokerOperation::Prepare,
            (10, 0) => BrokerOperation::RecoverPreparation,
            (11, 0) => BrokerOperation::AcknowledgePreparation,
            (3, 0) => BrokerOperation::Reopen,
            (4, 0) => BrokerOperation::RecordPublication,
            (5, 0) => BrokerOperation::Activate,
            (6, 0) => BrokerOperation::Inspect,
            (7, 0) => BrokerOperation::OpenRuntime,
            (8, 0) => BrokerOperation::Abort,
            (9, value) if value <= MAX_BROKER_TIMEOUT_MS => {
                BrokerOperation::Terminate { grace_ms: value }
            }
            _ => return Err(invalid_data("broker request operation is malformed")),
        };
        if (!matches!(operation, BrokerOperation::Probe) && deadline_monotonic_ns == 0)
            || (matches!(operation, BrokerOperation::Probe) && deadline_monotonic_ns != 0)
        {
            return Err(invalid_data("broker request deadline is malformed"));
        }
        let flags = take_u8(&mut input)?;
        if flags & !3 != 0 {
            return Err(invalid_data("broker request flags are unsupported"));
        }
        let lease_token = if flags & 1 != 0 {
            Some(take_array(&mut input)?)
        } else {
            None
        };
        let request_capability = if flags & 2 != 0 {
            Some(take_array(&mut input)?)
        } else {
            None
        };
        let body_length = take_u32(&mut input)? as usize;
        if body_length > MAX_BROKER_BODY_BYTES || input.len() != body_length {
            return Err(invalid_data("broker request body length is invalid"));
        }
        let value = Self {
            request_id,
            challenge_nonce,
            caller_uid,
            deadline_monotonic_ns,
            operation,
            lease_token,
            request_capability,
            body: input.to_vec(),
        };
        value
            .encode()
            .map_err(|_| invalid_data("broker request is malformed"))?;
        Ok(value)
    }
}

fn challenge_message(hello: &ClientHello, observed_client: PeerCredentials) -> Vec<u8> {
    let mut message = Vec::with_capacity(CHALLENGE_DOMAIN.len() + 50);
    message.extend_from_slice(CHALLENGE_DOMAIN);
    message.extend_from_slice(&BROKER_PROTOCOL_VERSION.to_be_bytes());
    message.extend_from_slice(&hello.nonce);
    message.extend_from_slice(&hello.claimed_uid.to_be_bytes());
    message.extend_from_slice(&observed_client.pid.to_be_bytes());
    message.extend_from_slice(&observed_client.uid.to_be_bytes());
    message.extend_from_slice(&observed_client.gid.to_be_bytes());
    message
}

fn key_id(public_key: &[u8; 32]) -> [u8; 32] {
    Sha256::digest(public_key).into()
}

fn require_empty(input: &[u8], label: &str) -> io::Result<()> {
    if input.is_empty() {
        Ok(())
    } else {
        Err(invalid_data(&format!("{label} contains trailing bytes")))
    }
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
            "broker message is truncated",
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
