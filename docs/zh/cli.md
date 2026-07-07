# CLI 参考手册

OpenSpec CLI（`openspec`）提供了用于项目初始化、校验、状态检查和管理的终端命令。这些命令与 AI 斜杠命令（如 `/opsx:propose`）互为补充，后者参见[命令](commands.md)。

## 概览

| 类别 | 命令 | 用途 |
|------|------|------|
| **初始化** | `init`, `update` | 在项目中初始化和更新 OpenSpec |
| **Store（独立 OpenSpec 仓库）** | `store setup`, `store register`, `store unregister`, `store remove`, `store list`, `store doctor` | 管理 store——你已注册的独立 OpenSpec 仓库 |
| **健康检查** | `doctor` | 报告解析到的根及其引用关系的健康状况 |
| **工作上下文** | `context` | 组装工作集（根 + 被引用的 store） |
| **个人工作集** | `workset create`, `workset list`, `workset open`, `workset remove` | 在你的工具中保存并打开个人、本地的工作视图 |
| **浏览** | `list`, `view`, `show` | 浏览变更和规格说明 |
| **校验** | `validate` | 检查变更和规格说明是否存在问题 |
| **生命周期** | `archive` | 归档已完成的变更 |
| **工作流** | `new change`, `status`, `instructions`, `templates`, `schemas` | 基于制品（artifact）的工作流支持 |
| **Schema** | `schema init`, `schema fork`, `schema validate`, `schema which` | 创建和管理自定义工作流 |
| **配置** | `config` | 查看和修改设置 |
| **工具** | `feedback`, `completion` | 反馈和 shell 集成 |

---

## 人类命令与 Agent 命令

大多数 CLI 命令面向**在终端中使用的人类**。其中一部分也通过 JSON 输出支持 **agent/脚本**使用。

### 仅限人类的命令

这些命令是交互式的，面向终端使用：

| 命令 | 用途 |
|---------|---------|
| `openspec init` | 初始化项目（交互式提示） |
| `openspec view` | 交互式仪表盘 |
| `openspec workset open <name>` | 打开已保存的工作集（编辑器窗口或终端 agent 会话） |
| `openspec config edit` | 在编辑器中打开配置 |
| `openspec feedback` | 通过 GitHub 提交反馈 |
| `openspec completion install` | 安装 shell 补全 |

### 兼容 Agent 的命令

这些命令支持 `--json` 输出，便于 AI agent 和脚本以编程方式使用：

| 命令 | 人类使用 | Agent 使用 |
|---------|-----------|-----------|
| `openspec list` | 浏览变更/规格说明 | `--json` 获取结构化数据 |
| `openspec show <item>` | 读取内容 | `--json` 便于解析 |
| `openspec validate` | 检查问题 | `--all --json` 批量校验 |
| `openspec status` | 查看制品进度 | `--json` 获取结构化状态 |
| `openspec instructions` | 获取下一步操作 | `--json` 获取 agent 指令 |
| `openspec templates` | 查找模板路径 | `--json` 用于路径解析 |
| `openspec schemas` | 列出可用 schema | `--json` 用于 schema 发现 |
| `openspec store setup <id>` | 创建并注册本地 store | `--json` 配合显式输入，获取结构化的 setup 输出 |
| `openspec store register <path>` | 注册已存在的 store | `--json` 获取结构化的注册输出 |
| `openspec store unregister <id>` | 忘记本地 store 注册 | `--json` 获取结构化的清理输出 |
| `openspec store remove <id>` | 删除已注册的本地 store 文件夹 | `--yes --json` 非交互式删除 |
| `openspec store list` | 浏览已注册的 store | `--json` 获取结构化的注册信息 |
| `openspec store doctor` | 检查本地 store 配置 | `--json` 获取结构化诊断 |
| `openspec new change <id>` | 创建仓库本地的变更脚手架 | `--json`，另可加 `--store <id>` 将已注册的 store 用作 OpenSpec 根 |
| `openspec workset create [name]` | 组合个人工作视图 | `--member <path> --json` 非交互式组合 |
| `openspec workset list` | 浏览已保存的工作集 | `--json` 获取结构化视图 |
| `openspec workset remove <name>` | 删除已保存的视图 | `--yes --json` 非交互式删除 |

---

## 全局选项

以下选项适用于所有命令：

| 选项 | 说明 |
|--------|-------------|
| `--version`, `-V` | 显示版本号 |
| `--no-color` | 禁用彩色输出 |
| `--help`, `-h` | 显示命令帮助 |

---

## 初始化命令

### `openspec init`

在你的项目中初始化 OpenSpec。创建文件夹结构并配置 AI 工具集成。

默认行为使用全局配置默认值：profile 为 `core`、delivery 为 `both`、workflows 为 `propose, explore, apply, sync, archive`。

```
openspec init [path] [options]
```

**参数：**

| 参数 | 必填 | 说明 |
|----------|----------|-------------|
| `path` | 否 | 目标目录（默认：当前目录） |

**选项：**

| 选项 | 说明 |
|--------|-------------|
| `--tools <list>` | 非交互式配置 AI 工具。使用 `all`、`none` 或逗号分隔列表 |
| `--force` | 自动清理遗留文件，不提示 |
| `--profile <profile>` | 为本次 init 覆盖全局 profile（`core` 或 `custom`） |

`--profile custom` 使用全局配置中当前选中的 workflows（`openspec config profile`）。

**支持的工具 ID（`--tools`）：** `amazon-q`, `antigravity`, `auggie`, `bob`, `claude`, `cline`, `codex`, `forgecode`, `codebuddy`, `continue`, `costrict`, `crush`, `cursor`, `factory`, `gemini`, `github-copilot`, `iflow`, `junie`, `kilocode`, `kimi`, `kiro`, `lingma`, `vibe`, `opencode`, `pi`, `qoder`, `qwen`, `roocode`, `trae`, `windsurf`

> 此列表与 `src/core/config.ts` 中的 `AI_TOOLS` 对应。各工具的 skill 和命令路径参见[支持的工具](supported-tools.md)。

**示例：**

```bash
# 交互式初始化
openspec init

# 在指定目录初始化
openspec init ./my-project

# 非交互式：为 Claude 和 Cursor 配置
openspec init --tools claude,cursor

# 为所有支持的工具配置
openspec init --tools all

# 为本次运行覆盖 profile
openspec init --profile core

# 跳过提示并自动清理遗留文件
openspec init --force
```

**创建的内容：**

```
openspec/
├── specs/              # 你的规格说明（事实来源）
├── changes/            # 提议的变更
└── config.yaml         # 项目配置

.claude/skills/         # Claude Code skills（选中 claude 时）
.cursor/skills/         # Cursor skills（选中 cursor 时）
.cursor/commands/       # Cursor OPSX 命令（delivery 包含命令时）
... (其他工具配置)
```

---

### `openspec update`

升级 CLI 后更新 OpenSpec 指令文件。使用当前全局 profile、选中的 workflows 和 delivery 模式重新生成 AI 工具配置文件。

```
openspec update [path] [options]
```

**参数：**

| 参数 | 必填 | 说明 |
|----------|----------|-------------|
| `path` | 否 | 目标目录（默认：当前目录） |

**选项：**

| 选项 | 说明 |
|--------|-------------|
| `--force` | 即使文件已是最新也强制更新 |

**示例：**

```bash
# npm 升级后更新指令文件
npm update @fission-ai/openspec
openspec update
```

---

## Store（独立 OpenSpec 仓库）

> **Beta。** Store 及其上的功能（引用、工作上下文、工作集）是新特性；命令名、flag、文件格式和 JSON 输出在不同版本之间可能变化。以问题为导向的完整介绍参见 [store 指南](stores-beta/user-guide.md)。

Store 是你在这台机器上注册过的独立 OpenSpec 仓库——例如一个规划仓库或契约仓库。注册 store 后，常规命令（`list`、`show`、`status`、`validate`、`new change`、`archive`……）可通过 `--store <id>` 从任意位置在其中执行。

### `openspec store setup`

创建并注册一个本地 store。在终端中无参数运行时，OpenSpec 会引导用户完成 setup。Agent 和脚本应传入显式输入并使用 `--json`。

```bash
openspec store setup [id] [options]
```

**选项：**

| 选项 | 说明 |
|--------|-------------|
| `--path <path>` | store 所在文件夹（例如 `~/openspec/<id>`） |
| `--remote <url>` | 将权威 remote 记录到新 store 的 `store.yaml` |
| `--init-git` | 初始化 Git 仓库并创建初始提交（默认） |
| `--no-init-git` | 跳过所有 Git 操作：不 init、无初始提交 |
| `--json` | 输出 JSON |

非交互式运行（`--json`、脚本、agent）必须同时传入 store id 和 `--path`。在交互式终端中，setup 会在一个可见的、用户拥有的位置（例如 `~/openspec/<id>`）通过可编辑的建议来提示位置；它绝不默认使用 OpenSpec 的托管数据目录。

示例：

```bash
openspec store setup
openspec store setup team-context
openspec store setup team-context --path ~/openspec/team-context --no-init-git
openspec store setup team-context --path ~/openspec/team-context --no-init-git --json
```

### `openspec store register`

注册一个已存在的本地 store 文件夹。

```bash
openspec store register [path] [options]
```

**选项：**

| 选项 | 说明 |
|--------|-------------|
| `--id <id>` | store id；默认取 store 元数据或文件夹名 |
| `--yes` | 确认为健康的 OpenSpec 根创建 store 身份元数据 |
| `--json` | 输出 JSON |

### `openspec store unregister`

忘记一个本地 store 注册，但不删除文件。

```bash
openspec store unregister <id> [--json]
```

当 store 已被移动、克隆到别处，或不应再在本机的 OpenSpec 中显示时，使用此命令。

### `openspec store remove`

忘记一个本地 store 注册并删除其本地文件夹。

```bash
openspec store remove <id> [--yes] [--json]
```

在交互式终端中，`remove` 删除前会显示确切的文件夹。Agent、脚本和 JSON 调用方必须传 `--yes` 以确认删除。OpenSpec 拒绝删除不包含匹配 store 元数据的文件夹。

### `openspec store list`

列出本地已注册的 store。

```bash
openspec store list [--json]
openspec store ls [--json]
```

### `openspec store doctor`

检查本地 store 的注册、元数据和 Git 存在性。

```bash
openspec store doctor [id] [--json]
```

doctor 仅用于诊断；它报告缺失的根、元数据不匹配和无效的本地注册表状态，但不修改 store。

### 从项目引用 store

项目仓库可以在 `openspec/config.yaml` 中声明其工作所依赖的 store：

```yaml
schema: spec-driven
references:
  - team-context
```

此后，该仓库中的 `openspec instructions` 输出（包括逐制品和 `apply` 两种界面、JSON 与人类模式）会携带每个被引用 store 的规格说明索引——spec id、取自各 spec Purpose 部分的一句话摘要，以及获取命令（`openspec show <spec-id> --type spec --store <id>`）。该索引在每次运行时从已注册的检出实时构建；spec 内容从不被复制到输出中。

引用是只读上下文。它们绝不改变命令执行的位置：工作始终留在仓库自身的根中，向被引用的 store 写入仍需显式的 `--store` 操作。无法解析的引用（例如本机未注册的 store）会降级为索引中的一条警告并附带确切修复方法，而 instructions 仍会生成。`openspec doctor` 会在一处统一报告引用健康状况。

### 记录 store 的克隆来源

Store 可以在其提交的身份文件中记录权威克隆源，这样上手流程绝不会卡在"注册该 store"这一步：

```bash
openspec store setup team-context --path ~/openspec/team-context \
  --remote git@github.com:acme/team-context.git
```

该 remote 会落入初始提交内的 `.openspec-store/store.yaml`，因此每次克隆天生就知道它。对于已存在的 store，手工编辑 `store.yaml` 并提交。`store doctor` 会显示记录的 remote（以及检出的 Git origin）；setup/register 的共享指引会点名它；register 还会把检出的 origin 记录到机器本地注册表中。

引用声明也可以携带克隆源，这样尚未拥有该 store 的队友就能得到一条完整、可直接粘贴的修复命令（`git clone <remote> <path> && openspec store register <path> --id <id>`）：

```yaml
references:
  - { id: team-context, remote: "git@github.com:acme/team-context.git" }
```

记录 remote 并不是同步：OpenSpec 绝不自行 clone、pull 或 push。

### 声明默认 store

一个规划完全外置的仓库——没有本地 `openspec/specs/` 或 `openspec/changes/`——可以一次性声明其 store，而不必在每条命令上都加 `--store`：

```yaml
# openspec/config.yaml（openspec/ 下唯一的文件）
store: team-context
```

此后常规命令会自动解析到所声明的 store；根横幅和 JSON `root` 块会报告 `source: "declared"` 及 store id，打印的提示仍会带上 `--store <id>`。该声明是回退机制，绝非覆盖：显式的 `--store` 总是优先，而含有真实规划文件夹的目录会忽略该指针（并给出警告）。要把一个指针仓库转换为本地 OpenSpec 根，请删除 `store:` 行并运行 `openspec init`——声明存在时 init 会拒绝搭建脚手架。

## Doctor（关系健康）

一个只读问题，一处查看：OpenSpec 根是否健康？它引用的 store 在本机是否可用？

```bash
openspec doctor [--store <id>] [--json]
```

报告将根健康状况、store 元数据健康状况（包括记录的 remote 与检出 origin 不一致时的提示）和引用健康状况（与 instructions 所示相同的诊断，并为未解析的引用附带 clone 修复）分开呈现。任何严重程度的健康发现都以退出码 0 退出——agent 读取 `status` 数组；只有命令失败（无根、未知 store）才以退出码 1 退出。doctor 绝不 clone、同步或修复。要获取组装好的集合本身而非其健康状况，请使用 `openspec context`。

## 工作上下文（组装好的集合）

本次工作通过 OpenSpec 声明所关联的一切，集中于一个工作集：OpenSpec 根及其引用的 store。

```bash
openspec context [--store <id>] [--json] [--code-workspace <path> [--force]]
```

JSON 摘要可供 agent 消费（每个可用的被引用 store 都带有其获取配方；未解析的成员带有与 instructions 和 doctor 相同的修复方法）。`--code-workspace` 还会写入一个包含根及可用被引用 store（`ref:<id>` 文件夹）的 VS Code 工作区文件——这是本命令执行的唯一写操作，若文件已存在且未带 `--force` 则会拒绝。不可用的成员会被报告，绝不臆测。

"工作上下文"是组装好的集合；`openspec/config.yaml` 中的 `context:` 字段是注入到 instructions 中的项目背景——两者是不同事物。`openspec doctor` 回答集合是否健康；`openspec context` 回答集合是什么。

## 个人工作集

> **Beta。** 工作集是新 beta 界面的一部分；命令、flag 和文件格式在不同版本之间可能变化。完整介绍参见 [store 指南](stores-beta/user-guide.md#worksets-reopen-the-folders-you-work-on-together)。

工作集是你一起工作的那些文件夹的个人化、具名视图——一个规划根加上你选择的任何其他文件夹——保存在你的机器上，并可在你的工具中按名称重新打开。它是纯本地的：从不提交、从不共享、从不派生自声明，且删除一个工作集绝不触及任何成员文件夹。

```bash
openspec workset create [name] [--member <path> | --member <name>=<path>]... [--tool <id>] [--json]
openspec workset list [--json]
openspec workset open <name> [--tool <id>]
openspec workset remove <name> [--yes] [--json]
```

`create` 运行一段简短的引导流程（或通过 `--member` flag 非交互式接收；第一个成员是主成员——会话从这里开始）。`open` 启动所选工具：编辑器（VS Code、Cursor）打开一个包含所有成员的窗口并返回；CLI agent（Claude Code、codex）接管当前终端作为会话，附加所有成员且不预填提示，在你退出时结束。open 时缺失的成员文件夹会被跳过并给出提示，其余照常打开。保存的工具偏好可在每次 open 时用 `--tool` 覆盖。

支持一个新工具是配置而非代码。每个工具属于两种启动风格之一——`workspace-file`（用生成的 `.code-workspace` 启动）或 `attach-dirs`（每个成员一个 attach flag）——全局 `config.json` 中的 `openers` 键（用 `openspec config edit` 打开）可按字段添加工具或调整内置项：

```json
{
  "openers": {
    "zed": { "style": "workspace-file" },
    "claude": { "attach_flag": "--dir" }
  }
}
```

所有工作集状态都位于全局数据目录的 `worksets/` 文件夹下（保存的视图加上生成的 `<name>.code-workspace` 文件，在每次 open 时重新生成）；删除该文件夹即移除一切痕迹。

---

## 浏览命令

### `openspec list`

列出你项目中的变更或规格说明。

```
openspec list [options]
```

**选项：**

| 选项 | 说明 |
|--------|-------------|
| `--specs` | 列出规格说明而非变更 |
| `--changes` | 列出变更（默认） |
| `--sort <order>` | 按 `recent`（默认）或 `name` 排序 |
| `--json` | 输出为 JSON |

**示例：**

```bash
# 列出所有活跃变更
openspec list

# 列出所有规格说明
openspec list --specs

# 供脚本使用的 JSON 输出
openspec list --json
```

**输出（文本）：**

```
Changes:
  add-dark-mode     No tasks      just now
```

---

### `openspec view`

显示一个用于浏览规格说明和变更的交互式仪表盘。

```
openspec view
```

打开一个基于终端的界面，用于浏览你项目的规格说明和变更。

---

### `openspec show`

显示某个变更或规格说明的详情。

```
openspec show [item-name] [options]
```

**参数：**

| 参数 | 必填 | 说明 |
|----------|----------|-------------|
| `item-name` | 否 | 变更或规格说明的名称（省略时提示输入） |

**选项：**

| 选项 | 说明 |
|--------|-------------|
| `--type <type>` | 指定类型：`change` 或 `spec`（无歧义时自动检测） |
| `--json` | 输出为 JSON |
| `--no-interactive` | 禁用提示 |

**变更专属选项：**

| 选项 | 说明 |
|--------|-------------|
| `--deltas-only` | 仅显示增量 spec（JSON 模式） |

**规格说明专属选项：**

| 选项 | 说明 |
|--------|-------------|
| `--requirements` | 仅显示需求，排除场景（JSON 模式） |
| `--no-scenarios` | 排除场景内容（JSON 模式） |
| `-r, --requirement <id>` | 按 1 基索引显示特定需求（JSON 模式） |

**示例：**

```bash
# 交互式选择
openspec show

# 显示特定变更
openspec show add-dark-mode

# 显示特定规格说明
openspec show auth --type spec

# 供解析的 JSON 输出
openspec show add-dark-mode --json
```

---

## 校验命令

### `openspec validate`

校验变更和规格说明的结构性问题。

```
openspec validate [item-name] [options]
```

**参数：**

| 参数 | 必填 | 说明 |
|----------|----------|-------------|
| `item-name` | 否 | 要校验的特定项（省略时提示输入） |

**选项：**

| 选项 | 说明 |
|--------|-------------|
| `--all` | 校验所有变更和规格说明 |
| `--changes` | 校验所有变更 |
| `--specs` | 校验所有规格说明 |
| `--type <type>` | 名称有歧义时指定类型：`change` 或 `spec` |
| `--strict` | 启用严格校验模式 |
| `--json` | 输出为 JSON |
| `--concurrency <n>` | 最大并行校验数（默认：6，或 `OPENSPEC_CONCURRENCY` 环境变量） |
| `--no-interactive` | 禁用提示 |

**示例：**

```bash
# 交互式校验
openspec validate

# 校验特定变更
openspec validate add-dark-mode

# 校验所有变更
openspec validate --changes

# 带 JSON 输出校验全部（供 CI/脚本）
openspec validate --all --json

# 严格校验并提高并行度
openspec validate --all --strict --concurrency 12
```

**输出（文本）：**

```
Validating add-dark-mode...
  ✓ proposal.md valid
  ✓ specs/ui/spec.md valid
  ⚠ design.md: missing "Technical Approach" section

1 warning found
```

**输出（JSON）：**

```json
{
  "version": "1.0.0",
  "results": {
    "changes": [
      {
        "name": "add-dark-mode",
        "valid": true,
        "warnings": ["design.md: missing 'Technical Approach' section"]
      }
    ]
  },
  "summary": {
    "total": 1,
    "valid": 1,
    "invalid": 0
  }
}
```

---

## 生命周期命令

### `openspec archive`

归档已完成的变更，并将增量 spec 合并进主规格说明。

```
openspec archive [change-name] [options]
```

**参数：**

| 参数 | 必填 | 说明 |
|----------|----------|-------------|
| `change-name` | 否 | 要归档的变更（省略时提示输入） |

**选项：**

| 选项 | 说明 |
|--------|-------------|
| `-y, --yes` | 跳过确认提示 |
| `--skip-specs` | 跳过规格说明更新（适用于基础设施/工具/纯文档变更） |
| `--no-validate` | 跳过校验（需要确认） |

**示例：**

```bash
# 交互式归档
openspec archive

# 归档特定变更
openspec archive add-dark-mode

# 无提示归档（CI/脚本）
openspec archive add-dark-mode --yes

# 归档不影响规格说明的工具类变更
openspec archive update-ci-config --skip-specs
```

**执行的操作：**

1. 校验该变更（除非 `--no-validate`）
2. 提示确认（除非 `--yes`）
3. 将增量 spec 合并进 `openspec/specs/`
4. 把变更文件夹移动到 `openspec/changes/archive/YYYY-MM-DD-<name>/`

---

## 工作流命令

这些命令支持基于制品的 OPSX 工作流。它们既适用于人类查看进度，也适用于 agent 确定下一步操作。

### `openspec new change`

在解析到的 OpenSpec 根中创建变更目录和可选的、纳入版本控制的元数据。

```bash
openspec new change <name> [options]
```

**选项：**

| 选项 | 说明 |
|--------|-------------|
| `--description <text>` | 要添加到 `README.md` 的描述 |
| `--goal <text>` | 随变更存储的可选 goal 元数据 |
| `--schema <name>` | 要使用的工作流 schema |
| `--store <id>` | 用作 OpenSpec 根的 store id（store 是你已注册的独立 OpenSpec 仓库） |
| `--json` | 输出 JSON |

示例：

```bash
openspec new change add-billing-api
openspec new change add-billing-api --store team-context --json
```

### `openspec status`

显示某变更的制品完成状态。

```
openspec status [options]
```

**选项：**

| 选项 | 说明 |
|--------|-------------|
| `--change <id>` | 变更名称（省略时提示输入） |
| `--schema <name>` | schema 覆盖（从变更的 config 自动检测） |
| `--json` | 输出为 JSON |

**示例：**

```bash
# 交互式状态检查
openspec status

# 特定变更的状态
openspec status --change add-dark-mode

# 供 agent 使用的 JSON
openspec status --change add-dark-mode --json
```

**输出（文本）：**

```
Change: add-dark-mode
Schema: spec-driven
Progress: 2/4 artifacts complete

[x] proposal
[ ] design
[x] specs
[-] tasks (blocked by: design)
```

**输出（JSON）：**

```json
{
  "changeName": "add-dark-mode",
  "schemaName": "spec-driven",
  "isComplete": false,
  "applyRequires": ["tasks"],
  "artifacts": [
    {"id": "proposal", "outputPath": "proposal.md", "status": "done"},
    {"id": "design", "outputPath": "design.md", "status": "ready"},
    {"id": "specs", "outputPath": "specs/**/*.md", "status": "done"},
    {"id": "tasks", "outputPath": "tasks.md", "status": "blocked", "missingDeps": ["design"]}
  ]
}
```

---

### `openspec instructions`

获取用于创建制品或应用任务的增强指令。AI agent 用它来理解接下来要创建什么。

```
openspec instructions [artifact] [options]
```

**参数：**

| 参数 | 必填 | 说明 |
|----------|----------|-------------|
| `artifact` | 否 | 制品 ID：`proposal`、`specs`、`design`、`tasks` 或 `apply` |

**选项：**

| 选项 | 说明 |
|--------|-------------|
| `--change <id>` | 变更名称（非交互模式下必填） |
| `--schema <name>` | schema 覆盖 |
| `--json` | 输出为 JSON |

**特殊情况：** 将 `apply` 作为 artifact 以获取任务实现指令。

**示例：**

```bash
# 获取下一个制品的指令
openspec instructions --change add-dark-mode

# 获取特定制品的指令
openspec instructions design --change add-dark-mode

# 获取 apply/实现指令
openspec instructions apply --change add-dark-mode

# 供 agent 消费的 JSON
openspec instructions design --change add-dark-mode --json
```

**输出包含：**

- 该制品的模板内容
- 来自 config 的项目上下文
- 来自依赖制品的内容
- 来自 config 的逐制品规则

---

### `openspec templates`

显示某 schema 中所有制品解析后的模板路径。

```
openspec templates [options]
```

**选项：**

| 选项 | 说明 |
|--------|-------------|
| `--schema <name>` | 要查看的 schema（默认：`spec-driven`） |
| `--json` | 输出为 JSON |

**示例：**

```bash
# 显示默认 schema 的模板路径
openspec templates

# 显示自定义 schema 的模板
openspec templates --schema my-workflow

# 供编程使用的 JSON
openspec templates --json
```

**输出（文本）：**

```
Schema: spec-driven

Templates:
  proposal  → ~/.openspec/schemas/spec-driven/templates/proposal.md
  specs     → ~/.openspec/schemas/spec-driven/templates/specs.md
  design    → ~/.openspec/schemas/spec-driven/templates/design.md
  tasks     → ~/.openspec/schemas/spec-driven/templates/tasks.md
```

---

### `openspec schemas`

列出可用的工作流 schema 及其描述和制品流程。

```
openspec schemas [options]
```

**选项：**

| 选项 | 说明 |
|--------|-------------|
| `--json` | 输出为 JSON |

**示例：**

```bash
openspec schemas
```

**输出：**

```
Available schemas:

  spec-driven (package)
    The default spec-driven development workflow
    Flow: proposal → specs → design → tasks

  my-custom (project)
    Custom workflow for this project
    Flow: research → proposal → tasks
```

---

## Schema 命令

用于创建和管理自定义工作流 schema 的命令。

### `openspec schema init`

创建一个新的项目本地 schema。

```
openspec schema init <name> [options]
```

**参数：**

| 参数 | 必填 | 说明 |
|----------|----------|-------------|
| `name` | 是 | schema 名称（kebab-case） |

**选项：**

| 选项 | 说明 |
|--------|-------------|
| `--description <text>` | schema 描述 |
| `--artifacts <list>` | 逗号分隔的制品 ID（默认：`proposal,specs,design,tasks`） |
| `--default` | 设为项目默认 schema |
| `--no-default` | 不提示设为默认 |
| `--force` | 覆盖已存在的 schema |
| `--json` | 输出为 JSON |

**示例：**

```bash
# 交互式创建 schema
openspec schema init research-first

# 非交互式并指定制品
openspec schema init rapid \
  --description "Rapid iteration workflow" \
  --artifacts "proposal,tasks" \
  --default
```

**创建的内容：**

```
openspec/schemas/<name>/
├── schema.yaml           # schema 定义
└── templates/
    ├── proposal.md       # 每个制品的模板
    ├── specs.md
    ├── design.md
    └── tasks.md
```

---

### `openspec schema fork`

将一个已存在的 schema 复制到你的项目以供定制。

```
openspec schema fork <source> [name] [options]
```

**参数：**

| 参数 | 必填 | 说明 |
|----------|----------|-------------|
| `source` | 是 | 要复制的 schema |
| `name` | 否 | 新 schema 名称（默认：`<source>-custom`） |

**选项：**

| 选项 | 说明 |
|--------|-------------|
| `--force` | 覆盖已存在的目标 |
| `--json` | 输出为 JSON |

**示例：**

```bash
# fork 内置的 spec-driven schema
openspec schema fork spec-driven my-workflow
```

---

### `openspec schema validate`

校验某 schema 的结构和模板。

```
openspec schema validate [name] [options]
```

**参数：**

| 参数 | 必填 | 说明 |
|----------|----------|-------------|
| `name` | 否 | 要校验的 schema（省略时校验全部） |

**选项：**

| 选项 | 说明 |
|--------|-------------|
| `--verbose` | 显示详细的校验步骤 |
| `--json` | 输出为 JSON |

**示例：**

```bash
# 校验特定 schema
openspec schema validate my-workflow

# 校验所有 schema
openspec schema validate
```

---

### `openspec schema which`

显示某 schema 解析自何处（用于调试优先级）。

```
openspec schema which [name] [options]
```

**参数：**

| 参数 | 必填 | 说明 |
|----------|----------|-------------|
| `name` | 否 | schema 名称 |

**选项：**

| 选项 | 说明 |
|--------|-------------|
| `--all` | 列出所有 schema 及其来源 |
| `--json` | 输出为 JSON |

**示例：**

```bash
# 检查某 schema 来自何处
openspec schema which spec-driven
```

**输出：**

```
spec-driven resolves from: package
  Source: /usr/local/lib/node_modules/@fission-ai/openspec/schemas/spec-driven
```

**schema 优先级：**

1. 项目：`openspec/schemas/<name>/`
2. 用户：`~/.local/share/openspec/schemas/<name>/`
3. 包：内置 schema

---

## 配置命令

### `openspec config`

查看和修改全局 OpenSpec 配置。

```
openspec config <subcommand> [options]
```

**子命令：**

| 子命令 | 说明 |
|------------|-------------|
| `path` | 显示配置文件位置 |
| `list` | 显示所有当前设置 |
| `get <key>` | 获取特定值 |
| `set <key> <value>` | 设置一个值 |
| `unset <key>` | 移除一个键 |
| `reset` | 重置为默认值 |
| `edit` | 在 `$EDITOR` 中打开 |
| `profile [preset]` | 交互式或通过预设配置工作流 profile |

**示例：**

```bash
# 显示配置文件路径
openspec config path

# 列出所有设置
openspec config list

# 获取特定值
openspec config get telemetry.enabled

# 设置一个值
openspec config set telemetry.enabled false

# 显式设置字符串值
openspec config set user.name "My Name" --string

# 移除自定义设置
openspec config unset user.name

# 重置全部配置
openspec config reset --all --yes

# 在你的编辑器中编辑配置
openspec config edit

# 通过基于 action 的向导配置 profile
openspec config profile

# 快速预设：将 workflows 切换为 core（保留 delivery 模式）
openspec config profile core
```

`openspec config profile` 以当前状态摘要开始，随后让你选择：
- 更改 delivery + workflows
- 仅更改 delivery
- 仅更改 workflows
- 保持当前设置（退出）

若保持当前设置，不会写入任何更改，也不会显示更新提示。
若没有配置更改，但当前项目文件与你的全局 profile/delivery 不同步，OpenSpec 会显示警告并建议 `openspec update`。
按 `Ctrl+C` 也会干净地取消该流程（无堆栈跟踪）并以退出码 `130` 退出。
在工作流清单中，`[x]` 表示该工作流已在全局配置中选中。要将这些选择应用到项目文件，请运行 `openspec update`（或在项目内出现提示时选择 `Apply changes to this project now?`）。

**交互式示例：**

```bash
# 仅更新 delivery
openspec config profile
# 选择：仅更改 delivery
# 选择 delivery：仅 skills

# 仅更新 workflows
openspec config profile
# 选择：仅更改 workflows
# 在清单中切换 workflows，然后确认
```

---

## 工具命令

### `openspec feedback`

提交关于 OpenSpec 的反馈。会创建一个 GitHub issue。

```
openspec feedback <message> [options]
```

**参数：**

| 参数 | 必填 | 说明 |
|----------|----------|-------------|
| `message` | 是 | 反馈消息 |

**选项：**

| 选项 | 说明 |
|--------|-------------|
| `--body <text>` | 详细描述 |

**要求：** 必须安装并通过认证 GitHub CLI（`gh`）。

**示例：**

```bash
openspec feedback "Add support for custom artifact types" \
  --body "I'd like to define my own artifact types beyond the built-in ones."
```

---

### `openspec completion`

管理 OpenSpec CLI 的 shell 补全。

```
openspec completion <subcommand> [shell]
```

**子命令：**

| 子命令 | 说明 |
|------------|-------------|
| `generate [shell]` | 将补全脚本输出到 stdout |
| `install [shell]` | 为你的 shell 安装补全 |
| `uninstall [shell]` | 移除已安装的补全 |

**支持的 shell：** `bash`, `zsh`, `fish`, `powershell`

**示例：**

```bash
# 安装补全（自动检测 shell）
openspec completion install

# 为特定 shell 安装
openspec completion install zsh

# 生成脚本以供手动安装
openspec completion generate bash > ~/.bash_completion.d/openspec

# 卸载
openspec completion uninstall
```

---

## 退出码

| 码 | 含义 |
|------|---------|
| `0` | 成功 |
| `1` | 错误（校验失败、文件缺失等） |

---

## 环境变量

| 变量 | 说明 |
|----------|-------------|
| `OPENSPEC_TELEMETRY` | 设为 `0` 禁用遥测 |
| `DO_NOT_TRACK` | 设为 `1` 禁用遥测（标准 DNT 信号） |
| `OPENSPEC_CONCURRENCY` | 批量校验的默认并发数（默认：6） |
| `EDITOR` 或 `VISUAL` | `openspec config edit` 使用的编辑器 |
| `NO_COLOR` | 设置时禁用彩色输出 |

---

## 相关文档

- [命令](commands.md) - AI 斜杠命令（`/opsx:propose`、`/opsx:apply` 等）
- [工作流](workflows.md) - 常见模式和各命令的适用时机
- [自定义](customization.md) - 创建自定义 schema 和模板
- [入门指南](getting-started.md) - 首次设置指南
