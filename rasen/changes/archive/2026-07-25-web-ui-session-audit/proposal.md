## Why

Session token audits are currently split from the Web UI into a standalone `viewer/audit.html`, so users must already know a session id, run a CLI command, and manually open a report before they can inspect spend. The Web UI can make that local-only workflow discoverable by listing recent sessions and saved reports while continuing to use the existing audit engine and report renderer.

## What Changes

- Add a global Audit page to the Web UI where users can browse recent Claude, Codex, and Zed sessions, run an audit, or import a transcript/database file.
- List valid reports already saved under the user's Rasen `analytics` directory, automatically select the newest report, and allow switching between saved results without regenerating them.
- Add authenticated localhost API endpoints for recent-session discovery, audit execution/import, saved-result metadata, and saved-result retrieval.
- Reuse the existing `runAudit` result contract and adapt the standalone viewer for same-origin embedding, while preserving its offline drag-and-drop and `--open` behavior.
- Give the visualization substantially more horizontal room: reduce the Audit page's outer margins, make the saved-results rail collapsible, and let the report pane reclaim that width while avoiding unnecessary horizontal scrolling.
- Bound and validate imported files, avoid accepting arbitrary server-side paths, and keep all discovery and report reads inside known machine-data/session roots.
- Show explicit loading, empty, unavailable-runtime, invalid-file, audit-failure, and retry states, with coverage across the server, API client, UI, and standalone viewer.

## Capabilities

### New Capabilities

- `session-audit-ui`: Covers the Web UI flow for recent-session selection, transcript/database import, saved-result browsing, report switching, and embedded report rendering.

### Modified Capabilities

- `management-http-api`: Adds authenticated local audit discovery, execution/import, report-listing, and report-detail contracts with bounded filesystem access.
- `management-ui-shell`: Adds the installation-wide Audit route and navigation entry without making audit data space-scoped.
- `cli-agent-audit`: Extends the shipped standalone viewer with a same-origin embed mode while preserving its existing self-contained offline contract.

## Impact

- Affected server areas: `src/core/management-api/`, token-audit discovery/orchestration helpers, and static viewer serving.
- Affected UI areas: `packages/ui/src/app.tsx`, global navigation, API client/types, the Audit page's responsive/collapsible master-detail layout, report-frame coordination, and shared styles.
- Affected viewer: `viewer/audit.html` gains a narrowly scoped embed/message bridge but keeps its current local file and `?src=` entry points.
- Tests expand in `test/core/config-api/`, `test/core/token-audit/`, `packages/ui/test/`, and viewer contract coverage. No new network service or external dependency is introduced.
