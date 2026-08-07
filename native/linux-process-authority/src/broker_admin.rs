use std::io;

use crate::broker_install::BrokerInstallLayout;
use crate::broker_lease::{BrokerLease, CgroupLeafIdentity};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct InstallInputs {
    pub binary_sha256: [u8; 32],
    pub public_key_manifest_sha256: [u8; 32],
    pub private_key_sha256: [u8; 32],
    pub service_unit_sha256: [u8; 32],
    pub service_gid: u32,
}

impl InstallInputs {
    fn validate(&self) -> io::Result<()> {
        if self.service_gid == 0
            || [
                self.binary_sha256,
                self.public_key_manifest_sha256,
                self.private_key_sha256,
                self.service_unit_sha256,
            ]
            .iter()
            .any(|digest| digest.iter().all(|byte| *byte == 0))
            || self.public_key_manifest_sha256 == self.private_key_sha256
        {
            return Err(invalid_input("broker install inputs are zero or conflated"));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExistingInstallation {
    pub protected_directories: bool,
    pub binary_sha256: Option<[u8; 32]>,
    pub public_key_manifest_sha256: Option<[u8; 32]>,
    pub private_key_sha256: Option<[u8; 32]>,
    pub service_unit_sha256: Option<[u8; 32]>,
    pub service_enabled: bool,
    pub service_gid: Option<u32>,
}

impl ExistingInstallation {
    pub fn absent() -> Self {
        Self {
            protected_directories: false,
            binary_sha256: None,
            public_key_manifest_sha256: None,
            private_key_sha256: None,
            service_unit_sha256: None,
            service_enabled: false,
            service_gid: None,
        }
    }

    pub fn matching(inputs: &InstallInputs) -> Self {
        Self {
            protected_directories: true,
            binary_sha256: Some(inputs.binary_sha256),
            public_key_manifest_sha256: Some(inputs.public_key_manifest_sha256),
            private_key_sha256: Some(inputs.private_key_sha256),
            service_unit_sha256: Some(inputs.service_unit_sha256),
            service_enabled: true,
            service_gid: Some(inputs.service_gid),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum InstallAction {
    NoChange,
    CreateProtectedDirectories,
    InstallBinary,
    InstallKeyMaterial,
    InstallServiceUnit,
    EnableService,
    DisableService,
    RemoveSocket,
    RemoveServiceUnit,
    RemoveKeyMaterial,
    RemoveBinary,
    RemoveEmptyProtectedDirectories,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AdministrativePlan {
    pub actions: Vec<InstallAction>,
}

impl AdministrativePlan {
    pub fn render(&self) -> String {
        self.actions
            .iter()
            .map(|action| match action {
                InstallAction::NoChange => "no-change",
                InstallAction::CreateProtectedDirectories => "create-protected-directories",
                InstallAction::InstallBinary => "install-binary",
                InstallAction::InstallKeyMaterial => "install-key-material",
                InstallAction::InstallServiceUnit => "install-service-unit",
                InstallAction::EnableService => "enable-service",
                InstallAction::DisableService => "disable-service",
                InstallAction::RemoveSocket => "remove-socket",
                InstallAction::RemoveServiceUnit => "remove-service-unit",
                InstallAction::RemoveKeyMaterial => "remove-key-material",
                InstallAction::RemoveBinary => "remove-binary",
                InstallAction::RemoveEmptyProtectedDirectories => {
                    "remove-empty-protected-directories"
                }
            })
            .collect::<Vec<_>>()
            .join("\n")
    }
}

pub fn plan_install(
    layout: &BrokerInstallLayout,
    inputs: &InstallInputs,
    existing: &ExistingInstallation,
) -> io::Result<AdministrativePlan> {
    layout.validate()?;
    inputs.validate()?;
    let mut actions = Vec::new();
    if !existing.protected_directories || existing.service_gid != Some(inputs.service_gid) {
        actions.push(InstallAction::CreateProtectedDirectories);
    }
    if existing.binary_sha256 != Some(inputs.binary_sha256) {
        actions.push(InstallAction::InstallBinary);
    }
    if existing.public_key_manifest_sha256 != Some(inputs.public_key_manifest_sha256)
        || existing.private_key_sha256 != Some(inputs.private_key_sha256)
    {
        actions.push(InstallAction::InstallKeyMaterial);
    }
    if existing.service_unit_sha256 != Some(inputs.service_unit_sha256) {
        actions.push(InstallAction::InstallServiceUnit);
    }
    if !existing.service_enabled {
        actions.push(InstallAction::EnableService);
    }
    if actions.is_empty() {
        actions.push(InstallAction::NoChange);
    }
    Ok(AdministrativePlan { actions })
}

pub fn plan_uninstall(
    layout: &BrokerInstallLayout,
    durable_leases: &[BrokerLease],
    populated_leaves: &[CgroupLeafIdentity],
) -> io::Result<AdministrativePlan> {
    layout.validate()?;
    if !durable_leases.is_empty() || !populated_leaves.is_empty() {
        return Err(io::Error::new(
            io::ErrorKind::WouldBlock,
            "broker uninstall refuses durable or populated leases",
        ));
    }
    Ok(AdministrativePlan {
        actions: vec![
            InstallAction::DisableService,
            InstallAction::RemoveSocket,
            InstallAction::RemoveServiceUnit,
            InstallAction::RemoveKeyMaterial,
            InstallAction::RemoveBinary,
            InstallAction::RemoveEmptyProtectedDirectories,
        ],
    })
}

fn invalid_input(message: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidInput, message)
}
