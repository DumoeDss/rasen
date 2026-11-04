use std::collections::VecDeque;
use std::io;
use std::path::Path;
use std::sync::{Arc, Barrier, Mutex};
use std::thread;
use std::time::Duration;

use rasen_linux_process_authority::broker_cgroup::{
    validate_cgroup_paths, BrokerCgroupAuthority, CgroupKernel, CgroupRequirements,
};
use rasen_linux_process_authority::broker_lease::CgroupLeafIdentity;

#[derive(Debug)]
struct State {
    exists: bool,
    identity: CgroupLeafIdentity,
    placed_pid: Option<u32>,
    populated: VecDeque<io::Result<bool>>,
    killed: bool,
    cleaned: bool,
    drift_after_place: bool,
    drift_during_cleanup: bool,
    kill_delay: Duration,
    active_kills: usize,
    maximum_active_kills: usize,
    monotonic_now: Duration,
    waits: Vec<Duration>,
}

struct FixtureKernel {
    state: Mutex<State>,
}

impl FixtureKernel {
    fn new(populated: impl IntoIterator<Item = io::Result<bool>>) -> Self {
        Self {
            state: Mutex::new(State {
                exists: false,
                identity: CgroupLeafIdentity {
                    device: 8,
                    inode: 9001,
                },
                placed_pid: None,
                populated: populated.into_iter().collect(),
                killed: false,
                cleaned: false,
                drift_after_place: false,
                drift_during_cleanup: false,
                kill_delay: Duration::ZERO,
                active_kills: 0,
                maximum_active_kills: 0,
                monotonic_now: Duration::ZERO,
                waits: Vec::new(),
            }),
        }
    }
}

impl CgroupKernel for FixtureKernel {
    fn probe(&self, requirements: &CgroupRequirements) -> io::Result<()> {
        if requirements.required_controllers != ["pids"] {
            return Err(io::Error::other("wrong requirements"));
        }
        Ok(())
    }

    fn create_unique_leaf(&self, _scope_id: &[u8; 16]) -> io::Result<CgroupLeafIdentity> {
        let mut state = self.state.lock().unwrap();
        if state.exists {
            return Err(io::ErrorKind::AlreadyExists.into());
        }
        state.exists = true;
        Ok(state.identity)
    }

    fn recover_created_leaf(&self, _scope_id: &[u8; 16]) -> io::Result<Option<CgroupLeafIdentity>> {
        let state = self.state.lock().unwrap();
        Ok(state.exists.then_some(state.identity))
    }

    fn place_guardian(&self, expected: CgroupLeafIdentity, guardian_pid: u32) -> io::Result<()> {
        let mut state = self.state.lock().unwrap();
        if state.identity != expected {
            return Err(io::ErrorKind::PermissionDenied.into());
        }
        state.placed_pid = Some(guardian_pid);
        if state.drift_after_place {
            state.identity.inode += 1;
        }
        Ok(())
    }

    fn reopen_leaf(&self, expected: CgroupLeafIdentity) -> io::Result<()> {
        let state = self.state.lock().unwrap();
        if !state.exists || state.identity != expected {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "identity-drift",
            ));
        }
        Ok(())
    }

    fn recursive_kill(&self, expected: CgroupLeafIdentity) -> io::Result<()> {
        self.reopen_leaf(expected)?;
        let delay = {
            let mut state = self.state.lock().unwrap();
            state.killed = true;
            state.active_kills += 1;
            state.maximum_active_kills = state.maximum_active_kills.max(state.active_kills);
            state.kill_delay
        };
        thread::sleep(delay);
        self.state.lock().unwrap().active_kills -= 1;
        Ok(())
    }

    fn populated(&self, expected: CgroupLeafIdentity) -> io::Result<bool> {
        self.reopen_leaf(expected)?;
        self.state
            .lock()
            .unwrap()
            .populated
            .pop_front()
            .unwrap_or(Ok(true))
    }

    fn cleanup_leaf(&self, expected: CgroupLeafIdentity) -> io::Result<()> {
        self.reopen_leaf(expected)?;
        let mut state = self.state.lock().unwrap();
        if state.drift_during_cleanup {
            state.identity.inode += 1;
        }
        if state.identity != expected {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "identity-drift",
            ));
        }
        state.exists = false;
        state.cleaned = true;
        Ok(())
    }

    fn monotonic_now(&self) -> Duration {
        self.state.lock().unwrap().monotonic_now
    }

    fn wait_for_populated_change(
        &self,
        _expected: CgroupLeafIdentity,
        maximum_wait: Duration,
    ) -> io::Result<()> {
        let mut state = self.state.lock().unwrap();
        let waited = maximum_wait.min(Duration::from_millis(5));
        state.monotonic_now += waited;
        state.waits.push(waited);
        Ok(())
    }
}

#[test]
fn cgroup_paths_are_closed_absolute_and_strictly_below_the_mount() {
    validate_cgroup_paths(
        Path::new("/sys/fs/cgroup"),
        Path::new("/sys/fs/cgroup/rasen-linux-process-authority"),
    )
    .unwrap();
    for invalid in [
        "/sys/fs/cgroup",
        "/sys/fs/cgroup/../replacement",
        "/sys/fs/cgroup-other/rasen",
        "relative/rasen",
        "/sys/fs/cgroup//rasen",
    ] {
        assert!(validate_cgroup_paths(Path::new("/sys/fs/cgroup"), Path::new(invalid)).is_err());
    }
}

#[test]
fn prepare_places_guardian_then_revalidates_the_unique_leaf() {
    let kernel = FixtureKernel::new([Ok(true)]);
    let authority = BrokerCgroupAuthority::new(kernel, CgroupRequirements::broker_default());
    let leaf = authority.prepare_leaf(&[3; 16], 4242).unwrap();
    assert_eq!(leaf.inode, 9001);
    assert_eq!(
        authority.kernel().state.lock().unwrap().placed_pid,
        Some(4242)
    );
}

#[test]
fn inode_drift_never_targets_or_cleans_a_replacement_leaf() {
    let kernel = FixtureKernel::new([Ok(false)]);
    {
        let mut state = kernel.state.lock().unwrap();
        state.exists = true;
        state.identity.inode = 9002;
    }
    let authority = BrokerCgroupAuthority::new(kernel, CgroupRequirements::broker_default());
    assert!(authority
        .force_empty_and_cleanup(
            CgroupLeafIdentity {
                device: 8,
                inode: 9001,
            },
            100,
        )
        .is_err());
    let state = authority.kernel().state.lock().unwrap();
    assert!(!state.killed);
    assert!(!state.cleaned);
    assert!(state.exists);
}

#[test]
fn recursive_kill_waits_for_populated_zero_before_cleanup() {
    let kernel = FixtureKernel::new([Ok(true), Ok(true), Ok(false), Ok(false)]);
    kernel.state.lock().unwrap().exists = true;
    let authority = BrokerCgroupAuthority::new(kernel, CgroupRequirements::broker_default());
    authority
        .force_empty_and_cleanup(
            CgroupLeafIdentity {
                device: 8,
                inode: 9001,
            },
            100,
        )
        .unwrap();
    let state = authority.kernel().state.lock().unwrap();
    assert!(state.killed);
    assert!(state.cleaned);
    assert!(!state.exists);
}

#[test]
fn event_error_or_bound_expiry_retains_leaf_after_kill() {
    for populated in [
        VecDeque::from([Err(io::Error::other("event read failed"))]),
        VecDeque::from([Ok(true), Ok(true), Ok(true)]),
    ] {
        let kernel = FixtureKernel::new(populated);
        kernel.state.lock().unwrap().exists = true;
        let authority = BrokerCgroupAuthority::new(kernel, CgroupRequirements::broker_default());
        assert!(authority
            .force_empty_and_cleanup(
                CgroupLeafIdentity {
                    device: 8,
                    inode: 9001,
                },
                2,
            )
            .is_err());
        let state = authority.kernel().state.lock().unwrap();
        assert!(state.killed);
        assert!(!state.cleaned);
        assert!(state.exists);
    }
}

#[test]
fn migration_during_prepare_is_identity_drift_and_not_optimistic_cleanup() {
    let kernel = FixtureKernel::new([Ok(true)]);
    kernel.state.lock().unwrap().drift_after_place = true;
    let authority = BrokerCgroupAuthority::new(kernel, CgroupRequirements::broker_default());
    assert!(authority.prepare_leaf(&[3; 16], 4242).is_err());
    let state = authority.kernel().state.lock().unwrap();
    assert!(!state.killed);
    assert!(!state.cleaned);
    assert!(state.exists);
}

#[test]
fn replacement_during_remove_is_rejected_before_destructive_cleanup() {
    let kernel = FixtureKernel::new([Ok(false)]);
    {
        let mut state = kernel.state.lock().unwrap();
        state.exists = true;
        state.drift_during_cleanup = true;
    }
    let authority = BrokerCgroupAuthority::new(kernel, CgroupRequirements::broker_default());
    assert!(authority
        .cleanup_already_empty(CgroupLeafIdentity {
            device: 8,
            inode: 9001,
        })
        .is_err());
    let state = authority.kernel().state.lock().unwrap();
    assert!(state.exists);
    assert!(!state.cleaned);
}

#[test]
fn destructive_operations_for_one_lease_are_serialized() {
    let kernel = FixtureKernel::new([Ok(false), Ok(false)]);
    {
        let mut state = kernel.state.lock().unwrap();
        state.exists = true;
        state.kill_delay = Duration::from_millis(40);
    }
    let authority = Arc::new(BrokerCgroupAuthority::new(
        kernel,
        CgroupRequirements::broker_default(),
    ));
    let start = Arc::new(Barrier::new(3));
    let mut workers = Vec::new();
    for _ in 0..2 {
        let authority = Arc::clone(&authority);
        let start = Arc::clone(&start);
        workers.push(thread::spawn(move || {
            start.wait();
            authority
                .force_empty(
                    CgroupLeafIdentity {
                        device: 8,
                        inode: 9001,
                    },
                    200,
                )
                .unwrap();
        }));
    }
    start.wait();
    for worker in workers {
        worker.join().unwrap();
    }
    assert_eq!(
        authority
            .kernel()
            .state
            .lock()
            .unwrap()
            .maximum_active_kills,
        1
    );
}

#[test]
fn timeout_ms_is_a_wall_clock_budget_not_a_population_read_count() {
    let kernel = FixtureKernel::new(std::iter::repeat_with(|| Ok(true)).take(256));
    kernel.state.lock().unwrap().exists = true;
    let authority = BrokerCgroupAuthority::new(kernel, CgroupRequirements::broker_default());
    let error = authority
        .force_empty(
            CgroupLeafIdentity {
                device: 8,
                inode: 9001,
            },
            25,
        )
        .unwrap_err();
    assert_eq!(error.kind(), io::ErrorKind::TimedOut);
    let state = authority.kernel().state.lock().unwrap();
    assert_eq!(state.monotonic_now, Duration::from_millis(25));
    assert_eq!(state.waits, vec![Duration::from_millis(5); 5]);
}
