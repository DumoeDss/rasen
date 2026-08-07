//! Strict launch decoding and the immutable launch snapshot (task 3.4).
//!
//! The snapshot is decided once, at prepare, and never re-read from the caller afterwards.
//! Its digest is what the publication ledger binds and what activation re-verifies, so every
//! field that can change the process that actually starts must be inside the digest —
//! including `windowsVerbatimArguments`, which changes the command line the kernel receives
//! without changing any argument value.

use std::collections::BTreeMap;
use std::io;

use crate::protocol::{
    canonical_environment, put_string, validate_text, MAX_ARGUMENTS, MAX_ARGUMENT_BYTES,
    MAX_ENVIRONMENT, MAX_PATH_BYTES,
};
use crate::sha256;

/// An immutable, fully materialised launch description.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LaunchSnapshot {
    /// Absolute, server-resolved executable path. Never searched on `PATH`.
    pub executable: String,
    /// Absolute working directory.
    pub working_directory: String,
    pub arguments: Vec<String>,
    pub environment: BTreeMap<String, String>,
    /// When true the arguments are passed through without quoting, exactly as the caller
    /// supplied them. Part of the digest because it changes the resulting command line.
    pub verbatim_arguments: bool,
}

impl LaunchSnapshot {
    pub fn validate(&self) -> io::Result<()> {
        validate_absolute_windows_path(&self.executable, "executable")?;
        validate_absolute_windows_path(&self.working_directory, "working directory")?;
        if self.arguments.len() > MAX_ARGUMENTS {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "argument vector exceeds its bound",
            ));
        }
        for argument in &self.arguments {
            validate_text(argument, MAX_ARGUMENT_BYTES, true, "argument")?;
        }
        if self.environment.len() > MAX_ENVIRONMENT {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "environment exceeds its bound",
            ));
        }
        for key in self.environment.keys() {
            if key.is_empty() || key.contains('=') {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "environment key is malformed",
                ));
            }
        }
        Ok(())
    }

    pub fn canonical_bytes(&self) -> io::Result<Vec<u8>> {
        self.validate()?;
        let mut output = Vec::new();
        output.extend_from_slice(b"RWL1");
        put_string(&mut output, &self.executable, MAX_PATH_BYTES, false)?;
        put_string(&mut output, &self.working_directory, MAX_PATH_BYTES, false)?;
        output.push(u8::from(self.verbatim_arguments));
        output.extend_from_slice(&(self.arguments.len() as u32).to_be_bytes());
        for argument in &self.arguments {
            put_string(&mut output, argument, MAX_ARGUMENT_BYTES, true)?;
        }
        output.extend_from_slice(&canonical_environment(&self.environment)?);
        Ok(output)
    }

    pub fn digest(&self) -> io::Result<[u8; 32]> {
        Ok(sha256::digest(&self.canonical_bytes()?))
    }

    pub fn digest_hex(&self) -> io::Result<String> {
        Ok(sha256::hex(&self.digest()?))
    }

    /// The exact command line handed to `CreateProcessW`.
    pub fn command_line(&self) -> io::Result<String> {
        self.validate()?;
        let mut line = quote_argument(&self.executable);
        for argument in &self.arguments {
            line.push(' ');
            if self.verbatim_arguments {
                if argument.contains('\0') {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidInput,
                        "verbatim argument contains nul",
                    ));
                }
                line.push_str(argument);
            } else {
                line.push_str(&quote_argument(argument));
            }
        }
        Ok(line)
    }

    /// A fully materialised `CREATE_UNICODE_ENVIRONMENT` block. Sorted, NUL separated, double
    /// NUL terminated. Never inherits the caller's environment implicitly.
    pub fn environment_block(&self) -> io::Result<Vec<u16>> {
        self.validate()?;
        let mut block: Vec<u16> = Vec::new();
        for (key, value) in &self.environment {
            for unit in key.encode_utf16() {
                block.push(unit);
            }
            block.push(u16::from(b'='));
            for unit in value.encode_utf16() {
                block.push(unit);
            }
            block.push(0);
        }
        // The block is a sequence of NUL-terminated strings followed by one more NUL. An empty
        // environment therefore needs **two** NULs, not one: the kernel rejects a single-NUL
        // block with `ERROR_INVALID_PARAMETER` (87). Measured on the real kernel — the first
        // real `CreateProcessW` call this crate ever made failed exactly this way, while every
        // unit test passed, because the test asserted the shape the code produced rather than
        // the shape the contract requires.
        block.push(0);
        if block.len() == 1 {
            block.push(0);
        }
        Ok(block)
    }
}

/// Reject anything that is not an exact absolute Windows path. This is what makes "no PATH
/// search, no shell, no caller-relative resolution" a decode-time property rather than a
/// convention.
pub fn validate_absolute_windows_path(value: &str, label: &str) -> io::Result<()> {
    validate_text(value, MAX_PATH_BYTES, false, label)?;
    let malformed = |reason: &str| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("{label} is not an exact absolute Windows path: {reason}"),
        )
    };
    if value.trim() != value {
        return Err(malformed("surrounding whitespace"));
    }
    if value.contains('"') {
        return Err(malformed("embedded quote"));
    }
    let bytes = value.as_bytes();
    let drive_absolute = bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && (bytes[2] == b'\\' || bytes[2] == b'/');
    let unc = value.starts_with("\\\\");
    if !drive_absolute && !unc {
        return Err(malformed("no drive root and no UNC root"));
    }
    for component in value.split(['\\', '/']) {
        if component == ".." {
            return Err(malformed("parent traversal component"));
        }
        if component == "." {
            return Err(malformed("relative component"));
        }
    }
    Ok(())
}

/// MSVCRT-compatible argument quoting, matching `CommandLineToArgvW` parsing. Used for every
/// argument unless the snapshot is verbatim.
pub fn quote_argument(value: &str) -> String {
    if !value.is_empty()
        && !value
            .chars()
            .any(|character| matches!(character, ' ' | '\t' | '\n' | '\u{0b}' | '"'))
    {
        return value.to_owned();
    }
    // A run of N backslashes is literal unless it precedes a quote, in which case it must be
    // doubled and the quote escaped; a run at the very end must be doubled so the closing
    // delimiter is not swallowed.
    let mut rebuilt = String::with_capacity(value.len() + 4);
    rebuilt.push('"');
    let mut run = 0_usize;
    for character in value.chars() {
        if character == '\\' {
            run += 1;
            continue;
        }
        if character == '"' {
            for _ in 0..run * 2 + 1 {
                rebuilt.push('\\');
            }
            rebuilt.push('"');
            run = 0;
            continue;
        }
        for _ in 0..run {
            rebuilt.push('\\');
        }
        run = 0;
        rebuilt.push(character);
    }
    for _ in 0..run * 2 {
        rebuilt.push('\\');
    }
    rebuilt.push('"');
    rebuilt
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snapshot() -> LaunchSnapshot {
        let mut environment = BTreeMap::new();
        environment.insert("RASEN_SCOPE".to_owned(), "1".to_owned());
        LaunchSnapshot {
            executable: "C:\\Windows\\System32\\cmd.exe".to_owned(),
            working_directory: "C:\\Windows".to_owned(),
            arguments: vec!["/c".to_owned(), "exit 0".to_owned()],
            environment,
            verbatim_arguments: false,
        }
    }

    #[test]
    fn absolute_windows_paths_are_required() {
        for accepted in [
            "C:\\Windows\\System32\\cmd.exe",
            "c:/Windows/System32/cmd.exe",
            "\\\\?\\C:\\Windows\\System32\\cmd.exe",
            "\\\\server\\share\\tool.exe",
        ] {
            validate_absolute_windows_path(accepted, "path")
                .unwrap_or_else(|error| panic!("{accepted} rejected: {error}"));
        }
        for rejected in [
            "cmd.exe",
            "System32\\cmd.exe",
            ".\\cmd.exe",
            "C:cmd.exe",
            "C:\\Windows\\..\\Windows\\cmd.exe",
            "C:\\Windows\\.\\cmd.exe",
            " C:\\Windows\\cmd.exe",
            "C:\\Windows\\cmd.exe ",
            "C:\\Win\"dows\\cmd.exe",
            "",
        ] {
            assert!(
                validate_absolute_windows_path(rejected, "path").is_err(),
                "{rejected:?} was accepted"
            );
        }
    }

    #[test]
    fn a_path_containing_nul_is_rejected() {
        assert!(validate_absolute_windows_path("C:\\a\0b", "path").is_err());
    }

    #[test]
    fn the_digest_changes_when_the_verbatim_flag_changes() {
        // The contract requires the launch digest to bind everything that can change the
        // process the kernel starts. `windowsVerbatimArguments` changes the command line
        // without changing any argument value, so a digest that ignored it would let a
        // published record authorise a different actual launch.
        let plain = snapshot();
        let mut verbatim = snapshot();
        verbatim.verbatim_arguments = true;
        assert_ne!(
            plain.digest().expect("digest"),
            verbatim.digest().expect("digest"),
            "verbatim flag is not bound by the launch digest"
        );
        assert_ne!(
            plain.command_line().expect("line"),
            verbatim.command_line().expect("line")
        );
    }

    #[test]
    fn the_digest_is_stable_and_order_independent_for_the_environment() {
        let first = snapshot();
        let mut second = snapshot();
        second
            .environment
            .insert("ZZZ".to_owned(), "later".to_owned());
        second.environment.insert("AAA".to_owned(), "first".to_owned());
        let mut third = snapshot();
        third.environment.insert("AAA".to_owned(), "first".to_owned());
        third.environment.insert("ZZZ".to_owned(), "later".to_owned());
        assert_eq!(first.digest().expect("d"), snapshot().digest().expect("d"));
        assert_eq!(second.digest().expect("d"), third.digest().expect("d"));
        assert_ne!(first.digest().expect("d"), second.digest().expect("d"));
    }

    #[test]
    fn the_digest_changes_for_every_other_field() {
        let base = snapshot().digest().expect("digest");

        let mut changed = snapshot();
        changed.executable = "C:\\Windows\\System32\\where.exe".to_owned();
        assert_ne!(changed.digest().expect("digest"), base);

        let mut changed = snapshot();
        changed.working_directory = "C:\\".to_owned();
        assert_ne!(changed.digest().expect("digest"), base);

        let mut changed = snapshot();
        changed.arguments.push("extra".to_owned());
        assert_ne!(changed.digest().expect("digest"), base);

        let mut changed = snapshot();
        changed
            .environment
            .insert("RASEN_SCOPE".to_owned(), "2".to_owned());
        assert_ne!(changed.digest().expect("digest"), base);
    }

    #[test]
    fn quoting_matches_command_line_to_argv_rules() {
        assert_eq!(quote_argument("plain"), "plain");
        assert_eq!(quote_argument("with space"), "\"with space\"");
        assert_eq!(quote_argument(""), "\"\"");
        assert_eq!(quote_argument("a\"b"), "\"a\\\"b\"");
        // No whitespace and no quote: the fast path leaves it exactly alone, backslashes and
        // all, which is what `CommandLineToArgvW` parses back to the original.
        assert_eq!(quote_argument("trailing\\"), "trailing\\");
        assert_eq!(quote_argument("a\\\\b"), "a\\\\b");
        // A trailing backslash run inside a quoted argument must be doubled, otherwise it
        // escapes the closing delimiter.
        assert_eq!(quote_argument("a b\\"), "\"a b\\\\\"");
        assert_eq!(quote_argument("a b\\\\"), "\"a b\\\\\\\\\"");
        assert_eq!(quote_argument("a\\\"b"), "\"a\\\\\\\"b\"");
    }

    #[test]
    fn verbatim_arguments_bypass_quoting_and_plain_arguments_do_not() {
        let mut plain = snapshot();
        plain.arguments = vec!["a b".to_owned()];
        assert!(plain.command_line().expect("line").ends_with("\"a b\""));

        let mut verbatim = snapshot();
        verbatim.verbatim_arguments = true;
        verbatim.arguments = vec!["a b".to_owned()];
        assert!(verbatim.command_line().expect("line").ends_with(" a b"));
    }

    #[test]
    fn the_environment_block_is_sorted_nul_separated_and_double_terminated() {
        let mut snapshot = snapshot();
        snapshot.environment.insert("B".to_owned(), "2".to_owned());
        snapshot.environment.insert("A".to_owned(), "1".to_owned());
        let block = snapshot.environment_block().expect("block");
        let text: Vec<String> = block
            .split(|unit| *unit == 0)
            .filter(|piece| !piece.is_empty())
            .map(|piece| String::from_utf16(piece).expect("utf16"))
            .collect();
        assert_eq!(text, vec!["A=1", "B=2", "RASEN_SCOPE=1"]);
        assert_eq!(block[block.len() - 1], 0);
        assert_eq!(block[block.len() - 2], 0);
    }

    #[test]
    fn an_empty_environment_block_carries_the_two_nuls_the_kernel_requires() {
        // The contract is the Win32 environment-block format: every string is NUL terminated
        // and the block itself is NUL terminated. An empty block is therefore two NULs. The
        // single-NUL form this originally produced is not "a smaller valid block" — the real
        // kernel refuses it with ERROR_INVALID_PARAMETER, so the assertion below states the
        // requirement rather than the previous behaviour.
        let mut snapshot = snapshot();
        snapshot.environment.clear();
        assert_eq!(snapshot.environment_block().expect("block"), vec![0_u16, 0]);
    }

    #[test]
    fn every_environment_block_ends_in_two_nuls_regardless_of_size() {
        for count in 0..4_usize {
            let mut snapshot = snapshot();
            snapshot.environment.clear();
            for index in 0..count {
                snapshot
                    .environment
                    .insert(format!("K{index}"), format!("v{index}"));
            }
            let block = snapshot.environment_block().expect("block");
            assert!(block.len() >= 2, "count {count} produced {block:?}");
            assert_eq!(block[block.len() - 1], 0, "count {count}");
            assert_eq!(block[block.len() - 2], 0, "count {count}");
        }
    }

    #[test]
    fn bounds_are_enforced_on_arguments_and_environment() {
        let mut oversize_arguments = snapshot();
        oversize_arguments.arguments = vec!["a".to_owned(); MAX_ARGUMENTS + 1];
        assert!(oversize_arguments.validate().is_err());

        let mut oversize_environment = snapshot();
        for index in 0..=MAX_ENVIRONMENT {
            oversize_environment
                .environment
                .insert(format!("K{index}"), "v".to_owned());
        }
        assert!(oversize_environment.validate().is_err());

        let mut malformed_key = snapshot();
        malformed_key
            .environment
            .insert("BAD=KEY".to_owned(), "v".to_owned());
        assert!(malformed_key.validate().is_err());
    }
}
