use std::io;
use std::net::Shutdown;
use std::os::fd::AsRawFd;
use std::os::unix::net::UnixStream;
use std::sync::Mutex;
use std::time::Duration;

use crate::broker_cgroup::CgroupKernel;
use crate::broker_lease::BrokerRequestRecord;
use crate::broker_protocol::{
    BrokerFrame, BrokerFrameKind, BrokerOperation, BrokerResponse, BrokerResponseCode,
    SigningBrokerIdentity,
};
use crate::broker_service::{
    BrokerPrepared, BrokerServiceCore, BrokerServiceResponse, GuardianRuntimeAuthority,
};
use crate::broker_supervisor::{BrokerMutationSupervisor, SupervisedBrokerDisposition};
use crate::broker_transport::accept_authenticated_request;
use crate::deadline::AbsoluteMonotonicDeadline;

/// Shipping daemon transaction engine shared by the installed binary and
/// process-loss oracles. It owns authentication, attempt replay, prepared
/// delivery commit ordering, response mapping, and response framing.
pub struct BrokerDaemonTransactions {
    request_locks: Vec<Mutex<()>>,
}

pub trait BrokerTransactionObserver {
    fn before_response(
        &self,
        _operation: BrokerOperation,
        _request_id: [u8; 16],
        _code: BrokerResponseCode,
        _body: &[u8],
    ) -> io::Result<()> {
        Ok(())
    }
}

impl Default for BrokerDaemonTransactions {
    fn default() -> Self {
        Self::new()
    }
}

impl BrokerDaemonTransactions {
    pub fn new() -> Self {
        Self {
            request_locks: (0..=u8::MAX).map(|_| Mutex::new(())).collect(),
        }
    }

    pub fn handle_one<G, K>(
        &self,
        stream: &mut UnixStream,
        signer: &SigningBrokerIdentity,
        service: &BrokerServiceCore<G, K>,
    ) -> io::Result<()>
    where
        G: GuardianRuntimeAuthority<Runtime = UnixStream>,
        K: CgroupKernel,
    {
        let (peer, hello, request) = accept_authenticated_request(stream, signer)?;
        if request.operation == BrokerOperation::OpenRuntime {
            return self.handle_runtime(stream, peer, hello.nonce, request, service);
        }
        let deadline = AbsoluteMonotonicDeadline::from_absolute_ns(request.deadline_monotonic_ns)?;
        let request_id = request.request_id;
        let request_for_worker = request.clone();
        let supervised = BrokerMutationSupervisor::execute_for_client(
            deadline,
            stream.as_raw_fd(),
            peer.pid,
            Duration::from_millis(750),
            || {
                let (code, body) =
                    self.execute_request(peer, hello.nonce, request_for_worker, service)?;
                encode_supervised_response(request_id, code, &body)
            },
        )?;
        match supervised.disposition {
            SupervisedBrokerDisposition::Completed => {
                let (completed_id, code, body) = decode_supervised_response(&supervised.bytes)?;
                if completed_id != request_id {
                    return Err(io::Error::new(
                        io::ErrorKind::PermissionDenied,
                        "broker mutation worker response identity drifted",
                    ));
                }
                write_response_after_commit(stream, request_id, code, body)
            }
            SupervisedBrokerDisposition::TimedOut => {
                if request.operation == BrokerOperation::Prepare {
                    let cleanup_request = request.clone();
                    let _ = BrokerMutationSupervisor::execute_without_client(deadline, || {
                        service.reconcile_pending_prepare(&cleanup_request)?;
                        Ok(Vec::new())
                    });
                }
                write_response_after_commit(
                    stream,
                    request_id,
                    BrokerResponseCode::Timeout,
                    Vec::new(),
                )
            }
            SupervisedBrokerDisposition::ClientGone => {
                if request.operation == BrokerOperation::Prepare {
                    let cleanup_request = request.clone();
                    let _ = BrokerMutationSupervisor::execute_without_client(deadline, || {
                        service.reconcile_pending_prepare(&cleanup_request)?;
                        Ok(Vec::new())
                    });
                }
                Ok(())
            }
        }
    }

    pub fn handle_one_observed<G, K, O>(
        &self,
        stream: &mut UnixStream,
        signer: &SigningBrokerIdentity,
        service: &BrokerServiceCore<G, K>,
        observer: &O,
    ) -> io::Result<()>
    where
        G: GuardianRuntimeAuthority<Runtime = UnixStream>,
        K: CgroupKernel,
        O: BrokerTransactionObserver,
    {
        let (peer, hello, request) = accept_authenticated_request(stream, signer)?;
        if request.operation == BrokerOperation::OpenRuntime {
            return self.handle_runtime(stream, peer, hello.nonce, request, service);
        }

        let request_id = request.request_id;
        let request_operation = request.operation;
        let (code, body) = self.execute_request(peer, hello.nonce, request, service)?;
        observer.before_response(request_operation, request_id, code, &body)?;
        write_response(stream, request_id, code, body)
    }

    fn execute_request<G, K>(
        &self,
        peer: crate::broker_protocol::PeerCredentials,
        authenticated_nonce: [u8; 32],
        request: crate::broker_protocol::BrokerRequest,
        service: &BrokerServiceCore<G, K>,
    ) -> io::Result<(BrokerResponseCode, Vec<u8>)>
    where
        G: GuardianRuntimeAuthority<Runtime = UnixStream>,
        K: CgroupKernel,
    {
        let _request_transaction = self.request_locks[request.request_id[0] as usize]
            .lock()
            .expect("broker request transaction lock");
        let request_id = request.request_id;
        let request_digest = request.replay_digest()?;
        let replayable = !matches!(request.operation, BrokerOperation::Probe);
        let pending = BrokerRequestRecord {
            request_id,
            request_digest,
            caller_uid: request.caller_uid,
            deadline_monotonic_ns: request.deadline_monotonic_ns,
            response_code: None,
            response_body: Vec::new(),
        };
        let replay_record = if replayable {
            if let Some(existing) = service.store().get_request(&request_id)? {
                if existing.request_digest != request_digest
                    || existing.caller_uid != request.caller_uid
                {
                    return Ok((BrokerResponseCode::IdentityDrift, Vec::new()));
                }
                if let Some(code) = existing.response_code {
                    return Ok((decode_response_code(code)?, existing.response_body));
                }
                if request.operation == BrokerOperation::Prepare
                    && service
                        .cgroups()
                        .deadline_from_absolute_ns(request.deadline_monotonic_ns)
                        .is_err()
                {
                    service.store().complete_request(
                        &existing,
                        BrokerResponseCode::Timeout as u8,
                        Vec::new(),
                    )?;
                    return Ok((BrokerResponseCode::Timeout, Vec::new()));
                }
                existing
            } else {
                service.store().put_request(&pending)?;
                pending.clone()
            }
        } else {
            pending.clone()
        };

        let service_response = service.handle(peer, authenticated_nonce, request);
        let (code, body, prepared) = match service_response {
            Ok(response) => {
                let prepared = match &response {
                    BrokerServiceResponse::Prepared(value) => Some(value.clone()),
                    _ => None,
                };
                let (code, body) = service_response_wire(response)?;
                (code, body, prepared)
            }
            Err(error) => (map_error(&error), Vec::new(), None),
        };
        if replayable {
            if let Some(prepared) = prepared.as_ref() {
                service.commit_prepared_delivery_until(
                    prepared,
                    AbsoluteMonotonicDeadline::from_absolute_ns(
                        replay_record.deadline_monotonic_ns,
                    )?,
                )?;
            }
            service
                .store()
                .complete_request(&replay_record, code as u8, body.clone())?;
        }
        Ok((code, body))
    }

    fn handle_runtime<G, K>(
        &self,
        stream: &mut UnixStream,
        peer: crate::broker_protocol::PeerCredentials,
        authenticated_nonce: [u8; 32],
        request: crate::broker_protocol::BrokerRequest,
        service: &BrokerServiceCore<G, K>,
    ) -> io::Result<()>
    where
        G: GuardianRuntimeAuthority<Runtime = UnixStream>,
        K: CgroupKernel,
    {
        let request_id = request.request_id;
        let mut runtime = match service.open_runtime(peer, authenticated_nonce, request) {
            Ok(runtime) => runtime,
            Err(error) => return write_response(stream, request_id, map_error(&error), Vec::new()),
        };
        write_response(stream, request_id, BrokerResponseCode::Reopened, Vec::new())?;
        stream.set_read_timeout(None)?;
        stream.set_write_timeout(None)?;
        runtime.set_read_timeout(None)?;
        runtime.set_write_timeout(None)?;
        bridge_runtime(stream, &mut runtime)
    }
}

fn encode_supervised_response(
    request_id: [u8; 16],
    code: BrokerResponseCode,
    body: &[u8],
) -> io::Result<Vec<u8>> {
    if body.len() > 64 * 1024 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "broker supervised response body exceeds its bound",
        ));
    }
    let mut output = Vec::with_capacity(21 + body.len());
    output.extend_from_slice(&request_id);
    output.push(code as u8);
    output.extend_from_slice(&(body.len() as u32).to_be_bytes());
    output.extend_from_slice(body);
    Ok(output)
}

fn decode_supervised_response(bytes: &[u8]) -> io::Result<([u8; 16], BrokerResponseCode, Vec<u8>)> {
    if bytes.len() < 21 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "broker supervised response is truncated",
        ));
    }
    let request_id = bytes[..16].try_into().expect("length checked");
    let code = decode_response_code(bytes[16])?;
    let length = u32::from_be_bytes(bytes[17..21].try_into().expect("length checked")) as usize;
    if length > 64 * 1024 || bytes.len() != 21 + length {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "broker supervised response length is invalid",
        ));
    }
    Ok((request_id, code, bytes[21..].to_vec()))
}

fn prepared_wire(prepared: &BrokerPrepared) -> io::Result<(BrokerResponseCode, Vec<u8>)> {
    Ok((
        BrokerResponseCode::Prepared,
        prepared.encode_client_reference()?,
    ))
}

pub fn service_response_wire(
    response: BrokerServiceResponse,
) -> io::Result<(BrokerResponseCode, Vec<u8>)> {
    Ok(match response {
        BrokerServiceResponse::Available => (BrokerResponseCode::Available, Vec::new()),
        BrokerServiceResponse::Prepared(prepared) => prepared_wire(&prepared)?,
        BrokerServiceResponse::PreparedDelivery(body) => (BrokerResponseCode::Prepared, body),
        BrokerServiceResponse::PreparationAcknowledged => {
            (BrokerResponseCode::PreparationAcknowledged, Vec::new())
        }
        BrokerServiceResponse::Reopened(phase) => (BrokerResponseCode::Reopened, vec![phase as u8]),
        BrokerServiceResponse::PublicationRecorded => {
            (BrokerResponseCode::PublicationRecorded, Vec::new())
        }
        BrokerServiceResponse::Activated => (BrokerResponseCode::Activated, Vec::new()),
        BrokerServiceResponse::Observed(events) => (BrokerResponseCode::Reopened, events),
        BrokerServiceResponse::ExactScopeEmpty(history) => {
            (BrokerResponseCode::ExactScopeEmpty, history)
        }
        BrokerServiceResponse::EventGap => (BrokerResponseCode::EventGap, Vec::new()),
    })
}

fn decode_response_code(value: u8) -> io::Result<BrokerResponseCode> {
    match value {
        1 => Ok(BrokerResponseCode::Available),
        2 => Ok(BrokerResponseCode::Prepared),
        3 => Ok(BrokerResponseCode::Reopened),
        4 => Ok(BrokerResponseCode::PublicationRecorded),
        5 => Ok(BrokerResponseCode::Activated),
        6 => Ok(BrokerResponseCode::ExactScopeEmpty),
        7 => Ok(BrokerResponseCode::PreparationAcknowledged),
        16 => Ok(BrokerResponseCode::AuthorityUnavailable),
        17 => Ok(BrokerResponseCode::IdentityDrift),
        18 => Ok(BrokerResponseCode::ControlLoss),
        19 => Ok(BrokerResponseCode::Timeout),
        20 => Ok(BrokerResponseCode::AuthorityUncertain),
        21 => Ok(BrokerResponseCode::EventGap),
        _ => Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "broker replay response code is invalid",
        )),
    }
}

fn write_response(
    stream: &mut UnixStream,
    request_id: [u8; 16],
    code: BrokerResponseCode,
    body: Vec<u8>,
) -> io::Result<()> {
    let response = BrokerResponse {
        request_id,
        code,
        body,
    };
    let kind = if is_failure(code) {
        BrokerFrameKind::Failure
    } else {
        BrokerFrameKind::Response
    };
    BrokerFrame::new(kind, response.encode()?)?.write_to(stream)
}

fn write_response_after_commit(
    stream: &mut UnixStream,
    request_id: [u8; 16],
    code: BrokerResponseCode,
    body: Vec<u8>,
) -> io::Result<()> {
    match write_response(stream, request_id, code, body) {
        Err(error)
            if matches!(
                error.kind(),
                io::ErrorKind::BrokenPipe
                    | io::ErrorKind::ConnectionReset
                    | io::ErrorKind::UnexpectedEof
            ) =>
        {
            Ok(())
        }
        result => result,
    }
}

pub fn map_error(error: &io::Error) -> BrokerResponseCode {
    match error.kind() {
        io::ErrorKind::TimedOut => BrokerResponseCode::Timeout,
        io::ErrorKind::PermissionDenied => BrokerResponseCode::IdentityDrift,
        io::ErrorKind::NotFound
        | io::ErrorKind::ConnectionRefused
        | io::ErrorKind::ConnectionReset
        | io::ErrorKind::BrokenPipe
        | io::ErrorKind::UnexpectedEof => BrokerResponseCode::ControlLoss,
        io::ErrorKind::Unsupported => BrokerResponseCode::AuthorityUnavailable,
        _ => BrokerResponseCode::AuthorityUncertain,
    }
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

fn bridge_runtime(client: &mut UnixStream, runtime: &mut UnixStream) -> io::Result<()> {
    let mut client_reader = client.try_clone()?;
    let mut runtime_writer = runtime.try_clone()?;
    let upstream = std::thread::spawn(move || {
        let result = io::copy(&mut client_reader, &mut runtime_writer);
        let _ = runtime_writer.shutdown(Shutdown::Write);
        result
    });
    io::copy(runtime, client)?;
    let _ = client.shutdown(Shutdown::Write);
    upstream
        .join()
        .map_err(|_| io::Error::other("broker runtime bridge thread panicked"))??;
    Ok(())
}
