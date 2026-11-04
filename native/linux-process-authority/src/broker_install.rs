use std::collections::HashSet;
use std::io;
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

use crate::broker_protocol::PinnedBrokerIdentity;

const MANIFEST_HEADER: &str = "rasen-linux-process-authority-broker-key-v1";

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BrokerPublicKeyManifest {
    pub key_id: [u8; 32],
    pub public_key: [u8; 32],
}

impl BrokerPublicKeyManifest {
    pub fn new(public_key: [u8; 32]) -> io::Result<Self> {
        let pinned = PinnedBrokerIdentity::from_public_key(public_key)?;
        Ok(Self {
            key_id: pinned.key_id(),
            public_key,
        })
    }

    pub fn encode(&self) -> String {
        format!(
            "{MANIFEST_HEADER}\nkey-id={}\npublic-key={}\n",
            hex(&self.key_id),
            hex(&self.public_key)
        )
    }

    pub fn decode(value: &str) -> io::Result<Self> {
        if value.len() > 256 || value.contains('\r') || value.contains('\0') {
            return Err(invalid_data("broker public-key manifest is malformed"));
        }
        let lines: Vec<&str> = value.split('\n').collect();
        if lines.len() != 4 || !lines[3].is_empty() || lines[0] != MANIFEST_HEADER {
            return Err(invalid_data(
                "broker public-key manifest has an unsupported shape",
            ));
        }
        let key_id = decode_hex_field(lines[1], "key-id=")?;
        let public_key = decode_hex_field(lines[2], "public-key=")?;
        let manifest =
            Self::new(public_key).map_err(|_| invalid_data("broker public key is invalid"))?;
        if manifest.key_id != key_id {
            return Err(invalid_data("broker public-key manifest key id is invalid"));
        }
        Ok(manifest)
    }

    pub fn pinned_identity(&self) -> io::Result<PinnedBrokerIdentity> {
        if Sha256::digest(self.public_key).as_slice() != self.key_id {
            return Err(invalid_data("broker public-key manifest key id is invalid"));
        }
        PinnedBrokerIdentity::from_public_key(self.public_key)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SecureNodeKind {
    Directory,
    RegularFile,
    UnixSocket,
    Symlink,
    Other,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SecurePathFact {
    pub path: PathBuf,
    pub owner_uid: u32,
    pub owner_gid: u32,
    pub mode: u32,
    pub kind: SecureNodeKind,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct SecurePathPolicy {
    pub leaf_kind: SecureNodeKind,
    pub leaf_mode: u32,
    pub leaf_gid: u32,
}

impl SecurePathPolicy {
    pub fn root_file(mode: u32) -> Self {
        Self {
            leaf_kind: SecureNodeKind::RegularFile,
            leaf_mode: mode,
            leaf_gid: 0,
        }
    }

    pub fn root_directory(mode: u32) -> Self {
        Self {
            leaf_kind: SecureNodeKind::Directory,
            leaf_mode: mode,
            leaf_gid: 0,
        }
    }

    pub fn root_group_directory(mode: u32, gid: u32) -> Self {
        Self {
            leaf_kind: SecureNodeKind::Directory,
            leaf_mode: mode,
            leaf_gid: gid,
        }
    }

    pub fn root_socket_for_group(gid: u32) -> Self {
        Self {
            leaf_kind: SecureNodeKind::UnixSocket,
            leaf_mode: 0o660,
            leaf_gid: gid,
        }
    }
}

pub fn validate_secure_path_facts(
    facts: &[SecurePathFact],
    policy: &SecurePathPolicy,
) -> io::Result<()> {
    if facts.len() < 2 || facts.first().map(|fact| fact.path.as_path()) != Some(Path::new("/")) {
        return Err(permission_denied(
            "secure path facts do not start at the filesystem root",
        ));
    }
    for (index, fact) in facts.iter().enumerate() {
        if !is_closed_absolute(&fact.path)
            || fact.owner_uid != 0
            || fact.mode & !0o7777 != 0
            || (index > 0 && linux_parent(&fact.path).as_deref() != facts[index - 1].path.to_str())
        {
            return Err(permission_denied(
                "secure path ownership or ancestry is invalid",
            ));
        }
        let is_leaf = index + 1 == facts.len();
        if !is_leaf {
            if fact.kind != SecureNodeKind::Directory || fact.mode & 0o022 != 0 {
                return Err(permission_denied(
                    "secure path ancestor is writable or not a directory",
                ));
            }
        } else if fact.kind != policy.leaf_kind
            || fact.mode & 0o7777 != policy.leaf_mode
            || fact.owner_gid != policy.leaf_gid
        {
            return Err(permission_denied(
                "secure path leaf type, owner, or mode is invalid",
            ));
        }
    }
    Ok(())
}

#[cfg(target_os = "linux")]
pub fn validate_root_owned_path(path: &Path, policy: &SecurePathPolicy) -> io::Result<()> {
    use std::os::unix::fs::{FileTypeExt, MetadataExt};

    if !is_closed_absolute(path) {
        return Err(permission_denied(
            "secure path is not a closed absolute path",
        ));
    }
    let mut facts = Vec::new();
    let mut current = PathBuf::from("/");
    let root = std::fs::symlink_metadata(&current)?;
    facts.push(SecurePathFact {
        path: current.clone(),
        owner_uid: root.uid(),
        owner_gid: root.gid(),
        mode: root.mode() & 0o7777,
        kind: metadata_kind(&root.file_type()),
    });
    for component in path.components().skip(1) {
        current.push(component.as_os_str());
        let metadata = std::fs::symlink_metadata(&current)?;
        facts.push(SecurePathFact {
            path: current.clone(),
            owner_uid: metadata.uid(),
            owner_gid: metadata.gid(),
            mode: metadata.mode() & 0o7777,
            kind: if metadata.file_type().is_socket() {
                SecureNodeKind::UnixSocket
            } else {
                metadata_kind(&metadata.file_type())
            },
        });
    }
    validate_secure_path_facts(&facts, policy)
}

#[cfg(target_os = "linux")]
fn metadata_kind(kind: &std::fs::FileType) -> SecureNodeKind {
    if kind.is_symlink() {
        SecureNodeKind::Symlink
    } else if kind.is_dir() {
        SecureNodeKind::Directory
    } else if kind.is_file() {
        SecureNodeKind::RegularFile
    } else {
        SecureNodeKind::Other
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BrokerInstallLayout {
    pub binary: PathBuf,
    pub public_key_manifest: PathBuf,
    pub private_key: PathBuf,
    pub state_directory: PathBuf,
    pub socket: PathBuf,
    pub service_unit: PathBuf,
    pub cgroup_subtree: PathBuf,
}

impl BrokerInstallLayout {
    pub fn system_default() -> Self {
        Self {
            binary: PathBuf::from("/usr/libexec/rasen/rasen-linux-process-authority-broker"),
            public_key_manifest: PathBuf::from(
                "/etc/rasen/linux-process-authority/broker-public-key.manifest",
            ),
            private_key: PathBuf::from("/var/lib/rasen/linux-process-authority/broker.key"),
            state_directory: PathBuf::from("/var/lib/rasen/linux-process-authority/leases"),
            socket: PathBuf::from("/run/rasen/linux-process-authority/broker.sock"),
            service_unit: PathBuf::from(
                "/usr/lib/systemd/system/rasen-linux-process-authority-broker.service",
            ),
            cgroup_subtree: PathBuf::from("/sys/fs/cgroup/rasen-linux-process-authority"),
        }
    }

    pub fn validate(&self) -> io::Result<()> {
        let paths = [
            &self.binary,
            &self.public_key_manifest,
            &self.private_key,
            &self.state_directory,
            &self.socket,
            &self.service_unit,
            &self.cgroup_subtree,
        ];
        if paths.iter().any(|path| !is_closed_absolute(path)) {
            return Err(invalid_input(
                "broker install layout contains an unsafe path",
            ));
        }
        let unique: HashSet<&Path> = paths.iter().map(|path| path.as_path()).collect();
        if unique.len() != paths.len()
            || self.private_key.starts_with("/usr/lib/rasen")
            || !self.state_directory.starts_with("/var/lib/rasen")
            || !self.socket.starts_with("/run/rasen")
            || !self.cgroup_subtree.starts_with("/sys/fs/cgroup")
        {
            return Err(invalid_input(
                "broker install layout crosses its trust roots",
            ));
        }
        Ok(())
    }
}

fn is_closed_absolute(path: &Path) -> bool {
    let Some(value) = path.to_str() else {
        return false;
    };
    value == "/"
        || (value.starts_with('/')
            && !value.contains('\\')
            && value
                .split('/')
                .skip(1)
                .all(|component| !matches!(component, "." | "..") && !component.is_empty()))
}

fn linux_parent(path: &Path) -> Option<String> {
    let value = path.to_str()?;
    if value == "/" || !is_closed_absolute(path) {
        return None;
    }
    let index = value.rfind('/')?;
    Some(if index == 0 {
        "/".to_owned()
    } else {
        value[..index].to_owned()
    })
}

fn decode_hex_field(value: &str, prefix: &str) -> io::Result<[u8; 32]> {
    let value = value
        .strip_prefix(prefix)
        .ok_or_else(|| invalid_data("broker public-key manifest field is missing"))?;
    if value.len() != 64 {
        return Err(invalid_data(
            "broker public-key manifest hex length is invalid",
        ));
    }
    let mut output = [0_u8; 32];
    for (index, pair) in value.as_bytes().chunks_exact(2).enumerate() {
        output[index] = (lower_hex(pair[0])? << 4) | lower_hex(pair[1])?;
    }
    Ok(output)
}

fn lower_hex(value: u8) -> io::Result<u8> {
    match value {
        b'0'..=b'9' => Ok(value - b'0'),
        b'a'..=b'f' => Ok(value - b'a' + 10),
        _ => Err(invalid_data(
            "broker public-key manifest hex is not canonical lowercase",
        )),
    }
}

pub(crate) fn hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(DIGITS[(byte >> 4) as usize] as char);
        output.push(DIGITS[(byte & 0x0f) as usize] as char);
    }
    output
}

fn invalid_input(message: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidInput, message)
}

fn invalid_data(message: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message)
}

fn permission_denied(message: &str) -> io::Error {
    io::Error::new(io::ErrorKind::PermissionDenied, message)
}
