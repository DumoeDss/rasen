## Why

Child 1 (`unified-config-layer`) unified Rasen's configuration behind a CLI: a config-key registry, project-scope read/write, and `resolveEffectiveConfig()` with per-key source metadata. That surface is CLI-only. The portfolio's goal is a web configuration page (and, beyond it, a management platform) for users who prefer a visual entry point — which requires the config layer to be reachable over HTTP from a local browser. This change adds the in-CLI localhost HTTP JSON API over the existing in-process modules and the `rasen config ui` command that serves it, so the optional UI package (child 3) has a complete, documented backend to build against. CLI-only users lose nothing: the server runs only when explicitly started.

## What Changes

- A localhost HTTP JSON API embedded in the CLI (Node's built-in `http`, no new dependencies), exposing the unified config layer:
  - list all registered keys with definition metadata, effective value, source (`default` | `global` | `project` | `env-override`), and raw per-scope values — the JSON shape of `EffectiveConfigEntry[]`;
  - get one key; set/unset a key with an explicit scope, validated through the config-key registry for BOTH scopes before any write (closing the zod/registry parity gap for global writes);
  - project addressing: requests may name a registered project (by project id or root path, resolved via the machine project registry); omitted means the server's launch project (if any).
- Security proportionate to a local single-user tool: the server binds to `127.0.0.1` only, on an ephemeral port by default; every mutating request must carry a per-session bearer token that the CLI generates at startup and injects into the served page — plus same-origin/no-CORS defaults so random web pages cannot drive the API.
- `rasen config ui`: starts the server, resolves the optional UI package (installed alongside the CLI) and serves its static assets at `/`; when the package is absent, still starts the API but prints a clear install hint instead of a broken page; opens the default browser (`--no-open` opts out); `--port` for a fixed port; clean shutdown on Ctrl+C and idle-safe process exit — the server must never leave the CLI hanging on open sockets (repo history: undici keep-alive once hung CLI exit ~10 s).
- The API contract is documented in the design doc as the foundation the future management platform extends — the envelope, error shape, auth, and project addressing outlive the config page.

## Capabilities

### New Capabilities
- `config-http-api`: the localhost HTTP JSON API — endpoints, request/response envelope, scope-explicit validated writes, project addressing, loopback bind, and token guard.
- `config-ui-command`: the `rasen config ui` command — server lifecycle, optional UI package resolution and static serving, browser opening, install hint, and clean shutdown.

### Modified Capabilities

(none — the API and command are purely additive; no existing requirement's behavior changes. `cli-config`'s subcommand list is already being reshaped by the in-flight `unified-config-layer` delta, and `rasen config ui` is specified wholly within `config-ui-command` to avoid stacking two deltas on the same requirement.)

## Impact

- **Code**: new `src/core/config-api/` (or `src/api/config/`) module — HTTP server, route handlers wrapping `resolveEffectiveConfig()` / `updateProjectConfigKey()` / `saveGlobalConfig()` + registry validation, UI-package resolution; `src/commands/config.ts` gains the `ui` subcommand; `src/cli/index.ts` registration untouched beyond that.
- **APIs**: a versioned HTTP contract (`/api/v1/...`) consumed by child 3's typed client; documented in design.md.
- **Dependencies**: none added — Node built-in `http`; browser opening via platform `open`/`start`/`xdg-open` spawn (no `open` npm package).
- **Systems**: no telemetry changes, no persistent daemon — the server lives only for the duration of `rasen config ui`.
- **Compatibility**: purely additive; no existing command behavior changes; no version bump (version read from package.json where surfaced).
