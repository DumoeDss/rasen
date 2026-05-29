# 计划：编写 OpenSpec 项目中文技术文档

## Context

OpenSpec 是一个 AI 原生的规范驱动开发 CLI 工具（TypeScript/Node.js），帮助团队在编码前对齐规范，使 AI 编码助手更加可预测和高效。当前项目文档全部为英文（docs/ 下 11 个 md 文件），缺少面向中文开发者的技术文档。本任务旨在编写一份全面的中文文档，深入介绍项目架构、运作原理、核心概念等，帮助中文开发者快速理解项目全貌。

## 文档产出

在 `docs/` 目录下创建一个中文文档文件：

- **`docs/zh-CN-technical-overview.md`** — 项目完整中文技术文档

## 文档结构设计

```
# OpenSpec 技术文档（中文）

## 1. 项目概述
  - 项目定位与愿景
  - 核心理念（流动而非僵化、迭代而非瀑布、简单而非复杂、棕地优先）
  - 技术栈概览（TypeScript, Node.js ≥20.19, Commander.js, Zod, YAML 等）
  - 项目仓库结构总览（顶层目录树）

## 2. 核心概念
  - Spec（规范）：结构、Purpose、Requirements、Scenarios
  - Change（变更）：结构、Why、What Changes、Deltas
  - Delta 操作类型：ADDED / MODIFIED / REMOVED / RENAMED
  - Artifact（工件）：依赖关系、模板、指令
  - Schema（工作流模式）：artifact 定义与 apply 阶段
  - Profile（配置档）：core vs custom

## 3. 系统架构
  - 分层架构图（CLI → Commands → Core → Utils）
  - 各层职责说明
  - 模块依赖关系图
  - 数据流：Markdown 文件 → Parser → Zod 验证 → 类型化对象 → 处理/展示

## 4. CLI 命令体系
  - 命令分类总表（设置、浏览、验证、生命周期、工作流、配置、工具）
  - 全局选项说明
  - 关键命令详解：init, list, show, validate, archive, status, instructions
  - 斜杠命令（AI 工作流）：/opsx:propose → /opsx:apply → /opsx:archive

## 5. 核心模块详解

  ### 5.1 CLI 入口（src/cli/index.ts）
  - Commander.js 注册、前后钩子、遥测集成

  ### 5.2 命令层（src/commands/）
  - 各命令文件职责一览

  ### 5.3 数据解析（src/core/parsers/）
  - Markdown 解析器：section 分层提取
  - Change 解析器：Why/What Changes/Deltas 提取
  - 需求块解析：delta 语法解析

  ### 5.4 数据验证（src/core/validation/ + src/core/schemas/）
  - Zod Schema 定义（Spec、Change、Delta、Requirement、Scenario）
  - 验证器工作流程：Zod 解析 → 自定义规则 → 增强错误消息
  - 验证常量和约束（最小/最大长度、SHALL/MUST 关键词等）

  ### 5.5 Artifact Graph 系统（src/core/artifact-graph/）
  - 图数据结构与依赖解析
  - Schema YAML 加载与解析
  - 工件状态检测
  - 指令加载与上下文注入

  ### 5.6 AI 工具集成（src/core/command-generation/）
  - 适配器模式设计
  - ToolCommandAdapter 接口
  - 工厂与注册表
  - 支持的 20+ 工具列表及适配方式

  ### 5.7 配置系统
  - 全局配置（~/.config/openspec/config.json）
  - 项目配置（openspec/config.yaml）
  - XDG 合规性
  - Profile 与 Delivery 机制

  ### 5.8 归档系统（src/core/archive.ts + specs-apply.ts）
  - 归档工作流：验证 → 查找更新 → 构建更新 → 移动到归档 → 更新主 spec
  - Delta 应用算法

  ### 5.9 模板与工作流（src/core/templates/ + profiles.ts）
  - 工作流 Profile：core（4 个）vs custom（11 个）
  - 技能生成与命令文件创建

  ### 5.10 Shell 补全系统（src/core/completions/）
  - 支持的 Shell（Bash, Zsh, Fish, PowerShell）
  - 生成器与安装器

## 6. 工具与基础设施
  - 构建系统：TypeScript 编译、自定义 build.js
  - 测试框架：Vitest 配置、测试组织、fixture 模式
  - CI/CD：GitHub Actions 工作流
  - 版本管理：Changesets 工作流
  - 遥测系统：PostHog 匿名数据收集、隐私保护

## 7. 关键数据结构
  - TypeScript 类型定义一览表
  - Spec / Change / Delta / Requirement / Scenario / Artifact / SchemaYaml
  - ProjectConfig / GlobalConfig

## 8. 设计模式与架构决策
  - 适配器模式（AI 工具集成）
  - 图模式（Artifact 依赖解析）
  - 解析器模式（Markdown → 结构化数据）
  - 验证管道模式（Zod + 自定义规则 + 增强消息）
  - 配置分层模式（全局 + 项目级）

## 9. 开发指南
  - 环境搭建（Node.js, pnpm, 构建命令）
  - 运行测试
  - 贡献规范（Conventional Commits, Changesets）
  - ESLint 规则要点
```

## 实施步骤

### Step 1: 阅读关键源文件
需要精读以下文件以确保文档准确性：
- `src/cli/index.ts` — CLI 注册逻辑
- `src/core/artifact-graph/types.ts` — Artifact 类型定义
- `src/core/schemas/` — 数据模型定义
- `src/core/command-generation/types.ts` — 适配器接口
- `schemas/spec-driven/schema.yaml` — 默认工作流模式
- `src/core/profiles.ts` — Profile 定义
- `README.md` — 项目理念和概述

### Step 2: 编写文档
创建 `docs/zh-CN-technical-overview.md`，按上述结构逐节编写，包含：
- 文字描述 + ASCII 架构图/流程图
- 关键代码片段引用（类型定义、接口等）
- 文件路径引用方便导航

### Step 3: 校验
- 确保所有技术细节与源码一致
- 确保术语翻译准确（保留英文专有名词原文）
- 确保文档结构清晰、层次分明

## 关键源文件清单

| 文件路径 | 用途 |
|---------|------|
| `src/cli/index.ts` | CLI 入口与命令注册 |
| `src/commands/*.ts` | 各命令实现 |
| `src/core/artifact-graph/*.ts` | Artifact 图系统 |
| `src/core/command-generation/` | AI 工具适配器 |
| `src/core/parsers/*.ts` | Markdown 解析器 |
| `src/core/schemas/*.ts` | Zod 数据模型 |
| `src/core/validation/*.ts` | 验证引擎 |
| `src/core/config.ts` / `global-config.ts` / `project-config.ts` | 配置系统 |
| `src/core/archive.ts` / `specs-apply.ts` | 归档与 delta 应用 |
| `src/core/profiles.ts` | 工作流 Profile |
| `src/core/completions/` | Shell 补全 |
| `src/telemetry/` | 遥测系统 |
| `schemas/spec-driven/schema.yaml` | 默认工作流模式定义 |
| `package.json` | 项目元数据与依赖 |
| `README.md` | 项目概述 |

## 验证方式

1. 文档中引用的文件路径全部存在
2. 类型定义和接口描述与源码一致
3. 命令列表和选项与 CLI 注册代码匹配
4. 架构图准确反映模块依赖关系
