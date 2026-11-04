#![cfg(target_os = "linux")]

use std::fs::{self, File};
use std::os::unix::fs::PermissionsExt;

use rasen_linux_process_authority::authority::AuthorityIdentity;
use rasen_linux_process_authority::journal::{DurableJournal, JournalBinding};
use rasen_linux_process_authority::lifecycle::{GuardianEvent, GuardianEventKind, RootExit};
use rasen_linux_process_authority::runtime::PrivateScope;

mod support;

#[test]
fn journal_fsyncs_monotonic_events_and_atomic_terminal_state() {
    let parent = support::short_private_root("jrn");
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
        launch_digest: [0x44; 32],
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
        .append(GuardianEvent::root_exited(3, RootExit::Signal(15)))
        .unwrap();
    journal.append(GuardianEvent::exact_empty(4)).unwrap();
    journal.commit_terminal().unwrap();

    assert_eq!(
        DurableJournal::read_bound(&directory, "journal.bin", &binding).unwrap(),
        journal.events()
    );
    assert_eq!(
        DurableJournal::read_bound(&directory, "terminal.bin", &binding).unwrap(),
        journal.events()
    );
    assert!(journal.append(GuardianEvent::exact_empty(5)).is_err());

    let mut wrong = binding.clone();
    wrong.launch_digest[0] ^= 0xff;
    assert!(DurableJournal::read_bound(&directory, "terminal.bin", &wrong).is_err());

    let mut bytes = fs::read(&scope.terminal).unwrap();
    let last = bytes.len() - 1;
    bytes[last] ^= 0xff;
    fs::write(&scope.terminal, bytes).unwrap();
    assert!(DurableJournal::read_bound(&directory, "terminal.bin", &binding).is_err());
    fs::remove_dir_all(parent).unwrap();
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum TerminalCrashPoint {
    BeforeJournalTemp,
    AfterJournalTempWrite,
    AfterJournalFileSync,
    AfterJournalRename,
    BeforeTerminalTemp,
    AfterTerminalFileSync,
    AfterTerminalRename,
    AfterTerminalDirectorySync,
}

impl TerminalCrashPoint {
    fn journal_was_renamed(self) -> bool {
        matches!(
            self,
            Self::AfterJournalRename
                | Self::BeforeTerminalTemp
                | Self::AfterTerminalFileSync
                | Self::AfterTerminalRename
                | Self::AfterTerminalDirectorySync
        )
    }

    fn terminal_was_renamed(self) -> bool {
        matches!(
            self,
            Self::AfterTerminalRename | Self::AfterTerminalDirectorySync
        )
    }
}

#[test]
fn terminal_record_crash_matrix_reopens_without_optimistic_state() {
    for (index, crash_point) in [
        TerminalCrashPoint::BeforeJournalTemp,
        TerminalCrashPoint::AfterJournalTempWrite,
        TerminalCrashPoint::AfterJournalFileSync,
        TerminalCrashPoint::AfterJournalRename,
        TerminalCrashPoint::BeforeTerminalTemp,
        TerminalCrashPoint::AfterTerminalFileSync,
        TerminalCrashPoint::AfterTerminalRename,
        TerminalCrashPoint::AfterTerminalDirectorySync,
    ]
    .into_iter()
    .enumerate()
    {
        let parent = support::short_private_root("tcm");
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
            launch_digest: [0x50 + index as u8; 32],
            identity: AuthorityIdentity {
                boot_id: "11111111-2222-3333-4444-555555555555".to_owned(),
                guardian_pid: 5000 + index as u32,
                start_ticks: 1000 + index as u64,
                pid_namespace_device: 4,
                pid_namespace_inode: 100 + index as u64,
            },
        };
        let directory = File::open(&scope.directory).unwrap();
        let mut journal =
            DurableJournal::create_in(directory.try_clone().unwrap(), binding.clone()).unwrap();
        journal.append(GuardianEvent::activated(2)).unwrap();
        journal
            .append(GuardianEvent::root_exited(3, RootExit::Code(23)))
            .unwrap();
        let root_exited_bytes = fs::read(&scope.journal).unwrap();
        journal.append(GuardianEvent::exact_empty(4)).unwrap();
        let exact_empty_bytes = fs::read(&scope.journal).unwrap();
        journal.commit_terminal().unwrap();

        fs::remove_file(&scope.terminal).unwrap();
        if crash_point.journal_was_renamed() {
            fs::write(&scope.journal, &exact_empty_bytes).unwrap();
        } else {
            fs::write(&scope.journal, &root_exited_bytes).unwrap();
        }
        if matches!(
            crash_point,
            TerminalCrashPoint::AfterJournalTempWrite | TerminalCrashPoint::AfterJournalFileSync
        ) {
            fs::write(
                scope.directory.join(".journal.bin.crash-tmp"),
                &exact_empty_bytes,
            )
            .unwrap();
        }
        if crash_point == TerminalCrashPoint::AfterTerminalFileSync {
            fs::write(
                scope.directory.join(".terminal.bin.crash-tmp"),
                &exact_empty_bytes,
            )
            .unwrap();
        }
        if crash_point.terminal_was_renamed() {
            fs::write(&scope.terminal, &exact_empty_bytes).unwrap();
            fs::set_permissions(&scope.terminal, fs::Permissions::from_mode(0o600)).unwrap();
        }

        let journal_events =
            DurableJournal::read_bound(&directory, "journal.bin", &binding).unwrap();
        let expected_last = if crash_point.journal_was_renamed() {
            GuardianEventKind::ExactScopeEmpty
        } else {
            GuardianEventKind::RootExited
        };
        assert_eq!(
            journal_events.last().map(|event| event.kind),
            Some(expected_last),
            "journal reopen at {crash_point:?}"
        );
        assert_eq!(
            journal_events.iter().find_map(|event| event.root_exit),
            Some(RootExit::Code(23)),
            "root status changed at {crash_point:?}"
        );

        let terminal = DurableJournal::read_bound(&directory, "terminal.bin", &binding);
        if crash_point.terminal_was_renamed() {
            let terminal_events = terminal.expect("renamed authenticated terminal must reopen");
            assert_eq!(
                terminal_events.last().map(|event| event.kind),
                Some(GuardianEventKind::ExactScopeEmpty)
            );
            assert_eq!(
                terminal_events.iter().find_map(|event| event.root_exit),
                Some(RootExit::Code(23))
            );
        } else {
            assert_eq!(terminal.unwrap_err().kind(), std::io::ErrorKind::NotFound);
        }
        fs::remove_dir_all(parent).unwrap();
    }
}
