## Context

The `codex-luna-thread-dispatch` change already owns effort validation and precedence. Its config registry exposes fixed `efforts.default` and `efforts.roles.<role>` entries plus the wildcard `pipelines.<name>.efforts.<stage>` family, and the Pipelines management mapper already emits `effectiveEffort: { value, source }` for collection and detail views. The standalone UI mirror omits that field, so `PipelinesPage` cannot render it. The same page currently has a two-column role Defaults matrix, gate/model stage controls, shared family-instance write helpers, and a shared free-text model datalist.

The Config page intentionally excludes the Workflow, Autopilot, and Pipelines registry groups, so the Pipelines page is the ordinary UI home for these new keys. This is a small follow-up on the existing PR: it must preserve arbitrary model ids, backend resolution, the page's Global/Local scope behavior, store-inherited handling, responsive layout, and all existing Claude suggestions.

## Goals / Non-Goals

**Goals:**

- Make role-default and per-stage effort configurable from the existing Pipelines page.
- Show the backend-resolved effective effort and provenance without duplicating precedence in the browser.
- Offer Luna and Terra as model suggestions while keeping model entry open-ended.
- Keep new user-facing labels complete in English, Simplified Chinese, and Japanese.
- Pin the additive wire contract and scoped write/clear behavior with focused tests.

**Non-Goals:**

- Changing effort vocabulary, validation, precedence, or runtime dispatch.
- Adding model discovery, availability checks, or an allow-list.
- Editing authored stage or pipeline-agent effort in pipeline definition YAML or Canvas.
- Moving Workflow/Pipelines keys back to the generic Config page or redesigning the Pipelines page.
- Changing stage gate, model, runtime, handoff, or threshold-scheme behavior.

## Decisions

### 1. Treat backend effective effort as the only resolution result

Add `effectiveEffort: WireEffectiveValue<string | null>` to the standalone UI's `WirePipelineStage` mirror and update typed fixtures accordingly. The stage effort control will render the returned value and source verbatim. It will not use that source to infer what is configured at the active editing scope: the config listing already exposes wildcard family instances by exact `instanceKey` with `scopeValues`, while the effective source describes only the winning layer and can hide a shadowed active-scope value.

The collection and detail mappers already serialize `effectiveEffort`, so backend production logic remains unchanged. A management API test will explicitly pin the value/source pair to prevent the existing field from disappearing unnoticed.

Alternative considered: derive effort from the config listing in the browser. Rejected because that would duplicate the resolver, miss authored pipeline layers, and risk diverging from dispatch.

### 2. Extend the existing role matrix with registry-driven effort cells

Extend each `MATRIX_ROLES` entry with its exact effort key (`efforts.default` or `efforts.roles.<role>`) and add a third Effort column. An `EffortCell` will reuse the compact matrix's `useDefaultsCell`, `ConfigSourceBadge`, `scopeValues`, and store-inherited treatment. Its select domain comes from that fixed entry's serialized enum constraints, which are generated from the backend's shared leaf-effort vocabulary rather than a second UI-owned list.

The cell will distinguish the active-scope choice from the resolved value: choosing a named effort writes that fixed key at the current Global/Local scope; choosing Inherit/unset deletes only that scope's value, then uses the config API response to re-render the newly effective value and source. A missing effective value is presented as runtime-default inheritance, not fabricated as one of the named efforts.

Alternative considered: render six full-width `ConfigEntryRow` instances below the model matrix. Rejected because the page already establishes the role-first matrix as the compact home for model-parallel defaults.

### 3. Add effort as a sibling stage control through the existing instance writer

Add `StageEffortControl` beside gate and model in each expanded stage row. It uses `useInstanceWriter` with the exact key `pipelines.<pipeline>.efforts.<stage>` and the same active write scope and post-write pipeline refresh. Its options come from the exact wildcard family template entry (`pipelines.<name>.efforts.<stage>`); its active editing choice comes from the exact configured entry whose `instanceKey` equals the concrete key and that entry's `scopeValues[writeScope]`. Inherit deletes only that active-scope instance; named choices write the selected value. The control separately shows the backend's effective value (or runtime default when null) and source, so inherited resolution remains visible even while the editing choice is Inherit.

The instance writer's re-resolved config response will update page state by exact entry identity (`instanceKey` when present, otherwise the fixed definition key), adding an absent-shape instance if necessary, before the pipeline view refreshes. This avoids replacing every wildcard sibling that shares one definition key and keeps the editing choice correct even when a higher layer shadows the scope being edited.

The existing stage grid gains one sibling column and retains its current single-column responsive breakpoint; no new disclosure or advanced panel is introduced.

Alternative considered: reuse a generic `ConfigEntryRow` for wildcard instances. Rejected because stage rows already own exact pipeline/stage instance keys and refresh the resolved pipeline view after writes.

### 4. Keep model suggestions shared and non-binding

Append `gpt-5.6-luna` and `gpt-5.6-terra` to `KNOWN_MODEL_IDS`, the datalist source already shared by Defaults and per-stage model inputs. Both ids match the existing `gpt-5` preset family, so no model-preset registry or threshold behavior changes. The input remains text-backed: existing Claude suggestions stay present and an arbitrary non-empty custom id still writes unchanged.

Tests will pin both suggestion surfaces to the shared list, assert Luna/Terra are present, retain the preset-resolution parity guard, and exercise a custom id write so suggestions cannot accidentally become validation.

Alternative considered: replace model inputs with selects. Rejected because that would turn suggestions into an allow-list and violate the generic model-id contract.

### 5. Localize labels while preserving configuration tokens

Add catalog keys for the Effort column, stage effort label, effective-value/runtime-default copy, and any new inherit affordance in `en`, `zh-cn`, and `ja`. Human-facing labels are translated; model ids, effort values, config keys, and provenance source strings remain stable domain tokens. Existing catalog parity and used-key tests remain authoritative, with a focused assertion that the new Pipelines effort keys have distinct non-English translations.

Alternative considered: hardcode the short label as existing stage controls do. Rejected because the requested surface must be complete in all three shipped locales.

## Risks / Trade-offs

- [An inherited effort select could obscure the winning value] → Render effective value and source separately from the active-scope Inherit choice, and test both before and after clearing an override.
- [Frontend/backend wire mirrors can drift] → Add `effectiveEffort` to typed fixtures and assert it in the real management API response; typecheck and focused tests catch omissions.
- [A duplicated effort option list could drift] → Read serialized enum domains from each fixed effort entry and the exact per-stage wildcard family template; do not maintain a UI effort constant.
- [Wildcard entries share one definition key] → Match and update configured instances by exact `instanceKey`, falling back to the definition key only for fixed/template entries.
- [An extra stage column can crowd narrow screens] → Extend the existing grid only at desktop widths and retain the established single-column mobile breakpoint.
- [New suggestions could be mistaken for supported-only models] → Keep datalist-backed text inputs and test an arbitrary custom id write unchanged.

## Migration Plan

This is an additive UI/client-contract update with no data migration. Ship the frontend mirror, controls, fixtures, locale keys, and tests together on the existing branch. Rollback is the inverse UI commit; stored effort keys and the additive backend field remain valid and continue to be used by runtime resolution.

## Open Questions

None. The backend vocabulary, source labels, scope behavior, and precedence are already fixed by the preceding change.
