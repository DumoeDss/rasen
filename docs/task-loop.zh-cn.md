# Task Loop(`task-loop`)

Task Loop 是 Rasen 的**显式选择、无 spec 的自治 pipeline**,用于小型、直接的实现工作。它在你*真实的*产物上,针对一份冻结的、有证据支撑的质量门槛,跑一轮角色分离的 builder/critic 循环,并且只在门槛被机械地满足后才 ship——不生成 spec-driven pipeline 那套 proposal/design/spec/task 产物。

> 当你希望一个改动被对照 spec 和 design 审查时,用 `small-feature`、`bug-fix` 或 `full-feature`。
> 当工作是一个聚焦的实现任务,而 spec 流程本身的成本超过工作时,用 `task-loop`。

## 何时用——以及何时不用

**适合用 `task-loop` 的**:聚焦、可直接验证的实现任务

- 修一个有可复现检查的具体缺陷。
- 实现一个小特性,其"完成"能表达为具体的、可检查的证据(一个通过的测试、一个渲染输出、一个度量、一个存在且行为正确的文件)。
- 带有可观察行为保持保证的重构。

**不适合用 `task-loop` 的**:确实需要设计稿和契约的工作

- *需求本身*在实现前需要被提出、评审或拆解的任何东西。
- 必须对照书面 spec/delta 评审的跨模块改动。
- "完成"无法被归约为"对照真实产物的可检查证据"的工作。

`task-loop` **永远不会被自动选中**。分类器不会建议它,默认仍是 `small-feature`,而一个终态的 `task-loop` 结果也永远不会被转换、升级或回退到某个 spec-driven pipeline。

## 启动一个 task loop

只有两种显式形式能选中它(两者等价):

```bash
rasen-auto task-loop <任务描述>
rasen-auto --pipeline task-loop <任务描述>
```

开头的 `task-loop` 选择 token(或 `--pipeline task-loop`)会被剥离,剩下的是任务描述。分类器不会被咨询,选择策略旗标(`--auto-select`、`--auto-compose`)也不起作用。

### 冻结的任务契约

在任何 builder 被接纳之前,auto 驱动会冻结一份**任务契约**,它成为该 Run 的唯一事实来源(在此生命周期内替代 `proposal.md`/`design.md`/`specs/`/`tasks.md`/`goal-plan.md`):

```json
{
  "format": "task-loop-input/1",
  "goal": "要产生的可观察结果",
  "artifactTargets": ["workspace 相对路径", "https://url", "runtime:name"],
  "bar": [
    {
      "id": "stable-kebab-id",
      "criterion": "一个可直接检查的通过条件",
      "evidenceHint": "证明它成立的那个 文件/命令/渲染/度量"
    }
  ],
  "constraints": ["范围、平台、安全或格式约束"]
}
```

契约必须满足的规则(在工作开始前强制):

- **`goal`** —— 非空,你想要的可观察结果。
- **`artifactTargets`** —— 至少一个真实目标。本地路径用平台 path API 相对项目根解析,且**必须留在授权 workspace 之内**(逃逸的 symlink/junction/reparse point 会被拒绝)。URL 和 `runtime:` 目标对核心保持不透明,由被指派的工具去检查。
- **`bar`** —— 至少一条 criterion;每条 criterion 都有唯一的稳定 `id`、可直接检查的 `criterion`、具体的 `evidenceHint`。空的或无法证明的 bar 会被拒绝——驱动**不会**用主观形容词("干净"、"测试充分")去替代一个真实的 bar。
- **`constraints`** —— 范围/平台/安全/格式限制。

契约被写入 `<ephemeraDir>/task-loop-input.json`,然后用 `rasen pipeline start <change> task-loop --input-file "<ephemeraDir>/task-loop-input.json"` 启动 canonical Run。契约参与 launch 身份,且在该 Run 的整个生命周期**永不改变**。

### 写一个好的 bar

bar 就是这个循环对"完成"的定义。一次 task-loop 运行的质量,上限就是它 bar 的质量。

- 让每条 criterion 是单一的、可直接检查的条件,而不是一个愿景。
- 在 `evidenceHint` 里点名具体证据:一个会通过的测试、一个输出会匹配的命令、一个你能读到内容/形状的文件、一个你能对比的渲染。
- 宁可少而锋利,也不要多而模糊。critic 每轮只返回**最大的那一个**剩余 gap,所以锐利的 bar 能让循环保持聚焦。
- 带空格或非 ASCII 字符的目标在 Windows 上没问题;路径用平台 API 解析,绝不走 shell 重定向。

## 生命周期

一个 task-loop Run 是三个不被打断的阶段:

```
iterate [有界的 build → fresh-critic 循环] → ship → archive
```

- **`iterate`** —— 一个有界的 goal-cycle 循环。每轮有两个阶段:
  - **work(builder)** —— 一个 implementer 编辑真实的产物目标,跑最小的直接检查,返回实质性的 before/after workspace 修订加原始证据。builder **不能宣布 bar 被满足**——它的完成声明是非权威的。
  - **judge(fresh critic)** —— 一个 reviewer,*与 builder 不同,也与之前每轮的 critic 不同*,独立地检查真实产物/证据,返回一份结构化判定,精确覆盖每一条冻结 criterion 各一次。
- **`ship`** —— 只在一个机械有效的 `satisfied` 判定之后才被接纳。
- **`archive`** —— 只在 ship 成功之后才被接纳。

**不会**创建的东西:没有 `proposal.md`、`design.md`、`specs/`、`tasks.md`、`planning-context.md`、`goal-plan.md`。Change 只被用作 canonical Run 的技术身份和存储/证据/交付容器。

### 一轮的细节

1. builder 收到冻结契约,加上(第 1 轮之后)仅有的上一轮 critic 的**最大 gap**和**通过条件**。它改进真实目标,返回绑定的 before/after 树和一个 delta 证据引用。
2. Run 推进到判定——它绝不会从一个 builder 声明直接 ship。
3. **fresh critic** 收到冻结契约、真实目标位置、after-tree 和原始证据——**绝不**包含 builder 的推理或摘要。它检查真实产物并返回裁决。
4. 如果每条 criterion 都用原始证据满足、且没有 gap → `satisfied`。否则 critic 返回恰好一个最大 gap 和一条明确、可测的下一轮通过条件,循环继续。

反馈是刻意收窄的:每轮一个 gap,不是头脑风暴。这让 builder 保持聚焦,也让预算有意义。

## 终态

| 结果 | 含义 | 交付 |
|---|---|---|
| `satisfied` | 每条冻结 criterion 都用原始证据满足;零 gap | 接纳 `ship` → `archive` |
| `task_loop_exhausted` | 预算耗尽仍未满足 | 终态/升级;**不**接纳 ship/archive |
| blocked / escalated | 权限、安全、依赖或阶段失败的阻塞 | 终态;保留原始原因;**不**接纳 ship/archive |
| cancelled | 用户取消了活动的 Run | 终态;**不再**有任何动作 |

非 `satisfied` 的结果是**最终且诚实**的:Rasen 报告证据和剩余 gap,绝不把 Run 转成另一个 pipeline。重新开始意味着一次新的显式 run,而不是改写当前这个活动的 run。

## 信任与安全模型

Task Loop 复用 canonical Run、GoalCycle 和 reconciler,并加上任务相关的机械检查,使得信任从不依赖于某段摘要:

- **冻结契约** —— goal/targets/bar/constraints 对该 Run 不可变,并烙进 launch 身份。用同样的契约重启动是幂等的;改了 goal/target/bar/Pipeline 会返回 `launch_request_conflict`,且不动已有的 Run。
- **证据绑定的判定** —— 每条 criterion 结果必须引用证据 digest,这些 digest 解析到*由该 judge action 提交的*原始证据引用,并绑定到正确的 change/run/action/schema 和当前 workspace 树。无关、过期或纯摘要的证据会被拒绝。
- **fresh critic** —— 每轮 critic 必须在 agent **session** 上与 builder 和之前每个 critic 都不同,且必须带 reviewer 角色/runtime。相同 session 或错误角色会被拒绝(`task_loop_critic_reused` / `goal_cycle_actor_separation`)。
- **精确的 bar 覆盖** —— 判定必须精确覆盖每一条冻结 criterion 各一次。遗漏、新增、重复或改 id 都会被拒绝(`task_loop_bar_mismatch`)。在有 criterion 未满足或还有 gap 时报 `satisfied: true` 会被拒绝(`task_loop_false_satisfaction`)。
- **物理路径授权** —— 启动输入和产物目标用 no-follow 的物理包含检查授权;symlink/junction/reparse-point 逃逸会被拒绝。隐藏的输入桥只从解析出的 change ephemera 根读取。
- **launch 身份** —— Rasen 从规范化的 pipeline/engine/inputs 派生 launch digest;caller 传入的 digest 只是一个一致性断言,不能凌驾其上。旧的空输入记录保持兼容。
- **精确的 built-in 身份** —— `task-loop` 的守卫只对真正的 package built-in 计划(精确的 `iterate → ship → archive` 形状)启用。一个同名但 DAG 不同的 project/user override 不会被误判。
- **交付时再次校验** —— 在完成和 ship/archive 两个边界,整段 work/judge 历史都会被对照**当前** workspace 树重新校验,所以投影或报告文件永远无法授予满足或交付权限。

## 引擎要求

Task Loop **只支持 reconciler**。它依赖 canonical 引擎来强制冻结输入、fresh critic、有界迭代和终态守卫。如果解析出的引擎是 legacy,或 reconciler 不受支持,preflight 会在**任何工作被接纳之前**用 `task_loop_reconciler_required` 停下——绝不静默回退到通用 legacy 路径。

## `--no-gate`

`--no-gate` 让普通的 gate 阶段自动通过而不是暂停(适合无人值守运行)。它被记进 `gatePolicy`,但**不能**绕过 task-loop 的输入校验、证据门槛、角色分离、终态检查或 ship/archive 交付守卫。no-gate 关掉的是暂停,不是把失败变成成功。

## 恢复与可观察性

- **确定性恢复** —— 密封的 plan 加上 canonical Record 完全决定下一个动作。如果一个进程在某阶段完成后停止、之后恢复,Rasen 会重放已提交的事件,保留 actor/证据历史,且只接纳下一个未完成的阶段——绝不重做一个已完成阶段,也不跑规划阶段。
- **状态** —— `task-loop` 状态派生自 Record(从不来自投影),暴露契约 digest、安全的契约字段、当前 round/phase、有效预算、builder/critic 身份、每条 criterion 的证据、最新的 gap/通过条件、停滞状态,以及确定性的下一个动作。
- **`task-loop-report.md`** —— 一份盖了 digest 戳的只读投影,在一次有效的 judge 完成后写进证据目录。它包含契约 digest、结果、轮次、goal、带证据 digest 的 criteria,以及排序后的原始证据。它是**派生的**:缺失、过期或手改的报告都无法改变状态、满足或交付。ship/archive 消费的是 canonical 的 satisfied 证据,不是这份报告。

## Registry、parity 和本地化

- `rasen pipeline list` / `show` / 校验都把 `task-loop` 暴露为一个 built-in,带 `iterate → ship → archive` 和角色隔离的 evaluate 循环。
- 内部 `rasen-task-loop` skill 作为 auto 依赖闭包的一部分被安装,但**不可被用户直接调用**(没有 `rasen loop` 命令,没有可直接选择的 skill)。已有的 goal pipeline 保留它们声明的 `rasen-goal-iterate` capability,lowering 方式不变。
- 诊断(输入/bar 错误、critic 复用、bar 不匹配、虚假满足、需要 reconciler、耗尽、交付守卫)已被本地化为英文、日文和简体中文。

## 设计边界(它刻意不是什么)

- **不是第二个通用编排入口。** 只有一个选择器,在 `rasen-auto` 之下。
- **不是自动升级。** 分类器不会路由进它;默认仍是 `small-feature`。
- **不可转换。** 终态是最终的;没有到 spec pipeline 的回退。
- **不是 goal pipeline 的替代品。** 它在一个小的任务相关模块背后复用 GoalCycle;不改它们的契约。
- **不是削弱评审的方式。** 独立的、基于证据的批评是核心保证;`--no-gate` 和投影都无法侵蚀它。

## 底层(架构)

Task Loop 是 canonical Change Run 之上的一个附加层,不是并行引擎:

- **启动输入** —— 契约存在 `CanonicalRunRecord.inputs.taskLoop`,并喂给 `digestLaunchIntent`,所以幂等复用 vs 冲突在任何副作用之前就被决定。
- **lowering** —— v1 goal-loop normalizer lower 的是阶段*声明的* skill capability(而非硬编码的),所以已有 goal pipeline lowering 不变,而 `task-loop` 派发它内部的 `rasen-task-loop` skill。
- **执行** —— 有界循环、角色隔离的 profile 解析(implementer = workspace-write 的 work,reviewer = 只读的 judge)、有界预算、重放、接纳和停滞语义,全都来自已有的 GoalCycle。TaskLoop 模块只加上任务相关的契约/判定校验,以及终态/交付守卫。
- **reconciler** —— action 输入只对 built-in task-loop 身份做富化:work 拿到契约 + 上一轮的 gap/通过条件;judge 拿到契约 + 真实目标/证据,但没有 builder 叙述。

这让深层机制(调度、actor 绑定、重放、结算、交付)保持共享且经过测试,任务策略则隔离在一个内部模块里。
