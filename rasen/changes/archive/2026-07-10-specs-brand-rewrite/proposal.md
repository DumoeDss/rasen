## Why

The code fully rebranded from `openspec`/`opsx` to `rasen` (CHANGELOG 0.1.1), but the main specs under `rasen/specs/**` lag behind: 86 of 113 `spec.md` files still contain `openspec`/`opsx` tokens, and a large fraction of those assert stale facts about the product's own namespace — `openspec-<skill>` skill directories, `openspec <verb>` command invocations, `/opsx:*` slash commands, `openspec/` workspace paths, and "OpenSpec branding/CLI/structure" product prose — that the shipped code no longer produces. The specs are the source-of-truth contract; leaving them mixed-vocabulary makes them internally contradictory (e.g. `rasen-cli-identity` SHALL says examples use `rasen <verb>`, yet the CLI specs show `openspec <verb>`) and misleads every future reader and generated artifact. This change brings the specs into conformance with the already-shipped rebranded code. The code is the truth; the specs are corrected to match it.

## What Changes

- Rewrite stale positive brand tokens across the affected `rasen/specs/**/spec.md` files so they describe the shipped `rasen` behavior:
  - `openspec <verb>` command invocations → `rasen <verb>` (binary renamed).
  - `/opsx:*` slash-command references → `/rasen:*`.
  - `openspec-<skill>` / `openspec-opsx-<x>` skill dirNames → `rasen-<skill>` (collapsed single brand segment).
  - `openspec/<changes|specs|schemas|pipelines|config.yaml|AGENTS.md>` current-behavior workspace paths → `rasen/...`.
  - Global config/data dir paths (`~/.config/openspec/...`, `${XDG_DATA_HOME}/openspec/...`) → `rasen` (code truth: `GLOBAL_CONFIG_DIR_NAME`/`GLOBAL_DATA_DIR_NAME = 'rasen'`).
  - `OPENSPEC_TELEMETRY` → `RASEN_TELEMETRY` (code truth: `src/telemetry/index.ts`; `telemetry/spec.md:36` already codifies this — `cli-feedback/spec.md:118,170` is stale).
  - "OpenSpec" product-identity prose (OpenSpec CLI / structure / project / branding / conventions when self-referential) → "Rasen".
- **PRESERVE (do not touch)** the intentional-keep and legitimate-reference tokens: `.openspec.yaml`, `format: 'openspec'`/`'openspec-change'`, legacy-detection literals (`.openspec-store`, `openspec-gstack-*` retired prefixes, `<!-- OPENSPEC:START/END -->` markers, `openspec_root_missing`-class diagnostics), upstream-project attribution ("forked from OpenSpec", "upstream OpenSpec v1.5.0", "@fission-ai/openspec"), migration/coexistence references to the legacy `openspec/` workspace, and **negative assertions** that require openspec/opsx tokens to be ABSENT (rewriting these would invert the requirement).
- **Behavior-neutral**: no requirement semantics change; only stale brand tokens are corrected. Capability folder names and requirement identity are unchanged.
- Add ONE new governance capability, `spec-brand-consistency`, whose single ADDED requirement makes the brand-token conformance rule a durable, testable contract (and is the change's delta-of-record — `rasen validate` mandates at least one delta per change).
- Mechanics: **direct main-spec conformance edit for the bulk rewrite, plus one ADDED governance delta** (justified in design.md D1). The bulk sweep is documentation/brand conformance, not per-capability behavioral deltas.

## Capabilities

### New Capabilities
- `spec-brand-consistency`: a governance requirement that spec prose uses current `rasen` brand tokens for the product's own surfaces, reserving `openspec`/`opsx` for the enumerated keep-classes (intentional-keep identifiers, legacy-detection literals, upstream attribution, migration/coexistence references, negative assertions, capability folder IDs, internal code symbols). Its scenario is the corpus-grep gate that verifies no positive brand drift remains.

### Modified Capabilities
<!-- Intentionally empty. The bulk rewrite alters NO requirement semantics — it only corrects
     stale brand tokens in main specs to match already-shipped code. Per the spec-driven schema,
     Modified Capabilities is populated only when spec-level BEHAVIOR changes. Expressing ~78
     capabilities as MODIFIED deltas would restate full requirement blocks verbatim (doubling the
     surface, transcription risk) and misrepresent a wording fix as behavior change. Instead the
     brand corrections land directly in rasen/specs/** (enumerated in tasks.md), and the change's
     required delta is the single ADDED spec-brand-consistency requirement. See design.md D1. -->

## Impact

- **Edited**: `rasen/specs/**/spec.md` — roughly 78 files touched (REWRITE or MIXED), roughly 8 KEEP-only (audit, no edit). Authoritative per-file adjudication table in design.md.
- **Added**: `rasen/specs/spec-brand-consistency/spec.md` (via the change's ADDED delta, synced at archive).
- **Not edited**: `src/`, templates, tests, parity fixtures. No code or behavior changes.
- **Out-of-scope follow-ups** (behaviorally wrong, not brand-token drift) are listed in design.md and must NOT be fixed here.
- **Validation**: `rasen validate specs-brand-rewrite` (change structure) plus `rasen validate --specs` staying green after edits (proves the rewrite is structurally behavior-neutral — no requirement/scenario parsing broke).
