# Planning Context — cli-update-stub-adjudication

Seeded by the LEAD, 2026-07-10. Pipeline: small-feature. Worktree run (branch cli-update-stub-adjudication @ 30dc336). INVESTIGATE-FIRST (user directive: 先排查再工作).

## User intent

Adjudicate and fix the follow-up flagged by fix-brand-residuals' planner: `rasen/specs/cli-update/spec.md` contains root-`AGENTS.md`/`CLAUDE.md` "stub" scenarios describing a feature with ZERO trace in `src/` — spec-vs-code divergence. Either the feature should exist (implement) or the scenarios are inherited stale upstream description (correct/remove the spec text). LEAD prior: the fork deliberately abolished marker-block writing into tool config files (legacy-cleanup.ts exists to REMOVE such artifacts; CHANGELOG 0.1.1: "Neither init nor update auto-cleans or rewrites legacy artifacts anymore"), so the stub feature is likely a dead upstream remnant — lean spec-correction, but VERIFY before deciding, and surface the product judgment explicitly in design.md.

## Investigation questions (answer with file:line evidence BEFORE fixing shape)

1. Locate the exact stub scenarios in rasen/specs/cli-update/spec.md (they survived fix-brand-residuals' 11-scenario rewrite because they were out of that change's scope — find them fresh, lines have drifted).
2. What did the stub feature DO historically? Check: git log/upstream history of the spec text; `legacy-cleanup.ts` (does it name root AGENTS.md/CLAUDE.md stubs among legacy artifacts it removes? that would CONFIRM deliberate abolition); `init.ts`/`update.ts` for any root-file writing; templates for AGENTS.md content generation (rasen/AGENTS.md in the WORKSPACE dir is a different thing — the workspace file is real; the ROOT stub is the question).
3. Distinguish THREE root-file surfaces before judging: (a) `rasen/AGENTS.md` INSIDE the workspace dir (real, written by init?); (b) repo-root `AGENTS.md`/`CLAUDE.md` stubs with marker blocks (the questioned feature); (c) tool config files (.claude/CLAUDE.md etc). The spec text may conflate them — the adjudication table must not.
4. If (b) is confirmed dead: rewrite/remove ONLY those scenarios via a MODIFIED delta on cli-update (or the owning capability), preserving any true statements. If evidence shows the feature is PARTIALLY alive (some path still writes root stubs), document per-path truth and fix text to match — do NOT implement new functionality either way (product call recorded: fork does not write root stubs; implementing is explicitly out of scope unless evidence contradicts the abolition).

## Constraints

- small-feature pipeline (propose → apply → verify(standard) → review-loop → ship → archive), gate policy off, ALL workers sonnet.
- Likely spec-text-only change (no src edits expected). If investigation reveals a needed code deletion (dead stub-writing code actually still runs), that's in scope only if tiny; otherwise ledger it.
- **CLI: use the WORKTREE's own dist** (`pnpm build` done, `node dist/cli/index.js` from worktree cwd). Do NOT use the main tree's dist — it currently runs another session's in-flight uncommitted identity code (workDir resolution drift observed 2026-07-10; worktree dist @ 30dc336 is authoritative for this run).
- Validation: `validate cli-update-stub-adjudication --strict` + `validate --specs --strict` (baseline 119/0) + spec-brand-consistency grep discipline (K1-K7 keep-classes; do not introduce or wrongly remove brand tokens).
- Wording discipline: NEVER/ALWAYS/MANDATORY need scope clauses; behavior descriptions must match code truth with file:line evidence in design.md.
- Ship local in worktree; LEAD merges post-archive.

## Durable findings (planner pass, 2026-07-10)

- **Verdict: dead upstream remnant, spec-correction (not implementation).** Root cause traced precisely via `CHANGELOG.md`: the root-`AGENTS.md`/`CLAUDE.md` marker-block stub feature was added upstream at v0.6.0/v0.7.0 (`CHANGELOG.md:600,606`) and explicitly **removed by upstream OpenSpec itself at v1.0.0** ("Config files removed — Tool-specific instruction files ... no longer generated", `CHANGELOG.md:219-227`) — years before this fork's baseline, which aligns with upstream v1.5.0 (`CHANGELOG.md:22`). The fork never had this feature; the spec text is stale pre-1.0.0 upstream language that was never scrubbed.
- **Zero implementation confirmed**: only `src/core/legacy-cleanup.ts` references root `AGENTS.md`/`CLAUDE.md`, and purely for *detecting* pre-existing legacy marker blocks (never writing them); removal only happens inside consent-gated `rasen migrate` (default: keep). `update.ts:507-511` and `config.ts:14-16` both carry explicit doc comments confirming "never rewrites/refreshes" and "never written into new content."
- **Fix applied**: MODIFIED delta on `cli-update` (4 requirements: Update Behavior, File Handling, Tool-Agnostic Updates, Core Files Always Updated) removing the false root-stub `AND` clause from each of the 4 scenarios (spec.md lines 10-13, 18-21, 26-31, 36-39), preserving every true `rasen/AGENTS.md`-replacement clause. No `src/` changes — none were needed.
- **Artifacts**: proposal.md, design.md, specs/cli-update/spec.md (delta), tasks.md all written to `rasen/changes/cli-update-stub-adjudication/`. Main spec `rasen/specs/cli-update/spec.md` already edited directly (not just delta) since this planner pass did both propose and apply given the tiny, unambiguous spec-text-only scope.
- **Validation status**: `validate cli-update-stub-adjudication --strict` → valid. `validate --specs --strict` → 119 passed, 0 failed (matches expected baseline). Brand-grep discipline: removed clauses contain zero `OpenSpec`/`openspec` tokens, confirmed clean.
- **Out-of-scope follow-up discovered**: `rasen/specs/cli-init/spec.md:87-88` ("generate that tool's configuration files with Rasen markers... managed sections that need refreshing") makes an adjacent-but-distinct false claim about a per-tool marker mechanism — different requirement/command surface, not root-stub language, not fixed here. Corpus-wide grep for "root-level stub"/"root stub"/"managed marker block" confirms no OTHER spec repeats the exact root-stub claim this change fixes.
- **Remaining for apply/ship**: tasks.md fully checked off since the edits were made and validated in this same pass. Next step is review-loop → ship → archive per the small-feature pipeline; no further spec/code work expected.
