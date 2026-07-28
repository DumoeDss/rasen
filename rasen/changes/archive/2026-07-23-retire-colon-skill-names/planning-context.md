# Planning Context — retire-colon-skill-names

## User intent (verbatim, 2026-07-23)

> 检查一下我们当前的skill名称补全,之前是有commands的,所以会有/rasen:office-hours这种命令,而现在commands已经被我们完全移除了,skills的名称都是-连接,比如/rasen-office-hours,我看到在快捷补全时还有:的情况,虽然补全后是正确的-

User confirmed: fix it via a change, and fold in the known-open `/rasen:` literal-residue backlog.

## Root cause (LEAD investigation, verified by reading code + installed artifacts)

- Claude Code's slash-completion popup displays the SKILL.md frontmatter `name:`; the inserted/invoked identifier is the skill directory name. Installed expert skills have `name: rasen:office-hours` (colon) in frontmatter but dir `rasen-office-hours` — hence popup shows `:`, completion inserts `-`.
- Frontmatter `name` comes verbatim from `template.name` via `src/core/shared/skill-generation.ts:172` (`generateSkillContent`). No transform is applied on the Claude delivery path (`transformToHyphenCommands` in `src/utils/command-references.ts` is only wired for `opencode`/`pi` in `init.ts:752` / `update.ts:321`).
- **Workflow templates** (`src/core/templates/workflows/*.ts`) were already renamed to hyphen form during the skills-only migration (e.g. `rasen-propose`).
- **Expert templates were missed**: all 21 files in `src/core/templates/experts/*.ts` still have `name: 'rasen:<x>'` (benchmark 228, careful 40, cso 376, chrome-use 126, codex 339, design-review 256, codebase-design 123, freeze 57, design-consultation 359, guard 52, investigate 227, navigator 65, office-hours 596, prototype 40, qa-only 96, qa 309, review 269, tdd 45, unfreeze 29, workflow-author 144, workflow-review 87).

## Why the colon existed

`rasen/specs/skill-name-prefix/spec.md` (from the full-rebrand era, when skills surfaced as commands `/rasen:xxx`) MANDATES `rasen:` names + `rasen-` dirNames. Commands were removed by the skills-only delivery change (PR #26), but this spec and the expert templates were not updated. The spec must be updated in this change (delta spec; renamed/changed scenarios need REMOVED+ADDED, validate does not guard scenario sync).

## Affected surface (all verified by grep, 2026-07-23)

1. **21 expert templates** — `name: 'rasen:<x>'` → `'rasen-<x>'` (making `template.name === dirName`).
2. **Bundled pipeline YAMLs** — `pipelines/{full-feature,small-feature,bug-fix,auto-decompose}/pipeline.yaml` reference `skill: rasen:review`, `rasen:cso`, `rasen:benchmark`, `rasen:design-review`, `rasen:qa`, `rasen:qa-only`. `execution-validation.ts:106` matches stage skills against `template.name` exactly — these YAMLs MUST change in the same commit.
3. **`src/core/pipeline-registry/legacy-skill.ts`** — currently maps `openspec:` → `rasen:`. Needs a `rasen:<x>` → `rasen-<x>` mapping so pre-existing user/local pipelines authored with colon refs resolve (the dual-identity `Set([template.name, dirName])` registration collapses once name==dirName, so the colon key disappears from catalogs). Decide: extend `mapLegacySkillId` (and its openspec: target should now land on hyphen form too, not `rasen:`).
4. **Identity plumbing is already tolerant** — `portablePathCollisionKey` (path-policy.ts:88) does case/Unicode folding only, no `:`/`-` normalization; all lookups register both `template.name` and `dirName` via `new Set([...])`, so name==dirName is safe (set collapses to one key). No collision risk (verified catalog collision guard logic in catalog.ts/registry.ts).
5. **`/rasen:` literals in instruction bodies** (the known-open backlog, user asked to fold in): `src/core/templates/experts/_shared.ts` (10), `office-hours.ts` (3 in body), `review.ts` (2), `src/core/claude-settings.ts` (comment), plus any others a fresh grep finds. These render into installed SKILL.md bodies.
6. **Governance spec** — `rasen/specs/skill-name-prefix/spec.md` requirements "Expert skill names use rasen: prefix" and its scenarios must flip to hyphen form (REMOVED+ADDED discipline for renamed requirements/scenarios).
7. **Tests** — `test/core/workflow-registry/validator.test.ts`, `test/core/pipeline-registry/pipeline.test.ts`, `test/commands/pipeline.test.ts`, `test/core/workflow-package/pipeline-package.test.ts`, `test/core/pipeline-registry/execution-validation.test.ts`, fixture `test/fixtures/workflow-registry/builtins-v1.json` reference colon names.
8. **Docs** — `docs/cli.md`, `docs/workflows.md`, `docs/concepts.md`, `docs/opsx-workflow-guide.md`, `docs/workflow-packages.md` + their `docs/zh/` counterparts reference `rasen:review` etc.
9. **`transformToHyphenCommands`** — after templates are colon-free, decide keep-as-noop-guard vs remove; prefer KEEP as a cheap invariant guard (removal ripples into init/update wiring), but planner may decide.

## Constraints & decisions already made

- Version discipline: NEVER bump major/minor; this is a fix, no version change.
- Testing: uncommitted local src changes must be exercised via `node bin/rasen.js`, not the globally installed rasen (global is a 0.1.5-dev.local tgz snapshot).
- Windows: full `pnpm test` may show CLI-spawn EBUSY flakes; failures must be FULLY enumerated and each isolated/attributed — never extrapolate flake from a truncated tail.
- Working tree: isolated worktree `auto/retire-colon-skill-names` based on be367343^..be367543 (merge of PR #27). Do NOT touch `packages/ui` (separate in-flight line owns it).
- `requires.skills` in user workflow packages may reference colon identities; the catalog resolves them via the same identity map — check `workflow-library.ts:481-508` behavior for colon refs post-change and cover with the legacy mapping if needed.
- The completion fix must hold for BOTH fresh `rasen init` and `rasen update` regeneration of installed skills.

## Planner findings (appended 2026-07-23, verified by grep/read)

- **Live functional surface the original list missed**: `src/core/management-api/whitelist.ts:70,77` carries `skill: '/rasen:auto'` / `'/rasen:goal'`, consumed verbatim by `supervisor.ts:282` as the spawned session's prompt token (`${input.skill} ${input.task}`). Must flip to `/rasen-auto` / `/rasen-goal` (both exist as workflow skills). Additional comment-only residues: `archive.ts:384` (user-facing message `/rasen:archive`), `project-config.ts:1195,1243`, `run-state.ts:105`, `workflow-chain.ts:8`, `supervisor.ts:38`.
- **Colon tokens are NOT a uniform prefix swap**: doc-era short names differ from real dirNames (`/rasen:apply`→`/rasen-apply-change`, `/rasen:new`→`/rasen-new-change`, `/rasen:continue`→`/rasen-continue-change`, `/rasen:verify`→`/rasen-verify-change`, `/rasen:sync`→`/rasen-sync-specs`, `/rasen:archive`→`/rasen-archive-change`, `/rasen:bulk-archive`→`/rasen-bulk-archive-change`). Full mapping table = design.md D7.
- **Corpus is far bigger than the initial inventory**: `rasen:` appears 140x across 41 main specs and ~630x across 42 docs files (EN+zh). `spec-brand-consistency` spec itself MANDATES `/rasen:*` as the current token — it gets a delta (MODIFIED) alongside `skill-name-prefix` (REMOVED+ADDED); the other ~39 specs are swept as behavior-neutral wording under that governance (specs-brand-rewrite precedent). `rasen/specs/opsx-goal-command/spec.md:14` additionally still claims a "CommandTemplate for `/rasen:goal`" — stale beyond wording (CommandTemplate survives only in `src/core/codex/`), gets a minimal reword.
- **Parity-hash blast radius**: `test/core/templates/skill-templates-parity.test.ts` pins SHA-256 for BOTH template function payloads and generated SKILL.md content; all 21 expert renames + `_shared.ts` body edits invalidate both tables (regenerate wholesale, don't hand-patch).
- **`test/ui/welcome-screen.test.ts` already guards `/rasen:` absence** in TUI output — existing negative test, keep unmodified.
- **`.claude/skills` is not committed** (git ls-files → 0), so installed-skill refresh is purely a `rasen update` concern, no repo migration.
- **workflow-library colon-ref degradation is silent**: `requires.skills` lookup (`workflow-library.ts:494-505`) does `if (!id) continue` — after name==dirName, colon refs lose dependency protection with no error; same for `workflowIdBySkillName` (line 507) feeding `collectPipelineUsage`. Both need a `mapLegacySkillId` fallback (design D4).
- Proposal/design/specs/tasks written 2026-07-23; `rasen validate retire-colon-skill-names --json` → valid, 0 issues.
