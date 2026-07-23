# Rasen Agent 契约

`rasen` CLI 的机器可读接口面，已对照 `src/` 验证（capstone audit，2026-06-11）。下文的每一个结构都依据产生它的代码记录而来。

## 1. 通用约定

- **每次调用一个 JSON 文档。** 在 `--json` 模式下，stdout 恰好承载一个 JSON 文档（2 空格美化打印）。人类可读的文字、旋转指示器（spinner）以及 store banner 都输出到 stderr。
- **Store banner。** 在人类模式下，被 store 选中的 root 会向 stderr 打印 `Using Rasen root: <id> (<path>)`。在 JSON 模式下从不打印。
- **键的大小写取决于接口面**（参见已知不一致之处）：store/doctor/context 载荷使用 `snake_case`；工作流载荷（`status`、`instructions`、`new change`、`validate`、`list`）使用 `camelCase`，但内嵌的 `root` 对象除外，它始终使用 `store_id`。
- **在大多数载荷中，可选键被省略而非 `null`**（例如 `root.store_id`、`member.path`）。使用显式 `null` 的例外情况按结构逐一说明（store doctor 的 `git.*`、失败载荷）。

## 2. 诊断信封（envelope）

所有机器可读的诊断共享同一个信封结构（`StoreDiagnostic`）：

```json
{
  "severity": "error" | "warning" | "info",
  "code": "snake_case_string",
  "message": "human sentence",
  "target": "dotted.surface (optional)",
  "fix": "one actionable sentence/command (optional)"
}
```

诊断出现在两个位置：**status 数组**（顶层的 `status: StoreDiagnostic[]`，或每个条目一个）用于健康发现；以及**抛出的错误**在命令失败时被转换为单元素 `status` 数组。

## 3. Root 选择与 `RootOutput`

所有解析 root 的命令（`list`、`show`、`validate`、`status`、`instructions`、`instructions apply`、`new change`、`archive`、`doctor`、`context`）都按以下优先级解析���个 Rasen root：

1. `--store <id>` → 已注册 store 的 root（`source: "store"`）。
2. 否则，最近的包含 `rasen/` 的祖先目录：规划结构 → `source: "nearest"`（`store:` 指针会被忽略并附带 stderr 警告）；仅有配置且带有效 `store:` 指针的目录 → 该 store，`source: "declared"`。
3. 没有最近的 root，但存在已注册的 store → 错误 `no_root_with_registered_stores`。
4. 没有 root、没有 store：脚手架命令将 cwd 视为 `source: "implicit"`；诊断命令（`doctor`、`context`）反而以 `no_openspec_root` 失败——它们只检查，从不脚手架。

成功的 JSON 载荷会内嵌 root：

```json
"root": { "path": "/abs/path", "source": "store" | "declared" | "nearest" | "implicit", "store_id": "id (only when store-selected)" }
```

**Root 失败契约**：在 JSON 模式下，解析失败会在 stdout 打印 `{ ...commandNullShape, "status": [diagnostic] }` 并以退出码 1 退出。

## 4. 命令 JSON 结构

### 4.1 `list --json`
`{ "changes": [ { "name", "completedTasks", "totalTasks", "lastModified", "status": "no-tasks"|"complete"|"in-progress" } ], "root": RootOutput }` — 注意此处的按变更 `status` 是一个字符串枚举。`--specs`：`{ "specs": [ { "id", "requirementCount" } ], "root" }`。

### 4.2 `show <item> --json`
Change：`{ "id", "title", "deltaCount", "deltas": [...], "root" }`。Spec：`{ "id", "title", "overview", "requirementCount", "requirements": [...], "metadata": { "version", "format", "sourcePath"? }, "root" }`。

### 4.3 `validate --json`
`{ "items": [ { "id", "type": "change"|"spec", "valid", "issues": [ { "level", "path", "message", "line"?, "column"? } ], "durationMs" } ], "summary": { "totals": {items,passed,failed}, "byType": {...} }, "version": "1.0", "root" }`。任何条目失败时退出码 1。

### 4.4 `status --json`
`{ "changeName", "schemaName", "planningHome"?: { "kind", "root", "changesDir", "defaultSchema" }, "changeRoot", "artifactPaths": { "<id>": {outputPath, resolvedOutputPath, existingOutputPaths} }, "nextSteps": ["..."], "actionContext": { "mode": "repo-local", "sourceOfTruth": "repo", "planningArtifacts", "linkedContext", "allowedEditRoots", "requiresAffectedAreaSelection", "constraints" }, "isComplete", "applyRequires", "artifacts": [ {id, outputPath, status: "done"|"ready"|"blocked", missingDeps?} ], "root" }`。没有活跃变更时：`{ "changes": [], "message", "root" }`，退出码 0。

### 4.5 `instructions <artifact> --json`
`{ "changeName", "artifactId", "schemaName", "changeDir", "planningHome"?, "outputPath", "resolvedOutputPath", "existingOutputPaths", "description", "instruction"?, "context"?, "rules"?, "references"?: ReferenceIndexEntry[], "template", "dependencies": [{id,done,path,description}], "unlocks", "root" }`。

`ReferenceIndexEntry`：`{ "store_id", "root"?, "specs"?: [{id,summary}], "fetch"?, "status": [] }` — 已解析的条目携带 root/specs/fetch；未解析的条目携带 store_id + 警告 status。索引上限为 50KB（`reference_index_truncated`）。

### 4.6 `instructions apply --json`
`{ "changeName", "changeDir", "schemaName", "contextFiles": { "<artifactId>": ["/abs", ...] }, "progress": {total,complete,remaining}, "tasks": [{id,description,done}], "state": "blocked"|"all_done"|"ready", "missingArtifacts"?, "instruction", "references"?, "root" }`。

### 4.7 `new change <name> --json`
成功：`{ "change": { "id", "path", "metadataPath", "schema" }, "root" }`。失败：`{ "change": null, "status": [d] }`，退出码 1。

### 4.8 `archive <name> --json`
成功：`{ "archive": { "change", "archivedAs": "YYYY-MM-DD-name", "path", "specsUpdated", "totals"? }, "root" }`。失败：`{ "archive": null, "root"?, "status": [d] }`，退出码 1。JSON 模式严格非交互：每一个提示点都变为一个 `archive_*` 代码。

### 4.9 `doctor --json`
`{ "root": { "path", "source", "store_id"?, "healthy", "status": [] }, "store": { "id", "metadata": {present,valid,remote?}, "origin_url"?, "status": [] } | null, "references": [...], "status": [] }`。任何严重级别的健康发现都退出码 0。失败载荷：`{ "root": null, "store": null, "references": [], "status": [d] }`，退出码 1。

### 4.10 `context --json`
`{ "root": { "path", "source", "store_id"?, "role": "openspec_root" }, "members": [ { "role": "referenced_store", "id", "path"?, "remote"?, "fetch"?, "status": [] } ], "status": [] }`。AVAILABLE = path 存在且 status 为空。`--code-workspace <path>` 写入 `{folders:[{name,path}]}`（仅限可用的被引用 store，带 `ref:` 前缀）；在 JSON 模式下写入发生在打印之前，因此即使写入失败 stdout 也只持有一个文档。失败：`{ "root": null, "members": [], "status": [d] }`，退出码 1。

### 4.11 `store ... --json`
setup/register：`{ "store": {id, root, metadata_path?}, "registry": {path, registered, already_registered}, "git": {is_repository, initialized, committed}, "created_files": [], "status": [] }`。unregister/remove：`{ "store", "registry": {path, removed}, "files": {deleted, deleted_path, left_on_disk}, "status": [] }`。list：`{ "stores": [{id, root}], "status": [] }`。doctor：`{ "stores": [ { id, root, metadata_path?, openspec_root: {...healthy, status}, metadata: {present, valid, id?, remote}, git: {is_repository, has_commits, has_uncommitted_changes, has_remote, origin_url}, status } ], "status": [] }`（`null` = 未知/未探测）。健康发现退出码 0；失败以匹配的 null-shape 退出码 1。提示取消退出码 130。

### 4.12 `schemas --json` / `templates --json`
`schemas`：裸数组 `[ {name, description, artifacts, source} ]`。`templates`：键控对象 `{ "<artifactId>": {path, source} }`。两者都基于 cwd，没有 root/status 键。

## 5. 退出码契约

| 情形 | 退出码 | Stdout |
|---|---|---|
| 成功，包括健康发现（doctor/context/store doctor） | 0 | 载荷 |
| `--json` 模式下的命令失败 | 1 | 一个带 `status: [d]` 和命令 null-shape 的 JSON 文档 |
| `validate` 存在失败的条目 | 1 | 完整报告 |
| 提示取消（`store` 组，人类模式） | 130 | 仅 stderr |

## 6. 诊断代码目录

### 解析
`no_openspec_root`, `no_root_with_registered_stores`, `no_registered_stores`, `unknown_store`, `store_identity_mismatch`, `unhealthy_store_root`, `store_path_not_supported`, `invalid_store_pointer`, `initiative_option_removed`, `areas_option_removed`；透传（pass-through）：`invalid_store_id`, `invalid_store_registry`, `invalid_store_metadata`。

### Rasen-root 健康（error，无 fix）
`openspec_store_root_missing`, `openspec_root_missing`, `openspec_config_missing`, `openspec_specs_missing`, `openspec_changes_missing`, `openspec_archive_missing`，以及每个对应的 `_not_directory` 变体。

### Store 注册表/身份/状态
`invalid_store_id`, `invalid_store_registry`, `invalid_store_metadata`, `store_registry_busy`, `store_not_found`, `no_store_registry`, `store_registry_changed`, `store_metadata_missing`, `store_metadata_id_mismatch`, `store_metadata_invalid`, `store_id_conflict`, `store_path_conflict`, `store_already_registered`（info）。

### Store setup/register/remove
`store_setup_id_required`, `store_setup_path_required`, `store_setup_path_not_directory`, `store_setup_inside_git_repo`, `store_setup_non_empty_directory`, `store_setup_cancelled`, `store_path_required`, `store_path_missing`, `store_path_not_directory`, `store_register_root_unhealthy`, `store_register_identity_confirmation_required`, `store_register_cancelled`, `store_remote_empty`, `store_remote_requires_hand_edit`, `store_remove_confirmation_required`, `store_remove_cancelled`, `store_remove_path_not_directory`, `store_remove_metadata_missing`, `store_root_missing`（remove 中为 warning，doctor 中为 error）, `store_root_not_directory`。

### Store git
`store_git_init_failed`, `store_git_identity_missing`, `store_git_commit_failed`, `store_git_no_commits`（warning）, `store_clone_fragile_directories`（warning）, `store_remote_divergence`（info，doctor）。

### 引用（warning）
`reference_invalid_id`, `reference_registry_unreadable`, `reference_unresolved`, `reference_root_unhealthy`, `reference_index_truncated`。

### 关系（warning；doctor；context 仅保留注册表的那个）
`relationship_registry_unreadable`, `root_pointer_ignored`, `root_pointer_invalid`, `pointer_declarations_inert`。

### Archive（JSON 模式）
`archive_change_name_required`, `archive_change_not_found`, `archive_validation_failed`, `archive_confirmation_required`, `archive_tasks_incomplete`, `archive_spec_update_failed`, `archive_spec_validation_failed`, `archive_target_exists`, `archive_error`。

### Context 写入
`context_file_exists`, `context_output_dir_missing`。

### 回退
`doctor_failed`, `context_failed`, `store_error`, `change_error`, `archive_error`。

## 已知不一致之处

由 capstone audit 记录；已发布键的重命名是推迟到本次发布之后的产品决策：

1. ~~在 `--json` 模式下，若干失败路径仅打印 stderr 而没有 JSON 文档。~~ 在 capstone gauntlet 轮次中已修复：`show`/`validate` 的 unknown 和 ambiguous 条目发出 `{status:[{code: unknown_item | ambiguous_item, ...}]}`；`status`/`instructions`/`list`/`show`/`validate` 中抛出的错误经由感知 JSON 的失败辅助函数路由（命令的 null-shape + `status`）；`store <unknown subcommand> --json` 发出 `{status:[{code: unknown_store_subcommand}]}`；`list` 在解析失败时携带其 `{changes|specs: [], root: null}` null-shape。
2. `store_root_missing` 以两种严重级别发出（remove 中为 warning，store doctor 中为 error）——取决于上下文，已在上文记录。
3. snake_case（store 家族）与 camelCase（工作流家族）的键大小写差异；`root.store_id` 在各处都为 snake_case。
4. src 中存在四份并行的 envelope 类型声明；archive 诊断从不携带 `target`。
5. `list --json` 将 `status` 键复用为每个变更的字符串枚举。
6. 只有 `validate` 的输出携带 `version` 字段。
7. `schemas`/`templates` 忽略 root 选择（基于 cwd，无 `--store`）。
8. 已弃用的名词形式（`change`/`spec` 子命令）发出不带 `root`/`status` 的未封装载荷。
