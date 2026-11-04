# Rasen Store 多机协作、身份与可移植运行态设计

> 执行说明：本文件保留为多机设计背景资料。后续开发的统一身份、PR #65/#66/#68
> 整合、Session runtime context、learned-skill 层级和阶段执行顺序，以
> [`global-store-project-unification-development-plan.md`](./global-store-project-unification-development-plan.md)
> 为准。

> 状态：开发就绪的上游设计基线
>
> 日期：2026-07-25
>
> 目标：供后续拆分 proposal、spec、tasks 和实现使用
>
> 范围：Store 身份、项目成员身份、本机注册、首次引导、多机同步、
> adoption/eject 可移植性，以及显式运行态交接

## 1. 摘要

当前 Store 模型已经具备多机协作的基础：

- Store 的可读 ID 保存在 Store 仓库的
  `.rasen-store/store.yaml` 中；
- 项目通过 `rasen/config.yaml` 中的 `store:` 指针选择 Store；
- 项目的 `projectId` 随项目仓库进入 Git；
- adoption 关系随 Store 仓库进入 Git；
- `~/.rasen` 只保存本机路径映射和运行时状态。

但当前模型仍有四个结构性缺口：

1. Store 的 `id` 同时承担“人类可读名称”和“不可变身份”，不同机器
   可以独立创建同名但不同的 Store；
2. `store add-project` 使用可读项目 ID 建立 `project:<id>` 引用，
   不同机器可以把不同项目注册成同一个可读 ID；
3. `adoptions.yaml.sourcePath` 把某台机器的绝对路径写入 Git，并被
   eject 当作默认写入目标；
4. clone + register 能恢复规划上下文，但不能恢复项目 namespace，
   也不能继续另一台机器上尚未完成的运行态。

本设计将数据严格拆为三个平面：

```text
┌─────────────────────────────────────────────────────────────┐
│ Git 共享身份与声明平面                                      │
│ store uid / projectId / remote / membership / adoption      │
│ specs / changes / 显式导出的 portable checkpoint            │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ rasen bootstrap / Git
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ 本机绑定平面 ~/.rasen                                      │
│ uid → checkout path / projectId → checkout paths / lastSeen │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ 显式 export/import
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ 临时执行平面                                                │
│ agent session / PID / locks / tokens / daemon / transient   │
└─────────────────────────────────────────────────────────────┘
```

最终用户体验是：

```bash
git clone <project-remote>
cd <project>
rasen bootstrap
```

`bootstrap` 是唯一允许根据共享声明执行 clone、register 和 hydrate 的
显式入口。`status`、`list`、`doctor` 等普通命令保持只读，不隐式修改
Git checkout 或 `~/.rasen`。

## 2. 设计目标

### 2.1 用户目标

1. 新机器只 clone 项目仓库，也能得到完整、可执行的 Store 安装指引。
2. Store 已经 clone 时，只需一次 bootstrap 即可重建本机绑定。
3. 同一个项目在多台机器或多个 checkout 中保持同一个项目身份。
4. 不同机器可以离线创建 Store 或注册项目，不依赖中央自增计数器。
5. 两台机器分别向同一 Store 添加不同项目时，不产生隐式身份覆盖。
6. eject 永远不会写入另一台机器遗留的绝对路径。
7. 需要跨机器继续同一次工作流时，可以显式导出、同步和恢复最小运行态。

### 2.2 工程目标

1. Git 中不保存本机绝对路径、PID、锁、token 或凭据。
2. 身份解析失败时 fail closed，不按别名猜测。
3. 数据格式支持向后兼容读取和显式迁移。
4. 普通命令无网络副作用、无注册副作用。
5. 多项目共享文件按不可变 ID 分片，降低 Git 合并冲突。
6. 所有写操作都可 dry-run、可诊断、可中断后恢复。

### 2.3 非目标

本设计不实现：

- 自动 `git pull`、`git push` 或后台同步；
- 分布式锁服务；
- 跨两个 Git 仓库的强原子事务；
- 实时多人编辑或 CRDT；
- 整体同步 `~/.rasen`；
- 自动迁移或复制凭据；
- 让 `doctor` 执行修复；
- 在普通 `status/list/new change` 中隐式 clone。

## 3. 当前模型与问题

### 3.1 当前 Store 身份

当前 Store identity：

```yaml
# <store>/.rasen-store/store.yaml
version: 1
id: elftia-store
remote: git@github.com:org/elftia-store.git
```

`id` 是字符串，语法允许小写字母、数字和单连字符。纯数字字符串如
`"123"` 也是合法值，但它不是自增 ID。

Store ID 的来源优先级是：

```text
已提交 store.yaml.id
        ↓
命令行 --id
        ↓
目录 basename
```

同一机器中，相同 namespace 下的两个相同 ID 会被本机注册表拒绝；
不同机器的本地注册表互不可见，因此无法阻止两个独立 Store 使用相同
ID。

### 3.2 当前项目身份

项目的持久身份已经是正确方向：

```yaml
# <project>/rasen/config.yaml
projectId: ed2cf5bf-2525-45ed-b665-c47a5b8d5450
```

`projectId` 使用随机 UUID 生成并进入 Git。不同机器 clone 同一个项目
时会得到相同 `projectId`；不同项目离线初始化时发生碰撞的概率可以
忽略。

但是 `store add-project` 当前还会生成另一个可读的 project namespace
ID，来源是：

```text
项目的 .rasen-store/store.yaml.id
        ↓
--as <id>
        ↓
项目目录 basename
```

Store config 中的 `project:<id>` 引用使用的是这个可读 ID，而不是
`projectId`。因此两台机器可能将两个不同项目都提交为
`project:api`，Git 甚至可能把相同文本行视为“无冲突”，但语义已经
发生错误合并。

### 3.3 当前 Store 指针

项目当前使用：

```yaml
store: elftia-store
```

这个声明足以在 Store 已经注册时完成：

```text
Store 可读 ID → 本机注册表 → Store checkout path
```

但在新机器只 clone 项目仓库时：

- 指针没有不可变 Store 身份；
- 指针通常没有 Store remote；
- 无法判断本机同名注册是否就是预期 Store；
- 无法自动给出完整 clone 源。

### 3.4 当前 adoption

当前 Store 使用一个共享文件：

```yaml
# <store>/.rasen-store/adoptions.yaml
version: 1
adoptions:
  ed2cf5bf-2525-45ed-b665-c47a5b8d5450:
    specs: [...]
    changes: [...]
    sourcePath: E:\old\path\elftia
    timestamp: 2026-07-25T10:00:00Z
```

问题有两个：

1. `sourcePath` 是机器私有信息，却进入了 Git；
2. 所有项目共同修改一个 YAML map，多机并发添加不同项目时也可能在
   同一文件中产生文本合并冲突。

### 3.5 当前本机状态

`~/.rasen` 中包含：

- Store ID 到本地 checkout 路径；
- projectId 到本地 checkout、mode 和 home；
- work directory；
- agent/session/run state；
- locks、PID、daemon 和本机生命周期状态。

其中只有路径绑定可以安全重建。运行时目录不能整体复制到另一台机器，
因为它同时包含不可移植字段和潜在敏感信息。

## 4. 核心设计原则

### 4.1 身份与名称分离

每个共享实体必须同时区分：

```text
不可变身份：机器生成、全球唯一、用于关联和校验
可读名称：人类选择、允许重命名、用于展示和命令行简写
```

目标身份模型：

| 实体 | 不可变身份 | 可读名称 | 是否进入 Git |
|---|---|---|---|
| Store | `storeUid`，UUID | `id`，如 `elftia-store` | 两者都进入 |
| Project | 已有 `projectId`，UUID | `id`，如 `elftia` | 两者都进入 |
| Checkout | 本机生成或路径哈希 | 可选 label | 不进入 |
| Run/checkpoint | `runId`，UUID | change 名称 | 显式导出时进入 |

### 4.2 Git 只记录逻辑关系

Git 中允许：

- UUID；
- 可读名称；
- 无凭据 remote；
- specs/changes 所有权；
- adoption 时间；
- portable checkpoint；
- 生成这些内容所依据的 Git commit SHA。

Git 中禁止：

- `C:\...`、`E:\...`、`/Users/...` 等绝对路径；
- `file://` 形式的本机路径；
- PID、lock owner、daemon socket；
- OAuth token、PAT、带密码 remote；
- 当前终端、编辑器或 agent session 句柄；
- 只能在一台机器解释的临时目录。

### 4.3 本机路径只按不可变身份绑定

```text
storeUid  → 当前机器上的 Store checkout
projectId → 当前机器上的一个或多个 Project checkout
```

可读名称只建立辅助索引。名称查到多个实体时必须报告歧义，不能任选一个。

### 4.4 普通命令不修复环境

普通命令只能：

- 解析；
- 校验；
- 报错；
- 输出完整修复命令。

只有显式 mutation 命令可以：

- clone；
- register；
- 更新 `~/.rasen`；
- 升级 pointer；
- 导入 checkpoint。

### 4.5 不使用全局自增编号

Store、Project、Run 都可能在离线机器上创建。没有中央协调者时，全局
自增编号无法安全分配。

本设计统一使用 UUID：

```text
本机生成 UUID
      +
Git 以 UUID 分片
      +
push 的 non-fast-forward 检查
      +
更新后重新校验
```

可读纯数字 ID 可继续兼容，但新建时应给出“不建议使用纯数字别名”的
warning。身份正确性不再依赖别名唯一。

## 5. 目标数据模型

### 5.1 Store identity v2

目标格式：

```yaml
# <store>/.rasen-store/store.yaml
version: 2
uid: 9d7a6f8d-6b8e-4f6a-b5c4-2e31fd3525c7
id: elftia-store
remote: git@github.com:org/elftia-store.git
```

字段语义：

| 字段 | 必需 | 语义 |
|---|---:|---|
| `version` | 是 | metadata schema 版本 |
| `uid` | v2 是 | 不可变 Store 身份；创建后不得修改 |
| `id` | 是 | 可读别名；允许通过显式 rename 流程修改 |
| `remote` | 否 | canonical clone source，不得携带凭据 |

约束：

1. `uid` 创建一次后不可变。
2. register 时必须校验 metadata 中的 `uid`。
3. `--id` 只影响新 Store 的别名，不能覆盖已有 identity。
4. 同一个 `uid` 在一台机器默认只绑定一个 Store checkout。
5. 不同 `uid` 可以拥有相同 `id`，但 `--store <id>` 会变成歧义错误。
6. `--store <uid>` 永远可以精确寻址。

### 5.2 项目侧结构化 Store pointer

目标格式：

```yaml
# <project>/rasen/config.yaml
schema: spec-driven
projectId: ed2cf5bf-2525-45ed-b665-c47a5b8d5450

store:
  uid: 9d7a6f8d-6b8e-4f6a-b5c4-2e31fd3525c7
  id: elftia-store
  remote: git@github.com:org/elftia-store.git
```

字段职责：

- `uid`：解析和身份校验的权威键；
- `id`：人类展示和兼容命令提示；
- `remote`：Store 尚未 clone 时的 bootstrap locator。

`remote` 在 Store metadata 和项目 pointer 中有意重复：

- Store metadata 是 Store 自身的 canonical remote；
- 项目 pointer 的 remote 是新机器尚未拥有 Store 时唯一可见的
  bootstrap locator。

Store 成功解析后：

- `uid` 不一致：错误，禁止继续；
- `id` 不一致：info/warning，提示刷新 pointer；
- `remote` 不一致：info，展示 canonical 与 pointer locator；
- identity 正确时，名称或 remote 漂移不能把用户路由到错误 Store。

向后兼容：

```yaml
store: elftia-store
```

仍可读取，但属于 legacy pointer：

- 本机有唯一同名 Store 时继续工作并提示升级；
- 无同名 Store 时输出 `rasen bootstrap` 修复命令；
- 多个同名 Store 时失败并要求 UID；
- legacy pointer 不允许静默选择任意 checkout。

### 5.3 按 projectId 分片的 Store 项目记录

目标布局：

```text
<store>/.rasen-store/
├── store.yaml
└── projects/
    ├── ed2cf5bf-2525-45ed-b665-c47a5b8d5450.yaml
    └── 799325c0-43ed-47a6-b983-25ca1059ec4e.yaml
```

项目记录：

```yaml
version: 1
projectId: ed2cf5bf-2525-45ed-b665-c47a5b8d5450
id: elftia
remote: git@github.com:org/elftia.git

adoption:
  specs:
    - fundraising
    - billing
  changes:
    - fundraising-p0-p1
  adoptedAt: 2026-07-25T10:00:00Z
```

如果项目只是通过 `store add-project` 加入上下文但没有被 adopt，则省略
`adoption`：

```yaml
version: 1
projectId: 799325c0-43ed-47a6-b983-25ca1059ec4e
id: shared-contracts
remote: git@github.com:org/shared-contracts.git
```

设计收益：

1. project namespace 以 `projectId` 为权威身份；
2. 两个同名项目可以并存，别名解析时显式消歧；
3. 两台机器添加不同项目时写不同文件，降低 Git 合并冲突；
4. `sourcePath` 被彻底移除；
5. bootstrap 可以根据当前 repo 的 `projectId` 找到对应 Store 记录；
6. eject 可以按 `projectId` 精确确定 specs/changes 所有权。

Store 内部的项目上下文由 `projects/*.yaml` 组装。旧的
`references: [project:<id>]` 保留只读兼容，升级后不再作为新项目成员
的权威声明。

Store-to-Store reference 仍可保留在 `rasen/config.yaml.references`，
但建议最终也升级为包含 `uid` 的结构化声明：

```yaml
references:
  - type: store
    uid: 1100532f-bf52-4300-a876-068ec5a94aef
    id: platform-reqs
    remote: git@github.com:org/platform-reqs.git
```

### 5.4 本机 Store registry v2

目标概念格式：

```yaml
# ~/.rasen/stores/registry.yaml
version: 2
stores:
  9d7a6f8d-6b8e-4f6a-b5c4-2e31fd3525c7:
    id: elftia-store
    backend:
      type: git
      local_path: E:\work\elftia-store
      remote: git@github.com:org/elftia-store.git
```

主键从可读 `id` 改为不可变 `uid`。运行时构建辅助索引：

```text
uid → 唯一 checkout
id  → 0、1 或多个 uid
```

别名命中多个 UID 时：

```text
Store id 'platform' is ambiguous on this machine.
Use --store <uid> or rename one of the stores.
```

### 5.5 本机 Project checkout registry

项目 checkout 继续进入 `~/.rasen`，以 `projectId` 归组：

```json
{
  "version": 2,
  "projects": {
    "ed2cf5bf-2525-45ed-b665-c47a5b8d5450": {
      "id": "elftia",
      "checkouts": [
        {
          "path": "E:\\work\\elftia",
          "mode": "store",
          "lastSeen": "2026-07-25T10:00:00Z"
        }
      ]
    }
  }
}
```

规则：

1. 同一 `projectId` 可以有多个 checkout/worktree。
2. 当前 cwd 命中的 checkout 优先。
3. 需要一个目标路径且有多个 checkout 时必须要求选择。
4. 不再要求把项目伪装成一个 Store identity 才能加入 project
   namespace。
5. 现有 Store registry 中的 `project:<id>` namespace 作为迁移兼容层，
   逐步由 project registry + Store `projects/*.yaml` 取代。

## 6. 数据所有权矩阵

| 数据 | 权威位置 | Git 共享 | 新机器处理 |
|---|---|---:|---|
| Store 不可变身份 | `store.yaml.uid` | 是 | clone 后校验 |
| Store 可读名称 | `store.yaml.id` | 是 | 用于展示 |
| Store clone locator | metadata + pointer | 是 | bootstrap 使用 |
| 项目身份 | `rasen/config.yaml.projectId` | 是 | clone 后保持 |
| Store 项目成员 | `.rasen-store/projects/<projectId>.yaml` | 是 | hydrate 使用 |
| adoption 所有权 | 同一项目记录的 `adoption` | 是 | eject 使用 |
| Store checkout path | `~/.rasen/stores/registry.yaml` | 否 | bootstrap 重建 |
| Project checkout path | `~/.rasen/projects/registry.json` | 否 | bootstrap 重建 |
| `sourcePath` | 无权威位置 | 否 | 从新格式删除 |
| locks/PID/session | `~/.rasen` runtime | 否 | 不迁移 |
| portable checkpoint | 显式导出文件 | 可选，是 | import 使用 |

## 7. `rasen bootstrap` 设计

### 7.1 命令职责

`rasen bootstrap` 是从 Git 共享声明重建本机绑定的显式 mutation 命令。

它负责：

1. 识别当前项目；
2. 读取并校验 `projectId`；
3. 解析结构化 Store pointer；
4. 定位或 clone Store；
5. 校验 Store identity；
6. 注册 Store checkout；
7. 注册当前项目 checkout；
8. 按 `projectId` hydrate Store 项目关系；
9. 校验 adoption；
10. 输出可重复执行的结果。

它不负责：

- pull 或 push 已有 checkout；
- 自动解决 Git 冲突；
- 导入运行态，除非显式传入 checkpoint 选项；
- 修改 Store remote；
- 自动提交 pointer 升级。

### 7.2 建议命令面

```text
rasen bootstrap
  [--store-path <path>]
  [--clone-into <path>]
  [--clone-root <path>]
  [--no-clone]
  [--upgrade-pointer]
  [--check]
  [--yes]
  [--json]
```

语义：

| 选项 | 行为 |
|---|---|
| `--store-path` | 使用已经存在的 Store checkout |
| `--clone-into` | Store 缺失时 clone 到精确路径 |
| `--clone-root` | 以 `<root>/<store-id>` 作为 clone 目标 |
| `--no-clone` | 只允许发现/注册已有 checkout |
| `--upgrade-pointer` | 将 legacy pointer 显式升级为结构化 pointer |
| `--check` | 完全只读，报告将执行的动作 |
| `--yes` | 跳过交互确认；仍执行所有身份和安全校验 |
| `--json` | 输出稳定、机器可读的 action/result/status |

### 7.3 Store checkout 位置决策

按以下顺序决定 Store checkout：

```text
1. --store-path
2. 本机 registry 中按 uid 命中
3. 配置的 stores.cloneRoot
4. --clone-into / --clone-root
5. 交互式询问，默认建议项目仓库的同级目录
6. 非交互环境中失败并输出精确命令
```

不把 Git Store checkout 隐式放进 `~/.rasen`。`~/.rasen` 是状态目录，
Store 是用户需要查看、提交和维护的正常 Git 仓库。

### 7.4 Bootstrap 状态机

```text
START
  │
  ├─ 无 rasen/config.yaml ───────────────► ERROR not_project
  │
  ├─ 无 projectId ───────────────────────► 提示 init/显式 mint
  │
  ├─ 无 store pointer ───────────────────► register project only / DONE
  │
  ▼
PARSE POINTER
  │
  ├─ v2 pointer ─► resolve by uid
  └─ legacy      ─► resolve unique alias + migration warning
  │
  ▼
RESOLVE LOCAL STORE
  │
  ├─ found ──────────────────────────────► VALIDATE IDENTITY
  └─ missing
       ├─ no remote / --no-clone ────────► ERROR with exact fix
       └─ remote available ──────────────► CONFIRM → CLONE
  │
  ▼
VALIDATE IDENTITY
  │
  ├─ uid mismatch ───────────────────────► ERROR, leave unregistered
  ├─ unhealthy root ─────────────────────► ERROR, leave unregistered
  └─ healthy ────────────────────────────► REGISTER STORE
  │
  ▼
HYDRATE PROJECT
  │
  ├─ register current checkout by projectId
  ├─ find <store>/projects/<projectId>.yaml
  ├─ validate project alias/remote/adoption
  └─ optional pointer upgrade
  │
  ▼
DONE
```

### 7.5 Clone 安全边界

1. remote 必须作为 argv 传递，不拼接 shell 字符串。
2. remote 中出现嵌入式密码/token 时拒绝写入共享配置并在输出中脱敏。
3. clone 目标已存在且非空时失败，不覆盖。
4. clone 完成但 UID 不一致时：
   - 不注册；
   - 不自动删除用户数据；
   - 明确报告预期 UID、实际 UID 和 checkout 路径。
5. `--check` 不创建目录、不运行 clone、不更新注册表。
6. bootstrap 不自动 pull 已存在 checkout；只提示用户 checkout 可能陈旧。

### 7.6 幂等性

相同项目和相同 Store checkout 重复执行：

- 不重写 identity；
- 不重复添加 project record；
- 不改变路径；
- 不创建新 commit；
- JSON 中标记 `already_registered` / `already_hydrated`；
- 如果可读名称或 remote 漂移，只报告诊断。

## 8. 普通命令和 Doctor 行为

### 8.1 普通命令

对于 config-only pointer 项目：

| 状态 | 行为 |
|---|---|
| UID 已注册且 identity 匹配 | 正常选择 Store root |
| UID 未注册、pointer 有 remote | 失败并提示 `rasen bootstrap` |
| UID 未注册、pointer 无 remote | 失败并要求 `--store-path` 或补 remote |
| UID 与 checkout metadata 不同 | fail closed |
| legacy alias 唯一命中 | 工作，但提示升级 |
| legacy alias 多重命中 | 歧义错误 |

普通命令不得：

- clone；
- register；
- 修改 pointer；
- 自动升级 metadata；
- 创建 project record。

### 8.2 `rasen doctor`

Doctor 保持只读，并报告四层健康：

```text
Project
  projectId: ok
  checkout binding: missing / ok / ambiguous

Store pointer
  uid: expected
  id: display alias
  remote: bootstrap locator

Store checkout
  registration: missing / ok
  metadata uid: match / mismatch
  canonical remote vs observed origin: match / diverged

Membership
  project record: missing / ok
  adoption: missing / ok / stale ownership
```

所有可修复项都提供可复制命令，但 Doctor 不执行修复。

建议新增诊断码：

| code | 严重性 | 含义 |
|---|---|---|
| `store_bootstrap_required` | error | pointer 正确但本机未绑定 |
| `store_uid_mismatch` | error | checkout 不是 pointer 指定的 Store |
| `store_alias_ambiguous` | error | 可读名称映射到多个 UID |
| `store_pointer_legacy` | warning | 只有字符串 ID |
| `store_pointer_remote_divergence` | info | pointer locator 与 canonical remote 不同 |
| `project_binding_missing` | warning | projectId 未注册到本机 checkout |
| `project_binding_ambiguous` | warning/error | 多 checkout 且命令需要唯一目标 |
| `store_project_record_missing` | warning | Store 中无当前 projectId 记录 |
| `store_project_alias_ambiguous` | warning | 多项目使用相同可读名称 |
| `shared_metadata_contains_local_path` | warning | legacy 数据仍含绝对路径 |

## 9. Adoption 与 Eject

### 9.1 Adoption 写入顺序

Adoption 继续遵循“所有权记录先于源删除”的可恢复原则：

```text
1. 校验 source projectId 和 target storeUid
2. 检查 specs/changes 名称碰撞
3. 写/更新 projects/<projectId>.yaml 的 adoption 块
4. copy → verify → delete specs/changes
5. 写结构化 Store pointer
6. 刷新本机 project checkout binding
7. 输出两个仓库的建议 commit 顺序
```

Store 项目记录不包含 `sourcePath`。

建议提交/发布顺序：

```text
1. 先提交并发布 Store 仓库中的项目记录和规划内容
2. 再提交并发布项目仓库中的 Store pointer
```

这不能提供跨仓库强原子性，但可以避免远端先出现一个指向尚不存在规划
内容的项目 pointer。

### 9.2 Eject 目标解析

Eject 的目标目录按以下顺序解析：

```text
1. 显式 --into <path>
2. 当前 cwd 所属项目的 projectId 与目标 adoption 一致
3. 本机 project registry 中该 projectId 恰好有一个 checkout
4. 有多个 checkout：交互选择或要求 --into
5. 无 checkout：要求 --into
```

永远禁止：

- 将 Git 中的 legacy `sourcePath` 自动作为写入目标；
- 仅按项目目录名寻找目标；
- 在 `projectId` 不匹配的现有目录中写入；
- 因为路径不存在而自动创建另一台机器的目录结构。

目标目录存在时必须校验：

- 是目录；
- 是预期 Git/Rasen 项目；
- `projectId` 一致；
- 写入位置没有 spec/change 碰撞；
- dry-run 输出完整移动计划。

### 9.3 Legacy `sourcePath` 迁移

读取 v1 `adoptions.yaml` 时：

1. `sourcePath` 只显示为历史诊断；
2. 不进入 eject 默认值；
3. 如果它恰好存在且 projectId 匹配，也只能作为交互候选，不可静默使用；
4. Store identity 升级时将每条 adoption 转换为
   `projects/<projectId>.yaml`；
5. 转换后的新文件不带路径；
6. 原 v1 文件在迁移验证通过前保留；最终删除由显式 apply 完成。

## 10. 多机并发模型

### 10.1 身份并发

不同机器独立创建对象时：

- Store 使用 `storeUid` UUID；
- Project 使用 `projectId` UUID；
- checkpoint 使用 `runId` UUID；
- 不需要请求“下一个数字”；
- 可读名称碰撞只影响简写，不影响身份。

### 10.2 项目注册并发

机器 A 和 B 分别添加不同项目：

```text
Machine A writes:
.rasen-store/projects/<project-A-uuid>.yaml

Machine B writes:
.rasen-store/projects/<project-B-uuid>.yaml
```

两次 Git 修改位于不同文件，正常情况下可直接合并。

如果两个不同项目使用相同 `id: api`：

- 两个项目文件都保留；
- `--project api` 报歧义；
- `--project <projectId>` 精确工作；
- 不允许后写者覆盖先写者。

如果两台机器操作的是同一个 clone lineage：

- `projectId` 相同，表示同一逻辑项目；
- 修改同一个项目记录属于正常 Git 并发；
- Git 冲突必须由用户解决；
- Rasen 在合并后重新校验 record schema 和 adoption 所有权。

### 10.3 Planning 内容并发

Store 仍使用平坦 `specs/<name>` 和 `changes/<name>`。两个项目添加同名
内容时，现有碰撞检查继续保留。

没有中央锁时，两个机器可能基于同一个旧 commit 同时通过本地预检。
最终一致性依赖：

1. Git push 的 non-fast-forward 拒绝；
2. 第二个写者 fetch/rebase；
3. rebase/merge 后重新执行 Rasen 校验；
4. 同路径内容产生显式 Git 冲突，不能静默覆盖。

Rasen 可以在 mutation 输出中记录：

```json
{
  "store_base_commit": "<sha>",
  "project_base_commit": "<sha>"
}
```

但不自动执行 pull/push。

## 11. 单项目多机运行态交接

### 11.1 为什么不能同步 `~/.rasen`

`~/.rasen` 同时含有：

- 可重建 registry；
- 不可移植的绝对路径；
- agent/session 标识；
- locks/PID；
- daemon 状态；
- token 或工具状态；
- 大量临时输出。

直接用 Git、网盘或 rsync 同步整个目录会制造：

- 路径指向错误；
- 锁被误认为仍有效；
- daemon/session 冲突；
- 凭据泄漏；
- 两台机器同时覆盖运行态。

因此只允许显式导出一个经过白名单过滤的 portable checkpoint。

### 11.2 Portable checkpoint

建议命令：

```text
rasen checkpoint export <change> [--to <path>|--to-store]
rasen checkpoint import <file>
rasen checkpoint list <change>
```

显式导出到 Store 时的建议位置：

```text
<store>/.rasen-store/checkpoints/
└── <projectId>/
    └── <change>/
        └── <runId>.yaml
```

建议 schema：

```yaml
version: 1
runId: a40c5a72-55d3-48e9-8f59-0b1eaa31216f
projectId: ed2cf5bf-2525-45ed-b665-c47a5b8d5450
storeUid: 9d7a6f8d-6b8e-4f6a-b5c4-2e31fd3525c7
change: fundraising-p0-p1
pipeline: auto
stage: implement
createdAt: 2026-07-25T10:30:00Z

bases:
  projectCommit: 86ab...
  storeCommit: e092...

progress:
  completedTasks:
    - 1.1
    - 1.2
  currentTask: 1.3
  decisions:
    - Use projectId-keyed records.
  blockers: []
  nextAction: Implement pointer v2 parsing.

artifacts:
  proposal: rasen/changes/example/proposal.md
  design: rasen/changes/example/design.md
```

白名单允许：

- identity；
- change/pipeline/stage；
- task progress；
- 决策、阻塞和下一步；
- Git base SHA；
- 相对于 project/store root 的路径；
- 不含秘密的结构化结果摘要。

必须剔除：

- 绝对路径；
- prompt transcript 原文，除非用户显式选择；
- token、cookies、environment secrets；
- PID、lock、socket；
- agent provider session handle；
- 临时文件路径；
- 本机用户名和 hostname，除非显式加入非敏感 label。

### 11.3 Import 规则

Import 前：

1. bootstrap 并验证 `projectId`、`storeUid`；
2. 比较当前 project/store commit 与 checkpoint base；
3. 当前 commit 落后时提示先同步；
4. 当前 commit 已分叉时标记 divergence；
5. 不恢复 PID、lock 或 provider session；
6. 创建新的本机 run/session，并把 checkpoint 作为 warm seed；
7. 保留原 `runId` 作为 lineage，给新本机 session 新建 session ID。

Checkpoint 是“可移植交接”，不是进程快照。

## 12. 迁移与兼容

### 12.1 兼容矩阵

| 数据 | Legacy | 新格式 | 兼容行为 |
|---|---|---|---|
| Store metadata | v1 `{id, remote?}` | v2 `{uid,id,remote?}` | v1 可读，提示升级 |
| Project pointer | `store: <id>` | object `{uid,id,remote}` | 字符串可读，歧义时失败 |
| Project reference | `project:<id>` | projectId 分片文件 | 旧引用继续读取 |
| Adoption | 单个 v1 map + `sourcePath` | 每 projectId 一个文件 | 显式迁移 |
| Store registry | 以 alias 为 key | 以 UID 为 key | 启动时读取 v1，显式写 v2 |
| Project namespace | Store registry `project:<id>` | project registry by projectId | 过渡期双读 |

### 12.2 建议升级命令

```text
rasen store upgrade-identity <store>
  [--dry-run]
  [--apply]
  [--json]
```

Dry-run 输出：

- 将生成的 `storeUid`；
- 将更新的 `store.yaml`；
- 可解析的 legacy project references；
- 将生成的 `projects/<projectId>.yaml`；
- 无法解析的 legacy alias；
- 将移除的 `sourcePath`；
- 需要随后升级 pointer 的项目列表。

Apply 前置条件：

- Store root 健康；
- metadata 可解析；
- Git working tree 对相关路径无未提交修改，或用户明确确认；
- 每个迁移的 project record 都有唯一 `projectId`；
- 不覆盖已有不同内容的分片文件；
- 所有写入采用临时文件 + atomic rename。

升级命令不 commit、不 push，只输出建议 Git 命令。

### 12.3 渐进发布

建议按以下阶段发布：

#### Phase 1：身份和读取兼容

- Store metadata v2；
- 结构化 pointer parser；
- UID-aware registry；
- alias ambiguity；
- Doctor diagnostics；
- 保持所有旧写路径不变。

#### Phase 2：Bootstrap 和本机 hydrate

- `rasen bootstrap`；
- 当前项目 checkout 以 `projectId` 注册；
- Store clone locator；
- identity mismatch 防护；
- legacy pointer 升级。

#### Phase 3：项目分片和 eject 安全

- `.rasen-store/projects/<projectId>.yaml`；
- `store add-project` 和 adopt 写新格式；
- v1 adoption 迁移；
- eject 不再使用 `sourcePath`；
- 旧 project namespace 双读兼容。

#### Phase 4：Portable checkpoint

- export/import schema；
- 敏感字段过滤；
- base commit divergence 检查；
- 显式 Store 持久化；
- warm-seed 恢复。

每个 Phase 都应能独立发布并保持旧仓库可用。

## 13. 实现代码地图

后续 proposal/tasks 应至少覆盖以下位置：

| 模块 | 预计职责变化 |
|---|---|
| `src/core/store/foundation.ts` | Store metadata v2、UID schema、registry v2 |
| `src/core/store/registry.ts` | UID 主键、alias 辅助索引、歧义诊断 |
| `src/core/store/operations.ts` | setup/register/upgrade identity |
| `src/core/project-config.ts` | string/object pointer 双格式解析 |
| `src/core/root-selection.ts` | UID-first Store resolution |
| `src/core/effective-config.ts` | 结构化 pointer 的配置继承 |
| `src/core/store/migration.ts` | project 分片 schema、legacy adoption reader |
| `src/core/store/migration-ops.ts` | adopt/eject 新顺序与目标解析 |
| `src/core/project-home.ts` | 按 projectId hydrate checkout |
| `src/core/global-config.ts` | 多 checkout project registry |
| `src/core/relationship-health.ts` | bootstrap/identity/membership 健康 |
| `src/commands/store.ts` | upgrade/bootstrap 命令与输出 |
| `src/commands/doctor.ts` | 新诊断展示 |
| 新 `src/core/store/bootstrap.ts` | bootstrap 状态机和纯计划层 |
| 新 `src/commands/bootstrap.ts` | CLI adapter、交互和 JSON |
| 新 checkpoint 模块 | export/import、过滤和 lineage |

实现应保持“核心纯计划 + command mutation adapter”的分层：

```text
inspect/plan（只读、可单测）
        ↓
confirm（CLI 交互）
        ↓
apply（原子本机写）
        ↓
render result（human/JSON）
```

## 14. 测试策略

### 14.1 单元测试

必须覆盖：

- UUID metadata v2 解析和 round-trip；
- legacy metadata/pointer 兼容；
- UID mismatch；
- alias 0/1/N 命中；
- 纯数字 alias warning；
- remote 凭据检测与脱敏；
- project 分片 schema；
- legacy `sourcePath` 不参与目标解析；
- eject 目标优先级；
- checkpoint 白名单过滤；
- `--check` 零写入。

### 14.2 CLI 集成测试

使用隔离的 `RASEN_HOME` 构造两台机器：

```text
machine-a/home
machine-b/home
shared-remotes/project.git
shared-remotes/store.git
```

关键场景：

1. A 创建 Store + adopt 项目 + push；
2. B 只 clone 项目，执行 bootstrap；
3. B 自动或按提示 clone Store；
4. B 的 `status/list/new change` 解析到正确 Store；
5. B 的 project binding 按 `projectId` 恢复；
6. B eject 时不会使用 A 的路径；
7. B 指定 `--into` 后正确 eject；
8. pointer UID 与 clone Store UID 不同，注册失败；
9. 两个同名不同 UID Store 同机注册，alias 访问报歧义；
10. 两个同名不同 projectId 项目进入同一 Store，两个分片都保留。

### 14.3 Git 并发测试

从同一个 Store remote 创建 A/B 两个 clone：

1. A 添加 project A；
2. B 添加 project B；
3. 双方生成不同 `projects/<uuid>.yaml`；
4. A push；
5. B rebase/merge；
6. 两条成员记录都存在；
7. context/doctor 能组装两个项目；
8. 相同 alias 只产生歧义诊断，不丢数据。

另测双方修改同一个 projectId：

- Git 应产生正常冲突或顺序更新；
- 合并后 schema validator 检查 adoption 所有权；
- 不允许 last-writer-wins 静默覆盖。

### 14.4 安全测试

- remote 参数不经过 shell；
- 带 token URL 不写入 metadata/pointer/checkpoint；
- clone 到非空目录失败；
- UID mismatch 不更新 registry；
- checkpoint 中绝对路径、PID、token 被拒绝或删除；
- malformed YAML 不触发部分写；
- atomic write 失败后保留旧 registry。

### 14.5 回归测试

必须保持：

- v1 Store 可继续 `--store <id>` 使用；
- 无 Store pointer 的经典项目行为不变；
- `doctor` 仍完全只读；
- setup/register 不自动 commit 用户已有仓库；
- store references 的现有只读语义；
- dry-run 不 mint projectId、不创建 home、不修改 config；
- human 和 JSON root selection 保持一致。

## 15. 验收标准

### 15.1 Fresh-machine bootstrap

- **GIVEN** 一台空 `~/.rasen` 的机器只 clone 了项目仓库
- **AND** 项目有结构化 Store pointer 和 remote
- **WHEN** 用户运行 `rasen bootstrap`
- **THEN** Rasen 定位或 clone Store、校验 UID、注册 Store 和项目 checkout
- **AND** 后续 `rasen status` 使用 Store planning root。

### 15.2 Identity mismatch

- **GIVEN** pointer 期望 UID A
- **AND** 目标路径中的 Store metadata 是 UID B
- **WHEN** bootstrap/register 运行
- **THEN** 命令失败且不更新 registry、不修改 pointer、不删除 checkout。

### 15.3 Cross-machine project registration

- **GIVEN** 两台机器向同一 Store 添加两个不同 `projectId`
- **AND** 两个项目具有相同可读 ID
- **WHEN** Git 修改合并
- **THEN** 两个 project 分片均保留
- **AND** 按 UUID 可精确寻址，按别名寻址报告歧义。

### 15.4 No local paths in Git

- **GIVEN** adopt、add-project、bootstrap、eject 和 checkpoint export
- **WHEN** 检查它们写入的 Git 跟踪文件
- **THEN** 不存在本机绝对 checkout 路径、PID、锁或凭据。

### 15.5 Safe eject

- **GIVEN** adoption 来自另一台机器
- **AND** 当前机器没有对应 project checkout
- **WHEN** eject 未提供 `--into`
- **THEN** 命令失败并要求目标路径
- **AND** 不尝试创建或写入 legacy `sourcePath`。

### 15.6 Read-only commands

- **GIVEN** Store 未 bootstrap 或关系损坏
- **WHEN** 运行 `status/list/doctor/bootstrap --check`
- **THEN** 命令只报告状态和修复命令
- **AND** Git worktree、registry 和文件系统快照保持不变。

### 15.7 Portable continuation

- **GIVEN** A 导出一个 checkpoint 并提交到 Store
- **AND** B bootstrap 同一 projectId/storeUid
- **WHEN** B import checkpoint
- **THEN** B 创建新的本机 session，从 portable progress 继续
- **AND** 不恢复 A 的绝对路径、PID、锁、token 或 provider session。

## 16. 开发拆分建议

后续不要把全部内容放入一个超大 change。建议拆为四个有依赖关系的
change：

```text
1. store-immutable-identity
   ├── storeUid
   ├── pointer v2
   ├── registry v2
   └── UID-first resolution

2. store-bootstrap-and-hydration
   ├── explicit bootstrap
   ├── clone locator
   ├── projectId checkout hydration
   └── doctor guidance

3. project-keyed-store-membership
   ├── projects/<projectId>.yaml
   ├── adoption v2
   ├── sourcePath removal
   ├── safe eject
   └── legacy migration

4. portable-run-checkpoints
   ├── export/import
   ├── sensitive-field filter
   ├── base SHA divergence
   └── warm-seed continuation
```

依赖关系：

```text
store-immutable-identity
          │
          ▼
store-bootstrap-and-hydration
          │
          ▼
project-keyed-store-membership
          │
          ▼
portable-run-checkpoints
```

前三个 change 完成后，多机 clone、注册、项目 namespace、adopt/eject
已经完整可用。第四个 change 专门解决“另一台机器继续同一次自动化 run”，
不阻塞基础多机协作发布。

## 17. 最终锁定决策

1. Store 新增不可变 UUID `uid`，现有 `id` 降级为可读别名。
2. 不使用全局自增数字；纯数字别名只做兼容。
3. Project 继续使用已有 UUID `projectId` 作为共享身份。
4. Store 项目成员按 `projectId` 分文件保存。
5. Git 共享数据中彻底移除本机绝对路径。
6. eject 只使用显式目标、当前 checkout 或本机 project registry。
7. 新机器通过显式 `rasen bootstrap` clone/register/hydrate。
8. 普通命令和 Doctor 永不隐式 clone、register、pull 或 repair。
9. `~/.rasen` 永不整体同步，只从 Git 声明重建绑定。
10. 进行中的运行态通过显式、脱敏、带 base SHA 的 checkpoint 交接。
11. 多机并发使用 UUID 分片 + Git 乐观并发，不引入中央服务。
12. 所有迁移均先 dry-run，保持旧格式可读，并分阶段发布。

这组决策将传统开发的：

```text
clone repository → work
```

扩展为 Store 模式下接近同等清晰的：

```text
clone project → rasen bootstrap → work
```

同时保留 Git 原生、离线优先、无后台同步和机器状态不入库的基本边界。
