## Why

OpenSpec 提供了优秀的工件 DAG 和变更生命周期管理，但在代码审查、浏览器测试、安全审计、发布部署等执行层面完全空白。gstack 提供了 25+ 专家角色（SKILL.md 提示词模板）和高性能 headless 浏览器，覆盖完整开发周期，但缺乏结构化工作流和规范管理。

当前的 fusion 层方案在两个系统外部用 SKILL.md 编排，只能做文件复制和 LLM 推理衔接，无法实现数据管道级的深度融合。正确的方案是将 gstack 的全部资产迁入 OpenSpec 项目中，复用 OpenSpec 已有的 skill 生成体系（`SkillTemplate` → `skill-generation.ts` → `openspec init` 写入目标工具目录），在保持 gstack 逻辑不变的前提下与 OpenSpec 深度融合为一个统一产品。

## What Changes

- **gstack 专家 skill 融入 OpenSpec 模板体系**：将 gstack 的 25+ skill 提示词内容转为 `src/core/templates/experts/` 下的 TypeScript 模板函数（与现有 `src/core/templates/workflows/` 平行），SKILL.md.tmpl 源文件保留在 `skills/` 目录供开发编辑，通过 gen-skill-docs 构建链生成最终内容。注册到 `skill-generation.ts` 中，`openspec init` 时自动安装到用户的 AI 工具目录。
- **browse 浏览器工具链迁入**：将 gstack 的 `browse/` 目录整体迁入 OpenSpec，保持其 Bun 构建流程不变（OpenSpec 支持 Bun 安装），作为内置浏览器模块。
- **模板生成器迁入**：将 gstack 的 `scripts/gen-skill-docs.ts` 迁入 OpenSpec 构建工具链，负责从 `skills/` 下的 `.tmpl` 源文件生成 SKILL.md 内容，再被 TypeScript 模板函数读入。
- **Schema 系统扩展**：artifact 定义新增 `enhance`、`provider`、`context-from` 可选字段，使专家 skill 增强和质量工件成为 DAG 一等公民。
- **instruction-loader 扩展**：新增 `quality-rules` 注入层（质量记忆反馈闭环），以及对 enhance/provider/context-from 的指令生成。
- **spec 场景解析器**：从 spec 场景（WHEN/THEN）提取结构化 TestPlan，供 QA skill 的 context-from 消费。
- **archive 扩展**：归档时从质量工件中提取摘要和可复用规则，自动写入 config.yaml。
- **默认 schema 升级**：`spec-driven` schema 扩展为包含 enhance 字段的完整工作流。

## Capabilities

### New Capabilities
- `gstack-skills-integration`: 将 gstack 的 25+ 专家 skill 融入 OpenSpec 的 SkillTemplate 模板体系和 skill-generation 注册表
- `browse-integration`: 将 gstack 的 headless Chromium 浏览器工具链迁入 `browse/` 目录
- `skill-template-generator`: 将 gstack 的 gen-skill-docs.ts 模板生成器迁入 OpenSpec 构建流程，支持 `.tmpl` → SKILL.md 生成
- `schema-enhance-field`: Schema artifact 定义支持 `enhance` 可选字段
- `schema-provider-field`: Schema artifact 定义支持 `provider` 可选字段
- `schema-context-from-field`: Schema artifact 定义支持 `context-from` 可选字段
- `quality-rules-injection`: instruction-loader 注入 `quality-rules` 到工件创建指令中
- `spec-scenario-parser`: 从 spec 场景提取结构化 TestPlan 数据
- `archive-quality-capture`: 归档时提取质量摘要并自动生成 quality-rules

### Modified Capabilities
- `artifact-graph`: Schema 解析逻辑扩展，支持三个新字段的验证
- `instruction-loader`: 模板富化逻辑扩展，支持 quality-rules/enhance/provider/structured-context 注入
- `context-injection`: 注入顺序扩展，在 rules 之后增加 quality-rules 层
- `cli-archive`: 归档流程扩展，增加质量摘要提取和 quality-rules 生成步骤
- `config-loading`: 项目配置解析扩展，支持 `quality-rules` 字段
- `command-generation`: skill-generation 注册表扩展，注册 25+ 专家 skill 模板，`openspec init` 时自动安装

## Impact

- **模板体系**：新增 `src/core/templates/experts/`（25+ 专家 skill 模板函数），与现有 `workflows/` 平行
- **Skill 源文件**：新增 `skills/`（25+ SKILL.md.tmpl 源文件 + SKILL.md 构建产物），供开发编辑和 gen-skill-docs 使用
- **注册表** (`src/core/shared/skill-generation.ts`)：新增 25+ 专家 skill 的 `SkillTemplateEntry` 注册
- **浏览器模块**：新增 `browse/`（Playwright CLI 源码 + 编译二进制）
- **构建系统** (`package.json`, `build.js`)：集成 gen-skill-docs 和 browse 二进制编译
- **Schema 数据模型** (`src/core/artifact-graph/schema.ts`)：Zod schema 新增可选字段
- **指令加载器** (`src/core/artifact-graph/instruction-loader.ts`)：新增多层注入逻辑
- **场景解析器** (`src/core/parsers/requirement-blocks.ts`)：新增 TestPlan 提取函数
- **归档逻辑** (`src/core/archive.ts`)：新增质量捕获
- **项目配置** (`src/core/project-config.ts`)：新增 quality-rules 字段
- **默认 schema** (`schemas/spec-driven/schema.yaml`)：升级为含 enhance 字段的完整工作流
- **依赖项**：新增 Playwright（optionalDependencies）
- **向后兼容**：所有新字段/新 skill 均为可选；不使用专家 skill 时行为完全不变
