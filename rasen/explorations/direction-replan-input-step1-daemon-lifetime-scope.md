# Direction replan 输入：Step 1 —— 作用域生命周期收敛到守护进程

> 状态：**决策输入，不是决策。** 本文不修改 Target State、Roadmap、Slice、任何
> run-state 或代码。落地须由 LEAD 单写者经 `/rasen-direction` 执行。
>
> 日期：2026-08-07
>
> 用户决定（2026-08-07，本文所要落地的内容）：
>
> 1. **分两步走。** Step 1 采用 Multica 式的轻量方案让 ECP 快速收敛验收；
>    判据 4（替换安全身份）的既有成果**不作废**，转为后续升级路线。
> 2. **macOS 在 Step 1 使用 Multica 方案**（POSIX 进程组 best-effort hosted），
>    不再限定为 `in-tool`-only。
> 3. 我提出的保留项予以保留（见 §4 三条不可退让项）。

## 1. 触发：复杂度的真实来源被定位错了

用户提出「设计是不是太复杂了、为什么 Claude Code 起 shell 命令就能管住生死」。
调查结论是：**复杂度不在「包含」，在「持久」。**

包含机制本身极简单：

```
Linux:   unshare(CLONE_NEWUSER|CLONE_NEWPID) + guardian，杀 guardian → 内核 SIGKILL 全 namespace
Windows: 不具名 Job Object + KILL_ON_JOB_CLOSE
```

内核保证不可逃逸、递归终止、精确判空。仓库里那一大坨——opaque reference 绑
boot id + guardian 出生时刻 + PID namespace inode、pidfd 重开复验、
prepared-inert → published-inert → activate 三态协议、registry v2、broker、
helper 可复现构建——**几乎全部服务于判据 4：守护进程死了、换一个新的，还要能
重新附着到同一作用域并证明身份。**

而判据 4 只为一件事存在：**守护进程要能死而作用域不死。**

## 2. 对照证据：Multica

`E:\AI\ChatAI\Agents\VibeCodingProjects\workflow\Reference\multica`，Go 编写的
同型产品（CLI + 本地 daemon 执行 AI 任务、可自托管）。

**POSIX**（`server/pkg/agent/proc_other.go`，整文件约 60 行）：

- `cmd.SysProcAttr.Setpgid = true`
- 取消：EOF stdin → `kill(-pgid, SIGTERM)` → 宽限 → `kill(-pgid, SIGKILL)`
- `waitProcessGroupGone` 轮询 `kill(-pgid, 0)` 直到 `ESRCH`
- SIGKILL 升级**以整组是否空为条件，而非 leader 是否退出**（注释写明：否则忽略
  SIGTERM 又不持有 stdout 的后代会让 leader 先退出从而跳过 SIGKILL）

**Windows**（`server/pkg/agent/proc_windows.go`）：

```go
func configureProcessGroup(cmd *exec.Cmd) {}              // 空操作
func signalProcessGroup(p *os.Process, _ syscall.Signal) { _ = p.Kill() }  // 只杀 leader
func waitProcessGroupGone(...) bool { return false }       // 永远无法确认
```

**持久性**（`server/internal/daemon/client.go:438`）：

> "RecoverOrphans tells the server to **fail** any dispatched/running tasks the
> previous daemon process for this runtime left behind. The server will
> auto-retry eligible tasks."

守护进程死 → **判任务失败、服务端重派**，不重新附着。遗留目录 `GCOrphanTTL = 72h`
后清理。**判据 4 花费为零。**

**它踩过的真实生产 bug**（代码注释带 issue 号）：孤儿 MCP server 与工具子进程
「keep running and **burning model budget** long after the task was cancelled，
and under `--max-concurrent-tasks 1` **starve every queued task**」（#5918，
codex #4520、opencode #4533 同因）。

**最有参考价值的一行**（`proc_windows.go`）：

```go
// codexInitializeRetrySupported remains false until Codex children are owned
// by a Job Object and descendant termination can be positively confirmed.
func codexInitializeRetrySupported() bool { return false }
```

因无法确认后代终止而**主动关掉一个功能**，而非假装有保证——与我们刚落地的
「按能力声明、绝不静默降级」独立收敛到同一形状。

## 3. 关键发现：现有验收本来写的就是 fail-closed

Slice `spec.md` 验收 4 主句原文：

> 「host/daemon restart…；**恢复只继续未提交前沿**，已提交 invocation/effect
> 不重复执行，无法证明的状态类型化等待或升级。」

Roadmap ECP-7 退出证据同样写的是「exactly-once/**fail-closed** 证据」。

**没有任何一处要求「必须重新夺回权威」。** Step 1 的语义（守护进程死 → 在飞
action 记类型化 `execution-lost` → 从最后已提交前沿恢复）**完全落在这句话的
字面含义内**。

因此本次改动的性质是：**主要是换实现，不是缩范围。** 唯一需要收窄的是分级条款
里 `hosted` 的一个词（§6.1）。

## 4. 三条不可退让项（用户已同意保留）

1. **Windows 必须上 Job Object。** Multica 在 Windows 上实质无包含；Job Object
   零特权、全 SKU、代价极小，没有理由退到那个水平。
2. **Linux 必须保 PID namespace，不退回 PGID。** `setsid()` 逃逸不是对抗场景：
   `npm run dev &`、docker、任何 daemonize 的工具都会跳出进程组。
3. **类型化 `authority-unavailable` + 绝不静默改路由。** 已实现、已归档
   （`process-authority-prepare-unavailability-outcome`），是整个分级叙事诚实性
   的支点。

## 5. Step 1 目标设计

### 5.1 统一语义：作用域生命周期 = 守护进程生命周期

**守护进程死亡 ⇒ 作用域死亡 ⇒ 在飞 action 记为类型化 `execution-lost`，
Run 只能从最后一个已提交前沿恢复。** 不重新附着、不复验身份、不留孤儿。

这比 Multica 更好：Multica 守护进程死后**留下杀不掉的孤儿**（72h GC），我们不接受。

### 5.2 Linux

- `unshare(CLONE_NEWUSER|CLONE_NEWPID)`；建议同时带 `CLONE_NEWCGROUP`
  （见 `process-authority-sandbox-survey.md` §3.5b：同一前提、多一个标志，
  堵上同 UID cgroup 迁移）。
- guardian 作 namespace PID 1，**持有一个从守护进程继承的管道**；守护进程死 →
  管道 EOF → guardian 退出 → 内核 SIGKILL 整个 namespace。
- ⚠️ **用继承管道 EOF，不要用 `PR_SET_PDEATHSIG`**：后者由**线程**死亡触发、
  且 setuid/exec 会清除，在 Go/Node 这类多线程宿主里是已知陷阱。
- 判空：对 guardian 阻塞 `waitpid()`/pidfd poll 即精确判空
  （内核保证 namespace init 是最后一个被回收的任务）。

### 5.3 Windows

- 不具名 Job Object + breakaway 禁用 + 单个不可继承 `KILL_ON_JOB_CLOSE` 句柄。
- 建议用 `PROC_THREAD_ATTRIBUTE_JOB_LIST`（Win10+）原子指派，替代
  「挂起创建 → assign → resume」，彻底消除竞态而非缩小窗口。
- ⚠️ 判空**不能只信 IOCP 通知**：`JOB_OBJECT_MSG_ACTIVE_PROCESS_ZERO` 属文档
  明写的尽力而为消息（"their delivery to the completion port is not
  guaranteed"），须以 `QueryInformationJobObject(JobObjectBasicProcessIdList)`
  同步查询确认，并加定时轮询兜底。
- 守护进程死 → 最后一个句柄关闭 → 内核杀光。与 Linux 对称。

### 5.4 macOS（用户 2026-08-07 决定：采用 Multica 方案）

- `setpgid` 自成进程组；取消：EOF stdin → 组 SIGTERM → 宽限 → 组 SIGKILL；
  升级条件**以整组是否空为准，不以 leader 退出为准**（照搬 Multica 的正确细节）。
- 守护进程死亡：因无内核强制边界，无法保证清理。仍按 §5.1 记 `execution-lost`。
- **已知残留风险：`setsid()` 逃逸真实存在**（`npm run dev &`、docker 等）。

**不可退让的诚实性约束（本文对该决定附加的唯一条件）：**

> macOS 的 `hosted` 取消**不得写成「已干净取消」**。终态必须是
> `cancelled / emptiness-unproven` 一类的类型化事实——「已发组信号，无法证明为空」。

理由：我们真正要保的不变量是**「Record 不能说谎」**，不是「进程绝不泄漏」。
只要 Record 如实报告未证实状态，下游（ship gate、下一个 action）就能据此要求
人工确认或换干净 workspace，核心不变量不破。若写成干净取消，则 Record 说谎，
后续 action 会在被污染的 worktree 上继续——那正是 ECP 存在的意义所在。

对应地，macOS `hosted` 的能力声明必须包含 `exactCancel: false`、
`scopeEmptyProof: false`，且这一事实要在启动前对用户可见。

### 5.5 能力矩阵（Step 1 终态）

| 平台 | `in-tool` | `hosted` |
| --- | --- | --- |
| Linux | ✅ | ✅ 内核强制；`durable: daemon-lifetime` |
| Windows | ✅ | ✅ 内核强制；`durable: daemon-lifetime` |
| macOS | ✅ | ⚠️ best-effort；`exactCancel: false`、`scopeEmptyProof: false` |

`hosted` 相对 `in-tool` 仍然买到：**headless driver、跨 launcher 退出存活、
（Linux/Windows 上）精确递归取消**。只丢「跨守护进程自身重启存活」。

## 6. 需要 Direction 同步的改动

### 6.1 措辞收窄（唯一的实质性文本修改）

Slice `spec.md` 验收 4 分级条款现文：

> `hosted` SHALL 证明 **durable** 执行、headless driver、精确递归终止与精确 scope-empty

须收窄为 `durable: daemon-lifetime`（跨 launcher 退出存活，不跨守护进程重启），
并按 §5.5 对 macOS 的 `exactCancel`/`scopeEmptyProof` 分别声明。

### 6.2 判据 4 移交升级路线

比照 macOS durable 权威与 Linux broker 两次移交的既定规矩：**保留全部代码与
evidence，标记为升级路线，不删除、不改写历史。** 具体涉及 opaque reference
envelope、boot id/出生时刻/PID-ns inode 绑定、pidfd 重开复验、
prepared→published→activate 三态协议、registry v2。

### 6.3 macOS best-effort hosted 进入 0.2.0

此前 Direction 记录的是「macOS 在 0.2.0 的执行形态就是 in-tool 执行」
（Target State 锁定决策 10、Roadmap 2026-08-07 replan 节、Slice 排除项）。
用户已改为 macOS 亦提供 best-effort `hosted`。**这些文本须同步修订**，
且必须带 §5.4 的诚实性约束，否则会变成一次未声明的能力扩张。

⚠️ 这一条**不放宽** macOS durable 进程权威移交 0.3.0 的决定：ES / VM / 签名
分发 / 最低版本仍然一项都未获批准。Step 1 的 macOS `hosted` 是显式声明的
**非权威**档次，不是 durable 权威的替代实现。

### 6.4 ECP-8 receipt 相应调整

OS × 后端矩阵仍成立，但 macOS `hosted` 那格的期望结果从「真实运行证明返回
类型化 `authority-unavailable`」改为「真实运行证明 best-effort 语义与
`emptiness-unproven` 终态如实上报，且能力声明在启动前可见」。

## 7. 对现有开放 finding 的实际影响（已逐条读原文核实）

Linux provider 现有 11 个开放 finding。**已逐条读取原始 finding 文本，不是摘要。**

| Finding | 归属机制 | Step 1 后 |
| --- | --- | --- |
| `BRK-R2-B06`（**唯一 Blocker**） | broker | **随 broker 移交 0.3.0 离开** |
| `BRK-R2-B01` | broker | 同上 |
| `BRK-R2-B02-M03` | broker | 同上 |
| `NATIVE-SEAM-R1-M01` | ready-hook seam | **消失**（见下） |
| `NATIVE-SEAM-R1-M02` | ready-hook seam | **消失** |
| `WSL-R4-M04` | published-inert abort | **消失**（publish 阶段不存在） |
| `WSL-R4-M06` | controller replacement 双窗口 | **消失**（replacement 不存在） |
| `WSL-R4-M00` | 构造失败矩阵 + final revalidation | **部分存留**：构造失败清理仍需，final revalidation 部分归属判据 4 |
| `WSL-R4-M01` | final-child race + root-status 损坏矩阵 | **部分存留**：final-child race 属判空，仍需；root-status 损坏属持久态，离开 |
| `WSL-R4-M05` | unavailable-configuration 矩阵 | **存留且必需**——正是 §4 第 3 条 |
| `PKG-P5`（Minor） | 陈旧 source digest | **存留**（供应链，与本次无关） |

**`NATIVE-SEAM-R1-M01/M02` 消失的依据（原文）：** 该 seam 的用途是
「the **broker hook** writes the construction reference」，而该记录被
`ready-hook-seam-remediation-plan.md` 明确定义为
「**same-boot process-recovery state**」。同一文档还写明普通入口
`prepare_primary(request, ...)`「retains its **no-extra-work** behavior」。
即：seam 同时依附于 broker（已移交）与 process-recovery（判据 4），两者皆不在
Step 1 内，seam 无消费者。

**净效果：11 条中 7 条离开（含唯一的 Blocker），2 条部分存留，2 条存留。**

⚠️ 需要注意的边界：`BRK-R2-B06` 曾被判定「定义可能过窄」——primary 路径的
helper CLI 在同样三个动词上有同款缺陷，而该 finding 措辞未覆盖。
**broker 实例随 broker 离开，但 primary 兄弟条必须留在 0.2.0**，这一点在
`direction-replan-input-broker-to-0-3-0.md` 已有记录，Step 1 不得抹掉它。

## 8. Linux 已冻结实现的处置

Linux provider 当前 72/93 tasks、处于 implementation-frozen 前夜。Step 1 之后：

- **属于判据 4 的实现**（opaque ref、三态协议、registry v2、replacement recovery）
  按 §6.2 保留并标记升级路线，不删。
- **属于包含与判空的实现**（namespace 构造、guardian、waitpid 判空、availability
  probe、escape oracle）**继续有效并继续需要真实 WSL 取证**。
- **任务账本需要重新分档**，而不是简单勾掉：Section 9（broker cgroup gate）
  已随 broker 离开；判据 4 相关任务转升级路线；其余保留。
  ⚠️ **具体分档必须由实现者逐条对照 tasks.md 完成，本文不做代劳**——按摘要
  分档正是本轮反复吃亏的做法。

## 9. 本文未做与不主张的事

- 未修改任何 Direction 制品、run-state 或代码。
- 不主张 Step 1 已经等于 ECP-7 可验收：Windows provider 尚未 propose，
  executor / policy-parity / self-hosting 三个 child 仍未开始。
- 不放宽任何真实 OS 取证义务、child archive 证据规则或 ECP-8 单一干净分支 PR 边界。
- 不主张判据 4 的既有工作白做——它按 §6.2 完整保留为升级路线，这是本次
  决定的明确前提。

## 10. 建议的落地顺序

1. LEAD 以单写者身份执行 `/rasen-direction`，按 §6 同步四处文本。
2. 同步 portfolio run-state：判据 4 相关范围标记移交，比照 macOS/broker 两次
   既有做法保留全部历史。
3. Linux provider 按 §8 重新分档任务账本（实现者逐条核对）。
4. Windows provider 按 §5.3 propose（含 §5.3 的三条改进）。
5. macOS provider 按 §5.4 propose best-effort hosted，带诚实性约束。
