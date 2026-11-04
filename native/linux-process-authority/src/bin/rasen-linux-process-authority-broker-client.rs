#[cfg(target_os = "linux")]
fn main() {
    if let Err(error) = client::run() {
        let _ = client::write_failure(&error);
        std::process::exit(70);
    }
}

#[cfg(target_os = "linux")]
mod client {
    use std::fs;
    use std::io::{self, Read, Write};
    use std::net::Shutdown;
    use std::os::unix::fs::MetadataExt;
    use std::path::{Path, PathBuf};

    use rasen_linux_process_authority::broker_client_transaction::{
        expect_code, fresh_deadline, fresh_request_until, parse_client_command, parse_phase_budget,
        parse_prepared_delivery_response, response_error, BrokerClientCommand,
        BrokerClientEndpoint,
    };
    use rasen_linux_process_authority::broker_guardian::{
        BrokerClientReference, BrokerPreparePayload,
    };
    use rasen_linux_process_authority::broker_install::{
        validate_root_owned_path, BrokerInstallLayout, BrokerPublicKeyManifest, SecurePathPolicy,
    };
    use rasen_linux_process_authority::broker_protocol::{
        BrokerOperation, BrokerPublicationBinding, BrokerResponse, BrokerResponseCode,
        PreparationDeliveryAcknowledgement, PreparationDeliveryBinding, PreparationDeliveryRequest,
    };
    use rasen_linux_process_authority::deadline::{poll_fd, AbsoluteMonotonicDeadline};
    use rasen_linux_process_authority::lifecycle::GuardianEvent;
    use rasen_linux_process_authority::primary::current_executable_digest;
    use rasen_linux_process_authority::protocol::{
        read_frame, write_frame, Frame, FrameKind, NativeFailure, NativeFailureCode,
    };
    use sha2::{Digest, Sha256};

    pub fn run() -> io::Result<()> {
        let arguments: Vec<String> = std::env::args().skip(1).collect();
        match parse_client_command(arguments.first().map(String::as_str).unwrap_or(""))? {
            BrokerClientCommand::Prepare => prepare(&arguments),
            BrokerClientCommand::RecoverPreparation => recover_preparation(&arguments),
            BrokerClientCommand::AcknowledgePreparation => acknowledge_preparation(&arguments),
            BrokerClientCommand::OpenRuntime => open_runtime(&arguments),
            BrokerClientCommand::RecordPublication => record_publication(&arguments),
            BrokerClientCommand::Activate => control(&arguments, Control::Activate),
            BrokerClientCommand::Inspect => control(&arguments, Control::Inspect),
            BrokerClientCommand::Abort => control(&arguments, Control::Abort),
            BrokerClientCommand::Terminate => control(&arguments, Control::Terminate),
        }
    }

    pub fn write_failure(error: &io::Error) -> io::Result<()> {
        let code = if error.to_string() == "broker-event-gap" {
            NativeFailureCode::EventGap
        } else {
            match error.kind() {
                io::ErrorKind::Unsupported => NativeFailureCode::Unavailable,
                io::ErrorKind::PermissionDenied => NativeFailureCode::IdentityDrift,
                io::ErrorKind::TimedOut => NativeFailureCode::Timeout,
                io::ErrorKind::NotFound
                | io::ErrorKind::ConnectionRefused
                | io::ErrorKind::ConnectionReset
                | io::ErrorKind::BrokenPipe
                | io::ErrorKind::UnexpectedEof => NativeFailureCode::ControlLoss,
                io::ErrorKind::InvalidData | io::ErrorKind::InvalidInput => {
                    NativeFailureCode::ReferenceInvalid
                }
                _ => NativeFailureCode::Uncertain,
            }
        };
        write_frame(
            &mut io::stdout().lock(),
            &Frame::new(FrameKind::Failure, NativeFailure { code }.encode().to_vec())?,
        )
    }

    fn prepare(arguments: &[String]) -> io::Result<()> {
        if arguments.len() != 7
            || arguments[1] != "--artifact-sha256"
            || arguments[3] != "--source-sha256"
            || arguments[5] != "--deadline-ms"
        {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "broker prepare requires pinned artifact and source digests",
            ));
        }
        let artifact_digest = decode_sha256(&arguments[2])?;
        let source_digest = decode_sha256(&arguments[4])?;
        let deadline_ms = parse_phase_budget(&arguments[6])?;
        let deadline = fresh_deadline(deadline_ms)?;
        if current_executable_digest()? != artifact_digest || artifact_digest == source_digest {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "broker client artifact identity differs from its pinned invocation",
            ));
        }
        let delivery = PreparationDeliveryRequest::decode(
            &one_input_until(FrameKind::Prepare, deadline)?.payload,
        )?;
        let payload = BrokerPreparePayload::decode(&delivery.prepare_payload)?;
        if payload.client_artifact_digest != artifact_digest
            || payload.client_source_digest != source_digest
            || payload.request.operation_id != delivery.binding.preparation_operation_id
            || payload.request.launch.digest()? != delivery.binding.launch_digest
        {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "broker preparation delivery differs from its pinned invocation",
            ));
        }
        let request = payload.request.clone();
        let response = call(BrokerOperation::Prepare, None, delivery.encode()?, deadline)?;
        parse_prepared_delivery_response(&response)?;
        let reference = BrokerClientReference::decode(&response.body)?;
        if reference.guardian.attestation.artifact_digest != artifact_digest
            || reference.guardian.attestation.source_digest != source_digest
            || reference.guardian.attestation.preparation_operation_id != request.operation_id
            || reference.guardian.attestation.launch_digest != request.launch.digest()?
            || reference.broker_key_id.iter().all(|byte| *byte == 0)
            || reference.broker_install_id.iter().all(|byte| *byte == 0)
        {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "broker prepared reference differs from the immutable request",
            ));
        }
        write_frame(
            &mut io::stdout().lock(),
            &Frame::new(FrameKind::Prepared, reference.encode()?)?,
        )
    }

    fn recover_preparation(arguments: &[String]) -> io::Result<()> {
        if arguments.len() != 3 || arguments[1] != "--deadline-ms" {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "broker preparation recovery arguments are malformed",
            ));
        }
        let deadline_ms = parse_phase_budget(&arguments[2])?;
        let deadline = fresh_deadline(deadline_ms)?;
        let binding = PreparationDeliveryBinding::decode(
            &one_input_until(FrameKind::Prepare, deadline)?.payload,
        )?;
        let response = call(
            BrokerOperation::RecoverPreparation,
            None,
            binding.encode()?,
            deadline,
        )?;
        parse_prepared_delivery_response(&response)?;
        BrokerClientReference::decode(&response.body)?;
        write_frame(
            &mut io::stdout().lock(),
            &Frame::new(FrameKind::Prepared, response.body)?,
        )
    }

    fn acknowledge_preparation(arguments: &[String]) -> io::Result<()> {
        let (runtime_root, _, deadline_ms) = control_arguments(arguments, Control::Inspect)?;
        let deadline = fresh_deadline(deadline_ms)?;
        let payload = one_input_until(FrameKind::Inspect, deadline)?.payload;
        if payload.len() < 5 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "broker preparation acknowledgement input is truncated",
            ));
        }
        let reference_length = u32::from_be_bytes(
            payload[..4]
                .try_into()
                .expect("acknowledgement reference prefix checked"),
        ) as usize;
        if reference_length == 0 || payload.len() <= 4 + reference_length {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "broker preparation acknowledgement reference length is invalid",
            ));
        }
        let reference_bytes = &payload[4..4 + reference_length];
        let reference = BrokerClientReference::decode(reference_bytes)?;
        validate_runtime_root(&reference, &runtime_root)?;
        let acknowledgement =
            PreparationDeliveryAcknowledgement::decode(&payload[4 + reference_length..])?;
        let exact_digest: [u8; 32] = Sha256::digest(reference_bytes).into();
        if acknowledgement.reference_digest != exact_digest
            || acknowledgement.binding.preparation_operation_id
                != reference.guardian.attestation.preparation_operation_id
            || acknowledgement.binding.launch_digest != reference.guardian.attestation.launch_digest
        {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "broker preparation acknowledgement differs from exact reference",
            ));
        }
        let response = call(
            BrokerOperation::AcknowledgePreparation,
            Some(&reference),
            acknowledgement.encode()?,
            deadline,
        )?;
        expect_code(&response, BrokerResponseCode::PreparationAcknowledged)?;
        write_frame(
            &mut io::stdout().lock(),
            &Frame::new(FrameKind::Observation, Vec::new())?,
        )
    }

    #[derive(Clone, Copy)]
    enum Control {
        Activate,
        Inspect,
        Abort,
        Terminate,
    }

    fn control(arguments: &[String], operation: Control) -> io::Result<()> {
        let (runtime_root, grace_ms, deadline_ms) = control_arguments(arguments, operation)?;
        let deadline = fresh_deadline(deadline_ms)?;
        let frame_kind = match operation {
            Control::Activate => FrameKind::Activate,
            Control::Inspect => FrameKind::Inspect,
            Control::Abort => FrameKind::Abort,
            Control::Terminate => FrameKind::Terminate,
        };
        let reference =
            BrokerClientReference::decode(&one_input_until(frame_kind, deadline)?.payload)?;
        validate_runtime_root(&reference, &runtime_root)?;
        let broker_operation = match operation {
            Control::Activate => BrokerOperation::Activate,
            Control::Inspect => BrokerOperation::Inspect,
            Control::Abort => BrokerOperation::Abort,
            Control::Terminate => BrokerOperation::Terminate { grace_ms },
        };
        let response = call(
            broker_operation,
            Some(&reference),
            reference.guardian.encode()?,
            deadline,
        )?;
        match operation {
            Control::Activate => {
                expect_code(&response, BrokerResponseCode::Activated)?;
                write_frame(
                    &mut io::stdout().lock(),
                    &Frame::new(FrameKind::Activated, Vec::new())?,
                )
            }
            Control::Inspect => write_inspection(response),
            Control::Abort | Control::Terminate => {
                expect_code(&response, BrokerResponseCode::ExactScopeEmpty)?;
                write_frame(
                    &mut io::stdout().lock(),
                    &Frame::new(FrameKind::ExactScopeEmpty, Vec::new())?,
                )
            }
        }
    }

    fn record_publication(arguments: &[String]) -> io::Result<()> {
        let (runtime_root, _, deadline_ms) = control_arguments(arguments, Control::Inspect)?;
        let deadline = fresh_deadline(deadline_ms)?;
        let payload = one_input_until(FrameKind::Inspect, deadline)?.payload;
        if payload.len() < 5 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "broker publication input is truncated",
            ));
        }
        let reference_length = u32::from_be_bytes(
            payload[..4]
                .try_into()
                .expect("publication prefix length checked"),
        ) as usize;
        if reference_length == 0 || payload.len() <= 4 + reference_length {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "broker publication reference length is invalid",
            ));
        }
        let reference = BrokerClientReference::decode(&payload[4..4 + reference_length])?;
        validate_runtime_root(&reference, &runtime_root)?;
        let binding = BrokerPublicationBinding::decode(&payload[4 + reference_length..])?;
        if binding.generation != reference.guardian.attestation.scope_id
            || binding.preparation_operation_id
                != reference.guardian.attestation.preparation_operation_id
            || binding.launch_digest != reference.guardian.attestation.launch_digest
        {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "broker publication binding differs from the prepared reference",
            ));
        }
        let response = call(
            BrokerOperation::RecordPublication,
            Some(&reference),
            binding.encode()?,
            deadline,
        )?;
        expect_code(&response, BrokerResponseCode::PublicationRecorded)?;
        write_frame(
            &mut io::stdout().lock(),
            &Frame::new(FrameKind::Observation, Vec::new())?,
        )
    }

    fn write_inspection(response: BrokerResponse) -> io::Result<()> {
        match response.code {
            BrokerResponseCode::Reopened => {
                GuardianEvent::decode_journal(&response.body)?;
                write_frame(
                    &mut io::stdout().lock(),
                    &Frame::new(FrameKind::Observation, response.body)?,
                )
            }
            BrokerResponseCode::ExactScopeEmpty => {
                GuardianEvent::decode_journal(&response.body)?;
                write_frame(
                    &mut io::stdout().lock(),
                    &Frame::new(FrameKind::ExactScopeEmpty, response.body)?,
                )
            }
            _ => Err(response_error(response.code)),
        }
    }

    fn open_runtime(arguments: &[String]) -> io::Result<()> {
        let (runtime_root, _, deadline_ms) = control_arguments(arguments, Control::Inspect)?;
        let deadline = fresh_deadline(deadline_ms)?;
        let reference = BrokerClientReference::decode(
            &one_input_until(FrameKind::OpenRuntime, deadline)?.payload,
        )?;
        validate_runtime_root(&reference, &runtime_root)?;
        let request = fresh_request_until(
            BrokerOperation::OpenRuntime,
            Some(reference.lease_token),
            Some(reference.request_capability()?),
            reference.guardian.encode()?,
            deadline,
        )?;
        let (mut stream, response) = endpoint()?.send(request)?;
        expect_code(&response, BrokerResponseCode::Reopened)?;
        stream.set_read_timeout(None)?;
        stream.set_write_timeout(None)?;
        write_frame(
            &mut io::stdout().lock(),
            &Frame::new(FrameKind::RuntimeReady, Vec::new())?,
        )?;
        io::stdout().flush()?;
        let mut writer = stream.try_clone()?;
        let upstream = std::thread::spawn(move || {
            let result = io::copy(&mut io::stdin().lock(), &mut writer);
            let _ = writer.shutdown(Shutdown::Write);
            result
        });
        io::copy(&mut stream, &mut io::stdout().lock())?;
        upstream
            .join()
            .map_err(|_| io::Error::other("broker client runtime bridge panicked"))??;
        Ok(())
    }

    fn call(
        operation: BrokerOperation,
        reference: Option<&BrokerClientReference>,
        body: Vec<u8>,
        deadline: AbsoluteMonotonicDeadline,
    ) -> io::Result<BrokerResponse> {
        endpoint()?.call_until(
            operation,
            reference.map(|value| value.lease_token),
            reference
                .map(BrokerClientReference::request_capability)
                .transpose()?,
            body,
            deadline,
        )
    }

    fn endpoint() -> io::Result<BrokerClientEndpoint> {
        let layout = BrokerInstallLayout::system_default();
        layout.validate()?;
        validate_root_owned_path(
            &layout.public_key_manifest,
            &SecurePathPolicy::root_file(0o644),
        )?;
        let manifest =
            BrokerPublicKeyManifest::decode(&fs::read_to_string(&layout.public_key_manifest)?)?;
        let socket = fs::metadata(&layout.socket)?;
        if socket.gid() == 0 {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "broker socket lacks a dedicated service group",
            ));
        }
        validate_root_owned_path(
            &layout.socket,
            &SecurePathPolicy::root_socket_for_group(socket.gid()),
        )?;
        BrokerClientEndpoint::new(layout.socket, manifest.pinned_identity()?, 0)
    }

    fn one_input_until(kind: FrameKind, deadline: AbsoluteMonotonicDeadline) -> io::Result<Frame> {
        let mut input = DeadlineStdin { deadline };
        let frame = read_frame(&mut input)?
            .ok_or_else(|| io::Error::new(io::ErrorKind::UnexpectedEof, "request absent"))?;
        if frame.kind != kind {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "broker client input operation differs",
            ));
        }
        Ok(frame)
    }

    struct DeadlineStdin {
        deadline: AbsoluteMonotonicDeadline,
    }

    impl Read for DeadlineStdin {
        fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
            if buffer.is_empty() {
                return Ok(0);
            }
            poll_fd(libc::STDIN_FILENO, libc::POLLIN, self.deadline)?;
            let count =
                unsafe { libc::read(libc::STDIN_FILENO, buffer.as_mut_ptr().cast(), buffer.len()) };
            if count < 0 {
                Err(io::Error::last_os_error())
            } else {
                Ok(count as usize)
            }
        }
    }

    fn control_arguments(
        arguments: &[String],
        operation: Control,
    ) -> io::Result<(PathBuf, u32, u32)> {
        let terminate = matches!(operation, Control::Terminate);
        if arguments.len() != if terminate { 7 } else { 5 }
            || arguments.get(1).map(String::as_str) != Some("--runtime-root")
        {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "broker control arguments are malformed",
            ));
        }
        let runtime_root = PathBuf::from(&arguments[2]);
        if !runtime_root.is_absolute() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "broker runtime root is not absolute",
            ));
        }
        let (grace_ms, deadline_index) = if terminate {
            if arguments[3] != "--grace-ms" {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "broker graceful interval argument is malformed",
                ));
            }
            (
                arguments[4].parse::<u32>().map_err(|_| {
                    io::Error::new(io::ErrorKind::InvalidInput, "broker grace is malformed")
                })?,
                5,
            )
        } else {
            (0, 3)
        };
        if arguments[deadline_index] != "--deadline-ms" {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "broker phase deadline argument is malformed",
            ));
        }
        let deadline_ms = parse_phase_budget(&arguments[deadline_index + 1])?;
        Ok((runtime_root, grace_ms, deadline_ms))
    }

    fn validate_runtime_root(
        reference: &BrokerClientReference,
        runtime_root: &Path,
    ) -> io::Result<()> {
        if reference.guardian.runtime_root != runtime_root {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "broker runtime root differs from the pinned reference",
            ));
        }
        Ok(())
    }

    fn decode_sha256(value: &str) -> io::Result<[u8; 32]> {
        if value.len() != 64 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "sha256 length is invalid",
            ));
        }
        let mut output = [0; 32];
        for (index, pair) in value.as_bytes().chunks_exact(2).enumerate() {
            output[index] = (lower_hex(pair[0])? << 4) | lower_hex(pair[1])?;
        }
        if output.iter().all(|byte| *byte == 0) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "sha256 is zero",
            ));
        }
        Ok(output)
    }

    fn lower_hex(value: u8) -> io::Result<u8> {
        match value {
            b'0'..=b'9' => Ok(value - b'0'),
            b'a'..=b'f' => Ok(value - b'a' + 10),
            _ => Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "sha256 is not canonical lowercase hex",
            )),
        }
    }
}

#[cfg(not(target_os = "linux"))]
fn main() {
    eprintln!("rasen Linux process-authority broker client is available only on Linux");
    std::process::exit(69);
}
