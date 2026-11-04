# Session 9e36259d 缓存重建缓解方案审查报告

> 审查对象：`C:\Users\Sayo\.rasen\analytics\session-audit-9e36259d.json`\
> Session：`9e36259d-e6a3-4ac1-862d-2a3e32d6e7da`\
> Runtime：Claude Code\
> 会话时间：2026-07-25 13:54:31 至 2026-07-26 12:58:03（Asia/Shanghai），23.06 小时\
> 报告日期：2026-07-26\
> 结论置信度：机制与执行证据高；反事实节省估算中等

## 1. 执行摘要

结论是：**`beat` / `rasen agent wait` 已经在被正确使用的 park episode 中生效，但尚未在整场编排中形成稳定、正收益的缓存重建缓解能力。应保留该机制，下一步重点不是重写 beat 实现，而是补齐编排覆盖、生命周期收口和信号通道约束。**

分项判定如下：

| 维度 | 判定 | 证据 |
|---|---:|---|
| beat 节奏可靠性 | 生效（A） | 37/37 个续拍间隔小于 300 秒；最大 283.0 秒 |
| 信号恢复保持热缓存 | 生效（A） | 3/3 个 `resumed` episode 的实际恢复请求均为缓存 HIT |
| 使用过 wait 的子代理恢复健康度 | 生效（A） | 48 HIT / 1 MISS，命中率 98.0%；唯一 MISS 发生在 beat-cap 后 490.4 分钟的机器休眠恢复 |
| 编排覆盖率 | 不足（D） | 12 个子代理中只有 3 个调用过 wait；未使用 wait 的子代理只有 24.0% 恢复命中率 |
| episode 经济性 | 局部有效、全场近乎持平（C） | 真正恢复的 3 个 episode 估算净节省 104.6 万 billed-input-equivalent；窄口径下两个 beat-cap episode 未兑现 warm-resume 收益，但 Reviewer A 通过 handoff 由 successor 继续，不能把两者都判为无效空耗 |
| 残余缓存重建 | 仍然严重 | 34 次 churn，重写 1,431.3 万 token；其中 TTL 914.7 万、rebase 516.6 万 |

最重要的两个结论：

1. **beat 本身不是当前主要故障点。** 在 active park 窗口内，没有观测到 TTL MISS；270 秒 cadence 和 330 秒工具超时配对均按设计工作。
2. **当前主要问题是“该 park 的 worker 没 park，以及已经 retired 的 worker 又被直接复用”。** 对等候时间超过默认 cap、但后续任务仍确定存在的 worker，`12-beat + handoff` 与延长 beat 都可能合理，应基于 ETA、上下文大小和 successor 成本选择，而不能把 beat-cap 本身视为编排失败。

## 2. 审查边界与证据

### 2.1 实验性限制

`rasen agent audit` 解析 Claude Code 的内部、未公开 transcript 格式。报告 schema 为 `rasen-token-audit/2`；Claude Code 或 harness 更新可能造成字段漂移、漏记或错误归因。因此，本报告将证据分为三层：

- **直接观测**：audit JSON 中的 token、churn、burst、HIT/MISS 数据；
- **交叉验证**：主会话和 12 份子代理 transcript 中的实际 Bash 调用、结果和 usage；
- **反事实估算**：如果没有 keepalive，本应发生的重写及其 billed-input-equivalent 差额。

反事实估算不是账单，也不换算美元。

### 2.2 使用的证据

- 审查 JSON：`C:\Users\Sayo\.rasen\analytics\session-audit-9e36259d.json`
- 主 transcript：`C:\Users\Sayo\.claude\projects\E--AI-ChatAI-Agents-VibeCodingProjects-workflow-Reference-OpenSpec-code\9e36259d-e6a3-4ac1-862d-2a3e32d6e7da.jsonl`
- 12 份子代理 transcript：同目录下 `9e36259d-...\subagents\agent-*.jsonl`
- keepalive 实现：
  - `src/commands/agent.ts`
  - `src/core/keepalive/index.ts`
  - `src/core/templates/workflows/_orchestration.ts`
- 当前规范：
  - `rasen/specs/cli-agent-wait/spec.md`
  - `rasen/specs/worker-reuse-orchestration/spec.md`
- 当前配置：
  - 项目 `rasen/config.yaml` 未设置 `keepalive`
  - `C:\Users\Sayo\.rasen\config.json` 的 `keepalive` 为空
  - 因此本次有效值为默认配置：enabled、Claude on、270 秒、12 beats、context floor 0

### 2.3 术语

本文使用 Claude audit 的术语：

- **billed input equivalent**\
  `raw input + cache-write × TTL 系数 + cache-read × 0.1`。主会话 cache write 系数为 2，子代理为 1.25。
- **TTL expiry**\
  空闲超过该 agent 的缓存 TTL；主会话为 60 分钟，子代理为 5 分钟。
- **rebase**\
  会话前缀发生分叉、变基或消息注入后，原缓存前缀无法继续使用。
- **resume HIT/MISS**\
  burst 恢复时是否继续命中旧缓存。

用户所说的 `rasen await` 在当前代码中的实际命令名是 **`rasen agent wait`**；未发现 `rasen await` CLI alias。

## 3. 全场 token 与 churn 基线

| 指标 | 数值 |
|---|---:|
| Agents | 13（1 MAIN + 12 subagents） |
| Requests | 3,028 |
| Raw input | 45,559 |
| Cache write | 20,589,295 |
| Cache read | 1,045,855,237 |
| Output | 2,488,538 |
| Billed input equivalent | 132,910,836 |
| Resume HIT / MISS | 85 / 25 |
| Resume 命中率 | 77.3% |
| Churn | 14,312,560 tokens / 34 events |
| Churn 占全部 cache write | 69.5% |

Churn 构成：

| 原因 | Events | 重写 token | Churn 占比 |
|---|---:|---:|---:|
| TTL expiry | 23 | 9,147,000 | 63.9% |
| Rebase | 11 | 5,165,560 | 36.1% |
| 合计 | 34 | 14,312,560 | 100% |

按“这些 token 如果保持热缓存，本可按 0.1× read 而不是按 write 系数重写”的理想反事实估算：

| 原因 | 实际重写对应的 billed-input-equivalent | 相对温读的额外 premium |
|---|---:|---:|
| TTL expiry | 12,671,209 | 11,756,509 |
| Rebase | 7,237,954 | 6,721,398 |
| 合计 | 19,909,163 | 18,477,907 |

这 1,847.8 万的 premium 约为全场 billed input equivalent 的 **13.9%**。它不是全部可避免：机器休眠、主会话长时间无人操作和必要的会话切换不能直接归责于 keepalive。但它说明缓存重建仍然是本场成本中的显著组成。

## 4. `rasen agent wait` 的实际执行情况

### 4.1 调用覆盖

原始 transcript 中共有 **42 次真实 `rasen agent wait` 调用**：

- 37 次返回 `{beat, remaining}`
- 3 次返回 `{resumed: true, ...}`
- 2 次返回 `{standDown: true, reason: "beat-cap"}`
- 42/42 次 Bash tool call 都显式设置了 `timeout: 330000`
- 只有 3/12 个子代理实际使用过 wait：
  - `aimpl-child-a`
  - `areviewer-child-a`
  - `afixer-child-a`

### 4.2 cadence 验证

37 个从 `{beat}` 到下一次 wait 的实际间隔：

| 指标 | 秒 |
|---|---:|
| 最小 | 275.8 |
| 平均 | 278.0 |
| 中位数 | 277.9 |
| P95 | 282.8 |
| 最大 | 283.0 |
| 小于 300 秒 | 37/37（100%） |

默认 beat 本身为 270 秒，其余约 5.8–13.0 秒来自 tool result 返回、模型续轮和再次发起 Bash。30 秒 TTL 边际在本次运行中足够，未发生 cadence 越界。

### 4.3 park episode 结果

“重复 beat 开销”只计算每个 episode 第一次 park 调用之后、由 beat 继续产生的请求；第一次 park 调用被视为进入停车状态的边界请求，不全部归为 keepalive 增量开销。

| Worker / episode | Timed beats | 终点 | Park 时长 | 重复 beat 开销（input eq） | 估算避免重写 token |
|---|---:|---|---:|---:|---:|
| implementer A / 1 | 4 | resumed | 18.6 min | 238,211 | 574,676 |
| fixer A / 1 | 7 | resumed | 32.5 min | 284,810 | 386,138 |
| fixer A / 2 | 2 | resumed | 9.3 min | 102,761 | 492,842 |
| fixer A / 3 | 12 | beat-cap | 55.5 min | 706,553 | 0 |
| reviewer A / 1 | 12 | beat-cap + handoff | 55.6 min | 388,366 | 0（warm-resume 口径；handoff 续接另计） |
| **合计** | **37** | 3 resumed / 2 cap | — | **1,720,701** | **1,453,656** |

三次热恢复后的首个模型请求分别读取了 593,504、404,966、511,670 个 cached input token。扣除报告中子代理普遍仍能读取的约 18,828 token 公共前缀，估算避免了 1,453,656 token 的会话段重写。

### 4.4 HIT/MISS 对照

| Cohort | Agents | HIT | MISS | 命中率 | MISS 重写 |
|---|---:|---:|---:|---:|---:|
| 使用过 wait 的子代理 | 3 | 48 | 1 | 98.0% | 569,867 |
| 未使用 wait 的子代理 | 9 | 6 | 19 | 24.0% | 7,277,344 |
| MAIN | 1 | 31 | 5 | 86.1% | 2,326,734 |

这不是随机对照实验，两个 cohort 的角色和工作负载不同。但差异足够大，且 wait transcript 与 HIT 时间序列逐项吻合，支持以下判断：

- active park 期间 keepalive 确实保持了缓存；
- wait cohort 的唯一 MISS 发生在 fixer 已经 beat-cap 下线、随后机器休眠约 8 小时以后，不属于 active beat 失效；
- 没有证据表明 270 秒 beat 在本场出现 TTL 穿透。

## 5. Audit 网页 Timeline 详细分解

### 5.1 如何正确读取网页 Timeline

Audit viewer 的 timeline 不是甘特图，也不表示 agent 在首末时间之间一直占用模型。它的渲染规则如下：

- 每一行对应 `agents[index]` 中的一个 agent；
- 行底部的细横线只是该 agent **第一次和最后一次有 token usage 的请求跨度**；
- 每一根竖条是一条去重后的 API request；
- 竖条高度按该请求的 `context` 相对整场最大 context 缩放；
- 普通 warm HIT 是低对比度细条；
- spawn 是 agent 的第一个请求；
- churn 条会加宽，宽度按该请求的 `cacheWrite` 平方根缩放，因此越宽通常表示本次重写越大；
- 鼠标悬停可看到 `context / read / write / output`；如果该请求是 churn，还会显示 `gap / rewrote / prevPrefix`。

Claude timeline 的状态含义：

| Viewer 状态 | 含义 | 本场数量 |
|---|---|---:|
| `spawn (first request)` | agent 首次请求；冷启动但不计为 churn | 13 |
| `warm (cache hit)` | 延续缓存前缀 | 绝大多数请求 |
| `churn: TTL expiry` | 空闲超过 MAIN 60 分钟或 subagent 5 分钟 | 23 |
| `churn: rebase / injection` | 会话链分叉、外部消息或前缀变基 | 11 |
| `churn: context drop / compact` | compaction/rewind 后上下文缩短 | 0 |
| `churn: unattributed` | 其他指纹均未命中 | 0 |

#### 网页时间是 UTC

viewer 的横轴和 hover 时间通过 `toISOString()` 生成，所以页面显示 **UTC**，不是本机 Asia/Shanghai 时间。

- 页面起点约 `05:54`，对应北京时间 `13:54`；
- 页面上的 `20:10`，对应次日北京时间 `04:10`；
- 本节正文统一使用北京时间，并在重建事件账本中同时列出网页 UTC 时间。

### 5.2 Timeline 行与 agent 活动映射

“活动窗口”是首末 usage 请求跨度；其中可能包含数小时休眠或等待。真实工作段应看该行竖条的聚集。

| # | Timeline label | 实际职责 | 活动窗口（北京时间） | Requests / peak context | 重建 |
|---:|---|---|---|---:|---:|
| 0 | MAIN | Portfolio LEAD、派发、收集、归档与暂停 handoff | 07-25 13:54–07-26 12:58 | 342 / 751,889 | 6 / 2,691,283 |
| 1 | aplanner-portfolio | 持久 planner；提案 A、B、C、D/D1/D2、E | 07-25 14:00–07-26 04:40 | 189 / 567,413 | 7 / 2,751,822 |
| 2 | aimpl-child-a | 实现 A：`store-immutable-identity` | 07-25 14:16–16:08 | 255 / 608,513 | 0 |
| 3 | areviewer-child-a | A 的首轮 reviewer，之后 wait 到 beat-cap | 07-25 15:48–17:06 | 79 / 327,229 | 0 |
| 4 | afixer-child-a | 修复 A 的多轮 review findings | 07-25 16:11–07-26 04:28 | 452 / 638,716 | 3 / 1,722,791 |
| 5 | arereviewer-child-a | A 的复审，并继续复审 B、C，最后退休 | 07-25 17:39–07-26 09:53 | 311 / 676,611 | 9 / 4,023,091 |
| 6 | aplanner-f | 新 planner，提案 F：`portable-project-knowledge` | 07-26 04:42–04:52 | 31 / 165,023 | 0 |
| 7 | aimpl-child-b | 实现 B：`project-keyed-store-membership` | 07-26 04:50–06:01 | 276 / 533,469 | 0 |
| 8 | afixer-child-b | 修复 B，随后复用于 C、D1 的修复 | 07-26 06:21–10:48 | 302 / 488,539 | 3 / 1,098,852 |
| 9 | aimpl-child-c | 实现 C：`unified-session-runtime-context` | 07-26 07:24–08:15 | 244 / 390,104 | 0 |
| 10 | aimpl-child-d1 | 实现 D1：`store-scoped-learned-knowledge` | 07-26 08:48–09:49 | 192 / 517,008 | 1 / 497,847 |
| 11 | areviewer-d | 评审/复审 D1，之后评审 D2 | 07-26 09:54–12:32 | 113 / 375,807 | 4 / 1,036,606 |
| 12 | aimpl-child-d2 | 实现 D2：`learned-knowledge-effective-resolution` | 07-26 11:01–12:14 | 242 / 512,358 | 1 / 490,268 |

Timeline 上最健康的三行是 #2、#3，以及 #4 在 07-25 20:05 beat-cap 以前的部分：

- #2 implementer A 的 wait/resume 全部 HIT；
- #3 reviewer A 的 12 个续拍全部 HIT；
- #4 fixer A 的前两个 park episode 都由 resume signal 热恢复；
- 它们在 active park 内没有 TTL expiry。

### 5.3 按时间顺序分解整场活动

#### 阶段 I：启动、Phase A 规划与实现（07-25 13:54–15:48）

1. `MAIN` 启动 `rasen-auto auto-decompose`，建立 portfolio，并派发 #1 planner。
2. #1 `aplanner-portfolio` 在 14:00–14:15 完成 A 的 proposal；该段是单一 spawn burst，没有重建。
3. #2 `aimpl-child-a` 在 14:16 开始实现 A，主工作 burst 持续到 15:28；随后通过 warm HIT 做检查并进入 keepalive。
4. `MAIN` 在等待 planner/implementer 时空闲 78.3 分钟，于 15:46 收到 A 实现完成消息时发生本场第一次 TTL 重建：188,037 token。
5. #2 从约 15:46 开始执行四个 beat，在 16:04 收到 retire/resume instruction；整段都是 HIT。
6. #3 `areviewer-child-a` 于 15:48 启动 A 首轮评审。

本阶段说明：subagent keepalive 工作正常，但 MAIN 的 60 分钟 TTL 没有相应治理。

#### 阶段 II：A 首轮评审、修复与 reviewer 保温（07-25 15:48–17:39）

1. #3 reviewer A 在 15:48–16:09 完成首轮 review，报告 2 Blocker、5 Major、10 Minor。
2. #4 `afixer-child-a` 于 16:11 启动，开始修复 A。
3. reviewer A 进入 wait，从 16:14 到 17:05 形成约 4.6 分钟一次的细 HIT 条，共 12 beats。
4. fixer A 在 16:11–17:35 持续工作，中间的小 burst 均为 HIT。
5. reviewer A 在 17:05 达到 beat-cap，17:06 写 handoff 并退出；此 episode 没有发生重建，但也没有获得一次热恢复。
6. `MAIN` 的 16:04、17:06、17:35 burst 均为 HIT。

该阶段是 viewer 中 beat 最容易识别的一段：#3 行上出现近乎等间距的低对比度细条，没有 warn/critical churn。

#### 阶段 III：A 多轮 review-loop，planner B/C 复用（07-25 17:39–20:07）

1. #5 `arereviewer-child-a` 于 17:39 启动，做 A round-2 delta re-review。
2. #4 fixer A 多次在完成修复后 park：
   - 17:35–18:07：7 beats 后由 signal 恢复；
   - 18:39–18:48：2 beats 后由 signal 恢复；
   - 19:10–20:05：12 beats 后 beat-cap。
3. #5 rereviewer 没有进入 wait：
   - 18:41，空闲 32 分钟后恢复，TTL 重写 210,539；
   - 19:10，空闲 19 分钟后恢复，TTL 重写 282,286。
4. #1 planner 在 18:40 被重新用于 B：
   - 先因 265.1 分钟空闲发生 TTL 重写 193,694；
   - 18:55 在同一工作段内发生 rebase 307,087；
   - 19:02 接收 C proposal teammate message，再 rebase 334,454。
5. #4 fixer 在 20:05 beat-cap 后没有保持线性退出：
   - 20:06，处理 beat-cap tool result 时 rebase 587,672；
   - 20:07，又收到状态询问并 rebase 565,252。

本阶段形成鲜明对比：

- #4 在前两个 signal-resume episode 中保持 warm；
- #1 和 #5 通过普通消息重复激活，连续出现 TTL/rebase；
- #4 在 cap 退出后的两次交互，抵消了此前很大一部分缓存收益。

#### 阶段 IV：机器休眠、全体冷恢复与 D/E/F 规划（07-25 20:07–07-26 04:53）

20:07 后机器休眠约 8 小时。viewer 上表现为所有已有行的一大片空白，随后在网页 UTC `20:10` 附近集中出现宽 churn 条。

恢复簇：

1. 04:10 `MAIN`：
   - 536.1 分钟 TTL 重写 363,331；
   - 26 秒后又因分支/前缀变化 rebase 364,549。
2. 04:13 #1 planner：540.8 分钟 TTL 重写 427,254，开始 D proposal。
3. 04:14 #5 rereviewer：531.4 分钟 TTL 重写 347,666，按 infra-revival 指令恢复。
4. 04:18 #4 fixer：490.4 分钟 TTL 重写 569,867，恢复 A round 5。

休眠恢复之后：

- #1 planner 在 04:24、04:30、04:37 接收 D split、E proposal、退休 adjudication 消息，连续发生三次 rebase，共 1,489,333 token；
- #5 rereviewer 在 04:28 仅间隔 8.3 分钟又 TTL 重写 379,439；
- #1 于 04:40 完成 handoff 并退休；
- #6 `aplanner-f` 于 04:42–04:52 单独提案 F，全程无重建；
- #7 `aimpl-child-b` 于 04:50 启动。

机器休眠不是延长 beat cap 可以解决的问题。正确方向是休眠前 handoff、恢复后冷启动 successor，并禁止重新激活已经 retired 的大上下文 worker。

#### 阶段 V：B 实现、评审和修复（07-26 04:50–07:24）

1. #7 implementer B 从 04:50 连续工作到 05:56，06:00 的收尾 burst 仍为 HIT；该 agent 无 churn。
2. 06:01 `MAIN` 收到 B 完成消息，距上次请求 68.2 分钟，TTL 重写 496,416。
3. #5 rereviewer 在 06:03 被复用于 B review，空闲 82.8 分钟，TTL 重写 437,091。
4. #8 `afixer-child-b` 于 06:21 冷启动修复 B；首次 spawn 不计 churn。
5. #5 在 fixer 工作期间没有 park，06:59 空闲 38.7 分钟后做 B delta re-review，TTL 重写 520,719。
6. #5 于 07:12 给出 CLEAN TO SHIP；#9 implementer C 随后在 07:24 启动。

本阶段最可避免的是 #5 的 38.7 分钟 re-review gap：它在 54 分钟 beat budget 内，适合 LOOP_BOUND park + signal resume。

#### 阶段 VI：C 与 D1，实现角色健康、复审角色持续重建（07-26 07:24–09:54）

1. #9 implementer C 从 07:24–08:15 单一连续 burst 完成实现，无重建。
2. #5 rereviewer：
   - 08:17，跨 child 64.6 分钟后评审 C，TTL 重写 574,223；
   - 08:34，仅 8.2 分钟后做 C delta re-review，又重写 625,696。
3. #8 fixer B 被跨 child 复用于 C：
   - 08:26，空闲 88.4 分钟，TTL 重写 303,414。
4. #10 implementer D1 于 08:48 启动。主工作 burst 到 09:36，随后一个长测试/工具等待跨过 5 分钟：
   - 09:43，gap 6.2 分钟，TTL 重写 497,847。
5. 09:49 `MAIN` 距上次请求 60.9 分钟，在接收 D1 完成时重写 602,161。
6. 09:51 #5 rereviewer 被唤醒执行“retire with handoff”，空闲 73.2 分钟，单为退休动作就重写 645,432。
7. #11 `areviewer-d` 于 09:54 冷启动评审 D1。

本阶段显示两个问题：

- 长前台命令没有按 ≤270 秒轮询，导致 D1 implementer 在自己的任务内部过期；
- 一个已经高占用、准备退休的 reviewer 不应在冷掉之后只为写退休 handoff 而重新加载 64.5 万 token；handoff/retired 状态应在仍 warm 时完成。

#### 阶段 VII：D1 review/fix ping-pong（07-26 09:54–11:01）

1. #11 reviewer D 在 09:54–10:08 完成首轮 D1 review，初始 spawn 无 churn。
2. #8 fixer B 被第三次跨任务复用：
   - 10:10，gap 97 分钟，TTL 重写 346,785；
   - 10:42，gap 14.4 分钟，修复 m3 时又重写 448,653。
3. #11 reviewer D：
   - 10:29，等待修复 20.5 分钟，TTL 重写 173,909；
   - 10:49，等待 m3 8.0 分钟，TTL 重写 245,994。
4. 10:51 reviewer D 确认 CLEAN TO SHIP。
5. #12 implementer D2 于 11:01 启动。

这四个 TTL event 都属于典型 review-loop role switch。20.5、14.4、8.0 分钟都在 keepalive budget 内；如果 reviewer/fixer 在轮间 park，并通过 signal 交付下一轮，可直接针对这类重写。

#### 阶段 VIII：D2 实现、评审与会话暂停（07-26 11:01–12:58）

1. #12 implementer D2 在 11:01–11:53 完成主体工作，11:57 和 12:04 的 burst 都是 HIT。
2. 12:07，在长测试 tool result 后仅 1.3 分钟，#12 发生 rebase，重写 490,268。它不是 TTL；audit 识别到的是 forked prefix，原始前一条输入是测试 tool result，而不是 teammate message。
3. 12:14 `MAIN` 收到 D2 完成的外部 teammate message，gap 14.8 分钟但发生 rebase，重写 676,789。
4. #11 reviewer D 从 D1 结束后空闲 83.5 分钟：
   - 12:15，恢复评审 D2，TTL 重写 266,547；
   - 12:31，收到“确认 B1 inline fix”消息，gap 3.9 分钟仍 rebase 350,156。
5. 12:32 reviewer D 确认 CLEAN TO SHIP；`MAIN` 随后完成验证、暂停 handoff 和路径答复，至 audit 最后 usage 12:58。

本阶段的重点不再只是 beat：

- D2 的 tool-result rebase 需要检查 harness parent-chain 连续性和是否有同 agent 并行分支；
- MAIN 的 teammate completion 注入会让主链 rebase；
- reviewer D 的快速确认应在完成 D2 review 后 park，并用 signal 交付，而不是普通 teammate message。

### 5.4 34 次重建事件的完整时间账本

下列缓解代码用于压缩表格：

| 代码 | 可尝试的避免方案 |
|---|---|
| K | 预计 ≤54 分钟会复用：LOOP/MILESTONE worker 进入 `agent wait`，下一任务只走 signal |
| R | gap 长、不可预测或跨 child：仍 warm 时 handoff，标记 retired，后续冷启动 successor |
| S | 机器休眠/基础设施中断：不要延长 beat cap；恢复后按 handoff 冷启动 |
| L | 长测试/build：后台运行，前台以 ≤270 秒轮询维持线性缓存 |
| Q | 防 rebase：避免向 parked/retired worker 发送 teammate message，保持单一 parent chain |
| M | MAIN 专项：长停顿前 session relay/handoff；若要主会话保温，需另行验证 ≤55 分钟低频 check-in 的收益 |
| I | tool-result 自身触发 fork：检查 harness parent 链、并行 sidechain 和 audit 归因 |

| 北京时间（网页 UTC） | Agent | 原因 / 重写 | 触发背景 | 可尝试避免 |
|---|---|---:|---|---|
| 07-25 15:46（07:46） | MAIN | TTL / 188,037 | 等待 A 实现 78.3 分钟后收到 DONE | M：MAIN relay 或经验证的低频编排 check-in |
| 07-25 18:40（10:40） | planner | TTL / 193,694 | 265.1 分钟后开始 B proposal | R：长 gap 不 park，使用 planner handoff/cold successor |
| 07-25 18:41（10:41） | rereviewer A | TTL / 210,539 | 32 分钟后做 A round-3 | K：reviewer 轮间 park |
| 07-25 18:55（10:55） | planner | rebase / 307,087 | 同一 planner burst 内，tool-result 后前缀 fork | Q+I：保持线性工具结果链，排查 sidechain |
| 07-25 19:02（11:02） | planner | rebase / 334,454 | teammate message 派发 C proposal | K+Q：planner 先 park，再用 signal |
| 07-25 19:10（11:10） | rereviewer A | TTL / 282,286 | 19 分钟后做 A round-4 | K：reviewer 轮间 park |
| 07-25 20:06（12:06） | fixer A | rebase / 587,672 | beat-cap tool result 后立即 fork | R+I：cap 后直接退休；排查 standDown 后 parent 链 |
| 07-25 20:07（12:07） | fixer A | rebase / 565,252 | retired 边界后又收到状态询问 | R+Q：禁止再消息激活 retired worker |
| 07-26 04:10（07-25 20:10） | MAIN | TTL / 363,331 | 机器休眠 536.1 分钟 | S+M：休眠前 session handoff，恢复后新 session |
| 07-26 04:10（07-25 20:10） | MAIN | rebase / 364,549 | 冷恢复后 26 秒内 tool-result 前缀再次变化 | Q+I：新 session 保持线性恢复，避免双重重写 |
| 07-26 04:13（07-25 20:13） | planner | TTL / 427,254 | 休眠 540.8 分钟后派发 D | S+R：从 handoff 启动 successor planner |
| 07-26 04:14（07-25 20:14） | rereviewer A | TTL / 347,666 | infra revival，gap 531.4 分钟 | S+R：新 reviewer 读 review report/handoff |
| 07-26 04:18（07-25 20:18） | fixer A | TTL / 569,867 | 休眠 490.4 分钟后恢复 round 5 | S+R：不要恢复已 cap 的 fixer handle |
| 07-26 04:24（07-25 20:24） | planner | rebase / 458,827 | teammate message 要求拆分 D1/D2 | K+Q：短间隔 planner 任务用 signal |
| 07-26 04:28（07-25 20:28） | rereviewer A | TTL / 379,439 | 8.3 分钟后做 A round-5 | K：reviewer 轮间 park |
| 07-26 04:30（07-25 20:30） | planner | rebase / 498,488 | teammate message 派发 E proposal | K+Q：planner park + signal |
| 07-26 04:37（07-25 20:37） | planner | rebase / 532,018 | teammate message adjudication/retire | K+Q：signal standDown；handoff 在 warm 时完成 |
| 07-26 06:01（07-25 22:01） | MAIN | TTL / 496,416 | 等待 B 实现 68.2 分钟后收到 DONE | M：主会话 relay/check-in |
| 07-26 06:03（07-25 22:03） | rereviewer A | TTL / 437,091 | 82.8 分钟后跨 child 评审 B | R：超过 beat budget，启用 fresh reviewer/handoff |
| 07-26 06:59（07-25 22:59） | rereviewer A | TTL / 520,719 | 等 fixer 38.7 分钟后复审 B | K：标准 review-loop park |
| 07-26 08:17（00:17） | rereviewer A | TTL / 574,223 | 64.6 分钟后跨 child 评审 C | R：fresh reviewer；不要跨长 gap 复活大上下文 |
| 07-26 08:26（00:26） | fixer B | TTL / 303,414 | 88.4 分钟后跨 child 修复 C | R：fresh fixer 或 handoff seed |
| 07-26 08:34（00:34） | rereviewer A | TTL / 625,696 | 8.2 分钟后复审 C | K：reviewer park + signal |
| 07-26 09:43（01:43） | implementer D1 | TTL / 497,847 | 长测试/tool wait 造成 6.2 分钟 gap | L：后台测试 + ≤270 秒前台轮询 |
| 07-26 09:49（01:49） | MAIN | TTL / 602,161 | 60.9 分钟后收到 D1 DONE | M：主会话 relay/check-in |
| 07-26 09:51（01:51） | rereviewer A | TTL / 645,432 | 73.2 分钟后只为 retire/handoff 被唤醒 | R：在 warm 时退休；冷后无需复活旧 handle |
| 07-26 10:10（02:10） | fixer B | TTL / 346,785 | 97 分钟后跨 child 修复 D1 | R：fresh non-author fixer |
| 07-26 10:29（02:29） | reviewer D | TTL / 173,909 | 等修复 20.5 分钟后复审 D1 | K：reviewer 轮间 park |
| 07-26 10:42（02:42） | fixer B | TTL / 448,653 | 14.4 分钟后补 m3 | K：预计有下一小轮时 park |
| 07-26 10:49（02:49） | reviewer D | TTL / 245,994 | 8 分钟后确认 m3 | K：reviewer park + signal |
| 07-26 12:07（04:07） | implementer D2 | rebase / 490,268 | 测试 tool-result 后，非 TTL 的 forked prefix | L+I：后台轮询并检查 tool-result parent chain |
| 07-26 12:14（04:14） | MAIN | rebase / 676,789 | 外部 teammate completion 注入 D2 DONE | Q+M：在已知收集边界读取 task result/文件，减少异步注入 |
| 07-26 12:15（04:15） | reviewer D | TTL / 266,547 | 83.5 分钟后跨 child 评审 D2 | R：从 review handoff 启动 fresh reviewer |
| 07-26 12:31（04:31） | reviewer D | rebase / 350,156 | 3.9 分钟后 teammate message 要求确认 B1 | K+Q：review 后 park，确认任务走 signal |

### 5.5 Timeline 对缓存方案的最终含义

按时间轴看，问题并不是均匀发生的，而是集中在四种形态：

1. **规则生效区**\
   implementer A、reviewer A、fixer A 的 active wait 区间全部 warm；这是方案的正证据。
2. **review-loop 未 park 区**\
   rereviewer A、fixer B、reviewer D 产生 15 个短/中 gap TTL event，是最大的可治理部分。
3. **消息驱动 rebase 区**\
   persistent planner、MAIN、reviewer D 在 teammate message 后形成宽 critical 条；需要 signal/线性收集边界，而不仅是 beat。
4. **超出 keepalive 适用域**\
   机器休眠、MAIN 60 分钟 TTL、跨 child 数小时复用，应由 handoff/cold successor 解决。

因此，viewer timeline 支持与汇总指标相同的结论：**beat cadence 已经可靠，剩余收益取决于编排器能否把正确的 worker 放入 park、在正确的时刻 signal resume/standDown，并拒绝复用 retired handle。**

## 6. 所有 beat subagent 的 Token 成本审计

### 6.1 计量口径与成本边界

本节把 3 个实际调用过 `rasen agent wait` 的 subagent transcript 与模型请求 usage 逐条关联。需要先区分“等待时长”和“模型 token”：

- `agent wait` 的 Node 进程阻塞约 270 秒时，不会持续调用模型，因此这 270 秒本身不按时间消耗 token；
- token 发生在 subagent 发起 Bash tool call 的模型请求上，以及收到 `{beat}` 后再次发起下一次 wait 的模型请求上；
- 42 次 wait 请求中，每个 park episode 的第一次调用共 5 次，包含“从工作态切换到 park”的边界成本，单独列为 **首次入场**；
- 每次 `{beat}` 返回后再次发起 wait 的请求共 37 次，列为 **重复 beat 增量**，这是审计 beat 机制边际成本的主口径；
- `{resumed}` / `{standDown}` 返回后的首个请求已经离开 beat 循环，不计入重复 beat；这些请求在 6.6 中单列，避免把恢复后的正常工作或退出异常混入 beat 成本。

由于三个 worker 都是 Claude 5 分钟 TTL subagent，统一使用：

```text
billed input equivalent
= raw input + cache write × 1.25 + cache read × 0.1
```

下表的 input equivalent 与 audit 报告保持一致：先对每个模型请求的折算值取整，再汇总。它不是美元账单；output token 也不进入该 input-equivalent 公式，因此始终单列。

### 6.2 全部 42 次 wait 请求与 37 次重复 beat 增量

| 成本边界 | 请求数 | Raw input | Cache write | Cache read | Output | Billed input equivalent | 占全场 input eq |
|---|---:|---:|---:|---:|---:|---:|---:|
| 全部 wait 请求（gross） | 42 | 81 | 28,195 | 19,502,478 | 6,923 | 1,985,573 | 1.494% |
| 每个 episode 首次入场 | 5 | 10 | 20,542 | 2,391,850 | 910 | 264,872 | 0.199% |
| **重复 beat 增量** | **37** | **71** | **7,653** | **17,110,628** | **6,013** | **1,720,701** | **1.295%** |

这里的 1,950 万 cache read 是原始读取量，不等同于 1,950 万 billed input。按 0.1× 折算后，全部 wait 请求的成本构成为：

- cache read 贡献约 1,950,248 input equivalent，占 98.22%；
- cache write 贡献约 35,244，占 1.78%；
- raw input 仅 81，占比低于 0.01%。

只看更严格的“重复 beat 增量”口径：

- 17,110,628 cache read 折算为 1,711,063 input equivalent，占 99.44%；
- 7,653 cache write 折算为 9,566 input equivalent，占 0.56%；
- 71 raw input 占比低于 0.01%；
- 平均每次重复 beat 请求消耗约 **46,505 input equivalent** 和 **162.5 output token**。

重复 beat 的 cache write / cache read 仅为 **0.045%**。这说明 active beat 的主要成本是反复温读既有上下文，而不是反复重建整段缓存；少量 write 是每轮新增的 tool call / tool result 尾部。

### 6.3 按 subagent 分解

全部 wait 请求的 gross token：

| Subagent | Park episodes | Wait 请求 | Raw input | Cache write | Cache read | Output | Billed input equivalent |
|---|---:|---:|---:|---:|---:|---:|---:|
| `aimpl-child-a`（Implementer A） | 1 | 5 | 10 | 4,369 | 2,961,183 | 898 | 301,590 |
| `areviewer-child-a`（Reviewer A） | 1 | 13 | 25 | 5,192 | 4,169,171 | 2,229 | 423,431 |
| `afixer-child-a`（Fixer A） | 3 | 24 | 46 | 18,634 | 12,372,124 | 3,796 | 1,260,552 |
| **合计** | **5** | **42** | **81** | **28,195** | **19,502,478** | **6,923** | **1,985,573** |

排除每个 episode 首次入场后，重复 beat 的增量 token：

| Subagent | 重复请求 | Raw input | Cache write | Cache read | Output | Billed input equivalent | 平均 input eq / 次 |
|---|---:|---:|---:|---:|---:|---:|---:|
| `aimpl-child-a` | 4 | 8 | 798 | 2,372,048 | 704 | 238,211 | 59,553 |
| `areviewer-child-a` | 12 | 23 | 2,516 | 3,851,990 | 2,039 | 388,366 | 32,364 |
| `afixer-child-a` | 21 | 40 | 4,339 | 10,886,590 | 3,270 | 1,094,124 | 52,101 |
| **合计** | **37** | **71** | **7,653** | **17,110,628** | **6,013** | **1,720,701** | **46,505** |

不同 worker 的单拍成本不同，不应只按 beat 次数估算。它主要随当时保持温热的上下文长度变化：Reviewer A 每次约 3.24 万 input eq，而 Implementer A 每次约 5.96 万。

### 6.4 按 park episode 和最终结果分解

| Worker / episode | 终点 | 重复请求 | Raw input | Cache write | Cache read | Output | 重复 beat input eq | 成本结果 |
|---|---|---:|---:|---:|---:|---:|---:|---|
| Implementer A / 1 | resumed | 4 | 8 | 798 | 2,372,048 | 704 | 238,211 | 发生 warm reuse |
| Reviewer A / 1 | beat-cap | 12 | 23 | 2,516 | 3,851,990 | 2,039 | 388,366 | 未发生 reuse |
| Fixer A / 1 | resumed | 7 | 13 | 1,522 | 2,828,933 | 1,260 | 284,810 | 发生 warm reuse |
| Fixer A / 2 | resumed | 2 | 4 | 384 | 1,022,764 | 346 | 102,761 | 发生 warm reuse |
| Fixer A / 3 | beat-cap | 12 | 23 | 2,433 | 7,034,893 | 1,664 | 706,553 | 未发生 reuse |
| **合计** | **3 resumed / 2 cap** | **37** | **71** | **7,653** | **17,110,628** | **6,013** | **1,720,701** | — |

按最终是否实际恢复汇总：

| Episode cohort | Episodes | 重复请求 | Cache write | Cache read | Output | 重复 beat input eq | 成本占比 |
|---|---:|---:|---:|---:|---:|---:|---:|
| 最终 resumed | 3 | 13 | 2,704 | 6,223,745 | 2,310 | 625,782 | 36.4% |
| 最终 beat-cap | 2 | 24 | 4,949 | 10,886,883 | 3,703 | 1,094,919 | 63.6% |

这里的 beat-cap cohort 只表示 **保温成本没有在 cap 前兑现为 warm resume**，不等于两个 episode 都是无效空耗：

- Reviewer A 等待的是仍在进行的 implementer 修复；cap 后按协议写出 handoff，successor 读取该 handoff 后继续复审。这是有界的 `12-beat + handoff` 策略，不是 LEAD 已确认无需复用却忘记 standDown。
- Fixer A 的第三个 episode 才暴露出生命周期问题：cap 后出现两次 rebase，且 retired handle 后来又被直接复用。

因此，需要评估的是 Reviewer A 是否值得延长保温，而不是把它与 Fixer A 一并归因为“未主动收口”。

### 6.5 Reviewer A：`12-beat + handoff` 与延长 beat 的实测比较

#### 时间关系

| 事件 | 北京时间 | 与 handoff 落盘的关系 |
|---|---|---:|
| Reviewer A 收到 beat-cap | 07-25 17:05:08.539 | -45.475 s |
| `reviewer-1.md` 写入成功 | 07-25 17:05:54.014 | 0 |
| Reviewer A 完成通知并退出 | 07-25 17:06:17.276 | +23.262 s |
| Fixer A 报告 round-1 修复完成 | 07-25 17:35:07.767 | +29 min 13.753 s |
| Successor `arereviewer-child-a` 启动 | 07-25 17:39:18.380 | **+33 min 24.366 s** |
| Successor 发起读取 `reviewer-1.md` | 07-25 17:39:22.534 | +33 min 28.520 s |
| Successor 完成 round-2 复审 | 07-25 18:09:57.632 | +64 min 03.618 s |

如果从 Reviewer A 最终退出计算，successor 在 **33 分 01.104 秒**后启动；从 Fixer A 宣告修复完成到 successor 启动只间隔 **4 分 10.613 秒**。这证明 successor 不是无关的后续 reviewer，而是直接承接同一轮修复验证。

#### Successor 的实际 token

| 范围 | 请求 | Raw input | Cache write | Cache read | Output | Billed input equivalent |
|---|---:|---:|---:|---:|---:|---:|
| Successor 冷启动首请求 | 1 | 2 | 23,039 | 18,828 | 226 | 30,684 |
| 启动并吸收 handoff（前 2 请求累计） | 2 | 4 | 27,790 | 60,695 | 402 | 40,811 |
| Successor 完成整个 round-2 复审 | 82 | 3,766 | 207,664 | 12,654,759 | 63,760 | **1,528,826** |
| 原 Reviewer cap 后写 handoff、通知并退出 | 3 | 6 | 4,854 | 971,250 | 1,594 | **103,198** |
| **cap 后至 successor 完成本轮的实际路径** | **85** | **3,772** | **212,518** | **13,626,009** | **65,354** | **1,632,024** |

1,528,826 中绝大部分是必须执行的 delta review、定向测试、一次 EBUSY 隔离重跑和报告编写，不能全部归为 handoff 开销。可以无争议地识别为“切换边界”的部分是旧 reviewer 的 handoff/退出 103,198，以及 successor 启动并吸收 handoff 的前两请求 40,811；合计 **144,009 input equivalent**。

#### 如果延长 Reviewer A 的 beat

按本场 Reviewer A 尾部实测增长外推：每次续拍约增加 198 个尾部 token，raw input 约 2，cache write 约 198；output 使用其 12 次重复请求的平均值估算。结果如下：

| Resume signal 时点 | 需要从一开始设置的 `maxBeats` | 比实际路径新增的 wait 请求 | 估算 Cache read | 估算 Cache write | 估算 Output | 估算新增 input eq |
|---|---:|---:|---:|---:|---:|---:|
| Fixer DONE，17:35:07 | 至少 19 | 6 | 1,937,208 | 1,188 | ≈1,020 | **195,218** |
| Successor 实际启动，17:39:18 | 至少 20 | 7 | 2,260,769 | 1,386 | ≈1,189 | **227,824** |

“至少 19”表示允许 7 个额外 beat 容量；实际会有 6 个新增模型续拍请求，最后一个阻塞 wait 在 17:35 左右被 signal 提前唤醒。17:39 才 signal 时则需要 `maxBeats >= 20`。

以 Fixer DONE 时立即 resume 为例：

```text
实际 12-beat + handoff + successor 路径       1,632,024
- 延长保温的新增 beat 成本                     195,218
= 原 Reviewer 完成本轮可使用的 break-even 预算 1,436,806
```

因此，延长策略要胜出，原 Reviewer 的 warm round-2 工作成本必须低于 **1,436,806**，即至少比 successor 的实测 1,528,826 少 **92,020（6.0%）**。如果到 17:39 才 resume，则预算降为 **1,404,200**，需要至少少 **124,626（8.2%）**。

但 warm worker 的每次请求并不天然更便宜：延长到 17:35 时，原 Reviewer 会携带约 32.36 万 token 的上下文，而 successor 从 4.19 万起步。若两者都使用相同的 82-request 工作形状，单是额外 cache read 就会使原 Reviewer 多约 231.0 万 input equivalent，延长明显更贵。按只读下界估算，原 Reviewer 必须把 round-2 压缩到最多约 **44 个请求**；计入新 cache write 后还要更少，才能落入 break-even 预算。

这给出更准确的判定：

- 如果原 Reviewer 因保留 finding、测试和代码定位，能把复审请求数从 successor 的 82 次压到约 40 次以内，延长到 19 beats 可能更省且保持更强语义连续性；
- 如果修复验证仍需接近 82 次请求，`12-beat + handoff + 小上下文 successor` 更便宜；
- 本次数据不能证明原 Reviewer 实际会用多少请求，所以不能把 Reviewer A 的 beat-cap 判为错误。当前选择是合理的有界策略，延长方案也是值得在后续样本中 A/B 审计的候选。

还有一个实现约束：当前 `loadBeatState()` 在 `maxBeats` 改变时会重置 episode state。因此不能在第 12 beat 临时把 `--max-beats 12` 改成 19；要么从 episode 第一次 wait 起就保持相同的 19，要么新增“只提高 cap、保留已消费 beats”的 extend 原语。延长期间，LEAD 仍可通过 `standDown` signal 在 5 秒轮询窗口内提前中断。

### 6.6 终点后的首个请求：为何不计入 beat 成本

下表是每个 `{resumed}` / `{standDown}` 后的首个模型请求，用来验证成本边界和缓存状态，不计入前述 1,720,701 重复 beat input eq：

| Worker / 终点 | Raw input | Cache write | Cache read | Output | Input eq | 归类 |
|---|---:|---:|---:|---:|---:|---|
| Implementer A / resumed | 1 | 1,306 | 593,504 | 5 | 60,984 | 已恢复后的正常工作请求；HIT |
| Fixer A / resumed 1 | 2 | 2,205 | 404,966 | 3 | 43,255 | 已恢复后的正常工作请求；HIT |
| Fixer A / resumed 2 | 2 | 2,380 | 511,670 | 3 | 54,144 | 已恢复后的正常工作请求；HIT |
| Reviewer A / beat-cap | 2 | 204 | 322,373 | 3 | 32,494 | 退出 follow-up；HIT |
| Fixer A / beat-cap | 2 | 587,672 | 0 | 2 | 734,592 | cap 后立即 rebase；属于缓存重建问题 |

前三行正是用来估算“如果没有 keepalive，本应重写多少上下文”的 warm resume 证据。最后一行则相反：它是 beat-cap 之后的异常重建，必须计入全场 churn 和生命周期缺陷，但不能倒灌为 active beat 的 cadence 成本。

### 6.7 Beat 成本审计结论

1. **机制的边际成本可量化为 1,720,701 input equivalent，而不是 270 秒 × 某个速率。** 模型在阻塞等待期间不持续烧 token；成本来自 37 次续拍请求。
2. **beat 期间没有出现整段缓存反复重建。** 重复请求 99.44% 的 input-equivalent 成本来自折价 cache read，cache write 只占 0.56%。
3. **成功恢复 cohort 的成本是合理的。** 625,782 的重复 beat 成本换来约 1,671,704 的避免重写 premium，净节省约 1,045,922。
4. **两个 beat-cap episode 必须分开解释。** Reviewer A 采用 handoff 由 successor 在 33 分钟后续接，是 `12-beat + handoff` 与延长保温之间的成本选择；Fixer A 才存在 cap 后 rebase 和 retired handle 复用问题。
5. **后续审计应同时报告 gross、重复增量、cap 后 handoff/successor 成本和延长反事实。** 只看 42 次 gross 会把首次 park 边界混入；只看 resumed 会低估 handoff 的连续性价值；把所有 cap 都称为空耗则会误判合法的 stop-loss。

## 7. 经济性判断

### 7.1 真正发生复用的 episode

三次 warm resume 的估算：

- 避免重写：1,453,656 token
- 按子代理 cold write 1.25× 与 warm read 0.1× 的差额，避免 premium：\
  `1,453,656 × 1.15 = 1,671,704 billed-input-equivalent`
- 这三个 episode 的重复 beat 开销：625,782 billed-input-equivalent
- 估算净节省：**1,045,922 billed-input-equivalent**
- 相对 cold premium 的净削减：**62.6%**

因此，**只看真正发生复用的 episode，效果落在设计预期的 40–75% 节省区间内。**

### 7.2 全部 episode

两个没有在 cap 前发生热恢复的 episode 消耗了：

- 24/37 个 timed beats
- 1,094,919 billed-input-equivalent 的重复 beat 开销
- 占全部重复 beat input 开销的 63.6%

全场 keepalive 反事实净值约为：

`1,671,704 避免 premium - 1,720,701 重复 beat 开销 = -48,997`

即在“只承认 warm resume 避免的 rewrite、不计 handoff 连续性”的窄口径下，**input-equivalent 接近持平、略为负值**。此外，42 个 wait 调用还产生了 6,923 output token；output 不属于 billed-input-equivalent 公式，因此未进入上式。

这说明：

- 技术机制有效；
- 对“确实会在 54 分钟内复用”的 worker 有正收益；
- Reviewer A 的等待超过默认 54 分钟边界后，以 handoff 交给小上下文 successor，是可辩护的 stop-loss；是否延长到 19–20 beats 取决于旧 reviewer 能否把复审工作压缩到约 40 个请求；
- Fixer A 的 cap 后 rebase 与 retired handle 再利用仍是明确的生命周期缺陷。

## 8. 仍然存在的缓存重建问题

### 8.1 TTL expiry：主要是覆盖和生命周期问题

| Agent | 角色 | Events | 重写 token | TTL 重写占比 | Gap 范围 |
|---|---|---:|---:|---:|---:|
| arereviewer-child-a | reviewer | 9 | 4,023,091 | 44.0% | 8.2–531.4 min |
| MAIN | main | 4 | 1,649,945 | 18.0% | 60.9–536.1 min |
| afixer-child-b | fixer | 3 | 1,098,852 | 12.0% | 14.4–97.0 min |
| areviewer-d | reviewer | 3 | 686,450 | 7.5% | 8.0–83.5 min |
| aplanner-portfolio | planner | 2 | 620,948 | 6.8% | 265.1–540.8 min |
| afixer-child-a | fixer | 1 | 569,867 | 6.2% | 490.4 min |
| aimpl-child-d1 | implementer | 1 | 497,847 | 5.4% | 6.2 min |

#### 问题 A：高复用 reviewer/fixer 未进入 park

`arereviewer-child-a`、`afixer-child-b` 和 `areviewer-d` 被多轮重复使用，却从未调用 wait，合计造成：

- 15 次 TTL expiry
- 5,808,393 token 重写
- 占全部 TTL 重写的 63.5%

其中多次 gap 只有 8–20 分钟，正是 keepalive 的目标区间。该问题不是 beat 失效，而是 LOOP_BOUND horizon 没有落实。

#### 问题 B：persistent planner 没有执行 MILESTONE_BOUND park

`aplanner-portfolio` 没有调用 wait。它经历了两次长 TTL MISS，并在短间隔的后续 propose 消息上发生五次 rebase。当前 playbook 已要求：下一次 propose 会在 beat budget 内到来时，planner 应 park 并通过 resume signal 接收任务。本次运行没有执行这一规则。

#### 问题 C：机器休眠无法靠 54 分钟 beat cap 解决

机器约 8 小时休眠后的同一恢复簇中，MAIN、planner、rereviewer、fixer 共发生四次 TTL 重写，合计 **1,708,118 token**。其中 transcript 明确记录“machine sleep (~8h)”。

这类 gap：

- 超过 12 beats / 约 54 分钟上限；
- 机器休眠时 Node wait loop 也不能正常续拍；
- 应通过 handoff + 冷启动 successor 处理，而不是延长 beat cap。

#### 问题 D：长前台命令超过子代理 TTL

`aimpl-child-d1` 在一个长测试命令返回后，6.2 分钟 gap 触发 497,847 token TTL 重写。这与 playbook 已加入的“长命令后台执行 + 最多 270 秒前台轮询”规则相反，说明该规则尚未稳定落地。

#### 问题 E：MAIN 不在现有子代理 keepalive 的治理范围

MAIN 的四次 TTL expiry 重写 1,649,945 token。主会话 TTL 为 60 分钟，当前 `rasen agent wait` 面向 parked subagent，不解决主会话长时间无人操作。对 MAIN 应使用：

- 长停顿前 session handoff；
- 机器休眠后的 successor session；
- 减少不必要的外部消息对长主链的重新激活。

### 8.2 Rebase：信号通道只在已 park 的 worker 上发挥作用

| Agent | Events | 重写 token | Rebase 占比 | Gap 范围 |
|---|---:|---:|---:|---:|
| aplanner-portfolio | 5 | 2,130,874 | 41.3% | 0.7–2.5 min |
| afixer-child-a | 2 | 1,152,924 | 22.3% | 0.3 min |
| MAIN | 2 | 1,041,338 | 20.2% | 0.4–14.8 min |
| aimpl-child-d2 | 1 | 490,268 | 9.5% | 1.3 min |
| areviewer-d | 1 | 350,156 | 6.8% | 3.9 min |

至少 6/11 个 rebase event 的原始 transcript 前一条用户侧输入是 `<teammate-message>` 或 “Another Claude session sent a message”，合计重写 **2,850,732 token（55.2%）**。这与“直接消息投递可能使前缀变基”的已知机制一致。

尤其值得关注：

- planner 在 0.7–2.5 分钟的极短 gap 内仍发生五次 rebase；TTL 完全不是原因；
- reviewer D 接收快速确认消息时，3.9 分钟内仍重写 350,156 token；
- MAIN 接收 D2 完成消息时重写 676,789 token。

因此，仅把 beat 间隔压在 5 分钟内还不够。**worker 必须真实处于 park 状态，并且下一条任务必须走 signal file，而不是 teammate message / SendMessage。**

### 8.3 beat-cap 后的异常重建

`afixer-child-a` 第三个 episode 达到 beat cap 后：

1. `{standDown: true, reason: "beat-cap"}` 的后续请求立即发生一次 587,672 token rebase；
2. 约 1.3 分钟后用户状态询问又触发 565,252 token rebase；
3. 两次 gap 在 audit 中均约为 0.3 分钟。

合计 **1,152,924 token**。同场 reviewer 的 beat-cap follow-up 是 HIT，说明这不是所有 standDown 都必然发生，而是 fixer 会话的分支连续性或退出后的再交互出现了问题。

当前 playbook 要求 standDown 后将 worker 视为 retired，不再恢复。实际运行中该 fixer 在机器休眠后又被复用，并再产生一次 569,867 token TTL MISS。说明“retired handle 禁止复用”的生命周期约束目前只是文本规则，没有被运行状态强制执行。

### 8.4 beat-cap 是 stop-loss，不应与“忘记 standDown”画等号

5 个 park episode 中：

- 3 个由 resume signal 正常结束；
- 0 个由 `lead-stand-down` 正常结束；
- 2 个由 beat-cap 结束。

这个分布本身不能证明 LEAD 收口失败。`lead-stand-down` 适用于 LEAD 已经知道 worker 不再需要的情况；Reviewer A 的事实相反：后续复审仍然需要，只是 implementer 在默认 12-beat 窗口内没有完成。Reviewer A 在 cap 后写出 handoff，33 分 24 秒后 successor 启动并读取它，属于协议设计的正常 fallback。

Reviewer A 的正确决策问题是：

- 维持默认 12 beats，在 cap 写 handoff，并让小上下文 successor 继续；
- 或从 park 开始就把 cap 提高到约 19–20，在延长期间由 LEAD 根据 implementer ETA 发 resume / standDown。

第 6.5 节的反事实显示，延长到 Fixer DONE 需要约 195,218 额外 input equivalent；只有当旧 reviewer 能把 successor 实测 82-request 复审显著压缩到约 40-request 量级时，延长才更可能更省。当前样本不足以证明哪一策略必胜，因此 **Reviewer A 的 beat-cap 不列为问题**。

Fixer A 则不同：它在 cap 后发生两次 rebase，之后 retired handle 又被复用。这里的问题不是“没有 lead-stand-down”，而是退出后的状态和通信边界没有被强制执行。

### 8.5 `agent wait` 对 Store 不可用状态不够稳健

本 session 的 reviewer 在临时项目中实际验证：

```text
rasen agent wait --change dummy --role reviewer
Error: Store nowhere is declared by this project but is not registered on this machine.
exit 1
```

当前 `AgentCommand.wait()` 在输出结构化 outcome 前先调用 `resolveCurrentPlanningHomeSync()`。当项目声明的 Store 不可用时，它会抛错，而不是返回一个可处理的 `standDown` JSON。

这意味着一旦真实工作目录处于 Store unavailable 状态：

- worker 无法进入 keepalive；
- 叶子代理可能把它当普通命令失败处理；
- 后续复用重新退化为 TTL/rebase 重写。

现有 `agent-wait` 单测覆盖注册 Store、配置优先级、signal、beat-cap、runtime gate、BOM 和 stale signal，但未覆盖“声明 Store 不可用”的命令级路径。

### 8.6 信号写入仍依赖手工 shell，存在操作脆弱性

主会话第一次尝试用内联 `node -e` 原子写 resume signal 时，因为 Bash quoting 失败并返回 exit 2；之后通过其他方式写入，implementer 最终成功收到 resume。

这次没有造成缓存 MISS，但说明 LEAD 侧缺少一等的 signal 命令：

- 复杂 instruction payload 容易被 shell quoting、编码和 Windows 路径破坏；
- 当前只能依赖模板要求 LEAD 正确实现 temp-file + rename；
- 一旦写入失败，park worker 会继续烧 beat，直至 cap。

## 9. 根因归纳

本次剩余缓存重建可以归为五类：

1. **编排覆盖缺失**\
   多个真正被复用的 reviewer、fixer 和 planner 没有进入 wait。
2. **生命周期状态未强制，且 cap 策略缺少成本输入**\
   beat-cap 后的 retired worker 仍可被消息重新激活；对于仍确定有后续任务的 worker，编排器也没有根据 implementer ETA、上下文大小和 successor 成本选择默认 cap、延长或 handoff。
3. **通信通道未统一**\
   非 park 或错误生命周期下仍通过 teammate message 重新接触大上下文 worker，产生 rebase。
4. **长阻塞与环境停顿**\
   6.2 分钟前台测试、8 小时机器休眠、主会话超过 60 分钟空闲均不受当前 active beat 覆盖。
5. **命令和可观测性缺口**\
   Store unavailable 会让 wait 在 outcome 前失败；audit 不直接标注 wait episode，必须手工 join transcript 才能计算收益。

因此，当前问题的中心已经从“是否有可行 keepalive 原语”转移为“编排器是否可靠地选择、驱动和终止 keepalive 生命周期”。

## 10. 建议

### P0：先修正编排正确性

1. **把 reuse horizon 和 park 状态写入 run-state 并机器校验。**\
   每个 worker 明确记录 `ONE_SHOT | LOOP_BOUND | MILESTONE_BOUND`、`active | parked | retired`。LEAD 在复用前必须检查状态；retired handle 禁止再次 SendMessage。

2. **对 eligible worker 强制执行 park。**\
   apply implementer 等待首轮 verdict、review-loop reviewer/fixer 等待下一轮、短间隔 persistent planner 都应由模板自动生成 wait loop 指令，而不是依赖 LEAD 临场记忆。

3. **禁止向 parked 或 retired worker 投递 teammate message。**\
   parked 只能使用 signal；retired 必须用 handoff 冷启动 successor。对未 park 但预计很快复用的 worker，应先完成当前轮并进入 park，再投递下一任务。

4. **把 beat cap 变成显式成本决策，而不是单向追求主动 standDown。**\
   park 开始时记录 implementer ETA、worker 当前 context、successor 启动成本和预期复审请求数。已知不再需要时由 LEAD 立即 `standDown`；仍有后续任务但 ETA 超过默认窗口时，在“12-beat + handoff”与有限延长之间选择。延长必须同时设置 deadline，ETA 再次滑移时由 LEAD signal standDown；正常到 cap 且已写 handoff 不是失败。

5. **落实长命令 warming。**\
   对预计超过 2 分钟的测试/build，统一使用后台进程和不超过 270 秒的前台轮询。最好由 helper 封装，而不是只写在 playbook 文本中。

### P1：补齐命令原语和容错

6. **新增 `rasen agent signal`。**\
   例如：

   ```text
   rasen agent signal --change <name> --role <key> --resume-file <path>
   rasen agent signal --change <name> --role <key> --stand-down
   ```

   由 CLI 负责 JSON 编码、同目录临时文件、原子 rename、Windows 路径和 BOM，消除手工 shell 写信号。

7. **支持不重置 episode 的 cap 延长。**\
   当前 `maxBeats` 改变会让 `loadBeatState()` 重置计数，无法在第 12 beat 根据新 ETA 安全地从 12 提高到 19。应新增有上限、只允许单调增加的 `rasen agent extend` / signal 字段，保留 `beats` 与 `startedAt`，并把 extension reason、旧/新 cap 和 LEAD deadline 写入状态及 audit。

8. **让 wait 对 Store unavailable fail-soft。**\
   `agent wait` 应尽量按本地 change root 工作，或把 planning-home 解析失败映射为明确的结构化 standDown reason；至少增加命令级回归测试，防止叶子代理收到非 JSON 异常。

9. **为机器休眠建立明确降级策略。**\
   不应提高默认 beat cap 来覆盖数小时休眠。检测到超长 gap 后，直接将旧 worker 视为 cold/retired，使用 handoff 启动 successor。

10. **主会话使用 handoff 而非 keepalive。**\
   对预计超过 60 分钟的停顿或睡眠，主动完成 session handoff；不要试图把 subagent 的 5 分钟 keepalive 模式扩展成主会话常驻 ping。

### P2：让收益可直接审计

11. **在 audit 中原生识别 keepalive episode。**\
    报告应直接提供：
    - wait calls / timed beats / cadence；
    - resumed / lead-stand-down / beat-cap；
    - 每个 episode 的实际 read/write/output；
    - 避免的重写估算；
    - cap 后 handoff、successor 启动和 extend 反事实；
    - beat 后的异常 rebase。

12. **区分环境性 TTL 与编排性 TTL。**\
    将机器休眠、主会话 60 分钟空闲、长命令、eligible worker 未 park 分开，否则总体 TTL 数字会掩盖 keepalive 本身是否退化。

## 11. 下一轮验收标准

建议在一个相似规模的 portfolio/review-loop session 上使用以下指标：

| 指标 | 建议门槛 |
|---|---:|
| Timed beat 间隔小于 300 秒 | 100% |
| Eligible LOOP/MILESTONE worker 实际进入 park | ≥ 90% |
| Warm resume HIT | 100%，并累计至少 20 个样本 |
| Parked worker 收到 teammate message 导致 rebase | 0 |
| Retired worker 被再次直接复用 | 0 |
| 非 resume episode 的 handoff 覆盖率 | 100% |
| Extend / cap / handoff 决策记录 ETA、context 与 break-even | 100% |
| 超过默认 cap 的延长 episode 有 LEAD deadline | 100% |
| cap 后发生消息注入或旧 handle 复用 | 0 |
| Eligible、非休眠 subagent 的 TTL 重写 token | 比本次下降 ≥ 70% |
| 长前台命令导致的 TTL event | 0 |
| Keepalive 全场净 billed-input-equivalent | 明确为正 |

机器休眠和 MAIN TTL 应单列，不计入“eligible subagent keepalive 失败率”。

## 12. 最终判定

**方案判定：保留并继续推进；机制有效，产品化未完成。**

- `rasen agent wait` 的 270 秒 beat、330 秒 tool timeout、持久 beat state 和 signal resume 在本场均有直接成功证据；
- 三次真正复用的 episode 全部热恢复，局部净削减估算为 62.6%，达到设计目标；
- 但只有 25% 的子代理使用过 wait；两个 cap episode 占了大部分 beat 成本，其中 Reviewer A 是有 handoff 的合法 stop-loss，Fixer A 才存在 cap 后 rebase 和 retired-handle 复用缺陷；
- Reviewer A 的样本不足以证明默认 12 beats 或延长到 19–20 beats 必然更优；break-even 要求旧 reviewer 把复审从 successor 的 82 请求压缩到约 40 请求量级；
- 残余问题以未 park 的重复角色、team message rebase、缺少可审计的 cap/extend 决策、长前台命令和休眠后的旧 worker 复用为主。

下一步应把资源投入到 **horizon/park/retired 状态机、signal/extend CLI、cap-vs-handoff 成本决策和 audit 原生归因**，而不是调整 270 秒 beat cadence 本身。

## 13. Plan B 调研：把每个 worker 改为独立 Claude Code Session

### 13.1 结论摘要

**Plan B 技术上可行，而且 Claude Code 现有能力已经覆盖大部分“会话宿主”问题；真正需要由 Rasen 新建的是可靠的跨 session 控制平面。**

该方案不应理解为“为每个 subagent 手工再开一个终端窗口”，而应理解为：

```text
LEAD session generation N ─┐
                           ├─ Rasen broker + durable message journal
LEAD session generation N+1┘             │
                          ┌───────────────┼───────────────┐
                          ▼               ▼               ▼
                  Reviewer session  Implementer session  Fixer session
                    1h cache tier      1h cache tier       1h cache tier
```

每个 worker 都是独立的、可恢复的完整 Claude Code conversation；LEAD 只持有 worker 的逻辑 ID、Claude session ID 和消息邮箱，不再持有只能在当前进程内使用的内置 subagent handle。这样 LEAD 做 session handoff 时，worker 不需要一起死亡或重建。

建议把 Plan B 定位为一个 **实验性并行后端**，先与当前内置 subagent + beat 路径并存，不立即全量替换。原因是：

- 对 5–60 分钟的空闲窗口，1 小时主会话缓存可以大幅减少 270 秒 beat；
- 对很短的等待，独立主会话的 1 小时 cache-write 系数更高，未必更便宜；
- 超过 60 分钟仍会过期；Plan B 是把保温频率从约 4.5 分钟降低到约 55 分钟，而不是获得永久缓存；
- Channels、agent view 当前均带 research preview 属性，必须先验证消息注入是否继续命中缓存；
- 独立 session 默认 worktree 隔离与 Rasen 当前共享工作区/单写者假设存在直接冲突。

### 13.2 Claude Code 已经提供的宿主能力

本机安装的 Claude Code 版本为 `2.1.220`。官方从 `2.1.139` 起提供 agent view/background session；每个 background session 都是一个完整 Claude Code conversation，有独立进程，并由 per-user supervisor 托管。可以通过：

```text
claude --bg --name <name> "<prompt>"
claude agents --json --all
claude attach <id>
claude logs <id>
claude stop <id>
claude respawn <id>
```

启动、发现、检查、停止和恢复这些 session。官方说明 background session 即使没有终端附着也会继续运行，transcript 和状态会持久化；进程退出后仍可从原 conversation 恢复。详见 [Agent view / background sessions](https://code.claude.com/docs/en/agent-view)。

本机只读探测 `claude agents --json --all` 已能列出当前交互式 session 的 `pid`、`cwd`、`sessionId`、`name` 和 `status`；`claude daemon status` 显示当时尚未启动 background supervisor、background roster 为 0。这证明所需 CLI 能力已经安装，但**不能替代一次真实 background worker 的缓存账单验证**。

Claude Code 官方对几种并行方式的定位也支持本方案的边界：

- agent view session 是独立任务，默认只向用户报告；
- agent team 才自带 lead、共享任务表和 inter-agent messaging；
- 多个 session 会独立消耗配额。

参见 [Run agents in parallel](https://code.claude.com/docs/en/agents)。Plan B 刻意不用内置 subagent/agent team，因此必须自己补上 inter-session messaging。

#### 现成能力与缺口

| 能力 | Claude Code 当前提供 | Rasen 仍需负责 |
|---|---|---|
| 启动独立 session | `claude --bg`、Agent SDK、普通交互进程 | 角色模板、命名、worker registry |
| 进程托管 | background supervisor 可重启/respawn | run 级生命周期与预算策略 |
| transcript 持久化 | session ID + 本地 JSONL | worker 与 change/run 的稳定映射 |
| 状态发现 | `claude agents --json` | 统一为 Rasen 状态机、合并非 background host |
| 人工接管 | `claude attach`、agent view reply | 自动化的定向消息注入 |
| 恢复对话 | `--resume <sessionId>` / SDK `resume` | cwd/worktree 校验、冷启动判定 |
| session 间通信 | agent view 只有人工 reply；独立 session 不互通 | broker、邮箱、ACK、去重、路由 |
| LEAD handoff | Rasen 已能启动 successor LEAD | broker leadership/epoch 转移 |
| 跨 session audit | 单 session transcript 可审计 | 按 run 聚合多个主会话 |

关键缺口是：公开 shell 管理命令提供 `list/attach/logs/stop/respawn`，但没有稳定的 `claude send <session-id> <message>` 自动化命令。agent view 内可以人工 reply，却不能作为 Rasen 的机器协议。因此不能只靠 `claude --bg` 完成 Plan B。

### 13.3 三条通信实现路线

#### 路线 A：Agent SDK streaming input，建议作为基线

Claude Agent SDK 的 streaming input 是官方推荐的长期交互模式。它支持：

- 长生命周期进程；
- 自然多轮上下文；
- 动态排队多条消息；
- 中断；
- permission/user-input 处理；
- 完整工具与 MCP；
- session ID 捕获、resume 和 fork。

官方示例直接把一个 `AsyncGenerator<SDKUserMessage>` 作为消息流传给 `query()`；Python `ClaudeSDKClient` 还提供持续的 `query()` / `receive_response()` 对。参见 [Agent SDK Streaming Input](https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode) 与 [Work with sessions](https://code.claude.com/docs/en/agent-sdk/sessions)。

在这条路线中，Rasen supervisor 自己持有 N 个 Claude Code/Agent SDK worker 进程：

```text
rasen worker send
      │
      ▼
durable inbox → SDKUserMessage queue → Claude worker session
                                      └→ streamed result → durable outbox
```

优点是消息发送、排队、中断和结果流都是公开的程序接口，不依赖预览版 Channel 协议，也不需要为每个 worker 分配端口。缺点是 Rasen 要负责进程托管、崩溃恢复和 backpressure；这些 SDK worker 也不能假定自动出现在 background supervisor 的可管理 roster 中。

当前项目未发现 `@anthropic-ai/claude-agent-sdk` 依赖。如果采用此路线，需要新增依赖和一个 `WorkerHost` 适配层；本次调研没有做安装或代码改动。

#### 路线 B：background session + 自定义 Channel，最贴近“端口发消息”

Claude Code Channels 是一个 MCP server 向**正在运行的原 session**主动推送事件的协议。Channel 可以双向工作：收到外部消息后注入当前 Claude session，Claude 再通过 MCP reply tool 回传。官方明确要求 session 保持打开，因而 background session 正适合作为宿主。参见 [Push events with Channels](https://code.claude.com/docs/en/channels)。

自定义 Channel 的技术契约是：

1. Claude Code 为该 session 启动一个 MCP stdio 子进程；
2. 子进程声明 `claude/channel` capability；
3. 子进程发送 `notifications/claude/channel`；
4. `content` 被包装为 `<channel>` 事件进入当前 session；
5. 若需双向通信，Channel 再暴露 reply MCP tool。

官方 [Channels reference](https://code.claude.com/docs/en/channels-reference) 给出的 webhook 示例就是监听 `127.0.0.1:8788`，收到 HTTP POST 后通过 stdio 将事件送入 Claude。这说明“session 起本地端口”的设想有官方技术路径。

但 Channel 目前有几个上线限制：

- research preview，协议和 flags 可能变化；
- `--channels` 暂不显示在 `claude --help`；
- 自定义 Channel 在预览期通常要用 `--dangerously-load-development-channels`；
- Team/Enterprise 需要管理员启用；
- 不支持 Bedrock、Vertex/Google Cloud Agent Platform 或 Microsoft Foundry；
- 每个入站事件都会唤起一次模型处理，不是免费的进程消息。

因此它适合作为第二个 POC host，特别适合需要 `claude attach`/agent view 人工接管的 worker；不宜在验证前成为唯一生产通道。

#### 路线 C：每条消息执行一次 `claude -p --resume`

也可以让 broker 在需要唤醒 worker 时执行：

```text
claude -p --resume <sessionId> "<message>" --output-format stream-json
```

conversation 会继续，但每条消息都要启动一次 CLI 进程，且并发消息、interrupt、permission 和正在执行中的追加消息更难处理。它适合作为 durable fallback 或灾难恢复路径，不适合作为低延迟主通道。

#### 路线比较

| 路线 | 稳定接口 | 可主动推送 | 人工 attach | Rasen 托管负担 | 建议 |
|---|---|---:|---:|---:|---|
| Agent SDK streaming input | 正式 SDK | 是 | 不能依赖 agent view | 高 | **首选基线** |
| `claude --bg` + Channel | 两项均为 preview 能力 | 是 | 是 | 中 | 第二 POC / 可视化 host |
| `-p --resume` | 正式 CLI | 一次一进程 | 可另行 resume | 中 | fallback |
| 每 worker 自建裸 HTTP server | 自定义 | 是 | 取决于宿主 | 最高 | 不建议作为目标架构 |

### 13.4 端口拓扑：不要让 LEAD 直接维护 N 个端口

“每个 session 起一个端口，LEAD 广播”可以做 demo，但会马上引入：

- 端口分配与冲突；
- session 重启后的端口漂移；
- stale listener 与僵尸 registry；
- Windows 防火墙/安全软件提示；
- N 份重试、鉴权和健康检查；
- LEAD handoff 后谁拥有广播权；
- 部分 worker 收到、部分 worker 未收到时的恢复问题。

推荐拓扑是**一个 Rasen broker endpoint**，每个 worker 的 SDK queue 或 Channel bridge 主动向 broker 注册：

```text
LEAD ── worker.send/broadcast ──► Rasen broker : ephemeral loopback port
                                      │
                    durable journal ──┤
                                      ├─► worker-A bridge ─► session A
                                      ├─► worker-B bridge ─► session B
                                      └─► worker-C bridge ─► session C
```

在 Windows 上可选 named pipe；为了跨平台实现简单，也可以使用只绑定 `127.0.0.1` 的 WebSocket/HTTP endpoint，并由 Rasen 分配一个随机空闲端口。端口只属于 broker，不属于各 worker。

必须同时具备：

- 每 worker capability token，不接受匿名本机 POST；
- 消息大小上限、TTL 和 payload hash；
- append-only journal，broker 重启后可重放；
- at-least-once delivery + worker 侧 idempotency；
- 收到消息的 `ACK` 与任务完成的 `DONE` 分离；
- 队列 backpressure，禁止无界广播；
- payload 是文件引用时记录绝对路径/工作区 ID 与内容 hash；
- 外部输入明确标记为 data，避免 Channel 内容成为无边界 prompt injection。

### 13.5 消息模型：默认定向，不默认广播

“广播”只应是一种控制消息类型，而不应成为所有通信的默认原语。原因是一个事件投递到一个独立主会话，通常就会触发一次新的模型请求；向 8 个 worker 广播一条与其中 2 个有关的消息，会付出 8 份上下文读取和 8 次潜在 rebase 风险。

建议支持三种路由：

- `direct(workerId)`：默认路径；
- `topic(runId, role/milestone)`：少量任务相关 worker；
- `broadcast(runId)`：只用于 cancel、repo-state-invalidated、lead-epoch-changed、shutdown。

建议的最小消息 envelope：

```json
{
  "messageId": "uuid",
  "idempotencyKey": "run/role/operation/generation",
  "runId": "change-or-run-id",
  "from": "lead:g3",
  "to": "worker:reviewer:1",
  "kind": "assign|resume|query|standDown|cancel|stateInvalidated",
  "leadEpoch": 3,
  "expectedWorkerGeneration": 1,
  "createdAt": "ISO-8601",
  "expiresAt": "ISO-8601",
  "replyTo": "message-id-or-null",
  "payloadRef": "path-or-inline-small-payload",
  "payloadHash": "sha256"
}
```

worker registry 至少记录：

| 字段 | 用途 |
|---|---|
| `workerId` / `role` / `generation` | 稳定逻辑身份，防止复用退休实例 |
| `sessionId` / `backgroundJobId` | Claude conversation 与宿主进程映射 |
| `hostKind` | `sdk-stream`、`background-channel`、`resume-cli` |
| `cwd` / `worktree` / `branch` | 确认 worker 看见哪份代码 |
| `state` | `starting/working/waiting/done/retired/failed` |
| `lastModelRequestAt` | 估算 1 小时 TTL 剩余窗口 |
| `contextTokens` / `cacheTier` | cap、handoff、低频 beat 成本输入 |
| `leadEpoch` / `leaseUntil` | 防止旧 LEAD 与新 LEAD 同时发命令 |
| `inboxSeq` / `ackSeq` | 恢复投递与审计 |

### 13.6 LEAD handoff 如何从“停机切换”变成“领导权切换”

当前 Rasen lead handoff 已经具备：

- 写入 `handoff/lead-n.md`；
- 更新 `auto-run.json.sessionHandoff`；
- Windows 下通过 `Start-Process` 启动新的可见 Claude Code session；
- successor 从 relay prompt 与 run-state 继续。

但当前模板的安全不变量是：只在 stage boundary 做 relay、handoff 时没有 worker in flight，并假定旧 Claude subagent handle 在新进程中不可恢复。这正是 Plan B 需要修改的地方。

Plan B 下 handoff 应只切换 LEAD：

1. 旧 LEAD 停止创建新消息，flush outbox；
2. broker 将 run 的领导权从 `epoch N` 标为 `transferring`；
3. handoff 文档写入所有 worker 的 `workerId/sessionId/host/state/pendingMessage`；
4. 启动 successor LEAD；
5. successor 通过 compare-and-swap 获得 `epoch N+1` lease；
6. broker 拒绝所有携带旧 epoch 的后续发送；
7. 旧 LEAD 确认失去 lease 后退出。

worker 本身不暂停、不写 handoff、不重新加载完整任务；它们只会收到一个很小的 `leadEpochChanged` 控制事件。这样能够避免 LEAD relay 与 worker cache 生命周期绑定。

最重要的正确性要求是 **fencing**：只有持有最新 `leadEpoch` 的 LEAD 可以给 worker 投递指令。否则旧窗口未及时退出时会形成 split brain，同一 reviewer 可能同时收到“继续等待”和“开始复审”。

### 13.7 工作区是比端口更大的集成风险

Claude background session 默认在第一次写文件前移动到 `.claude/worktrees/` 下的隔离 worktree；官方也允许在 `.claude/settings.json` 设置：

```json
{
  "worktree": {
    "bgIsolation": "none"
  }
}
```

关闭隔离。详见 [background session file isolation](https://code.claude.com/docs/en/agent-view#how-file-edits-are-isolated)。

这会与 Rasen 当前工作流产生两种相反风险：

1. **保留默认隔离**\
   reviewer 可能在自己的 worktree 看不到 implementer 尚未合并的改动；run-state 必须记录 branch/commit/worktree，并建立显式集成分支。
2. **关闭隔离**\
   所有独立 session 都直接写当前 working copy；如果两个完整 session 并行编辑同一文件，会出现覆盖、测试污染和状态误判。

建议分阶段处理：

- POC 使用共享 working copy，但由 broker 强制 **single-writer lease**；
- implementer/fixer 可以写，reviewer/planner 默认只读；
- writer 发布 milestone 后，reviewer 才开始读取；
- 长期方案再迁移到 per-worker worktree + commit/merge gate；
- 不允许 background worker 自主 push/merge，除非所选 pipeline 明确授权。

如果不先解决工作区可见性，即使消息和缓存完全正确，Plan B 也可能让 reviewer 审查错误的代码快照。

### 13.8 1 小时缓存的经济性模型

本报告沿用 audit 的计价近似：

```text
5 分钟 subagent：cache write = 1.25 × C，cache read = 0.1 × C
1 小时 main session：cache write = 2.00 × C，cache read = 0.1 × C
```

令 `C` 为两种 worker 都需要保留的相同上下文。独立主会话的首次写入相对内置 subagent 多：

```text
(2.00 - 1.25) × C = 0.75 × C
```

而一次温 beat 约为 `0.1 × C`。忽略很小的新增尾部后：

```text
Plan B 与当前 beat 的首次生命周期 break-even
≈ 0.75 C / 0.1 C
≈ 7.5 次 beat
```

即等待大约 **8 beats，约 36 分钟**后，独立 1 小时 session 才开始摊平其更高的 cache-write 系数。这个阈值不是常数：完整 session 的 system prompt、MCP/tool schemas 通常与 subagent 不完全相同，必须以真实 audit 为准。

| 场景 | 预期经济性 |
|---|---|
| 一次性任务、不复用 | 内置 subagent 通常更便宜 |
| 1–4 beats 的短等待 | 当前 beat 通常更便宜 |
| 8–12 beats、且 60 分钟内恢复 | Plan B 倾向更便宜 |
| 同一角色多次 park/resume | Plan B 的首次 0.75C premium 可跨 episode 摊薄 |
| 60 分钟以上无模型请求 | Plan B 也会 cache MISS |
| 大上下文 worker 被频繁无关广播 | Plan B 可能因每次 0.1C 温读反而很贵 |

#### 用本场 Reviewer A 做反事实

Reviewer A 的 12 次重复 beat：

- 平均保温前缀约 `3,851,990 / 12 = 320,999` tokens；
- 实际 12 beats 消耗 `388,366` input equivalent；
- 改为 1 小时主会话的首次 TTL premium 约 `0.75 × 320,999 = 240,749`；
- 若在约 55 分钟时仍不确定 ETA，做一次低频温请求，成本近似本场单拍 `32,364`。

因此只比较“保持同一 reviewer 可恢复”这一层：

| Plan B 策略 | 估算成本 | 相对现有 12 beats |
|---|---:|---:|
| 60 分钟内决定 handoff/恢复，不发 beat | 240,749 | 节省约 **147,617** |
| 等到 Fixer 约 85 分钟完成，55 分钟时发 1 次低频 beat | 273,113 | 节省约 **115,253** |

本场 Fixer 在 Reviewer 首次 review 后约 85 分钟才完成修复，所以“1 小时 session 完全不需要 beat”并不成立；若要让同一 reviewer 等到修复完成，仍需约 55 分钟一次的低频保温，或者接受 60 分钟处 handoff/cold resume。

这项节省也**不能直接等同于整轮 review 节省**。正如 6.5 所示，旧 reviewer 带着约 32 万 token 上下文执行 82 个请求，可能比读取 handoff 的小上下文 successor 更贵。Plan B 改善的是 idle/cache-control 成本，`继续旧 session` 与 `handoff 给小 context successor` 仍应由成本模型选择。

另外两个本场样本也说明 Plan B 不应无条件启用：

- Implementer A 只有 4 次重复 beat，实际成本 `238,211`；按约 59.3 万上下文估算的 1 小时首次 premium 约 `444,759`，首次生命周期反而更贵；
- Fixer A 第一段只有 7 次重复 beat，实际成本 `284,810`；按约 40.4 万上下文估算的首次 premium 约 `303,100`，接近 break-even 但仍略贵。

更合理的路由条件不是“所有 subagent 都换成 session”，而是：

```text
expected idle > 35–40 min
OR expected reuse episodes >= 2
OR lead handoff 后仍需要保留该 worker
    => 倾向 independent-session worker

one-shot
OR expected idle < 20–30 min
    => 倾向 built-in subagent + beat / direct return
```

### 13.9 Plan B 仍然无法消除的缓存重建

1. **超过 60 分钟的 TTL expiry**\
   supervisor 保持进程运行、pin session 或保存 transcript，都不等于服务端 prompt cache 仍然存在。官方说明 completed background process 空闲约 1 小时后会被停止，但下次可从 transcript 重启；重启 conversation 与恢复热 cache 是两件事。
2. **消息注入导致的 rebase**\
   正常的 follow-up 应是前缀追加并命中缓存，但 Channel event、执行中 interrupt、queued message、lead epoch 切换是否被当前 audit 判为 rebase，需要实测。
3. **模型/工具/system prompt 改变**\
   worker 运行中更换 model、permission、MCP/plugin、role prompt，可能改变缓存前缀。
4. **context compaction**\
   完整主会话持续更久，context 也更容易膨胀和 compact；1 小时 TTL 不解决上下文增长。
5. **worker 内再次使用 subagent**\
   如果独立 worker 自己又启动内置 subagent，后者仍回到 5 分钟 tier。Plan B role prompt 应默认禁止二次委派，除非单独审计。
6. **广播成本放大**\
   一个 40 万 token worker 收到一次无关广播，温读成本约 4 万 input equivalent；N 个 worker 会线性放大。
7. **机器休眠和超长任务**\
   transcript 可以恢复，但睡眠期间没有 API 请求刷新 prompt cache；醒来后的首次模型请求仍可能 cold write。
8. **跨工作区 resume 失败**\
   官方 SDK 文档指出 session transcript 按 encoded cwd 存放；`resume` 使用不同 cwd 时可能找不到预期历史。worker registry 必须固定 cwd/worktree。

### 13.10 审计模型也必须改为 run 级多 session 聚合

采用 Plan B 后，执行：

```text
rasen audit <lead-session-id>
```

将不再自动看到所有 worker，因为它们不是该 lead transcript 下的 subagent。必须为每个 run 持久化：

- LEAD 各 generation 的 session ID；
- 所有 worker session ID；
- worker host、role、generation、cwd/worktree；
- 每条 broker 消息的 send/deliver/ack/done 时间；
- 每个 session 的 cache tier 与请求 usage；
- lead handoff epoch；
- worker handoff/retire 原因。

审计入口应支持：

```text
rasen audit --run <runId>
```

然后把多份主会话 transcript 合并到一条 run timeline，并额外输出：

- 独立 session 启动的 1 小时 cache-write premium；
- 无 beat 节省；
- 55 分钟低频 beat 成本；
- 消息注入后的 HIT/MISS；
- 广播 fan-out token；
- lead handoff 前后仍存活的 worker；
- session process restart 与真正 cache MISS 的区别。

否则 Plan B 会让每个单会话报告看起来都更干净，却把总成本分散到多个文件中，无法判断系统是否真的更省。

### 13.11 建议的最小 POC

不要先重写整个 pipeline。选择一次 review-loop，限定：

- 1 个 LEAD；
- 1 个 implementer 独立 session；
- 1 个 reviewer 独立 session；
- shared working copy + single-writer lease；
- directed message only，暂不开放任意 broadcast；
- 所有消息进入 durable journal；
- worker 禁止再派生内置 subagent。

分两轮验证：

#### POC-A：Agent SDK host

1. 用 streaming input 启动两个长期 worker；
2. 定向发送 assign、wait、resume、standDown；
3. 在 worker 工作中和空闲中各追加一条消息；
4. 杀掉并恢复 Rasen supervisor，验证 session ID 与未 ACK 消息；
5. LEAD 做一次真实 session handoff，worker 不重启；
6. audit 聚合三个以上主会话。

#### POC-B：background + Channel host

1. 用 `claude --bg --name` 启动 worker；
2. 自定义 Channel bridge 连接同一个 Rasen broker；
3. 验证 `claude attach` 能人工接管；
4. 验证 Channel 消息后的缓存分类；
5. 验证 background supervisor respawn 后 Channel 自动重连；
6. 对照 SDK host 的延迟、token 与故障恢复。

建议的验收门槛：

| 指标 | 门槛 |
|---|---:|
| directed message 持久投递 | 100% |
| 重放导致重复执行 | 0 |
| LEAD handoff 时 worker 重启 | 0 |
| 旧 LEAD epoch 发送成功 | 0 |
| 10/30/55 分钟 follow-up cache HIT | 100% |
| 65 分钟无低频 beat 的预期 MISS | 被 audit 正确识别 |
| 55 分钟低频 beat 后 85–90 分钟恢复 | HIT |
| Channel/SDK 普通消息导致 rebase | 0 |
| 非目标 worker 被 direct 消息唤醒 | 0 |
| run 级 token 与单 session 合计误差 | 0 |
| 并行写者 | 0 |

### 13.12 最终建议

**建议继续做 Plan B POC，但采用“独立 session worker + 单 broker + durable mailbox”，不要采用“LEAD 直接向 N 个裸端口广播”的最终形态。**

实现优先级建议为：

1. 先抽象 `WorkerHost` 与 run 级 worker registry；
2. 先做 Agent SDK streaming-input host，打通定向消息与恢复；
3. 给 LEAD handoff 增加 epoch/lease/fencing，使 worker 跨 LEAD generation 存活；
4. 给 audit 增加 `--run` 多 session 聚合；
5. 再做 background + Channel host，获得 agent view/attach 与 supervisor 能力；
6. 最后根据 A/B 数据决定哪些 role/horizon 默认走 Plan B。

从本场数据看，最佳长期形态很可能是**混合路由**：

- 短、一次性、预计很快返回的工作继续走内置 subagent；
- 预计等待超过 35–40 分钟、多轮复用、或必须跨 LEAD handoff 存活的 reviewer/fixer/planner 走独立 session；
- 超过 60 分钟时仍在“低频 beat、handoff、小 context successor”之间做成本决策；
- 所有跨 session 消息统一走 broker，broadcast 只保留给少数控制事件。

Plan B 的主要价值不是把缓存重建变成零，而是把当前 **每 270 秒保温和进程内 handle 生命周期**，提升为 **约 1 小时缓存窗口、可恢复 conversation、可跨 LEAD handoff 的稳定 worker 身份**。这会显著扩大编排器可做成本决策的空间，但仍需要消息协议、工作区隔离和 run 级审计三项基础设施共同成立。
