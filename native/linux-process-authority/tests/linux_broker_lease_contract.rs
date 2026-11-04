use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use rasen_linux_process_authority::authority::AuthorityIdentity;
use rasen_linux_process_authority::broker_lease::{
    BrokerLease, BrokerPreparationDeliveryPhase, BrokerPreparationDeliveryRecord,
    BrokerRecoveryPhase, BrokerRecoveryRecord, BrokerRequestRecord, CgroupLeafIdentity,
    DurableLeaseStore, LeasePhase, LeaseTerminal, LeaseTerminalHistory, MAX_CLEANUP_TOMBSTONES,
    MAX_DELIVERY_RECORDS,
};

static NEXT: AtomicU64 = AtomicU64::new(1);

fn temp_root(label: &str) -> PathBuf {
    let path = std::env::temp_dir().join(format!(
        "rasen-broker-lease-{}-{}-{label}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    fs::create_dir(&path).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o700)).unwrap();
    }
    path
}

fn lease() -> BrokerLease {
    BrokerLease {
        token: [1; 32],
        request_capability: [2; 32],
        scope_id: [3; 16],
        preparation_operation_id: "prepare-lease-contract".to_owned(),
        launch_digest: [6; 32],
        caller_uid: 1000,
        broker_install_id: [4; 32],
        broker_key_id: [5; 32],
        guardian: AuthorityIdentity {
            boot_id: "7dc44f16-8f9d-4ad8-a233-44bbd0704848".to_owned(),
            guardian_pid: 4242,
            start_ticks: 777,
            pid_namespace_device: 4,
            pid_namespace_inode: 99,
        },
        cgroup: CgroupLeafIdentity {
            device: 8,
            inode: 1234,
        },
        phase: LeasePhase::Prepared,
        terminal: LeaseTerminal::Retained,
        publication_binding: None,
        terminal_history: LeaseTerminalHistory::None,
    }
}

fn recovery() -> BrokerRecoveryRecord {
    BrokerRecoveryRecord {
        recovery_id: [9; 32],
        request_id: [8; 16],
        request_digest: [7; 32],
        caller_uid: 1000,
        broker_install_id: [4; 32],
        broker_key_id: [5; 32],
        phase: BrokerRecoveryPhase::Intent,
        scope_id: None,
        guardian: None,
        client_reference: Vec::new(),
        cgroup: None,
    }
}

fn delivery() -> BrokerPreparationDeliveryRecord {
    BrokerPreparationDeliveryRecord {
        delivery_key: [10; 32],
        caller_uid: 1000,
        preparation_operation_id: "prepare-lease-contract".to_owned(),
        prepare_digest: [11; 32],
        launch_digest: [6; 32],
        broker_install_id: [4; 32],
        broker_key_id: [5; 32],
        capability_hash: [12; 32],
        original_deadline_monotonic_ns: 123_456,
        phase: BrokerPreparationDeliveryPhase::Intent,
        recovery_id: None,
        lease_token: None,
        response_body: Vec::new(),
        reference_digest: None,
    }
}

#[test]
fn durable_lease_codec_is_closed_and_binds_every_destructive_identity() {
    let value = lease();
    let bytes = value.encode().unwrap();
    assert_eq!(BrokerLease::decode(&bytes).unwrap(), value);

    let mut corrupted = bytes.clone();
    corrupted[40] ^= 1;
    assert!(BrokerLease::decode(&corrupted).is_err());

    let mut trailing = bytes;
    trailing.push(0);
    assert!(BrokerLease::decode(&trailing).is_err());

    let conflated = BrokerLease {
        request_capability: [1; 32],
        ..lease()
    };
    assert!(conflated.encode().is_err());
}

#[test]
fn broker_restart_recovers_the_same_token_and_leaf_inode() {
    let root = temp_root("restart");
    let store = DurableLeaseStore::open_for_current_owner(&root).unwrap();
    store.put(&lease()).unwrap();
    drop(store);

    let replacement = DurableLeaseStore::open_for_current_owner(&root).unwrap();
    assert_eq!(replacement.get(&[1; 32]).unwrap(), Some(lease()));
    replacement.put(&lease()).unwrap();
    assert_eq!(replacement.load_all().unwrap(), vec![lease()]);

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn token_collision_and_corrupt_crash_record_fail_closed() {
    let root = temp_root("collision");
    let store = DurableLeaseStore::open_for_current_owner(&root).unwrap();
    store.put(&lease()).unwrap();

    let collision = BrokerLease {
        caller_uid: 2000,
        ..lease()
    };
    assert!(store.put(&collision).is_err());

    let path = store.path_for_token(&[1; 32]);
    let mut bytes = fs::read(&path).unwrap();
    bytes[60] ^= 1;
    fs::write(&path, bytes).unwrap();
    assert!(store.get(&[1; 32]).is_err());
    assert!(path.exists());

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn lease_is_deleted_only_after_an_exact_empty_terminal_record() {
    let root = temp_root("terminal");
    let store = DurableLeaseStore::open_for_current_owner(&root).unwrap();
    store.put(&lease()).unwrap();
    assert!(store.remove_terminal(&lease()).is_err());
    assert!(store.get(&[1; 32]).unwrap().is_some());

    let terminal = BrokerLease {
        phase: LeasePhase::ExactScopeEmpty,
        terminal: LeaseTerminal::ExactEmpty,
        terminal_history: LeaseTerminalHistory::EventGap,
        ..lease()
    };
    store.replace(&lease(), &terminal).unwrap();
    store.remove_terminal(&terminal).unwrap();
    assert!(store.get(&[1; 32]).unwrap().is_none());

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn cleanup_complete_is_a_durable_idempotent_tombstone() {
    let root = temp_root("tombstone");
    let store = DurableLeaseStore::open_for_current_owner(&root).unwrap();
    store.put(&lease()).unwrap();
    let empty = BrokerLease {
        phase: LeasePhase::ExactScopeEmpty,
        terminal: LeaseTerminal::ExactEmpty,
        terminal_history: LeaseTerminalHistory::EventGap,
        ..lease()
    };
    store.replace(&lease(), &empty).unwrap();
    let tombstone = BrokerLease {
        phase: LeasePhase::CleanupComplete,
        ..empty.clone()
    };
    store.replace(&empty, &tombstone).unwrap();
    drop(store);

    let replacement = DurableLeaseStore::open_for_current_owner(&root).unwrap();
    assert_eq!(replacement.get(&[1; 32]).unwrap(), Some(tombstone));

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn cleanup_tombstones_are_pruned_by_a_closed_nonzero_retention_bound() {
    let root = temp_root("tombstone-prune");
    let store = DurableLeaseStore::open_for_current_owner(&root).unwrap();
    for marker in [10_u8, 11, 12] {
        let tombstone = BrokerLease {
            token: [marker; 32],
            request_capability: [marker + 32; 32],
            scope_id: [marker; 16],
            phase: LeasePhase::CleanupComplete,
            terminal: LeaseTerminal::ExactEmpty,
            terminal_history: LeaseTerminalHistory::EventGap,
            ..lease()
        };
        store.put(&tombstone).unwrap();
    }
    assert_eq!(store.prune_cleanup_tombstones(2).unwrap(), 1);
    let retained = store.load_all().unwrap();
    assert_eq!(retained.len(), 2);
    assert!(retained
        .iter()
        .all(|lease| lease.phase == LeasePhase::CleanupComplete));
    assert!(store.prune_cleanup_tombstones(0).is_err());
    assert!(store
        .prune_cleanup_tombstones(MAX_CLEANUP_TOMBSTONES + 1)
        .is_err());

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn provisional_recovery_is_durable_before_guardian_and_leaf_construction() {
    let root = temp_root("provisional");
    let store = DurableLeaseStore::open_for_current_owner(&root).unwrap();
    let intent = recovery();
    store.put_recovery(&intent).unwrap();

    let guardian = BrokerRecoveryRecord {
        phase: BrokerRecoveryPhase::GuardianPrepared,
        scope_id: Some([3; 16]),
        guardian: Some(lease().guardian),
        client_reference: b"guardian-ref".to_vec(),
        ..intent.clone()
    };
    store.replace_recovery(&intent, &guardian).unwrap();
    let creating = BrokerRecoveryRecord {
        phase: BrokerRecoveryPhase::LeafCreating,
        ..guardian.clone()
    };
    store.replace_recovery(&guardian, &creating).unwrap();
    let leaf = BrokerRecoveryRecord {
        phase: BrokerRecoveryPhase::LeafPrepared,
        cgroup: Some(lease().cgroup),
        ..creating.clone()
    };
    store.replace_recovery(&creating, &leaf).unwrap();

    drop(store);
    let replacement = DurableLeaseStore::open_for_current_owner(&root).unwrap();
    assert_eq!(replacement.load_recoveries().unwrap(), vec![leaf.clone()]);
    assert!(replacement.load_all().unwrap().is_empty());
    replacement.remove_recovery(&leaf).unwrap();
    assert!(replacement.load_recoveries().unwrap().is_empty());

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn request_replay_records_are_closed_durable_and_bounded() {
    let root = temp_root("request-replay");
    let store = DurableLeaseStore::open_for_current_owner(&root).unwrap();
    let pending = BrokerRequestRecord {
        request_id: [8; 16],
        request_digest: [7; 32],
        caller_uid: 1000,
        deadline_monotonic_ns: 1,
        response_code: None,
        response_body: Vec::new(),
    };
    store.put_request(&pending).unwrap();
    let complete = store
        .complete_request(&pending, 6, b"terminal-journal".to_vec())
        .unwrap();
    assert_eq!(store.get_request(&[8; 16]).unwrap(), Some(complete.clone()));
    assert_eq!(store.load_requests().unwrap(), vec![complete]);
    assert!(store.prune_completed_requests(0).is_err());

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn prepared_delivery_survives_restart_and_request_record_pruning_until_exact_ack() {
    let root = temp_root("prepared-delivery");
    let store = DurableLeaseStore::open_for_current_owner(&root).unwrap();
    let intent = delivery();
    store.put_delivery(&intent).unwrap();
    let preparing = BrokerPreparationDeliveryRecord {
        phase: BrokerPreparationDeliveryPhase::Preparing,
        recovery_id: Some([9; 32]),
        ..intent.clone()
    };
    store.replace_delivery(&intent, &preparing).unwrap();
    let pending = BrokerPreparationDeliveryRecord {
        phase: BrokerPreparationDeliveryPhase::PreparedPendingAck,
        lease_token: Some([1; 32]),
        response_body: b"byte-identical-prepared-reference".to_vec(),
        reference_digest: Some([13; 32]),
        ..preparing.clone()
    };
    store.replace_delivery(&preparing, &pending).unwrap();

    let attempt = BrokerRequestRecord {
        request_id: [8; 16],
        request_digest: [7; 32],
        caller_uid: 1000,
        deadline_monotonic_ns: 123_456,
        response_code: None,
        response_body: Vec::new(),
    };
    store.put_request(&attempt).unwrap();
    store
        .complete_request(&attempt, 2, pending.response_body.clone())
        .unwrap();
    store.prune_completed_requests(1).unwrap();
    drop(store);

    let replacement = DurableLeaseStore::open_for_current_owner(&root).unwrap();
    assert_eq!(
        replacement.get_delivery(&[10; 32]).unwrap(),
        Some(pending.clone())
    );
    let delivered = BrokerPreparationDeliveryRecord {
        phase: BrokerPreparationDeliveryPhase::Delivered,
        response_body: Vec::new(),
        ..pending.clone()
    };
    replacement.replace_delivery(&pending, &delivered).unwrap();
    assert_eq!(
        replacement.get_delivery(&[10; 32]).unwrap(),
        Some(delivered)
    );

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn exact_abort_reconciles_a_prepared_pending_ack_delivery_without_controller_ack() {
    let root = temp_root("pending-delivery-exact-abort");
    let store = DurableLeaseStore::open_for_current_owner(&root).unwrap();
    let retained = lease();
    store.put(&retained).unwrap();
    let intent = delivery();
    store.put_delivery(&intent).unwrap();
    let preparing = BrokerPreparationDeliveryRecord {
        phase: BrokerPreparationDeliveryPhase::Preparing,
        recovery_id: Some([9; 32]),
        ..intent.clone()
    };
    store.replace_delivery(&intent, &preparing).unwrap();
    let pending = BrokerPreparationDeliveryRecord {
        phase: BrokerPreparationDeliveryPhase::PreparedPendingAck,
        lease_token: Some(retained.token),
        response_body: b"unacknowledged-prepared-reference".to_vec(),
        reference_digest: Some([13; 32]),
        ..preparing.clone()
    };
    store.replace_delivery(&preparing, &pending).unwrap();

    let exact_empty = BrokerLease {
        phase: LeasePhase::ExactScopeEmpty,
        terminal: LeaseTerminal::ExactEmpty,
        terminal_history: LeaseTerminalHistory::EventGap,
        ..retained.clone()
    };
    store.replace(&retained, &exact_empty).unwrap();
    let cleanup_complete = BrokerLease {
        phase: LeasePhase::CleanupComplete,
        ..exact_empty.clone()
    };
    store.replace(&exact_empty, &cleanup_complete).unwrap();

    assert!(store
        .reconcile_terminal_delivery(&cleanup_complete)
        .unwrap());
    let reconciled = store.get_delivery(&pending.delivery_key).unwrap().unwrap();
    assert_eq!(reconciled.phase, BrokerPreparationDeliveryPhase::Reconciled);
    assert_eq!(reconciled.lease_token, None);
    assert!(reconciled.response_body.is_empty());
    assert_eq!(reconciled.reference_digest, None);
    assert!(!store
        .reconcile_terminal_delivery(&cleanup_complete)
        .unwrap());

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn concurrent_delivery_capacity_is_reserved_before_any_new_active_record_is_created() {
    let root = temp_root("delivery-capacity");
    let store = Arc::new(DurableLeaseStore::open_for_current_owner(&root).unwrap());
    for marker in 1..MAX_DELIVERY_RECORDS {
        let value = BrokerPreparationDeliveryRecord {
            delivery_key: [marker as u8; 32],
            preparation_operation_id: format!("prepare-capacity-{marker}"),
            ..delivery()
        };
        store.put_delivery(&value).unwrap();
    }
    let barrier = Arc::new(std::sync::Barrier::new(3));
    let workers: Vec<_> = [201_u8, 202]
        .into_iter()
        .map(|marker| {
            let store = Arc::clone(&store);
            let barrier = Arc::clone(&barrier);
            std::thread::spawn(move || {
                let value = BrokerPreparationDeliveryRecord {
                    delivery_key: [marker; 32],
                    preparation_operation_id: format!("prepare-capacity-{marker}"),
                    ..delivery()
                };
                barrier.wait();
                store.put_delivery(&value)
            })
        })
        .collect();
    barrier.wait();
    let results: Vec<_> = workers
        .into_iter()
        .map(|worker| worker.join().unwrap())
        .collect();
    assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
    assert_eq!(
        results
            .iter()
            .filter(|result| result
                .as_ref()
                .is_err_and(|error| error.kind() == std::io::ErrorKind::OutOfMemory))
            .count(),
        1
    );
    assert_eq!(store.load_deliveries().unwrap().len(), MAX_DELIVERY_RECORDS);

    drop(store);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn more_than_sixty_four_terminal_and_failed_operations_reclaim_capacity_across_restart() {
    let root = temp_root("delivery-lifetime-capacity");
    let store = DurableLeaseStore::open_for_current_owner(&root).unwrap();
    for marker in 1_u8..=80 {
        let terminal = BrokerLease {
            token: [marker; 32],
            request_capability: [marker.wrapping_add(100); 32],
            scope_id: [marker; 16],
            preparation_operation_id: format!("prepare-complete-{marker}"),
            launch_digest: [marker.wrapping_add(1); 32],
            guardian: AuthorityIdentity {
                guardian_pid: 4_242 + u32::from(marker),
                start_ticks: 777 + u64::from(marker),
                pid_namespace_inode: 99 + u64::from(marker),
                ..lease().guardian
            },
            cgroup: CgroupLeafIdentity {
                device: 8,
                inode: 1_234 + u64::from(marker),
            },
            phase: LeasePhase::CleanupComplete,
            terminal: LeaseTerminal::ExactEmpty,
            terminal_history: LeaseTerminalHistory::EventGap,
            ..lease()
        };
        store.put(&terminal).unwrap();
        let reconciled = BrokerPreparationDeliveryRecord {
            delivery_key: [marker; 32],
            preparation_operation_id: terminal.preparation_operation_id.clone(),
            prepare_digest: [marker.wrapping_add(2); 32],
            launch_digest: terminal.launch_digest,
            capability_hash: [marker.wrapping_add(3); 32],
            original_deadline_monotonic_ns: 123_456 + u64::from(marker),
            phase: BrokerPreparationDeliveryPhase::Reconciled,
            ..delivery()
        };
        store.put_delivery(&reconciled).unwrap();
    }
    assert!(store.load_deliveries().unwrap().len() <= MAX_DELIVERY_RECORDS);
    drop(store);

    let replacement = DurableLeaseStore::open_for_current_owner(&root).unwrap();
    for marker in 81_u8..=160 {
        let reconciled = BrokerPreparationDeliveryRecord {
            delivery_key: [marker; 32],
            preparation_operation_id: format!("prepare-failed-{marker}"),
            prepare_digest: [marker.wrapping_add(2); 32],
            launch_digest: [marker.wrapping_add(1); 32],
            capability_hash: [marker.wrapping_add(3); 32],
            original_deadline_monotonic_ns: 223_456 + u64::from(marker),
            phase: BrokerPreparationDeliveryPhase::Reconciled,
            ..delivery()
        };
        replacement.put_delivery(&reconciled).unwrap();
    }
    let deliveries = replacement.load_deliveries().unwrap();
    assert!(deliveries.len() <= MAX_DELIVERY_RECORDS);
    let latest = deliveries
        .iter()
        .find(|record| record.preparation_operation_id == "prepare-failed-160")
        .unwrap()
        .clone();
    let conflicting = BrokerPreparationDeliveryRecord {
        prepare_digest: [200; 32],
        ..latest
    };
    assert_eq!(
        replacement.put_delivery(&conflicting).unwrap_err().kind(),
        std::io::ErrorKind::AlreadyExists
    );

    let removed = replacement
        .clear_authenticated_terminal_state([4; 32], [5; 32])
        .unwrap();
    assert_eq!(removed.0, 80);
    assert_eq!(removed.1, 0);
    assert!(fs::read_dir(&root).unwrap().next().is_none());

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn uninstall_cleanup_accepts_only_authenticated_terminal_state() {
    let retained_root = temp_root("uninstall-retained");
    let retained = DurableLeaseStore::open_for_current_owner(&retained_root).unwrap();
    retained.put(&lease()).unwrap();
    assert!(retained
        .clear_authenticated_terminal_state([4; 32], [5; 32])
        .is_err());
    fs::remove_dir_all(retained_root).unwrap();

    let root = temp_root("uninstall-terminal");
    let store = DurableLeaseStore::open_for_current_owner(&root).unwrap();
    let tombstone = BrokerLease {
        phase: LeasePhase::CleanupComplete,
        terminal: LeaseTerminal::ExactEmpty,
        terminal_history: LeaseTerminalHistory::EventGap,
        ..lease()
    };
    store.put(&tombstone).unwrap();
    let pending = BrokerRequestRecord {
        request_id: [8; 16],
        request_digest: [7; 32],
        caller_uid: 1000,
        deadline_monotonic_ns: 1,
        response_code: None,
        response_body: Vec::new(),
    };
    store.put_request(&pending).unwrap();
    assert!(store
        .clear_authenticated_terminal_state([4; 32], [5; 32])
        .is_err());
    store.complete_request(&pending, 6, Vec::new()).unwrap();
    store.with_token_lock(&tombstone.token, || Ok(())).unwrap();
    assert_eq!(
        store
            .clear_authenticated_terminal_state([4; 32], [5; 32])
            .unwrap(),
        (1, 1, 2)
    );
    assert!(fs::read_dir(&root).unwrap().next().is_none());

    fs::remove_dir_all(root).unwrap();
}
