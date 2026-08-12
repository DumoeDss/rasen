# Rasen × OmniCross 多 Provider 推理路由设计

> 状态：设计基线，尚未实现
> 日期：2026-08-11
> 范围：Rasen 作为消费端，通过长期运行的 OmniCross daemon 为每个 workflow stage
> 自动选择上游 Provider/账号与模型，并向 Claude Code 或 Codex 注入一次性路由凭证。

## 1. 决策摘要

Rasen 保留 workflow、stage、角色、运行时和 agent 进程的所有权；OmniCross 负责上游资源、
认证、账号调度、协议转换和请求转发。用户只需要：

1. 在 OmniCross 中配置上游 Provider、API Key、订阅账号或账号池；
2. 在 Rasen workflow stage 中选择 agent runtime、上游引用和模型；
3. 启动一个长期运行的 OmniCross daemon。

Rasen 执行 stage 时向 OmniCross 申请一个临时 **Route Lease**。该 lease 在内存中同时表达：

- 本次请求允许进入的客户端协议；
- 目标上游 Provider、账号、账号组或账号池；
- 冻结的上游模型；
- 一次性下游 route token；
- Claude Code 或 Codex 所需的环境变量和单次启动参数。

Rasen 不要求用户手动创建 Gateway API Key 或 GatewayBinding，也不修改用户的
`~/.codex/config.toml`、`~/.codex/auth.json` 或 Claude 原生凭证文件。

## 2. 问题与目标

当前 Rasen 可以为 workflow/stage 选择 Claude Code、Codex 等工具，也可以向工具传递模型，
但模型通常受工具当前登录状态或固定 Provider 限制。期望的配置是：

```yaml
planner:
  runtime: codex
  upstreamRef: claude-premium-pool
  model: claude-opus-4-6

implementer:
  runtime: claude
  upstreamRef: anthropic-api
  model: claude-sonnet-4-6

ship:
  runtime: codex
  upstreamRef: deepseek-api
  model: deepseek-chat
```

以上 YAML 仅表达目标语义，不代表当前 pipeline schema 已包含这些字段。实现时应把等价字段
纳入规范 schema、冻结执行计划和运行记录，而不是只做 prompt 约定。

### 2.1 目标

- 一个长期运行的 OmniCross daemon 服务所有 Rasen runs 和并发 stages；
- 同一个 Claude Code/Codex 工具可在不同 stage 使用不同 Provider 和模型；
- 用户只配置上游资源，不为 Rasen 手动创建下游 Key 和 Binding；
- 每个 stage 获得独立、短期、最小权限的 route token；
- Provider 密钥和订阅令牌永不进入 Rasen Run Record、agent 环境之外的持久状态或日志；
- resume 保持相同的逻辑推理路由，但可以重新签发临时 token；
- Rasen 原有 sandbox、approval、structured output、thread/session 和 leaf-worker 约束保持不变。

### 2.2 非目标

- 不以此功能替代 OmniCross 面向普通外部客户端的长期 Gateway Key/GatewayBinding；
- 不让 OmniCross 编排 Rasen pipeline、stage、重试、workspace 或 agent 会话；
- 不让 Rasen 存储或刷新上游 API Key/OAuth token；
- 不为每次 stage 在 OmniCross 数据库创建持久 API Key 或 GatewayBinding；
- 不通过修改用户全局 Codex/Claude 配置完成 stage 路由；
- 第一阶段不支持远程公网 daemon；先限定为本机 loopback 控制面与代理面。

## 3. 两种 OmniCross 消费模式

| 维度 | 普通外部客户端 | Rasen 托管执行 |
|---|---|---|
| 下游身份 | 长期 Gateway API Key | 临时 route token |
| 路由 | 持久 GatewayBinding | 内存 RouteContext |
| 创建者 | 用户/管理员 | Rasen 自动申请 |
| 生命周期 | 显式撤销或轮换 | stage 结束释放，超时自动回收 |
| 配置文件 | 可选择持久 CLI 集成 | 零文件写入 |
| 主要用途 | 普通终端、第三方客户端 | workflow stage、自动化 agent |

“自动生成 API Key 与 Binding”是正确的产品语义；实现上不应创建持久数据库记录。临时 route
token 就是本次 stage 的 API Key，RouteContext 就是本次 stage 的 Binding。

## 4. 所有权边界

### 4.1 Rasen 所有

- pipeline 定义、stage DAG、角色和 gate；
- `runtime: claude | codex` 选择；
- stage 的 `upstreamRef`、模型、effort、sandbox 和 approval 策略；
- Run/action/session/workspace 的身份与冻结计划；
- Claude/Codex 进程启动、输出解析、超时、中断与 resume；
- Route Lease 的申请、续租、释放和失败恢复；
- 不含 secret 的运行证据与错误投影。

### 4.2 OmniCross 所有

- Provider、API Key Pool、订阅账号、账号组和账号池；
- 上游认证、OAuth 刷新、账号健康、限额和故障切换；
- runtime 到 ingress 协议的映射；
- Provider 格式识别、请求/响应转换和上游调用；
- resident ProviderProxy、RouteContext 和 route token；
- token 过期、撤销、lease 诊断与无 secret 审计。

### 4.3 不共享的状态

Rasen 不读取 OmniCross 上游凭证；OmniCross 不读取 Rasen prompt、workspace 文件或 Run
Record。OmniCross 只能在转发请求时看到客户端发送的模型请求内容，这是代理功能的必要边界，
并应服从 OmniCross 自身的审计和数据保留配置。

## 5. 架构

```text
Pipeline Definition
  stage.runtime + stage.inference + model
                         │
                         ▼ freeze
Frozen Stage Execution Profile
  runtime + upstreamRef + model + route/config revision
                         │
                         ▼ create lease
┌──────────────────────────────────────────────────────────────┐
│ Long-lived OmniCross daemon                                  │
│                                                              │
│  RouteLeaseManager ──► resident ProviderProxy                 │
│       │                    │                                  │
│       │                    ├─ Anthropic Messages ingress      │
│       │                    ├─ OpenAI Responses ingress        │
│       │                    └─ transformer/upstream pipeline   │
│       │                                                       │
│       └─ leaseId + ephemeral token + runtime launch descriptor│
└─────────────────────────────┬────────────────────────────────┘
                              │
                              ▼
Rasen Stage Executor
  ├─ Claude runner: merge lease.env
  └─ Codex runner: merge lease.env + lease.extraArgs
                              │
                              ▼
                    Claude Code / codex exec
                              │
                              ▼
                       OmniCross proxy
                              │
                              ▼
             selected Provider/account + selected model
```

daemon 和 ProviderProxy 长期存在；单个 Route Lease 有意保持临时。释放一个 lease 只删除该
RouteContext，不销毁 listener，也不影响其他并发 stage。

## 6. Workflow 与冻结执行配置

### 6.1 建议的概念模型

```ts
type OmniCrossUpstreamRef =
  | { kind: 'provider'; providerId: string; keyId?: string }
  | { kind: 'account'; providerId: string; accountId: string }
  | { kind: 'account-group'; providerId: string; group: string }
  | { kind: 'account-pool'; providerId: string };

interface StageInferenceConfig {
  broker: 'omnicross';
  upstream: OmniCrossUpstreamRef;
  model: string;
}

interface FrozenStageExecutionProfile {
  runtime: 'claude' | 'codex';
  inference: StageInferenceConfig;
  effort?: string;
  sandbox?: string;
  brokerEndpointRef: string;
  brokerConfigRevision?: string;
}
```

`upstreamRef` 比单独的 `provider` 更准确，因为目标可能是 BYO Provider、单账号、账号组或账号池。
workflow 只保存资源标识，不保存凭证。

### 6.2 冻结规则

stage 获得执行授权时，应把以下逻辑路由冻结进 execution profile：

- runtime；
- upstream 的判别联合和稳定标识；
- model；
- OmniCross daemon endpoint 的配置引用，而非明文管理 token；
- 可用时记录上游/路由配置 revision；
- 与 runtime 相关的 effort、sandbox 和 approval 设置。

不得冻结：

- route token；
- lease 返回的 secret 环境变量值；
- Provider API Key、OAuth access/refresh token；
- 临时 loopback port（daemon 使用固定/可发现 endpoint 时）。

### 6.3 Resume 规则

Resume 必须继续使用冻结的逻辑路由。若原 lease 仍有效，可继续使用；若 lease 已释放、过期或因
daemon 重启丢失，Rasen 使用同一个 frozen profile 申请新 lease。新 token 不构成路由漂移。

如果 `upstreamRef` 已被删除或模型不再可用，应产生显式 blocked/fatal 诊断，不得静默选择另一
Provider。只有 workflow 中明确声明的 pool/fallback 策略可以允许 OmniCross 换账号或 key。

## 7. Route Lease 客户端契约

Rasen 依赖 OmniCross 提供以下受保护的本地控制面：

```text
POST   /admin/api/route-leases
POST   /admin/api/route-leases/:leaseId/renew
DELETE /admin/api/route-leases/:leaseId
GET    /admin/api/route-leases/:leaseId   # 只返回脱敏元数据
```

创建请求至少包含：

```json
{
  "schemaVersion": "omnicross.route-lease.request/1",
  "consumer": "rasen",
  "runtime": "codex",
  "upstream": {
    "kind": "provider",
    "providerId": "deepseek-api"
  },
  "model": "deepseek-chat",
  "execution": {
    "runId": "run-123",
    "stageId": "ship",
    "attempt": 1,
    "sessionId": "thread-or-session-affinity-key"
  },
  "idempotencyKey": "run-123:ship:1"
}
```

响应至少包含：

```json
{
  "schemaVersion": "omnicross.route-lease/1",
  "leaseId": "lease-123",
  "expiresAt": "2026-08-11T12:00:00.000Z",
  "runtime": "codex",
  "model": "deepseek-chat",
  "launch": {
    "env": {
      "OMNICROSS_CODEX_ROUTE_TOKEN": "<ephemeral-secret>"
    },
    "extraArgs": [
      "-c", "model_provider=\"omnicross\"",
      "-c", "model_providers.omnicross.base_url=\"http://127.0.0.1:8766/openai\"",
      "-c", "model_providers.omnicross.wire_api=\"responses\"",
      "-c", "model_providers.omnicross.env_key=\"OMNICROSS_CODEX_ROUTE_TOKEN\"",
      "-c", "disable_response_storage=true"
    ]
  }
}
```

Rasen 将 `launch.env` 仅合并到目标 child process，将 `launch.extraArgs` 作为 argv 元素传入，
不得拼接成 shell 字符串。

## 8. Runtime 映射

### 8.1 Codex

OmniCross lease 应固定：

- ingress：`openai-responses`；
- provider name：专用、不与用户配置冲突的 `omnicross`；
- `wire_api="responses"`；
- `env_key="OMNICROSS_CODEX_ROUTE_TOKEN"`；
- `disable_response_storage=true`，直到 OmniCross 明确支持 Codex response-id store；
- route token 通过专用 env key 进入 Codex child process。

不得依赖：

- `requires_openai_auth=true`；
- `OPENAI_API_KEY` 这个进程级通用变量；
- 用户 `auth.json`；
- 用户全局 `model_provider`。

Rasen 继续拥有 `codex exec` 的 `--json`、`-o`、`--output-schema`、sandbox、effort、prompt、
thread resume 和输出解析参数。OmniCross 只返回路由相关 argv。

### 8.2 Claude Code

OmniCross lease 应固定：

- ingress：`anthropic-messages`；
- `ANTHROPIC_BASE_URL=<resident-proxy-base>`；
- `ANTHROPIC_AUTH_TOKEN=<route-token>`；
- 如 Claude Code 需要，提供非 secret 的 `ANTHROPIC_API_KEY` sentinel；
- 目标模型的环境变量或 argv。

Rasen 继续拥有 `claude -p` 的输入/输出格式、resume、工具限制、prompt 和结果解析。

### 8.3 格式转换

用户不在 workflow 中配置 `wire_api` 或 transformer。OmniCross 根据 runtime ingress 和上游资源
的 `apiFormat` 自动解析 transformer chain。如果组合不可支持，lease 创建必须失败，而不是等到
agent 运行中产生不透明的 502。

## 9. 生命周期与并发

```text
unleased
   │ POST create
   ▼
active ── heartbeat/renew ──► active
   │                              │
   │ stage completed/failed       │ daemon restart/TTL
   ▼                              ▼
releasing                      expired/lost
   │                              │
   ▼                              └─► recreate from frozen profile
released
```

- 每个 stage attempt 使用独立 idempotency key 和 lease；
- 并发 stages 不共享 route token；
- 同一 stage 的重试 attempt 默认创建新 lease；
- create 超时后重试必须通过 idempotency key 得到同一个仍存活的 lease；
- stage 运行期间 Rasen 在 lease TTL 的安全窗口内续租；
- finally 中 best-effort 释放；释放失败依靠 TTL 回收；
- cancel 应先终止 agent 进程，再释放 lease；
- daemon 重启后旧 token 必须失效，Rasen 重新申请；
- 不使用“最近一个 lease”或“最近一个 route”之类的隐式选择。

## 10. Rasen 现有接缝

当前代码已有大部分本地注入能力：

- `src/core/codex/invocation.ts`
  - `ModelProviderOverride` 已支持 `name`、`baseUrl`、`wireApi`、`envKey`；
  - `buildCodexExecInvocation()` 已生成对应的单次 `-c model_providers.*` 参数；
- `src/core/codex/runner.ts`
  - runner 已接受 child process `env`；
- `src/core/claude/runner.ts`
  - runner 已接受 child process `env`。

需要补齐的主要接线：

1. 定义并校验 stage inference 配置和 frozen execution profile；
2. 增加 OmniCross discovery/config 与受保护的 Route Lease client；
3. 让 Codex runner options 接收并传递 `providerOverride` 或直接接收路由 argv；
4. 在 Claude/Codex stage executor 周围统一管理 lease 生命周期；
5. 把不含 secret 的 lease metadata 投影到诊断证据；
6. 在 `rasen agent dispatch`、pipeline/session execution layer 和 resume 中贯通；
7. 为 daemon 不可用、lease 失效和上游解析失败定义稳定分类；
8. 更新 architecture-index 中 AI integration 与 workflow/pipeline 的定位说明。

## 11. 安全与数据处理

- Route Lease API 必须使用 OmniCross 管理控制面的认证，不得暴露在未认证公网接口；
- 第一阶段只允许 loopback daemon；
- route token 只出现在内存和目标 child process 环境；
- Rasen 日志、Run Record、receipt、error serialization、debug dump 和 telemetry 必须脱敏；
- OmniCross 列表/诊断 API 不得回显 token；
- route token 不能作为上游凭证使用；ProviderProxy 必须先查 RouteContext，再使用自己的上游凭证；
- 未知、过期或被释放的 token 必须 fail closed，不能回退到默认 Provider；
- 不读取、不修改 `~/.codex/auth.json`；
- 不把 lease secret 写入 `config.toml`、临时 JSON、shell history 或命令行参数；
- 管理 endpoint/token 的 Rasen 本地配置应使用现有 secret/config 机制，不进入 workflow package。

## 12. 失败语义

| 条件 | Rasen 行为 |
|---|---|
| daemon 未启动/不可达 | 启动前失败；提示启动/配置 daemon；不启动 agent |
| 管理认证失败 | fatal configuration error；不得降级到用户默认 Provider |
| upstreamRef 不存在 | frozen route invalid；blocked/fatal，等待用户修复 |
| 模型不属于目标上游 | lease 创建失败；不启动 agent |
| 格式转换不支持 | lease 创建失败，并报告 runtime/ingress/upstream format |
| lease token 401/过期 | 若 agent turn 尚可安全重试，重建 lease；否则保留失败证据 |
| daemon 重启 | 旧 lease 视为丢失，按 frozen profile 重建 |
| 释放失败 | 记录脱敏 warning，依赖 TTL；不把成功 stage 改判失败 |
| Provider 429/限额 | 由 OmniCross 按显式账号池/fallback 策略处理并返回结构化结果 |
| 上游凭证无效 | OmniCross 返回可操作错误；Rasen 不尝试读取或修复凭证 |

任何 broker 失败都不得静默回退到 Codex/Claude 当前登录账号或用户全局配置。

## 13. 分阶段实现建议

### R1：真实 E2E 探针

- 长期启动 OmniCross daemon；
- 手工申请一个 Codex lease 和一个 Claude lease；
- 使用真实 `codex exec`、`claude -p`，上游指向本地 mock Provider；
- 验证工具调用、streaming、错误、清理和所有用户配置文件 hash 不变；
- 再选择一个真实、可计费的 Provider 做显式人工验收。

### R2：Rasen broker client 与 runner 接线

- 实现 typed client、认证、超时、idempotency 和 secret redaction；
- 接入 Codex/Claude runner；
- 单 stage fresh dispatch 闭环；
- 失败时保证不启动 agent 或正确清理。

### R3：Pipeline schema 与冻结计划

- 引入 upstreamRef/model 配置；
- compile/freeze 到 execution profile；
- pipeline resume 保持逻辑路由；
- 管理 API/UI 投影只显示安全元数据。

### R4：并发、续租和恢复

- parallel stage 独立 lease；
- heartbeat/renew；
- daemon 重启重建；
- cancel/timeout/crash cleanup；
- 同一 Codex thread resume 与新 token 组合验证。

### R5：产品化

- workflow authoring/UI 选择上游资源和模型；
- 连接测试和 capability discovery；
- 运行诊断、provider/model 归因和成本数据；
- 文档、迁移、发布和兼容矩阵。

## 14. Rasen 验收标准

1. 一个 daemon 同时服务至少两个并发 stage，二者使用不同 Provider/model，互不串路由；
2. planner/implementer/ship 可分别使用 Claude Opus、Claude Sonnet、DeepSeek；
3. Rasen 用户只配置 OmniCross 上游和 workflow inference，不创建持久下游 Key/Binding；
4. Codex 和 Claude 的用户全局配置及原生凭证文件在执行前后 hash、mtime、size 不变；
5. Run Record、日志和 API 响应中没有 route token 或上游 secret；
6. stage 完成、失败、取消后 lease 被释放；进程崩溃后由 TTL 回收；
7. daemon 重启后 resume 能以同一 frozen route 申请新 token；
8. 删除 frozen upstream 后 resume 明确失败，不静默回退；
9. Codex 使用专用 `env_key`，不依赖 `requires_openai_auth` 或 `auth.json`；
10. 真实 Codex/Claude CLI 均完成至少一次包含工具调用的端到端回合；
11. 不支持的 runtime/upstream 格式组合在 agent 启动前失败；
12. 现有不使用 OmniCross 的 workflow 行为保持不变。

## 15. 待实现时确认的问题

- OmniCross daemon 的发现方式：固定配置 URL、状态文件、端口发现还是本机 IPC；
- Rasen 如何引用管理认证 secret，且不把它打包进 workflow；
- workflow 是直接保存判别联合，还是保存 OmniCross 管理的稳定 upstream resource id；
- lease 的默认 TTL、续租间隔和最大存活策略；
- Codex response storage 在 OmniCross 支持有状态 Responses 后是否可以开启；
- 成本/usage 归因使用 runId、stageId 的明文、哈希还是专用 attribution id；
- 账号池在 frozen route 下允许怎样的健康/限额故障切换；
- 远程 daemon、TLS 和多租户授权是否作为后续独立 capability。

在这些问题确定前，核心边界不变：**Rasen 冻结并执行逻辑路由，OmniCross 签发并服务临时
Route Lease；用户只管理上游，不手工管理 Rasen 下游。**
