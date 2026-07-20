## Why

The `concept-coherence` portfolio settled a conceptual model in discussion but has so far only implemented it in code (ff removed, `kind` taxonomy added). The model itself is undocumented: `docs/concepts.md` defines `schema` (as an artifact dependency graph) but never mentions `pipeline`, `inner/outer loop`, `driver`, or how the three concepts relate. `glossary.md:61` gestures at "distinct from an artifact schema and orchestration pipeline" but nothing unifies them. The result is that a reader cannot tell why rasen has three overlapping-sounding concepts, why the names stay, or what the `kind` field they now see in `workflow list` means at a conceptual level.

This change writes the model down (portfolio decisions: the converged conceptual model + #6 + the scope exclusions). It also closes a loose end from the kind-taxonomy sibling: that change added English `kind` subsections to `docs/cli.md` and `docs/workflow-packages.md` but no Chinese mirror; the LEAD rerouted the zh mirroring here, with the minimal approach left to this planner.

## What Changes

### 1. Document the execution model in `docs/concepts.md`

Add one new section, **The Execution Model: Inner and Outer Loops**, placed after the existing `## Schemas` section (which already owns the content axis) and before `## Archive`. It presents the model as a content layer plus an execution layer split into two loops:

- **schema** = the content layer (what artifacts a methodology produces and how they depend on each other; today the one built-in is `spec-driven`). Cross-references the existing `## Schemas` section rather than redefining it.
- **workflow** = the execution layer's **inner loop** (how one task unit runs inside one session: a code agent plans and executes it, possibly dispatching subagents).
- **pipeline** = the execution layer's **outer loop** (how a harness such as autopilot chains multiple inner-loop tasks — propose → apply → archive — in sequence).

Sub-parts of the section:
- **Kind taxonomy**: `task` (inner-loop unit), `driver` (outer-loop engine that consumes pipelines — `auto`/`goal`), `internal` (a driver's sub-unit, hidden from `workflow list` by default). Ties the conceptual model to the `kind` field a reader sees in the CLI.
- **Why the names stay**: workflow reads "large" from the outer-loop view, but the names are kept — upstream OpenSpec heritage, the GitHub Actions precedent of "workflow" naming a chained unit, and the cost/benefit of a rename being inverted. The fix is the model, not new words.
- **Scope and position declarations** (settled exclusions, stated as design position, not shipped behavior): schema keeps its existing three-layer directory-override resolution this round (a later change reserves a `schemas` slot in workflow `requires` for existence checks only); the `-command` suffix renames (`ship-command` → `ship`) are deferred; community sharing is designed for file + git/PR distribution with no registry/marketplace; and a trust-boundary statement — community packages are executable prompts, mitigated by transactional install + digest + validate + author/review experts, not a signature system.
- **Forward references** to not-yet-landed siblings (explicit dependency graph, pipeline packages, expert integration) phrased as design direction so the doc stays true before those land — it must not describe unshipped CLI behavior as current.

Update the `## Glossary` table in `concepts.md` to add rows for the newly first-class terms (pipeline, driver, inner loop, outer loop, installable workflow), consistent with the existing `Schema` row.

### 2. Full Chinese mirror in `docs/zh/concepts.md`

Mirror the new section and glossary rows in `docs/zh/concepts.md`, following the existing 1:1 bilingual convention for that file.

### 3. Rerouted kind-section zh work (minimal approach)

- `docs/zh/cli.md` exists: add the Chinese mirror of the `kind` paragraph (and the two `workflow list` synopsis line edits) that the kind-taxonomy change added to `docs/cli.md`.
- `docs/zh/workflow-packages.md` does not exist and this change does NOT create it: whole-file Chinese translation of `workflow-packages.md` is declared out of scope. The site l10n build falls back to English for unmirrored content, so the manifest `kind` bullet remains English-only this round. (Recorded as an explicit scope exclusion.)

## Capabilities

### Modified Capabilities

- `docs-content-accuracy`: adds a requirement that the conceptual model (schema/workflow/pipeline as content + inner/outer execution loops, plus the kind taxonomy) is documented and that any command the concept doc references exists in the shipped CLI.

## Impact

- `docs/concepts.md` — new "Execution Model" section + glossary rows
- `docs/zh/concepts.md` — Chinese mirror of the above
- `docs/zh/cli.md` — Chinese mirror of the kind paragraph + `workflow list` synopsis edits
- `rasen/specs/docs-content-accuracy/spec.md` — one ADDED requirement (delta)
- No source code changes; no `docs/website-manifest.json` change (extending `concepts.md`, not adding a file); no version change.
- Constraints: avoid the literal phrase "context store" (the only docs vocabulary-sweep tripwire); do not coin "two-axis" as the model's name (that term already denotes the Standards+Spec review model — describe the model as content/execution layers and inner/outer loops instead); every `rasen …` / `/rasen:*` command referenced must exist in the CLI.
