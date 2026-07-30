# Handoff: hybrid-session-workers — Session 执行层设计 #1

> 这是 repo-level fallback handoff（无 Rasen change，纯 docs/experiments 工作流）。下一切片开工时读本文 + 设计文档 + 探针报告即可接续，无需回放对话。

## Original intent

用户要求：基于 `docs/audits/session-audit-9e36259d-cache-rebuild-review.md` 的 Plan B，采用「短会话用 subagent + beat 机制（5min 缓存）、长会话用独立 agent session（1h 缓存）」的混合方案。最初定位为 0.1.6 playbook 新后端，经讨论后**重定位到 0.2.0 内核**（用户拍板：Plan B 应直接从新系统开始）。随后用真实账单探针验证承重假设、对表 ECP-4/5 契约与现实。

## Position

无 pipeline（纯设计 + 实验工作流）。
- Worktree：`OpenSpec-code-hybrid-session-workers`，分支 `feat/hybrid-session-workers`，基于 `origin/dev/0.1.6 @ d623b8f5`（纯 docs 提交链 `0ff25ad1..574e129d`）。**实现开工时须改基到 dev/0.2.0**。
- 设计定稿：`docs/session-execution-layer-design.md`（v2 重定位版）。
- 探��完整档案：`docs/experiments/session-cache-probe-results.md`（两轮）+ `session-cache-probe.md/.ps1`（可复跑协议/脚本）。
- 已交付阶段：**P0 全部完结**（探针 + 设计 + ECP 对表）。未开工：P1（实现）、P2（接线 dogfood）。

## Done / Remaining

Done:
- v1（0.1.6 playbook 版，commit `0ff25ad1`）→ v2（0.2.0 内核重定位，`a6cd731b`）。
- P0 探针两轮全部跑完：KC1a/1c/2/3/4/5/6 + fork + KC6-65，裁决入设计（`f91fa451`、`2429b3d8`）。
- 官方文档调研（stream-json 宿主/fork/hooks/caching 语义）入设计（`da83c951`）。
- 对表 `feat/ecp-review-cycle @ 2fa693d8`（ECP-4 收口、ECP-5 进行中），接线定案 + P2 上游前置（`574e129d`）。
- memory 更新：`session-execution-layer-planb.md` + `session-cache-probe-results.md` + MEMORY.md 索引。

Remaining:
- **P2 上游前置（须转 ECP 侧或随本层修复，已在 ECP 反馈稿里整理）**：①`handoffTokenLimit:10_000`/`reuseRoundLimit:1` 硬编码孤儿字段 ②合成 stage 硬写 `sessionReuse:'never'` ③四值→二值映射抹平语义 ④`opsx-orchestration` spec worker 生命周期所有权边界修订。
- **排期**：direction 校准把本层排为 ECP-5 之后切片（用户倾向已知，未正式拍板）。
- P1（探针通过即可开工）：扩展 `management-api/supervisor.ts` 加 stream-json 多轮 + resume 宿主；持久化 `session-registry.ts`；`rasen session exec|list|retire` CLI；daemon touch scheduler。
- 0.1.6 可选止血小 PR：`rasen agent signal` + retired-handle 拒绝（用户未决）。

## Key decisions (and why)

- **重定位到 0.2.0 内核**：v1 的 playbook Step B.5 / LEAD epoch fencing / mailbox 整层都是为"LLM LEAD 会话"代偿；内核世界编排者是 deterministic reconciler，无缓存要保护/不睡眠/重启恢复，最大几类 churn 结构性消失。保留：SessionHost、registry、tier 经济学、audit --run。
- **主宿主 = stream-json 常驻进程（非 resume-cli，非 Agent SDK）**：探针裁决（见下）。`--input-format stream-json` 单进程多轮；空闲零成本；进程存活是缓存资产。
- **resume-cli 降为崩溃恢复路径**：repo cwd 下 resume 重渲染注入的项目上下文块致前缀不稳定。
- **daemon 角色从 touch 优化器升级为 live 进程托管者**：正确性永不依赖 daemon，只有缓存效率依赖。
- **不新增 sessionTier 字段**：authored 四值 `sessionReuse` 承载 tier 语义，只修下降保真。
- **tier 经济学保持原始 35min break-even**：主宿主下成立；touch 仅 >55min 空闲需要。
- **fork 无热继承**（实测 0/2）：定位改为"付一次全量重写换完整上下文继承 + 零重探索"，与 manifest 播种同台比价。

## Dead ends & gotchas

- **KC1a 曾误判为"TTL 不够长"/"容量淘汰"**：两轮探针才定位真因 = cwd 注入块前缀不稳定（repo 变化 + session 身份）。TTL/容量假设双双出局。不要重走。
- **subagent 后台闲等的完成通知会丢**（今晚丢 ×2）：数据须落盘、收割不依赖通知——这恰是 registry/journal 的立论。
- **探针脚本 `Add-Content` 撞瞬时文件锁可致早退**：结果文件须先于日志落盘；P1 registry 写入须 retry-on-lock。
- **PowerShell 5.1 坑**：`[uint32]0x80000003` 解析为负 Int32（已改 `Convert::ToUInt32`）；`-GapsSeconds "1800,2400"` 被强转成单字符串跑歪不报错。
- **勿碰 ECP 在飞文件**：`OpenSpec-code-ecp-review-cycle` worktree 另有 session 在跑 ECP-5；对表全程只读。

## Eliminated hypotheses

- 「换 Agent SDK 宿主能救 KC1a」— ruled out：缓存服务端按前缀键控、宿主无关。改宿主不改变留存。
- 「1h 档 = 保证存活」— ruled out：官方措辞 best-effort 可逐出；实测 live 进程 65min MISS。
- 「fork 免费继承热缓存」— ruled out：0/2，9 秒内也 MISS。
- 「规模相关淘汰」— ruled out：95k 会话 30/40min HIT，98k 在 scratchpad cwd 也 HIT，分界是 cwd 非规模。

## Working set

设计/实验产出（均在 `feat/hybrid-session-workers` 分支）：
- `docs/session-execution-layer-design.md` — 设计定稿（§5.1 宿主、§6 tier+implementer 边界、§7 registry、§4.2 接线、§9 验证与排期）
- `docs/experiments/session-cache-probe-results.md` — 两轮探针完整档案
- `docs/experiments/session-cache-probe.md` + `.ps1` — 可复跑协议/脚本
- 探针原始输出：`%USERPROFILE%\.rasen\probe\{session-cache,session-cache-bisect,session-cache-large,session-cache-cwdrepo,session-cache-cwdtemp,session-cache-kc6,kc6-65min,kc6-65b,fork-kc5}\`
- memory：`~/.claude/projects/<proj>/memory/{session-execution-layer-planb.md,session-cache-probe-results.md}` + MEMORY.md

ECP 对表证据（只读，在另一 worktree `OpenSpec-code-ecp-review-cycle @ 2fa693d8`）：`change-run/contracts.ts:196-208`、`change-run/facade.ts:14`（deliveryMode grant/defer）、`pipeline-registry/profile-resolver.ts:243-244,564-565,592-593,612,640`、`commands/pipeline.ts:843-846`、`management-api/supervisor.ts`、`changes/ecp-product-closure/specs/opsx-orchestration/spec.md:38`。

## Next action

本工作流处于"设计闭环完成、等排期"的稳态。接续者的第一动作取决于触发时机：

1. **若 ECP 侧反馈到账（P2 上游前置 4 条的处置）** → 据其决定更新设计 §4.2/§6/§9 的前置清单。
2. **若要排期** → 在 `rasen/work/issue-centered-automation-platform/executable-composite-pipelines/` 的 direction 校准中把本层排为 ECP-5 后切片；确认后改基 `feat/hybrid-session-workers` 到 dev/0.2.0。
3. **若要开工 P1** → 先做"扩展 supervisor.ts 加 stream-json stdin 多轮宿主"的最小骨架（无需等 ECP 排期，模块独立），门槛见设计 §9 P1。
