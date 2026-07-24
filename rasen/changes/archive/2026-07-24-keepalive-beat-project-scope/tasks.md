# Tasks

## 1. Core config plumbing
- [x] 1.1 `src/core/config-keys.ts`: `keepalive.beatSeconds` scopes `['global']` → `['global', 'project']`
- [x] 1.2 `src/core/project-config.ts`: `ProjectConfigSchema` 加 keepalive 块(镜像 GlobalConfigSchema 结构;runtimes/contextFloor 仅前向兼容,project 不可 set)

## 2. Tests
- [x] 2.1 `test/core/config-keys.test.ts`: scope 断言改 global+project;count 分类(globalOnly 9→8, globalProject 2→3, globalProject keys 含 keepalive.beatSeconds);加 ProjectConfigSchema round-trip
- [x] 2.2 config-keys + effective-config 全绿(96/96)

## 3. Verification
- [x] 3.1 pnpm vitest run test/core/config-keys.test.ts test/core/effective-config.test.ts — 96 passed
- [x] 3.2 ship: pathspec commit 92c2f055(config-keys.ts, project-config.ts, config-keys.test.ts + change dir);UI/i18n/style.css excluded(留给并行 ui-i18n change)
- [x] 3.3 fix delta spec(标题对齐 main "Keepalive keys are registered" + 保留 5 旧场景 + 4 新场景)并 amend 进 ship commit
