use std::io;
use std::os::unix::net::UnixStream;
use std::path::{Path, PathBuf};

use crate::broker_protocol::{
    fresh_challenge_nonce, BrokerClientReferenceWire, BrokerFrame, BrokerFrameKind,
    BrokerOperation, BrokerRequest, BrokerResponse, BrokerResponseCode, ClientHello,
    PinnedBrokerIdentity,
};
use crate::broker_transport::authenticate_broker_for_uid;
use crate::deadline::AbsoluteMonotonicDeadline;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum BrokerClientCommand {
    Prepare,
    RecoverPreparation,
    AcknowledgePreparation,
    OpenRuntime,
    RecordPublication,
    Activate,
    Inspect,
    Abort,
    Terminate,
}

/// Closed operation-name parser used by the shipping CLI and subprocess
/// transaction oracle.
pub fn parse_client_command(value: &str) -> io::Result<BrokerClientCommand> {
    match value {
        "prepare" => Ok(BrokerClientCommand::Prepare),
        "recover-preparation" => Ok(BrokerClientCommand::RecoverPreparation),
        "acknowledge-preparation" => Ok(BrokerClientCommand::AcknowledgePreparation),
        "open-runtime" => Ok(BrokerClientCommand::OpenRuntime),
        "record-publication" => Ok(BrokerClientCommand::RecordPublication),
        "activate" => Ok(BrokerClientCommand::Activate),
        "inspect" => Ok(BrokerClientCommand::Inspect),
        "abort" => Ok(BrokerClientCommand::Abort),
        "terminate" => Ok(BrokerClientCommand::Terminate),
        _ => Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "broker client operation is unsupported",
        )),
    }
}

pub struct BrokerClientEndpoint {
    socket: PathBuf,
    pinned: PinnedBrokerIdentity,
    expected_broker_uid: u32,
}

impl BrokerClientEndpoint {
    pub fn new(
        socket: PathBuf,
        pinned: PinnedBrokerIdentity,
        expected_broker_uid: u32,
    ) -> io::Result<Self> {
        if !socket.is_absolute() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "broker client socket path is not absolute",
            ));
        }
        Ok(Self {
            socket,
            pinned,
            expected_broker_uid,
        })
    }

    pub fn call(
        &self,
        operation: BrokerOperation,
        lease_token: Option<[u8; 32]>,
        request_capability: Option<[u8; 32]>,
        body: Vec<u8>,
        deadline_ms: u32,
    ) -> io::Result<BrokerResponse> {
        self.call_until(
            operation,
            lease_token,
            request_capability,
            body,
            fresh_deadline(deadline_ms)?,
        )
    }

    pub fn call_until(
        &self,
        operation: BrokerOperation,
        lease_token: Option<[u8; 32]>,
        request_capability: Option<[u8; 32]>,
        body: Vec<u8>,
        deadline: AbsoluteMonotonicDeadline,
    ) -> io::Result<BrokerResponse> {
        let request =
            fresh_request_until(operation, lease_token, request_capability, body, deadline)?;
        self.call_request(request)
    }

    pub fn call_request(&self, mut request: BrokerRequest) -> io::Result<BrokerResponse> {
        let response = match self.send(request.clone()) {
            Ok((_stream, response)) => response,
            Err(error)
                if matches!(
                    error.kind(),
                    io::ErrorKind::TimedOut
                        | io::ErrorKind::UnexpectedEof
                        | io::ErrorKind::ConnectionReset
                        | io::ErrorKind::BrokenPipe
                ) && AbsoluteMonotonicDeadline::from_absolute_ns(
                    request.deadline_monotonic_ns,
                )
                .and_then(AbsoluteMonotonicDeadline::ensure_live)
                .is_ok() =>
            {
                request.challenge_nonce = fresh_challenge_nonce()?;
                self.send(request)?.1
            }
            Err(error) => return Err(error),
        };
        if is_failure(response.code) {
            Err(response_error(response.code))
        } else {
            Ok(response)
        }
    }

    pub fn send(&self, request: BrokerRequest) -> io::Result<(UnixStream, BrokerResponse)> {
        let mut stream = UnixStream::connect(&self.socket)?;
        let timeout = AbsoluteMonotonicDeadline::from_absolute_ns(request.deadline_monotonic_ns)?
            .remaining()?;
        stream.set_read_timeout(Some(timeout))?;
        stream.set_write_timeout(Some(timeout))?;
        let hello = ClientHello {
            nonce: request.challenge_nonce,
            claimed_uid: request.caller_uid,
        };
        authenticate_broker_for_uid(&mut stream, &self.pinned, &hello, self.expected_broker_uid)?;
        BrokerFrame::new(BrokerFrameKind::Request, request.encode()?)?.write_to(&mut stream)?;
        let frame = BrokerFrame::read_from(&mut stream)?.ok_or_else(|| {
            io::Error::new(io::ErrorKind::UnexpectedEof, "broker response is absent")
        })?;
        if !matches!(
            frame.kind,
            BrokerFrameKind::Response | BrokerFrameKind::Failure
        ) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "broker returned an unexpected frame kind",
            ));
        }
        let response = BrokerResponse::decode(&frame.payload)?;
        if response.request_id != request.request_id
            || (frame.kind == BrokerFrameKind::Failure) != is_failure(response.code)
        {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "broker response identity or disposition differs",
            ));
        }
        Ok((stream, response))
    }
}

pub fn fresh_request(
    operation: BrokerOperation,
    lease_token: Option<[u8; 32]>,
    request_capability: Option<[u8; 32]>,
    body: Vec<u8>,
    deadline_ms: u32,
) -> io::Result<BrokerRequest> {
    fresh_request_until(
        operation,
        lease_token,
        request_capability,
        body,
        fresh_deadline(deadline_ms)?,
    )
}

pub fn fresh_request_until(
    operation: BrokerOperation,
    lease_token: Option<[u8; 32]>,
    request_capability: Option<[u8; 32]>,
    body: Vec<u8>,
    deadline: AbsoluteMonotonicDeadline,
) -> io::Result<BrokerRequest> {
    let nonce = fresh_challenge_nonce()?;
    let request_random = fresh_challenge_nonce()?;
    let request = BrokerRequest {
        request_id: request_random[..16]
            .try_into()
            .expect("fixed random prefix"),
        challenge_nonce: nonce,
        caller_uid: unsafe { libc::geteuid() },
        deadline_monotonic_ns: deadline.absolute_ns()?,
        operation,
        lease_token,
        request_capability,
        body,
    };
    request.encode()?;
    Ok(request)
}

pub fn fresh_deadline(deadline_ms: u32) -> io::Result<AbsoluteMonotonicDeadline> {
    AbsoluteMonotonicDeadline::after_ms(deadline_ms)
}

pub fn parse_prepared_delivery_response(
    response: &BrokerResponse,
) -> io::Result<BrokerClientReferenceWire> {
    expect_code(response, BrokerResponseCode::Prepared)?;
    BrokerClientReferenceWire::decode(&response.body)
}

pub fn parse_phase_budget(value: &str) -> io::Result<u32> {
    value
        .parse::<u32>()
        .ok()
        .filter(|value| (1..=300_000).contains(value))
        .ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::InvalidInput,
                "broker phase budget is malformed",
            )
        })
}

pub fn expect_code(response: &BrokerResponse, expected: BrokerResponseCode) -> io::Result<()> {
    if response.code != expected {
        return Err(response_error(response.code));
    }
    Ok(())
}

pub fn is_failure(code: BrokerResponseCode) -> bool {
    matches!(
        code,
        BrokerResponseCode::AuthorityUnavailable
            | BrokerResponseCode::IdentityDrift
            | BrokerResponseCode::ControlLoss
            | BrokerResponseCode::Timeout
            | BrokerResponseCode::AuthorityUncertain
            | BrokerResponseCode::EventGap
    )
}

pub fn response_error(code: BrokerResponseCode) -> io::Error {
    let kind = match code {
        BrokerResponseCode::AuthorityUnavailable => io::ErrorKind::Unsupported,
        BrokerResponseCode::IdentityDrift => io::ErrorKind::PermissionDenied,
        BrokerResponseCode::ControlLoss => io::ErrorKind::ConnectionReset,
        BrokerResponseCode::Timeout => io::ErrorKind::TimedOut,
        BrokerResponseCode::AuthorityUncertain => io::ErrorKind::Other,
        BrokerResponseCode::EventGap => return io::Error::other("broker-event-gap"),
        _ => io::ErrorKind::InvalidData,
    };
    io::Error::new(kind, "broker returned a closed failure disposition")
}

pub fn validate_socket_path(path: &Path) -> io::Result<()> {
    if !path.is_absolute() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "broker client socket path is not absolute",
        ));
    }
    Ok(())
}
