# Stores：在专属仓库中规划

> **Beta。** Stores、references、working context 和 worksets 都是新增功能。命令名、flag、文件格式和 JSON 输出在不同版本之间仍可能变形。下面每一段演练都基于当前构建实际跑过，但升级后请重新阅读本指南。

## 它解决的问题

OpenSpec 通常寄居在一个代码仓库里：一个紧挨着你代码的 `openspec/` 文件夹，存放着该仓库的 spec 和 change。

一旦你的规划大过一个仓库，这套就不再合适了：

- 你的工作横跨多个仓库 —— 一个功能同时牵动 API server、web app 和一个共享库。这份规划该放进谁的 `openspec/` 文件夹？
- 你的团队在代码诞生之前就做规划，或者规划了一些永远不会成为*本*仓库代码的东西。
- 需求由一个团队拥有，却被其他团队消费。wiki 上的版本会漂移，而且你的 coding agent 反正也读不了它。

**store** 就是答案：一个独立的仓库，唯一职责就是规划。它有着你已经熟悉的 `openspec/` 结构 —— spec 和 change —— 外加一个小小的身份文件。你在自己的机器上按名字注册它一次，之后所有普通的 OpenSpec 命令都能从任何地方在它里面工作。

## 它的结构

```
            team-plans  (a store: planning in its own repo)
            ├── .openspec-store/store.yaml     identity: "I am team-plans"
            └── openspec/
                ├── specs/      what is true
                └── changes/    what is in motion
                      ▲
                      │ registered on each machine by name;
                      │ shared by pushing/cloning like any repo
        ┌─────────────┼─────────────┐
        │             │             │
    web-app       api-server     mobile-app
   (code repo)   (code repo)    (code repo)
```

两条规则让一切保持简单：

1. **一个 store 就是一个 git 仓库。** 提交、推送、拉取、审查都由你自己来。OpenSpec 从不自行 clone、sync 或 push 任何东西。
2. **声明，而非机制。** 仓库可以*声明*自己与 store 的关系（见下文）。声明改变的是 OpenSpec 能告诉你什么 —— 永远不会改变你的命令作用在哪里。

## 五分钟拥有你的第一个 store

两条命令，带你从零到一个可用的、store 作用域内的 change：

```bash
rasen store setup team-plans --path ~/openspec/team-plans
```

```
Store ready: team-plans
Location: /Users/you/openspec/team-plans
OpenSpec root: ready
Registry: registered

Next: run normal OpenSpec commands against this store, for example:
  rasen new change <change-id> --store team-plans
Share this store by committing and pushing it like any Git repo.
```

```bash
rasen new change add-login --store team-plans
```

```
Using OpenSpec root: team-plans (/Users/you/openspec/team-plans)
Created change 'add-login' at /Users/you/openspec/team-plans/rasen/changes/add-login/
Schema: spec-driven
Next: rasen status --change add-login --store team-plans
```

这就是全部模型。从这里开始，生命周期正是你所熟悉的 —— `status`、`instructions`、`validate`、`archive` —— 每条命令都加上 `--store team-plans`，而每一条打印出来的提示都会替你带上这个 flag。`Using OpenSpec root:` 这一行总会告诉你命令正作用在哪里。

## 案例：一个团队，一个规划仓库

一个团队把自己的 spec 和 change 集中放在 `team-plans` 里，而不是散落在各个代码仓库中。

**第一天（搭建它的那个人）：**

```bash
rasen store setup team-plans --path ~/openspec/team-plans \
  --remote git@github.com:acme/team-plans.git
git -C ~/openspec/team-plans push -u origin main
```

传入 `--remote` 会把 clone URL 记录进 store 自己的身份文件（`.openspec-store/store.yaml`），写进初次提交里。此后每一次 clone 一诞生就知道自己从哪儿来，于是健康检查和错误信息能为还没有它的队友打印出一条完整的、可直接粘贴的修复指令。

**每个队友（每台机器一次）：**

```bash
git clone git@github.com:acme/team-plans.git ~/openspec/team-plans
rasen store register ~/openspec/team-plans
```

从那以后，所有人都按名字在同一个规划仓库里工作：

```bash
rasen status --store team-plans --change add-login
rasen show add-login --store team-plans
```

**共享工作就是 git，这是有意为之。** 你创建的 change 在你提交并推送之前只存在于你的 checkout 里 —— 和代码一样。规划因此白得了分支、pull request 和 review，因为 store 就是一个普通仓库。

**把团队的代码仓库接上。** 一个把规划完全外置的代码仓库，只需在 `rasen/config.yaml` 里加一行：

```yaml
# web-app/rasen/config.yaml
store: team-plans
```

现在，在 `web-app` 内运行的每条 OpenSpec 命令都会作用在 `team-plans` 上，完全不需要任何 flag：

```bash
cd ~/src/web-app
rasen status --change add-login
```

```
Using OpenSpec root: team-plans (/Users/you/openspec/team-plans)
...
```

这个指针是一个回退项，绝不是覆盖：显式的 `--store` 永远优先；如果该仓库长出了自己真正的规划文件夹，那些优先（并附一条警告，提醒你删掉这个过时的指针）。

## 案例：跨越团队边界的需求

一个平台团队拥有需求。产品团队在自己的仓库里、用自己的设计，依此构建。一个 reference 描述这种关系，却不必搬动任何一方的工作。

```
   platform-reqs (store)                 api-server (code repo)
   owned by the platform team            owned by a product team
   ┌──────────────────────────┐          ┌──────────────────────────┐
   │ rasen/specs/          │ ◀────────│ rasen/config.yaml     │
   │   payments/spec.md       │ reads    │   references:            │
   │   auth/spec.md           │          │     - platform-reqs      │
   │                          │          │ rasen/specs/          │
   │ rasen/changes/        │          │   (their own designs)    │
   │   platform work          │          │ rasen/changes/        │
   │                          │          │   (their own work)       │
   │                          │          └──────────────────────────┘
   └──────────────────────────┘
```

**产品团队在自己仓库的 `rasen/config.yaml` 里声明它依赖什么**：

```yaml
references:
  - platform-reqs
```

reference 是只读的上下文。仓库保留自己的 `openspec/` root；工作也留在那里。改变的是：该仓库里的 `rasen instructions` 现在会包含一份被引用 store 的 spec 索引 —— 每条都带一行摘要和精确的抓取命令（`rasen show <spec-id> --type spec --store platform-reqs`）。在 `api-server` 里工作的 agent 能找到上游的支付需求、引用它们，并在仓库自己的 root 里写下它的低层设计 —— 不需要任何人到处粘贴上下文。

一个 reference 可以带上自己的 clone 来源，这样还没有该 store 的队友会得到一条完整的修复指令，而不是一个死胡同：

```yaml
references:
  - { id: platform-reqs, remote: "git@github.com:acme/platform-reqs.git" }
```

**当你想把规划和代码同时打开，就建一个 workset。** 这是个人且显式的：每个人在自己机器上挑选实际会用到的文件夹。这些本地 checkout 路径的任何信息都不会被提交到共享的规划仓库。

```bash
rasen workset create platform \
  --member ~/openspec/platform-reqs \
  --member ~/src/api-server \
  --member ~/src/web-app
```

## 你随时可以问的两个问题

**"我的配置健康吗？"** —— `rasen doctor` 以只读方式检查当前 root 及其引用的 store，每条发现都附一条可粘贴的修复指令：

```
Doctor

Root
  Location: /Users/you/src/api-server
  OpenSpec root: ok

References
  - platform-reqs: ok (/Users/you/openspec/platform-reqs)
  - design-system: Referenced store 'design-system' is not registered on this machine.
    Fix: git clone -- git@github.com:acme/design-system.git '/Users/you/openspec/design-system' && rasen store register '/Users/you/openspec/design-system' --id design-system

```

**"我正在和什么打交道？"** —— `rasen context` 从 OpenSpec 的声明中组装出工作集：root 和它引用的 store。

```
Working context for api-server (/Users/you/src/api-server)

OpenSpec root
  api-server  /Users/you/src/api-server

Referenced stores
  platform-reqs  /Users/you/openspec/platform-reqs
    Fetch: rasen show <spec-id> --type spec --store platform-reqs
```

两者都为 agent 支持 `--json`。`rasen context --code-workspace <path>` 还会额外写出一个 VS Code workspace 文件，包含整个集合 —— 这是该命令唯一会执行的一次写入。

## Workset：重新打开你一起工作的那些文件夹

与上面所有内容分开说：大多数人每个工作时段都会把同样几个文件夹一起打开 —— 规划仓库外加两三个代码仓库。一个 **workset** 就是这件事的个人化、命名视图，用一条命令在你选定的工具里重新打开。

```
  workset "platform"                 rasen workset open platform
  ├── team-plans   ~/openspec/team-plans         │
  ├── api-server   ~/src/api-server              ▼
  └── web-app      ~/src/web-app       all three open in your tool
```

```bash
rasen workset create platform \
  --member ~/openspec/team-plans --member ~/src/api-server \
  --tool code
rasen workset list
```

```
platform  (opens in VS Code)
  team-plans  /Users/you/openspec/team-plans
  api-server  /Users/you/src/api-server
```

随后 `rasen workset open platform` 会启动保存好的工具：编辑器（VS Code、Cursor）打开一个包含全部成员的窗口然后返回。第一个成员是主成员。任何时候都可以用 `--tool <id>` 覆盖工具。

workset 被有意设计成*非*共享状态。它们只存在于你的机器上、从不被提交、也不对工作本身做任何断言 —— 它们只记录你喜欢把哪些文件夹一起打开。删除一个 workset 永远不会动到成员文件夹。新工具是配置，不是代码：任何能通过 workspace 文件或逐文件夹 attach flag 启动的东西，都可以加到全局配置（`rasen config edit`）的 `openers` 键下。

## 命令如何决定作用在哪里

每条普通命令都按相同方式、依以下顺序解析自己的 root：

```
1. --store <id>          you said so explicitly        → that store
2. nearest openspec/     a real planning root here     → this repo
   (walking up from cwd)
3. store: pointer        config.yaml declares a store  → that store
4. none of the above     stores registered on this     → error with a
                         machine?                        selection hint
                         no stores registered?         → the current
                                                          directory
                                                          (classic behavior)
```

`Using OpenSpec root:` 这一行（以及 `--json` 输出中的 `root` 块）会告诉你处于哪种情况。

## 已知限制

- **Beta 形态。** 本页的一切都可能在版本之间变化 —— 名字、flag、文件格式、JSON key。
- **每台机器上每个 store id 只能有一个 checkout。** 在同一 id 下注册第二个 checkout 会失败，并提示先 `store unregister`。
- **永不同步 —— 这是设计如此。** OpenSpec 从不 clone、pull 或 push。陈旧的 checkout 会显示陈旧的 spec，直到*你*自己 pull；reference 则实时地从磁盘上现有的内容建立索引。
- **某些命令留在原地。** `view`、`templates`、`schemas` 只作用于当前目录 —— 没有 `--store`。
- **每机状态就是每机的事。** store 注册表和 workset 都是本地设置。你机器布局的任何信息都永远不会被提交到共享规划中。
- **workset 有两种启动方式。** 一个无法用 workspace 文件或逐文件夹 attach flag 启动的工具，无法被加为 opener。
- **Agent JSON 存在一个已知的大小写分裂**（store 家族的 key 是 snake_case，workflow 家族是 camelCase）。已在 [agent 契约](../agent-contract.md)中记录；统一它被推迟到某个版本化发布。

## 各物所在

| 内容 | 位置 | 是否共享？ |
|---|---|---|
| 一个 store 的规划 | `<store>/openspec/`（spec、change） | 是 —— 提交并推送它 |
| 一个 store 的身份 | `<store>/.openspec-store/store.yaml` | 是 —— 随 store 一起提交 |
| store 注册表 | `<data dir>/openspec/stores/registry.yaml` | 否 —— 仅本机 |
| Workset | `<data dir>/openspec/worksets/` | 否 —— 仅本机 |

`<data dir>` 在 macOS 和 Linux 上是 `~/.local/share/openspec`（或设置了 `$XDG_DATA_HOME` 时为 `$XDG_DATA_HOME/openspec`），在 Windows 上是 `%LOCALAPPDATA%\openspec`。

## 参考

本页每条命令的精确 flag 与 JSON 结构：[CLI 参考](../cli.md)（Stores、Doctor、Working context、Personal worksets）和 [agent 契约](../agent-contract.md)。
