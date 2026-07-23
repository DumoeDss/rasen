# Fix agent wait liveness (keepalive never actually beat in production)

## Why

Post-fix session audits (f32e0543 / f834a450 / 568626ae, 2026-07-23) show ttl-expiry churn still dominates (e.g. 2.58M of 4.31M churn in 568626ae) on exactly the large-context workers keepalive was built for. Transcript forensics found `rasen agent wait` WAS invoked by workers, but **not one real beat ever completed**:

1. **Stale-signal insta-kill** — a `standDown` signal file left over from a previous park episode (the LEAD wrote it after the prior worker had already exited) is read on the first poll of the NEXT episode, so every new park returns `{standDown, lead-stand-down}` in milliseconds (observed on implementer-1, reviewer-1).
2. **Beat longer than the Bash tool timeout** — the default 270s beat exceeds the harness's default 120s Bash timeout; a worker that doesn't pass an explicit tool `timeout` gets the wait call killed/backgrounded mid-beat (observed on reviewer-2: "moved to the background"), losing both the beat and the outcome.
3. **Context floor blocked adoption** — the 100k floor (user directive 2026-07-24: remove it) makes workers skip parking that would still pay for itself.

## What Changes

- `rasen agent wait` discards any pre-existing signal older than 120s (mtime-based) on the FIRST beat of an episode; fresh signals (the legit LEAD-wrote-resume-just-before-park race) are still delivered; mid-episode signals are always delivered.
- `DEFAULT_BEAT_SECONDS` 270 → 100 so a plain Bash invocation works under the default tool timeout; `--beat-seconds` up to 300 remains, documented as requiring a raised tool timeout.
- `DEFAULT_CONTEXT_FLOOR` 100000 → 0 (gate disabled by default; `keepalive.contextFloor` config can re-enable, now accepting 0).
- Orchestration playbook Step B.4 (template) updated: new default beat + tool-timeout warning, stale-signal grace, no default floor, cap ≈ 20 minutes.

## Impact

- Affected specs: cli-agent-wait
- Affected code: src/core/keepalive/index.ts, src/commands/agent.ts, src/cli/index.ts, src/locales/{en,zh-cn,ja}.json, src/core/config-keys.ts, src/core/config-schema.ts, src/core/templates/workflows/_orchestration.ts
