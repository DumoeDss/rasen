//! The guardian's durable event journal (task 6.5).
//!
//! Four record kinds, one monotonic sequence, and a terminal record that is durably flushed
//! **before the guardian exits and therefore before the last Job handle closes**. That
//! ordering is what lets a replacement distinguish "the authority reached exact empty" from
//! "the guardian vanished and we cannot tell".
//!
//! Durability on Windows is not the POSIX recipe: write a temporary file in the same
//! directory, `FlushFileBuffers` it, `MoveFileExW(REPLACE_EXISTING | WRITE_THROUGH)` over the
//! target, then flush a directory handle opened with `FILE_FLAG_BACKUP_SEMANTICS`.

use std::fs::{File, OpenOptions};
use std::io::{self, Write};
use std::os::windows::io::AsRawHandle;
use std::path::{Path, PathBuf};

use crate::protocol::{EventKind, RootStatus, SequenceGuard};
use crate::win;

const JOURNAL_MAGIC: &str = "RWJ1";
pub const MAX_JOURNAL_RECORDS: u64 = 4096;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct JournalRecord {
    pub sequence: u64,
    pub kind: EventKind,
    /// Bounded, non-secret detail. Never a capability, never the endpoint path.
    pub detail: String,
}

impl JournalRecord {
    pub fn encode(&self) -> io::Result<String> {
        if self.detail.contains('\n') || self.detail.len() > 512 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "journal detail is malformed or exceeds its bound",
            ));
        }
        Ok(format!(
            "{JOURNAL_MAGIC} {} {} {}\n",
            self.sequence,
            self.kind.name(),
            self.detail
        ))
    }

    pub fn decode(line: &str) -> io::Result<Self> {
        let mut parts = line.trim_end_matches('\n').splitn(4, ' ');
        let magic = parts.next().unwrap_or_default();
        if magic != JOURNAL_MAGIC {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "journal record magic is invalid",
            ));
        }
        let sequence: u64 = parts
            .next()
            .unwrap_or_default()
            .parse()
            .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "journal sequence"))?;
        let kind = EventKind::from_name(parts.next().unwrap_or_default()).ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::InvalidData,
                "journal record kind is outside the closed vocabulary",
            )
        })?;
        Ok(Self {
            sequence,
            kind,
            detail: parts.next().unwrap_or_default().to_owned(),
        })
    }
}

pub struct Journal {
    path: PathBuf,
    terminal_path: PathBuf,
    directory: PathBuf,
    sequence: SequenceGuard,
    terminal_written: bool,
}

impl Journal {
    pub fn create(path: &Path, terminal_path: &Path) -> io::Result<Self> {
        let directory = path
            .parent()
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "journal has no parent"))?
            .to_path_buf();
        Ok(Self {
            path: path.to_path_buf(),
            terminal_path: terminal_path.to_path_buf(),
            directory,
            sequence: SequenceGuard::new(),
            terminal_written: false,
        })
    }

    pub fn last_sequence(&self) -> u64 {
        self.sequence.last()
    }

    /// Append one record and flush it before returning.
    pub fn append(&mut self, kind: EventKind, detail: &str) -> io::Result<JournalRecord> {
        if self.sequence.last() >= MAX_JOURNAL_RECORDS {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "journal exceeded its record bound",
            ));
        }
        if self.terminal_written {
            return Err(io::Error::other(
                "native-ordering-conflict: a record was appended after the terminal record",
            ));
        }
        let record = JournalRecord {
            sequence: self.sequence.next(),
            kind,
            detail: detail.to_owned(),
        };
        let line = record.encode()?;
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)?;
        file.write_all(line.as_bytes())?;
        file.flush()?;
        win::flush_file(file.as_raw_handle() as crate::sys::Handle)?;
        if kind.is_terminal() {
            self.write_terminal_record(&record)?;
            self.terminal_written = true;
        }
        Ok(record)
    }

    /// The durably replaced terminal record. Written before the guardian exits so a
    /// replacement can apply it rather than fall back to the last-handle rule.
    fn write_terminal_record(&self, record: &JournalRecord) -> io::Result<()> {
        let temporary = self.directory.join(format!(
            "terminal.{}.partial",
            win::current_process_id()
        ));
        {
            let mut file = File::create(&temporary)?;
            file.write_all(record.encode()?.as_bytes())?;
            file.flush()?;
            win::flush_file(file.as_raw_handle() as crate::sys::Handle)?;
        }
        win::replace_file_atomically(
            &temporary.to_string_lossy(),
            &self.terminal_path.to_string_lossy(),
        )?;
        win::flush_directory(&self.directory.to_string_lossy())?;
        Ok(())
    }

    pub fn terminal_record(&self) -> io::Result<Option<JournalRecord>> {
        match std::fs::read_to_string(&self.terminal_path) {
            Ok(text) => Ok(Some(JournalRecord::decode(text.trim_end())?)),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(error),
        }
    }

    /// Read the journal back and verify the sequence is complete and monotonic. A missing,
    /// duplicated or reordered record is an `event-gap`, never a repaired history.
    pub fn read_verified(path: &Path) -> io::Result<Vec<JournalRecord>> {
        let text = match std::fs::read_to_string(path) {
            Ok(text) => text,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => return Err(error),
        };
        let mut guard = SequenceGuard::new();
        let mut records = Vec::new();
        for line in text.lines().filter(|line| !line.trim().is_empty()) {
            let record = JournalRecord::decode(line)?;
            guard.accept(record.sequence)?;
            records.push(record);
        }
        if let Some(terminal_at) = records.iter().position(|record| record.kind.is_terminal()) {
            if terminal_at + 1 != records.len() {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "event-gap: a record follows the terminal record",
                ));
            }
        }
        Ok(records)
    }
}

/// Detail text for a root-exit record. Unsigned, no signal name, ever.
pub fn root_exit_detail(status: RootStatus) -> String {
    format!("code={} signal=null", status.unsigned_text())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(tag: &str) -> PathBuf {
        let mut base = std::env::temp_dir();
        base.push(format!(
            "rasen-wpa-journal-{tag}-{}",
            win::current_process_id()
        ));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).expect("scratch");
        base
    }

    fn journal(tag: &str) -> (PathBuf, Journal) {
        let directory = scratch(tag);
        let journal = Journal::create(
            &directory.join("journal.log"),
            &directory.join("terminal.record"),
        )
        .expect("journal");
        (directory, journal)
    }

    #[test]
    fn records_are_monotonic_and_read_back_verified() {
        let (directory, mut journal) = journal("monotonic");
        journal.append(EventKind::Prepared, "inert").expect("prepared");
        journal.append(EventKind::Activated, "root=42").expect("activated");
        journal
            .append(EventKind::RootExited, &root_exit_detail(RootStatus { code: 0 }))
            .expect("root exited");
        let records = Journal::read_verified(&directory.join("journal.log")).expect("read");
        assert_eq!(records.len(), 3);
        assert_eq!(
            records.iter().map(|record| record.sequence).collect::<Vec<_>>(),
            vec![1, 2, 3]
        );
        assert_eq!(records[2].detail, "code=0 signal=null");
        let _ = std::fs::remove_dir_all(&directory);
    }

    #[test]
    fn a_terminal_record_is_durably_written_and_closes_the_journal() {
        let (directory, mut journal) = journal("terminal");
        journal.append(EventKind::Prepared, "inert").expect("prepared");
        assert!(journal.terminal_record().expect("read").is_none());
        journal
            .append(EventKind::ExactScopeEmpty, "active=0")
            .expect("empty");
        let terminal = journal.terminal_record().expect("read").expect("present");
        assert_eq!(terminal.kind, EventKind::ExactScopeEmpty);
        assert_eq!(terminal.sequence, 2);
        // The contract requires the terminal record to be the last thing the guardian writes.
        let error = journal
            .append(EventKind::Activated, "late")
            .expect_err("append after terminal");
        assert!(error.to_string().contains("native-ordering-conflict"));
        let _ = std::fs::remove_dir_all(&directory);
    }

    #[test]
    fn a_gap_or_reorder_in_the_journal_file_is_reported_rather_than_repaired() {
        // Written by hand rather than through `append`, because the point is that a file which
        // was damaged out of band must not read back as a healthy history.
        let directory = scratch("gap");
        let path = directory.join("journal.log");
        std::fs::write(
            &path,
            "RWJ1 1 prepared inert\nRWJ1 3 activated root=1\n",
        )
        .expect("write");
        let error = Journal::read_verified(&path).expect_err("gap accepted");
        assert!(error.to_string().contains("event-gap"), "{error}");

        std::fs::write(
            &path,
            "RWJ1 2 prepared inert\nRWJ1 1 activated root=1\n",
        )
        .expect("write");
        assert!(Journal::read_verified(&path).is_err(), "reorder accepted");

        std::fs::write(
            &path,
            "RWJ1 1 prepared inert\nRWJ1 1 prepared inert\n",
        )
        .expect("write");
        assert!(Journal::read_verified(&path).is_err(), "duplicate accepted");
        let _ = std::fs::remove_dir_all(&directory);
    }

    #[test]
    fn a_record_after_the_terminal_record_is_an_event_gap_on_read() {
        let directory = scratch("after-terminal");
        let path = directory.join("journal.log");
        std::fs::write(
            &path,
            "RWJ1 1 exact-scope-empty active=0\nRWJ1 2 activated root=1\n",
        )
        .expect("write");
        let error = Journal::read_verified(&path).expect_err("accepted");
        assert!(error.to_string().contains("event-gap"), "{error}");
        let _ = std::fs::remove_dir_all(&directory);
    }

    #[test]
    fn records_outside_the_closed_vocabulary_are_refused() {
        assert!(JournalRecord::decode("RWJ1 1 published anything").is_err());
        assert!(JournalRecord::decode("RWJ1 1 publish anything").is_err());
        assert!(JournalRecord::decode("XXXX 1 prepared inert").is_err());
        assert!(JournalRecord::decode("RWJ1 x prepared inert").is_err());
        assert!(JournalRecord::decode("RWJ1 1 prepared inert").is_ok());
    }

    #[test]
    fn a_detail_with_a_newline_or_beyond_its_bound_is_refused() {
        let record = JournalRecord {
            sequence: 1,
            kind: EventKind::Prepared,
            detail: "a\nb".to_owned(),
        };
        assert!(record.encode().is_err());
        let record = JournalRecord {
            sequence: 1,
            kind: EventKind::Prepared,
            detail: "a".repeat(513),
        };
        assert!(record.encode().is_err());
    }
}
