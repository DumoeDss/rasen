# Handoff: hybrid-session-workers — Session 执行层设计 #1

> 这是 repo-level fallback handoff（无 Rasen change，纯 docs/experiments 工作流）。下一切片开工时读本文 + 设计文档 + 探针报告即可接续，无需回放对话。

## Original intent

用户要求：基于 `docs/audits/session-audit-9e36259d-cache-rebuild-review.md` 的 Plan B，采用「短会话用 subagent + beat 机制（5min 缓存）、长会话用独立 agent session（1h 缓存）」的混合方案。最初定位为 0.1.6 playbook 新后端，经讨论后**重定位到 0.2.0 内核**（用户拍板：Plan B 应直接从新系统开始）。随后用真实账单探针验证承重假设、对表 ECP-4/5 契约与现实。

## Position

无 pipeline（纯设计 + 实验工作流）。
- Worktree：`OpenSpec-code-hybrid-session-workers`，分支 `feat/hybrid-session-workers`。**已于 2026-07-30 改基到 `origin/dev/0.2.0`**（12 个纯 docs 提交落在 `be124057` 之上，0 落后；原基点 `origin/dev/0.1.6 @ d623b8f5` 那 8 个 0.1.6 提交**没有**被重放——它们由独立的 `chore/merge-0.1.6-into-0.2.0` 分支负责引入 0.2.0，避免同一批 commit 走两条路）。回退点：`backup/hybrid-session-workers-pre-rebase`。
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

**2026-07-30 追加完成（前期任务清零）**：
- 改基到 `dev/0.2.0`（见 Position），ECP-1..5 已合并归档，对表对象从"进行中"变成最终形态。
- **P2 上游前置四条逐条核实并回写设计 §4.2**：③（四值保真）**已关闭** —— `sessionReuseAuthored` 落在 `contracts.ts:213`/`actions.ts:211`/`execution-plan-internal.ts:275`/`commands/pipeline.ts:874`，由 `session-contract-fidelity.test.ts` 钉住；②（合成 stage 硬写）**已关闭且更好** —— 改为按 provenance 分型，定义性的值带 `definition` 且权威，没人选过的带 `default` 且是占位；①（孤儿字段）**从前置变成授权** —— `ecp-change-run-runtime` spec 的占位 requirement 明文要求未来读者不得据 `reuseRoundLimit: 1` 约束 session（点名它会禁止评审者跨轮复用）、须从"自己那一层的权威来源"取真值，等于预先把定义权指派给本层；④（`opsx-orchestration` 所有权边界）**仍是本层 P2 的必交项**，不是等待项。
- 架构文档槽位已由 ECP-5 task 6.3 备好：`docs/architecture/executable-composite-pipelines.md` §3 明写内核不开 session、不管 worker 生命周期，"独立的 session execution layer 是后续切片"；§7 写明占位值的真实取值是本层的设计产出。
- 排期已由用户确认（2026-07-30）：ECP 之后推进本层；ECP 的测试与审查由用户自己处理。

Remaining（真正剩下的）:
- **P1 实现**（无任何等待项）：给 `management-api/supervisor.ts` 加 stream-json stdin 多轮 + resume 宿主；持久化 `session-registry.ts`（§7 schema，写入须 retry-on-lock）；`rasen session exec|list|retire` CLI；daemon touch scheduler（~50 分钟 cadence，仅 >55 分钟空闲）。门槛见 §9 P1。
- **P2 接线 dogfood**：含 ④ 的 spec/playbook delta（Step A/B.1/B.4/H.2 所有权移交）+ 架构文档章节插入。P1 executor 验收只覆盖 6 个受 reconciler 支持的内建 pipeline —— `auto-decompose` fail-closed 是设计，不要当回归。
- 0.1.6 可选止血小 PR：`rasen agent signal` + retired-handle 拒绝（用户未决；注意 0.1.6 现在是 0.1.5 的 bug 修复线）。

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

~~本工作流处于"设计闭环完成、等排期"的稳态。~~ **2026-07-30：上面三条触发条件全部满足并处置完毕**
—— ECP 侧反馈已到账并逐条回写（§4.2 表）、排期已由用户确认、分支已改基。本工作流现在处于
**"P1 可直接开工"** 的状态，没有前置。

**接续者的第一动作：直接开 P1 的最小骨架** ——
给 `management-api/supervisor.ts` 加 `--input-format stream-json` 的 stdin 多轮宿主
（现有 headless spawn / pid 管理 / tree-kill / 并发槽 / Windows `.cmd` 转义全部复用，不新起
`src/core/session-host/`），先只做 create → wake×N → retire 的进程生命周期与单飞锁，
registry 持久化随后跟上。门槛见设计 §9 P1。

开工前值得先读的三处硬事实（都是探针买来的，别重走）：
1. **缓存资产是"进程存活"，不是 session id** —— live stream-json 进程同 cwd 55 分钟仍 HIT（含 repo
   变化免疫实证），65 分钟 MISS（1h 上界）；而 resume-cli 在 repo cwd 下因注入块前缀不稳定一发即
   MISS。所以宿主形态本身就是设计的主体，不是实现细节。
2. **并发 resume 会静默丢回合**（KC5，非确定性复现）→ 单飞锁必须在 CLI 之上自己实现。
3. **subagent 后台闲等的完成通知会丢**（两轮探针各复现一次）→ 数据须落盘、收割不依赖通知；
   registry 写入须 retry-on-lock（探针脚本就被瞬时文件锁咬过一次）。
