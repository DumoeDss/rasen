# Planning context — stabilize-store-context-foundation

Seeded by the LEAD before the first propose. Read this FIRST, then research only
what is missing.

## User intent (verbatim)

> `$rasen-auto small-feature 现在一个changes来做A–D2 stabilization`

Locked interpretation, carried across a session relay and re-confirmed by the
user's successor prompt:

- Create **exactly ONE** new Rasen change for A–D2 stabilization.
- Run the explicit **`small-feature`** pipeline end-to-end.
- **Do NOT implement Phase E or Phase F.**

Authoritative predecessor distillate:
`rasen/handoff/a-d2-stabilization.md` (repo-relative). Read it. Its locked
scope, exclusions, evidence, and dirty-worktree warnings are authoritative and
are NOT to be re-litigated.

## Where the portfolio state actually lives

This change is a follow-up to a paused 7-part portfolio (`A`..`F`) whose parent
umbrella change is `store-context-unification`.

- Parent planning dir: `rasen/changes/store-context-unification/` — it has no
  proposal/design/specs/tasks **by design** (it is a planning container), so
  `rasen status --change store-context-unification --json` reporting it as
  artifact-blocked is expected, not a defect.
- Real portfolio progress lives externally:
  - `C:\Users\Sayo\.rasen\projects\autonomy-ladder-1e42477e\changes\store-context-unification\work\portfolio-run.json`
  - `C:\Users\Sayo\.rasen\projects\autonomy-ladder-1e42477e\changes\store-context-unification\work\auto-run.json`
  - `C:\Users\Sayo\.rasen\projects\autonomy-ladder-1e42477e\changes\store-context-unification\work\verification-report.md`
    (the predecessor LEAD's canonical evidence-based audit — read this)
  - `C:\Users\Sayo\.rasen\projects\autonomy-ladder-1e42477e\changes\store-context-unification\work\handoff\portfolio-pause-1.md`
- Development plan: `rasen/explorations/global-store-project-unification-development-plan.md`
- A–D2 are shipped and archived; their `tasks.md` files are under
  `rasen/changes/archive/`.

## Established state (do not re-derive from zero)

- A, B, C, D1, D2 are locally implemented, shipped, and archived.
- E (`store-bootstrap-and-hydration`, 81 tasks) and F
  (`portable-project-knowledge`, 78 tasks) are **proposal-only, 0 tasks done,
  and intentionally unstarted**. Their unstarted state is a deliberate pause,
  not a defect for this change to fix.
- Focused evidence already gathered by the predecessor:
  - Identity 84/84 pass; membership/provider/record/space/health 105 pass
    (three `doctor` tests timed out at 10s with cleanup EPERM); runtime 93/93
    pass; launch-session UI 15/15 pass; learned D1/D2 130 pass 2 skipped.
  - `pnpm lint` and `pnpm build` pass.
- Reproduced pre-existing failures on this branch (NOT caused by this change):
  - `test/release-contract.test.ts` — suite import `SyntaxError`
  - `test/commands/handoff.test.ts` — stale `maxRelays: 3` assertion
  - CLI locale test — installed-skill version warning on stderr
  - **Added in review round 3:** this list is what the predecessor reproduced,
    not the complete set. The combined run found a **fourth**,
    `test/commands/workset.test.ts` (Windows temp-cleanup flake, 41/41 in
    isolation). `combined-verification-A-D2.md` is the authority on all four.
- `git diff --check d73c1da2..HEAD` reports twelve spec files with a new blank
  line at EOF.

## Scope to re-derive and specify (planner owns the final decomposition)

The predecessor identified these five stabilization items. Treat them as the
candidate scope, and confirm/refine each against the code before writing specs.

1. **Decomposed-parent resume frontier is wrong.** The paused parent still has
   E/F remaining, but `rasen pipeline resume store-context-unification --json`
   returns `next: ship`. The parent's `auto-run.json` encodes delegated stages
   as `skipped`; resume counts `skipped` as complete and exposes `ship`,
   ignoring the portfolio children entirely. Specify and test the correct
   portfolio-aware frontier. Seams: `src/commands/pipeline.ts`,
   `src/core/pipeline-registry/run-state.ts`.
   **This is a real safety defect — the current `ship` frontier must never be
   used to jump the paused portfolio to delivery.**

2. **Finish archived C task 9.4** (a genuine implementation omission): the
   launch-session UI must distinguish a **rootless Store member** from an
   **empty Store**, and state that a planning-only grant confers no code-write
   permission. Needs en/ja/zh-cn locale parity plus tests. Seams:
   `packages/ui/src/components/LaunchSessionDialog.tsx`,
   `packages/ui/src/i18n/locales/{en,ja,zh-cn}.json`.

3. **Store knowledge identity must be UID-authoritative.** Frozen Store
   knowledge is currently keyed by alias; replace with UID authority while
   preserving a **fail-closed** legacy read/migration path. Seams:
   `src/core/learned-skills/types.ts`, `effective.ts`,
   `src/core/templates/workflows/retain.ts`.

4. **Unify the learned-skill evaluation-root fallback.**
   `src/core/learned-skills/context.ts:770` falls back to `process.cwd()` while
   `src/core/learned-skills/effective.ts:487` uses the resolved project root.
   E and F will both consume this seam, so it must be consistent before they
   start.

5. **Reconcile the nine unchecked archived A–D2 task checkboxes truthfully.**
   The predecessor already classified them — do NOT treat all nine as nine code
   tasks:
   - **Four** are archive rehearsals ~~that were genuinely performed but never
     ticked → tick them citing the durable rehearsal evidence~~. **Refuted
     during apply and corrected in review round 3:** no rehearsal was ever
     performed, and two of the four boxes say so in their own text (D1 10.5
     "deliberately not run", C 12.5 "deferred to the ship/archive stage"). This
     instruction was therefore deliberately NOT followed — following it would
     have ticked four boxes against evidence that does not exist. Each box was
     restated instead, and settled against the archive commit that performed the
     merge the rehearsal was a proxy for, with the substitution recorded on the
     line. The classification error propagated from here into design D6 and into
     `tasks.md` 5.1; all three are now corrected.
   - **Four** are literal `full suite green` gates that the current baseline
     does NOT satisfy → either obtain a truthful combined A–D2 verification
     result, or revise the gate wording via an explicit spec decision. **Never
     tick a false statement.**
   - **One** is C task 9.4 → real work, item 2 above.

## Hard exclusions (do not widen scope)

- No Phase E bootstrap/hydration code. No Phase F portable-bundle code.
- Do not fold in, unless you can *prove* it is a direct prerequisite:
  the repository-level NUL guard, broad `docs/zh` debt,
  `RuntimeExecutionRef.home?`, `listStoreMemberCandidates`, or the final
  branch rebase/integration. The portfolio handoff deliberately assigned these
  to separate follow-ups.

## Working-tree hazard (read before editing anything)

The working tree is **shared and dirty**, with a concurrent session actively
editing `packages/ui/**`.

- Modified by others right now: `packages/ui/src/**` (incl. all three
  `i18n/locales/*.json` — exactly the files item 2 needs), `rasen/config.yaml`,
  `packages/ui/test/**`.
- Untracked and owned by others: `docs/audits/`, `docs/handoff/`,
  `rasen/explorations/*`, and the E/F change directories
  (`store-bootstrap-and-hydration`, `portable-project-knowledge`,
  `simplify-pipeline-handoff-ui`).
- Rules: **never `git add -A`**; re-take `git status` before editing; edit
  narrowly; never stage or overwrite unrelated hunks. If ownership conflicts
  materially on the locale files, record and sequence it rather than erasing
  concurrent work.
- Do **not** rewrite branch history during this change.

## Test-execution discipline (learned the hard way)

- Two large vitest batches exceeded a five-minute command limit.
- Run **smaller serial batches**. **Never** run concurrent vitest batches —
  prior work observed spurious timeouts from doing so.
- Any command expected to exceed ~2 minutes runs backgrounded with bounded
  foreground polling at intervals of at most 270 seconds.

## Branch

`feat/store-context-unification`, `HEAD=2131f987`. It diverges from cached
`origin/dev/0.1.5` and carries four commits from a concurrent session. Final
integration is deferred until after E/F.

## Append below: durable findings from each stage

<!-- Workers append durable discoveries (decisions, discovered constraints).
     Not chatter, not status recaps. -->

### propose (planner)

- **The item-1 root cause is upstream of `completedStages`.** `pipeline resume`
  already has a portfolio branch that outranks stage-based resume. It never fired
  because `portable-project-knowledge` carries `status: "propose-done"`, outside
  the child status enum; `readPortfolioState` catches every validation error and
  returns `null`, and the caller reads `null` as "not a portfolio". Only after
  that silent downgrade does delegated-as-`skipped` leave `ship`. Fixing
  `completedStages` alone would not have fixed the bug.
- **`readPortfolioState` / `parsePortfolioState` swallow validation errors by
  design** (`portfolio-state.ts:114-122`). Any safety property built on "we read
  the portfolio record" is only as strong as that record's schema — one
  out-of-enum value disarms it entirely and silently.
- **Item 4's direction was right but its stated reason was wrong.**
  `learned-skill-effective-materialization` already specifies the current
  directory as the fallback, so `context.ts`'s `process.cwd()` looks conformant in
  isolation. The clause it defers to (`session-runtime-context`: explicit selector
  → session context → working directory, "a later step SHALL NOT be consulted once
  an earlier one has answered") settles it: `context.ts` is the violation because
  it reaches for cwd after an owner was already resolved. Fall back to the
  resolved checkout; cwd stays the genuine last resort for Store/global owners.
- **The three known suite failures are provably not this portfolio's.**
  `test/release-contract.test.ts` and `scripts/release-contract.mjs` are
  byte-identical to base `d73c1da2` (empty `git diff d73c1da2..HEAD`), so that
  failure pre-dates every A–F commit. ~~`test/commands/handoff.test.ts` traces to
  `313df542`, one of the four concurrent-session commits.~~ **Refuted during
  apply and corrected in review round 2:** `git show 313df542 | grep maxRelays`
  returns no matches; the assertion went stale at `58faffad`, which
  `git merge-base --is-ancestor 58faffad d73c1da2` shows is an ancestor of the
  branch base. Byte-identity to base is a cheap, checkable attribution technique
  worth reusing — and this is exactly why: it settled the question against the
  planning premise rather than for it.
- **The manual pre-ship NUL scan covers `src/**` and `test/**` but not
  `scripts/**`** — and `scripts/` holds modules the test suite imports.

### apply (implementer)

- **`rasen archive` can be rehearsed with zero blast radius** by copying
  `rasen/config.yaml` + `rasen/specs/` + the one change directory into a scratch
  root and running `node bin/rasen.js archive <change> --json --yes` with cwd set
  there. It resolves its root from cwd, so the real tree is never moved and main
  specs are never written. This closes the gap every A–D2 child recorded as
  "archive has no dry run, so I cannot rehearse without archiving".
- **A frozen-identity upgrade must not become a write-side refusal.**
  `registerStore`/`commitStoreRegistration` record metadata `{version:1, id}` and
  mint NO uid — only `store setup` and `store upgrade-identity` do. So a Store
  reached through ordinary registration has no permanent identity, and refusing
  to freeze against it would break retain runs that work today. The durable rule:
  fail-closed belongs on the READ side (an unsettleable name refuses); the write
  side falls back to the older record shape. `FrozenKnowledgeContext` is now
  v1|v2|v3, and `freezeKnowledgeContext` picks v3 only when every ref has an
  identity.
- **Widening a shared status enum has a mandatory three-file tail:**
  `src/core/management-api/wire-types.ts`, the hand-maintained mirror in
  `packages/ui/src/api/types.ts`, and any `Record<Status, …>` exhaustive map
  (here `STAGE_GLYPHS` in `SessionRow.tsx`). Only the last one fails the build;
  the mirror drifts silently. Also: a portfolio CHILD's vocabulary and a parent
  STAGE's vocabulary are now separate types — `delegated` is a parent-only state,
  `proposed`/`unknown` are child-only.
- **Byte-identity to the branch base is the cheapest honest attribution, and it
  reached further than planning expected.** All FOUR failures in the combined run
  — including `test/commands/handoff.test.ts`, which planning attributed to
  concurrent-session commit `313df542` — are byte-identical to base `d73c1da2`.
  The `maxRelays: 3` assertion actually went stale at `58faffad`, an ancestor of
  the base (`git log -S "<literal>" -- <file>` plus
  `git merge-base --is-ancestor` is the two-command proof). A fourth failure
  (`test/commands/workset.test.ts`) appeared that planning had not listed; it is
  the known Windows temp-cleanup flake and passes 41/41 in isolation. Never
  assume the known-failure list is complete — enumerate and attribute each file.
- **`skill-templates-parity` needs BOTH hashes regenerated** after any workflow
  template edit: `EXPECTED_FUNCTION_HASHES.<getter>` and
  `EXPECTED_GENERATED_SKILL_CONTENT_HASHES['<dir>']`. Run the file, paste the
  received values, and re-run — a second template edit invalidates them again.

### apply, review round 1 (implementer)

- **"Better evidence" is still a deviation, and must be recorded as one.**
  Settling a gate against evidence STRONGER than the evidence it named is not
  automatically honest: if the box's own text says the named work was not done, a
  `[x]` beside it is a false statement no matter how good the substitute is. The
  repair is the restate-then-settle mechanism, not a stronger citation. Applies
  to any gate reconciliation: state the original, state that its named evidence
  was never obtained, restate the outcome actually owed, settle that.
- **A tick's evidence pointer must survive archiving.** Citing a path under the
  machine-local `work/` directory makes the tick uncheckable for everyone else,
  since that directory is untracked and single-machine. Put the verification
  artifact IN the change directory (it archives with the change) and inline the
  one-command evidence in the citation itself.
- **`[].every(...)` is a live hazard in every completeness predicate here.**
  `isPortfolioComplete` reported a zero-child portfolio complete. Any
  `children.every(isTerminal)` over a schema-defaulted array needs an explicit
  `length > 0`. Worth grepping for on the next portfolio/registry change.
- **Recorded CLI evidence must be captured AFTER the final `pnpm build`.**
  `bin/rasen.js` runs from `dist/`, so a JSON artifact captured mid-change
  silently records pre-fix behavior and reads as a missing feature at review.

### apply, review round 2 (implementer)

- **A refuted premise must be swept out of EVERY artifact, not just the line the
  reviewer cited.** Round 1 corrected `tasks.md` 5.1 and D6's table for
  propagating a false premise and left the identical falsehood three paragraphs
  below in the same two files, plus a third copy in `planning-context.md`. The
  durable rule: when evidence refutes a planning claim, `grep` every SHA and
  every count across `proposal.md`, `design.md`, `tasks.md`, the specs, and the
  planning context, and reconcile all of them against the one artifact that now
  holds the truth. All of these archive together and become the permanent record.
- **A ticked task whose own text says "to be re-confirmed" is a trap.** Task 6.4
  said the planning attribution was "to be re-confirmed against the final tree".
  It was re-confirmed and REFUTED — and then ticked with the refuted sentence
  still in it. Re-confirming a premise means editing the premise when it fails,
  not just recording the new finding somewhere else.
- **When you scope one instance of a claim, enumerate every SIBLING of that claim
  in the same file before reporting done.** I flagged the rename scenario as
  over-broad and missed the namesake scenario eight lines below it, which failed
  in exactly the same way — the fourth instance of "correct for every site named,
  incomplete one step over". Scoping a requirement is not a per-line edit; list
  all of its scenarios and test each against every arm of the new condition.
- **`validate` looks for SHALL/MUST on the FIRST BODY LINE of a requirement, not
  anywhere in its prose** (`validator.ts` `getRequirementText` returns the first
  non-blank, non-metadata line; `containsShallOrMust` tests only that). Reflowing
  a requirement's opening sentence — same words, same meaning — can push the
  keyword to line 2 and fail validation with a message that reads as if the
  keyword were missing entirely. When editing requirement prose, keep SHALL/MUST
  on the first wrapped line.
- **Sweep by CLAIM, not by pattern — a falsehood that is neither a SHA nor a
  number is invisible to both.** Round 1 swept by line number, round 2 by SHA and
  count; all three rounds were complete for every site named and missed the same
  proposition one file over. The working method is to enumerate the PROPOSITIONS
  the evidence refuted, then ask of every artifact "does this assert it, in any
  wording?" — including narrative prose no grep reaches. `proposal.md` earns its
  own pass: it is the only artifact that leaves the repo (it is the PR body), and
  a false clause there is the change's outward-facing self-description.
- **"Necessary" and "sufficient" are not interchangeable when checking whether a
  spec covers a fix.** `opsx-pipeline-registry`'s "delivery only once every child
  has finished" is a NECESSARY condition, vacuously satisfied by zero children —
  it permitted the zero-child guard without requiring it, while the sibling
  SUFFICIENT scenario ("children have all finished ⇒ can deliver") arguably
  demanded the opposite. Silent-to-contradictory is a genuine spec gap and a
  legitimate spec edit; "the code disagrees with the spec" is not. Check the
  quantifier direction before claiming a requirement covers a behavior.
