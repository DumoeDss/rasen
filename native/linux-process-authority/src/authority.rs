use std::io;

pub const PROVIDER_REFERENCE_VERSION: u16 = 1;
const IDENTITY_MAGIC: &[u8; 4] = b"RBI1";
const MAX_OPERATION_BYTES: usize = 256;
const MAX_BOOT_ID_BYTES: usize = 64;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AuthorityIdentity {
    pub boot_id: String,
    pub guardian_pid: u32,
    pub start_ticks: u64,
    pub pid_namespace_device: u64,
    pub pid_namespace_inode: u64,
}

impl AuthorityIdentity {
    pub fn validate(&self) -> io::Result<()> {
        if self.boot_id.is_empty()
            || self.boot_id.len() > MAX_BOOT_ID_BYTES
            || !self
                .boot_id
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit() || byte == b'-')
            || self.guardian_pid == 0
            || self.start_ticks == 0
            || self.pid_namespace_inode == 0
        {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Linux authority identity is malformed",
            ));
        }
        Ok(())
    }

    pub fn encode_standalone(&self) -> io::Result<Vec<u8>> {
        let mut output = Vec::with_capacity(128);
        output.extend_from_slice(IDENTITY_MAGIC);
        output.extend_from_slice(&PROVIDER_REFERENCE_VERSION.to_be_bytes());
        self.encode_into(&mut output)?;
        Ok(output)
    }

    pub fn decode_standalone(bytes: &[u8]) -> io::Result<Self> {
        if bytes.len() < 6 || &bytes[..4] != IDENTITY_MAGIC {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "standalone authority identity header is malformed",
            ));
        }
        let mut input = &bytes[4..];
        if take_u16(&mut input)? != PROVIDER_REFERENCE_VERSION {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "standalone authority identity version is unsupported",
            ));
        }
        let value = Self::decode_from(&mut input)?;
        if !input.is_empty() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "standalone authority identity contains trailing bytes",
            ));
        }
        Ok(value)
    }

    fn encode_into(&self, output: &mut Vec<u8>) -> io::Result<()> {
        self.validate()?;
        put_string(output, &self.boot_id, MAX_BOOT_ID_BYTES)?;
        output.extend_from_slice(&self.guardian_pid.to_be_bytes());
        output.extend_from_slice(&self.start_ticks.to_be_bytes());
        output.extend_from_slice(&self.pid_namespace_device.to_be_bytes());
        output.extend_from_slice(&self.pid_namespace_inode.to_be_bytes());
        Ok(())
    }

    fn decode_from(input: &mut &[u8]) -> io::Result<Self> {
        let value = Self {
            boot_id: take_string(input, MAX_BOOT_ID_BYTES)?,
            guardian_pid: take_u32(input)?,
            start_ticks: take_u64(input)?,
            pid_namespace_device: take_u64(input)?,
            pid_namespace_inode: take_u64(input)?,
        };
        value.validate()?;
        Ok(value)
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PreparedAttestation {
    pub helper_protocol_version: u16,
    pub scope_id: [u8; 16],
    pub scope_capability: [u8; 32],
    pub control_capability: [u8; 32],
    pub preparation_operation_id: String,
    pub launch_digest: [u8; 32],
    pub artifact_digest: [u8; 32],
    pub source_digest: [u8; 32],
    pub identity: AuthorityIdentity,
}

impl PreparedAttestation {
    pub fn encode(&self) -> io::Result<Vec<u8>> {
        if self.helper_protocol_version != crate::protocol::PROTOCOL_VERSION {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "prepared attestation helper protocol version is unsupported",
            ));
        }
        for (label, zero) in [
            ("scope id", self.scope_id.iter().all(|byte| *byte == 0)),
            (
                "scope capability",
                self.scope_capability.iter().all(|byte| *byte == 0),
            ),
            (
                "control capability",
                self.control_capability.iter().all(|byte| *byte == 0),
            ),
            (
                "launch digest",
                self.launch_digest.iter().all(|byte| *byte == 0),
            ),
            (
                "artifact digest",
                self.artifact_digest.iter().all(|byte| *byte == 0),
            ),
            (
                "source digest",
                self.source_digest.iter().all(|byte| *byte == 0),
            ),
        ] {
            if zero {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    format!("prepared attestation {label} is zero"),
                ));
            }
        }
        if self.scope_capability == self.control_capability {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "prepared attestation capabilities are conflated",
            ));
        }
        if self.artifact_digest == self.source_digest {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "prepared attestation artifact and source digests are conflated",
            ));
        }
        let mut output = Vec::with_capacity(256);
        output.extend_from_slice(&PROVIDER_REFERENCE_VERSION.to_be_bytes());
        output.extend_from_slice(&self.helper_protocol_version.to_be_bytes());
        output.extend_from_slice(&self.scope_id);
        output.extend_from_slice(&self.scope_capability);
        output.extend_from_slice(&self.control_capability);
        put_string(
            &mut output,
            &self.preparation_operation_id,
            MAX_OPERATION_BYTES,
        )?;
        output.extend_from_slice(&self.launch_digest);
        output.extend_from_slice(&self.artifact_digest);
        output.extend_from_slice(&self.source_digest);
        self.identity.encode_into(&mut output)?;
        Ok(output)
    }

    pub fn decode(bytes: &[u8]) -> io::Result<Self> {
        let mut input = bytes;
        if take_u16(&mut input)? != PROVIDER_REFERENCE_VERSION {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "provider reference version is unsupported",
            ));
        }
        let value = Self {
            helper_protocol_version: take_u16(&mut input)?,
            scope_id: take_array(&mut input)?,
            scope_capability: take_array(&mut input)?,
            control_capability: take_array(&mut input)?,
            preparation_operation_id: take_string(&mut input, MAX_OPERATION_BYTES)?,
            launch_digest: take_array(&mut input)?,
            artifact_digest: take_array(&mut input)?,
            source_digest: take_array(&mut input)?,
            identity: AuthorityIdentity::decode_from(&mut input)?,
        };
        if !input.is_empty() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "prepared attestation contains trailing bytes",
            ));
        }
        value.encode()?;
        Ok(value)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ControlOperation {
    OpenRuntime,
    Activate,
    Inspect,
    Abort,
    Terminate { grace_ms: u32 },
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ControlRequest {
    pub scope_capability: [u8; 32],
    pub control_capability: [u8; 32],
    pub identity: AuthorityIdentity,
    pub deadline_monotonic_ns: u64,
    pub operation: ControlOperation,
}

impl ControlRequest {
    pub fn encode(&self) -> io::Result<Vec<u8>> {
        if self.scope_capability.iter().all(|byte| *byte == 0)
            || self.control_capability.iter().all(|byte| *byte == 0)
            || self.scope_capability == self.control_capability
            || self.deadline_monotonic_ns == 0
        {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "control capability is empty",
            ));
        }
        let mut output = Vec::with_capacity(160);
        output.extend_from_slice(&PROVIDER_REFERENCE_VERSION.to_be_bytes());
        output.extend_from_slice(&self.scope_capability);
        output.extend_from_slice(&self.control_capability);
        self.identity.encode_into(&mut output)?;
        output.extend_from_slice(&self.deadline_monotonic_ns.to_be_bytes());
        match self.operation {
            ControlOperation::OpenRuntime => output.push(1),
            ControlOperation::Activate => output.push(2),
            ControlOperation::Inspect => output.push(3),
            ControlOperation::Abort => output.push(4),
            ControlOperation::Terminate { grace_ms } => {
                output.push(5);
                output.extend_from_slice(&grace_ms.to_be_bytes());
            }
        }
        Ok(output)
    }

    pub fn decode(bytes: &[u8]) -> io::Result<Self> {
        let mut input = bytes;
        if take_u16(&mut input)? != PROVIDER_REFERENCE_VERSION {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "control request version is unsupported",
            ));
        }
        let scope_capability = take_array(&mut input)?;
        let control_capability = take_array(&mut input)?;
        if scope_capability.iter().all(|byte| *byte == 0)
            || control_capability.iter().all(|byte| *byte == 0)
            || scope_capability == control_capability
        {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "control capability is empty",
            ));
        }
        let identity = AuthorityIdentity::decode_from(&mut input)?;
        let deadline_monotonic_ns = take_u64(&mut input)?;
        if deadline_monotonic_ns == 0 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "control request deadline is zero",
            ));
        }
        let tag = take_u8(&mut input)?;
        let operation = match tag {
            1 => ControlOperation::OpenRuntime,
            2 => ControlOperation::Activate,
            3 => ControlOperation::Inspect,
            4 => ControlOperation::Abort,
            5 => ControlOperation::Terminate {
                grace_ms: take_u32(&mut input)?,
            },
            _ => {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "control operation is unsupported",
                ))
            }
        };
        if !input.is_empty() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "control request contains trailing bytes",
            ));
        }
        Ok(Self {
            scope_capability,
            control_capability,
            identity,
            deadline_monotonic_ns,
            operation,
        })
    }
}

fn put_string(output: &mut Vec<u8>, value: &str, maximum: usize) -> io::Result<()> {
    if value.is_empty() || value.len() > maximum || value.contains('\0') {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "bounded identity string is malformed",
        ));
    }
    output.extend_from_slice(&(value.len() as u16).to_be_bytes());
    output.extend_from_slice(value.as_bytes());
    Ok(())
}

fn take_u8(input: &mut &[u8]) -> io::Result<u8> {
    let value = *input
        .first()
        .ok_or_else(|| io::Error::new(io::ErrorKind::UnexpectedEof, "missing u8"))?;
    *input = &input[1..];
    Ok(value)
}

fn take_u16(input: &mut &[u8]) -> io::Result<u16> {
    if input.len() < 2 {
        return Err(io::Error::new(io::ErrorKind::UnexpectedEof, "missing u16"));
    }
    let value = u16::from_be_bytes(input[..2].try_into().expect("length checked"));
    *input = &input[2..];
    Ok(value)
}

fn take_u32(input: &mut &[u8]) -> io::Result<u32> {
    if input.len() < 4 {
        return Err(io::Error::new(io::ErrorKind::UnexpectedEof, "missing u32"));
    }
    let value = u32::from_be_bytes(input[..4].try_into().expect("length checked"));
    *input = &input[4..];
    Ok(value)
}

fn take_u64(input: &mut &[u8]) -> io::Result<u64> {
    if input.len() < 8 {
        return Err(io::Error::new(io::ErrorKind::UnexpectedEof, "missing u64"));
    }
    let value = u64::from_be_bytes(input[..8].try_into().expect("length checked"));
    *input = &input[8..];
    Ok(value)
}

fn take_array<const N: usize>(input: &mut &[u8]) -> io::Result<[u8; N]> {
    if input.len() < N {
        return Err(io::Error::new(
            io::ErrorKind::UnexpectedEof,
            "missing fixed identity bytes",
        ));
    }
    let value = input[..N].try_into().expect("length checked");
    *input = &input[N..];
    Ok(value)
}

fn take_string(input: &mut &[u8], maximum: usize) -> io::Result<String> {
    let length = take_u16(input)? as usize;
    if length == 0 || length > maximum || input.len() < length {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "bounded identity string length is invalid",
        ));
    }
    let value = std::str::from_utf8(&input[..length])
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "identity string is not utf8"))?;
    if value.contains('\0') {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "identity string contains nul",
        ));
    }
    *input = &input[length..];
    Ok(value.to_owned())
}
