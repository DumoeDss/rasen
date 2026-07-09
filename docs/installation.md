# Installation

## Prerequisites

- **Node.js 20.19.0 or higher** — Check your version: `node --version`

## Package Managers

### npm

```bash
npm install -g rasen@latest
```

### pnpm

```bash
pnpm add -g rasen@latest
```

### yarn

```bash
yarn global add rasen@latest
```

### bun

Bun can install rasen globally, but rasen currently runs on Node.js.
You still need Node.js 20.19.0 or higher available on `PATH`.

```bash
bun add -g rasen@latest
```

## Nix

Run rasen directly without installation:

```bash
nix run github:DumoeDss/rasen -- init
```

Or install to your profile:

```bash
nix profile install github:DumoeDss/rasen
```

Or add to your development environment in `flake.nix`:

```nix
{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    rasen.url = "github:DumoeDss/rasen";
  };

  outputs = { nixpkgs, rasen, ... }: {
    devShells.x86_64-linux.default = nixpkgs.legacyPackages.x86_64-linux.mkShell {
      buildInputs = [ rasen.packages.x86_64-linux.default ];
    };
  };
}
```

## Verify Installation

```bash
rasen --version
```

## Updating

Upgrade the package, then refresh each project's generated files:

```bash
npm install -g rasen@latest   # or pnpm/yarn/bun equivalent
rasen update                  # run inside each project
```

`rasen update` regenerates the skill and command files for the tools you've configured, so your slash commands stay current with the installed version.

## Uninstalling

There's no `rasen uninstall` command, because rasen is just a global package plus some files in your project. Removing it is a few manual steps, and nothing here touches your source code.

**1. Remove the global package:**

```bash
npm uninstall -g rasen   # or: pnpm rm -g / yarn global remove / bun rm -g
```

**2. Remove rasen from a project (optional).** Delete the `rasen/` directory if you no longer want its specs and changes:

```bash
rm -rf rasen/
```

Think before you do this: `rasen/specs/` and `rasen/changes/archive/` are your record of how the system behaves and why it changed. If you might want that history, keep the folder (or keep it in git) even after uninstalling.

**3. Remove generated AI tool files (optional).** rasen writes skill and command files into per-tool directories like `.claude/skills/rasen-*/`, `.claude/commands/rasen/`, and `.cursor/commands/rasen-*`. Delete the `rasen-*` skills and `rasen` commands for whichever tools you configured. The exact paths per tool are listed in [Supported Tools](supported-tools.md).

If you also have rasen marker blocks in files like `CLAUDE.md` or `AGENTS.md`, remove those blocks by hand; your own content in those files is yours to keep.

## Next Steps

After installing, initialize rasen in your project:

```bash
cd your-project
rasen init
```

See [Getting Started](getting-started.md) for a full walkthrough.
