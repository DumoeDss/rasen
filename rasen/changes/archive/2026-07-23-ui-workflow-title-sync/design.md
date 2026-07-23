## Context

`packages/ui` hand-mirrors `src/core/management-api/wire-types.ts` by convention (no
build-time import between the two packages) and pins the mirror with `satisfies
<ResponseType>` fixtures — a `tsc` drift tripwire, not a runtime check. Core already
sends `title`/`category`/`tags` on both the workflow list and detail endpoints; the UI
mirror, card, and detail view are the only pieces left stale. This is a small,
single-package sync, not a new capability — most of the "design" is deciding how the
detail view presents two fields the proposal deliberately left open (category, tags).

## Goals / Non-Goals

**Goals:**
- Bring `packages/ui`'s wire-type mirror, card, and detail view into agreement with
  the already-shipped core contract, so the browser and the CLI never show a
  different name for the same workflow.
- Decide, once, how category and tags are presented in the detail view so the
  component and its test are unambiguous.

**Non-Goals:**
- No new UI surface, route, or interaction pattern.
- No change to `TelemetryDisclosure.tsx` or any other component outside the
  Workflows page.
- No change to core, the management API, or the CLI — those already ship the fields.

## Decisions

- **Card**: render `entry.title ?? entry.skillName`, exactly the fallback rule the
  CLI's profile picker already uses for the same `title` field (`design.md` D5 of
  `cli-locale-workflow-list-skill-title-fixes`, `src/commands/profile-editor.ts`).
  One fallback rule for the same field, consistently applied everywhere it's shown.
- **Detail view**: add a `Title` fact row to the existing `<dl class="workflow-detail__facts">`,
  shown only when `detail.workflow.title` is non-null — the detail view already omits
  rows for fields that don't apply, so an always-present-but-empty row would be new
  behavior, not consistent with the panel's existing style.
- **Category/tags**: also shown as facts rows, each only when non-null — `Category`
  as its plain string value, `Tags` as a comma-joined string. Rejected alternative:
  a new dedicated section for presentation metadata; the three fields are small,
  optional, and read naturally as facts alongside Kind/Source/Skill/Digest, so a new
  section would be unwarranted structure for three optional strings.
- **Mirror discipline**: copy field order and doc comments from
  `src/core/management-api/wire-types.ts` verbatim, matching every other section of
  `packages/ui/src/api/types.ts` (its own file header names this as the required
  discipline).

## Risks / Trade-offs

- [Risk] The `workflow-http-api` spec's endpoint-field prose still omits
  `title`/`category`/`tags` (a pre-existing gap from the core-side change, not
  introduced here) → Mitigation: out of scope for this UI-only change; noted in the
  proposal's Impact section for whoever next touches that spec.
- [Risk] Hand-maintained mirrors drift silently between releases (as happened here)
  → Mitigation: unchanged from today — the `satisfies` fixture tripwire is the
  existing safeguard; introducing a shared package is out of scope for this change.
