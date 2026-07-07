# 安装

## 前提条件

- **Node.js 20.19.0 或更高版本** — 检查你的版本：`node --version`

## 包管理器

### npm

```bash
npm install -g @fission-ai/openspec@latest
```

### pnpm

```bash
pnpm add -g @fission-ai/openspec@latest
```

### yarn

```bash
yarn global add @fission-ai/openspec@latest
```

### bun

Bun 可以把 OpenSpec 全局安装，但 OpenSpec 目前运行在 Node.js 之上。
你仍然需要在 `PATH` 中可用、版本为 20.19.0 或更高的 Node.js。

```bash
bun add -g @fission-ai/openspec@latest
```

## Nix

无需安装，直接运行 OpenSpec：

```bash
nix run github:Fission-AI/OpenSpec -- init
```

或安装到你的 profile：

```bash
nix profile install github:Fission-AI/OpenSpec
```

或在 `flake.nix` 里把它加进你的开发环境：

```nix
{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    openspec.url = "github:Fission-AI/OpenSpec";
  };

  outputs = { nixpkgs, openspec, ... }: {
    devShells.x86_64-linux.default = nixpkgs.legacyPackages.x86_64-linux.mkShell {
      buildInputs = [ openspec.packages.x86_64-linux.default ];
    };
  };
}
```

## 验证安装

```bash
openspec --version
```

## 更新

先升级包，再刷新每个项目的生成文件：

```bash
npm install -g @fission-ai/openspec@latest   # 或 pnpm/yarn/bun 的等价命令
openspec update                              # 在每个项目内运行
```

`openspec update` 会为你已配置的工具重新生成 skill 和命令文件，让你的斜杠命令与所安装的版本保持一致。

## 卸载

没有 `openspec uninstall` 命令，因为 OpenSpec 不过是一个全局包，外加你项目里的若干文件。移除它只需几个手动步骤，并且这些步骤都不会触碰你的源代码。

**1. 移除全局包：**

```bash
npm uninstall -g @fission-ai/openspec   # 或：pnpm rm -g / yarn global remove / bun rm -g
```

**2. 从某个项目中移除 OpenSpec（可选）。** 如果你不再需要它的规范和变更，删除 `openspec/` 目录：

```bash
rm -rf openspec/
```

动手前先想一想：`openspec/specs/` 和 `openspec/changes/archive/` 是你关于“系统如何运作”以及“它为什么改变”的记录。如果你可能还想要这份历史，那就在卸载之后也保留这个文件夹（或把���留在 git 里）。

**3. 移除生成的 AI 工具文件（可选）。** OpenSpec 会把 skill 和命令文件写入各工具各自的目录，例如 `.claude/skills/openspec-*/`、`.cursor/commands/opsx-*` 等等。为你配置过的那些工具，删除 `openspec-*` 的 skill 和 `opsx-*` 的命令即可。每个工具对应的确切路径见 [支持的工具](supported-tools.md)。

如果你在 `CLAUDE.md` 或 `AGENTS.md` 这类文件里还有 OpenSpec 的标记块（marker block），请手动移除那些块；那些文件中属于你自己的内容，仍然归你保留。

## 后续步骤

安装完成后，在你的项目里初始化 OpenSpec：

```bash
cd your-project
openspec init
```

完整演练请参阅 [快速入门](getting-started.md)。
