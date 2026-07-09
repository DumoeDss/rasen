## Context

`rasen/specs/cli-update/spec.md` contains four scenarios that each assert: "if a root-level stub (`AGENTS.md`/`CLAUDE.md`) exists, refresh/create it using the managed marker block pointing to `@/rasen/AGENTS.md`." This change investigates whether that behavior exists anywhere in the current implementation, and — if not — corrects the spec text rather than building the feature.

This follow-up was explicitly flagged (not fixed) by `rasen/changes/archive/2026-07-10-fix-brand-residuals/design.md`:

> "Separate finding, explicitly out of scope: the same spec file's root-level `AGENTS.md`/`CLAUDE.md` "stub" scenarios (roughly lines 10-13, 18-21, 26-29, 36-39 ...) describe a mechanism that a repo-wide search ... found zero matches for anywhere in `src/`. ... Flagged as a follow-up; not touched here."

That change (F5/D0/D1) already fixed a *different, adjacent* false claim in the same requirement blocks — that command/skill files are updated via marker-scoped partial writes rather than whole-file regeneration — confirmed false via `update.ts:224`/`update.ts:252` (`FileSystemUtils.writeFile`, whole-file overwrite). This change closes the one item that fix explicitly deferred: the root-stub claim.

### Three distinct root-file surfaces (do not conflate)

1. **`rasen/AGENTS.md`** — inside the workspace directory. Real. Replaced wholesale by `init`/`update` on every run. Unaffected by this change; every corrected scenario keeps its true "replace `rasen/AGENTS.md` with the latest template" clause.
2. **Repo-root `AGENTS.md`/`CLAUDE.md` marker-block stub** — the questioned feature. This is what the 4 scenarios describe and what this change adjudicates.
3. **Tool config files** (`.claude/CLAUDE.md`, etc.) — a separate surface entirely, governed by different requirements (`cli-init`'s "Additional AI Tool Initialization"), not addressed by these 4 scenarios.

### Located scenarios (current line numbers, drifted since fix-brand-residuals)

| Requirement | Scenario | Lines | False clause |
|---|---|---|---|
| Update Behavior | Running update command | 10-13 | "if a root-level stub ... exists, refresh it so it points to `@/rasen/AGENTS.md`" |
| File Handling | Updating files | 18-21 | "if a root-level stub exists, update the managed block content so it keeps directing teammates to `@/rasen/AGENTS.md`" |
| Tool-Agnostic Updates | Updating files | 26-31 | "create or refresh the root-level `AGENTS.md` stub using the managed marker block, even if the file was previously absent" |
| Core Files Always Updated | Successful update | 36-39 | "if a root-level stub exists, refresh it so it still directs contributors to `@/rasen/AGENTS.md`" |

### Historical trace (why the text exists)

- `CHANGELOG.md:600` (upstream v0.7.0): "Always scaffold the managed root `AGENTS.md` hand-off stub and regroup the AI tool prompts during init/update to keep instructions consistent." — the feature was introduced.
- `CHANGELOG.md:606` (upstream v0.6.0, appears earlier in file / chronologically before 0.7.0 since CHANGELOG is newest-first): "Slim the generated root agent instructions down to a managed hand-off stub..." — precursor.
- `CHANGELOG.md:219-227` (upstream v1.0.0, "The OPSX Release"): **"Config files removed — Tool-specific instruction files (`CLAUDE.md`, `.cursorrules`, `AGENTS.md`, `project.md`) are no longer generated"** and **"Migration — Run `openspec init` to upgrade. Legacy artifacts are detected and cleaned up with confirmation."** Upstream itself abolished the feature at v1.0.0.
- `CHANGELOG.md:22` (fork 0.1.0): "Fork baseline ... aligned with upstream v1.5.0" — the fork begins several major versions after upstream's own removal, so the fork never had this feature to begin with.
- `CHANGELOG.md:16` (fork 0.2.0, current): "Neither `init` nor `update` auto-cleans or rewrites legacy artifacts anymore — they only print a one-time coexistence notice. Marker-block removal from shared config files happens only inside `rasen migrate`, gated on explicit consent (default no)." This is the fork's own refinement of legacy-artifact *handling* (detect + optionally strip), built on top of a baseline where creation/refresh was already absent.

The stub-writing text in `cli-update/spec.md` is stale upstream spec language that predates OpenSpec 1.0.0 and was never scrubbed when the fork's spec corpus was assembled.

### Current implementation (why it's confirmed dead, not merely undocumented)

- `src/core/legacy-cleanup.ts:59-68` — `LEGACY_CONFIG_FILES` lists root `AGENTS.md`/`CLAUDE.md` (and other tool config filenames) purely as **detection** targets for pre-existing marker blocks from old installs.
- `src/core/legacy-cleanup.ts:310-337` — `detectLegacyStructureFiles` only calls `fileExists` + `hasOpenSpecMarkers` against the root `AGENTS.md` path; it never writes.
- `src/core/legacy-cleanup.ts:395-416` — `cleanupMarkerBlocks` only **removes** marker blocks from files that already have them (`removeMarkerBlock`); there is no code path that creates a marker block or writes stub content. Its own doc comment (lines 384-389) states it is "the narrow, consent-gated cleanup invoked inside the `rasen migrate` flow ... removal only happens when the user explicitly confirms it."
- `src/core/init.ts:288-316` — the only caller of `cleanupMarkerBlocks`, gated behind an interactive confirm prompt defaulting to no ("Remove OpenSpec marker blocks from ...? (they may be used by upstream OpenSpec)").
- `src/core/update.ts:507-511` — doc comment on `noticeLegacyArtifacts`: "Never removes, rewrites, or refreshes them: they may belong to upstream OpenSpec or an older rasen install (D4). update only refreshes rasen-namespace artifacts." `rasen update` does not touch root config files at all, in either direction.
- `src/core/config.ts:14-16` — `OPENSPEC_MARKERS` doc comment: "Legacy marker pair — recognized ONLY to identify pre-existing legacy artifacts (upstream OpenSpec or older rasen installs). Never written into new content."
- Repo-wide grep for `@/rasen/AGENTS.md`, `@/openspec/AGENTS.md`, `root-level stub`, `rootStub`, `ensureRootStub` inside `src/`: zero matches outside the spec/changes corpus itself.

### Corpus-wide check for sibling claims

`grep -rl "root-level stub\|root stub\|managed marker block" rasen/specs/` returns only `rasen/specs/cli-update/spec.md`. No other main spec repeats this exact root-stub claim, so no sibling delta is needed for this specific claim.

A related-but-distinct claim exists at `rasen/specs/cli-init/spec.md:87-88` ("generate that tool's configuration files with Rasen markers ... leave existing tool configuration files unchanged except for managed sections that need refreshing") — this is about surface (3), tool config files, under a different requirement ("Additional AI Tool Initialization") and a different command path. It resembles the marker-mechanism claim `fix-brand-residuals` already disproved for `cli-update`'s command/skill files, but it was not part of that change's 11-site sweep and is not root-stub language. Recorded as a follow-up, not fixed here (see Non-Goals).

## Goals / Non-Goals

**Goals:**
- Adjudicate each of the 4 root-stub scenarios in `cli-update/spec.md` against actual code behavior, with file:line evidence.
- Correct the false root-stub clauses via a MODIFIED delta, preserving every true clause (the `rasen/AGENTS.md` replacement) in each scenario.
- Record the product judgment explicitly: this is a stale-upstream-remnant spec defect, not a missing feature — no implementation work follows from this change.

**Non-Goals:**
- Implementing root-level `AGENTS.md`/`CLAUDE.md` stub writing. The fork's product decision (confirmed by `legacy-cleanup.ts` and the 0.2.0 CHANGELOG entry) is that shared root config files are never auto-rewritten; only detected and, on explicit consent, stripped of legacy markers inside `rasen migrate`. Evidence contains no signal contradicting this — there is no partially-alive code path.
- Fixing `cli-init/spec.md:87`'s adjacent tool-config-marker claim — different surface, different requirement, discovered as a side effect of the corpus grep but out of the "root-stub language" scope this change was chartered for. Ledgered as a follow-up.
- Any `src/` change. No code implements the false behavior, so there is nothing to delete or refactor.
- Re-litigating the 11 scenarios `fix-brand-residuals` already fixed (command/skill whole-file regeneration wording) — those are correct as they stand.

## Decisions

**D0 — Verdict: dead upstream remnant, spec-correction not implementation.** All four investigation questions from the LEAD's brief resolve the same way: (1) scenarios located at spec.md:10-13,18-21,26-31,36-39; (2) the feature was upstream-only, added at v0.6.0/v0.7.0 and removed at v1.0.0, years before this fork's v1.5.0-aligned baseline; (3) the three surfaces are cleanly separable and only surface (2) is false; (4) no code path writes root stubs anywhere, confirmed dead, not partially alive — so the fix is a pure MODIFIED delta on `cli-update`, no code changes.

**D1 — Adjudication table (per LEAD instruction, verdict each scenario/claim separately).**

| # | Location | Claim | Verdict | Evidence |
|---|---|---|---|---|
| 1 | `Update Behavior` / "Running update command" (10-13) | Refresh root stub on every update, pointing to `@/rasen/AGENTS.md` | **FALSE — remove** | `update.ts:507-511` doc comment: update never rewrites/refreshes shared config files |
| 2 | `File Handling` / "Updating files" (18-21) | Update managed block content in root stub | **FALSE — remove** | Same; also `legacy-cleanup.ts` has no write path for marker blocks, only removal |
| 3 | `Tool-Agnostic Updates` / "Updating files" (26-31) | Create or refresh root stub "even if previously absent" | **FALSE — remove** | Strongest false claim (asserts creation of a new file); no creation code exists anywhere in `src/` |
| 4 | `Core Files Always Updated` / "Successful update" (36-39) | Refresh root stub to keep directing contributors | **FALSE — remove** | Same as #1 |
| 5 (context, not fixed) | `cli-init/spec.md:87-88` | Generate tool config files "with Rasen markers"; refresh "managed sections" | Distinct claim, plausibly also false, **out of scope** | Not root-stub language; different requirement/command; ledgered as follow-up |

Each of scenarios 1-4 also contains a true clause ("replace `rasen/AGENTS.md` with the latest template" / "completely replace `rasen/AGENTS.md`") that is kept verbatim — only the root-stub `AND` clause is removed from each.

**D1a — Round-1 verify history (honest record).** A reviewer verified the round-1 diff (root-stub clauses removed, `rasen/AGENTS.md` clauses kept) and returned **BLOCKED**: the kept "true" clause was never independently checked — it was carried forward as an assumed-true baseline, the same failure mode D1's own investigation was chartered to avoid, just on the other clause in each scenario. The reviewer's own empirical check (`rasen init --tools claude` / `rasen init --tools all` in clean scratch dirs, this worktree's `dist/cli/index.js`) found **zero** `rasen/AGENTS.md` or root `AGENTS.md` written anywhere, and a whole-tree `grep -rn "AGENTS" src/*.ts` turned up exactly three non-write hits (`config.ts:65` — `'agents'` tool entry `available: false`; `legacy-cleanup.ts` — detect/remove only; `templates/index.ts:4` — doc comment confirming AGENTS.md templates were removed). `update.ts` and `init.ts` contain zero occurrences of `AGENTS` at all. This fixer re-ran the same greps and reproduced the same empirical result independently (see D1b) before rewriting the scenarios — see `work/verification-report.md` for the reviewer's full evidence.

**D1b — Second-pass adjudication (fixer, this round).** The kept `rasen/AGENTS.md` clause describes a file the current implementation never creates, under any tool selection — confirmed by re-running `grep -n "AGENTS" src/core/update.ts src/core/init.ts src/core/templates/index.ts src/core/config.ts`: zero hits in `update.ts`/`init.ts`, and the three non-write hits the reviewer already found. `update.ts` (521 lines, read in full) has no concept of a `rasen/AGENTS.md` file at all; the actual "instruction files" `rasen update` maintains are per-tool skill files (`<skillsDir>/skills/<workflow>/SKILL.md`, generated unconditionally every update regardless of delivery — `update.ts:209-222`, comment: "Generate skill files (always installed regardless of delivery)") and, when `delivery === 'both'` (`update.ts:115`), per-tool command files (`update.ts:226-243`, via `CommandAdapterRegistry` + `FileSystemUtils.writeFile`, whole-file overwrite — this matches the whole-file-regeneration finding `fix-brand-residuals` already established for command/skill files). All four scenarios' surviving clauses were rewritten to assert exactly this, grounded file:line by file:line, rather than any `rasen/AGENTS.md` claim:

| # | Requirement / Scenario | Old surviving clause | New clause | Evidence |
|---|---|---|---|---|
| 1 | `Update Behavior` / "Running update command" | "replace `rasen/AGENTS.md` with the latest template" | "regenerate skill files for each tool being updated, using the latest templates" + "regenerate command files too when the delivery setting includes commands" | `update.ts:209-222` (skill loop, unconditional), `update.ts:115,226-243` (`shouldGenerateCommands = delivery === 'both'`, gated command loop) |
| 2 | `File Handling` / "Updating files" | "completely replace `rasen/AGENTS.md` with the latest template" | "completely replace each skill file's content with the latest template" + "completely replace each command file's content with the latest template too, when delivery includes commands" | `update.ts:217` / `update.ts:234` — both are `FileSystemUtils.writeFile` (whole-file overwrite, not a partial/merge write) |
| 3 | `Tool-Agnostic Updates` / "Updating files" | "completely replace `rasen/AGENTS.md`..." THEN clause, plus a second `AND` clause ("avoid creating new native-tool configuration files ... unless they already exist") | THEN: "only operate on tools that already have at least one Rasen-generated file; update never onboards a new tool"; kept `AND` (full-regen, unmodified — still true); new `AND`: "generate command files only when delivery includes commands; skill files are generated regardless of delivery" | `getConfiguredToolsForProfileSync` (`profile-sync-drift.ts:95-99`) requires pre-existing skill- or command-configuration before a tool is touched at all — corroborated by the already-true `Update detects new tool directories` requirement ("SHALL NOT automatically add the new tool"); delivery-gating corroborated by the already-true `Update respects delivery setting` requirement ("Skills are always generated for selected workflows; only command files are added or removed by a delivery change") |
| 4 | `Core Files Always Updated` / "Successful update" | "replace `rasen/AGENTS.md` with the latest template" | "regenerate skill files for each tool that was updated, regardless of delivery setting" | Same as #1's skill-loop evidence; "regardless of delivery" ties directly to the `update.ts:209` comment |

**D1c — Second false clause found and deliberately not asserted.** While re-adjudicating #3's second `AND` clause ("avoid creating new native-tool configuration files ... unless they already exist"), this fixer found it is *also* false as a blanket claim: `profile-sync-drift.ts:hasToolProfileOrDeliveryDrift` treats a missing command/skill file for a currently-selected workflow as drift (lines 126-132, 149-156), and `update.ts`'s per-tool loop then unconditionally writes every desired workflow's command/skill file for any tool entering `toolsToUpdate` — including files that didn't previously exist. Empirically reproduced in a clean scratch dir (this worktree's `dist/cli/index.js`): `rasen init --tools claude`, delete `.claude/commands/rasen/apply.md`, run `rasen update` — the file is recreated. The rewritten clause (D1b, row 3) deliberately does **not** assert "update creates missing files," because doing so would collide with an existing, unrelated, already-shipped set of scenarios in this same spec file (`Slash Command Updates`, e.g. "skip creating any missing workflow files during update" for Windsurf/Kilo Code/Antigravity/Factory Droid/Codex/Gemini CLI, and the `Missing slash command file` scenario: "do not create a new file during update") that assert the opposite and were already reviewed and accepted as correct by `fix-brand-residuals` (this design's own Non-Goals: "Re-litigating the 11 scenarios `fix-brand-residuals` already fixed ... those are correct as they stand"). Reconciling that apparent contradiction is a distinct investigation (which surface governs: profile-drift healing vs. per-tool "only refresh existing" behavior, and whether the 11 scenarios need their own correction) — out of scope for a change chartered around 4 specific root-stub scenarios. Per D3, the safer move is dropping the disputed claim rather than asserting either side of an unresolved contradiction. **Ledgered as a new follow-up** (see Open Questions).

**D2 — Delta strategy: MODIFIED on all 4 requirements, full block copies.** Per this repo's delta-spec convention (see `rasen/changes/archive/2026-07-10-fix-brand-residuals/specs/cli-update/spec.md` for the exact prior pattern in this same file), a MODIFIED requirement is expressed as the complete current requirement block with the corrected text — not a diff fragment. `Tool-Agnostic Updates` and `Slash Command Updates` share one requirement in the source spec structure only insofar as they're adjacent; each is delta'd independently by requirement name, matching how `fix-brand-residuals` split its own MODIFIED blocks.

**D3 — Wording after removal.** Each scenario's `THEN`/`AND` list drops the root-stub `AND` clause entirely rather than rewording it into a negative ("do not create a root stub") — a SHALL-NOT clause here would describe non-behavior that doesn't need spec-level assertion (nothing else in `cli-update/spec.md` asserts other non-actions this way), consistent with `fix-brand-residuals`' D1 approach of stating what the code actually does rather than padding with negatives.

## Risks / Trade-offs

- [Risk] Removing the root-stub clause could look like a regression to a reader expecting root AGENTS.md/CLAUDE.md hand-off — but the behavior it describes has never existed in this fork and was already dead in the upstream version this fork forked from. → Mitigation: proposal.md and this design.md carry the full historical trace for anyone auditing the change.
- [Trade-off] The `cli-init:87` finding is left unfixed, so `cli-init/spec.md` keeps its own defect a bit longer. → Accepted: it's a different requirement/command surface and investigating it properly (confirming whether `init.ts`'s "add a tool after initial setup" path is whole-file regeneration like every other adapter, or something else) is its own investigation, not "root-stub language." Ledgered in proposal.md's Impact section for a future change.

## Migration Plan

None. Documentation-only correction; no runtime behavior, data, or file format changes.

## Open Questions

None blocking as of this round. Follow-ups (not part of this change):
- Adjudicate `cli-init/spec.md:87`'s "Rasen markers" / "managed sections" claim for tool config files against `init.ts`'s actual per-tool-adapter behavior.
- (New, found during D1c re-adjudication) Reconcile the apparent contradiction between `cli-update/spec.md`'s `Slash Command Updates` requirement ("SHALL refresh existing slash command files for configured tools without creating new ones") plus its per-tool "skip creating missing files" scenarios and `Missing slash command file` ("do not create a new file during update") on one side, versus the profile-drift-healing behavior this change empirically verified (`profile-sync-drift.ts` treats a missing in-profile command/skill file as drift; `update.ts` then recreates it — reproduced live: delete an existing tool's command file, run `rasen update`, file comes back). One side of this is stale. Needs its own investigation and delta; not fixed here because it touches the 11 `Slash Command Updates` scenarios `fix-brand-residuals` already reviewed and accepted, which is outside this change's charter (4 named root-stub scenarios only).
