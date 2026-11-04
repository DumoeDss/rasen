use rasen_linux_process_authority::broker_protocol::{
    fresh_challenge_nonce, BrokerFrame, BrokerFrameKind, BrokerHello, BrokerOperation,
    BrokerRequest, ClientHello, PeerCredentials, PinnedBrokerIdentity,
    PreparationDeliveryAcknowledgement, PreparationDeliveryBinding, PreparationDeliveryRequest,
    SigningBrokerIdentity, MAX_BROKER_FRAME_BYTES, MAX_BROKER_TIMEOUT_MS,
};

fn caller() -> PeerCredentials {
    PeerCredentials {
        pid: 4242,
        uid: 1000,
        gid: 1000,
    }
}

#[test]
fn fresh_challenge_is_signed_for_the_exact_peer_and_pinned_key() {
    let signing = SigningBrokerIdentity::from_seed([7; 32]).unwrap();
    let pinned = PinnedBrokerIdentity::from_public_key(signing.public_key()).unwrap();
    let hello = ClientHello::new([3; 32], caller().uid).unwrap();
    let answer = signing.answer_challenge(&hello, caller()).unwrap();

    pinned
        .verify_challenge(&hello, &answer, caller(), PeerCredentials::root_broker(51))
        .unwrap();

    let other_nonce = ClientHello::new([4; 32], caller().uid).unwrap();
    assert!(pinned
        .verify_challenge(
            &other_nonce,
            &answer,
            caller(),
            PeerCredentials::root_broker(51),
        )
        .is_err());
    assert!(pinned
        .verify_challenge(
            &hello,
            &answer,
            caller(),
            PeerCredentials {
                pid: 51,
                uid: 1000,
                gid: 1000,
            },
        )
        .is_err());

    let other = SigningBrokerIdentity::from_seed([8; 32]).unwrap();
    let wrong_pin = PinnedBrokerIdentity::from_public_key(other.public_key()).unwrap();
    assert!(wrong_pin
        .verify_challenge(&hello, &answer, caller(), PeerCredentials::root_broker(51))
        .is_err());
}

#[test]
fn closed_request_codec_rejects_unknown_trailing_and_unbounded_inputs() {
    let request = BrokerRequest {
        request_id: [9; 16],
        challenge_nonce: [3; 32],
        caller_uid: 1000,
        deadline_monotonic_ns: 10_000_000_000,
        operation: BrokerOperation::Terminate { grace_ms: 250 },
        lease_token: Some([5; 32]),
        request_capability: Some([6; 32]),
        body: vec![1, 2, 3],
    };
    let encoded_request = request.encode().unwrap();
    assert_eq!(BrokerRequest::decode(&encoded_request).unwrap(), request);

    let frame = BrokerFrame::new(BrokerFrameKind::Request, encoded_request).unwrap();
    let encoded_frame = frame.encode().unwrap();
    assert_eq!(BrokerFrame::decode(&encoded_frame).unwrap(), frame);

    let mut trailing = encoded_frame.clone();
    trailing.push(0);
    assert!(BrokerFrame::decode(&trailing).is_err());

    let mut unknown_kind = encoded_frame;
    unknown_kind[6] = 99;
    assert!(BrokerFrame::decode(&unknown_kind).is_err());

    assert!(BrokerFrame::new(
        BrokerFrameKind::Response,
        vec![0; MAX_BROKER_FRAME_BYTES + 1],
    )
    .is_err());

    let missing_capability = BrokerRequest {
        request_capability: None,
        ..request.clone()
    };
    assert!(missing_capability.encode().is_err());

    let zero_grace = BrokerRequest {
        operation: BrokerOperation::Terminate { grace_ms: 0 },
        ..request.clone()
    };
    assert!(zero_grace.encode().is_ok());

    for grace_ms in [MAX_BROKER_TIMEOUT_MS + 1, u32::MAX] {
        let unbounded = BrokerRequest {
            operation: BrokerOperation::Terminate { grace_ms },
            ..request.clone()
        };
        assert!(unbounded.encode().is_err());
    }

    let mut unbounded_wire = request.encode().unwrap();
    // version + request id + nonce + uid + operation tag
    unbounded_wire[55..59].copy_from_slice(&u32::MAX.to_be_bytes());
    assert!(BrokerRequest::decode(&unbounded_wire).is_err());
}

#[test]
fn challenge_nonce_comes_from_the_os_and_is_nonzero_and_fresh() {
    let first = fresh_challenge_nonce().unwrap();
    let second = fresh_challenge_nonce().unwrap();
    assert_ne!(first, [0; 32]);
    assert_ne!(second, [0; 32]);
    assert_ne!(first, second);
}

#[test]
fn broker_hello_codec_does_not_accept_signature_shape_drift() {
    let signing = SigningBrokerIdentity::from_seed([7; 32]).unwrap();
    let hello = ClientHello::new([3; 32], caller().uid).unwrap();
    let answer = signing.answer_challenge(&hello, caller()).unwrap();
    let bytes = answer.encode().unwrap();
    assert_eq!(BrokerHello::decode(&bytes).unwrap(), answer);

    let mut truncated = bytes;
    truncated.pop();
    assert!(BrokerHello::decode(&truncated).is_err());
}

#[test]
fn prepared_delivery_binding_is_closed_and_derives_a_stable_non_secret_index() {
    let binding = PreparationDeliveryBinding {
        preparation_operation_id: "prepare:controller-owned-1".to_owned(),
        prepare_digest: [4; 32],
        launch_digest: [5; 32],
        recovery_capability: [6; 32],
    };
    let bytes = binding.encode().unwrap();
    assert_eq!(PreparationDeliveryBinding::decode(&bytes).unwrap(), binding);
    assert_eq!(
        binding.delivery_key(1000, &[7; 32], &[8; 32]).unwrap(),
        binding.delivery_key(1000, &[7; 32], &[8; 32]).unwrap()
    );
    assert_ne!(
        binding.delivery_key(1000, &[7; 32], &[8; 32]).unwrap(),
        binding.delivery_key(1001, &[7; 32], &[8; 32]).unwrap()
    );
    assert_eq!(
        binding.delivery_key(1000, &[7; 32], &[8; 32]).unwrap(),
        PreparationDeliveryBinding {
            prepare_digest: [9; 32],
            launch_digest: [10; 32],
            recovery_capability: [11; 32],
            ..binding.clone()
        }
        .delivery_key(1000, &[7; 32], &[8; 32])
        .unwrap(),
        "binding drift must address the same broker-owned operation index"
    );
    assert_ne!(
        binding.capability_hash().unwrap(),
        binding.recovery_capability
    );

    let mut trailing = bytes.clone();
    trailing.push(0);
    assert!(PreparationDeliveryBinding::decode(&trailing).is_err());
    assert!(PreparationDeliveryBinding {
        prepare_digest: [0; 32],
        ..binding.clone()
    }
    .encode()
    .is_err());
    assert!(PreparationDeliveryBinding {
        recovery_capability: [0; 32],
        ..binding
    }
    .encode()
    .is_err());
}

#[test]
fn prepared_delivery_prepare_and_ack_codecs_bind_the_exact_payload_and_reference() {
    let payload = b"closed-prepare-payload".to_vec();
    let binding = PreparationDeliveryBinding::for_prepare(
        "prepare:controller-owned-2".to_owned(),
        [5; 32],
        [6; 32],
        &payload,
    )
    .unwrap();
    let request = PreparationDeliveryRequest {
        binding: binding.clone(),
        prepare_payload: payload,
    };
    let bytes = request.encode().unwrap();
    assert_eq!(PreparationDeliveryRequest::decode(&bytes).unwrap(), request);

    let acknowledgement = PreparationDeliveryAcknowledgement {
        binding,
        reference_digest: [9; 32],
    };
    let ack = acknowledgement.encode().unwrap();
    assert_eq!(
        PreparationDeliveryAcknowledgement::decode(&ack).unwrap(),
        acknowledgement
    );

    let mut changed = request;
    changed.prepare_payload.push(0);
    assert!(changed.encode().is_err());
}
