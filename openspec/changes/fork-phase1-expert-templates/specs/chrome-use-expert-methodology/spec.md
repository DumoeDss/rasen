## ADDED Requirements

### Requirement: Browser-Driving Experts Use chrome-use Endpoints

The generated browser-driving expert skills (QA, QA-only, design review, design consultation, benchmark, office-hours) SHALL instruct the reader to drive the vendored chrome-use CDP proxy via its HTTP curl endpoints at `localhost:3456`, and SHALL NOT instruct the reader to invoke the `browse` binary (`$B` commands).

#### Scenario: QA methodology drives chrome-use

- **WHEN** the QA or QA-only expert skill is generated
- **THEN** its browser steps use `curl localhost:3456/...` endpoint calls and contain no `$B` browse-binary invocations

#### Scenario: Design and benchmark experts drive chrome-use

- **WHEN** the design-review, design-consultation, benchmark, or office-hours expert skill is generated
- **THEN** its browser steps use chrome-use curl endpoints and contain no `$B` browse-binary invocations

### Requirement: chrome-use SETUP and Tab Lifecycle

The shared SETUP block used by browser-driving experts SHALL instruct the reader to verify prerequisites via `check-deps.mjs` and to obtain and reuse a `targetId` for a background tab, replacing the browse-binary path probe.

#### Scenario: SETUP checks dependencies and gets a tab

- **WHEN** an expert skill's SETUP block is generated
- **THEN** it instructs running `check-deps.mjs` and obtaining a `targetId` (for example via `/new`), and reusing that `targetId` across subsequent endpoint calls

#### Scenario: Tabs are opened and closed cleanly

- **WHEN** the methodology opens a tab for a task
- **THEN** it uses a `targetId`-scoped background tab and closes it when done, consistent with the sticky-proxy conventions

### Requirement: Endpoint Reference Consistency

The chrome-use endpoint reference and flag tables in the shared blocks SHALL name endpoints and parameters exactly as implemented by the shipped proxy and documented in `skills/experts/chrome-use/references/cdp-api.md`, including `/snapshot` (with `mode=i|C|D`), `/perf`, `/viewport`, and `/responsive`.

#### Scenario: Referenced endpoints exist in the proxy

- **WHEN** the shared endpoint reference lists an endpoint or parameter
- **THEN** that endpoint and parameter are provided by the vendored `cdp-proxy.mjs` and match the names in `cdp-api.md`

#### Scenario: Snapshot modes map to browse semantics

- **WHEN** the methodology needs an interactive snapshot, a cursor-interactive snapshot, or a diff
- **THEN** it uses `/snapshot?mode=i`, `/snapshot?mode=C`, or `/snapshot?mode=D` respectively

### Requirement: Responsive and Performance Coverage Preserved

The methodology blocks SHALL preserve responsive-audit and performance coverage using the chrome-use endpoints, and SHALL NOT claim performance metrics the proxy does not reliably provide.

#### Scenario: Responsive audit uses emulation endpoints

- **WHEN** the methodology performs a responsive or multi-viewport audit
- **THEN** it uses `/viewport` and/or `/responsive` rather than the removed browse `viewport`/`responsive` commands

#### Scenario: Performance text does not overpromise

- **WHEN** the methodology references page performance metrics via `/perf`
- **THEN** it describes the metrics the endpoint provides (such as LCP, FCP, CLS, resource timing) and does not promise reliable long-task counts unless they are caveated

### Requirement: Command Guide Points to chrome-use

The navigator command guide and other prose-only references SHALL describe chrome-use as the browser-driving expert instead of browse.

#### Scenario: Navigator lists chrome-use

- **WHEN** the navigator skill is generated
- **THEN** its browser-related command guidance describes chrome-use (CDP-driven real Chrome) and does not present browse as the browser tool

### Requirement: browse Template Frozen for Clean Removal

The `browse` expert template SHALL remain build-valid and byte-identical in generated output after the shared blocks are rewritten, by being decoupled from the rewritten shared blocks, so it can be deleted wholesale by the browse-removal change without further edits.

#### Scenario: browse output is unchanged

- **WHEN** the `browse` skill is generated after the shared blocks are rewritten for chrome-use
- **THEN** its generated content is identical to before this change (its parity hashes are unchanged)

#### Scenario: Build compiles with browse decoupled

- **WHEN** the project is built after the shared blocks are rewritten
- **THEN** `browse.ts` compiles without importing the rewritten chrome-use shared blocks
