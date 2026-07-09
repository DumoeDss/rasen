# Local Install (Project-Level)

Unlike a global install, a local install adds OpenSpec as a project dependency, so everyone on the team uses the same version.

## Prerequisites

- **Node.js 20.19.0+** — `node --version`
- The project already has a `package.json` (if not, run `npm init -y` first)

## Install from the npm registry

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

After installing, the `openspec` command lives at `node_modules/.bin/openspec`.

## Install from a local folder (development mode)

Use this when you have cloned the OpenSpec source locally and want to use a development build in another project.

### Option 1: pnpm link (recommended)

```bash
# 1. Build in the OpenSpec source directory
cd /path/to/OpenSpec
pnpm install
pnpm build

# 2. Link it in the target project
cd /path/to/your-project
pnpm link /path/to/OpenSpec
```

To unlink:

```bash
pnpm unlink rasen
```

### Option 2: npm link

```bash
# 1. Register a global link in the OpenSpec source directory
cd /path/to/OpenSpec
npm link

# 2. Use the link in the target project
cd /path/to/your-project
npm link rasen
```

To unlink:

```bash
cd /path/to/your-project
npm unlink rasen

cd /path/to/OpenSpec
npm unlink
```

### Option 3: Point directly at a local path

```bash
# npm
npm install --save-dev /path/to/OpenSpec

# pnpm (use the file: protocol)
pnpm add -D "file:/path/to/OpenSpec"
```

> **Note**: This copies files rather than creating a symlink. You must reinstall after each change to the OpenSpec source.

### Option 4: Install a packed tarball (.tgz)

```bash
# 1. Pack in the OpenSpec source directory
cd /path/to/OpenSpec
pnpm pack
# Produces fission-ai-openspec-x.x.x.tgz

# 2. Install it in the target project
cd /path/to/your-project
npm install --save-dev /path/to/OpenSpec/fission-ai-openspec-x.x.x.tgz
```

## Run a locally installed openspec

A local install does not add `openspec` to your system PATH. Run it via:

### npx / pnpx (recommended)

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

Adding a script to `package.json` is the cleanest approach:

```json
{
  "scripts": {
    "openspec": "openspec",
    "openspec:init": "rasen init",
    "openspec:status": "rasen status"
  }
}
```

Then run:

```bash
npm run rasen -- init
pnpm openspec:init
```

### Call node_modules/.bin directly

```bash
./node_modules/.bin/openspec --version
```

On Windows:

```bash
.\node_modules\.bin\rasen --version
```

## Verify the install

```bash
npx rasen --version
```

## Initialize the project

```bash
npx rasen init
```

Follow the interactive prompts to choose an AI tool and configuration. See [Getting Started](getting-started.md).

## Local vs global install

| | Local install | Global install |
|---|---|---|
| Scope | Current project only | All projects |
| Version pinning | Pinned in `package.json` | A single system-wide version |
| Team collaboration | Team members get it via `npm install` | Each person installs manually |
| How to run | `npx openspec` / `pnpm exec openspec` | `openspec` directly |
| CI/CD | Available automatically | Requires an extra install step |
| Recommended for | Team projects, CI/CD | Quick personal use |

## FAQ

### Q: After linking, I changed the OpenSpec source — do I need to re-link?

No. `pnpm link` / `npm link` create a symlink; after changing the source you only need to rebuild:

```bash
cd /path/to/OpenSpec
pnpm build
```

### Q: My project has both a global and a local install — which takes precedence?

`npx openspec` or `pnpm exec openspec` use the local version. Running `openspec` directly uses the global version.

### Q: How do I use it in CI?

A local install is the recommended approach for CI. `npm ci` or `pnpm install --frozen-lockfile` installs dependencies automatically:

```yaml
# GitHub Actions example
steps:
  - uses: actions/checkout@v4
  - uses: actions/setup-node@v4
    with:
      node-version: '20'
  - run: pnpm install --frozen-lockfile
  - run: npx rasen status
```
