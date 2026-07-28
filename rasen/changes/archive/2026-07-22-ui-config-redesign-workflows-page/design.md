## Context

W4 of the ratified `rasen/office-hours/ui-config-and-library-redesign.md`. The workflow library is user-wide: `loadWorkflowCatalog()` (`src/core/workflow-registry/`) reads built-ins plus the user library with no space dependency; usage scanning (`createWorkflowUsageContext`, `src/core/workflow-library.ts:425`) reads global config, profiles, dependency edges, pipeline stage references, and — only when given a `projectRoot` — the project artifact ledger. The CLI surface to mirror is `src/commands/workflow-library.ts`: `list` (`--unused`, `--all`, `--json`), `show`, `which`, `init --output`, `validate`, `import`, `export --force`, `delete --yes --force`. Every subcommand has `--json`; `delete` requires `--yes` non-interactively; `export` fails `destination_exists` without `--force` non-interactively.

Sibling context that binds this design:
- W6 (`ui-config-redesign-spaces-page`, pending) establishes: the bounded-CLI whitelist tier as an exact enumeration (four ops), the general "every mutating endpoint spawns the CLI" rule, `GET /api/v1/local-paths` (lists directories AND files, absolute-path-only escape above home), and the `/spaces` precedent of a space-agnostic route added via its own capability spec without deltaing `config-ui-package`'s shell requirement.
- The change-submission bridge pattern (`src/core/management-api/submit.ts`): resolve the server's own `dist/cli/index.js`, spawn with argv array + `shell: false`, cap-1 in-flight per bridge, SIGTERM→SIGKILL timeout, parse `--json` stdout, pass CLI errors through verbatim (422), cwd never client free text.
- Visual style is frozen; warm-editorial + CRT variant untouched. Reference projects are never named.

## Goals / Non-Goals

**Goals:**
- A `/workflows` page giving the library a complete management surface: inspect (list, detail, provenance, kind, digest, dependencies, unused, invalid), grow (init draft, validate, import), share (export), retire (delete).
- Server mutations exclusively via spawned CLI subprocesses, admitted through the shared whitelist table.
- Read endpoints computed in-process from fresh reads, mirroring `workflow list --json` / `workflow show --json` payloads so the UI never diverges from CLI truth.

**Non-Goals:**
- No per-workflow model/handoff/gate controls (Fork 4B rejected — those bind to pipeline stages, W3).
- No CLI or workflow-library core changes; no new listing semantics (the unused marker is exactly what `workflow list` computes).
- No file upload/download: import sources and export destinations are server-local paths picked via the existing local-path browser.
- No space addressing on workflow endpoints (see D2).
- No `which` UI action (its content — source path, digest — is already on the card/detail).

## Decisions

**D1 — Route and navigation: space-agnostic `/workflows`, following the `/spaces` precedent.**
The library is machine-wide; a space-prefixed route would render identical data under every space and falsely imply per-space scoping. `/workflows` carries no space prefix, and the header gains a `Workflows` navigation entry rendered regardless of whether a space is resolved (unlike the space-scoped Board/Archive/Config group). `Layout.tsx` is an explicit LEAD merge point with W3's future Pipelines entry. Alternative rejected: space-prefixed routes (`/p/:id/workflows`) — pipelines genuinely have a project layer and may warrant that in W3; workflows do not.

**D2 — No space selector on workflow endpoints; project-context referents resolve from the launch project.**
Mutation subprocesses run with cwd = the server's launch project root (falling back to the server cwd outside a project), exactly as change submission does without a `space` selector. Consequence, accepted and documented: an import whose `requires.pipelines`/`requires.schemas` referent exists only in some *other* project's layer may be refused by validation — the CLI run from that project is the escape hatch. Alternative rejected: accepting `?space=` to re-root referent resolution — it adds addressing surface the ratified design never asked for, for an edge case with a CLI escape.

**D3 — Endpoint shapes.**
- `GET /api/v1/workflows` — fresh in-process read; payload mirrors `workflow list --json`: `{ workflows: [...], invalid: [...], diagnostics: [...] }` with each entry carrying `id, source, sourcePath, digest, kind, skillName, commandId, unused`. The unused marker uses the same machine-level usage context `list` uses (no projectRoot), so UI and CLI agree.
- `GET /api/v1/workflows/<id>` — one path segment deep (matching the `/api/v1/tasks/<id>` matcher pattern); payload mirrors `workflow show --json`: `{ workflow: workflowDefinitionForJson(...), usage: [...] }`. Unknown id → 404.
- `GET /api/v1/workflow-validation?target=<id-or-absolute-path>` — read-only in-process `validateWorkflowInput`, mirroring `workflow validate --json`'s `{ validation }`. A separate top-level path rather than a `/workflows/...` subpath so a user workflow named `validate` can never collide. GET because it mutates nothing — keeping "POST implies mutation" clean.
- `POST /api/v1/workflows` — the single mutation bridge, discriminated by `op`: `{ op: 'import', path }`, `{ op: 'init', id, output }`, `{ op: 'export', id, path, force? }`, `{ op: 'delete', id, force? }`. One collection POST with a body discriminator follows the `POST /api/v1/spaces` `{ kind, ... }` idiom and avoids admitting new HTTP methods (management-http-api 405s PUT/DELETE — unchanged).

**D4 — Whitelist rows and argv construction.**
Four new bounded-cli rows: `import-workflow`, `init-workflow`, `export-workflow`, `delete-workflow` (tier count 4 → 8). Each op maps to a fixed argv template over the server's own CLI entry, `shell: false`:
- `workflow import <path> --json`
- `workflow init <id> --output <output> --json`
- `workflow export <id> <path> --json` (+ `--force` iff `force: true`)
- `workflow delete <id> --yes --json` (+ `--force` iff `force: true`) — `--yes` is always passed; confirmation is the UI dialog's job, mirroring how the bounded tier already treats non-interactive CLI runs.
Injection guards: every client-supplied filesystem path must be absolute (400 otherwise — same rule as `local-paths` and W6's space creation, and it doubles as the option-injection guard since an absolute path cannot begin with `-`); `id` must satisfy a conservative identifier pattern (the same character class workflow ids already use — letters, digits, `-`, `_`, rejecting anything starting with `-`) before it is placed in argv. All values are single argv tokens. Bridge mechanics copy `submit.ts`: cap-1 in-flight, 60s timeout (imports copy file trees; change submission's 30s is tight), SIGTERM→SIGKILL, exit-0 + parsed `--json` stdout → 200/201, non-zero → 422 with the CLI's own message verbatim (`status[0].message` from the `--json` failure payload, else stderr). The eligibility criteria hold: all four terminate deterministically, are bounded, leave no resident process, and their results are observable through the read endpoints.

**D5 — UI structure: card groups by provenance, detail + four dialogs.**
`WorkflowsPage` renders three groups: **Built-in**, **User**, and (when present) **Invalid** — user entries whose records came from `catalog.invalid`, shown with their diagnostics. Cards carry the authored name/skill, id, kind chip, source, truncated digest, and the unused badge; built-in cards present no delete affordance (locked), and the CLI refuses `builtin_delete_forbidden` regardless — defense in both layers. Clicking a card opens the detail view (full definition incl. the four `requires` slots + `recommends`, plus usage referrers). Dependency slots live in the detail view, not on the card: the listing endpoint (D3) is frozen to mirror `workflow list --json`, which carries no dependency data, so the card cannot show a dependency summary without a per-card detail fetch. Actions:
- **New draft** (init): id input + output-directory pick via the local-path browser → on success, show the created draft path with a "validate, then import" hint.
- **Validate**: on an installed card, validates its id; standalone, validates a picked directory or `.rasenpkg`. Diagnostics render as-is.
- **Import**: pick a directory or `.rasenpkg` file (the local-paths listing already includes files); success shows imported/reused ids.
- **Export**: destination directory pick + filename (default `<id>.rasenpkg`); on `destination_exists`, offer overwrite → resend with `force`.
- **Delete**: confirmation dialog; on a referrer-guard refusal, show the CLI's message (which names referrers) verbatim and offer force-delete with a second explicit confirmation.
All flows follow the W6 rule: CLI failures surface verbatim; the browser never touches the filesystem itself. Existing card/list CSS idioms only — no new visual language.

**D6 — Spec surface: two new specs + two deltas stacked on W6.**
New `workflow-http-api` and `workflows-ui` capabilities own the new behavior. `management-http-api` and `change-submission` deltas REMOVE W6's pending ADDED requirements and re-ADD under renamed requirements (distinct-name guard), quoting W6's text as the base — **archive-order dependency: W6 archives before W4** (ship order already guarantees this; the LEAD controls order). `config-ui-package` is deliberately untouched (W6 precedent: sibling routes extend the shell through their own capability specs); `workflow-library` is untouched (no library contract change).

## Risks / Trade-offs

- [W6's deltas change during its review/implementation, orphaning W4's REMOVED text] → The deltas quote W6's ADDED requirement names exactly; the tasks include a pre-archive re-check against the archived W6 spec text. If W6's wording shifts, only the REMOVED blocks need repasting.
- [Import/export paths are server-local, which surprises a user thinking in browser terms] → The picker itself is server-rooted (home start), so every path the user can pick is by construction server-local; copy in the dialogs says "on this machine".
- [Deleting a workflow that a *project ledger elsewhere* references — machine-level unused marker can't see it] → Same exposure the CLI has from any cwd; the CLI already prints a project-consumer warning on delete, which the UI surfaces. Accepted (D2).
- [A second mutation while one is in flight] → cap-1 per bridge returns 409 `busy`, same as change submission; the UI disables action buttons while a request is pending.
- [Workflow id containing characters the argv guard rejects but the catalog accepted] → The guard's character class is checked in tasks against the manifest schema's actual id validation so the UI can never refuse an id the CLI accepts.

## Open Questions

- None blocking. (Whether W3's Pipelines page later wants a shared "library page" component is a W3 concern; nothing here forecloses it.)
