use rasen_linux_process_authority::authority::{
    AuthorityIdentity, ControlOperation, ControlRequest, PreparedAttestation,
};

fn identity() -> AuthorityIdentity {
    AuthorityIdentity {
        boot_id: "11111111-2222-3333-4444-555555555555".to_owned(),
        guardian_pid: 4242,
        start_ticks: 987_654,
        pid_namespace_device: 4,
        pid_namespace_inode: 4_026_531_841,
    }
}

fn attestation() -> PreparedAttestation {
    PreparedAttestation {
        helper_protocol_version: 1,
        scope_id: [0x11; 16],
        scope_capability: [0x21; 32],
        control_capability: [0x22; 32],
        preparation_operation_id: "prepare-1".to_owned(),
        launch_digest: [0x33; 32],
        artifact_digest: [0x43; 32],
        source_digest: [0x44; 32],
        identity: identity(),
    }
}

#[test]
fn prepared_attestation_is_closed_versioned_and_round_trips() {
    let exact = attestation();
    let encoded = exact.encode().unwrap();
    assert_eq!(PreparedAttestation::decode(&encoded).unwrap(), exact);

    let mut trailing = encoded.clone();
    trailing.push(0);
    assert!(PreparedAttestation::decode(&trailing).is_err());

    let mut zero_pid = exact;
    zero_pid.identity.guardian_pid = 0;
    assert!(zero_pid.encode().is_err());

    let mut conflated = attestation();
    conflated.control_capability = conflated.scope_capability;
    assert!(conflated
        .encode()
        .unwrap_err()
        .to_string()
        .contains("capabilities are conflated"));
    let mut conflated_digest = attestation();
    conflated_digest.source_digest = conflated_digest.artifact_digest;
    assert!(conflated_digest
        .encode()
        .unwrap_err()
        .to_string()
        .contains("digests are conflated"));
}

#[test]
fn control_request_binds_capability_identity_and_closed_operation() {
    for operation in [
        ControlOperation::OpenRuntime,
        ControlOperation::Activate,
        ControlOperation::Inspect,
        ControlOperation::Abort,
        ControlOperation::Terminate { grace_ms: 750 },
    ] {
        let exact = ControlRequest {
            scope_capability: [0x54; 32],
            control_capability: [0x55; 32],
            identity: identity(),
            deadline_monotonic_ns: 123_456_789,
            operation,
        };
        assert_eq!(
            ControlRequest::decode(&exact.encode().unwrap()).unwrap(),
            exact
        );
    }

    let mut future = ControlRequest {
        scope_capability: [0x54; 32],
        control_capability: [0x55; 32],
        identity: identity(),
        deadline_monotonic_ns: 123_456_789,
        operation: ControlOperation::Inspect,
    }
    .encode()
    .unwrap();
    future[0] = 0;
    future[1] = 2;
    assert!(ControlRequest::decode(&future).is_err());

    let conflated = ControlRequest {
        scope_capability: [0x55; 32],
        control_capability: [0x55; 32],
        identity: identity(),
        deadline_monotonic_ns: 123_456_789,
        operation: ControlOperation::Inspect,
    };
    assert!(conflated.encode().is_err());
}

#[test]
fn attestation_never_contains_runtime_or_workload_paths() {
    let text = String::from_utf8_lossy(&attestation().encode().unwrap()).to_string();
    assert!(!text.contains("/work"));
    assert!(!text.contains("control.sock"));
    assert!(!text.contains("/usr/bin"));
}

#[test]
fn guardian_bootstrap_identity_has_a_dedicated_closed_codec() {
    let exact = identity();
    let encoded = exact.encode_standalone().unwrap();
    assert_eq!(
        AuthorityIdentity::decode_standalone(&encoded).unwrap(),
        exact
    );

    let mut trailing = encoded;
    trailing.push(0);
    assert!(AuthorityIdentity::decode_standalone(&trailing).is_err());
}
