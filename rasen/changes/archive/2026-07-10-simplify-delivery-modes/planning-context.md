# Planning Context — simplify-delivery-modes

Seeded by the LEAD, 2026-07-10. User-proposed design direction, LEAD-assessed and user-approved ("开始吧"). The planner turns this into artifacts; the DIRECTION is settled — do not re-litigate the mode collapse itself.

## User intent (approved direction)

**交付模式从 5 收敛到 2：skills 必须装，commands 可选。**
- New mode set: `skills`（只装 skills）| `both`（skills + commands；维持现默认，`global-config.ts:33` DEFAULT_CONFIG.delivery='both'）。
- Removed: `commands`, `commands-first`, `skills-first`。
- Rationale: orchestration commands (/rasen:auto, /rasen:review-cycle, /rasen:goal) embed ORCHESTRATION_PLAYBOOK whose LEAD-spawned subagents invoke worker SKILLS at runtime — a delivery mode that deletes skills leaves the command installed but silently broken. Killing the mode class kills the footgun class (supersedes DOC1 follow-up from fix-goal-deploy-gap's ship-log).

## Migration mapping (LEAD-assessed, user saw and approved)

- `skills-first` → `skills`（语义等价：每个命令都有 skill 替身，skills-first 的 dedup 会移除全部命令 → 实际就是 skills-only，零损失）
- `commands` → `both`（用户要命令，命令保留，skills 强制回归）
- `commands-first` → `both`（同上）
- Graceful on read: old value in global config silently mapped + ONE-TIME notice printed (e.g. "delivery 'commands-first' has been consolidated into 'both'"); config file rewritten to the new value on next write (or on read — planner decides, prefer least-surprise). NEVER crash on an old value.

## Expected simplification payoff (verify each during propose)

The fix-goal-deploy-gap change (ship f0d3547, archived 2026-07-10-fix-goal-deploy-gap) added special-case machinery for "modes that delete skills" — with those modes gone, it can be REMOVED/simplified back:
1. `removeSkillDirs(skillsDir, restrictToCommandCounterparts)` param in BOTH update.ts and init.ts copies — the commands-first call sites disappear entirely (no mode deletes skills anymore → the whole removeSkillDirs-on-delivery-switch path may go; KEEP whatever is needed for delivery-switch healing both→skills? No: skills are never removed. The only removal that survives is removeCommandFiles when switching both→skills, and removeUnselectedSkillDirs for profile deselection).
2. `hasToolProfileOrDeliveryDrift` (profile-sync-drift.ts): the skills else-branch (delivery without skills) becomes dead — skills are ALWAYS required; the commands side checks only under `both`. The delivery-aware else-branch complexity from fix-goal-deploy-gap round 3 largely deletes.
3. `deduplicateForDelivery` (shared/skill-generation.ts): *-first modes were its only non-passthrough cases → function reduces to passthrough; planner decides delete-vs-keep-as-identity (prefer delete + update callers, unless test surface says otherwise).
4. Regression tests from fix-goal-deploy-gap: commands-first-specific tests (update.test.ts, init.test.ts, profile-sync-drift.test.ts) are REPURPOSED to assert the new invariants (skills always present; old-value migration works), not deleted wholesale — keep the seam coverage.

## MUST-VERIFY during propose (planner homework)

1. **Upstream origin of the 5-mode system**: check whether delivery modes came from upstream OpenSpec v1.5 or are fork-native (git log / upstream-main branch has the mirror). If upstream code, note the cherry-pick friction in design.md as an accepted cost — the direction is settled regardless.
2. **All Delivery consumers** (grep `Delivery` type + `delivery` config reads): known surface = global-config.ts (type + default + parse), init.ts (prompt + generation gating), update.ts (generation gating + removal paths + shouldGenerateSkills/Commands), profile-sync-drift.ts (drift), config.ts (deliveryChoices UI + display), shared/skill-generation.ts (deduplicateForDelivery), command-generation adapters?, telemetry config-shape events?, migration.ts?. Enumerate exhaustively; each gets a row in design.md.
3. **Type narrowing**: `Delivery` union type — narrow to `'skills' | 'both'` with a separate `LegacyDelivery` for the parse/migration layer, so the compiler finds every consumer (preferred over keeping the wide type).
4. **Zod/schema validation** if any (global config parse) — old values must parse into the legacy layer, not fail validation.
5. **Docs**: delivery-modes mentions in docs/ (+ docs/zh mirror) need the 2-mode rewrite — IN SCOPE for this change (it supersedes DOC1; keep it to the delivery sections, not a general docs pass).
6. **Telemetry**: if delivery value is reported in telemetry events, the new value set must not break the ingest schema (likely free-form string — verify).

## Constraints (repo conventions, unchanged)

- CLI not on PATH: `node dist/cli/index.js <args>`; `pnpm build` broken (workspace fault) → use `node build.js`; update/init read dist, build before live verification.
- NO template source edits expected (`src/core/templates/**`) → NO parity hash movement; if parity moves, STOP and investigate. EXCEPTION: if any template TEXT mentions delivery modes (grep first), that's a template edit + parity hand-paste — planner must scope it explicitly if found.
- Shared working tree has other sessions' in-flight edits (store/work series: src/commands/work.ts, src/core/work-migration.ts, store runtime files, package.json 0.1.1, CHANGELOG). NEVER stage/commit outside this change's surface; ship with explicit pathspec + `git show --stat`.
- Version discipline: NEVER bump version (user-owned); CHANGELOG entry for the mode consolidation goes under the CURRENT unreleased section ONLY if that's the repo convention — check how previous changes handled CHANGELOG; if CHANGELOG is currently another session's in-flight file (it IS modified in the tree), DO NOT touch it — record the needed entry line in ship-log follow-up instead.
- Ship local mode (commit only, no push).
- Windows EBUSY/ENOTEMPTY test flakes known non-regression; update.test.ts '0.1.0' hardcoded assertion vs package.json 0.1.1 is a known-external failure owned by another session.
- Absolutes need scope clauses; no unmapped vocabularies.

## Model assignment (user directive 2026-07-10)

planner/propose = fable; ALL other roles (implementer, reviewer, fixer, shipper) = sonnet.

## Planner findings (appended by planner-1, 2026-07-10; all MUST-VERIFY items resolved)

1. **Upstream origin verdict**: upstream OpenSpec (`upstream-main` mirror, `src/core/global-config.ts:12`) has a THREE-mode system `'both' | 'skills' | 'commands'`. The `*-first` modes are fork-native (commit 52bb5ca, gstack fusion). Removing `commands` diverges further from upstream — noted in design.md Risks as accepted cost.
2. **Templates clean**: grep `skills-first|commands-first|delivery` across `src/core/templates/**` matches ONLY the unrelated ship delivery axis (pr/push/local) in ship/archive/auto/apply/navigator/_orchestration templates. NO template mentions install delivery modes → NO template edits, parity expects ZERO movement.
3. **Telemetry clean**: `src/telemetry/*` never reports the delivery value; no ingest-schema impact.
4. **Main specs never adopted the 5-mode system**: zero grep hits for `*-first` in `rasen/specs/` — specs still describe upstream's 3-mode contract. Deltas therefore modify 3-mode text. Six capabilities get deltas: profiles (3 MODIFY + 1 ADDED legacy-migration req), cli-init (2 MODIFY), cli-update (2 MODIFY), cli-config (1 MODIFY: Schema Validation accepts legacy), developer-qa-workflow (1 MODIFY: smoke list), skill-sidecar-install (1 MODIFY: uninstall scenario). `opsx-goal-command` needs NO delta — its deploy requirement names only `both` delivery, never commands-first.
5. **Parse layer fact**: `getGlobalConfig()` does raw JSON.parse with NO enum validation (legacy values already flow through unchecked); zod (`config-schema.ts`) validates only on `config set`/`config edit` whole-file writes. Migration design: normalize inside `getGlobalConfig()` with immediate best-effort persist (makes the notice one-time without a seen-flag); zod enum narrows with `.or(legacyEnum).transform()` so a legacy value in the file never blocks unrelated `config set` writes. Unknown/garbage values → default `'both'`, NOT persisted.
6. **`deduplicateForDelivery` has no direct test references** (only init.ts ×2, update.ts, shared/index.ts re-export) → delete cleanly, unwrap callers.
7. **Interactive picker already offers only 3 choices** (both/skills/commands — `src/commands/config.ts:542-558`); the `*-first` modes were config-file-only. Picker goes to 2.
8. **dist/ is volatile in the shared tree** (another session rebuilt it mid-planning; momentarily absent). Implementer: always `node build.js` before live verification and expect transient MODULE_NOT_FOUND if racing another session.
