use std::collections::BTreeMap;
use std::io;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use crate::broker_lease::CgroupLeafIdentity;
pub use crate::deadline::AbsoluteMonotonicDeadline as MonotonicDeadline;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CgroupRequirements {
    pub required_controllers: Vec<String>,
}

impl CgroupRequirements {
    pub fn broker_default() -> Self {
        Self {
            required_controllers: vec!["pids".to_owned()],
        }
    }

    pub fn validate(&self) -> io::Result<()> {
        if self.required_controllers.is_empty()
            || self.required_controllers.len() > 16
            || self.required_controllers.iter().any(|controller| {
                controller.is_empty()
                    || controller.len() > 32
                    || !controller
                        .bytes()
                        .all(|byte| byte.is_ascii_lowercase() || byte == b'_')
            })
        {
            return Err(invalid_input(
                "cgroup controller requirements are malformed",
            ));
        }
        Ok(())
    }
}

pub fn validate_cgroup_paths(mount_root: &Path, service_subtree: &Path) -> io::Result<()> {
    let Some(mount) = mount_root.to_str() else {
        return Err(invalid_input("cgroup mount root is not utf8"));
    };
    let Some(service) = service_subtree.to_str() else {
        return Err(invalid_input("cgroup service subtree is not utf8"));
    };
    if !is_closed_linux_absolute(mount)
        || !is_closed_linux_absolute(service)
        || mount == "/"
        || service == mount
        || service
            .strip_prefix(mount)
            .is_none_or(|suffix| !suffix.starts_with('/'))
    {
        return Err(invalid_input(
            "cgroup service subtree escapes its mount root",
        ));
    }
    Ok(())
}

fn is_closed_linux_absolute(value: &str) -> bool {
    value.starts_with('/')
        && !value.contains('\\')
        && value
            .split('/')
            .skip(1)
            .all(|component| !component.is_empty() && !matches!(component, "." | ".."))
}

pub trait CgroupKernel: Send + Sync {
    fn probe(&self, requirements: &CgroupRequirements) -> io::Result<()>;
    fn bind_recovered_leaf(
        &self,
        _scope_id: &[u8; 16],
        expected: CgroupLeafIdentity,
    ) -> io::Result<()> {
        self.reopen_leaf(expected)
    }
    fn create_unique_leaf(&self, scope_id: &[u8; 16]) -> io::Result<CgroupLeafIdentity>;
    fn recover_created_leaf(&self, scope_id: &[u8; 16]) -> io::Result<Option<CgroupLeafIdentity>>;
    fn place_guardian(&self, expected: CgroupLeafIdentity, guardian_pid: u32) -> io::Result<()>;
    fn reopen_leaf(&self, expected: CgroupLeafIdentity) -> io::Result<()>;
    fn recursive_kill(&self, expected: CgroupLeafIdentity) -> io::Result<()>;
    fn populated(&self, expected: CgroupLeafIdentity) -> io::Result<bool>;
    fn cleanup_leaf(&self, expected: CgroupLeafIdentity) -> io::Result<()>;
    fn monotonic_now(&self) -> Duration {
        #[cfg(target_os = "linux")]
        {
            let mut value = libc::timespec {
                tv_sec: 0,
                tv_nsec: 0,
            };
            if unsafe { libc::clock_gettime(libc::CLOCK_MONOTONIC, &mut value) } == 0 {
                return Duration::new(value.tv_sec.max(0) as u64, value.tv_nsec.max(0) as u32);
            }
        }
        // Production is Linux-only.  Host contract tests override this method;
        // returning zero here keeps non-Linux codec checks deterministic.
        Duration::ZERO
    }
    fn wait_for_populated_change(
        &self,
        _expected: CgroupLeafIdentity,
        maximum_wait: Duration,
    ) -> io::Result<()> {
        std::thread::sleep(maximum_wait.min(Duration::from_millis(10)));
        Ok(())
    }
}

pub struct BrokerCgroupAuthority<K> {
    kernel: K,
    requirements: CgroupRequirements,
    operation_locks: Mutex<BTreeMap<CgroupLeafIdentity, Arc<Mutex<()>>>>,
}

impl<K: CgroupKernel> BrokerCgroupAuthority<K> {
    pub fn new(kernel: K, requirements: CgroupRequirements) -> Self {
        Self {
            kernel,
            requirements,
            operation_locks: Mutex::new(BTreeMap::new()),
        }
    }

    pub fn kernel(&self) -> &K {
        &self.kernel
    }

    pub fn probe(&self) -> io::Result<()> {
        self.requirements.validate()?;
        self.kernel.probe(&self.requirements)
    }

    pub fn prepare_leaf(
        &self,
        scope_id: &[u8; 16],
        guardian_pid: u32,
    ) -> io::Result<CgroupLeafIdentity> {
        let leaf = self.create_leaf(scope_id)?;
        if let Err(error) = self.place_guardian_exact(leaf, guardian_pid) {
            let operation_lock = self.operation_lock(leaf);
            let _operation = operation_lock.lock().expect("cgroup operation lock");
            self.cleanup_partial_exact_leaf(leaf);
            return Err(error);
        }
        Ok(leaf)
    }

    pub fn create_leaf(&self, scope_id: &[u8; 16]) -> io::Result<CgroupLeafIdentity> {
        self.probe()?;
        if scope_id.iter().all(|byte| *byte == 0) {
            return Err(invalid_input("broker cgroup scope identity is zero"));
        }
        let leaf = self.kernel.create_unique_leaf(scope_id)?;
        leaf.validate()?;
        Ok(leaf)
    }

    pub fn recover_created_leaf(
        &self,
        scope_id: &[u8; 16],
    ) -> io::Result<Option<CgroupLeafIdentity>> {
        self.probe()?;
        if scope_id.iter().all(|byte| *byte == 0) {
            return Err(invalid_input(
                "broker recovered cgroup scope identity is zero",
            ));
        }
        self.kernel.recover_created_leaf(scope_id)
    }

    pub fn place_guardian_exact(
        &self,
        leaf: CgroupLeafIdentity,
        guardian_pid: u32,
    ) -> io::Result<()> {
        leaf.validate()?;
        if guardian_pid == 0 {
            return Err(invalid_input("broker guardian pid is zero"));
        }
        let operation_lock = self.operation_lock(leaf);
        let _operation = operation_lock.lock().expect("cgroup operation lock");
        self.kernel
            .reopen_leaf(leaf)
            .and_then(|_| self.kernel.place_guardian(leaf, guardian_pid))
            .and_then(|_| self.kernel.reopen_leaf(leaf))
            .and_then(|_| {
                self.kernel.populated(leaf)?.then_some(()).ok_or_else(|| {
                    io::Error::new(
                        io::ErrorKind::NotFound,
                        "prepared guardian is absent from its cgroup leaf",
                    )
                })
            })
    }

    pub fn reopen(&self, expected: CgroupLeafIdentity) -> io::Result<()> {
        expected.validate()?;
        let operation_lock = self.operation_lock(expected);
        let _operation = operation_lock.lock().expect("cgroup operation lock");
        self.kernel.reopen_leaf(expected)
    }

    pub fn deadline_after_ms(&self, timeout_ms: u32) -> io::Result<MonotonicDeadline> {
        if timeout_ms == 0 {
            return Err(invalid_input("cgroup empty wait timeout is zero"));
        }
        let expires_at = self
            .kernel
            .monotonic_now()
            .checked_add(Duration::from_millis(u64::from(timeout_ms)))
            .ok_or_else(|| invalid_input("cgroup empty wait deadline overflowed"))?;
        MonotonicDeadline::from_duration(expires_at)
    }

    pub fn deadline_from_absolute_ns(&self, value: u64) -> io::Result<MonotonicDeadline> {
        let deadline = MonotonicDeadline::from_absolute_ns(value)?;
        if deadline.is_expired_at(self.kernel.monotonic_now()) {
            return Err(io::Error::new(
                io::ErrorKind::TimedOut,
                "broker request deadline already expired",
            ));
        }
        Ok(deadline)
    }

    pub fn force_empty_and_cleanup(
        &self,
        expected: CgroupLeafIdentity,
        timeout_ms: u32,
    ) -> io::Result<()> {
        let deadline = self.deadline_after_ms(timeout_ms)?;
        let operation_lock = self.operation_lock(expected);
        let _operation = operation_lock.lock().expect("cgroup operation lock");
        self.force_empty_locked(expected, deadline)?;
        self.cleanup_already_empty_locked(expected)
    }

    pub fn bind_recovered(
        &self,
        scope_id: &[u8; 16],
        expected: CgroupLeafIdentity,
    ) -> io::Result<()> {
        if scope_id.iter().all(|byte| *byte == 0) {
            return Err(invalid_input("recovered cgroup scope id is zero"));
        }
        let operation_lock = self.operation_lock(expected);
        let _operation = operation_lock.lock().expect("cgroup operation lock");
        self.kernel.bind_recovered_leaf(scope_id, expected)?;
        self.kernel.reopen_leaf(expected)
    }

    pub fn cleanup_recovered_or_absent(
        &self,
        scope_id: &[u8; 16],
        expected: CgroupLeafIdentity,
        timeout_ms: u32,
    ) -> io::Result<()> {
        match self.bind_recovered(scope_id, expected) {
            Ok(()) => self.force_empty_and_cleanup(expected, timeout_ms),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error),
        }
    }

    pub fn cleanup_empty_recovered_or_absent(
        &self,
        scope_id: &[u8; 16],
        expected: CgroupLeafIdentity,
    ) -> io::Result<()> {
        match self.bind_recovered(scope_id, expected) {
            Ok(()) => self.cleanup_already_empty(expected),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error),
        }
    }

    pub fn force_empty(&self, expected: CgroupLeafIdentity, timeout_ms: u32) -> io::Result<()> {
        let deadline = self.deadline_after_ms(timeout_ms)?;
        self.force_empty_until(expected, deadline)
    }

    pub fn force_empty_until(
        &self,
        expected: CgroupLeafIdentity,
        deadline: MonotonicDeadline,
    ) -> io::Result<()> {
        let operation_lock = self.operation_lock(expected);
        let _operation = operation_lock.lock().expect("cgroup operation lock");
        self.force_empty_locked(expected, deadline)
    }

    fn force_empty_locked(
        &self,
        expected: CgroupLeafIdentity,
        deadline: MonotonicDeadline,
    ) -> io::Result<()> {
        if deadline.is_expired_at(self.kernel.monotonic_now()) {
            return Err(io::Error::new(
                io::ErrorKind::TimedOut,
                "cgroup control deadline expired before recursive kill",
            ));
        }
        self.kernel.reopen_leaf(expected)?;
        self.kernel.recursive_kill(expected)?;
        loop {
            self.kernel.reopen_leaf(expected)?;
            if !self.kernel.populated(expected)? {
                self.kernel.reopen_leaf(expected)?;
                return Ok(());
            }
            if deadline.is_expired_at(self.kernel.monotonic_now()) {
                return Err(io::Error::new(
                    io::ErrorKind::TimedOut,
                    "cgroup leaf did not report populated=0 before the deadline",
                ));
            }
            self.kernel.wait_for_populated_change(
                expected,
                deadline.remaining_at(self.kernel.monotonic_now()),
            )?;
        }
    }

    pub fn cleanup_already_empty(&self, expected: CgroupLeafIdentity) -> io::Result<()> {
        let operation_lock = self.operation_lock(expected);
        let _operation = operation_lock.lock().expect("cgroup operation lock");
        self.cleanup_already_empty_locked(expected)
    }

    fn cleanup_already_empty_locked(&self, expected: CgroupLeafIdentity) -> io::Result<()> {
        self.kernel.reopen_leaf(expected)?;
        if self.kernel.populated(expected)? {
            return Err(io::Error::new(
                io::ErrorKind::WouldBlock,
                "populated cgroup leaf cannot be cleaned",
            ));
        }
        self.kernel.reopen_leaf(expected)?;
        self.kernel.cleanup_leaf(expected)
    }

    fn cleanup_partial_exact_leaf(&self, leaf: CgroupLeafIdentity) {
        if self.kernel.reopen_leaf(leaf).is_err() {
            return;
        }
        if self.kernel.populated(leaf).ok() == Some(true) {
            if self.kernel.recursive_kill(leaf).is_err() {
                return;
            }
            for _ in 0..8 {
                match self.kernel.populated(leaf) {
                    Ok(false) => break,
                    Ok(true) => continue,
                    Err(_) => return,
                }
            }
        }
        if self.kernel.reopen_leaf(leaf).is_ok() && self.kernel.populated(leaf).ok() == Some(false)
        {
            let _ = self.kernel.cleanup_leaf(leaf);
        }
    }

    fn operation_lock(&self, expected: CgroupLeafIdentity) -> Arc<Mutex<()>> {
        self.operation_locks
            .lock()
            .expect("cgroup operation lock registry")
            .entry(expected)
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone()
    }
}

pub fn parse_cgroup_events(value: &str) -> io::Result<bool> {
    if value.is_empty() || value.len() > 4096 || value.contains('\0') {
        return Err(invalid_data("cgroup.events is empty or exceeds its bound"));
    }
    let mut populated = None;
    for line in value.lines() {
        let mut fields = line.split_ascii_whitespace();
        let Some(name) = fields.next() else {
            return Err(invalid_data("cgroup.events contains an empty line"));
        };
        let Some(raw) = fields.next() else {
            return Err(invalid_data("cgroup.events field lacks a value"));
        };
        if fields.next().is_some()
            || !name
                .bytes()
                .all(|byte| byte.is_ascii_lowercase() || byte == b'_')
        {
            return Err(invalid_data("cgroup.events field is malformed"));
        }
        if name == "populated" {
            if populated.is_some() {
                return Err(invalid_data("cgroup.events repeats populated"));
            }
            populated = match raw {
                "0" => Some(false),
                "1" => Some(true),
                _ => return Err(invalid_data("cgroup.events populated value is invalid")),
            };
        } else if !raw.bytes().all(|byte| byte.is_ascii_digit()) {
            return Err(invalid_data("cgroup.events value is malformed"));
        }
    }
    populated.ok_or_else(|| invalid_data("cgroup.events lacks populated"))
}

#[cfg(target_os = "linux")]
pub mod linux {
    use std::collections::BTreeMap;
    use std::ffi::CString;
    use std::fs::{self, File, OpenOptions};
    use std::io::{self, Read, Write};
    use std::os::fd::{AsRawFd, FromRawFd};
    use std::os::unix::ffi::OsStrExt;
    use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
    use std::path::{Path, PathBuf};
    use std::sync::{Arc, Mutex};
    use std::time::Duration;

    use super::{parse_cgroup_events, validate_cgroup_paths, CgroupKernel, CgroupRequirements};
    use crate::broker_install::hex;
    use crate::broker_lease::CgroupLeafIdentity;
    use crate::broker_protocol::fresh_challenge_nonce;

    const CGROUP2_SUPER_MAGIC: u64 = 0x6367_7270;
    const MAX_CONTROLLER_BYTES: u64 = 4096;

    #[derive(Clone)]
    struct LeafBinding {
        name: CString,
        parent: Arc<File>,
        leaf: Arc<File>,
    }

    pub struct FsCgroupKernel {
        mount_root: PathBuf,
        service_subtree: PathBuf,
        bindings: Mutex<BTreeMap<CgroupLeafIdentity, LeafBinding>>,
        administrative_lock: Mutex<()>,
    }

    impl FsCgroupKernel {
        pub fn new(mount_root: PathBuf, service_subtree: PathBuf) -> io::Result<Self> {
            validate_cgroup_paths(&mount_root, &service_subtree)?;
            Ok(Self {
                mount_root,
                service_subtree,
                bindings: Mutex::new(BTreeMap::new()),
                administrative_lock: Mutex::new(()),
            })
        }

        pub fn bind_recovered_leaf(
            &self,
            scope_id: &[u8; 16],
            expected: CgroupLeafIdentity,
        ) -> io::Result<()> {
            let _administrative = self
                .administrative_lock
                .lock()
                .expect("cgroup administrative lock");
            let path = self.leaf_path(scope_id)?;
            let binding = open_leaf_binding(&self.service_subtree, &path, expected)?;
            validate_pinned_binding(&binding, expected)?;
            self.bindings
                .lock()
                .expect("cgroup binding lock")
                .insert(expected, binding);
            Ok(())
        }

        pub fn ensure_service_subtree(&self) -> io::Result<()> {
            validate_cgroup2(&self.mount_root)?;
            validate_root_directory(&self.mount_root)?;
            match fs::create_dir(&self.service_subtree) {
                Ok(()) => {}
                Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
                Err(error) => return Err(error),
            }
            validate_root_directory(&self.service_subtree)
        }

        fn leaf_path(&self, scope_id: &[u8; 16]) -> io::Result<PathBuf> {
            if scope_id.iter().all(|byte| *byte == 0) {
                return Err(invalid_input("cgroup scope id is zero"));
            }
            Ok(self
                .service_subtree
                .join(format!("lease-{}", hex(scope_id))))
        }

        fn bound_binding(&self, expected: CgroupLeafIdentity) -> io::Result<LeafBinding> {
            self.bindings
                .lock()
                .expect("cgroup binding lock")
                .get(&expected)
                .cloned()
                .ok_or_else(identity_drift)
        }
    }

    impl CgroupKernel for FsCgroupKernel {
        fn probe(&self, requirements: &CgroupRequirements) -> io::Result<()> {
            requirements.validate()?;
            validate_cgroup2(&self.mount_root)?;
            validate_root_directory(&self.service_subtree)?;
            for name in [
                "cgroup.controllers",
                "cgroup.subtree_control",
                "cgroup.procs",
                "cgroup.events",
                "cgroup.kill",
            ] {
                validate_control_file(&self.service_subtree.join(name))?;
            }
            let controllers_path = self.service_subtree.join("cgroup.controllers");
            let controllers = bounded_read(&controllers_path)?;
            let available: Vec<&str> = controllers.split_ascii_whitespace().collect();
            if requirements
                .required_controllers
                .iter()
                .any(|required| !available.contains(&required.as_str()))
            {
                return Err(unavailable("required cgroup v2 controller is unavailable"));
            }
            let subtree_control_path = self.service_subtree.join("cgroup.subtree_control");
            let mut enabled = bounded_read(&subtree_control_path)?;
            for required in &requirements.required_controllers {
                if !enabled
                    .split_ascii_whitespace()
                    .any(|value| value == required)
                {
                    let mut control = OpenOptions::new().write(true).open(&subtree_control_path)?;
                    write_control_command(&mut control, &format!("+{required}"))?;
                    drop(control);
                    enabled = bounded_read(&subtree_control_path)?;
                    if !enabled
                        .split_ascii_whitespace()
                        .any(|value| value == required)
                    {
                        return Err(unavailable("required cgroup v2 controller did not enable"));
                    }
                }
            }
            for writable in ["cgroup.procs", "cgroup.kill", "cgroup.subtree_control"] {
                require_writable(&self.service_subtree.join(writable))?;
            }
            parse_cgroup_events(&bounded_read(&self.service_subtree.join("cgroup.events"))?)?;
            let random = fresh_challenge_nonce()?;
            let scope_id: [u8; 16] = random[..16].try_into().expect("fixed random prefix");
            let probe_leaf = self.create_unique_leaf(&scope_id)?;
            let result = (|| {
                self.recursive_kill(probe_leaf)?;
                if self.populated(probe_leaf)? {
                    return Err(unavailable("new cgroup probe leaf remains populated"));
                }
                self.cleanup_leaf(probe_leaf)
            })();
            if result.is_err()
                && self.reopen_leaf(probe_leaf).is_ok()
                && self.populated(probe_leaf).ok() == Some(false)
            {
                let _ = self.cleanup_leaf(probe_leaf);
            }
            result?;
            Ok(())
        }

        fn bind_recovered_leaf(
            &self,
            scope_id: &[u8; 16],
            expected: CgroupLeafIdentity,
        ) -> io::Result<()> {
            FsCgroupKernel::bind_recovered_leaf(self, scope_id, expected)
        }

        fn create_unique_leaf(&self, scope_id: &[u8; 16]) -> io::Result<CgroupLeafIdentity> {
            let _administrative = self
                .administrative_lock
                .lock()
                .expect("cgroup administrative lock");
            let path = self.leaf_path(scope_id)?;
            let parent = Arc::new(open_pinned_directory(&self.service_subtree)?);
            validate_root_directory_file(&parent)?;
            let name = leaf_name(&path)?;
            if unsafe { libc::mkdirat(parent.as_raw_fd(), name.as_ptr(), 0o755) } != 0 {
                return Err(io::Error::last_os_error());
            }
            let result = (|| {
                let leaf = Arc::new(openat_directory(&parent, &name)?);
                let value = file_identity(&leaf)?;
                let binding = LeafBinding {
                    name: name.clone(),
                    parent: Arc::clone(&parent),
                    leaf,
                };
                validate_pinned_binding(&binding, value)?;
                if populated_from_binding(&binding, value)? {
                    return Err(io::Error::new(
                        io::ErrorKind::WouldBlock,
                        "new cgroup leaf is unexpectedly populated",
                    ));
                }
                self.bindings
                    .lock()
                    .expect("cgroup binding lock")
                    .insert(value, binding);
                Ok(value)
            })();
            if result.is_err() {
                let _ = unlinkat_directory(&parent, &name);
            }
            result
        }

        fn recover_created_leaf(
            &self,
            scope_id: &[u8; 16],
        ) -> io::Result<Option<CgroupLeafIdentity>> {
            let _administrative = self
                .administrative_lock
                .lock()
                .expect("cgroup administrative lock");
            let path = self.leaf_path(scope_id)?;
            let parent = Arc::new(open_pinned_directory(&self.service_subtree)?);
            validate_root_directory_file(&parent)?;
            let name = leaf_name(&path)?;
            let leaf = match openat_directory(&parent, &name) {
                Ok(value) => Arc::new(value),
                Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
                Err(error) => return Err(error),
            };
            let value = file_identity(&leaf)?;
            let binding = LeafBinding { name, parent, leaf };
            validate_pinned_binding(&binding, value)?;
            self.bindings
                .lock()
                .expect("cgroup binding lock")
                .insert(value, binding);
            Ok(Some(value))
        }

        fn place_guardian(
            &self,
            expected: CgroupLeafIdentity,
            guardian_pid: u32,
        ) -> io::Result<()> {
            if guardian_pid == 0 {
                return Err(invalid_input("guardian pid is zero"));
            }
            let binding = self.bound_binding(expected)?;
            validate_pinned_binding(&binding, expected)?;
            let mut procs = open_control_file(&binding, "cgroup.procs", true)?;
            validate_pinned_binding(&binding, expected)?;
            write_control_command(&mut procs, &guardian_pid.to_string())?;
            drop(procs);
            validate_pinned_binding(&binding, expected)?;
            if !populated_from_binding(&binding, expected)? {
                return Err(io::Error::new(
                    io::ErrorKind::NotFound,
                    "guardian did not enter the exact cgroup leaf",
                ));
            }
            Ok(())
        }

        fn reopen_leaf(&self, expected: CgroupLeafIdentity) -> io::Result<()> {
            expected.validate()?;
            validate_pinned_binding(&self.bound_binding(expected)?, expected)
        }

        fn recursive_kill(&self, expected: CgroupLeafIdentity) -> io::Result<()> {
            let binding = self.bound_binding(expected)?;
            validate_pinned_binding(&binding, expected)?;
            let mut kill = open_control_file(&binding, "cgroup.kill", true)?;
            validate_pinned_binding(&binding, expected)?;
            kill.write_all(b"1\n")?;
            drop(kill);
            validate_pinned_binding(&binding, expected)
        }

        fn populated(&self, expected: CgroupLeafIdentity) -> io::Result<bool> {
            let binding = self.bound_binding(expected)?;
            validate_pinned_binding(&binding, expected)?;
            let populated = populated_from_binding(&binding, expected)?;
            validate_pinned_binding(&binding, expected)?;
            Ok(populated)
        }

        fn cleanup_leaf(&self, expected: CgroupLeafIdentity) -> io::Result<()> {
            // The installed daemon holds the service-wide broker singleton for its whole
            // lifetime, and the uninstaller acquires that same singleton while stopped.
            // This in-process administrative lock closes name replacement by every path
            // mutator inside that trusted domain from the final identity check through unlink.
            let _administrative = self
                .administrative_lock
                .lock()
                .expect("cgroup administrative lock");
            let binding = self.bound_binding(expected)?;
            validate_pinned_binding(&binding, expected)?;
            if populated_from_binding(&binding, expected)? {
                return Err(io::Error::new(
                    io::ErrorKind::WouldBlock,
                    "populated cgroup leaf cannot be removed",
                ));
            }
            validate_pinned_binding(&binding, expected)?;
            unlinkat_directory(&binding.parent, &binding.name)?;
            validate_pinned_handle(&binding, expected)?;
            self.bindings
                .lock()
                .expect("cgroup binding lock")
                .remove(&expected);
            Ok(())
        }

        fn wait_for_populated_change(
            &self,
            expected: CgroupLeafIdentity,
            maximum_wait: Duration,
        ) -> io::Result<()> {
            let binding = self.bound_binding(expected)?;
            validate_pinned_binding(&binding, expected)?;
            let events = open_control_file(&binding, "cgroup.events", false)?;
            let milliseconds = maximum_wait.as_millis().max(1).min(i32::MAX as u128) as i32;
            let mut descriptor = libc::pollfd {
                fd: events.as_raw_fd(),
                events: libc::POLLPRI | libc::POLLERR,
                revents: 0,
            };
            let result = unsafe { libc::poll(&mut descriptor, 1, milliseconds) };
            if result < 0 {
                return Err(io::Error::last_os_error());
            }
            drop(events);
            validate_pinned_binding(&binding, expected)
        }
    }

    fn open_leaf_binding(
        service_subtree: &Path,
        path: &Path,
        expected: CgroupLeafIdentity,
    ) -> io::Result<LeafBinding> {
        expected.validate()?;
        let parent = Arc::new(open_pinned_directory(service_subtree)?);
        validate_root_directory_file(&parent)?;
        let name = leaf_name(path)?;
        let leaf = Arc::new(openat_directory(&parent, &name)?);
        let binding = LeafBinding { name, parent, leaf };
        validate_pinned_binding(&binding, expected)?;
        Ok(binding)
    }

    fn leaf_name(path: &Path) -> io::Result<CString> {
        let name = path
            .file_name()
            .ok_or_else(|| invalid_input("cgroup leaf path has no name"))?;
        if name.as_bytes().contains(&b'/') {
            return Err(invalid_input("cgroup leaf name contains a separator"));
        }
        CString::new(name.as_bytes()).map_err(|_| invalid_input("cgroup leaf name contains nul"))
    }

    fn open_pinned_directory(path: &Path) -> io::Result<File> {
        OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_PATH | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC)
            .open(path)
    }

    fn openat_directory(parent: &File, name: &CString) -> io::Result<File> {
        let descriptor = unsafe {
            libc::openat(
                parent.as_raw_fd(),
                name.as_ptr(),
                libc::O_PATH | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            )
        };
        if descriptor < 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(unsafe { File::from_raw_fd(descriptor) })
    }

    fn open_control_file(
        binding: &LeafBinding,
        name: &'static str,
        write: bool,
    ) -> io::Result<File> {
        let access = if write {
            libc::O_WRONLY
        } else {
            libc::O_RDONLY
        };
        let file = openat_file(binding, name, access)?;
        validate_control_file_metadata(&file.metadata()?)?;
        Ok(file)
    }

    /// Writes one cgroup control command as exactly one `write(2)`.
    ///
    /// Kernel cgroup control files parse every write independently, so a command
    /// must never be split across writes.  `writeln!` splits it: `File` is
    /// unbuffered and `Write::write_fmt` emits one write per format fragment, so
    /// the trailing newline arrives as a second, empty command and is rejected --
    /// after the first fragment has already taken effect.
    fn write_control_command(file: &mut File, command: &str) -> io::Result<()> {
        file.write_all(format!("{command}\n").as_bytes())
    }

    fn openat_file(binding: &LeafBinding, name: &'static str, access: i32) -> io::Result<File> {
        let name = CString::new(name).expect("fixed cgroup control name");
        let descriptor = unsafe {
            libc::openat(
                binding.leaf.as_raw_fd(),
                name.as_ptr(),
                access | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            )
        };
        if descriptor < 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(unsafe { File::from_raw_fd(descriptor) })
    }

    fn validate_control_at(binding: &LeafBinding, name: &'static str) -> io::Result<()> {
        let name = CString::new(name).expect("fixed cgroup control name");
        let descriptor = unsafe {
            libc::openat(
                binding.leaf.as_raw_fd(),
                name.as_ptr(),
                libc::O_PATH | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            )
        };
        if descriptor < 0 {
            return Err(io::Error::last_os_error());
        }
        let file = unsafe { File::from_raw_fd(descriptor) };
        validate_control_file_metadata(&file.metadata()?)
    }

    fn validate_pinned_binding(
        binding: &LeafBinding,
        expected: CgroupLeafIdentity,
    ) -> io::Result<()> {
        validate_pinned_handle(binding, expected)?;
        if current_name_identity(binding)? != expected {
            return Err(identity_drift());
        }
        for name in ["cgroup.procs", "cgroup.events", "cgroup.kill"] {
            validate_control_at(binding, name)?;
        }
        Ok(())
    }

    fn current_name_identity(binding: &LeafBinding) -> io::Result<CgroupLeafIdentity> {
        file_identity(&openat_directory(&binding.parent, &binding.name)?)
    }

    fn validate_pinned_handle(
        binding: &LeafBinding,
        expected: CgroupLeafIdentity,
    ) -> io::Result<()> {
        validate_root_directory_file(&binding.leaf)?;
        if file_identity(&binding.leaf)? != expected {
            return Err(identity_drift());
        }
        Ok(())
    }

    fn validate_root_directory_file(file: &File) -> io::Result<()> {
        let metadata = file.metadata()?;
        if !metadata.is_dir() || metadata.uid() != 0 || metadata.mode() & 0o022 != 0 {
            return Err(unavailable(
                "cgroup directory descriptor is not root-owned and protected",
            ));
        }
        Ok(())
    }

    fn validate_control_file_metadata(metadata: &fs::Metadata) -> io::Result<()> {
        if !metadata.is_file() || metadata.uid() != 0 || metadata.mode() & 0o022 != 0 {
            return Err(unavailable(
                "cgroup control descriptor ownership or mode is insecure",
            ));
        }
        Ok(())
    }

    fn file_identity(file: &File) -> io::Result<CgroupLeafIdentity> {
        let metadata = file.metadata()?;
        let value = CgroupLeafIdentity {
            device: metadata.dev(),
            inode: metadata.ino(),
        };
        value.validate()?;
        Ok(value)
    }

    fn populated_from_binding(
        binding: &LeafBinding,
        expected: CgroupLeafIdentity,
    ) -> io::Result<bool> {
        validate_pinned_handle(binding, expected)?;
        parse_cgroup_events(&bounded_read_file(open_control_file(
            binding,
            "cgroup.events",
            false,
        )?)?)
    }

    fn unlinkat_directory(parent: &File, name: &CString) -> io::Result<()> {
        if unsafe { libc::unlinkat(parent.as_raw_fd(), name.as_ptr(), libc::AT_REMOVEDIR) } != 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(())
    }

    pub fn probe_namespace_operations() -> io::Result<()> {
        for path in [
            "/proc/self/ns/user",
            "/proc/self/ns/pid",
            "/proc/self/ns/mnt",
        ] {
            let metadata = fs::symlink_metadata(path)?;
            if !metadata.file_type().is_symlink() {
                return Err(unavailable("required namespace handle is unavailable"));
            }
        }
        let result = unsafe { libc::syscall(libc::SYS_pidfd_open, libc::getpid(), 0_u32) };
        if result < 0 {
            return Err(unavailable("pidfd_open is unavailable"));
        }
        unsafe { libc::close(result as libc::c_int) };
        let child = unsafe { libc::fork() };
        if child < 0 {
            return Err(io::Error::last_os_error());
        }
        if child == 0 {
            let result = unsafe {
                libc::unshare(libc::CLONE_NEWUSER | libc::CLONE_NEWPID | libc::CLONE_NEWNS)
            };
            unsafe { libc::_exit(if result == 0 { 0 } else { 111 }) };
        }
        let mut status = 0;
        if unsafe { libc::waitpid(child, &mut status, 0) } != child {
            return Err(io::Error::last_os_error());
        }
        if !libc::WIFEXITED(status) || libc::WEXITSTATUS(status) != 0 {
            return Err(unavailable(
                "user/PID/mount namespace construction is unavailable",
            ));
        }
        Ok(())
    }

    fn validate_cgroup2(path: &Path) -> io::Result<()> {
        let c_path = CString::new(path.as_os_str().as_bytes())
            .map_err(|_| invalid_input("cgroup path contains nul"))?;
        let mut information = std::mem::MaybeUninit::<libc::statfs>::zeroed();
        if unsafe { libc::statfs(c_path.as_ptr(), information.as_mut_ptr()) } != 0 {
            return Err(io::Error::last_os_error());
        }
        let information = unsafe { information.assume_init() };
        if information.f_type as u64 != CGROUP2_SUPER_MAGIC {
            return Err(unavailable("cgroup mount is not unified cgroup v2"));
        }
        Ok(())
    }

    fn validate_root_directory(path: &Path) -> io::Result<()> {
        let metadata = fs::symlink_metadata(path)?;
        if metadata.file_type().is_symlink()
            || !metadata.is_dir()
            || metadata.uid() != 0
            || metadata.mode() & 0o022 != 0
        {
            return Err(unavailable(
                "cgroup service subtree is not root-owned and protected",
            ));
        }
        Ok(())
    }

    fn validate_control_file(path: &Path) -> io::Result<()> {
        let metadata = fs::symlink_metadata(path)?;
        if metadata.file_type().is_symlink()
            || !metadata.is_file()
            || metadata.uid() != 0
            || metadata.mode() & 0o022 != 0
        {
            return Err(unavailable(
                "cgroup control file ownership or mode is insecure",
            ));
        }
        Ok(())
    }

    fn bounded_read(path: &Path) -> io::Result<String> {
        bounded_read_file(File::open(path)?)
    }

    fn bounded_read_file(file: File) -> io::Result<String> {
        let mut bytes = Vec::with_capacity(MAX_CONTROLLER_BYTES as usize + 1);
        file.take(MAX_CONTROLLER_BYTES + 1)
            .read_to_end(&mut bytes)?;
        if bytes.len() as u64 > MAX_CONTROLLER_BYTES {
            return Err(invalid_data("cgroup control value exceeds its bound"));
        }
        String::from_utf8(bytes).map_err(|_| invalid_data("cgroup control value is not valid utf8"))
    }

    fn require_writable(path: &Path) -> io::Result<()> {
        let c_path = CString::new(path.as_os_str().as_bytes())
            .map_err(|_| invalid_input("cgroup path contains nul"))?;
        if unsafe { libc::access(c_path.as_ptr(), libc::W_OK) } != 0 {
            return Err(unavailable("required cgroup control file is not writable"));
        }
        Ok(())
    }

    fn identity_drift() -> io::Error {
        io::Error::new(io::ErrorKind::PermissionDenied, "identity-drift")
    }

    fn unavailable(message: &str) -> io::Error {
        io::Error::new(io::ErrorKind::Unsupported, message)
    }

    fn invalid_input(message: &str) -> io::Error {
        io::Error::new(io::ErrorKind::InvalidInput, message)
    }

    fn invalid_data(message: &str) -> io::Error {
        io::Error::new(io::ErrorKind::InvalidData, message)
    }

    #[cfg(test)]
    mod tests {
        use std::fs;
        use std::io::Write;
        use std::sync::Arc;

        use super::{
            current_name_identity, file_identity, leaf_name, open_pinned_directory,
            openat_directory, openat_file, write_control_command, LeafBinding,
        };
        use crate::broker_install::hex;
        use crate::broker_protocol::fresh_challenge_nonce;

        #[test]
        fn pinned_leaf_descriptor_never_writes_to_a_path_replacement() {
            let root = std::env::temp_dir().join(format!(
                "rasen-cgroup-fd-race-{}",
                hex(&fresh_challenge_nonce().unwrap())
            ));
            let service = root.join("service");
            let leaf = service.join("lease-test");
            fs::create_dir_all(&leaf).unwrap();
            fs::write(leaf.join("cgroup.kill"), b"original").unwrap();

            let parent = Arc::new(open_pinned_directory(&service).unwrap());
            let name = leaf_name(&leaf).unwrap();
            let pinned_leaf = Arc::new(openat_directory(&parent, &name).unwrap());
            let expected = file_identity(&pinned_leaf).unwrap();
            let binding = LeafBinding {
                name,
                parent,
                leaf: pinned_leaf,
            };

            let held = service.join("held-original");
            fs::rename(&leaf, &held).unwrap();
            fs::create_dir(&leaf).unwrap();
            fs::write(leaf.join("cgroup.kill"), b"replacement").unwrap();
            assert_ne!(current_name_identity(&binding).unwrap(), expected);

            let mut kill = openat_file(&binding, "cgroup.kill", libc::O_WRONLY).unwrap();
            kill.write_all(b"pinned").unwrap();
            drop(kill);
            assert_eq!(fs::read(held.join("cgroup.kill")).unwrap(), b"pinnedal");
            assert_eq!(fs::read(leaf.join("cgroup.kill")).unwrap(), b"replacement");

            drop(binding);
            fs::remove_dir_all(&root).unwrap();
        }

        /// A cgroup control command must reach the kernel as one `write(2)`, because
        /// cgroup files parse each write on its own.  A regular file cannot witness
        /// that -- one write and two writes leave identical bytes behind -- so this
        /// uses an `O_DIRECT` packet-mode pipe, where every `write(2)` becomes one
        /// packet and every `read(2)` returns exactly one packet.
        ///
        /// Regression guard: `place_guardian` and the controller-enable path used
        /// `writeln!`, which emits the value and the newline as two writes.  Against
        /// a real `cgroup.procs` that migrated the process and *then* failed EINVAL
        /// on the empty second command.
        #[test]
        fn a_control_command_reaches_the_kernel_as_exactly_one_write() {
            let guardian_pid = 4242_u32;
            let required = "pids";
            assert_eq!(
                packets_written(|file| write_control_command(file, &guardian_pid.to_string())),
                vec![b"4242\n".to_vec()]
            );
            assert_eq!(
                packets_written(|file| write_control_command(file, &format!("+{required}"))),
                vec![b"+pids\n".to_vec()]
            );

            // The oracle is only meaningful if it can see the defect, so prove it
            // distinguishes the exact forms that shipped.  Both carry a format
            // argument, and that is what makes `write_fmt` emit a separate write for
            // the trailing newline.  `writeln!(file, "4242")` -- a bare literal with
            // no argument -- is a single write and does NOT reproduce the defect.
            assert_eq!(
                packets_written(|file| writeln!(file, "{guardian_pid}")),
                vec![b"4242".to_vec(), b"\n".to_vec()]
            );
            assert_eq!(
                packets_written(|file| writeln!(file, "+{required}")),
                vec![b"+".to_vec(), b"pids".to_vec(), b"\n".to_vec()]
            );
        }

        /// Runs `write` against a packet-mode pipe and returns one entry per
        /// `write(2)` the closure performed.
        fn packets_written(
            write: impl FnOnce(&mut fs::File) -> std::io::Result<()>,
        ) -> Vec<Vec<u8>> {
            use std::io::Read;
            use std::os::fd::FromRawFd;

            let mut ends = [0; 2];
            assert_eq!(
                unsafe { libc::pipe2(ends.as_mut_ptr(), libc::O_DIRECT) },
                0,
                "packet-mode pipe is required to observe write boundaries"
            );
            let mut reader = unsafe { fs::File::from_raw_fd(ends[0]) };
            let mut writer = unsafe { fs::File::from_raw_fd(ends[1]) };
            write(&mut writer).unwrap();
            drop(writer);

            let mut packets = Vec::new();
            loop {
                let mut buffer = [0_u8; 256];
                match reader.read(&mut buffer).unwrap() {
                    0 => break,
                    read => packets.push(buffer[..read].to_vec()),
                }
            }
            packets
        }
    }
}

fn invalid_input(message: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidInput, message)
}

fn invalid_data(message: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message)
}
