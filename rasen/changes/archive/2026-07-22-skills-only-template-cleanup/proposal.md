## Why

Children 1-2 retired the command surface and moved "what comes next" into the CLI (`nextWorkflows`, `src/core/workflow-chain.ts`). The workflow **skill bodies** still carry the old world: hardcoded downstream steering (apply's "steer to `/rasen:verify` → `/rasen:ship`") that duplicates — and contradicts — the runtime chain under lean profiles, and `/rasen:*` colon-form cross-references that no longer resolve on Claude Code (project skills invoke as `/rasen-apply-change`, the skill-directory name). This final change (Phase C) rewrites the skill template bodies to relay the CLI's `nextWorkflows` and to name other workflows by their canonical skill name, and closes the residual `delivery` and colon-form leftovers children 1-2 could not reach.

## What Changes

- **C1 — remove hardcoded next-step steering** from workflow skill bodies (`apply-change.ts:56/94/125`, `continue-change.ts:53`). Replace with a uniform slot: relay the CLI's `nextWorkflows` (using this tool's invocation name for the skill), with a zero-CLI fallback line ("if you have not run a `nextWorkflows`-bearing command this turn, run `rasen status --change \"<name>\" --json`"). The CLI side already emits `nextWorkflows` (child 2) — bodies only relay it.
- **C2 — unify cross-references to canonical skill names.** `/rasen:apply <other>` → `/rasen-apply-change <other>`; `consult /tdd` → "consult the rasen-tdd skill"; the navigator router map, the help command catalog, and CLI init/update output hints move off the `/rasen:*` colon form to canonical skill names.
- **C3 — non-goal guard (zero changes):** expert `_shared.ts` PREAMBLE, the "Dispatched vs standalone mode" contract, and dispatched-report templates are untouched. The word "delivery" in `ship.ts`/`archive.ts`/`auto.ts` means ship-mode (pr/push/local) and is NOT touched.
- **C4 — grep-assertion test:** generated **workflow** skill bodies contain no `/rasen:` colon references (whitelist: frozen expert dispatched-contract content carried from `_shared.ts`, and historical/archive docs).
- **Golden-master parity:** `skill-templates-parity.test.ts` hashes are updated for every touched template body (function-payload and generated-content maps).
- **Residual fold-in (per LEAD):** scrub the remaining retired-`delivery` leftovers children 1-2 left in `cli-update` (incl. the "One-time migration" spec still claiming it writes `delivery:"both"` — code is already clean) and `profiles` (drift-detection and config-changes requirements); remove the `delivery (both/skills)` wording from `help.ts:98/125` and the help spec.

## Capabilities

### New Capabilities
None. The skill-side relay/canonical-name contract is added to the existing `workflow-next-steps` capability (child 2), which already owns the runtime chain.

### Modified Capabilities
- `lifecycle-stage-sequencing`: apply and continue completion messages relay the CLI `nextWorkflows` instead of hardcoding `/rasen:verify`→`/rasen:ship` / `/rasen:apply`.
- `workflow-next-steps`: ADD the skill-body relay contract, the canonical-skill-name cross-reference rule, and the no-`/rasen:`-colon grep guard for generated workflow skill bodies.
- `cli-init`: the "Init output uses the rasen namespace" requirement moves next-step hints to canonical skill names (skill-directory form), not the colon form.
- `workflow-help-command`: the help skill routes by canonical skill name and drops the retired `delivery` wording; the workflow is generated as a skill (no delivery mode).
- `navigator-router-skill`: the router map names workflows by canonical skill name, not colon form.
- `methodology-expert-fusion`: the apply/explore/propose skill scenarios reference the methodology experts by skill name (`rasen-tdd`, `rasen-codebase-design`, …) rather than bare-slash `/tdd`.
- `cli-update`: residual Phase-A `delivery` cleanup (drift/migration/deselection scenarios; the code is already delivery-free).
- `profiles`: residual `delivery` cleanup in drift-detection and config-changes-applied requirements.

## Impact

- **Templates (bodies only):** `src/core/templates/workflows/*.ts` — primarily `apply-change.ts`, `continue-change.ts`, `help.ts`, `onboard.ts`, `ship.ts`, `navigator` (expert router), plus every workflow template carrying a `/rasen:` colon cross-reference. Expert `_shared.ts` is NOT touched.
- **CLI output:** `src/core/init.ts:927/930` (and any `update.ts` equivalent) next-step hints.
- **Tests:** new grep assertion; `skill-templates-parity.test.ts` hash refresh (function-payload + generated-content) for every touched body.
- **Docs:** primary command-reference docs updated for canonical names; historical/archive docs whitelisted (may retain colon form).
- **No version bump.** No change to the pipeline registry, LEAD orchestration, the CLI `nextWorkflows` mechanism (child 2), or the expert dispatched contract.
