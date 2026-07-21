## 1. Execution-model section in concepts.md (EN)

- [x] 1.1 Add `## The Execution Model: Inner and Outer Loops` to `docs/concepts.md`, placed after the `## Schemas` section and before `## Archive`
- [x] 1.2 Frame the content layer (schema — cross-reference the existing `## Schemas` section, do NOT redefine) vs the execution layer (workflow = inner loop, pipeline = outer loop), with the task/subagent vs harness-chaining framing
- [x] 1.3 Add a kind-taxonomy subsection (task / driver / internal; driver = auto/goal outer-loop engines that consume pipelines; internal = hidden from `workflow list` by default) consistent with the shipped `kind` field
- [x] 1.4 Add a "why the names stay" subsection (upstream heritage, GitHub Actions precedent, inverted rename cost)
- [x] 1.5 Add scope/position declarations: schema keeps three-layer directory-override this round (later change reserves a `requires.schemas` existence-check slot); `-command` suffix renames deferred; community sharing = file + git/PR, no registry/marketplace; trust boundary = executable prompts mitigated by transactional install + digest + validate + author/review experts, no signatures
- [x] 1.6 Phrase forward references (dependency graph, pipeline packages, expert integration) as design direction, not current CLI behavior
- [x] 1.7 Add Glossary rows for Pipeline, Driver, Inner loop, Outer loop, Installable workflow; leave the existing Schema row intact
- [x] 1.8 Verify every `rasen`/`/rasen:*` command cited as current exists in the CLI (auto, goal, `workflow list --all`, `pipeline list`); avoid the literal phrase "context store"; do not coin "two-axis" as the model name

## 2. Chinese mirror in concepts.md

- [x] 2.1 Mirror the new section and glossary rows in `docs/zh/concepts.md`, following the file's existing 1:1 bilingual convention

## 3. Rerouted kind-section zh work (minimal)

- [x] 3.1 Add the Chinese mirror of the `kind` paragraph and the two `workflow list` synopsis line edits to `docs/zh/cli.md` in the location matching `docs/cli.md`. Discovery: `docs/zh/cli.md` had no `### rasen workflow` section at all (a pre-existing gap predating this portfolio, from the workflow-library PR), so there was no "corresponding location" to insert a lone paragraph into. Resolved by adding the full `### rasen workflow` section (translated) plus a `工作流库` summary-table row, bounded to this one section; see design.md Risks/Trade-offs for the full note. `### rasen profile` remains untranslated — a separate, unrelated gap, left out of scope.
- [x] 3.2 Do NOT create `docs/zh/workflow-packages.md` (whole-file translation is out of scope; English fallback applies) — noted in design.md Risks/Trade-offs, not in the docs

## 4. Validate

- [x] 4.1 Ran `npx vitest run test/vocabulary-sweep.test.ts test/utils/command-references.test.ts` — 21/21 passed. `pnpm build` also run clean (docs-only change, but confirmed untouched).
- [x] 4.2 Ran `rasen validate concept-coherence-concept-docs --strict` (via `node bin/rasen.js`) — "Change 'concept-coherence-concept-docs' is valid"
