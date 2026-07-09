# Planning Context — office-hours-fork-first

## User intent (verbatim essence)
重构 office-hours skill:用"产品路由 + fork-first 追问纪律"取代现有三条命名路径(Startup interview / Builder interview / Consultation posture)。设计已收敛并通过对抗审查(9/10),本 change 是纯实现。

## AUTHORITATIVE design document
`C:\Users\Sayo\.rasen\projects\rasen\Sayo-main-design-20260710-011233.md` — read it FIRST and treat it as the source of truth for every design decision. Do NOT re-litigate decisions recorded there. Key sections: Recommended Approach (routing discriminator, fork-scan procedure, skip semantics, doc-template collapse), Dependencies (the two-file change surface + cross-reference sweep), Success Criteria (8 checkable items), Open Questions (2 items deliberately left open — do not resolve them silently).

## Decisions already made (do not re-open)
- 顶层路由按产品:诊断产品(六题脚本原样保留)vs 设计产品;判别器 = 请求的对象(venture 本身 → 诊断;设计/方案 → 设计产品),身份不是路由变量;意图可中途改变(双向升级)。
- 设计产品 = fork-first 统一机制:4 步分叉扫描程序 → 承重分叉先问(≤2/轮,一次一个带倾向)→ 立场分析 → Dialogue Override 讨论 → 收敛 → 文档。
- Phase 3(Premise Challenge)/ Phase 4(强制备选)溶解为分叉机制的特例,删除独立立法;Builder/Consultation 作为命名模式删除,残余只是按 goal 条件渲染的评价框架参数。
- 设计产品单一文档模板(评价框架块按 goal 渲染);诊断产品沿用现 Startup 模板。
- 显式跳过信号 → 未决分叉一次性降级为置顶声明的假设,立即交付。
- explore 模板零改动;不加转介检测;fork-first 不进共享 PREAMBLE。
- landscape(Phase 2.75)挂点在分叉扫描之前。

## Change surface (from code inspection, verified)
- `src/core/templates/experts/office-hours.ts` — 主改动面。全部被重构机制在此(12 处 "Consultation" 引用、约十处命名路径互锁守卫条款)。
- `src/core/templates/workflows/office-hours.ts` — command 薄包装,Step 1 的 Startup/Builder 模式路由、文件头 "two modes" 措辞、fallback pre-brief 须同步改写为产品路由。
- 头号回归风险:命名路径交叉引用清扫不净(悬空引用)。
- 模板改动流程 = build → update;涉及模板 parity 哈希时手工贴。

## Constraints
- 版本号归用户管:不 bump version(当前 0.1.1)。
- 并发 session 共享 working tree:任何 commit 必须 `git commit -- <explicit paths>` 显式 pathspec 并 `git show --stat` 复核。
- 测试:pnpm test 在 Windows 偶发 CLI-spawning EBUSY flake,非逻辑回归;隔离重跑确认。

## Planner findings (durable — apply-phase should read before touching code)

- **Artifacts generated** (all validated, `rasen validate office-hours-fork-first --strict` clean, 4/4 status complete): `proposal.md`, `design.md`, `specs/office-hours-fork-first/spec.md` (ADDED — new capability), `specs/office-hours-dialogue/spec.md` (MODIFIED 5 reqs + REMOVED 3 reqs), `specs/opsx-office-hours-command/spec.md` (ADDED 1 req replacing "Startup and Builder Modes" + MODIFIED 1 req), `tasks.md` (11 task groups, 40 checkboxes).
- **D1 — filled-in mechanism gap, not a re-litigated decision**: the approved design doc says Diagnosis product keeps "六个 forcing questions...全部不动" but pointedly omits Phase 3/4 from that unchanged-list, while separately saying Phase 3/4 dissolve "删除独立立法" (deleted as standalone legislation, unscoped). Planner's reading: after the Diagnosis product's six questions, it ALSO now routes through the shared fork-scan mechanism for premise-checking/alternatives — it no longer has a private Phase 3/4 copy, because there's no private Phase 3/4 copy left anywhere. This is documented in `design.md` Decision D1 with the alternative considered and rejected. **Flag for review before/during apply** — if this reading is wrong, the fix is confined to task 2.3 (just don't route Diagnosis into the fork-scan; keep a Diagnosis-local premise/alternatives step instead).
- **Old Consultation's "skip questioning" requirement was REMOVED, not MODIFIED** (see `office-hours-dialogue/spec.md`): Consultation's unconditional skip-on-concrete-design behavior is inverted by this change (fork-scan only skips when zero weight-bearing forks — that inversion IS the whole point per Success Criteria 1 vs 2), so treating it as a rename would have been wrong. Two other Consultation-specific requirements were also REMOVED (precedence-replaces-Phases-2-4; the Startup/Builder full-skip evidence-bar rule, superseded by the fork scan's structural branch-writability test). Migration pointers in each REMOVED block name the exact new requirement that supersedes it.
- **opsx-office-hours-command's "Startup and Builder Modes" requirement was replaced via REMOVED+ADDED, not MODIFIED**: per the delta-spec tooling (`src/core/specs-apply.ts`), MODIFIED requires the header to match the existing requirement name exactly; a combined rename+content-rewrite doesn't fit MODIFIED or RENAMED (RENAMED preserves body text verbatim under a new header) cleanly, so REMOVED (old name, with Reason/Migration) + ADDED (new name "Diagnosis and Design Products") was used instead. Same reasoning applies if the apply-phase agent is tempted to use MODIFIED with a changed header anywhere else — don't; use RENAMED for pure renames or REMOVED+ADDED for renamed-with-rewritten-content.
- **Test surface is small**: only `test/core/templates/skill-templates-parity.test.ts` asserts on office-hours template content today (hash-pinned, no prose assertions) — confirmed by grep across `test/`, no other test file asserts on "Consultation"/"Startup mode"/"Builder mode" strings. Task group 9 adds a new standing regression guard test (exact-substring check) since none existed before; this is new test surface, not a modification of existing assertions.
- **Existing capability specs read in full before drafting deltas**: `office-hours-dialogue/spec.md` (9 requirements, 8 pre-change) and `opsx-office-hours-command/spec.md` (6 requirements) were read from `rasen/specs/` (not just skimmed) to build accurate MODIFIED/REMOVED blocks — `office-hours-grilling-absorption` was checked too and left untouched (its requirement text is mode-agnostic, doesn't name Startup/Builder/Consultation, no delta needed).
