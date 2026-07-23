# Design — retire-colon-skill-names

## Context

The skills-only delivery change (PR #26) removed command payloads entirely, but the naming layer kept two identities per skill: `template.name` (colon form for the 21 experts, hyphen form for workflows) and `dirName` (always hyphen). Every registry/catalog lookup registers both identities via `new Set([template.name, dirName])`, and `generateSkillContent` writes `template.name` verbatim into SKILL.md frontmatter — which is what Claude Code's slash-completion popup displays, while the invokable identifier is the directory name. Root cause and full surface inventory: `planning-context.md` (authoritative), verified 2026-07-23.

Constraints: no version bump; `packages/ui` untouched; delta-spec discipline (renames = REMOVED+ADDED); local CLI testing via `node bin/rasen.js`.

## Goals / Non-Goals

**Goals**
- One identity per skill: `template.name === dirName === rasen-<x>` for all 21 experts (workflows already comply).
- Popup shows exactly what invocation inserts, for both fresh `rasen init` and `rasen update`.
- Old colon references in user-authored assets keep resolving (mapping, not breakage).
- Retire the `/rasen:` literal residue everywhere it describes current surfaces: instruction bodies, comments, specs, docs.

**Non-Goals**
- No renaming of dirNames, skill ids, or pipeline ids (only the colon-form `name` values die).
- No removal of `transformToHyphenCommands` or its init/update wiring.
- No touch of `packages/ui`, no version bump, no changes to the `openspec:`-era keep-classes (`.openspec.yaml`, format ids, markers).

## Decisions

**D1 — `template.name` becomes the dirName, not a new third form.** The dual-identity `Set` registration collapses to a single key; no collision risk (`portablePathCollisionKey` does case/Unicode folding only, and name==dirName is the workflows' existing steady state).

**D2 — Bundled pipeline YAMLs flip in the same commit as the templates.** `resolvePipelineExecutionSkillSets` (`src/core/pipeline-registry/execution-validation.ts:106`) builds `knownSkillNames` from `template.name` exactly; splitting the two edits breaks every bundled pipeline preflight in between.

**D3 — `mapLegacySkillId` gains a colon branch and retargets the openspec branch.** `rasen:<x>` → `rasen-<x>`; `openspec:<x>` now → `rasen-<x>` (previously → `rasen:<x>`, which after this change would map into another dead namespace). Alternative considered: a lookup-table keyed by real skill ids — rejected; the mapping is a dumb prefix swap used for resume hints, and pipeline stages only ever referenced expert skills whose base name equals the dirName suffix. Known limitation (accepted): `rasen:apply`-style tokens whose real skill is `rasen-apply-change` map to a nonexistent `rasen-apply`; such tokens never appeared as pipeline stage skills.

**D4 — Catalog identity lookups fall back through `mapLegacySkillId` on miss.** Two sites in `src/core/workflow-library.ts`: the `requires.skills` identity map (~line 488-505) and `workflowIdBySkillName` used by `collectPipelineUsage` (~line 507). Today a colon ref resolves because the colon identity is registered; after name==dirName it would silently `continue` (lost dependency protection / lost usage attribution). On lookup miss, retry with the mapped id. This implements the spec scenario "Workflow package requiring a colon skill identity still protects its dependency".

**D5 — Whitelist skill invocations flip to hyphen.** `src/core/management-api/whitelist.ts:70,77` (`/rasen:auto`, `/rasen:goal`) are live strings: `supervisor.ts:282` builds the spawned session prompt as `${input.skill} ${input.task}`. Colon form no longer resolves as anything in Claude Code; hyphen skills `rasen-auto`/`rasen-goal` exist.

**D6 — `transformToHyphenCommands` stays as an invariant guard.** After the sweep it is a no-op on bundled templates; removal would ripple into `init.ts`/`update.ts` wiring for zero benefit. Its own tests (colon inputs → hyphen outputs) intentionally keep colon literals.

**D7 — Literal rewrites use a canonical mapping table, not a blind `s/rasen:/rasen-/`.** Doc-era short names differ from real skill dirNames:

| colon token | current skill |
|---|---|
| `/rasen:propose` | `/rasen-propose` |
| `/rasen:explore` | `/rasen-explore` |
| `/rasen:new` | `/rasen-new-change` |
| `/rasen:continue` | `/rasen-continue-change` |
| `/rasen:apply` | `/rasen-apply-change` |
| `/rasen:verify` | `/rasen-verify-change` |
| `/rasen:verify-enhanced` | `/rasen-verify-enhanced` |
| `/rasen:sync` | `/rasen-sync-specs` |
| `/rasen:archive` | `/rasen-archive-change` |
| `/rasen:bulk-archive` | `/rasen-bulk-archive-change` |
| `/rasen:review-cycle` | `/rasen-review-cycle` |
| `/rasen:ship` | `/rasen-ship` |
| `/rasen:auto` | `/rasen-auto` |
| `/rasen:goal` | `/rasen-goal` |
| `/rasen:retro` | `/rasen-retro` |
| `/rasen:handoff` | `/rasen-handoff` |
| `/rasen:onboard` | `/rasen-onboard` |
| `/rasen:help` | `/rasen-help` |
| `/rasen:office-hours` | `/rasen-office-hours-command` (workflow entry) or `/rasen-office-hours` (expert) — pick by context |
| expert tokens (`/rasen:review`, `/rasen:cso`, `/rasen:qa`, …) | same base, hyphen (`/rasen-review`, …) |

**D8 — Spec corpus sweep rides the spec-brand-consistency governance, not 41 delta specs.** Only `skill-name-prefix` (whose requirement mandates the colon form — a real contract flip, REMOVED+ADDED) and `spec-brand-consistency` (whose current-token list names `/rasen:*`) get delta specs. The remaining ~39 specs' colon tokens are brand-token wording, not requirement semantics — swept in place as a behavior-neutral correction, same precedent as the specs-brand-rewrite 76-file sweep that this governance spec was created to sanction. Enumerated judgment lines (swap alone would leave a false claim): `rasen/specs/opsx-goal-command/spec.md:14` still says "a CommandTemplate for `/rasen:goal`" — CommandTemplate survives only in codex integration; reword minimally to the skill-only reality. Keep-class survivors: colon tokens inside legacy-mapping/negative-assertion text.

**D9 — Docs sweep policy.** All `/rasen:<x>` and `rasen:<x>` tokens in `docs/**` (EN+zh, ~630 across 42 files) rewrite via the D7 table. `openspec:` tokens stay (upstream/migration documentation). Migration-guide old→new tables: only the "new" side flips. Grep-zero target: `rg 'rasen:' docs/` → 0, except lines that document the colon→hyphen legacy mapping itself (if any are added, they must read as legacy).

**D10 — Parity hashes are regenerated, not hand-patched.** `test/core/templates/skill-templates-parity.test.ts` pins SHA-256 of (a) template function payloads and (b) generated SKILL.md content. All 21 expert renames plus `_shared.ts`/`office-hours.ts`/`review.ts` body edits invalidate both tables for every affected skill. Run the test, collect actuals from the vitest diff (or a one-off script through the same hash routine), paste both tables wholesale.

## Risks / Trade-offs

- [User pipelines authored with colon refs stop matching catalogs] → D3+D4 legacy mapping fallback; covered by tests (`legacy-namespace-detection`, workflow-library usage).
- [A missed colon literal in a template body re-enters installed SKILL.md] → welcome-screen test already guards `/rasen:` absence in TUI; add/keep grep-zero verification tasks over `src/core/templates/**` and generated payloads; `transformToHyphenCommands` remains as belt-and-braces on non-Claude paths.
- [Sweep collides with in-flight `packages/ui` branch] → hard exclusion: never edit `packages/ui/**`; colon refs there (if any) belong to that work line.
- [Blind replace corrupts `openspec:`-era keep-classes or legacy-test inputs] → D7 table + enumerated keep files (`command-references.test.ts`, `legacy-namespace-detection.test.ts` inputs, `legacy-skill.ts` source constants, migration docs' old-form columns).
- [Windows CLI-spawn test flakes muddy the full-suite verdict] → enumerate every FAIL, isolate and attribute each; never extrapolate flake from a truncated tail.

## Migration Plan

Single commit chain in this worktree; templates + pipeline YAMLs + legacy mapping land together (D2). Installed skills refresh on the user's next `rasen update` (`.claude/skills` is not committed). Rollback = revert the branch; no persisted state changes shape.

## Open Questions

(none — all decisions taken above)
