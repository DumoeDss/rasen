//! Windows-only recursive process-authority helper.
//!
//! The authority is one unnamed, breakaway-disabled, kill-on-job-close Job Object. A guardian
//! process outside the Job holds its only handle; the workload root is created suspended with
//! its Job membership applied as part of creation. See
//! `rasen/changes/ecp-windows-process-authority-provider/design.md`.

pub mod construction;
pub mod encoding;
pub mod launch;
pub mod protocol;
pub mod sha256;
pub mod sys;

#[cfg(windows)]
pub mod activation;
#[cfg(windows)]
pub mod attestation;
#[cfg(windows)]
pub mod boot;
#[cfg(windows)]
pub mod cli;
#[cfg(windows)]
pub mod endpoint;
#[cfg(windows)]
pub mod guardian;
#[cfg(windows)]
pub mod job;
#[cfg(windows)]
pub mod journal;
#[cfg(windows)]
pub mod stateroot;
#[cfg(windows)]
pub mod win;
