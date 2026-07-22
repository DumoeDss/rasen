## Why

The installable workflow library (`rasen workflow` — list, show, which, init, validate, import, export, delete) has no web UI at all: the entire group is absent from the management surface, so inspecting what is installed, importing a package, or retiring an unused workflow all require returning to a terminal. This is the W4 workstream of the ratified UI config & library redesign (`rasen/office-hours/ui-config-and-library-redesign.md`), which chose pure library management for this page (Fork 4): a workflow definition carries no model or handoff field, so the page manages the library and nothing else.

## What Changes

- **New Workflows page** at a space-agnostic `/workflows` route (the library is user-wide, like the Spaces page): every catalog unit rendered as cards grouped by provenance (built-in / user, plus invalid user entries), showing id, kind (task / driver / expert / internal), source, skill name, digest, and the unused marker that `rasen workflow list --unused` already computes. Dependency slots are shown in the per-workflow detail view rather than on the card, because the listing endpoint mirrors `workflow list --json`, which carries no dependency data. A header navigation entry reaches the page from anywhere.
- **Detail view** per workflow mirroring `workflow show`: full definition (skill, command, requires, recommends, files) plus known usage referrers.
- **Library actions from the UI**: init (scaffold a draft into a chosen directory), validate (an installed id, a draft directory, or a `.rasenpkg`), import (a directory or `.rasenpkg` picked via the existing local-path browser), export (to a chosen destination, with explicit overwrite), delete (user workflows only, with confirmation; referrer-guard refusals surface the CLI's message verbatim and offer force). Built-in entries are locked against deletion in the UI and the CLI refuses regardless.
- **New management endpoints**: read endpoints for listing, detail, and validation computed in-process from fresh catalog reads; one mutation endpoint whose four operations (import, init, export, delete) each spawn the existing CLI as a subprocess — the server itself writes nothing, extending the change-submission admission whitelist's bounded-CLI tier from four operations to eight.
- **No per-workflow model or handoff controls** — rejected in the ratified design (Fork 4B); those concerns belong to the Pipelines page (W3), bound to stages.
- `workflow` and `pipeline` remain distinct concepts; no CLI behavior changes.

## Capabilities

### New Capabilities
- `workflow-http-api`: Management endpoints for the workflow library — GET listing (with unused markers and invalid entries), GET detail (definition + usage), GET validation (id or absolute path), and a POST mutation bridge whose import/init/export/delete operations are admitted through the shared whitelist and performed exclusively by a spawned CLI subprocess.
- `workflows-ui`: The `/workflows` page — space-agnostic route, header navigation entry, provenance-grouped card listing with kind/source/digest/dependency/unused display, detail view, and the init/validate/import/export/delete flows with built-in lock and verbatim CLI error surfacing.

### Modified Capabilities
- `management-http-api`: The "every mutating endpoint mutates by spawning the CLI" requirement's enumeration gains `POST /api/v1/workflows`; a new requirement places the workflows paths (listing, detail, validation, mutation) under the same loopback/bearer/fresh-read security posture. **Drafted against the pending `ui-config-redesign-spaces-page` (W6) delta's ADDED text — W6 must archive first.**
- `change-submission`: The bounded-CLI tier's exact enumeration grows from four operations to eight (adding import-workflow, init-workflow, export-workflow, delete-workflow), keeping the eligibility criteria and per-endpoint own-operation admission unchanged. **Also drafted against W6's ADDED text — W6 must archive first.**

## Impact

- **Server**: new `src/core/management-api/workflows.ts` (reads + validation) and a workflow mutation submitter mirroring `submit.ts` (cap-1 concurrency, timeout, argv-array + `shell: false`, absolute-path guards); `whitelist.ts` gains four bounded-cli rows; `router.ts` registers the new paths; `wire-types.ts` gains the workflow shapes. Reads reuse `loadWorkflowCatalog` / `scanWorkflowUsage` / `validateWorkflowInput` from `src/core/workflow-library.ts` — no changes to the library core or the CLI.
- **UI**: new `WorkflowsPage` (+ detail and action dialogs) in `packages/ui/src/components/`, route registrations in `app.tsx`, a navigation entry in `Layout.tsx` (explicit LEAD merge point with W3's Pipelines entry), API client methods and wire-type mirrors in `packages/ui/src/api/`. Visual style is frozen — existing warm-editorial card/list idioms only.
- **Specs**: 2 new capability specs, 2 delta specs stacked on W6's pending deltas (archive-order dependency: W6 before W4).
- **Tests**: management-api endpoint tests (list/detail/validation/mutation admission, injection guards, built-in delete refusal passthrough) and UI component tests, following existing patterns.
- Not touched: workflow-library spec (no CLI/catalog contract change), config-ui-package spec (per the W6 precedent, sibling routes extend the shell via their own capability specs), version numbers.
