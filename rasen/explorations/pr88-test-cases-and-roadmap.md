# PR #88 测试用例与验收/发布路线

> 状态：`integrated-candidate`（工程实现 + 自动化验证已过；待 fresh-machine 人工签收）
>
> 日期：2026-07-27
>
> 适用：`feat/store-context-portable-knowledge`（PR #88 → `dev/0.1.5`，head `c4e54285`）
>
> 配套：审查报告见 `rasen/explorations/global-store-project-unification-development-plan.md`
> §36；测试策略见同文件 §28；验收 Gate 见 §29；发布顺序见 §36.8。

本文是 PR #88 的**测试覆盖盘点**与**剩余验收/发布路线**，给 reviewers 和最终人工验收
者一个单一入口：哪些行为被自动化测试覆盖了、哪些没有、当前结果是什么、还差什么才能
发布 0.1.5。

---

## 0. 当前快照

| 检查 | 结果 | 复现 |
|---|---|---|
| `pnpm run lint` | PASS | `pnpm lint` |
| TypeScript build | PASS | `pnpm build` |
| `git diff --check origin/dev/0.1.5...HEAD` | clean | `git diff --check origin/dev/0.1.5...HEAD` |
| `pnpm test`（全量） | **5441 pass / 0 逻辑失败 / 32 skip** | `pnpm test` |
| 残留失败 | 仅 `store-membership-cli` 的 **Windows 间歇性 flake**（全量跑 0–4 个、子集每次不同、隔离跑全过） | `pnpm vitest run test/commands/store-membership-cli.test.ts`（隔离绿） |
| §28.2 双机场景证据 | green | 见下表 |

**0 逻辑失败**指：所有由 PR #88（含 §36 审查修复）引入或暴露的失败都已修复；唯一残留是
本仓已知的 Windows CLI-spawning flake（`rasen-workspace` 历史记录在案），与本 PR 逻辑无关。

---

## 1. 测试盘子总览

311 个测试文件，约 5475 个用例。按目录：

```text
test/core                 71   (store / management-api / learned-skills / pipeline-registry / ...)
test/commands             52   (CLI 命令面：bootstrap, pipeline, config-profile, knowledge, handoff, ...)
test/core/management-api  37   (session 启动/supervisor/spaces/wire-types)
test/core/store           23   (bootstrap, membership, foundation, registry, operations, ...)
test/core/pipeline-registry 12
test/core/learned-skills   8
test/core/knowledge-bundle 6
test/cli-e2e               7   (真实 CLI 子进程端到端)
test/core/templates        7   (skill 模板 parity)
... (其余 ~80 文件散布在 config-api/codex/artifact-graph/completions/token-audit 等)
```

---

## 2. 测试用例矩阵（§28 策略 → 实际文件 → 状态）

按开发计划 §28 的测试策略分类，每类给出**代表性测试文件**与**覆盖要点**。所有列出的
文件在当前 head 都是 green（除非注明 flake）。

### 2.1 Identity（§28.1）— Store 不可变身份
| 要点 | 代表测试文件 | 状态 |
|---|---|---|
| metadata v1/v2、UID round-trip | `test/core/store/bootstrap-obtain.test.ts`（B4 身份校验 4 例）、`bootstrap-metadata-probe.test.ts`（M11 absent/valid/unreadable ×5） | green |
| pointer string/object、alias 0/1/N、UID mismatch | `test/core/store/store-identity-cli.test.ts`、`test/core/store/foundation.test.ts` | green |
| tri-state binding（resolved/absent/unavailable） | `test/core/store/bootstrap-obtain.test.ts`、`test/core/effective-config.test.ts` | green |
| 数值 alias warning、凭据 remote 拒绝/redact | `test/core/store/remote.test.ts`（Trivial 2：`?token=abc` 非凭据 + 4 类凭据形）、`git-redaction.test.ts`（M9 defense-in-depth） | green |
| **display-alias 守卫**（每个读取点登记） | `test/core/store/identity-boundaries.test.ts` | green（`init.ts::pointer` 已登记） |

### 2.2 Membership（§28.1）— Project-keyed Store membership
| 要点 | 代表测试文件 | 状态 |
|---|---|---|
| projectId 文件名/schema、roles、locator-only | `test/core/store/membership.test.ts`（+ M7 并发写字段不丢 ×2）、`membership-operations.test.ts` | green |
| legacy references/adoption 归一、无 sourcePath 写入 | `test/core/store/migration*.test.ts`、`store-membership-cli.test.ts` | green（CLI 全量跑 Windows flake，隔离绿） |
| **owner-aware 锁**（M7 record / M8 hints 并发不丢） | `membership.test.ts`、`test/core/project-config-store-memberships.test.ts`（M8 ×3）、`test/core/file-state.test.ts`（B5 原语 ×13） | green |
| add-project/adopt/eject 语义 | `test/commands/store-membership-cli.test.ts`、`test/core/store/membership-operations.test.ts` | green（同上 flake） |

### 2.3 Runtime（§28.1）— Session planning/execution 分离
| 要点 | 代表测试文件 | 状态 |
|---|---|---|
| planning/execution 分离、exact clone root、worktree | `test/core/management-api/sessions-space.test.ts`（4 例，已写 Store record）、`session-runtime-context-e2e.test.ts`（×7） | green |
| frozen context + Session binding、stale checkout | `test/core/management-api/session-launch-context.test.ts`（M6 record-only 资格 ×26） | green |
| planning-only、ActionContext roots | `test/core/management-api/sessions-space.test.ts`、`change-status-policy*.test.ts` | green |
| **M6 资格=Store record 唯一**（declaration 仅 locator） | `session-launch-context.test.ts`（2 翻转 + 3 分类 + 1 both-agree）、`session-runtime-context-e2e.test.ts` | green |

### 2.4 Learned（§28.1）— project > Store > global precedence
| 要点 | 代表测试文件 | 状态 |
|---|---|---|
| project > eligible Stores > global、two equivalent Stores | `test/core/learned-skills/effective.test.ts`（54）、`context.test.ts` | green |
| divergent Stores conflict、alias rename 不改 identity | `test/core/learned-skills/effective.test.ts`、`authority.test.ts` | green |
| **unavailable Store = degraded（非空）**（M5） | `test/core/learned-skills/catalog-backup.test.ts`（×5）、`effective.test.ts` | green |
| logical project catalog、ledger v1/v2、resolution digest | `test/core/learned-skills/*`、`project-learned-skill-ledger.test.ts` | green |
| **normalizeProjectIdentity 全比较点**（M10） | `test/core/knowledge-bundle/import.test.ts`（M10 大写 UUID roundtrip ×3）、`test/core/project-registry.test.ts`（case-different ×2） | green |
| bundle export/import、Store transport | `test/core/knowledge-bundle/export.test.ts`、`export-degraded.test.ts`（M2 fail-closed）、`import.test.ts`（B5 owner-aware 锁 ×3） | green |

### 2.5 双机 CLI fixture（§28.2）— 真实 git remotes、两台机器
| 场景 | 测试文件 | 状态 |
|---|---|---|
| **Store-first 双机生命周期**（A 建仓/推送/归档 → B clone/注册/读 promoted specs/自己完成 change→archive） | `test/cli-e2e/store-lifecycle.test.ts`（8 例） | green |
| **project-first obtain 双机**（第二台机器从 project clone bootstrap 并 obtain 声明的 Store；占用 target 被拒、内容保留） | `test/core/store/bootstrap-obtain.test.ts > acceptance: two-machine fixture with clone remotes` | green |
| bootstrap `--check` / `--dry-run` / `--apply`（读/预览/mutation） | `test/commands/bootstrap.test.ts`（17）、`test/core/store/bootstrap-obtain.test.ts` | green |
| failed-retrieval cleanup（不删他者数据） | `bootstrap-obtain.test.ts`（B3 staging 竞态 + 预存保护） | green |
| never-harvest（Store-first 不自动 obtain 全部 project） | `bootstrap-obtain.test.ts > never-harvest enforcement (D6)` | green |

### 2.6 多 checkout / 多 Store / Git 并发 / 安全 / 回归 / 联合矩阵（§28.3–28.8）
| 类别 | 覆盖位置 | 状态 |
|---|---|---|
| 多 checkout（同 projectId 多 clone/worktree、exact root） | `sessions-space.test.ts`、`project-registry.test.ts`（worktree-duplicate/gc） | green |
| 多 Store（primary=A、membership=A/B、alias 同 UID 不同） | `learned-skills/effective.test.ts`、`store-membership-cli.test.ts` | green（CLI flake） |
| Git 并发（同 projectId 正常冲突、alias 保留两份） | `store-lifecycle.test.ts`、`membership.test.ts` | green |
| 安全（clone 不经 shell、remote 不写凭据、bundle 拒绝对路径） | `git-redaction.test.ts`、`remote.test.ts`、`knowledge-bundle/import.test.ts` | green |
| 回归（standalone Project 无 Store、v1 pointer/metadata、init/update workflow 生成） | `bootstrap.test.ts`、`init-update-learned.test.ts`、`store-identity-cli.test.ts` | green |
| 联合矩阵（§28.8：Project/Store × planning/execution × knowledge 组合） | 散布于 sessions-space、effective、bootstrap-obtain | green |
| pipeline/run-state/portfolio（B2/M4 + delegated 语义） | `test/commands/pipeline.test.ts`（88）、`run-state.test.ts`、`portfolio-state.test.ts` | green |

### 2.7 工具链与契约
| 要点 | 测试文件 | 状态 |
|---|---|---|
| skill 模板 split parity（payload + 生成内容哈希） | `test/core/templates/skill-templates-parity.test.ts`（已同步 6 个 playbook 哈希） | green |
| completion registry 与 Commander 旗标 parity | `test/core/completions/command-registry.test.ts` | green |
| handoff playbook Step-H 安全子句（maxRelays/stallLimit/SendMessage 探针） | `test/commands/handoff.test.ts`（25） | green |
| CLI e2e 基础 + 多语言 help | `test/cli-e2e/basic.test.ts` | green |
| release 契约（scripts 可加载、断言通过） | `test/release-contract.test.ts`（15） | green |
| 命令面 localization parity | `test/commands/bootstrap.test.ts`、`knowledge.test.ts`、`config-profile.test.ts` | green |

---

## 3. PR #88 审查修复（§36）引入/改动的测试

6 个 fix child，每个 author ≠ verifier 审净（0 Blocker / 0 Major），归档于
`rasen/changes/archive/2026-07-27-pr88-rf-*`，各带 `review-report.md`：

| Child | 新增/改动测试要点 | 提交 |
|---|---|---|
| `pr88-rf-obtain`（B3/B4/M1/M2/M11） | staging-dir 竞态、UID/ProjectId 校验 ×{wrong/missing/unreadable}、A≠B 数据目录、metadata probe | `6e905340` |
| `pr88-rf-locks`（B5/M7/M8） | owner-aware 锁原语 ×13、B5 import 并发 ×3、M7 字段并发 ×2、M8 hints 并发 ×3 | `ec28f743` |
| `pr88-rf-regressions`（B2/M3/M4） | delegated 不计完成 + corrupt-portfolio、init≈update learned 报告、unknown 子状态 | `85f95e65` |
| `pr88-rf-validation`（M9/M5/M10） | 凭据 remote 拒绝 ×7、redaction ×3、catalog 备份 degraded ×5、大写 UUID roundtrip ×3、registry case-different ×2、export fail-closed ×3 | `a245503a`/`7dcdbec0` |
| `pr88-rf-authority`（M6） | declaration-only 拒绝 ×2 + marker、3-way 分类、both-agree、6 fixture 补 Store record | `277785be` |
| `pr88-rf-docs`（M12/M13/M15/Minor/Trivial/B1） | E1–E4 任务状态诚实化、locale 去重、knowledge degraded 本地化 | `5043d4de` |
| stale-test 修正（B2/M4/M6 单测对齐） | run-state/portfolio-state/sessions-space | `deab9f2f` |
| pre-existing 7 失败修复 + 3 连锁 | locale/registry/identity-guard/handoff-playbook/release-contract/config-profile/pipeline-store-root + parity fixture | `daee5a0d`/`c4e54285` |

---

## 4. 已知缺口（自动化未覆盖 → 需人工）

这些**没有**自动化测试，是 §36.8 第 10 步人工验收的范围：

1. **真实 Agent 跑完一个 Change Pipeline**：fixture 只验证 rasen 自身的 bootstrap/status/membership/learned 解析；没有"启动真实 Claude/Codex agent，跑完 propose→apply→verify→ship"的端到端。
2. **UI 真实交互**：Store roster 恢复、exact checkout 选择、planning-only 限制在浏览器里的真实点击流（`test/ui` 仅 1 个文件，非完整 UI e2e）。
3. **fresh 物理机器**：自动化用临时 `RASEN_HOME` 模拟，但不等同于一台真正干净的机器（无残留 `~/.rasen`、无现成 node_modules/凭据）。
4. **跨机器并发 push 真实网络**：fixture 用本地 file:// remote，不覆盖真实 GitHub 并发 push/rebase。
5. **性能/规模**：无大 Store（数千 spec/change）、大 bundle 导入的规模与耗时基准。

---

## 5. 验收与发布路线

```text
[已完成] implemented → automated-verified → integrated-candidate
   • §36 全部 automatable findings 修复（5B + 14M + Minor/Trivial）
   • 0 逻辑测试失败；§28.2 双机 fixture green；canonical specs 同步归档
   • PR #88 = OPEN / MERGEABLE(CLEAN) / 15 commit 在 head

[当前] integrated-candidate

[下一步 · 只能由用户/仓库设置完成]
   ① §36.8 step 10 — fresh-machine 真实场景验收 → 产出 human-scenario-accepted
   ② §36.8 step 11 — 加项目测试 required CI check / 分支保护（Docs-site check 单独不足，§23.4）

[终点] human-scenario-accepted → releasable → 发布 0.1.5
```

### 5.1 fresh-machine 人工验收清单（§36 Phase Release，10 项）

在干净机器 / 干净 `RASEN_HOME` 上，按顺序确认：

1. clone 项目 → 发现 Store bootstrap requirement（`rasen bootstrap --check` 报缺失）。
2. 显式 clone/register Store（`rasen bootstrap --apply`）。
3. Store roster 正确恢复（`rasen store list` / spaces 看到成员项目）。
4. 从 Store planning space 选择**准确的** Project checkout（多 checkout 不歧义）。
5. 启动真实 Agent（Claude 或 Codex）。
6. 完成一个真实 Change Pipeline（propose→apply→verify→ship→archive），或产生可解释、可恢复的真实失败。
7. Store/Project/global learned resolution 与发布承诺一致（`rasen knowledge list/show`）。
8. eject 不读取其他机器遗留的绝对路径。
9. Git 中不存在本机绝对路径、凭据或 transient state（`git diff --check` + 抽查 Store/project 仓）。
10. 多语言（en/zh-cn/ja）命令面文案正确。

通过后：把状态记为 `human-scenario-accepted`，附证据（终端记录/截图/产物路径）。

### 5.2 required CI（§36.8 step 11）

仓库设置（需 maintainer）：

- 把 `pnpm lint` + `pnpm build` + `pnpm test` 配为 dev/0.1.5 的 required status check（不是仅 Docs-site `build-and-deploy`）。
- 启用分支保护（required reviews 按团队惯例）。
- 注意：全量 `pnpm test` 在 Windows 上有 `store-membership-cli` 的间歇 flake；CI 策略应允许��试或隔离该文件（见 §6）。

### 5.3 版本边界（§29.2 / §36）

- **0.1.5**（本 PR scope）：Store 身份/membership/runtime context/learned 解析/bootstrap/portable project knowledge。
- **0.2.0**（不在本 PR）：Issue、Execution Plan、Issue acceptance、Issue Board、portable run checkpoint。CHANGELOG 已声明此边界。

---

## 6. 风险与回滚（§30 摘要）

- **alias→UID 迁移改变 ledger/digest identity**：已有 ledger v1/v2 migration 测试；dogfood 数据需重跑 migration dry-run。
- **M6 是破坏性变更**（declaration-only 不再授予 Session 资格）：launch 与 `rasen doctor` 对齐报同一条件 + `rasen store add-project` 修复命令；既有 declaration-only 安装会收到迁移提示而非静默断。
- **并发写**：M7/M8/B5 已加 owner-aware 锁；Windows `store-membership-cli` 全量 flake 是已知 CLI-spawning 问题（隔离绿），不阻塞逻辑正确性。
- **回滚原则**：reader 先于 writer；migration 保留旧数据直到新数据验证；不自动删用户修改；失败输出 repair plan。

---

## 7. 如��复现当前 evidence

```powershell
git fetch origin
git switch feat/store-context-portable-knowledge   # head = c4e54285
pnpm install --frozen-lockfile
pnpm lint
pnpm build
pnpm test                                          # ~10–12 min；Windows 上 store-membership-cli 偶发 flake
git diff --check origin/dev/0.1.5...HEAD
# 双机场景证据（含在 pnpm test 里，也可单跑）：
pnpm vitest run test/cli-e2e/store-lifecycle.test.ts
pnpm vitest run test/core/store/bootstrap-obtain.test.ts
```

机器：`Sayo` / Windows 11 / Node 5.9.3 toolchain。
