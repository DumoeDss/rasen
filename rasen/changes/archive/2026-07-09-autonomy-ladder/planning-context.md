# Planning Context — autonomy-ladder portfolio

## User intent
0.2.0 自主权阶梯:让 LEAD 在 /rasen:auto 中获得更多自主控制权。用户原话(2026-07-10 讨论):"当前是用户输入 /rasen:auto small-feature/auto-decompose xxxx 来选择……我觉得之后可以直接 /rasen:auto xxxx,然后 lead 自动根据任务情况来选择对应的工作流,甚至工作流本身也是动态创建的 DAG。"

## 已拍板的设计阶梯(LEAD 与用户 2026-07-10 收敛,不要重开)
- **第 1 阶 — classify-as-decision**(child: autonomy-ladder-classify):`/rasen:auto <task>`(无 pipeline 选择子)时,LEAD 跑 `rasen pipeline classify` 并**采纳**建议(今天 classify 只是建议、缺省固定 small-feature 且明文禁止 auto-escalate)。显式选择子永远优先;classify 不可用/无建议时回退 small-feature。
- **第 2 阶 — 组合式 pipeline**(child: autonomy-ladder-compose):LEAD 从已知 stage 库**组装** pipeline YAML(动态 DAG 的安全版),必须过 `PipelineYamlSchema` 校验 + registry 既有守卫(decompose-free child 等),落盘到项目 pipeline 目录(registry 已支持 project/user-defined pipelines),记入 run-state 保证 resume/审计继承。**策略底线:合成 pipeline 必须含 verify 与 review-loop 阶段(LEAD 不许给自己免检)。**
- **第 3 阶 — 运行时自由 DAG:已否决**,不做。理由:破坏 resume 与审计根基;运行时动态性已由 decompose(运行时扇出)+ goal-loop(运行时迭代)覆盖。设计文档/spec 中应把该否决记为 Non-Goal。

## 版本与兼容约束(硬)
- 当前版本 0.1.x,版本号归用户管——**绝不 bump version**。这些是"0.2.0 特性",但落地方式 = 现在以 **opt-in** 进入(flag 或 config,默认关,行为与 0.1.x 完全一致);将来 0.2.0 翻默认是用户的决定,不在本 portfolio 范围。opt-in 的具体形状(如 `--auto-select` flag / config `autopilot.selection`)由 planner 设计,但"默认关、显式赢、回退 small-feature"三条不可动。
- --no-gate + vet 级 gate 已由另一改动落地(692c1d4),是本阶梯的前置,可直接引用其机制。

## 改动面提示(需 planner 核实)
- 第 1 阶主要是 `src/core/templates/workflows/auto.ts`("Select the pipeline" 一节 + guardrails)与 `rasen pipeline classify` 的输出契约(src/commands/pipeline.ts / classify 实现,视需要增强置信度/理由输出)。
- 第 2 阶涉及 auto.ts 模板(组合流程一节)、pipeline registry 的加载/校验路径(src/core/pipeline-registry/:resolver、types 的 schema 已在)、可能需要一个 `rasen pipeline validate <file>`/compose 辅助命令让 LEAD 校验合成产物(是否新增 CLI 由 planner 权衡:template-only 方案 vs CLI 辅助方案——倾向最小 CLI 面)。
- 模板改动流程 = build → update;parity 哈希手工贴(test/core/templates/skill-templates-parity.test.ts)。

## 环境(worktree)
- 本 portfolio 在 git worktree `.claude/worktrees/autonomy-ladder`(分支 autonomy-ladder,基于本地 HEAD 00f6bea)。node_modules 是指向主仓的 junction——不要 pnpm install/修改依赖。构建用 `node build.js`,测试用 `npx vitest run <paths>`(pnpm 包装器已知损坏)。
- delta spec 教训(office-hours-fork-first 踩坑):requirement 改名+场景标题改名必须用 REMOVED+ADDED;MODIFIED 标题须与现有主 spec 逐字匹配且场景名全覆盖;`validate --strict` 不检查同步引擎的场景守卫。
- 子 change ship 一律 local 模式(worktree 分支上 commit),portfolio 级交付 = 留在分支上由用户决定合并;不 push。

## 依赖 DAG
autonomy-ladder-classify → autonomy-ladder-compose(串行:两者都改 auto.ts 模板同一区域;compose 的选择流程叙事建立在 classify-as-decision 之上)。

## Planner findings — child 1 (autonomy-ladder-classify, artifacts 完成 2026-07-10)
- **Opt-in 形状已定**(compose 必须沿用):`--auto-select` flag + `autopilot.selection: classify | manual` config,precedence flag > config > default(`manual`),resolver `resolveAutopilotSelectionPolicy` 与 `resolveAutopilotGatePolicy` 并列于 src/core/project-config.ts。值空间刻意留了扩展位:compose 可加第三个值 `compose` 而不破 schema。**显式选择子位于 policy 之上**(不在 policy 内)——`--pipeline x --auto-select` 定义为显式赢、flag 惰性;compose 扩展选择流程时必须保持这条排序。
- **classify 输出契约增强 = 仅加 `basis: 'keyword' | 'default'`**(matched 即 reason;确定性关键词启发式给数值 confidence 是假精度,design D3 已记 rejected alternative)。
- **无需改 run-state**:pipeline 名已在 run start 持久化、resume 只读不重选。compose 侧的等价结论:合成 pipeline 只要落盘进 project pipelines 目录、按名可加载,resume 即免费继承——不要发明新的 run-state 字段。
- **auto.ts 第 1 节结构保持"编号选择顺序 + policy 段落"**,专为 compose 扩展(而非重写)预留;delta spec 对 `Task Complexity Classification`(opsx-auto-command)与 `Pipeline CLI Surface`(opsx-pipeline-registry)的 MODIFIED 已全场景覆盖,compose 若再改同一 requirement,以本 child 归档后的主 spec 文本为基准。
- **发现主 spec 缺陷(pre-existing,非本 child 范围)**:`rasen/specs/autopilot-gate-policy/spec.md` 是 delta 格式(首行 `## ADDED Requirements`,无 `# ... Specification`/Purpose 头),同类新能力 spec(verify-ship-evidence 等)都是标准格式——疑为 gate-policy 改动归档 sync 缺陷。若 compose 需 MODIFY 该能力,标题须按该文件现状逐字匹配;建议 LEAD 记一个清理 follow-up。

## Planner findings — child 2 (autonomy-ladder-compose, artifacts 完成 2026-07-10)
- **归档顺序是硬依赖**:compose 的 delta MODIFY 了 child 1 新增的 `autopilot-selection-policy` 能力(值空间 `classify|manual` → 三值 + `--auto-compose` 进 precedence)。其 MODIFIED 标题/基文以 child 1 **归档后**的主 spec 文本为基准——child 1 必须先归档再归档 compose(portfolio 串行序已保证,勿重排);proposal 顶部已显著标注。对 `opsx-pipeline-registry` 只 MODIFY 了 child 1 未碰的两个 requirement(Data-Driven Pipeline Definitions / Pipeline Validation),无同 requirement 冲突。
- **校验路径拍板 = 复用 `rasen validate <name> --type pipeline`,不新增 CLI**:该命令已跑全守卫栈(parse+Zod+结构校验+known-skill+decompose 递归守卫)且出机器可读 issue 报告;rejected alternatives(`rasen pipeline validate <file>` 新子命令、template-only `pipeline show` gate)已录 design D3。
- **质量底线机制 = `origin: composed` 标记 + parse 时强制**:PipelineYamlSchema 加可选 `origin`(唯一值 `composed`),parsePipeline 里 `validateComposedPolicyFloor` 要求 ≥1 个 `role: reviewer` stage + ≥1 个 `loop.kind: review-cycle` stage,违反直接不可加载。不能做成 blanket 规则:内置 bug-fix 本身就没有 review-loop stage,无标记 pipeline 完全不受影响。
- **flag 形状 = 独立布尔 `--auto-compose`**(非 `--auto-select compose` 取值形式——skill 调用行里取值 flag 与首个任务 token 有歧义);双 flag 同现 compose 赢(超集语义,resolver 序:--auto-compose > --auto-select > config > default)。
- **compose 语义 = classify-first、no-fit 才许组合(MAY 非 SHALL)**:keyword-basis 建议永远直接采纳,组合只在 default-basis 且无注册 pipeline 适配时被允许;组合命名 `composed-` 前缀 + 撞名加数字后缀绝不覆盖(registry precedence 会变成 shadow);校验失败一次修复机会后回退 small-feature 并删除无效目录。
- **组合无新增人类 gate**(design D6 记了 rejected alternative:强制 vet 会废掉无人值守场景,opt-in 即授权;composed YAML 自身 stage gate + rung-1 gate policy 照常适用)。
