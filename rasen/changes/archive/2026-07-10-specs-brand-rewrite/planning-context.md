# Planning Context — specs-brand-rewrite

Seeded by the LEAD, 2026-07-10. Source of truth for the propose stage.

## User intent (verbatim)

"主 specs 混词——113 个 spec.md 中 86 个含旧词，41 个属明确漂移需回写；这个是主要修复内容，开个rasen:auto small-feature修复吧。"

Full task framing: rasen/specs/ 下 113 个 spec.md 中 86 个含 openspec/opsx 旧词。修复目标：
1. **41 个明确漂移文件**——SHALL 正文仍写 openspec- dirName（如 `add-grill-expert-skills/spec.md:33,38` 要求 `openspec-codebase-design`，实际模板已生成 `rasen-*`）、`openspec init`、`/opsx:` 命令引用、"OpenSpec branding" 表述（`ai-tool-paths/spec.md:4`、`branding-migration/spec.md:4`）等，需回写为 rasen 品牌，使 specs 与已 rebrand 的代码一致。
2. **6 个含 `.openspec.yaml`/`.openspec-store` 元数据引用的文件**——逐条甄别，CHANGELOG 0.1.1 "Not rebranded (intentional)" 清单为准据：`.openspec.yaml` 文件名、`format: 'openspec'`/`'openspec-change'` 格式标识、legacy 检测字面量是**有意保留**——引用这些的 spec 文本**不改**。
3. **其余无害提及**（描述上游、迁移语境的合法引用）保留。

## LEAD findings so far (2026-07-09 survey, planner MUST re-derive the authoritative file list)

- Counts (86/41/6) come from a survey grep — treat as approximate; planner re-greps `rasen/specs/**/spec.md` for `openspec|opsx` (case-insensitive) and builds the authoritative adjudication table.
- Drift classes observed: (a) `openspec-<skill>` dirName requirements vs actual `rasen-<skill>` generation; (b) `openspec init` / `openspec update` CLI invocations vs actual `rasen` bin; (c) `/opsx:` slash-command references vs `/rasen:` (current code generates ONLY `/rasen:*`; opsx exists solely as LEGACY_COMMAND_PREFIX in detection/cleanup, `command-file-id.ts:25-73`); (d) prose like "OpenSpec branding" describing the pre-rebrand state as current.
- Legitimate references that MUST survive: upstream-facing prose (describing OpenSpec-the-upstream-project), migration-context references (`openspec/` legacy workspace dir, `rasen migrate` semantics), the intentional non-rebranded identifiers (`.openspec.yaml`, `format: 'openspec'`, `.openspec-store` legacy literal, `openspec_root_missing` diagnostic code, `OPENSPEC_DIR_NAME` alias), and env vars if any specs mention `OPENSPEC_TELEMETRY` (check actual code before touching).
- CHANGELOG 0.1.1 (top entry, renamed from 0.2.0 on 2026-07-10) "Not rebranded (intentional)" is the adjudication basis for class (2).

## Constraints

- **Specs-only change**: edits land in `rasen/specs/**` main specs (this is a conformance rewrite — the CODE is the truth, specs are brought to match it). No `src/` edits, no template edits, no parity churn expected. If the planner discovers a spec whose requirement is BEHAVIORALLY wrong (not just brand-worded), record it as out-of-scope follow-up, do not fix code here.
- **Delta-spec mechanics**: this change rewrites MAIN specs directly?? NO — decide in design: main specs are normally only touched by archive/sync. Options: (a) delta specs per affected capability with MODIFIED requirements then sync; (b) direct main-spec edit justified as brand conformance (precedent: docs/zh alignment?). Planner adjudicates and documents; lean (b) direct edit ONLY if the workflow supports it, else (a). NOTE: 86 capabilities' worth of deltas is heavy — consider a scoped approach: fix the 41 clear-drift files' wording in place via a single change whose tasks enumerate them, with validation via `rasen validate --specs`.
- **Shared working tree**: другие sessions' in-flight edits exist (`archive-change.ts`, `ship.ts` uncommitted — sha-stamping draft; do NOT touch/stage). Every commit MUST use explicit pathspec (`git commit -- rasen/specs/...`) + `git show --stat` verification.
- **Wording discipline** (from prompt-audit-fixes): any NEVER/ALWAYS/MANDATORY must carry a scope clause; do not introduce new unmapped vocabularies; brand rewrite must not change requirement SEMANTICS — behavior-neutral wording only.
- Windows: CLI is `node dist/cli/index.js <args>` (not on PATH). Build not needed for specs-only work.
- Runtime directive (user, 2026-07-10): all non-propose workers run on **sonnet**; planner inherits session default.

## Planner findings (appended 2026-07-10, propose stage complete)

- **Authoritative survey**: 907 occurrences across **86** files (not 41). Command-invocation drift (`openspec <verb>`) is pervasive across inherited CLI/schema specs, so the honest touched-file count is ~78 REWRITE/MIXED + ~8 KEEP-only. The "41" figure counted only the egregious dirName/slash/prose drift. Full per-file adjudication table lives in `design.md` (7 batches).
- **Code truth pinned (verified against src)**: bin/pkg `rasen`; `/rasen:*` only (`opsx` = LEGACY_COMMAND_PREFIX in command-file-id.ts:25-73); dirNames `rasen-<base>` collapsed (skill-name-prefix:45); workspace `rasen/` only; config/data dir `rasen` (global-config.ts GLOBAL_CONFIG_DIR_NAME/GLOBAL_DATA_DIR_NAME='rasen', LEGACY_BRAND_DIR_NAME='openspec'); telemetry env `RASEN_TELEMETRY` (telemetry/index.ts:99). **cli-feedback/spec.md:118,170 `OPENSPEC_TELEMETRY` is DRIFT** (contradicts telemetry/spec.md:36 + code) → REWRITE to RASEN_TELEMETRY.
- **MECHANICS DECISION (D1, important)**: `rasen validate <change>` HARD-FAILS a zero-delta change ("Change must have at least one delta"). So pure direct-edit is invalid in this system. Chose: **direct in-place edits to rasen/specs/** for the ~78-file bulk rewrite + ONE honest ADDED governance delta** (`spec-brand-consistency`, a real testable requirement whose scenario is the corpus-grep gate). NOT full delta-then-sync (would need ~78 verbatim MODIFIED restatements — detail-loss + misrepresents wording fix as behavior change). Consequence: the ~78 direct edits happen at APPLY and will NOT show in `rasen show --deltas-only`; archive syncs only the one delta (creates spec-brand-consistency/spec.md), no double-application.
- **RULESET is subtractive** (design D3): rewrite all POSITIVE brand claims (R1-R7); KEEP 7 classes (K1-K7). **Highest risk = negative assertions (K5)**: specs that require an openspec/opsx token to be ABSENT/inert (command-generation:71, rasen-cli-identity, skill-name-prefix rename FROM-side + L41/57, remove-* asserted-absent dirNames, dead-stub/eureka literals) — blanket find-replace would INVERT these. Reviewer must diff MIXED/careful files line-by-line, never sed a whole file.
- **Out-of-scope follow-ups** (behaviorally wrong, NOT brand-token drift — do not fix here): F1 rasen-cli-identity:5 scope text still says rename must NOT touch openspec//opsx: (phase-1 boundary; phase-2 DID move them — semantic reconciliation needed); F2 non-telemetry OPENSPEC_* env renames (verify code); F3 capability folder renames (openspec-conventions, openspec-config-extensions are spec IDs — renaming breaks references).
- **Validation status**: `rasen validate specs-brand-rewrite` = VALID (exit 0); 4/4 artifacts complete. Apply-stage validation contract = `rasen validate --specs` must stay green (behavior-neutrality proof) + corpus-grep gate (task 8.3).
