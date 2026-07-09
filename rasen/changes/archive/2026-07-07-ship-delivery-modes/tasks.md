# Tasks: ship-delivery-modes

## 1. Delta specs

- [x] 1.1 `specs/opsx-ship-command/spec.md` — ADDED: Delivery Mode Resolution、Commit Is Part of Ship；MODIFIED: Pre-Flight Checks、Ship Execution、Ship Log
- [x] 1.2 `specs/opsx-orchestration/spec.md` — ADDED: 子 change 本地交付与组合级统一交付
- [x] 1.3 `specs/review-cycle-workflow/spec.md` — ADDED: Gate-Run Test Evidence Recording
- [x] 1.4 `specs/opsx-auto-command/spec.md` — MODIFIED: Bug Fix Pipeline（单测门证据记录）

## 2. Implementation

- [x] 2.1 `src/core/templates/workflows/ship.ts` — 重写 Ship Phase：交付模式解析、commit-with-hooks、条件 merge、证据测试门、按模式交付、模式感知 ship log；更新文件头注释与两处 description
- [x] 2.2 `src/core/templates/workflows/auto.ts` — §5 adaptive verify 增加证据记录；Guardrails 增加子 change local 交付守则
- [x] 2.3 `src/core/templates/workflows/_orchestration.ts` — Step G 插入「5. Single portfolio-level delivery」并重排 5→6、6→7
- [x] 2.4 `src/core/templates/workflows/review-cycle.ts` — Cycle report 段增加测试证据记录契约

## 3. Verification & ship

- [x] 3.1 `pnpm build` 干净
- [x] 3.2 定向测试绿：skill-templates-parity / auto / review-cycle / handoff / profiles / skill-generation（104/104）
- [x] 3.3 `openspec validate ship-delivery-modes --strict` 通过
- [x] 3.4 独立 reviewer（非作者）评审通过，0 未决 Blocker/Major（APPROVE；F1 测试钉子已修并经复核确认，F2/F3 留作 follow-up）
- [x] 3.5 ship：commit + push origin dev-harness（按证据门：定向测试绿 + 评审干净即可，不重跑全量）→ 归档
