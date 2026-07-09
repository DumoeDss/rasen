## 1. Expert template — product routing (Phase 1)

- [x] 1.1 In `src/core/templates/experts/office-hours.ts`, replace the "Consultation short-circuit — check the opening message first" step and the goal-question mode mapping (Phase 1, ~lines 35-52) with a Product Routing step: discriminator = the object of the request (venture validation → Diagnosis product; design/plan feedback → Design product, regardless of the requester's identity). Keep the direct-route-when-unambiguous / goal-question-when-ambiguous structure, but map the goal answer to a product, not to "Startup mode / Builder mode."
- [x] 1.2 Add the bidirectional mid-session upgrade/downgrade rule (generalizes the existing Builder-mode "vibe shifts" rule at ~line 282): a Design-product session whose user signals venture-validation intent upgrades to the Diagnosis product; a Diagnosis-product session whose user brings a concrete design for feedback downgrades to the Design product.
- [x] 1.3 Keep Phase 1's "Assess product stage" step (pre-product / has users / paying customers), scoped to sessions that route to the Diagnosis product.

## 2. Expert template — Diagnosis product (rename Phase 2A, no behavior change)

- [x] 2.1 Rename "Phase 2A: Startup Mode — YC Product Diagnostic" to "Diagnosis Product — YC Product Diagnostic." Leave the Operating Principles, Response Posture, Anti-Sycophancy Rules, Pushback Patterns, and the Six Forcing Questions (including smart routing by product stage and the intrapreneurship adaptation) unchanged in content.
- [x] 2.2 Leave the Diagnosis product's escape hatch (~lines 239-244) unchanged in trigger semantics (explicit skip signals only); update its cross-reference at the end ("Interview paths only... Even then, still run Phase 3 (Premise Challenge) and Phase 4 (Alternatives)") to point at the shared fork-scan mechanism (task group 4) instead of the deleted Phase 3/4 headers.
- [x] 2.3 After the six-question script, route the Diagnosis product into the shared fork-scan mechanism (task group 4) for premise-checking and alternatives generation, replacing its former private Phase 3 → Phase 4 pass, before reaching Phase 5 (Design Doc).

## 3. Expert template — delete Builder mode and Consultation posture as named paths

- [x] 3.1 Delete "Phase 2B: Builder Mode — Design Partner" as a named phase. Preserve its content as the Design product's builder-context rendering parameter: fold the Operating Principles (delight as currency, ship something showable, solve your own problem, explore before optimize) and the generative questions into the Design product's evaluation-framework description (task group 4), gated on the user's stated goal rather than a mode.
- [x] 3.2 Delete the "Consultation posture" section (~lines 63-76) as a named posture, including its precedence language ("This posture is authoritative for the session — it replaces Phases 2, 3, and 4...") and its terminal description. Fold the terminal (plain summary + `/rasen:propose` pointer, skip Phase 4.5/6) into the Design product's terminal (task group 4).
- [x] 3.3 Delete "Phase 3: Premise Challenge" and "Phase 4: Alternatives Generation (MANDATORY on the interview paths)" as standalone phase headers. Confirm their content is fully represented by the fork-scan procedure's premise-classification (declared assumption / already verified) and method-space-fork-as-approach-menu behavior (task group 4) before removing the headers.

## 4. Expert template — the fork-first Design product mechanism

- [x] 4.1 Write the Design product's fork-scan procedure as an operating block that runs per topic, before any stance is delivered: (1) list load-bearing premises, (2) test branch-writability for each, (3) classify each as weight-bearing fork / declared assumption / already verified, (4) ask at most 2 weight-bearing forks per round, one at a time, each carrying a recommended answer (reusing the existing Interview discipline's "carry your recommended answer" rule).
- [x] 4.2 Write the Design product's flow as: fork-scan → weight-bearing forks asked first → stance analysis → Dialogue Override discussion → convergence → doc. State the ordering rule explicitly: no stance that depends on an unresolved weight-bearing fork is delivered before that fork's answer lands.
- [x] 4.3 Write the Design product's skip semantics: an explicit skip signal (same trigger phrases as the existing escape hatch) downgrades every still-open weight-bearing fork to a headline declared assumption in the analysis and delivers the analysis immediately; a request for discussion is never a skip signal (routes to Dialogue Override per the PREAMBLE); a downgraded assumption is individually reopenable if the user later contests it.
- [x] 4.4 Move the Phase 2.75 (Landscape Awareness) hook point to immediately before the fork-scan procedure (currently feeds into the deleted Phase 3). Update its "Important" note ("This search feeds Phase 3 (Premise Challenge)...") to state it feeds the fork-scan procedure's premise listing and classification instead.
- [x] 4.5 Write the Design product's evaluation-framework rendering: a sentence stating the framework renders by the user's stated goal (startup context → demand-as-currency, produces an assignment; builder context → delight-as-currency, produces build steps) as a rendering parameter, not a flow branch.
- [x] 4.6 Write the Design product's terminal: after convergence and explicit "yes" to distill, deliver a plain summary plus a `/rasen:propose` pointer; explicitly skip Phase 4.5 (founder-signal synthesis) and Phase 6 (three-beat close).

## 5. Expert template — collapse the design-doc templates (Phase 5)

- [x] 5.1 Collapse the "Builder mode design doc template" into the single Design-product template: keep the shared skeleton (Problem Statement, Constraints, Premises, Approaches Considered, Recommended Approach, Open Questions, Success Criteria, Supersedes) and render the evaluation-framework block conditionally — startup context: Demand Evidence + The Assignment; builder context: What Makes This Cool + Next Steps.
- [x] 5.2 Leave the "Startup mode design doc template" unchanged and confirm it is the template used by the Diagnosis product (not renamed, not altered).
- [x] 5.3 Update the Phase 5 hard-gate precondition text (~line 419, "OR, in the Consultation posture, the user's explicit 'yes' to distilling...") to reference the Design product's convergence terminal instead of "Consultation posture."

## 6. Expert template — cross-reference sweep

- [x] 6.1 Rewrite every guard clause and precedence statement that names "interview paths (Startup mode / Builder mode)," "Consultation," or "Phase 3/Phase 4" as a scoping mechanism. Known locations from the design surface: Interview discipline header (~lines 79-88), the Diagnosis-product escape hatch's full-skip rule (~line 244), the (deleted) Builder-mode escape hatch's fully-formed-plan rule (~line 280), Phase 4.5's "interview paths only" scoping (~lines 398-400), Phase 6's "every user gets all three beats... interview paths (Startup/Builder)" statement (~line 553), and "Important Rules"'s fully-formed-plan rule (~line 625). Rewrite each to reference "Diagnosis product" / "Design product" as appropriate, or delete the clause entirely if the distinction it guarded no longer exists (e.g. the Phase 3/4 precedence carve-outs).
- [x] 6.2 After the rewrite, grep `src/core/templates/experts/office-hours.ts` for the literal strings `Startup mode`, `Builder mode`, and `Consultation` and confirm zero matches (excluding the MIT-attribution comment for `grilling`, which is unrelated).

## 7. Command template — product routing and fallback pre-brief

- [x] 7.1 In `src/core/templates/workflows/office-hours.ts`, rewrite the file header comment (~lines 4-6, "two modes: Startup (six forcing questions) and Builder (design thinking brainstorm)") to describe product routing (Diagnosis / Design).
- [x] 7.2 Rewrite Step 1 "Mode Selection" (~lines 27-46) as a Product Routing step: the fallback pre-brief content stays (six forcing questions description; design-brainstorm description) but is framed as Diagnosis product / Design product, not Startup mode / Builder mode.
- [x] 7.3 Update the "Facilitation Delegates to the Office-Hours Expert" section (~lines 47-51) to say "the inline product-routed description" instead of "the inline six-questions (Startup) / brainstorm (Builder) description."
- [x] 7.4 Update the Output Format block (~lines 83-100, `**Mode:** Startup | Builder`) to `**Product:** Diagnosis | Design`.
- [x] 7.5 Update `getOfficeHoursCommandSkillTemplate`'s `description` field and the module docstring (~lines 1-7) to drop "Startup mode... Builder mode" phrasing in favor of product routing language.
- [x] 7.6 Grep `src/core/templates/workflows/office-hours.ts` for the literal strings `Startup mode` and `Builder mode` and confirm zero matches.

## 8. Regenerate installed skills and sync parity hashes

- [x] 8.1 Run `pnpm build` (compiles TS → `dist/`), then `node dist/cli/index.js update` to regenerate the installed `.claude/skills/rasen-office-hours` and `.claude/commands/rasen-office-hours-command` (or their generated equivalents). Confirm the regenerated files show product-routing language and contain no residual "Startup mode / Builder mode / Consultation" text.
- [x] 8.2 Run `pnpm vitest run test/core/templates/skill-templates-parity.test.ts` — expect hash mismatches for `rasen-office-hours` and `rasen-office-hours-command` only (both `EXPECTED_FUNCTION_HASHES` and `EXPECTED_GENERATED_SKILL_CONTENT_HASHES`). Confirm no other template's hash changed — a diff elsewhere signals an unintended edit.
- [x] 8.3 From the assertion diff, paste the actual hashes into `EXPECTED_FUNCTION_HASHES` and `EXPECTED_GENERATED_SKILL_CONTENT_HASHES` for `rasen-office-hours` and `rasen-office-hours-command` in `test/core/templates/skill-templates-parity.test.ts`. Re-run until green.

## 9. Add the residual-named-path regression guard

- [x] 9.1 Add a test (in `test/core/templates/skill-templates-parity.test.ts` or a new `test/core/templates/office-hours-no-legacy-modes.test.ts`) asserting the generated bodies of `getOfficeHoursSkillTemplate()` and `getOfficeHoursCommandSkillTemplate()` / `getOpsxOfficeHoursCommandTemplate()` do NOT contain the literal strings `Startup mode`, `Builder mode`, or `Consultation posture` (case-sensitive, exact substrings) — this is the automated form of Success Criterion 7 and tasks 6.2/7.6 above, kept as a standing regression guard rather than a one-time grep.

## 10. Verify against the design doc's Success Criteria

- [x] 10.1 Manually trace three canonical openings through the rewritten expert template and confirm: (a) a concrete design with an unverified load-bearing premise → the first action is the weight-bearing fork question, not a stance (Criterion 1); (b) a concrete design with all premises already verified → zero questions, direct analysis (Criterion 2); (c) a fully vague opening → questions emerge from the fork scan on the design goal, ≤2 per round (Criterion 3).
- [x] 10.2 Confirm the Diagnosis product's six-question script, escape hatch, and Phase 6 three-beat close are byte-for-byte unchanged in behavior (Criterion 4).
- [x] 10.3 Confirm `git diff` shows zero changes to `src/core/templates/experts/explore.ts` and its command wrapper (Criterion 5).
- [x] 10.4 Confirm the rewritten template states non-forking premises appear as declared assumptions in the analysis, never as questions (Criterion 6).
- [x] 10.5 Confirm no residual Startup/Builder/Consultation references remain in either template file (Criterion 7 — covered by tasks 6.2, 7.6, and the guard test in 9.1).
- [x] 10.6 Confirm a startup-context concrete-design-plus-feedback opening routes to the Design product (discriminator = request object) and that the fork scan surfaces the demand premise as a load-bearing fork in that context (Criterion 8).

## 11. Full verification

- [x] 11.1 Run `pnpm vitest run test/core/templates/` and report pass/fail; note known Windows CLI-spawning EBUSY flakes as non-regressions if they appear (isolate and re-run once to confirm).
- [x] 11.2 Run `node dist/cli/index.js validate office-hours-fork-first` and confirm the change validates clean.
