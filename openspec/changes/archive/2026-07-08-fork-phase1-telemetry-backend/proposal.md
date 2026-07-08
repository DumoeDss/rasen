## Why

Upstream OpenSpec sends anonymous usage telemetry to PostHog via a `edge.openspec.dev` reverse proxy (`src/telemetry/index.ts`) — infrastructure the fork does not control and cannot keep using. Phase 1 migrates telemetry to a maintainer-owned Cloudflare Worker backed by Analytics Engine. This change (batch B1) is the backend half: it must be deployed and verified *before* the client is rewritten (B2), so that B2 has a real, working endpoint URL to point at. It preserves the same privacy contract as upstream (anonymous, command+version only) on infrastructure the maintainer owns.

## What Changes

- **New `telemetry-backend/` project in this repo** (co-located, single-maintainer): a Cloudflare Worker that accepts `POST` of a small JSON event, validates it minimally, writes one Analytics Engine data point, and returns quickly (2xx) — designed to never block or leak.
- **Event payload contract**: `{ command, version, distinctId, os?, node_version? }`. The Worker rejects anything malformed with a 4xx and ignores/does not persist any unexpected fields. `distinctId` is the client's anonymous UUID.
- **Analytics Engine dataset** written via `writeDataPoint` — `blobs` carry command/version/os/node_version, `indexes` carries the anonymized distinctId for distinct-user counting; no IP, no request body echo, no paths/args/project info.
- **`wrangler.toml`** binding the Worker (`openspec-telemetry`) to the Analytics Engine dataset, using the authenticated account (`5cc51d8388c780c03fb4c6161bd403c4`).
- **Real deployment** via `wrangler deploy` (implementation task) plus **endpoint verification**: POST a synthetic event and expect 2xx, optionally observed via `wrangler tail`.
- **Maintainer doc** covering the CF SQL API query patterns for reading the dataset (DAU via `count()` + `count(DISTINCT distinctId)`, `GROUP BY` command/version), noting that SQL-API reads require a separate API token (documented, not a hard verification gate).
- **Hand-off seam to B2**: the deployed endpoint URL is recorded in this change's notes so the client rewrite consumes a known-good URL.

This change does NOT touch `src/telemetry/index.ts` — replacing `posthog-node` with a native fetch to this endpoint, keeping the opt-out logic and notice, is sibling change B2.

## Capabilities

### New Capabilities
- `telemetry-backend`: A maintainer-owned Cloudflare Worker + Analytics Engine ingestion endpoint that receives anonymous CLI usage events (command, version, anonymous UUID, optional os/node_version), enforces the privacy contract, persists them for aggregate analytics, and is queryable via the CF SQL API — replacing the upstream PostHog dependency.

### Modified Capabilities
<!-- None. The client-side src/telemetry rewrite is sibling change B2; it will MODIFY the client telemetry behavior, not this backend capability. -->

## Impact

- **New code/artifacts**: `telemetry-backend/` (Worker source, `wrangler.toml`, `package.json`, maintainer README) at the repo root.
- **Deployment**: a live Cloudflare Worker under account `5cc51d8388c780c03fb4c6161bd403c4`, plus a provisioned Analytics Engine dataset. This is external, outward-facing infrastructure created during implementation.
- **npm pack**: `telemetry-backend/` is at the repo root and NOT in package.json's `files` whitelist (`dist`, `bin`, `schemas`, `pipelines`, `scripts/postinstall.js`), so it is excluded from the published npm tarball by default — no per-file ignore needed. `fork-phase1-release-prep` (C) should confirm pack contents; seam noted, no action expected.
- **Dependencies**: no runtime dependency added to the CLI package; the Worker's own dev dependency is `wrangler` (already installed locally, 4.86.0). B2 later removes `posthog-node` from the CLI.
- **Seam to B2**: B2 consumes the deployed endpoint URL recorded in this change's ship-log/notes.
