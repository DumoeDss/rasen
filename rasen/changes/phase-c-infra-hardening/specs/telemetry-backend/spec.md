## ADDED Requirements

### Requirement: Production Endpoint TLS and End-to-End Reachability

The production telemetry endpoint served at the maintainer's custom domain (`https://telemetry.rasen.io`) — the URL the shipped CLI targets — SHALL terminate TLS with a valid certificate and accept CLI-emitted events end-to-end, returning a 2xx (202) to a well-formed event. The release process SHALL verify this and record the evidence. Because TLS certificate provisioning is an external Cloudflare dependency, if provisioning is not yet complete at verification time the verification obligation SHALL be satisfied by probing and recording the pending status rather than by blocking on Cloudflare's timeline.

#### Scenario: Production endpoint serves valid TLS

- **WHEN** the production endpoint is probed over HTTPS
- **THEN** the TLS handshake completes against a valid, non-expired certificate for `telemetry.rasen.io`
- **AND** the probe transcript (certificate issuer/validity and HTTP status) is recorded as verification evidence

#### Scenario: Well-formed event is accepted end-to-end

- **WHEN** a well-formed event (`command`, `version`, `distinctId`, and optional `os`/`node_version`) is POSTed to the production endpoint
- **THEN** the endpoint responds with a 202
- **AND** a real CLI-emitted event (a genuine `rasen` command run with telemetry enabled) completes without surfacing a network error and without delaying CLI exit beyond the client timeout

#### Scenario: TLS provisioning incomplete is recorded, not blocking

- **WHEN** the production endpoint's TLS certificate is still provisioning at verification time
- **THEN** the verification records the endpoint status as a known pending external dependency (with the probe result) and does not block the change
- **AND** the client's fire-and-forget design means events are silently dropped in the interim without affecting the CLI, and dashboard confirmation that events land is left as the maintainer's follow-up step
