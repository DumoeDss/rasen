## ADDED Requirements

### Requirement: Stale ethos removed from the standalone browse skill
The top-level `browse/SKILL.md` (the standalone browse package's vendored skill doc, outside the `skills/gstack/` generation loop) SHALL have its stale pre-0b ethos content removed: the `LAKE_INTRO` / Completeness-Principle / "Boil the Lake" blocks, the "Search Before Building" section (including the `eureka.jsonl` write and the `ETHOS.md` reference and `garryslist.org` links), and the dangling "(see Completeness Principle)" cross-reference.

After the fix, `browse/SKILL.md` SHALL be **ethos-equivalent** to the already-clean `skills/gstack/browse/SKILL.md` — it carries none of the five ethos token classes and no dangling reference to a removed ethos block, and its `.tmpl` is left untouched. Full body-parity with the generated copy is **not** required and is explicitly out of scope: the standalone vendored copy also predates the gstack→openspec rename and still carries gstack-branded preamble, session/analytics tracking, the telemetry prompt, Contributor Mode, and the upgrade-flow prose — none of which are ethos, and removing them is browse-productization de-vendor work tracked separately.

#### Scenario: No ethos residue in the standalone browse skill
- **WHEN** `browse/SKILL.md` is inspected
- **THEN** it SHALL contain zero matches for `Boil the Lake`, `Search Before Building`, `Completeness Principle`, `eureka.jsonl`, `ETHOS.md`, or `garryslist.org`

#### Scenario: No dangling reference to a removed ethos block
- **WHEN** `browse/SKILL.md` is inspected after the ethos blocks are removed
- **THEN** it SHALL contain no leftover reference to a removed block — zero matches for `LAKE_INTRO`, `_LAKE_SEEN`, or `completeness-intro` — so nothing points at content that no longer exists

#### Scenario: Ethos-equivalent to the clean gstack browse skill
- **WHEN** `browse/SKILL.md` and `skills/gstack/browse/SKILL.md` are compared
- **THEN** `browse/SKILL.md` SHALL carry no ethos content that the generated copy lacks
- **AND** any remaining divergence limited to pre-rename gstack branding, session/analytics tracking, telemetry prompt, Contributor Mode, or upgrade-flow prose SHALL NOT count as a violation (that de-vendor cleanup is out of scope for this change)

#### Scenario: browse tmpl already clean
- **WHEN** `browse/SKILL.md.tmpl` is inspected
- **THEN** it SHALL contain only placeholders (`{{PREAMBLE}}`, `{{BROWSE_SETUP}}`, `{{SNAPSHOT_FLAGS}}`, `{{COMMAND_REFERENCE}}`) and no literal ethos prose
