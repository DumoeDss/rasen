# Review report — `store-worktree-bindings-v2` (round 1)

Reviewer: dispatched leaf worker, non-author. Mode: DISPATCHED (report-only) — no fixes applied,
no commits, no subagents.

- Branch `feat/store-v2-foundation`, HEAD `29dd0b8b`; implementation commit `ad413c6f` (43 files),
  evidence commits `bda3b783` / `2b2e4708` / `b7b9373e` / `29dd0b8b`.
- Verified against committed bytes: `git status --porcelain` was empty at review start and at
  review end, so the working tree is identical to `HEAD` for every file inspected.
- Every mutation performed during this review was reverted with `Edit` (never `git checkout --`)
  and confirmed byte-exact by `sha256sum` against a pre-mutation hash. Final tree is byte-clean.

## Verdict

**Findings: 0 Blocker, 0 Major, 3 Minor, 2 Trivial.**

The six pressure-test items all hold. The implementer's central claims — seven mutation-proved
digest anchors, three distinct anchor shapes, the shape-(b) discrimination argument, the
27-of-54 breadth attribution, the `session-runtime-context` carve-out, and scope containment —
were re-derived independently here and every one reproduced. The self-correction in item 2
corrected in the right direction. Nothing found blocks shipping.

---

## Findings

### Minor 1 — undeclared behaviour change to a shared seam: `src/commands/workflow/shared.ts:131-142`

`statusFromError` gained a `StoreError` branch that returns the error's own `.diagnostic` code
instead of collapsing to the generic `change_error`.

Why it is a finding rather than a nit:

- It is **not a port**. `git show origin/dev/0.1.7:src/commands/workflow/shared.ts | grep StoreError`
  returns nothing — the reference line does not have this branch. It is a 0.2.0-specific addition.
- **No task covers it.** `tasks.md` 2.5 pins `src/core/file-state.ts` as the one existing-module
  extension; nothing pins this file.
- **`proposal.md` does not disclose it**, and the proposal is the PR body. Its Impact section is
  precise enough to call out "Extends the shared file-lock module with one additive predicate",
  so this level of change is within its register. It also states "Modified Capabilities: None"
  and "No existing capability's requirements change".
- It changes the observable `status[0].code` of `rasen new change --json` (the sole caller,
  `src/commands/workflow/new-change.ts:245`) for any thrown `StoreError`.

Assessed risk is low and the change is an improvement: I searched for consumers keying on
`change_error` and found none that would break — `src/core/management-api/` only forwards `code`
through `sendError`, and the only repository hits are a comment in
`test/core/store/workspace-cleanup.test.ts:666` and a fabricated value in
`test/fixtures/management-api/fake-cli.mjs:29`. It is covered by
`test/core/store/workspace-cleanup.test.ts:661-675`, and motivated by task 5.6.

The defect is disclosure, not correctness: add a line to `proposal.md`'s Impact and a task, or
state why the seam edit is in scope.

### Minor 2 — `assertTargetLineMatchesChange` ships with no production caller, undocumented

`src/core/store/target-lines.ts:263`. `grep -rn "assertTargetLineMatchesChange" src/` returns the
declaration and nothing else; its only consumer is `test/core/store/target-lines.test.ts:451`.

This is **not** an unenforced requirement. The spec requirement "A Change cannot be re-pointed at
another target line" is separately enforced on a reachable path — `src/core/store/workspace/plan.ts:888`
raises `target_line_mismatch` naming both lines, reached by
`rasen store workspace plan --change <id> --target-line <other> --existing-change`. That path is
tested at `test/core/store/workspace-plan.test.ts:572-586`, with a proper accept-all control at
`:558-570` (matching line ⇒ `applicable: true`). I verified `--target-line` is a real registered
flag on that command (`src/core/completions/command-registry.ts:524`) and that both new command
groups resolve at runtime (`node bin/rasen.js store workspace --help`, `store target-line --help`).

So the exported helper is an unused duplicate of a gate that is enforced elsewhere. Keeping it is
consistent with task 2.1 (byte-comparability with the reference; do not restructure for tidiness),
and its caller lives in the deferred `store-planning-scope-routing` slice.

The gap is that this is the **same hazard shape** Decision 6 handles explicitly for the `change`
and `integration` lock kinds ("deliberately have no taker yet", pinned by task 6.4) — and this one
got no equivalent record. Recommend one line in design Decision 6 or the proposal naming it as a
published-but-untaken surface, so a later reader does not read it as dead code or as coverage.

### Minor 3 — shape-(b) anchors are blind to a `canonicalBytes` serialization shift

Measured, not inferred. I mutated `src/core/canonical-json.ts::canonicalBytes` to prepend a
`v2:` prefix — a uniform serialization change — and re-ran:

| Anchor | Shape | Result under the `canonicalBytes` shift |
| --- | --- | --- |
| `plan.ts:794` (`workspace-plan.test.ts:200`) | (b) reconstructed-and-rehashed | **GREEN — blind** |
| `locks.ts:128` (`workspace-locks.test.ts:88`) | (a) pinned literal | **RED — caught** |

The cause is structural: shape (b) hardcodes `createHash('sha256')` and `.digest('hex')`
independently, but imports `canonicalBytes` from production, so a change there moves both sides
together. The same holds for the `cleanup.ts:251` anchor.

Coverage is **not** lost at the change level — four pinned-literal anchors (`locks.ts:128`,
`registry.ts:201`, `cleanup.ts:170`, and the `dependencies.ts:343` claim digest) route through the
same serializer and redden. But design Decision 4 asks each anchor to catch "any uniform change to
the preimage **or the serialization**", and shape (b) catches only the digest-encoding half. Task
6.1's note claims shape (b) catches "a uniform formula shift (e.g. hex -> base64)", which is
exactly true as written; the narrower claim is worth stating there so the residual is on the
record rather than assumed away.

Reverted byte-exactly; `src/core/canonical-json.ts` hash restored to `c733a42f…`.

### Trivial 4 — task 6.5's `workspace-migration` report obligation is unfulfilled

Task 6.5 says "Also check `test/core/workspace-migration.test.ts` and report whether it belongs to
this child." The recorded task text states a verdict for `test/commands/context-workspace.test.ts`
but never for `workspace-migration`.

Verified independently: `test/core/workspace-migration.test.ts` is a pre-existing, unrelated
capability present on both lines (`rasen/specs/workspace-migration/spec.md`,
`src/core/workspace-migration.ts`), untouched by this change. The exclusion is correct; only the
recorded report is missing.

### Trivial 5 — task 5.4 names a file this change does not modify

Task 5.4 requires registering both groups in `src/cli/index.ts`. That file is unmodified:
`git diff 6b1c24d7..HEAD -- src/cli/index.ts` is empty. Registration is via `src/commands/store.ts`
(+8 lines), which is the correct site on this line. Outcome verified working at runtime; the task
text names the wrong file.

---

## Pressure-test items

### 1. Seven digest anchors, three shapes — CONFIRMED

I re-ran every mutation myself (`.digest('hex')` → `.digest('base64')` at each production site,
one at a time, running only the target anchor). All seven reddened:

| # | Production site | Anchor | Shape | Mutation result |
| --- | --- | --- | --- | --- |
| 1 | `locks.ts:130` | `workspace-locks.test.ts:88` | (a) pinned ×3 | RED |
| 2 | `binding.ts:93` | `workspace-binding.test.ts:167` | (a) pinned ×2 | RED |
| 3 | `registry.ts:203` | `workspace-binding.test.ts:327` | (a) pinned ×4 | RED |
| 4 | `dependencies.ts:343` | `workspace-atomic-write.test.ts:648` | (a) pinned ×1 | RED |
| 5 | `cleanup.ts:172` | `workspace-cleanup.test.ts:280` | (a) pinned ×2 | RED |
| 6 | `cleanup.ts:251` | `workspace-cleanup.test.ts:353` | (b) reconstructed | RED |
| 7 | `plan.ts:794` | `workspace-plan.test.ts:200` | (b) reconstructed | RED |

**Shape (b) discriminates a uniform formula shift** — verified directly at both sites (#6, #7).
The mechanism is real: the test destructures `{planId, createdAt, token, ...body}` off the plan's
own returned object, asserts the surviving key set against a hardcoded list, and rehashes with its
own `createHash`/`.digest('hex')`. Folding `createdAt` into the production body would also redden
it, because the reconstruction excludes `createdAt` by destructuring. Its one residual blind spot
is Minor 3 above.

**No anchor is chained off another's output.** Verified two ways: by reading (each of the five
pinned-literal anchors builds its hashed input from hand-written literals — `scopeLockKey({...})`,
a hand-built scope object, hand-built index documents, a hand-built binding fact — none consumes a
prior anchor's value), and by measurement: with `binding.ts:93` mutated, the `registry.ts:201`
anchor in the **same test file** stayed GREEN. Breaks localise.

The three shapes are genuinely distinct and the classification is accurate.

### 2. The self-correction — RETRACTION IS CORRECT

Verified by measurement, not by reading. With `locks.ts:130` mutated in isolation, I ran the
adjacent relational test `derives each key from its stated material` (`workspace-locks.test.ts:65`,
which compares against the test-local `digestFor()` helper at `:44-48`):

```
FAIL  derives each key from its stated material, and only its material
Expected: "scope-72e63287d6b43164cc0fb2579b2dee85…"
Received: "scope-cuYyh9a0MWTMD7JXmy3uhfObCQ292czZxGU22R6vylY="
```

It went RED. `digestFor` hardcodes `'workspace-lock/v1'` and `.digest('hex')` independently, so an
isolated production mutation desyncs both sides exactly as the retraction claims. The initial
"it is blind" statement was wrong and the retraction fixed it. The stated residual — a coordinated
change touching production and helper together — is real, and Minor 3 identifies the concrete
instance of it (`canonicalBytes`), which the pinned literal at `:102` catches.

### 3. `dependencies.ts:343` breadth — REAL, NOT ENTANGLEMENT

Reproduced exactly: **27 failed / 27 passed of 54** under the mutation.

The breadth is load-bearing, and the mechanism is visible in the source: `dependencies.ts:449,454`
makes the digest the **carrier filename prefix** —
`` `.${basename(target)}.rasen-write-${digest}` `` for the `.intent` / `.backup` / `.claim` files.
Base64 introduces `/`, `+` and `=`, so every content-addressed carrier path changes (and on Windows
becomes invalid), which is why the entire `atomic workspace coordination recovery` and
`directory durability fault policy` surface reddens.

It is discriminating rather than indiscriminate: the 27 tests that still **passed** are the ones
that fail closed before touching a carrier file — the table-driven `fails closed for unlisted
<platform>/<op>/<errno> tuples` policy cases. A digest change cannot reach them, and it did not.

### 4. Dead-code mutation as proof of a source guard — ADEQUATE, and stated explicitly

**The guard is a scanner, confirmed, not inferred.** `test/core/store/workspace-git-verb-guard.test.ts`
reads the module's files with `fs.readFileSync` (`workspaceSources`, `:368-379`), strips comments
via `withoutComments`, and regex-matches quoted verb literals in argument-array position
(`argumentElementMatcher`, `:301`). It never executes the adapter. Reachability is therefore
irrelevant to it by construction, so a `if (Date.now() < 0)` dead-code insertion is a **valid**
proof of discrimination — saying so explicitly, as asked, rather than assuming it.

The collateral failure recorded in the evidence is explained by the guard's own structure: the
sibling case at `:550` re-scans every real workspace source file as part of its fixture, so it sees
the same offender. Expected, not a defect.

Worth recording for the LEAD: task 4.3's manual mutation is **not** the strongest evidence in this
file. `:610` (`fails on a forbidden verb inserted ANYWHERE a statement can go in the adapter`)
injects three distinct bypass shapes — including the `execFilePromise('git', ['-C', …, 'branch', …])`
shape that evades the runtime allow-list — at **every legal statement line** of the real adapter
and requires an offender at each. `:663` is the accept-all control (`merge-base` and
`worktree add` must NOT fire). Task 4.3 adds the one thing that sweep cannot give: proof the guard
fires against the real committed file. Suite re-run solo: **12 passed (12)**.

### 5. `session-runtime-context.ts` carve-out — HELD

- `git diff 6b1c24d7..HEAD -- src/core/session-runtime-context.ts src/commands/context.ts` is
  **empty**. Both files byte-untouched.
- `git show HEAD:src/core/session-runtime-context.ts` → `RUNTIME_CONTEXT_VERSION = 1` at line 33,
  with both guards intact: `z.literal(RUNTIME_CONTEXT_VERSION)` at `:95` and the independent
  declared-version rejection at `:255`.
- Nothing in the diff can make an on-disk context file unreadable: no file in this change imports
  `session-runtime-context` or `commands/context.ts`, and no schema, version, or reader in that
  path is touched.

### 6. Scope containment — CONFIRMED, and broader than reported

| Check | Result |
| --- | --- |
| `git diff --stat origin/dev/0.1.7 -- src/core/store/workspace/` | **empty** (13 files byte-identical to the 0.1.7 tip) |
| `git diff --stat origin/dev/0.1.7 -- src/core/store/target-lines.ts` | **empty** (also byte-identical — beyond what was claimed) |
| `git diff --stat origin/dev/0.1.7 -- src/commands/workspace.ts src/commands/store-target-line.ts` | **empty** (also byte-identical) |
| `store-planning/` `layout-migration/` `issues/` `query/` imports | **none** (`git grep` over the module + both command files, empty) |
| `membership-layout.ts` | **absent** from the tree entirely |
| `project-registry.ts` | correctly **excluded** — untouched by this child, and still 471 lines divergent from 0.1.7 |
| new branded type | **none** — `git grep 'unique symbol'` and `__brand` / `Brand<` over the new sources are all empty, so the S1 three-file brand-vocabulary guard needs no extension (design Decision 5 holds) |

Locale lockstep (task 5.4) verified by **key set**, not by count: `en` / `ja` / `zh-cn` each carry
1569 keys with **zero** keys missing or extra in either direction against `en`, and all 28
workspace/target-line keys are genuinely translated (0 of 28 identical to the English value in
either `ja` or `zh-cn`).

---

## The two deliberate open items and the seven deferred cases — all correct

**Task 6.9 `[ ]` — correct.** `rasen archive --dry-run --json` reports exactly one blocker,
`"2 task(s) are incomplete."`, and no spec or delta blocker. The matrix-configuration half is done
and additive-only: `vitest.config.ts` gains three `KNOWN_SLOW_TEST_WEIGHTS_MS` entries and nothing
else (diff inspected). The run-reference half is structurally unobtainable from inside this
worktree, as stated.

**Task 6.10 `[ ]` — correct.** Not duplicated here, per the dispatch. I deliberately ran only
single suites, never a parallel sweep, so nothing I did can have contended with the LEAD's gate.

**Seven deferred cases — deferral correct, and the substitutes are discriminating.** Located: 5
`it.skip` in `workspace-baseline.test.ts` (`:180, :210, :251, :287, :321`) and 2 in
`store-v2-workspace-journey.test.ts` (`:245, :546`). The stated cause holds — `--target-line`
appears nowhere in `src/cli/index.ts`, so `new change --target-line` and `archive --target-line` are
genuinely absent on this branch. Each skip carries a substitute mapping naming the replacement.

Substitute coverage checked against the four behaviours named in the dispatch:

- **Marker validation** — covered. `workspace-baseline.test.ts:423` drives the under-declared
  marker through `readBindingFact` directly, asserts a `StoreError` whose message names both
  missing fields, **and** asserts the marker file is byte-unchanged after the refusal
  (`fs.readFileSync(markerPath).equals(before)`), which is the "refuse, never repair" half.
- **Refusal taxonomy including `planning_worktree_required`** — the premise needs correcting:
  **`planning_worktree_required` does not exist in `src/` at all** (`grep -rn` returns zero hits in
  `src/`; every hit is in a skipped test or a comment). It is decided entirely by the deferred
  scope resolver, so no substitute could reproduce it without importing the deferred slice. The
  substitute at `:423` **says so explicitly** and records the genuine discrepancy — S2's own reader
  throws `workspace_marker_conflict` instead — rather than papering over it. That is the honest
  handling, and I confirmed the underlying claim by reading `binding.ts`. Not a defect.
- **Integration-checkout refusal** — covered twice. The evidence layer:
  `workspace-baseline.test.ts:393` asserts `probePlanningWorktree` reports `linked: false` for the
  Store integration checkout, paired with `:410` asserting `linked: true` for a genuine linked
  worktree — a real accept-all control, so the `false` is not a function that always answers false.
  And the **enforcement** layer is shipped and reachable: `plan.ts:262-279` emits an unsatisfied
  `planning-is-linked-worktree` precondition, tested at `workspace-plan.test.ts:393-400`
  (`applicable: false`), with its own control at `:402-411` proving the project main checkout is
  still permitted on the execution side. The requirement is enforced here, not only deferred.
- **Index update** — covered. `workspace-pairing.test.ts:381` drives `completeChangeBinding` on a
  hand-assembled marker-only worktree and asserts the index entry was rebuilt from disk
  (`entry?.changeInstanceId`, `entry?.planning.root`) while `execution.root` stays `''` and no
  `workspacePairId` is invented. Distinguished from the bound outcome by the sibling at `:422`,
  where `workspacePairId` **is** defined.

Both journey substitutes cited in the skip comments exist and are real cases
(`workspace-pairing.test.ts:145` and `:244`). The `:217` comment goes further and names the **one**
step with no S2-scoped substitute — `archive --dry-run` finding the bound pair — recording it as an
inbound acceptance item rather than claiming coverage it does not have. That is the correct
handling of a genuine gap.

None of the substitutes is decorative: every negative assertion I checked has a positive
counterpart in the same suite that would fail if the function under test always answered the
refusing value.

---

## Other checks run

- **Task 3.3 (semantic conflict does not consume the retry budget)** — I suspected
  `expect(attempts).toBe(1)` (`workspace-locks.test.ts:340`) might be a tautology, because
  `withWorkspaceLocks` invokes the body exactly once structurally at `locks.ts:249` with no retry
  loop around it. Tested it: wrapping the body in a retry made the assertion **RED**. It is a
  genuine regression guard, not decorative. It is properly contrasted with `:262-293`, which proves
  contention *does* wait (`Date.now() - started >= 140` against a 150 ms deadline) and leaves the
  holder's lock file intact. Task 3.3's demand is met.
- **Task 6.4 (name each lock kind's taker)** — verified in shipped code: `scope` and `workspace` are
  taken at `module.ts:164-176`, `module.ts:350-362`, `cleanup.ts:192-202` and
  `target-lines.ts:334, :398`. `change` (`locks.ts:105`) and `integration` (`locks.ts:116`) have no
  caller, each carrying the comment "Published for the finalization owner. This change never takes
  it." — matching Decision 6.
- **Task 1.4 (each refusal refused for its own reason)** — the overwrite refusal asserts
  `target_line_exists` on a **valid, existing** id (`target-lines.test.ts:137-152`), so it cannot be
  the id-validation refusal, and it asserts the catalog is byte-identical afterwards. The re-point
  gate asserts `target_line_mismatch` with **both** lines named plus an accept-all control at `:470`.
  Distinct codes confirmed across the surface: `target_line_unknown`, `target_line_exists`,
  `target_line_locator_in_use`, `target_line_ref_unresolved`, `target_line_mismatch`.
- **Task 6.7** — `test/core/store/workspace-atomic-write.test.ts` re-run solo after all reverts:
  **54 passed (54)**, confirming both the recorded count and that my mutations left no residue.
- **Verb guard suite** re-run solo: **12 passed (12)**.
- **Gates** re-run: `pnpm exec tsc --noEmit` exit 0;
  `node bin/rasen.js validate 'store-worktree-bindings-v2' --type change --strict` →
  "Change 'store-worktree-bindings-v2' is valid".
- **No staging/commit/fetch/push** — no `add` / `commit` / `push` / `fetch` verb and no
  `commitStoreFiles` call appears in `src/commands/workspace.ts` or
  `src/commands/store-target-line.ts`. Asserted behaviourally at
  `store-target-line-cli.test.ts:98` (`diff --cached` empty), `workspace-cli.test.ts:140` and
  `store-v2-workspace-journey.test.ts:1054-1055` (both repositories `status --porcelain` empty), the
  last inside the journey's one **running** case. Note for a later slice: the source guard scans
  `src/core/store/workspace/` only, so the two command files are covered by behaviour, not by the
  guard.
- **`src/core/file-state.ts`** — the diff is purely additive: one new exported
  `fileLockOwnerIsProvablyDead` plus its docstring, no existing export altered. Matches task 2.5.
- **`src/core/completions/shared-flags.ts`** — the added `targetLine` flag is byte-identical to
  0.1.7 (same line 32) and is used at `command-registry.ts:524, :544, :554`. Not dead.

## Statement on tree state

I am **done mutating**. Every file I touched was restored with `Edit` and confirmed byte-exact by
hash against its pre-mutation value:

```
c733a42f7e4b26f638731d7293298cf2edde139c2c0fe0ccffe70553611f3071  src/core/canonical-json.ts
6ed6097b9b92d405541b4abd67416fa3c3228fe82556afbfcfbf6048e2762d2d  src/core/store/workspace/plan.ts
9b08319f8f9e3eb7c0599e48eb86a8247ffbd44f8d76fcfad85d14ccc0c40826  src/core/store/workspace/cleanup.ts
79cf821b8ed911bcf40bbd39ee88cc76642a9e28b81a829a5d2d03566ae8934c  src/core/store/workspace/locks.ts
31609228ca92aeb3e9c24d56389cb73ff38fe52506d5aaaf537f30b11ea17595  src/core/store/workspace/registry.ts
2d5960f945fb325f36e014a1990bf06318e9973642371e3a87ca676a9cb6e70c  src/core/store/workspace/binding.ts
6ad75415bbc0e9718295ebb40e075969ae70c35d7057fc6f8b9fd2b6c0b5ff59  src/core/store/workspace/dependencies.ts
```

`git status --porcelain` is empty and no `.rasen-archive-stage-*` residue remains from the
`archive --dry-run` probe. **The tree is byte-clean.**
