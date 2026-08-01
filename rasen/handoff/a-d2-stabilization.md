# Handoff: A–D2 stabilization — LEAD #1

## Original intent

The user first asked for an evidence-based review of the real completion state
against:

- `rasen/explorations/global-store-project-unification-development-plan.md`
- `C:\Users\Sayo\.rasen\projects\autonomy-ladder-1e42477e\changes\store-context-unification\work\handoff\portfolio-pause-1.md`

After the review, the user clarified that pausing after D2 was intentional for
handoff and that E/F are intentionally unstarted. The current explicit request
is:

> `$rasen-auto small-feature 现在一个changes来做A–D2 stabilization`

Interpretation locked by the conversation: create exactly ONE new Rasen change
for A–D2 stabilization, run the explicit `small-feature` pipeline end-to-end,
and do not implement Phase E or F in this change.

The user selected automatic session relay after the `rasen-auto` context
pre-flight fired.

## Position

Pipeline selected explicitly: `small-feature`.

Completed stages: none. No stabilization change has been created yet.

Current stage: pre-flight handoff before `propose`.

The predecessor did not dispatch any workers and made no stabilization edits.
The only files written during the handoff are this document and its relay
prompt.

## Done / Remaining

Done:

- Reconstructed the true A–F portfolio state from plan, handoff, child changes,
  commits, source, specs, and tests.
- Wrote the canonical audit to:
  `C:\Users\Sayo\.rasen\projects\autonomy-ladder-1e42477e\changes\store-context-unification\work\verification-report.md`
- Established that A–D2 are locally implemented/archived, while E/F are
  intentionally unstarted.
- Classified the nine unchecked archived A–D2 tasks:
  - four archive rehearsals were actually performed but never ticked;
  - four literal `full suite green` gates are not satisfied by the current
    baseline;
  - C task 9.4 is a real UI/localization omission.
- Verified current focused evidence:
  - Identity: 84/84 passed.
  - Membership/provider/record/space/health: 105 passed; three `doctor` tests
    timed out at 10 seconds with cleanup EPERM.
  - Runtime: 93/93 passed.
  - Launch-session UI: 15/15 passed.
  - Learned D1/D2: 130 passed, 2 skipped.
  - `pnpm lint` and `pnpm build` passed.
- Reproduced current known failures:
  - `test/release-contract.test.ts`: suite import `SyntaxError`;
  - `test/commands/handoff.test.ts`: stale `maxRelays: 3` assertion;
  - CLI locale test: installed-skill version warning on stderr.
- Verified the manual pre-ship scan is currently clean for NUL bytes, staged
  binaries, and archived Purpose placeholders.

Remaining:

- Create one new change with a clear stabilization name.
- Run `small-feature`: propose → apply → verify → review-loop → ship → archive.
- Stabilization scope to cover, subject to planner re-derivation:
  1. Repair decomposed-parent resume/frontier behavior: the paused parent says
     E/F remain, but `rasen pipeline resume store-context-unification --json`
     incorrectly returns `next: ship`.
  2. Finish C task 9.4: distinguish rootless Store members from an empty Store
     and state that planning-only grants no code writes, with en/ja/zh-cn
     parity and tests.
  3. Replace alias-keyed frozen Store knowledge identity with UID authority,
     preserving a fail-closed legacy read/migration path.
  4. Unify the learned-skill evaluation-root fallback:
     `context.ts:770` currently uses `process.cwd()` while
     `effective.ts:487` uses the resolved project root. E/F will consume this
     seam, so fix it before they begin.
  5. Reconcile the nine archived task checkboxes without fabricating evidence:
     use durable rehearsal evidence for the four stale boxes; treat C 9.4 as
     real work; obtain a truthful combined A–D2 verification result for the
     four full-suite gates, or revise the gate wording through an explicit spec
     decision rather than ticking false statements.
- Do not implement E/F bootstrap or portable bundle code.
- Do not fold the separate repository-level NUL guard, broad `docs/zh` debt,
  `RuntimeExecutionRef.home?`, `listStoreMemberCandidates`, or final branch
  rebase/integration into this change unless the planner proves one is a direct
  prerequisite. The portfolio handoff deliberately assigned some of these to
  separate follow-ups.

## Key decisions (and why)

- One change only — the user explicitly requested one stabilization change.
- Explicit pipeline `small-feature` — do not classify or substitute another
  pipeline.
- E/F remain out of scope — their unstarted state is intentional, not a defect
  to fix in stabilization.
- Do not mechanically treat all nine unchecked boxes as nine code tasks —
  four are stale bookkeeping, four are verification gates, and one is a real
  implementation omission.
- Author must differ from verifier — use role-isolated workers and a non-author
  review loop exactly as `rasen-auto` requires.
- Parent `pipeline resume` is not trustworthy until fixed — do not use its
  current `ship` frontier as authority for the portfolio.

## Dead ends & gotchas

- `rasen status --change store-context-unification --json` reports the parent
  umbrella change as artifact-blocked because it intentionally has no
  proposal/spec/design/tasks. The real portfolio progress lives in external
  `portfolio-run.json` and child changes.
- The parent's `auto-run.json` encodes delegated stages as `skipped`; current
  resume counts them complete and exposes `ship`, ignoring E/F in the portfolio
  frontier. This is the resume defect to specify and test, not evidence that the
  portfolio is ready.
- The working tree is shared and dirty. Existing changes under
  `packages/ui/**`, `rasen/config.yaml`, `docs/handoff/`, the E/F proposal
  directories, `simplify-pipeline-handoff-ui`, and explorations belong to the
  user/concurrent work. Preserve them; never use `git add -A`.
- C task 9.4 needs the same UI locale files that are currently modified by a
  concurrent session. Re-take `git status` before proposing/applying and edit
  narrowly without staging or overwriting unrelated hunks. If ownership still
  conflicts materially, record and sequence it instead of erasing user work.
- Two large vitest batches exceeded a five-minute command limit. Smaller
  serial batches produced reliable evidence. Never run concurrent vitest
  batches; prior work observed spurious timeouts.
- `git diff --check d73c1da2..HEAD` currently reports twelve spec files with a
  new blank line at EOF.
- The branch `feat/store-context-unification` diverges from cached
  `origin/dev/0.1.5` and carries four commits from a concurrent session. Final
  integration is deferred until after E/F; do not rewrite history during this
  stabilization change.

## Eliminated hypotheses

- “Five of seven delivered means ship-ready” — ruled out by E/F 0/159 tasks,
  the parent frontier contradiction, missing E/F source entry points, and the
  absence of an integrated candidate.
- “All nine unchecked tasks are missing implementation” — ruled out by the
  archive rehearsal evidence and the task text itself.
- “A–D2 are merely paper-complete” — ruled out by implementation commits,
  archived specs, large source surfaces, and 427+ focused passing tests.
- “The current full suite is green except for unverified folklore” — ruled out
  by direct reproduction of release-contract, handoff, and CLI-locale failures.

Current best framing: this is a bounded A–D2 correctness/coherence stabilization
change that makes the existing foundation safe and truthful before E starts.

## Working set

Important evidence and likely implementation seams:

- `C:\Users\Sayo\.rasen\projects\autonomy-ladder-1e42477e\changes\store-context-unification\work\verification-report.md`
- `C:\Users\Sayo\.rasen\projects\autonomy-ladder-1e42477e\changes\store-context-unification\work\auto-run.json`
- `C:\Users\Sayo\.rasen\projects\autonomy-ladder-1e42477e\changes\store-context-unification\work\portfolio-run.json`
- `src/commands/pipeline.ts`
- `src/core/pipeline-registry/run-state.ts`
- `src/core/learned-skills/types.ts`
- `src/core/learned-skills/context.ts`
- `src/core/learned-skills/effective.ts`
- `src/core/templates/workflows/retain.ts`
- `packages/ui/src/components/LaunchSessionDialog.tsx`
- `packages/ui/src/i18n/locales/{en,ja,zh-cn}.json`
- archived A–D2 `tasks.md` files under `rasen/changes/archive/`

Current branch: `feat/store-context-unification`, `HEAD=2131f987`.

## Next action

From the repository root, invoke the explicitly selected workflow:

```text
$rasen-auto small-feature Create exactly one new Rasen change for A–D2 stabilization. Read rasen/handoff/a-d2-stabilization.md first and treat its locked scope, exclusions, evidence, and dirty-worktree warnings as authoritative. Do not implement E or F.
```

The successor LEAD must run the `rasen-auto` pre-flight, display the resolved
gate/selection policy and runtime table, choose a collision-free change name,
then dispatch a planner worker for `propose`. Do not resume the paused portfolio
parent into `ship`.
