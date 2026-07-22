## MODIFIED Requirements

### Requirement: Spec prose uses current rasen brand tokens for the product's own surfaces

Main spec prose under `rasen/specs/**/spec.md` SHALL describe the product's own surfaces — the CLI binary and verbs, slash-invoked skills, skill directory names, workspace and config/data directory paths, the telemetry opt-out environment variable, and product-identity prose — using the current `rasen` brand tokens: `rasen <verb>`, `/rasen-<skill>` slash invocations, `rasen-<skill>` directory names, `rasen/…` workspace paths, the `rasen` config/data directory, `RASEN_TELEMETRY`, and "Rasen" in prose.

The tokens `openspec`/`opsx` SHALL appear in spec prose only within these enumerated keep-classes:
- intentional-keep identifiers: the `.openspec.yaml` change-metadata filename and the `format: 'openspec'` / `format: 'openspec-change'` file-format identifiers;
- legacy-detection literals: `.openspec-store`, retired `openspec-gstack-*` skill prefixes, `<!-- OPENSPEC:START/END -->` marker strings, diagnostic-code strings, and the `edge.openspec.dev` hostname;
- upstream-project attribution: that the product is forked from OpenSpec, `@fission-ai/openspec`, and upstream-version alignment;
- migration and coexistence references to the legacy `openspec/` workspace and `rasen migrate` semantics;
- negative assertions that require an `openspec`/`opsx` token to be absent or inert (rewriting these would invert the requirement);
- capability folder identifiers (spec IDs) and internal code symbols referenced by name.

The retired colon-form skill namespace (`rasen:<skill>`, `/rasen:<skill>`) SHALL likewise appear in spec prose only as a legacy token: within legacy-detection or legacy-resolution requirements (the colon→hyphen mapping contract), migration references, or negative assertions — never as a positive claim about a current slash invocation, skill name, or pipeline stage reference.

This requirement is behavior-neutral with respect to every other capability: it constrains only brand-token wording, not requirement semantics.

#### Scenario: No positive brand drift remains in the spec corpus

- **WHEN** `rasen/specs/**/spec.md` is grepped case-insensitively for `openspec` or `opsx`
- **THEN** every remaining match falls into one of the enumerated keep-classes (intentional-keep identifier, legacy-detection literal, upstream attribution, migration/coexistence reference, negative assertion, capability folder identifier, or internal code symbol)
- **AND** no remaining match is a positive claim about the product's current CLI verb, slash invocation, skill directory, workspace path, config/data path, telemetry environment variable, or product-identity prose that still uses an `openspec`/`opsx` token

#### Scenario: No colon-form skill tokens remain as current-surface claims

- **WHEN** `rasen/specs/**/spec.md` is grepped for `rasen:`
- **THEN** every remaining match sits inside a legacy-detection/legacy-resolution requirement, a migration reference, or a negative assertion
- **AND** no remaining match is a positive claim about a current slash invocation, skill name, or pipeline stage reference
