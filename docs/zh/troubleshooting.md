# 故障排查

针对具体问题的具体修复。每一条都点出一个症状，用一句话解释可能的原因，并给出修复办法。如果你在这里没找到自己的问题，[FAQ](faq.md) 也许能帮上忙，而 [Discord](https://discord.gg/YctCnvvshC) 几乎一定能。

## 安装与设置

### `openspec: command not found`

CLI 没有安装，或者你的 shell 找不到它。全局安装并检查：

```bash
npm install -g @fission-ai/openspec@latest
openspec --version
```

如果已安装但仍然找不到，多半是你全局 npm 的 bin 目录不在 `PATH` 里。运行 `npm bin -g` 查看全局二进制文件所在位置，并确保该路径出现在你的 shell 配置里。

### “Requires Node.js 20.19.0 or higher”

OpenSpec 运行在 Node 20.19.0+ 上。检查你的版本，必要时升级：

```bash
node --version
```

如果你是用 bun 安装的 OpenSpec，请注意 OpenSpec 仍然*运行在* Node 之上，所以无论如何你都需要在 `PATH` 中可用、版本为 20.19.0+ 的 Node。参见[安装](installation.md)。

### `openspec init` 没有配置我的 AI 工具

init 会询问要设置哪些工具。如果你跳过了你的工具，或者想再加一个，重新运行即可，或使用非交互式形式：

```bash
openspec init --tools claude,cursor
```

完整的工具 ID 列表见[支持的工具](supported-tools.md)。用 `--tools all` 安装全部，用 `--tools none` 跳过工具设置。

## 命令没有出现

如果 `/opsx:propose`（或你的工具里的等价命令）不出现，或没有任何反应，按以下清单依次排查。它们按“最快能检查”的顺序排列。

1. **你可能找错了地方。** 斜杠命令是在你的 AI 助手的聊天里输入的，而不是终端里。如果你把 `/opsx:propose` 输进了 shell，那就是问题所在。参见[命令是如何工作的](how-commands-work.md)。

2. **重新生成文件。** 在你的项目根目录下：

   ```bash
   openspec update
   ```

   这会为你配置的每一个工具重写技能和命令文件。

3. **重启你的助手。** 大多数工具在启动时扫描技能和命令。开一个新窗口往往就能解决。

4. **确认文件存在。** 对于 Claude Code，检查 `.claude/skills/` 是否包含 `openspec-*` 文件夹。其他工具使用各自的目录，全部列在[支持的工具](supported-tools.md)里。

5. **检查你是否初始化了这个项目。** 技能是按项目写入的。如果你克隆了一个仓库或切换了文件夹，就在那里运行 `openspec init`（或 `openspec update`）。

6. **确认你的工具支持命令文件。** 少数工具（Kimi CLI、Trae、ForgeCode、Mistral Vibe）不会生成 `opsx-*` 命令文件；它们改用基于技能的调用方式。各工具的形式有所不同：参见[支持的工具](supported-tools.md)和[命令是如何工作的](how-commands-work.md#各工具的斜杠命令语法)。

## 处理变更

### “Change not found”

命令无法判断你指的是哪次变更。显式地命名它，或查看现有的变更：

```bash
openspec list                    # see active changes
/opsx:apply add-dark-mode        # name the change in chat
```

同时确认你处在正确的项目目录里。

### “No artifacts ready”

每个产物要么已经创建，要么正被某个依赖阻塞。看看是什么在阻塞：

```bash
openspec status --change <name>
```

然后先创建缺失的依赖。记住顺序：proposal 解锁 specs 和 design；specs 和 design 一起解锁 tasks。

### `openspec validate` 报告警告或错误

校验会检查你的规格和变更是否存在结构问题。阅读提示信息：它会点出文件和问题所在。

```bash
openspec validate <name>           # validate one item
openspec validate --all            # validate everything
openspec validate --all --strict   # stricter checks, good for CI
```

常见原因包括缺少必要的章节（比如一份没有场景的规格），或增量头部格式有误。修复文件后重新运行。[CLI 参考](cli.md#openspec-validate)文档说明了输出格式。

### AI 创建了不完整或错误的产物

AI 没有足够的上下文。几个杠杆会有帮助：

- 在 `openspec/config.yaml` 中添加项目上下文，这样你的技术栈和约定会被注入每一次请求。参见[自定义](customization.md#项目配置)。
- 添加按产物分类的 `rules:`，用于只在（比如说）specs 上生效的指导。
- 在提出变更时给出更详细的描述。
- 使用扩展的 `/opsx:continue`，一次创建一个产物并逐一评审，而不是用 `/opsx:ff` 一次性全部生成。

### 归档无法完成，或警告任务未完成

归档不会因任务未完成而*阻塞*，但它会警告你，因为归档通常意味着工作已经完成。如果任务是刻意保留的（你正在提交一次不完整的变更），那就继续。否则，请先把任务做完。归档还会提议把你的增量规格同步进主规格（如果你还没同步的话）；除非你有理由拒绝，否则就同意。

## 配置

### 我的 `config.yaml` 没有生效

通常有三个嫌疑：

1. **文件名不对。** 必须是 `openspec/config.yaml`，而不是 `.yml`。
2. **YAML 无效。** 用任意 YAML 校验器跑一遍；CLI 也会带行号报告语法错误。
3. **你以为需要重启。** 不需要。配置改动立即生效。

### “Unknown artifact ID in rules: X”

`rules:` 下的某个键与你 schema 中的任何产物都不匹配。对于默认的 `spec-driven` schema，合法的 ID 是 `proposal`、`specs`、`design`、`tasks`。要查看任意 schema 的 ID：

```bash
openspec schemas --json
```

### “Context too large”

`context:` 字段被限制在 50KB，这是有意为之，因为它会被注入每一次请求。把它精简一下，或者改为链接到更长的文档，而不是整段粘贴。精简的上下文还能带来更好、更快的结果。

### “Schema not found”

你引用的 schema 名称不存在。列出可用的 schema 并检查拼写：

```bash
openspec schemas                    # list available schemas
openspec schema which <name>        # see where a schema resolves from
openspec schema init <name>         # create a custom one
```

参见[自定义](customization.md#自定义-schema)。

## 从旧工作流迁移

### “Legacy files detected in non-interactive mode”

你处于 CI 或非交互式 shell 中，而 OpenSpec 发现有旧文件需要清理，却无法提示你。自动批准：

```bash
openspec init --force
```

### 迁移之后命令没有出现

重启你的 IDE。技能在启动时被检测。如果仍然不出现，运行 `openspec update` 并检查[支持的工具](supported-tools.md)里的文件位置。

### 我的旧 `project.md` 没有被迁移

这是有意为之。OpenSpec 从不自动删除 `project.md`，因为它可能装着你写下的上下文。把其中有用的部分搬进 `config.yaml` 的 `context:` 章节，然后自己删掉它。[迁移指南](migration-guide.md#将-projectmd-迁移到-configyaml)详细讲解了这一过程，包括一段你可以直接交给 AI 去做提炼的提示词。

## 还是卡住了？

- **Discord：** [discord.gg/YctCnvvshC](https://discord.gg/YctCnvvshC)
- **GitHub Issues：** [github.com/Fission-AI/OpenSpec/issues](https://github.com/Fission-AI/OpenSpec/issues)
- **从你的终端：** `openspec feedback "what went wrong"` 会为你打开一个 issue。

当你反馈问题时，请附上你的 OpenSpec 版本（`openspec --version`）、Node 版本（`node --version`）、你的 AI 工具，以及确切的命令和输出。这能让帮助快得多。
