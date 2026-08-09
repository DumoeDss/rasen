# 缺陷说明:`rasen store adopt --dry-run` 低报归档条目

> **状态:已修复(2026-07-25)**,落在 change `rasen/changes/fix-adopt-dryrun-archive-preview`(未提交)。
> 采用下文「修复方案」的推荐改法 1(给 `handleAdoptArchive` 加 `dryRun` 入参);唯一偏差:真副作用调用**保留在守卫内原位**(manifest 写之后),
> 只把 dry-run 预览调用提到守卫外,以免破坏「manifest 先于源删除」的 resume 不变量。
> 顺带修掉验证步骤 3 暴露的第二处 dry-run 泄漏:`ensureProjectIdInConfig` 在 dry-run 也会往 tracked `rasen/config.yaml` 写 `projectId:`(git status 变脏)。
> 验证步骤 1–6 全过(见 change 的 tasks.md §3)。

> 跨 session 移交文档。新 session 读本文即可独立处理,无需原对话上下文。
> 关联已归档 change:`rasen/changes/archive/2026-07-24-store-migration-commands`(ship `07bd768f`)。
> 涉及 spec capability:`store-adopt`(主)、`archive-relocate`(作为正确参照)。

## 症状

`rasen store adopt <path> --to <store-id> [--archive move|external|leave] --dry-run` 的输出里,归档行永远显示 0:

```
  Archive: move (0 entries)
```

即便源仓库 `rasen/changes/archive/` 下有几百个归档目录。**dry-run 完全无法预览归档搬迁规模**,用户无法据此判断操作量。真实(非 dry-run)adopt 会照常搬走全部归档条目——所以这是 dry-run 预览缺陷,不是搬迁本身的正确性 bug。

实测撞到本缺陷的场景:elftia 仓库有 **496 个归档目录 / 4011 个文件**,dry-run 报 `0 entries`;真实 adopt 全部正确搬入 store(`Archive: move (496 entries)`)。

## 根因(已定位到行)

文件:`src/core/store/migration-ops.ts`,`adoptProject` 函数。

- **第 294 行** `if (!input.dryRun) {` 守卫把所有副作用包了起来。
- **第 343 行** `archiveMoves = await handleAdoptArchive(...)` 在守卫**内部**。
- 因此 dry-run 时 `archiveMoves` 保持初始值 `[]`(第 292 行),命令层格式化器(migration-ops.ts 末尾 / `src/commands/store-migration.ts`)用 `archiveMoves.length` 渲染,自然显示 0。

对比 **`archive relocate` 的 dry-run 是正确的**——同一文件第 695-699 行,在守卫**外部**调用:

```ts
const moves = await moveArchiveEntries([...sources], targetDir, {
  ...storeOpts,
  ...(input.verifyHash ? { verifyHash: true } : {}),
  ...(input.dryRun ? { dryRun: true } : {}),   // ← dryRun 透传,枚举但不搬
});
if (!input.dryRun) {
  updateProjectConfigKey(projectRoot, 'archive.destination', destinationValue); // 真副作用才进守卫
}
```

`moveArchiveEntries` 本身已支持 `dryRun` 选项(枚举 moves、不实际拷贝),relocate 用对了。adopt 没用对。

## 为什么重要

adopt 是跨仓库、删除几千个 git-tracked 文件的大操作,dry-run 是用户「先看再决定」的唯一安全网。归档动辄成百上千条目,0 报告会让用户严重低估规模、跳过 `--verify-hash`、或没准备好两仓库的提交规划。这违背 `store-adopt` spec 的「Adopt is git-safe and previewable」契约。

## 修复方案

把归档**枚举**从 `if (!input.dryRun)` 守卫里提出来,让它 dry-run 时也跑(只读、不搬),真副作用留在守卫内。难点在 `handleAdoptArchive`(第 392-420 行)对三种 mode 的处理:

- **`leave`**:直接返回 `[]`,无副作用,天然 dry-run 安全。
- **`move`**:只调 `moveArchiveEntries`,后者已支持 `dryRun` —— 把 `dryRun` 透传即可,无副作用。
- **`external`**(需小心,两处副作用):
  1. 第 406-409 行 `resolveProjectHome(sourcePath, { ensure: true })` —— `ensure: true` 会**铸造 projectId / 建 home 目录**,是写操作。dry-run 时必须改用 `ensure: false`(只读探测;读不到 home 就在 result 里标注「external 目标尚未创建」,不要 throw)。
  2. 第 418 行 `updateProjectConfigKey(sourcePath, 'archive.destination', 'external')` —— 配置写,必须留在 `if (!dryRun)` 守卫内。

建议改法(二选一,推荐前者):

1. **给 `handleAdoptArchive` 加 `dryRun` 入参**:内部按上述规则跳过/降级副作用,`moveArchiveEntries` 透传 `dryRun`;然后把第 343 行的调用**提到守卫外**,配置 flip 单独留在守卫内(或由 `handleAdoptArchive` 内部按 `dryRun` 决定)。结构对齐 relocate。
2. 在 `adoptProject` 的 dry-run 分支单独跑一次只读枚举(`listSubdirectoryNames` + 解析 targetDir,external 用 `ensure:false`),复用同一渲染。

注意:**specs/changes 的 `moveTreeVerified` 循环**(第 329-340 行)目前在守卫内,dry-run 也不预览它们的具体文件——但 dry-run 已经打印了 spec/change **名字列表**,规模可见,所以那部分不构成同类缺口。本修复只针对归档。

## Spec 影响(建议补回归场景)

`rasen/specs/store-adopt/spec.md` 的「Adopt is git-safe and previewable」requirement 现有场景只覆盖「Dry run shows the plan including uncommitted work」。建议新增一条明确场景,锁死回归:

```
#### Scenario: Dry run previews archive moves
- **WHEN** the user runs `rasen store adopt . --to <store> --archive move --dry-run` and the repo has archived changes
- **THEN** the archive line reports the real entry count and names (or count), no files move, and no config changes
```

`external` mode 同理补一条(dry-run 不建 home、不改 config)。`archive relocate` 的 dry-run 已正确,可作为同形态参照,无需改 spec。

## 验证步骤

1. 在 rasen 仓实现修复后 `pnpm build`(或等价),本地 link 生效。
2. 准备一个有归档的 in-repo 测试仓库 + 一个空 store。
3. `rasen store adopt <repo> --to <store> --archive move --dry-run` → 归档行应显示真实条数;`git status` 两仓库均无变化;`config.yaml` 无 `store:` 写入。
4. 同上换 `--archive external --dry-run` → 显示真实条数;`~/.rasen/projects/<home>/` 未新建 home 目录;`config.yaml` 未写 `archive.destination`。
5. 删 dry-run 跑真实 adopt → 仍正确搬迁全量归档(回归未破)。
6. 跑既有 adopt/eject 测试套件确保未引入回归。

## 落地建议

新 session 可直接 `rasen-propose store-adopt-dryrun-archive-preview`(或视为已归档 change 的小补丁),把本文作为 proposal/design 输入。改动面很小:单文件 `src/core/store/migration-ops.ts` 的 `adoptProject` + `handleAdoptArchive`,外加 spec 一条场景 + 对应单测。
