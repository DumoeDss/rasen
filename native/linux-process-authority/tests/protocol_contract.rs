use std::collections::BTreeMap;
use std::io::{self, Cursor};
use std::path::PathBuf;

use rasen_linux_process_authority::protocol::{
    read_frame, write_frame, Frame, FrameKind, LaunchSpec, NativeFailure, NativeFailureCode,
    PrepareRequest, MAX_FRAME_BYTES, PROTOCOL_VERSION,
};

fn request() -> PrepareRequest {
    PrepareRequest {
        operation_id: "prepare-operation-1".to_owned(),
        runtime_root: PathBuf::from("/var/run/user/1000/rasen-authority"),
        launch: LaunchSpec {
            command: PathBuf::from("/usr/bin/node"),
            cwd: PathBuf::from("/work/project"),
            args: vec!["script.js".to_owned(), "--exact".to_owned()],
            env: BTreeMap::from([
                ("LANG".to_owned(), "C.UTF-8".to_owned()),
                ("TERM".to_owned(), "dumb".to_owned()),
            ]),
        },
    }
}

#[test]
fn native_failure_payload_is_closed_and_maps_to_frozen_diagnostic_codes() {
    let cases = [
        (NativeFailureCode::Unavailable, "native-unavailable"),
        (NativeFailureCode::Uncertain, "native-uncertain"),
        (NativeFailureCode::IdentityDrift, "identity-drift"),
        (NativeFailureCode::EventGap, "event-gap"),
        (NativeFailureCode::Timeout, "native-operation-timeout"),
        (NativeFailureCode::ControlLoss, "native-transport-lost"),
        (NativeFailureCode::ReferenceInvalid, "reference-invalid"),
        (
            NativeFailureCode::ArtifactUnavailable,
            "artifact-unavailable",
        ),
        (NativeFailureCode::StateRetained, "native-state-retained"),
    ];
    for (code, diagnostic) in cases {
        let exact = NativeFailure { code };
        assert_eq!(NativeFailure::decode(&exact.encode()).unwrap(), exact);
        assert_eq!(code.diagnostic_code(), diagnostic);
    }
    assert!(NativeFailure::decode(&[0, 1, 0xff]).is_err());
    assert!(NativeFailure::decode(&[0, 1, 1, 0]).is_err());
    assert_eq!(
        NativeFailureCode::from_control_error(&io::Error::new(
            io::ErrorKind::NotFound,
            "event-gap: exact namespace teardown is proven but root result was lost",
        )),
        NativeFailureCode::EventGap
    );
}

#[test]
fn closed_frame_round_trip_uses_distinct_magic_and_version() {
    let frame = Frame::new(FrameKind::Prepare, request().encode().unwrap()).unwrap();
    let mut encoded = Vec::new();
    write_frame(&mut encoded, &frame).unwrap();

    assert_eq!(&encoded[..4], b"RPA1");
    assert_eq!(
        u16::from_be_bytes([encoded[4], encoded[5]]),
        PROTOCOL_VERSION
    );
    assert_eq!(read_frame(&mut Cursor::new(encoded)).unwrap(), Some(frame));
}

#[test]
fn launch_decode_is_closed_bounded_and_immutable() {
    let exact = request();
    let encoded = exact.encode().unwrap();
    assert_eq!(PrepareRequest::decode(&encoded).unwrap(), exact);

    let mut trailing = encoded.clone();
    trailing.push(0);
    assert!(PrepareRequest::decode(&trailing).is_err());

    let mut relative = exact.clone();
    relative.launch.command = PathBuf::from("node");
    assert!(relative.encode().is_err());

    let mut invalid_env = exact;
    invalid_env
        .launch
        .env
        .insert("BAD=KEY".to_owned(), "value".to_owned());
    assert!(invalid_env.encode().is_err());
}

#[test]
fn frames_reject_unknown_reserved_truncated_and_oversize_input() {
    let mut unknown = Vec::from(&b"RPA1\0\x01\x7f\0\0\0\0\0"[..]);
    assert!(read_frame(&mut Cursor::new(&mut unknown)).is_err());

    let reserved = Vec::from(&b"RPA1\0\x01\x01\x01\0\0\0\0"[..]);
    assert!(read_frame(&mut Cursor::new(reserved)).is_err());

    let truncated = Vec::from(&b"RPA1\0\x01\x01\0\0\0\0\x04ab"[..]);
    assert!(read_frame(&mut Cursor::new(truncated)).is_err());

    let oversized = vec![0_u8; MAX_FRAME_BYTES + 1];
    assert!(Frame::new(FrameKind::Input, oversized).is_err());
}

#[test]
fn launch_digest_is_native_deterministic_and_sensitive_to_exact_launch() {
    let exact = request().launch;
    let digest = exact.digest().unwrap();
    assert!(digest.iter().any(|byte| *byte != 0));
    assert_eq!(digest, exact.clone().digest().unwrap());

    let mut changed = exact;
    changed.args.push("different".to_owned());
    assert_ne!(digest, changed.digest().unwrap());
}
