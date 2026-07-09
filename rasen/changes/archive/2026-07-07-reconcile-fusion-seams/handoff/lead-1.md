# Handoff: reconcile-fusion-seams — LEAD #1

> 写给零共享上下文的接班 LEAD。会话前半段（三个已归档 change）另有交接：
> `openspec/handoff/2026-07-07-gstack-consolidation.md` —— 本文档只覆盖其后的工作。
> 交接时 LEAD 占用 40.1%（401,176/1,000,000）。

## Original intent

用户在融合矩阵审查后的连环指令（按时序，均已执行到位）：

1. 「你来审查一下融合矩阵的结果，对比openspec的原版……我怕会有两个系统打架的情况」→ LEAD 亲自复审，发现三处真实缝隙。
2. 「你直接修复，第三点是删掉design.enhance」→ 直接修（LEAD 亲自实施 + 独立 reviewer 核验的压缩流程，不走完整 auto 管线）。
3. 「我检查了一下，感觉domain-modeling和openspec流程有些冲突，还是直接移除domain-modeling吧。然后告诉我所有融合的情况，我去全面检查」→ 转向：从"getter 注记中和"改为**整体移除 domain-modeling**；融合全景清单已呈报；**ship 被 HOLD，等用户检查结论**。

## Position

Pipeline: 无正式 auto-run（用户指令"直接修复"，走的是 LEAD 直接实施 + reviewer-4 非作者核验的压缩流程）。
等效进度：propose/apply/verify/review-loop 已完成，**ship 之前暂停（用户 HOLD）**。

## Done / Remaining

Done（tasks.md 1.1-3.6 全勾）：
- 三处融合缝修复：`design.enhance` 删除（schema 现零 enhance 钩子，机制保留休眠）；explore 护栏加 `/prototype` 唯一豁免（双变体）；`CHANGE_CONTEXT_CAPTURE_GUIDANCE`（`src/core/templates/workflows/change-context.ts`）getter 层注入 prototype。
- **domain-modeling 整体移除**（名册 20→19）：getter/四处接线/源目录（含 ADR-FORMAT、CONTEXT-FORMAT sidecar）/AGENTS 行/navigator vocabulary 段/propose 融合块引用/安装孤儿/计数断言（4 处 20→19）。
- parity 哈希重算：explore 三件 + propose 三件（函数×2+内容×1 各自），零外溢。
- 4 个 delta spec：methodology-expert-fusion（propose 需求 REMOVED+ADDED 改名、prototype 适配 ADDED、名册三件 MODIFIED、explore 护栏场景）、add-grill-expert-skills（4→3 + 过期计数需求 REMOVED）、methodology-skill-tool-scoping（domain-modeling 需求 REMOVED）、navigator-router-skill（MODIFIED，含补回的平行生命周期场景）。
- reviewer-4 两轮评审：round-1 APPROVE（1 Minor 反斜杠笔误已修）；round-2 APPROVE、我修掉 2 Minor + 1 Trivial 后复核 **0 未决**。review-report.md 齐全。

Remaining（tasks.md 3.7 + 三个等用户拍板的决定）：
1. **放行 ship**（用户对"融合全景清单"的检查结论未回）→ 全量 `pnpm test` → 单 commit + push origin dev-harness（无 PR，惯例）→ 归档。
2. **tdd 措辞**：apply 模板那行触发条件循环（"测试先行的工作→咨询 /tdd"）——删 / 改为"核心逻辑+覆盖薄弱时考虑" / 保持。若改：并入本 change，apply 双变体 + parity 哈希重算（apply 在白名单）。
3. **`unify-expert-template-pipeline` 是否立项**：19 个专家 .tmpl 源迁入 TS 模板管线、删 bun/gen-skill-docs/skill-check 工具链、新鲜度统一 parity、可顺带去 gstack 前缀。已向用户完整论证（收益/代价/中等规模、建议独立 change 甚至 full-feature），等拍板。
4. 另一个已分析未立项项：explore × office-hours 的"半合并"（Builder 模式并入 explore、office-hours 收窄纯 Startup 验证）——用户问过，我建议与"gstack 直调入口收纳"打包，未拍板。

## Key decisions（勿重新讨论或静默反转）

- domain-modeling **移除而非修补**（用户拍板 2026-07-07）：其 CONTEXT.md/ADR 工作方式与 change 目录流结构性冲突。
- `design.enhance` 删除（用户拍板）；enhance **机制**保留（schema-enhance-field spec 描述机制本身，仍为真）。
- prototype 用 getter 注记中和（缝窄、技能本身有价值），codebase-design/tdd 无路径冲突不加注记。
- MODIFIED delta 必须携带主 spec 该需求的**全部**场景——丢场景=静默删除（reviewer-4 round-2 Minor-2 的教训）。
- 归档时需**手工调整三个主 spec 的 Purpose 行**（delta 不携带 Purpose）：methodology-expert-fusion / add-grill-expert-skills / methodology-skill-tool-scoping——清单在 proposal.md 末尾 NOTE。
- ship 惯例：直接 commit+push origin dev-harness，不开 PR；commit 尾行 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`。

## Dead ends & gotchas

- **消息交叉误判两次**：worker 空闲通知先于其落盘/回报到达，LEAD 探测得出"没干活"的错误结论（implementer-2、reviewer-4 各一次）。教训：催派前先查黑板+等一拍；worker 声称已完成时 re-check 而非坚持己见。
- PowerShell `Get-Content`/`Set-Content` 往返会把 UTF-8 中文/符号写坏（tasks.md 的 × 和 — 变 脳/鈥）——改文件用 Edit/Write 工具或 `[System.IO.File]::WriteAllText` + UTF8 no-BOM。
- PowerShell 里 openspec 原生命令常报 exit 255 但输出正常（native-exe quirk，直接跑 exit 0）——看输出别看退出码。
- parity 白名单：explore/propose/apply 及其 command 变体+content 哈希**在列**（各三件套），expert getter **不在列**。哈希重算流程：跑 parity 测试→从失败输出抄新值。
- `openspec update --force` 不清理被删 expert 的安装目录——手动删孤儿（本次已删 openspec-gstack-domain-modeling）。
- 全量测试 Windows temp-dir 抖动（随机文件超时/EBUSY/EPERM）：未触碰文件隔离重跑绿即过。

## Eliminated hypotheses

none（本 change 无排障线；三处缝的定位是审查发现而非调试）。

## Working set

工作区未提交 diff ≈ 20 文件：schemas/spec-driven/schema.yaml、src/core/templates/workflows/{explore,propose,change-context}.ts、src/core/templates/experts/{index,prototype}.ts（domain-modeling.ts 已删）、src/core/templates/skill-templates.ts、src/core/shared/skill-generation.ts、skills/gstack/navigator/（tmpl+SKILL.md）、skills/gstack/docs/AGENTS.md、docs/review-cycle-workflow-design.md、test/core/{templates/skill-templates-parity,shared/skill-generation}.test.ts、已删 skills/gstack/domain-modeling/、.claude/skills 安装侧（gitignored）、openspec/changes/reconcile-fusion-seams/ 全套 artifacts。
门禁基线：build 干净；parity/skill-generation/profiles 53/53；validate --strict 过；config 未污染。
呈报给用户的"融合全景清单"在对话中——要点已由 proposal.md + design.md 矩阵承载。

## Next action

等用户回复三个决定（放行 ship / tdd 措辞 / 管线统一立项）。若用户放行且无 tdd 改动：跑全量 `pnpm test`（抖动按上述惯例处理）→ 勾 tasks 3.7 → 单 commit（`fix(opsx): reconcile fusion seams, remove domain-modeling expert`）+ push origin dev-harness → 归档（archiver 注意 proposal NOTE 的三处 Purpose 手调；REMOVED 需求同步；若某主 spec 被删空参考 fuse change 归档时的手工处理先例——archive 工具不能 rebuild 到零需求）。
