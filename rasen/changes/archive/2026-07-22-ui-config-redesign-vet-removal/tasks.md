> **Dependency note**: implemented in the MAIN tree, gated on `ui-config-redesign-pipelines-page` (W3) being review-clean there — the mask and the migrated pipelines-endpoint contract are this child's substrate (W2's Privacy tab arrives transitively). Archive order: W3 before this change (both stacked deltas quote W3's pending ADDED texts); this is the portfolio's final child in the chain.
>
> **Boundary note**: no change to mask precedence, per-stage families, or run-state beyond deleting the vet exception; no telemetry behavior change — disclosure only.

## 1. Gate type narrowing

- [x] 1.1 `src/core/pipeline-registry/types.ts`: StageSchema gate `z.union([z.boolean(), z.literal('vet')])` → `z.boolean()` with a preprocessing shim coercing the literal `'vet'` to `true` and warning once per pipeline per process (module-level warned-set), the warning naming the pipeline, the stage, and `pipelines.<name>.gates.<stage>` as the per-stage control. This shim is the ONLY permitted `'vet'` occurrence in `src/` (design D1).
- [x] 1.2 The three built-in YAMLs: `goal-loop-{measure,evaluate,research}` `define-goal` → `gate: true`.
- [x] 1.3 `src/core/config-api/wire-types.ts` gate → `boolean`; mirror in `packages/ui/src/api/types.ts`; remove the vet display branch in `src/commands/pipeline.ts` (~:913); sweep any vet handling in the W3-added stage-overrides resolver and pipelines-endpoint serialization (mask no longer exempts anything).
- [x] 1.4 Tests: coercion + exactly-one-warning (load twice), boolean wire shape, built-in YAML gates, mask covers `define-goal` under `--no-gate` (no-stage-exempt scenario), pre-existing run-state parses. Add the `'vet'`-literal guard test: a source-tree scan (paths built with `path.join`, Windows-safe) asserting the only match in `src/` is the shim site.

## 2. Template prose

- [x] 2.1 Rewrite the seven vet blocks — `src/core/templates/auto.ts`, `_orchestration.ts` (×2 blocks), `goal-command.ts` (×2), `goal-plan.ts` (×2), `experts/workflow-author.ts` — grep-confirm the enumeration first (the design-doc count is the floor, not the ceiling). Replace carve-out claims with the actual rule: gates resolve per the mask; `define-goal` pauses by default and is configurable per stage. No template may still claim any gate cannot be auto-approved.
- [x] 2.2 Repaste golden hashes in `test/core/templates/skill-templates-parity.test.ts` for every touched template, one at a time from the failing test's actual output.

## 3. Telemetry disclosure (independent half)

- [x] 3.1 New `packages/ui/src/components/TelemetryDisclosure.tsx`: help affordance beside the `telemetry.enabled` row on the Privacy tab (isolated component with a keyed seam, not a generic per-key help system — design D4). English copy: the five payload fields (command name, CLI version, anonymous random UUID, OS platform, Node.js version), one line for global-only scope, one for env opt-outs (`RASEN_TELEMETRY=0`, `DO_NOT_TRACK=1`, CI) always winning. Opening/closing issues no write.
- [x] 3.2 Tests: disclosure renders beside `telemetry.enabled` only; field-list parity fixture pinned against `telemetry/index.ts:190-194`'s payload keys (comment pointing maintenance at both sites); no write on interaction.

## 4. Verification

- [x] 4.1 Full suite (CLI `node build.js`, UI `pnpm --filter @atelierai/rasen-ui build`); golden-hash tests green after repastes; isolate-rerun Windows CLI-spawn flakes before calling regressions.
- [x] 4.2 Manual checks: a scratch user pipeline with `gate: vet` loads with one warning and shows `true` everywhere (`pipeline show`, the Pipelines page); `--no-gate` goal-loop run plan shows `define-goal` auto-approved; setting `pipelines.goal-loop-measure.gates.define-goal: on` restores the pause; the Privacy tab shows the disclosure with the five fields.
- [x] 4.3 CHANGELOG (version untouched): vet gate type retired — `define-goal` becomes an ordinary default-on gate; under `autopilot.gates: off` it auto-approves (restore with one per-stage value); legacy `gate: vet` YAML reads as `true` with a warning.
- [x] 4.4 From the repo root: `rasen validate ui-config-redesign-vet-removal --strict`; before archive, re-check both stacked-delta REMOVED blocks against W3's archived text verbatim.
