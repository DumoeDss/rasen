# Planning context — store-bootstrap-adopt-local (Phase E, child 2 of 4)

Seeded by the LEAD before propose. Read this FIRST, then research only what is
missing. This is a **carve from an existing design**, not a new design — E's
complete proposal/design/tasks/spec already exist and you are extracting E2
from them.

## User intent

The A–F Store/context portfolio was split into 8 children. **E1
(`store-bootstrap-diagnose`) shipped at `f11daa1d`** after 4 review rounds.
This change is **E2: the project-first apply half of Phase E** — the first
child that WRITES. The user asked the LEAD to drive it end-to-end via
`small-feature`.

Locked scope:
- Implement the **acting-on-what's-already-local** half: register the current
  checkout, register present-unregistered Stores (consent-gated), prepare the
  knowledge location, idempotent reruns, and durable declaration writing.
- Do NOT retrieve/clone from the network (that is E3 `store-bootstrap-obtain`).
- Do NOT touch ordinary-command repair text or doctor (that is E4
  `store-bootstrap-repair-text`).
- Do NOT implement any Phase F work.

## Where E's existing work lives — reuse it

`rasen/changes/store-bootstrap-and-hydration/` holds the COMPLETE proposal,
design, 81-task list, and delta spec for all of Phase E. **Read all four.**
Your job is to CARVE E2 out of them, preserving wording and decisions wherever
a requirement belongs to E2 — not to reinvent the design.

- `proposal.md`, `design.md`, `tasks.md`
- `specs/store-bootstrap/spec.md` — E's 10 ADDED requirements (E1 already
  landed 7 of them; E2 lands 2 more and MODIFYes one of E1's).

E1's shipped artifacts (`rasen/changes/store-bootstrap-diagnose/`) are the
contract you deepen — read its `proposal.md`, `design.md` (especially **D6**),
`specs/store-bootstrap/spec.md`, and `tasks.md`.

### E2's task groups (from E's tasks.md)

- **Group 5 (project-first apply), minus the clone branch** — 5.1 register the
  current checkout; 5.3 verify each Store's record of this project after the
  Store is available; 5.4 order steps as state-machine states so an
  interruption leaves a resumable state. **5.2 splits at the "obtain" verb:**
  "register a present-unregistered Store" is E2; "obtain and register an
  absent-with-remote Store" is E3. 5.5's tests split along the same line.
- **Group 6 (knowledge location preparation)** — one seam backed by child D2's
  knowledge home; create empty base directories only, invent no content, import
  nothing; plan an explicit portable bundle import as a SEPARATE reported step
  but do not perform it (that is F4).
- **Group 9 (idempotence)** — a rerun rewrites no identity, creates no duplicate
  registration, changes no recorded path, re-imports nothing; JSON marks
  `already_registered`/`already_hydrated`; display-name/remote drift is reported
  and NEVER auto-corrected.
- **Group 10 (durable declarations + pasteable hints, design D7)** — every
  declaration goes through `writeDurablePointer`; record the object form with
  permanent identity AND display name (when the Store has one); a Store with no
  display name reports the limitation rather than writing a declaration that
  silently fails; every printed selector is unambiguous.

Approximate task count: ~33 (E1 estimated 52 and shipped 62 — treat this as a
**floor**, see the calibration note below).

### Requirement structure for E2

- **ADD** *A declaration bootstrap writes is durable and usable* (E's
  requirement 8, verbatim).
- **ADD** *Running bootstrap again changes nothing that is already correct*
  (E's requirement 7, verbatim — no longer vacuous because this child writes).
- **MODIFY** E1's requirement 3 — *Starting from a project clone, every
  declared Store is classified and reported* — to add registering the current
  checkout, preparing the knowledge location, and re-verifying membership after
  a Store becomes available. **Read E1's requirement 3 verbatim first** (all 7
  of its scenarios) and preserve its wording; E2 deepens, it does not rewrite.

E1 landed **7 requirements / 35 scenarios** (the delta spec, frozen at
`f11daa1d`). Requirement 3 is your only MODIFIED target. Do not MODIFY any other
E1 requirement unless you can prove E2 deepens it — and if you do, say so
explicitly with the proof.

## THE INVARIANT — and the hole in it

**E2's stated invariant:** nothing is retrieved from anywhere, and no repository
checkout is created. Every write lands in machine-local state this machine
already owns, PLUS the project's own declaration when explicitly asked. No
network, no `git`, no new checkout.

**The hole (the reason E2 is rated medium-heavy to review):** the durable
declaration is the one write that lands in a **Git-tracked file in the user's
repository**, and it is where child A lost the most time — a bare string
written into a tracked file that then could not resolve. E's task 10.5 rule is
non-negotiable here: **assert what LANDS IN THE FILE, not what the message
says.** An invariant with an "except" is not really an invariant (E1's own
finding); budget for the heavier review.

## Three binding constraints inherited from E1's design.md D6

These are **settled decisions E2 must honor**, not suggestions:

1. **Construction-time `mutates` field on repairs — E2 OWNS this.** E1 deferred
   it because "E2 is the change that adds most of the mutating repairs;
   introducing the shape now would mean E1 defining a field it barely
   exercises." Replace E1's `BOOTSTRAP_MUTATING_COMMANDS` prefix list with
   mutation declared where a repair is CONSTRUCTED —
   `{ kind: 'command'; command: string; mutates: boolean }` — so a new repair
   cannot be added without stating whether it writes. E1's exact words: "E2
   inherits this as a settled decision."

2. **`diagnostic.fix` is a second command channel no filter covers.** E1's
   `isMutatingRepair` inspects `BootstrapRepair[]` and cannot see a command
   embedded mid-string in a `fix` — and E1 VIOLATED this one round after
   writing it down (R3 Major, by rendering `diagnostic.fix` and putting three
   state-changing commands under an undetermined answer). The construction-time
   `mutates` field from (1) **must govern both channels**, or the defect
   returns the first time someone renders a payload more completely. Any rule
   about what commands may be offered must cover `diagnostic.fix`, not only
   `repair[]`.

3. **Two rules for composed readers** (both E1 Blockers were this defect class
   at two layers): (a) a composed reader in this repo has two failure modes —
   throwing, and degrading to a diagnostic while returning a plausible value —
   and `try/catch` catches only the first, so any surface computing an end
   state must consult the diagnostics it collected; (b) a repair that changes
   state may only be offered against an answer that was **established**, never
   against an unknown.

## The `--yes` asymmetry (adjudicated in E's tasks 7.5 and 12.2 — do not re-litigate)

- **Project-first (E2's half):** `--yes` MAY obtain/register the Stores the
  project itself declares, because the expected set comes from the user's own
  committed configuration and a scripted setup that stops halfway is unusable.
- **Store-first (E3's half):** `--yes` MUST NOT obtain projects — a Store's
  roster is authored by others and can grow without the local user knowing.
- Do NOT unify the two behind one predicate.

E2 owns the project-first side only. E3 owns store-first.

## Calibration from E1 (this is why the sizing is a floor)

E1 estimated 52 tasks and shipped **62** (the gap is landed-code drift that
became real work once group 1 ran — every A–D2 child experienced this). E1
took **4 review rounds and 12 findings**, and the §9 calibration explicitly
says: the collapsing invariant only collapses ONE axis. "Writes nothing on any
path" made every write-safety question free, and **neither of E1's two Blockers
was a write-safety question** — one was a crash, one was a confident wrong
answer. E2 has no collapsing invariant (it writes, with an "except"). So expect
E2 to review at least as heavily as E1, despite fewer tasks.

## Ground truth (verified by the LEAD and an Explore agent, 2026-07-26)

- **E1 is shipped at `f11daa1d`, review-clean, delta spec frozen.** E1 is NOT
  archived (`archive.timing: on-merge`, branch unmerged), so
  `rasen/specs/store-bootstrap/` does NOT exist yet. E2 may propose/apply/ship
  (its MODIFIED target is frozen in E1's delta); **E2's archive must follow
  E1's archive** (the MODIFIED target must exist in main specs). Same
  serialization as the prior changes — not a blocker for starting.
- **F1 (`knowledge-bundle-export`) is in a SEPARATE worktree**
  (`OpenSpec-code-wt-knowledge-bundle-export`, branch
  `feat/knowledge-bundle-export` at `968482cf`). It will not touch this tree.
  E2 does NOT need its own worktree — its touch set is disjoint from F's and
  from the concurrent UI session.
- **Concurrent UI session** still owns 19 files in this tree: all of
  `packages/ui/**` + `rasen/config.yaml`. E2's touch points
  (`src/core/store/**`, `src/commands/**`, `src/locales/*.json`) are fully
  disjoint. The three shared append-type files (`command-registry.ts`,
  `src/locales/{en,ja,zh-cn}.json`, `identity-boundaries.test.ts`'s
  `PHASE_A_FILES`) are also not in the concurrent set — no hunk-level staging
  needed, a narrow pathspec suffices.
- **`store-bootstrap-and-hydration/` must NOT be modified, moved, or deleted.**
  It is the source material for E3/E4. Re-deriving E's remainder into E3 is a
  separate step. E2 archives before E3 begins (E2→E3 is a HARD edge: both would
  MODIFY E1's requirement 3, and concurrent MODIFIED owners on the same
  requirement force serialization — `specs-apply.ts:305-310`).

## Repo conventions that bite (E1 paid for each of these)

- Specs in **user-facing product behavior language**; mechanism in `design.md`.
- Cross-platform: `path.join`/`path.resolve`, no hardcoded separators, tests use
  `path.join` for expected values.
- **`validate` looks for SHALL/MUST only on a requirement's FIRST body line** —
  reflowing an opening sentence fails validation with a misleading message.
- **`rasen validate <change> --changes` validates ALL active changes**; summary
  totals always show ~10–22 failures from delta-less portfolio container dirs.
  Read the per-item `valid` for YOUR change.
- New messages through a `*-messages.ts` module — no inline English strings.
  Command descriptions are authored in English at the call site even under the
  "no inline English" rule (`cli/help-localization.ts` keys the lookup on the
  English text).
- **`rasen archive` rehearse with zero blast radius**: copy `rasen/config.yaml`
  + `rasen/specs/` + this change dir into a scratch root, run archive with cwd
  there. Archiving a NEW capability stamps `TBD - created by archiving` and
  discards the delta's Purpose — task to copy it back.
- `src/cli/index.ts`'s Commander does NOT await `.action(async …)` — an
  uncaught rejection is a process-level crash. Every mature command wraps its
  own body in try/catch; bootstrap must too (E1's R0 Blocker was exactly this).

## Test-execution discipline

- **Never run concurrent vitest batches** — E1 proved it manufactures "new"
  failures (`pipeline.test.ts` alone needs ~220s; `store-membership-cli`'s
  tests run 3–6s against a 10s cap). Small **serial** batches only.
- Any command over ~2 minutes runs backgrounded with bounded FOREGROUND polling
  at intervals of at most 270 seconds.
- Known pre-existing failures on this branch, NOT ours: `test/release-contract.test.ts`,
  `test/commands/handoff.test.ts` (stale at `58faffad`, ancestor of base — NOT
  `313df542`), `test/cli-e2e/basic.test.ts` (skill-version-drift warning), and
  `test/commands/workset.test.ts` (Windows temp-cleanup flake). All four
  byte-identical to base `d73c1da2`. Do not "fix" them; attribute individually.

## Branch

`feat/store-context-unification`, `HEAD=f11daa1d`, pushed to origin. Do not
rewrite history.

## Append below: durable findings from each stage

<!-- Workers append durable discoveries (decisions, discovered constraints).
     Not chatter, not status recaps. -->
