## MODIFIED Requirements

### Requirement: Implicit latest-session discovery refuses a host with no context-probe adapter

When the user asks for the current session's occupancy without naming a transcript or a runtime, `rasen agent context --latest` SHALL resolve the harness the session is running in and, if that harness has no context-probe adapter, SHALL report the occupancy as unavailable with a reason identifying the host. It SHALL NOT read another harness's transcript store in that case, because a reading taken from a different harness's session describes a different conversation and cannot be distinguished from a correct answer by the caller.

When the resolved harness DOES have a context-probe adapter, the implicit path SHALL locate that harness's own newest session for the working directory and report the occupancy — this now includes Oh My Pi, so an Oh My Pi session receives a reading of its own session instead of the unavailable result. A harness whose pre-existing implicit resolution is pinned by the byte-identical guarantee below is the stated exception and SHALL keep resolving through the fallback store; today that is Codex, whose implicit `--latest` continues to read the Claude projects directory.

This refusal SHALL follow the existing environmental-absence contract: exit 0 with a machine-readable unavailable result that fabricates no probe fields, since a host without a probe adapter is a legitimate host for a non-blocking probe rather than an error.

The refusal SHALL apply only where the runtime is inferred. An explicit `--transcript <path>` and an explicit `--runtime <runtime>` are deliberate user selections and SHALL continue to work unchanged from any host, including a host with no probe adapter.

#### Scenario: Implicit probe on a host with no probe adapter is unavailable

- **WHEN** a user runs `rasen agent context --latest --json` with neither `--transcript` nor `--runtime`
- **AND** the detected host runtime is a recognized runtime with no context-probe adapter
- **THEN** the CLI SHALL exit 0
- **AND** SHALL print a single JSON object reporting `available` as `false` with a reason distinguishing an unsupported host from a missing transcript
- **AND** the detail SHALL name the detected host and state that no context probe exists for it
- **AND** SHALL NOT report `runtime`, `model`, `contextTokens`, `limit`, or `pct`
- **AND** SHALL NOT read any other harness's session store

#### Scenario: Unsupported host is refused in text mode

- **WHEN** the same implicit probe runs without `--json`
- **THEN** the CLI SHALL exit 0
- **AND** SHALL print a single human-readable line naming the detected host and the reason
- **AND** SHALL print no occupancy figures

#### Scenario: Implicit probe on an Oh My Pi host reports its own session

- **WHEN** a user runs `rasen agent context --latest --json` from an Oh My Pi session with neither `--transcript` nor `--runtime`
- **AND** an Oh My Pi session exists for the working directory
- **THEN** the CLI SHALL exit 0
- **AND** SHALL report `available` as `true` with runtime `omp` and the occupancy of that session
- **AND** SHALL NOT read the Claude projects directory or the Codex sessions store

#### Scenario: Implicit probe on an Oh My Pi host with no session reports absence

- **WHEN** the same implicit probe runs and no Oh My Pi session exists for the working directory
- **THEN** the CLI SHALL exit 0
- **AND** SHALL report the existing no-transcript unavailable result rather than the unsupported-host result

#### Scenario: Explicit transcript still works from an unsupported host

- **WHEN** a user runs `rasen agent context --transcript <path> --json` from a host with no context-probe adapter
- **AND** the path names a readable transcript of a supported runtime
- **THEN** the CLI SHALL report the same successful fields it reports from any other host
- **AND** SHALL NOT refuse on account of the host

#### Scenario: Explicit runtime still works from an unsupported host

- **WHEN** a user runs `rasen agent context --latest --runtime claude --json` from a host with no context-probe adapter
- **THEN** the CLI SHALL perform the requested runtime's latest-session discovery unchanged
- **AND** SHALL report either a successful reading or the existing no-transcript unavailable result for that runtime

#### Scenario: Hosts with a probe adapter are unaffected

- **WHEN** a user runs `rasen agent context --latest` on a Claude or Codex host with no explicit runtime
- **THEN** discovery, detection, reported fields, and the existing no-transcript unavailable result SHALL be byte-identical to their behavior before this capability

## ADDED Requirements

### Requirement: An Oh My Pi session is a valid explicit probe target

Rasen SHALL accept `omp` wherever a probe runtime is named explicitly, and SHALL read a named Oh My Pi session file rather than refusing it, so a user who points at an Oh My Pi session from any harness gets a reading.

#### Scenario: Explicit Oh My Pi runtime is accepted

- **WHEN** a user runs `rasen agent context --latest --runtime omp`
- **THEN** the CLI SHALL locate and read the newest Oh My Pi session for the working directory
- **AND** SHALL NOT reject `omp` as a non-probe runtime

#### Scenario: An explicitly named Oh My Pi session file is read

- **WHEN** a user runs `rasen agent context --transcript <oh-my-pi-session-file> --json` from any host
- **THEN** the CLI SHALL report the occupancy of that session with runtime `omp`
- **AND** SHALL NOT refuse the file for want of a reader

#### Scenario: The opportunistic estimate covers Oh My Pi

- **WHEN** a consumer takes a best-effort occupancy estimate from an Oh My Pi session file
- **THEN** an estimate SHALL be returned
- **AND** absence SHALL still be reported as absence rather than as a zero occupancy
