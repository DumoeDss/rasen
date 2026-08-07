#[cfg(target_os = "linux")]
fn main() {
    use std::io::{self, Write};
    use std::path::Path;

    use rasen_linux_process_authority::authority::PreparedAttestation;
    use rasen_linux_process_authority::deadline::AbsoluteMonotonicDeadline;
    use rasen_linux_process_authority::lifecycle::GuardianEvent;
    use rasen_linux_process_authority::primary::{
        prepare_primary_with_deadline_ms, AuthorityClient, AuthorityInspection,
    };
    use rasen_linux_process_authority::protocol::{
        read_frame, write_frame, Frame, FrameKind, NativeFailure, NativeFailureCode, PrepareRequest,
    };

    fn one_input(kind: FrameKind) -> io::Result<Frame> {
        let mut input = io::stdin().lock();
        let frame = read_frame(&mut input)?
            .ok_or_else(|| io::Error::new(io::ErrorKind::UnexpectedEof, "request frame absent"))?;
        if frame.kind != kind {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "helper request frame kind does not match its operation",
            ));
        }
        Ok(frame)
    }

    fn write_output(frame: Frame) -> io::Result<()> {
        write_frame(&mut io::stdout().lock(), &frame)
    }

    fn parse_reference(kind: FrameKind) -> io::Result<PreparedAttestation> {
        PreparedAttestation::decode(&one_input(kind)?.payload)
    }

    fn runtime_root<'a>(arguments: &'a [String], extra: usize) -> io::Result<&'a Path> {
        if arguments.len() != 3 + extra || arguments[1] != "--runtime-root" {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "control operation requires exactly one trusted --runtime-root",
            ));
        }
        Ok(Path::new(&arguments[2]))
    }

    fn bounded_u32(value: &str) -> io::Result<u32> {
        if value.is_empty() || !value.bytes().all(|byte| byte.is_ascii_digit()) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "control duration is not a bounded decimal u32",
            ));
        }
        value.parse().map_err(|_| {
            io::Error::new(
                io::ErrorKind::InvalidInput,
                "control duration is not a bounded decimal u32",
            )
        })
    }

    fn run(arguments: &[String]) -> io::Result<()> {
        let operation = arguments.first().map(String::as_str).unwrap_or("");
        if operation == "prepare" {
            if arguments.len() != 7
                || arguments[1] != "--artifact-sha256"
                || arguments[3] != "--source-sha256"
                || arguments[5] != "--deadline-ms"
            {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "prepare arguments are malformed",
                ));
            }
            let artifact_digest = decode_sha256(&arguments[2])?;
            let source_digest = decode_sha256(&arguments[4])?;
            let deadline_ms = bounded_u32(&arguments[6])?;
            let frame = one_input(FrameKind::Prepare)?;
            let request = PrepareRequest::decode(&frame.payload)?;
            let prepared = prepare_primary_with_deadline_ms(
                request,
                artifact_digest,
                source_digest,
                deadline_ms,
            )?;
            return write_output(Frame::new(
                FrameKind::Prepared,
                prepared.attestation.encode()?,
            )?);
        }

        let frame_kind = match operation {
            "open-runtime" => FrameKind::OpenRuntime,
            "activate" => FrameKind::Activate,
            "inspect" => FrameKind::Inspect,
            "abort" => FrameKind::Abort,
            "terminate" => FrameKind::Terminate,
            _ => {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "helper operation is unsupported",
                ))
            }
        };
        let extra = if operation == "terminate" { 4 } else { 2 };
        let root = runtime_root(arguments, extra)?;
        let reference = parse_reference(frame_kind)?;
        let client = AuthorityClient::new(root, reference)?;
        match operation {
            "open-runtime" => {
                if arguments[3] != "--deadline-ms" {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidInput,
                        "open-runtime requires exactly one --deadline-ms",
                    ));
                }
                bounded_u32(&arguments[4])?;
                let runtime = client.open_runtime()?.into_stream();
                write_output(Frame::new(FrameKind::RuntimeReady, Vec::new())?)?;
                let mut writer = runtime.try_clone()?;
                std::thread::spawn(move || {
                    let _ = io::copy(&mut io::stdin().lock(), &mut writer);
                    let _ = writer.shutdown(std::net::Shutdown::Write);
                });
                let mut reader = runtime;
                let mut output = io::stdout().lock();
                io::copy(&mut reader, &mut output)?;
                output.flush()
            }
            "activate" => {
                if arguments[3] != "--deadline-ms" {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidInput,
                        "activate requires exactly one --deadline-ms",
                    ));
                }
                client.activate_until(AbsoluteMonotonicDeadline::after_ms(bounded_u32(
                    &arguments[4],
                )?)?)?;
                write_output(Frame::new(FrameKind::Activated, Vec::new())?)
            }
            "inspect" => {
                if arguments[3] != "--deadline-ms" {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidInput,
                        "inspect requires exactly one --deadline-ms",
                    ));
                }
                bounded_u32(&arguments[4])?;
                let (kind, events) = match client.inspect_evidence()? {
                    AuthorityInspection::Events(events) => {
                        let kind = if events.last().map(|event| event.kind)
                            == Some(rasen_linux_process_authority::lifecycle::GuardianEventKind::ExactScopeEmpty)
                        {
                            FrameKind::ExactScopeEmpty
                        } else {
                            FrameKind::Observation
                        };
                        (kind, events)
                    }
                    AuthorityInspection::KernelExactEmptyRootResultLost(events) => {
                        (FrameKind::ExactScopeEmpty, events)
                    }
                };
                write_output(Frame::new(kind, GuardianEvent::encode_journal(&events)?)?)
            }
            "abort" => {
                if arguments[3] != "--deadline-ms" {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidInput,
                        "abort requires exactly one --deadline-ms",
                    ));
                }
                client.abort(bounded_u32(&arguments[4])?)?;
                write_output(Frame::new(FrameKind::ExactScopeEmpty, Vec::new())?)
            }
            "terminate" => {
                if arguments[3] != "--grace-ms" || arguments[5] != "--deadline-ms" {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidInput,
                        "terminate requires exact --grace-ms and --deadline-ms",
                    ));
                }
                bounded_u32(&arguments[6])?;
                client.terminate(bounded_u32(&arguments[4])?)?;
                write_output(Frame::new(FrameKind::ExactScopeEmpty, Vec::new())?)
            }
            _ => unreachable!("closed operation match"),
        }
    }

    let arguments: Vec<String> = std::env::args().skip(1).collect();
    if let Err(error) = run(&arguments) {
        let mut output = std::io::stdout().lock();
        let failure = NativeFailure {
            code: if arguments.first().map(String::as_str) == Some("prepare") {
                NativeFailureCode::from_prepare_error(&error)
            } else {
                NativeFailureCode::from_control_error(&error)
            },
        };
        let _ = write_frame(
            &mut output,
            &Frame::new(FrameKind::Failure, failure.encode().to_vec())
                .expect("fixed helper failure"),
        );
        std::process::exit(70);
    }
}

#[cfg(target_os = "linux")]
fn decode_sha256(value: &str) -> std::io::Result<[u8; 32]> {
    if value.len() != 64 {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "sha256 must contain exactly 64 lowercase hex digits",
        ));
    }
    let mut output = [0_u8; 32];
    for (index, pair) in value.as_bytes().chunks_exact(2).enumerate() {
        output[index] = (lower_hex(pair[0])? << 4) | lower_hex(pair[1])?;
    }
    if output.iter().all(|byte| *byte == 0) {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "sha256 cannot be all zero",
        ));
    }
    Ok(output)
}

#[cfg(target_os = "linux")]
fn lower_hex(value: u8) -> std::io::Result<u8> {
    match value {
        b'0'..=b'9' => Ok(value - b'0'),
        b'a'..=b'f' => Ok(value - b'a' + 10),
        _ => Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "sha256 must contain exactly 64 lowercase hex digits",
        )),
    }
}

#[cfg(not(target_os = "linux"))]
fn main() {
    eprintln!("rasen-linux-process-authority is available only on Linux");
    std::process::exit(69);
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::decode_sha256;

    #[test]
    fn sha256_cli_field_is_exact_and_lowercase() {
        assert_eq!(decode_sha256(&"ab".repeat(32)).unwrap(), [0xab; 32]);
        assert!(decode_sha256(&"AB".repeat(32)).is_err());
        assert!(decode_sha256(&"00".repeat(32)).is_err());
        assert!(decode_sha256("abc").is_err());
    }
}
