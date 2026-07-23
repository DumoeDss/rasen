# Proposal: agent-wait-keepalive

## Why

实测(rasen/office-hours/token-cost-audit.md,APPROVED)显示 pipeline 多 agent 运行的账单中 ~20% 是 cache churn,其中 ~60% 是角色交替税:subagent 的 prompt cache 固定 5 分钟 TTL,review-cycle 的 impl↔rev 互为对方的 >5min 闲置窗口,34 次 >3min 复用 32 次 MISS(94%),每次整段上下文按 1.25× 重写(20–47 万 token/次,单 child 最高 149 万)。受控实验证明:SendMessage 心跳 5/5 全 MISS(attachment 投递 100% 触发会话变基)、subagent 无 ScheduleWakeup 工具、fork 无缓存红利、TTL 不可配;**唯一可行的保活通道是"忙等 + 文件信号"(受控实验 3/3 拍 HIT,单拍成本 0.1×上下文)**。该通道需要一个标准化原语,而不是让每个 skill 内联 shell 循环。

## What Changes

- 新增 `rasen agent wait` 子命令:worker 缓存保活的忙等原语。单次调用 = 一拍(默认 270s 阻塞,尽量贴近 5min TTL 留 30s 边际),轮询 change 目录下的角色信号文件;命中信号 → 把 LEAD 写入的指令 payload 作为结构化输出返回并消费(删除)信号文件;超时 → 返回拍数进度;拍数达到封顶 → 返回 standDown。
- 拍数封顶跨调用持久(计数状态存于信号目录旁),全角色统一默认 12 拍(≈54 分钟保温,用户 2026-07-23 拍板,取代按角色 3/5/12 的分档),`--max-beats` 可覆盖;上下文体积豁免(`--context-tokens` 低于阈值直接 standDown,阈值默认 100k)。
- 运行时门控:Claude Code 运行时启用;Codex 运行时调用立即返回 `standDown`(reason=runtime-not-gated),不白等。门控默认 claude=on、codex=off,可配置覆盖。
- LEAD 侧信号写入约定与编排规则:orchestration playbook 与 review-cycle 模板新增 keepalive 生命周期规则——三档复用视界(ONE_SHOT 不保活 / LOOP_BOUND 循环出口下线 / MILESTONE_BOUND 里程碑信号下线,planner 的里程碑 = 最后一个 child 的 propose 完成);**恢复/停机 parked worker 一律写信号文件,禁止 SendMessage**(实证 100% 变基)。
- 不改变现有 reuse 阈值语义(worker-reuse-config 的 0.6 等阈值仍决定"能不能复用");keepalive 只决定"复用间隔期间保不保温"。

## Capabilities

### New Capabilities
- `cli-agent-wait`: `rasen agent wait` 命令的行为契约——拍语义(阻塞时长、信号轮询、消费语义)、拍数封顶与持久计数、standDown 条件(封顶/门控/豁免)、结构化输出格式、运行时门控与配置解析、信号文件路径与格式约定。

### Modified Capabilities
- `worker-reuse-orchestration`: 新增 keepalive 生命周期要求——parked worker 经 `rasen agent wait` 保温;三档复用视界及各自下线点;LEAD 对 parked worker 的恢复/停机必须走信号文件通道(禁止 SendMessage);standDown 后 worker 执行 handoff+退役协议。

## Impact

- 受影响代码:`src/commands/`(新增 agent wait 子命令,挂在既有 `rasen agent` 命令组)、`src/core/`(信号文件/拍计数模块)、运行时检测复用 `src/core/shared/tool-detection.ts` 与 codex 检测;`src/core/templates/workflows/_orchestration.ts`(playbook keepalive 规则)与 review-cycle 模板;模板改动需重建安装的 skill 并同步 parity 基线(workflow-template-parity)。
- 配置:新增 keepalive 运行时门控键(默认 claude=on/codex=off);若 config-key-registry 要求登记新键,在 specs 阶段确认是否需要 delta。
- 依赖/系统:无新外部依赖;信号文件走 change 目录(黑板),Windows 路径兼容必测。
- 成本预期:review-cycle 轮间保温省 40–75% 的切换重写;全量落地对应审计文档中 ping-pong 税(~12% 账单)的可治理部分。
