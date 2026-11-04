//! The Job Object authority (tasks 4.1, 4.2, 4.3, and the kernel half of 6.1/6.3/6.4).
//!
//! One unnamed Job Object is the recursive authority. Unnamed, so there is no kernel-namespace
//! name to squat and no pre-existing object to hijack. Its limit mask is **read back and
//! required to be bit-exact**, because `SetInformationJobObject` succeeding is not evidence.
//! Its completion port is associated while the Job is still empty, because associating after a
//! member exists silently loses that member's `NEW_PROCESS` message and permanently corrupts
//! the event stream the exact-empty oracle depends on.

use std::ffi::c_void;
use std::io;
use std::mem::size_of;
use std::ptr::{null, null_mut};
use std::sync::atomic::{AtomicU32, Ordering};

use crate::protocol::MembershipMessage;
use crate::sys::*;
use crate::win::{last_error, last_error_code, OwnedHandle};

/// The exact extended-limit mask this authority requires: kill-on-job-close set, both
/// breakaway permissions clear, every other limit clear.
pub const EXPECTED_LIMIT_MASK: Dword = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;

/// The completion key associated with the Job's port. A message arriving under any other key
/// did not come from this Job.
pub const COMPLETION_KEY: UlongPtr = 0x7261_7365_6e77_7061;

/// The single accounting field permitted as emptiness corroboration. `TotalProcesses` is the
/// cumulative count of every process that has ever been a member and would report a
/// long-finished scope as populated forever.
pub const EMPTINESS_CORROBORATION_FIELD: &str = "active_processes";

/// Facts observed — not intended — during Job construction. Carried into the prepare
/// attestation so a reviewer sees actual values.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct JobAttestation {
    /// The mask read back from the kernel after configuration.
    pub observed_limit_mask: Dword,
    pub active_processes_before_port_association: u32,
    pub active_processes_after_port_association: u32,
    /// `GetHandleInformation` on the Job handle. Must be 0: not inheritable.
    pub job_handle_inherit_flags: Dword,
    /// How many times the Job handle has been duplicated out of this process. The sole-handle
    /// invariant requires 0; the task 9.2 mutation makes it 1 and the recovery rules must then
    /// refuse to infer exact empty from guardian absence.
    pub job_handle_duplications: u32,
}

impl JobAttestation {
    pub fn breakaway_is_disabled(&self) -> bool {
        self.observed_limit_mask & JOB_OBJECT_LIMIT_BREAKAWAY_OK == 0
            && self.observed_limit_mask & JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK == 0
    }

    pub fn kill_on_close_is_enabled(&self) -> bool {
        self.observed_limit_mask & JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE != 0
    }

    pub fn mask_is_exact(&self) -> bool {
        self.observed_limit_mask == EXPECTED_LIMIT_MASK
    }

    pub fn port_was_associated_on_an_empty_job(&self) -> bool {
        self.active_processes_before_port_association == 0
            && self.active_processes_after_port_association == 0
    }

    /// The sole-handle attestation consumed by the reference and by the recovery rules. The
    /// "guardian died therefore the kernel emptied the Job" inference is sound **only** because
    /// this holds.
    pub fn sole_handle_holds(&self) -> bool {
        self.job_handle_duplications == 0 && self.job_handle_inherit_flags == 0
    }

    pub fn describe(&self) -> String {
        format!(
            "mask=0x{:08x} exact={} breakaway-disabled={} kill-on-close={} \
             port-association-active-before={} port-association-active-after={} \
             inherit-flags=0x{:x} duplications={} sole-handle={}",
            self.observed_limit_mask,
            self.mask_is_exact(),
            self.breakaway_is_disabled(),
            self.kill_on_close_is_enabled(),
            self.active_processes_before_port_association,
            self.active_processes_after_port_association,
            self.job_handle_inherit_flags,
            self.job_handle_duplications,
            self.sole_handle_holds(),
        )
    }
}

/// A reading of `JOBOBJECT_BASIC_ACCOUNTING_INFORMATION`. Only [`Self::active_processes`] may
/// decide emptiness; [`Self::total_processes`] is carried for diagnostics only.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct AccountingSnapshot {
    pub active_processes: u32,
    pub total_processes: u32,
}

impl AccountingSnapshot {
    /// Corroboration only, never the oracle. `exact-scope-empty` comes from the
    /// `ACTIVE_PROCESS_ZERO` message; this value is recorded alongside it.
    pub fn corroborates_empty(&self) -> bool {
        self.active_processes == 0
    }
}

/// A raw message read from the Job's completion port.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PortMessage {
    Membership(MembershipMessage),
    /// A message from our Job that is not part of the membership vocabulary. Never silently
    /// dropped: an unexplained message makes the observation an `event-gap`.
    Unexplained { message: Dword, process_id: u32 },
}

/// Construction options. `duplicate_job_handle` exists solely for the task 9.2 RED mutation and
/// is never set on any production path.
#[derive(Clone, Copy, Debug, Default)]
pub struct JobMutations {
    /// Enable `JOB_OBJECT_LIMIT_BREAKAWAY_OK`. Task 9.1 RED.
    pub allow_breakaway: bool,
    /// Enable `JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK`. Task 9.1 RED.
    pub allow_silent_breakaway: bool,
    /// Associate the completion port only after the first member exists. Task 9.3 RED.
    pub associate_port_late: bool,
}

impl JobMutations {
    pub fn any(&self) -> bool {
        self.allow_breakaway || self.allow_silent_breakaway || self.associate_port_late
    }

    pub fn intended_mask(&self) -> Dword {
        let mut mask = EXPECTED_LIMIT_MASK;
        if self.allow_breakaway {
            mask |= JOB_OBJECT_LIMIT_BREAKAWAY_OK;
        }
        if self.allow_silent_breakaway {
            mask |= JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK;
        }
        mask
    }
}

pub struct JobAuthority {
    job: OwnedHandle,
    port: OwnedHandle,
    attestation: JobAttestation,
    duplications: AtomicU32,
    port_associated: bool,
}

impl JobAuthority {
    pub fn create() -> io::Result<Self> {
        Self::create_with(JobMutations::default())
    }

    pub fn create_with(mutations: JobMutations) -> io::Result<Self> {
        // Unnamed: no kernel-namespace name to squat, no pre-existing object to hijack.
        let raw = unsafe { CreateJobObjectW(null_mut(), null()) };
        if raw.is_null() {
            return Err(last_error("CreateJobObjectW"));
        }
        let job = unsafe { OwnedHandle::from_raw(raw) };

        // Non-inheritable by construction, then asserted by reading the flags back.
        if unsafe { SetHandleInformation(job.raw(), HANDLE_FLAG_INHERIT, 0) } == FALSE {
            return Err(last_error("SetHandleInformation job"));
        }
        let mut inherit_flags: Dword = 0;
        if unsafe { GetHandleInformation(job.raw(), &mut inherit_flags) } == FALSE {
            return Err(last_error("GetHandleInformation job"));
        }
        if inherit_flags & HANDLE_FLAG_INHERIT != 0 {
            return Err(io::Error::other(
                "authority-unavailable: the Job handle is inheritable",
            ));
        }

        let mut limits = JobObjectExtendedLimitInformation::default();
        limits.basic_limit_information.limit_flags = mutations.intended_mask();
        let ok = unsafe {
            SetInformationJobObject(
                job.raw(),
                JOB_OBJECT_EXTENDED_LIMIT_INFORMATION,
                &limits as *const _ as *const c_void,
                size_of::<JobObjectExtendedLimitInformation>() as Dword,
            )
        };
        if ok == FALSE {
            return Err(last_error("SetInformationJobObject limits"));
        }

        // Setting succeeded is not evidence. Read the mask back and require bit-exact equality.
        let observed = read_limit_mask(job.raw())?;
        if !mutations.any() && observed != EXPECTED_LIMIT_MASK {
            return Err(io::Error::other(format!(
                "authority-unavailable: Job limit mask read back as 0x{observed:08x}, expected 0x{EXPECTED_LIMIT_MASK:08x}"
            )));
        }

        let before = read_accounting(job.raw())?;
        if before.active_processes != 0 {
            return Err(io::Error::other(
                "authority-unavailable: a freshly created Job already has a member",
            ));
        }

        let port_raw =
            unsafe { CreateIoCompletionPort(INVALID_HANDLE_VALUE, null_mut(), 0, 1) };
        if port_raw.is_null() {
            return Err(last_error("CreateIoCompletionPort"));
        }
        let port = unsafe { OwnedHandle::from_raw(port_raw) };

        let mut authority = Self {
            job,
            port,
            attestation: JobAttestation {
                observed_limit_mask: observed,
                active_processes_before_port_association: before.active_processes,
                active_processes_after_port_association: u32::MAX,
                job_handle_inherit_flags: inherit_flags,
                job_handle_duplications: 0,
            },
            duplications: AtomicU32::new(0),
            port_associated: false,
        };

        if mutations.associate_port_late {
            // Task 9.3 RED: leave the port unassociated so the caller can create a member
            // first. The resulting attestation records a non-zero active count and
            // `port_was_associated_on_an_empty_job()` is false.
            return Ok(authority);
        }

        authority.associate_port()?;
        Ok(authority)
    }

    /// Associate the completion port. Production associates while the Job is empty; the task
    /// 9.3 mutation defers this call until after a member exists.
    pub fn associate_port(&mut self) -> io::Result<()> {
        if self.port_associated {
            return Err(io::Error::other(
                "native-ordering-conflict: completion port associated twice",
            ));
        }
        let association = JobObjectAssociateCompletionPort {
            completion_key: COMPLETION_KEY as *mut c_void,
            completion_port: self.port.raw(),
        };
        let ok = unsafe {
            SetInformationJobObject(
                self.job.raw(),
                JOB_OBJECT_ASSOCIATE_COMPLETION_PORT_INFORMATION,
                &association as *const _ as *const c_void,
                size_of::<JobObjectAssociateCompletionPort>() as Dword,
            )
        };
        if ok == FALSE {
            return Err(last_error("SetInformationJobObject completion port"));
        }
        let after = read_accounting(self.job.raw())?;
        self.attestation.active_processes_after_port_association = after.active_processes;
        self.port_associated = true;
        Ok(())
    }

    pub fn attestation(&self) -> JobAttestation {
        JobAttestation {
            job_handle_duplications: self.duplications.load(Ordering::SeqCst),
            ..self.attestation
        }
    }

    pub fn raw_job(&self) -> Handle {
        self.job.raw()
    }

    pub fn raw_port(&self) -> Handle {
        self.port.raw()
    }

    pub fn accounting(&self) -> io::Result<AccountingSnapshot> {
        read_accounting(self.job.raw())
    }

    pub fn limit_mask(&self) -> io::Result<Dword> {
        read_limit_mask(self.job.raw())
    }

    pub fn contains(&self, process: Handle) -> io::Result<bool> {
        let mut result: Bool = FALSE;
        if unsafe { IsProcessInJob(process, self.job.raw(), &mut result) } == FALSE {
            return Err(last_error("IsProcessInJob"));
        }
        Ok(result != FALSE)
    }

    pub fn terminate(&self, exit_code: Dword) -> io::Result<()> {
        if unsafe { TerminateJobObject(self.job.raw(), exit_code) } == FALSE {
            return Err(last_error("TerminateJobObject"));
        }
        Ok(())
    }

    /// Block for a completion-port message. `None` means the wait timed out.
    pub fn poll(&self, timeout_ms: Dword) -> io::Result<Option<PortMessage>> {
        let mut bytes: Dword = 0;
        let mut key: UlongPtr = 0;
        let mut overlapped: *mut Overlapped = null_mut();
        let ok = unsafe {
            GetQueuedCompletionStatus(
                self.port.raw(),
                &mut bytes,
                &mut key,
                &mut overlapped,
                timeout_ms,
            )
        };
        if ok == FALSE {
            let code = last_error_code();
            if code == WAIT_TIMEOUT as i32 {
                return Ok(None);
            }
            if code == ERROR_ABANDONED_WAIT_0 {
                return Err(io::Error::other(
                    "native-transport-lost: the Job completion port was closed",
                ));
            }
            return Err(last_error("GetQueuedCompletionStatus"));
        }
        if key != COMPLETION_KEY {
            return Err(io::Error::other(format!(
                "event-gap: completion message under foreign key 0x{key:x}"
            )));
        }
        let process_id = overlapped as usize as u32;
        Ok(Some(classify_message(bytes, process_id)))
    }

    /// Wake a blocked [`Self::poll`] so the guardian can shut down deterministically.
    pub fn wake_poller(&self) -> io::Result<()> {
        let ok = unsafe {
            PostQueuedCompletionStatus(self.port.raw(), 0, COMPLETION_KEY, null_mut())
        };
        if ok == FALSE {
            return Err(last_error("PostQueuedCompletionStatus"));
        }
        Ok(())
    }

    /// **Mutation only (task 9.2).** Duplicate the Job handle into another process, breaking
    /// the sole-handle invariant so that killing the guardian no longer destroys the Job.
    /// Never called on any production path; the resulting attestation reports
    /// `sole_handle_holds() == false`.
    pub fn duplicate_into_for_mutation(&self, target: Handle) -> io::Result<()> {
        const DUPLICATE_SAME_ACCESS: Dword = 2;
        let mut duplicated: Handle = null_mut();
        let ok = unsafe {
            DuplicateHandle(
                GetCurrentProcess(),
                self.job.raw(),
                target,
                &mut duplicated,
                0,
                FALSE,
                DUPLICATE_SAME_ACCESS,
            )
        };
        if ok == FALSE {
            return Err(last_error("DuplicateHandle mutation"));
        }
        self.duplications.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }
}

fn classify_message(message: Dword, process_id: u32) -> PortMessage {
    match message {
        JOB_OBJECT_MSG_NEW_PROCESS => {
            PortMessage::Membership(MembershipMessage::NewProcess(process_id))
        }
        JOB_OBJECT_MSG_EXIT_PROCESS => {
            PortMessage::Membership(MembershipMessage::ExitProcess(process_id))
        }
        JOB_OBJECT_MSG_ABNORMAL_EXIT_PROCESS => {
            PortMessage::Membership(MembershipMessage::AbnormalExitProcess(process_id))
        }
        JOB_OBJECT_MSG_ACTIVE_PROCESS_ZERO => {
            PortMessage::Membership(MembershipMessage::ActiveProcessZero)
        }
        other => PortMessage::Unexplained {
            message: other,
            process_id,
        },
    }
}

fn read_limit_mask(job: Handle) -> io::Result<Dword> {
    let mut limits = JobObjectExtendedLimitInformation::default();
    let mut returned: Dword = 0;
    let ok = unsafe {
        QueryInformationJobObject(
            job,
            JOB_OBJECT_EXTENDED_LIMIT_INFORMATION,
            &mut limits as *mut _ as *mut c_void,
            size_of::<JobObjectExtendedLimitInformation>() as Dword,
            &mut returned,
        )
    };
    if ok == FALSE {
        return Err(last_error("QueryInformationJobObject limits"));
    }
    if returned as usize != size_of::<JobObjectExtendedLimitInformation>() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("Job limit information returned {returned} bytes"),
        ));
    }
    Ok(limits.basic_limit_information.limit_flags)
}

fn read_accounting(job: Handle) -> io::Result<AccountingSnapshot> {
    let mut accounting = JobObjectBasicAccountingInformation::default();
    let mut returned: Dword = 0;
    let ok = unsafe {
        QueryInformationJobObject(
            job,
            JOB_OBJECT_BASIC_ACCOUNTING_INFORMATION,
            &mut accounting as *mut _ as *mut c_void,
            size_of::<JobObjectBasicAccountingInformation>() as Dword,
            &mut returned,
        )
    };
    if ok == FALSE {
        return Err(last_error("QueryInformationJobObject accounting"));
    }
    if returned as usize != size_of::<JobObjectBasicAccountingInformation>() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("Job accounting returned {returned} bytes"),
        ));
    }
    Ok(AccountingSnapshot {
        active_processes: accounting.active_processes,
        total_processes: accounting.total_processes,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_created_authority_reads_back_the_exact_expected_mask() {
        let authority = JobAuthority::create().expect("create");
        let attestation = authority.attestation();
        assert!(attestation.mask_is_exact(), "{}", attestation.describe());
        assert!(attestation.kill_on_close_is_enabled());
        assert!(attestation.breakaway_is_disabled());
        assert_eq!(attestation.observed_limit_mask, EXPECTED_LIMIT_MASK);
        // Read the live mask again through the kernel rather than trusting the recorded copy.
        assert_eq!(authority.limit_mask().expect("mask"), EXPECTED_LIMIT_MASK);
    }

    #[test]
    fn the_port_is_associated_while_the_job_is_still_empty() {
        let authority = JobAuthority::create().expect("create");
        let attestation = authority.attestation();
        assert!(
            attestation.port_was_associated_on_an_empty_job(),
            "{}",
            attestation.describe()
        );
        assert_eq!(attestation.active_processes_before_port_association, 0);
        assert_eq!(attestation.active_processes_after_port_association, 0);
    }

    #[test]
    fn a_breakaway_enabled_job_fails_the_attestation_it_would_otherwise_pass() {
        // RED counterpart for the breakaway invariant at the attestation level. The kernel
        // level RED is task 9.1's real create-process attempt.
        let mutated = JobAuthority::create_with(JobMutations {
            allow_breakaway: true,
            ..JobMutations::default()
        })
        .expect("create mutated");
        let attestation = mutated.attestation();
        assert!(!attestation.mask_is_exact());
        assert!(!attestation.breakaway_is_disabled());
        assert_ne!(attestation.observed_limit_mask, EXPECTED_LIMIT_MASK);

        let silent = JobAuthority::create_with(JobMutations {
            allow_silent_breakaway: true,
            ..JobMutations::default()
        })
        .expect("create mutated");
        assert!(!silent.attestation().breakaway_is_disabled());
    }

    #[test]
    fn the_sole_handle_attestation_goes_false_when_the_handle_is_duplicated() {
        // Task 9.2's provider-level consequence: the attestation the recovery rules consume
        // must stop holding the moment the invariant is broken. Without this the duplicate
        // handle mutation would be invisible above the kernel.
        let authority = JobAuthority::create().expect("create");
        assert!(authority.attestation().sole_handle_holds());
        authority
            .duplicate_into_for_mutation(unsafe { GetCurrentProcess() })
            .expect("duplicate");
        assert!(
            !authority.attestation().sole_handle_holds(),
            "duplicating the Job handle left the sole-handle attestation intact"
        );
        assert_eq!(authority.attestation().job_handle_duplications, 1);
    }

    #[test]
    fn emptiness_corroboration_reads_the_active_field_and_not_the_total_field() {
        // Task 6.4. These two snapshots are exactly the discriminating pair: an implementation
        // that read `total_processes` would classify both of them the other way round.
        let live_but_never_recycled = AccountingSnapshot {
            active_processes: 3,
            total_processes: 0,
        };
        let finished_long_ago = AccountingSnapshot {
            active_processes: 0,
            total_processes: 500,
        };
        assert!(!live_but_never_recycled.corroborates_empty());
        assert!(finished_long_ago.corroborates_empty());
        assert_eq!(EMPTINESS_CORROBORATION_FIELD, "active_processes");
    }

    #[test]
    fn completion_messages_outside_the_membership_vocabulary_are_unexplained() {
        assert_eq!(
            classify_message(JOB_OBJECT_MSG_NEW_PROCESS, 42),
            PortMessage::Membership(MembershipMessage::NewProcess(42))
        );
        assert_eq!(
            classify_message(JOB_OBJECT_MSG_ACTIVE_PROCESS_ZERO, 0),
            PortMessage::Membership(MembershipMessage::ActiveProcessZero)
        );
        for message in [
            JOB_OBJECT_MSG_END_OF_JOB_TIME,
            JOB_OBJECT_MSG_END_OF_PROCESS_TIME,
            JOB_OBJECT_MSG_ACTIVE_PROCESS_LIMIT,
            JOB_OBJECT_MSG_PROCESS_MEMORY_LIMIT,
            JOB_OBJECT_MSG_JOB_MEMORY_LIMIT,
            JOB_OBJECT_MSG_NOTIFICATION_LIMIT,
            4242,
        ] {
            assert!(
                matches!(
                    classify_message(message, 1),
                    PortMessage::Unexplained { .. }
                ),
                "message {message} was silently absorbed into the membership vocabulary"
            );
        }
    }

    #[test]
    fn waking_the_poller_delivers_a_message_that_is_classified_as_unexplained() {
        // Task 9.6: `PostQueuedCompletionStatus` is a declared foreign item, so it owes a real
        // call against the real kernel. It had a call site inside `wake_poller` and
        // `wake_poller` had no callers, which means the declaration was never actually
        // executed — exactly the debt the "every declared item is exercised" obligation exists
        // to catch. This is that call.
        //
        // It also asserts the right thing about the wake itself: a manual wake is not a
        // membership message, and it must not be absorbed into the membership vocabulary.
        let authority = JobAuthority::create().expect("create");
        assert_eq!(authority.poll(10).expect("quiet"), None);
        authority.wake_poller().expect("wake");
        let message = authority
            .poll(2_000)
            .expect("poll")
            .expect("the wake did not reach the poller");
        assert!(
            matches!(message, PortMessage::Unexplained { message: 0, .. }),
            "a manual wake was classified as {message:?}"
        );
        assert_eq!(authority.poll(10).expect("quiet again"), None);
    }

    #[test]
    fn an_empty_authority_reports_no_membership_message() {
        let authority = JobAuthority::create().expect("create");
        assert_eq!(authority.poll(10).expect("poll"), None);
        assert_eq!(
            authority.accounting().expect("accounting").active_processes,
            0
        );
    }
}
