## Context

PR #26 (skills-only delivery) retired the command surface. The backend is already clean: `handleWorkflowsList` (src/core/management-api/workflows.ts:41) builds entries without `commandId`, and `workflowDefinitionForJson` (src/core/workflow-library.ts:593) emits no `command` field — both mirror the CLI's `workflow list --json` / `workflow show --json`, which are equally clean. What remains is dead presentation and dead type declarations downstream:

- `src/core/management-api/wire-types.ts:421` — `WorkflowDefinitionWire.command` declares a field no emitter produces.
- `packages/ui/src/api/types.ts:603,632` — the hand-maintained mirror still declares `WorkflowListEntry.commandId` and `WorkflowDefinitionWire.command`, so the "field-for-field mirror" discipline is currently violated.
- `packages/ui/src/components/WorkflowsPage.tsx:214` — a `commandId` badge that can never render; `:310` — a detail row that always shows "Command: none".
- `packages/ui/src/style.css:807` — `.workflow-card__command` selector.
- `packages/ui/src/config/labels.ts:11` — `delivery: 'Command delivery'` labels a retired config key the registry never serves (`RETIRED_CONFIG_KEYS` in src/core/config-keys.ts:85; config-key-registry spec: "Retired delivery key is absent in every scope").
- `packages/ui/test/fixtures/workflows.ts` — fixtures pin the stale mirror shapes via `satisfies`.

The Workflows page also still groups by provenance (Built-in / User sections, `WorkflowGroup` in WorkflowsPage.tsx) with the category as a per-card `kind` chip. The CLI's human listing already moved to category grouping (task / driver / expert headings, internal behind `--all` — src/commands/workflow-library.ts:107-120). The user wants the page sectioned by category: driver (expandable to reveal internal), task, expert.

Not a remnant: `TelemetryDisclosure.tsx`'s "command" payload key documents the live CLI command-name telemetry field (`trackCommand` in src/telemetry/index.ts) and must stay.

Sibling change `worktree-aware-spaces` owns SpacesPage / space registry / `handleSpaces`; this change does not touch those files.

## Goals / Non-Goals

**Goals:**

- Zero retired-command remnants in the web UI and its wire-type mirrors; the UI mirror is field-for-field identical to the server's wire types again.
- Workflows page sectioned by category — driver (with collapsed-by-default internal subsection), task, expert — with provenance still visible per card.
- Specs (`workflows-ui`, `workflow-http-api`) match the code after the change.

**Non-Goals:**

- No change to any HTTP payload byte on the wire (emitters are already clean; only dead declarations go).
- No CLI delivery-machinery changes (PR #26's territory, done).
- No touch of SpacesPage / space registry / `handleSpaces` (sibling change).
- No new visual language — reuse the existing `workflows-group` / card idioms.
- The retired-key migrate-on-read machinery and the `command_field_ignored` validator warning stay as they are.

## Decisions

**D1 — Sections replace provenance grouping; provenance moves entirely onto the card.** The page renders three category sections in the user-specified order driver, task, expert (note: the CLI human listing orders task first; the UI follows the user's stated order — drivers are the primary units one launches). Each card keeps its existing `workflow-card__source` badge ("built-in"/"user") and the built-in lock marker, so provenance remains distinguishable at a glance without its own section. The per-card kind chip (`workflow-card__kind`) is removed — the enclosing section states it. Alternative considered: nesting kind sections inside Built-in/User sections — rejected as double-nesting that fragments small groups into up to eight lists.

**D2 — Internal workflows live inside the driver section behind a disclosure, collapsed by default.** A "Show internal (N)" toggle at the end of the driver section reveals internal-kind cards; internal units are driver plumbing (dependencies pulled in by drivers), matching the CLI's `--all` gating of the same group. Empty-state rule: a category section with no entries is omitted entirely (same as today's `WorkflowGroup` returning null), and the internal toggle is omitted when there are no internal workflows. The toggle is plain component state (`useState`), not persisted.

**D3 — Per-card actions derive from the entry, not the group.** Today `onExport`/`onDelete` are passed per provenance group. With mixed provenance inside one category section, the card decides from `entry.source === 'user'` whether to render export/delete. The Invalid section is unchanged.

**D4 — Dead fields are deleted at every layer that declares them, and only those.** `command` leaves `src/core/management-api/wire-types.ts` (server-side declaration), `commandId`/`command` leave `packages/ui/src/api/types.ts` (mirror), the fixtures drop them, and the two render sites disappear. The `satisfies` fixtures then re-pin the corrected mirror — `tsc` fails if any layer is missed, which is the existing drift-tripwire discipline. Alternative considered: leaving the server wire type and only fixing the UI — rejected; the wire type documents the contract and currently documents a lie.

**D5 — The `delivery` label entry is removed rather than renamed.** The config registry never serves the retired key (config-key-registry spec), so the label is unreachable; `labelFor`'s dot-path fallback covers any hypothetical stale client. No other labels change.

**D6 — Spec deltas.** `workflows-ui`: the listing requirement's scenario set changes (provenance grouping out, category sections + internal disclosure in), so per the spec-merge guard it is REMOVED and re-ADDED under a distinct name ("…lists the installable library in category sections"); the detail-view requirement drops the word "command" from its field list with its scenario intact, so it is MODIFIED. `workflow-http-api`: both endpoint requirements drop the dead field names from their prose with scenarios intact — MODIFIED only.

## Risks / Trade-offs

- [Detail-panel field order shifts and e2e/test selectors referencing the kind chip break] → The only consumers are this repo's component tests; they are updated in the same change (the `workflow-kind` testid disappears; section testids change from `workflows-group-built-in`/`-user` to category ones).
- [A future re-introduction of per-workflow commands would need the fields back] → They would come back through the same mirror discipline; deleting dead declarations now is cheaper than carrying always-null fields.
- [Sibling-change collision] → Zero expected: file sets are disjoint (verified — this change touches no Spaces/space-registry file). If `style.css` conflicts arise they are trivial (distinct rule blocks).
- [User's stated section order (driver first) differs from the CLI table's (task first)] → Accepted intentionally; the UI is a management surface where drivers are the headline units. Recorded here so nobody "fixes" the mismatch later.
