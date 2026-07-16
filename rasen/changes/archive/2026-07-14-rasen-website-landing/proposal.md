## Why

Rasen has no public website: the npm package (`@atelierai/rasen`), GitHub README, and docs are the only surfaces, and the in-repo `website/` fumadocs app was inherited from upstream and is not deployed anywhere under the rasen brand. A standalone landing site gives the project a front door — what rasen is, why "loops that ascend", and how to install — with a distinctive visual identity (brutalist CRT-terminal) instead of a generic docs-framework default.

## What Changes

- Create a NEW standalone static-site repository at `/Users/sayo/repos/rasen-site` (sibling of this repo, its own `git init`) — the rasen repo itself gains nothing except this change's planning artifacts.
- Scaffold the site project: `package.json` (private, ESM), a Node build script skeleton (`build.mjs`) that assembles static output into `dist/`, and a `wrangler` config using Cloudflare Workers **static assets** so the site is `npx wrangler deploy`-ready. No heavy framework — HTML/CSS/vanilla JS only; the existing `rasen/website/` fumadocs app is a content/IA reference, not a tech base.
- Build the landing page (`index.html` via the build script) in the brutalist-CRT visual system: charcoal substrate, phosphor monospace, single hazard-red accent, hairline telemetry grids, scanline overlay, ASCII decoration, one hazard-stripe install/alert block, specimen-scale hero typography with a blinking caret, footer colophon.
- All landing copy is sourced from the real README/docs (spiral thesis, pipeline family, `/rasen:auto`, `/rasen:goal`, chrome-use, context handoff, coexistence with OpenSpec, telemetry honesty). No lorem ipsum, no invented features, versions, or metrics; the version shown is read from this repo's `package.json` at build time or pinned to the current published value.
- Self-contained at runtime: no CDN dependencies; fonts are self-hosted via `@font-face` or fall back to a system monospace stack. Responsive from mobile to desktop.
- Deployment itself is out of scope (Cloudflare auth is user-side); the deliverable is a deploy-ready config plus a locally verified build (`wrangler dev` or opening `dist/index.html`).
- The build layout leaves an explicit seam for the follow-up docs child (`rasen-website-docs`): shared CSS/shell separated from page content so markdown-rendered doc pages can reuse them.

## Capabilities

### New Capabilities
- `website-scaffold`: the rasen-site repository structure — its own git repo, package manifest, Node build pipeline producing a static `dist/`, and a Cloudflare Workers static-assets deploy configuration that works without in-pipeline deployment.
- `website-landing`: the landing page itself — content sourced from real rasen docs, the brutalist-CRT visual system contract (palette, typography, geometry, required motifs, banned effects), responsiveness, and runtime self-containment.

### Modified Capabilities

None — no existing rasen capability's requirements change; all implementation lands in the new sibling repository.

## Impact

- **New repo:** `/Users/sayo/repos/rasen-site/` (created by this change; all site code lives there).
- **This repo:** read-only source for copy (`README.md`, `docs/overview.md`, `docs/getting-started.md`, `package.json` version) and for these planning artifacts; no product code touched.
- **Dependencies:** dev-only in rasen-site (`wrangler` for deploy/preview; a markdown renderer such as `marked` is anticipated by the build skeleton but only exercised by the later docs child). Zero runtime JS dependencies on the page beyond trivial inline vanilla JS.
- **Downstream:** child change `rasen-website-docs` will extend this scaffold's build script and shell; sibling change `rasen-website-docs-refresh` curates the markdown this site will later render — neither is blocked by nor blocks this page's copy.
- **Delivery:** ships LOCAL (commits in the rasen-site repo); the portfolio makes one delivery decision at the end.
