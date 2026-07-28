# 多语言指南

配置 rasen 以生成英语以外的其他语言的产出物。

## 界面语言与产物语言

CLI 界面语言和生成的产物语言是两项独立设置。机器全局配置中的 `language: "auto" | "en" | "ja" | "zh-cn"` 或临时的 `RASEN_LANG=en|ja|zh-cn` 只控制 Rasen 自有的帮助、提示和人类可读输出；切换界面语言不会翻译已有产物或用户编写的工作流、流水线描述。

产物语言由项目 `rasen/config.yaml` 的 `context` 指令交给 AI 助手执行。更改这段指令不会改变 CLI 界面语言；要使用简体中文界面，请设置 `rasen config set language zh-cn`。以下示例配置的是产物语言。

## 快速设置

在你的 `rasen/config.yaml` 中添加语言指令：

```yaml
schema: spec-driven

context: |
  Language: Portuguese (pt-BR)
  All artifacts must be written in Brazilian Portuguese.

  # Your other project context below...
  Tech stack: TypeScript, React, Node.js
```

就这样。所有生成的产出物现在都将使用葡萄牙语。

## 语言示例

### 葡萄牙语（巴西）

```yaml
context: |
  Language: Portuguese (pt-BR)
  All artifacts must be written in Brazilian Portuguese.
```

### 西班牙语

```yaml
context: |
  Idioma: Español
  Todos los artefactos deben escribirse en español.
```

### 中文（简体）

```yaml
context: |
  语言：中文（简体）
  所有产出物必须用简体中文撰写。
```

### 日语

```yaml
context: |
  言語：日本語
  すべての成果物は日本語で作成してください。
```

### 法语

```yaml
context: |
  Langue : Français
  Tous les artefacts doivent être rédigés en français.
```

### 德语

```yaml
context: |
  Sprache: Deutsch
  Alle Artefakte müssen auf Deutsch verfasst werden.
```

## 提示

### 处理技术术语

决定如何处理技术术语：

```yaml
context: |
  Language: Japanese
  Write in Japanese, but:
  - Keep technical terms like "API", "REST", "GraphQL" in English
  - Code examples and file paths remain in English
```

### 与其他上下文组合使用

语言设置可以与你的其他项目上下文一起使用：

```yaml
schema: spec-driven

context: |
  Language: Portuguese (pt-BR)
  All artifacts must be written in Brazilian Portuguese.

  Tech stack: TypeScript, React 18, Node.js 20
  Database: PostgreSQL with Prisma ORM
```

## 验证

要验证你的语言配置是否生效：

```bash
# 查看 instructions——应显示你的语言上下文
rasen instructions proposal --change my-change

# 输出会包含你的语言上下文
```

## 相关文档

- [自定义指南](./customization.md) - 项目配置选项
- [工作流指南](./workflows.md) - 完整的工作流文档
