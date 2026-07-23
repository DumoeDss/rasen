# Design: agent-wait-keepalive

## Context

subagent 的 prompt cache 是 5 分钟 TTL 且不可配置;闲置超窗后温续要按 1.25× 重写全上下文,review-cycle 的角色交替使这成为 pipeline 账单里最大的可治理单项(实证见 rasen/office-hours/token-cost-audit.md D1,含六通道保活实验矩阵)。已验证的唯一保活通道是"回合内忙等 + 文件信号":worker 不结束回合,以 ≤270s 的工具调用节拍轮询信号文件,每拍是干净的 tool_result 续行(3/3 拍 HIT)。需要把这个模式固化为 CLI 原语,并配套编排规则(谁保活、保多久、怎么下线),同时按 agent 运行时门控——收益模型建立在 Claude Code 的前缀缓存行为上,Codex 运行时(codex-exec-runtime,独立计费与缓存语义)开启只会空耗等待。

## Goals / Non-Goals

**Goals:**
- 一个自足的 `rasen agent wait` 命令承载:拍语义、信号消费、拍数封顶、standDown 判定、运行时门控、上下文豁免,全部结构化 JSON 输出。
- LEAD↔parked-worker 的恢复/停机全部走信号文件(缓存安全),SendMessage 从 parked-worker 交互中退场。
- playbook/review-cycle 模板落入三档复用视界与下线协议。

**Non-Goals:**
- 不改 worker-reuse-config 的阈值语义(0.6 等仍只管"能不能复用");keepalive 只管"间隔期保不保温"。
- 不做 Codex 侧保活(门控关闭即可,不研究其缓存语义)。
- 不做 MCP 工具版、不做常驻 daemon、不复刻 ScheduleWakeup(harness 特权,已实证 subagent 拿不到)。
- 不在本 change 内推进 D2(上下文纪律)/D3(skill 分层)。

## Decisions

**D-1 命令面:`rasen agent wait --change <name> --role <key> [--max-beats N] [--context-tokens N] [--beat-seconds S]`。** 挂在既有 `rasen agent` 命令组(与 `agent context` 同组,同样不接 `--store`/`--project`——worker 的 cwd 就是其工作树)。`--role` 是自由字符串键(如 `impl-spaces`、`reviewer`),同一 change 下多 worker 用不同 key 隔离信号;封顶默认值全角色统一 12 拍(用户 2026-07-23 拍板,取代最初按角色族 3/5/12 分档的经济推导),`--max-beats` 显式覆盖。备选"按枚举角色"被否:pipeline 的角色名是模板层概念,CLI 不应硬编码枚举。

**D-2 信号协议:`<changeRoot>/signals/<role>.json`,写入原子、读取即消费。** LEAD 用临时文件+rename 原子写入;格式 `{ kind: "resume"|"standDown", instruction?: string, ts }`。worker 命中后:输出整个 payload 到 stdout(指令经工具结果进上下文=缓存安全通道),随后删除文件(消费语义,防重复触发);Windows 下删除失败重试 3 次(EBUSY 兼容,已知病根见 windows flake 记忆)。备选"信号常驻+序号"被否:消费语义最简单且天然幂等。

**D-3 拍计数持久化:`<changeRoot>/signals/.state/<role>.json`,`{ beats, startedAt }`。** 跨调用累加;三种复位:信号被消费(新工作片段开始)、`--max-beats` 变化、`startedAt` 超过 2 小时(陈旧状态自动作废)。达到封顶→输出 `{ standDown: true, reason: "beat-cap" }` 并清状态。备选"单次调用内自循环到封顶"被否:单调用长阻塞会撞 Bash 工具 10 分钟超时,且每拍一次工具调用正是缓存续期的机制本身。

**D-4 阻塞实现:命令内部 5s 间隔轮询,默认 270s(`--beat-seconds` 上限 300;默认值贴近 5min TTL 留 30s 边际)。** Node 进程自己等,不依赖 shell `sleep`(规避 harness 对裸 sleep 的拦截差异)。所有出口 exit code 0 + JSON stdout(超时 `{ beat, remaining }`、命中 `{ resumed: true, instruction }`、停机 `{ standDown, reason }`),worker 无脑按 JSON 行动。

**D-5 运行时门控:环境检测 + 配置覆盖,默认 claude=on、codex=off、unknown=off。** 检测复用现有机制:Claude Code 置 `CLAUDECODE` 环境变量,Codex 运行时经 codex-home/exec 链路有自己的环境指纹(实现时以 `src/core/codex/` 现有检测为准)。门控关闭或运行时未知→立即 `{ standDown: true, reason: "runtime-not-gated" }`,零等待。配置键 `keepalive.runtimes.{claude,codex}`(布尔),走 config-loading 常规解析;若 config-key-registry 强制登记,specs 阶段带上 delta。备选"按调用方自报 --runtime"被否:自报可被模板漂移带歪,环境检测才反映真实宿主。

**D-6 上下文豁免:`--context-tokens` < 100000(默认阈值,`keepalive.contextFloor` 可配)→ `{ standDown: true, reason: "context-below-floor" }`。** 值由 worker 从 `rasen agent context` 探针取得后自报——命令进程无法内省调用方会话,这是唯一可行来源;省略该参数则跳过豁免检查(保守放行)。

**D-7 playbook/review-cycle 模板规则(worker-reuse-orchestration 的 delta):**
- 三档复用视界由 LEAD 在派发时告知 worker:ONE_SHOT(默认,DONE 即退,不调 wait)、LOOP_BOUND(review-cycle 的 reviewer/fixer:轮间调 wait,循环出口下线)、MILESTONE_BOUND(decompose 的 planner:LEAD 在最后一个 child 的 propose 完成后写 standDown 信号)。
- LEAD 对 parked worker 的一切恢复/停机通过信号文件;禁止 SendMessage(100% 变基实证)。对未 park(活跃回合中)的 worker,现行 SendMessage 规则不变。
- standDown 后 worker 协议:按 rasen-handoff 写蒸馏 → 报 DONE → 退出释放槽位。
- 模板改动走既有流程:build → update,workflow-template-parity 哈希同步。

## Risks / Trade-offs

- [并发槽占用] parked worker 忙等期间持有一个并发槽(≈16 上限)→ 封顶统一 12 拍(占槽窗口上限 ≈54 分钟,用户拍板的统一值),LOOP_BOUND 同时 parked 的通常仅 1–2 个;宽扇出阶段(verify 5 并发)playbook 规则禁止叠加 keepalive。
- [信号竞态] LEAD 写入与 worker 消费竞争 → 原子 rename 写入 + 消费端删除重试;信号目录仅 LEAD 写、单 worker 读,天然单生产者单消费者。
- [worker 不遵从 JSON] worker 忽略 standDown 继续调用 → 状态已清零会重新计数,但 reason 会持续返回 beat-cap;playbook 措辞把"按 JSON 行动"写为硬规则,D5 审计脚本可事后验证遵从率。
- [运行时指纹失效] harness 改环境变量 → 门控退化为 unknown=off(安全侧失败:不保活,退回现状成本,而非错误保活)。
- [收益依赖 harness 缓存行为] Anthropic 若改 TTL/变基行为,收益模型失真 → 命令本身无害(最坏=白等几拍),审计脚本(D5)常态监测命中率即可发现。

## Migration Plan

纯增量:新命令 + 模板规则,无破坏性变更、无数据迁移。模板改动后需 `rasen update` 重装 skill 并同步 parity 基线。回滚 = 移除 playbook 规则(worker 不再调 wait),命令留存无副作用。

## Open Questions

- config-key-registry 是否强制登记 `keepalive.*` 键(specs 阶段查证,必要则补 delta)。
- 信号文件是否需要 LEAD 侧写入命令(`rasen agent signal`)封装原子写?首版先让 LEAD 用 Write 工具直接写(playbook 给出格式),观察出错率再决定。
