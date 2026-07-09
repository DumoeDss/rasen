## Context

`src/core/templates/experts/_shared.ts` holds the browse-coupled content that expert templates inline. Browser experts import these constants and reference the `$B` browse binary. A1 shipped chrome-use (vendored CDP proxy on `localhost:3456`, self-contained `chrome-use.ts` template, endpoints incl. `/snapshot?mode=i|C|D`, `/perf`, `/viewport`, `/responsive`). A2 rewrites the shared blocks + consumers to drive chrome-use; A3 then deletes browse.

Verified structure:
- Shared blocks (line numbers): `BROWSE_SETUP` :101-118, `SNAPSHOT_FLAGS` :121-154, `COMMAND_REFERENCE` :157-244, `QA_METHODOLOGY` :325-601, `DESIGN_METHODOLOGY` :603-932, `DESIGN_SKETCH` :1402-1458. 60 `$B` occurrences in `_shared.ts`, concentrated in the methodology blocks.
- Constant consumers (imports of the browse blocks): `benchmark.ts` (BROWSE_SETUP), `browse.ts` (BROWSE_SETUP, SNAPSHOT_FLAGS, COMMAND_REFERENCE), `design-consultation.ts` (BROWSE_SETUP), `design-review.ts` (BROWSE_SETUP, DESIGN_METHODOLOGY), `office-hours.ts` (DESIGN_SKETCH), `qa.ts` (BROWSE_SETUP, QA_METHODOLOGY), `qa-only.ts` (BROWSE_SETUP, QA_METHODOLOGY). Prose-only: `navigator.ts` (`/browse` bullet at :53), `verify-enhanced.ts` (generic "browser" mentions).
- Parity test `test/core/templates/skill-templates-parity.test.ts`: two manually-pinned maps — `EXPECTED_FUNCTION_HASHES` (:57, sha256 of raw template payloads) and `EXPECTED_GENERATED_SKILL_CONTENT_HASHES` (:103, sha256 of `generateSkillContent(t,'PARITY-BASELINE')`). Lists are explicit (`GENERATED_SKILL_FACTORIES` :139). No env auto-update: the test fails printing actual vs expected; the fix is to paste the new hashes for changed skills.
- Expert count assertions live in `test/core/shared/skill-generation.test.ts` (4 assertions at 20 — A1 durable finding 1). A2 adds/removes no experts → unchanged.

## Goals / Non-Goals

**Goals:**
- Rewrite the 6 shared browse blocks to chrome-use curl endpoints + `targetId` lifecycle, preserving snapshot/perf/viewport/responsive coverage.
- Update the 6 rewrite-class + 2 prose-class consumer templates.
- Keep endpoint names/params exactly matching the shipped proxy / `cdp-api.md`.
- Freeze `browse.ts` so the build compiles and A3 can delete it cleanly.
- Regenerate parity hashes for changed templates.

**Non-Goals:**
- Deleting browse or touching `browse-integration` spec / `package.json` / `skills/experts/browse/` — A3.
- Adding/removing experts, or changing the count assertions.
- Editing A1's `chrome-use.ts` (already self-contained) or the vendored proxy.
- Re-optimizing methodology substance beyond the browse→chrome-use transport swap.

## Decisions

**D1 — Freeze `browse.ts` via inline copies (chosen over keeping renamed constants importable).** Move the current text of `BROWSE_SETUP`, `SNAPSHOT_FLAGS`, and `COMMAND_REFERENCE` into `browse.ts` as file-local constants and drop its imports of them from `_shared.ts`. Because the inlined strings are byte-identical to today's, `browse`'s generated output — and therefore both its parity hashes — is unchanged. This fully removes browse content from `_shared.ts` (so A3's `_shared.ts` cleanup is nil) and localizes the dead code to the one file A3 deletes wholesale. The alternative (keep old constant names as frozen aliases in `_shared.ts`) leaves browse debt in a shared file and gives A3 extra cleanup; rejected.

**D2 — Rename the rewritten shared blocks to chrome-use names.** After D1, the `_shared.ts` blocks are free to become chrome-use content. Rename for clarity: `BROWSE_SETUP` → `CHROME_USE_SETUP`, `SNAPSHOT_FLAGS` → `CHROME_USE_SNAPSHOT`, `COMMAND_REFERENCE` → `CHROME_USE_ENDPOINTS` (methodology block names `QA_METHODOLOGY`/`DESIGN_METHODOLOGY`/`DESIGN_SKETCH` stay — they are not browse-branded). Update the 6 rewrite-class consumers' imports accordingly. (browse.ts no longer imports these — D1.)

**D3 — Endpoint mapping (`$B` → curl), applied consistently everywhere.** Canonical map (see `cdp-api.md` for full params):
- `$B goto <url>` → open/reuse a tab: `TAB=$(curl -s "localhost:3456/new?url=<url>" | jq -r .targetId)` then reuse `target=$TAB`; subsequent nav `curl "localhost:3456/navigate?target=$TAB&url=<url>"`.
- `$B snapshot -i|-C|-D` → `curl "localhost:3456/snapshot?target=$TAB&mode=i|C|D"`.
- `$B click <sel>` → `curl -X POST "localhost:3456/click?target=$TAB" -d '<sel>'` (or `/clickAt` for real mouse).
- `$B fill <sel> <val>` → `/eval` (no `/fill` endpoint): `curl -X POST "localhost:3456/eval?target=$TAB" -d 'document.querySelector("<sel>").value="<val>"'`.
- `$B js "<expr>"` → `curl -X POST "localhost:3456/eval?target=$TAB" -d '<expr>'`.
- `$B screenshot <path>` → `curl "localhost:3456/screenshot?target=$TAB&file=<path>&full=true"`.
- `$B viewport WxH` → `curl "localhost:3456/viewport?target=$TAB&width=W&height=H"`.
- `$B responsive <prefix>` → `curl "localhost:3456/responsive?target=$TAB"` (writes per-breakpoint screenshots).
- `$B console --errors` → `curl "localhost:3456/console/enable?target=$TAB"` then `curl "localhost:3456/console?target=$TAB&level=error"`.
- `$B perf` → `curl "localhost:3456/perf?target=$TAB"`.
- `$B text` → `/text?target=$TAB&selector=`; `$B url` → `/info?target=$TAB`; `$B links` → `/eval` extraction; `$B cookie-import` → `/cookies` POST.
The "Read the screenshot file so the user sees it" guidance (currently after `$B screenshot`/`responsive`) is preserved verbatim, retargeted to the curl output files.

**D4 — `targetId` lifecycle in SETUP.** `CHROME_USE_SETUP` runs `node "${CLAUDE_SKILL_DIR}/scripts/check-deps.mjs"` (ensures Chrome/Node/proxy), then establishes `TAB` via `/new`, notes the sticky proxy (never stop it), per-`targetId` isolation, and `/close?target=$TAB` when done. Matches A1's chrome-use.ts SETUP conventions.

**D5 — `/perf` long-task caveat (A1 accepted Minor).** Where `$B perf` appears (DESIGN_METHODOLOGY perf audit, benchmark), the rewritten text lists LCP/FCP/CLS/resource-timing and either omits long-task counts or explicitly caveats that long-task counts require an active PerformanceObserver and may report 0. No methodology promises numbers the endpoint cannot deliver.

**D6 — Prose-class edits are minimal and scanned, not invented.** `navigator.ts:53` `/browse` "headless Chromium" bullet → a chrome-use bullet (CDP-driven real Chrome; exact invocation name verified against A1's registration). `verify-enhanced.ts` is scanned for browse-specific wording (browse binary, playwright, headless); its current mentions are generic "browser"/`/qa` and likely need no change — if so it is a verified no-op and its hash is left untouched.

**D7 — Parity hash regeneration procedure.** After edits: run `pnpm vitest run test/core/templates/skill-templates-parity.test.ts`; it fails listing actual vs expected for each changed skill. For every changed template, copy the new sha256 into `EXPECTED_FUNCTION_HASHES` (payload changed) and/or `EXPECTED_GENERATED_SKILL_CONTENT_HASHES` (generated content changed). Expected changed: `openspec-qa`, `openspec-qa-only`, `openspec-design-review`, `openspec-design-consultation`, `openspec-benchmark`, `openspec-office-hours`, `openspec-navigator` (+ `openspec-verify-enhanced` only if D6 edits it). `openspec-browse` must NOT change (D1) — if it does, the inline copy diverged and must be corrected rather than re-hashed.

## Risks / Trade-offs

- **Accidentally changing browse output** → D1 requires byte-identical inline copies; guard = browse's two parity hashes stay green without editing them. If browse's hash changes, fix the copy, don't re-pin.
- **Endpoint name/param drift from the shipped proxy** → D3 pins names to `cdp-api.md`; spec requires consistency; reviewer can diff against the vendored proxy's 404 help.
- **Ref model mismatch** (browse `@e`/`@c` refs vs chrome-use selector-based clicks) → methodology uses CSS selectors / `/eval` for interaction; snapshot `mode=i|C` provides the interactive inventory. Acceptable; slightly different ergonomics, same capability.
- **Large mechanical diff (60 `$B` sites)** → risk of a missed `$B`; mitigation task: final `grep -rn '\$B' src/core/templates/experts/_shared.ts` must return only browse.ts-local (none in _shared after rewrite) and no consumer template retains `$B`.
- **Hash churn hides a real regression** → regenerate only the intended skills; any unexpected skill in the diff is a signal, not a paste target.

## Migration Plan

1. D1: inline the three browse constants into `browse.ts`, drop its `_shared` imports; confirm build + browse parity hashes unchanged.
2. Rewrite `_shared.ts` blocks (rename per D2, remap per D3-D5).
3. Update the 6 rewrite-class consumers' imports/wording; apply D6 prose edits.
4. `grep` sweep for residual `$B` / browse wording in `_shared.ts` and the 8 consumers.
5. Regenerate parity hashes (D7); run parity + skill-generation count tests + `pnpm build`.
6. Rollback: revert `_shared.ts`, the consumers, and the hash maps together (single logical change).

## Open Questions

- Exact chrome-use invocation label navigator should use (skill name vs a command) — verify against A1's registration during implementation; default to describing "the chrome-use expert (CDP real Chrome)".
- Whether `office-hours.ts` needs more than the `DESIGN_SKETCH` swap (it imports only DESIGN_SKETCH among the browse blocks) — confirm no other `$B`/browse prose in its body during edit.
