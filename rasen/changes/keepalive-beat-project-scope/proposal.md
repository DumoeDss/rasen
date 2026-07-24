# keepalive.beatSeconds 加 project scope

## Why

`keepalive.beatSeconds`(keepalive-beat-config,已 ship)注册为 global-only,与同��� `runtimes`/`contextFloor` 一致——它们是机器级运行时参数。但实测发现不同项目对 beat 时长有不同诉求(重型项目倾向更长的经济档),用户要求支持 per-project 覆盖。project scope 覆盖 global 的机制与既有 `handoff`/`profile`/`workflows` 完全相同(effective-config deep merge),不引入新解析路径。

`runtimes`/`contextFloor` 保持 global-only——它们是机器级 gate(哪个 runtime 能 park、多小上下文不保温),per-project 无��义;只有 `beatSeconds`(经济调优)值得 project 化。

## What Changes

- **config-keys.ts**:`keepalive.beatSeconds` scopes `['global']` → `['global', 'project']`。store 仍不可用(与 runtimes/contextFloor 一致,机器级键不经 store)。
- **project-config.ts**:`ProjectConfigSchema` 加 `keepalive` 块(镜像 `GlobalConfigSchema` 结构:runtimes + contextFloor + beatSeconds,均 optional)。runtimes/contextFloor 在 project schema 接��仅为前向兼容,registry 不让它们在 project set;实际 project config 只会存 beatSeconds。
- **测试**:scope 断言(project valid)、count 分类调整(globalOnly 9→8、globalProject 2→3)、ProjectConfigSchema round-trip。

## Impact

- Affected specs: config-key-registry(beatSeconds 的 scope requirement 从 global-only 改为 global+project)
- Affected code: src/core/config-keys.ts, src/core/project-config.ts, test/core/config-keys.test.ts
- 解析优先级不变(effective-config 已 deep-merge global+project 的 keepalive 块,beatSeconds project 值自然覆盖 global)
- 无 CLI locale 变动(description 键未改);无 UI 变动(UI 部分由并行 ui-i18n change 处理)
