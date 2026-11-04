//! Suspended assign-before-run activation (tasks 5.1, 5.2, 5.3).
//!
//! The workload root is created **by the guardian, in one `CreateProcessW` call**, with
//! `PROC_THREAD_ATTRIBUTE_JOB_LIST` so the kernel places it in the Job **as part of process
//! creation** — before `ntdll` loader initialization and before any static-import
//! `DLL_PROCESS_ATTACH` can execute. `CREATE_SUSPENDED` is kept as defence in depth and as the
//! mechanism that makes activation a distinct, exactly-once act.
//!
//! This is a deliberate divergence from `plan.md:291-292`'s literal
//! `CREATE_SUSPENDED` -> `AssignProcessToJobObject` -> `ResumeThread` wording. That sequence
//! leaves a window in which the process object exists, unassigned; `PROC_THREAD_ATTRIBUTE_JOB_LIST`
//! removes the window entirely. `AssignProcessToJobObject` is therefore not declared anywhere
//! in this crate — the weaker construction is not merely unused, it is unreachable.

use std::ffi::c_void;
use std::io;
use std::mem::{size_of, zeroed};
use std::ptr::null_mut;
use std::time::{Duration, Instant};

use crate::job::JobAuthority;
use crate::launch::LaunchSnapshot;
use crate::protocol::MembershipMessage;
use crate::sys::*;
use crate::win::{self, last_error, OwnedHandle};

/// The three standard I/O handles the root is allowed to inherit, and nothing else.
pub struct RootStdio {
    pub stdin_read: OwnedHandle,
    pub stdout_write: OwnedHandle,
    pub stderr_write: OwnedHandle,
}

pub struct SuspendedRoot {
    pub process: OwnedHandle,
    pub thread: OwnedHandle,
    pub process_id: u32,
    pub birth: u64,
    resumed: bool,
}

impl SuspendedRoot {
    pub fn is_resumed(&self) -> bool {
        self.resumed
    }

    /// Resume the initial thread exactly once.
    pub fn resume(&mut self) -> io::Result<()> {
        if self.resumed {
            return Err(io::Error::other(
                "native-ordering-conflict: the workload root was already resumed",
            ));
        }
        if unsafe { ResumeThread(self.thread.raw()) } == u32::MAX {
            return Err(last_error("ResumeThread"));
        }
        self.resumed = true;
        Ok(())
    }

    /// Destroy a root that failed its pre-resume proof. The workload has executed nothing.
    pub fn terminate_unresumed(&mut self, code: Dword) -> io::Result<()> {
        if self.resumed {
            return Err(io::Error::other(
                "terminate_unresumed called on a resumed root",
            ));
        }
        if unsafe { TerminateProcess(self.process.raw(), code) } == FALSE {
            return Err(last_error("TerminateProcess"));
        }
        unsafe { WaitForSingleObject(self.process.raw(), 5_000) };
        Ok(())
    }
}

/// Deliberate breakages used to demonstrate that the activation oracles discriminate.
#[derive(Clone, Copy, Debug, Default)]
pub struct ActivationMutations {
    /// Create the root **without** `PROC_THREAD_ATTRIBUTE_JOB_LIST`, so it is never a member.
    /// The membership proof must then fail and the root must die still suspended.
    pub omit_job_list: bool,
    /// Skip the pre-resume proof entirely and resume regardless. Used to show the proof is
    /// what prevents an unproven root from executing.
    pub skip_membership_proof: bool,
    /// Resume before the membership event has been received.
    pub resume_before_membership_event: bool,
}

/// Create the workload root, suspended, with its Job membership applied as part of creation.
pub fn create_root_suspended(
    job: &JobAuthority,
    launch: &LaunchSnapshot,
    stdio: &RootStdio,
    mutations: ActivationMutations,
) -> io::Result<SuspendedRoot> {
    launch.validate()?;
    let application = win::wide(&launch.executable);
    let mut command_line = win::wide(&launch.command_line()?);
    let working_directory = win::wide(&launch.working_directory);
    let mut environment = launch.environment_block()?;

    let attribute_count: Dword = if mutations.omit_job_list { 1 } else { 2 };
    let mut bytes = 0_usize;
    unsafe { InitializeProcThreadAttributeList(null_mut(), attribute_count, 0, &mut bytes) };
    if bytes == 0 {
        return Err(last_error("InitializeProcThreadAttributeList size"));
    }
    let mut storage = vec![0_u8; bytes];
    let list = storage.as_mut_ptr() as *mut c_void;
    if unsafe { InitializeProcThreadAttributeList(list, attribute_count, 0, &mut bytes) } == FALSE {
        return Err(last_error("InitializeProcThreadAttributeList"));
    }

    let mut job_handle = job.raw_job();
    if !mutations.omit_job_list {
        let ok = unsafe {
            UpdateProcThreadAttribute(
                list,
                0,
                PROC_THREAD_ATTRIBUTE_JOB_LIST,
                &mut job_handle as *mut _ as *mut c_void,
                size_of::<Handle>(),
                null_mut(),
                null_mut(),
            )
        };
        if ok == FALSE {
            unsafe { DeleteProcThreadAttributeList(list) };
            return Err(last_error("UpdateProcThreadAttribute job list"));
        }
    }

    // Exactly the three standard I/O handles, and nothing else.
    let mut handles = [
        stdio.stdin_read.raw(),
        stdio.stdout_write.raw(),
        stdio.stderr_write.raw(),
    ];
    let ok = unsafe {
        UpdateProcThreadAttribute(
            list,
            0,
            PROC_THREAD_ATTRIBUTE_HANDLE_LIST,
            handles.as_mut_ptr() as *mut c_void,
            size_of::<Handle>() * handles.len(),
            null_mut(),
            null_mut(),
        )
    };
    if ok == FALSE {
        unsafe { DeleteProcThreadAttributeList(list) };
        return Err(last_error("UpdateProcThreadAttribute handle list"));
    }

    let mut startup: StartupInfoExW = unsafe { zeroed() };
    startup.startup.cb = size_of::<StartupInfoExW>() as Dword;
    startup.startup.flags = STARTF_USESTDHANDLES;
    startup.startup.stdin = stdio.stdin_read.raw();
    startup.startup.stdout = stdio.stdout_write.raw();
    startup.startup.stderr = stdio.stderr_write.raw();
    startup.attributes = list;

    let mut information: ProcessInformation = unsafe { zeroed() };
    let created = unsafe {
        CreateProcessW(
            application.as_ptr(),
            command_line.as_mut_ptr(),
            null_mut(),
            null_mut(),
            TRUE,
            CREATE_SUSPENDED
                | CREATE_NO_WINDOW
                | CREATE_UNICODE_ENVIRONMENT
                | EXTENDED_STARTUPINFO_PRESENT,
            environment.as_mut_ptr() as *mut c_void,
            working_directory.as_ptr(),
            &mut startup.startup,
            &mut information,
        )
    };
    unsafe { DeleteProcThreadAttributeList(list) };
    if created == FALSE {
        return Err(last_error("CreateProcessW root"));
    }

    let process = unsafe { OwnedHandle::from_raw(information.process) };
    let thread = unsafe { OwnedHandle::from_raw(information.thread) };
    let birth = win::process_creation_filetime(process.raw())?;
    Ok(SuspendedRoot {
        process,
        thread,
        process_id: information.process_id,
        birth,
        resumed: false,
    })
}

/// The three pre-resume proofs, in order. Every one must succeed before the initial thread is
/// allowed to run.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct PreResumeProof {
    pub membership_confirmed: bool,
    pub limit_mask_unchanged: bool,
    pub membership_event_received: bool,
}

impl PreResumeProof {
    pub fn is_complete(&self) -> bool {
        self.membership_confirmed && self.limit_mask_unchanged && self.membership_event_received
    }

    pub fn missing(&self) -> Vec<&'static str> {
        let mut missing = Vec::new();
        if !self.membership_confirmed {
            missing.push("membership-not-confirmed-for-this-process");
        }
        if !self.limit_mask_unchanged {
            missing.push("limit-mask-changed-since-prepare");
        }
        if !self.membership_event_received {
            missing.push("membership-event-not-received-for-this-process-id");
        }
        missing
    }
}

/// Run the pre-resume proof. `await_new_process` is supplied by the guardian and must return
/// true only when the completion port delivered `JOB_OBJECT_MSG_NEW_PROCESS` for exactly this
/// process id.
pub fn prove_before_resume(
    job: &JobAuthority,
    root: &SuspendedRoot,
    expected_mask: Dword,
    mutations: ActivationMutations,
    mut await_new_process: impl FnMut(u32, Duration) -> bool,
) -> io::Result<PreResumeProof> {
    if mutations.skip_membership_proof {
        return Ok(PreResumeProof {
            membership_confirmed: true,
            limit_mask_unchanged: true,
            membership_event_received: true,
        });
    }
    let membership_confirmed = job.contains(root.process.raw())?;
    let limit_mask_unchanged = job.limit_mask()? == expected_mask;
    let membership_event_received = if mutations.resume_before_membership_event {
        false
    } else {
        await_new_process(root.process_id, Duration::from_secs(10))
    };
    Ok(PreResumeProof {
        membership_confirmed,
        limit_mask_unchanged,
        membership_event_received,
    })
}

/// Wait for the root to exit, then read its status. **Order matters.**
/// `GetExitCodeProcess` returns `STILL_ACTIVE` (259) for a running process, so a process that
/// legitimately exits with code 259 is indistinguishable from a running one if the status is
/// read without a completed wait. Reading first is a real, classic Windows defect and this
/// function exists so the correct order is the only one production can take.
pub fn wait_then_read_exit_status(process: Handle, timeout_ms: Dword) -> io::Result<Option<Dword>> {
    let waited = unsafe { WaitForSingleObject(process, timeout_ms) };
    if waited == WAIT_TIMEOUT {
        return Ok(None);
    }
    if waited == WAIT_FAILED {
        return Err(last_error("WaitForSingleObject root"));
    }
    if waited != WAIT_OBJECT_0 {
        return Err(io::Error::other(format!(
            "native-uncertain: WaitForSingleObject returned {waited}"
        )));
    }
    let mut code: Dword = 0;
    if unsafe { GetExitCodeProcess(process, &mut code) } == FALSE {
        return Err(last_error("GetExitCodeProcess"));
    }
    Ok(Some(code))
}

/// **Mutation only (task 9.4 RED).** Read the exit status without a completed wait. A running
/// process reports 259, and so does a process that really exited with 259 — which is exactly
/// why production may never do this.
pub fn read_exit_status_without_waiting(process: Handle) -> io::Result<Dword> {
    let mut code: Dword = 0;
    if unsafe { GetExitCodeProcess(process, &mut code) } == FALSE {
        return Err(last_error("GetExitCodeProcess"));
    }
    Ok(code)
}

/// The bounded re-terminate loop (task 7.8 / 8.10). A member that had already called
/// `CreateProcessW` when the sweep ran can produce a `NEW_PROCESS` message after the
/// terminate, so force is re-applied on every such message until the authority's own
/// `ACTIVE_PROCESS_ZERO` arrives. Deadline expiry returns `Timeout`; it never returns empty.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TerminationOutcome {
    ExactEmpty { reterminations: u32 },
    Timeout { reterminations: u32 },
}

pub fn terminate_until_empty(
    job: &JobAuthority,
    exit_code: Dword,
    deadline: Instant,
) -> io::Result<TerminationOutcome> {
    job.terminate(exit_code)?;
    let mut reterminations = 0_u32;
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Ok(TerminationOutcome::Timeout { reterminations });
        }
        let slice = remaining.as_millis().min(250) as Dword;
        match job.poll(slice)? {
            Some(crate::job::PortMessage::Membership(MembershipMessage::ActiveProcessZero)) => {
                return Ok(TerminationOutcome::ExactEmpty { reterminations })
            }
            Some(crate::job::PortMessage::Membership(MembershipMessage::NewProcess(_))) => {
                job.terminate(exit_code)?;
                reterminations += 1;
            }
            Some(_) | None => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_pre_resume_proof_requires_all_three_facts() {
        assert!(PreResumeProof {
            membership_confirmed: true,
            limit_mask_unchanged: true,
            membership_event_received: true,
        }
        .is_complete());
        for (label, proof) in [
            (
                "membership-not-confirmed-for-this-process",
                PreResumeProof {
                    membership_confirmed: false,
                    limit_mask_unchanged: true,
                    membership_event_received: true,
                },
            ),
            (
                "limit-mask-changed-since-prepare",
                PreResumeProof {
                    membership_confirmed: true,
                    limit_mask_unchanged: false,
                    membership_event_received: true,
                },
            ),
            (
                "membership-event-not-received-for-this-process-id",
                PreResumeProof {
                    membership_confirmed: true,
                    limit_mask_unchanged: true,
                    membership_event_received: false,
                },
            ),
        ] {
            assert!(!proof.is_complete());
            assert_eq!(proof.missing(), vec![label]);
        }
    }

    #[test]
    fn a_resumed_root_cannot_be_resumed_twice() {
        // Exactly-once activation at the process level; the authority-level rule is in the
        // guardian. A doubly resumed initial thread would restart a suspended count that is
        // already zero and let the workload run under a second activation record.
        let mut root = SuspendedRoot {
            process: unsafe { OwnedHandle::from_raw(null_mut()) },
            thread: unsafe { OwnedHandle::from_raw(null_mut()) },
            process_id: 0,
            birth: 0,
            resumed: true,
        };
        let error = root.resume().expect_err("second resume accepted");
        assert!(error.to_string().contains("native-ordering-conflict"));
        assert!(root.terminate_unresumed(1).is_err());
    }
}
