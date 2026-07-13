# website-scaffold Specification

## ADDED Requirements

### Requirement: Standalone site repository
The rasen website SHALL live in its own repository at the `rasen-site` directory, a sibling of the rasen repo, initialized as an independent git repository. The rasen repo itself MUST NOT gain any site implementation files from this capability.

#### Scenario: Repository created as a sibling
- **WHEN** the site scaffold is set up
- **THEN** a `rasen-site` directory exists alongside the rasen repo, contains its own `.git`, and has an initial commit
- **AND** the rasen repo's working tree contains no site source files (planning artifacts under `rasen/changes/` excepted)

#### Scenario: Build output is not committed
- **WHEN** the site is built locally
- **THEN** generated output (the `dist` directory) and `node_modules` are ignored by the repository's `.gitignore`

### Requirement: Static build pipeline
The site SHALL be produced by a Node build script (invoked via `npm run build` / `pnpm build`) that assembles the complete static site into a `dist` directory, with no framework runtime. Running the build on a fresh clone after installing dev dependencies MUST succeed on macOS, Linux, and Windows (all internal paths resolved with `path.join`/`path.resolve`).

#### Scenario: Fresh build produces a complete site
- **WHEN** a user runs the install step followed by the build script in a fresh clone
- **THEN** `dist/` contains `index.html`, the site stylesheet, and all referenced local assets (fonts, favicon)
- **AND** the build exits with code 0 and no network access is required

#### Scenario: Build is idempotent
- **WHEN** the build script runs twice in a row
- **THEN** the second run succeeds and `dist/` reflects only the current source (no stale files from removed pages)

#### Scenario: Shared shell is reusable by future doc pages
- **WHEN** a later change adds markdown-rendered doc pages
- **THEN** it can reuse the site's shared HTML shell (head, header, footer, scanline overlay) and stylesheet without editing the landing page, because the shell and page content are separate source files consumed by the build script

### Requirement: Cloudflare Workers deploy-ready configuration
The repository SHALL include a wrangler configuration that serves the `dist` directory via Cloudflare Workers static assets, such that `npx wrangler deploy` from the repo root is the only step needed to publish once the user is authenticated. Actually deploying is the user's action, not part of the build.

#### Scenario: Deploy configuration is valid
- **WHEN** a user with Cloudflare credentials runs `npx wrangler deploy` after a build
- **THEN** wrangler accepts the configuration (project name, compatibility date, `assets` directory pointing at `dist`) without edits

#### Scenario: Local preview without deployment
- **WHEN** a user runs the local preview script (`wrangler dev`) or opens `dist/index.html` directly from the filesystem
- **THEN** the site renders fully — all asset references are relative or root-relative paths that both serving modes resolve
