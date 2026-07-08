# CDP Proxy API 参考

## 基础信息

- 地址：`http://localhost:3456`
- 启动：`node ~/.claude/skills/web-access/scripts/cdp-proxy.mjs &`
- 启动后持续运行，不建议主动停止（重启需 Chrome 重新授权）
- 强制停止：`pkill -f cdp-proxy.mjs`
- 环境变量：
  - `CDP_PROXY_PORT`（默认 3456）
  - `CDP_TAB_IDLE_TIMEOUT`（受管 tab 闲置自动关闭，默认 900000ms）
  - `CDP_MAX_NETWORK_EVENTS`（环形缓冲容量，默认 2000）
  - `CDP_MAX_CONSOLE_EVENTS`（默认 1000）
  - `CDP_MAX_BODY_BYTES`（缓存响应体大小上限，默认 262144 / 256 KiB）

## 基础导航 & 输入

### GET /health
健康检查，返回 `{ status, connected, sessions, managedTabs, chromePort }`。

### GET /targets
列出所有页面 tab。每项 `{ targetId, title, url, type }`。

### GET /new?url=URL
创建新后台 tab；自动等待加载。返回 `{ targetId }`。

### GET /close?target=ID
关闭 tab。

### GET /navigate?target=ID&url=URL[&hard_reload=true]
导航并等待加载完成。`hard_reload=true` 时走 `Page.reload({ignoreCache:true})`，对调试改过的本地静态资源特别有用。仅 `hard_reload=true` 不带 `url` 时只刷新。

### GET /back?target=ID
后退一页。

### GET /info?target=ID
`{title, url, ready}`。

### POST /eval?target=ID
执行 JS 表达式（body 是 JS），支持 `await`。返回 `{ value }` 或 `{ error }`。

### POST /click?target=ID
JS 层点击（`el.click()`），body 是 CSS 选择器。

### POST /clickAt?target=ID[&visible=true&nth=N&text=...]
真实鼠标点击（`Input.dispatchMouseEvent`）。可叠加：
- `visible=true` 只挑可见（`offsetParent != null` 且面积 > 0 且非 `display:none/visibility:hidden`）
- `nth=N` 多个匹配选第 N 个（0 起）
- `text=子串` 进一步要求 `innerText` 包含
返回 `{clicked, x, y, tag, text, match_index, total_matches}`。

### POST /setFiles?target=ID
绕过文件对话框给 file input 赋路径。body：`{"selector":"...","files":["/abs/path",...]}`。

### GET /scroll?target=ID&y=N&direction=down|up|top|bottom
滚动后自动等 800ms 触发懒加载。

### GET /screenshot?target=ID[&file=PATH&format=png|jpeg&full=true&retries=2]
截图。`full=true` 走 `captureBeyondViewport`。默认重试 2 次（含首次共 3 次），可调 `retries=N`。

---

## 浏览器层网络抓包（Network 域）

**适用场景：逆向 SPA 的隐藏 API**。比 eval 注入 fetch wrapper 可靠得多——抓在浏览器层，不受页面任何 fetch 缓存/iframe 隔离/`openapi-fetch` pristine ref 等绕过手法影响。

### GET /network/enable?target=ID[&body=true]
启用抓包。`body=true` 自动缓存响应体（跳过 image/video/audio/wasm，且 >256KiB 也跳过；用 `/network/body` 按需补取）。

返回 `{enabled, captureBody, buffered}`。

### GET /network/events?target=ID[过滤参数]
查抓包缓冲。事件按 `seq` 单调递增。

过滤参数：
- `since=N` 仅返回 seq > N（增量取）
- `url_contains=子串` 
- `url_pattern=正则`（容错：非法 regex 静默忽略）
- `method=GET|POST|...`
- `status=200` 完成状态码
- `has_post_data=true`
- `limit=200`（默认）
- `include_body=true`（默认 true）

返回 `{enabled, captureBody, total, lastSeq, returned, events: [...] }`。

每条 event：`{seq, kind, method, url, status, mime, bytes, started_at, ended_at, completed, failed, error, request_headers, post_data, response_headers, response_body, response_body_base64, redirects, frames}`。

### GET /network/body?target=ID&seq=N
按需取一条响应体（即使 enable 时没开 `body=true`）。返回 `{seq, body, base64Encoded}`。

### GET /network/wait?target=ID[过滤参数]&timeout=30000[&body=true&include_body=true&since=N]
**长轮询等待匹配请求 `completed`**。一次返回一条事件（即 first match-after-since）。

支持与 `/network/events` 相同的过滤参数。`since=N` 让多个并发 wait 互不抢同一事件。

超时返回 HTTP 408 + `{matched:false, error:"timeout"}`。

### GET /network/clear?target=ID
清空缓冲、重置 seq。

### GET /network/disable?target=ID
停用抓包；所有等待中的 waiter 立即收到 503。

### Network 用法模式

逆向一个"点了按钮才发的提交请求"：

```bash
TAB=$(curl -s http://localhost:3456/targets | jq -r '.[0].targetId')

# 1. 开抓包，开 body
curl -s "http://localhost:3456/network/enable?target=$TAB&body=true"

# 2. 在另一个 shell 里启动等待（阻塞）
curl -s "http://localhost:3456/network/wait?target=$TAB&url_pattern=/api/.*/submit&method=POST&timeout=60000&include_body=true" > /tmp/captured.json &

# 3. 触发动作（用户点 / 自己 click）
curl -s -X POST "http://localhost:3456/clickAt?target=$TAB" -d 'button[data-action=submit]'

# 4. wait 一返回，POST body / 签名头 / 响应都在 /tmp/captured.json
wait
```

---

## 等待原语

### GET /wait?target=ID&selector=CSS[&visible=true&timeout=10000&interval=200]
等待元素出现（默认要求可见：`offsetParent !== null` 或 bounding box 有宽度）。

### POST /wait?target=ID[&timeout=10000&interval=200]
body 是 JS 表达式。轮询 `interval` 毫秒，每次执行表达式，truthy 即返回。

返回 `{matched: true, waited_ms}` 或 HTTP 408 + `{matched:false, error:"timeout"}`。

---

## 控制台 / 异常采集

### GET /console/enable?target=ID
启用 `Runtime.consoleAPICalled` + `Runtime.exceptionThrown` + `Log.entryAdded` 采集。

### GET /console?target=ID[&since=&level=&contains=&limit=]
查日志。`level`：log/info/warn/error/debug 等。`contains` 在序列化后整体过滤。

每条 `{seq, kind: "console"|"exception"|"log", level, t, args|message, stack, url, line, column}`。

### GET /console/clear?target=ID
清空缓冲。

---

## 存储

### GET /cookies?target=ID[&name=NAME&url=URL]
读 Network.getCookies。`name` 过滤同名；不传 `url` 则取当前 frame 全部。

### POST /cookies?target=ID
body：单个 `{name,value,...}` 或数组。透传给 `Network.setCookies`。

### GET /localStorage?target=ID[&key=NAME]
不带 key 取全部 `{items: {...}}`，带 key 取 `{value}`。

### POST /localStorage?target=ID
body：`{key,value}` 或 `{k1:v1, k2:v2}`。非字符串值会被 `JSON.stringify`。

---

## DOM 快捷

### GET /text?target=ID&selector=CSS
返回 `{text, value}`（text 是 `innerText`/`textContent` 前 8000 字，value 是 input/textarea 的 `.value`）。404 表示选择器无匹配。

### GET /attribute?target=ID&selector=CSS&name=ATTR
返回 `{value}` 或 404。

---

## 资源 / iframe

### GET /resources?target=ID[&type=TYPE&contains=子串]
`PerformanceResourceTiming` 条目：`{name, type, dur, size, t}`。

`type` 取值匹配 `initiatorType`：`script` / `stylesheet` / `img` / `xmlhttprequest` / `fetch` / `link` / `css` / `font` / `navigation`。**特殊**：`type=wasm` 按 URL 后缀筛 `.wasm`。

`contains` 在 URL 上 substring 匹配。

### GET /iframes?target=ID
列出 `type=iframe` 的 targets（即跨源 OOPIF）。**注意**：同源空 `<iframe>` 一般不会作为独立 target 出现，要操作它们用 `eval` 进 `contentWindow`。

---

## 浏览器 QA（DOM 快照 / 性能 / 视口）

### GET /snapshot?target=ID[&mode=i|C|D]
序列化交互式 DOM 树，每个元素带稳定 `@ref`、`role`、`name`、`tag`。
- `mode=i`（默认）：仅交互元素（`a/button/input/select/textarea`、含 `role`/`onclick`/`tabindex` 的元素）。
- `mode=C`：追加非 ARIA 可点元素（`cursor:pointer` / `onclick` / `tabindex`），ref 前缀 `@c`。
- `mode=D`：对该 target 上一次快照做增量 diff，返回 `{added, removed, changed, unchanged, total}`。

每次调用都会把当前树写入 per-`targetId` 基线（进程内存，proxy 重启丢失），供后续 `mode=D` 比较。返回 `{mode, total, elements}`。

### GET /perf?target=ID
页面性能指标：`{fp, fcp, lcp, cls, longTasks:{count,tasks}, navTiming:{ttfb,domContentLoaded,load,transferSize}, resources:{count,byType,transferBytes}}`。同步读取缓冲的 Performance 条目；指标视页面渲染状态而定，缺失项返回 `null`（不报错）。

### GET /viewport?target=ID&width=W&height=H[&scale=S&mobile=true]
`Emulation.setDeviceMetricsOverride` 施加设备视口模拟，**不改真实窗口尺寸**。返回 `{applied}`。override 会残留在 tab 上，通过再次 `/viewport` 复位或关闭 tab 清除。

### GET /responsive?target=ID[&screenshot=true&dir=PATH]
依次对 mobile(375x812) / tablet(768x1024) / desktop(1440x900) 断点施加 `setDeviceMetricsOverride`；`screenshot=true` 时每断点截一张图（`dir` 指定则写盘 `responsive-<bp>.png`，否则返回字节数）。返回 `{breakpoints}`。

---

## /eval 使用提示

- POST body 为任意 JS 表达式，返回 `{ value }` 或 `{ error }`
- 支持 `awaitPromise`：可以写 async 表达式
- 返回值必须是可序列化的（字符串、数字、对象），DOM 节点不能直接返回，需要提取属性
- 提取大量数据时用 `JSON.stringify()` 包裹，确保返回字符串
- 根据页面实际 DOM 结构编写选择器，不要套用固定模板

## 错误处理

| 错误 | 原因 | 解决 |
|------|------|------|
| `Chrome 未开启远程调试端口` | Chrome 未开启远程调试 | 提示用户打开 `chrome://inspect/#remote-debugging` 并勾选 Allow |
| `attach 失败` | targetId 无效或 tab 已关闭 | 用 `/targets` 获取最新列表 |
| `CDP 命令超时` | 页面长时间未响应 | `/screenshot` 已内置重试；其他端点可重试或检查 tab 状态 |
| `端口已被占用` | 另一个 proxy 已在运行 | 已有实例可直接复用 |
| `/network/wait` 408 timeout | 在指定时间内未观察到匹配请求 | 看是否过滤条件太严，或动作没真正触发请求 |
| `/network/body` 410 | 响应体已被 Chrome 释放或不可获取 | 必须在请求完成不久后取，或 enable 时就开 body=true |
