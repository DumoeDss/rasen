# Planning context — externalize-artifacts portfolio

## User intent (verbatim)
"auto-decompose 首先阅读交接文档 rasen/office-hours/externalize-openspec-artifacts.md，然后你来推进完成开发任务。一些agent的模型选择：propose/reviewer使用fable，apply/ship/archive使用sonnet。no gate，开始吧。"

## Authoritative design source
`rasen/office-hours/externalize-openspec-artifacts.md` — a refined office-hours design
document (2026-07-09). Every child proposal MUST read it in full and treat it as the
design of record. Its "Implementation order" section IS this portfolio's decomposition.

## Design summary (from the doc — read the doc itself for full rationale)
- Four artifact tiers by CONSUMER: T1 specs (in-repo permanent), T2 review material
  (proposal/design/tasks/delta specs — in-repo, committed, rides the PR), T3 process
  ephemera (handoff/review round logs/ship-log/verification reports/run-state —
  EXTERNAL from birth, never in git), T4 knowledge (office-hours/research — in-repo
  permanent, archive never touches).
- Unified machine home `~/.rasen/<name>-<shortHash(projectId)>/` for every project,
  both planning modes. projectId generated at init, stored in repo `rasen/config.yaml`;
  `~/.rasen/registry.json` maps abs path → {projectId, name, mode, lastSeen},
  self-healing on every CLI run.
- T3 path: `<home>/changes/<name>/work/`, mirrors change layout, shared across
  worktrees. Exposed ONLY via CLI (`rasen context` / instructions workDir field).
- Archive decomposes into spec-sync + directory-bookkeeping. Timing config axis:
  `on-merge` (default; pr mode: merge confirmation triggers archive; local/push:
  archive chains right after ship) | `in-ship`. Change stays ACTIVE during PR review.
- Archive destination config axis: `in-repo` (default) | `external` (project home) |
  `prune`. makeRoot's hardcoded archiveDir becomes config-resolved.
- SHA cross-stamping + store-mode PR-body embedding of proposal/delta in ship.

## Decomposition & dependency DAG (all SERIAL, topological order)
1. externalize-artifacts-machine-home — Decision 4 foundation: projectId + registry +
   home layout + init/doctor integration. No template edits.
2. externalize-artifacts-t3-workdir — depends on 1. workDir resolution on the home;
   context/instructions exposure; audit + switch templates writing ephemera to the
   CLI-resolved workDir; CLI readers (pipeline resume etc.) follow.
3. externalize-artifacts-archive-timing — depends on 2 (templates now stable). Archive
   sync/bookkeeping decomposition + timing config + merge-confirmation mechanism
   (open Q1: planner decides; polling is out — prefer check-on-next-command +
   explicit `rasen archive` trigger).
4. externalize-artifacts-archive-dest — depends on 1 (home) and 3 (archive code
   overlap). Destination config; retro/goal-loop readers adapt.
5. externalize-artifacts-sha-stamping — depends on 3/4 (ship/archive template
   overlap). SHA cross-stamps + store-mode PR-body embedding.

Serial rationale: children 2/3/5 all touch src/core/templates workflows; 3/4 share
archive code; conservative policy forbids parallel on overlapping touch-sets. ALSO: a
CONCURRENT session is live in this same working tree (change
prompt-audit-fixes-verify-ship) with uncommitted edits to
src/core/templates/workflows/{ship,verify-change,verify-enhanced}.ts,
src/core/templates/experts/_shared.ts, src/telemetry/*, test/telemetry/*,
test/core/templates/skill-templates-parity.test.ts.

## Hard constraints (every worker must honor)
- SHARED WORKING TREE: another live session owns the dirty files listed above. NEVER
  commit, revert, or edit them unless this portfolio's change genuinely requires it —
  and re-check `git status` on those paths before any commit. ALL commits use explicit
  pathspec: `git commit -- <paths>` listing ONLY files this change touched, then
  `git show --stat` to verify no foreign files were swallowed.
- Children ship in LOCAL delivery mode (commit only, pathspec-scoped). ONE portfolio
  delivery decision at the end, by the LEAD.
- CLI invocation on this machine: `node bin/rasen.js <args>` (global `rasen`/`openspec`
  not on PATH). Build with `pnpm build` if dist is needed; tests via `pnpm test`
  (Windows: CLI-spawning tests can flake EBUSY — isolate-rerun before believing a
  failure).
- Templates live in src/core/templates/** and are the source of truth; .claude/skills
  and .codex prompts are GENERATED (build → update flow). Template changes must keep
  the skill-templates-parity test green (it hashes generated output).
- Post-rebrand naming: machine home is `~/.rasen/`, config is `rasen/config.yaml`
  (legacy openspec/ dirs still supported by root resolution — do not break them).

## Open questions routed to planners
- Q1 (merge confirmation) → child 3's proposal must pick the mechanism.
- Q2 (bulky change-scoped research T2 vs work/) → child 2, minor decision.
- Q3 (migration of existing flat change dirs) → child 2 decides scope; existing
  archives stay untouched.
- Q4 sub-questions (registry schema, locking, multi-clone suffix, stores.json merge
  timing) → child 1's proposal. Doc says: reuse store registry atomic-update
  machinery; merging stores.json can be deferred.
- Q5 (template ephemera-path inventory) → child 2's apply does the audit.

## Durable findings log (planners/implementers append here)

### From child 1 planning (externalize-artifacts-machine-home, planner, 2026-07-09)

- MACHINE HOME ROOT IS NOT literally `~/.rasen/` — it is `getGlobalDataDir()`
  (src/core/global-config.ts): `$XDG_DATA_HOME/rasen`, Windows `%LOCALAPPDATA%\rasen`,
  Unix `~/.local/share/rasen`. Store registry already lives there
  (`<gdd>/stores/registry.yaml` — YAML, not "stores.json"). Child 1 puts the project
  registry at `<gdd>/projects/registry.json` and homes at `<gdd>/projects/<home>/`.
  All later children and docs must use this, not `~/.rasen`.
- Reusable atomic-state machinery is `src/core/file-state.ts` (acquireFileLock with
  30s stale-steal + 5s deadline, writeFileAtomically, makeLockErrorFactory) — generic,
  extracted for exactly this kind of second consumer. Copy the
  `updateStoreRegistryState` pattern from src/core/store/foundation.ts.
- Repo config = `rasen/config.yaml` (WORKSPACE_DIR_NAME='rasen', config.ts;
  OPENSPEC_DIR_NAME is a back-compat alias). Parsed resiliently field-by-field in
  src/core/project-config.ts. TWO config-creation sites: init.ts createConfig (~730)
  and workspace-root.ts (~266) — both must mint projectId.
- Q4 ANSWERED in child 1 design.md: registry schema keyed by canonical abs path with
  explicit stored `home` field (never re-derived); locking = file-state.ts lock on
  registry.json.lock; multi-clone rule = path-exact update / moved-repo rebind (home
  reused) / worktree share (git rev-parse --git-common-dir compare) / true clone forks
  with first-free `-N` suffix, fork-when-unsure; stores.yaml merge DEFERRED (D8).
- Resolver API frozen for children 2/4 (src/core/project-home.ts, new):
  `resolveProjectHome(projectRoot, {globalDataDir?, ensure?}) → ProjectHome | null`
  with `homeDir`, `workDir(changeName)` = `<home>/changes/<name>/work`, `archiveDir`
  = `<home>/archive`, `mode`. `ensure:false` is a non-mutating probe. Child 2 consumes
  workDir; child 4 consumes archiveDir. Home-internal layout is decided in child 1;
  siblings must NOT re-derive paths.
- Lazy identity policy: projectId minted at init OR on first home-needing command
  (appended to config.yaml preserving comments); ordinary read commands NEVER write
  into the repo (shared-working-tree safety). Self-heal hook lives in
  resolveRootForCommand (root-selection.ts), throttled by lastSeen < 24h, all errors
  swallowed (precedent: migrateLegacyBrandConfig in cli/index.ts runCli).
- `rasen doctor` has no spec of its own (grep: no rasen/specs/*doctor*); child 1's
  doctor requirements live in the new `project-registry` capability spec. Doctor is
  read-only by documented contract — GC is the explicit `--gc` flag.

### From child 1 implementation (externalize-artifacts-machine-home, implementer, 2026-07-09)

- All 21 tasks implemented and verified. New files: `src/core/project-registry.ts`
  (schema/IO/lock/home-naming/registerProject/GC), `src/core/project-home.ts`
  (`resolveProjectHome`, `touchProjectRegistry`). Edited: `src/core/project-config.ts`
  (projectId parse + `ensureProjectIdInConfig`), `src/core/config-prompts.ts`
  (serializeConfig emits projectId), `src/core/id.ts` (added `toKebabCase`),
  `src/core/store/git.ts` (added `gitCommonDir`), `src/core/init.ts` (registers
  machine home, prints `Machine home: <path>`), `src/core/workspace-root.ts`
  (second config-creation site mints projectId inline), `src/core/root-selection.ts`
  (self-heal hook in `resolveRootForCommand`), `src/commands/doctor.ts` +
  `src/core/relationship-health.ts` (machine-home section + `--gc`).
- Child 2 (T3 workdir) can rely on the FROZEN API exactly as designed:
  `resolveProjectHome(projectRoot, {globalDataDir?, ensure?}) → ProjectHome | null`
  with `homeDir`, `workDir(changeName)`, `archiveDir`, `mode`. `ensure:false` never
  mutates. `projectRoot` must be the ALREADY-RESOLVED planning root (repo- or
  store-side) — the resolver does not walk to find it.
  `touchProjectRegistry(projectRoot, {globalDataDir?})` is also exported from
  `project-home.ts` for anything else needing the self-heal behavior standalone.
- `registerProject`'s worktree-share check shells to `git rev-parse
  --git-common-dir` (new `gitCommonDir` helper in `store/git.ts`) ONLY when a
  same-projectId entry exists at another still-existing path — ordinary
  registration/refresh never invokes git.
- One legitimate behavior change future work should expect: `rasen init` now
  ALWAYS mints/registers a machine home (even in extend mode on an existing
  config) — a pre-existing test asserting byte-identical config.yaml on
  extend-mode init had to be relaxed to "original content is a preserved
  prefix" since init now appends `projectId:` when absent.
- Full `pnpm test` run (see task 7.1 note in this child's own tasks.md) is the
  authority on pass/fail; isolate-rerun any Windows CLI-spawning EBUSY/ENOTEMPTY
  flake before trusting a failure — confirmed at least one such flake
  (`should select all tools with --tools all option` in `test/core/init.test.ts`)
  is pre-existing and unrelated (passes standalone).

### From child 1 review/fix round (2026-07-09)
- `withProjectRegistryLock` (src/core/project-registry.ts) is THE serialization
  primitive for all project-registry writers (GC + projectId mint both use it);
  future callers reuse it, never re-acquire the lock file directly.
- GC deletes ANY unreferenced directory under `<globalDataDir>/projects/` — siblings
  must NEVER park non-home directories there (child 2's work/ layout must live INSIDE
  registered homes).
- GC holds the registry lock during home deletions; if child 2's T3 trees make
  deletions exceed the 30s stale-steal threshold, the TOCTOU race narrowly reopens —
  revisit retention/GC batching in child 2.
- `ensureCliBuilt()` only rebuilds when dist/ is MISSING — after touching src/, always
  `node build.js` before CLI-spawning tests or they run stale code.
- isGitWorktreeSibling predicate: git-common-dir must MATCH and git-dir must DIFFER;
  `git rev-parse --git-common-dir` alone matches any two dirs in one working tree.

### From child 2 planning (externalize-artifacts-t3-workdir, planner, 2026-07-09)

- CONCURRENT-SESSION DIRT CLEARED: `git status` on src/core/templates/** (and all of
  src/) is CLEAN as of 2026-07-09 — the other session's template edits landed. The
  apply-time re-check discipline still stands (tasks.md preamble states it); the
  constraint list's "dirty files" enumeration is now historical.
- THE CLI ONLY READS RUN-STATE; AGENTS WRITE IT. `writeRunState`/`writePortfolioState`
  (src/core/pipeline-registry/) have no production callers — templates instruct the
  LEAD to write auto-run.json/portfolio-run.json directly; the only CLI reader is
  `pipeline resume` (src/commands/pipeline.ts, changeDir = root.changesDir/<name>).
  So T3 externalization is mostly a TEMPLATE-PROSE change + one CLI read path.
- EXPOSURE SURFACES DECIDED (Q5 exposure half): change-scoped payloads carry top-level
  `workDir` — `status --json` (probe-only, never writes) and BOTH instructions payloads
  (the designated ensure/mint surface under child 1's lazy-identity policy);
  `pipeline resume --json` gains `runStateDir` (dir actually read); `rasen context`
  gains root-level `machineHome`. `rasen context` is root-scoped (working set), NOT
  change-scoped — the design doc's "context workDir" shorthand resolves this way.
- Q3 DECIDED: sticky-legacy per file — read workDir-first with change-dir fallback;
  a file already in the change dir keeps living there (no split-brain mid-flight);
  new files born in workDir; no `workDir` in payload → full legacy behavior; archives
  never migrated. Q2 DECIDED: change-scoped research stays T2; bulky raw dumps →
  work/research/ (one-line guidance in propose/explore).
- TEMPLATE EPHEMERA INVENTORY (Q5 audit, exhaustive): _orchestration.ts (Step F
  run-state, Step L goal-run/loop.runArtifact, Step H handoff records, blackboard
  sentence), handoff.ts, auto.ts, ship.ts (write + evidence pre-flight),
  verify-change.ts (2 sites), verify-enhanced.ts, review-cycle.ts, retro.ts (reads),
  archive-change.ts (2 read sites), goal-command/goal-iterate/goal-report.ts,
  experts/_shared.ts (canonical report rule) + dispatched-mode lines in experts/
  {review,cso,qa,qa-only,benchmark,design-review}.ts.
- SPEC-DELTA NOTE: review-cycle-workflow's spec does NOT pin the cycle-report location
  at requirement level (only the template prose does) — no delta needed there; 13 spec
  files shipped in this child's specs/ (1 new `change-work-dir` + 12 modified).
  Several main specs still carry legacy `openspec/` wording (known follow-up) —
  deltas preserved requirement headers verbatim for archive-time sync matching.
- Repo-level no-active-change handoff fallback (`rasen/handoff/<topic>.md`,
  handoff.ts) has no change scope → left as-is, recorded as a follow-up.

### From child 2 apply (impl-t3-workdir, 2026-07-09)
- resolveProjectHome(root,{ensure:true}) THROWS when rasen/config.yaml is entirely
  absent (not just missing projectId); resolveChangeWorkDir's ensure path swallows all
  errors -> null (never break a user command; touchProjectRegistry precedent).
- experts/_shared.ts PREAMBLE is embedded by ~15 expert skills (not just the 6 core
  ones) — any edit there has a wide parity-hash blast radius; verify via the parity
  test, never hand-list consumers.
- pnpm is broken machine-wide right now ("packages field missing or empty", fails on
  bare `pnpm --version`) — pre-existing, NOT repo-caused; use `node build.js` +
  `npx vitest run` as the literal underlying commands.

### From child 3 planning (externalize-artifacts-archive-timing, planner, 2026-07-09)

- NO CLI ARCHIVE COMMAND EXISTS in this fork (no src/commands/archive.ts) — archive is
  entirely skill-driven (agent runs the mv; sync delegates to rasen-sync-specs). The
  decomposition Decision 1 wants (sync vs bookkeeping) ALREADY exists structurally in
  archive-change.ts; child 3 adds only the timing brain. Child 4's `destination`
  should also stay skill-side unless `external` needs CLI path help.
- CONFIG SHAPE DECIDED: nested `archive: { timing: on-merge|in-ship }` block in
  rasen/config.yaml (NOT the design doc's scalar shorthand — the doc defines TWO
  archive axes, child 4's `destination` joins the same map). Resilient parse +
  `resolveArchiveTiming()` default-applying resolver in project-config.ts. Resolved
  value exposed as `archive: {timing}` in status --json (always present; additive).
- Q1 DECIDED (merge confirmation): check-on-invocation, AGENT-side — every archive
  attempt runs `gh pr view <url> --json state,mergedAt` (URL from workDir ship-log);
  OPEN → refuse (named override only; outright non-interactive); CLOSED-unmerged →
  surface, never archive; gh/network/no-URL → "cannot verify" → explicit human
  confirmation replaces the check / refuse non-interactively; unverifiable NEVER
  equals merged. Orchestrated runs park the archive stage as `pending` +
  awaiting-merge note in run-state and end cleanly; resume re-attempts. CLI never
  shells to gh/git (preserves the no-git contract; git-crossing stays in skill prose).
- IN-SHIP ORDERING: sync + bookkeeping move go BEFORE ship's commit (results must ride
  the same delivery); PR-body/task facts captured BEFORE the move (dir disappears).
  Child 2 synergy: ship-log/run-state live in workDir keyed by change name → the move
  can't orphan them. Recorded ship-log facts outrank re-resolved config for
  already-delivered changes (mid-flight config edits never rewrite history).
- DELTA-COLLISION AVOIDANCE PATTERN: child 2's spec sync was still landing while child
  3 proposed — so ALL child-3 deltas on existing capabilities are ADDED requirements
  (new concerns), zero MODIFIED blocks → no dependency on child 2's sync timing.
  Reusable pattern for child 4/5 if they propose while a sibling's archive is in
  flight. 6 spec files (1 new `archive-timing` + 5 ADDED-only deltas).
- Follow-ups recorded: bulk-archive timing awareness; possible future `rasen archive`
  CLI command (only if child 4's external destination needs it).

### From child 3 review loop (2026-07-09)
- Template branch conditions MUST key on RECORDED ship-log facts (Mode:/Archived-in-ship:
  lines), never on re-resolved config — config can flip between ship and archive.
  This is now spec'd ("recorded delivery facts outrank re-resolved config"); children
  4/5 editing ship/archive templates must preserve it.
- archive-change.ts has a step-1.5 pre-status already-archived detection: active-dir
  existence check first, then archive-dir scan. Child 4 (destination config) MUST
  update this scan when archive location becomes config-resolved (it currently
  hardcodes <root>/rasen/changes/archive/) — flag this to child 4's planner.
- workDir is keyed by change NAME — a recycled name inherits the prior change's stale
  work/ contents (ship-log etc). Fail-safe today (HARD STOP), but a real design wart;
  candidate follow-up: key workDir by name+created-timestamp or purge work/ at archive.

### From child 4 planning (planner2, relayed by LEAD, 2026-07-09)
- CORRECTION to child 3 log: legacy CLI `rasen archive` DOES exist (ArchiveCommand in
  src/core/archive.ts, wired at src/cli/index.ts:391 — child 3 only checked
  src/commands/). It syncs+moves with NO timing awareness = bypasses the merge gate;
  child 4 adds a minimal guard (on-merge + pr-delivered + no --yes → refuse, point to
  /rasen:archive; CLI still never shells to gh).
- makeRoot cannot be config-resolved (external home name is registry-stored, async);
  root.archiveDir keeps sync in-repo meaning; new async resolveArchiveDestination
  beside resolveChangeWorkDir carries the destination axis.
- Sticky-union: readers always union in-repo + home archive; config governs WRITES
  only; no migration; prune tombstone = ship-log record.
- Retro/goal-loop do NOT read archive dirs today — "retro reads configured location"
  is future swept-work flow, follow-up outside this portfolio.
- Destructive destinations (external/prune) require: delivery-complete (child 3 gates)
  + clean `git status --porcelain -- <changeRoot>` + prune confirmation; external
  archives share the home GC lifecycle.

### From child 5 planning (externalize-artifacts-sha-stamping, planner, 2026-07-09)

- Ship-side chain stamps ALREADY exist (ship-log records Mode/Branch/Commit/Tree/
  Base/PR + child 3's `Archived in ship:`); only the ARCHIVE end was missing. Child 5
  is TEMPLATE-ONLY (ship.ts, archive-change.ts, bulk-archive-change.ts) — zero CLI
  code, zero config; the thinnest child as intended.
- Chain record design: workDir ship-log = the canonical two-ended journal (append-only
  `## Archive` section; survives every child-4 destination incl. prune). Direction-2
  stamp = archive COMMIT MESSAGE (`…specs synced; ship <short-sha>`), NOT synced spec
  headers (would churn T1 content with delivery metadata at every archive — rejected).
- LATENT STORE BUG found + folded in: ship's PR-body step still reads
  `rasen/changes/<name>/proposal.md` repo-relatively — breaks store mode; fixed to
  status-JSON changeRoot (same pattern as 2d855e1's store-safe paths).
- Store-mode embedding scoped to existing read surfaces: status JSON changeRoot +
  plain agent-side git (`git -C <storeRoot> rev-parse HEAD`); dirty-tree/non-git
  states stamped honestly (`<sha> (store tree dirty at ship time)` / `(store not
  under git)`). Follow-ups recorded: store-side write-back of code-repo SHAs (needs
  store write APIs); chain-record consumers (retro/dashboard); embedding size cap.
- Portfolio planning complete: all 5 children proposed (1-3 shipped, 4 mid-apply at
  child-5 propose time, 5 proposed); child 5's apply MUST verify child 4's landed
  template text before editing (its additions are append-shaped to minimize friction).

### From child 5 implementation (externalize-artifacts-sha-stamping, implementer, 2026-07-09)

- REAL BUG FOUND in the design's store-mode premise: `planningHome.kind` NEVER equals
  `'store'` in the actual status JSON. `toPlanningHome()` (`src/core/root-selection.ts`)
  is a documented "compatibility bridge" hardcoded to `kind: 'repo'` unconditionally,
  even for a store-selected root. The real, already-wired store-mode signal in the same
  `rasen status --json` payload is `root.store_id` (set by `toRootOutput()` whenever
  `--store <id>` or a declared fallback selected a store — see `isStoreSelectedRoot`).
  `root.path` under a store-selected root is the store's absolute filesystem path (what
  `git -C <root.path> ...` needs). Implemented all three templates and both delta specs
  (`sha-cross-stamping`, `opsx-ship-command`) against `root.store_id`, not
  `planningHome.kind`; noted the correction inline in this child's design.md. Any future
  work that wants to ADD an actual `'store'` value to `PlanningHomeKind` should treat
  this as the reason `toPlanningHome()`'s "always repo-shaped" comment exists — it's
  deliberate, not an oversight, so don't "fix" it without checking every prose
  reference to `planningHome.kind` across the portfolio first.
- Chain-record design (D1/D2 from this child's design.md) landed as: ship.ts gets a
  `Store:`/`Store commit:` ship-log field pair (pr mode + store mode only) plus an
  in-ship-only `## Archive` section that names the ship commit as the archive commit;
  archive-change.ts gets a new step 5.5 (`Close the delivery chain`) appending `##
  Archive` to the workDir ship-log before the post-bookkeeping commit and a follow-up
  `Archive commit:` line right after it, plus `ship <short-sha>` in every destination's
  commit message (previously NO commit-message template existed anywhere in this file —
  `git commit -- <path>` had no `-m` at all; this child added the message form fresh,
  not just a suffix onto existing text). bulk-archive-change.ts mirrors both,
  condensed, as step 8b.5.
- FOUND AND FIXED a pre-existing divergence unrelated to this child's own scope, in the
  same guardrails section this child was editing: `bulk-archive-change.ts`'s TWO getters
  had drifted — the skill getter's Guardrails bullet had the fuller
  `--ignored`/`git ls-files` tracked-check wording (child-4-review-round fix), the
  command getter's matching bullet still had the older, weaker
  `git status --porcelain` (no `--ignored`) wording. The actual step-8b BODY was
  already byte-identical and correct in both getters — only this redundant Guardrails
  restatement had silently diverged. Brought to parity while touching this section
  anyway (low-risk, same-file, mechanical). Lesson for any future editor of this
  file: the digest's "verify byte-identity before replace_all" advice caught the
  step-8b body fine, but a SEPARATE spot-check is needed for every other place a rule
  gets restated in prose (Guardrails sections are exactly this kind of restatement).
- Task 5.3 (live smoke: actually ship+archive a scratch change) was SKIPPED — it
  requires real commits in this shared working tree, and this implementer's session
  instruction was explicit "do NOT commit." Left as an open item for whoever has
  commit authority next; static verification (parity tests, full suite, direct
  reading of the regenerated `.claude/skills/rasen-{ship,archive-change,
  bulk-archive-change}/SKILL.md`) was substituted.
- Regen note: `.claude/commands/opsx/*.md` is a STALE legacy `openspec`-branded
  artifact set (content still says "openspec store list", predates the rasen
  rebrand) that `rasen update --force` does NOT touch — do not chase a diff there.
  The live generated Rasen-namespace commands are `.claude/commands/rasen/*.md`;
  verify there instead.
- Parity blast radius confirmed exactly as predicted: 6 function hashes + 3
  generated-skill-dir hashes (getArchiveChangeSkillTemplate,
  getBulkArchiveChangeSkillTemplate, getOpsxArchiveCommandTemplate,
  getOpsxBulkArchiveCommandTemplate, getShipCommandSkillTemplate,
  getOpsxShipCommandTemplate; rasen-archive-change, rasen-bulk-archive-change,
  rasen-ship) — nothing else moved. Full `npx vitest run`: 124 files, 2310 passed,
  22 skipped, 0 failed; the previously-flagged Windows `init.test.ts` "select all
  tools" flake did not reproduce this run.

### From child 5 review round (externalize-artifacts-sha-stamping, reviewer + implementer fix, 2026-07-10)

- VERDICT: DONE_WITH_CONCERNS (0 Blocker / 2 Major / 4 Minor / 4 Trivial), both
  Majors confined to the store-mode × in-ship-timing intersection. LEAD decided
  fix-now (no ship with open Majors). All 2 Majors + 4 Minors fixed in a second
  implementer pass; hashes/tests re-verified green (same 9 parity entries moved a
  second time, full suite still 124/2310/0).
- **M1 fixed**: in-ship store-mode PR-body embedding was reading delta specs from
  `<changeRoot>/specs/**` AFTER the change directory had already moved/deleted in
  step (b).3 — a real data-loss bug (the PR would ship without its review material).
  Fix: step (b).1's capture list now also captures delta spec content when
  `root.store_id` is present, mirroring the existing proposal-capture pattern; the
  embedding step reads the captured copy under in-ship timing, fresh under on-merge.
- **M2 fixed HONESTLY, not fully orchestrated**: the in-ship `## Archive` section
  used to unconditionally assert `Archive commit == Commit` (ship commit). False for
  a store-rooted change — in-ship bookkeeping (spec sync + move) mutates the STORE's
  working tree, a different git repository ship's own commit never touches. Chose
  the LEAD-offered "explicitly marked pending" resolution over inventing new
  store-commit orchestration (store delivery-mode resolution, push, etc. — a real
  scope explosion for a template-prose-only child): ship.ts now records
  `pending — store-side bookkeeping not committed by this workflow` unless the agent
  separately commits the store repo and records that SHA. **KNOWN-OPEN FOLLOW-UP**:
  a genuinely complete in-ship + store-mode flow needs the agent (or new CLI
  surface) to actually commit — and likely push — the store repo's bookkeeping
  mutation; this was NOT implemented, only honestly disclosed. Root cause (in-ship
  bookkeeping being store-blind) predates this child (child 3/4's scope).
- Minors fixed: M3 (bulk command-getter Guardrails bullet was still missing the
  "SEPARATE consent from the batch confirmation in step 7" clause after the first
  parity pass — both getters now byte-identical, verified scripted); M4 (commit
  message no longer unconditionally claims "specs synced" — four conditional forms
  based on whether delta specs actually existed/were synced this run, crossed with
  whether a ship commit is recorded); M5 (`Store:` ship-log line's source annotation
  corrected to `root.path`, was wrongly citing `root.store_id`/`changeRoot`); M6
  (step 5.5's `workDir` resolution now mints on demand like step 5's own prune
  tombstone writer, instead of silently falling back to `changeRoot` — which
  `external`/`prune` are about to move or delete; documented the sticky-legacy edge
  case explicitly, including that a sticky log in `changeRoot` under `prune` has NO
  post-deletion recovery path and must be captured before the `rm -rf`).
- **Reviewer's durable findings, recorded here as known-open follow-ups (NOT fixed
  this round, out of this child's scope per its own report)**:
  - `ship.ts:51` (pre-flight task read: literal `rasen/changes/<name>/tasks.md`) and
    `ship.ts:152`-equivalent (ship-log fallback literal) misresolve for store-rooted
    changes — same bug CLASS as the proposal-read fix this child already shipped,
    just at different call sites. Candidate for a small follow-up child.
  - The CLI-side archive path (`src/core/archive.ts`, the legacy `rasen archive`
    command that writes prune tombstones) writes NO chain records — the
    `sha-cross-stamping` capability is agent-workflow-only by design of this child;
    don't read it as covering CLI-driven archives.
  - Store-mode paths (PR-body embedding, `Store:`/`Store commit:` stamps, and now
    M1/M2's fixes) have never been LIVE-exercised — only statically verified
    (generated SKILL.md inspection + code-level premise checks). Recommend a
    store-mode live smoke as a follow-up item, separate from and in addition to the
    still-outstanding repo-mode task 5.3.
