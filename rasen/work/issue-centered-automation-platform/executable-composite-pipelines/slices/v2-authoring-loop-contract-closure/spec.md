# ECP-6：v2 Authoring and Loop Contract Closure

## 用户可见结果

用户通过 CLI、Canvas 或内置 Pipeline 新建 Change-level Pipeline 时，得到可直接由
deterministic reconciler 执行的 Definition v2；Canvas 能完整创作首版受支持的
Composite、BoundedLoop、Choice、FanOut/Join、Gate 与 Finish 语义。保存、导出、
编译、执行、恢复和 Operations 展示不会改变该定义的含义。

ReviewCycle 与 GoalLoop 使用同一套有界生命周期契约表达进度、停滞、阻塞、策略耗尽、
人工升级和类型化终态；领域 reducer 只负责领域判断，不再拥有第二套隐藏推进状态。

## 为什么现在验证

0.2.0 已具备 Definition v2、lowerer、canonical Run Record 和 deterministic
reconciler 的基础，但公开新建入口仍默认 v1，Canvas 对部分 v2 原语只读，公共 loop
lifecycle 也没有完整闭环。这些缺口会让“可执行内核已存在”与“用户真正能够创作和运行”
继续分裂，因而必须在 Session 自宿主和最终发布审查之前关闭。

## 可观察验收

1. `pipeline init`、空白 Canvas 和所有公开新建入口默认产出 Definition v2；v1 仅作为
   兼容输入，并能 normalize/lower 为与等价 v2 相同的 immutable plan。
2. package built-in 使用 authored v2，或在面向用户的产品视图中被明确标为兼容
   fixture；正常 built-in 不再产生“prompt-owned execution unchanged”一类误导警告。
3. Canvas 可以创建、编辑、保存并重新载入 CompositeRef、BoundedLoop、Choice、
   FanOut/Join、Gate、Finish，以及 declaration body、typed outcomes、limits、exits
   和 capability；导出/导入后的 semantic digest 不漂移。
4. ReviewCycle 与 GoalLoop 共享程序化验证的 bounded lifecycle：iteration/action/
   budget limit、progress fingerprint、stall、blocked、strategy exhaustion、human
   escalation、cancel/recovery 和 typed terminal outcome。
5. 至少一个从空白 Canvas 创作的含 loop + parallel 的 v2 Custom Composite 完成真实
   success、fresh-process resume 和 fail-closed 运行；Definition、compiled plan、Record、
   CLI/API/Operations projection 对同一 Run 给出一致解释。
6. 与 Definition、Canvas、loop contract 相关的 Blocker/Major 审查 finding 为零，相关
   root/UI tests、typecheck 和 lint 通过。

## 明确排除

- 独立 Session executor、agent worker lifecycle 和 ECP 自宿主：由 ECP-7 承接。
- 0.2.0 全量完成审查、版本/changelog/package/tag 一致性和 legacy retirement 决策：
  由 ECP-8 承接。
- `auto-decompose` 上移、Issue Execution Plan、Issue Acceptance、跨项目 portfolio：
  属于 0.3.0。
- recursive Composite、nested loop、任意脚本节点、Remote Runtime 和团队平台。

## Direction 对齐

- Workstream：`executable-composite-pipelines`
- Target State：`../../target-state.md`
- Roadmap：`../../roadmap.md` 的 ECP-6
- 上位 North Star：`../../../north-star.md`，遵循“先证明真实 Change 闭环，再进入
  Issue/跨项目层”的 Horizon 0 原则。
- 支持的 Result 终态：`passed | partial | failed | superseded | cancelled`
