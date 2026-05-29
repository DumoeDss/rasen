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

或在 `flake.nix` 中添加到你的开发环境：

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

## 后续步骤

安装完成后，在你的项目中初始化 OpenSpec：

```bash
cd your-project
openspec init
```

参阅[快速入门](getting-started.md)获取完整的操作指南。
