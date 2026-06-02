## 1. Stage Schema：decompose 阶段类型

- [x] 1.1 在 `src/core/pipeline-registry/types.ts` 中向 `StageSchema` 增加一个具名的 `StageKind` enum 常量（`standard` | `decompose`）和一个 `kind` 字段（默认 `standard`）
- [x] 1.2 向 `StageSchema` 增加可选的 `childPipeline: string`
- [x] 1.3 通过 `superRefine` 放宽必填的 `skill` 字段，使其仅在 `kind === 'decompose'` 时可选（`standard` 时仍必填）
- [x] 1.4 增加单元测试：解析一个 `kind: decompose` 阶段（无 `skill`、带 `childPipeline`）；确认无 `kind` 的阶段默认为 `standard` 且仍要求 `skill`

## 2. Pipeline 校验：保障 decompose 安全

- [x] 2.1 强制每条流水线**至多一个** decompose 阶段；重复时给出确定性错误
- [x] 2.2 强制 decompose 阶段在 build order 中位于**第一位**（索引 0）；否则给出确定性错误
- [x] 2.3 通过显式的注册表查找（project > user > package）解析 `childPipeline`，绝不用模式匹配；解析不到时报错
- [x] 2.4 递归防护：拒绝（传递地）包含 decompose 阶段的 `childPipeline`，并指出违规的流水线名
- [x] 2.5 省略时把 `childPipeline` 默认为 `small-feature`，并断言 `small-feature` 不含 decompose
- [x] 2.6 把上述规则接入 `openspec validate --type pipeline`，并在 `openspec pipeline show --json` 中呈现 decompose 阶段及解析后的 `childPipeline`
- [x] 2.7 为每条规则编写测试：重复、非首位、子流水线解析不到、递归子流水线、省略默认、show 输出

## 3. 组合运行状态

- [x] 3.1 增加组合运行状态 schema + 读写器（`src/core/pipeline-registry/` 下的新模块），文件名作为具名常量跟踪，路径用 `path.join` 构建——记载拆分方案、子 change 列表、依赖 DAG、每个子 change 的执行模式 + 并行同批、**每个子 change 实际运行的流水线（允许逐个覆盖，默认取 decompose 阶段的 `childPipeline`）**、每个子 change 的状态，以及可运行前沿
- [x] 3.2 保持既有的每个子 change 的 `auto-run.json` schema 不变；组合状态按 id 引用子 change
- [x] 3.3 扩展 `openspec pipeline resume <parent>`，使其能检测组合父 change、读取组合状态 + 各子状态，并计算下一个可运行的子 change；组合状态为权威，产物存在性作为交叉校验
- [x] 3.4 测试：组合往返（写/读）、从 DAG 计算前沿、resume 选中正确的下一个子 change、部分失败时停止依赖链

## 4. 编排 playbook（组合章节）

- [x] 4.1 在 `src/core/templates/workflows/_orchestration.ts` 的 `ORCHESTRATION_PLAYBOOK` 中增加一个「组合编排」章节：产出拆分方案 + 依赖 DAG、父作为容器、为每个子 change 运行 `childPipeline`
- [x] 4.2 编码串行/并行策略：沿边严格串行（依赖者等待前置已实现 + review 干净；不并发运行前置/依赖者；共享工作树 + review 干净即足够，无需先 ship/archive，仅当依赖已落地/已合并产物时才升级），仅当无边*且*触及集无重叠*且* Tier A 时才并行（Tier A 下并行不设固定上限），不确定时保守串行默认，Tier B/C 下绝不并行
- [x] 4.3 编码递归防护（decompose 至多一次，仅顶层）以及组合运行状态的交接/升级行为

## 5. Auto skill：条件性 decompose 步骤

- [x] 5.1 在 `src/core/templates/workflows/auto.ts` 中，把 decompose 加为 LEAD 的条件性首步：根据任务判断执行还是跳过；跳过 → 单 change 路径不变
- [x] 5.2 增加 LEAD 对拆分方案的自审（切片内聚性、独立性依据、DAG 正确性）；自动继续、无人类 gate；仅当不存在安全方案时才升级给人类；保持运行可中断
- [x] 5.3 当 auto 在一个已拆分的父 change 上被重新调用时，增加组合恢复处理
- [x] 5.4 更新 auto skill 的 Output Format / Guardrails，覆盖组合进度以及「绝不并行化未经证明独立的工作」这条护栏

## 6. 内置流水线

- [x] 6.1 在 `pipelines/` 下增加一条启用 decompose 的入口流水线（起首的 `kind: decompose` 阶段、无人类 gate、`childPipeline: small-feature`）
- [x] 6.2 确认 `small-feature` / `bug-fix` 保持不含 decompose，从而是合法的子流水线；增加一个内置测试断言这一点

## 7. 文档

- [x] 7.1 更新 `docs/opsx-workflow-guide.md`——让 §2.1「每个 change 各自一支 worker 团队」的承诺成真；把 decompose 记录为一个条件性 auto 步骤以及串行/并行安全规则
- [x] 7.2 为 decompose 阶段类型与 `childPipeline` 更新 `docs/commands.md`（及流水线注册表文档）
- [x] 7.3 记录与 `add-change-stacking-awareness` 的软对齐（当它落地时产出 `dependsOn`/`parent` + 复用 `change graph`）

## 8. 校验与跨平台

- [x] 8.1 `openspec validate add-auto-decompose-stage --strict` 通过
- [x] 8.2 完整测试套件通过（`pnpm test`）；为组合运行状态的路径处理增加 Windows CI 验证 _(本次新增/相关测试全绿：1515 通过；唯一 1 个失败为既有、与本 change 无关的 `openspec/specs/archive-quality-capture/spec.md` 占位文本问题，源自另一进行中的 `integrate-gstack-into-openspec`。组合状态路径用 `path.join`，已在 win32 上跑通。)_
- [x] 8.3 确认 stacking 顺序：仅在 `upgrade-auto-orchestrated-pipelines` 归档之后再归档
