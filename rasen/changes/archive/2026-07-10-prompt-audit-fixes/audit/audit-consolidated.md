# Prompt 冲突全量审计 — 汇总报告（2026-07-09）

审计面：src/core/templates/ 全部 44 个模板文件（~10.8k 行）+ pipelines/*/pipeline.yaml。
5 个并行审计域：shared（SH）、interactive（IN）、reviewers（RV）、workflows（WF）、orchestration（OR）。
明细报告：同目录 audit-{shared,interactive,reviewers,workflows,orchestration}.md（每条含双方原文引用 + 具体误行为场景 + 修复方向）。

## 总量

50 条发现：Critical 5（去重后 4）/ Major 22 / Minor 23。
去重：OR-1 ≡ SH-4（planner 阈值 0.5 vs 0.25，两域独立撞见同一缺陷）。
互证：SH-3 与 RV-4/RV-5 从两端确认同一断裂（review 系技能是主动修改型，编排层当只读审查器用）。

## 四个 Critical（去重后）

1. **RV-1** review 引擎产出 critical/informational 两级词表，review-cycle/Step E 消费 Blocker/Major/Minor/Trivial 四级——无映射，"never report clean while Blocker/Major open" 的终止不变量在主路径上没有定义。
2. **RV-5** rasen-review 是 Fix-First 技能（自动改代码 + AskUserQuestion），review-cycle 却把它当纯发现返回器委派：reviewer 变 author（author≠verifier 崩塌）、LEAD triage 在已修的发现上空转、叶子 worker 弹 AskUserQuestion 无人应答。
3. **OR-1/SH-4** planner 复用决策：B.1.5 要求用 reuse 阈值 0.25，H.2 的措辞把 LEAD 引向 handoff 阈值 0.5——每次 portfolio planner 复用都会做错误保留。
4. **IN-1** office-hours 新 Consultation 短路 vs 三处 "fully formed plan 仍必须跑 Phase 3+4 (MANDATORY)"——同一开场消息命中两条互斥路由且无优先级，最常见的求评审场景会退回旧的"弹方案菜单"反模式。
5. **SH-1** QA "Never read source code"（绝对化）vs diff-aware 主模式必须读源码做 diff→路由映射——守规矩的 agent 会把定向 QA 静默降级为首页冒烟测试。

## 结构性病理（比单条发现更重要）

1. **接缝断裂是主病**（~60% 发现是 F 族）：严重度词表、报告文件路径、evidence 文件、office-hours→propose 交接——都是"生产者承诺 vs 消费者期待"错位。根因：模板来自三股来源（grills 收编 + 上游合并 + fork 自研），无合同注册表。
2. **绝对化好记规则缺作用域**（D/E 族，校准样本同族全域复现）："Never read source code"、"dead handles"、"MANDATORY"、"save NOTHING"——在窄域正确，被写成全域绝对。
3. **双阈值/双计数器不消歧**：0.25 vs 0.5、maxRelays vs 轮次 cap vs stallLimit（OR-9/13/15、SH-4）。
4. **收编适配缺失**：grills 系技能（qa/design-review/review）是"独立全能"型（测→修→提交），塞进 auto 的角色隔离流水线时没做 report-only 适配（RV-3/4/5、SH-3）。

## 修复批次建议

| 批次 | 主题 | 覆盖 | 体量 |
|---|---|---|---|
| B1 review/verify 合同统一 | 唯一严重度词表+映射；被编排调度时的 report-only/非交互模式；报告文件路径合同；ship 证据链（WF-1/8）；never-read-source 限域 | RV-1..9, SH-1/2/3, WF-1/7/8 | M-L（最高价值）|
| B2 编排记账与分类学 | H.4 infra 死亡唤醒（已设计）+ OR-1/SH-4 阈值 + OR-6/7/2/3 + 计数器消歧 + SH-5/7 + Tier-C 降级（OR-4/14）+ OR 系 minor | OR-1..15, SH-4/5/7 | M |
| B3 office-hours consultation 收尾 | IN-1 优先级（Consultation 取代 Phase 2-4）+ IN-2 终局（跳过 founder plea）+ IN-4/5/6 + SH-6 + IN-3(--noproxy) | IN-1..6, SH-6 | S |
| B4 生命周期契约 | WF-2 交接落地或删承诺 + WF-3/9 store 路径解析 + WF-4/5 gate 补牙 + WF-10/11/6 | WF-2..6, 9..11 | M |
| B5 杂项 | IN-7/8, RV-8/9 残余 | 少量 | XS |

## 防复发（回应"不要修修补补"）

- **合同测试层**：机器可查的合同（严重度词表字符串、报告文件名、--store 白名单命令、pipeline yaml 字段 vs playbook 提及的字段）做静态断言测试，与 parity 测试并列——接缝断裂在 CI 就炸，不等运行时。
- **审计分类学入 review checklist**：A 规则冲突 / B 漏态 / C 优先级缺口 / D 错域泛化 / E 埋没覆盖 / F 接缝——模板改动的 review 必查这六族。
- **绝对化规则写作规范**：任何 NEVER/ALWAYS/MANDATORY 必须带作用域从句（"during X phases"）。
