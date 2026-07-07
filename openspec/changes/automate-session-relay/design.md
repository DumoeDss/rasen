# Design: automate-session-relay

## Context

`add-context-handoff`（2026-07-06 归档）建立了 handoff 文档、run-state 记录、worker 接力协议，但把"自动主会话重启"排除在外，理由是 "platform cannot"。本 change 基于 2026-07-07 的三项探针推翻该结论（claude CLI 2.1.202，Windows 11）：

1. **嵌套 headless**：会话内经 shell 运行 `claude -p "..."` 正常返回，`CLAUDECODE=1` 不拦截子实例。
2. **分离进程**：`Start-Process`（hidden）拉起的子进程在父工具命令返回后独立完成工作并写回结果，正确继承工作目录。
3. **交互式窗口**：`Start-Process` 新终端窗口 + 交互式 `claude "<初始 prompt>"` 可拉起；初始 prompt 经 `-EncodedCommand`（base64）传递时完整送达并得到回复（用户目视确认）。**首次尝试裸拼引号时，中文 prompt 被双层命令行解析截断为前两字**——引号安全传输是硬约束，不是优化。

历史归档不改写；本 design 是"platform cannot"结论的正式修订记录。

## Goals / Non-Goals

**Goals:**

- 主动接力：LEAD 撞线时在用户授权下自动拉起继任会话，从 handoff 蒸馏物继续，替代"用户手动开新会话"。
- 被动加固：auto-compact 发生后，继任回合自动被指回 `openspec pipeline resume` 与 handoff 蒸馏物，而非依赖机器摘要。
- 接力链有界：代数计数 + 上限，超限升级给用户。

**Non-Goals:**

- 跨会话恢复/续接 subagent——agentId 是跨会话死句柄，平台无此通道；继任者按既有 Step F.1 梯度（handoff 文档 → worker transcript 暖种子 → 变更目录冷重建）重生新 worker。本 change 不试图突破这一点。
- 无人值守的静默接力——spawn 前必须有用户授权（H.1 询问或用户预先明示）；不改变"用户拥有 session"的原则。
- 自动修改 `.claude/settings.json`——hook 交付沿用 safety-hook 的"只打印、不改写"先例。
- 前任会话自动退出——交互式会话无法有意义地自杀；前任结束回合并告知用户可关闭即可。

## Decisions

### D1. 继任者形态：新终端窗口的交互式会话（非 headless）

`Start-Process` 拉起可见终端窗口运行交互式 `claude "<bootstrap prompt>"`。
理由：(a) 用户可见、可随时接管，保持人在环；(b) 继任者走正常交互式权限流，避免 headless 必需的 `--dangerously-skip-permissions`/allowlist 权限突破面；(c) 探针 ③ 已实测此形态。
备选被拒：headless `-p`（用户失明 + 权限突破面）；fork + 主动 compact（无 IPC 注入 `/compact`；对已有蒸馏物的 transcript 再付一次大摘要成本，产物更差且与 handoff 文档冗余；原始 transcript 在磁盘上本就是免费的 fallback 档案）。

### D2. Bootstrap prompt 经引号安全通道传递

Windows：PowerShell `-EncodedCommand`（UTF-16LE base64），探针实测裸拼引号会被 `Start-Process` 参数拼接 + 子 shell `-Command` 重分词双层解析截断。macOS/Linux：终端模拟器差异大（Terminal.app / gnome-terminal / konsole...），模板指引优先**文件中转**——bootstrap prompt 写入 `openspec/changes/<id>/handoff/relay-prompt.txt`，spawn 命令只含短 ASCII（`claude "$(cat <path>)"` 或等价），彻底绕开引号问题且跨平台同构。Windows 也可用文件中转作为统一形态；`-EncodedCommand` 是已验证的捷径。

Bootstrap prompt 内容（handoff.ts 模板生成）：读 `handoff/lead-<n>.md` → 运行 `openspec pipeline resume <change>`（store-scoped 时带 `--store <id>`）→ 按 handoff 文档的"next concrete action"继续推进。

### D3. 接力时序：先 spawn，后退场

前任写完 handoff 文档并更新 run-state **之后**才 spawn；spawn 后前任结束回合，告知用户"继任窗口已拉起，本会话可关闭"。前任存活覆盖整个 spawn 窗口，因此不依赖"孤儿进程活过前任会话退出"（Windows job object 语义未验证，被时序设计消解；实现期补一个全退出验证作为加固证据，非阻塞项）。

### D4. Quiesce 不变式

Session 接力只发生在 stage 边界：所有在飞 worker 已返回 `DONE`/`HANDOFF`，run-state 已落盘。这把"跨会话 subagent 恢复"从需要解决的问题变为设计上不存在的问题。LEAD 在 worker 在飞时撞线：等 worker 返回（worker 侧有自己的 H.3 契约兜底）再接力。

### D5. 代数计数与上限：`sessionHandoff.n` + maxRelays 语义

run-state `sessionHandoff` 增加可选字段 `n`（第几代接力，首代为 1；缺省视为 1，旧 run-state 原样解析）。自动接力前检查：`n` 达到解析出的 `maxRelays`（session 级无独立配置，复用 pipeline 解析结果或内置默认 3）时不再自动 spawn，改为向用户升级——反复 session 接力与反复 worker 接力同理，是"任务该 decompose"的信号（沿用既有原则 5）。

### D6. H.1 从提醒升级为接力询问

auto 入口预检探针达阈值时，从"一行提醒 + 用户自行处理"升级为 AskUserQuestion 式询问：「(a) 现在自动接力（写 handoff → 拉起继任窗口）；(b) 继续本会话（auto-compact 兜底）；(c) 我自己处理」。仍非阻塞原则的延续：低于阈值静默通过；用户拒绝则行为与现状完全一致。`/opsx:handoff` 手动路径同样在文档写完后追加"是否拉起继任会话"询问。

### D7. Compact-recovery hook：脚本 + 打印配置，不自动安装

新增 `hooks/compact-recovery.sh`（与 `hooks/safety-check.sh` 并列，bash，输出纯文本指引到 stdout——SessionStart hook 的 stdout 会作为上下文注入）。指引文案要点：刚发生 compaction；运行 `openspec pipeline resume <change>` 检查 `sessionHandoff` 与各 stage `handoffs[]`；优先读 handoff 蒸馏物恢复；不要信任 compact 摘要中的细节。`openspec init` 在既有 Safety Hook 提示旁打印 SessionStart 配置片段（matcher: `compact`），绝不改写 `.claude/settings.json`。脚本名进入既有的生成物名单常量（"track it by name in a constant"规则）。

### D8. 与主动接力的关系：互补而非二选一

方案 A 覆盖"探针发现撞线"的主动路径；hook 覆盖"没赶上探针、auto-compact 已发生"的被动路径。两者共享同一恢复入口（`pipeline resume` + handoff 蒸馏物），不引入第二套状态。

## Risks / Trade-offs

- [接力链失控：继任者反复撞线再传代] → D5 代数上限，超限升级给用户；每次接力都要求 handoff 文档显示实质进展（沿用 stall 语义）。
- [Spawn 的终端形态碎片化（macOS/Linux 终端模拟器差异）] → D2 文件中转统一形态；模板按平台给出分支指引并声明"拉不起窗口时降级为打印手动接力命令"，永远有手动兜底。
- [继任者拉起但没有正确 bootstrap（读错目录/没读 handoff）] → bootstrap prompt 由模板生成，仅含三个确定性步骤；`pipeline resume` 本身会报告 `sessionHandoff` 指针，形成双保险。
- [用户环境没有配 compact-recovery hook] → hook 是加固不是依赖；主动路径与手动路径不依赖它。
- [worker 在飞时 LEAD 撞线，quiesce 等待期间继续烧上下文] → LEAD 等待期间不读大产物、只收结构化返回（既有实践）；极端情况下 auto-compact 兜底 + hook 指路，仍能恢复。
- [首次探针的截断类事故（引号/编码）在其他 shell 复现] → 统一走文件中转即可消除该类事故面；模板中明确禁止裸拼含引号/非 ASCII 的 prompt。

## Migration Plan

纯增量：run-state 新字段可选（旧文件原样解析）；hook 是可选配置；H.1 升级只在用户授权时改变行为。回滚 = 移除模板段落与 hook 脚本，无数据迁移。

## Open Questions

- ~~分离进程活过整个前任会话退出的 Windows job object 语义~~ **已补验（2026-07-07）**：嵌套 headless claude 作为前任，经脚本 `Start-Process` 一个"睡 20 秒再写标记"的孙进程后立即退出；前任退出后孙进程仍写出 `ORPHAN-OK`——`Start-Process` 子进程脱离 claude 进程树/job，不随根进程消亡。接力时序（先 spawn 后退场）因此有双保险。
- macOS/Linux 各终端模拟器的具体 spawn 命令清单——模板已给出主流三种（Terminal.app、gnome-terminal、konsole）+ 通用 fallback（打印手动命令）；真机验证待有对应环境时进行。
