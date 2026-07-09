# Review Report: relocate-machine-home

Reviewer: reviewer-relocate-home (adversarial, non-author). Scope: uncommitted diff on `src/core/global-config.ts`, `src/cli/index.ts` (adoptLegacyMachineData call-site hunk only — a foreign `--project` flag hunk in the same file was excluded), `src/core/index.ts`, `src/core/project-home.ts`, `src/core/workspace-migration.ts`, `src/commands/doctor.ts`, `src/core/relationship-health.ts`, plus the listed tests and 5 docs.

## Verdict (Round 1): DONE_WITH_CONCERNS — no blockers; 1 Major, 2 Minor, 2 Trivial findings. Ship-able after LEAD triage of the Major.

## Verdict (Round 2, current): CLEAN — M1/m1/m2 all genuinely fixed and regression-tested; see "Round 2 — delta re-review" below. No new issues introduced by the fix delta. Ship-able.

## Test evidence (re-verified independently)

All counts reproduced live, matching tasks.md's claims exactly:
- `test/core/global-config.test.ts`: 52/52 pass
- `test/core/relationship-health.test.ts`: 10/10 pass
- `test/telemetry/config.test.ts`: 17/17 pass
- `test/core/store/foundation.test.ts`: 22/22 pass
- `test/commands/doctor.test.ts`: **21/21 pass** (tasks.md's "20/21, the 1 failure is the foreign `type` field" — that foreign test now also passes; the concurrent store-registry session's fix appears to have landed since apply-time)

## Verified safe (adversarial trace, not just re-reading the author's claims)

1. **Never-overwrite is real.** `adoptChildrenInto` (global-config.ts:296-327) is the *only* write path in the adoption chain. Its sole guard, `fs.existsSync(destChild)) continue`, gates every subsequent write (`mkdirSync`/`cpSync`/`renameSync`). Traced all three: none can reach an existing target child.
2. **Per-child atomicity holds under the two-process race the design calls out.** temp-name-then-rename means a crash between copy and rename never leaves a partial child at its real name; a losing racer's `renameSync` onto an already-populated dest throws (caught → warning), never corrupts. Confirmed by direct code trace, matches design.md Risks §1.
3. **Chain ordering (`rasen`-scheme wins over `openspec`-scheme when both exist) is correct and deliberate** — `adoptOneScheme` (global-config.ts:335-343) unambiguously prefers `oldRasenDir`, only falling to `oldOpenspecDir` when the first is absent. Matches design D2 step 3. (Untested directly — see Minor #3.)
4. **Idempotence confirmed** both by test (`is idempotent: a second run changes nothing further`) and by code trace: second run's `existsSync(destChild)` is true for every previously-adopted child, so it's a true no-op even when the old dir gains new content between runs.
5. **Env-override skip is symmetric and centralized.** All four surfaces — `getGlobalDataDir`, `getGlobalConfigDir`, `adoptLegacyMachineData`, `checkMachineRootRelocation` — route through the single `resolveRasenHome()` helper, and `adoptLegacyMachineData` additionally gates data vs. config adoption independently on `XDG_DATA_HOME`/`XDG_CONFIG_HOME` respectively (global-config.ts:373, 384). No asymmetry found.
6. **Blank RASEN_HOME is genuinely neutralized end-to-end.** `resolveRasenHome`'s `raw.trim() === ''` check treats blank as unset; `test/helpers/run-cli.ts`'s `mergeEnv(process.env, {...RASEN_HOME: ''}, options.env)` applies sources in order with later ones winning, so an ambient real `RASEN_HOME` is blanked by default and a test's own `options.env.RASEN_HOME` still wins when a test opts in. Verified the merge order in code, not just the comment.
7. **Doctor's probe is genuinely read-only.** `checkMachineRootRelocation` (global-config.ts:415-450) calls only `fs.existsSync`/`statSync`/`readdirSync` — no write syscall anywhere in the function. `doctor.ts`'s new call site wraps it in try/catch and never writes. Confirmed by test (`Doctor is read-only: the blocking file and the old dir are both untouched`).
8. **JSON mode isn't corrupted.** `relocation` is an unconditionally-populated field on `MachineHomeHealth`, printed via the single `printJson(health)` call (doctor.ts:335); all warnings go through `console.error` → stderr, never stdout. No interleaving risk.
9. **Grep for remaining LOCALAPPDATA/APPDATA/`.local/share` references** outside `global-config.ts` across `src/` and `scripts/`: only one hit, a stale docstring in `src/telemetry/config.ts` (see Major finding below) — no postinstall/completions hits.

## Findings

### Major

**M1. `src/telemetry/config.ts`'s own, untouched legacy-telemetry-merge mechanism bypasses `RASEN_HOME`/XDG entirely, and this change's default-path shift newly activates it in the default case on every platform.**

`getLegacyConfigPath()` (telemetry/config.ts:37-39) is hardcoded to `path.join(os.homedir(), '.config', 'rasen', 'config.json')` — it never consults `RASEN_HOME`, `XDG_CONFIG_HOME`, or any override. `migrateLegacyTelemetryConfig` (telemetry/config.ts:92-121) short-circuits only when `configPath === legacyConfigPath` (line 98).

- **Before this change**, on POSIX, the old default `getGlobalConfigDir()` result *was* `~/.config/rasen` — identical to `getLegacyConfigPath()` — so this merge was a guaranteed, permanent no-op on POSIX (dead code in the default case). It only ever fired when `XDG_CONFIG_HOME` was explicitly set (its designed use case: migrate from `~/.config/rasen` to a newly-set XDG dir).
- **After this change**, the default becomes `~/.rasen` on *all* platforms, so `configPath` (`~/.rasen/config.json`) now differs from `legacyConfigPath` (`~/.config/rasen/config.json`) even in the plain default case — the exact case `adoptLegacyMachineData` also targets. In the common flow this is harmless (adoption runs first in `runCli()` and copies the whole `config.json`, so telemetry fields are already present by the time `readConfig()` runs). But when **`RASEN_HOME` is set** — an explicit override that spec.md's ADDED requirement says "SHALL be ignored" for XDG and design.md frames as "nothing relocates" — `getLegacyConfigPath()` still unconditionally points at `~/.config/rasen/config.json`. If a fresh `RASEN_HOME`-scoped `config.json` is missing telemetry fields and a stray `~/.config/rasen/config.json` happens to exist on that machine (e.g. leftover from before the user set `RASEN_HOME`, or from an unrelated old install), `readConfig()` silently pulls `anonymousId`/`noticeSeen` from it and **persists** them into the `RASEN_HOME`-scoped config — a real violation of "env override disables adoption" for those two fields, via a code path this change never touched or audited.
- Blast radius is low (an anonymous UUID and a boolean, not sensitive data, and not project data), which is why I'm calling it Major rather than Blocker. But it's a genuine, silent contract violation newly exposed by the default-path shift, on a file explicitly in scope for the "grep for remaining old-scheme references" check in my brief — and it's untested (none of the reviewed test files exercise `RASEN_HOME` + a stray `~/.config/rasen/config.json`).
- Also stale: the docstring above `getConfigPath()` (telemetry/config.ts:123-130, "Follows XDG Base Directory Specification and platform conventions... Windows fallback: `%APPDATA%/openspec/`") no longer describes actual behavior at all post-change.
- **Recommendation:** either make `getLegacyConfigPath()` route through the same `resolveRasenHome`-aware precedence (so it's skipped whenever an override is active, matching `adoptLegacyMachineData`'s contract), or fold this mechanism into `adoptLegacyMachineData` outright and delete it — it now substantially overlaps that function's job. Out of this change's stated file scope, so flagging for LEAD triage rather than fixing.

### Minor

**m1. `checkMachineRootRelocation`'s `targetHasContent` is a coarse "target dir is non-empty" check, not "this old dir's children are present in target."** (global-config.ts:429: `isExistingDirectory(target) && fs.readdirSync(target).length > 0`). If the target already has *unrelated* content (or a prior adoption partially failed on one child, which fires a separate loud `console.error` at the time but leaves no persistent record), doctor can report an old-scheme directory as "safe to delete after verifying" even though not all of its children actually made it into the target. Mitigated by the "after verifying" hedge in the message text, but untested: `test/core/global-config.test.ts:643-684`'s `checkMachineRootRelocation` describe block only covers the two extremes (empty target vs. a target that received exactly the old dir's content), never "target has other content, old dir's content is only partially present."

**m2. No test exercises the "both old-scheme dirs exist simultaneously" precedence tie-break**, despite this being explicitly called out as a thing to verify. The code is correct (see Verified-safe #3 above), but `test/core/global-config.test.ts`'s `adoptLegacyMachineData` block (lines 510-641) never seeds both `oldRasenDir` and `oldOpenspecDir` at once to assert the `rasen`-wins outcome directly — the one openspec-hop test (line 525) explicitly sets up "no rasen-scheme dir exists," so it doesn't cover the tie-break.

### Trivial

**t1. Orphaned `.adopt-tmp-*` directories can accumulate in the target root** if the process is hard-killed between `fs.cpSync` and `fs.renameSync` inside `adoptChildrenInto` (global-config.ts:309-313) — a crash (not a caught JS exception) skips the `catch` block's cleanup entirely. Nothing on any later run sweeps stale `.adopt-tmp-*` entries (each run computes a fresh name via `Date.now()`/`process.pid`). No overwrite or correctness risk — the real child name is never touched, so re-adoption still proceeds correctly — just disk litter in `~/.rasen` that neither adoption nor doctor ever cleans up.

**t2. design.md's Risks section ("if unusable, warn and fall back to `~/.rasen`") is imprecise relative to the actual/spec'd/tested behavior**, which falls through to the *next-lower* precedence tier (XDG alias if set, else `~/.rasen`), confirmed by `test/core/global-config.test.ts:170-180` ("falls back to XDG and warns when RASEN_HOME points at an existing file"). Not a code defect — spec.md's own wording ("fall back to the default") is compatible with the real behavior — just a design-doc wording nit.

## Spec conformance

Both delta spec files (`global-config`, `project-registry`) match the implementation and are exercised by tests scenario-for-scenario: default-everywhere, RASEN_HOME-overrides-everything, XDG-alias-retained, both adoption chain scenarios, no-adoption-over-existing-content, env-override-disables-adoption, failure-is-loud-but-not-fatal, and all three doctor relocation states. No spec drift found.

## Docs

All 5 touched docs (`cli.md`, `customization.md`, `opsx.md`, `opsx-workflow-guide.md`, `stores-beta/user-guide.md`) accurately reflect the new `~/.rasen` default + `RASEN_HOME` override + XDG-alias-retained story. `docs/zh/*` (untouched, per scope) are now stale relative to English, consistent with this repo's established practice of syncing zh docs in a later pass — not treating as a new defect.

---

## Round 2 — delta re-review

Scope: fix delta only, on top of round-1 context. Files: `src/core/global-config.ts`, `src/telemetry/config.ts`, `test/core/global-config.test.ts`, `test/telemetry/config.test.ts`. Confirmed via `git status --porcelain` that the delta touches exactly these four files, nothing more.

### M1 — telemetry legacy-merge bypassing RASEN_HOME: FIXED, correctly scoped

- `resolveRasenHome` is now exported from `global-config.ts` (`src/core/global-config.ts:94`) and imported into `telemetry/config.ts`.
- `migrateLegacyTelemetryConfig` now opens with `if (resolveRasenHome(process.env) !== undefined) return config;` (telemetry/config.ts:107-109) — an explicit `RASEN_HOME` now hard-skips the legacy merge before any read of the stray `~/.config/rasen/config.json` path, closing exactly the leak my original finding described.
- **Walked the XDG_CONFIG_HOME-set case concretely, per the ask.** `getLegacyConfigPath()` is `path.join(os.homedir(), '.config', CONFIG_DIR_NAME, CONFIG_FILE_NAME)` — hardcoded, **never** derived from `XDG_CONFIG_HOME`. So when `XDG_CONFIG_HOME=/custom/xdg-config` is set: `configPath` = `/custom/xdg-config/rasen/config.json`, `legacyConfigPath` = `~/.config/rasen/config.json` — these are different paths (unless `XDG_CONFIG_HOME` happens to literally equal `~/.config`, an edge case that was already a no-op before this whole feature existed). This is **not new behavior introduced by relocate-machine-home** — `~/.config/rasen` was *also* the value `getLegacyConfigPath()` produced before this change, and it was *also* disconnected from `XDG_CONFIG_HOME` before this change; the XDG-set branch has always pulled from the hardcoded legacy path regardless of the XDG value, both before and after the default-scheme shift. The author's framing ("this mechanism's original, still-intended use case") is accurate: a user setting `XDG_CONFIG_HOME` for the first time is precisely the persona this merge was built for — carrying `anonymousId`/`noticeSeen` out of the pre-XDG default and into their newly-chosen location. Verified `mergeLegacyTelemetry` only fills fields that are `undefined` on the current side (telemetry/config.ts:76-78) — it can't clobber an already-set value, XDG-triggered or not.
- **Residual tension, not a bug:** the new `adoptLegacyMachineData` contract states symmetrically that *either* `RASEN_HOME` *or* the respective XDG variable disables adoption "for that resolution" (spec.md's "Env override disables adoption" scenario). The telemetry legacy-merge, by design, does **not** honor that symmetry for `XDG_CONFIG_HOME` — only for `RASEN_HOME`. This is defensible (see above: it's the pre-existing, narrower, non-destructive, fill-gaps-only mechanism this change didn't create and correctly left alone once the RASEN_HOME leak was closed), but it does mean "no adoption occurs when an XDG override is set" is not literally true machine-wide once you count this 2-field telemetry path. Downgrading to **Trivial** (documentation/mental-model nuance, not a functional problem) — no concrete failure scenario, no data clobber, matches pre-existing intended behavior.
- Stale docstring confirmed fixed: `getConfigPath()`'s docstring now correctly delegates to `getGlobalConfigDir()`'s real precedence (telemetry/config.ts:137-142) instead of the old "Windows fallback: `%APPDATA%/openspec/`" text.
- Regression test verified: `does not merge from the stray legacy path when RASEN_HOME is set (relocate-machine-home M1 regression)` (test/telemetry/config.test.ts:125-145) seeds a stray legacy config, sets `RASEN_HOME`, and asserts `config.telemetry` is `undefined` and the `RASEN_HOME`-scoped `config.json` is never even written. Correct and matches the fix.

**M1 verdict: closed.** The reported contract violation (RASEN_HOME leak) is fixed and regression-tested. The XDG asymmetry is real but is pre-existing, deliberate, non-destructive, and doesn't reopen the finding — downgraded to Trivial for the record, not carried forward as an open Minor/Major.

### m1 — coarse `targetHasContent` check: FIXED

- New `oldDirFullyPresentIn(oldDir, target)` (global-config.ts:301-311) replaces the old "target is non-empty" check with a genuine per-child presence check: every top-level child of `oldDir` must exist (by name) under `target`; an `oldDir` with zero children trivially counts as adopted (sensible edge case — nothing to verify). This is the right fix and matches `adoptChildrenInto`'s own existence-based never-overwrite semantics, so the two mechanisms now agree on what "adopted" means.
- Two new unit tests confirmed present and correct: `reports pending, not lingering, when the target is non-empty but holds only UNRELATED content (review m1)` (line 708) and `reports pending, not lingering, when adoption partially failed (some but not all children present)` (line 723) — both seed exactly the scenarios my original finding described and assert `targetHasContent: false` for both.
- **On the missing CLI-level doctor test for this state:** agree with the author's judgment call. I looked for a non-flaky construction and couldn't find one better than what they already have. The team lead's suggested probe — seed the target with a same-named file where a child dir should be — doesn't actually produce a *partial-failure* state: `adoptChildrenInto`'s `if (fs.existsSync(destChild)) continue` guard fires on any existing entry regardless of type, so a pre-seeded file at that name is silently *skipped* (already covered by the existing "never overwrites an existing child" test), not failed. Forcing a genuine partial failure (some children copy, one specific child's copy throws) deterministically and cross-platform at the CLI/subprocess level would need something like an unreadable source child or a broken symlink — exactly the class of construction the author already ruled out as Windows-unreliable (`chmod` doesn't reliably restrict access on Windows, and directory symlinks need elevation/Developer Mode). The existing CLI-level `doctor.test.ts` "warns loudly when relocation failed" test already proves the full pipeline wiring (adoption failure → doctor's pending/failed report) end-to-end for the *total*-failure case; the new unit tests directly exercise the exact function whose logic changed (`oldDirFullyPresentIn`) for the *partial* case. Between the two, the risk this finding cared about — doctor asserting "safe to delete" when it isn't fully true — is soundly covered. Not blocking on a CLI-level test that would likely trade determinism for marginal coverage.

**m1 verdict: closed.**

### m2 — no test for the both-old-dirs-exist tie-break: FIXED

- `prefers the rasen-scheme old dir over its openspec sibling when both exist simultaneously (review m2)` (test/core/global-config.test.ts:642-663) seeds the rasen-scheme dir with a `projects/` child and the openspec-scheme dir with a *different*, non-overlapping `stores/` child, then asserts the rasen-scheme content lands in the target AND the openspec-scheme's `stores/` never appears at all. This is exactly the right construction — non-overlapping children make "rasen wins outright" and "rasen and openspec get merged" mutually distinguishable outcomes, closing the ambiguity my original finding flagged.

**m2 verdict: closed.**

### Test evidence (re-verified live)

- `test/core/global-config.test.ts`: 55/55 pass (was 52; +3 matches the 3 new tests: M1 doesn't touch this file, m1 adds 2, m2 adds 1)
- `test/telemetry/config.test.ts`: 18/18 pass (was 17; +1 matches the M1 regression test)
- `test/commands/doctor.test.ts`: 21/21 pass (unchanged, not part of this delta — confirmed still green)
- `test/core/relationship-health.test.ts`: 10/10 pass (unchanged, not part of this delta — confirmed still green)
- `git status --porcelain` confirms the delta touched exactly the 4 claimed files, nothing more.

### Round 2 verdict: CLEAN — all three findings (M1, m1, m2) genuinely fixed and correctly regression-tested. No new issues introduced by the fix delta. Ship-able.
