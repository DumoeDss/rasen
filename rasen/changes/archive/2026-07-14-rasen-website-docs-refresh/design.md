## Context

The `docs/` tree (≈35 markdown files plus `zh/`, `stores-beta/`, `codex-parity/`) was inherited from upstream OpenSpec and only partially rebranded: `installation.md` already says `@atelierai/rasen`, but `README.md`, `overview.md`, and `getting-started.md` still introduce the product as "OpenSpec", and getting-started's install line is `npm install -g @fission-ai/openspec@latest` — an actively wrong command. The upcoming static website (portfolio siblings `rasen-website-landing` → `rasen-website-docs`) will render a curated subset of these files, so accuracy and a declared publication set are prerequisites. The fumadocs app's `website/docs.sync.config.mjs` already encodes a good curation (sections: Start here / Understand it / Guides / Reference) and is the ordering reference. Write-set is strictly `docs/**` + optionally `README.md`, keeping this change parallel-safe with the landing change.

## Goals / Non-Goals

**Goals:**
- Every self-reference in curated docs says rasen; every documented command exists in the shipped CLI.
- `overview.md`, `getting-started.md`, `installation.md` publication-ready.
- `docs/website-manifest.json` as the renderer contract.

**Non-Goals:**
- Touching `website/` (fumadocs) or the `rasen-site` repo.
- Rewriting prose style, restructuring the docs IA, or translating; `docs/zh/` is out of curation scope this pass (the manifest format can grow a `zh` variant later).
- Rebranding engineering notes (handoff logs, `brand-independence-status.md`, `codex-parity/`, design retrospectives) — they are historical records, not publication candidates.

## Decisions

**D1 — Curated set = manifest set.** The accuracy work is scoped to the files the manifest publishes (plus `README.md` at repo root because it is the GitHub front door and the landing page's copy source). This keeps the change honest and bounded: internal notes keep their history; anything published gets audited. The manifest is therefore written FIRST (task order), then used as the audit checklist.

**D2 — Manifest format: JSON, sections of pages.**

```json
{
  "$schema": "./website-manifest.schema.json",   // optional; omit if not shipping a schema
  "version": 1,
  "sections": [
    { "label": "Start here",
      "pages": [
        { "title": "Introduction", "slug": "index", "source": "README.md" },
        { "title": "Installation", "slug": "installation", "source": "installation.md" }
      ] }
  ]
}
```

JSON over YAML/MJS: the consumer is a Node build script in another repo (`JSON.parse`, no dependency, no code execution) and diff-reviewable. Structure mirrors `website/docs.sync.config.mjs` (label + ordered pages, source relative to `docs/`, slug for URL) minus fumadocs-specific fields (icons, folder meta). `version: 1` lets the renderer detect future shape changes. Curation seed: the fumadocs sections, minus anything that no longer earns publication (implementer judgment, e.g. migration-guide stays if accurate; opsx.md checked for current naming).

**D3 — Brand-pass mechanics.** `grep -n 'OpenSpec\|openspec\|@fission-ai'` per curated file, then classify each hit: (a) self-reference → rewrite to rasen; (b) upstream reference (lineage, coexistence, migrate source, MIT attribution) → keep, ensure framing says "upstream OpenSpec"; (c) literal `openspec/` path in a migration context → keep. No bulk sed — each occurrence is a judgment call, matching the "content accuracy over rewrites" mandate. The landing page copy in README.md is already rasen-branded; expected README delta is small or zero.

**D4 — CLI verification against `--help`, not memory.** For each curated doc, extract `rasen …` commands and flags and check against `node bin/rasen.js --help` and subcommand `--help` (current surface includes `init`, `update`, `migrate`, `list`, `view`, `archive`, `config`, `schema`, `store`, `doctor`, `context`, `workset`, `work`, `validate`, `show`, `feedback`, `completion`, `status`, `instructions`, `templates`, `schemas`, `new`, `pipeline`, `agent`). Slash commands checked against the shipped skill set (`/rasen:propose|explore|apply|sync|archive|new|ff|continue|verify|goal|auto|…`). Known upstream-era phrasing to catch: noun-group commands removed by the retire-noun-commands change (e.g. `rasen change …`/`rasen spec …` forms), and `rasen show`/`list` flag drift.

**D5 — Manifest slug/source conventions.** Slugs are lowercase kebab, unique, forward-slash for nesting (`reference/cli`); `source` is always forward-slash relative to `docs/` — consumers on Windows must translate with `path.join`, which the renderer child's spec already anticipates. `README.md` maps to slug `index`.

## Risks / Trade-offs

- [Grep-based audit misses prose-level staleness (correct commands, wrong story)] → the three landing-facing pages get a full read-through, not just a grep pass; other curated pages get grep + spot-read of command blocks.
- [Over-rebranding: erasing legitimate upstream credit] → classification rule (D3) with lineage/coexistence/migration/license as explicit keep-cases; review checks both directions.
- [Manifest curates a page that later proves stale] → accuracy pass runs over exactly the manifest set (D1), so inclusion implies audited; if a page can't be made accurate cheaply it is dropped from the manifest rather than published wrong.
- [Docs churn conflicts with the parallel landing change] → landing only READS `README.md`/docs; this change owns the writes. Landing copy pinned at its own build time; any divergence is cosmetic and resolved when the site next builds.
- [zh docs fall behind en] → explicitly out of scope; noted as a portfolio follow-up rather than half-done here.

## Open Questions

- Whether `opsx.md` / `opsx-workflow-guide.md` (upstream-command-named guides) belong in the publication set at all, or are superseded by rasen-named equivalents — implementer decides when auditing; default is exclude from manifest if they document surfaces rasen renamed.
- Whether to also ship a JSON Schema for the manifest — nice-to-have; skip unless trivial.
