# Planning Context — rasen-website portfolio

## User intent (verbatim, 2026-07-13)

> 为rasen创建一个官网（部署到cloudflare worker或pages），风格参考 /Users/sayo/repos/elftia_dev/dev-branch-1/elftia/resources/design-studio-builtin/design-templates/html-ppt-taste-brutalist，制作一个美观富有科技感的官网落地页（包含文档更新，这里可以参考website/的内容）！因此包含文档更新，落地页官网（含文档展示，这里是不是做成一个能够解析markdown文档来展示网页的功能）的制作。官网页的项目放到rasen项目上层新建目录。

## LEAD decisions & constraints (authoritative unless a child proposal overrides with reason)

- **Site location:** NEW directory `/Users/sayo/repos/rasen-site/` (sibling of the rasen repo), its own git repo (`git init`). NOT inside the rasen repo.
- **Deploy target:** Cloudflare Workers static assets (wrangler config with `assets` binding). Pure static output — `npx wrangler deploy` ready. Do NOT require deployment to succeed in-pipeline (auth is user-side); deliverable = deploy-ready config + local preview verified (`wrangler dev` or file open).
- **Stack:** lightweight static — HTML/CSS/vanilla JS + a Node build script (`marked` or `markdown-it`) that renders markdown docs into HTML pages sharing the site shell. NO heavy framework (no Next.js — the existing `rasen/website/` fumadocs site is a CONTENT/IA reference only, not the tech base).
- **Visual system (from the brutalist-CRT reference SKILL.md, adapted from 16:9 deck to a scrolling website):**
  - Substrate charcoal `#0A0A0A`/`#121212` (never pure black); foreground phosphor `#EAEAEA`, secondary `#9A9A98`; ONE accent hazard red `#E61919`; optional single terminal-green `#4AF626` element (e.g. one status dot).
  - Monospace body (JetBrains Mono / IBM Plex Mono); heavy grotesque (Archivo Black / Inter Black) for titles only; title scale `clamp(56px,7vw,96px)`, uppercase, tracking -0.04em.
  - `border-radius: 0` everywhere; 1px hairlines `#2A2A28`; `display:grid; gap:1px` telemetry-grid modules; fixed scanline overlay (repeating-linear-gradient 2px/4px, opacity ≤0.08, pointer-events-none).
  - ASCII decoration (`[ ... ]`, `>>>`, `///`) ≥4 places; diagonal hazard-stripe alert block; tabular-nums for numbers.
  - Banned: shadows, gradients (except scanline/hazard stripes), glassmorphism, glow, emoji, stock imagery, light-mode sections, border-radius > 0.
  - Fonts must be self-hostable or system-fallback safe (site must render offline; prefer @font-face with local files or a mono system stack fallback).
- **Docs rendering:** build-time — a script reads `rasen/docs/*.md` (curated subset; en first, zh under `/zh/` if cheap) and emits HTML doc pages with a sidebar nav, styled in the same CRT shell. Content source of truth stays in the rasen repo; the site build copies/renders it.
- **Content reference:** `rasen/website/` (fumadocs) for IA/copy ideas; `README.md`, `docs/overview.md`, `docs/getting-started.md` for landing copy. Brand: **rasen** (螺旋 — "loops that ascend"), npm `@atelierai/rasen`, GitHub repo is this fork. Current version 0.1.3 (read package.json; never invent versions).
- **Models:** planner/reviewer = fable; implementer/fixer/shipper + docs writing = sonnet (user directive).
- **Delivery:** children ship LOCAL (commit only, in their respective repos: rasen-site repo for C1/C2, rasen repo for C3). ONE portfolio-level delivery decision at the end.

## Decomposition & dependency rationale

- **C1 `rasen-website-landing`** — scaffold rasen-site repo + landing page + wrangler deploy config. Foundation slice.
- **C2 `rasen-website-docs`** — markdown→HTML docs pipeline + docs section pages + nav. Depends on C1 (consumes its shell/CSS/build layout).
- **C3 `rasen-website-docs-refresh`** — update/curate `rasen/docs/` content in the rasen repo (accuracy vs current CLI, brand consistency, landing-facing copy polish). Touches ONLY rasen/docs (+ possibly README): no overlap with C1/C2 write-sets → runs PARALLEL with C1.
- DAG: C1 → C2; C3 independent. C2 reads docs content but writes only in rasen-site — read-dependency, not a write conflict; C2 should tolerate arbitrary valid markdown so C3's edits can't break it.

## Durable findings log (planner appends)

- **C1/C2 seam pinned (landing design D1):** rasen-site layout is `build.mjs` + `src/shell.mjs` (`renderPage()`) + `src/pages/*.mjs` + `src/styles/site.css` + `src/assets/`; the docs child (C2) extends by adding page modules and a markdown step in `build.mjs` — it must NOT edit `landing.mjs`. `wrangler.jsonc` is assets-only (no Worker script), `assets.directory: "./dist"`.
- **C3→C2 interface pinned:** `docs/website-manifest.json` — `{version: 1, sections: [{label, pages: [{title, slug, source}]}]}`; `source` relative to `docs/` with forward slashes, slugs unique kebab, `README.md` → slug `index`. JSON (not YAML/MJS) so C2 consumes it with bare `JSON.parse`. Curation seeded from `website/docs.sync.config.mjs` (Start here / Understand it / Guides / Reference).
- **Docs staleness confirmed (grounded, not assumed):** `docs/getting-started.md` still installs `@fission-ai/openspec@latest` and shows an `openspec/` workspace tree; `docs/README.md` + `overview.md` introduce the product as "OpenSpec". `installation.md` is already correctly `@atelierai/rasen`. ~30 docs files contain `openspec` hits — many are legitimate lineage/coexistence/migrate keep-cases, so the refresh classifies per-hit (no bulk sed).
- **Version policy in both proposals:** current version 0.1.3; site build reads the sibling rasen `package.json` at build time with a pinned fallback — never hand-invented (user's version-discipline directive respected).
- **Fonts:** landing spec requires offline correctness, not specific font files — system-stack fallback alone is compliant (design D3), so no font-licensing blocker exists for C1.
- **Open question left to C2/C3 implementers:** whether `opsx.md`/`opsx-workflow-guide.md` enter the publication manifest (default: exclude if they document renamed surfaces); zh docs explicitly out of C3 scope.
- **C2 proposed (renderer child):** capabilities `website-docs-rendering` + `website-docs-navigation`. Renderer = `marked` (devDependency, GFM, renderer hook for link rewriting). Output convention `dist/docs/<slug>/index.html` with ROOT-RELATIVE hrefs — docs pages preview via `wrangler dev`, not `file://` (accepted trade-off; landing page keeps file-open support). Manifest resolved at `../rasen/docs/website-manifest.json`, env-overridable `RASEN_DOCS_DIR`, with a checked-in `src/docs-manifest.dev.json` dev fallback so C2 is implementable before C3 lands.
- **C2 parallel-safety rule (binding on its implementer):** reconcile against the ACTUAL rasen-site tree at apply time; extend `shell.mjs` only additively (optional args, landing output byte-identical); never edit `landing.mjs`; landing↔docs nav goes in the shell's header register strip. If the seam is fundamentally absent, escalate to the LEAD instead of refactoring landing code.
- **Fault-tolerance contract pinned in C2 specs:** valid-markdown edits can never break the build; missing manifest source = warn + skip (exit 0, nav chain closes over gap); only a malformed manifest (bad JSON, missing fields, dup slug, version ≠ 1) fails the build, loudly.
