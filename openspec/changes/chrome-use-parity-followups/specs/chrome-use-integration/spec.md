## MODIFIED Requirements

### Requirement: Performance Metrics Endpoint

The chrome-use proxy SHALL expose a `/perf` endpoint that returns page performance metrics (LCP, FCP, CLS, resource timing, and long tasks) for a target tab, providing parity with the browse daemon `perf` command. It SHALL read LCP from a buffered `PerformanceObserver` (not `getEntriesByType`, which is spec-empty for LCP), SHALL always report the tab's `visibility` state, and SHALL support an opt-in parameter to briefly foreground a background tab so paint metrics can be sampled.

#### Scenario: Perf endpoint returns core web vitals and timing

- **WHEN** `/perf` is requested for a loaded target tab
- **THEN** the response includes paint/layout metrics (such as LCP, FCP, CLS), resource timing, and long-task information

#### Scenario: LCP is read from a buffered observer

- **WHEN** `/perf` is requested for a target tab that has rendered at least once (was foregrounded at some point)
- **THEN** LCP is obtained via a buffered `PerformanceObserver` for `largest-contentful-paint` so a previously-recorded LCP is returned rather than `null`

#### Scenario: Background tab reports visibility and honest nulls

- **WHEN** `/perf` is requested for a background tab that has never rendered and `activate` is not set
- **THEN** the response includes a `visibility` field reflecting the tab's visibility state
- **AND** paint metrics that are physically absent are returned as `null` with an accompanying note explaining that a background tab was not rendered and that `activate=true` can force a foreground sample

#### Scenario: Opt-in activate foregrounds the tab to sample paint

- **WHEN** `/perf` is requested with `activate=true`
- **THEN** the proxy foregrounds the target tab (via `Target.activateTarget`), waits briefly for paint/LCP to occur, and then samples the metrics
- **AND** when `activate` is absent or false the proxy does not change tab focus

## ADDED Requirements

### Requirement: JS Eval Endpoint Supports Top-Level Await

The chrome-use proxy `/eval` endpoint SHALL evaluate its JS body with REPL semantics so that a bare top-level `await` expression works without an explicit async IIFE wrapper, matching the behavior documented in `cdp-api.md`.

#### Scenario: Bare top-level await evaluates successfully

- **WHEN** `/eval` is posted a body containing a bare top-level `await` expression (for example `await fetch('/api').then(r => r.status)`)
- **THEN** the expression evaluates and returns `{ value }` rather than an `Uncaught SyntaxError`

#### Scenario: Documentation matches implementation

- **WHEN** the `/eval` reference in `cdp-api.md` states that `await` is supported
- **THEN** the shipped `/eval` implementation accepts bare top-level `await` (enabled via `replMode`), so the doc and implementation agree
