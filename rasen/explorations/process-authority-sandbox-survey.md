# 三平台进程权威 / 沙盒方案调研

> 状态：**调研文档，不是决策，也不是 Direction 制品。** 本文不修改 Target State、
> Roadmap、Slice 或任何 run-state。
>
> 日期：2026-08-07
>
> 触发：ECP-7 的 macOS durable 权威已移交 0.3.0；Linux 的 authenticated broker /
> cgroup-v2 路径亦已移交 0.3.0。用户要求横向调研三平台各有什么沙盒方案。
>
> 方法：主 agent + 三个并行 Sonnet 研究 agent。**所有结论按可信度分级**（见 §8），
> 未能核实的一律标 UNVERIFIED，不猜。本次调研中已捕获两起搜索引擎摘要捏造，
> 详见 §6.1 与 §8.2 —— 这是本文最重要的方法论产出之一。

## 1. 判据：我们到底在找什么

沿用 `architecture-replan.md` 的必要不变量，六项：

1. **不可逃逸的递归包含** —— workload 调 `setsid()`/`setpgid()`/double-fork/嵌套
   namespace 都出不去。（POSIX 进程组已被实证否证。）
2. **精确递归终止** —— 杀光所有后代，有保证。
3. **精确判空** —— 区分「根进程退出了」与「作用域真的空了」，这是两件事。
4. **替换安全的身份** —— 守护进程死后，新进程能重新附着到同一作用域并证明身份，
   抗 PID 复用。
5. **特权成本** —— root / setuid / 服务安装 / entitlement / 版本门槛。我们是
   **npm 分发、无安装器的 CLI**，每一项都昂贵。
6. **可用性探测** —— 运行时检测不可用并 fail closed 返回类型化错误。

## 2. 先分清：能力限制 ≠ 进程权威

这是本次调研最有价值的框架性发现，它解释了为什么我们一路撞墙。

业界叫「沙盒」的东西**绝大多数是能力限制**（限制读写什么、能不能联网），
而我们要的是**进程权威**（递归包含 + 精确终止 + 精确判空）。两者正交。

| 产品 | Linux | macOS | Windows | 类型 |
| --- | --- | --- | --- | --- |
| `@anthropic-ai/sandbox-runtime` | bubblewrap + seccomp | Seatbelt (`sandbox-exec`) | 专用本地账户 `srt-sandbox` + WFP + NTFS ACL | 能力限制 |
| Codex CLI | Landlock + seccomp | Seatbelt | Restricted Tokens | 能力限制 |
| Gemini CLI | Docker / Podman | Seatbelt | — | 混合 |
| Cursor / Devin / Copilot | 云端 VM / 微 VM | 同左 | 同左 | 云端隔离 |
| AgentENV（本次另评） | Firecracker 微 VM | 不支持 | 不支持 | VM 隔离 |

**没有一个提供「杀干净这棵子树并确知它空了」。** 原因是它们的产品形态不同：
多数把 agent 放进一次性容器，跑完整个扔掉，于是不需要精确终止——扔掉即终止。
而我们要 agent 在**用户真实 worktree 里改真实代码**，扔不掉，所以必须自己拥有
进程权威。这是我们的需求在业界属于少数派的根本原因，不是我们方案选错了。

Anthropic 自己那个 runtime 有两条直接命中我们的事实：Linux 路径要求 user
namespace，**Ubuntu 24.04+ 需要用户改 `kernel.apparmor_restrict_unprivileged_userns=0`**；
Windows 路径走**专用本地用户账户 + SID**（越界 spawn 的进程仍带该 SID）——后者是
一条我们没考虑过的思路，但按 SID 枚举仍属采样，不满足判据 2/3。

## 3. Linux

### 3.1 结论

**PID namespace 是权威，cgroup 是佐证。反过来不成立。**

| 机制 | 1 包含 | 2 终止 | 3 判空 | 4 身份 | 5 特权 | 6 探测 |
| --- | --- | --- | --- | --- | --- | --- |
| **user ns + PID ns**（我们已实现） | ✅ | ✅ | ✅ 见 §3.2b | ⚠️ 无文件系统名 | ✅ 非特权 | ⚠️ 须实际 `unshare` 试探 |
| cgroup v2（systemd 用户委派） | ❌ 同 UID 可迁出 | ✅ | ✅ | ✅ 路径即身份 | ✅ 非特权 | ✅ `user.delegate` xattr |
| cgroup v2 + cgroup ns + `nsdelegate` | ✅ | ✅ | ✅ | ✅ | ⚠️ **仍需 `CLONE_NEWUSER`**，见 §3.5 | ⚠️ |
| pidfd | ❌ 单进程句柄 | ❌ | ❌ | ✅ 解 PID 复用 | ✅ | ✅ |
| Landlock / seccomp | ❌ 能力限制 | ❌ | ❌ | ❌ | ✅ | — |
| bubblewrap / nsjail / minijail | ❌ 沙盒不是作用域 | ⚠️ | ⚠️ | ❌ | ⚠️ 需 userns | ⚠️ |

### 3.2 PID namespace 为什么是权威（一手核实）

`pid_namespaces(7)` 两句原文，给出内核级保证：

> "If the 'init' process of a PID namespace terminates, the kernel terminates
> **all of the processes in the namespace** via a SIGKILL signal."

> "While processes may freely descend into child PID namespaces ... they may
> **not** move in the other direction. That is to say, processes **may not enter
> any ancestor namespaces** (parent, grandparent, etc.)."

判据 1 与 2 由内核保证。`setsid()`/`setpgid()`/double-fork **根本不改变 PID
namespace 成员资格**——它们改的是 session/进程组，是另一个维度。

补充一条同样来自 `pid_namespaces(7)` 的强化保证：

> "SIGKILL or SIGSTOP are treated exceptionally: these signals are **forcibly
> delivered** when sent from an ancestor PID namespace."

即 guardian **无法屏蔽/忽略/阻塞**来自祖先 namespace 的终止信号。

> ⚠️ 研究 agent 首轮把此项判为 ❌（称「不是原子操作」），**该判断与 man page
> 矛盾，已退回**；二轮它已撤回该判断并确认本节结论。若采信首轮，会错误否定
> 我们已实现并已通过 review 的 Linux 设计。见 §8.2。

### 3.2b 判空是免费的（二轮新发现，此前被低估）

首轮报告称 PID namespace「没有 `populated` 的等价物」，二轮撤回并给出一条
**比 cgroup `populated` 更强**的保证：内核 `zap_pid_ns_processes()` 保证
namespace 的 init（PID 1）**是最后一个被回收的任务**——

> "the kernel guarantees that the init process of a pid namespace is not reaped
> before every other task in the pid namespace is reaped, and **waiting on the
> init process gives the guarantee that all processes in the pid namespace are
> dead and gone**"

因此：祖先守护进程对 guardian 做阻塞 `waitpid()` 或 pidfd poll，**本身就是精确
判空信号**，无需另设轮询原语，且由内核设计保证原子性而非靠约定。

判据 3 因此由 ⚠️ 升为 ✅。来源等级：内核提交说明（lkml），非 man page —— 属
【一手·研究 agent 拉取】，未经主 agent 独立复核。

### 3.3 单靠 cgroup 为什么不是权威（一手核实，且推翻了我自己的初判）

调研中我一度认为 systemd 的 cgroup 委派能让非特权用户直接拿到 `cgroup.kill`，
从而使 broker 变得不必要。**这个想法是错的**，仓库旧研究早就写对了：

内核 cgroup-v2 Delegation Containment 原文，非 root euid 迁移进程需满足：

> "The writer must have write access to the 'cgroup.procs' file." **且**
> "The writer must have write access to the 'cgroup.procs' file of the
> **common ancestor** of the source and destination cgroups."

其效果被文档描述为 delegatee「不能推出**该子层级之外**」。而 systemd 委派是把
**整个用户子树** `chown` 给你的 UID（`user@.service.in` 中 `Delegate=pids memory cpu`
+ `User=%i`）。我们的 workload 跑在**同一个 UID**，因此：

- 它对我们 leaf 与其兄弟 cgroup 的**共同祖先**有写权限；
- 于是它可以把自己迁进兄弟 cgroup；
- 我们对 leaf 执行 `cgroup.kill` 就打空了。

**同 UID 可写的 cgroup 是资源管理边界，不是安全边界。** 判据 1 = ❌。

### 3.4 cgroup 仍然有用的地方

- `cgroup.kill`：「causes the cgroup and all descendant cgroups to be killed」，
  且「deals with concurrent forks appropriately and is protected against
  migrations」——**防 fork 炸弹**，作为兜底清扫有价值。
- `cgroup.events` 的 `populated`：「1 if the cgroup or its descendants contains
  any live processes; otherwise, 0」——递归、可 poll，正是判据 3 要的那个
  「根退出 ≠ 作用域空」的区分信号。
- 这两个都是**核心接口文件，不需要启用任何 controller**，只依赖目录属主。

结论：**分层，但分工比「佐证判空」更精确**（二轮修正）。既然 §3.2b 证明判空
由 PID namespace 免费提供，cgroup 的真正价值收窄为三点：

1. **`pids.max` / `memory.max` 防炸弹**——PID namespace 本身**不设任何上限**，
   fork 炸弹或内存炸弹可以在我们的 namespace 拆除被调度之前就耗尽**宿主全局**
   的 PID 表或内存。这是 cgroup 唯一不可替代的作用。
2. **OOM 记账与上报。**
3. **判据 4 的稳定句柄**——见下。

### 3.4b 判据 4：PID namespace 唯一的真实缺口

裸 PID namespace **没有文件系统可见的名字**：守护进程死后，重启的新进程没有东西
可以按名重开。两条候选：

- **bind-mount nsfs 句柄**：创建作用域时
  `mount --bind /proc/<guardian-pid>/ns/pid /run/<app>/scopes/<job-id>.pidns`
  （`ip-netns(8)` 对 net namespace 用的就是这个模式），之后以 inode 比对
  （`stat()` bind-mount vs `stat(/proc/<candidate>/ns/pid)`）验证身份再发信号。
  ⚠️ 研究 agent 明确标注：这是它**从文档化的 namespace/nsfs 机制推理出来的**，
  **未找到成文配方，UNVERIFIED as established idiom**。
- **用 cgroup 路径作持久身份键**：确定性命名的 cgroup 路径天然是稳定句柄。

**推荐分工：cgroup 路径当持久身份/查找键，PID namespace 当实际的包含/终止/判空
执行者。** 两者角色互补而非重叠。

### 3.5 补救路线已查清：能堵住，但收敛到同一个前提

**决定性证据（主 agent 以 `curl` 取内核文档原始字节自行提取，非摘要）。**
`Delegation Containment` 一节存在**两条彼此独立**的强制路径：

面向低权限用户的那条，就是 §3.3 里对同 UID 失效的那条，失败码 `-EACCES`：

> "The writer must have write access to the 'cgroup.procs' file of the common
> ancestor of the source and destination cgroups."

而面向 namespace 的那条完全不同：

> "For delegations to namespaces, containment is achieved by requiring that both
> the source and destination cgroups are **reachable from the namespace** of the
> process which is attempting the migration. If either is not reachable, the
> migration is rejected with **`-ENOENT`**."

**关键在于失败码不同。** 这不是权限检查（`EACCES`），是**可达性/命名检查**
（`ENOENT`）——目标 cgroup 在 namespace 内**根本无法被解析**。同 UID 再怎么有
权限也满足不了一个「你看不见它」的约束。**与 UID 无关，结构性阻断。**

同节还给出两条精确事实：

- 委派是**自动的**，无需额外授权：`nsdelegate` 生效时，containment「automatically
  to a cgroup namespace **on namespace creation**」——创建 cgroup namespace 这个
  动作本身就是委派事件，不需要额外 chown 或配置。
- namespace root 上仍可写的，只有 `/sys/kernel/cgroup/delegate` 列出的那些文件
  （`cgroup.procs`、`cgroup.threads`、`cgroup.subtree_control` 等），恰好够
  workload 组织**自己的**子树。⚠️ `cgroup.kill` 是否在该集合中，引文未点名，
  应在目标内核上运行时读 `/sys/kernel/cgroup/delegate` 确认，不要想当然。

**systemd 是否默认这么挂载——已从 systemd 源码原始字节核实**
（`src/shared/mount-setup.c`）：

```c
.where = "/sys/fs/cgroup",
.type = "cgroup2",
.options = "nsdelegate,memory_recursiveprot",
.flags = MS_NOSUID|MS_NOEXEC|MS_NODEV,
```

这是无条件的挂载表项。自 systemd 235（2017）起，内核支持自 Linux 4.15（2018）起
——**到 2026 年两个门槛都早已是古董，任何非 EOL 内核的 systemd 主机上这层强制
在我们的进程启动之前就已经生效。我们无权自己设，但也不需要设。**

**但关键在这里（本次调研最重要的架构洞见）：**

`clone(2)` 原文，两处措辞完全相同（主 agent 一手核实）：

> "Only a privileged process (**CAP_SYS_ADMIN**) can employ **CLONE_NEWCGROUP**."
>
> "Only a privileged process (**CAP_SYS_ADMIN**) can employ **CLONE_NEWPID**."

而：

> "Starting with Linux 3.8, **no privileges are needed to create a user namespace**."

非特权拿到 `CAP_SYS_ADMIN` 的**唯一途径**，是在同一次 `clone` 调用中带上
`CLONE_NEWUSER`——新 user namespace 内调用者获得完整能力集，足以同时创建
cgroup/PID namespace。

**因此「非特权 cgroup namespace 加固」与「非特权 PID namespace 包含」不是两个
独立选项，它们收敛到同一个前提：非特权 `CLONE_NEWUSER` 必须成功。**

推论：**Linux 只有一道可用性闸门，不是两道。** 除了走 user namespace（或真正的
UID 分离，而那本身又需要特权来配置），没有任何办法在非特权下堵住同 UID cgroup
逃逸。这既简化了设计（只需为一个 gate 写 fail-closed 路径），也集中了风险
（一个 gate 同时决定主副两条机制的生死）。

另两条附带结论：

- **`CLONE_INTO_CGROUP`（clone3）不绕过权限**——`clone(2)`：「all of the usual
  restrictions (described in cgroups(7)) on placing a process into a version 2
  cgroup apply」。它只消除守护进程放置新进程时的 fork-then-migrate 竞态窗口，
  与自我迁移逃逸问题正交。
- **「不给 workload 挂载 cgroupfs」不是边界，只是纵深**：同 UID 进程可能经
  `/proc/<pid>/root` 触达宿主 mount namespace，其阻断仅取决于 Yama
  `ptrace_scope`（Ubuntu 默认 `1`，Fedora 不一致）。须运行时探测
  `/proc/sys/kernel/yama/ptrace_scope`，不可按发行版硬编码假设。

### 3.5b 由此得出的具体加固方案（近乎免费）

既然 PID namespace 已经要求 `CLONE_NEWUSER`，把 cgroup namespace 捆进同一次调用
即可，**不引入任何新的前提或新的失败点**：

1. 守护进程创建 leaf cgroup（`systemd-run --user --scope --unit=<name>`，或在被
   委派子树下直接 `mkdir`）。
2. 把即将成为 guardian 的进程放进该 leaf（写 `cgroup.procs`，或用
   `CLONE_INTO_CGROUP` 在 spawn 时放置以消除竞态）。
3. 该进程在 leaf 内部，**单次**调用
   `unshare(CLONE_NEWUSER|CLONE_NEWPID|CLONE_NEWCGROUP[|CLONE_NEWNS])`。
   其 cgroup namespace root 即当前所在的 leaf；由于 `nsdelegate` 已经生效，
   这一次调用**同时**关闭 PID namespace 逃逸（已证）与 cgroup 迁移逃逸（新证）。

**这是现有设计的严格超集**：同一个 `CLONE_NEWUSER` 前提、多一个 clone 标志、
堵上一个原本敞开的洞。属于加固，不是重构。

### 3.6 真正的风险不在机制，在发行版策略

非特权 user namespace 今天有三个独立关闭开关：

| 发行版 | 状态 | 来源等级 |
| --- | --- | --- |
| Ubuntu 23.10+ / 24.04+ | AppArmor 默认 `kernel.apparmor_restrict_unprivileged_userns=1`，需 profile 授权否则 `EPERM` | Ubuntu 官方 spec |
| Debian 11+ | `kernel.unprivileged_userns_clone=1` 默认开启 | 二手（邮件列表），UNVERIFIED |
| RHEL 8/9 | 默认开启，但 DISA STIG 建议 `user.max_user_namespaces=0` | STIG 文档 |
| Arch | 默认开启，无限制层 | 二手 |

这与 Anthropic 自家 sandbox-runtime 要求 Ubuntu 用户手动关闭该限制是同一件事——
**这是全行业共同的痛点，不是我们的实现缺陷。**

## 4. Windows

### 4.1 结论：现有 Job Object 设计在最难的问题上是对的

逃逸问题是**结构性阻断，不是策略阻断**（Microsoft Learn 一手）：

- 「After a process is associated with a job, **the association cannot be
  broken**.」没有任何 API 能让进程自行脱离。
- 未启用 breakaway 时，`CreateProcess(..., CREATE_BREAKAWAY_FROM_JOB, ...)`
  **无效**——子进程在 `CreateProcess` 时被无条件捕获，没有 opt-out 窗口。
- **嵌套 Job 不构成逃逸**：被捕获的进程确实可以自建 Job 并把自己 assign 进去
  （新 Job 为空，满足嵌套合法性规则），但那只是在既有层级下**再加一层**，
  不会脱离外层。终止会级联：「the system terminates processes in that job and
  all of its child jobs, **starting with the child job at the bottom of the
  hierarchy**」。
- 旁证：Chrome 的 Windows 沙盒正是用 Job Object 作硬边界，restricted token 是
  **叠加**在其上而非替代。

**特权成本为零**：无需管理员、无版本门槛、Home 版可用，XP 起即有（嵌套 Job 需
Win8+）。对无安装器的 npm CLI 而言这是压倒性优势。

### 4.2 三条应当纳入 Windows provider Change 的改进

Windows provider 尚未 propose，以下三条应作为其 proposal 输入：

1. **判据 3 有真实缺口。** `JOB_OBJECT_MSG_ACTIVE_PROCESS_ZERO` 属于**尽力而为**
   的通知：「except for limits set with the `JobObjectNotificationLimitInformation`
   information class, messages are intended only as notifications and **their
   delivery to the completion port is not guaranteed**」。必须以
   `QueryInformationJobObject(JobObjectBasicProcessIdList)` 或
   `JobObjectBasicAccountingInformation.ActiveProcesses` 同步查询确认，
   IOCP 消息只当低延迟触发器，并加定时轮询兜底。
2. **可用 `PROC_THREAD_ATTRIBUTE_JOB_LIST` 彻底消除竞态**（Win10+）。经
   `STARTUPINFOEX` 传入，在初始线程运行**之前**原子完成 Job 指派，比
   「挂起创建 → assign → resume」更强：后者只是缩小窗口，前者消除窗口。
   （最低 build 号 UNVERIFIED。）
3. **`KILL_ON_JOB_CLOSE` 是「全系统最后一个句柄关闭」**，不是「守护进程的最后
   一个句柄」。任何 `DuplicateHandle` 或可继承句柄泄漏都会让 Job 在守护进程死后
   存活，破坏「控制方死亡即保证清理」。我们的「单个不可继承句柄」是正确缓解，
   但需确认下游（日志工具、进程包装器）不会复制它。

### 4.3 判据 4 是 Windows 最硬的开放问题

**这是一个结构性矛盾，不是实现缺陷：**

- **不具名 Job + 单个 kill-on-close 句柄**（现设计）：守护进程死亡必然清理
  （句柄随进程消亡，无代码路径可阻止）——但不具名对象**没有名字可供后继进程
  `OpenJobObject`**，新守护进程无法重新附着。
- **具名 Job**：解决可发现性，但引入两个已证实的问题：
  - **抢占是真实风险**：`CreateJobObjectW` 文档明写「If the object existed
    before the function call, the function returns a handle to the **existing**
    job object and `GetLastError` returns `ERROR_ALREADY_EXISTS`」。低权限本地
    进程可预先以可预测名字创建并设宽松 DACL，导致我们的守护进程静默附着到
    **它的**对象上。缓解需 `CreatePrivateNamespace`/`CreateBoundaryDescriptor`
    （身份 = 名字 + 边界 SID）或 GUID 后缀 + 严格 DACL（注意 DACL 只保护创建后，
    对已被抢占的情况无效）。
  - **会话作用域**：「A job is associated with the session of the first process
    to be assigned to the job」——跨会话（RDP / session 0）无法重开，除非用
    `Global\` 前缀，而那又扩大抢占面。

研究 agent 提出的 **keeper 进程方案**（独立最小进程持有复制句柄，经带边界保护的
具名管道 IPC 向后继守护进程交付句柄，配心跳死人开关）在文档原语上成立，
但**该 agent 明确标注这是它自己的综合方案，不是 Microsoft 背书的既有模式，
UNVERIFIED**。采纳前需独立设计审查。

### 4.4 其他 Windows 方案（均不推荐）

| 方案 | 否决理由 |
| --- | --- |
| Server Silos / Windows 容器 | Pro/Enterprise + 可选功能 + 管理员 + 重启 |
| AppContainer / 低完整性 | 令牌限制，非包含作用域，无 kill-all、无判空 |
| Restricted tokens | 同上；Chrome 历史上是在其**下面**叠 Job Object |
| Windows Sandbox (`.wsb`) | 非 Home 版；`wsb exec` **要求活动交互式会话**且**无进程 I/O**（「no way to retrieve the output」）——对捕获 `claude -p` stdout 的无头守护进程直接出局 |
| WSL2 | 工作负载是原生 Win32 程序，用它意味着改架构；`.wslconfig` **全局影响用户所有发行版**；`/mnt/c` 走 9P 有真实性能税 |

## 5. macOS

### 5.1 结论：零成本的原生进程树包含，不存在

直接回答「macOS 上有没有东西能在**不需要 Apple 审批的 entitlement** 下，
对**原生 macOS 进程树**做内核强制包含？」——

**没有。** 但有一个重要的限定放宽：满足判据 1+2+3 的只有
**Virtualization.framework**，而它的 entitlement `com.apple.security.virtualization`
经 Apple DocC 实时核实是**自助申请，不是 Apple 人工审批门**（与 Endpoint Security
不同）。代价是可量化的一次性工程，不是人工审批等待：

- 付费 Apple Developer Program 会员
- Developer ID 证书 + 代码签名
- 公证（notarization）
- **必须随 npm 包分发一个编译的原生签名二进制**（不能纯 JS）
- 运行时非特权，无需 root

### 5.2 各机制

| 机制 | 1 包含 | 2 终止 | 3 判空 | 4 身份 | 5 特权/分发 | 结论 |
| --- | --- | --- | --- | --- | --- | --- |
| **Virtualization.framework**（Linux 客户机） | ✅ 客户机内核独立 | ✅ 整机停止即原子递归终止 | ✅ VM 状态即判空 | ⚠️ 需自己做簿记 | ⚠️ 见 §5.1 | **0.2.0/0.3.0 最务实路线** |
| **ES descendants client**（macOS 27 Beta） | ⚠️ 内核推送递归成员集，无竞态；但只观察+逐事件 AUTH，**无批量终止**，须自建 stop/sync 不动点循环 | ⚠️ 靠自建循环，非原语 | ⚠️ sync 完成与 client 拆毁**不可区分**，须独立存活检查 | ⚠️ | ❌ **需 Apple 人工审批的 `endpoint-security.client` entitlement**；调用免 root，但权限分离仍需安装时 root（§5.3c）；且 macOS 27 未发布 | 仅 0.3.0 候选，非近期可用 |
| Virtualization.framework（macOS 客户机） | ✅ | ✅ | ✅ | ⚠️ | ❌ 再加：仅 Apple Silicon + 数 GB 客户机镜像 | 更重且无收益 |
| Apple `container` / Containerization | ❌ | ❌ | ❌ | ❌ | ❌ | **仅 Linux 客户机、仅 Apple Silicon，无法包含原生 macOS 进程** |
| Hypervisor.framework | ✅ | ✅ | ✅ | ⚠️ | ❌ 需自行重写 VMM | 无理由优于上者 |
| App Sandbox / Seatbelt | ⚠️ fork 继承，但**经 LaunchServices 重启的进程不继承**（真实绕过类） | ❌ 无作用域 kill 原语 | ❌ | ❌ | ❌ `sandbox-exec` 已弃用，替代品面向 GUI `.app`，**无无头 CLI 的非弃用路径** | 否 |
| launchd / `launchctl kill` | ❌ 只作用于单个已注册 job 的 PID | ❌ | ❌ | ❌ | ✅ | 否 |
| Mach task ports / `task_for_pid` | ❌ 单 task，无层级概念 | ❌ | ❌ | ❌ | ❌ `get-task-allow` **会导致公证被拒** | 否 |
| `kqueue` + `NOTE_TRACK` | ❌ 见 §5.3 | ❌ 纯观察 | ❌ | ❌ | ✅ | **否，且比我们以为的更死** |

### 5.3 两项对既有认知的修正

**(a) `NOTE_TRACK` 不是「有时不可靠」，是自 2007 年起就不工作。**

XNU 一手源码 `bsd/sys/event.h`（main 分支）含字面注释：

> "DEPRECATED!!!!!!!!! NOTE_TRACK, NOTE_TRACKERR, and NOTE_CHILD are no longer
> supported as of 10.5"

宏仍为源码兼容而 `#define`，但当前 `kevent(2)` man page 只记载 `NOTE_EXIT`、
`NOTE_EXITSTATUS`、`NOTE_FORK`、`NOTE_EXEC`、`NOTE_SIGNAL`、`NOTE_REAP`。
所以真实失败模式不是「资源压力下 `NOTE_TRACKERR` 丢子树」，而是**自动 fork 跟踪
在 macOS 上自 Leopard 起就没有功能**。`NOTE_FORK` 仍会触发，但你退回到手工枚举
并重新注册每个新 PID——即我们已否证的采样，且同样有 PID 复用竞态。

**(b) `es_new_descendants_client` 与 `es_sync_client` 已证实存在；仓库既有引用成立。**

> 本节曾一度写成「存在性存疑、仓库引用无法复验」。研究 agent 二轮改用 raw `curl`
> 直接拉取 Apple DocC JSON 数据 API 的**原始字节**（绕过搜索引擎综合与 WebFetch 的
> 摘要模型），两个 API 均 HTTP 200 命中。**此前的存疑结论作废，
> `architecture-replan.md` 的引用是对的。** 之所以首轮看不到，是因为查的是公开
> Client 主题组列表，Beta API 不在其中。

`es_new_descendants_client(_:_:)`（13567 bytes，HTTP 200）逐字：

- 平台：`{"name":"macOS","beta":true,"introducedAt":"27.0"}`——截至 2026-08-07
  仍是 Beta，macOS 27 尚未正式发布。
- 签名：`es_new_client_result_t es_new_descendants_client(es_client_t **client, es_handler_block_t handler)`
- 说明：「Create a new ES client scoped to descendant processes only.」
- 「The returned client receives notify events for the calling process and
  **auth+notify events for descendant processes (forked or exec'd after
  creation, recursively). All other processes are invisible.**」
- **entitlement 逐字**：「Requires the `com.apple.developer.endpoint-security.client`
  entitlement.」——**与经典 `es_new_client` 是同一个 Apple 人工审批门控的
  entitlement，判据 5 的核心门槛没有放宽。**
- **特权逐字**：「Does NOT require root privilege.」/「Does NOT require TCC approval.」
  ——**那条「不需要 root/TCC」的说法本身是真的**，只是先前被安到了错误的来源上
  （见 §8.2）。
- 「Process muting APIs are not available and return `ES_RETURN_ERROR`.」

`es_sync_client(_:_:)`（12960 bytes，HTTP 200）逐字关键句：

- 「Place a sync marker at the back of the message queue... run block when it
  reaches the front.」「enqueuing is fully synchronous」
- 「**If the ES client is destroyed, all sync blocks are called.**」——**证实了
  仓库旧研究的告诫**：sync 回调完成在「真的追平了」与「client 被拆毁了」之间
  **有歧义**，必须对 client 本身做独立存活检查，才能把 sync 完成当作权威证明。
- 它是**消息顺序屏障，不是终止原语**，文档中没有任何 stop/kill/enforce 能力。

**它到底买到了什么**：ES 仍是观察 + 逐事件 AUTH，没有「把整个后代集合作为一个
单位终止」的批量原语，所以旧设计的 stop/sync 不动点循环**依然必需**。真正的进步是
**消除了竞态而非消除了循环**——成员集由内核实时推送（递归覆盖每次 fork/exec，
其余进程不可见），不再是 `proc_listchildpids`/kqueue 的采样快照，于是不动点循环
收敛的对象变成了权威且无竞态的成员集。

部署成本上也有真实降低：经典 ES client 惯例要打包成 System Extension（安装器 +
系统设置里的用户批准 + 通常 root）；descendants 变体这些全都不需要，直接在已持有
entitlement 的进程里调用即可。**但对 npm CLI 而言真正昂贵且不确定的那一环——
entitlement 的人工审批——没有任何变化。**

**(c) 新发现：信号授权问题，ES 的「不需要 root」解决不了。**

`es_process_t` 的 raw doc JSON 显示 `is_es_client` 与 `is_platform_binary` 是
**两个独立的布尔字段**。商业 EDR 依赖的 trusted-PID 内核级信号阻断自保机制，
关联的是 platform-binary / 正确安装的 System Extension 身份，**不是「持有
entitlement」本身**。第三方 Developer ID 签名的 npm 分发二进制**不是 platform
binary**。

实际后果：**若守护进程（权威）与 agent workload 同 UID——非特权 npm CLI 的常态
——workload 可以直接 `kill -9` 掉守护进程。** 要真正做到权威与 workload 的权限
分离，需要不同 UID，即用专用服务账户跑 LaunchDaemon，而写
`/Library/LaunchDaemons` **需要安装时的 root/管理员权限**；非特权替代品
LaunchAgent 与 workload 同 UID，等于没有隔离。

**所以：ES 调用本身不需要 root，但权威与 workload 之间真正的权限分离仍然需要
安装时 root**——除非接受 workload 能杀掉我们的守护进程。这印证并量化了仓库旧研究
那句「signal authorization or privilege separation is part of the design, not a
prompt convention」。

（该子项的推理链——第三方 ES-entitled 但非 System Extension 的进程不继承信号免疫
——研究 agent 标注为 reasoned-but-not-directly-confirmed，未找到明确证实或排除的
引用。）

### 5.4 macOS 上唯一务实的路线

若 agent CLI 可以跑 **Linux 构建版**，则 Virtualization.framework 的 Linux 客户机
路径是最强选项：真内核隔离、`VZSharedDirectory` + `VZVirtioFileSystemDeviceConfiguration`
（VirtioFS）让客户机能读写**真实宿主目录**，因此 agent 仍可编辑真实 host git
worktree；原子停止 = 原子递归终止；判空 = VM 状态；entitlement 自助。

**前置条件**：`claude -p` / `codex exec` 是否有可用的 Linux 构建，以及我们是否
接受在 macOS 上跑 Linux 版 agent。这是 0.3.0 macOS 研究应当首先回答的问题，
优先级高于 Endpoint Security。

## 6. 三平台汇总

| | Linux | Windows | macOS |
| --- | --- | --- | --- |
| **推荐主机制** | user ns + PID ns（已实现） | 不具名 Job Object（已实现） | Virtualization.framework + Linux 客户机（未实现） |
| 判据 1 包含 | ✅ 内核保证 | ✅ 结构性阻断 | ✅ VM 边界 |
| 判据 2 终止 | ✅ init 死 → 全 SIGKILL | ✅ 级联至嵌套 Job | ✅ 整机停止 |
| 判据 3 判空 | ✅ **内核回收顺序保证，免费** | ⚠️ **须同步查询确认，通知不保证送达** | ✅ VM 状态 |
| 判据 4 身份 | ⚠️ 无文件系统名，须自建句柄 | ❌ **结构性矛盾，最硬开放问题** | ⚠️ 自行簿记 |
| 判据 5 特权 | ✅ 非特权，但发行版可关 | ✅ **零成本，全 SKU** | ⚠️ 付费会员 + 签名 + 公证 + 原生二进制 |
| 主要风险 | **单一闸门：非特权 `CLONE_NEWUSER`** | 守护进程重启后无法重新附着 | 需 agent 的 Linux 构建 |

一个跨平台的观察：**三个平台的判据 4（替换安全身份）都是最弱的一项。** Linux 靠
自建 bind-mount 或 cgroup 路径，Windows 是结构性矛盾，macOS 要自行簿记。这不是
巧合——操作系统提供的包含原语大多绑定「创建者的生命周期」，而我们要的是
「作用域比创建者活得久，但创建者死了仍能被清理」，这两个诉求天然张力。
若将来要投入设计精力，这是三平台共享的那块硬骨头。

## 7. 对当前 Direction 决定的影响

本文不改变任何决定，但以下几条应当被后续 Change 消费：

1. **Linux primary（PID ns）设计得到一手来源确认**，`architecture-replan.md`
   的选择是对的。研究 agent 首轮的否定判断是错的（§8.2）。**并新增一条可直接
   落地的加固**：把 `CLONE_NEWCGROUP` 捆进现有的 `unshare` 调用（§3.5b），
   同一前提、多一个标志，堵上同 UID cgroup 迁移这个原本敞开的洞。这条应作为
   Linux provider 后续 review 波或 closure 的输入。
2. **broker 移交 0.3.0 的决定看起来更正确了**，而非更可疑：cgroup 路径本身有
   同 UID 迁移漏洞（§3.3），它从来就不是「更简单的替代」，而是需要额外特权
   才能成立的路线。§3.5 进一步说明，非特权下堵住该漏洞仍要回到 `CLONE_NEWUSER`，
   即回到我们已有的主机制——broker 的价值只在 `CLONE_NEWUSER` **不可用**的环境，
   这恰好就是它当初被设计出来服务的那一小类主机。范围判断前后一致。
3. **Windows provider 尚未 propose，§4.2 的三条应作为其 proposal 输入**，
   §4.3 的判据 4 矛盾应作为其显式开放问题而非隐含债务。
4. **0.3.0 的 macOS 研究应把 Virtualization.framework + Linux 客户机排在
   Endpoint Security 之前**——理由不再是「ES 存在性存疑」（已证实存在），而是：
   ES 需要 **Apple 人工审批**的 entitlement、macOS 27 **尚未正式发布**且 API 仍
   Beta、即便拿到也只有观察 + 逐事件 AUTH 而无批量终止、且权限分离仍需安装时
   root（§5.3b/c）。相比之下 Virtualization 的 entitlement 自助、今天就能做。
5. ~~`architecture-replan.md` 的 ES API 引用需要复验~~ —— **已复验，引用成立**
   （§5.3b）。该文对 `es_new_descendants_client`、`es_sync_client` 及 sync 完成
   歧义的描述，与 Apple 官方 DocC 原始数据逐字一致。**先前我提出的存疑作废。**
6. **`es_new_descendants_client` 的「不需要 root/TCC」是真的，但不改变结论**：
   审批门在 entitlement 上，不在 root 上。同时新增一条此前未记录的约束——
   同 UID 下 workload 可直接杀掉守护进程，真正的权限分离需要安装时 root
   （§5.3c）。这一条应写进 0.3.0 macOS 研究的输入。

## 8. 可信度分级与方法论

### 8.1 分级

- **【一手·主 agent 核实】** §3.2 PID namespace 保证、§3.3 cgroup 委派containment
  规则、§3.4 `cgroup.kill`/`populated` 语义——由主 agent 直接拉取 man7.org 与
  kernel.org 原文核对。
- **【一手·研究 agent 实时拉取】** §4 全部 Microsoft Learn 引文、§5.3a XNU 源码
  注释、§5.1/§5.2 Apple DocC entitlement 与 API 列表、Apple `container` README。
- **【一手·主 agent 核实（二轮）】** §3.5 的 `CLONE_NEWCGROUP`/`CLONE_NEWPID` 需
  `CAP_SYS_ADMIN`、`CLONE_NEWUSER` 自 Linux 3.8 起免特权、`CLONE_INTO_CGROUP` 仍
  受 cgroups(7) 常规限制——均由主 agent 直接拉取 `clone(2)` 原文核对。
- **【一手·主 agent raw curl 字节核实（三轮）】** §3.5 的 namespace 委派 `-ENOENT`
  可达性规则——主 agent 以 `curl` 取 `docs.kernel.org` 原始 HTML（167KB）后自行
  剥标签提取 `Delegation Containment` 全节，未经任何摘要模型；systemd 的
  `nsdelegate,memory_recursiveprot` 无条件挂载表项——`curl` 取 systemd 仓库
  `src/shared/mount-setup.c` 原始源码，命中第 203 行。**这一档与 macOS 的
  raw curl 核实同级，是本文可信度最高的证据。**
- **【二手/待复核】** §3.6 发行版状态（部分来自邮件列表与社区）；§3.2b 的内核回收
  顺序保证（来源为 lkml 提交说明，非 man page，未经主 agent 独立复核）；
  §3.5 中 systemd 默认以 `nsdelegate` 挂载的说法（研究 agent 结论，未复核版本阈值）。
- **【一手·raw curl 字节核实】** §5.3b 全部 ES 引文——研究 agent 二轮绕过搜索引擎
  综合与 WebFetch 摘要模型，直接 `curl` Apple DocC JSON 数据 API 取原始字节
  （`es_new_descendants_client` 13567 bytes / `es_sync_client` 12960 bytes /
  `es_process_t` 字段，均 HTTP 200）。这是本文可信度最高的一档。
- **【UNVERIFIED】** Windows keeper 进程模式；`PROC_THREAD_ATTRIBUTE_JOB_LIST`
  最低 build；WSL2 2026-07 cgroup 变更细节；systemd GUI 会话 `cpu` controller
  委派版本阈值；§5.3c 中「第三方 ES-entitled 但非 System Extension 的进程不继承
  trusted-PID 信号免疫」这一推理（未找到明确证实或排除的引用）。

### 8.2 本次调研捕获的两起事实错误（方法论产出）

**(a) 搜索引擎摘要「答案对、出处假」——比纯捏造更阴险的一种失效。**

多次 WebSearch 反复断言 `es_new_descendants_client`「不需要 TCC 批准、不需要
root」，并把该说法与一条实际讲 `bootstrap_check_in`/`bootstrap_look_up` 的推文
焊接在一起；另一次则把它归因于几条实际在讨论 `es_new_client` 错误码的 Apple
开发者论坛帖。主 agent 打开原推文发现主题完全不同；macOS 研究 agent 在不知情下
**独立复现了同一起错误归因**。

**结局是这个案例最值得记住的地方：那条说法本身是真的。** 第二轮用 raw `curl`
拉 Apple DocC JSON 原始字节后，「Does NOT require root privilege / Does NOT
require TCC approval」逐字出现在 Apple 官方文档里（§5.3b）。

所以真正的失效模式不是「编了个假结论」，而是**「给一个正确结论配了假出处」**。
这比纯捏造更难防：结论经得起后续验证，于是审阅者容易顺势接受它的来源链。
**教训：一个听起来正确的综合，永远不能替代一份亲手取回的一手文档。**

**(a2) 我据此一度做出的错误判断，也记录在案。** 首轮因查询公开 Client 主题组
列表未见这两个 API，我在文档中写下「存在性存疑」并**质疑了仓库
`architecture-replan.md` 的引用**。该判断是错的——Beta API 本就不进公开主题组
列表。已于 §5.3b 更正并为原引用平反。**「没搜到」不等于「不存在」，把检索失败
当成否证是我这一轮犯的错。**

**(b) 研究 agent 自身的错误判定。** Linux agent 首轮将 user+PID namespace 判为
判据 1、2 均 ❌，理由是「不是原子操作」。该判断与 `pid_namespaces(7)` 明文矛盾；
若采信，会错误否定我们已实现并已通过 review 的 Linux 设计。同一份报告还把
cgroup 判据 1 判为 ✅，而其自身给出的理由（「写入调用者有权限的
`cgroup.procs`」）恰恰承认了同 UID 逃逸。已退回重做。

**教训：多 agent 调研必须逐条复核关键判定，不能整份采信。** 本文因此对每条
结论标注来源等级；凡未复核者一律显式标出，宁可留白不猜。

## 9. 未决与需要人拍板的

1. ~~`nsdelegate` + cgroup namespace 能否堵住同 UID 迁移~~ —— **已查清**（§3.5）：
   能堵住，但仍需 `CLONE_NEWUSER`，因而与主机制共用同一道闸门。**新的待办是：
   为非特权 `CLONE_NEWUSER` 这一道闸门设计 fail-closed 的类型化错误路径**，
   并区分 `EPERM`（LSM/sysctl 硬关闭）与 `ENOSPC`（`user.max_user_namespaces`
   耗尽，可重试）。这是 Linux 唯一能同时打掉主副两条机制的单点。
2. Windows 判据 4（durability vs 保证清理）的取舍，keeper 进程方案是否值得
   独立设计审查。
3. macOS：`claude -p` / `codex exec` 是否有可用 Linux 构建——决定 0.3.0 的
   Virtualization.framework 路线是否成立。**这是 macOS 唯一真正的阻断性未知，
   优先级高于任何 ES 相关问题。**
4. ~~`architecture-replan.md` 的 ES API 引用复验~~ —— **已完成，引用成立**（§5.3b）。
5. macOS 权限分离：是否接受「workload 可以杀掉守护进程」，还是要求安装时 root
   来跑专用 UID 的 LaunchDaemon（§5.3c）。这直接影响 macOS 是否还能维持
   「npm 分发、无安装器」的形态，需要产品决定，不是技术决定。
