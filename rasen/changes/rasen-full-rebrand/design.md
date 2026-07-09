## Context

rasen 已完成 CLI/包名品牌化（`rasen` bin、`RASEN_*` env、全局配置目录迁移 `migrateLegacyBrandConfig`），但命令前缀 `/opsx:*`、技能命名空间 `openspec-*`、工作区目录 `openspec/` 仍与上游共享，导致同一项目内 rasen 与上游 OpenSpec 互相覆写。改名面实测：

- `opsx` 前缀**无统一常量**——28 个 adapter 各自硬编码文件路径（两种形态：`commands/opsx/<id>.md` 子目录形、`opsx-<id>.md` 连字符形），`src/utils/command-references.ts:19` 有 `/opsx:/g` 正则，24 个 workflow 模板正文含 ~102 处 `/opsx:` 字面量。
- 目录名有两组常量（`config.ts:1` `OPENSPEC_DIR_NAME`、`openspec-root.ts:11-22` `OPENSPEC_*`），但 ~40 处代码以字面量 `'openspec'` 绕过它们。
- 技能目录名由 `profile-sync-drift.ts` `WORKFLOW_TO_SKILL_DIR` 映射（`openspec-*`），`pipelines/*.yaml` 以技能 ID 引用。
- 已有可复用蓝本：`global-config.ts` `migrateLegacyBrandConfig()`——copy-not-move、不覆盖已存在目标、best-effort、旧目录保留只读。
- store：`.openspec-store/` 元数据目录名、默认根 `~/openspec/<id>`、registry.yaml 持久化绝对路径。
- 本仓库自身用 `openspec/` 跑工作流，需自举迁移。

## Goals / Non-Goals

**Goals:**
- rasen 与上游 OpenSpec 在同一项目零冲突共存：命令、技能、工作区目录三个命名空间完全隔离。
- 旧 `openspec/` 工作区一键迁移（复制），旧目录 rasen 永不写入。
- 结构性标识（路径、前缀、目录名）单点定义，杜绝再次散落。
- README 以共存说明取代卸载要求。

**Non-Goals:**
- 不改 change 内部元数据文件名 `.openspec.yaml`（藏在 rasen 自己的工作区内，无冲突面；改名只赚品牌纯度、赔历史 archive 兼容性）。
- 不改 `OPENSPEC_MARKERS` 常量值（仅用于识别**遗留**块，改值反而识别不了旧安装）。
- 不重写用户 store registry 中已注册的绝对路径（旧路径继续有效）。
- 不提供 `rasen/` → `openspec/` 反向迁移。
- 不承诺与上游 v1.5 布局兼容（对齐声明相应改写）。

## Decisions

### D1. 品牌标识常量单点化，散落字面量收编
在 `src/core/config.ts` 建立唯一品牌命名源：
```ts
export const WORKSPACE_DIR_NAME = 'rasen';            // 原 OPENSPEC_DIR_NAME
export const LEGACY_WORKSPACE_DIR_NAME = 'openspec';
export const COMMAND_PREFIX = 'rasen';                // 斜杠命令前缀 & 命令文件路径段
export const LEGACY_COMMAND_PREFIX = 'opsx';
export const SKILL_PREFIX = 'rasen';                  // 技能 name/dirName 前缀
```
- 28 个 adapter 的 `getFilePath()` 改为从 `COMMAND_PREFIX` 拼接（消除 28 处独立硬编码）；`command-references.ts` 的冒号→连字符变换以常量构造正则。
- `openspec-root.ts` 的 `OPENSPEC_ROOT_DIR` 等常量重命名为 `WORKSPACE_*` 并取值 `rasen`；~40 处字面量 `'openspec'` 路径段逐一改为引用常量（`archive.ts`、`change-utils.ts`、`planning-home.ts`、`root-selection.ts` 等，见勘察清单）。
- 模板正文的 ~102 处 `/opsx:` 与 `openspec-*` 技能名：prose 用机械替换而非逐处插值（可读性优先），由 **brand-guard 测试**兜底——新增测试生成全部命令/技能/模板产物，断言不含 `/opsx:`、`openspec-`、`commands/opsx/` 等遗留 token（白名单豁免 legacy 迁移代码自身）。
- 为什么不全部插值：200+ 处 `${COMMAND_PREFIX}` 会让模板难读难 diff；guard 测试给出与插值等强的防回归保证，成本低一个数量级。

### D2. 工作区解析：只认 `rasen/`，旧目录只导不读
- 根解析只认 `rasen/`（nearest 向上查找逻辑不变，目标名换成 `WORKSPACE_DIR_NAME`）。**不做静默回退读 `openspec/`**——同项目并存上游时，`openspec/` 是上游的活工作区，静默读取等于劫持，也让"当前生效的是哪套规格"变得不可判定。
- 需要工作区而 `rasen/` 不存在时：若检测到 `openspec/`，报错文案升级为迁移引导（"检测到 OpenSpec 工作区，运行 `rasen migrate` 迁移（只复制，原目录不动），或 `rasen init` 新建"）。
- 迁移执行者 `rasen migrate`（新命令）+ `rasen init` 检测到旧目录时的交互式提示（复用同一实现）。语义完全复刻 `migrateLegacyBrandConfig` 契约：递归**复制** `openspec/{specs,changes,config.yaml}` → `rasen/`；目标已存在的文件一律跳过不覆盖；任何失败不中断（汇总报告）;源目录零写入、零删除。幂等：重复运行只补缺失文件。
- 迁移后旧目录去留完全交给用户：继续给上游用（共存）或手动删除（彻底切换）。rasen 不删。

### D3. 技能与 pipeline 命名空间
- `WORKFLOW_TO_SKILL_DIR` 映射值 `openspec-<x>` → `rasen-<x>`；其中原 `openspec-opsx-<x>`（如 `openspec-opsx-ship`）折叠为 `rasen-<x>`，不留双前缀。
- 专家技能 `name` 字段 `openspec:<x>` → `rasen:<x>`；`metadata.author` → `rasen`。
- `pipelines/*/pipeline.yaml` 引用的技能 ID 同步替换（数据文件与代码同一 change 内原子更换，不做双 ID 兼容期——pipeline yaml 随包分发，版本天然一致）。

### D4. 遗留产物处理：宁留勿删
共存是第一原则，所有清理必须先回答"这个文件确定是我装的吗"：
- **命令文件**（`.claude/commands/opsx/`、`opsx-*.md` 等）：rasen 无法与上游产物可靠区分（同源模板、同 marker），因此 `rasen update`/`init` **一律不删**，仅在检测到时打印一次性提示（"发现 /opsx:* 命令文件；若来自旧版 rasen 可手动删除，若在用上游 OpenSpec 请保留"）。
- **技能目录**（`openspec-*`）：同规则——仅提示，不删。现有 `openspec-gstack-*` 孤儿清理逻辑（init.ts:582）限定的是本 fork 独有的 gstack 名字空间，保留不变。
- **AGENTS.md marker 块清理**：现行 legacy-cleanup 会移除 `OPENSPEC_MARKERS` 包裹的块——共存场景下该块可能是上游**正在维护**的活配置。改为仅在用户确认迁移意图后（migrate 流程内询问，默认否）才移除；`update` 路径不再自动清理 marker 块。
- 依据：fork 尚未 npm 发布，"旧版 rasen 遗留"体量≈0，激进清理收益趋零而误删上游文件的代价极高。

### D5. store 命名
- `STORE_METADATA_DIR_NAME` `'.openspec-store'` → `'.rasen-store'`；探测店根时先查新名、失配再查旧名（读兼容）；注册/写入一律写新名。旧名目录存在且新名不存在时，注册流程按 D2 同款 copy-not-move 迁移元数据。
- 默认 store 位置 `~/openspec/<id>` → `~/rasen/<id>`（仅影响新注册；registry 里的旧绝对路径原样有效）。

### D6. 本仓库自举迁移
实现序列上 CLI 先支持 `rasen/`，最后一步 `git mv openspec rasen` 迁移本仓库工作区（含本 change 目录自身）。git mv 保 history；in-flight changes 路径随目录整体移动，`.openspec.yaml` 元数据文件名不变故无内部引用断裂。schemas/`templates/proposal.md` 中指引文本的 `openspec/specs/` 路径同步改 `rasen/specs/`。CI 与 hooks（`compact-recovery.sh`）内的路径引用同批更新。

### D7. 文档与对齐声明
- README/README_zh：删除 `npm uninstall -g @fission-ai/openspec` 段；新增"与 OpenSpec 共存"小节（三个命名空间隔离、可同项目并用、`rasen migrate` 迁移路径）；第 25/48 行"布局与上游一致/unchanged from upstream"改为"工作流语义对齐 v1.5.0，命名空间独立"。
- `docs/`、`docs/zh/` 中的 `/opsx:` 与 `openspec/` 目录引用全量对齐（brand-guard 测试同样覆盖 docs 构建产物则更佳，至少覆盖生成模板）。

## Risks / Trade-offs

- [~1300 处测试引用机械替换引入笔误] → brand-guard 测试 + 全量 `pnpm test` 把关；替换按目录分批提交，每批可独立回归。
- [上游 cherry-pick 成本永久上升（路径/前缀 diff 噪音）] → 接受：这是独立品牌的固有代价；缓解手段是 D1 的常量单点化——上游 patch 落到散落字面量的概率随收编下降。
- [用户同项目并存两套工作区，规格双源] → 文档明确"迁移后 rasen/ 为唯一事实源，openspec/ 归上游"；rasen 对旧目录零写入保证不产生第三种状态。
- [Windows 路径大小写/分隔符在 40 处字面量收编中出错] → 沿用项目铁律 path.join；guard 测试在 CI 三平台矩阵跑。
- [`rasen-<x>` 技能名与 `opsx` 折叠（D3）造成 pipeline resume 旧 run-state 引用旧技能 ID] → run-state 属短命中间态，文档声明升级前完成或放弃 in-flight run；resume 读到未知技能 ID 时报错文案给出新旧映射提示。
- [迁移复制大工作区（含 archive）耗时/占盘] → archive 一并复制保完整性；提示中报告文件数与体积；可接受（文本为主）。

## Migration Plan

1. 常量与解析层（D1/D2 的常量、根解析、migrate 命令）——此时仓库自身仍是 `openspec/`，用 `LEGACY` 常量保测试通过的过渡期最短化：同 change 内立即执行步骤 4。
2. 生成层（adapter 路径、模板正文、技能映射、pipelines yaml）+ brand-guard 测试。
3. 遗留处理与 store（D4/D5）+ init/update 文案。
4. 本仓库 `git mv openspec rasen` + schemas/hooks/CI 路径 + 全量测试替换。
5. 文档（README 双语、docs/、docs/zh/）。
回滚：单 change 原子回退（git revert 序列）；用户侧无远端状态，回滚旧版 CLI 即恢复读 `openspec/`（rasen/ 目录留存无害）。

## Open Questions

- `rasen migrate` 是否顺带迁移 store 元数据目录（D5）还是仅工作区？倾向：workspace 迁移只管工作区，store 元数据在下次 `store register`/访问时惰性迁移。
- docs 站（website/）里的命令引用是否本 change 内一并改：倾向一并改，工作量小。
