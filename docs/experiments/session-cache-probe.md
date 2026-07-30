# Session 缓存行为探针实验（KC 验证）

> 目的：用真实账单验证「独立 Claude Code session worker（`claude -p --resume` 宿主）」方案的承重假设。
> 结果决定 `docs/session-execution-layer-design.md`（0.2.0 内核 Session 执行层设计）是否成立。
> 本文档自包含，可由任意 Claude Code session 独立执行；执行完按 §7 模板回报。
> 预计钱包成本 < $2（sonnet），预计墙钟时间 ≈ 4 小时 10 分（无人值守脚本）+ 约 20 分钟手工步骤。

## 1. 背景（执行者需要知道的最小上下文）

Rasen 计划把长等待/多轮复用的 worker 从「内置 subagent + 270 秒 beat 保温（5 分钟缓存档）」改为「独立 Claude Code session（1 小时主会话缓存档），空闲零成本，用 `claude -p --resume <sessionId> "<msg>"` 事件驱动唤醒」。整条路线压在以下未验证假设上：

| 编号 | 假设 | 若不成立 |
|---|---|---|
| KC1a | `-p --resume` 唤醒在上次请求后 7/30/55 分钟内是 **cache HIT**（前缀追加，不触发重写）——同时证明 `-p` 无头 session 属于 1 小时缓存档而非 5 分钟档 | **整条路线推倒**，转评估 Agent SDK streaming 宿主 |
| KC1b | 空闲 65 分钟后唤醒是预期 MISS（TTL ≈ 60 分钟上界确认，且测量方法能正确识别 MISS） | 测量方法不可信，重设计实验 |
| KC1c | 空闲 ~50 分钟时发一次廉价 touch（触发一次模型请求）可把 TTL 续命，再过 35 分钟唤醒仍 HIT | warm-touch 策略不成立，>55 分钟场景只能 retire |
| KC2 | resume 绑定 cwd：换目录 resume 的实际行为（失败/找不到/全局可达）需要实测记录 | 影响 registry 是否必须记录并校验 cwd |
| KC3 | Claude Code 会话内 background Bash 任务完成通知注入后，下一请求是前缀追加（HIT）而非 rebase | LEAD/launcher 收口方式改用 park+signal 通道 |
| KC4 | `--resume` 每次唤醒后 session_id 是否变化、transcript 文件是否新增（身份链语义） | 决定 registry 记录单 id 还是 id 链，及 audit 聚合方式 |
| KC5（可选） | 对同一 session 并发两个 resume 的实际行为（拒绝/排队/分叉/损坏） | 决定单飞锁的严格程度 |

KC1a/b/c、KC4 由脚本无人值守完成；KC2、KC3、KC5 是手工步骤。

## 2. 前置条件

1. **执行目录**：`E:\AI\ChatAI\Agents\VibeCodingProjects\workflow\Reference\OpenSpec-code-hybrid-session-workers`（分支 `feat/hybrid-session-workers`）。cwd 是实验变量之一（KC2），全程从这个目录启动脚本，不要换目录。
2. `claude --version` ≥ 2.1.220，记录精确版本。**实验期间不要升级 Claude Code**。
3. 机器整个实验期间不能休眠。脚本会用 `SetThreadExecutionState` 阻止系统睡眠（不改全局电源设置），但请确认接通电源、不要手动睡眠/注销。
4. 实验期间**不要用其他工具打开/attach/resume 探针创建的 session**（会话列表里它们的最后消息是 PONG/OK 字样）。同账号跑其他 Claude 工作没关系——prompt cache 按前缀隔离，互不影响。
5. 探针调用默认带 `--dangerously-skip-permissions`（探针回合只做「读材料 + 回固定字符串」，无写操作；此 flag 只为杜绝 4 小时无人值守中途卡权限询问）。不接受可加 `-NoSkipPermissions` 开关，但需自担中途卡住的风险。

## 3. 脚本执行（KC1a/b/c + KC4）

脚本：`docs\experiments\session-cache-probe.ps1`（与本文档同目录）。

从仓库根目录以**后台任务**启动（总时长 ≈ 4 小时 5 分，绝不能用前台有限超时跑）：

```text
powershell -NoProfile -ExecutionPolicy Bypass -File docs\experiments\session-cache-probe.ps1
```

脚本行为：

1. **smoke**：一次快速 `claude -p` 调用，校验输出 JSON 含 `session_id` 与 `usage` 字段（schema 漂移则立刻中止，避免 4 小时后才发现测量失效）；
2. **bootstrap**：把仓库内 4–5 个大文件拼成 payload（≈35–50k token）经 stdin 灌入一次**单请求、零工具**调用，创建探针 session 并做大上下文（单请求保证 usage 数字可直接换算上下文大小）；
3. 按间隔序列 **7 → 30 → 55 → 65 → 50(touch) → 35 分钟** 依次 `claude -p --resume` 唤醒（唤醒 prompt 均为「只回复 PONG n / OK，禁用工具」的单请求回合）；
4. 每次调用的完整 stdout JSON 落盘；若 `session_id` 变化则记录并**改用新 id 继续链**（KC4）；
5. 结束时自动计算逐步 verdict（HIT / MISS-rewrite / AMBIGUOUS）写入 `summary.json`，并列出实验窗口内 `~/.claude/projects/` 下新增的 transcript 文件（KC4 佐证）。

输出目录：`%USERPROFILE%\.rasen\probe\session-cache\`

```text
probe-log.txt                     全程日志（时间戳）
00-smoke.json / 01-bootstrap.json
02-wake-7min.json … 07-wake-35min-after-touch.json
payload.txt                       bootstrap 灌入的材料
summary.json                      逐步 usage + verdict
transcripts.txt                   实验窗口内新增 transcript 清单
```

### 判定公式（脚本已内置，供人工复核）

- 上下文估算（单请求回合精确）：`ctx ≈ input + cache_creation + cache_read + output`
- 唤醒 verdict（相对上一步的 `ctxPrev`）：
  - **HIT**：`cache_read ≥ 0.85 × ctxPrev` 且 `cache_creation ≤ 0.15 × ctxPrev`
  - **MISS-rewrite**：`cache_creation ≥ 0.7 × ctxPrev`
  - 其余 **AMBIGUOUS** → 原始数字照报，不要自行归类
- bootstrap 后 `ctx` 须 ≥ 30,000，否则区分度不足，向脚本 `-PayloadFiles` 追加大文件重跑。

### 兜底

若 `--output-format json` 的 `usage` 字段缺失导致 summary 全为 n/a：改用 `rasen agent audit <最终 session_id>` 分析该 session transcript，churn 分类（hit / ttl-expiry / rebase）等价可用；把 audit 报告路径附在回报里。

## 4. KC3：background 通知注入（手工，在执行者自己的会话里做）

KC3 测的是「Claude Code 会话等待 background Bash 完成 → 通知注入 → 下一请求是否仍 HIT」。执行者自己就是一个 Claude Code session，直接自测：

1. 先做几次正常操作（保证上下文非平凡，≥30k 更好；跑完 §3 脚本收尾时顺手做即可）；
2. 以 `run_in_background` 启动一个约 4 分钟结束的命令：`powershell -Command "Start-Sleep 240; 'KC3-DONE'"`，然后**结束当前 turn，安静等通知**（不要轮询、不要发别的消息）；
3. 通知到达、自己回应一句之后，运行 `rasen agent context --latest --json` 拿到本会话 transcript 路径与 session id，再运行 `rasen agent audit <session-id>`；
4. 检查报告中通知到达时刻附近的请求：**不在 `churnEvents` 里（即 hit）→ PASS**；若出现 `rebase` 事件且时间戳对应通知注入 → FAIL，把该 churnEvent 原样贴进回报。

## 5. KC2：跨 cwd resume（手工，2 分钟）

脚本跑完后，取 `summary.json` 里**最后一个** session_id：

1. 在**别的目录**（如 `%TEMP%`）执行：
   `claude -p --resume <sessionId> "KC2 cross-cwd probe. Reply with exactly: PONG-KC2" --output-format json --model sonnet`
   完整记录 stdout/stderr/退出码。三种可能都有意义：报错找不到 session / 静默新开会话 / 正常续上（说明新版 CLI 全局可寻址）。
2. **对照**：回到仓库根目录同命令再跑一次（prompt 换成 `KC2 control`），确认正确 cwd 下仍可续（也证明步骤 1 没把会话弄坏）。两次的 stdout 都留档。

## 6. KC5（可选）：并发 resume

仅在前面全部完成后做（有弄脏探针 session 的风险，所以放最后）：开两个终端，对同一 session_id 几乎同时发起两个 `claude -p --resume`（prompt 分别为 `CONCURRENT-A` / `CONCURRENT-B`）。记录两边的完整输出与退出码，随后再做一次正常 resume 看会话是否仍健康。

## 7. 结果回报模板

```markdown
## Session 缓存探针结果

- claude 版本：`x.y.z`；model：sonnet；执行日期/时区：
- 输出目录：%USERPROFILE%\.rasen\probe\session-cache\（已保留）
- bootstrap ctx ≈ <n> tokens（≥30k? 是/否）

| 步骤 | 间隔 | verdict | cache_read | cache_creation | session_id 变化? |
|---|---|---|---|---|---|
| wake-7min | 7m | HIT/MISS/AMBIG | | | 是/否 |
| wake-30min | 30m | | | | |
| wake-55min | 55m | | | | |
| wake-65min | 65m | 预期 MISS：实际= | | | |
| touch-50min | 50m | | | | |
| wake-35min-after-touch | 35m | | | | |

- KC2：不同 cwd resume 实际行为 = <报错原文 / 新开会话 / 正常续上>；同 cwd 对照 = OK/异常
- KC3：通知后请求 = hit / rebase（若 rebase 附 churnEvent 原文）
- KC4：session_id 链 = <id1 → id2 → …>（每次唤醒是否换 id）；新增 transcript 文件数 = <n>
- KC5（若做了）：<两侧行为>
- 异常与偏离脚本之处：<无 / 描述>
```

## 8. 各 KC 的 PASS 标准（供回报后判读，执行者不必裁决）

| KC | PASS |
|---|---|
| KC1a | 7/30/55 分钟三次唤醒全部 HIT |
| KC1b | 65 分钟唤醒为 MISS-rewrite（且 audit 归因 ttl-expiry） |
| KC1c | touch HIT 且 touch 后 35 分钟唤醒 HIT |
| KC2 | 行为被完整记录即可（无对错，影响设计参数） |
| KC3 | 通知后请求不产生 rebase churn |
| KC4 | 身份链被完整记录即可（无对错，影响 registry 设计） |
| KC5 | 行为被完整记录即可 |

KC1a 任一次非 HIT = 路线级 kill 信号，其余步骤照跑（数据仍有诊断价值）。
