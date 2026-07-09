# Review Report — fork-phase1-expert-templates (A2)

**Reviewer:** reviewer-a2 (independent; did not author)
**Branch:** dev-harness
**Scope reviewed:** `src/core/templates/experts/_shared.ts`, `browse.ts`, `qa.ts`, `qa-only.ts`, `design-review.ts`, `design-consultation.ts`, `benchmark.ts`, `office-hours.ts`, `navigator.ts`, `test/core/templates/skill-templates-parity.test.ts`. Ignored concurrent B2 noise (`src/telemetry/*`, `package.json`, `pnpm-lock.yaml`, telemetry-backend, openspec bookkeeping). `verify-enhanced.ts` confirmed untouched (verified no-op per task 3.3).

**Verdict: APPROVE.** No Blockers, no Majors. One Minor and two Trivials, all in LLM-guidance prose that is self-correcting in use. Spec-conformant, endpoint-faithful, browse frozen correctly, tests regenerated exactly.

---

## Evidence by review dimension

1. **Spec conformance (6 requirements):** All met.
   - Browser experts use `curl localhost:3456/...`, zero `$B` — verified by grep (none in `_shared.ts` or the 7 consumers; the one `grep '\$B'` hit is `$BRANCH` in office-hours:408, a shell var).
   - SETUP runs `check-deps.mjs` + establishes/reuses `$TAB` via `/new` — `CHROME_USE_SETUP` in `_shared.ts:100-125`.
   - Endpoint reference names/params match `cdp-api.md` and the shipped proxy.
   - `/snapshot` mode=i|C|D documented (`CHROME_USE_SNAPSHOT`).
   - Responsive/perf coverage preserved (`/viewport`, `/responsive`, `/perf`); no long-task overpromise.
   - Navigator points to `/chrome-use`.

2. **Endpoint fidelity:** Every endpoint used exists in `cdp-proxy.mjs`: `/new`, `/navigate` (+`hard_reload`), `/back`, `/info`, `/close`, `/eval`, `/click`, `/clickAt`, `/setFiles`, `/scroll`, `/wait`, `/text`, `/attribute`, `/resources`, `/iframes`, `/console/enable`+`/console` (`level`), `/cookies` GET/POST, `/localStorage`, `/perf`, `/network/*`, `/screenshot` (`file`,`full`,`format`,`retries`), `/viewport` (`width`,`height`,`scale`,`mobile`), `/responsive` (`screenshot`,`dir`), `/snapshot` (`mode`). No `/fill` used — form fill routed through `/eval`; clicks via `/click`/`/clickAt`. Confirmed against proxy source lines and cdp-api.md.

3. **Zero browse residue:** Confirmed. No `$B`, no `.openspec/browse`, no "browse binary/daemon" in rewritten blocks or consumers. Remaining `playwright`/`headless`/`open` hits are unrelated: `playwright.config.*` in the TEST_BOOTSTRAP framework-detection table, and design-consultation:260 "headless environment" refers to the OS `open` command lacking a display — not a headless browser.

4. **browse.ts freeze integrity:** PASS. Inline `BROWSE_SETUP`/`SNAPSHOT_FLAGS`/`COMMAND_REFERENCE` in `browse.ts` are byte-identical to the pre-change `_shared.ts` (compared against removed lines in the `_shared.ts` diff). Proof: `openspec-browse` and `getBrowseSkillTemplate` parity hashes are unchanged in the test AND the parity suite passes green — the two must agree, so the copy is exact.

5. **Methodology coherence:** Complete workflow preserved — SETUP → tab via `/new` → `$TAB` threaded through every curl example → `/close` when done; sticky-proxy "never stop it" guidance present; snapshot mode=D before/after pattern retained; responsive/viewport audit steps intact; "Read the screenshot file so the user sees it" guidance preserved and retargeted. `/perf` text lists LCP/FCP/CLS + resource/nav timing and omits long-task counts (honors D5). See Minor-1 for the one nuance.

6. **Test adequacy:** PASS. Exactly 7 skills regenerated in BOTH maps (benchmark, design-consultation, design-review, navigator, office-hours, qa, qa-only); browse and verify-enhanced untouched. `pnpm build` green; `skill-templates-parity.test.ts` (6 tests) + `skill-generation.test.ts` (38 tests, expert count still 20) green; `openspec validate` reports valid.

---

## Findings

### Minor
- **[Minor] `_shared.ts:301-306` (QA_METHODOLOGY "Detect the running app" loop)** — The port probe uses `[ "$(curl .../info?target=$TAB | jq -r .ready)" = "complete" ]` to decide an app is running. `document.readyState` reaches `complete` even on Chrome's connection-refused error page, so the check is a near-constant true and the loop effectively always reports the first port (:3000) rather than the first port with a live server. The prior browse form relied on `goto`'s exit code. Impact is limited — this is agent guidance, and the agent sees the error page on navigation and self-corrects — so not a blocker. Consider a content-based signal (e.g. `/eval` checking `document.body.innerText` is non-empty / title is not an error string) if tightened later.

### Trivial
- **[Trivial] `_shared.ts` console filtering** — `curl "/console?target=$TAB&level=error"` matches only `level==='error'`; the old browse `console --errors` also surfaced warnings. The proxy's `level` filter is single-exact-match, so error+warning can't be one call. Low-value loss (errors are the primary QA signal).
- **[Trivial] `_shared.ts:645` responsive output files** — `/responsive?...&dir=` writes `responsive-{mobile,tablet,desktop}.png`; the prose says "Read all of them" without naming the files. The endpoint's JSON response returns the written paths, so the agent can recover them; naming them inline would be marginally clearer.

---

## Concurrency note
Ran build + targeted vitest in isolation; no EBUSY/dist flake observed. B2's telemetry edits did not interfere.
