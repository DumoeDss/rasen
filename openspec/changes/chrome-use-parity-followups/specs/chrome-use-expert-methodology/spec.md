## ADDED Requirements

### Requirement: curl Examples Bypass a Configured HTTP Proxy

The chrome-use curl examples in the shared expert blocks and the self-contained chrome-use skill SHALL pass `--noproxy '*'` (or equivalent) so that calls to `localhost:3456` are not hijacked by a machine-level `HTTP(S)_PROXY` and returned as 502, and the SETUP guidance SHALL state why.

#### Scenario: Live curl examples opt out of the proxy

- **WHEN** a browser-driving expert skill (QA, QA-only, design review, design consultation, benchmark, office-hours) is generated
- **THEN** each live `curl` example that calls `localhost:3456` passes `--noproxy '*'` so it works on a machine with a configured HTTP(S) proxy

#### Scenario: SETUP explains the proxy caveat

- **WHEN** an expert skill's SETUP block is generated
- **THEN** it notes that a configured `HTTP(S)_PROXY` would otherwise hijack `localhost` calls, which is why the examples pass `--noproxy '*'`

## MODIFIED Requirements

### Requirement: Responsive and Performance Coverage Preserved

The methodology blocks SHALL preserve responsive-audit and performance coverage using the chrome-use endpoints, and SHALL NOT claim performance metrics the proxy does not reliably provide. Where the methodology reads paint metrics via `/perf`, it SHALL reflect that a background tab must be foregrounded (or sampled with `activate=true`) for paint/LCP to be present.

#### Scenario: Responsive audit uses emulation endpoints

- **WHEN** the methodology performs a responsive or multi-viewport audit
- **THEN** it uses `/viewport` and/or `/responsive` rather than the removed browse `viewport`/`responsive` commands

#### Scenario: Performance text does not overpromise

- **WHEN** the methodology references page performance metrics via `/perf`
- **THEN** it describes the metrics the endpoint provides (such as LCP, FCP, CLS, resource timing) and does not promise reliable long-task counts unless they are caveated

#### Scenario: Performance text accounts for background tabs

- **WHEN** the methodology reads paint metrics (fp/fcp/lcp) via `/perf` on an agent-created background tab
- **THEN** it reflects that these metrics require the tab to have rendered (foregrounded) or to be sampled with `activate=true`, rather than presenting a `null` paint metric as a page problem
