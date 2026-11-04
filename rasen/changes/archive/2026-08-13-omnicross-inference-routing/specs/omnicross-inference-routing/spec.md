## ADDED Requirements

### Requirement: OmniCross connection configuration is typed and local-only
Rasen SHALL resolve an OmniCross daemon endpoint, a bounded request timeout, and the name of the environment variable containing the control credential from its ordinary effective configuration layers. The endpoint SHALL be an HTTP loopback origin in this capability; the credential value SHALL be read only at dispatch time and SHALL NOT be stored in project configuration, pipeline definitions, frozen profiles, or output. Invalid, missing, remote, credential-less, or unsupported configuration SHALL fail before an agent process starts.

#### Scenario: Configured loopback daemon is available
- **WHEN** a stage selects OmniCross, the effective endpoint is a valid loopback HTTP origin, and the configured credential environment variable is present
- **THEN** Rasen SHALL create the Route Lease through that endpoint using the credential in the request authorization header
- **AND** the credential SHALL NOT appear in the request body or invocation arguments

#### Scenario: Remote endpoint is rejected
- **WHEN** the effective OmniCross endpoint resolves to a non-loopback hostname or address
- **THEN** Rasen SHALL reject the dispatch as invalid broker configuration before creating a lease or starting an agent
- **AND** SHALL identify that remote OmniCross daemons are outside this capability

#### Scenario: Control credential is absent
- **WHEN** a stage selects OmniCross but the configured control-credential environment variable is absent or empty
- **THEN** Rasen SHALL return a fatal configuration failure before contacting the daemon or starting an agent

### Requirement: Route Lease requests preserve the frozen logical route
For each OmniCross-routed stage attempt, Rasen SHALL send the versioned Route Lease request with consumer `rasen`, the frozen runtime, the frozen upstream discriminated union, the frozen effective model, bounded execution attribution, an attempt-specific idempotency key, and an optional bounded TTL. The supported upstream kinds SHALL be `provider`, `account`, `account-group`, and `account-pool`, with the identifiers required by each kind. Rasen SHALL reject unknown kinds or incomplete targets before contacting the daemon.

#### Scenario: Provider route is requested
- **WHEN** a Codex stage attempt freezes upstream `{ kind: "provider", providerId: "deepseek-api" }` and model `deepseek-chat`
- **THEN** its create request SHALL identify runtime `codex`, that exact upstream, and model `deepseek-chat`
- **AND** SHALL carry an idempotency key unique to the run, stage, and attempt

#### Scenario: Account pool route is requested
- **WHEN** a Claude stage freezes upstream `{ kind: "account-pool", providerId: "anthropic-subscriptions" }`
- **THEN** its create request SHALL preserve that exact pool target rather than reducing it to a generic Provider

#### Scenario: Incomplete upstream is rejected
- **WHEN** an account, account-group, or Provider target omits an identifier required by its kind
- **THEN** Rasen SHALL reject it before any Route Lease request or agent spawn

### Requirement: Lease responses are validated into a constrained runtime binding
Rasen SHALL accept only `omnicross.route-lease/1` create responses whose lease identity, expiry, runtime, upstream, and model agree with the request and whose launch descriptor can be reduced to the named Claude or Codex binding contract. Unknown major schema versions, mismatched routing metadata, expired responses, unrecognized environment keys, secret-bearing argv, or arbitrary CLI overrides SHALL fail before process spawn. Extension fields on the same supported major version MAY be ignored only when they cannot change launch behavior.

#### Scenario: Valid Codex descriptor is accepted
- **WHEN** OmniCross returns the dedicated route-token environment key and the supported `omnicross` custom-provider overrides for a requested Codex route
- **THEN** Rasen SHALL produce a typed Codex binding containing the child-only environment and allowlisted provider configuration
- **AND** SHALL keep the route token out of argv

#### Scenario: Descriptor attempts to override Rasen-owned arguments
- **WHEN** a lease descriptor contains an argument that changes the prompt, sandbox, output schema, result file, effort, model, resume thread, or another Rasen-owned Codex option
- **THEN** Rasen SHALL reject the descriptor and SHALL NOT spawn Codex

#### Scenario: Response route does not match the request
- **WHEN** a create response names a different runtime, upstream, or model than the frozen request
- **THEN** Rasen SHALL classify the response as an invalid broker contract and SHALL NOT spawn an agent

### Requirement: Lease lifetime encloses exactly one agent attempt
Rasen SHALL acquire a distinct Route Lease before each fresh or resumed agent attempt, keep it alive while that attempt is running, and best-effort release it after success, failure, timeout, cancellation, or spawn failure. Renewal SHALL happen before the returned expiry with bounded retries; if Rasen can no longer prove the lease remains valid through the running turn, it SHALL terminate the agent process tree and return a route-lost failure. Release failure SHALL produce a redacted warning and SHALL NOT change an otherwise successful agent result.

#### Scenario: Successful attempt releases its lease
- **WHEN** an OmniCross-routed agent turn completes successfully
- **THEN** Rasen SHALL release that attempt's lease after collecting the structured result
- **AND** SHALL retain only safe lease metadata in the receipt

#### Scenario: Spawn fails after lease creation
- **WHEN** Rasen creates a lease but the Claude or Codex process cannot be started
- **THEN** Rasen SHALL best-effort release the lease before returning the spawn failure

#### Scenario: Renewal can no longer establish validity
- **WHEN** renewals fail past the bounded safety window while the agent process remains active
- **THEN** Rasen SHALL terminate the complete agent process tree and return a stable route-lost failure
- **AND** SHALL best-effort release the lease

#### Scenario: Release fails after a successful turn
- **WHEN** the agent result is valid but the release request fails
- **THEN** Rasen SHALL preserve the successful result and attach a redacted cleanup warning
- **AND** SHALL rely on the daemon's bounded TTL to reclaim the route

### Requirement: Resume re-leases the same logical inference route
Rasen SHALL persist the credential-free logical route needed for recovery and SHALL use it for every continuation of the same frozen stage/action. A released, expired, or daemon-lost lease SHALL be replaced with a newly created lease and token for that same runtime, upstream, and model; the replacement SHALL NOT be treated as route drift. If the frozen upstream or model can no longer be leased, resume SHALL fail closed without using the CLI's current login, global provider, or a different upstream.

#### Scenario: Daemon restarted before resume
- **WHEN** an existing Claude session or Codex thread resumes after the daemon has lost its in-memory leases
- **THEN** Rasen SHALL create a new lease from the frozen logical route before continuing the exact session or thread
- **AND** the new token SHALL remain ephemeral

#### Scenario: Frozen upstream was deleted
- **WHEN** resume attempts to lease an upstream that no longer exists
- **THEN** Rasen SHALL return an actionable frozen-route-invalid failure
- **AND** SHALL NOT start or resume the agent against its default account

### Requirement: Broker failures are stable, redacted, and fail closed
Rasen SHALL map transport, timeout, authorization, daemon-readiness, request-validation, upstream-resolution, model, format, idempotency, exhaustion, expiry, and unsupported-version failures to stable Route Lease failure kinds while preserving the daemon's retryability signal where safe. Every failure path SHALL redact authorization values, route tokens, credential-shaped environment values, request headers, and launch descriptors before the value reaches receipts, logs, run-state, evidence, or telemetry.

#### Scenario: Daemon is unreachable
- **WHEN** the loopback daemon cannot be reached within the configured timeout
- **THEN** Rasen SHALL return a daemon-unavailable failure before starting the agent
- **AND** SHALL NOT fall back to an unproxied invocation

#### Scenario: Daemon rejects the control credential
- **WHEN** lease creation returns `control_unauthorized`
- **THEN** Rasen SHALL return a fatal broker-authentication failure without retrying under another identity
- **AND** no diagnostic SHALL reveal the credential

#### Scenario: Secret-shaped error payload is returned
- **WHEN** the daemon or runtime includes a route token, bearer header, or credential-shaped value in an error
- **THEN** every user-visible and persisted diagnostic SHALL contain a redaction marker in place of that value

### Requirement: Validated worker results preserve their complete structure
Secret redaction for a validated leaf or evaluate worker result SHALL preserve every schema-valid field, array element, and nesting level. Diagnostic rendering MAY apply separate size, breadth, and depth bounds, but those bounds SHALL NOT be applied to a typed worker result or hidden behind a cast to the validated result type. Explicit in-memory Route Lease and control secrets SHALL still be redacted from every string in the returned structured result.

#### Scenario: Evaluate result contains more than one hundred gaps
- **WHEN** a Claude or Codex evaluate worker returns a schema-valid result containing more than one hundred gaps and nested strings that echo an explicit route secret
- **THEN** the runtime receipt and canonical Action outcome SHALL retain every gap in order
- **AND** every occurrence of the explicit secret SHALL be replaced by the redaction marker
- **AND** the preserved result SHALL remain valid under the evaluate result schema

### Requirement: Concurrent and non-OmniCross dispatches remain isolated
Each concurrent OmniCross-routed stage attempt SHALL own an independent lease and child environment. Releasing, renewing, or failing one lease SHALL NOT mutate another attempt or a process-wide provider selection. A stage without an OmniCross inference declaration SHALL follow the pre-existing runtime dispatch path byte-for-byte apart from additive absent fields in machine output.

#### Scenario: Concurrent stages choose different upstreams
- **WHEN** two stages run concurrently with different OmniCross upstreams or models
- **THEN** each child process SHALL receive only its own route binding
- **AND** cleanup of either lease SHALL NOT affect the other process

#### Scenario: Existing pipeline has no inference declaration
- **WHEN** a pre-existing pipeline stage dispatches without `inference`
- **THEN** Rasen SHALL make no OmniCross request and SHALL use the existing Claude or Codex invocation behavior
