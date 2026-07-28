## Context

This is the documentation sibling of the `concept-coherence` portfolio. Children 1 (ff removal) and 2 (kind taxonomy) have landed the code; this change records the model they implement. It is docs-only. The research question is not "what to build" but "where the prose goes without contradicting existing docs, tripping the one docs test, or documenting unshipped behavior as current."

Verified facts about the current tree that shape the design:
- `docs/concepts.md` (628 lines) already has a `## Schemas` section defining schema as an artifact dependency graph, and a Glossary. It has zero mentions of pipeline / inner loop / outer loop / driver / harness.
- `glossary.md:61` already says an installable workflow is "distinct from an artifact schema and orchestration pipeline" — the closest existing seed of the model.
- The kind vocabulary was freshly seeded by the kind-taxonomy change in `docs/cli.md` and `docs/workflow-packages.md` (English only).
- The only automated docs tripwire is `test/vocabulary-sweep.test.ts`, which forbids the literal "context store" in scanned files (including `docs/`). No brand-word or 1:1-parity test gates docs.
- The publication manifest `docs/website-manifest.json` lists `concepts.md` (slug `core-concepts`); extending that file needs no manifest edit. Adding a new file would.
- "two-axis" is already used in docs for the Standards+Spec code-review model — reusing it for schema/workflow/pipeline would collide.

## Goals / Non-Goals

**Goals**
- One coherent place a reader learns the three concepts, the inner/outer loop framing, the kind taxonomy, and why the names stay.
- Chinese parity for the new prose and for the rerouted kind sections (minimal scope).
- A minimal, honest docs-governance requirement so the model doc does not silently rot.

**Non-Goals**
- No new doc file (and therefore no manifest change).
- No whole-file translation of `workflow-packages.md`.
- No documentation of unshipped CLI behavior (dependency-closure install, pipeline packages, expert integration) as current — these appear only as clearly-labeled design direction.
- No source code changes.

## Decisions

### D1. Extend `concepts.md`, do not add a new file

`concepts.md` already owns `Schema` and is already published (`core-concepts`). Adding the execution-model section there unifies the model next to the schema definition it builds on, avoids a `website-manifest.json` entry, and keeps the existing 1:1 zh mirror obligation to a single file pair. A standalone `concept-model.md` would fragment the reader's path and force a manifest + new zh file. Placement: immediately after `## Schemas` (content axis defined) and before `## Archive`.

### D2. Name the model by its layers/loops, not "two-axis"

The section is titled **The Execution Model: Inner and Outer Loops**. Prose frames it as: schema = content layer; workflow + pipeline = execution layer, split into inner loop (workflow) and outer loop (pipeline). This carries the portfolio's "two axes" intuition without colliding with the existing "two-axis (Standards + Spec)" review term. The word "axis" may appear descriptively but is never coined as the model's proper name.

### D3. Reconcile with the existing Schema definition, don't redefine

The new section references `## Schemas` for the content axis rather than restating it, and the Glossary gains rows for the genuinely new terms (Pipeline, Driver, Inner loop, Outer loop, Installable workflow) while leaving the existing `Schema` row intact. This prevents a contradictory second definition — the failure mode the research flagged.

### D4. Forward references are labeled as direction

Dependency-graph, pipeline packages, and expert integration are unshipped. The doc introduces them under phrasing like "the direction rasen is moving" / "a later step will…", never as current CLI behavior. This satisfies `docs-content-accuracy`'s "documented commands match the shipped CLI" — the doc only asserts existing commands (`/rasen:auto`, `/rasen:goal`, `rasen workflow list --all`, `rasen pipeline list`) as current, and marks everything else as roadmap.

### D5. Minimal-scope zh reroute for the kind sections

- `docs/zh/cli.md` exists → insert the Chinese mirror of the kind paragraph and the two `workflow list` synopsis edits in the corresponding location. In-context, paragraph-level; no surrounding retranslation.
- `docs/zh/workflow-packages.md` does not exist → creating a full Chinese `workflow-packages.md` is out of scope (a large, unrelated translation surface). The site l10n spec (`website-docs-l10n`) says missing translations fall back to English with a marker and the build still succeeds, so leaving the manifest `kind` bullet English-only is safe and honest. Declared explicitly as a scope exclusion so a future translation pass picks it up.

### D6. One honest docs-governance requirement

Add a single ADDED requirement to `docs-content-accuracy`: the conceptual model is documented (schema/workflow/pipeline as content + inner/outer loops, plus the kind taxonomy), and any command the concept doc cites must exist in the shipped CLI. This is checkable, matches the spec's existing "documented commands match the shipped CLI" theme, and turns the model doc into a maintained contract rather than inventing new governance machinery.

## Risks / Trade-offs

- **zh parity drift**: `docs/zh/workflow-packages.md` stays absent, so parity is deliberately partial. Accepted per LEAD ruling and the English-fallback l10n behavior; recorded as a scope exclusion for future pickup.
- **`docs/zh/cli.md` gap was larger than assumed**: at implementation time, `docs/zh/cli.md` had no `### rasen workflow` section at all (nor a `### rasen profile` section) — both were added to the English file by prior PRs (workflow-library, reusable profiles) without a zh mirror, predating this portfolio. D5 assumed only a paragraph-level insertion into an existing section. Resolution: the missing `### rasen workflow` section was added in full (synopsis, subcommand table, JSON example, `delete` note, plus the translated Kind classification paragraph) and a `工作流库` row was added to the summary table — bounded, one section, needed to give the kind paragraph a coherent home. The `### rasen profile` section remains untranslated; that gap is unrelated to the kind taxonomy and is left as an explicit, separate scope exclusion for a future translation pass, same treatment as `workflow-packages.md`.
- **Terminology**: "inner/outer loop" is introduced as new first-class vocabulary. Mitigated by anchoring to the already-present "outer loop" usage in `docs/README.md` and `docs/faq.md`, so it is not wholly novel.
- **vocabulary-sweep**: trivially avoided by not writing "context store"; noted as a task check.

## Migration Plan

Not applicable — additive documentation. No behavior, config, or artifact changes.

## Open Questions

None. The extend-vs-new-file decision, the naming-collision avoidance, and the zh-reroute minimal scope are all resolved above against the verified tree state.
