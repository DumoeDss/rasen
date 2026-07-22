## Context

W2 of the ratified `rasen/office-hours/ui-config-and-library-redesign.md`. Current state (verified): `ConfigPage.tsx` does one `listConfig(projectId)` render grouped by registry group, returns a deferred-stub for store spaces (`ConfigPage.tsx:70-77`), and injects `GatesInventoryPanel` inside the Autopilot group; `ConfigEntryRow.tsx` renders a per-row Scope `<select>` (`:310-324`), dot-path as the row title, and a shadowed-value line (`config-entry__shadowed`); `config/controls.ts` computes `writableScopes`/`defaultWriteScope` over `{global, project}`; `api/client.ts` config calls still ride `?project=` (`:95-98`).

W1 (`ui-config-redesign-store-scope`, in flight on the main tree, dependency edge) provides the entire backend: space addressing on config endpoints (`?space=` beside `?project=`, both → 400), `ConfigScope`/`ConfigSource` gain `'store'`, `scopeValues { global?, store?, project? }`, response-level `store: { id, root } | null` (the inherited store at a project, the space's own store at a store space), `scope: 'store'` writes valid only when the addressed space is a store, project-scope writes rejected at store spaces with fix guidance. W1 deliberately does not touch `packages/ui` — the UI-side mirrors and consumption are all W2.

Registry group inventory (current `config-keys.ts`): Profile 3 (`profile`, `delivery`, `workflows`), Appearance 1 (`language`; W6 adds `ui.pinnedSpaces` here in a parallel worktree), Behavior 2, Telemetry 1, Project 1, Archive 2, Advanced 1 (`featureFlags`, wildcard, display-only), Autopilot 2, Workflow 12.

## Goals / Non-Goals

**Goals:**
- Scope as a page mode: one segmented control that is both write target and visibility filter; per-row scope UI gone.
- Store spaces fully served; store inheritance visible (inherited line) and navigable (edit-in-store space switch).
- Tabs shrink the page to at most ~7 rows per tab (design success criterion); human labels make rows scannable.
- Consume W1's API exactly as promised — no backend additions, no duplication of resolution logic in the UI.

**Non-Goals:**
- No removal of the Workflow/Autopilot keys or the gates inventory from the page (W3's move; W2 stages them in one interim tab).
- No pipeline config, no wildcard-family editing (`featureFlags` stays a display-only family entry until the W3 enabler).
- No UI localization work (see D6).
- No changes to `config-http-api`, the registry, or the CLI; no visual-language changes (tokens/themes frozen).

## Decisions

**D1 — Mode semantics: `Local` = the current space's root; write scope derived from the space type.**
The segmented control has exactly two states, Global and Local. In Local mode the write scope is `project` at a project space and `store` at a store space — the UI never asks the user to know that distinction; the space already encodes it (W1's accepted CLI asymmetry is invisible here because the UI always space-addresses). Visibility: Global mode shows keys whose scopes include `global`; Local mode shows keys settable at the space's local scope. Keys not settable in the active mode are absent (Fork 1A, ratified), and a tab whose keys are all absent is itself absent. Default mode is **Local** — the user navigated into a space, so the space's own configuration is the context; Global is one click away. Env-override rows render read-only in any mode where the key is visible, exactly as today.

**D2 — Interim fifth tab `Workflow`, not Autopilot-group removal.**
The portfolio plan lets W2 leave the Autopilot group in place or stage its removal. Staging removal would leave the 12 Workflow keys and 2 Autopilot keys with no home for one release window — hiding still-functional keys is a regression, and W3 is the change that gives them their new home. So W2 maps groups→tabs as: General (Profile+Appearance+Behavior), Project (Project+Archive), Privacy (Telemetry), Advanced (Advanced group = featureFlags), **Workflow (Workflow+Autopilot groups, gates inventory included, all rendered exactly as today)**. W3 then deletes one tab entry and the panel — a surgical delta against this change's ADDED spec text. Tab mapping is a declared constant over group names (the registry `group` field stays the grouping primitive — declared assumption in the design doc); an unmapped future group falls into a trailing bucket so no key can silently vanish.

**D3 — Inherited line and store-edit link are driven by `scopeValues` + the response store ref.**
In Local mode, a visible multi-scope key with no local value renders an inherited-value line naming the providing layer and value: from `scopeValues.store` + `store.id` when the store layer provides it, else from `scopeValues.global`, else the built-in default. The existing `config-entry__shadowed` element is reused inverted (today it shows the wider value under a narrower winner; now it shows the winning wider value under an absent local one). When the provider is the store, the row's control renders read-only and the line carries an "edit in store `<id>` →" affordance that navigates to that store space's Config page via the existing `spaceHref` — navigation, not a mode; one page mode = one write target holds. Recorded consequence (ratified choice): creating a *project-level override* of a store-inherited key is not offered by the UI — the CLI can still set it, and once set the row becomes an ordinary editable local row (with the store value revealed as shadowed). When the response's `store` ref is null, no store affordance of any kind renders.

**D4 — Write/unset both follow the mode; `controls.ts` gains the mode parameter.**
`writableScopes(entry, mode, spaceType)` collapses to "is this key settable in the active mode's scope"; `defaultWriteScope` disappears as a concept (the mode IS the scope). Every write and unset carries the mode's explicit scope — the API contract stays scope-explicit; only the chooser moved from row to page. The unset button appears only when the active mode's scope has a value. Global mode at a store space is legal and identical to Global anywhere (global keys are machine-wide).

**D5 — Human labels are a UI-local constant with dot-path fallback.**
The registry has no label field, and adding one would widen W1's just-shipped wire surface for presentation-only data. A `labels.ts` constant maps dot-path → short label ("Default model" for `models.default`); the row titles on the label with the dot-path as secondary text (`config-entry__key` demoted). A key missing from the map titles on its dot-path — a new registry key degrades gracefully instead of breaking. Registry `description` continues to render as today.

**D6 — Display language stays the UI's existing English; the design doc's Chinese strings are intent, not literal copy.**
The ratified doc writes `继承自 global：<value>` / `在 store <id> 中编辑 →` — the conversation's language. The UI has no localization layer (unlike the CLI's three locale catalogs), and shipping two Chinese strings into an otherwise-English surface would be incoherent. W2 implements the *behavior* with English copy ("Inherited from global: …", "Inherited from store `<id>`: …", "Edit in store `<id>` →"). If UI localization arrives later, these strings move with everything else. Spec text is written language-neutrally.

**D7 — Client addressing: config calls move to `?space=` wholesale.**
`listConfig`/`getKey`/`putKey`/`deleteKey` take the space selector (`project:<id>` / `store:<id>`) built from the route's space, replacing the `?project=` plumbing (W1 keeps `?project=` working for compatibility, but the UI has exactly one caller — no reason to keep two addressing forms alive in the client). The UI wire mirrors in `api/types.ts` gain `'store'` in `ConfigScope`/`ConfigSource`, `store` in `scopeValues`, and the `store: { id, root } | null` response field — mirroring W1's `wire-types.ts` exactly (the mirror-drift is pinned by existing fixture-driven tests, which gain store cases).

## Risks / Trade-offs

- [W1's implementation shifts details during its review loop while W2 is being planned] → W2's tasks start with a re-read of W1's landed `wire-types.ts`/router surface; the spec text here names W1's *promised contract*, which W1's own delta specs pin — any W1 wording change during review must be reconciled by the LEAD before W2 applies (serial dependency already enforces this).
- [Hiding keys by mode confuses users looking for a key that's "gone"] → The mode control is a visible page-level state with the filtered-out direction one click away; the tab set never hides a key in *both* modes (every key is settable somewhere). Mitigation accepted by Fork 1A's rejection of badge-everything (rejected: keeps the page long).
- [Interim Workflow tab means W2 ships a 14-key tab, over the ~7-row criterion] → Accepted: the criterion is met by the four final tabs; the fifth is a staging area W3 deletes. The alternative (hiding the keys) is a regression.
- [Store-inherited read-only rows block a UI user from project-overriding a store value] → Ratified design choice (navigation, not a third mode); CLI escape exists and is stated in D3; once a CLI-set local value exists the row edits normally.
- [W6 lands `ui.pinnedSpaces` (Appearance) in a parallel worktree while W2 retabs the page] → Additive: the key lands in the General tab automatically via the group mapping; W2 adds no count assertions (portfolio rule), so the merge is conflict-free by construction.

## Open Questions

- None blocking. (Tab-state persistence across visits — e.g. query param vs ephemeral — is left to the implementer; either satisfies the spec.)
