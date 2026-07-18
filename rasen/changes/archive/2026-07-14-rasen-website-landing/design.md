## Context

Rasen (v0.1.3, npm `@atelierai/rasen`) has no deployed website. The LEAD has fixed the major choices: new sibling repo `/Users/sayo/repos/rasen-site`, Cloudflare Workers static assets, lightweight static stack (HTML/CSS/vanilla JS + Node build script), and the brutalist-CRT visual system from the `html-ppt-taste-brutalist` reference skill (adapted from a 16:9 deck to a scrolling page). The in-repo `website/` fumadocs app is IA/copy reference only. A follow-up child (`rasen-website-docs`) will extend this scaffold with markdown-rendered doc pages; a parallel sibling (`rasen-website-docs-refresh`) curates the doc content in the rasen repo.

## Goals / Non-Goals

**Goals:**
- Deploy-ready static site repo: `pnpm build` → `dist/` → `npx wrangler deploy`.
- A landing page that passes the CRT-system pre-flight and reads as tech-dense and honest.
- A build/source layout the docs child can extend without reworking the landing page.

**Non-Goals:**
- Actually deploying (user-side Cloudflare auth), custom domain wiring, analytics.
- Docs rendering (owned by `rasen-website-docs`) and doc content edits (owned by `rasen-website-docs-refresh`).
- SEO beyond basic meta/OG tags; zh localization of the landing page (may come later).

## Decisions

**D1 — Repo layout (seam for the docs child).** Source under `src/`, output to `dist/`, build logic in `build.mjs`:

```
rasen-site/
├── package.json          # private, "type": "module"; scripts: build, dev (wrangler dev), preview
├── wrangler.jsonc        # { name: "rasen-site", assets: { directory: "./dist" }, compatibility_date }
├── .gitignore            # dist/, node_modules/
├── build.mjs             # assembles dist/: renders pages through the shell, copies assets
├── src/
│   ├── shell.mjs         # renderPage({title, content, ...}) → full HTML doc (head, header, footer, scanline)
│   ├── pages/landing.mjs # exports the landing page's body HTML
│   ├── styles/site.css   # the whole design system (custom properties + components)
│   └── assets/           # fonts/ (woff2), favicon.svg
```
`shell.mjs` + `site.css` are the shared contract: the docs child adds `src/pages/docs*.…` and a markdown step in `build.mjs` without touching `landing.mjs`. Pages as JS template modules (not raw HTML files) keeps the shell single-sourced with zero templating dependency. Alternative considered: plain `index.html` with no shell abstraction — simpler today but forces the docs child to fork the header/footer/overlay markup.

**D2 — Wrangler config with assets-only Worker.** `wrangler.jsonc` with an `assets.directory` binding and no Worker script — pure static serving, free-tier friendly, `wrangler dev` for local preview. Alternative: Cloudflare Pages — rejected by LEAD decision (Workers static assets is the current recommended path). `wrangler` is a devDependency so `npx wrangler` resolves locally and the config is validated by `wrangler dev` during implementation.

**D3 — Fonts self-hosted with system fallback.** Ship woff2 subsets only if license-clean copies are trivially available locally; otherwise ship no font files and rely on stacks `ui-monospace, 'JetBrains Mono', 'SF Mono', Menlo, Consolas, monospace` (body) and `'Archivo Black', 'Arial Black', 'Helvetica Neue', sans-serif` with `font-weight: 900` (titles). The spec requires offline correctness, not specific files — the fallback stack alone satisfies it. No Google Fonts/CDN links ever.

**D4 — Page anatomy (deck archetypes → scrolling sections).** In order: (1) hero/cover — giant call-sign "RASEN" specimen type, blinking caret `▌`, mono meta column (version, license, node requirement) with the optional single green status dot; (2) briefing strip — mono register cells (npm name, version from build, license, upstream lineage); (3) spiral thesis — numbered `>>>` theses (spec origin / loop form / ascent / breakthrough) with the 「不是循环，是螺旋」 line; (4) telemetry grid — feature modules (workflow, pipelines, auto, goal, decompose, chrome-use, handoff) as 1px-gap cells; (5) terminal transcript — the README "see it in action" session as a styled mono block; (6) hazard-stripe install alert — `npm i -g @atelierai/rasen` + `rasen init`; (7) coexistence table (OpenSpec vs rasen namespaces, hairline table); (8) colophon footer — operator/system/build/license/GitHub link. Version injected by `build.mjs` reading `../rasen/package.json` when present, else a pinned constant (build must not fail outside the sibling checkout).

**D5 — CSS is one hand-written file, custom properties at the top** (`--bg0/--bg1/--fg/--fg2/--line/--red/--green`), mobile-first, grid collapse via `repeat(auto-fit, minmax(240px, 1fr))`. No preprocessor, no reset dependency beyond a few lines. Scanline overlay as a `body::after` fixed element (pointer-events: none) rather than an extra DOM node.

**D6 — Vanilla JS budget ≈ zero.** Caret blink and dot pulse are CSS keyframes (opacity steps — mechanical, allowed as the two sanctioned motions). Optional copy-to-clipboard button on the install block is the only script, inline and dependency-free; page must be fully functional without it.

## Risks / Trade-offs

- [Deploy config can't be fully proven without Cloudflare auth] → validate via `wrangler dev` locally + config lint (`wrangler deploy --dry-run` if available in the installed version); document the one-command deploy in the site README.
- [Design-by-checklist can still look bad] → the reference `example.html` is the taste anchor; implementer should keep density high (register strips, tabular numbers) and run the SKILL.md pre-flight literally before calling a task done.
- [Version drift between site and npm] → version is read from the sibling repo's package.json at build time; a stale pinned fallback only appears when built away from the monorepo layout, and the colophon labels it as build-time value.
- [Docs child assumptions] → the only promised interface is `renderPage()` in `shell.mjs` + `site.css` class vocabulary; keep both small and documented in the site README so C2's extension is additive.
- [Windows builds] → `build.mjs` uses `node:path`/`node:url` throughout; no shell-specific commands in npm scripts (plain `node build.mjs`).

## Open Questions

- Custom domain (e.g. rasen.io) mapping — user-side, post-deploy; config keeps the default `workers.dev` route.
- Whether to ship real woff2 font files or rely on the fallback stack (D3 makes either spec-compliant; implementer decides by what's license-clean locally).
