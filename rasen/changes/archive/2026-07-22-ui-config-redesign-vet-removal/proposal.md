## Why

W5 of the ratified `rasen/office-hours/ui-config-and-library-redesign.md`, the portfolio's final child. With the Pipelines page (W3) making every gate visible and individually controllable, the `gate: 'vet'` carve-out — a gate no configuration can ever auto-approve — loses its reason to exist as a special type: it was a blunt instrument from before per-stage gate control existed. The second, independent half discharges a trust debt: the `telemetry.enabled` toggle asks users to decide about telemetry without showing them what is sent; listing the actual five-field payload is more persuasive than any privacy prose.

**Autonomy consequence, stated plainly (the user chose this trade):** after this change, `autopilot.gates: off` auto-approves `define-goal`, so a goal-loop's measure command — including an arbitrary shell command — can run unattended for up to `maxRounds` without a human having read it. The mitigations are that gates default to on and the Pipelines page makes every gate individually visible and controllable (`pipelines.goal-loop-measure.gates.define-goal: on` restores the old pause under an `off` base with one value).

## What Changes

- **`gate: 'vet'` is removed as a gate type.** The three built-in goal-loop pipelines (`goal-loop-{measure,evaluate,research}`) change `define-goal` to `gate: true`; the stage schema's gate becomes plain boolean; the wire type drops the `'vet'` literal; the vet display branch in `pipeline show` goes; and the seven agent-facing template-prose blocks that instruct the LEAD to honour the carve-out are rewritten (`auto.ts`, `_orchestration.ts` ×2, `goal-command.ts` ×2, `goal-plan.ts` ×2, `experts/workflow-author.ts`) — leaving them stale would mean the code drops the carve-out while the agent keeps enforcing it.
- **Migration, never breakage:** a user pipeline YAML still carrying `gate: vet` reads as `gate: true` with a one-time warning per pipeline — no hard error, existing user libraries keep loading. This legacy-coercion shim is the single place the `'vet'` string remains in `src/` (the success criterion is refined accordingly).
- **Telemetry disclosure:** a help affordance beside `telemetry.enabled` on the Config page's Privacy surface listing the five sent fields verbatim from the sending code — command name, CLI version, an anonymous random UUID, the OS platform, the Node.js version — plus a line noting the key is global-only and that environment opt-outs (`RASEN_TELEMETRY=0`, `DO_NOT_TRACK=1`, CI) always win over it.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities
- `autopilot-gate-policy`: the vet requirement is removed outright; the gate-widening backward-compat requirement becomes the legacy-coercion requirement (`vet` reads as `true`, one-time warning); W3's mask requirement is re-cut without its vet sentence (stacked on W3's pending ADDED text).
- `pipeline-http-api`: the inventory requirement's declared gate value narrows to boolean and the vet-distinguishable scenario is dropped (stacked on W3's pending ADDED text — per the portfolio finding, this contract moved OUT of `config-http-api` in W3, which is why that spec is untouched here).
- `config-ui-package`: gains an ADDED-only telemetry-disclosure requirement on the Privacy surface (order-independent with the sibling deltas to that spec).

**Archive-order constraint**: W3 must archive before this change (both stacked deltas quote W3's pending ADDED texts). This is the portfolio's last child in the chain: W1 → W2 → W6 → W4 → enabler → W3 → **W5**.

## Impact

**Touched files:**
- Pipeline YAMLs: the three `goal-loop-*` `define-goal` stages → `gate: true`
- `src/core/pipeline-registry/types.ts` — `StageSchema` gate union → boolean with the legacy-`'vet'` coercion (warn once per pipeline, coerce to `true`)
- `src/core/config-api/wire-types.ts` — `gate: false | true | 'vet'` → `boolean` (and the UI mirror in `packages/ui/src/api/types.ts`)
- `src/commands/pipeline.ts` — vet display branch removed
- Templates: `src/core/templates/auto.ts`, `_orchestration.ts`, `goal-command.ts`, `goal-plan.ts`, `experts/workflow-author.ts` — vet prose removed/rewritten, with golden-hash repastes in `test/core/templates/skill-templates-parity.test.ts` for every touched template
- UI: a small `TelemetryDisclosure` component rendered by the Privacy tab beside `telemetry.enabled` (isolated component, not a `ConfigEntryRow` rework — see design), plus its test
- Tests: schema coercion + one-time warning, boolean wire shape, goal-loop YAML gates, a `src/`-wide `'vet'`-literal guard test excluding the single shim site, disclosure content parity with `telemetry/index.ts`
- **Dependency**: MAIN tree, gated on W3 review-clean (the mask and the migrated pipelines-endpoint contract are the substrate); the UI half additionally assumes W2's tabbed Config page (Privacy tab) is landed — which W3's gating already transitively guarantees.
- Not touched: `config-http-api` (W3 already removed the pipelines requirement from it), gate mask semantics beyond deleting the vet exception, versions, visual design.
