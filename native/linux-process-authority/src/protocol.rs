use std::collections::BTreeMap;
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

pub const PROTOCOL_VERSION: u16 = 1;
pub const MAX_FRAME_BYTES: usize = 2 * 1024 * 1024;
const MAGIC: &[u8; 4] = b"RPA1";
const HEADER_BYTES: usize = 12;
const MAX_OPERATION_BYTES: usize = 256;
const MAX_PATH_BYTES: usize = 32 * 1024;
const MAX_ARGUMENT_BYTES: usize = 128 * 1024;
const MAX_ARGUMENTS: usize = 128;
const MAX_ENVIRONMENT: usize = 128;
const MAX_ENV_KEY_BYTES: usize = 1024;
const MAX_ENV_VALUE_BYTES: usize = 128 * 1024;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u8)]
pub enum FrameKind {
    Prepare = 0x01,
    OpenRuntime = 0x02,
    Activate = 0x03,
    Inspect = 0x04,
    Abort = 0x05,
    Terminate = 0x06,
    Input = 0x07,
    CloseInput = 0x08,
    ReleaseGate = 0x09,
    Prepared = 0x81,
    RuntimeReady = 0x82,
    Activated = 0x83,
    Observation = 0x84,
    Output = 0x85,
    ErrorOutput = 0x86,
    Event = 0x87,
    ExactScopeEmpty = 0x88,
    Challenge = 0x89,
    ActivationReady = 0x8a,
    Failure = 0xff,
}

impl TryFrom<u8> for FrameKind {
    type Error = io::Error;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0x01 => Ok(Self::Prepare),
            0x02 => Ok(Self::OpenRuntime),
            0x03 => Ok(Self::Activate),
            0x04 => Ok(Self::Inspect),
            0x05 => Ok(Self::Abort),
            0x06 => Ok(Self::Terminate),
            0x07 => Ok(Self::Input),
            0x08 => Ok(Self::CloseInput),
            0x09 => Ok(Self::ReleaseGate),
            0x81 => Ok(Self::Prepared),
            0x82 => Ok(Self::RuntimeReady),
            0x83 => Ok(Self::Activated),
            0x84 => Ok(Self::Observation),
            0x85 => Ok(Self::Output),
            0x86 => Ok(Self::ErrorOutput),
            0x87 => Ok(Self::Event),
            0x88 => Ok(Self::ExactScopeEmpty),
            0x89 => Ok(Self::Challenge),
            0x8a => Ok(Self::ActivationReady),
            0xff => Ok(Self::Failure),
            _ => Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "unknown Linux authority frame kind",
            )),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Frame {
    pub kind: FrameKind,
    pub payload: Vec<u8>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u8)]
pub enum NativeFailureCode {
    Unavailable = 1,
    Uncertain = 2,
    IdentityDrift = 3,
    EventGap = 4,
    Timeout = 5,
    ControlLoss = 6,
    ReferenceInvalid = 7,
    ArtifactUnavailable = 8,
    StateRetained = 9,
}

impl NativeFailureCode {
    pub fn diagnostic_code(self) -> &'static str {
        match self {
            Self::Unavailable => "native-unavailable",
            Self::Uncertain => "native-uncertain",
            Self::IdentityDrift => "identity-drift",
            Self::EventGap => "event-gap",
            Self::Timeout => "native-operation-timeout",
            Self::ControlLoss => "native-transport-lost",
            Self::ReferenceInvalid => "reference-invalid",
            Self::ArtifactUnavailable => "artifact-unavailable",
            Self::StateRetained => "native-state-retained",
        }
    }

    pub fn from_prepare_error(error: &io::Error) -> Self {
        if error.to_string().contains("artifact") {
            return Self::ArtifactUnavailable;
        }
        let diagnostic = error.to_string();
        for code in [
            Self::Unavailable,
            Self::Uncertain,
            Self::IdentityDrift,
            Self::EventGap,
            Self::Timeout,
            Self::ControlLoss,
            Self::ReferenceInvalid,
            Self::ArtifactUnavailable,
            Self::StateRetained,
        ] {
            if diagnostic == code.diagnostic_code() {
                return code;
            }
        }
        if error.kind() == io::ErrorKind::TimedOut {
            return Self::Timeout;
        }
        if matches!(
            error.raw_os_error(),
            Some(libc::EPERM) | Some(libc::EACCES) | Some(libc::ENOSYS) | Some(libc::EOPNOTSUPP)
        ) {
            return Self::Unavailable;
        }
        if matches!(
            error.kind(),
            io::ErrorKind::InvalidInput
                | io::ErrorKind::InvalidData
                | io::ErrorKind::PermissionDenied
        ) {
            return Self::ReferenceInvalid;
        }
        Self::Uncertain
    }

    pub fn from_control_error(error: &io::Error) -> Self {
        let diagnostic = error.to_string();
        if diagnostic == Self::IdentityDrift.diagnostic_code() {
            return Self::IdentityDrift;
        }
        if (diagnostic == Self::EventGap.diagnostic_code() || diagnostic.starts_with("event-gap:"))
            || diagnostic.contains("guardian journal")
            || diagnostic.contains("guardian event")
        {
            return Self::EventGap;
        }
        for code in [
            Self::Unavailable,
            Self::Uncertain,
            Self::Timeout,
            Self::ControlLoss,
            Self::ReferenceInvalid,
            Self::ArtifactUnavailable,
            Self::StateRetained,
        ] {
            if diagnostic == code.diagnostic_code() {
                return code;
            }
        }
        match error.kind() {
            io::ErrorKind::TimedOut | io::ErrorKind::WouldBlock => Self::Timeout,
            io::ErrorKind::AlreadyExists | io::ErrorKind::InvalidInput => Self::StateRetained,
            io::ErrorKind::PermissionDenied | io::ErrorKind::InvalidData => Self::ReferenceInvalid,
            io::ErrorKind::NotFound
            | io::ErrorKind::ConnectionRefused
            | io::ErrorKind::ConnectionReset
            | io::ErrorKind::BrokenPipe
            | io::ErrorKind::UnexpectedEof => Self::ControlLoss,
            _ => Self::Uncertain,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct NativeFailure {
    pub code: NativeFailureCode,
}

impl NativeFailure {
    pub fn encode(self) -> [u8; 3] {
        let version = PROTOCOL_VERSION.to_be_bytes();
        [version[0], version[1], self.code as u8]
    }

    pub fn decode(bytes: &[u8]) -> io::Result<Self> {
        if bytes.len() != 3 || u16::from_be_bytes([bytes[0], bytes[1]]) != PROTOCOL_VERSION {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "native failure payload is malformed",
            ));
        }
        let code = match bytes[2] {
            1 => NativeFailureCode::Unavailable,
            2 => NativeFailureCode::Uncertain,
            3 => NativeFailureCode::IdentityDrift,
            4 => NativeFailureCode::EventGap,
            5 => NativeFailureCode::Timeout,
            6 => NativeFailureCode::ControlLoss,
            7 => NativeFailureCode::ReferenceInvalid,
            8 => NativeFailureCode::ArtifactUnavailable,
            9 => NativeFailureCode::StateRetained,
            _ => {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "native failure code is unsupported",
                ))
            }
        };
        Ok(Self { code })
    }
}

impl Frame {
    pub fn new(kind: FrameKind, payload: Vec<u8>) -> io::Result<Self> {
        if payload.len() > MAX_FRAME_BYTES {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Linux authority frame exceeds its bound",
            ));
        }
        Ok(Self { kind, payload })
    }
}

pub fn write_frame<W: Write>(writer: &mut W, frame: &Frame) -> io::Result<()> {
    if frame.payload.len() > MAX_FRAME_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Linux authority frame exceeds its bound",
        ));
    }
    writer.write_all(MAGIC)?;
    writer.write_all(&PROTOCOL_VERSION.to_be_bytes())?;
    writer.write_all(&[frame.kind as u8, 0])?;
    writer.write_all(&(frame.payload.len() as u32).to_be_bytes())?;
    writer.write_all(&frame.payload)?;
    writer.flush()
}

pub fn read_frame<R: Read>(reader: &mut R) -> io::Result<Option<Frame>> {
    let mut header = [0_u8; HEADER_BYTES];
    let mut offset = 0;
    while offset < header.len() {
        let count = reader.read(&mut header[offset..])?;
        if count == 0 {
            if offset == 0 {
                return Ok(None);
            }
            return Err(io::Error::new(
                io::ErrorKind::UnexpectedEof,
                "truncated Linux authority frame header",
            ));
        }
        offset += count;
    }
    if &header[..4] != MAGIC
        || u16::from_be_bytes([header[4], header[5]]) != PROTOCOL_VERSION
        || header[7] != 0
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "Linux authority frame header is invalid",
        ));
    }
    let kind = FrameKind::try_from(header[6])?;
    let length = u32::from_be_bytes(header[8..12].try_into().expect("fixed header")) as usize;
    if length > MAX_FRAME_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "Linux authority frame exceeds its bound",
        ));
    }
    let mut payload = vec![0_u8; length];
    reader.read_exact(&mut payload)?;
    Ok(Some(Frame { kind, payload }))
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LaunchSpec {
    pub command: PathBuf,
    pub cwd: PathBuf,
    pub args: Vec<String>,
    pub env: BTreeMap<String, String>,
}

impl LaunchSpec {
    pub fn digest(&self) -> io::Result<[u8; 32]> {
        let bytes = self.canonical_bytes()?;
        Ok(Sha256::digest(bytes).into())
    }

    fn canonical_bytes(&self) -> io::Result<Vec<u8>> {
        validate_linux_absolute(&self.command, "command")?;
        validate_linux_absolute(&self.cwd, "cwd")?;
        if self.args.len() > MAX_ARGUMENTS || self.env.len() > MAX_ENVIRONMENT {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "launch collection exceeds its bound",
            ));
        }
        let mut output = Vec::new();
        output.extend_from_slice(b"RPL1");
        put_path(&mut output, &self.command)?;
        put_path(&mut output, &self.cwd)?;
        output.extend_from_slice(&(self.args.len() as u32).to_be_bytes());
        for argument in &self.args {
            put_string(&mut output, argument, MAX_ARGUMENT_BYTES, true)?;
        }
        output.extend_from_slice(&(self.env.len() as u32).to_be_bytes());
        for (key, value) in &self.env {
            if key.contains('=') {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "environment key is malformed",
                ));
            }
            put_string(&mut output, key, MAX_ENV_KEY_BYTES, false)?;
            put_string(&mut output, value, MAX_ENV_VALUE_BYTES, true)?;
        }
        Ok(output)
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PrepareRequest {
    pub operation_id: String,
    pub runtime_root: PathBuf,
    pub launch: LaunchSpec,
}

impl PrepareRequest {
    pub fn encode(&self) -> io::Result<Vec<u8>> {
        validate_text(
            &self.operation_id,
            MAX_OPERATION_BYTES,
            false,
            "operation id",
        )?;
        validate_linux_absolute(&self.runtime_root, "runtime root")?;
        validate_linux_absolute(&self.launch.command, "command")?;
        validate_linux_absolute(&self.launch.cwd, "cwd")?;
        if self.launch.args.len() > MAX_ARGUMENTS || self.launch.env.len() > MAX_ENVIRONMENT {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "launch collection exceeds its bound",
            ));
        }
        let mut output = Vec::new();
        output.extend_from_slice(&PROTOCOL_VERSION.to_be_bytes());
        put_string(&mut output, &self.operation_id, MAX_OPERATION_BYTES, false)?;
        put_path(&mut output, &self.runtime_root)?;
        put_path(&mut output, &self.launch.command)?;
        put_path(&mut output, &self.launch.cwd)?;
        output.extend_from_slice(&(self.launch.args.len() as u32).to_be_bytes());
        for argument in &self.launch.args {
            put_string(&mut output, argument, MAX_ARGUMENT_BYTES, true)?;
        }
        output.extend_from_slice(&(self.launch.env.len() as u32).to_be_bytes());
        for (key, value) in &self.launch.env {
            if key.contains('=') {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "environment key is malformed",
                ));
            }
            put_string(&mut output, key, MAX_ENV_KEY_BYTES, false)?;
            put_string(&mut output, value, MAX_ENV_VALUE_BYTES, true)?;
        }
        if output.len() > MAX_FRAME_BYTES {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "prepare payload exceeds its bound",
            ));
        }
        Ok(output)
    }

    pub fn decode(bytes: &[u8]) -> io::Result<Self> {
        let mut input = bytes;
        if take_u16(&mut input)? != PROTOCOL_VERSION {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "prepare protocol version is unsupported",
            ));
        }
        let operation_id = take_string(&mut input, MAX_OPERATION_BYTES, false)?;
        let runtime_root = take_path(&mut input)?;
        let command = take_path(&mut input)?;
        let cwd = take_path(&mut input)?;
        validate_linux_absolute(&runtime_root, "runtime root")?;
        validate_linux_absolute(&command, "command")?;
        validate_linux_absolute(&cwd, "cwd")?;
        let argument_count = take_u32(&mut input)? as usize;
        if argument_count > MAX_ARGUMENTS {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "too many arguments",
            ));
        }
        let mut args = Vec::with_capacity(argument_count);
        for _ in 0..argument_count {
            args.push(take_string(&mut input, MAX_ARGUMENT_BYTES, true)?);
        }
        let environment_count = take_u32(&mut input)? as usize;
        if environment_count > MAX_ENVIRONMENT {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "too many environment entries",
            ));
        }
        let mut env = BTreeMap::new();
        for _ in 0..environment_count {
            let key = take_string(&mut input, MAX_ENV_KEY_BYTES, false)?;
            let value = take_string(&mut input, MAX_ENV_VALUE_BYTES, true)?;
            if key.contains('=') || env.insert(key, value).is_some() {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "environment entry is malformed or duplicated",
                ));
            }
        }
        if !input.is_empty() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "prepare payload contains trailing bytes",
            ));
        }
        Ok(Self {
            operation_id,
            runtime_root,
            launch: LaunchSpec {
                command,
                cwd,
                args,
                env,
            },
        })
    }
}

fn validate_linux_absolute(path: &Path, label: &str) -> io::Result<()> {
    let value = path.to_str().ok_or_else(|| {
        io::Error::new(io::ErrorKind::InvalidInput, format!("{label} is not utf8"))
    })?;
    validate_text(value, MAX_PATH_BYTES, false, label)?;
    if !value.starts_with('/') {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("{label} is not an absolute Linux path"),
        ));
    }
    Ok(())
}

fn validate_text(value: &str, maximum: usize, empty: bool, label: &str) -> io::Result<()> {
    if value.as_bytes().len() > maximum || (!empty && value.is_empty()) || value.contains('\0') {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("{label} is malformed or exceeds its bound"),
        ));
    }
    Ok(())
}

fn put_string(output: &mut Vec<u8>, value: &str, maximum: usize, empty: bool) -> io::Result<()> {
    validate_text(value, maximum, empty, "string")?;
    output.extend_from_slice(&(value.len() as u32).to_be_bytes());
    output.extend_from_slice(value.as_bytes());
    Ok(())
}

fn put_path(output: &mut Vec<u8>, value: &Path) -> io::Result<()> {
    let text = value
        .to_str()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "path is not utf8"))?;
    put_string(output, text, MAX_PATH_BYTES, false)
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

fn take_string(input: &mut &[u8], maximum: usize, empty: bool) -> io::Result<String> {
    let length = take_u32(input)? as usize;
    if length > maximum || input.len() < length || (!empty && length == 0) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "bounded string length is invalid",
        ));
    }
    let value = std::str::from_utf8(&input[..length])
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "string is not utf8"))?;
    if value.contains('\0') {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "string contains nul",
        ));
    }
    *input = &input[length..];
    Ok(value.to_owned())
}

fn take_path(input: &mut &[u8]) -> io::Result<PathBuf> {
    Ok(PathBuf::from(take_string(input, MAX_PATH_BYTES, false)?))
}
