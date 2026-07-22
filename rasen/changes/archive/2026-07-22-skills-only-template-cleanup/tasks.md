## 1. C1 — remove hardcoded steering from workflow skill bodies

- [x] 1.1 `src/core/templates/workflows/apply-change.ts` (:56, :94, :125): remove the hardcoded `state: all_done → /rasen:verify → /rasen:ship` steering. Replace with the uniform slot: relay the CLI's `nextWorkflows` (each named by this tool's invocation for that skill), plus the zero-CLI fallback line ("if you have not run a `nextWorkflows`-bearing command this turn, run `rasen status --change \"<name>\" --json`"). Do NOT name verify/ship as literals.
- [x] 1.2 `src/core/templates/workflows/continue-change.ts` (:53): remove the hardcoded "Next: implement with `/rasen:apply`"; replace with the same relay+fallback slot (no hardcoded `apply` literal, no archive-as-co-equal).
- [x] 1.3 Confirm `goal-iterate.ts:28` is left untouched (its "steer" is round-guidance, not chain steering).

## 2. C2 — canonical skill names across workflow skill bodies

- [x] 2.1 `help.ts`: rewrite the command catalog to reference workflows by canonical skill name (`rasen-propose`, `rasen-apply-change`, `rasen-verify-change`, `rasen-sync-specs`, `rasen-archive-change`, `rasen-new-change`, `rasen-continue-change`, `rasen-office-hours-command`, `rasen-explore`, `rasen-bulk-archive-change`, `rasen-handoff`, `rasen-auto`, `rasen-review-cycle`, `rasen-ship`, `rasen-goal-*`, `rasen-retro`, `rasen-onboard`), NOT `/rasen:*` colon form. Remove the delivery wording (`delivery (both / skills)` at :98; "check profile and delivery" at :125).
- [x] 2.2 `onboard.ts` (~20 colon refs): same canonical-name rewrite.
- [x] 2.3 `ship.ts` (13 colon refs): rename colon cross-references to canonical skill names. Leave the ship-mode "delivery" (pr/push/local) wording untouched (non-goal).
- [x] 2.4 Remaining workflow templates with colon refs: `office-hours.ts`, `retro.ts`, `review-cycle.ts`, `goal-command.ts`, `apply-change.ts` (:31 `/rasen:apply <other>` → `/rasen-apply-change <other>`), `propose.ts`, `verify-enhanced.ts`, `auto.ts`, `verify-change.ts`, `handoff.ts`, `explore.ts`, `continue-change.ts`, `change-context.ts`, `archive-change.ts`, `_orchestration.ts` — rename every `/rasen:` colon reference to the canonical skill name. `consult /tdd`-style bare-slash expert refs → the `rasen-tdd` skill (and `rasen-careful`, `rasen-prototype`, `rasen-codebase-design`).
- [x] 2.5 `src/core/templates/experts/navigator.ts` (router, 9 colon refs): rewrite the four-part map to canonical skill names per the navigator-router-skill delta. Keep the negative "absent skill" bare-slash references (`/to-prd`, `/autoplan`, `/domain-modeling`, …) as-is — they assert absence.

## 3. C2 — CLI output hints

- [x] 3.1 `src/core/init.ts` (:927, :930): change the first-change hint from `/rasen:propose`/`/rasen:new` to the canonical skill-directory form (`rasen-propose` / `rasen-new-change`) for every tool (no colon branch). Update the header comment (:4) if it names `/rasen:*`.
- [x] 3.2 Check `src/core/update.ts` for any equivalent colon-form next-step output and apply the same canonical form. The migration message "New in this version: /rasen:propose …" (cli-update spec) becomes "the rasen-propose skill".

## 4. C3 — non-goal guard (verify, do not change)

- [x] 4.1 Confirm `src/core/templates/experts/_shared.ts` is UNCHANGED (PREAMBLE, "Dispatched vs standalone mode", dispatched-report tables at :141-146/:349-351, SPEC_REVIEW_LOOP). Workflow templates do not import it, so cleaning them does not require touching it.
- [x] 4.2 Confirm `ship.ts`/`archive.ts`/`auto.ts` "delivery" (ship-mode: pr/push/local) wording is untouched — only colon cross-refs in those files were renamed (task 2.3), never the ship-mode word.

## 5. C4 — grep-assertion test + parity hashes

- [x] 5.1 Add a grep-assertion test (extend `test/core/templates/skill-templates-parity.test.ts`, mirroring the existing "generates no workspace-planning residue" guard): every generated workflow skill body AND the navigator router body contains no `/rasen:` colon reference. Whitelist: expert skills carrying frozen `_shared.ts` dispatched-contract content, and historical/archive docs.
- [x] 5.2 Add a body-content assertion: the generated `rasen-apply-change` skill body contains the relay-and-fallback instruction (references `nextWorkflows` and `rasen status --change`) and does NOT contain a literal `verify`→`ship` chain.
- [x] 5.3 Regenerate the golden-master hashes in `skill-templates-parity.test.ts` — BOTH `EXPECTED_GENERATED_SKILL_CONTENT_HASHES` (:106) and the function-payload hash map — for every touched template body (apply-change, continue-change, help, onboard, ship, navigator, and every file touched in task 2.4). Review the hash diff deliberately; do not rubber-stamp a red suite green.

## 6. Residual delivery scrub (spec-backed; code already delivery-free)

- [x] 6.1 Verify no code change is needed for the migration `delivery:"both"` write — `grep -rn "delivery" src/core/update.ts src/core/migration.ts` should show no `delivery:"both"` assignment (children 1-2 already removed it). If any residual delivery write remains, remove it to match the cli-update delta.
- [x] 6.2 (Specs already written) Confirm the `cli-update` and `profiles` deltas remove the remaining retired-`delivery` references; run affected update/profile tests.

## 7. Docs

- [x] 7.1 Update the primary command-reference docs (`docs/commands.md`, `docs/how-commands-work.md`, `docs/getting-started.md`, `docs/customization.md` and `docs/zh/` mirrors) for canonical skill names where they teach invocation. Historical/archive docs may retain colon form (C4 whitelist).

## 8. Validate

- [x] 8.1 `node bin/rasen.js validate skills-only-template-cleanup --strict` clean.
- [x] 8.2 Targeted suites green this round (`skill-templates-parity`, `migration`, `ui/welcome-screen`, `auto`, `handoff`, `review-cycle`, `init`, `update` — 8 files / 177 tests). Full-suite evidence owned by the LEAD (per instruction), not re-run here.
- [x] 8.3 Acceptance: generated workflow skill bodies (now including `rasen-help`) contain no `/rasen:` colon references; the apply skill relays CLI `nextWorkflows` with the zero-CLI fallback and hardcodes no verify→ship chain; `_shared.ts` and ship-mode "delivery" wording are unchanged; the migration-message and init-welcome-screen CLI surfaces are also colon-free.
