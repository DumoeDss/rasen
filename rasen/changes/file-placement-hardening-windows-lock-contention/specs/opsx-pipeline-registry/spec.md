## ADDED Requirements

### Requirement: Concurrent pipeline imports survive transient Windows registry-lock sharing errors

When pipeline imports contend for a shared legacy registry lock on Windows, Rasen SHALL treat `EPERM`, `EACCES`, and `EBUSY` results from opening that lock as transient contention within the existing bounded lock deadline. If the transient condition clears, the import SHALL continue through the existing transaction and report its semantic result. If it persists to the deadline, the import SHALL return the registry's existing busy/timeout diagnostic. Other errors, and the existing behavior on non-Windows platforms, SHALL continue to return the registry's create-failed diagnostic.

#### Scenario: Concurrent same-name imports reach the semantic winner and loser results

- **WHEN** two Windows callers concurrently import different packages that install the same pipeline name
- **AND** opening the shared workflow or pipeline registry lock temporarily reports `EPERM`, `EACCES`, or `EBUSY`
- **THEN** Rasen SHALL retry within the existing lock deadline
- **AND** exactly one import SHALL install the complete pipeline while the other reports `pipeline_already_exists`
- **AND** no partial or mixed pipeline content SHALL be installed

#### Scenario: Persistent Windows sharing contention remains bounded

- **WHEN** opening a legacy registry lock on Windows continues to report `EPERM`, `EACCES`, or `EBUSY` until the existing lock deadline
- **THEN** Rasen SHALL stop retrying at that deadline
- **AND** it SHALL return the registry's existing busy/timeout diagnostic

#### Scenario: Genuine lock creation failures retain their existing diagnosis

- **WHEN** opening a legacy registry lock fails with another error, or fails on a non-Windows platform
- **THEN** Rasen SHALL return the registry's existing create-failed diagnostic without reclassifying it as transient Windows contention
