## 1. Gap 1 — `--noproxy '*'` on curl examples

- [x] 1.1 In `src/core/templates/experts/_shared.ts` `CHROME_USE_SETUP` (~100–126), add `--noproxy '*'` to the 2 live curls (`/new`, `/close`) and add one sentence noting a configured `HTTP(S)_PROXY` otherwise hijacks `localhost` (502).
- [x] 1.2 In `_shared.ts` `QA_METHODOLOGY` (~285–566), add `--noproxy '*'` to every `curl localhost:3456` example.
- [x] 1.3 In `_shared.ts` `DESIGN_METHODOLOGY` (~567–1366), add `--noproxy '*'` to every `curl localhost:3456` example.
- [x] 1.4 In `_shared.ts` `DESIGN_SKETCH` (~1367+), add `--noproxy '*'` to its curl examples.
- [x] 1.5 In `_shared.ts` `CHROME_USE_SNAPSHOT` (~128–151, a dead export — no importer, zero hash/runtime impact), add `--noproxy '*'` for source hygiene. (`CHROME_USE_ENDPOINTS` has no curl — skip.)
- [x] 1.6 In `src/core/templates/experts/chrome-use.ts`, add `--noproxy '*'` to its `$BASE/...` curl examples (not parity-pinned; edited for completeness).
- [x] 1.7 In `skills/experts/chrome-use/references/cdp-api.md`, add `--noproxy '*'` to the `$BASE` core-pattern curls and a one-line basics note about the proxy caveat.

## 2. Gap 2 — `/perf` buffered LCP + opt-in activate + visibility

- [x] 2.1 In `skills/experts/chrome-use/scripts/cdp-proxy.mjs` `/perf` block (~1333–1367), rewrite the eval to `awaitPromise: true` Promise-returning IIFE: read LCP from `new PerformanceObserver(...).observe({type:'largest-contentful-paint', buffered:true})` with a `Promise.race` between first callback and a ~400ms fallback; keep `fp`/`fcp` on `getEntriesByType('paint')` and cls/longtask/nav/resource reads unchanged.
- [x] 2.2 Add `visibility: document.visibilityState` to the `/perf` response, and a `note` string when paint metrics are null on a non-activated background tab (explaining it wasn't rendered and that `activate=true` forces a foreground sample).
- [x] 2.3 Add opt-in `?activate=true` handling to `/perf`: when set, call `Target.activateTarget({targetId})` (browser-level, sessionless), wait ~1200ms, then sample; when absent/false, do not change tab focus. No automatic focus restore (CDP exposes no focused-tab signal — see design Open Question 1).
- [x] 2.4 Update `skills/experts/chrome-use/references/cdp-api.md` `/perf` section (~204–205) to document `activate`, the `visibility`/`note` fields, and the background-tab paint caveat.
- [x] 2.5 If any methodology template prose overpromises `/perf` paint on background tabs (`_shared.ts` `DESIGN_METHODOLOGY`/`QA_METHODOLOGY` around the `/perf` calls), add the background-tab/activate caveat per the `chrome-use-expert-methodology` delta.
- [x] 2.6 `node --check skills/experts/chrome-use/scripts/cdp-proxy.mjs`.

## 3. Gap 3 — `/eval` bare top-level await

- [x] 3.1 In `cdp-proxy.mjs` `/eval` block (~743–760), add `replMode: true` alongside the existing `awaitPromise: true` in the `Runtime.evaluate` params.
- [x] 3.2 Update `cdp-api.md` `/eval` section (lines 39–40 and the `/eval` 使用提示 ~215–221) with a bare top-level `await` example and confirm the "支持 await" claim now matches the implementation.

## 4. Parity hash regeneration + build

- [x] 4.1 `pnpm build`.
- [x] 4.2 Run `pnpm vitest run test/core/templates/skill-templates-parity.test.ts`; from the failure diff, copy the actual hashes into `EXPECTED_FUNCTION_HASHES` and `EXPECTED_GENERATED_SKILL_CONTENT_HASHES` for exactly these 6 skills (12 entries): benchmark, design-consultation, design-review, office-hours, qa, qa-only. Do not touch any other skill's hash or any count assertion.
- [x] 4.3 Re-run the parity test until green; run `pnpm vitest run` for `skill-generation` and `skill-sidecar-install` to confirm no collateral drift.

## 5. Live re-verification (running proxy on localhost:3456)

- [x] 5.1 Restart the proxy process so the `cdp-proxy.mjs` edits take effect (watch for a Chrome "Allow" popup; wait for the user to click Allow if it hangs).
- [x] 5.2 `TAB=$(curl --noproxy '*' -s "localhost:3456/new?url=https://example.com" | jq -r .targetId)`; then `curl --noproxy '*' "localhost:3456/perf?target=$TAB"` — expect a `visibility` field and, for an unrendered background tab, `null` paint with the explanatory `note`.
- [x] 5.3 `curl --noproxy '*' "localhost:3456/perf?target=$TAB&activate=true"` — expect populated `fp`/`fcp`/`lcp` after the foreground sample.
- [x] 5.4 `curl --noproxy '*' -sX POST "localhost:3456/eval?target=$TAB" -d "await fetch('https://example.com').then(r => r.status)"` — expect `{ value: 200 }`, not an `Uncaught SyntaxError`.
- [x] 5.5 Close the test tab: `curl --noproxy '*' "localhost:3456/close?target=$TAB"`.

## 6. Validate

- [x] 6.1 `openspec validate chrome-use-parity-followups` — resolve any errors.
- [x] 6.2 Confirm expert count is still 19 and no count assertions changed.
