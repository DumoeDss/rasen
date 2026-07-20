# Autopilot 策略:gate、选型与组合式 pipeline

`/rasen:auto` 有三条 **opt-in 策略轴**,控制 LEAD 的自主决定权限。三条全部默认关闭——不带 flag、不写配置时,autopilot 的行为与 [opsx-workflow-guide.md §2](opsx-workflow-guide.md#2-一条命令跑完整个工作流opsxauto) 所述完全一致:gate 停顿等确认、pipeline 缺省 `small-feature`、classify 仅作建议。

| 策略轴 | 运行参数 | 配置键(项目 `rasen/config.yaml` 与全局配置均可) | 取值 | 内建默认 |
|---|---|---|---|---|
| **Gate 策略** | `--no-gate` | `autopilot.gates` | `on` / `off` | `on`(gate 停顿) |
| **选型策略** | `--auto-select` / `--auto-compose` | `autopilot.selection` | `classify` / `compose` / `manual` | `manual` |

每条轴的优先级:**运行参数 > 项目配置 > 全局配置 > 内建默认。** `autopilot.gates` 与 `autopilot.selection` 均可在项目与全局(机器级)两个作用域设置——项目值始终覆盖全局值。任一作用域的配置值缺失或不可识别时回退下一层并告警——绝不破坏配置解析,兄弟字段照常解析。

解析后的策略在**运行开始时连同来源一起展示**(如 `Gate policy: off (--no-gate)` / `Selection policy: classify (project)`),opt-in 的运行绝不对自己的行为方式保持沉默。

```
/rasen:auto [--pipeline <name>] [--no-gate] [--auto-select] [--auto-compose]
            [--review-plan] [--planner claude|codex] [... 其他角色参数] <任务>
```

---

## 1. Gate 策略 —— `--no-gate`

默认情况下,标记 `gate: true` 的阶段会暂停运行:LEAD 总结已完成的工作,等你 Continue / Stop / 切手动。想让 autopilot 无人值守地跑完——而不是每次都说一遍"no gate / 跑完不用停"——传 `--no-gate`(或把 `autopilot.gates: off` 写成项目或全局默认):

- **普通 gate 自动通过**:运行不停顿地越过每个 `gate: true` 阶段。
- **没有任何静默跳过**:每个自动通过的 gate 都作为显式 gate 决定记入 run-state,并注明策略来源(如 `auto-approved (--no-gate)`)。审计轨迹显示该阶段由自动批准推进,而非人工 Continue。
- **resume 继承策略**:解析后的 gate 策略持久化在 run-state 里,`rasen pipeline resume` 无需重传 flag 即继续自动通过。
- **decompose portfolio**:父级 `--no-gate` 指令同样自动通过子 pipeline 的普通 gate(父指令 > 子 gate)。

### vet gate 永不自动通过

阶段可以把 gate 标成 **`gate: 'vet'`** 而非 `true`。vet gate 的含义是*此阶段必须由人审核*——在 `--no-gate`、`autopilot.gates: off`、父 portfolio 指令下都照样停顿。

典型例子是 goal-loop 的 `define-goal` 阶段:它的产出可能包含后续每轮都要执行的任意 shell 度量命令。那是 LEAD 自己写的命令,若无 vet 就等于 LEAD 自批自执——所以无论 gate 策略如何,第一轮跑之前必须有人审过。

既有 pipeline YAML 不受影响:`gate: true`、`gate: false`、省略 `gate` 的解析与行为完全如旧;`rasen pipeline show --json` 照常报告每个阶段的 gate 值。

---

## 2. 选型策略 —— `--auto-select`

经典行为(`manual`):显式选择优先,否则 pipeline 为 `small-feature`,`rasen pipeline classify` 永远只是 LEAD 可以展示给你的建议。

开启 `--auto-select`(或 `autopilot.selection: classify`)后,LEAD **采纳** classify 的建议:

- 运行 `rasen pipeline classify "<任务>" --json`,建议的 pipeline 在可用列表中即采纳。
- 选择**连同依据一起展示**:关键词命中型建议展示命中的指示词(如 `bug-fix — matched: fix, crash`);无命中则为默认依据(落在 `small-feature`)。classify 的 JSON 输出以 `basis: 'keyword' | 'default'` 携带这一信息。
- **执行前你仍可改**——采纳是起始选择,不是锁定。
- LEAD *原样*采纳建议——绝不凭自己的判断升级或替换成别的 pipeline。
- **兜底**:classify 不可用、失败、无建议、或建议了未知 pipeline 时,LEAD 回退 `small-feature` 并展示回退原因。选型永不报错中断。

### 显式选择永远最高

`--pipeline <name>` 或开头的已知 pipeline 名(`/rasen:auto full-feature <任务>`)位于整条策略轴**之上**:存在显式选择时不咨询 classify,`--auto-select` / `--auto-compose` 均不生效。配置默认同样被显式选择压过。

### 为什么没有置信度分数?

classify 是确定性的关键词启发式。`basis` + 命中指示词已经精确说明了*为什么*建议这个 pipeline;数字置信度只会是假精度。

---

## 3. 组合式 pipeline —— `--auto-compose`

`compose` 策略是 `classify` 的超集(两个 flag 同时给时 `--auto-compose` 胜出):classify 仍然先跑,关键词命中的建议一律采纳。**只有在没有已注册 pipeline 匹配时**——建议以默认依据返回、且 LEAD 判断任务也不适合默认 pipeline——才允许组合:LEAD 可以(MAY)从现有 stage 库组装一个新 pipeline,而不是硬塞进不合身的流程。

组合产物不是特殊的运行时形态,而是一个**普通的项目 pipeline**:

- 以 **`composed-` 前缀**命名,与所有已注册 pipeline 名做冲突检查——**绝不覆盖**既有 pipeline。
- 落盘到项目 pipelines 目录(`rasen/pipelines/<name>/pipeline.yaml`),打上 **`origin: composed`** 标记,来源可查(`rasen pipeline show` 会报告)。
- 因为是注册 pipeline,`rasen pipeline list / show / resume` 与 run-state 全部免费继承——组合 pipeline 上的运行 resume 起来与任何 pipeline 无异。

### 机器强制的质量底线

标记 `origin: composed` 的 pipeline 若不同时含至少一个 reviewer 角色阶段与至少一个 `review-cycle` loop 阶段,**根本无法加载**。该检查实施在所有加载路径共同经过的唯一解析咽喉(validate、show、resume 全部经过)——LEAD 不可能组装出一个跳过自我审查的 pipeline,手工篡改过的 composed YAML 也会响亮地失败而不是不经验证地运行。**没有** `origin` 标记的 pipeline(你手写的、以及全部内建)完全不受影响——内建 `bug-fix` 没有 review-cycle loop,依然有效。

### 校验把关执行

组合 pipeline 运行前必须通过 `rasen validate <name> --type pipeline`——完整 schema 校验 + registry 守卫(+ 经标记生效的质量底线)。失败时 LEAD 有**一次有界修复机会**;再失败则运行**回退 `small-feature`**,无效的 pipeline 目录被清理。autopilot 只执行已注册且通过校验的 pipeline。

与选型一样,组合结果在执行前**完整展示**——阶段、组合依据、校验结论——你可以在任何阶段运行之前换成任意已注册 pipeline。

### Non-Goal:运行时自由 DAG

组合发生在**运行之前、以数据形式、由与所有 pipeline 相同的机制校验**。LEAD 在运行中途发明或改动 stage 被明确否决——那会破坏 resume 与审计语义。运行时的动态性已有两个受认可的形态:`decompose` 扇出(运行时决定子 change)与 goal-loop 迭代(运行时决定轮数)。

---

## 4. 组合使用

项目级"放手"默认姿态的配置:

```yaml
# rasen/config.yaml
autopilot:
  gates: off        # 普通 gate 自动通过(vet gate 仍停顿)
  selection: classify  # 采纳 classify 建议;写 compose 则进一步允许组合
```

完全无人值守的一发入魂,允许组合:

```
/rasen:auto --no-gate --auto-compose 给 webhook API 实现限流
```

无人值守运行仍会停下来的情形:**vet gate**(永远)、ship 时未解决的 **Blocker/Major 发现**(发现门不是停顿门——永不豁免)、以及编排阶梯的升级呈报(见 playbook 的 Step H)。

兼容性保证:三条轴全在默认值时,行为与这些能力存在之前逐字节一致。

延伸阅读:[opsx-workflow-guide.md §2](opsx-workflow-guide.md#2-一条命令跑完整个工作流opsxauto)(autopilot 章)、§2.6(手写自定义 pipeline——组合的手动同胞)、§9(goal 驱动迭代及其 vet 门的 `define-goal`)。
