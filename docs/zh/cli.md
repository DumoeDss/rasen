# CLI 参考手册

rasen CLI（`rasen`）提供了用于项目初始化、校验、状态检查和管理的终端命令。这些命令与 AI 斜杠命令（如 `/rasen-propose`）互为补充，后者参见[命令](commands.md)。

## 概览

| 类别 | 命令 | 用途 |
|------|------|------|
| **初始化** | `init`, `update` | 在项目中初始化和更新 rasen |
| **Store（独立 rasen 仓库）** | `store setup`, `store register`, `store unregister`, `store remove`, `store list`, `store doctor` | 管理 store——你已注册的独立 rasen 仓库 |
| **健康检查** | `doctor` | 报告解析到的根及其引用关系的健康状况 |
| **工作上下文** | `context` | 组装工作集（根 + 被引用的 store） |
| **个人工作集** | `workset create`, `workset list`, `workset open`, `workset remove` | 在你的工具中保存并打开个人、本地的工作视图 |
| **浏览** | `list`, `view`, `show` | 浏览变更和规格说明 |
| **校验** | `validate` | 检查变更和规格说明是否存在问题 |
| **生命周期** | `archive` | 归档已完成的变更 |
| **工作流** | `new change`, `status`, `instructions`, `templates`, `schemas` | 基于产物（artifact）的工作流支持 |
| **工作流库** | `workflow list/show/which/init/validate/import/export/delete` | 管理面向整机的可安装工作流 |
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
| `rasen init` | 初始化项目（交互式提示） |
| `rasen view` | 交互式仪表盘 |
| `rasen workset open <name>` | 打开已保存的工作集（编辑器窗口或终端 agent 会话） |
| `rasen config edit` | 在编辑器中打开配置 |
| `rasen feedback` | 通过 GitHub 提交反馈 |
| `rasen completion install` | 安装 shell 补全 |

### 兼容 Agent 的命令

这些命令支持 `--json` 输出，便于 AI agent 和脚本以编程方式使用：

| 命令 | 人类使用 | Agent 使用 |
|---------|-----------|-----------|
| `rasen list` | 浏览变更/规格说明 | `--json` 获取结构化数据 |
| `rasen show <item>` | 读取内容 | `--json` 便于解析 |
| `rasen validate` | 检查问题 | `--all --json` 批量校验 |
| `rasen status` | 查看产物进度 | `--json` 获取结构化状态 |
| `rasen instructions` | 获取下一步操作 | `--json` 获取 agent 指令 |
| `rasen templates` | 查找模板路径 | `--json` 用于路径解析 |
| `rasen schemas` | 列出可用 schema | `--json` 用于 schema 发现 |
| `rasen store setup <id>` | 创建并注册本地 store | `--json` 配合显式输入，获取结构化的 setup 输出 |
| `rasen store register <path>` | 注册已存在的 store | `--json` 获取结构化的注册输出 |
| `rasen store unregister <id>` | 忘记本地 store 注册 | `--json` 获取结构化的清理输出 |
| `rasen store remove <id>` | 删除已注册的本地 store 文件夹 | `--yes --json` 非交互式删除 |
| `rasen store list` | 浏览已注册的 store | `--json` 获取结构化的注册信息 |
| `rasen store doctor` | 检查本地 store 配置 | `--json` 获取结构化诊断 |
| `rasen new change <id>` | 创建仓库本地的变更脚手架 | `--json`，另可加 `--store <id>` 将已注册的 store 用作 Rasen 根 |
| `rasen workset create [name]` | 组合个人工作视图 | `--member <path> --json` 非交互式组合 |
| `rasen workset list` | 浏览已保存的工作集 | `--json` 获取结构化视图 |
| `rasen workset remove <name>` | 删除已保存的视图 | `--yes --json` 非交互式删除 |

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

### `rasen init`

在你的项目中初始化 rasen。创建文件夹结构并配置 AI 工具集成。

默认行为使用全局配置默认值：profile 为 `core`、delivery 为 `both`、workflows 为 `propose, explore, apply, sync, archive`。

```
rasen init [path] [options]
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

`--profile custom` 使用全局配置中当前选中的 workflows（`rasen config profile`）。

**支持的工具 ID（`--tools`）：** `amazon-q`, `antigravity`, `auggie`, `bob`, `claude`, `cline`, `codex`, `forgecode`, `codebuddy`, `continue`, `costrict`, `crush`, `cursor`, `factory`, `gemini`, `github-copilot`, `iflow`, `junie`, `kilocode`, `kimi`, `kiro`, `lingma`, `vibe`, `opencode`, `pi`, `qoder`, `qwen`, `roocode`, `trae`, `windsurf`

> 此列表与 `src/core/config.ts` 中的 `AI_TOOLS` 对应。各工具的 skill 和命令路径参见[支持的工具](supported-tools.md)。

**示例：**

```bash
# 交互式初始化
rasen init

# 在指定目录初始化
rasen init ./my-project

# 非交互式：为 Claude 和 Cursor 配置
rasen init --tools claude,cursor

# 为所有支持的工具配置
rasen init --tools all

# 为本次运行覆盖 profile
rasen init --profile core

# 跳过提示并自动清理遗留文件
rasen init --force
```

**创建的内容：**

```
rasen/
├── specs/              # 你的规格说明（事实来源）
├── changes/            # 提议的变更
└── config.yaml         # 项目配置

.claude/skills/         # Claude Code skills（选中 claude 时）
.cursor/skills/         # Cursor skills（选中 cursor 时）
.cursor/commands/       # Cursor rasen 命令（delivery 为 both 时）
... (其他工具配置)
```

---

### `rasen update`

升级 CLI 后更新 rasen 指令文件。使用当前全局 profile、选中的 workflows 和 delivery 模式重新生成 AI 工具配置文件。

```
rasen update [path] [options]
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
npm update @atelierai/rasen
rasen update
```

---

## Store（独立 rasen 仓库）

> **Beta。** Store 及其上的功能（引用、工作上下文、工作集）是新特性；命令名、flag、文件格式和 JSON 输出在不同版本之间可能变化。以问题为导向的完整介绍参见 [store 指南](stores-beta/user-guide.md)。

Store 是你在这台机器上注册过的独立 rasen 仓库——例如一个规划仓库或契约仓库。注册 store 后，常规命令（`list`、`show`、`status`、`validate`、`new change`、`archive`……）可通过 `--store <id>` 从任意位置在其中执行。

### `rasen store setup`

创建并注册一个本地 store。在终端中无参数运行时，Rasen 会引导用户完成 setup。Agent 和脚本应传入显式输入并使用 `--json`。

```bash
rasen store setup [id] [options]
```

**选项：**

| 选项 | 说明 |
|--------|-------------|
| `--path <path>` | store 所在文件夹（例如 `~/rasen/<id>`） |
| `--remote <url>` | 将权威 remote 记录到新 store 的 `store.yaml` |
| `--init-git` | 初始化 Git 仓库并创建初始提交（默认） |
| `--no-init-git` | 跳过所有 Git 操作：不 init、无初始提交 |
| `--json` | 输出 JSON |

非交互式运行（`--json`、脚本、agent）必须同时传入 store id 和 `--path`。在交互式终端中，setup 会在一个可见的、用户拥有的位置（例如 `~/rasen/<id>`）通过可编辑的建议来提示位置；它绝不默认使用 rasen 的托管数据目录。

示例：

```bash
rasen store setup
rasen store setup team-context
rasen store setup team-context --path ~/rasen/team-context --no-init-git
rasen store setup team-context --path ~/rasen/team-context --no-init-git --json
```

### `rasen store register`

注册一个已存在的本地 store 文件夹。

```bash
rasen store register [path] [options]
```

**选项：**

| 选项 | 说明 |
|--------|-------------|
| `--id <id>` | store id；默认取 store 元数据或文件夹名 |
| `--yes` | 确认为健康的 Rasen 根创建 store 身份元数据 |
| `--json` | 输出 JSON |

### `rasen store unregister`

忘记一个本地 store 注册，但不删除文件。

```bash
rasen store unregister <id> [--json]
```

当 store 已被移动、克隆到别处，或不应再在本机的 rasen 中显示时，使用此命令。

### `rasen store remove`

忘记一个本地 store 注册并删除其本地文件夹。

```bash
rasen store remove <id> [--yes] [--json]
```

在交互式终端中，`remove` 删除前会显示确切的文件夹。Agent、脚本和 JSON 调用方必须传 `--yes` 以确认删除。Rasen 拒绝删除不包含匹配 store 元数据的文件夹。

### `rasen store list`

列出本地已注册的 store。

```bash
rasen store list [--json]
rasen store ls [--json]
```

### `rasen store doctor`

检查本地 store 的注册、元数据和 Git 存在性。

```bash
rasen store doctor [id] [--json]
```

doctor 仅用于诊断；它报告缺失的根、元数据不匹配和无效的本地注册表状态，但不修改 store。

### 从项目引用 store

项目仓库可以在 `rasen/config.yaml` 中声明其工作所依赖的 store：

```yaml
schema: spec-driven
references:
  - team-context
```

此后，该仓库中的 `rasen instructions` 输出（包括逐产物和 `apply` 两种界面、JSON 与人类模式）会携带每个被引用 store 的规格说明索引——spec id、取自各 spec Purpose 部分的一句话摘要，以及获取命令（`rasen show <spec-id> --type spec --store <id>`）。该索引在每次运行时从已注册的检出实时构建；spec 内容从不被复制到输出中。

引用是只读上下文。它们绝不改变命令执行的位置：工作始终留在仓库自身的根中，向被引用的 store 写入仍需显式的 `--store` 操作。无法解析的引用（例如本机未注册的 store）会降级为索引中的一条警告并附带确切修复方法，而 instructions 仍会生成。`rasen doctor` 会在一处统一报告引用健康状况。

### 记录 store 的克隆来源

Store 可以在其提交的身份文件中记录权威克隆源，这样上手流程绝不会卡在"注册该 store"这一步：

```bash
rasen store setup team-context --path ~/rasen/team-context \
  --remote git@github.com:acme/team-context.git
```

该 remote 会落入初始提交内的 `.rasen-store/store.yaml`，因此每次克隆天生就知道它。对于已存在的 store，手工编辑 `store.yaml` 并提交。`store doctor` 会显示记录的 remote（以及检出的 Git origin）；setup/register 的共享指引会点名它；register 还会把检出的 origin 记录到机器本地注册表中。

引用声明也可以携带克隆源，这样尚未拥有该 store 的队友就能得到一条完整、可直接粘贴的修复命令（`git clone <remote> <path> && rasen store register <path> --id <id>`）：

```yaml
references:
  - { id: team-context, remote: "git@github.com:acme/team-context.git" }
```

记录 remote 并不是同步：rasen 绝不自行 clone、pull 或 push。

### 声明默认 store

一个规划完全外置的仓库——没有本地 `rasen/specs/` 或 `rasen/changes/`——可以一次性声明其 store，而不必在每条命令上都加 `--store`：

```yaml
# rasen/config.yaml（rasen/ 下唯一的文件）
store: team-context
```

此后常规命令会自动解析到所声明的 store；根横幅和 JSON `root` 块会报告 `source: "declared"` 及 store id，打印的提示仍会带上 `--store <id>`。该声明是回退机制，绝非覆盖：显式的 `--store` 总是优先，而含有真实规划文件夹的目录会忽略该指针（并给出警告）。要把一个指针仓库转换为本地 Rasen 根，请删除 `store:` 行并运行 `rasen init`——声明存在时 init 会拒绝搭建脚手架。

## Doctor（关系健康）

一个只读问题，一处查看：Rasen 根是否健康？它引用的 store 在本机是否可用？

```bash
rasen doctor [--store <id>] [--json]
```

报告将根健康状况、store 元数据健康状况（包括记录的 remote 与检出 origin 不一致时的提示）和引用健康状况（与 instructions 所示相同的诊断，并为未解析的引用附带 clone 修复）分开呈现。任何严重程度的健康发现都以退出码 0 退出——agent 读取 `status` 数组；只有命令失败（无根、未知 store）才以退出码 1 退出。doctor 绝不 clone、同步或修复。要获取组装好的集合本身而非其健康状况，请使用 `rasen context`。

## 工作上下文（组装好的集合）

本次工作通过 rasen 声明所关联的一切，集中于一个工作集：Rasen 根及其引用的 store。

```bash
rasen context [--store <id>] [--json] [--code-workspace <path> [--force]]
```

JSON 摘要可供 agent 消费（每个可用的被引用 store 都带有其获取配方；未解析的成员带有与 instructions 和 doctor 相同的修复方法）。`--code-workspace` 还会写入一个包含根及可用被引用 store（`ref:<id>` 文件夹）的 VS Code 工作区文件——这是本命令执行的唯一写操作，若文件已存在且未带 `--force` 则会拒绝。不可用的成员会被报告，绝不臆测。

"工作上下文"是组装好的集合；`rasen/config.yaml` 中的 `context:` 字段是注入到 instructions 中的项目背景——两者是不同事物。`rasen doctor` 回答集合是否健康；`rasen context` 回答集合是什么。

## 个人工作集

> **Beta。** 工作集是新 beta 界面的一部分；命令、flag 和文件格式在不同版本之间可能变化。完整介绍参见 [store 指南](stores-beta/user-guide.md#workset重新打开你一起工作的那些文件夹)。

工作集是你一起工作的那些文件夹的个人化、具名视图——一个规划根加上你选择的任何其他文件夹——保存在你的机器上，并可在你的工具中按名称重新打开。它是纯本地的：从不提交、从不共享、从不派生自声明，且删除一个工作集绝不触及任何成员文件夹。

```bash
rasen workset create [name] [--member <path> | --member <name>=<path>]... [--tool <id>] [--json]
rasen workset list [--json]
rasen workset open <name> [--tool <id>]
rasen workset remove <name> [--yes] [--json]
```

`create` 运行一段简短的引导流程（或通过 `--member` flag 非交互式接收；第一个成员是主成员——会话从这里开始）。`open` 启动所选工具：编辑器（VS Code、Cursor）打开一个包含所有成员的窗口并返回；CLI agent（Claude Code、codex）接管当前终端作为会话，附加所有成员且不预填提示，在你退出时结束。open 时缺失的成员文件夹会被跳过并给出提示，其余照常打开。保存的工具偏好可在每次 open 时用 `--tool` 覆盖。

支持一个新工具是配置而非代码。每个工具属于两种启动风格之一——`workspace-file`（用生成的 `.code-workspace` 启动）或 `attach-dirs`（每个成员一个 attach flag）——全局 `config.json` 中的 `openers` 键（用 `rasen config edit` 打开）可按字段添加工具或调整内置项：

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

### `rasen list`

列出你项目中的变更或规格说明。

```
rasen list [options]
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
rasen list

# 列出所有规格说明
rasen list --specs

# 供脚本使用的 JSON 输出
rasen list --json
```

**输出（文本）：**

```
Changes:
  add-dark-mode     No tasks      just now
```

---

### `rasen view`

显示一个用于浏览规格说明和变更的交互式仪表盘。

```
rasen view
```

打开一个基于终端的界面，用于浏览你项目的规格说明和变更。

---

### `rasen show`

显示某个变更或规格说明的详情。

```
rasen show [item-name] [options]
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
rasen show

# 显示特定变更
rasen show add-dark-mode

# 显示特定规格说明
rasen show auth --type spec

# 供解析的 JSON 输出
rasen show add-dark-mode --json
```

---

## 校验命令

### `rasen validate`

校验变更和规格说明的结构性问题。

```
rasen validate [item-name] [options]
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
| `--concurrency <n>` | 最大并行校验数（默认：6，或 `RASEN_CONCURRENCY` 环境变量） |
| `--no-interactive` | 禁用提示 |

**示例：**

```bash
# 交互式校验
rasen validate

# 校验特定变更
rasen validate add-dark-mode

# 校验所有变更
rasen validate --changes

# 带 JSON 输出校验全部（供 CI/脚本）
rasen validate --all --json

# 严格校验并提高并行度
rasen validate --all --strict --concurrency 12
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

### `rasen archive`

归档已完成的变更，并将增量 spec 合并进主规格说明。

```
rasen archive [change-name] [options]
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
rasen archive

# 归档特定变更
rasen archive add-dark-mode

# 无提示归档（CI/脚本）
rasen archive add-dark-mode --yes

# 归档不影响规格说明的工具类变更
rasen archive update-ci-config --skip-specs
```

**执行的操作：**

1. 校验该变更（除非 `--no-validate`）
2. 提示确认（除非 `--yes`）
3. 将增量 spec 合并进 `rasen/specs/`
4. 把变更文件夹移动到 `rasen/changes/archive/YYYY-MM-DD-<name>/`

---

## 工作流命令

这些命令支持制品工作流。它们既适用于人类查看进度，也适用于 agent 确定下一步操作。

### `rasen new change`

在解析到的 Rasen 根中创建变更目录和可选的、纳入版本控制的元数据。

```bash
rasen new change <name> [options]
```

**选项：**

| 选项 | 说明 |
|--------|-------------|
| `--description <text>` | 要添加到 `README.md` 的描述 |
| `--goal <text>` | 随变更存储的可选 goal 元数据 |
| `--schema <name>` | 要使用的工作流 schema |
| `--store <id>` | 用作 Rasen 根的 store id（store 是你已注册的独立 rasen 仓库） |
| `--json` | 输出 JSON |

示例：

```bash
rasen new change add-billing-api
rasen new change add-billing-api --store team-context --json
```

### `rasen status`

显示某变更的产物完成状态。

```
rasen status [options]
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
rasen status

# 特定变更的状态
rasen status --change add-dark-mode

# 供 agent 使用的 JSON
rasen status --change add-dark-mode --json
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

### `rasen instructions`

获取用于创建产物或应用任务的增强指令。AI agent 用它来理解接下来要创建什么。

```
rasen instructions [artifact] [options]
```

**参数：**

| 参数 | 必填 | 说明 |
|----------|----------|-------------|
| `artifact` | 否 | 产物 ID：`proposal`、`specs`、`design`、`tasks` 或 `apply` |

**选项：**

| 选项 | 说明 |
|--------|-------------|
| `--change <id>` | 变更名称（非交互模式下必填） |
| `--schema <name>` | schema 覆盖 |
| `--json` | 输出为 JSON |

**特殊情况：** 将 `apply` 作为 artifact 以获取任务实现指令。

**示例：**

```bash
# 获取下一个产物的指令
rasen instructions --change add-dark-mode

# 获取特定产物的指令
rasen instructions design --change add-dark-mode

# 获取 apply/实现指令
rasen instructions apply --change add-dark-mode

# 供 agent 消费的 JSON
rasen instructions design --change add-dark-mode --json
```

**输出包含：**

- 该产物的模板内容
- 来自 config 的项目上下文
- 来自依赖产物的内容
- 来自 config 的逐产物规则

---

### `rasen templates`

显示某 schema 中所有产物解析后的模板路径。

```
rasen templates [options]
```

**选项：**

| 选项 | 说明 |
|--------|-------------|
| `--schema <name>` | 要查看的 schema（默认：`spec-driven`） |
| `--json` | 输出为 JSON |

**示例：**

```bash
# 显示默认 schema 的模板路径
rasen templates

# 显示自定义 schema 的模板
rasen templates --schema my-workflow

# 供编程使用的 JSON
rasen templates --json
```

**输出（文本）：**

```
Schema: spec-driven

Templates:
  proposal  → ~/.rasen/schemas/spec-driven/templates/proposal.md
  specs     → ~/.rasen/schemas/spec-driven/templates/specs.md
  design    → ~/.rasen/schemas/spec-driven/templates/design.md
  tasks     → ~/.rasen/schemas/spec-driven/templates/tasks.md
```

---

### `rasen schemas`

列出可用的工作流 schema 及其描述和产物流程。

```
rasen schemas [options]
```

**选项：**

| 选项 | 说明 |
|--------|-------------|
| `--json` | 输出为 JSON |

**示例：**

```bash
rasen schemas
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

### `rasen schema init`

创建一个新的项目本地 schema。

```
rasen schema init <name> [options]
```

**参数：**

| 参数 | 必填 | 说明 |
|----------|----------|-------------|
| `name` | 是 | schema 名称（kebab-case） |

**选项：**

| 选项 | 说明 |
|--------|-------------|
| `--description <text>` | schema 描述 |
| `--artifacts <list>` | 逗号分隔的产物 ID（默认：`proposal,specs,design,tasks`） |
| `--default` | 设为项目默认 schema |
| `--no-default` | 不提示设为默认 |
| `--force` | 覆盖已存在的 schema |
| `--json` | 输出为 JSON |

**示例：**

```bash
# 交互式创建 schema
rasen schema init research-first

# 非交互式并指定产物
rasen schema init rapid \
  --description "Rapid iteration workflow" \
  --artifacts "proposal,tasks" \
  --default
```

**创建的内容：**

```
rasen/schemas/<name>/
├── schema.yaml           # schema 定义
└── templates/
    ├── proposal.md       # 每个产物的模板
    ├── specs.md
    ├── design.md
    └── tasks.md
```

---

### `rasen schema fork`

将一个已存在的 schema 复制到你的项目以供定制。

```
rasen schema fork <source> [name] [options]
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
rasen schema fork spec-driven my-workflow
```

---

### `rasen schema validate`

校验某 schema 的结构和模板。

```
rasen schema validate [name] [options]
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
rasen schema validate my-workflow

# 校验所有 schema
rasen schema validate
```

---

### `rasen schema which`

显示某 schema 解析自何处（用于调试优先级）。

```
rasen schema which [name] [options]
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
rasen schema which spec-driven
```

**输出：**

```
spec-driven resolves from: package
  Source: /usr/local/lib/node_modules/@atelierai/rasen/schemas/spec-driven
```

**schema 优先级：**

1. 项目：`rasen/schemas/<name>/`
2. 用户：`~/.rasen/schemas/<name>/`
3. 包：内置 schema

---

## 配置命令

### CLI 界面语言

Rasen CLI 支持英语（`en`）、日语（`ja`）和简体中文（`zh-cn`）界面。机器全局 JSON 配置使用规范值 `language: "auto" | "en" | "ja" | "zh-cn"`；持久化设置只接受这些值，不会把 `zh-CN` 或 `zh_CN` 自动改写为 `zh-cn`。

```bash
# 持久化简体中文界面
rasen config set language zh-cn

# 仅为当前进程临时覆盖界面语言
RASEN_LANG=zh-cn rasen --help
```

`RASEN_LANG=en|ja|zh-cn` 会临时覆盖已保存的设置。默认的 `auto` 模式在类 Unix 系统上依次检查 `LC_ALL`、`LC_MESSAGES` 和 `LANG`，然后使用运行时系统语言环境；Windows 直接使用运行时系统语言环境。`zh-CN`、`zh_CN.UTF-8`、`zh-SG`、`zh-Hans` 和不带区域的 `zh` 会解析为 `zh-cn`。繁体中文语言环境 `zh-TW`、`zh-HK`、`zh-MO` 和 `zh-Hant` 暂不支持，并回退到英语。

界面语言只控制 Rasen 自有的帮助、提示和人类可读输出，不决定 AI 生成的产物语言。产物语言应通过项目 `rasen/config.yaml` 的 `context` 指令设置，详见[多语言指南](multi-language.md)。更改已保存的界面语言后，请重新运行 `rasen completion install [shell]`；如果手动管理补全脚本，则重新运行 `rasen completion generate [shell]`，以刷新生成的命令说明。

### `rasen workflow`

管理面向整机（machine-wide）用户库中的可安装工作流。这些命令操作的是工作流定义本身，不是产物 schema，也不是编排 pipeline。

```text
rasen workflow list [--unused] [--all] [--json]
rasen workflow show <id> [--json]
rasen workflow which <id> [--json]
rasen workflow init <id> --output <path> [--json]
rasen workflow validate <id-or-path> [--json]
rasen workflow import <path> [--json]
rasen workflow export <id> <path> [--force] [--json]
rasen workflow delete <id> [--yes] [--json]
```

| 子命令 | 说明 |
|------------|-------------|
| `list` | 按 kind 分组列出有效的内置/用户定义，以及无效的用户条目；`--unused` 仅供参考，只考虑可探测到的使用方；`--all` 会额外显示 internal 分组 |
| `show <id>` | 显示身份信息、skill/command 元数据、依赖、文件、digest 以及已知的使用情况 |
| `which <id>` | 显示某个 ID 是解析自内置目录还是用户目录 |
| `init <id>` | 在必须为空的 `--output` 目录下创建最小草稿，不安装它 |
| `validate <id-or-path>` | 静态校验一个已安装的 ID、一个未打包的草稿，或一个严格模式的 `.rasenpkg`，不执行脚本 |
| `import <path>` | 校验、暂存、复校，然后原子化安装一个未打包的工作流或 `kind: workflow` 包 |
| `export <id> <path>` | 将某个用户工作流及其所需的用户工作流依赖闭包导出为确定性的 `.rasenpkg`；内置工作流不可导出 |
| `delete <id>` | 在使用情况预检和确认后，删除一个未被引用的用户工作流；内置工作流不可删除 |

每个 JSON 成功响应都包含 `status: []`。失败时会输出一份 JSON 文档，其 `status` 条目携带稳定的 `severity`、`code`、`message` 字段。例如：

```json
{
  "workflow": null,
  "usage": [],
  "status": [
    {
      "severity": "error",
      "code": "workflow_not_found",
      "message": "Workflow \"missing\" was not found"
    }
  ]
}
```

`delete` 会扫描全局选中项、已保存的 profile、反向依赖、用户/当前项目的 pipeline，以及当前项目的产物管理台账。它无法证明没有其他未知项目在别处引用该工作流，因此即便删除成功，也会打印这一限制说明。关于清单（manifest）、包、digest、路径与资源限制的约定，参见[可安装工作流与 `.rasenpkg`](workflow-packages.md)。

**kind 分类**：每个工作流定义都带有一个 `kind` —— `task`（可直接调用的内循环操作）、`driver`（消费 pipeline 的外循环引擎，例如 `auto-command`/`goal-command`），或 `internal`（仅由某个 driver 调用的子单元，例如 `goal-plan`/`goal-iterate`/`goal-report` 三件套）。面向人类的 `list` 表格会把条目分为 `task` 和 `driver` 两组，并默认隐藏 `internal`，除非传入 `--all`。`--json` 始终列出全部工作流（不分组），并带上各自的 `kind`——机器消费者无论是否传 `--all` 都能看到完整目录。用户工作流的 `workflow.yaml` 默认 `kind: task`，也可以选择声明 `kind: internal`；`driver` 保留给内置引擎使用。`kind` 只是呈现层元数据——它从不进入工作流的 digest，因此分类或重新分类一个工作流永远不会触发 drift-healing。

### `rasen pipeline`

检查、打包、安装并移除编排 pipeline——串联工作流的外循环 DAG（schema/workflow/pipeline 模型见[概念](concepts.md)）。Pipeline 按以下优先级从三层解析（从高到低）：project（`rasen/pipelines/<name>/pipeline.yaml`）、user（通过 `import` 安装，机器全局）、package（内置，随 rasen 发布）。

```text
rasen pipeline list [--json]
rasen pipeline show <name> [--for-execution] [--json]
rasen pipeline agents <name> [--planner|--implementer|--reviewer|--fixer|--shipper <runtime>] [--json]
rasen pipeline classify <task> [--json]
rasen pipeline resume <change> [--json]
rasen pipeline init <name> --output <path> [--json]
rasen pipeline validate <name-or-path> [--json]
rasen pipeline import <path> [--force] [--json]
rasen pipeline export <name> <path> [--force] [--json]
rasen pipeline delete <name> [--yes] [--force] [--json]
```

全部十个子命令都接受 `--store <id>` / `--project <id>`，其根解析方式与 `rasen validate` 完全一致。

全部十个子命令的帮助和 Rasen 自有的人类可读输出都支持英语、日语和简体中文。本地化只改变呈现：pipeline 与 stage ID、role/runtime/source 值、路径、JSON 字段与原始描述，以及分类器的关键词、`suggested`、`matched` 和 `basis` 语义都保持不变。项目和用户编写的名称与描述保留原文；只有包内置流水线（pipeline）的描述会在人类视图中本地化，其 JSON 描述仍保留原始值。

| 子命令 | 说明 |
|------------|-------------|
| `list` | 列出可用 pipeline（project > user > package），含描述与 stage id |
| `show <name>` | 显示某 pipeline 的 stage DAG、build order，以及解析后的逐 stage runtime/handoff/reuse 配置；`--for-execution` 还会校验当前 profile 下的 skill |
| `agents <name>` | 显示或（写入项目级覆盖）设置逐角色的 Claude/Codex runtime |
| `classify <task>` | 用建议性的关键词启发式方法为任务字符串推荐一个 pipeline |
| `resume <change>` | 根据 run-state 显示某 change（或 portfolio）的下一个/剩余 stage |
| `init <name>` | 在必须为空的 `--output` 目录下创建最小 `pipeline.yaml` 草稿，不安装它 |
| `validate <name-or-path>` | 对已安装的 pipeline 名、草稿目录，或 `kind: pipeline` 的 `.rasenpkg` 做结构性校验（解析、重复/环/parallel-group/decompose stage 检查）；不要求所引用的 skill 已安装 |
| `import <path>` | 校验、暂存、复校 digest，然后把 `kind: pipeline` 包中的每个 pipeline 原子化安装进 user 层；`--force` 允许覆盖同名的已安装 pipeline |
| `export <name> <path>` | 将一个已安装的 **user** pipeline 打包为确定性的 `.rasenpkg`；内置与项目本地 pipeline 不可导出 |
| `delete <name>` | 在引用计数检查后删除一个未被引用的 user pipeline；内置 pipeline 不可删除 |

`.rasenpkg` 携带一个 `kind` 判别字段——`workflow`、`profile`、或 `pipeline`——共享同一套包格式。`kind: pipeline` 包的 digest、事务性安装（暂存到临时目录 → 原子重命名，包内全部 pipeline 要么全装要么全不装）与文件限额规则，均与[可安装工作流与 `.rasenpkg`](workflow-packages.md)中 `kind: workflow` 的约定一致。每个包还携带一个可选的 `minRasenVersion`，在打包时由打包 CLI 自身版本戳入：较旧的 CLI 导入一个要求更新版本的包时，会收到清晰的升级提示，而不是含糊的 schema 错误。这个预检只对本次改动之后的 CLI 生效——早于此字段存在的已发布 CLI，遇到无法识别的包 `kind` 时仍会含糊拒绝，无法回补。

`delete` 的引用计数守卫会拒绝删除被任一已安装工作流的 `requires.pipelines`、或另一个 pipeline 的 `decompose` stage 的 `childPipeline`（显式声明或默认的 `small-feature`）所引用的 pipeline，并列出每个引用方；`--force` 会绕过该守卫（但不会绕过对内置 pipeline 的禁止删除），并警告哪些引用方将变成悬空引用。

内置 pipeline 中的 stage `skill:` 字段使用工作流目录名形式（`rasen-propose`、`rasen-review`）；`validate` 与包导入仍接受已退役的 skill 名冒号形式（`rasen:review`）以保持向后兼容，且不要求该 skill 在导入时已安装——缺失的 skill 会在执行期才被捕获。

### `rasen config`

查看和修改全局 rasen 配置。

```
rasen config <subcommand> [options]
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
rasen config path

# 列出所有设置
rasen config list

# 获取特定值
rasen config get telemetry.enabled

# 设置一个值
rasen config set telemetry.enabled false

# 显式设置字符串值
rasen config set user.name "My Name" --string

# 移除自定义设置
rasen config unset user.name

# 重置全部配置
rasen config reset --all --yes

# 在你的编辑器中编辑配置
rasen config edit

# 通过基于 action 的向导配置 profile
rasen config profile

# 快速预设：将 workflows 切换为 core（保留 delivery 模式）
rasen config profile core
```

`rasen config profile` 以当前状态摘要开始，随后让你选择：
- 更改 delivery + workflows
- 仅更改 delivery
- 仅更改 workflows
- 保持当前设置（退出）

若保持当前设置，不会写入任何更改，也不会显示更新提示。
若没有配置更改，但当前项目文件与你的全局 profile/delivery 不同步，rasen 会显示警告并建议 `rasen update`。
按 `Ctrl+C` 也会干净地取消该流程（无堆栈跟踪）并以退出码 `130` 退出。
在工作流清单中，`[x]` 表示该工作流已在全局配置中选中。要将这些选择应用到项目文件，请运行 `rasen update`（或在项目内出现提示时选择 `Apply changes to this project now?`）。

**交互式示例：**

```bash
# 仅更新 delivery
rasen config profile
# 选择：仅更改 delivery
# 选择 delivery：仅 skills

# 仅更新 workflows
rasen config profile
# 选择：仅更改 workflows
# 在清单中切换 workflows，然后确认
```

---

## 工具命令

### `rasen feedback`

提交关于 rasen 的反馈。会创建一个 GitHub issue。

```
rasen feedback <message> [options]
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
rasen feedback "Add support for custom artifact types" \
  --body "I'd like to define my own artifact types beyond the built-in ones."
```

---

### `rasen completion`

管理 rasen CLI 的 shell 补全。

```
rasen completion <subcommand> [shell]
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
rasen completion install

# 为特定 shell 安装
rasen completion install zsh

# 生成脚本以供手动安装
rasen completion generate bash > ~/.bash_completion.d/rasen

# 卸载
rasen completion uninstall
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
| `RASEN_TELEMETRY` | 设为 `0` 禁用遥测 |
| `DO_NOT_TRACK` | 设为 `1` 禁用遥测（标准 DNT 信号） |
| `RASEN_CONCURRENCY` | 批量校验的默认并发数（默认：6） |
| `RASEN_LANG` | 临时覆盖已保存的 CLI 界面语言（`en`、`ja` 或 `zh-cn`） |
| `EDITOR` 或 `VISUAL` | `rasen config edit` 使用的编辑器 |
| `NO_COLOR` | 设置时禁用彩色输出 |

---

## 相关文档

- [命令](commands.md) - AI 斜杠命令（`/rasen-propose`、`/rasen-apply-change` 等）
- [工作流](workflows.md) - 常见模式和各命令的适用时机
- [自定义](customization.md) - 创建自定义 schema 和模板
- [入门指南](getting-started.md) - 首次设置指南
