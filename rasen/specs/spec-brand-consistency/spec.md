# spec-brand-consistency Specification

## Purpose

This spec governs brand-token wording within the main spec corpus itself (`rasen/specs/**/spec.md`). It ensures spec prose describing the product's own current surfaces uses the `rasen` brand consistently, while enumerating the keep-classes where `openspec`/`opsx` tokens legitimately remain (intentional-keep identifiers, legacy-detection literals, upstream attribution, migration/coexistence references, negative assertions, and capability/code identifiers).

## Requirements

### Requirement: Spec prose uses current rasen brand tokens for the product's own surfaces

Main spec prose under `rasen/specs/**/spec.md` SHALL describe the product's own surfaces — the CLI binary and verbs, slash commands, skill directory names, workspace and config/data directory paths, the telemetry opt-out environment variable, and product-identity prose — using the current `rasen` brand tokens: `rasen <verb>`, `/rasen:*`, `rasen-<skill>`, `rasen/…` workspace paths, the `rasen` config/data directory, `RASEN_TELEMETRY`, and "Rasen" in prose.

The tokens `openspec`/`opsx` SHALL appear in spec prose only within these enumerated keep-classes:
- intentional-keep identifiers: the `.openspec.yaml` change-metadata filename and the `format: 'openspec'` / `format: 'openspec-change'` file-format identifiers;
- legacy-detection literals: `.openspec-store`, retired `openspec-gstack-*` skill prefixes, `<!-- OPENSPEC:START/END -->` marker strings, diagnostic-code strings, and the `edge.openspec.dev` hostname;
- upstream-project attribution: that the product is forked from OpenSpec, `@fission-ai/openspec`, and upstream-version alignment;
- migration and coexistence references to the legacy `openspec/` workspace and `rasen migrate` semantics;
- negative assertions that require an `openspec`/`opsx` token to be absent or inert (rewriting these would invert the requirement);
- capability folder identifiers (spec IDs) and internal code symbols referenced by name.

This requirement is behavior-neutral with respect to every other capability: it constrains only brand-token wording, not requirement semantics.

#### Scenario: No positive brand drift remains in the spec corpus

- **WHEN** `rasen/specs/**/spec.md` is grepped case-insensitively for `openspec` or `opsx`
- **THEN** every remaining match falls into one of the enumerated keep-classes (intentional-keep identifier, legacy-detection literal, upstream attribution, migration/coexistence reference, negative assertion, capability folder identifier, or internal code symbol)
- **AND** no remaining match is a positive claim about the product's current CLI verb, slash command, skill directory, workspace path, config/data path, telemetry environment variable, or product-identity prose that still uses an `openspec`/`opsx` token
