//! The prepare attestation (task 4.7).
//!
//! Everything the reference and the recovery rules depend on is an **observed** value recorded
//! here, not an intended one: the limit mask that was read back, the active-process counts
//! either side of port association, the handle inherit flags, the boot-identity source that was
//! probed, and the explicit fact that no workload process exists.

use std::io;

use crate::boot::{BootIdentity, BootIdentitySource, CANDIDATE_ORDER};
use crate::job::JobAttestation;
use crate::protocol::{
    put_bytes, put_string, take_bytes, take_string, take_u16, take_u32, take_u64,
    MAX_OPERATION_BYTES, MAX_PATH_BYTES, MAX_TEXT_BYTES, PROTOCOL_VERSION, REFERENCE_VERSION,
};
use crate::sha256;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PrepareAttestation {
    pub scope_id: String,
    pub generation: [u8; 16],
    /// Native-generated. The TypeScript layer validates and preserves these bytes and never
    /// generates or backfills them.
    pub scope_capability: [u8; 32],
    pub control_capability: [u8; 32],
    pub operation_id: String,
    pub launch_digest: [u8; 32],
    pub boot_identity: [u8; 16],
    pub boot_identity_source: String,
    /// Every candidate that was tried and what it produced, so a reviewer can tell a probed
    /// source from an assumed one.
    pub boot_probe: String,
    pub guardian_process_id: u32,
    pub guardian_birth: u64,
    pub endpoint_name: String,
    pub endpoint_owner_sid: String,
    /// Owner of the trusted state root. Node cannot read a Windows owner SID at all
    /// (`stat.uid` is 0), so if this is not carried here it does not exist above the crate.
    pub state_root_owner_sid: String,
    /// The sole-handle corroboration token. The guardian mints it at prepare and records it in
    /// the trusted state root **only while the invariant holds**; recovery must ask
    /// [`crate::stateroot::TrustedStateRoot::corroborate_sole_handle`] rather than observe that
    /// this field is non-empty, which it always is.
    pub sole_handle_token: [u8; 32],
    pub job: JobAttestation,
    /// SHA-256 of the helper artifact the provider actually resolved, measured by hashing that
    /// executable rather than asserted from a constant.
    pub artifact_sha256: String,
    /// Crate source digest, compiled in by the build script. Absent in a development build —
    /// and then **omitted** from the canonical projection rather than emitted empty, so a
    /// receipt from an unbuilt helper cannot be bound to a build that never happened.
    pub helper_source_digest: String,
    pub protocol_version: u16,
    pub reference_version: u16,
    /// Always false at `prepared-inert`. Prepare creates no workload process object at all.
    pub workload_process_exists: bool,
}

impl PrepareAttestation {
    /// The complete set of conditions that must hold before `prepared-inert` may be returned.
    /// A caller that revalidates the attestation runs exactly this.
    pub fn violations(&self) -> Vec<&'static str> {
        let mut violations = Vec::new();
        if !self.job.mask_is_exact() {
            violations.push("job-limit-mask-is-not-exact");
        }
        if !self.job.kill_on_close_is_enabled() {
            violations.push("kill-on-job-close-is-not-enabled");
        }
        if !self.job.breakaway_is_disabled() {
            violations.push("breakaway-is-permitted");
        }
        if !self.job.port_was_associated_on_an_empty_job() {
            violations.push("completion-port-was-associated-after-a-member-existed");
        }
        if !self.job.sole_handle_holds() {
            violations.push("job-handle-is-not-solely-held");
        }
        if self.workload_process_exists {
            violations.push("a-workload-process-exists-at-prepared-inert");
        }
        if self.boot_identity == [0_u8; 16] {
            violations.push("boot-identity-is-absent");
        }
        if !CANDIDATE_ORDER
            .iter()
            .any(|source| source.name() == self.boot_identity_source)
        {
            violations.push("boot-identity-source-is-not-an-enumerated-candidate");
        }
        if self.guardian_process_id == 0 || self.guardian_birth == 0 {
            violations.push("guardian-identity-is-absent");
        }
        if self.scope_capability == [0_u8; 32] || self.control_capability == [0_u8; 32] {
            violations.push("a-capability-is-absent");
        }
        if self.scope_capability == self.control_capability {
            violations.push("the-two-capabilities-are-not-independent");
        }
        if self.sole_handle_token == [0_u8; 32] {
            violations.push("sole-handle-token-is-absent");
        }
        if self.sole_handle_token == self.scope_capability
            || self.sole_handle_token == self.control_capability
        {
            violations.push("sole-handle-token-reuses-a-capability");
        }
        if self.state_root_owner_sid.is_empty() {
            violations.push("state-root-owner-is-absent");
        }
        if self.protocol_version != PROTOCOL_VERSION || self.reference_version != REFERENCE_VERSION
        {
            violations.push("version-mismatch");
        }
        violations
    }

    pub fn is_valid(&self) -> bool {
        self.violations().is_empty()
    }

    pub fn boot_source(&self) -> Option<BootIdentitySource> {
        CANDIDATE_ORDER
            .into_iter()
            .find(|source| source.name() == self.boot_identity_source)
    }

    pub fn with_boot(mut self, identity: &BootIdentity, probe: String) -> Self {
        self.boot_identity = identity.value;
        self.boot_identity_source = identity.source.name().to_owned();
        self.boot_probe = probe;
        self
    }

    pub fn encode(&self) -> io::Result<Vec<u8>> {
        let mut output = Vec::new();
        output.extend_from_slice(&PROTOCOL_VERSION.to_be_bytes());
        output.extend_from_slice(&REFERENCE_VERSION.to_be_bytes());
        put_string(&mut output, &self.scope_id, 64, false)?;
        put_bytes(&mut output, &self.generation, 16)?;
        put_bytes(&mut output, &self.scope_capability, 32)?;
        put_bytes(&mut output, &self.control_capability, 32)?;
        put_string(&mut output, &self.operation_id, MAX_OPERATION_BYTES, false)?;
        put_bytes(&mut output, &self.launch_digest, 32)?;
        put_bytes(&mut output, &self.boot_identity, 16)?;
        put_string(&mut output, &self.boot_identity_source, MAX_TEXT_BYTES, false)?;
        put_string(&mut output, &self.boot_probe, MAX_TEXT_BYTES, true)?;
        output.extend_from_slice(&self.guardian_process_id.to_be_bytes());
        output.extend_from_slice(&self.guardian_birth.to_be_bytes());
        put_string(&mut output, &self.endpoint_name, MAX_PATH_BYTES, false)?;
        put_string(&mut output, &self.endpoint_owner_sid, MAX_TEXT_BYTES, false)?;
        put_string(&mut output, &self.state_root_owner_sid, MAX_TEXT_BYTES, false)?;
        put_bytes(&mut output, &self.sole_handle_token, 32)?;
        output.extend_from_slice(&self.job.observed_limit_mask.to_be_bytes());
        output.extend_from_slice(&self.job.active_processes_before_port_association.to_be_bytes());
        output.extend_from_slice(&self.job.active_processes_after_port_association.to_be_bytes());
        output.extend_from_slice(&self.job.job_handle_inherit_flags.to_be_bytes());
        output.extend_from_slice(&self.job.job_handle_duplications.to_be_bytes());
        put_string(&mut output, &self.artifact_sha256, 128, true)?;
        put_string(&mut output, &self.helper_source_digest, 128, true)?;
        output.push(u8::from(self.workload_process_exists));
        Ok(output)
    }

    pub fn decode(bytes: &[u8]) -> io::Result<Self> {
        let mut input = bytes;
        let protocol_version = take_u16(&mut input)?;
        let reference_version = take_u16(&mut input)?;
        if protocol_version != PROTOCOL_VERSION || reference_version != REFERENCE_VERSION {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "attestation version is unsupported",
            ));
        }
        let scope_id = take_string(&mut input, 64, false)?;
        let generation = fixed16(take_bytes(&mut input, 16)?)?;
        let scope_capability = fixed32(take_bytes(&mut input, 32)?)?;
        let control_capability = fixed32(take_bytes(&mut input, 32)?)?;
        let operation_id = take_string(&mut input, MAX_OPERATION_BYTES, false)?;
        let launch_digest = fixed32(take_bytes(&mut input, 32)?)?;
        let boot_identity = fixed16(take_bytes(&mut input, 16)?)?;
        let boot_identity_source = take_string(&mut input, MAX_TEXT_BYTES, false)?;
        let boot_probe = take_string(&mut input, MAX_TEXT_BYTES, true)?;
        let guardian_process_id = take_u32(&mut input)?;
        let guardian_birth = take_u64(&mut input)?;
        let endpoint_name = take_string(&mut input, MAX_PATH_BYTES, false)?;
        let endpoint_owner_sid = take_string(&mut input, MAX_TEXT_BYTES, false)?;
        let state_root_owner_sid = take_string(&mut input, MAX_TEXT_BYTES, false)?;
        let sole_handle_token = fixed32(take_bytes(&mut input, 32)?)?;
        let observed_limit_mask = take_u32(&mut input)?;
        let active_before = take_u32(&mut input)?;
        let active_after = take_u32(&mut input)?;
        let inherit_flags = take_u32(&mut input)?;
        let duplications = take_u32(&mut input)?;
        let artifact_sha256 = take_string(&mut input, 128, true)?;
        let helper_source_digest = take_string(&mut input, 128, true)?;
        if input.len() != 1 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "attestation payload has trailing or missing bytes",
            ));
        }
        let workload_process_exists = input[0] != 0;
        Ok(Self {
            scope_id,
            generation,
            scope_capability,
            control_capability,
            operation_id,
            launch_digest,
            boot_identity,
            boot_identity_source,
            boot_probe,
            guardian_process_id,
            guardian_birth,
            endpoint_name,
            endpoint_owner_sid,
            state_root_owner_sid,
            sole_handle_token,
            job: JobAttestation {
                observed_limit_mask,
                active_processes_before_port_association: active_before,
                active_processes_after_port_association: active_after,
                job_handle_inherit_flags: inherit_flags,
                job_handle_duplications: duplications,
            },
            artifact_sha256,
            helper_source_digest,
            protocol_version,
            reference_version,
            workload_process_exists,
        })
    }

    /// The canonical projection the TypeScript reference codec binds to.
    ///
    /// The **key names are the contract**, not the renderings: that codec projects field by
    /// field by name, so a snake_case key reads as `undefined` and fails as malformed. Extra
    /// keys are tolerated and ignored, which is why `bootProbe`, `workloadProcessExists` and
    /// both port-association counts are carried here as evidence alongside the canonical set.
    ///
    /// `sourceSha256` is **omitted** when the build script did not compile a source digest in.
    /// An absent key fails closed on the consuming side; an empty string would look like a
    /// supplied value, and an unbound runtime receipt is precisely the failure this change
    /// exists to prevent.
    pub fn to_canonical_json(&self) -> String {
        use crate::encoding::{base64url, guid_text, JsonObject};
        let mut object = JsonObject::new();
        object
            .string("scopeId", &self.scope_id_canonical())
            .string("generation", &base64url(&self.generation))
            .string("scopeCapability", &base64url(&self.scope_capability))
            .string("controlCapability", &base64url(&self.control_capability))
            .string("preparationOperationId", &self.operation_id)
            .string("launchDigest", &sha256::hex(&self.launch_digest))
            .string("bootIdentity", &guid_text(&self.boot_identity))
            .string("bootIdentitySource", &self.boot_identity_source)
            .number("guardianProcessId", u64::from(self.guardian_process_id))
            .string("guardianCreationTime", &self.guardian_birth.to_string())
            .string("endpointOwnerSid", &self.endpoint_owner_sid)
            .string("stateRootOwnerSid", &self.state_root_owner_sid)
            .number("jobLimitMask", u64::from(self.job.observed_limit_mask))
            .number(
                "activeProcessCountAtPortAssociation",
                u64::from(self.job.active_processes_before_port_association),
            )
            .string("soleHandleAttestation", &base64url(&self.sole_handle_token))
            .number("helperProtocolVersion", u64::from(self.protocol_version))
            .optional_string("artifactSha256", Some(&self.artifact_sha256))
            .optional_string("sourceSha256", Some(&self.helper_source_digest))
            // Evidence beyond the canonical set. Tolerated and ignored by the codec; retained
            // because task 4.4 needs "probed rather than assumed" to be auditable.
            .string("bootProbe", &self.boot_probe)
            .boolean("workloadProcessExists", self.workload_process_exists)
            .number(
                "activeProcessCountBeforePortAssociation",
                u64::from(self.job.active_processes_before_port_association),
            )
            .number(
                "activeProcessCountAfterPortAssociation",
                u64::from(self.job.active_processes_after_port_association),
            )
            .number(
                "jobHandleInheritFlags",
                u64::from(self.job.job_handle_inherit_flags),
            )
            .number(
                "jobHandleDuplications",
                u64::from(self.job.job_handle_duplications),
            )
            .number("providerReferenceVersion", u64::from(self.reference_version));
        object.finish()
    }

    /// The scope id in the canonical wire rendering: unpadded base64url of the 16 identity
    /// bytes. Internally the same bytes are carried as hex, because the id also names a
    /// filesystem directory and a pipe, where a case-insensitive namespace makes hex the safer
    /// choice.
    pub fn scope_id_canonical(&self) -> String {
        match crate::stateroot::scope_id_bytes(&self.scope_id) {
            Some(bytes) => crate::encoding::base64url(&bytes),
            None => self.scope_id.clone(),
        }
    }

    /// A one-way digest safe to place in diagnostics. The attestation itself carries
    /// capabilities and never reaches a log.
    pub fn redacted_digest(&self) -> io::Result<String> {
        Ok(sha256::digest_hex(&self.encode()?))
    }

    /// The non-secret diagnostic rendering. Capabilities, the endpoint path and the boot value
    /// are deliberately absent.
    pub fn redacted_summary(&self) -> String {
        format!(
            "scope={} generation={} guardian={}/{} boot-source={} boot-probe={} {} workload-exists={}",
            &self.scope_id[..8],
            crate::encoding::base64url(&self.generation),
            self.guardian_process_id,
            self.guardian_birth,
            self.boot_identity_source,
            self.boot_probe,
            self.job.describe(),
            self.workload_process_exists
        )
    }
}

fn fixed32(bytes: Vec<u8>) -> io::Result<[u8; 32]> {
    bytes.try_into().map_err(|_| {
        io::Error::new(io::ErrorKind::InvalidData, "expected a 32 byte field")
    })
}

fn fixed16(bytes: Vec<u8>) -> io::Result<[u8; 16]> {
    bytes.try_into().map_err(|_| {
        io::Error::new(io::ErrorKind::InvalidData, "expected a 16 byte field")
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::job::EXPECTED_LIMIT_MASK;

    fn valid() -> PrepareAttestation {
        PrepareAttestation {
            scope_id: "0123456789abcdef0123456789abcdef".to_owned(),
            generation: [1_u8; 16],
            scope_capability: [1_u8; 32],
            control_capability: [2_u8; 32],
            operation_id: "op-1".to_owned(),
            launch_digest: [3_u8; 32],
            boot_identity: [4_u8; 16],
            boot_identity_source: "nt-system-boot-environment-information".to_owned(),
            boot_probe: "nt-system-boot-environment-information=ok".to_owned(),
            guardian_process_id: 4242,
            guardian_birth: 133_000_000_000_000_000,
            endpoint_name: "\\\\.\\pipe\\rasen-wpa-0123456789abcdef0123456789abcdef".to_owned(),
            endpoint_owner_sid: "S-1-5-21-1-2-3-1001".to_owned(),
            state_root_owner_sid: "S-1-5-21-1-2-3-1001".to_owned(),
            sole_handle_token: [9_u8; 32],
            job: JobAttestation {
                observed_limit_mask: EXPECTED_LIMIT_MASK,
                active_processes_before_port_association: 0,
                active_processes_after_port_association: 0,
                job_handle_inherit_flags: 0,
                job_handle_duplications: 0,
            },
            artifact_sha256: "b".repeat(64),
            helper_source_digest: "a".repeat(64),
            protocol_version: PROTOCOL_VERSION,
            reference_version: REFERENCE_VERSION,
            workload_process_exists: false,
        }
    }

    #[test]
    fn a_complete_attestation_round_trips_exactly() {
        let attestation = valid();
        let encoded = attestation.encode().expect("encode");
        assert_eq!(PrepareAttestation::decode(&encoded).expect("decode"), attestation);
        assert!(attestation.is_valid(), "{:?}", attestation.violations());
    }

    #[test]
    fn every_prepared_inert_precondition_is_individually_load_bearing() {
        // The contract requires prepare to return `prepared-inert` only when all of these
        // hold. Each mutation below breaks exactly one, and each must be caught: a validator
        // that checked a subset would pass some of these.
        let cases: Vec<(&str, PrepareAttestation)> = vec![
            ("job-limit-mask-is-not-exact", {
                let mut value = valid();
                value.job.observed_limit_mask = EXPECTED_LIMIT_MASK | 0x1;
                value
            }),
            ("breakaway-is-permitted", {
                let mut value = valid();
                value.job.observed_limit_mask =
                    EXPECTED_LIMIT_MASK | crate::sys::JOB_OBJECT_LIMIT_BREAKAWAY_OK;
                value
            }),
            ("kill-on-job-close-is-not-enabled", {
                let mut value = valid();
                value.job.observed_limit_mask = 0;
                value
            }),
            (
                "completion-port-was-associated-after-a-member-existed",
                {
                    let mut value = valid();
                    value.job.active_processes_before_port_association = 1;
                    value
                },
            ),
            ("job-handle-is-not-solely-held", {
                let mut value = valid();
                value.job.job_handle_duplications = 1;
                value
            }),
            ("a-workload-process-exists-at-prepared-inert", {
                let mut value = valid();
                value.workload_process_exists = true;
                value
            }),
            ("boot-identity-is-absent", {
                let mut value = valid();
                value.boot_identity = [0_u8; 16];
                value
            }),
            ("boot-identity-source-is-not-an-enumerated-candidate", {
                let mut value = valid();
                value.boot_identity_source = "invented-source".to_owned();
                value
            }),
            ("guardian-identity-is-absent", {
                let mut value = valid();
                value.guardian_birth = 0;
                value
            }),
            ("a-capability-is-absent", {
                let mut value = valid();
                value.control_capability = [0_u8; 32];
                value
            }),
            ("the-two-capabilities-are-not-independent", {
                let mut value = valid();
                value.control_capability = value.scope_capability;
                value
            }),
            ("sole-handle-token-is-absent", {
                let mut value = valid();
                value.sole_handle_token = [0_u8; 32];
                value
            }),
            ("sole-handle-token-reuses-a-capability", {
                let mut value = valid();
                value.sole_handle_token = value.control_capability;
                value
            }),
            ("state-root-owner-is-absent", {
                let mut value = valid();
                value.state_root_owner_sid = String::new();
                value
            }),
        ];
        for (expected, mutated) in cases {
            let violations = mutated.violations();
            assert!(
                violations.contains(&expected),
                "mutation for {expected} produced {violations:?}"
            );
            assert!(!mutated.is_valid());
        }
    }

    #[test]
    fn a_truncated_or_extended_attestation_payload_is_rejected() {
        let encoded = valid().encode().expect("encode");
        assert!(PrepareAttestation::decode(&encoded[..encoded.len() - 1]).is_err());
        let mut extended = encoded.clone();
        extended.push(0);
        assert!(PrepareAttestation::decode(&extended).is_err());
        let mut wrong_version = encoded.clone();
        wrong_version[1] = 9;
        assert!(PrepareAttestation::decode(&wrong_version).is_err());
    }

    #[test]
    fn the_redacted_summary_never_carries_a_capability_or_the_boot_value() {
        let attestation = valid();
        let summary = attestation.redacted_summary();
        assert!(!summary.contains(&sha256::hex(&attestation.scope_capability)));
        assert!(!summary.contains(&sha256::hex(&attestation.control_capability)));
        assert!(!summary.contains(&sha256::hex(&attestation.boot_identity)));
        assert!(!summary.contains(&attestation.endpoint_name));
        assert!(!summary.contains(&attestation.scope_id));
        assert!(summary.contains("boot-source="));
        assert_eq!(attestation.redacted_digest().expect("digest").len(), 64);
    }
}
