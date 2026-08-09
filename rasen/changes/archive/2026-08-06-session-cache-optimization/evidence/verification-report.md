# Session Cache Optimization 当前完成内容与原计划对照

## 2026-08-03 Draft PR 发布补充

当前代码已合并发布时最新的 `origin/dev/0.2.0`，父级 3 个 portfolio
文件也已提交。受控冻结、提交树、远端分支与 Draft PR head 完全一致：

- 分支：`feat/session-cache-optimization`
- base：`dev/0.2.0`（发布时为 `a1306828a23b2c4adc0db81f92b09498a5e92710`）
- head：`ffc73fbb36f5f207d96278164fab8bed6536cd1e`
- Git tree：`acee4ad076ca205422c9eccd7d57adada49b3062`
- 候选内容指纹：`b6a5651eae7f21208393ee3d5a96b6119e621e17edaf4237e9efc1046edaddf4`
- Draft PR：[#133](https://github.com/DumoeDss/rasen/pull/133)
- GitHub 核验：`OPEN`、`Draft`、head/base 匹配、`MERGEABLE`

本次增加了受控的 E1 前审查通道：授权和发布分别写入两个不可变记录，
`acceptance-run-v2.json` 可在之后的 E1 finalization 中嵌入该发布记录；若
授权后没有完成发布、候选不一致、仓库不一致或 E2 不是同一个 PR head，
协议都会 fail closed。Draft PR 只供审查，不代表 E1、E2、E3 或 E4，且在
E1 前必须保持 Draft 和未合并。任何代码、head、base 集成或冻结树变化都要
重新冻结并重做 E1。

发布前验证：

- `pnpm run build`：通过；
- 合并冲突与 acceptance 范围 ESLint：通过；
- 合并影响集：11 个文件通过、185 个测试通过；唯一剩余项是受并发负载影响
  超过原 30 秒限制的受控 Git 集成测试；
- 上述集成测试设置显式 90 秒边界后单独复验：1 个测试通过（约 14.6 秒）；
- 同一合并影响集中 acceptance protocol：32 个测试通过；
- 合并前 protocol + parent-delivery：2 个文件、33 个测试通过；
- 分支差异 whitespace check：通过。

一次合并影响集的统一重跑超过了本地 180 秒命令包装上限，未报告断言失败，
结束后也没有残留测试进程；没有继续重复启动测试。真机 E1 仍按用户决定延期。
当前不会创建 `acceptance-run-v2.json`，也不会执行最终 E2 delivery 记录。

> 用途：供实现审查时按“原始目标 → 架构设计 → 代码实现 → 验证证据 → 未完成门禁”逐项核对。\
> 快照日期：2026-07-31\
> 工作树：`OpenSpec-code-ecp-review-cycle`\
> 分支：`feat/session-cache-optimization`\
> 代码基线：`v0.2.0` 之后的 P1 开工点 `d77f95ee4da8f3fd5968122981f8500f8bc8d502`\
> 当前 HEAD：`7a88040094a1a89cf4c70a3d79a493e40abb2921`

## 1. 结论先行

### 1.1 已完成

仓库内的 Session 缓存优化实现已完成，并按依赖顺序交付、复审和归档了六个子变更：

1. reusable host 生命周期；
2. durable registry 与恢复；
3. `rasen session` CLI / 管理 API；
4. daemon touch scheduler；
5. 集成验收协议、证据工具和架构文档；
6. 最终 E4 native-CI 判定不可达问题的修复。

最终主规格位于：

- `rasen/specs/session-host-lifecycle/spec.md`
- 共 33 个最终 Requirement；
- 共 146 个最终 Scenario。

六个归档子变更的任务清单合计：

- 已勾选：143 项；
- 历史未勾选：1 项；
- 该历史项是 acceptance child 的 Task 6.5“父级冻结”，它在 child 归档之后由受控父级入口完成，因此没有回写已经归档的 child 文件；当前外部 run-state 与冻结记录已绑定实际结果。

独立的非真机收口复审结果为：

`VERIFY VERDICT: CLEAN — Blocker: 0, Major: 0, Minor: 0, Trivial: 0`

这个 CLEAN 只说明仓库实现和非真机元数据闭环没有未解决发现，不表示物理时长观测、远端 CI 或最终归档已经完成。

### 1.2 尚未完成

剩余的是按固定顺序推进的四个外部门禁：

| 门禁 | 当前状态 | 内容 |
|---|---|---|
| E1 | Pending | 用户协调的真机 50/55/65 分钟物理观测 |
| E2 | Pending after E1 | 通过受控父级入口执行唯一一次 delivery |
| E3 | Pending after E2 | 对 E2 精确提交 SHA 运行并收集 native CI 五个必需 job |
| E4 | Pending after E1 + E3 | 最终 acceptance assertion、结果封存和父级归档 |

因此，“仓库内开发任务是否完成”的答案是 **是**；“整个 change 是否已经最终完成并可直接归档”的答案是 **否**。真机 E1 是下一步，但其后仍有 E2、E3、E4 自动化/交付门禁。

## 2. 审查时应采用的状态权威

### 2.1 父级是分解容器，不是普通单 change

父级目录：

`rasen/changes/session-cache-optimization/`

只包含：

- `.openspec.yaml`
- `planning-context.md`
- `decomposition-plan.md`

标准 `rasen status` / `instructions apply` 会因为父级没有普通 change 的 `proposal.md`、`design.md`、`tasks.md` 而显示 blocked。这里不是实现缺失，而是 `auto-decompose` 父级作为 portfolio planning container 的表现。

实现完成状态的权威来源依次是：

1. 外部 `portfolio-run.json`；
2. 六个已归档 child 的 proposal/design/spec/tasks；
3. 同步后的最终主规格；
4. 当前冻结记录；
5. 独立非真机复审报告。

不应为了让普通 change status 变绿而给父级补造一套重复的 proposal/design/tasks；那会形成第二套相互竞争的完成权威。

### 2.2 当前 portfolio 状态

`portfolio-run.json` 记录：

- pipeline：`auto-decompose`
- tier：`A`
- mode：`autonomous`
- 六个 child：全部 `done`
- delivery：`pending`
- candidate freeze：`ready_for_deferred_E1`
- non-physical closure：`clean`
- E1–E4：全部仍为 pending

## 3. 原始计划与证据起点

### 3.1 原始问题判断

原始设计没有把“Claude session id”当作缓存资产，而是把仍存活的 Claude `stream-json` 进程及其上下文当作可复用资产。

探针结论来自：

- `docs/experiments/session-cache-probe-results.md`
- `docs/session-execution-layer-design.md`
- `rasen/handoff/hybrid-session-workers-design.md`

关键事实是：

- 同 cwd 的 live host 在约 55 分钟仍能命中缓存；
- 约 65 分钟时已 miss，说明缓存窗口上界接近 1 小时；
- live host 所在 worktree 发生普通仓库变化不会立即破坏热缓存；
- fork 不继承父 host 的热缓存；
- 并发 resume 可能两次计费但丢失其中一轮，因此必须在 CLI/协调层实现同 session single-flight；
- subagent 完成通知并不可靠，持久结果不能依赖通知到达；
- Windows 上探针曾暴露短暂文件锁冲突，registry 写入需要 bounded retry-on-lock 和安全替换。

### 3.2 原设计分期

原设计 `docs/session-execution-layer-design.md` 分为：

- P0：探针与设计；
- P1：SessionHost + durable registry + CLI + daemon touch scheduler；
- P2：ReviewCycle dogfood、执行层接线和 worker 生命周期所有权移交。

本 portfolio 的实现范围是：

- 完成 P1；
- 增加完整 acceptance/evidence 层；
- 填充架构文档预留的 session execution layer 边界；
- 修复验收协议中后来发现的 E4 不可达条件。

明确未纳入本 portfolio 的范围是：

- P2 ReviewCycle dogfood；
- 修改 `src/core/change-run/**`；
- 修改 `src/core/pipeline-registry/**`；
- 将 ops/reconciler 中更广泛的 worker 生命周期所有权整体迁移到 executor；
- 把 `auto-decompose` 改造成 reconciler 支持的 execution profile。

这不是遗漏，而是原分期和各 child ownership manifest 中持续保持的边界。验收只要求六个 reconciler 已支持的内建 pipeline，并要求 `auto-decompose` 继续 fail-closed。

### 3.3 P1 原始验收门槛

原始 P1 gate 要求：

- create → 多次 wake → touch → retire 完整生命周期；
- 并发 wake 立即拒绝；
- retired session 后续 wake 拒绝；
- durable registry 与真实 transcript 一致；
- host 丢失后能够在同 canonical cwd 恢复；
- daemon 不在线时正确性仍成立；
- 真实约 50 分钟 touch、55 分钟 hit、65 分钟 miss；
- exact-tree Windows/POSIX 交付证据。

当前状态：

- 仓库内的生命周期、并发、恢复、daemon-off、协议和测试实现均已完成；
- 真实 50/55/65 分钟观测与 exact-SHA native CI 尚待 E1–E3。

## 4. 分解计划与实际交付 DAG

原 decomposition plan 的五个 child：

```text
host-lifecycle
      |
registry-recovery
      |
      +--------------------+
      |                    |
cli-surface        touch-scheduler
      |                    |
      +----------+---------+
                 |
       acceptance-evidence
```

实现后因独立复审发现 E4 的 native-Linux 证明条件不可达，追加了第六个 bug-fix child：

```text
acceptance-evidence
        |
final-acceptance-ci-proof
```

各 child 的实际结果：

| Child | 原计划角色 | 实际结果 | Ship commit | Archive/spec-sync commit |
|---|---|---|---|---|
| host-lifecycle | reusable live host 基础 | 完成并归档 | `727e39cc` | `11a4b0fc` |
| registry-recovery | durable identity、锁、恢复 | 完成并归档 | `ab37eaa1` | `f5b39ab` |
| cli-surface | CLI、HTTP、owner 选择 | 完成并归档 | `5fd15cc8` | `8f8fab4d` |
| touch-scheduler | daemon 定时刷新策略 | 完成并归档 | `5465e229` | `2551baed` |
| acceptance-evidence | 集成、物理/CI 证据协议、架构文档 | 完成并归档 | `8f0d3766` | `087417a9` |
| final-acceptance-ci-proof | 修复 E4 不可达条件 | 完成、复审 CLEAN、归档 | `52b53aa6` | `7a880400` |

## 5. 交付后的整体架构

### 5.1 组件与调用关系

```text
Canonical Run + active/granted Action
                 |
                 v
       rasen session exec/list/retire
                 |
       +---------+----------+
       |                    |
 resident daemon      foreground owner
 loopback bearer API  （只允许在请求 admission 前 fallback）
       |                    |
       +---------+----------+
                 |
      ReusableSessionService
                 |
      SessionHostCoordinator
        |                 |
        |                 +--> durable registry
        |                      sessions.json
        |                      mutation lock
        |                      per-session wake lease
        |
        +--> existing SessionSupervisor
                 |
          live Claude stream-json host
          stdin multi-turn / stdout NDJSON
                 |
          exact turn result + transcript

daemon SessionTouchScheduler
        |
        +--> 同一个 loopback API
             同一个 coordinator
             同一个 durable single-flight

acceptance/evidence plane
        |
        +--> immutable attempt directories
        +--> physical checkpoints/results
        +--> exact-tree freeze
        +--> exact-SHA CI evidence
        +--> final assertion
```

### 5.2 最重要的架构决策

1. **复用既有 supervisor，而不是新建平行子系统。**\
   reusable host 扩展在 `src/core/management-api/supervisor.ts`；没有新增原先一度设想的 `src/core/session-host/`。

2. **同一个 coordinator 是正确性边界。**\
   CLI 与 scheduler 都必须经过 durable coordinator，不能各自实现恢复、锁或幂等。

3. **daemon 只影响缓存效率，不影响正确性。**\
   daemon 存在时使用 resident owner；daemon 明确不存在时，CLI 可在 admission 前选择 foreground owner。请求一旦可能被 daemon 接纳，传输不确定就不能切换 owner 重放。

4. **长操作和短持久化锁分离。**\
   registry mutation lock 只保护短事务；同 session 的长 wake 用独立 lease，避免一次模型调用长期占用全 run registry 锁。

5. **ambiguous delivery 绝不自动 replay。**\
   如果 stdin 接纳边界之后 owner/transport 丢失，记录 `delivery_uncertain`。宁可要求人工/调用者消歧，也不冒险重复执行。

6. **恢复依据不是 PID。**\
   恢复会重新证明 canonical run/cwd、owner、host、Claude session 和 exact transcript；PID 单独不能作为当前 owner 身份。

7. **物理证据与仓库逻辑证据分离。**\
   fake clock 证明调度逻辑，真实 50/55/65 分钟才证明缓存经济性；本地 injected POSIX 不是 native Linux，native 证明只能来自 exact-SHA CI。

### 5.3 架构文档已更新的边界

`docs/architecture/executable-composite-pipelines.md` 已补充：

- reconciler 只授予 canonical action，不直接运行 agent/session；
- session execution layer 只接受 exact active + granted action；
- live `stream-json` 进程、恢复、retire、dispatch fence 和 single-flight 属于 session execution layer；
- authored policy 与 frozen action 是真实策略来源，历史 placeholder 值不是 operator 选择；
- daemon scheduler 解释 cadence/cold/deadline；
- durable registry 保存 logical session、digest-only 结果引用和 admission 状态；
- daemon 失效只能降低 cache efficiency，不能破坏正确性。

## 6. 子系统一：Reusable Host 生命周期

### 6.1 计划目标

- 创建固定 cwd 的 live Claude `stream-json` 进程；
- 通过 stdin/stdout 支持多轮 wake；
- 一次接受的 message 对应一个完整结果；
- 同 host single-flight；
- host 丢失时只在安全边界恢复；
- retire 幂等且终态；
- 不破坏原有 one-shot management session。

### 6.2 设计决策

- 在既有 supervisor 中增加 host mode；
- 启动后清除 one-shot 的 idle watchdog，由 turn 级 deadline 管理 wake；
- 增量读取 NDJSON，只完成当前 turn 对应结果；
- process-local admission 同步完成，重叠 wake 立即结构化拒绝；
- 仅在“确定尚未交付”时透明恢复；
- 已接纳但交付边界不确定时返回 `delivery_uncertain`；
- retirement 是 terminal transition，重复 retire 成功但不复活；
- host 与 one-shot 共用并发容量、tree-kill、Windows shim 安全和 shutdown 所有权。

### 6.3 实现落点

主文件：

- `src/core/management-api/supervisor.ts`

主要结构：

- host state/type：约第 76–167 行；
- `createSessionSupervisor`：约第 385 行；
- live `stream-json` argv：约第 553 行；
- host turn / busy / recovery / retire：约第 944–1141 行；
- recovery 继续使用 captured Claude session；
- 旧的 one-shot API 保持兼容。

测试：

- `test/core/management-api/supervisor-host-lifecycle.test.ts`
- `test/core/management-api/supervisor-host-windows.test.ts`
- `test/fixtures/management-api/session-fake-cli.mjs`

### 6.4 与计划对照

| 原计划 | 实际 |
|---|---|
| 新增可复用 live host | 已实现 |
| 多轮 stdin/stdout | 已实现 |
| host single-flight | 已实现 |
| pre-delivery loss 可恢复 | 已实现 |
| ambiguous delivery 不重放 | 已实现 |
| retire terminal/idempotent | 已实现 |
| 保持 one-shot 行为 | 已实现并有兼容测试 |
| 新建 `src/core/session-host/` | 最终设计明确取消，实际复用 supervisor |

## 7. 子系统二：Durable Registry、恢复与跨进程 Admission

### 7.1 计划目标

- logical session 跨 owner/daemon 重启持久存在；
- canonical run/cwd 绑定且 fail-closed；
- registry 原子写入；
- 跨进程 same-session single-flight；
- bounded wake history 与稳定 idempotency；
- owner 丢失时以真实 transcript 恢复；
- corrupt/stale 状态不能猜测性继续。

### 7.2 持久模型

主文件：

- `src/core/management-api/durable-session-registry.ts`
- `src/core/management-api/session-registry.ts`（兼容导出/接线）

核心 schema：

- `DURABLE_SESSION_REGISTRY_SCHEMA = "rasen-session-registry/1"`
- 每个 canonical run 旁保存 `sessions.json`
- mutation lock：`sessions.json.lock`
- per-session wake lease：`session-wake-locks/`

每条 session record 包括：

- `sessionKey`
- role/action/node/invocation identity
- `hostKind: "stream-json"`
- immutable canonical `cwd`
- attached roots / session space
- runtime execution reference
- model / effort
- Claude session id
- lifecycle status
- current owner binding
- touch policy
- current dispatch fence
- idempotency tombstones
- bounded terminal wake records

隐私与容量边界：

- durable message id 只保存 domain-separated SHA-256 digest，不保存原始 id；
- terminal presentation history 上限 64；
- non-evicting idempotency tombstone 上限 4096；
- 达到不能安全继续的容量边界时 fail-closed，而不是丢失重复检测。

### 7.3 锁与原子性

实现把两个并发问题分开：

- registry mutation lock：保护加载、revision 检查、原子替换等短事务；
- wake lease：保护一个 logical session 的整个长 wake。

Windows/POSIX 写入策略：

- 临时文件写入；
- 安全 replace；
- Windows `EPERM` / `EACCES` / `EBUSY` 使用有界预算重试；
- 不以非原子截断覆盖作为回退；
- owner-aware lock 防止仅凭过期 PID 误判。

### 7.4 Coordinator

`createSessionHostCoordinator` 位于：

- `src/core/management-api/durable-session-registry.ts` 约第 2198 行

它统一负责：

- register；
- list；
- wake admission；
- dispatch fence；
- duplicate 判定；
- exact transcript 对账；
- lost host recovery；
- conditional scheduler wake；
- retire；
- shutdown/reconcile。

安全恢复规则：

- 当前 owner 有真实 in-memory handle 才可直接继续；
- owner 丢失后重新证明 canonical path 和 transcript；
- 已完成结果通过 digest/reference 对账；
- pre-delivery failure 可重新启动 host；
- dispatch 后的不确定状态终止为 `delivery_uncertain`；
- stale、corrupt、run mismatch、cwd mismatch 全部 fail-closed。

### 7.5 测试

- `test/core/management-api/session-registry-recovery.test.ts`
- `test/core/management-api/session-registry-concurrency.test.ts`
- `test/core/management-api/session-registry.test.ts`
- `test/fixtures/management-api/session-registry-lock-holder.mjs`

### 7.6 与计划对照

| 原计划 | 实际 |
|---|---|
| per-run versioned registry | 已实现 |
| canonical cwd 不可漂移 | 已实现 |
| atomic cross-process mutation | 已实现 |
| retry-on-lock | 已实现 |
| same-session wake lease | 已实现 |
| durable dispatch fence | 已实现 |
| ambiguous delivery 不重放 | 已实现 |
| exact transcript recovery | 已实现 |
| PID-only recovery | 明确禁止 |
| CLI/scheduler 共用 coordinator | 已实现 |

## 8. 子系统三：CLI、管理 API 与 Owner 选择

### 8.1 对外命令

主文件：

- `src/commands/session.ts`
- `src/cli/index.ts`

新增命令：

```text
rasen session exec
rasen session list
rasen session retire
```

`exec` 支持：

- `--run`
- `--session`
- `--action <file|->`
- `--cwd`
- `--message-id`
- `--touch`
- `--touch-deadline`
- `--max-touches`
- `--deadline-action`
- `--json`

命令只接受 canonical run 下 exact active/granted action；不允许从任意 cwd、session key 或 registry 内容反推出授权。

### 8.2 管理 API

主文件：

- `src/core/management-api/wire-types.ts`
- `src/core/management-api/reusable-session-api.ts`
- `src/core/management-api/router.ts`
- `src/core/management-api/server.ts`

wire schema：

- `rasen-reusable-session-api/1`

路由：

- `GET /api/v1/reusable-sessions`
- `POST /api/v1/reusable-sessions/wake`
- `POST /api/v1/reusable-sessions/retire`
- `POST /api/v1/reusable-sessions/touch-policy`

服务层：

- 解码 bounded request；
- 验证 bearer/loopback owner 边界；
- 投影 durable result；
- 映射稳定 HTTP status；
- 缓存/复用每个 canonical run 的 coordinator；
- shutdown 时按 deadline 停止所有 owner。

### 8.3 Resident / Foreground Owner 规则

owner 选择遵循：

1. daemon identity 明确、token/port 可验证时走 resident daemon；
2. daemon 明确不存在时，命令可在 admission 前创建 foreground owner；
3. daemon 身份模糊、响应越过 admission 边界后丢失、或 transport outcome 不确定时，不允许 fallback 重放；
4. foreground 与 resident 都调用同一个 service/coordinator contract。

因此 daemon down 不会让正确性依赖失效；它只让 session 不能被后台自动 touch，或让一次 CLI 自己暂时持有 owner。

### 8.4 稳定输出与退出码

CLI 同时提供人类输出和 JSON envelope。

退出码映射：

| Exit | 类别 |
|---|---|
| 0 | 成功或确定性 duplicate-success |
| 1 | 普通内部/基础设施失败，或 duplicate `pre_delivery_failed` |
| 2 | invalid request/action/run/identity/transition |
| 3 | busy、lock timeout、idempotency capacity exhaustion |
| 4 | session/host absent、retired、stale、unrecoverable |
| 5 | transport/delivery uncertain、turn/no-output timeout |

### 8.5 本地化与 completion

已更新：

- `src/locales/en.json`
- `src/locales/ja.json`
- `src/locales/zh-cn.json`
- `src/core/completions/command-registry.ts`

三种语言拥有完整 help、示例和结果文案；completion 使用结构值，不把自由文本或运行时 identity 填进静态候选。

### 8.6 测试

- `test/commands/session.test.ts`
- `test/commands/session-e2e.test.ts`
- `test/core/management-api/reusable-session-api.test.ts`
- `test/core/management-api/reusable-session-routes.test.ts`
- `test/core/management-api/daemon-probe.test.ts`
- `test/core/completions/command-registry.test.ts`

## 9. 子系统四：Daemon Touch Scheduler

### 9.1 策略常量

主文件：

- `src/core/management-api/session-touch-scheduler.ts`
- `src/commands/daemon.ts`

当前生产常量：

| 常量 | 值 | 含义 |
|---|---:|---|
| touch cadence | 50 分钟 | 正常 refresh 目标 |
| cold gap | 60 分钟 | 超过后不再把普通 touch 当作有效保温 |
| scan interval | 1 分钟 | scheduler 扫描周期 |
| backoff base | 1 分钟 | 每 session 初始失败退避 |
| backoff max | 10 分钟 | 每 session 最大退避 |
| request timeout | 4 秒 | loopback 请求预算 |
| stop drain | 5 秒 | daemon shutdown drain |

touch prompt 固定为只回复 `OK` 且不得使用工具，降低刷新 turn 的副作用与上下文噪音。

### 9.2 分类与动作

纯分类器综合：

- touch mode；
- `lastWakeAt`；
- persisted deadline；
- maxTouches / touchesUsed；
- deadlineAction；
- backoff；
- owner/session 状态；
- conditional expected-last-wake。

动作包括：

- not eligible / wait；
- touch；
- deadline stop；
- deadline retire-silent；
- exhaustion；
- cold-gap handling；
- bounded retry。

deadline 优先于 cold 判定，防止已经到期的 session 因分类顺序而逃逸终态动作。

### 9.3 因果与幂等

- stable touch message id 由 session + touch ordinal/attempt 导出；
- restart 或 response loss 不会生成一个看似全新的逻辑 touch；
- 每次 touch 经过正式 reusable-session API；
- coordinator 用 conditional `expectedLastWakeAt` 防止交互 wake 与 scheduler stale decision 竞态；
- scheduler 与用户 wake 共享 durable single-flight；
- 不直接改 registry 伪造成功。

### 9.4 Daemon 生命周期

daemon 启动时创建 scheduler，shutdown 时：

- 停止新 scan；
- drain 已开始请求；
- 在有界时间内停止 scheduler/service/supervisor；
- 失败会明确记录，而不是无限等待；
- restart 后从 durable policy 重建，不依赖内存 timer 连续性；
- clock backward/forward 使用保守分类。

### 9.5 测试

- `test/core/management-api/session-touch-scheduler.test.ts`
- `test/commands/daemon-touch-scheduler.test.ts`

## 10. 子系统五：Acceptance 与 Evidence Protocol

### 10.1 为什么它不只是“几个测试”

这一层承担的是 exact-tree acceptance protocol：

- 把本地逻辑证据、真机时长证据、交付 SHA 和 native CI 串成一条可审计链；
- 防止旧 attempt 的结果被静默继承到新候选；
- 防止为了记录证据又修改仓库，从而让被证明 SHA 失效；
- 防止 fake-clock 或 injected POSIX 被误标成真实缓存/native Linux 证据；
- 在最终 assertion 时重新验证依赖，不只相信早先写下的 summary。

### 10.2 主要实现

目录：

- `scripts/session-cache-acceptance/`
- `test/acceptance/session-cache/`

核心文件：

| 文件 | 作用 |
|---|---|
| `protocol.mjs` | schema、attempt、checkpoint、result、reuse、CI、final assertion |
| `observation-harness.mjs` | 物理时钟/观测分类与 arm 执行 |
| `launch-physical.mjs` | 创建不可变物理 attempt |
| `observe.mjs` | 单 arm observer |
| `prepare-physical.mjs` | 物理前置准备 |
| `physical-preflight.mjs` | 环境、候选、路径和进程前置检查 |
| `transcript-usage.mjs` | exact transcript usage、digest 和 scheduler 因果提取 |
| `delivery-candidate.mjs` | candidate identity 与 tracked-tree 检查 |
| `parent-delivery.mjs` | freeze、E1 finalize、authorize、delivery record |
| `ci-evidence.mjs` | exact-SHA workflow/job 证据 |
| `ownership-audit.mjs` | ownership/delivery manifest 审计 |
| `rasen-cli-driver.mjs` | 通过真实 CLI/API path 驱动验收 |

### 10.3 三个物理 arm

固定 arm：

1. `control-hit-55m`
2. `control-miss-65m`
3. `scheduler-cadence-deadline`

判定要求包括：

- context baseline 至少 30k；
- 55 分钟 control 应证明 HIT；
- 65 分钟 control 应证明 MISS；
- scheduler cadence 允许误差由 immutable constants 限定为 5 分钟；
- deadline application 允许误差由 immutable constants 限定为 10 分钟；
- scheduler 结果必须绑定真实 transcript、durable wake record、preterminal owner history 和 terminal owner absence/reason。

fake clock 只能证明分类和状态机，不得替代上述物理 arm。

### 10.4 Immutable Attempt Protocol

每次 launch 创建新的 content-addressed 或 UUID attempt generation：

- launcher 只写自己的 intent/summary；
- 各 observer 只写自己的 arm 目录；
- observer 不写 canonical acceptance ledger；
- 旧 attempt 不删除、不覆盖、不改名成成功；
- control arm 只有在 bounded validation 后才能复制/引用到新候选；
- scheduler arm 禁止跨 attempt reuse；
- canonical `acceptance-run-v2.json` 只能由受控 E1 finalizer 创建或做 exact-idempotent 验证；
- legacy `acceptance-run.json` 保留，不被偷偷升级为 v2。

### 10.5 Pipeline 支持边界

集成验收覆盖六个 reconciler-supported pipeline：

- `bug-fix`
- `small-feature`
- `full-feature`
- `goal-loop-measure`
- `goal-loop-evaluate`
- `goal-loop-research`

`auto-decompose` 的预期结果是：

- `execution_profile_unavailable`
- fail-closed

这是当前架构设计，不应被当成 session-cache 回归。

### 10.6 E4 修复

独立复审发现原 final assertion 同时要求：

- 本地证据诚实记录 `localEvidence.nativeLinux: false`；
- final gate 又要求这个字段为 truthy；
- 即使 exact-SHA native Linux CI 已成功，也无法到达 E4 success。

第六个 child 修改：

- `scripts/session-cache-acceptance/protocol.mjs` 约第 2605 行；
- `test/acceptance/session-cache/protocol.test.ts` 约第 1838–1979 行。

修复原则：

- 保留本地 evidence 的 `nativeLinux: false`；
- native Linux 权威只来自 `ciState = successful`；
- 必须存在当前 exact delivered SHA 的五个严格 job record；
- pending、缺 job、stale、provenance mismatch 仍不能关闭 E4；
- 不把 injected POSIX 重命名成 native proof。

这次修复改变了候选树，因此旧 freeze 被保留为 superseded history，并生成了当前新 freeze。

## 11. Cross-cutting 正确性与安全不变量

审查实现时，以下不变量比单个 API 的表面行为更重要。

### 11.1 授权与 identity

- 只从 canonical run 选择 active/granted action；
- session key 不能反向授予任意 cwd/action；
- canonical cwd 创建时绑定，后续必须重新证明；
- run id、run path 和 registry document 必须一致；
- wire request 使用版本化、bounded schema。

### 11.2 单次执行与不重放

- host 内同一时间最多一个 wake；
- durable logical session 跨进程最多一个 wake lease；
- message id 使用 durable digest；
- dispatch 前失败可安全重试；
- dispatch 后不确定必须 `delivery_uncertain`；
- duplicate 根据 terminal durable outcome 返回，不重新执行。

### 11.3 进程所有权

- active owner 需要 instance identity + PID + host id + child PID；
- PID 不单独代表所有权；
- supervisor 负责 process tree；
- shutdown 有明确 deadline；
- daemon identity 模糊时 fail-closed；
- foreground fallback 只能发生在 admission 前。

### 11.4 数据完整性

- registry revisioned；
- mutation 原子 replace；
- 锁有 bounded retry/timeout；
- terminal history 有上限；
- idempotency capacity 满时拒绝新 admission，不驱逐仍需防重的 tombstone；
- exact transcript 用来确认实际结果；
- acceptance result/checkpoint/CI evidence 都绑定 candidate identity。

### 11.5 平台边界

- Windows `.cmd` / tree-kill / replace contention 单独覆盖；
- injected POSIX 只算本地兼容证据；
- native Linux 与 Windows PowerShell shard 必须由 exact-SHA CI 提供；
- 当前尚未把 native CI 误报为已完成。

## 12. 规格、任务和归档完成度

### 12.1 六个归档 child

| Child | Checked tasks | Open tasks | Delta requirements | Delta scenarios |
|---|---:|---:|---:|---:|
| host-lifecycle | 15 | 0 | 6 | 22 |
| registry-recovery | 32 | 0 | 8 | 31 |
| touch-scheduler | 23 | 0 | 6 | 26 |
| cli-surface | 33 | 0 | 6 | 27 |
| acceptance-evidence | 32 | 1（历史 parent freeze 项） | 7 | 38 |
| final-acceptance-ci-proof | 8 | 0 | 1 | 11 |
| **合计** | **143** | **1** | **34** | **155** |

归档 delta 的 requirement/scenario 数不能直接当作最终唯一规格数相加，因为后续 child 会修改、替代前一个 child 已定义的同一 capability。同步后的最终主规格才是最终权威：

- 33 requirements
- 146 scenarios

### 12.2 历史未勾选 Task 6.5 的解释

归档文件中仍可看到：

> Parent freeze pending: through the controlled parent finalize/freeze entrypoint...

它没有被回写勾选，原因是：

1. child 在父级冻结前已归档；
2. 归档内容保持不可变；
3. 父级随后通过受控 freeze 入口完成实际操作；
4. `portfolio-run.json`、acceptance external run-state 和 `candidate-freeze-summary.md` 已记录当前 freeze；
5. non-physical closure review 已复核 child 状态图为 terminal。

因此这是一条“历史清单未回写”的可解释差异，不是当前尚未实现的代码任务。

## 13. 已执行的验证证据

本节记录各阶段已经执行过的证据；编写本报告时没有重新运行测试。

### 13.1 Host

- focused host lifecycle：19 passed；
- full suite 当时结果：398/399 test files；
- 6412 passed；
- 33 skipped；
- 1 个已知、与本变更无关的 baseline failure。

结论：host slice 的 focused evidence 通过，但不能把那次根套件描述为 100% clean。

### 13.2 Registry

- recovery + concurrency：43 passed；
- host integration：20 passed；
- compatibility：101 passed，1 skipped；
- native POSIX 最终权威仍留给 portfolio CI gate。

### 13.3 CLI / API

- 最终 focused round：5 files / 56 tests；
- 更早的 broader focused round：24 files / 331 tests；
- scoped lint、strict typecheck、build 均通过。

### 13.4 Scheduler

- scheduler core + daemon integration：2 files / 28 tests；
- affected focused group：5 files / 31 tests；
- CLI seam：11 tests；
- scoped lint、strict typecheck、build 均通过。

### 13.5 Acceptance / E4

- `physical-readiness.test.ts`：39/39；
- E4 修复后的 `protocol.test.ts`：31/31；
- lifecycle / pipeline binding focused coverage 已通过；
- 一次 combined acceptance run 为 76/77，唯一失败是 Windows temp rename `EPERM`；
- 该失败测试单独重跑通过，因此记录为环境性锁冲突，而不是隐瞒为全套 clean；
- E4 修复后的 syntax、scoped ESLint、strict validation 通过；
- E4 独立复审：CLEAN 0/0/0/0。

### 13.6 Build

- `pnpm build` 在最终 E4 一行 assertion 修复之前通过；
- E4 修复后没有重新跑完整 build；
- E4 修改仅涉及 `.mjs` assertion 和对应测试，不涉及 TypeScript 产物；
- 已执行 syntax、focused test、scoped lint、strict validation。

### 13.7 非真机最终复审

报告：

`nonphysical-closure-review.md`

结果：

- Blocker: 0
- Major: 0
- Minor: 0
- Trivial: 0

它还确认：

- acceptance child 的 apply/propose/verify/review/ship/archive 状态都已 terminal；
- E4 fix 的 ship/archive provenance 已绑定；
- current fingerprint/tree 已绑定；
- 先前两条 metadata finding 已解决；
- E1–E4 仍未被误报为通过。

## 14. 代码规模与审查解释

从 P1 开工点 `d77f95ee` 到当前 HEAD：

- 85 files changed；
- 33,220 insertions；
- 62 deletions。

当前 staged parent planning container 再增加：

- 3 files；
- 274 insertions。

因此从开工点到当前 frozen index 共：

- 88 files；
- 33,494 insertions；
- 62 deletions。

不要把 33k 行全部理解为 runtime：

- 大量内容是归档 proposal/design/spec/tasks；
- acceptance harness/protocol 本身占数千行；
- acceptance 和 management API 测试占很大比例；
- 三种 locale 文案分别增加；
- 真正产品运行时集中在 supervisor、durable registry、service/API、CLI 和 scheduler。

## 15. 当前冻结候选

当前 candidate freeze：

| 字段 | 值 |
|---|---|
| Content fingerprint | `5cf86d9669173b049a7bd4fc9bae5e5dc4572284026aee331ef239d0d58c1a28` |
| Binary fingerprint | `9cff121471ab4defe9c7fe4ae6ff912aaf8ac8fd0f6d0880fa7c330109ed9b6b` |
| Baseline SHA | `7a88040094a1a89cf4c70a3d79a493e40abb2921` |
| Candidate/index tree OID | `bcc1fecf5e41be9d3dec4299d353120c7918a55b` |
| Freeze SHA-256 | `2fe00eb5c273c4450fedf61ed10625cc588221d7d934f1bc54f00de27f3125cf` |
| Status | `ready_for_deferred_E1` |

frozen index 中最后三个 delivery path：

1. `rasen/changes/session-cache-optimization/.openspec.yaml`
2. `rasen/changes/session-cache-optimization/decomposition-plan.md`
3. `rasen/changes/session-cache-optimization/planning-context.md`

当前工作树还存在用户拥有的 untracked 文件：

- `packages/ui/package-lock.json`

它被显式排除在 candidate/delivery manifest 之外，未被修改、删除或暂存。

当前不存在：

- `physical/`
- `capacity-proof.json`
- `acceptance-run-v2.json`

这与尚未启动 E1 一致。

## 16. 已知差异、限制与非目标

### 16.1 原 registry proposal 文件名与实际文件名

早期 proposal 写的是：

`src/core/management-api/session-registry.ts`

实际主体落在：

`src/core/management-api/durable-session-registry.ts`

`session-registry.ts` 仅保留窄兼容职责。这个变化没有改变架构边界，反而把 process-local registry 与 durable registry 的职责区分得更清楚。

### 16.2 P2 未完成

本 change 没有声称完成：

- ReviewCycle dogfood；
- reconciler 对 `auto-decompose` 的 execution profile；
- ops playbook 中 worker lifecycle 所有权的全面迁移；
- `src/core/change-run/**` / `src/core/pipeline-registry/**` 接线。

如果审查依据是整个 `docs/session-execution-layer-design.md` 的 P0+P1+P2 全部内容，那么结论应是：

- P0：此前已完成；
- P1：本 portfolio 已实现；
- acceptance/architecture evidence：本 portfolio 已实现；
- P2：仍是后续切片。

### 16.3 尚无真实缓存经济性结果

当前仓库已具备并测试了物理协议，但没有生成真实：

- 50 分钟 scheduler arm；
- 55 分钟 HIT control；
- 65 分钟 MISS control。

因此不能从当前状态宣称“真实生产环境中节省了多少 token/费用”，只能宣称：

- 探针此前证明了缓存窗口假设；
- 产品实现和验收协议已完成；
- 当前候选尚待重新进行物理验收。

### 16.4 尚无当前精确 SHA 的远端 CI 证明

本地 Windows/注入式 POSIX 测试不能替代：

- `linux-bash`
- `linux-bash-node24`
- 全部 Windows PowerShell shard

E3 必须在 E2 交付后对精确 SHA 收集五个 required job record。

## 17. 建议的人工审查顺序

### 第一轮：确认范围是否与原计划一致

1. `docs/session-execution-layer-design.md`
2. `rasen/handoff/hybrid-session-workers-design.md`
3. `rasen/changes/session-cache-optimization/planning-context.md`
4. `rasen/changes/session-cache-optimization/decomposition-plan.md`

重点确认：

- 本次是 P1，不是 P2；
- 不新增平行 session-host 子系统；
- 不修改 change-run/pipeline-registry；
- daemon 不是正确性依赖。

### 第二轮：审架构核心

1. `src/core/management-api/supervisor.ts`
2. `src/core/management-api/durable-session-registry.ts`
3. `src/core/management-api/reusable-session-api.ts`
4. `src/commands/session.ts`
5. `src/core/management-api/session-touch-scheduler.ts`
6. `src/commands/daemon.ts`

建议优先检查这些危险边界：

- dispatch fence 在 stdin delivery 前后如何变化；
- `delivery_uncertain` 是否可能被自动 replay；
- registry mutation lock 是否跨越长模型调用；
- wake lease 是否覆盖完整 same-session turn；
- owner identity 是否错误依赖 PID；
- foreground fallback 是否可能发生在 admission 后；
- scheduler 是否绕过 coordinator；
- retire 后是否存在复活路径。

### 第三轮：审 acceptance 是否会“伪造绿灯”

1. `scripts/session-cache-acceptance/protocol.mjs`
2. `scripts/session-cache-acceptance/parent-delivery.mjs`
3. `scripts/session-cache-acceptance/transcript-usage.mjs`
4. `scripts/session-cache-acceptance/physical-preflight.mjs`
5. `test/acceptance/session-cache/protocol.test.ts`
6. `test/acceptance/session-cache/physical-readiness.test.ts`

重点确认：

- attempt 是否不可变；
- scheduler arm 是否禁止复用；
- control reuse 是否有 bounded validation；
- `acceptance-run-v2.json` 是否只有 E1 finalizer 能写；
- exact-tree/fingerprint/SHA 是否贯穿；
- native Linux 是否只由 CI 权威提供；
- final assertion 是否重新检查 job 和本地 output hash。

### 第四轮：对规格逐项看测试

最终规格：

- `rasen/specs/session-host-lifecycle/spec.md`

按 requirement 对应测试文件：

| 规格段 | 主要测试 |
|---|---|
| host create/wake/busy/recovery/retire | `supervisor-host-*.test.ts` |
| durable identity/atomicity/recovery | `session-registry-*.test.ts` |
| CLI/API/owner/output | `session*.test.ts`, `reusable-session-*.test.ts` |
| touch/deadline/backoff/daemon | `session-touch-scheduler.test.ts`, `daemon-touch-scheduler.test.ts` |
| full lifecycle/pipeline/evidence | `test/acceptance/session-cache/*.test.ts` |

## 18. 审查判定

### 18.1 对“原计划中的 P1 是否实现”的判定

**实现完成。**

代码、设计、规格、测试、CLI、scheduler、durable recovery、acceptance protocol 和架构边界都已有实际落点；六个 child 已交付并归档；非真机复审无开放 finding。

### 18.2 对“整个 session execution layer 长期设计是否全部实现”的判定

**没有。**

原设计的 P2 ReviewCycle dogfood 和更广的 worker ownership transfer 明确不在本 portfolio 范围内。

### 18.3 对“当前 change 是否已经最终完成”的判定

**尚未。**

仓库内实现已完成，但 E1–E4 尚未关闭。当前最准确的状态是：

> Repository implementation complete; candidate frozen; non-physical review clean; deferred physical acceptance and exact-SHA delivery/CI/finalization pending.

## 19. 证据索引

仓库内：

- `docs/session-execution-layer-design.md`
- `docs/experiments/session-cache-probe-results.md`
- `rasen/handoff/hybrid-session-workers-design.md`
- `rasen/changes/session-cache-optimization/decomposition-plan.md`
- `rasen/changes/archive/2026-07-30-session-cache-optimization-host-lifecycle/`
- `rasen/changes/archive/2026-07-30-session-cache-optimization-registry-recovery/`
- `rasen/changes/archive/2026-07-30-session-cache-optimization-touch-scheduler/`
- `rasen/changes/archive/2026-07-31-session-cache-optimization-cli-surface/`
- `rasen/changes/archive/2026-07-31-session-cache-optimization-acceptance-evidence/`
- `rasen/changes/archive/2026-07-31-session-cache-optimization-final-acceptance-ci-proof/`
- `rasen/specs/session-host-lifecycle/spec.md`
- `docs/architecture/executable-composite-pipelines.md`

仓库外 canonical workDir：

- `portfolio-run.json`
- `candidate-freeze-summary.md`
- `nonphysical-closure-review.md`
- `deferred-physical-test-plan.md`
- `portfolio-resume-audit.md`

---

最终状态标签：

`IMPLEMENTATION_COMPLETE / NONPHYSICAL_CLEAN / CANDIDATE_FROZEN / E1_E2_E3_E4_PENDING`
