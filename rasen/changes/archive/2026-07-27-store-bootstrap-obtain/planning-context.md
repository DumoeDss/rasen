# Planning context — store-bootstrap-obtain (Phase E, child 3 of 4)

Seeded by the LEAD before propose. Read this FIRST, then research only what is
missing. This is a **carve from an existing design** — E's complete
proposal/design/tasks/spec already exist and you extract E3 from them.

## User intent

The A–F portfolio was split into 8 children. **E1 (`store-bootstrap-diagnose`)
shipped at `f11daa1d`**, **E2 (`store-bootstrap-adopt-local`) shipped at
`9f4286da`**. This change is **E3: the retrieval half of Phase E** — the only
child that creates new checkouts from the network, and the only one that can
**destroy user data**.

Locked scope:
- Implement clone-target **enforcement** (E1 previewed; E3 enforces), the
  Store-first obtain flow, the obtain half of project-first, and
  failed-retrieval cleanup.
- Do NOT touch ordinary-command repair text or doctor (that is E4).
- Do NOT implement any Phase F work.

## ⚠ This is the data-destroying child

E's own design D5 flagged the critical danger: *"cleaning up a failed clone"*
when the target directory **already existed before the operation** equals
**deleting user data**. The failed-retrieval cleanup must execute ONLY when it
can PROVE the directory was created by THIS operation — never when it
pre-existed.

The decomposition plan (§8) requires: **E3 runs ALONE, nothing beside it.**
This is the one place the plan deliberately spends wall-clock for safety. The
cost of getting cleanup wrong is not a re-review; it is a user's deleted
directory.

## The split question you must evaluate and REPORT

The §9 calibration (informed by E1's 4 review rounds) recommended: **split E3**
into retrieval (groups 7, 8.1–8.6, 5.2 obtain half) versus failed-retrieval
cleanup (8.7 + E's requirement *A failed retrieval is cleaned up only when
provably safe*), because cleanup is where the data loss lives and deserves
isolated review.

E2 then shipped in **1 round** (not 4), proving E1's infrastructure (`mutates`
field, every-catch-pushes-diagnostics, tick-truthfulness) makes subsequent
children lighter. So the "E3 is too big to review" premise may not hold.

**Your call, with evidence:** read the actual code for groups 7/8 and the
failed-cleanup requirement. If retrieval and cleanup can be reviewed cleanly
as one diff (given the inherited infrastructure), keep E3 as one change. If
the cleanup logic is genuinely dangerous enough to deserve its own focused
review with no other concerns competing for attention, recommend the split and
say so explicitly. The user wants E done — do not split on a hunch, only on
evidence.

## Where E's existing work lives — reuse it

`rasen/changes/store-bootstrap-and-hydration/` — E's complete artifacts. Read:
- `proposal.md`, `design.md` (especially **D5** for the data-loss path, and
  the Store-first flow design), `tasks.md` (groups 7, 8, 5.2 obtain half)
- `specs/store-bootstrap/spec.md` — E's 10 requirements (E1 landed 7, E2 landed
  2 more; E3 lands the remaining acting requirements)

E1's artifacts: `rasen/changes/store-bootstrap-diagnose/` (shipped `f11daa1d`).
E2's artifacts: `rasen/changes/store-bootstrap-adopt-local/` (shipped
`9f4286da`). **E3's MODIFIED targets build on E2's version of requirement 3**
(the project-clone flow, which E1 ADDed and E2 deepened — read E2's delta spec
for the current state). The MODIFIED chain is E1 ADD → E2 MODIFY → E3 MODIFY,
all serial, all safe.

### E3's task groups (from E's tasks.md)

- **Group 5.2 obtain half** — "obtain and register an absent-with-remote Store"
  (the clone branch; E2 took the "register present-unregistered" half).
- **Group 7 (Store-first flow)** — verify Store identity → register the
  checkout → read its project records → show which projects are local and
  which could be obtained → clone and register ONLY on explicit selection.
  **Never clone every project in the Store.**
- **Group 8 (clone target selection and safety)** — 8.1–8.6 the selection
  logic and safety (E1 implemented the **preview** of this; E3 adds
  **enforcement**: E1 reports a refused location, E3 actually refuses and
  never overwrites). 8.7 failed-retrieval cleanup (the data-destroying part).
- **`--yes` Store-first:** MUST NOT obtain projects. A Store's roster is
  authored by others and can grow without the local user knowing. `--yes`
  covers registering the Store's own checkout and non-expanding confirmations
  only. E2 owns project-first; E3 owns store-first. **Do not unify.**

### Requirement structure (pre-resolved — confirm, don't redesign)

- **ADD** *A clone target is chosen by stated priority and never overwrites
  anything* (E's req 5 — E1 previewed the selection; E3 enforces).
- **ADD** *A failed retrieval is cleaned up only when provably safe* (E's
  req 6 — the data-destruction guard).
- **ADD** *Starting from a Store lists its projects and obtains none without
  being asked* (E's req 4 — the listing half was E1; the obtain-gated-by-
  explicit-selection half is E3).
- **MODIFY** E2's version of requirement 3 (project-clone flow) to add the
  obtain path for absent-with-remote Stores. Preserve E2's (and E1's)
  scenarios verbatim; add the obtain scenarios.

## THE invariant (weaker than E1/E2)

**Every checkout created is at the location preview reported, or the filesystem
is untouched.** No silent overwrites, no partial clones left behind, no
cleanup of directories that pre-existed. There is NO "writes nothing" or
"writes only machine-local" invariant here — E3 retrieves from the network and
creates checkouts. The safety surface is: target selection is safe (never
overwrites), cleanup is safe (only touches what THIS operation created), and
the never-harvest rule holds even under `--yes`.

## Three binding constraints inherited from E1/E2

1. **Construction-time `mutates` field** (E2 built it) — E3's new repairs
   (obtain, clone) must carry `mutates: true` at construction. The filter
   blocks `mutates: true` on unknown arms. Both `repair[]` and
   `diagnostic.fix` channels governed.
2. **Every composed reader pushes diagnostics on failure** (E2 made this
   total across its apply path) — E3 composes MORE readers (git operations,
   remote resolution). Every catch must push.
3. **A repair that changes state may only be offered against an established
   answer** — E3's obtain/clone repairs are the most state-changing in the
   whole portfolio. They must never appear under an undetermined answer.

## Proof discipline (different from E1/E2)

- **Target safety:** whole-tree snapshot proving a pre-existing target
  directory is **never overwritten** — `git clone` into an occupied path
  refuses; assert the refusal, assert the pre-existing content is byte-identical
  after.
- **Cleanup safety:** the critical one. Assert cleanup runs ONLY on a directory
  this operation created. Construct the specific test E's D5 fears: target
  directory pre-exists with content → retrieval "fails" (or the path is
  occupied) → **directory and its content are byte-identical afterward**.
  Cleanup of a proven-self-created directory is fine; cleanup of anything else
  is a Blocker-class defect.
- **Never harvest:** assert that without explicit selection, NO project is
  cloned, even under `--yes`, even if the Store lists many.
- **Real git operations in tests:** use fixture repositories (local file://
  remotes), NEVER real network. Any test that writes to disk uses a temp dir
  with whole-tree snapshots before/after.

## Ground truth (verified 2026-07-26)

- **E1 shipped `f11daa1d`, E2 shipped `9f4286da`** — both review-clean, delta
  specs frozen. Neither archived (branch unmerged). E3's archive follows E2's
  (which follows E1's).
- **F1 in a separate worktree** (`OpenSpec-code-wt-knowledge-bundle-export`).
  Will not touch this tree.
- **Concurrent UI session** owns 18 `packages/ui/**` files + `rasen/config.yaml`
  (disjoint from E3's `src/core/store/**`, `src/commands/**`,
  `src/locales/*.json` touch points).
- **`store-bootstrap-and-hydration/` must NOT be modified, moved, or deleted.**
  After E3 (and E4) absorb its content, it can be cleaned up — but only with
  user confirmation.
- Branch: `feat/store-context-unification`, `HEAD=9f4286da`, pushed.

## Repo conventions that bite (same as E1/E2 — all paid for already)

- Specs in user-facing product behavior language; `path.join`/`path.resolve`;
  SHALL/MUST on the FIRST body line of a requirement; `validate --changes`
  shows ~10–22 unrelated container-dir failures (read per-item `valid`);
  messages through `*-messages.ts` (English at call site for descriptions);
  Commander does NOT await `.action(async …)` — wrap the action body.
- Never run concurrent vitest batches (E1/E2 proved this manufactures
  failures). Serial only. Background anything over ~2 min, poll at ≤270s.
- Known pre-existing failures: `release-contract`, `handoff` (stale at
  `58faffad`, NOT `313df542`), `cli-e2e/basic` (skill-version warning),
  `workset` (Windows flake). Byte-identical to base `d73c1da2`.

## Append below: durable findings from each stage

<!-- Workers append durable discoveries. Not chatter, not status recaps. -->
