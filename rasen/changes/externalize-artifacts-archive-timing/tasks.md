# Tasks: externalize-artifacts-archive-timing

> Shared-working-tree discipline (every task): `git status --porcelain` on each file before editing and before committing — touch only files clean of foreign modifications; commit with explicit pathspec (`git commit -- <paths>`) and verify with `git show --stat`; wait/escalate on foreign dirt. Build with `node build.js`; run tests with `npx vitest run` (pnpm is broken machine-wide — pre-existing). After touching `src/`, always `node build.js` before CLI-spawning tests.
>
> Groups are dependency-ordered and hand-off-able at any boundary: 1 (config) → 2 (exposure) → 3-5 (templates) → 6 (regeneration) → 7 (verification).

## 1. Config axis: archive.timing

- [x] 1.1 `src/core/project-config.ts`: parse an optional `archive` map with optional `timing` ('on-merge' | 'in-ship') under the resilient field-by-field policy (non-map `archive` → warn + drop block; invalid `timing` → warn + drop field; absence silent). Extend `ProjectConfig` with `archive?: { timing?: ArchiveTiming }`; export `resolveArchiveTiming(config | null | undefined): ArchiveTiming` applying the `on-merge` default (shape extensible for child 4's `destination`).
- [x] 1.2 Unit tests for the parsing matrix (valid on-merge / valid in-ship / invalid value / non-map block / absent block) and the resolver default, mirroring the projectId test style in `test/core/project-config.test.ts`.

## 2. CLI exposure: resolved timing in status JSON

- [x] 2.1 `src/commands/workflow/status.ts`: add `archive: { timing: resolveArchiveTiming(readProjectConfig(root.path)) }` to the `--json` payload (always present, additive, beside `workDir`); add an `Archive timing:` line to the human output. No git/gh calls, no writes.
- [x] 2.2 Tests: status JSON carries `archive.timing` = configured value and = `on-merge` when unconfigured; human output line present; existing payload fields unchanged.

## 3. Template: ship.ts timing awareness

- [x] 3.1 Resolve `archive.timing` from the status JSON ship already fetches (alongside `workDir`), stating the default.
- [x] 3.2 In-ship path: insert the conditional step before the commit step — capture PR-body sections from `proposal.md` and task-completion facts FIRST (the dir is about to move), then run the `rasen-sync-specs` step, then perform the bookkeeping move (`mv <changeRoot> <changesDir>/archive/YYYY-MM-DD-<name>`, same collision rule as the archive skill), then commit everything together; ship-log gains `Archived in ship: <path>`.
- [x] 3.3 On-merge post-ship guidance (step 6), mode-aware: `pr` → change stays ACTIVE during review, archive follows merge confirmation (do NOT suggest immediate archive); `push`/`local` → archive immediately. Keep the retro/docs suggestions.
- [x] 3.4 Recorded-facts-win rule: one line stating ship-log facts (mode, PR URL, archived-in-ship marker) outrank re-resolved config for already-delivered changes.

## 4. Template: archive-change.ts timing + merge gate (both getters)

- [x] 4.1 New early step (after the status fetch, before existing gates): resolve `archive.timing` from status JSON and read delivery facts from the workDir ship-log; branch: in-ship-archived → report already-archived at recorded path, stop cleanly (idempotent); on-merge + PR-delivered → merge-confirmation gate (4.2); on-merge + push/local/no-ship-log → existing flow unchanged.
- [x] 4.2 Merge-confirmation gate: extract the PR URL from ship-log; `gh pr view <url> --json state,mergedAt`; MERGED → proceed; OPEN → refuse by default, explicit unmerged-naming override only, refuse outright non-interactively; CLOSED-unmerged → refuse and surface the rejected delivery; gh missing/unauthenticated/network/parse failure or no PR URL → state "cannot verify", ask the human to confirm the merge explicitly (interactive) / refuse with reason (non-interactive); NEVER treat unverifiable as merged.
- [x] 4.3 Update the guardrails block: merge confirmation joins the hard-gate list (with its degradation rule); already-archived no-op noted; both the skill getter and the command getter stay in sync.

## 5. Template: _orchestration.ts archive-stage rule

- [x] 5.1 Add the compact archive-stage timing rule at the stage-interpretation level: in-ship → record stage satisfied "archived in ship", no dispatch; on-merge + push/local → run immediately; on-merge + pr → dispatch archive, and on unmerged refusal record the stage `pending` with an awaiting-merge note (PR URL) in run-state, end the run cleanly surfacing the open frontier — no polling; resume re-attempts check-on-invocation. No run-state schema changes (use existing stage record fields).

## 6. Regeneration and parity

- [x] 6.1 Run the build → update flow (`node build.js`, then the update command) to regenerate `.claude/skills/**` and `.codex/**`; hand-edit nothing generated.
- [x] 6.2 Update `test/core/templates/skill-templates-parity.test.ts` expected hashes for exactly the affected templates (ship, archive-change, _orchestration consumers); `npx vitest run test/core/templates/` passes with only those hashes moved.

## 7. Verification

- [x] 7.1 `node bin/rasen.js validate externalize-artifacts-archive-timing` passes; `node build.js` clean.
- [x] 7.2 Full test suite green via `npx vitest run` (Windows: isolate-rerun CLI-spawning EBUSY/ENOTEMPTY flakes after clearing stale tmp dirs before trusting a failure).
- [x] 7.3 Live smoke (scratch project or this repo read-only): `rasen status --change <n> --json` shows `archive.timing` default `on-merge`; set `archive: { timing: in-ship }` in a scratch config and confirm exposure flips; confirm invalid value warns and defaults. Inspect the regenerated ship/archive skills for the timing branches and the merge-gate wording.
- [x] 7.4 Cross-platform check: new tests build expected paths with `path.join`; no hardcoded separators; config parsing tests are platform-neutral.
