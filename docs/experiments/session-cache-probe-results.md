# Session 缓存探针结果（KC1–KC6）

- claude 版本：`2.1.220`；执行日期：2026-07-29（本地时区，UTC+8）；执行窗口 16:35 – 20:06
- model：**haiku**（协议默认 sonnet；按用户指示改用 haiku。KC6 双档位跑了 haiku + sonnet，见 §KC6）
- 输出目录：`%USERPROFILE%\.rasen\probe\`（全部保留）
  - `session-cache\`（主链 + KC2 + KC5 + KC1c）
  - `session-cache-bisect\`（68k 二分链）
  - `session-cache-large\`（95k 链）
  - `session-cache-cwdrepo\` / `session-cache-cwdtemp\`（cwd 对照）
  - `session-cache-kc6\`（常驻 stream-json 双臂）
- 账单：**25 次计费调用，合计 $3.5325**

---

## 结论摘要

**杠杆是宿主进程是否存活，不是缓存 TTL。**

| worktree cwd，空闲 30–35 分钟 | 结果 |
|---|---|
| 一发即走 `claude -p --resume` | **MISS-rewrite** |
| 常驻 `--input-format stream-json` 进程 | **HIT**（haiku 与 sonnet 同） |

原设计押的「`-p --resume` 事件驱动唤醒」被证伪；但文档在 KC1a 失败分支上点名的备选（Agent SDK streaming 宿主）已由 KC6 提前验证成立。**路线不必推倒，需要换宿主形态。**

---

## §7 模板

- bootstrap ctx ≈ **98,336** tokens（≥30k？**是**）

| 步骤 | 间隔 | verdict | cache_read | cache_creation | session_id 变化? |
|---|---|---|---|---|---|
| wake-7min | 7m | **HIT** | 97,655 | 697 | 否 |
| wake-30min | 30m | **MISS-rewrite** | 21,736 | 76,656 | 否 |
| wake-55min | 55m | *未执行*（见下） | — | — | — |
| wake-65min | 65m | *未执行* | — | — | — |
| touch-50min | 50m | **MISS-rewrite** | 21,736 | 77,247 | 否 |
| wake-35min-after-touch | 35m | **MISS-rewrite** | 21,736 | 77,461 | 否 |

> 55/65 分钟两步于 17:24:30 主动终止。理由：30 分钟已 MISS，55/65 必然 MISS 且不产生新信息；KC1b 的目的（验证测量方法能识别 MISS）已由 30 分钟那次达成。省下的 3 小时改投 cwd 对照与 KC6，见下。**这是对协议的偏离，据此判读。**

- **KC2**：不同 cwd resume = **硬报错** `No conversation found with session ID: 218a9774-…`，exit code 1（不是静默新开会话，也不是全局可寻址）。同 cwd 对照 = **OK**（read 98,392 / write 72，≈12 分钟间隔仍 HIT，且证明步骤 1 未弄坏会话）。→ **registry 必须记录并校验 cwd**。
- **KC3**：通知后请求 = **hit**。`cacheRead 79,524` / `cacheWrite 524`，`churnEvents: []`，4.13 分钟间隔出现在 `gapHistogram` 的 `1-5m` 桶。→ background 通知注入是纯前缀追加，**不需要改走 park+signal 通道**。
- **KC4**：session_id 链 = **`218a9774` 全程不变**（跨 7 次 resume，含并发与跨 cwd 失败尝试）。其余各臂同样零轮换。新增 transcript：worktree 项目目录 5 个、scratchpad 项目目录 4 个（各含 1 个 smoke/废弃会话）。→ **registry 记单 id 即可，无需 id 链**。
- **KC5**：两侧**都成功、都计费**（A: read 98,564/write 24；B: read 98,464/write 100，两者读数差 100 说明互相看不见对方的轮次）。事后健康检查：会话只认得 **PONG-A 与 PONG-KC2C，PONG-B 被静默丢弃**。会话本身保持可用。→ **CLI 无任何并发保护，单飞锁必须在其之上自建；丢轮次不会报错**。

---

## KC1a 的真实病因：cwd，不是 TTL

失败与成功的分界线不是时间、不是上下文规模、不是模型档位，是**会话的 cwd**。

| cwd | 规模 | 试次 | 结果 |
|---|---|---|---|
| scratchpad | 68k | 15 / 22 / 26 / 30 / 40 分 | **HIT ×5** |
| scratchpad | 95k | 30 / 40 分 | **HIT ×2** |
| scratchpad | 98.7k | 30 分 | **HIT ×1** |
| worktree | 98k | 7 / 12 分 | HIT ×2 |
| worktree | 98k | 30 / 35 / 50 分 | **MISS ×3** |
| worktree | 106k | 30 分 | **MISS ×1** |

**决定性对照**（同脚本、同 5 个 payload 文件、同模型、同 30 分钟空闲，启动相差 2 秒、唤醒相差 11 秒，唯一变量是 cwd）：

| 会话 | cwd | ctx | 30 分钟 | read / write |
|---|---|---|---|---|
| `28d5c415` | **worktree** | 106,078 | **MISS-rewrite** | 26,057 / 80,086 |
| `d7cc9c89` | scratchpad | 98,752 | **HIT** | 98,485 / 283 |

对照臂 98,752 token 与最初失败的 98,336 会话几乎等大 → **规模因素出局**。40 分钟试次恰好发生在另外两个会话（94k + 126k）刚 bootstrap 完一分钟后、缓存压力最大时依然全 HIT → **容量淘汰假设出局**。

相同 payload 下 worktree 会话比 scratchpad 会话多 **7,326 token**，即 Claude Code 因身处真实仓库而注入的项目上下文；MISS 时残存的前缀恒定落在 21,736 / 26,057 处，正是该块之前的边界。

**未能定位到具体字段。** transcript 只保存消息与 attachment 元数据（`deferred_tools_delta` / `agent_listing_delta` / `skill_listing`，两个 worktree 会话完全一致且仅出现在 bootstrap），**不保存运行时渲染的 system prompt**，因此无法凭现有证据指认那 7,326 token 中究竟哪一项在变。需要更深插桩。

---

## KC6：常驻 stream-json 进程的留存（新增探针）

`claude -p --input-format stream-json --output-format stream-json --verbose`，stdin 全程不关，**cwd = worktree**（与一发即走三连 MISS 的同一目录），空闲 35 分钟后经 stdin 发第二条消息。

| 臂 | session_id | bootstrap ctx | 35 分钟后 read / write | verdict | sid 稳定 |
|---|---|---|---|---|---|
| haiku | `8dd26873` | 94,150 | 93,697 / 467 | **HIT** (99.5%) | 是 |
| sonnet | `e4c9ecdf` | 126,412 | 126,293 / 138 | **HIT** (99.9%) | 是 |

- 空闲期间进程存活确认（`process alive=True`），stdin 未关闭。
- 写入档位全程 `ephemeral_1h`，`ephemeral_5m` 恒为 0。
- 消息排队：stdin 写入后按序处理，未观察到排队异常；bootstrap 前有若干 `system/thinking_tokens` 事件，`system/init` 携带 session_id。
- **sonnet 与 haiku 结论一致 → 模型档位不是变量**，开场「haiku 是否具代表性」的 caveat 就此关闭。

---

## §8 判读

| KC | PASS 标准 | 实际 |
|---|---|---|
| KC1a | 7/30/55 三次全 HIT | **FAIL**（30 分钟 MISS；55 分钟未执行） |
| KC1b | 65 分钟 MISS 且归因 ttl-expiry | **未执行**；MISS 检出能力已由 30 分钟那次验证 |
| KC1c | touch HIT 且 touch 后 35 分钟 HIT | **FAIL**（两腿皆冷） |
| KC2 | 行为被完整记录 | **达成**：硬报错 + exit 1 |
| KC3 | 通知后不产生 rebase churn | **PASS** |
| KC4 | 身份链被完整记录 | **达成**：不轮换 |
| KC5 | 行为被完整记录 | **达成**：双成功 + 静默丢轮次 |
| KC6 | （新增）常驻进程 35 分钟仍 HIT | **PASS**（双档位） |

---

## 残余缺口（下一轮该补的）

1. **>35 分钟的常驻进程留存未验证。** KC6 只证到 35 分钟，而设计的动机场景是 >55 分钟乃至 1 小时。**需要一次 65 分钟的 KC6 复跑**才能支撑原目标。
2. **worktree 一发即走的 MISS 只在 haiku 上测过**（cwdrepo 臂也是 haiku）。sonnet 的一发即走 worktree 30 分钟从未测。KC6 显示进程存活效应与档位无关，但一发即走侧的档位无关性属推断而非实测。
3. **7,326 token 项目上下文块中的易变字段未定位**，因此「是否可修」仍未知。
4. KC5 的丢轮次是否与时序/负载相关未做重复试验（n=1）。

---

## 执行偏离与踩坑记录

- **脚本 bug（已修，改动未提交）**：`session-cache-probe.ps1` 中 `[uint32]0x80000003` 在 PowerShell 5.1 下把字面量解析为负 Int32，转换抛异常，且该行位于 `try` 之前——**首次启动连一行日志都没写就静默死亡**。已改为 `[Convert]::ToUInt32('80000003', 16)`（第 44–47 行与 finally 块）。
- 协议 55/65 分钟两步主动终止（理由见上）。
- 新增未在协议内的探针：cwd 对照、68k/95k 规模对照、KC6 双臂。脚本在会话 scratchpad 目录：`ttl-bisect.ps1`、`resume-chain.ps1`、`kc1c-touch.ps1`、`kc6-stream.ps1`。
- **PowerShell 坑**：`powershell.exe -File script.ps1 -Arr a b` 会把 `b` 当位置参数报错；`-Arr "a,b"` 会被当成**单个字符串**（`-GapsSeconds "1800,2400"` 被强转成 `18002400` 秒去 `Start-Sleep`）。两种写法都跑歪，其中后者不报错只跑错。必须用 `-Command` + 真正的 `@(...)` 字面量。
- 二分探针从 scratchpad 目录启动，使其 transcript 落入不同的 `~/.claude/projects/` 目录，避免污染主链 KC4 普查——此举意外成为定位 cwd 根因的关键。
