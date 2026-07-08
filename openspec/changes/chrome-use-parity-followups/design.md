## Context

The vendored chrome-use CDP proxy (`skills/experts/chrome-use/scripts/cdp-proxy.mjs`) drives the user's real Chrome, unlike browse which drove a private headless Chromium. That single architectural difference is the source of all three gaps: the user's Chrome sits behind their machine's HTTP(S) proxy env (Gap 1), agent-created tabs open in the background and never render (Gap 2), and the proxy evaluates JS in a plain (non-REPL) context (Gap 3). The fixes live in two places — the generated expert templates under `src/core/templates/experts/` (parity-hashed) and the vendored proxy + its `cdp-api.md` (not hashed). Live verification is available: a proxy is running on `localhost:3456` with Chrome connected.

## Goals / Non-Goals

**Goals**
- localhost curl examples work on machines with a configured proxy.
- `/perf` returns real LCP/paint on tabs that have been (or can be) foregrounded, and is honest about background tabs.
- `/eval` behavior matches its documentation for bare `await`.
- Regenerate only the affected parity hashes; keep expert count and count assertions untouched.

**Non-Goals**
- No new persistent Chrome window management or tab-focus tracking infrastructure.
- No change to `/snapshot`, `/viewport`, `/responsive`, or the network endpoints.
- No re-litigation of the parity sweep findings (they are LEAD-authoritative input).

## Decisions

### Decision 1 (Gap 1): per-curl `--noproxy '*'`, not a shell-wide env export

Add `--noproxy '*'` to each live `curl` example that targets `localhost:3456`, and add one sentence in the SETUP block and `cdp-api.md` basics explaining that a configured `HTTP(S)_PROXY` otherwise hijacks localhost and returns 502.

Rejected alternative: a single `export no_proxy=localhost,127.0.0.1` in SETUP. It is one line, but it is fragile in exactly this template's usage pattern — agents copy individual example lines and frequently run them in fresh shells or skip SETUP. A self-contained example line that works in isolation is the robust choice here; `--noproxy '*'` bypasses the proxy for that one call regardless of environment. This affirms the LEAD's stated direction, with that rationale.

**Exact curl inventory (which blocks ship, which are dead):**
- `_shared.ts` `CHROME_USE_SETUP` (lines ~100–126): 2 live curls (`/new`, `/close`). **Ships** → 6 experts.
- `_shared.ts` `QA_METHODOLOGY` (~285–566): the QA methodology curls. **Ships** → `qa`, `qa-only`.
- `_shared.ts` `DESIGN_METHODOLOGY` (~567–1366): the design-audit curls. **Ships** → `design-review`.
- `_shared.ts` `DESIGN_SKETCH` (~1367+): the sketch-screenshot curls. **Ships** → `office-hours`.
- `_shared.ts` `CHROME_USE_SNAPSHOT` (~128–151) and `CHROME_USE_ENDPOINTS` (~153–284): **dead exports** — no template imports them (verified: only `CHROME_USE_SETUP`, `QA_METHODOLOGY`, `DESIGN_METHODOLOGY`, `DESIGN_SKETCH` are imported). `CHROME_USE_ENDPOINTS` contains no curl (markdown endpoint table); `CHROME_USE_SNAPSHOT` contains curl examples. Fix `CHROME_USE_SNAPSHOT` for source hygiene so a future importer does not inherit proxy-broken examples, but note it has **zero hash/runtime impact**.
- `chrome-use.ts`: uses `BASE="http://localhost:3456"` + `$BASE/...`; add `--noproxy '*'` to its curls. **Not parity-pinned** (not in the golden maps), but ships as the chrome-use skill — fix for completeness.
- `cdp-api.md`: `$BASE` core-pattern block — add `--noproxy '*'` and a basics note.

### Decision 2 (Gap 2): buffered LCP observer + opt-in `?activate=true` + `visibility` field

Rewrite the `/perf` eval from a synchronous `returnByValue` read into an `awaitPromise: true` Promise-returning IIFE (the same pattern `/eval` and `/resources` already use), doing three things:

1. **LCP via buffered observer.** Replace `getEntriesByType('largest-contentful-paint')` (spec-empty by design) with a `new PerformanceObserver(...).observe({ type: 'largest-contentful-paint', buffered: true })`. With `buffered:true`, any LCP entries already recorded for a tab that was ever foregrounded are delivered on the first callback tick — so this alone fixes LCP for any tab that has rendered at least once, no activation required. Resolve the metrics after a short settle (a `Promise.race` between the first observer callback and a ~400 ms fallback timer) so a tab with no LCP still returns promptly with `lcp: null`. Keep `fp`/`fcp` on `getEntriesByType('paint')` (paint entries persist once a tab has rendered) and `cls`/`longtask`/`navigation`/`resource` reads unchanged.

2. **Opt-in `?activate=true` (default false).** When set, before sampling: call `Target.activateTarget({ targetId })` (browser-level, sessionless — the proxy has no existing `activateTarget` call, this is new) to foreground the tab, then wait ~1200 ms for paint/LCP to occur, then sample. Default (`activate` absent/false) never steals focus — preserving the sticky-proxy "don't disturb the user" principle. `activate=true` is the escalation for a pure-background tab that has never rendered.

   **Restore mechanics — precise and honest.** CDP's `TargetInfo` (from `Target.getTargets`) carries no "focused"/"active" flag, so the proxy cannot reliably determine which tab was frontmost before activation and therefore cannot restore it. The precise behavior is: `activate=true` foregrounds the audited tab and leaves it frontmost; there is no automatic cross-tab restore. This is why it is opt-in and why the `note` field flags it. (Attempting a heuristic restore — e.g., re-activating the first non-audited target — would guess wrong and disturb the user more, so we do not.) See Open Question 1.

3. **`visibility` + `note` fields, always returned.** Add `visibility: document.visibilityState` and, when paint metrics are null because the tab is a non-activated background tab, a `note` string like `"background tab not rendered; paint/LCP null — pass ?activate=true to force a foreground sample"`. This makes the null case self-explanatory rather than looking like a bug.

Live re-verification is mandatory (tasks §5) because this is a real behavioral change on a running proxy: restart the proxy, `curl --noproxy '*' "localhost:3456/perf?target=$TAB"` (expect honest nulls + note on a background tab) and `...&activate=true` (expect populated fp/fcp/lcp).

### Decision 3 (Gap 3): `replMode: true` on `/eval`

Add `replMode: true` alongside the existing `awaitPromise: true` in the `/eval` `Runtime.evaluate` params (one line). replMode gives DevTools-console semantics, so a bare top-level `await fetch(...)` evaluates directly without the `(async()=>{...})()` wrapper — matching what `cdp-api.md` already promises. **Tradeoff (one line):** replMode evaluates each call as an independent console entry, so `let`/`const` bindings still do not persist across separate `/eval` calls (already true today, since each call is a fresh evaluate) — no regression, just no new cross-call state. Update `cdp-api.md` `/eval` section with a bare-`await` example. Keep `awaitPromise: true` (needed so a returned Promise's value is unwrapped).

### Decision 4: exactly which parity hashes regenerate

Six expert skills transitively include a changed shared curl block. Each has **two** entries to regenerate — a `getXSkillTemplate` entry in `EXPECTED_FUNCTION_HASHES` and an `openspec-X` entry in `EXPECTED_GENERATED_SKILL_CONTENT_HASHES`:

| Skill | Changed block(s) | Function-hash key | Content-hash key |
|---|---|---|---|
| benchmark | CHROME_USE_SETUP | `getBenchmarkSkillTemplate` | `openspec-benchmark` |
| design-consultation | CHROME_USE_SETUP | `getDesignConsultationSkillTemplate` | `openspec-design-consultation` |
| design-review | CHROME_USE_SETUP + DESIGN_METHODOLOGY | `getDesignReviewSkillTemplate` | `openspec-design-review` |
| office-hours | CHROME_USE_SETUP + DESIGN_SKETCH | `getOfficeHoursSkillTemplate` | `openspec-office-hours` |
| qa | CHROME_USE_SETUP + QA_METHODOLOGY | `getQaSkillTemplate` | `openspec-qa` |
| qa-only | CHROME_USE_SETUP + QA_METHODOLOGY | `getQaOnlySkillTemplate` | `openspec-qa-only` |

Regenerate only these 12 entries. Do not touch other skills' hashes, the expert count (19), or any count assertion. `chrome-use.ts` is not in either golden map, so its Gap 1 edits do not require a hash change. Regenerate by running the parity test, reading the actual hashes from the failure diff, and pasting them in (do not hand-compute).

## Risks / Trade-offs

- **`activate=true` disrupts the user's foreground.** Mitigated by making it opt-in (default off), documenting it in `cdp-api.md`, and surfacing it via the `note` field. The buffered-observer fix means most real cases (a tab the agent navigated and screenshotted, hence foregrounded at least once) get LCP without ever needing `activate`.
- **Proxy restart re-triggers CDP authorization.** Editing `cdp-proxy.mjs` requires restarting the proxy to take effect, which can re-prompt Chrome's "Allow" popup. Live verification must account for it (the machine currently connects without a popup; if it hangs, wait for the user to click Allow).
- **Windows test flake.** CLI-spawning vitest cases (`cli-e2e`, `artifact-workflow`) can EBUSY/timeout-flake; re-run in isolation before treating a failure as a regression.

## Migration Plan

No user migration. Template hash changes are internal to the parity test; vendored proxy/doc changes ship with the next skill sidecar install. Delivery is a local commit scoped to this change's files.

## Open Questions

1. **Focus restore after `activate=true`.** Deferred: CDP exposes no reliable focused-tab signal, so we ship no automatic restore and document the disruption. If this proves annoying in practice, a future change could track the last agent-activated target within the proxy and offer a `restore=true` best-effort — out of scope here.
