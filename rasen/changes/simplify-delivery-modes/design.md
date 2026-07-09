## Context

The delivery setting controls HOW workflows are installed. Upstream OpenSpec defines a 3-mode system — `Delivery = 'both' | 'skills' | 'commands'` (verified against the `upstream-main` mirror's `src/core/global-config.ts`). This fork added `skills-first` and `commands-first` in commit 52bb5ca (gstack fusion). The modes that delete skills (`commands`, `commands-first`) conflict with a fork architectural fact: orchestration commands embed a playbook whose subagents invoke worker *skills* at runtime, so those modes install commands that are silently broken. fix-goal-deploy-gap (archived 2026-07-10) papered over one instance with special-case machinery: `removeSkillDirs(dir, restrictToCommandCounterparts)` in both `init.ts` and `update.ts`, and a delivery-aware skills-absent else-branch in `profile-sync-drift.ts` that spares skill-only workflows under `commands-first`. This change removes the mode class and the machinery with it. The direction (5 → 2, skills always installed) is user-approved and settled.

Current consumer surface (exhaustively enumerated; every `delivery`/`Delivery` reference in `src/` outside `src/core/templates/**`):

| Consumer | Role today | Change |
| --- | --- | --- |
| `src/core/global-config.ts:15` | `Delivery` union (5 values), `DEFAULT_CONFIG.delivery='both'`, `getGlobalConfig()` raw JSON read (no enum validation), `saveGlobalConfig()` | Narrow union to `'skills' \| 'both'`; add legacy normalization in `getGlobalConfig()` (map + one-time notice + persist) |
| `src/core/config-schema.ts:17-20` | zod enum (5 values) used by `validateConfig` (`config set`/`config edit` paths) | Enum narrows to 2 with a legacy-acceptance layer so old values validate instead of erroring |
| `src/core/init.ts:631-643,685-729,818-825,931` | gating flags, `deduplicateForDelivery`, commands-only skill removal, `commands-first` restricted removal, `skills-first` command removal, summary counts, `removeSkillDirs` | Skills generated unconditionally; commands gated on `both`; delete `removeSkillDirs` + both `*-first` branches; drop dedup call |
| `src/core/update.ts:112-118,191-195,234-242,263-270,296-301,433` | same shape as init (gating, dedup, removal branches, summary lines, `removeSkillDirs`) | Same deletions; keep `removeUnselectedSkillDirs` (profile deselection) and `removeCommandFiles` on `both`→`skills` |
| `src/core/profile-sync-drift.ts:109-234,278-301` | `hasToolProfileOrDeliveryDrift` skills else-branch (`commands`/`commands-first` expectations incl. skill-only sparing), `getToolsNeedingProfileSync`, `hasProjectConfigDrift` include flags | Skills side always required; commands side checked iff `both`; else-branch deletes |
| `src/core/shared/skill-generation.ts:276-290` (+ re-export `shared/index.ts:31`) | `deduplicateForDelivery` — only non-passthrough for `*-first` | Delete function + re-export; callers unwrap |
| `src/core/migration.ts:75-83,126-128` | `inferDelivery`: commands-only artifacts → `'commands'` | commands-only → `'both'` (skills restored on next update); both/skills arms unchanged |
| `src/commands/config.ts:27-33,93-103,154-169,259-264,464-473,497-570,616-618` | `ProfileState.delivery`, picker with 3 choices (both/skills/commands), display strings, diff lines | Picker offers 2 choices; helper text "skills, commands, or both" → two-mode wording; rest is type-driven |
| `src/core/profiles.ts:5` | comment only ("delivery determines HOW") | No code change |

Non-consumers, verified: `src/core/archive.ts` and all `src/core/templates/**` "delivery" mentions are the unrelated *ship* delivery modes (pr / push / local) — grep for `skills-first|commands-first|delivery` across templates matched only ship-delivery text, so **no template edits and no parity-hash movement**. Telemetry (`src/telemetry/*`) never reports the delivery value — no ingest-schema impact. Main specs never adopted the `*-first` modes (zero grep hits in `rasen/specs/`); they still describe the upstream 3-mode contract, so deltas modify 3-mode text, not 5-mode text.

## Goals / Non-Goals

**Goals:**
- `Delivery` is exactly `'skills' | 'both'`; the compiler surfaces every consumer (no wide type left behind).
- Skills are always installed for selected workflows; no code path removes a skill directory because of delivery.
- Existing configs holding any removed value keep working: silent mapping (`skills-first`→`skills`; `commands`/`commands-first`→`both`), a one-time notice, config persisted with the new value. Never crash on an old value.
- fix-goal-deploy-gap's delivery special-casing (restricted skill removal, drift else-branch, dedup) is deleted, with its regression tests repurposed to pin the new invariants.
- Docs delivery sections (docs/ + docs/zh) describe the 2-mode system.

**Non-Goals:**
- No re-litigation of the collapse itself (user-approved direction).
- No template source edits (`src/core/templates/**`); parity hashes must not move.
- No general docs pass — delivery sections only.
- No change to profile semantics (WHICH workflows), `removeUnselectedSkillDirs`, or the ship pr/push/local delivery axis.
- No version bump, no CHANGELOG edit in this change (CHANGELOG is another session's in-flight file; the entry line is recorded as a ship-log follow-up).

## Decisions

**D1 — Type narrowing with a separate legacy layer.** `export type Delivery = 'skills' | 'both'` in `global-config.ts`, plus `type LegacyDelivery = 'commands' | 'skills-first' | 'commands-first'` and a `normalizeDelivery(raw: unknown): { delivery: Delivery; legacy?: LegacyDelivery }` helper owned by `global-config.ts`. Alternative — keep the 5-value union and guard at call sites — rejected: the whole point is that the compiler finds every consumer; a wide type keeps the footgun compilable.

**D2 — Migrate on read, inside `getGlobalConfig()`, persisting immediately.** `getGlobalConfig()` is the single funnel every consumer reads through (it does raw `JSON.parse` with no enum validation today, so legacy values currently flow through unchecked). When it sees a legacy value it maps it, prints one stderr-style notice (e.g. `Note: delivery mode 'commands-first' has been consolidated into 'both' (skills are always installed). Your config has been updated.`), and calls `saveGlobalConfig()` with the mapped value. Persisting at that moment is what makes the notice genuinely one-time — the next read finds the new value — with no extra "seen" flag to store. Alternatives: (a) rewrite only on next explicit write — leaves the legacy value in the file indefinitely and requires notice-dedup state; (b) notice without rewrite — nags every run. Guard: persistence is best-effort (wrapped in try/catch like the rest of config IO); if the write fails the mapping still applies in-memory and the notice may repeat, which is acceptable degradation. Unknown/garbage values (not in either set) fall back to the default `'both'` without persisting — same as today's undefined handling, and it avoids clobbering a hand-edited file over a typo the user should see and fix.

**D3 — zod schema accepts-and-normalizes legacy values.** `config-schema.ts` delivery becomes the 2-value enum `.or()` a legacy enum with a `.transform()` to the mapped value. `validateConfig` runs on `config set`/`config edit` whole-file validation — if it rejected legacy values, a user with an old config file couldn't set an unrelated key (`rasen config set featureFlags.x true` validates the whole merged object). Explicit `rasen config set delivery commands-first` is therefore also accepted-and-mapped rather than rejected — uniform "never crash on an old value" behavior; the read-path notice still explains what happened. Alternative — reject explicit sets of legacy values with an error naming the two valid values — rejected for splitting behavior across entry paths.

**D4 — Delete `deduplicateForDelivery`, don't keep it as identity.** The `*-first` modes were its only non-passthrough cases. Callers (init.ts ×2, update.ts ×1) use the template lists directly. Its tests retarget to the invariant that skills and commands lists are independent under `both`. Keeping an identity function would preserve a name whose contract no longer exists.

**D5 — Removal paths that survive.** Exactly two artifact-removal paths remain delivery/profile-driven: `removeCommandFiles` when delivery is `skills` (the `both`→`skills` switch), and `removeUnselectedSkillDirs`/deselected-command cleanup for profile deselection. `removeSkillDirs` (both copies, init.ts and update.ts) is deleted outright along with its `restrictToCommandCounterparts` parameter and the "Removed: N skill directories (delivery: commands)" summary lines. The skill-sidecar uninstall contract now rides only the deselection path.

**D6 — `inferDelivery` maps commands-only installs to `both`.** A pre-profile-era project with only command files gets `delivery: 'both'`; the next `rasen update` regenerates the missing skills. That is the desired healing behavior (skills forced back), not data loss. Alternative — infer `skills`— nonsensical (would delete the user's commands).

**D7 — Drift semantics under the 2-mode system.** `hasToolProfileOrDeliveryDrift`: skill files are forward-required for every selected workflow regardless of delivery; command artifacts are forward-required iff delivery is `both` and the tool has an adapter; a command file present under `skills` delivery is drift (triggers removal sync). The entire skills-absent else-branch (including the `commands-first` skill-only sparing logic) deletes. `hasProjectConfigDrift` include flags become `includeSkills = true`, `includeCommands = delivery === 'both'`.

**D8 — Docs scope.** Rewrite the delivery enumerations and the now-obsolete "commands/commands-first breaks orchestration" warnings into the skills-always-installed guarantee: `docs/opsx-workflow-guide.md` §5 (+ zh mirror lines 283-285), `docs/supported-tools.md` artifact list ("Skills (always)"), `docs/cli.md` delivery examples (already 2-mode-compatible; verify only), `docs/glossary.md` command-file entry wording. `docs/migration-guide.md` line 147 is generic and stands. Historical docs (`grill-gstack-absorption.md`, handoff docs, `brand-independence-status.md` — another session's untracked file) are not touched.

## Risks / Trade-offs

- **[Config write-on-read side effect]** `getGlobalConfig()` gains a one-time write. → Bounded: fires only when a legacy value is present, at most once (post-write reads see the new value); best-effort try/catch so a read can never fail because persistence did; tests isolate global config via `XDG_CONFIG_HOME` already (`test/helpers/run-cli.ts`).
- **[Further upstream divergence]** Upstream keeps 3 modes incl. `commands`; future upstream cherry-picks touching init/update/config delivery code will conflict. → Accepted cost, direction settled; the delta is well-localized and this design.md documents the mapping for conflict resolution.
- **[Users who deliberately chose commands-only]** Their skills reappear on next update and the mode can't be re-selected. → Intended behavior (that mode shipped broken orchestration); the one-time notice states the consolidation; commands remain installed under `both`, so nothing they used is removed.
- **[Test repurposing could silently drop seam coverage]** The commands-first regression tests from fix-goal-deploy-gap pinned real seams (skill-only workflow survival, drift sparing). → Repurpose, don't delete: same fixtures now assert skills-always-present and legacy-value migration; profile-deselection removal coverage (`removeUnselectedSkillDirs`) is kept as-is.
- **[Parity movement would signal an accidental template edit]** → Verified zero install-delivery mentions in `src/core/templates/**`; the verification tail runs the parity test expecting zero movement; if it moves, stop and investigate rather than pasting hashes.
- **[Shared working tree]** Other sessions have in-flight edits (store/work series, package.json 0.1.1, CHANGELOG). → Ship with explicit pathspec + `git show --stat`; never touch CHANGELOG here (follow-up line recorded in ship-log instead). Known-external: update.test.ts's hardcoded `0.1.0` assertion fails against package.json 0.1.1 — owned by another session, not this change.

## Migration Plan

User-facing: nothing to do. Old config values are mapped on the first CLI run that reads global config, a single notice explains the consolidation, and the config file is rewritten. Projects previously on a skills-deleting mode regain their skills on the next `rasen init`/`rasen update`. Rollback is reverting the commit; a rewritten config file (`delivery: 'both'`) remains valid under the old 5-value schema, so rollback is safe.

## Open Questions

None. All planning-context MUST-VERIFY items are resolved above (upstream origin: fork added `*-first` on top of upstream's 3-mode set; consumer table exhaustive; type narrowing per D1; parse/migration per D2/D3; docs scope per D8; telemetry unaffected).
