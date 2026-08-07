# ECP-7：Session Execution and Self-hosting

## 用户可见结果

用户从 CLI、API、Canvas 或 daemon 驱动同一个 Change-level Run 时，Reconciler 授予的
agent Action 会由真实、独立、可恢复的 Session executor 执行。用户能从同一 canonical
Run 看到 worker 身份、实际 cwd、actor、usage、结果、证据、取消/恢复状态与下一步；关闭
launcher、切换 driver 或进程重启不会让隐藏的 prompt-owned worker manager 成为第二份真相。

ECP 将使用这条执行路径从 start 到 verify、independent review 和 delivery-ready 完成一个
非 ECP 玩具 Change，证明 Session 层不是只存在于模块、schema、mock 或测试 helper 中。

## 为什么现在验证

ECP-6 已通过 v2 default authoring、Canvas parity、共享 bounded lifecycle 与真实 vertical
Run，并建立 plan-bound Ed25519 trusted completion contract。当前唯一核心断点是：生产内核
只 grant/defer Action，ECP-6 的可信 producer 仍是测试宿主，真实 agent Session 的启动、
复用、取消、恢复、usage 与 completion publication 仍由 launcher 隐式承担。

在最终 0.2.0 release audit 之前关闭这个断点，才能证明“deterministic mechanics + real agent
work”形成一条可恢复链，而不是把真实执行留到 ECP 路线最后。

## 可观察验收

1. **Frozen Action consumption**：executor 只消费已提交、计划冻结、当前可执行的 agent
   Action；它校验 Run/Action/invocation/effect/workspace/profile/adapter authority 和 Record
   version，不从当前 Definition、聊天或调用者自报重建执行权威。重复 dispatch、stale
   Record、错误 workspace 或非法 Action fail closed。
2. **真实 Session 与完整事实**：至少一个真实支持的 agent backend 执行 Action，并把
   Session identity、host/backend/model、实际 cwd、ActorRef、开始/结束时间、结构化事件、
   usage/cost、result、stderr/诊断与 evidence 关联到同一 Run/Action。registry 只保存宿主
   lifecycle 事实，不成为第二份完成状态。

   **分级执行后端（2026-08-07 scope decision）**：executor 通过声明能力的后端执行冻结
   Action，首版两个后端：

   - `in-tool`：worker 由宿主工具（Claude Code / Codex）自身设施创建，rasen 不拥有任何
     进程，不做任何进程权威声明。三 OS 可用。
   - `hosted`（内核强制）：rasen daemon/host 拥有子进程，由内核强制的
     `ProcessAuthorityProvider` 围栏。0.2.0 覆盖 Linux 与 Windows。
   - `hosted`（best-effort，macOS）：POSIX 进程组，**显式非权威**。2026-08-07
     Step 1 决定纳入 0.2.0；它不是 macOS durable 权威的替代实现，后者仍在 0.3.0。

   后端能力（`durable`、`headlessDriver`、`exactCancel`、`scopeEmptyProof`、
   `usageAttribution`）由声明**计算**成 OS × 后端矩阵，用户在启动前即可看到差异。
   请求 `hosted` 而当前平台无 provider 时 SHALL 返回类型化 `authority-unavailable`，
   **SHALL NOT 静默改路由到 `in-tool`**；选用 `in-tool` 只能来自显式请求，或来自启动前
   即展示能力差异的显式默认。

   `in-tool` 后端下实际提交由 LEAD 调用的 `rasen` CLI 进程完成。这是一条**事实描述**，
   记录在 run-state 即可，不承载信任语义。

   **已退场：`producerIsolation` 能力字段。** 它于 2026-08-07 早些时候被加入，用以声明
   「agent 产出经 LEAD 转述而非隔离 host 直签」的信任强度差异。按锁定决策 12，该差异
   防的是「LEAD 伪造转述」，而 LEAD 就是我们自己——真实风险是 bug 不是伪造，且同一进程
   本就能直接写 Record。该字段不再要求。
3. **完成证据的事务完整性**（2026-08-07 按锁定决策 12 重写；原文要求签名与私钥托管，
   见下方「已退场的要求」）：`HostEvidenceWriter` SHALL 在发布前验证证据**完整集合**，
   `Facade` SHALL 从 durable EvidenceStore **重读并复验**后才允许 Record mutation。
   崩溃在发布中途 SHALL NOT 留下被后续当作完整的半写集合。完成声明 SHALL 绑定
   Action/invocation/workspace revision/actor，使**错配或陈旧**的声明 fail closed。

   这是**事务性**要求，由校验和/原子发布/重读比对承担，**不要求密码学签名**。

   **已退场的要求**：真实 Session producer 对 completion claim 签名，以及「private
   signing capability 只存在于可信 host 内存，不进入 argv/environment/project/Record/
   registry/日志/API/Canvas」的密钥托管纪律。理由见锁定决策 12：能伪造签名的攻击者
   同样能直接改本地 Run Record，密钥托管防的攻击者与能绕开它的是同一个人。
   **ECP-6 已交付并归档的 Ed25519 实现不回退**；本条只解除 ECP-7 将其延伸进生产
   Session executor 的义务。
4. **Cancel/restart/ack-loss**：真实执行覆盖 cancel-before-start、cancel-in-flight、host/daemon
   restart、worker process loss、completion ack loss、重复 completion 与 stale control；恢复
   只继续未提交前沿，已提交 invocation/effect 不重复执行，无法证明的状态类型化等待或升级。

   按后端分级验收：

   - `hosted` SHALL 证明 headless driver 与 `durable: daemon-lifetime`（跨 launcher 退出
     存活，**不跨守护进程自身重启**）。**守护进程死亡 SHALL 使作用域死亡**，在飞 action
     记类型化 `execution-lost`，Run 只能从最后一个已提交前沿恢复；SHALL NOT 尝试重新
     附着或复验身份。Linux/Windows SHALL 另证明精确递归终止、精确 scope-empty，以及
     守护进程死亡时的**零孤儿**拆除（Linux 继承管道 EOF → namespace 拆除；Windows
     最后句柄关闭 → `KILL_ON_JOB_CLOSE`）；
   - macOS `hosted` 为**显式声明的 best-effort**（POSIX 进程组）：SHALL 声明
     `exactCancel: false`、`scopeEmptyProof: false` 且启动前对用户可见；取消终态
     SHALL 为 `cancelled / emptiness-unproven`，**SHALL NOT 写成「已干净取消」**。
     `setsid()` 逃逸的残留风险是已知且已声明的限制，不是缺陷；
   - `in-tool` SHALL 证明 launcher 消失时返回类型化 `execution-lost`、未提交前沿保持未提交、
     Run 可由其他 driver 恢复、已提交 invocation 不重复执行；它 SHALL NOT 声称 durable、
     headless 或对孙代进程的精确递归终止。该限制必须是**声明出来的**能力事实，不是事后解释。
5. **Session reuse 与 handoff 权威配置**：`never`/`same-invocation` 以及 authored
   `sessionReuse` scope、handoff token limit、reuse round limit、touch/retire policy 的来源、
   默认值和 provenance 可追溯且由程序强制；复用只发生在相同冻结 invocation/role/workspace/
   backend authority 内，超限或不兼容时产生可审计 handoff/retire，而不是静默复用。
6. **驱动面同一 Run**：Claude/Codex 交互 launcher、裸 CLI、Management API、Canvas 和
   daemon 在能力允许时都能 start/resume/cancel/inspect 同一 Run；headless driver 不依赖交互
   launcher 存活。所有平面消费同一 projector/control contract，driver 切换不复制 Run 或
   Session truth。

   「在能力允许时」SHALL 由**可查询的能力矩阵**而非文档口头断言决定：每个 driver × 后端
   × 平台组合要么可用并有真实运行 receipt，要么返回类型化不可用原因。headless driver 只在
   `hosted` 后端可用的平台上成立；在只有 `in-tool` 的平台上，缺少 headless driver 是**声明的
   能力边界**，不是缺陷，但必须可被用户在启动前看到。
7. **真实自宿主**：选择一个范围受控、非 ECP、会修改真实产品代码并有确定性测试的玩具
   Change，由 ECP 从 start 驱动 implement、verify、independent review 和修复循环，直到本地
   delivery-ready。保存 RunId、ActionId、Session identity、workspace revision、result/evidence、
   gate/review verdict 与最终 delivery-ready revision；该 Change 纳入 0.2.0 最终统一 PR，不另开
   ECP-7 PR。

   自宿主证据 SHALL 显式记录所使用的执行后端与运行平台。**后端选择尚未拍板**（见下方
   「开放决定」）：Direction 建议在 Windows 上用 `hosted` 后端完成主证据（本机可验证、能力
   声明最强），并另取一份 `in-tool` receipt 证明两个后端消费同一冻结 Action contract；该建议
   在用户确认前不构成验收要求。
8. **质量门**：Session/executor/trust/control 相关的 Blocker/Major finding 为零；真实 backend
   fixture/protocol replay、故障注入、root/UI tests、typecheck、lint 与严格 Change 验证通过。

## 明确排除

- 0.2.0 completion audit、版本/changelog/package/tag、legacy engine retirement、最终干净分支
  与统一 PR/远端 CI：由 ECP-8 承接。
- Issue、Issue Acceptance、Issue Execution Plan、portfolio runtime、`auto-decompose` 迁移、
  Dispatch 与跨项目执行：属于 0.3.0。
- Remote/distributed Runtime、多机器 lease、团队权限、secret service、Tracker/Forge 托管、
  通知与多租户平台。
- **macOS 的 durable 进程权威**（sandbox / Endpoint Security / VM 方向均未选）：经
  2026-08-07 显式 scope decision 移交 0.3.0 研究。**同日 Step 1 决定修订本项的交付面**：
  本 Slice 在 macOS 上交付 `in-tool` 后端**与显式声明的 best-effort `hosted`**
  （POSIX 进程组，见验收 4），不再是 `in-tool`-only。这不批准 Endpoint Security、VM、
  silent unsupported、macOS 最低版本或任何签名/entitlement 分发方案；best-effort 档次
  **不是** durable 权威的替代实现；也不免除 ECP-8 对 macOS 断言的真实运行取证义务。
- **判据 4：替换安全身份**（opaque reference envelope、boot id/出生时刻/PID-ns inode
  绑定、pidfd 重开复验、prepared→published→activate 三态协议、registry v2）：经
  2026-08-07 Step 1 决定转为**升级路线**。既有实现与 evidence **全部保留、不删除、
  不改写历史**。0.2.0 改为守护进程死亡即作用域死亡（见验收 4 与 Target State
  锁定决策 11）。
- 为所有 agent backend 一次性建立完整平台；本 Slice 要求稳定窄接口、至少一个真实 backend
  与其他现有 driver 的明确 capability/fallback，而不是虚构全支持。
- 以 cache HIT、成本优化或常驻 daemon 代替正确性；缓存只作为有证据的性能优化，daemon
  退出时仍必须可恢复。
- ECP-8 的 release truth 审查与 0.3.0 的 Issue/portfolio 路线选择。

## 开放决定（不阻塞当前实现波）

以下问题在 2026-08-07 的 scope decision 中被提出但未拍板。它们不阻塞 Linux/Windows
provider 的实现波，但在到达对应 child 前必须由用户决定，不得由实现者默认取值：

1. **真实 macOS runner 是否可得。** 若届时无 macOS 机器，验收 2/4/6 的 macOS 侧
   `in-tool` receipt 与 `authority-unavailable` 断言取不到证据，ECP-8 必须把它显式记为
   0.2.0 的已知缺口，不得默认写成通过。
2. **自宿主玩具 Change（验收 7）使用哪个后端与哪个平台。** Direction 建议 Windows +
   `hosted` 为主证据，外加一份 `in-tool` receipt；待确认。
3. ~~`in-tool` 后端 `producerIsolation` 的取值与可验证表述~~ —— **已消解**：该字段按
   锁定决策 12 退场，无需再定取值。
4. **macOS child 在 portfolio 中的终态**：`skipped` + 0.3.0 指针，或保留 `escalated` 并在
   parent replan 中记为已移出本 Slice。该项属于 run-state，由 LEAD 单写者决定并落盘。

## Direction 对齐

- Workstream：`executable-composite-pipelines`
- Target State：`../../target-state.md`
- Roadmap：`../../roadmap.md` 的 ECP-7
- 上位 North Star：`../../../north-star.md`，遵循“每个切片纵向穿透”“最迟在切片结束前
  dogfood”“LLM 负责判断、程序负责机械推进”“完成必须有外部证据”。
- 设计输入：`../../../../../../docs/session-execution-layer-design.md`。其中 stream-json 主宿主、
  resume 恢复、single-flight、registry、tier 与 audit 研究是实现输入；任何与当前冻结 Action、
  trusted producer 或 ECP-6 事实冲突的旧段落必须在 Change 设计中重新对表，不能覆盖现行权威。
- 支持的 Result 终态：`passed | partial | failed | superseded | cancelled`
