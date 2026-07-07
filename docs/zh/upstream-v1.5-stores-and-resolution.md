# 上游 v1.5.0 详解：Stores 体系与架构收敛

> 本文分析上游 `origin/main`（Fission-AI/OpenSpec，版本 v1.5.0，2026-07 同步）相对本
> fork（dev-harness，分叉点 `afdca0d`）新增的两大块内容：
>
> 1. **Stores 体系** —— 替换掉整个 beta 期 workspace / initiative / collection /
>    context-store 概念的新模型（breaking change，PR #1190 及一系列前置演进）。
> 2. **架构收敛** —— 分两层：
>    - **根解析收敛**（stores beta 的一部分）：所有常规命令统一通过
>      `src/core/root-selection.ts` 决定"在哪个 OpenSpec root 上动作"，并统一了
>      JSON 输出信封与退出码契约；
>    - **解析逻辑对等修复**（commit `a325305`，PR #1280，修 #1182/#1202/#1156）：
>      把 validate / view / archive 各自复制后悄悄发散的 change 发现、任务计数、
>      SHALL/MUST 校验三条路径收敛回 canonical 实现。
>
> 结尾给出对 dev-harness 合并上游时的迁移指引。
>
> 主要依据：上游源码（`src/core/store/`、`src/core/root-selection.ts`、
> `src/commands/{store,context,workset,doctor,shared-output}.ts`）、上游官方文档
> （`docs/stores-beta/user-guide.md`、`docs/agent-contract.md`）、上游设计史料
> （`openspec/work/simplify-context-and-workspace-model/`、
> `openspec/initiatives/context-store-and-initiatives/`）以及 `git show a325305`。

---

## 第一部分：Stores 体系

### 1. 一句话总览

一个 **store** 就是"一个独立的 Git 仓库，里面装一份标准的 `openspec/`（specs +
changes），外加一个极薄的身份文件 `.openspec-store/store.yaml`"。你在本机把它按
名字注册一次，之后所有常规 OpenSpec 命令都能用 `--store <id>` 在它里面操作。

**OpenSpec 自己永远不 clone / pull / push / sync** —— 共享完全靠用户自己的 git
推拉。这是刻意的设计底线（"No sync, ever — by design"）。

核心命题被上游压缩成两句话：

```
Specs are what is true.    （specs/    = 已成立的事实）
Work  is what is in motion.（changes/  = 进行中的工作）
```

### 2. 它解决什么问题

OpenSpec 传统上活在单个代码仓里：`openspec/` 目录挨着代码。当规划大于一个仓库时
这就不够用了：

- 一个 feature 横跨 API server、web app、shared library —— plan 放谁的
  `openspec/`？
- 团队在代码存在之前就开始规划，或规划的东西根本不会变成"这个仓库"的代码；
- 需求由一个团队拥有、被多个团队消费 —— wiki 版本会漂移，且 coding agent 读不到。

旧 beta 模型试图用一整套并列概念回答这个问题：

```
Context stores sync truth.       （context store 负责同步事实）
Collections shape truth.         （collection 组织事实）
Initiatives coordinate work.     （initiative 协调工作）
Workspaces open local views.     （workspace 打开本地视图）
Changes implement repo-owned slices.
```

结论是失败的：用户和 agent 要同时理解四五个产品系统，难解释、难实现、难
dogfood（workspace 命令组删除时净减约 12,900 行）。新方向：

```
OpenSpec is a Git-native artifact format for specs and work.
```

### 3. 新旧概念对应关系

| 旧概念（beta，已删除） | 新去向 |
|---|---|
| context store | 改名 **store**，明确"绝不 sync"；committed 文件格式保留，机器 token 由 `context_store_*` 全部改为 `store_*`，数据目录 `context-stores/` → `stores/` |
| collection | 删除，无替代 |
| initiative | 删除，工作直接进 `changes/`；`new change --initiative` 被拒绝（保留 `initiative_option_removed` 诊断码），`openspec set change` 整个删除；`--store` 被重新赋义为"root 选择器" |
| workspace（命令组） | 拆成两半：**workset**（本地打开多个文件夹）+ **context**（从声明装配工作集） |
| code-repo 声明 + 本机 map | 2026-06-19 整个删除（心智模型不清晰），被 workset 的显式手工组合取代 |

三个新名词的精确边界：

| 名词 | 定义 | 是否共享 |
|---|---|---|
| **store** | 独立 Git 仓库：标准 `openspec/` + `.openspec-store/store.yaml` 身份文件；本机按 id 注册 | 仓库本身用 git 共享；本机注册记录不共享 |
| **workset** | 纯本地、私人的"命名视图"：把几个文件夹（规划仓 + 自选代码仓）攒成一个名字，一条命令在指定工具里一起打开 | 从不共享、从不提交、从不由声明推导 |
| **context**（working context） | 从**声明**（root + 它 reference 的 stores）计算出的工作集，供 agent 读或写 VS Code workspace 文件 | 无独立状态，纯计算 |

关键区分：**context 是声明推导出的数据**（只含 root + referenced stores，不推断
代码仓）；**workset 是人手工攒的**（含代码仓、纯本地）。两者刻意分开。

设计过程中被否决的方案（合并后不要在我们的设计里重提）：

- `openspec context` 曾设计为 change-anchored 的 `openspec workset <change-name>`，
  后推翻 —— workset 不锚定 change、不由声明推导；
- 顶层 marker 文件（如项目根放 `.openspec.yaml`）—— 该名已被 per-change metadata
  占用；
- 复用 "repo" 名词命名 store —— agent 会误听成"正在操作的代码 checkout"；
- per-change link 对象 —— "那等于重新发明 initiative"。

### 4. 磁盘布局与数据格式

#### 4.1 store 仓库内部

```
<store-root>/                      ← 用户自选路径（如 ~/openspec/team-plans）
├── .openspec-store/
│   └── store.yaml                 ← 身份文件（committed，随仓库共享）
└── openspec/
    ├── config.yaml
    ├── specs/
    └── changes/
        └── archive/
```

`.openspec-store/store.yaml`（`src/core/store/foundation.ts` 的
`MetadataStateSchema`，Zod strict）：

```yaml
version: 1
id: team-plans                                  # 必须 kebab-case id
remote: git@github.com:acme/team-plans.git      # 可选：权威 clone 源
```

`remote` 由 `store setup --remote` 写入初始 commit，随每个 clone 传播 —— 让健康
检查和错误信息能给没有这个 store 的队友打印一条完整可粘贴的修复命令。

#### 4.2 本机全局数据目录（`getGlobalDataDir()`）

| 平台 | 数据目录 |
|---|---|
| 设了 `$XDG_DATA_HOME` | `$XDG_DATA_HOME/openspec` |
| macOS / Linux | `~/.local/share/openspec` |
| **Windows** | **`%LOCALAPPDATA%\openspec`** |

- **store 注册表**：`<dataDir>/stores/registry.yaml`
  （Windows 实际为 `%LOCALAPPDATA%\openspec\stores\registry.yaml`）。
  ⚠️ 上游 `docs/stores-beta/user-guide.md` 的表格写成
  `<data dir>/openspec/stores/registry.yaml`，多了一层 `openspec` —— 是文档笔误，
  以代码为准（`GLOBAL_DATA_DIR_NAME` 本身已是 `'openspec'`）。
- **worksets**：`<dataDir>/worksets/`。
- 另有独立的**配置目录**（`getGlobalConfigDir()`，Windows 用 `%APPDATA%` 而非
  `%LOCALAPPDATA%`）：`%APPDATA%\openspec\config.json`，装 `openers` 工具表、
  profile、featureFlags 等。

`registry.yaml`（`RegistryStateSchema`，strict；原子写 + `registry.yaml.lock`
文件锁）：

```yaml
version: 1
stores:
  team-plans:
    backend:
      type: git                                        # 目前唯一后端
      local_path: /Users/you/openspec/team-plans        # 规范化绝对路径
      remote: git@github.com:acme/team-plans.git        # 可选（observed origin）
      branch: main                                      # 可选
```

核心不变量：**一个 store id 在一台机器上只允许一个 checkout**
（`store_id_conflict` / `store_path_conflict`）。

#### 4.3 代码仓侧的声明（`openspec/config.yaml`）

一个代码仓可以声明两种与 store 的关系：

```yaml
schema: spec-driven
references:                          # 本仓工作"draw on"哪些 store（只读上下文）
  - platform-reqs
  - { id: design-system, remote: "git@github.com:acme/design-system.git" }
store: team-plans                    # 默认 store 指针（fallback，不是 override）
```

- `references` 刻意不进 Zod schema，由 `parseDeclarationList` 手工解析为
  `DeclarationEntry[]`（`{id, remote?}`），按 id 去重保首位；
- `store:` 指针**仅当**本目录是"纯配置目录"（`openspec/` 下没有 specs/、changes/
  即无 planning shape）时生效；真 root 永远赢，指针被忽略并 warn；
- 指针有两条读取路径且刻意不同：`readProjectConfig` 宽松（坏值丢弃 + warn）；
  `readStorePointer`（供根解析用）坏值**报告**（`invalid_store_pointer`）而不静默
  丢弃 —— 静默丢指针会让工作落到错误位置，是数据安全问题。

### 5. CLI 命令面

四个命令组，统一失败契约（`src/commands/shared-output.ts`）：human 模式打
`Error:` / `Fix:` 两行 + exit 1；`--json` 模式在 stdout 打**恰好一个** JSON 文档
（含 `status: StoreDiagnostic[]`）+ exit 1。

#### `openspec store <sub>`

| 子命令 | 关键参数 | 行为 |
|---|---|---|
| `store setup [id]` | `--path`、`--init-git`/`--no-init-git`、`--remote`、`--json` | 创建 store 形状、写 `store.yaml`、默认 `git init` + 初始 commit、注册本机 |
| `store register [path]` | `--id`、`--yes`、`--json` | 注册已存在的健康 root；缺身份文件需确认后补写；**从不 commit** |
| `store unregister <id>` | `--json` | 只删本机注册记录，不删文件 |
| `store remove <id>` | `--yes`、`--json` | 删注册记录**并删本地文件夹** |
| `store list` | `--json` | 列本机注册的 stores |
| `store doctor [id]` | `--json` | 检查注册 / metadata / root 健康 / git 事实，只读 |

git 集成极窄（`src/core/store/git.ts`）：**写操作只有 `git init` 和一次初始
commit**（都只发生在 setup），其余全部只读探测（`gitHasCommits`、
`gitHasUncommittedChanges`、`gitOriginUrl` 读本地 config 绝不触网）。

#### `openspec context`

解析 root（诊断命令不脚手架，`allowImplicitRoot: false`），装配工作集 =
root + 它 reference 的、本机已注册可用的 stores。人类输出列 "OpenSpec root" +
"Referenced stores"（每条带取用命令
`Fetch: openspec show <spec-id> --type spec --store <id>`）。
`--code-workspace <path>` 是它唯一的写操作 —— 生成 VS Code workspace 文件。

#### `openspec workset <sub>`

`create`（`--member <path|name=path>` 可重复、首个为 primary、`--tool <id>`）、
`list`、`open <name>`（用保存的工具打开全部成员；编辑器开一个多 root 窗口）、
`remove`（从不碰成员文件夹）。opener 表来自全局 config 的 `openers` 键 ——
**新工具是配置，不是代码**。

#### `openspec doctor`

与 `store doctor` 的分工：`store doctor` 检查**注册表里的 stores 本身**；
`openspec doctor` 检查**当前 root 及它 reference 的 stores** 在本机是否健康可用。
只读，每条发现带可粘贴的 `Fix:`。

### 6. 与 changes/specs 生命周期的关系（跨仓工作流）

- store 里就是标准 `openspec/`，**完全可以放 changes**：
  `openspec new change add-login --store team-plans` 会在
  `team-plans/openspec/changes/add-login/` 建 change，整个生命周期
  （`status` / `instructions` / `validate` / `archive`）都带 `--store` 照常用。
- **一个 change 只活在一个 root**；跨 root 就是两个 change。
- 跨仓关系有三种，全部不是 managed link：
  1. **location**：`--store` 选工作落在哪个 root；
  2. **reference**：代码仓声明 draw on 哪些 store —— 只读上下文。
     `openspec instructions` 会附带被引用 store 的 specs **索引**（每条一行摘要 +
     精确取用命令），**index, not inline** —— 绝不把上游内容冻结内联进生成的
     指令（索引总量 50KB 上限，超限发 `reference_index_truncated`）；
  3. **citation**：artifact 散文里引用（"derives from platform-reqs/billing"），
     agent 通过 reference 机制现取。
- 典型分层流：平台团队在 store 里维护需求 specs；产品团队在自己 repo 的 root
  写 low-level design 和 changes，把 store 当被引用的上下文。谁的工作都不搬家。

### 7. Beta 状态

"Beta" 是**文档层面的稳定性声明，不是运行期 feature flag**：
`registerStoreCommand` / `registerContextCommand` / `registerWorksetCommand` /
`registerDoctorCommand` 无条件注册，没有任何开关判断（全局 config 的
`featureFlags` 存在但这些路径不消费）。含义是：命令名、flag、文件格式、JSON key
都可能在版本间变化。

已知限制：一 id 一 checkout；永不 sync（stale checkout 显示 stale specs 直到你
自己 pull）；`view` / `templates` / `schemas` 及废弃的 noun 形式不吃 `--store`；
JSON key 存在 casing 裂缝（见下文 8.3）。

---

## 第二部分：架构收敛

上游的"收敛"实际是两层不同粒度的工作，合并分析时要分开看。

### 8. 第一层：根解析收敛（stores beta 的骨架改造）

这一层解释了为什么 `src/core/archive.ts`（相对分叉点 +296/−65）、
`src/commands/validate.ts`、`src/cli/index.ts` 等文件在上游有大改 —— 它们全部被
改造为通过统一入口解析"我在哪个 root 上动作"。

#### 8.1 单一决策点：`src/core/root-selection.ts`

所有常规命令（`list` / `show` / `validate` / `status` / `instructions` /
`instructions apply` / `new change` / `archive` / `doctor` / `context`）都通过
`resolveOpenSpecRoot()` 用同一个优先级解析 root：

```
1. --store <id> 显式指定            → 该注册 store 的根       source: "store"
2. 从 cwd 向上找最近的"合格" openspec/ → 本仓库                source: "nearest"
   （config-only 目录 + 合法 store: 指针 → 声明的 store        source: "declared"）
3. 无最近 root 且本机有注册 stores    → 报错 + 选择提示
   （no_root_with_registered_stores）
4. 什么都没有                        → 脚手架类命令把 cwd 当根  source: "implicit"
                                      诊断类命令直接失败（no_openspec_root）
```

值得注意的设计细节：

- **"合格 root"判定**（`findQualifyingRootSync`）：光有一个 `openspec/` 目录不算
  root，必须有 planning shape（specs/ 或 changes/）**或** config 文件。否则推荐的
  `~/openspec/<id>` store 布局会让 `$HOME` 变成捕获一切命令的幽灵 root。
- **fallback 永不 override**：真 root 上的 `store:` 指针被忽略（stderr warn）。
- **`--store-path` 被显式移除**（`store_path_not_supported`）—— 逼用户先
  `store register` 再 `--store <id>`，保证 id → 路径的映射只有 registry 一个来源。
- `inspectRegisteredStore()` 是 metadata 身份 + root 健康的**单一非抛出检查路径**：
  root 解析器把失败映射成错误，reference 索引装配器把同样的失败映射成 warning ——
  一条检查路径绝不分叉（源码注释原话 "One shared inspection path — never fork
  it."）。

返回类型：

```ts
interface ResolvedOpenSpecRoot {
  path: string;
  changesDir: string;   // <root>/openspec/changes
  specsDir: string;     // <root>/openspec/specs
  archiveDir: string;   // <root>/openspec/changes/archive
  defaultSchema: 'spec-driven';
  source: 'store' | 'declared' | 'nearest' | 'implicit';
  storeId?: string;
}
```

#### 8.2 CLI 适配器：`resolveRootForCommand()`

每个命令的 action 里第一件事就是调它：

- 成功且 human 模式 → stderr 打横幅 `Using OpenSpec root: <id> (<path>)`
  （写 stderr 是为了让 agent 消费的 stdout 保持纯净）；
- 失败且 `--json` 模式 → stdout 打"该命令的 null 形状 + `status: [diagnostic]`"、
  `exitCode = 1`、返回 `null`（调用方必须 return）；
- 失败且 human 模式 → 异常继续向上走命令的常规错误处理。

配套工具：`withStoreFlag(root, cmd)` 让所有后续提示命令自动带上 `--store <id>`
（用户可以直接粘贴）；`isStoreSelectedRoot()` 是跨 root 行为（绝对路径输出、
`--store` 提示）的唯一判定依据。

#### 8.3 统一的机器可读契约（`docs/agent-contract.md`）

这份"agent contract"是对着发射代码逐条审计过的（capstone audit）：

- **一次调用恰好一个 JSON 文档**在 stdout；人类文案、spinner、store 横幅全走
  stderr；
- **统一诊断信封** `StoreDiagnostic`：
  `{ severity: "error"|"warning"|"info", code, message, target?, fix? }`，
  全体系 100+ 个 flat snake_case 诊断码（`unknown_store`、`store_id_conflict`、
  `archive_tasks_incomplete`……），每条尽量带可粘贴的 `fix`；
- 成功 payload 统一内嵌
  `root: { path, source, store_id? }`；
- **退出码契约**：成功（含健康发现）= 0；`--json` 命令失败 = 1 + null 形状 +
  `status`；`validate` 有失败项 = 1；交互取消 = 130；
- 已知裂缝：store 家族 JSON key 是 snake_case，workflow 家族是 camelCase
  （`root.store_id` 例外，处处 snake_case）—— 统一被推迟到带版本的 release。

### 9. 第二层：解析对等修复（commit `a325305`，PR #1280）

> ⚠️ 范围澄清：这个提交经常被误读成大重构。实际它是**外科手术式的 bug-fix
> bundle**：源码改动只有 `change.ts` 53 行、`validator.ts` 73 行、
> `task-progress.ts` 76 行、`validate.ts` 21 行、`base.schema.ts` 12 行、
> `archive.ts` **仅 +4/−4**，外加 459 行 parity 测试。它不碰
> `src/core/artifact-graph/`，也不碰 `project-config.ts`。提交信息原话：
> "Fix converges each divergent path onto the canonical one; parity is asserted
> by test. No new surface, no behavior change to the already-correct paths."

这里的 "canonical resolution" 指"一个 change 解析出什么"这套逻辑：
(1) 哪些 change 算存在；(2) 任务进度从哪些文件数；(3) delta spec 文件如何发现、
SHALL/MUST 规则如何校验。痛点是：这三件事 `status` / `instructions` 做对了，而
`validate` / `view` / `archive` / `change` 各自复制了一份并**悄悄发散**。

#### 9.1 修复 #1182：change 存在性的门槛不一致

- **之前**：`validate` 用 `getActiveChangeIds()`（要求目录里有 `proposal.md`
  才算 change），而 `status` / `instructions` 只看目录存在。后果：刚 scaffold、
  还没写 proposal 的 change，`status` 认得、`validate` 报 "Unknown item"；
  `validate --all` 在只有目录的仓里**静默 exit 0**。
- **之后**：validate 的三处调用点全部换成 canonical 的
  `getAvailableChanges(projectRoot, changesDir)`
  （`src/commands/workflow/shared.ts`，只按目录存在性列举，过滤 archive 和
  点开头目录）。
- 附带修复：`validateChangeDeltaSpecs` 原来只扫一层 `specs/<cap>/spec.md`，嵌套
  的 `specs/<area>/<cap>/spec.md` 会漏校验 —— 新增递归 walker
  `findDeltaSpecFiles(specsDir)` 发现任意深度的 spec.md。

#### 9.2 修复 #1202：任务计数瞎了（数据安全 bug）

- **之前**：`getTaskProgressForChange` 硬编码只读
  `changes/<name>/tasks.md` 单文件。但 schema 可以通过 `apply.tracks` 声明任务
  artifact，其 `generates` 是 glob（可匹配嵌套的多个 tasks.md）。`status` 走
  `resolveArtifactOutputs` 按 glob 解析，`view` / `archive` 没有。后果：
  (a) view 把有嵌套 tasks 的 change 误判为 Draft；
  (b) **archive 的"未完成任务"闸门失效** —— 上游实测把 3/5 未完成的 change 直接
  搬进了 archive。
- **之后**：`getTaskProgressForChange(changesDir, changeName, projectRoot)`
  新增第三参，内部调用链统一为：

  ```
  resolveSchemaForChange（显式参数 > change 的 .openspec.yaml > config.yaml > 'spec-driven'）
    → resolveSchema（项目级 openspec/schemas/ > 用户级数据目录 schemas/ > 包内置 schemas/）
    → findTrackedTasksArtifact（apply.tracks 匹配 > 回退 id==='tasks'）
    → resolveArtifactOutputs（fast-glob）→ 跨所有匹配文件累加计数
    → 任一步失败 → 回退单文件 tasks.md（helper 保证 never-throw）
  ```

  view / list / archive / change 的全部 5 处调用点补传 projectRoot；`change.ts`
  里手抄的第二份 `countTasks` 连同正则常量一起被删除。

#### 9.3 修复 #1156：SHALL/MUST 提示对 main spec 失灵

- **之前**：delta spec 走命令式校验（有精确提示），main spec 走 Zod
  `.refine`——但 main-spec 解析器在跑 Zod 之前已把需求 header 折叠进 text，Zod
  分不清"关键字只在标题里"和"正文里有"，只能吐笼统错误。
- **之后**：删掉 `base.schema.ts` 里 `RequirementSchema.text` 的
  `.refine(SHALL||MUST)`，SHALL/MUST 校验统一由 `Validator.applySpecRules` 命令式
  拥有，复用 delta 路径信任的同一解析器
  （`extractRequirementsSection(content).bodyBlocks`），每条需求恰好报一次、给出
  与 delta 逐字节一致的可操作提示（"把 SHALL 挪到 header 下一行"）。

整组修复由 5 个 parity 测试文件钉死（`test/utils/task-progress.test.ts`、
`test/core/validation.test.ts`、`test/commands/validate.test.ts`、
`test/core/archive.test.ts`、`test/core/view.test.ts`），防止三条路径再度 fork。

---

## 第三部分：对 dev-harness 合并的影响

### 10. 冲突面回顾

dev-harness 与上游共同修改且会冲突的核心 src 文件：`src/cli/index.ts`、
`src/commands/validate.ts`、`src/core/archive.ts`、`src/core/init.ts`、
`src/core/profiles.ts`、`src/core/project-config.ts`、
`src/core/artifact-graph/instruction-loader.ts`、`src/core/global-config.ts`。
其中 archive/validate 的上游大改主要来自**第一层根解析收敛**（+ a325305 的少量
对等修复），不是单一提交，逐 commit cherry-pick 不现实，应整体 merge。

### 11. 我们的自定义逻辑迁移到哪些新挂载点

| 我们 fork 里的改动类型 | 合并后的正确挂载点 |
|---|---|
| archive 前的额外检查 / 闸门（opsx） | 仍在 `ArchiveCommand.run`，但任务闸门数据源必须走 `getTaskProgressForChange(changesDir, name, projectRoot)`（三参版）；不要再手抄任务计数 |
| validate 的 change 发现 | 换 `getAvailableChanges(root.path, root.changesDir)`（上游 validate 内包了一层 `listChangeIds` 私有方法做排序），三处调用点都要换，否则 parity 测试挂。注意：dev-harness 当前是无参调用 `getActiveChangeIds()`，签名已与上游 pre-fix 版本不同，解冲突时留意参数 |
| validate 的自定义 spec 规则 | 加在 `Validator.applySpecRules`（命令式），**不要**加回 `base.schema.ts` 的 Zod refine（上游已把 SHALL/MUST 从那里下移；dev-harness 当前仍带旧 `.refine`，合并时要删） |
| 嵌套多区域 delta 处理 | 用 `Validator.findDeltaSpecFiles(specsDir)` 递归发现 |
| 任何新命令的 root/输出处理 | 注册进 `src/cli/index.ts` 后，action 开头调 `resolveRootForCommand()`；JSON 输出遵守"一个文档 + `root` 块 + `status` 数组"契约；诊断用 `StoreDiagnostic` 信封（snake_case code + 可粘贴 fix） |
| 我们的 pipeline / opsx CLI 输出 | 建议逐步对齐 agent-contract 的信封（`shared-output.ts` 的 `asStatus` 用鸭子类型提取诊断，自定义 Error 只要带同形 `diagnostic` 字段即可复用） |

### 12. 建议的迁移顺序（风险低 → 高）

1. `src/utils/task-progress.ts`（自包含、never-throw、带单文件回退）→ 更新 5 处
   调用点补 projectRoot；
2. `validator.ts` 的 `findDeltaSpecFiles` + `applySpecRules` SHALL/MUST + 删
   `base.schema.ts` 的 refine —— **三者必须一起动**，否则双重报错或漏报；
3. `validate.ts` 的 change 发现换 `getAvailableChanges` —— 与我们 fork 的
   root/发现签名交叉最多，冲突最可能在此；
4. 每步跑上游带来的 parity 测试锁定对等性。

其他注意事项：

- **CORE_WORKFLOWS 冲突**（`src/core/profiles.ts`）：我们加了 `'auto-command'`，
  上游加了 `'sync'`，同一行 —— 合并时两者都保留；
- stores 的数据目录逻辑依赖 `getGlobalDataDir()` / `getGlobalConfigDir()`，我们
  fork 对 `global-config.ts` 有小改（+12/−1），解冲突时保证这两个函数语义与上游
  一致，否则 registry 路径漂移会导致 store 全部"未注册"；
- 我们的 opsx 文档与 skill 模板里如出现 workspace / initiative 词汇，合并后需要
  对齐 stores 术语（上游连诊断码都清洗过一轮）。

---

## 附录：上游权威材料索引

| 主题 | 位置（origin/main） |
|---|---|
| Stores 用户指南 | `docs/stores-beta/user-guide.md` |
| Agent JSON 契约（全部 shape + 诊断码目录） | `docs/agent-contract.md` |
| 设计目标与约束 | `openspec/work/simplify-context-and-workspace-model/goal.md`、`roadmap.md`、`workset-direction.md` |
| beta 演进史（为什么推倒 workspace/initiative） | `openspec/initiatives/context-store-and-initiatives/README.md`、`direction-git-native-work.md`、`decisions.md` |
| store 核心实现 | `src/core/store/{foundation,registry,operations,git,errors}.ts` |
| 根解析实现 | `src/core/root-selection.ts` |
| 解析对等修复 | `git show a325305`（含 change 目录 `openspec/changes/fix-validate-view-resolution-parity/` 的 proposal/design/specs） |
