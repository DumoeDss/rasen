## ADDED Requirements

### Requirement: The standalone viewer supports a same-origin embedded mode

The shipped audit viewer SHALL support an explicit embedded mode that reuses its existing runtime-aware renderer inside the Rasen Web UI. In embedded mode it SHALL hide standalone file-loading chrome, signal readiness to its parent, accept report data only from its same-origin parent window, validate the audit schema before rendering, and report a structured load error back to that parent. The report payload, bearer token, and local report path SHALL NOT be required in the iframe URL.

#### Scenario: Same-origin parent renders a report
- **WHEN** the viewer is served over HTTP(S) with embedded mode enabled and its same-origin parent sends a supported audit report after readiness
- **THEN** the viewer renders it through the same Claude/Codex/Zed dispatch used by standalone file loading

#### Scenario: Cross-origin message is ignored
- **WHEN** a different origin or a window other than the direct parent sends report data
- **THEN** the viewer ignores the message and renders no supplied report

#### Scenario: Invalid embedded report is reported
- **WHEN** the same-origin parent sends data without a supported `rasen-token-audit/` schema
- **THEN** the viewer does not render it and sends a structured validation error to the parent

### Requirement: Embedded mode preserves every standalone viewer entry point

Adding embedded mode SHALL preserve direct offline opening, drag-and-drop/file-picker loading, `?src=` auto-loading, runtime-specific rendering, theme behavior, and the CLI's `--open` flow. A viewer not explicitly opened in embedded mode SHALL keep its existing standalone chrome and behavior.

#### Scenario: Offline file drop remains available
- **WHEN** the user opens the viewer directly as a local file without embedded mode
- **THEN** the existing report picker/drop target and runtime-aware rendering remain available without a network connection

#### Scenario: CLI open remains compatible
- **WHEN** `rasen agent audit <session> --open` opens the viewer with a generated report
- **THEN** the report loads and renders as before, without requiring a parent window or Web UI

#### Scenario: Standalone mode does not accept embed-only control
- **WHEN** the viewer is opened as a standalone `file://` page
- **THEN** same-origin embed messaging is not used to bypass its normal local file/`?src=` loading paths
