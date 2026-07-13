## Why

The `docs/` tree is about to become the content source for the public rasen website (rendered by the upcoming `rasen-website-docs` child), but much of it still reads as OpenSpec documentation: `docs/README.md` introduces "OpenSpec", `getting-started.md` tells users to `npm install -g @fission-ai/openspec@latest` and shows an `openspec/` workspace tree, and self-references to the product as "OpenSpec" are scattered across the user-facing guides. Publishing that verbatim would misname the product and give readers a broken install path. The website also needs a declared, ordered subset of docs to publish — today that curation exists only in the fumadocs app's `website/docs.sync.config.mjs`, which the new static site does not read.

## What Changes

- Fix staleness and brand consistency across the user-facing docs in `docs/` (and `README.md` if needed): the product is **rasen**; install is `npm i -g @atelierai/rasen`; the workspace is `rasen/`; commands are `rasen …` / `/rasen:*`. Legitimate references to upstream OpenSpec (lineage, coexistence table, `rasen migrate`, license attribution) are kept and clearly framed as references to the upstream project, not self-references.
- Verify every CLI command and slash command mentioned in the curated docs against the current CLI (`rasen --help`, subcommand help, or `src/`); correct or remove anything the current build doesn't support. Content accuracy over rewrites — no wholesale restyling of prose that is already correct.
- Polish the three landing-facing pages (`overview.md`, `getting-started.md`, `installation.md`) since the website surfaces them most prominently.
- Add a docs manifest — `docs/website-manifest.json` — declaring the ordered, curated subset of docs the website publishes (per page: title, slug, source path relative to `docs/`, section grouping). This is the stable interface the future website docs renderer (`rasen-website-docs`) consumes; internal/engineering notes (handoff logs, design retrospectives, `codex-parity/`) are deliberately excluded from it.
- Scope guard: this change touches ONLY `docs/**` and (if needed) `README.md` in the rasen repo — it does not modify `website/` (fumadocs stays as-is) or the sibling `rasen-site` repo, so it can run in parallel with the landing-page change with zero write-set overlap.

## Capabilities

### New Capabilities
- `docs-content-accuracy`: user-facing docs describe the current product truthfully — rasen branding for self-references (upstream OpenSpec mentioned only as lineage/coexistence), install/workspace/command surfaces that match the shipped CLI.
- `website-docs-manifest`: a machine-readable manifest in `docs/` declaring which docs the website publishes, in what order, with what titles and slugs — the contract between the docs tree and any site renderer.

### Modified Capabilities

None — no existing spec in `rasen/specs/` governs the human documentation content (`docs-agent-instructions` covers generated agent instruction files, which this change does not touch).

## Impact

- **Files:** `docs/*.md` user-facing guides (README, overview, getting-started, installation, how-commands-work, concepts, workflows, commands, cli, faq, troubleshooting, and peers), new `docs/website-manifest.json`; possibly `README.md`. Engineering notes in `docs/` (handoff logs, design docs, `codex-parity/`, `stores-beta/` internals) are out of curation scope and left untouched except for outright errors encountered in passing.
- **No code changes;** no test impact beyond any doc-lint CI if present.
- **Downstream:** `rasen-website-docs` (site renderer) will read `docs/website-manifest.json`; the renderer must tolerate arbitrary valid markdown, so nothing here blocks or is blocked by the site work. The fumadocs `website/docs.sync.config.mjs` curation serves as the reference ordering for the manifest but is not modified.
- **Delivery:** ships LOCAL (commit in the rasen repo); portfolio-level delivery decision at the end.
