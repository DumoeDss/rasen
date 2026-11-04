# Review report — `issue-plan-publication` (VERIFY, reviewer-1)

Date: 2026-08-20. Independent verification of child 1/3 of `issue-multi-change-execution`
(Issue layer Phase 2). Reviewer did not write the code.

## Tree under review

- HEAD: `71b64a16` (branch `feat/issue-phase2`), tree `3276b4674e60352caf3d0521143357522edcb096`,
  working tree dirty with this change's own uncommitted delta (7 modified tracked files
  + untracked `src/core/issue-publication/`, 2 new test paths, change dirs).
- Dist currency (CLI tests run `dist/cli/index.js`): `dist/core/issue-publication/*` and
  `dist/commands/store-issue.js` built 2026-08-20T01:01Z, at/after every src mtime;
  `dist/commands/store-issue.js` contains `from-portfolio` and `issue_plan_source_conflict`.

## Gate 1 — unit-test gate (re-run by reviewer, real exit codes, no pipes)

| Command | Result |
| --- | --- |
| `pnpm exec vitest run <the 22 affected-set files>` | **22 files / 240 tests passed, exit 0** (matches implementer's claim and `affected-set-gate.log` exactly) |
| `pnpm exec vitest run test/core/completions/cli-presentation.test.ts test/core/completions/command-registry.test.ts test/locales/catalog.test.ts` | **3 files / 34 tests passed, exit 0** (reviewer addition — see T-1) |
| `node bin/rasen.js validate issue-plan-publication` | **valid, exit 0** |

Full suite deferred to portfolio delivery per dispatch; not run.

## Gate 2 — claim sweep (verdict per claim)

**Channel purity — VERIFIED.** `git diff -- src/core/store/issues/` is byte-empty; the
diff over `src/core/pipeline-registry/`, `packages/ui`, `package.json` is byte-empty.
The orchestration's only write is the revision file via `StoreIssues.publishPlan`
(`orchestration.ts:183-193`); the run-state, workspace index, and child dirs are
read-only inputs. Orchestration tests byte-compare the run-state (Buffer equality) and
assert nothing staged; dogfood receipts evidence the same by sha256 (identical hash
before/after publication).

**Name→instance resolution — VERIFIED, one Minor wrinkle (M-1).** New direction reusing
`gatherReferenceEvidence` is real: `resolution.ts:100-106` matches active entries by
exact directory name and archived entries through the archive engine's own
`archiveDatePrefixedNameMatches` (archived-only, so an active `2026-08-07-x` cannot
claim `x` — pinned by a dedicated test). Both archive shapes (`<date>-<change>` and
Store v2 `<date>-<change>--<instanceShort>`) are tested against real Git fixtures.
Ambiguity groups by the full identity triple and refuses with every claimant listed;
no claimants[0]-style picking exists anywhere in the channel. Archived committed
Changes resolving (the g-003 re-publication prerequisite) is proven at the resolver
layer on real Git fixtures.

**Locator seam — VERIFIED.** `orchestration.ts:100-113` mirrors `pipeline resume`
(`src/commands/pipeline.ts:2703-2722`) expression-for-expression: same
`path.join(root.changesDir, parent)`, same probe-only
`resolveChangeWorkDir(..., { ensure: false })`, same
`ephemeraDir(resolvedExecutionProjectRoot(root), parent)`, same
`resolvePortfolioStateLocation` + `readPortfolioStateDetailed`. The conditional
workDir inclusion is equivalent to resume's unconditional pass (`stateFileSearchChain`
falsy-checks it). Strict read: invalid ≠ absent with distinct codes; the vanish-between
locate-and-read window gets its own honest absence refusal; parent-agreement check is
real and tested (names both values); empty-children refused. The one deliberate
divergence — no `validateChangeExists` (change dir need not exist) — is documented in
design D4 and tested (ephemera-only placement publishes without a change dir).
Ephemera-over-stale-change-dir precedence is tested and matches resume.

**CLI three-way sync — VERIFIED.** Commander `--from-portfolio <parent>`
(`store-issue.ts:802`), locale key
`cli.root.commands.store.commands.issue.commands.plan.options.from-portfolio` resolves
in en/ja/zh-cn (checked by direct JSON navigation, not just diff context), completions
`COMMAND_REGISTRY` `plan` flags entry (`command-registry.ts:668-671`). Structural
enforcement confirmed: `cli-presentation.test.ts` asserts commander/registry/locale
parity, and it plus `command-registry.test.ts` and `locales/catalog.test.ts` pass
(34/34, exit 0). JSON form carries `{...planPayload, source}`; human form prints
`source: portfolio '<parent>' — N children, run-state <path>` beside the unchanged
commit suggestion — both forms tested, nothing staged asserted. Source exclusivity:
both/none refused naming both sources; the retired `issue_plan_from_file_required`
code is pinned nowhere (grep clean) and the new codes are pinned by the CLI suite.
The `--from-file` path's render/payload is behaviorally unchanged.

**Dogfood receipts — VERIFIED, byte-stability EVIDENCED.** Receipt 1: real CLI run
from a member project root, run-state at the real resume placement
(`app/.rasen/changes/issue-multi-change-execution/ephemera/portfolio-run.json`),
run-state sha256 identical before/after publication, 0001 sha256 recorded, git status
clean of staged entries. Receipt 2: child flipped to `done` in the run-state,
re-publish → 0002 `supersedes: 0001`, 0001 sha256 identical before/after (hash
comparison, not a summary match), full `show` output evidencing both revisions and
resolved references. Receipt 3: teardown double-clear, temp root removed, registry
residue check 0. The run-state named the real portfolio parent and the real sibling
children with a real `dependsOn` edge.

**Fences — ALL CLEAN.** `git diff -- src/core/pipeline-registry/ packages/ui package.json`
byte-empty; no version bumps anywhere in the diff; `git status` shows no modified
prior test file (all test files in the delta are new paths — this change is
prior-test-clean); `store/issues` untouched; `rasen validate` green.

## Gate 3 — fixture-coincidence sweep

Mentally mutated each refusal predicate against its test:

- invalid≠absent: misreporting invalid as absent flips the asserted code — discriminates.
- parent-mismatch: removing the check makes publication succeed, so `refusalCode`
  fails on no-throw — discriminates; message must contain BOTH names.
- children-empty: removing the check defers to `publishPlan` (empty-node refusal or
  empty revision), failing the asserted code — discriminates.
- root-unresolvable: removing the wrap surfaces a non-`StoreError` — discriminates.
- absent: message must list the ephemera candidate AND the change-dir candidate
  (`path.join`-built) — dropping either chain link fails the test.
- unsearched-ref: removing the `!reader.complete` upgrade flips
  `store_query_ref_unreadable` → `issue_reference_unresolved` — discriminates.
- ambiguous: any picking would return `resolved` and fail the status assertion;
  both project names asserted in the message.
- uncommitted: real workspace-index entry planted; locator path asserted in message.
- foreign-store: instance identity genuinely derives from a foreign scope (the test
  explains why a naive seed would be invisible), status + foreign uid asserted.
- 0001-bytes-unchanged: `Buffer` deep-equality on raw `readFileSync` bytes, not a
  digest or field match — a real byte comparison. Same for run-state byte-identity.
- ephemera precedence: stale change-dir copy + live ephemera copy; childCount and
  statePath both asserted — reading the wrong file fails either assertion.

No fixture was found to coincide with a defect path.

## Findings

### Blocker — none.

### Major — none.

### Minor

**M-1 — active+archived copies of one instance: the name layer resolves, the mutation
layer then refuses.** `resolution.ts:117-131` groups committed entries by the identity
triple, so a Change present BOTH active (`x`) and archived (`2026-08-07-x`) with the
same instance resolves to one identity (preferred = active). But `publishPlan`'s
under-lock verification re-resolves BY INSTANCE (`resolveChangeReference`,
`references.ts:139-141`), where `collectCommittedChanges`' dedup key includes
`changeId` (`refs.ts:record`), so the pair is TWO entries → `committed.length > 1` →
`issue_reference_ambiguous` refusal under the lock. Concrete scenario: a Store that
still carries an active copy of a Change that was also archived (fork/migration
anomaly; the normal archive flow removes the active copy, which is why the dogfood
path is unaffected). The refusal is honest (both copies listed with refs) and the
same store state already refuses on the manual `--from-file` path, so this is a
layer divergence, not a wrong write — but this channel is the first caller that
pre-resolves by name and then hits the instance verifier, and no test pins the
combined behavior. Suggest a follow-up test (or a note for g-003) documenting that
active+archived coexistence refuses at publish despite name-layer resolution.

### Trivial

**T-1 — affected-set gate omitted the three-way-sync enforcement suites.** Tasks 5.1
names "commander-presentation locale structure, completions registry" as focused
suites, but `affected-set-gate.log`'s 22 files contain neither
`test/core/completions/cli-presentation.test.ts`, `command-registry.test.ts`, nor
`test/locales/catalog.test.ts`. Reviewer ran them: 3 files / 34 tests, exit 0 —
claim closed, but the gate log understates what the change touches.

**T-2 — test residue at repo root.** `.rasen-pipeline-command-g4roIW/` (timestamped
09:11, the implementer's gate run) is untracked residue from a pipeline-command test
leak (`rasen/pipelines/invalid-detail-nested/pipeline.yaml`). Not this change's code,
but it will surface in `git status` at archive time; worth deleting before staging.

**T-3 — coverage shape notes (no defect claimed).** No end-to-end 3-child publication
(three children with edges exist at the pure-compile layer; end-to-end exercises two);
no test plants a legacy machine-home work-dir copy (chain order inherited from the one
shared `stateFileSearchChain`, which resume's own tests cover); the
`uncommitted`-on-incomplete-reader upgrade arm (`resolution.ts:225-227`) is untested
(the `unresolved` arm is tested).

**T-4 — ambiguous-refusal claimant count can overstate.** `claimants: committed.map(...)`
counts entries (refs/copies), not distinct Changes, so one identity reachable via two
entries plus a second identity prints "3 committed Changes" for two Changes. The
message lists `foundAtRef` per claimant so it stays truthful, and the decision
(refuse, none chosen) is unaffected.

## Verdict

**PASS.** 0 Blocker / 0 Major / 1 Minor / 4 Trivial. All five requirements and thirteen
scenarios verified against the delta; all fences clean; the test gate reproduces
(22/240, exit 0) and closes the three-way-sync claim beyond it (34/34, exit 0);
dogfood receipts evidence every byte-stability claim by content hash. M-1 is a
fail-safe divergence worth a pinning test or a g-003 note, not a rework.

## Round-1 re-review — CLEAN

Date: 2026-08-20. Delta re-reviewed: the M-1 pin test, `evidence/fix-round-1.md`,
and the T-2 residue deletion. No production code changed (tracked diff still exactly
the 7 implementation-round files; fences byte-empty; no version bumps; no prior test
file modified — the touched file is this change's own new suite).

**M-1 pin — verified as claimed, both directions.**
`test/core/issue-publication/issue-plan-publication-resolution.test.ts:409`:

- Fixture is the COPY shape (`fs.cpSync`, active `shared-fate` directory stays beside
  the archived `2026-08-07-shared-fate`) — the fork/migration anomaly, not the
  rename/archive flow the earlier archived tests use. Correct.
- Layer 1 asserted exactly: `resolveChildByName` → `resolved` with the active copy's
  full identity triple.
- Layer 2 asserted end-to-end: `publishPlanFromPortfolio` over a portfolio naming the
  child throws `issue_reference_ambiguous` with BOTH copies in the message
  (`shared-fate at refs/heads/main` and `2026-08-07-shared-fate at refs/heads/main`),
  and no `0001.yaml` exists after the refusal.
- Discrimination: a later change that made this store state publish fails on
  `expect(thrown).toBeInstanceOf(StoreIssueError)` (no-throw); one that made the name
  layer refuse fails the layer-1 `toEqual` assertion. The pin holds in both
  directions — it pins the divergence, not just a code path.

**Gate (reviewer-run, real exit code):** `pnpm exec vitest run test/core/issue-publication/issue-plan-publication-resolution.test.ts`
→ **1 file / 12 tests, exit 0** (11 → 12 with the pin; the pin itself green at 6.7s).

**T-2 — verified gone.** `.rasen-pipeline-command-g4roIW/` no longer exists; no
`.rasen-pipeline-command-*` remains in `git status`.

**Open items: none.** Accepted as recorded: T-1 (closed by reviewer's round-1 run,
34/34), T-3 (coverage-shape notes, no defect claimed), T-4 (claimant-count wording,
decision unaffected).

Verdict: **CLEAN — PASS** (0 Blocker / 0 Major / 0 open Minor / T-1, T-3, T-4 accepted as recorded).
