# Rasen 品牌独立化进展报告

> 快照：2026-07-10（第 4 次盘点），`main @ 13dccf3`，与 origin/main 同步。
> 范围：rasen 从上游 OpenSpec fork 独立出来的全部品牌化/独立化工作——命令命名空间、文件与存档位置、包身份、遥测、发布准备、文档。
> 结论先行：**0.1.1 已正式发版**——tag `rasen-v0.1.1` + GitHub Release（tarball）+ **npm `@atelierai/rasen@0.1.1` 发布成功**（provenance 签名，装机实测 `rasen --version` 报 0.1.1）。npm 相似名保护拒绝裸名 `rasen`（与 raven/resend 太近，E403），经用户拍板改用 scoped 名 `@atelierai/rasen`（bin 仍为 `rasen`，仓库仍 DumoeDss/rasen）。署名已由 DumoeDss 改为 Sayo（仓库 URL 不变）。品牌层面仅剩 docs/ 内容与文件名回写（#5）和根目录遗留文件（#9）。

---

## 1. 总览

| 维度 | 状态 | 一句话 |
|---|---|---|
| 包与 CLI 身份 | ✅ 已完成 | npm 名 `@atelierai/rasen`（0.1.1，裸名被注册表相似名政策拒绝）、bin 仅 `rasen`、repo/homepage 指向 DumoeDss/rasen |
| 命令命名空间 | ✅ 已完成 | 仅生成 `/rasen:*`；`opsx` 只存在于 legacy 检测/清理层 |
| 工作区/存档位置 | ✅ 已完成 | `rasen/` 工作区、copy-only 迁移、archive 三轴配置已落地 |
| machine-home | ✅ 已完成 | 机器数据根迁至 `~/.rasen`（`RASEN_HOME` > XDG 别名 > 默认，`global-config.ts:18,145`）；legacy 收养 copy-only + 碰撞安全（`cba4073`/`1c1735d`） |
| 遥测 | ✅ 已完成 | endpoint `telemetry.rasen.io`（`src/telemetry/index.ts:30`）；TLS 实测上线；D1 聚合+面板 v2 已部署；垃圾遥测已清+合成探测约定（probe:/全零 UUID） |
| 测试断言 | ✅ 已完成 | parity/e2e 断言全部期待 `rasen-*`；EBUSY flake 病根已治（batch1，2186/0 零 flake 基线） |
| 主 specs 混词 | ✅ 已完成 | 四连清扫全关（§2.7）；120 个 spec，残留 token 全部落入甄别过的 K1–K7 保留类；治理 spec `spec-brand-consistency` 钉门 |
| 交付模式 | ✅ 已收敛 | 5→2（`both`\|`skills`，skills 必装，`config-schema.ts:18`）；legacy 三值 migrate-on-read；编排型命令永远可用 → 原 DOC1 文档缺口被架构性取代 |
| 发布 | ✅ **已发版** | `rasen-v0.1.1` tag + GitHub Release + npm `@atelierai/rasen@0.1.1`（provenance，2026-07-10）；workflow 三跑闭环（pnpm pin 冲突修复 `2670bda`、包名 scoped 化 `13dccf3`） |
| 文档 | ⚠️ 部分完成 | docs/（36 篇）+ docs/zh/（33 篇）；67 个文件仍含 openspec/opsx 字样，`opsx.md`/`opsx-workflow-guide.md`/`grill-gstack-absorption.md` 双语文件名未改 |
| git 交付 | ✅ 已完成 | **origin/main = 本地 main = `955fdb8`，零未推送**；`autonomy-ladder` 分支已 push 未合并（`e0a4a19`） |

---

## 2. 已完成（含证据）

### 2.1 包与 CLI 身份
- `package.json` name=`rasen`、version=`0.1.1`、homepage/repository 指向 `github.com/DumoeDss/rasen`、MIT、`publishConfig.access: public`；bin 仅 `rasen`，`openspec` 可执行名已移除。
- `README.md:1` 品牌头 "Rasen — loops that ascend"；CLI 版本号从 package.json 动态读取。

### 2.2 命令命名空间（BREAKING 重命名 + 上游共存）
- 当前代码**只生成 `/rasen:*`**（CHANGELOG 0.1.1 记录 BREAKING）；源码中 `opsx` 仅作为 `LEGACY_COMMAND_PREFIX` 存在于安装检测/清理路径（`command-file-id.ts`）。
- 与上游共存：上游拥有 `openspec` CLI + `openspec-*` skills + `/opsx:*`；rasen 拥有 `rasen` + `rasen-*` + `/rasen:*`，同一项目互不相扰。init/update 不自动清理 legacy 产物（一次性共存提示）；清理仅在 `rasen migrate` 中做、需显式同意。
- shell installer marker 已双族化：新块写 `# RASEN:*`、双族识别保升级/卸载路径（fix-brand-residuals F6）；四站点孤块去重 + 按消费方匹配严格度（fix-marker-orphan `ea5602c`）。
- 故意保留的 back-compat 层：`.openspec.yaml` 元数据文件名、`format:'openspec'` 格式标识、legacy 检测字面量、`.openspec-store` copy-forward——确保 pre-rebrand 与上游布局可探测。

### 2.3 工作区、存档与 machine-home
- 工作区：`WORKSPACE_DIR_NAME='rasen'`；root 解析仅认 `rasen/`，遇 legacy 目录打印迁移指引并非零退出；迁移 copy-only（源目录永不改/删）。
- **machine-home 已迁 `~/.rasen`（2026-07-10，relocate-machine-home `cba4073` + harden-adoption `1c1735d`）**：解析优先级 `RASEN_HOME` > XDG 兼容别名 > 字面默认（`global-config.ts:90-145`），跨平台一致；legacy（旧 `%APPDATA%/rasen` 等）收养链 copy-only、原子按子项、碰撞安全 home 映射、worktree-aware 命名；doctor 报告迁移状态。
- store 元数据 `.rasen-store`；legacy `.openspec-store` 仍可读并 copy-forward、永不删。
- store/project 命名空间分型（`4fa8f27`）：type 分型、(type,id) 唯一、`--project` flag、`project:` 前缀引用。
- store 双功能（2026-07-10，`2af26ba`..`8f7b242`）：`store add-project` + `--no-gate`/vet gate。
- 存档三轴（externalize-artifacts portfolio，5-child 全 archive）：t3-workdir ephemera 外置、archive-timing、archive-dest（in-repo/external/prune）。

### 2.4 遥测（全链路完成）
- endpoint `https://telemetry.rasen.io`（`src/telemetry/index.ts:30`），custom domain TLS 实测上线（直连+代理 curl 通过、合成 event 202、CLI 打点 +60ms 无退出挂起）。
- Worker（ingest + Access admin console）已部署（144b4263 上线）；D1 永久聚合 + stats v2 + 面板 v2 已完成，待用户 backfill 调用+面板验收。
- 遥测卫生已闭环（`e470d1b`/`4aa9d16`）：热冷两层查询排除垃圾遥测、D1 清 6 行、`probe:`/全零 UUID 合成探测约定；面板数据已溯源确认全为本机流量、零外部用户。

### 2.5 测试
- 断言层全部 `rasen-*` 期待值，全量 ~2180+ 测试绿。
- **Windows EBUSY flake 病根已治**（upstream-cherrypick-batch1 `3bfbb42`，已 push）：2186/0 零 flake 基线。

### 2.6 许可与署名
- LICENSE 为 MIT 双署名：上游 "Copyright (c) 2024 OpenSpec Contributors" + "Copyright (c) 2026 Sayo"（2026-07-10 署名由 DumoeDss 改为 Sayo；仓库 URL 仍为 DumoeDss/rasen，`package.json` author、README 双语 fork 声明/版权行、CHANGELOG、fork-release-preparation 与 project-readme 两个 spec 已同步）。

### 2.7 主 specs 混词——四连清扫全关（2026-07-10）
1. **specs-brand-rewrite**（ship `5ea680a`/archive `d3997cf`/main `361490d`）：907 处命中全语料甄别，76 文件回写，44 文件残留全部落入 K1–K7 保留类（有意标识/legacy 检测/上游署名/迁移语境/反向断言/capability ID/内部符号）；新增治理 spec `spec-brand-consistency`（scenario 即语料 grep 门）；`validate --specs` 行为中性。
2. **fix-brand-residuals**（ship `3f98486`/archive `1b617cc`/main `8907201`）：cli-completion 虚构接口改名、cli-update marker 过时描述 11 scenario 语义重写、installer `# RASEN:*` 代码修复+回归测试。
3. **fix-marker-orphan**（`ea5602c`/`30dc336`）：双族 marker 孤块四站点去重。
4. **cli-update-stub-adjudication**（`6dc06e4`/`6efc3a7`）：root-stub/rasen-AGENTS.md 的 scenario 主张裁决为上游死遗留（killed upstream v1.0.0），specs 重写为实际行为。
- 现状：`rasen/specs` 120 个 spec，validate 全绿，品牌一致性有治理 spec 长期钉门。

### 2.8 交付模式收敛（2026-07-10，delivery-modes 5→2，`b4e8ca5`/`00f6bea`）
- 五值收敛为 `both`|`skills`（`config-schema.ts:18`），**skills 必装**；legacy `commands`/`skills-first`/`commands-first` migrate-on-read + 一次性提示（`:21-27`）。
- 架构性副作用：编排型命令（`/rasen:auto`、`/rasen:review-cycle`、`/rasen:goal`）所依赖的 worker skills 在任何模式下都在——**原 DOC1"交付模式前提"文档缺口被整个取代，关闭**。

### 2.9 goal 模板 deploy（`f0d3547`/`8130edc`）
- profile 三注册表漏注册已修，review 3 轮闭合 4 接缝，各有必红回归测试。goal 未进 `CORE_WORKFLOWS`（opt-in，裁决在 change design）。

### 2.10 git 交付 ✅
- **origin/main = 本地 main = `955fdb8`（2026-07-10 09:24），零未推送提交**。上次快照以来的 31 个提交（specs 四连清扫、machine-home 迁移、store 命名空间+gates、交付模式收敛、office-hours 二连、upstream batch1、版本对齐）全部在远程。
- `autonomy-ladder` 分支已 push origin（`e0a4a19`，自主权阶梯文档 EN+ZH），未合并 main——合并时机归用户。
- `upstream-main` 镜像分支在位，batch1 已验证 cherry-pick 流程可行。

---

## 3. 缺失 / 部分完成

### 3.1 发布闭环——只差 tag
- **无 `rasen-v*` tag（唯一发版卡点）**：本地仅存上游 fork 带来的旧 `v0.1.0`–`v0.13.0` tag；release workflow 从未实跑。
- publish-npm job 已落地（`needs: release`、NPM_TOKEN 缺失优雅跳过、`npm publish --provenance --access public`、版本无关读 package.json，`release.yml:50-99`）；**NPM_TOKEN 已配**；npm 包名 `rasen` 空闲，首发即创建。
- 注意：workflow 仅静态验证过——首个 tag 即首次实跑，需全程盯（tarball + npm publish + provenance）。
- flake.nix `pnpmDeps.hash` 待首次 CI 实跑日志回填（nix-flake-validate 会强制新鲜度，红了照日志改即可）。
- CHANGELOG 0.1.1 目前只记录 rebrand；快照后落地的功能（store gates、交付模式收敛、machine-home 迁移等）尚未入 CHANGELOG 条目——**版本号与条目归属由用户拍板（0.1.1 明令，不擅自 bump）**。

### 3.2 docs 品牌回写（品牌层面最后一块，#5）
- 现状：docs/ 36 篇 + docs/zh/ 33 篇（非完全镜像）；**67 个文件仍含 openspec/opsx 字样**（含 migration-guide 等合法迁移语境，需甄别非全改）。
- 文件名未改：`opsx.md`、`opsx-workflow-guide.md`、`grill-gstack-absorption.md`（EN+ZH 双份）；另有历史 handoff 文档（`handoff-2026-07-06-upstream-merge-session.md`）可归档或删。
- 方法论可复用 specs-brand-rewrite 的 K1–K7 甄别框架 + worktree 全自动 pipeline（该 change 首审即净）。

### 3.3 根目录清理（#9，部分自愈）
- 已消失：`compute-err.txt`、空 `openspec/` 目录（955fdb8 顺带清理 handoff docs）。
- 仍在：`README_OLD.md`、`README_zh.md`、根 `config.yaml`。

---

## 4. 待做清单（按优先级）

| # | 事项 | 体量 | 依赖 |
|---|---|---|---|
| 1 | ~~发版~~ ✅ 完成（2026-07-10）：`rasen-v0.1.1` → Release + npm `@atelierai/rasen@0.1.1`，装机验收通过；CHANGELOG 0.1.1 未补记 tag 之后落地的功能（help、store gates、交付模式收敛等），归版本决策 | — | — |
| 2 | docs 品牌回写（文件名 + 内容层，双语镜像同步；复用 K1–K7 甄别框架） | M | 无 |
| 3 | 根目录清理：README_OLD.md、README_zh.md、根 config.yaml | XS | 无 |
| 4 | nix hash 回填（首次 CI 实跑后照日志改） | XS | #1 |
| 5 | 面板 event 落库/backfill 验收 | XS | 用户 |
| 6 | `autonomy-ladder` 分支合并决策 | XS | 用户 |
| 7 | `~/.rasen` 测试泄漏目录清理 + doctor --gc/旧 AppData 删除取舍（harden-adoption known-open） | XS | 无 |

已全部关闭（历史）：push 主线 ✅、版本对齐 0.1.1 ✅、goal deploy ✅、主 specs 混词 ✅（四连清扫）、npm publish 通道 ✅、flake hash 机制 ✅、遥测 TLS ✅、CI 矩阵 ✅、DOC1 交付模式文档句 ✅（被 5→2 收敛架构性取代）。

---

## 5. Roadmap

### Phase A — 交付闭环 ✅ 完成（2026-07-10）
~~push 主线~~ ✅ → ~~tag~~ ✅ `rasen-v0.1.1` → ~~release workflow~~ ✅（三跑：pnpm pin 冲突→修复；裸名 E403→scoped）→ ~~npm publish~~ ✅ `@atelierai/rasen@0.1.1`（provenance 已签，sigstore logIndex 2137057074）。
**出口判据已达成**：`npm i -g @atelierai/rasen` 可装，`rasen --version` 报 0.1.1（实测）。

### Phase B — 一致性收尾
~~goal deploy~~ ✅ → ~~主 specs 混词~~ ✅ → ~~DOC1~~ ✅（架构性取代）→ **docs 品牌回写（#2）** → 根目录清理（#3）。
**出口判据**：docs 全文 grep openspec/opsx 仅剩甄别过的迁移/共存语境引用。

### Phase C — 基础设施硬化 ✅ 已完成并推送
npm publish job、CI 三 OS 矩阵 + node24 腿、nix hash 新鲜度钉门、遥测 TLS 实测——全部落地。残余仅 release workflow 首次实跑（随 Phase A tag）。

### Phase D — 长期（择机）
- 上游跟踪：`main`=产品线 / `upstream-main`=镜像，定期 cherry-pick（batch1 已验证流程）。
- legacy 层退场计划：`opsx` 前缀探测、`.openspec-store` copy-forward、`openspec/` 迁移指引保持至少一个 minor 周期后再评估。
- rasen.io 官网/文档站（deploy-docs.yml 已在，内容待 Phase B 后挂载）。
- 本地仓库目录名仍为 `OpenSpec-code`（仅本机路径，不影响包身份，可选改名）。

---

## 6. 风险与注意事项

1. **共享工作树纪律**：多 session 并发在同一工作树，任何提交必须显式 `git commit -- <paths>` + `git show --stat` 复核（历史事故 4b37644）。
2. **docs 回写按 change 流程走**：虽然 docs 不是 verify 对照物，但双语镜像同步和 K 类甄别（迁移指南必须保留 openspec 字样）需要审查闭环，建议沿用 worktree pipeline。
3. **首个 tag 是 release workflow 的首次实跑**：publish-npm 只做过静态验证，打 tag 后盯全程；nix-flake-validate 可能因 hash 过期红一次，照日志回填即可。
4. **CHANGELOG 0.1.1 对外承诺 `/rasen:*` 为唯一命令命名空间**；发布前确认 migration-guide 与 README 安装/迁移指引可执行（migration-guide 属 docs 回写 #2 的甄别范围）。
5. **版本号归用户管**（2026-07-10 明令）：当前 0.1.1，不擅自 bump；发布类改动一律版本无关。

---

*本报告 2026-07-09 首盘、2026-07-10 两次更新（第 2 次：goal deploy + Phase C；第 3 次：main 全量推送确认、specs 四连清扫、machine-home 迁 ~/.rasen、store 命名空间+gates、交付模式 5→2、遥测全链路闭环、DOC1 关闭）；代码为准、附证据行号。后续状态变化请更新本文件而非另开新档。*
