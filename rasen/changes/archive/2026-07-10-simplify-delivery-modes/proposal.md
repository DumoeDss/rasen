## Why

Three of the five delivery modes (`commands`, `commands-first`, `skills-first`) can produce installs where orchestration commands (`/rasen:auto`, `/rasen:review-cycle`, `/rasen:goal`) are present but silently broken: their LEAD-spawned subagents invoke worker *skills* at runtime, so any mode that deletes skills leaves a command shell with no working engine. The fix-goal-deploy-gap change had to add special-case machinery (skill-only-workflow sparing, delivery-aware drift branches) just to keep `commands-first` from destroying the goal loop — evidence that the mode class itself is the footgun. Collapsing to two modes where skills are always installed kills the entire failure class and lets that machinery be removed.

## What Changes

- **BREAKING** — The delivery setting narrows from five values to two: `skills` (skills only) and `both` (skills + commands, the default). `commands`, `commands-first`, and `skills-first` are removed as configurable values.
- Skills become an unconditional install: every delivery mode installs skill directories; only command generation is optional.
- Legacy config values migrate gracefully on read — `skills-first` → `skills` (semantically equivalent: its dedup removed every command), `commands` → `both`, `commands-first` → `both` — with a one-time console notice and the config file rewritten to the new value. An old value never crashes the CLI.
- The `commands-first` special-case machinery from fix-goal-deploy-gap is removed: skill-dir removal on delivery switch, the `restrictToCommandCounterparts` sparing logic, and the delivery-aware skills-absent drift branch all become dead and are deleted.
- `deduplicateForDelivery` (only non-passthrough for `*-first` modes) is deleted; callers use templates directly.
- The interactive `rasen config profile` delivery picker offers two choices (`both`, `skills`) instead of three.
- Migration inference (`inferDelivery`) maps a detected commands-only install to `both` (skills are restored on the next update) instead of `commands`.
- Docs (`docs/` + `docs/zh`) delivery sections rewritten for the 2-mode system; the "commands-first breaks orchestration" warning becomes obsolete and is replaced by the skills-always-installed guarantee. Supersedes the DOC1 follow-up from fix-goal-deploy-gap.

## Capabilities

### New Capabilities

None — this narrows and hardens existing capabilities; no new spec directory is warranted.

### Modified Capabilities

- `profiles`: delivery dimension narrows to two options (`both`, `skills`); skills are always installed; new requirement for graceful legacy-value migration with a one-time notice; picker and config-schema scenarios updated.
- `cli-init`: command-generation requirement drops the commands-only scenario; delivery cleanup no longer removes skill directories (only command files on `both` → `skills`).
- `cli-update`: delivery-respect requirement drops the `delivery: commands` removal scenario and gains a legacy-value migration scenario; profile-sync and migration scenarios updated (commands-only installs infer `both`).
- `cli-config`: interactive profile flow offers two delivery choices.
- `developer-qa-workflow`: QA scenario list drops the `both -> commands` delivery-cleanup case.
- `skill-sidecar-install`: sidecar-removal scenario no longer cites commands-only delivery (deselection remains the only removal path).

## Impact

- **Code**: `src/core/global-config.ts` (Delivery type narrowing + legacy parse/migration layer), `src/core/config-schema.ts` (zod enum + legacy acceptance), `src/core/init.ts` and `src/core/update.ts` (generation gating, removal-path deletion, summary lines), `src/core/profile-sync-drift.ts` (drift simplification), `src/core/shared/skill-generation.ts` (+ `shared/index.ts`) (`deduplicateForDelivery` deletion), `src/core/migration.ts` (`inferDelivery`), `src/commands/config.ts` (picker choices + display text).
- **Tests**: init/update/profile-sync-drift/global-config/migration/config/config-profile/review-cycle test files — commands-first and commands-only cases repurposed to assert the new invariants (skills always present; legacy values map with notice), keeping the seam coverage.
- **Docs**: `docs/opsx-workflow-guide.md`, `docs/cli.md`, `docs/supported-tools.md`, `docs/glossary.md` + `docs/zh` mirrors — delivery sections only.
- **No template source edits** (`src/core/templates/**` mentions of "delivery" are the unrelated ship pr/push/local modes) → parity hashes must not move.
- **Upstream divergence**: upstream OpenSpec has a 3-mode system (`both|skills|commands`); the `*-first` modes are fork-native. Removing `commands` diverges further from upstream — accepted cost, direction settled.
- **Config compatibility**: existing user configs with any of the three removed values keep working via silent mapping + one-time notice; no telemetry impact (delivery is never reported in telemetry events).
