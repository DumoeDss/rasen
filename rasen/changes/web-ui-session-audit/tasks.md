## 1. Audit discovery and saved-result core

- [x] 1.1 Add typed recent-session discovery for Claude main transcripts, Codex main/non-fork rollouts, and Zed root threads using the existing runtime path/database helpers, with newest-first global ordering, a hard result cap, and per-runtime fail-soft diagnostics.
- [x] 1.2 Add an exact `{runtime, sessionId}` resolver that re-finds a selected native session only inside its established runtime store and returns the correct `runAudit()` target/options without accepting a browser-provided source path.
- [x] 1.3 Add an analytics report repository resolved through `getGlobalDataDir()` and `path.join()` that lists direct regular `.json` files, validates supported report shapes, returns newest-first descriptors/skipped counts, and reads detail by an exact safe basename.
- [ ] 1.4 Cover discovery and report-repository behavior with temporary Claude/Codex/Zed/global-data fixtures, including missing stores, malformed reports, symlinks, traversal, duplicate ids, native separators, and Windows case/path behavior. (Claude duplicate resolution and direct symlinks are covered; a deterministic symlink-swap harness and explicit Codex duplicate fixture remain.)

## 2. Audit execution and import service

- [x] 2.1 Add an audit execution boundary that invokes the existing `runAudit()` implementation off the management server's request loop and returns a normalized saved-report detail/error while preserving transcript-format-drift messaging.
- [x] 2.2 Add a per-server single-flight audit coordinator that rejects overlapping execution/import with retryable `audit_busy` while leaving list/detail reads available.
- [x] 2.3 Implement streamed raw-file import with the 256 MiB cap, sanitized basename/type detection, server-generated temporary paths under Rasen machine data, and unconditional cleanup on success, stream failure, parse failure, or cancellation.
- [x] 2.4 Route `.jsonl`/`.db`/`.sqlite` uploads through `runAudit()`, validate supported audit-report `.json` uploads for collision-safe persistence without re-analysis, and reject unsupported/malformed types without creating analytics output.
- [x] 2.5 Test the worker/coordinator/import service for every supported type, full-family native versus single-file import behavior, oversize/declared-size rejection, cleanup, collision-safe report names, busy overlap, and cross-platform paths.

## 3. Authenticated management API and client contracts

- [x] 3.1 Define server wire types and handlers for audit session discovery, saved list/detail, native execution, and raw import responses using the standard error envelope.
- [x] 3.2 Register exact `/api/v1/audits`, `/api/v1/audits/sessions`, `/api/v1/audits/import`, and one-segment report-detail routes with one-trailing-slash tolerance, bearer authentication, admitted methods, and non-matching deeper suffixes.
- [x] 3.3 Extend the Preact API types/client seam with list/discover/detail/run/import calls, including a raw `File` request path that still applies the launch bearer token and central unauthorized/error handling.
- [x] 3.4 Add router/server tests for successful methods, 401/405/404/409/413 envelopes, malformed JSON, invalid runtime/id, path-field rejection, exact-depth matching, symlink/traversal denial, and daemon identity headers on audit responses.

## 4. Shared viewer embedding

- [x] 4.1 Extend `viewer/audit.html` with explicit `?embed=1` chrome hiding, parent-ready/error messages, schema validation, exact same-origin/direct-parent checks, report/theme messages, and dispatch into the existing Claude/Codex/Zed `render()` path.
- [x] 4.2 Expose the shipped viewer HTML at a fixed management-server asset URL without putting a report path or bearer token in the URL, and ensure development and packaged UI launches resolve the same asset.
- [ ] 4.3 Add viewer/static-serving tests proving same-origin embed rendering and cross-origin rejection while retaining offline file drop, `?src=`, older-report tolerance, theme behavior, and `rasen agent audit --open`. (Static contracts, sandbox isolation, server serving, and CLI regressions are covered; real-browser viewer execution remains.)

## 5. Audit page and shell integration

- [x] 5.1 Add the global `/audit` route and active Audit navigation entry while preserving recent-space fallback access to space-scoped pages and avoiding space/config writes.
- [x] 5.2 Build the Audit page's saved-result master list with newest default selection, skipped-entry notice, empty/loading/error/retry states, and stale-detail-response protection when switching quickly.
- [x] 5.3 Build recent-session selection with runtime labels/metadata, unavailable-runtime disclosures, analyze controls, in-flight disabling, failure preservation, and post-success list refresh/selection.
- [x] 5.4 Add file picker/drop import for supported source/report types, upload progress/busy copy, the single-transcript family limitation disclosure, specific recoverable errors, and post-success refresh/selection.
- [x] 5.5 Add the report iframe controller that waits for viewer readiness, sends only the current validated report through the same-origin channel, forwards theme changes, handles viewer errors, and never places tokens/report paths in its URL.
- [x] 5.6 Add responsive Audit page styles that fit the existing component system and keep saved results, actions, loading/error states, and the embedded visualization usable at narrow and wide widths.
- [x] 5.7 Widen the Audit page container and implement the responsive saved-results disclosure: desktop-expanded/narrow-collapsed initial state, reclaimed report width when collapsed, full-width narrow expansion, `min-width: 0`/iframe sizing that avoids unnecessary page-level horizontal scrolling, and a focus-preserving native toggle with state-specific label plus `aria-expanded`/`aria-controls`.

## 6. UI, integration, and cross-platform verification

- [x] 6.1 Add API-client tests for bearer-authenticated JSON and raw-file audit requests, response narrowing, standard errors, and unauthorized transitions.
- [ ] 6.2 Add component tests for newest selection, saved-result switching without rerun, partial discovery failure, native analysis success/failure, report/source import, busy/loading states, retry, stale-response suppression, iframe readiness, theme sync, and existing-report preservation. (Core selection, stale response, native failure/success, import busy flow, iframe readiness, and preservation are covered; explicit theme/error/retry branches remain.)
- [ ] 6.3 Add integration fixtures for Claude, enriched/older Codex, and Zed reports and verify the Web UI and standalone viewer render each runtime through the same viewer dispatch. (Runtime fixtures and source dispatch contracts exist; real-browser shared-renderer execution remains.)
- [x] 6.4 Run the focused token-audit, management-router/server, CLI audit, and UI test suites; build the UI package; then run TypeScript/lint checks required by the repository.
- [x] 6.5 Verify path/import/list/detail behavior on Windows CI plus the existing non-Windows CI matrix, using `path.join()`/`path.resolve()` expectations and no hardcoded home or separator assumptions.
- [x] 6.6 Add focused Audit layout/component coverage for collapse/expand state, report-width reclamation, desktop and narrow initial states, keyboard/ARIA semantics, selection preservation, and absence of page-level horizontal overflow at representative desktop widths.
