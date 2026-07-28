## 1. Core config plumbing

- [x] 1.1 `src/core/keepalive/index.ts`: add `beatSeconds` to `KeepaliveConfig`/`KeepaliveConfigInput`/`DEFAULT_KEEPALIVE_CONFIG` (default 270); `resolveKeepaliveConfig` accepts integers 90–280 and falls back to the default otherwise; add `DEFAULT_CONFIG_BEAT_SECONDS = 270` (or equivalent) and update the `DEFAULT_BEAT_SECONDS` doc comment to describe it as the no-config fuse
- [x] 1.2 `src/core/config-keys.ts`: register `keepalive.beatSeconds` (scopes `['global']`, type number, validate integer 90–280, defaultValue 270, group `Pipelines`, description via locale string)
- [x] 1.3 `src/core/config-schema.ts`: add `beatSeconds: z.number().int().min(90).max(280).optional()` to the keepalive block
- [x] 1.4 Locales `src/locales/{en,zh-cn,ja}.json`: description string for `keepalive.beatSeconds` (and any new CLI help string keys). Do not touch unrelated in-flight locale edits from other sessions

## 2. CLI wait resolution

- [x] 2.1 `src/commands/agent.ts` `wait()`: resolve beat as `options.beatSeconds ?? keepalive.beatSeconds` (from `resolveKeepaliveConfig`), still clamped to `MAX_BEAT_SECONDS`; keep the 100 fuse inside `resolveKeepaliveConfig`'s out-of-range fallback path per design D1
- [x] 2.2 `src/cli/index.ts` `--beat-seconds` help text: state resolution order (flag > `keepalive.beatSeconds` config, default 270) and that beats over the shell tool default timeout require raising the tool timeout; mirror in `src/core/completions/command-registry.ts` if it carries a description

## 3. Playbook templates (A–D)

- [x] 3.1 `src/core/templates/workflows/_orchestration.ts` Step B.4: (A) require park dispatch wording to name Bash `timeout: 330000` in the same sentence as the wait call, replacing the "if you raise --beat-seconds you MUST also pass a larger timeout" conditional framing; update the beat-length prose to reflect config-driven beats (default 270 via `keepalive.beatSeconds`, 100 fuse)
- [x] 3.2 Step B.4: (B) add beat-silence discipline — on `{beat}` emit no text/deliberation, immediately re-issue the identical wait call; (C) add prompt stand-down discipline — LEAD writes `standDown` the moment the worker is done; 12-beat cap described as stop-loss backstop only
- [x] 3.3 (D) Merge long-command warming into the existing long-task discipline wording in the shared template: >~2 min or unknown-duration commands → `run_in_background` + bounded foreground polling (interval ≤270s), both rationales (lost notifications, cache refresh per poll); short commands stay foreground
- [x] 3.4 Verify the reuse horizons / stand-down text stays consistent with the worker-reuse-orchestration delta (no contradictory "20 minutes" style durations left — recompute the ≈ minutes figure for the cap at default beat, or drop it)

## 4. UI (packages/ui)

- [x] 4.1 Add `KeepaliveBeatControl` component (new file under `packages/ui/src/components/`): presets 100 (fast) / 270 (economy, default) + custom 90–280 numeric input, effective-value-driven selection, derived tool-timeout hint (beat + 50s, informational), writes/unset via the same config API path as `AUTOPILOT_KEYS` rows (`ConfigEntryRow`/Defaults cell plumbing)
- [x] 4.2 Wire it into `packages/ui/src/components/PipelinesPage.tsx` Defaults section after the autopilot keys, sourced from `byKey('keepalive.beatSeconds')`, respecting scope-mode visibility (global-only key)
- [x] 4.3 UI tests following existing PipelinesPage/Defaults test patterns: preset write, custom write, out-of-range rejection, hint derivation, effective-value selection state

## 5. Tests

- [x] 5.1 `test/core/keepalive.test.ts`: `resolveKeepaliveConfig` beatSeconds — unset → 270, in-range accepted, out-of-range/non-integer → 100 fuse (per cli-agent-wait delta)
- [x] 5.2 `test/commands/agent-wait.test.ts`: resolution priority — explicit flag > config > default; config 90–280 honored; MAX cap still clamps
- [x] 5.3 Config-keys round-trip / registry tests: `keepalive.beatSeconds` set/unset/validation messages, schema round-trip through global scope
- [x] 5.4 `test/core/templates/skill-templates-parity.test.ts`: after template edits, run the parity test to harvest and refill BOTH hash tables (`EXPECTED_FUNCTION_HASHES` + `EXPECTED_GENERATED_SKILL_CONTENT_HASHES`)

## 6. Build and verification

- [x] 6.1 `pnpm build` (dist refresh — required before any `node bin/rasen.js` CLI verification; don't run concurrently with tests)
- [x] 6.2 CLI smoke: `rasen config set keepalive.beatSeconds 120 --scope global`, `rasen config get`, and a short `rasen agent wait --change <tmp> --role smoke` verifying resolution (then unset)
- [x] 6.3 Full suite `pnpm test` (Windows: known CLI-spawn EBUSY flakes — isolate and re-run per established discipline; enumerate any FAIL list fully before attributing to flake)
- [x] 6.4 `packages/ui`: `pnpm build` + `pnpm test` inside the package
- [x] 6.5 Commit hygiene: locale files carry another session's uncommitted edits — stage with explicit pathspecs (`git commit -- <paths>`) and audit the diff ownership
