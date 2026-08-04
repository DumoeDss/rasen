# Planning context

## User intent

Add a small follow-up change to PR #134 so the WebUI exposes the generic Codex model and reasoning-effort configuration delivered by `codex-luna-thread-dispatch`.

## Confirmed gap

- Backend config/API already supports `efforts.default`, `efforts.roles.<role>`, `pipelines.<name>.efforts.<stage>`, and emits per-stage `effectiveEffort` with provenance.
- The WebUI pipeline defaults matrix currently renders only model values.
- Per-stage controls currently render gate and model, not effort.
- The frontend `WirePipelineStage` omits `effectiveEffort`, so the backend value is ignored.
- The generic Config page excludes Workflow and Pipelines groups; the new effort registry keys do not appear there as a fallback.
- Model fields accept arbitrary non-empty ids, but their non-binding suggestions do not include `gpt-5.6-luna` or `gpt-5.6-terra`.

## Required outcome

- Keep model ids open-ended; add Luna and Terra only as suggestions, never an allow-list.
- Add an Effort column to the role-default matrix for default/planner/implementer/reviewer/fixer/shipper.
- Add a per-stage Effort select with `inherit`, `low`, `medium`, `high`, `xhigh`, and `max`.
- Consume and display `effectiveEffort` and its source without reimplementing backend precedence.
- Update English, Simplified Chinese, and Japanese labels.
- Add focused UI/API/model tests, including write/clear inheritance behavior and model suggestion parity.

## Constraints

- Work in the existing PR #134 worktree and branch; this is a second independent Rasen change.
- Preserve the already-green Codex runtime implementation and configuration precedence.
- Reuse existing model/effort control and instance-writer patterns; avoid visual redesign.
- Preserve arbitrary custom model entry and all existing Claude model suggestions.
- Target PR base remains `dev/0.2.0`; do not merge.

## Durable findings

- The config listing already exposes each set wildcard family instance by exact `instanceKey` plus per-scope `scopeValues`, and a write/delete returns a re-resolved (including absent-shape) entry; stage effort editing can therefore track the active scope without interpreting the winning effective source.
- `PipelinesPage.updateEntry()` currently matches only `definition.key`, which is unsafe for wildcard siblings because they share one family definition; the effort consumer must update by `instanceKey` when present and use the definition key only for fixed/template entries.
- Effort enum constraints are serialized from the backend's shared `LEAF_EFFORTS` on both fixed effort keys and the per-stage wildcard template, while Luna/Terra already resolve through the existing `gpt-5` model preset; neither concern needs a new frontend effort list or backend preset.
