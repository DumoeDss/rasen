## Why

Today `/rasen:auto <task>` without a pipeline selector always runs `small-feature`: `rasen pipeline classify` exists but is advisory-only, so a task that is plainly a bug fix or a full feature still lands on the default unless the user names a pipeline by hand. This is rung 1 of the agreed autonomy ladder (classify-as-decision): let the LEAD adopt the classify suggestion as its pipeline decision — under an explicit opt-in, so 0.1.x behavior is unchanged until the user turns it on.

## What Changes

- **Opt-in automatic pipeline selection** for `/rasen:auto`: a new `--auto-select` run flag and a new `autopilot.selection: classify | manual` key in `rasen/config.yaml`, resolved with the same precedence shape as the gate policy (run flag > project config > built-in default `manual`).
- **When the policy resolves to `classify`** and the invocation carries no explicit pipeline selector, the LEAD runs `rasen pipeline classify "<task>" --json` and ADOPTS the suggestion (displaying the choice and its basis; the user can still change it at the display point). Three invariants are non-negotiable:
  - **Default OFF** — absent the flag and config key, selection behaves exactly as today (default `small-feature`, classify advisory-only, no auto-escalation).
  - **Explicit selection always wins** — `--pipeline <name>` or a leading known-pipeline token beats the selection policy entirely; classify is never consulted.
  - **`small-feature` fallback** — classify unavailable, erroring, or returning no usable suggestion falls back to `small-feature` exactly as today, with the fallback displayed.
- **Classify output contract enrichment (minimal)**: `rasen pipeline classify --json` gains a `basis` field (`keyword` when indicators matched, `default` when the suggestion is the fallback default) so an adopting LEAD can state *why* it chose the pipeline and treat a `default`-basis suggestion as the fallback it is. Existing fields (`suggested`, `matched`, `available`) are unchanged; the addition is backward compatible.
- **Auto template update** (`rasen-auto` skill / `Rasen: Auto` command): the "Select the pipeline" section gains the selection-policy resolution step and the adoption/fallback flow; Guardrails gain the default-off / explicit-wins / fallback invariants. Built via the template build → update flow with the parity hash updated.
- **NOT in scope**: no version bump (opt-in only; flipping the default is a future 0.2.0 decision owned by the user); no run-state schema change (the chosen pipeline is already persisted in run-state and resume never re-selects); rung 2 (composed pipelines) is the sibling change `autonomy-ladder-compose`; runtime free-form DAGs are rejected (portfolio Non-Goal).

## Capabilities

### New Capabilities
- `autopilot-selection-policy`: the opt-in automatic pipeline selection axis for `/rasen:auto` — `--auto-select` flag, `autopilot.selection` config key, precedence, the adopt-classify behavior, the explicit-selector supremacy, and the `small-feature` fallback.

### Modified Capabilities
- `opsx-auto-command`: the Task Complexity Classification requirement changes from "classify is advisory, user picks" to "selection follows the resolved selection policy: manual (today's behavior, default) or classify-adoption (opt-in)".
- `opsx-pipeline-registry`: the Pipeline CLI Surface requirement's Classify scenario gains the `basis` field in the JSON output contract.

## Impact

- `src/core/templates/workflows/auto.ts` — "Select the pipeline" section, Input line (new `--auto-select` flag), Guardrails; regenerated skill/command templates via build → update; parity hash in `test/core/templates/skill-templates-parity.test.ts`.
- `src/commands/pipeline.ts` — `classify` adds `basis` to JSON and a basis line to human output.
- `src/core/project-config.ts` — `autopilot.selection` parsing (warn-and-drop on invalid, consistent with `autopilot.gates`), `AutopilotSelectionPolicy` type, `resolveAutopilotSelectionPolicy()` resolver.
- Tests: `test/commands/pipeline.test.ts` (classify basis), `test/core/project-config.test.ts` (selection parse + resolver precedence), `test/commands/auto.test.ts` (template mentions the new flag/flow), parity hash test.
- No dependency changes; no CLI signature breaks; `rasen/config.yaml` consumers unaffected when the key is absent.
