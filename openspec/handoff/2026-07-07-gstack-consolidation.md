# Handoff: gstack 收编 session（2026-07-07）— LEAD #1

> 会话级交接。本 session 无进行中 change（全部完成归档），故落在 openspec/handoff/ 而非某个 change 目录。
> 写给零共享上下文的下一个 session：读完本文档即可接手，无需回放对话。
> 交接时 LEAD 上下文占用 27.7%（276,692/1,000,000），交接是用户主动要求的检查点，非容量逼迫。

## Original intent（用户三条指令，按时序）

1. 「阅读 docs/handoff-2026-07-06-upstream-merge-session.md，然后修复所有问题」（/opsx:auto small-feature）
2. 「首先移除gstack的那一套平行生成周期。然后当时把grill都融合进了gstck，看有没有能融合进openspec的，
   以及看gstack有没有能融合进openspec的。我们的主轴始终是openspec，尤其是workflow。」
3. 穿插的咨询问题（store 机制、office-hours 双层架构、grill 融合史）——已答复，无待办。

## Position

三个 change 全部走完 small-feature 流水线（propose→apply→verify→review-loop→ship→archive）并归档：

| Change | 归档位置 | commits |
|---|---|---|
| fix-pipeline-root-selection | openspec/changes/archive/2026-07-07-fix-pipeline-root-selection/ | 4251e59, cb6d0fc, 3793c5f |
| remove-gstack-parallel-lifecycle | openspec/changes/archive/2026-07-07-remove-gstack-parallel-lifecycle/ | 8d6ae87, de5b407, 6aea2f3 |
| fuse-methodology-into-opsx | openspec/changes/archive/2026-07-07-fuse-methodology-into-opsx/ | 6e92013, 7dc7f33, 938ef65 |

`origin/dev-harness` = `938ef65`，工作区干净，`openspec validate --all --strict` 94/94。
三次评审均 0 Blocker/Major/Minor（第一个 change 有 1 Major 教学层矛盾，review-loop 第 1 轮修复并非作者确认）。

## Done / Remaining

Done（详见各归档 change 的 tasks.md/review-report.md/ship-log.md，此处不复制）：
- pipeline 命令组 root-selection 迁移 + `--store`（store 场景断链修复）；
- 10 个 gstack 平行生命周期专家删除（名册 30→20），ship/retro 契约吸收进 opsx:ship/opsx:retro（自包含）；
- grill 四件教学级融合（codebase-design+domain-modeling→propose、tdd+careful→apply、prototype→explore），
  产物收编 change 目录；guard/freeze/unfreeze/design-consultation/codex 审计后留作纯专家层（理由在 design.md 矩阵）；
- schema.yaml enhance 现行 bug 修复（proposal/specs 删 enhance，design→codebase-design）；
- 7 个主 spec 陈旧示例清理（ship-portability 整个 spec 从主 specs 删除）。

Remaining（均未开工，等用户点单）：
1. **archive 工具缺口**：`openspec archive` 无法把 spec 同步到零 requirements（`requirements.min(1)` 挡整批）；
   全 REMOVED spec 只能手动删目录+暂挪 delta（archiver 实测，证据在归档 fuse change 的 tasks.md 8.5 注记）。
   建议一个小 change 给 spec-rebuild-to-empty 提供删除路径。
2. **gstack 直调入口收纳**（曾与用户讨论）：把 20 个专家改回不可直调，只留 navigator/opsx/流水线消费——用户未拍板。
3. **docs/zh/ 翻译过时**（上上个 session 遗留，独立立项）。
4. **2026-07-06 全局配置覆写事故根因**未查清（本 session 多次 `openspec config list` 核查均干净；
   排查方向：Windows 上写 global config 的测试的 XDG 隔离时序 / 并行 session）。
5. **browse/ 顶层包**仍有 /plan-ceo-review 等残留——属 browse 产品化专项（历来 carve-out），勿并入日常清理。

## Key decisions（勿重新讨论或静默反转）

- 主轴 = openspec workflow 是唯一生命周期；gstack 收编为被消费的纯专家层。
- phase0「plan 四件套留作 elfspec 储备」的旧决策已被用户显式推翻（已删）。
- document-release 一并删除（gate 裁决，推翻 planner 的保留建议）。
- 7 个陈旧示例主 spec 全修（gate 裁决，推翻 planner 的修4留3；主 specs 只保留对现存系统为真的条款，
  历史由 changes/archive 承担）。
- enhance 处置：proposal/specs 删字段、design→codebase-design（gate 采纳 planner 推荐）。
- 融合是教学级条件引用：不内联专家正文、不造新平行入口、不给简单 change 加强制仪式。
- ship 惯例：直接 commit+push origin dev-harness，不开 PR；ship-log 单独第二个 commit。
- `openspec status --json` 的绝对路径字段是 **changeRoot**（不是 changeDir）——教学与测试锚点都按此。

## Dead ends & gotchas

- `openspec update --force` **不清理**被删 expert 的已安装目录（只 prune workflow）——删专家要手动清 .claude/skills 孤儿。
- parity 测试（skill-templates-parity.test.ts）是**固定白名单**：只锚 11 个 base workflow（propose/apply/explore 在列，
  ship/retro workflow 与全部 expert 不在）。改模板前先核对 EXPECTED_FUNCTION_HASHES，别想当然。
- `scripts/skill-check.ts` 无法独立运行（缺 test/helpers/skill-parser，预先存在）；权威新鲜度门禁是
  `bun run skill:check`（= gen-skill-docs --dry-run）。
- Windows 全量测试有随机文件的 temp-dir 抖动（10s 超时/EBUSY/EPERM，两次运行失败集不重叠）——
  未触碰文件隔离重跑绿即过；已有记忆条目 windows-test-flakiness。
- gstack 层改动 = 改 .tmpl → `bun run gen:skill-docs` 重渲染，别手改生成的 SKILL.md。
- validate --strict 只查结构，不查跨文件存在性——死引用要靠 grep 门禁自查。
- 本 session 的 subagent 常**静默完工**（idle 通知无 DONE 报告）——接手 LEAD 遇到 idle 先查黑板
  （tasks.md 勾选 + git status），再 SendMessage 追讨报告；也发生过消息交叉误判（探测早于落盘），下结论前重查。

## Eliminated hypotheses

none（本 session 无 fixer/debugger 排障线；唯一疑案「配置覆写事故」根因仍开放，见 Remaining 4）。

## Working set

- 归档三件套各自的 planning-context.md 是机制知识的 SSOT（注册链、计数断言、parity 白名单、
  update 孤儿行为、absorb 契约提炼）——新 change 涉及 skills/模板时先读它们，别重新调研。
- 记忆索引 MEMORY.md 已更新（upstream-v15-merge-handoff 条目含本 session 成果与遗留清单）。
- 本 session workers 的 transcript 指针记录在各归档 change 的 auto-run.json（跨 session 已失效为
  warm-seed 素材，agentId 均为死句柄）。

## Next action

无强制下一步——工作已收官。若用户点单，最高性价比的第一步是 Remaining 1（archive 零需求 spec 的
工具缺口）：开 change `fix-archive-empty-spec-removal`，走 /opsx:auto small-feature，
以归档 fuse change 的 tasks.md 8.5 注记 + src/core/archive.ts:439-459 + src/core/specs-apply.ts 为起点。
