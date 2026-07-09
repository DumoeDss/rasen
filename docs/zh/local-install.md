# 本地安装 (项目级安装)

与全局安装不同，本地安装将 OpenSpec 作为项目依赖，确保团队成员使用相同版本。

## 前置条件

- **Node.js 20.19.0+** — `node --version`
- 项目已初始化 `package.json`（若没有，先运行 `npm init -y`）

## 从 npm 注册表安装

### npm

```bash
npm install --save-dev rasen
```

### pnpm

```bash
pnpm add -D rasen
```

### yarn

```bash
yarn add -D rasen
```

### bun

```bash
bun add -D rasen
```

安装后，`openspec` 命令位于 `node_modules/.bin/openspec`。

## 从本地文件夹安装（开发模式）

适用于你本地克隆了 OpenSpec 源码，希望在另一个项目中使用开发版本。

### 方式一：pnpm link（推荐）

```bash
# 1. 在 OpenSpec 源码目录构建
cd /path/to/OpenSpec
pnpm install
pnpm build

# 2. 在目标项目中链接
cd /path/to/your-project
pnpm link /path/to/OpenSpec
```

取消链接：

```bash
pnpm unlink rasen
```

### 方式二：npm link

```bash
# 1. 在 OpenSpec 源码目录注册全局链接
cd /path/to/OpenSpec
npm link

# 2. 在目标项目中使用链接
cd /path/to/your-project
npm link rasen
```

取消链接：

```bash
cd /path/to/your-project
npm unlink rasen

cd /path/to/OpenSpec
npm unlink
```

### 方式三：直接引用本地路径

```bash
# npm
npm install --save-dev /path/to/OpenSpec

# pnpm (使用 file: 协议)
pnpm add -D "file:/path/to/OpenSpec"
```

> **注意**：此方式会复制文件而非创建符号链接。每次修改 OpenSpec 源码后需要重新安装。

### 方式四：打包后安装 (.tgz)

```bash
# 1. 在 OpenSpec 源码目录打包
cd /path/to/OpenSpec
pnpm pack
# 生成 fission-ai-openspec-x.x.x.tgz

# 2. 在目标项目中安装
cd /path/to/your-project
npm install --save-dev /path/to/OpenSpec/fission-ai-openspec-x.x.x.tgz
```

## 运行本地安装的 openspec

本地安装不会将 `openspec` 添加到系统 PATH。使用以下方式运行：

### npx / pnpx（推荐）

```bash
npx rasen --version
npx rasen init
npx rasen status
```

### pnpm exec

```bash
pnpm exec rasen --version
pnpm exec rasen init
```

### yarn exec

```bash
yarn rasen --version
yarn rasen init
```

### package.json scripts

在 `package.json` 中添加脚本是最简洁的方式：

```json
{
  "scripts": {
    "openspec": "openspec",
    "openspec:init": "rasen init",
    "openspec:status": "rasen status"
  }
}
```

然后运行：

```bash
npm run rasen -- init
pnpm openspec:init
```

### 直接调用 node_modules/.bin

```bash
./node_modules/.bin/openspec --version
```

Windows 下：

```bash
.\node_modules\.bin\rasen --version
```

## 验证安装

```bash
npx rasen --version
```

## 初始化项目

```bash
npx rasen init
```

按照交互式提示选择 AI 工具和配置。详见 [Getting Started](getting-started.md)。

## 本地安装 vs 全局安装

| | 本地安装 | 全局安装 |
|---|---|---|
| 作用范围 | 仅当前项目 | 所有项目 |
| 版本锁定 | 锁定在 `package.json` | 系统级单一版本 |
| 团队协作 | 团队成员 `npm install` 自动获取 | 需要每人手动安装 |
| 运行方式 | `npx openspec` / `pnpm exec openspec` | 直接 `openspec` |
| CI/CD | 自动可用 | 需要额外安装步骤 |
| 推荐场景 | 团队项目、CI/CD | 个人快速使用 |

## 常见问题

### Q: link 之后修改了 OpenSpec 源码，需要重新 link 吗？

不需要。`pnpm link` / `npm link` 创建的是符号链接，修改源码后只需重新构建：

```bash
cd /path/to/OpenSpec
pnpm build
```

### Q: 项目中同时有全局和本地安装，哪个优先？

使用 `npx openspec` 或 `pnpm exec openspec` 时优先使用本地版本。直接运行 `openspec` 时使用全局版本。

### Q: CI 环境中如何使用？

本地安装是 CI 的推荐方式。`npm ci` 或 `pnpm install --frozen-lockfile` 会自动安装依赖：

```yaml
# GitHub Actions 示例
steps:
  - uses: actions/checkout@v4
  - uses: actions/setup-node@v4
    with:
      node-version: '20'
  - run: pnpm install --frozen-lockfile
  - run: npx rasen status
```
