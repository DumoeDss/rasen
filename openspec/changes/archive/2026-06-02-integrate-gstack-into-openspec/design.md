## Context

OpenSpec 已有一套完整的 skill 生成体系：

```
src/core/templates/workflows/explore.ts     → getExploreSkillTemplate(): SkillTemplate
src/core/templates/skill-templates.ts       → 汇总导出所有模板
src/core/shared/skill-generation.ts         → 注册表: { template, dirName, workflowId }[]
src/core/init.ts                            → openspec init 时遍历注册表写入 SKILL.md 到目标 AI 工具目录
```

gstack 的 skill 是提示词模板（SKILL.md.tmpl → gen-skill-docs → SKILL.md），需要迁入 OpenSpec 并复用上述体系。gstack 的 browse 是基于 Playwright 的 headless 浏览器 CLI，使用 Bun 编译（OpenSpec 支持 Bun 安装，无需迁移到 Node.js）。

**约束**：
- gstack 的 skill 提示词逻辑保持不变，只做路径适配
- 复用 OpenSpec 现有的 `SkillTemplate` 接口和 `skill-generation.ts` 注册机制
- 跨平台：macOS/Linux/Windows
- 向后兼容：不使用新功能时行为完全不变

## Goals / Non-Goals

**Goals:**
- gstack 的 25+ skill 通过 OpenSpec 的 SkillTemplate 体系注册，`openspec init` 时自动安装
- browse 浏览器作为 OpenSpec 内置模块，保持 Bun 构建流程
- gen-skill-docs 构建链迁入，支持 `.tmpl` → SKILL.md → TypeScript 模板函数的完整链路
- Schema 支持 `enhance`/`provider`/`context-from` 字段
- 质量记忆反馈闭环完整可用

**Non-Goals:**
- 不改变 gstack skill 的提示词逻辑
- 不改变 browse CLI 的命令接口
- 不迁入 gstack 的 eval 测试体系（后续独立变更）
- 不改变 OpenSpec 的核心数据模型（Spec/Change/Delta）

## Decisions

### Decision 1：gstack skill 融入 OpenSpec 模板体系

**选择**：两层结构——skill 源文件在 `skills/`，TypeScript 模板函数在 `src/core/templates/experts/`。

```
skills/                                ← 开发层（编辑这里）
├── review/
│   ├── SKILL.md.tmpl                  ← 模板源文件（含占位符）
│   └── SKILL.md                       ← 构建产物（gen-skill-docs 生成）
├── qa/
├── ship/
├── ...25+ skill 目录

src/core/templates/
├── workflows/                         ← 现有 OpenSpec 工作流模板
│   ├── explore.ts
│   ├── apply-change.ts
│   └── ...
├── experts/                           ← 新增：gstack 专家模板
│   ├── review.ts                      ← export function getReviewSkillTemplate(): SkillTemplate
│   ├── qa.ts
│   ├── ship.ts
│   ├── ...
│   └── index.ts                       ← 汇总导出
└── skill-templates.ts                 ← 扩展：同时导出 workflows/ 和 experts/

src/core/shared/skill-generation.ts    ← 扩展注册表
  getSkillTemplates() → [
    // 现有
    { template: getExploreSkillTemplate(), dirName: 'openspec-explore', workflowId: 'explore' },
    ...
    // 新增
    { template: getReviewSkillTemplate(), dirName: 'openspec-review', workflowId: 'review' },
    { template: getQaSkillTemplate(), dirName: 'openspec-qa', workflowId: 'qa' },
    { template: getShipSkillTemplate(), dirName: 'openspec-ship', workflowId: 'ship' },
    ...
  ]
```

**构建链**：
```
skills/review/SKILL.md.tmpl
      │ gen-skill-docs.ts（构建时运行）
      ▼
skills/review/SKILL.md
      │ 被 src/core/templates/experts/review.ts 读取或内联
      ▼
getReviewSkillTemplate(): SkillTemplate { instructions: "..." }
      │ 注册到 skill-generation.ts
      ▼
openspec init → .claude/skills/openspec-review/SKILL.md
```

**替代方案**：
- A) 直接把 SKILL.md 内容硬编码为 TypeScript 字符串 → 失去 .tmpl 模板编辑体验和 gen-skill-docs 的变量替换能力
- B) 运行时从 `skills/` 目录读取文件 → 增加文件发现逻辑，不如编译时嵌入可靠

**理由**：复用 OpenSpec 现有的 SkillTemplate 接口保持架构统一。`skills/` 保留 .tmpl 源文件方便开发者编辑和 gen-skill-docs 处理，最终内容编译进 TypeScript 模块。安装后用户只看到 `openspec init` 生成的文件，不需要知道 `skills/` 的存在。

### Decision 2：Skill 分类 — 工作流 vs 专家 vs 工具

gstack 的 25+ skill 按用途分三类：

| 类别 | skill | 说明 |
|------|-------|------|
| **规划专家** | office-hours, plan-ceo-review, plan-eng-review, plan-design-review, autoplan, design-consultation | 用于 schema enhance 字段 |
| **质量专家** | review, qa, qa-only, cso, design-review, benchmark | 用于 schema provider 字段 |
| **执行工具** | ship, land-and-deploy, document-release, investigate, retro, codex | 独立调用 |
| **浏览器** | browse, setup-browser-cookies | 被其他 skill 引用 |
| **安全防护** | careful, freeze, guard, unfreeze | 会话级钩子 |
| **维护** | canary, setup-deploy, gstack-upgrade | 辅助功能 |

所有类别统一注册到 `skill-generation.ts`。schema 中通过 enhance/provider 字段引用 skill 名称。

### Decision 3：路径适配策略

gstack skill 中需要替换的路径模式：

| 原始模式 | 替换为 | 出现位置 |
|---------|--------|---------|
| `~/.gstack/` | `~/.openspec/` | 用户级数据目录 |
| `.gstack/` | `.openspec/` | 项目级数据目录 |
| `$B` / browse 二进制引用 | OpenSpec 安装路径下的 `browse/dist/browse` | browse 相关 skill |
| `gstack` CLI 命令 | `openspec` | 少数引用 gstack CLI 的地方 |

替换在 gen-skill-docs 构建时完成（通过模板变量），运行时无需替换。

### Decision 4：browse 集成

**选择**：`browse/` 目录整体迁入，保持 Bun 构建流程。

OpenSpec 的 `package.json` 记录支持 bun 安装。browse 的 `bun build --compile` 可以直接复用。

```
OpenSpec/
├── browse/
│   ├── src/               ← Playwright CLI TypeScript 源码（不修改）
│   ├── dist/browse        ← 编译二进制（Bun compile 产物）
│   └── test/              ← 集成测试
├── package.json           ← 新增 Playwright 为 optionalDependencies + browse 构建脚本
```

### Decision 5：Schema 扩展

与之前方案一致。artifact 定义新增三个可选字段：

```typescript
// src/core/artifact-graph/schema.ts
enhance: z.string().optional(),      // 引用内置 skill 名称
provider: z.string().optional(),     // 引用内置 skill 名称
'context-from': z.string().optional(), // 引用另一个 artifact ID
```

默认 `spec-driven` schema 升级为 v2，为 proposal/specs/design 添加 enhance 字段。

### Decision 6：instruction-loader 指令生成

当 artifact 有 enhance/provider 字段时，instruction-loader 在输出中追加对应标签：

```xml
<enhance>
After creating this artifact, invoke the built-in expert skill "/[enhance-value]"
to review and enhance the content with expert perspective.
</enhance>
```

```xml
<provider>
This artifact is provided by the built-in expert skill "/[provider-value]".
Invoke the skill and save its output to [outputPath].
</provider>
```

skill 的实际内容已通过 `openspec init` 安装到了用户的 AI 工具目录中，AI 可以直接读取和执行。

### Decision 7：质量记忆反馈闭环

- `config.yaml` 新增 `quality-rules: string[]`
- instruction-loader 注入 `<quality-rules>` 到指令中
- archive 从质量工件提取 `[RULE]` 标记 → 追加到 config.yaml
- 注入顺序：`<context>` → `<rules>` → `<quality-rules>` → `<enhance/provider/structured-context>` → `<template>`

### Decision 8：Profile 系统扩展

OpenSpec 现有的 Profile 系统控制安装哪些工作流 skill：
- `core` profile → propose, explore, apply, archive
- `custom` profile → 用户自选

扩展 Profile 以支持专家 skill：
- 专家 skill 默认全部安装（与工作流 skill 不同，它们是独立能力而非工作流阶段）
- 用户可通过 `openspec config` 禁用不需要的专家 skill
- `getSkillTemplates(workflowFilter)` 函数扩展，专家 skill 不受 workflowFilter 影响

## Risks / Trade-offs

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| [包体积] 25+ skill 模板增加包大小 | 低 | skill 是纯文本，总计约 200-300KB |
| [上游 gstack 更新] 需同步 skill 变更 | 中 | skill 逻辑稳定后修改频率低；定期对比 diff 同步 |
| [Playwright 安装] 部分环境安装困难 | 中 | 作为 optionalDependencies，不影响非浏览器功能 |
| [skill 数量多] init 时生成大量文件 | 低 | 用户可通过 config 选择安装哪些专家 skill |
| [路径替换遗漏] 个别 skill 中可能遗漏 | 低 | 批量 grep 验证 + 逐个 skill 测试 |

## Migration Plan

1. **Phase 1 — skill 源文件迁入**：`skills/` 目录 + gen-skill-docs + browse
2. **Phase 2 — TypeScript 模板**：`src/core/templates/experts/` 模板函数 + 注册表扩展
3. **Phase 3 — Schema/DAG 扩展**：enhance/provider/context-from 字段
4. **Phase 4 — 质量闭环**：quality-rules 注入 + archive 捕获 + spec 场景解析
5. **Phase 5 — 测试验证**：端到端验证

## Open Questions

1. 专家 skill 模板函数是构建时从 SKILL.md 读取文件内容，还是直接内联字符串？→ 倾向构建时读取，保持 .tmpl 编辑体验
2. gstack 的 eval 测试体系是否迁入？→ 暂不迁入，后续独立变更
3. gstack-upgrade skill 重命名为什么？→ `skill-upgrade`，负责更新内置 skill
