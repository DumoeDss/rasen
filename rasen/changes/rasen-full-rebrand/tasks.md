## 1. 品牌常量与工作区解析（D1/D2 基础层）

- [x] 1.1 在 `src/core/config.ts` 建立品牌常量：`WORKSPACE_DIR_NAME='rasen'`、`LEGACY_WORKSPACE_DIR_NAME='openspec'`、`COMMAND_PREFIX='rasen'`、`LEGACY_COMMAND_PREFIX='opsx'`、`SKILL_PREFIX='rasen'`；`OPENSPEC_MARKERS` 保留并注释为 legacy-only
- [x] 1.2 重命名并改值 `src/core/openspec-root.ts` 的 `OPENSPEC_ROOT_DIR` 等常量为 `WORKSPACE_*` 系列（取值 rasen），文件改名为 `workspace-root.ts`，更新全部 import
- [x] 1.3 收编 ~40 处硬编码 `'openspec'` 路径字面量到常量（勘察清单：archive.ts、change-utils.ts、commands/change.ts、doctor.ts、item-discovery.ts、instruction-loader.ts、resolver.ts×2、schema.ts、shared-gather.ts、list.ts、planning-home.ts、workflow/shared.ts、project-config.ts、references.ts、specs-apply.ts、root-selection.ts、view.ts、spec.ts、store.ts）
- [x] 1.4 根解析只认 `rasen/`；workspace-requiring 命令在仅有 `openspec/` 时输出迁移引导文案（指向 `rasen migrate` / `rasen init`）并退出码 1

## 2. 迁移命令（D2/D4）

- [x] 2.1 实现 `rasen migrate`：copy-only 递归复制 `openspec/{specs,changes,config.yaml}` → `rasen/`，跳过已存在目标、单文件失败不中断、汇总报告（复制/跳过/失败计数），幂等可重跑；全程 path.join
- [x] 2.2 `rasen init` 检测到 `openspec/` 且无 `rasen/` 时交互式提供迁移（复用 2.1 实现）；拒绝或非交互模式则新建空工作区并提示 `rasen migrate` 可用
- [x] 2.3 marker 块清理改为仅 migrate 流程内经用户确认（默认否）执行；`update`/`init` 路径移除自动 marker 清理
- [x] 2.4 init/update 检测到 `opsx` 命令文件或 `openspec-*` 技能目录时打印一次性归属提示，不删不改
- [x] 2.5 migrate/迁移引导的单元与集成测试（含 Windows 路径、嵌套 archive 目录、重跑幂等、目标已存在不覆盖、源目录零写入断言）

## 3. 命令生成层（D1/D3）

- [x] 3.1 重构 28 个 adapter 的 `getFilePath()` 从 `COMMAND_PREFIX` 常量拼接（`commands/rasen/<id>.md` 与 `rasen-<id>.md` 两种形态）；消除各自硬编码
- [x] 3.2 `src/utils/command-references.ts` 冒号→连字符变换用常量构造正则；`command-file-id.ts` 的 legacy 候选路径逻辑纳入 `LEGACY_COMMAND_PREFIX`
- [x] 3.3 `WORKFLOW_TO_SKILL_DIR`（profile-sync-drift.ts）映射值 `openspec-*` → `rasen-*`，双前缀折叠（`openspec-opsx-ship` → `rasen-ship`）；专家技能模板 `name` → `rasen:<x>`、`metadata.author` → `rasen`
- [x] 3.4 workflow 模板正文（24 文件 ~102 处）`/opsx:` → `/rasen:`、`openspec-*` 技能引用 → `rasen-*`、模板内 `openspec/` 工作区路径 → `rasen/`（含 `_orchestration.ts`、experts/_shared.ts 命令表）
- [x] 3.5 `pipelines/*/pipeline.yaml`（7 文件）技能 ID `openspec-*`/`openspec:*` → `rasen-*`/`rasen:*`；pipeline resume 读到未知旧技能 ID 时报错提示新旧映射
- [x] 3.6 新增 brand-guard 测试：生成全部工具的命令/技能/模板产物，断言不含 `/opsx:`、`opsx-`、`commands/opsx/`、`openspec-` 技能引用（白名单豁免 legacy 迁移/检测代码）

## 4. init/update/store（D4/D5）

- [x] 4.1 init 脚手架创建 `rasen/` 结构与 `rasen/config.yaml`；成功输出与 next-steps 全部引用 `/rasen:*` 与 `rasen/`
- [x] 4.2 update 仅刷新 rasen 命名空间产物；无 `rasen/` 时按 legacy 有无分别输出迁移引导或未初始化报错
- [x] 4.3 store：`STORE_METADATA_DIR_NAME` → `.rasen-store`，解析时旧名读兼容，写入时 copy 迁移到新名不删旧；默认 store 位置 `~/openspec/<id>` → `~/rasen/<id>`；registry 已有绝对路径不重写
- [x] 4.4 init/update/store 相关测试更新与新增（legacy-only 项目引导、双工作区并存只认 rasen、store 旧元数据兼容）

## 5. 本仓库自举迁移（D6）

- [x] 5.1 仓库工作区迁移完成（LEAD 执行树合并而非整体 git mv：openspec/ 1036 文件逐项 git mv 并入 rasen/，保留并发 session 已提交的 8c47a06 归档与同步 spec，零覆盖；CLI 解析/validate/list 验证通过）
- [x] 5.2 schemas（`schemas/spec-driven/schema.yaml`、`templates/proposal.md`）指引文本 `openspec/specs/` → `rasen/specs/`；`hooks/compact-recovery.sh` 同步（`openspec pipeline resume`→`rasen`、`openspec/changes/`→`rasen/changes/`）；CI workflows 无 `openspec/` 工作区路径引用（仅 deploy-docs 注释里一个 infra 名，保留）
- [x] 5.3 全量测试引用替换完成；`pnpm test` 全绿（120 文件 / 2201 passed / 22 skipped / 0 failed）。init.test/update.test 行为重写 + 删除已移除的 legacy cleanup/upgrade describe 块；json-converter/spec 的 `format:'openspec'` 属白名单已回改；telemetry endpoint 保持 openspec-telemetry（见 5.1 handoff，升级 LEAD）
- [x] 5.4 本机全量绿：120 files / 2201 passed / 22 skipped / 0 failed（两次全量复核；CI 三平台矩阵待 push 后回填 — known-open）

## 6. 文档（D7）

- [x] 6.1 README.md/README_zh.md：删卸载段、加"与 OpenSpec 共存"表（四命名空间 + copy-only `rasen migrate`）、`/opsx:`→`/rasen:`、`openspec/`→`rasen/`、对齐声明改为"语义对齐 v1.5.0、命名空间独立"；README_zh 整篇从上游残留重写为 rasen 中文镜像
- [x] 6.2 `docs/`、`docs/zh/`、`website/` 机械对齐（72 文件：`/opsx:`→`/rasen:`、workspace 路径、`openspec `二进制→`rasen `，白名单保护包名/URL）；installation.md（含 zh/local-install）安装包名从 `@fission-ai/openspec` 修正为 `rasen`、nix 仓库改 DumoeDss/rasen。残留 follow-up：历史/上游分析文档按白名单豁免；`docs/opsx*.md` 文件名未改（避免断链）；prose 里部分大写 "OpenSpec" 品牌提及保留
- [x] 6.3 CHANGELOG 记录 BREAKING 变更与迁移指引（新增 `## 0.2.0` 全命名空间重命名条目 + `rasen migrate` copy-only 指引 + 白名单说明；标题 `# @fission-ai/openspec`→`# rasen`）
