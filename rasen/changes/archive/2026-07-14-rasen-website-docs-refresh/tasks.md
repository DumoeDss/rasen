# Tasks

## 1. Curate: the manifest first

- [x] 1.1 Inventory `docs/` and draft the publication set seeded from `website/docs.sync.config.mjs` sections (Start here / Understand it / Guides / Reference), excluding internal notes (handoff logs, design retrospectives, `codex-parity/`, brand-status) and deciding the `opsx.md`/`opsx-workflow-guide.md` question per design D2/D4
- [x] 1.2 Write `docs/website-manifest.json` (`version: 1`, sections → pages with title/slug/source per design D2/D5) and verify every `source` resolves to an existing file and slugs are unique
- [x] 1.3 Add a short "Website publication" note to `docs/README.md` (or a dedicated paragraph) pointing at the manifest as the interface the website build consumes

## 2. Accuracy pass over the curated set

- [x] 2.1 Brand audit: grep every curated file (plus root `README.md`) for `OpenSpec|openspec|@fission-ai`, classify each hit per design D3 (self-reference vs upstream reference vs migration path), and rewrite the self-references to rasen — starting with `docs/README.md`, `overview.md`, `getting-started.md` (fix the `@fission-ai/openspec` install line and the `openspec/` workspace tree)
- [x] 2.2 CLI verification: extract every `rasen …` command/flag from curated docs and check against `node bin/rasen.js --help` + subcommand help; fix or remove stale surfaces (watch for retired noun-group commands per design D4)
- [x] 2.3 Slash-command verification: check every `/rasen:*` mention in curated docs against the shipped skills/profile set, including profile claims in getting-started (core profile contents) — correct drift
- [x] 2.4 Full read-through polish of the three landing-facing pages (`overview.md`, `getting-started.md`, `installation.md`): coherent as public pages, Node ≥20.19.0 prerequisite, correct workspace trees, accurate archive paths
- [x] 2.5 Cross-link check across the curated set: every relative link resolves to an existing file; fix or drop dead links

## 3. Verify and close

- [x] 3.1 Re-run the brand grep over the curated set and confirm every remaining `openspec` occurrence is a documented keep-case (lineage/coexistence/migrate/attribution); spot-check that no upstream credit was erased
- [x] 3.2 Validate `docs/website-manifest.json` with a one-liner (`node -e "JSON.parse(...)"` + existence/uniqueness assertions) and confirm the manifest set equals the audited set (design D1)
- [x] 3.3 Confirm the change's write-set stayed within `docs/**` + `README.md` (`git status`); write-set verified clean — commit deferred to the shipper stage per portfolio delivery process
