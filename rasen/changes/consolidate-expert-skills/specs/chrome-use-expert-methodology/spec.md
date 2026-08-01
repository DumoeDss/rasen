## MODIFIED Requirements

### Requirement: Browser-Driving Experts Use chrome-use Endpoints

The generated browser-driving expert skills (`qa`, design review, design consultation, benchmark, and office-hours) SHALL instruct the reader to drive the vendored chrome-use CDP proxy through its HTTP endpoints at `localhost:3456`, and SHALL NOT instruct the reader to invoke the retired `browse` binary. The single `rasen-qa` skill SHALL preserve this browser contract in default, dispatched, and explicit report-only/non-UI modes.

#### Scenario: Unified QA methodology drives chrome-use

- **WHEN** `rasen-qa` is generated
- **THEN** every QA mode's browser steps SHALL use `curl localhost:3456/...` endpoint calls and contain no `$B` browse-binary invocation
- **AND** report-only/non-UI mode SHALL remain browser-based rather than being replaced by source-only review

#### Scenario: Design and benchmark experts drive chrome-use

- **WHEN** design-review, design-consultation, benchmark, or office-hours is generated
- **THEN** its browser steps SHALL use chrome-use curl endpoints and contain no `$B` browse-binary invocation

### Requirement: curl Examples Bypass a Configured HTTP Proxy

The chrome-use curl examples in shared expert blocks and the self-contained chrome-use skill SHALL pass `--noproxy '*'` or an equivalent so calls to `localhost:3456` are not hijacked by machine-level proxy settings. The setup guidance SHALL explain the reason. This requirement SHALL apply to every mode of the unified QA skill.

#### Scenario: Live curl examples opt out of the proxy

- **WHEN** a browser-driving expert skill (`qa`, design-review, design-consultation, benchmark, or office-hours) is generated
- **THEN** each live curl example that calls `localhost:3456` SHALL bypass configured HTTP(S) proxies
- **AND** the result SHALL be the same for QA's default and report-only/non-UI paths

#### Scenario: Setup explains the proxy caveat

- **WHEN** an expert skill's setup block is generated
- **THEN** it SHALL note that configured HTTP(S) proxies can hijack localhost calls and explain the bypass flag

### Requirement: Command Guide Points to chrome-use

The navigator reference bundled with `rasen-help` and other prose-only routing references SHALL describe `rasen-chrome-use` as the browser-driving expert instead of browse. The router SHALL not require a standalone navigator identity.

#### Scenario: Help navigator reference lists chrome-use

- **WHEN** the installed `rasen-help` navigator reference is inspected
- **THEN** its browser-related guidance SHALL describe `rasen-chrome-use` as CDP-driven real Chrome
- **AND** SHALL not present browse as the browser tool
