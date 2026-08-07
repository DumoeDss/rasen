//! Closed Windows helper protocol (task 3.3).
//!
//! Every frame is length-prefixed, magic-tagged, version-checked and bounded. The frame
//! vocabulary is closed: an unknown discriminant is a decode error, never an ignored frame.
//!
//! Two properties are load-bearing and are asserted by tests rather than left as comments:
//!
//! 1. **There is no `PUBLISH` frame.** Decision 10 routes the durable publication phase through
//!    the common publisher seam and a provider-owned ledger. `activate` verifies the ledger; it
//!    never writes publication state and never sends a publication frame. `FRAME_VOCABULARY`
//!    is the enumerated proof.
//! 2. **The root status carries exactly one branch.** Windows has no signals, so the provider
//!    always emits `{ code, signal: null }`. The wire tag can express "both branches",
//!    "neither branch" and "signal branch", and the decoder rejects all three — otherwise the
//!    rule would be untestable and the assertion would merely restate the encoder.

use std::collections::BTreeMap;
use std::io::{self, Read, Write};

pub const PROTOCOL_VERSION: u16 = 1;
pub const REFERENCE_VERSION: u16 = 1;
pub const COMMON_CONTRACT_VERSION: u16 = 1;

const MAGIC: &[u8; 4] = b"RWA1";
const HEADER_BYTES: usize = 12;

pub const MAX_FRAME_BYTES: usize = 1024 * 1024;
pub const MAX_OPERATION_BYTES: usize = 256;
pub const MAX_PATH_BYTES: usize = 32 * 1024;
pub const MAX_ARGUMENT_BYTES: usize = 128 * 1024;
pub const MAX_ARGUMENTS: usize = 128;
pub const MAX_ENVIRONMENT: usize = 256;
pub const MAX_ENV_KEY_BYTES: usize = 1024;
pub const MAX_ENV_VALUE_BYTES: usize = 128 * 1024;
pub const MAX_TEXT_BYTES: usize = 32 * 1024;

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
#[repr(u8)]
pub enum FrameKind {
    // Controller -> guardian.
    Attest = 0x01,
    OpenRuntime = 0x02,
    Activate = 0x03,
    Inspect = 0x04,
    Abort = 0x05,
    Terminate = 0x06,
    Input = 0x07,
    CloseInput = 0x08,
    // Guardian -> controller.
    Attestation = 0x81,
    RuntimeReady = 0x82,
    Activated = 0x83,
    Observation = 0x84,
    Output = 0x85,
    ErrorOutput = 0x86,
    Event = 0x87,
    RootExited = 0x88,
    ExactScopeEmpty = 0x89,
    Failure = 0xff,
}

/// The complete closed vocabulary. Any byte outside this set is a decode error.
pub const FRAME_VOCABULARY: [FrameKind; 18] = [
    FrameKind::Attest,
    FrameKind::OpenRuntime,
    FrameKind::Activate,
    FrameKind::Inspect,
    FrameKind::Abort,
    FrameKind::Terminate,
    FrameKind::Input,
    FrameKind::CloseInput,
    FrameKind::Attestation,
    FrameKind::RuntimeReady,
    FrameKind::Activated,
    FrameKind::Observation,
    FrameKind::Output,
    FrameKind::ErrorOutput,
    FrameKind::Event,
    FrameKind::RootExited,
    FrameKind::ExactScopeEmpty,
    FrameKind::Failure,
];

impl FrameKind {
    pub fn name(self) -> &'static str {
        match self {
            Self::Attest => "attest",
            Self::OpenRuntime => "open-runtime",
            Self::Activate => "activate",
            Self::Inspect => "inspect",
            Self::Abort => "abort",
            Self::Terminate => "terminate",
            Self::Input => "input",
            Self::CloseInput => "close-input",
            Self::Attestation => "attestation",
            Self::RuntimeReady => "runtime-ready",
            Self::Activated => "activated",
            Self::Observation => "observation",
            Self::Output => "output",
            Self::ErrorOutput => "error-output",
            Self::Event => "event",
            Self::RootExited => "root-exited",
            Self::ExactScopeEmpty => "exact-scope-empty",
            Self::Failure => "failure",
        }
    }
}

impl TryFrom<u8> for FrameKind {
    type Error = io::Error;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        for kind in FRAME_VOCABULARY {
            if kind as u8 == value {
                return Ok(kind);
            }
        }
        Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "unknown Windows authority frame kind",
        ))
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Frame {
    pub kind: FrameKind,
    pub payload: Vec<u8>,
}

impl Frame {
    pub fn new(kind: FrameKind, payload: Vec<u8>) -> io::Result<Self> {
        if payload.len() > MAX_FRAME_BYTES {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Windows authority frame exceeds its bound",
            ));
        }
        Ok(Self { kind, payload })
    }
}

pub fn write_frame<W: Write>(writer: &mut W, frame: &Frame) -> io::Result<()> {
    if frame.payload.len() > MAX_FRAME_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Windows authority frame exceeds its bound",
        ));
    }
    let mut header = Vec::with_capacity(HEADER_BYTES + frame.payload.len());
    header.extend_from_slice(MAGIC);
    header.extend_from_slice(&PROTOCOL_VERSION.to_be_bytes());
    header.push(frame.kind as u8);
    header.push(0);
    header.extend_from_slice(&(frame.payload.len() as u32).to_be_bytes());
    header.extend_from_slice(&frame.payload);
    writer.write_all(&header)?;
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
                "truncated Windows authority frame header",
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
            "Windows authority frame header is invalid",
        ));
    }
    let kind = FrameKind::try_from(header[6])?;
    let length = u32::from_be_bytes(header[8..12].try_into().expect("fixed header")) as usize;
    if length > MAX_FRAME_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "Windows authority frame exceeds its bound",
        ));
    }
    let mut payload = vec![0_u8; length];
    reader.read_exact(&mut payload).map_err(|error| {
        io::Error::new(
            error.kind(),
            format!(
                "truncated {} frame payload: expected {length} bytes ({error})",
                kind.name()
            ),
        )
    })?;
    Ok(Some(Frame { kind, payload }))
}

// ---------------------------------------------------------------------------------------------
// Typed failures
// ---------------------------------------------------------------------------------------------

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
    OrderingConflict = 10,
}

pub const FAILURE_VOCABULARY: [NativeFailureCode; 10] = [
    NativeFailureCode::Unavailable,
    NativeFailureCode::Uncertain,
    NativeFailureCode::IdentityDrift,
    NativeFailureCode::EventGap,
    NativeFailureCode::Timeout,
    NativeFailureCode::ControlLoss,
    NativeFailureCode::ReferenceInvalid,
    NativeFailureCode::ArtifactUnavailable,
    NativeFailureCode::StateRetained,
    NativeFailureCode::OrderingConflict,
];

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
            Self::OrderingConflict => "native-ordering-conflict",
        }
    }

    pub fn encode(self) -> [u8; 3] {
        let version = PROTOCOL_VERSION.to_be_bytes();
        [version[0], version[1], self as u8]
    }

    pub fn decode(bytes: &[u8]) -> io::Result<Self> {
        if bytes.len() != 3 || u16::from_be_bytes([bytes[0], bytes[1]]) != PROTOCOL_VERSION {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "native failure payload is malformed",
            ));
        }
        for code in FAILURE_VOCABULARY {
            if code as u8 == bytes[2] {
                return Ok(code);
            }
        }
        Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "native failure code is unsupported",
        ))
    }
}

// ---------------------------------------------------------------------------------------------
// Root status: exactly one branch, unsigned, never sign-extended
// ---------------------------------------------------------------------------------------------

/// Wire tag for the root-status union. Only [`ROOT_STATUS_CODE_ONLY`] is accepted; the other
/// three values exist so the "exactly one branch" rule is expressible on the wire and can be
/// shown to fail against a broken producer.
pub const ROOT_STATUS_NEITHER: u8 = 0x00;
pub const ROOT_STATUS_CODE_ONLY: u8 = 0x01;
pub const ROOT_STATUS_SIGNAL_ONLY: u8 = 0x02;
pub const ROOT_STATUS_BOTH: u8 = 0x03;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct RootStatus {
    /// The exact `DWORD` from `GetExitCodeProcess`, carried unsigned. `0xC0000005` is
    /// `3221225477`, never `-1073741819`, and never truncated.
    pub code: u32,
}

impl RootStatus {
    pub fn encode(self) -> Vec<u8> {
        let mut output = Vec::with_capacity(5);
        output.push(ROOT_STATUS_CODE_ONLY);
        output.extend_from_slice(&self.code.to_be_bytes());
        output
    }

    pub fn decode(bytes: &[u8]) -> io::Result<Self> {
        if bytes.len() != 5 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "root status payload is malformed",
            ));
        }
        match bytes[0] {
            ROOT_STATUS_CODE_ONLY => {}
            ROOT_STATUS_NEITHER => {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    NativeFailureCode::ControlLoss.diagnostic_code(),
                ))
            }
            ROOT_STATUS_SIGNAL_ONLY | ROOT_STATUS_BOTH => {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    NativeFailureCode::ControlLoss.diagnostic_code(),
                ))
            }
            _ => {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "root status branch tag is unsupported",
                ))
            }
        }
        Ok(Self {
            code: u32::from_be_bytes(bytes[1..5].try_into().expect("length checked")),
        })
    }

    /// The decimal rendering handed to the common contract. Always unsigned.
    pub fn unsigned_text(self) -> String {
        self.code.to_string()
    }
}

// ---------------------------------------------------------------------------------------------
// Journal / event vocabulary
// ---------------------------------------------------------------------------------------------

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u8)]
pub enum EventKind {
    Prepared = 1,
    Activated = 2,
    RootExited = 3,
    ExactScopeEmpty = 4,
}

pub const EVENT_VOCABULARY: [EventKind; 4] = [
    EventKind::Prepared,
    EventKind::Activated,
    EventKind::RootExited,
    EventKind::ExactScopeEmpty,
];

impl EventKind {
    pub fn name(self) -> &'static str {
        match self {
            Self::Prepared => "prepared",
            Self::Activated => "activated",
            Self::RootExited => "root-exited",
            Self::ExactScopeEmpty => "exact-scope-empty",
        }
    }

    pub fn from_name(value: &str) -> Option<Self> {
        EVENT_VOCABULARY.into_iter().find(|kind| kind.name() == value)
    }

    /// `exact-scope-empty` is terminal: after it the guardian flushes and exits, closing the
    /// last Job handle on an already-empty Job.
    pub fn is_terminal(self) -> bool {
        matches!(self, Self::ExactScopeEmpty)
    }
}

/// Kernel membership-message vocabulary. Distinct from [`EventKind`] on purpose: these are raw
/// completion-port messages about Job membership, not lifecycle records.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MembershipMessage {
    NewProcess(u32),
    ExitProcess(u32),
    AbnormalExitProcess(u32),
    ActiveProcessZero,
}

impl MembershipMessage {
    pub fn name(self) -> &'static str {
        match self {
            Self::NewProcess(_) => "new-process",
            Self::ExitProcess(_) => "exit-process",
            Self::AbnormalExitProcess(_) => "abnormal-exit-process",
            Self::ActiveProcessZero => "active-process-zero",
        }
    }

    pub fn process_id(self) -> Option<u32> {
        match self {
            Self::NewProcess(id) | Self::ExitProcess(id) | Self::AbnormalExitProcess(id) => {
                Some(id)
            }
            Self::ActiveProcessZero => None,
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Bounded primitives
// ---------------------------------------------------------------------------------------------

pub fn validate_text(value: &str, maximum: usize, empty: bool, label: &str) -> io::Result<()> {
    if value.len() > maximum || (!empty && value.is_empty()) || value.contains('\0') {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("{label} is malformed or exceeds its bound"),
        ));
    }
    Ok(())
}

pub fn put_string(
    output: &mut Vec<u8>,
    value: &str,
    maximum: usize,
    empty: bool,
) -> io::Result<()> {
    validate_text(value, maximum, empty, "string")?;
    output.extend_from_slice(&(value.len() as u32).to_be_bytes());
    output.extend_from_slice(value.as_bytes());
    Ok(())
}

pub fn put_bytes(output: &mut Vec<u8>, value: &[u8], maximum: usize) -> io::Result<()> {
    if value.len() > maximum {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "byte field exceeds its bound",
        ));
    }
    output.extend_from_slice(&(value.len() as u32).to_be_bytes());
    output.extend_from_slice(value);
    Ok(())
}

pub fn take_u16(input: &mut &[u8]) -> io::Result<u16> {
    if input.len() < 2 {
        return Err(io::Error::new(io::ErrorKind::UnexpectedEof, "missing u16"));
    }
    let value = u16::from_be_bytes(input[..2].try_into().expect("length checked"));
    *input = &input[2..];
    Ok(value)
}

pub fn take_u32(input: &mut &[u8]) -> io::Result<u32> {
    if input.len() < 4 {
        return Err(io::Error::new(io::ErrorKind::UnexpectedEof, "missing u32"));
    }
    let value = u32::from_be_bytes(input[..4].try_into().expect("length checked"));
    *input = &input[4..];
    Ok(value)
}

pub fn take_u64(input: &mut &[u8]) -> io::Result<u64> {
    if input.len() < 8 {
        return Err(io::Error::new(io::ErrorKind::UnexpectedEof, "missing u64"));
    }
    let value = u64::from_be_bytes(input[..8].try_into().expect("length checked"));
    *input = &input[8..];
    Ok(value)
}

pub fn take_string(input: &mut &[u8], maximum: usize, empty: bool) -> io::Result<String> {
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

pub fn take_bytes(input: &mut &[u8], maximum: usize) -> io::Result<Vec<u8>> {
    let length = take_u32(input)? as usize;
    if length > maximum || input.len() < length {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "bounded byte field length is invalid",
        ));
    }
    let value = input[..length].to_vec();
    *input = &input[length..];
    Ok(value)
}

/// A monotonic sequence guard. A repeated, skipped or reordered sequence number is an
/// `event-gap`, never a silently accepted record.
#[derive(Clone, Copy, Debug, Default)]
pub struct SequenceGuard {
    last: u64,
}

impl SequenceGuard {
    pub fn new() -> Self {
        Self { last: 0 }
    }

    pub fn last(&self) -> u64 {
        self.last
    }

    pub fn next(&mut self) -> u64 {
        self.last += 1;
        self.last
    }

    pub fn accept(&mut self, sequence: u64) -> io::Result<()> {
        if sequence != self.last + 1 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                format!(
                    "{}: expected sequence {} but observed {sequence}",
                    NativeFailureCode::EventGap.diagnostic_code(),
                    self.last + 1
                ),
            ));
        }
        self.last = sequence;
        Ok(())
    }
}

/// Operation identifiers are bounded opaque text minted by the caller.
pub fn validate_operation_id(value: &str) -> io::Result<()> {
    validate_text(value, MAX_OPERATION_BYTES, false, "operation id")
}

/// A canonical, deterministic rendering of an environment block for digesting.
pub fn canonical_environment(env: &BTreeMap<String, String>) -> io::Result<Vec<u8>> {
    if env.len() > MAX_ENVIRONMENT {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "environment exceeds its bound",
        ));
    }
    let mut output = Vec::new();
    output.extend_from_slice(&(env.len() as u32).to_be_bytes());
    for (key, value) in env {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_frame_vocabulary_contains_no_publication_frame() {
        // Task 5.6 / 7.11: activation must not be able to send a publish command, because the
        // durable publication phase is owned by the common publisher seam and the provider
        // ledger. The absence is asserted here so a future frame addition trips this test.
        for kind in FRAME_VOCABULARY {
            let name = kind.name();
            assert!(
                !name.contains("publish"),
                "frame vocabulary gained a publication frame: {name}"
            );
        }
        assert_eq!(FRAME_VOCABULARY.len(), 18);
    }

    #[test]
    fn unknown_frame_discriminants_are_rejected() {
        let known: Vec<u8> = FRAME_VOCABULARY.iter().map(|kind| *kind as u8).collect();
        for candidate in 0_u8..=255 {
            let decoded = FrameKind::try_from(candidate);
            if known.contains(&candidate) {
                assert!(decoded.is_ok(), "known frame {candidate} was rejected");
            } else {
                assert!(decoded.is_err(), "unknown frame {candidate} was accepted");
            }
        }
    }

    #[test]
    fn frames_round_trip_and_reject_oversize_payloads() {
        let frame = Frame::new(FrameKind::Observation, b"payload".to_vec()).expect("frame");
        let mut buffer = Vec::new();
        write_frame(&mut buffer, &frame).expect("write");
        let decoded = read_frame(&mut buffer.as_slice()).expect("read").expect("frame");
        assert_eq!(decoded, frame);
        assert!(Frame::new(FrameKind::Input, vec![0; MAX_FRAME_BYTES + 1]).is_err());
    }

    #[test]
    fn truncated_and_tampered_frames_fail_closed() {
        let frame = Frame::new(FrameKind::Attest, b"x".to_vec()).expect("frame");
        let mut buffer = Vec::new();
        write_frame(&mut buffer, &frame).expect("write");

        // Truncated header.
        assert!(read_frame(&mut &buffer[..6]).is_err());
        // Truncated payload.
        assert!(read_frame(&mut &buffer[..buffer.len() - 1]).is_err());
        // Wrong magic.
        let mut tampered = buffer.clone();
        tampered[0] = b'X';
        assert!(read_frame(&mut tampered.as_slice()).is_err());
        // Wrong protocol version.
        let mut tampered = buffer.clone();
        tampered[5] = 9;
        assert!(read_frame(&mut tampered.as_slice()).is_err());
        // Non-zero reserved byte.
        let mut tampered = buffer.clone();
        tampered[7] = 1;
        assert!(read_frame(&mut tampered.as_slice()).is_err());
        // Declared length beyond the bound.
        let mut tampered = buffer.clone();
        tampered[8..12].copy_from_slice(&((MAX_FRAME_BYTES + 1) as u32).to_be_bytes());
        assert!(read_frame(&mut tampered.as_slice()).is_err());
        // Empty input is end-of-stream, not corruption.
        assert!(read_frame(&mut [].as_slice()).expect("eof").is_none());
    }

    #[test]
    fn root_status_preserves_the_exact_unsigned_value() {
        for code in [0_u32, 1, 137, 259, 0x8000_0000, 0xC000_0005, u32::MAX] {
            let encoded = RootStatus { code }.encode();
            let decoded = RootStatus::decode(&encoded).expect("decode");
            assert_eq!(decoded.code, code);
        }
        assert_eq!(
            RootStatus { code: 0xC000_0005 }.unsigned_text(),
            "3221225477"
        );
        assert_ne!(
            RootStatus { code: 0xC000_0005 }.unsigned_text(),
            "-1073741819"
        );
    }

    #[test]
    fn a_root_status_with_both_branches_or_neither_is_rejected_as_control_loss() {
        // The contract requires exactly one non-null branch. This asserts the requirement, not
        // the encoder's current behaviour: the three rejected tags are constructed by hand.
        for tag in [ROOT_STATUS_NEITHER, ROOT_STATUS_SIGNAL_ONLY, ROOT_STATUS_BOTH] {
            let mut payload = vec![tag];
            payload.extend_from_slice(&7_u32.to_be_bytes());
            let error = RootStatus::decode(&payload).expect_err("must reject");
            assert_eq!(
                error.to_string(),
                NativeFailureCode::ControlLoss.diagnostic_code(),
                "tag {tag:#04x} was not classified as control-loss"
            );
        }
        // A sign-extended 64-bit encoding cannot even be parsed at the fixed width.
        let mut wide = vec![ROOT_STATUS_CODE_ONLY];
        wide.extend_from_slice(&(-1073741819_i64).to_be_bytes());
        assert!(RootStatus::decode(&wide).is_err());
    }

    #[test]
    fn the_sequence_guard_rejects_repeats_gaps_and_reordering() {
        let mut guard = SequenceGuard::new();
        guard.accept(1).expect("first");
        guard.accept(2).expect("second");
        assert!(guard.accept(2).is_err(), "duplicate accepted");
        assert!(guard.accept(4).is_err(), "gap accepted");
        assert!(guard.accept(1).is_err(), "reorder accepted");
        guard.accept(3).expect("third");
        assert_eq!(guard.last(), 3);
    }

    #[test]
    fn sequence_gap_errors_are_classified_as_event_gap() {
        let mut guard = SequenceGuard::new();
        let error = guard.accept(5).expect_err("gap");
        assert!(error
            .to_string()
            .starts_with(NativeFailureCode::EventGap.diagnostic_code()));
    }

    #[test]
    fn failure_codes_round_trip_and_reject_unknown_values() {
        for code in FAILURE_VOCABULARY {
            assert_eq!(NativeFailureCode::decode(&code.encode()).expect("decode"), code);
        }
        assert!(NativeFailureCode::decode(&[0, 1, 200]).is_err());
        assert!(NativeFailureCode::decode(&[9, 9, 1]).is_err());
        assert!(NativeFailureCode::decode(&[0, 1]).is_err());
    }

    #[test]
    fn bounded_primitives_reject_oversize_and_nul_bearing_text() {
        let mut output = Vec::new();
        assert!(put_string(&mut output, "ok", 8, false).is_ok());
        assert!(put_string(&mut output, "toolongtoolong", 4, false).is_err());
        assert!(put_string(&mut output, "", 8, false).is_err());
        assert!(put_string(&mut output, "a\0b", 8, false).is_err());

        let mut input = output.as_slice();
        assert_eq!(take_string(&mut input, 8, false).expect("ok"), "ok");

        let mut oversize = Vec::new();
        oversize.extend_from_slice(&9_u32.to_be_bytes());
        oversize.extend_from_slice(b"123456789");
        assert!(take_string(&mut oversize.as_slice(), 4, false).is_err());
    }

    #[test]
    fn the_event_vocabulary_is_closed_and_only_empty_is_terminal() {
        assert_eq!(EVENT_VOCABULARY.len(), 4);
        assert!(EventKind::from_name("prepared").is_some());
        assert!(EventKind::from_name("published").is_none());
        assert!(EventKind::from_name("publish").is_none());
        let terminal: Vec<_> = EVENT_VOCABULARY
            .into_iter()
            .filter(|kind| kind.is_terminal())
            .collect();
        assert_eq!(terminal, vec![EventKind::ExactScopeEmpty]);
    }
}
