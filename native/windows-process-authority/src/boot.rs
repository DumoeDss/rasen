//! Boot identity acquisition (task 4.4).
//!
//! A reference that cannot be disambiguated across a reboot must never be minted. So boot
//! identity is required, not optional: when no exact source is obtainable, prepare returns
//! typed `authority-unavailable` before anything is created.
//!
//! **All tick-arithmetic derivations are rejected.** `GetTickCount64`, unbiased interrupt
//! time and system-time subtraction all move under sleep, hibernate and clock adjustment, so
//! a value derived from them cannot disambiguate a boot. That rejection is structural rather
//! than a convention: none of those entry points is declared in [`crate::sys`], and
//! [`tick_sources_are_not_reachable`] asserts it against the declared-item list.
//!
//! The named-pipe namespace's non-persistence across a reboot is a **separate, independent**
//! proof (Decision 5) and lives in [`crate::endpoint`]. The two are deliberately not merged:
//! the boot-identity value can be unobtainable on an edition where the candidate source is
//! denied, while the endpoint proof can be defeated only by an attacker who already holds the
//! scope id. Collapsing them would leave one failure mode silently uncovered.

use std::io;
use std::mem::size_of;

use crate::sha256;
use crate::sys::*;
use crate::win;

/// The enumerated candidate sources, in probe order. Recorded in the prepare attestation so a
/// reviewer sees that the source was probed rather than assumed.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum BootIdentitySource {
    /// `NtQuerySystemInformation(SystemBootEnvironmentInformation)` -> `BootIdentifier` GUID.
    /// Exact and boot-unique by construction.
    BootEnvironmentIdentifier,
    /// `NtQuerySystemInformation(SystemTimeOfDayInformation)` -> `BootTime` + `BootTimeBias`.
    /// A stored absolute value, not a tick derivation. Second because it is not proven immune
    /// to a clock adjustment, only to sleep and hibernate.
    TimeOfDayBootTime,
}

pub const CANDIDATE_ORDER: [BootIdentitySource; 2] = [
    BootIdentitySource::BootEnvironmentIdentifier,
    BootIdentitySource::TimeOfDayBootTime,
];

/// Derivations that are rejected outright, recorded so the rejection is visible in evidence.
pub const REJECTED_TICK_DERIVATIONS: [&str; 4] = [
    "GetTickCount64",
    "QueryUnbiasedInterruptTime",
    "QueryPerformanceCounter",
    "GetSystemTimeAsFileTime",
];

impl BootIdentitySource {
    pub fn name(self) -> &'static str {
        match self {
            Self::BootEnvironmentIdentifier => "nt-system-boot-environment-information",
            Self::TimeOfDayBootTime => "nt-system-time-of-day-boot-time",
        }
    }
}

/// A boot-unique value plus the source it was probed from.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BootIdentity {
    pub source: BootIdentitySource,
    pub value: [u8; 16],
}

impl BootIdentity {
    pub fn hex(&self) -> String {
        sha256::hex(&self.value)
    }
}

/// The complete probe record: what was tried, in order, and what each attempt produced.
#[derive(Clone, Debug)]
pub struct BootIdentityProbe {
    pub attempts: Vec<(BootIdentitySource, Result<[u8; 16], String>)>,
    pub selected: Option<BootIdentity>,
}

impl BootIdentityProbe {
    pub fn selected_or_unavailable(&self) -> io::Result<BootIdentity> {
        self.selected.clone().ok_or_else(|| {
            io::Error::other(format!(
                "authority-unavailable: no exact boot identity source (tried {})",
                self.attempts
                    .iter()
                    .map(|(source, _)| source.name())
                    .collect::<Vec<_>>()
                    .join(", ")
            ))
        })
    }

    /// Rendered for the attestation. Names every candidate and its outcome, so a reviewer can
    /// tell a selected source from an assumed one.
    pub fn describe(&self) -> String {
        self.attempts
            .iter()
            .map(|(source, outcome)| match outcome {
                Ok(_) => format!("{}=ok", source.name()),
                Err(reason) => format!("{}=unavailable({reason})", source.name()),
            })
            .collect::<Vec<_>>()
            .join(";")
    }
}

fn read_boot_environment_identifier() -> io::Result<[u8; 16]> {
    let mut buffer = [0_u8; size_of::<SystemBootEnvironmentInformation>()];
    let returned = win::query_system_information(SYSTEM_BOOT_ENVIRONMENT_INFORMATION, &mut buffer)?;
    if (returned as usize) < 16 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "boot environment information is shorter than its GUID",
        ));
    }
    let information = unsafe { &*(buffer.as_ptr() as *const SystemBootEnvironmentInformation) };
    let guid = information.boot_identifier;
    if guid == Guid::default() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "boot identifier is the nil GUID",
        ));
    }
    let mut value = [0_u8; 16];
    value[0..4].copy_from_slice(&guid.data1.to_be_bytes());
    value[4..6].copy_from_slice(&guid.data2.to_be_bytes());
    value[6..8].copy_from_slice(&guid.data3.to_be_bytes());
    value[8..16].copy_from_slice(&guid.data4);
    Ok(value)
}

fn read_time_of_day_boot_time() -> io::Result<[u8; 16]> {
    let mut buffer = [0_u8; size_of::<SystemTimeOfDayInformation>()];
    let returned = win::query_system_information(SYSTEM_TIME_OF_DAY_INFORMATION, &mut buffer)?;
    if (returned as usize) < 8 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "time of day information is truncated",
        ));
    }
    let information = unsafe { &*(buffer.as_ptr() as *const SystemTimeOfDayInformation) };
    if information.boot_time == 0 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "boot time is zero",
        ));
    }
    let mut value = [0_u8; 16];
    value[0..8].copy_from_slice(&information.boot_time.to_be_bytes());
    value[8..16].copy_from_slice(&information.boot_time_bias.to_be_bytes());
    Ok(value)
}

fn read(source: BootIdentitySource) -> io::Result<[u8; 16]> {
    match source {
        BootIdentitySource::BootEnvironmentIdentifier => read_boot_environment_identifier(),
        BootIdentitySource::TimeOfDayBootTime => read_time_of_day_boot_time(),
    }
}

/// Probe the enumerated candidates in order and select the first exact one.
pub fn probe() -> BootIdentityProbe {
    let mut attempts = Vec::new();
    let mut selected = None;
    for source in CANDIDATE_ORDER {
        match read(source) {
            Ok(value) => {
                attempts.push((source, Ok(value)));
                if selected.is_none() {
                    selected = Some(BootIdentity { source, value });
                }
            }
            Err(error) => attempts.push((source, Err(error.to_string()))),
        }
    }
    BootIdentityProbe { attempts, selected }
}

/// Acquire boot identity or fail closed with the typed unavailable diagnostic.
pub fn acquire() -> io::Result<BootIdentity> {
    probe().selected_or_unavailable()
}

/// Structural proof that no tick-arithmetic derivation is reachable from this crate: every
/// operating-system entry point the crate can call is declared in [`crate::sys`], and none of
/// the rejected derivations appears there.
pub fn tick_sources_are_not_reachable() -> bool {
    !REJECTED_TICK_DERIVATIONS
        .iter()
        .any(|rejected| DECLARED_FOREIGN_ITEMS.contains(rejected))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_tick_arithmetic_source_is_declared_anywhere_in_the_crate() {
        // The contract requires an exact boot-unique value and rejects tick derivations. This
        // asserts the requirement structurally rather than restating what the code happens to
        // call today: if someone later declares `GetTickCount64` in `sys.rs` in order to
        // derive a boot value, this fails.
        assert!(tick_sources_are_not_reachable());
        for rejected in REJECTED_TICK_DERIVATIONS {
            assert!(
                !DECLARED_FOREIGN_ITEMS.contains(&rejected),
                "{rejected} became reachable"
            );
        }
    }

    #[test]
    fn the_probe_enumerates_every_candidate_in_order() {
        let probe = probe();
        let names: Vec<&str> = probe
            .attempts
            .iter()
            .map(|(source, _)| source.name())
            .collect();
        let expected: Vec<&str> = CANDIDATE_ORDER.iter().map(|source| source.name()).collect();
        assert_eq!(names, expected, "the probe skipped a candidate");
        assert!(!probe.describe().is_empty());
    }

    #[test]
    fn a_boot_identity_is_obtainable_on_this_host_and_is_not_the_nil_value() {
        let identity = acquire().expect("boot identity");
        assert_ne!(identity.value, [0_u8; 16]);
        assert_eq!(
            identity.source,
            BootIdentitySource::BootEnvironmentIdentifier,
            "expected the primary source to be selected on this host"
        );
    }

    #[test]
    fn boot_identity_is_constant_across_repeated_probes_within_one_boot() {
        let first = acquire().expect("first");
        for _ in 0..8 {
            std::thread::sleep(std::time::Duration::from_millis(5));
            assert_eq!(acquire().expect("again"), first);
        }
    }

    #[test]
    fn both_candidate_sources_are_readable_and_disagree_with_each_other() {
        // Two independent readings of the same boot must both be obtainable here; that they
        // differ in value is what makes the fallback a genuinely different source rather than
        // a rename of the first.
        let primary = read(BootIdentitySource::BootEnvironmentIdentifier).expect("primary");
        let fallback = read(BootIdentitySource::TimeOfDayBootTime).expect("fallback");
        assert_ne!(primary, fallback);
        assert_ne!(primary, [0_u8; 16]);
        assert_ne!(fallback, [0_u8; 16]);
    }

    #[test]
    fn an_empty_probe_fails_closed_as_unavailable_rather_than_minting_a_value() {
        let empty = BootIdentityProbe {
            attempts: vec![(
                BootIdentitySource::BootEnvironmentIdentifier,
                Err("denied".to_owned()),
            )],
            selected: None,
        };
        let error = empty.selected_or_unavailable().expect_err("must fail closed");
        assert!(error.to_string().starts_with("authority-unavailable:"));
        assert!(error.to_string().contains("nt-system-boot-environment"));
    }
}
