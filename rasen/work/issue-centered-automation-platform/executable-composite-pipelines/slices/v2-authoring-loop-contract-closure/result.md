# ECP-6 Result

Status: partial

## Current evidence

- 2026-08-01：Direction 校准确认 ECP-6 是唯一 NOW 候选；用户明确要求从 Direction
  启用 slice 并通过 `rasen-auto auto-decompose` 持续推进。
- Slice 已激活并投影为 4 个严格串行的子 Change portfolio。
- 首个 child 的真实 reconciler bootstrap Run
  `run:7db97fdc0a562f1824d5a866807ab67035587c81c63fe8a214688304e558efa4` 验证了
  canonical action grant 与 fail-closed：公开 completion facade 无法观察 required workspace
  effect，domain success 未被错误提交；typed control 最终明确取消 Run。该缺口属于
  ECP-7 Session executor/self-hosting，不伪装成 ECP-6 通过证据。

## Acceptance accounting

- v2 default authoring：未验证。
- Canvas v2 authoring parity：未验证。
- shared bounded-loop lifecycle：未验证。
- vertical success/resume/fail-closed dogfood：未验证。
- Blocker/Major finding 清零：未验证。

在所有可观察验收均有真实证据前，本 Result 不得标记为 `passed`。
