## 1. Freeze browse.ts (do first — decouples it from the rewrite)

- [x] 1.1 In `src/core/templates/experts/browse.ts`, add file-local constants holding byte-identical copies of the current `BROWSE_SETUP`, `SNAPSHOT_FLAGS`, and `COMMAND_REFERENCE` strings from `_shared.ts`, and stop importing those three from `./_shared.js` (keep importing `PREAMBLE`).
- [x] 1.2 Build (`pnpm build`) and run the parity test; confirm `openspec-browse` hashes in BOTH maps are still green WITHOUT editing them (proves the inline copies are byte-identical). If browse's hash changed, fix the copy — do not re-pin.

## 2. Rewrite the shared blocks in _shared.ts

- [x] 2.1 Rewrite `BROWSE_SETUP` (:101-118) → `CHROME_USE_SETUP`: run `node "${CLAUDE_SKILL_DIR}/scripts/check-deps.mjs"`, establish `TAB` via `/new`, note sticky proxy (never stop) + per-`targetId` isolation + `/close?target=$TAB` when done.
- [x] 2.2 Rewrite `SNAPSHOT_FLAGS` (:121-154) → `CHROME_USE_SNAPSHOT`: document `/snapshot?target=&mode=i|C|D` (interactive / cursor-interactive / diff) matching the shipped proxy; drop `@e/@c` browse-ref flag syntax, describe selector/`/eval`-based interaction.
- [x] 2.3 Rewrite `COMMAND_REFERENCE` (:157-244) → `CHROME_USE_ENDPOINTS`: curl endpoint table for navigation/interaction/inspection/visual/network, names/params exactly per `skills/experts/chrome-use/references/cdp-api.md`; point to `cdp-api.md` for the full list.
- [x] 2.4 Rewrite `QA_METHODOLOGY` (:325-601): replace every `$B <cmd>` with the D3 `curl localhost:3456/<endpoint>` mapping + `$TAB` lifecycle; keep the "Read the screenshot file so the user sees it" guidance, retargeted to curl output files.
- [x] 2.5 Rewrite `DESIGN_METHODOLOGY` (:603-932): same `$B`→curl remap; for the perf audit use `/perf` and apply the D5 long-task caveat (list LCP/FCP/CLS/resource-timing; do not promise reliable long-task counts).
- [x] 2.6 Rewrite `DESIGN_SKETCH` (:1402-1458): remap its `$B goto`/`$B screenshot` to `/new` + `/screenshot`.
- [x] 2.7 Sweep: `grep -n '\$B' src/core/templates/experts/_shared.ts` returns nothing (all browse invocations removed).

## 3. Update consumer templates

- [x] 3.1 Update imports in the 6 rewrite-class consumers to the renamed constants: `qa.ts`, `qa-only.ts`, `design-review.ts`, `design-consultation.ts`, `benchmark.ts`, `office-hours.ts` (`BROWSE_SETUP`→`CHROME_USE_SETUP`, etc.). Fix any template-local `$B`/browse wording in each.
- [x] 3.2 `navigator.ts`: replace the `/browse` "headless Chromium" bullet (:53) with a chrome-use bullet (CDP-driven real Chrome); verify the invocation label against A1's chrome-use registration.
- [x] 3.3 `src/core/templates/workflows/verify-enhanced.ts`: scan for browse-specific wording (browse binary, playwright, headless, `/browse`); update to chrome-use framing if present. If only generic "browser"/`/qa` mentions exist, leave unchanged and record it as a verified no-op. VERIFIED NO-OP: only generic "browser QA" / "browser-based" / `/qa` mentions (lines 66, 72, 125, 136); no browse binary, playwright, headless, or `/browse` references. Left unchanged; openspec-verify-enhanced is not in the changed-hash set.
- [x] 3.4 Sweep the 8 consumers: `grep -rn '\$B\|playwright\|headless' src/core/templates/experts/{qa,qa-only,design-review,design-consultation,benchmark,office-hours,navigator}.ts src/core/templates/workflows/verify-enhanced.ts` returns nothing browse-coupled.

## 4. Regenerate parity + verify

- [x] 4.1 Run `pnpm vitest run test/core/templates/skill-templates-parity.test.ts`; for each changed skill copy the new sha256 into `EXPECTED_FUNCTION_HASHES` and/or `EXPECTED_GENERATED_SKILL_CONTENT_HASHES`. Expected changed: `openspec-qa`, `openspec-qa-only`, `openspec-design-review`, `openspec-design-consultation`, `openspec-benchmark`, `openspec-office-hours`, `openspec-navigator` (+ `openspec-verify-enhanced` only if 3.3 edited it). `openspec-browse` must NOT appear.
- [x] 4.2 Confirm the 4 expert-count assertions in `test/core/shared/skill-generation.test.ts` remain at 20 (no expert added/removed).
- [x] 4.3 Run `pnpm build` and the affected test suites (parity + skill-generation); confirm green.
- [x] 4.4 Run `openspec validate fork-phase1-expert-templates`; confirm valid.
