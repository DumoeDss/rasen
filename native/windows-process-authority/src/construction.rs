//! Exact partial-construction reconciliation (task 4.9).
//!
//! Every point at which prepare can fail is enumerated as a [`ConstructionCheckpoint`]. The
//! injected-failure matrix in the tests is tied to that enumeration by a **compile-time
//! forcing function**: [`checkpoint_position`] matches without a wildcard arm, so adding a
//! sixteenth variant produces `error[E0004]: non-exhaustive patterns` rather than silently
//! escaping a coverage claim. This is the direct answer to `F-L2-08` on the Linux sibling,
//! where an 18-entry array had no compile-time tie to its enum.

use std::io;

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub enum ConstructionCheckpoint {
    ArgumentValidation,
    TrustedStateRootValidation,
    ScopeIdentityGeneration,
    BootIdentityAcquisition,
    ScopeDirectoryCreation,
    JobCreation,
    JobLimitConfiguration,
    JobLimitReadback,
    CompletionPortAssociation,
    JobHandleDiscipline,
    ControlEndpointCreation,
    JournalCreation,
    PreparedRecord,
    AttestationEmission,
    FinalRevalidation,
}

/// Every checkpoint, in construction order.
pub const CONSTRUCTION_CHECKPOINTS: [ConstructionCheckpoint; 15] = [
    ConstructionCheckpoint::ArgumentValidation,
    ConstructionCheckpoint::TrustedStateRootValidation,
    ConstructionCheckpoint::ScopeIdentityGeneration,
    ConstructionCheckpoint::BootIdentityAcquisition,
    ConstructionCheckpoint::ScopeDirectoryCreation,
    ConstructionCheckpoint::JobCreation,
    ConstructionCheckpoint::JobLimitConfiguration,
    ConstructionCheckpoint::JobLimitReadback,
    ConstructionCheckpoint::CompletionPortAssociation,
    ConstructionCheckpoint::JobHandleDiscipline,
    ConstructionCheckpoint::ControlEndpointCreation,
    ConstructionCheckpoint::JournalCreation,
    ConstructionCheckpoint::PreparedRecord,
    ConstructionCheckpoint::AttestationEmission,
    ConstructionCheckpoint::FinalRevalidation,
];

/// The forcing function. Deliberately wildcard-free: a new variant fails to compile here
/// before it can escape the injected-failure matrix.
pub fn checkpoint_position(checkpoint: ConstructionCheckpoint) -> usize {
    match checkpoint {
        ConstructionCheckpoint::ArgumentValidation => 0,
        ConstructionCheckpoint::TrustedStateRootValidation => 1,
        ConstructionCheckpoint::ScopeIdentityGeneration => 2,
        ConstructionCheckpoint::BootIdentityAcquisition => 3,
        ConstructionCheckpoint::ScopeDirectoryCreation => 4,
        ConstructionCheckpoint::JobCreation => 5,
        ConstructionCheckpoint::JobLimitConfiguration => 6,
        ConstructionCheckpoint::JobLimitReadback => 7,
        ConstructionCheckpoint::CompletionPortAssociation => 8,
        ConstructionCheckpoint::JobHandleDiscipline => 9,
        ConstructionCheckpoint::ControlEndpointCreation => 10,
        ConstructionCheckpoint::JournalCreation => 11,
        ConstructionCheckpoint::PreparedRecord => 12,
        ConstructionCheckpoint::AttestationEmission => 13,
        ConstructionCheckpoint::FinalRevalidation => 14,
    }
}

impl ConstructionCheckpoint {
    pub fn name(self) -> &'static str {
        match self {
            Self::ArgumentValidation => "argument-validation",
            Self::TrustedStateRootValidation => "trusted-state-root-validation",
            Self::ScopeIdentityGeneration => "scope-identity-generation",
            Self::BootIdentityAcquisition => "boot-identity-acquisition",
            Self::ScopeDirectoryCreation => "scope-directory-creation",
            Self::JobCreation => "job-creation",
            Self::JobLimitConfiguration => "job-limit-configuration",
            Self::JobLimitReadback => "job-limit-readback",
            Self::CompletionPortAssociation => "completion-port-association",
            Self::JobHandleDiscipline => "job-handle-discipline",
            Self::ControlEndpointCreation => "control-endpoint-creation",
            Self::JournalCreation => "journal-creation",
            Self::PreparedRecord => "prepared-record",
            Self::AttestationEmission => "attestation-emission",
            Self::FinalRevalidation => "final-revalidation",
        }
    }

    pub fn from_name(value: &str) -> Option<Self> {
        CONSTRUCTION_CHECKPOINTS
            .into_iter()
            .find(|checkpoint| checkpoint.name() == value)
    }

    /// True once the Job object exists, which is where reconciliation stops being a no-op.
    pub fn job_exists_at_or_after(self) -> bool {
        checkpoint_position(self) >= checkpoint_position(ConstructionCheckpoint::JobCreation)
    }

    /// True once the control endpoint exists.
    pub fn endpoint_exists_at_or_after(self) -> bool {
        checkpoint_position(self)
            >= checkpoint_position(ConstructionCheckpoint::ControlEndpointCreation)
    }
}

/// What a caller must observe after prepare failed at any checkpoint. All four are required,
/// at every checkpoint, without exception.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct ReconciliationOutcome {
    pub workload_process_exists: bool,
    pub guardian_is_live: bool,
    pub job_survived: bool,
    pub endpoint_survived: bool,
}

impl ReconciliationOutcome {
    pub fn is_clean(&self) -> bool {
        !self.workload_process_exists
            && !self.guardian_is_live
            && !self.job_survived
            && !self.endpoint_survived
    }

    pub fn violations(&self) -> Vec<&'static str> {
        let mut violations = Vec::new();
        if self.workload_process_exists {
            violations.push("a-workload-process-survived-a-failed-prepare");
        }
        if self.guardian_is_live {
            violations.push("a-guardian-survived-a-failed-prepare");
        }
        if self.job_survived {
            violations.push("a-job-survived-a-failed-prepare");
        }
        if self.endpoint_survived {
            violations.push("an-endpoint-survived-a-failed-prepare");
        }
        violations
    }
}

pub fn parse_checkpoint(value: &str) -> io::Result<ConstructionCheckpoint> {
    ConstructionCheckpoint::from_name(value).ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("unknown construction checkpoint: {value}"),
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_checkpoint_maps_back_to_its_own_index() {
        // Catches duplication and reordering between the enum and the array, which the
        // compile-time exhaustiveness check alone cannot see.
        for (index, checkpoint) in CONSTRUCTION_CHECKPOINTS.into_iter().enumerate() {
            assert_eq!(
                checkpoint_position(checkpoint),
                index,
                "{} is at array index {index} but reports position {}",
                checkpoint.name(),
                checkpoint_position(checkpoint)
            );
        }
        let mut names: Vec<&str> = CONSTRUCTION_CHECKPOINTS
            .into_iter()
            .map(|checkpoint| checkpoint.name())
            .collect();
        names.sort_unstable();
        names.dedup();
        assert_eq!(names.len(), CONSTRUCTION_CHECKPOINTS.len());
    }

    #[test]
    fn checkpoint_names_round_trip() {
        for checkpoint in CONSTRUCTION_CHECKPOINTS {
            assert_eq!(
                ConstructionCheckpoint::from_name(checkpoint.name()),
                Some(checkpoint)
            );
        }
        assert!(ConstructionCheckpoint::from_name("nope").is_none());
        assert!(parse_checkpoint("job-creation").is_ok());
        assert!(parse_checkpoint("job-creationx").is_err());
    }

    #[test]
    fn a_clean_reconciliation_requires_all_four_conditions() {
        assert!(ReconciliationOutcome::default().is_clean());
        for mutated in [
            ReconciliationOutcome {
                workload_process_exists: true,
                ..Default::default()
            },
            ReconciliationOutcome {
                guardian_is_live: true,
                ..Default::default()
            },
            ReconciliationOutcome {
                job_survived: true,
                ..Default::default()
            },
            ReconciliationOutcome {
                endpoint_survived: true,
                ..Default::default()
            },
        ] {
            assert!(!mutated.is_clean(), "{mutated:?} was accepted as clean");
            assert_eq!(mutated.violations().len(), 1);
        }
    }

    #[test]
    fn resource_existence_predicates_follow_construction_order() {
        assert!(!ConstructionCheckpoint::ArgumentValidation.job_exists_at_or_after());
        assert!(!ConstructionCheckpoint::BootIdentityAcquisition.job_exists_at_or_after());
        assert!(ConstructionCheckpoint::JobCreation.job_exists_at_or_after());
        assert!(ConstructionCheckpoint::FinalRevalidation.job_exists_at_or_after());
        assert!(ConstructionCheckpoint::JournalCreation.endpoint_exists_at_or_after());
        assert!(!ConstructionCheckpoint::JobCreation.endpoint_exists_at_or_after());
        assert!(ConstructionCheckpoint::ControlEndpointCreation.endpoint_exists_at_or_after());
    }
}
