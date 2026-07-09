## 1. Classify output contract (`basis` field)

- [x] 1.1 In `src/commands/pipeline.ts` `classify()`, compute `basis: 'keyword' | 'default'` (`keyword` when any indicator matched, `default` otherwise), add it to the JSON result object, and add a corresponding line to the human-readable output
- [x] 1.2 In `test/commands/pipeline.test.ts` `describe('classify')`, extend the existing four cases to assert `basis` (`keyword` for the bug-fix / full-feature / both-match cases, `default` for the no-match case) and assert the existing keys (`suggested`, `matched`, `available`) are unchanged

## 2. Selection policy config axis (`autopilot.selection`)

- [x] 2.1 In `src/core/project-config.ts`, add `selection: z.enum(['classify','manual']).optional()` to the `autopilot` Zod block, an `AutopilotSelectionPolicy` type, and warn-and-drop parsing for `autopilot.selection` inside the existing `autopilot` block parse (invalid value drops only that field; sibling `gates` still parses)
- [x] 2.2 In `src/core/project-config.ts`, add `resolveAutopilotSelectionPolicy(config, autoSelectFlag)` beside `resolveAutopilotGatePolicy`, returning `{ effective: 'classify'|'manual', source: 'flag'|'config'|'default' }` with precedence flag > config > default(`manual`)
- [x] 2.3 In `test/core/project-config.test.ts`, add cases mirroring the gate-policy tests: valid `selection` values parse; invalid value warns, drops the field, and keeps sibling `gates`; resolver precedence (flag wins over config, config wins over default, absent everything resolves `manual`/`default`)

## 3. Auto template (selection-policy resolution and adoption flow)

- [x] 3.1 In `src/core/templates/workflows/auto.ts`, add `[--auto-select]` to the Input line in section 1 and add the selection-policy resolution (precedence flag > `autopilot.selection` config > default `manual`; display `Selection policy: <effective> (<source>)` at run start alongside the gate policy line)
- [x] 3.2 Rewrite the "Select the pipeline" choice order: (1) explicit selector always wins, classify never consulted, `--auto-select` inert; (2) policy `classify` → run `rasen pipeline classify "<task>" --json`, adopt `suggested` when it is in `available`, display the adoption with basis/matched indicators, keep the user-changeable display point; classify failure / no suggestion / suggestion not in `available` → `small-feature` with the fallback and cause displayed; (3) policy `manual` (default) → today's text verbatim (default `small-feature`, classify advisory-only, no auto-escalate)
- [x] 3.3 Add the Guardrails entries: default OFF (absent flag+config, selection behavior is exactly 0.1.x); explicit selection always wins over the policy; adopt the classify suggestion exactly — never escalate or substitute by LEAD judgment; classify-unavailable falls back to `small-feature`
- [x] 3.4 In `test/commands/auto.test.ts`, add assertions that the skill text contains `--auto-select`, `autopilot.selection`, the adoption rule, the explicit-wins rule, and the `small-feature` fallback rule

## 4. Template regeneration and parity

- [x] 4.1 Run `node build.js`, then regenerate installed templates via the update flow (build → update) so the `rasen-auto` skill and `Rasen: Auto` command pick up the new section
- [x] 4.2 Update the pinned hash in `test/core/templates/skill-templates-parity.test.ts` for the auto template (manual paste per established procedure)

## 5. Validation

- [x] 5.1 Run the touched suites with `npx vitest run test/commands/pipeline.test.ts test/commands/auto.test.ts test/core/project-config.test.ts test/core/templates/skill-templates-parity.test.ts` and confirm green
- [x] 5.2 Run `node bin/rasen.js validate autonomy-ladder-classify --strict` and confirm the change passes; smoke-check `node bin/rasen.js pipeline classify "fix the crash" --json` shows `basis: "keyword"` and an unmatched task shows `basis: "default"`
