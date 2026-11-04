use std::path::PathBuf;

use rasen_linux_process_authority::broker_install::{
    validate_secure_path_facts, BrokerInstallLayout, BrokerPublicKeyManifest, SecureNodeKind,
    SecurePathFact, SecurePathPolicy,
};
use rasen_linux_process_authority::broker_protocol::SigningBrokerIdentity;

fn directory(path: &str, mode: u32) -> SecurePathFact {
    SecurePathFact {
        path: PathBuf::from(path),
        owner_uid: 0,
        owner_gid: 0,
        mode,
        kind: SecureNodeKind::Directory,
    }
}

#[test]
fn pinned_public_key_manifest_is_canonical_and_self_authenticating() {
    let signing = SigningBrokerIdentity::from_seed([7; 32]).unwrap();
    let manifest = BrokerPublicKeyManifest::new(signing.public_key()).unwrap();
    let encoded = manifest.encode();
    let decoded = BrokerPublicKeyManifest::decode(&encoded).unwrap();
    assert_eq!(decoded, manifest);
    assert_eq!(
        decoded.pinned_identity().unwrap().key_id(),
        signing.key_id()
    );

    let tampered = encoded.replace("key-id=", "unexpected=");
    assert!(BrokerPublicKeyManifest::decode(&tampered).is_err());

    let mut wrong_id = encoded;
    let first_key_id_digit = wrong_id.find("key-id=").unwrap() + "key-id=".len();
    wrong_id.replace_range(first_key_id_digit..first_key_id_digit + 1, "0");
    assert!(BrokerPublicKeyManifest::decode(&wrong_id).is_err());
}

#[test]
fn every_install_ancestor_and_leaf_must_match_root_owned_policy() {
    let facts = vec![
        directory("/", 0o755),
        directory("/etc", 0o755),
        directory("/etc/rasen", 0o755),
        SecurePathFact {
            path: PathBuf::from("/etc/rasen/broker-public-key.manifest"),
            owner_uid: 0,
            owner_gid: 0,
            mode: 0o644,
            kind: SecureNodeKind::RegularFile,
        },
    ];
    validate_secure_path_facts(&facts, &SecurePathPolicy::root_file(0o644)).unwrap();

    let mut insecure_parent = facts.clone();
    insecure_parent[2].mode = 0o777;
    assert!(
        validate_secure_path_facts(&insecure_parent, &SecurePathPolicy::root_file(0o644),).is_err()
    );

    let mut symlink_leaf = facts.clone();
    symlink_leaf[3].kind = SecureNodeKind::Symlink;
    assert!(
        validate_secure_path_facts(&symlink_leaf, &SecurePathPolicy::root_file(0o644),).is_err()
    );

    let mut wrong_owner = facts;
    wrong_owner[3].owner_uid = 1000;
    assert!(
        validate_secure_path_facts(&wrong_owner, &SecurePathPolicy::root_file(0o644),).is_err()
    );
}

#[test]
fn socket_policy_allows_only_the_explicit_service_group() {
    let facts = vec![
        directory("/", 0o755),
        directory("/run", 0o755),
        directory("/run/rasen", 0o750),
        SecurePathFact {
            path: PathBuf::from("/run/rasen/linux-authority-broker.sock"),
            owner_uid: 0,
            owner_gid: 991,
            mode: 0o660,
            kind: SecureNodeKind::UnixSocket,
        },
    ];
    validate_secure_path_facts(&facts, &SecurePathPolicy::root_socket_for_group(991)).unwrap();

    let mut wrong_group = facts;
    wrong_group[3].owner_gid = 1000;
    assert!(validate_secure_path_facts(
        &wrong_group,
        &SecurePathPolicy::root_socket_for_group(991),
    )
    .is_err());
}

#[test]
fn installation_layout_is_absolute_closed_and_keeps_private_state_out_of_the_package() {
    let layout = BrokerInstallLayout::system_default();
    layout.validate().unwrap();
    assert_eq!(
        layout.socket,
        PathBuf::from("/run/rasen/linux-process-authority/broker.sock")
    );
    assert_eq!(
        layout.private_key,
        PathBuf::from("/var/lib/rasen/linux-process-authority/broker.key")
    );
    assert!(!layout.private_key.starts_with("/usr/lib/rasen"));
}
