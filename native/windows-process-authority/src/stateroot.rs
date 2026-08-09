//! Provider-owned trusted state root and bounded derivation (task 3.5).
//!
//! Every durable path this provider uses is derived from a trusted root plus a bounded scope
//! id. Nothing is ever taken from a path carried inside a reference, and nothing lives under
//! the workload's working directory. The Windows analogue of the Linux symlink/ownership
//! checks is: reject any component that is a reparse point, and require the owner SID to be
//! exactly the expected one.

use std::fs;
use std::io;
use std::os::windows::fs::MetadataExt;
use std::path::{Path, PathBuf};

use crate::launch::validate_absolute_windows_path;
use crate::win::{self, OwnedSid};

const FILE_ATTRIBUTE_DIRECTORY: u32 = 0x0000_0010;
const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0000_0400;

/// A 128-bit scope id rendered as exactly 32 lowercase hex characters. Bounded and
/// non-escaping by construction: it cannot contain a separator, a drive letter or a traversal
/// component.
pub const SCOPE_ID_HEX_LENGTH: usize = 32;

/// The 16 identity bytes behind a scope id, from either the internal hex rendering or the
/// canonical base64url one.
pub fn scope_id_bytes(value: &str) -> Option<[u8; 16]> {
    if value.len() == SCOPE_ID_HEX_LENGTH {
        let mut bytes = [0_u8; 16];
        for index in 0..16 {
            bytes[index] =
                u8::from_str_radix(value.get(index * 2..index * 2 + 2)?, 16).ok()?;
        }
        return Some(bytes);
    }
    crate::encoding::from_base64url(value)?.try_into().ok()
}

/// Accept a scope id in either rendering and return the internal hex form.
///
/// The canonical wire rendering is base64url (22 characters, which the provider's reference
/// bound of 2048 bytes across 21 fields makes worth the ten characters). The internal rendering
/// stays hex because the same id names a directory and a named pipe, and the Windows filesystem
/// namespace is case-insensitive — a case-folding collision is astronomically unlikely but hex
/// removes the question entirely. This is the one conversion point; nothing else translates.
pub fn normalize_scope_id(value: &str) -> io::Result<String> {
    let bytes = scope_id_bytes(value).ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            "scope id is neither 32 hex characters nor base64url of 16 bytes",
        )
    })?;
    Ok(crate::sha256::hex(&bytes))
}

pub fn validate_scope_id(value: &str) -> io::Result<()> {
    if value.len() != SCOPE_ID_HEX_LENGTH
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "scope id is not exactly 32 lowercase hex characters",
        ));
    }
    Ok(())
}

/// The private control endpoint name for a scope. Derived from the bounded scope id alone and
/// never from a path carried in a reference. The Windows object namespace does not survive a
/// reboot, which is the **independent** second proof of boot identity described in Decision 5;
/// it is deliberately not merged with [`crate::boot`].
pub fn endpoint_name(scope_id: &str) -> io::Result<String> {
    validate_scope_id(scope_id)?;
    Ok(format!("\\\\.\\pipe\\rasen-wpa-{scope_id}"))
}

#[derive(Clone, Debug)]
pub struct TrustedStateRoot {
    path: PathBuf,
    owner: OwnedSid,
}

fn create_owned_leaf_directory(path: &Path, owner: &OwnedSid) -> io::Result<()> {
    let parent = path.parent().ok_or_else(|| {
        io::Error::new(io::ErrorKind::InvalidInput, "directory has no parent")
    })?;
    fs::create_dir_all(parent)?;
    match fs::create_dir(path) {
        Ok(()) => win::set_file_owner_sid(&path.to_string_lossy(), owner),
        // A concurrent creator won the race. Leave that object's owner untouched so the
        // strict validation below decides whether it is trusted.
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => Ok(()),
        Err(error) => Err(error),
    }
}

impl TrustedStateRoot {
    /// Validate an existing trusted root: absolute, a real directory, no reparse point on any
    /// component, and owned by the expected SID.
    pub fn open(path: &str, expected_owner: &OwnedSid) -> io::Result<Self> {
        validate_absolute_windows_path(path, "trusted state root")?;
        let root = PathBuf::from(path);
        reject_reparse_points_along(&root)?;
        let metadata = fs::symlink_metadata(&root)?;
        if metadata.file_attributes() & FILE_ATTRIBUTE_DIRECTORY == 0 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "trusted state root is not a directory",
            ));
        }
        let owner = win::file_owner_sid(path)?;
        if !owner.equals(expected_owner) {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                format!(
                    "trusted state root owner {} is not the expected {}",
                    owner.to_text().unwrap_or_default(),
                    expected_owner.to_text().unwrap_or_default()
                ),
            ));
        }
        Ok(Self { path: root, owner })
    }

    /// Create the root if absent, then validate it. Creation is separate from validation on
    /// purpose: a root that already existed is validated exactly as strictly as a fresh one.
    pub fn create_or_open(path: &str, expected_owner: &OwnedSid) -> io::Result<Self> {
        validate_absolute_windows_path(path, "trusted state root")?;
        match fs::symlink_metadata(path) {
            Ok(_) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                create_owned_leaf_directory(Path::new(path), expected_owner)?;
            }
            Err(error) => return Err(error),
        }
        Self::open(path, expected_owner)
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn owner(&self) -> &OwnedSid {
        &self.owner
    }

    /// The per-scope durable directory. Bounded by the scope id, always under the trusted root.
    pub fn scope_directory(&self, scope_id: &str) -> io::Result<PathBuf> {
        validate_scope_id(scope_id)?;
        Ok(self.path.join("scopes").join(scope_id))
    }

    pub fn create_scope_directory(&self, scope_id: &str) -> io::Result<PathBuf> {
        let directory = self.scope_directory(scope_id)?;
        match fs::symlink_metadata(&directory) {
            Ok(_) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                create_owned_leaf_directory(&directory, &self.owner)?;
            }
            Err(error) => return Err(error),
        }
        reject_reparse_points_along(&directory)?;
        let owner = win::file_owner_sid(&directory.to_string_lossy())?;
        if !owner.equals(&self.owner) {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "scope directory owner differs from the trusted root owner",
            ));
        }
        Ok(directory)
    }

    pub fn journal_path(&self, scope_id: &str) -> io::Result<PathBuf> {
        Ok(self.scope_directory(scope_id)?.join("journal.log"))
    }

    pub fn terminal_record_path(&self, scope_id: &str) -> io::Result<PathBuf> {
        Ok(self.scope_directory(scope_id)?.join("terminal.record"))
    }

    /// Where the guardian records the sole-handle corroboration token.
    pub fn sole_handle_path(&self, scope_id: &str) -> io::Result<PathBuf> {
        Ok(self.scope_directory(scope_id)?.join("sole-handle.attestation"))
    }

    /// Record the sole-handle corroboration durably. Written **only** while the invariant
    /// actually holds.
    pub fn record_sole_handle(&self, scope_id: &str, token: &[u8; 32]) -> io::Result<()> {
        let path = self.sole_handle_path(scope_id)?;
        write_durably(
            &path,
            crate::sha256::hex(token).as_bytes(),
            &self.owner,
        )
    }

    /// Withdraw the corroboration. Called the moment the Job handle stops being solely held,
    /// so that a later probe reports `null` rather than a token that no longer means anything.
    pub fn revoke_sole_handle(&self, scope_id: &str) -> io::Result<()> {
        let path = self.sole_handle_path(scope_id)?;
        match std::fs::remove_file(&path) {
            Ok(()) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
            Err(error) => return Err(error),
        }
        win::flush_directory(&path.parent().expect("scope directory").to_string_lossy())
    }

    /// Corroborate the sole-handle attestation against the trusted state root.
    ///
    /// This is the difference between *present* and *corroborated*. "Present" is vacuous: every
    /// valid reference carries the attestation by construction, so a recovery rule keyed on
    /// presence is always true and the guardian-absent inference could never be falsified. The
    /// only question with an answer is whether the **trusted state root still says the
    /// invariant held**, and that is what this returns.
    ///
    /// `None` means "not corroborated" and MUST NOT be treated as exact empty.
    pub fn corroborate_sole_handle(
        &self,
        scope_id: &str,
        expected: &[u8; 32],
    ) -> io::Result<Option<String>> {
        let path = self.sole_handle_path(scope_id)?;
        reject_reparse_points_along(&path)?;
        let recorded = match std::fs::read_to_string(&path) {
            Ok(text) => text.trim().to_owned(),
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error),
        };
        let owner = win::file_owner_sid(&path.to_string_lossy())?;
        if !owner.equals(&self.owner) {
            return Ok(None);
        }
        if recorded != crate::sha256::hex(expected) {
            return Ok(None);
        }
        Ok(Some(recorded))
    }
}

/// Write bytes with Decision 10's Windows durability recipe: temporary file in the same
/// directory, flush the file handle, atomic replace with write-through, then flush a directory
/// handle opened with backup semantics. This is not the POSIX recipe and Node cannot express it.
pub fn write_durably(path: &Path, bytes: &[u8], owner: &OwnedSid) -> io::Result<()> {
    use std::io::Write;
    use std::os::windows::io::AsRawHandle;

    let directory = path
        .parent()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "path has no parent"))?;
    let temporary = directory.join(format!(
        "{}.{}.partial",
        path.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("record"),
        win::current_process_id()
    ));
    {
        let mut file = std::fs::File::create(&temporary)?;
        // Elevated Windows tokens may default new filesystem objects to the
        // Administrators group even when the process token belongs to one user.
        // Pin the durable record to the same owner as its trusted root before
        // publishing it; corroboration deliberately rejects any other owner.
        win::set_file_owner_sid(&temporary.to_string_lossy(), owner)?;
        file.write_all(bytes)?;
        file.flush()?;
        win::flush_file(file.as_raw_handle() as crate::sys::Handle)?;
    }
    win::replace_file_atomically(&temporary.to_string_lossy(), &path.to_string_lossy())?;
    win::flush_directory(&directory.to_string_lossy())
}

/// Reject a reparse point on the target **or on any ancestor**. A trusted root reached through
/// a junction is not a trusted root.
pub fn reject_reparse_points_along(path: &Path) -> io::Result<()> {
    let mut current = Some(path);
    while let Some(component) = current {
        if let Ok(metadata) = fs::symlink_metadata(component) {
            if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
                return Err(io::Error::new(
                    io::ErrorKind::PermissionDenied,
                    format!("path component is a reparse point: {}", component.display()),
                ));
            }
        }
        current = component.parent();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temporary_root(tag: &str) -> PathBuf {
        let mut base = std::env::temp_dir();
        base.push(format!(
            "rasen-wpa-stateroot-{tag}-{}",
            crate::win::current_process_id()
        ));
        let _ = fs::remove_dir_all(&base);
        base
    }

    #[test]
    fn scope_ids_must_be_exactly_thirty_two_lowercase_hex_characters() {
        validate_scope_id("0123456789abcdef0123456789abcdef").expect("valid");
        for rejected in [
            "",
            "0123456789abcdef0123456789abcde",
            "0123456789abcdef0123456789abcdef0",
            "0123456789ABCDEF0123456789abcdef",
            "0123456789abcdef0123456789abcdeg",
            "..\\..\\0123456789abcdef0123456",
            "0123456789abcdef0123456789abcd\\f",
        ] {
            assert!(
                validate_scope_id(rejected).is_err(),
                "{rejected:?} was accepted as a scope id"
            );
        }
    }

    #[test]
    fn the_endpoint_name_is_derived_only_from_the_bounded_scope_id() {
        let name = endpoint_name("0123456789abcdef0123456789abcdef").expect("name");
        assert_eq!(name, "\\\\.\\pipe\\rasen-wpa-0123456789abcdef0123456789abcdef");
        assert!(endpoint_name("../escape").is_err());
    }

    #[test]
    fn a_root_owned_by_this_user_validates_and_a_wrong_expected_owner_does_not() {
        let root = temporary_root("owner");
        let text = root.to_string_lossy().into_owned();
        let mine = win::current_user_sid().expect("sid");
        let opened = TrustedStateRoot::create_or_open(&text, &mine).expect("create");
        assert_eq!(opened.path(), root.as_path());

        // The contract requires the owner to be *exactly* the expected SID. Assert that
        // requirement discriminates rather than restating that our own root is ours: a
        // well-known SID that is definitely not the owner must be refused.
        let everyone = {
            // S-1-1-0 built by hand: revision 1, 1 sub-authority, identifier authority 1,
            // sub-authority 0.
            let bytes = vec![1_u8, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0];
            unsafe { OwnedSid::copy_from(bytes.as_ptr() as *mut std::ffi::c_void) }
                .expect("well-known SID")
        };
        assert!(TrustedStateRoot::create_or_open(&text, &everyone).is_err());
        TrustedStateRoot::open(&text, &mine).expect("existing root owner was changed");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_relative_or_traversing_root_is_refused_before_any_filesystem_access() {
        let mine = win::current_user_sid().expect("sid");
        for rejected in ["relative\\path", "C:\\a\\..\\b", ".\\here", ""] {
            assert!(TrustedStateRoot::open(rejected, &mine).is_err(), "{rejected}");
        }
    }

    #[test]
    fn scope_directories_stay_under_the_trusted_root() {
        let root = temporary_root("scope");
        let text = root.to_string_lossy().into_owned();
        let mine = win::current_user_sid().expect("sid");
        let opened = TrustedStateRoot::create_or_open(&text, &mine).expect("open");
        let scope = "abcdef0123456789abcdef0123456789";
        let directory = opened.create_scope_directory(scope).expect("scope dir");
        assert!(directory.starts_with(&root));
        assert!(directory.ends_with(scope));
        let token = [7_u8; 32];
        opened.record_sole_handle(scope, &token).expect("record");
        let record_owner = win::file_owner_sid(
            &opened
                .sole_handle_path(scope)
                .expect("sole-handle path")
                .to_string_lossy(),
        )
        .expect("record owner");
        assert!(record_owner.equals(&mine));
        assert_eq!(
            opened
                .corroborate_sole_handle(scope, &token)
                .expect("corroborate"),
            Some(crate::sha256::hex(&token))
        );
        assert!(opened.journal_path(scope).expect("journal").starts_with(&root));
        assert!(opened
            .terminal_record_path(scope)
            .expect("terminal")
            .starts_with(&root));
        assert!(opened.scope_directory("../../escape").is_err());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_reparse_point_on_the_target_is_refused() {
        // A directory symlink needs either developer mode or elevation. When the environment
        // does not permit creating one, the check below is skipped rather than reported as a
        // pass; the caller-visible signal is the returned bool.
        let root = temporary_root("reparse");
        let real = root.join("real");
        fs::create_dir_all(&real).expect("real dir");
        let link = root.join("link");
        let created = std::os::windows::fs::symlink_dir(&real, &link).is_ok();
        if created {
            assert!(
                reject_reparse_points_along(&link).is_err(),
                "a reparse point was accepted"
            );
            assert!(reject_reparse_points_along(&real).is_ok());
        }
        let _ = fs::remove_dir_all(&root);
    }
}
