use rasen_linux_process_authority::lifecycle::{
    GuardianEvent, GuardianEventKind, GuardianMachine, GuardianObservation, RootExit,
};

#[cfg(target_os = "linux")]
use std::fs::{self, File};
#[cfg(target_os = "linux")]
use std::os::unix::fs::PermissionsExt;

#[cfg(target_os = "linux")]
use rasen_linux_process_authority::authority::AuthorityIdentity;
#[cfg(target_os = "linux")]
use rasen_linux_process_authority::journal::{DurableJournal, JournalBinding};
#[cfg(target_os = "linux")]
use rasen_linux_process_authority::runtime::PrivateScope;

#[cfg(target_os = "linux")]
mod support;

#[test]
fn activation_is_exactly_once_and_publication_is_not_a_native_event() {
    let mut machine = GuardianMachine::prepared();
    assert_eq!(machine.observe(), GuardianObservation::Inert);
    assert_eq!(machine.activate().unwrap().sequence, 2);
    assert!(machine.activate().is_err());
    assert_eq!(machine.observe(), GuardianObservation::Live);

    let kinds: Vec<_> = machine.events().iter().map(|event| event.kind).collect();
    assert_eq!(
        kinds,
        vec![GuardianEventKind::Prepared, GuardianEventKind::Activated]
    );
    assert!(!format!("{kinds:?}").contains("Published"));
}

#[test]
fn root_exit_is_exact_and_does_not_imply_empty() {
    let mut machine = GuardianMachine::prepared();
    machine.activate().unwrap();
    machine
        .root_exited(RootExit::Code(9), true)
        .expect("exact root exit");
    assert_eq!(
        machine.observe(),
        GuardianObservation::RootExited(RootExit::Code(9))
    );
    assert!(machine.exact_empty().is_err());

    let empty = machine.descendants_empty().expect("exact child-set empty");
    assert_eq!(empty.kind, GuardianEventKind::ExactScopeEmpty);
    assert_eq!(machine.observe(), GuardianObservation::ExactScopeEmpty);
}

#[test]
fn event_sequences_and_root_status_are_closed() {
    let events = vec![
        GuardianEvent::prepared(),
        GuardianEvent::activated(2),
        GuardianEvent::root_exited(3, RootExit::Signal(15)),
        GuardianEvent::exact_empty(4),
    ];
    let bytes = GuardianEvent::encode_journal(&events).unwrap();
    assert_eq!(GuardianEvent::decode_journal(&bytes).unwrap(), events);

    let mut gap = events;
    gap[2] = GuardianEvent::root_exited(4, RootExit::Signal(15));
    assert!(GuardianEvent::encode_journal(&gap).is_err());
    assert!(RootExit::try_from_parts(None, None).is_err());
    assert!(RootExit::try_from_parts(Some(0), Some(9)).is_err());
    assert_eq!(
        RootExit::try_from_parts(Some(255), None).unwrap(),
        RootExit::Code(255)
    );
    assert!(RootExit::try_from_parts(Some(256), None).is_err());
    assert!(RootExit::try_from_parts(None, Some(0)).is_err());
    assert_eq!(
        RootExit::try_from_parts(None, Some(64)).unwrap(),
        RootExit::Signal(64)
    );
    assert!(RootExit::try_from_parts(None, Some(65)).is_err());

    let lost_root = vec![
        GuardianEvent::prepared(),
        GuardianEvent::activated(2),
        GuardianEvent::exact_empty(3),
    ];
    let bytes = GuardianEvent::encode_journal(&lost_root).unwrap();
    let decoded = GuardianEvent::decode_journal(&bytes).unwrap();
    assert_eq!(decoded, lost_root);
    assert!(GuardianEvent::root_result_lost(&decoded));
}

#[test]
fn root_status_corruption_matrix_is_retained_and_never_empty() {
    for (code, signal) in [
        (None, None),
        (Some(0), Some(9)),
        (Some(-1), None),
        (Some(256), None),
        (None, Some(-1)),
        (None, Some(0)),
        (None, Some(65)),
    ] {
        assert!(RootExit::try_from_parts(code, signal).is_err());
    }

    let valid = GuardianEvent::encode_journal(&[
        GuardianEvent::prepared(),
        GuardianEvent::activated(2),
        GuardianEvent::root_exited(3, RootExit::Code(23)),
        GuardianEvent::exact_empty(4),
    ])
    .unwrap();
    let event_offset = |index: usize| 8 + index * 16;
    let mut corruptions: Vec<(&str, Vec<u8>)> = Vec::new();

    let mut invalid_tag = valid.clone();
    invalid_tag[event_offset(2) + 9] = 3;
    corruptions.push(("invalid status tag", invalid_tag));

    let mut status_on_non_exit = valid.clone();
    status_on_non_exit[event_offset(1) + 9] = 1;
    status_on_non_exit[event_offset(1) + 12..event_offset(1) + 16]
        .copy_from_slice(&7_i32.to_be_bytes());
    corruptions.push(("status on activated", status_on_non_exit));

    let mut missing_status = valid.clone();
    missing_status[event_offset(2) + 9] = 0;
    missing_status[event_offset(2) + 12..event_offset(2) + 16]
        .copy_from_slice(&0_i32.to_be_bytes());
    corruptions.push(("missing root status", missing_status));

    let mut reserved_bytes = valid.clone();
    reserved_bytes[event_offset(2) + 10] = 1;
    corruptions.push(("reserved bytes", reserved_bytes));

    let mut duplicate_sequence = valid.clone();
    duplicate_sequence[event_offset(2)..event_offset(2) + 8].copy_from_slice(&2_u64.to_be_bytes());
    corruptions.push(("duplicate sequence", duplicate_sequence));

    let mut gapped_sequence = valid.clone();
    gapped_sequence[event_offset(2)..event_offset(2) + 8].copy_from_slice(&4_u64.to_be_bytes());
    corruptions.push(("gapped sequence", gapped_sequence));

    let mut invalid_transition = valid.clone();
    invalid_transition[event_offset(3) + 8] = GuardianEventKind::Activated as u8;
    corruptions.push(("invalid transition", invalid_transition));

    corruptions.push(("truncation", valid[..valid.len() - 1].to_vec()));
    let mut trailing_bytes = valid.clone();
    trailing_bytes.push(0);
    corruptions.push(("trailing bytes", trailing_bytes));

    for (label, bytes) in corruptions {
        match GuardianEvent::decode_journal(&bytes) {
            Err(_) => {}
            Ok(events) => assert_ne!(
                events.last().map(|event| event.kind),
                Some(GuardianEventKind::ExactScopeEmpty),
                "{label} fabricated exact empty"
            ),
        }
    }

    #[cfg(target_os = "linux")]
    assert_authenticated_bound_corruption_is_retained();
}

#[cfg(target_os = "linux")]
fn assert_authenticated_bound_corruption_is_retained() {
    let parent = support::short_private_root("rsc");
    let runtime = parent.join("runtime");
    let cwd = parent.join("workload");
    fs::create_dir_all(&runtime).unwrap();
    fs::create_dir_all(&cwd).unwrap();
    fs::set_permissions(&runtime, fs::Permissions::from_mode(0o700)).unwrap();
    fs::set_permissions(&cwd, fs::Permissions::from_mode(0o700)).unwrap();
    let scope = PrivateScope::create(&runtime, &cwd).unwrap();
    let binding = JournalBinding {
        scope_id: scope.scope_id,
        scope_capability: scope.scope_capability,
        launch_digest: [0x41; 32],
        identity: AuthorityIdentity {
            boot_id: "11111111-2222-3333-4444-555555555555".to_owned(),
            guardian_pid: 4242,
            start_ticks: 999,
            pid_namespace_device: 4,
            pid_namespace_inode: 5,
        },
    };
    let directory = File::open(&scope.directory).unwrap();
    let mut journal =
        DurableJournal::create_in(directory.try_clone().unwrap(), binding.clone()).unwrap();
    journal.append(GuardianEvent::activated(2)).unwrap();
    journal
        .append(GuardianEvent::root_exited(3, RootExit::Code(23)))
        .unwrap();
    journal.append(GuardianEvent::exact_empty(4)).unwrap();
    journal.commit_terminal().unwrap();

    let mut bytes = fs::read(&scope.terminal).unwrap();
    let authenticated_byte = bytes.len() - 1;
    bytes[authenticated_byte] ^= 0x80;
    fs::write(&scope.terminal, bytes).unwrap();
    assert!(DurableJournal::read_bound(&directory, "terminal.bin", &binding).is_err());
    fs::remove_dir_all(parent).unwrap();
}

#[test]
fn prepared_abort_reaches_exact_empty_without_activation_or_root_exit() {
    let mut machine = GuardianMachine::prepared();
    let empty = machine.abort_inert().unwrap();
    assert_eq!(empty.sequence, 2);
    assert_eq!(empty.kind, GuardianEventKind::ExactScopeEmpty);
    assert_eq!(machine.observe(), GuardianObservation::ExactScopeEmpty);
    assert_eq!(
        machine
            .events()
            .iter()
            .map(|event| event.kind)
            .collect::<Vec<_>>(),
        vec![
            GuardianEventKind::Prepared,
            GuardianEventKind::ExactScopeEmpty
        ]
    );
}

#[test]
fn root_exit_is_journaled_before_a_separate_kernel_empty_proof() {
    let mut machine = GuardianMachine::prepared();
    machine.activate().unwrap();
    machine.root_exited(RootExit::Code(0), false).unwrap();
    assert_eq!(
        machine.observe(),
        GuardianObservation::RootExited(RootExit::Code(0))
    );
    assert_eq!(machine.events().len(), 3);
    assert_eq!(machine.descendants_empty().unwrap().sequence, 4);
}
