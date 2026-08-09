use rasen_linux_process_authority::broker_admin::{
    plan_install, plan_uninstall, ExistingInstallation, InstallAction, InstallInputs,
};
use rasen_linux_process_authority::broker_install::BrokerInstallLayout;
use rasen_linux_process_authority::broker_lease::{
    BrokerLease, LeaseTerminal, LeaseTerminalHistory,
};

fn inputs() -> InstallInputs {
    InstallInputs {
        binary_sha256: [1; 32],
        public_key_manifest_sha256: [2; 32],
        private_key_sha256: [3; 32],
        service_unit_sha256: [4; 32],
        service_gid: 991,
    }
}

#[test]
fn install_plan_is_closed_and_idempotent_for_the_exact_layout() {
    let layout = BrokerInstallLayout::system_default();
    let first = plan_install(&layout, &inputs(), &ExistingInstallation::absent()).unwrap();
    assert!(first
        .actions
        .contains(&InstallAction::CreateProtectedDirectories));
    assert!(first.actions.contains(&InstallAction::InstallBinary));
    assert!(first.actions.contains(&InstallAction::InstallKeyMaterial));
    assert!(first.actions.contains(&InstallAction::InstallServiceUnit));
    assert!(first.actions.contains(&InstallAction::EnableService));

    let present = ExistingInstallation::matching(&inputs());
    let second = plan_install(&layout, &inputs(), &present).unwrap();
    assert_eq!(second.actions, vec![InstallAction::NoChange]);
    assert!(!first.render().contains("sudo"));
    assert!(!second.render().contains("sudo"));
}

#[test]
fn uninstall_refuses_any_retained_or_populated_lease() {
    let layout = BrokerInstallLayout::system_default();
    let mut lease: BrokerLease = {
        use rasen_linux_process_authority::authority::AuthorityIdentity;
        use rasen_linux_process_authority::broker_lease::{CgroupLeafIdentity, LeasePhase};
        BrokerLease {
            token: [1; 32],
            request_capability: [2; 32],
            scope_id: [3; 16],
            preparation_operation_id: "prepare-admin-contract".to_owned(),
            launch_digest: [6; 32],
            caller_uid: 1000,
            broker_install_id: [4; 32],
            broker_key_id: [5; 32],
            guardian: AuthorityIdentity {
                boot_id: "7dc44f16-8f9d-4ad8-a233-44bbd0704848".to_owned(),
                guardian_pid: 42,
                start_ticks: 7,
                pid_namespace_device: 8,
                pid_namespace_inode: 9,
            },
            cgroup: CgroupLeafIdentity {
                device: 8,
                inode: 10,
            },
            phase: LeasePhase::Prepared,
            terminal: LeaseTerminal::Retained,
            publication_binding: None,
            terminal_history: LeaseTerminalHistory::None,
        }
    };
    assert!(plan_uninstall(&layout, &[lease.clone()], &[]).is_err());
    assert!(plan_uninstall(&layout, &[], &[lease.cgroup]).is_err());

    lease.terminal = LeaseTerminal::Retained;
    let empty = plan_uninstall(&layout, &[], &[]).unwrap();
    assert_eq!(
        empty.actions,
        vec![
            InstallAction::DisableService,
            InstallAction::RemoveSocket,
            InstallAction::RemoveServiceUnit,
            InstallAction::RemoveKeyMaterial,
            InstallAction::RemoveBinary,
            InstallAction::RemoveEmptyProtectedDirectories,
        ]
    );
}

#[test]
fn uninstall_assets_refuse_unknown_state_before_removing_recovery_identity() {
    let installer = include_str!("../install/install.sh");
    let script = include_str!("../install/uninstall.sh");
    assert!(installer.contains("find \"$lease_root\" -mindepth 1 -maxdepth 1 -print -quit"));
    assert!(!installer.contains("-name '*.lease'"));
    assert!(installer.contains("lease store is not root-owned mode 0700"));
    assert!(
        installer.contains("public identity replacement is refused while a durable lease exists")
    );
    assert!(script.contains("find \"$lease_root\" -mindepth 1 -maxdepth 1 -print -quit"));
    assert!(!script.contains("-name '*.lease'"));
    assert!(script.contains("lease store is not root-owned mode 0700"));
    assert!(script.contains("unknown cgroup leaf name"));
    assert!(script.contains("cgroup.events is malformed"));
    assert!(script.contains("clean-uninstall-state"));
    assert!(script
        .contains("durable broker state is retained, incomplete, unauthenticated, or malformed"));

    let cgroup_cleanup = script
        .find("rmdir -- \"$cgroup_root\"")
        .expect("cgroup subtree cleanup");
    let identity_removal = script
        .find("rm -f -- /var/lib/rasen/linux-process-authority/broker.key")
        .expect("broker recovery identity removal");
    assert!(cgroup_cleanup < identity_removal);
}

#[test]
fn installer_pins_tools_and_consumes_only_stable_root_owned_sources() {
    let script = include_str!("../install/install.sh");
    assert!(script.contains("PATH=/usr/sbin:/usr/bin:/sbin:/bin"));
    assert!(script.contains("assert_secure_source \"$source_file\""));
    assert!(script.contains("installation source is not root-owned"));
    assert!(script.contains("installation source is group/other writable"));
    assert!(script.contains("source_identity"));
    assert!(script.contains("source digest changed before copy"));
    assert!(script.contains("source digest changed during copy"));
    assert!(script.contains("staged installation digest differs"));
    assert!(!script.contains("cmp -s"));
}

#[test]
fn uninstaller_holds_the_daemon_singleton_and_fails_closed_on_stop_or_pid_drift() {
    let script = include_str!("../install/uninstall.sh");
    let stop = script
        .find("systemctl stop rasen-linux-process-authority-broker.service || fail")
        .expect("stop failure must be terminal");
    let lock = script
        .find("flock -n 9 || fail")
        .expect("shared administrative singleton");
    let scan = script
        .find("find \"$lease_root\" -mindepth 1")
        .expect("durable state scan");
    let removal = script
        .find("rm -f -- /var/lib/rasen/linux-process-authority/broker.key")
        .expect("recovery identity removal");
    assert!(stop < lock && lock < scan && scan < removal);
    assert!(script.contains("systemctl is-active --quiet"));
    assert!(script.contains("systemctl show --property MainPID --value"));
    assert!(!script.contains(
        "systemctl stop rasen-linux-process-authority-broker.service 2>/dev/null || true"
    ));
}

#[test]
fn daemon_reclaims_only_a_proven_stale_socket_while_holding_its_singleton() {
    let daemon = include_str!("../src/bin/rasen-linux-process-authority-broker.rs");
    let cgroup = include_str!("../src/broker_cgroup.rs");
    let unit = include_str!("../install/rasen-linux-process-authority-broker.service");
    assert!(daemon.contains("libc::LOCK_EX | libc::LOCK_NB"));
    assert!(daemon.contains("libc::O_NOFOLLOW | libc::O_CLOEXEC"));
    assert!(daemon.contains("validate_root_owned_path(\n                &layout.socket"));
    assert!(daemon.contains("UnixStream::connect(&layout.socket)"));
    assert!(daemon.contains("error.kind() == io::ErrorKind::ConnectionRefused"));
    assert!(daemon.contains("metadata.dev() == self.socket_device"));
    assert!(daemon.contains("metadata.ino() == self.socket_inode"));
    assert!(unit.contains("RuntimeDirectory=rasen/linux-process-authority"));
    assert!(unit.contains("RuntimeDirectoryMode=0750"));
    assert!(unit.contains("RuntimeDirectoryPreserve=yes"));
    assert!(cgroup.contains("administrative_lock: Mutex<()>"));
    assert!(cgroup.contains("from the final identity check through unlink"));
}

#[test]
fn production_daemon_client_and_guardian_cover_every_authenticated_lifecycle_route() {
    let daemon = include_str!("../src/bin/rasen-linux-process-authority-broker.rs");
    let daemon_transactions = include_str!("../src/broker_daemon_transaction.rs");
    let client = include_str!("../src/bin/rasen-linux-process-authority-broker-client.rs");
    let client_transactions = include_str!("../src/broker_client_transaction.rs");
    let guardian = include_str!("../src/broker_guardian.rs");
    let primary = include_str!("../src/primary.rs");
    assert!(daemon.contains("broker_daemon_transaction::BrokerDaemonTransactions"));
    assert!(daemon.contains("transactions: BrokerDaemonTransactions"));
    assert!(daemon_transactions.contains("accept_authenticated_request(stream, signer)"));
    assert!(
        daemon_transactions.contains("service.open_runtime(peer, authenticated_nonce, request)")
    );
    assert!(daemon_transactions.contains("BrokerMutationSupervisor::execute_for_client("));
    assert!(daemon_transactions.contains("service.handle(peer, authenticated_nonce, request)"));
    assert!(daemon_transactions.contains("prepared.encode_client_reference()"));
    assert!(client.contains("match parse_client_command"));
    for (parsed, dispatched) in [
        (
            "\"prepare\" => Ok(BrokerClientCommand::Prepare)",
            "BrokerClientCommand::Prepare => prepare",
        ),
        (
            "\"recover-preparation\" => Ok(BrokerClientCommand::RecoverPreparation)",
            "BrokerClientCommand::RecoverPreparation => recover_preparation",
        ),
        (
            "\"acknowledge-preparation\" => Ok(BrokerClientCommand::AcknowledgePreparation)",
            "BrokerClientCommand::AcknowledgePreparation => acknowledge_preparation",
        ),
        (
            "\"open-runtime\" => Ok(BrokerClientCommand::OpenRuntime)",
            "BrokerClientCommand::OpenRuntime => open_runtime",
        ),
        (
            "\"activate\" => Ok(BrokerClientCommand::Activate)",
            "BrokerClientCommand::Activate => control",
        ),
        (
            "\"inspect\" => Ok(BrokerClientCommand::Inspect)",
            "BrokerClientCommand::Inspect => control",
        ),
        (
            "\"abort\" => Ok(BrokerClientCommand::Abort)",
            "BrokerClientCommand::Abort => control",
        ),
        (
            "\"terminate\" => Ok(BrokerClientCommand::Terminate)",
            "BrokerClientCommand::Terminate => control",
        ),
        (
            "\"record-publication\" => Ok(BrokerClientCommand::RecordPublication)",
            "BrokerClientCommand::RecordPublication => record_publication",
        ),
    ] {
        assert!(
            client_transactions.contains(parsed),
            "missing client parser route: {parsed}"
        );
        assert!(
            client.contains(dispatched),
            "missing client dispatch route: {dispatched}"
        );
    }
    assert!(client.contains("BrokerClientEndpoint"));
    assert!(client_transactions.contains("authenticate_broker_for_uid("));
    assert!(client.contains("BrokerPublicKeyManifest::decode"));
    assert!(client.contains("current_executable_digest()? != artifact_digest"));
    assert!(guardian.contains("libc::setgroups"));
    assert!(guardian.contains("libc::setresgid"));
    assert!(guardian.contains("libc::setresuid"));
    assert!(guardian.contains("close_inherited_descriptors(&[result_fd, construction_fd])"));
    assert!(guardian.contains("prepare_primary_recoverable_until"));
    assert!(guardian.contains("ConstructionPreReadinessPermit"));
    assert!(primary.contains("permit.commit_and_release(&prepared, deadline)?"));
    assert!(primary.contains("write_all_fd_until(\n            parent_gate_write"));
    assert!(guardian.contains("clear_ambient_environment()"));
}
