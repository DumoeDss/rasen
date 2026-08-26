# Design: fix-store-workspace-pair-transactions

## Context

The workspace pair transaction is split across `src/core/store/workspace/plan.ts` (read-only, total, freezes preconditions into an immutable plan) and `apply.ts` (consumes only a token, revalidates, then writes). What each half actually freezes and compares — verified on dev/0.2.0, 2026-08-26:

**What the plan freezes, per side and disposition** (`planSide`, `plan.ts:153-298`; token assembly `plan.ts:810-827`):

- **Create-disposition side** (destination absent, or occupied-by-non-worktree which blocks): side plan carries `ref` = the pair branch `change/<line>/<project>/<change>` (`plan.ts:474-478,191`) and `fromOid` = the target-line locator OID resolved *at plan time* — `targetLine.storeRefOid` for planning (`plan.ts:517`), `targetLine.codeRefOid` for execution (`plan.ts:537`), both minted by `resolveTargetLineRecord` via exact `git for-each-ref` against the *local* repository (`target-lines.ts:527-532,552-557`; resolution never falls back). No `headOid` and no `worktreeInstanceId` are recorded — nothing exists yet. The token carries only `storeRefOid`/`codeRefOid` for such a side (`plan.ts:816-818`).
- **Reuse-disposition side**: side plan carries `ref` = the index-recorded ref when an entry exists, else the ref the worktree is on (`plan.ts:229`), `fromOid` = the **live surveyed** `headOid` (`plan.ts:290`), plus live `worktreeInstanceId` and `headOid` (`plan.ts:292-295`); the token freezes those as `planningHeadOid`/`executionHeadOid` (`plan.ts:819-824`). The index entry's `recorded.headOid` is passed into `planSide` but never read — a dead input.
- **Both**: the target-line catalog digest (`plan.ts:788`), the store-metadata layout expectation, and the machine index fingerprint computed **excluding the plan's own Change entry** (`plan.ts:775-779`; `registry.ts:193-204` — deliberate, so re-applying after a partial failure survives its own writes).

**The refusal that misjudges a not-yet-created worktree** (`apply.ts:141-213`): `revalidateWorkspacePlan` reads the machine index entry for this Change (`apply.ts:283-287` — the one entry the fingerprint deliberately excludes) and, for a create-disposition side, compares `recordedIdentity = existing?.<side>.worktreeInstanceId` against a live survey of the planned destination (`apply.ts:165-180`). An absent destination surveys as `{exists:false}` with no `worktreeInstanceId` (`binding.ts:248-255`), so whenever the entry's recorded id is non-empty the inequality is guaranteed and apply throws `workspace_plan_stale` ("The identity of the created `<side>` worktree ...", expected the recorded id, actual `(unknown)`). The `live.exists` guard at `apply.ts:157` covers only the ref comparison, not the identity comparison, and nothing checks that the entry's recorded *root* is the planned root. Meanwhile the plan blesses the same create without complaint (`plan.ts:175-181`) — the own-Change entry is exempt from the `workspace_already_bound` scan (`plan.ts:488` filters `entry.changeId !== changeId`). Plan says applicable, apply says stale, and re-planning reproduces both verdicts: a permanent wedge.

**Field evidence (read-only survey of the live stores, 2026-08-26).** elftia-store (`E:\AI\ChatAI\Agents\VibeCodingProjects\elftia\elftia-store`, uid `a9da9342`), target line `main`, `storeRef: refs/heads/main`: local `main` = `9972549` (dirty checkout, 16 entries), ahead of `origin/main` = `5870604` by exactly the 10 `Merge archive *` commits the retention session itself produced during 2026-08-24..26 — the ref was moving as part of the very flow that needed the checkout. The scope index (`ps_a8dfca…`) holds `bound` entries with non-empty `worktreeInstanceId`s for the two Changes the session was retaining (`document-skills-xlsx-advanced-authoring`, `document-skills-xlsx-completion`), which arms the apply-side wedge for any re-preparation. The hand-made `elftia-store-wt-xlsx-*-final` worktrees on ad-hoc `planning/*` branches are the session's fallback after the official flow refused — the Changes were then archived soundly on 2026-08-25 by the finalization engine under a retention waiver (only the verified-checkout retention step was waived), so the defects' consequence is a forced waiver on every such delivery, not a stranded archive.

**Are the two defects one root cause?** No — they are independent mechanisms in the two halves of the transaction, but they compound. Defect 1 (stale-tip freeze) lives in the plan half plus the two-invocation gap: `plan` and `apply --apply-plan` are separate CLI invocations (`src/commands/workspace.ts:141,297-311`), and a line under active retention advances `refs/heads/main` between them, so the frozen `storeRefOid` fails the apply-time equality (`apply.ts:111-123`). That refusal is *designed* ("A moved ref invalidates the plan") and self-heals by re-planning. Defect 2 (identity misjudge) is what makes the re-plan loop futile — it converts a recoverable refusal into "two consecutive refusals before any write, flow unusable". The shared design-level flaw worth naming: apply consults a fact the plan deliberately did **not** freeze (the own-Change index entry, excluded from the fingerprint), so the transaction's two halves judge different worlds. A THIRD defect sits behind both and was only reachable once D1 stopped refusing earlier: the pair branch survives every teardown, and apply always created with `git worktree add -b`, which fails on a branch that exists. It is not a fourth judgement about the world — it is the flow's next step failing in Git — and D6 below is what it forced.

Design of record: `docs/zh/store-project-partitions-and-planning-worktrees.md` §5.3 (frozen pair binding), §6 (`planChangeWorkspace`/`applyWorkspacePlan` are the only seam), §10 (a plan whose preconditions moved is invalidated and re-planned, never repaired). Sibling change A (`fix-store-retention-scope-resolution`) owns the resolver/registry/gate seam; this change does not touch `src/core/store-planning/internal/resolver.ts` or `src/core/store/identity.ts` (the store-level one; the workspace-local `src/core/store/workspace/identity.ts` is read but not modified either).

## Goals / Non-Goals

**Goals:**

- Re-preparing a Change workspace converges: a torn-down pair, a vanished worktree, or a fresh destination can be planned and applied through the official flow, as the existing spec scenario ("Re-preparing an existing Change changes the pair identity") already promises.
- A create-disposition side revalidates against the state a create actually requires (absence, or its own resumable creation) — no comparison against identities that cannot exist yet.
- The plan surfaces, in its preview, everything it decided about a surviving recorded pair and the exact tip each created side will be born from.
- The official "fresh verified checkout" path cannot race its own session: one invocation, one lock hold, plan and apply inside it.
- Fail-closed semantics are not weakened anywhere: a genuinely moved ref, a genuinely occupied destination, a live conflicting pair, and disagreeing carriers still refuse with named repairs.
- Both defects are pinned by real-git tests that demonstrably fail against the pre-fix code.

**Non-Goals:**

- No changes to target-line locator semantics (`target-lines.ts`): a locator names one local ref, resolution is exact and never falls back. Freezing the locally-resolved tip is correct; which ref a line should point at is operator policy (G2 territory).
- No resolver/registry/scope-gate changes (sibling A owns that seam), no finalization-engine changes, no cleanup-flow changes beyond what its existing verbs already provide as the named repair.
- No index-schema migration: `WorkspaceIndexEntry` keeps its shape; the fix changes who compares what, not what is recorded.
- No weakening or skipping of `workspace_plan_stale` for reused sides, moved refs, catalog digests, or index fingerprints.

## Decisions

### D1 — Apply's create-side revalidation asserts what a create needs: absence, or its own resumable creation

`revalidateWorkspacePlan` (`apply.ts:154-181`) changes for `disposition === 'create'`:

1. `live.exists === false` → **satisfied**. Absence is precisely the precondition the plan blessed; there is no identity to compare and no fact on disk that disagrees (the plan-time survey and the apply-time survey agree the destination is absent).
2. `live.exists === true` and `live.ref !== side.ref` → `workspace_plan_stale` (unchanged — the destination was occupied between planning and applying).
3. `live.exists === true` and `live.ref === side.ref` → idempotent resume; the recorded-identity comparison **now applies only here**, and only when the index entry's recorded side-root is the planned root (`samePath(existing.<side>.root, side.root, flavor)`). A recorded identity for a *different* root is not evidence about this destination and is never compared against it.

Rationale: the current comparison guards against "the destination this apply already created was swapped for a different incarnation" — a real resume-time concern that only exists when the destination *exists*. Aiming it at an absent destination makes apply refuse the exact state the plan requires, with a repair (re-plan) that cannot repair. The index is "a rebuildable projection … authority for nothing" (`registry.ts:4-10`); letting its leftover entry veto a creation inverts that stated authority order.

*Alternatives considered:* (a) delete the create-side identity check entirely — rejected: the resume case (crash after `git worktree add`, re-apply of the same token) genuinely benefits from verifying that the surviving destination is the incarnation this apply created; (b) have apply auto-remove the stale index entry — rejected: apply consumes a token and mutates only what the plan declared; reconciliation belongs in the plan (D2), and the entry is rewritten by `record()` on success anyway.

### D2 — The plan reconciles the surviving own-Change index entry into named preconditions

`buildWorkspacePlan` gains a reconciliation step when `indexEntry !== null` (it already has the entry in hand, `plan.ts:458,518-527`), per side:

- **Recorded root is the planned root** (the default when no explicit `--planning-worktree`/`--execution-worktree` is given, since the recorded root *is* the destination default, `plan.ts:159-161`): if the recorded worktree is live → today's reuse path, unchanged. If it is absent (or no longer a worktree of the recorded repository) → a **satisfied** precondition (`<side>-recorded-pair-recreated`) stating that the recorded worktree is gone and the pair will be re-created at the recorded root — the divergence becomes visible in the preview instead of ambushing apply.
- **Recorded root differs from the planned root**: if the recorded worktree is still live → an **unsatisfied** precondition (code `workspace_already_bound`) naming the recorded pair and the repair (`rasen store workspace cleanup --change <id>`, or planning without an explicit destination to reuse the recorded root). This closes the gap where the own-Change entry was exempt from every plan-time check: one Change instance belongs to exactly one pair (`detectBindingAmbiguity` already enforces the two-planning-worktrees form of this; the plan now enforces it before a second pair is created rather than after). If the recorded worktree is gone → the satisfied `<side>-recorded-pair-recreated` precondition, and creation proceeds at the new root.

No new error code enters the `StoreWorkspaceErrorCode` union: the blocking case reuses `workspace_already_bound` (it is exactly "this Change is already bound to a pair"), the non-blocking cases are ordinary satisfied preconditions.

*Alternatives considered:* (a) a distinct `disposition: 'recreate'` — rejected: create-from-frozen-OID already describes the action; a third disposition would ripple through actions, types, and every consumer for no behavioral difference; (b) blocking on a vanished pair too (require cleanup first) — rejected: cleanup of a vanished worktree can prove nothing about a directory that does not exist, the entry alone is a projection with no authority, and blocking would keep re-preparation wedged behind a manual index edit — the exact failure being fixed.

### D3 — A compound one-invocation prepare closes the transaction's self-race window

`StoreWorkspace` gains a `prepare()` orchestration: acquire the same scope + workspace locks `apply()` takes today (`module.ts:164-176`), then **inside the lock hold** build the plan, persist it, and run `applyWorkspacePlan` on the fresh token. The CLI exposes it as `rasen store workspace plan --apply` (one invocation; prints the same plan preview, then the apply result). The existing two-step remains for preview-then-decide workflows.

Rationale: defect 1's field shape was the session's own flow advancing `refs/heads/main` (10 archive merges) between the `plan` invocation and the `apply` invocation. Freezing at plan time and re-verifying at apply time is correct and stays; what must go is the mandatory multi-second-to-multi-minute gap between the two for the common "just prepare it" case. Under one lock hold the gap is milliseconds and same-machine workspace operations on the scope are serialized. Cross-process movers that do not take the scope lock (finalization's integration-lock merges, a human `git commit`) can still move the ref — and then the compound refuses stale exactly as before, but re-running it converges now that D1/D2 removed the wedge.

Plan stays lock-free when invoked alone (it is a read; locking a preview would add contention for no protection — its output is revalidated by apply anyway).

*Alternatives considered:* (a) apply re-resolves the ref and creates from the live tip — rejected outright: violates "created from the recorded OID, never the ref name" (`apply.ts:17-19,358-365`) and §10's invalidate-never-repair rule; (b) auto-re-plan-once inside apply on staleness — rejected: apply consuming only a token is the module's core contract (`module.ts:120-127`); silently substituting a different plan than the token names repairs the plan on the user's behalf; (c) also taking the integration lock in the compound to exclude concurrent finalization merges — rejected for now: the acquisition order permits it (scope → workspace → integration), but it would serialize preparation against every archive on the line, and the stale refusal plus convergent retry already handles that race correctly.

### D4 — The plan preview names the frozen tip for every created side

For each create-disposition side, the plan emits a satisfied precondition (`<side>-created-from`) whose detail names the locator ref and the frozen OID ("planning worktree will be created from refs/heads/main @ 9972549…"). This is pure disclosure — the values are already in the plan body (`fromOid`, `plan.ts:192`) — but it puts the frozen tip in the human-facing preview and in the refusal context an operator compares against, which is what the elftia session lacked when diagnosing "which tip did my plan freeze?".

*Alternative considered:* surveying upstream divergence of the locator ref (`%(upstream:track)`) and warning when the local ref is behind — deferred to G2: elftia's field state was local-*ahead* (its own unpushed archive merges), where a behind/diverged warning would have said nothing, and locator-vs-upstream policy is a target-line concern, not a pair-transaction one.

### D5 — Reproduction: purpose-built temporary fixtures; the live stores are read-only evidence

The real evidence lives in `elftia-store` and `E:/rasen-pairs/` — other projects' live planning state; nothing in this change's tests or dogfood touches them. Tests build the established disposable real-CLI fixture (temp dirs, real `git init` + commits, own registry and machine data dir via env redirection — the cli-dogfood / issue-dogfood recipe): a v2 store with a project partition and a target line whose `storeRef` is a local branch, plus a project repo. Defect scenarios, each pinned as FAILING against pre-fix code before its fix lands:

1. **Wedge, vanished-worktree shape:** prepare a pair → complete it (entry `bound`/`prepared` with non-empty ids) → `git worktree remove` the planning side + prune → plan (blesses create at the recorded root) → pre-fix apply refuses `workspace_plan_stale` "identity of the created planning worktree"; post-fix it re-creates and rewrites the entry.
2. **Wedge, fresh-destination shape:** prepare and keep the pair → plan with an explicit new `--planning-worktree` → pre-fix apply refuses the same way; post-fix the *plan* refuses with `workspace_already_bound` naming the recorded pair and the cleanup repair (fail-closed preserved, but at the right half of the transaction, with a repair that works).
3. **Self-race shape:** plan → advance the store branch with a commit → apply refuses stale (designed, unchanged — this test pins that the refusal names both OIDs) → re-plan + apply converges; compound `plan --apply` succeeds in one invocation on the moving line.
4. **Resume integrity kept:** create destination exists on the planned ref with a matching recorded identity at the same root → apply proceeds idempotently; with a *mismatched* identity at the same root → still refuses (D1 case 3 keeps its teeth — mutation-tested by flipping the recorded id).

Real-git suites carry explicit per-test timeouts (the 30s default passes solo and fails in a parallel full run); runs are never piped through `tail`/`head`.

### D6 — A created side's pair branch may already exist, so the plan decides between minting and reattaching

Added during implementation, after D1 removed the apply-side wedge and revealed what it had been hiding. Neither `git worktree remove` nor `rasen store workspace cleanup` deletes a branch — deliberately, because a branch may carry commits, and cleanup's own report says so ("No branch, ref, Change directory, Archive, or other pair was touched"). So every re-preparation of a Change meets its own previous pair branch, and `git worktree add -b <name>` fails outright on a branch that exists: `fatal: a branch named 'change/<line>/<project>/<change>' already exists`. Reproduced standalone against real Git before any code changed, and reproduced through the module the moment D1 stopped refusing earlier. Without this decision, D1 and D2 relocate the refusal but the flow still cannot complete, so the change's central goal — re-preparation converges — is unreachable.

`planSide` therefore resolves the pair branch in the side's own repository for every create-disposition side, and reports the answer as a precondition:

1. **Absent** → `createsBranch: true`, `fromOid` = the target line's frozen tip. Today's behaviour, now stated: satisfied `<side>-branch-available`.
2. **Exists, checked out nowhere** → `createsBranch: false`, `fromOid` = **the branch's own tip**, frozen at plan time; satisfied `<side>-branch-reattached` naming the ref and that commit. Apply attaches it (`git worktree add <destination> <branch>`) rather than minting it.
3. **Exists, checked out in another worktree** → unsatisfied `workspace_ref_mismatch` naming that worktree, because Git checks one branch out in one worktree at a time and preparation never moves another worktree's HEAD. (D2 already blocks the same-Change form of this at plan time; case 3 catches a hand-made worktree sitting on the pair branch.)
4. **Ambiguous** (more than one matching ref) → unsatisfied `workspace_ref_mismatch`; which commit the pair would be born from is not decidable.

Apply revalidates case 2 like any other frozen Git precondition: a reattached branch whose tip moved between planning and applying is `workspace_plan_stale` naming both commits. The adapter's `addWorktree` gains an optional `createBranch`, defaulting to **true**, so every existing caller is unchanged; `false` runs `git worktree add <destination> <branch>`, which is still `worktree add` and so leaves the closed Git verb set and its source guard untouched. No new error code enters `StoreWorkspaceErrorCode`.

Rationale for reattaching at the branch's OWN tip rather than the line's: the branch IS the Change's work, and the reuse disposition already establishes the pattern — a reused side freezes its live `headOid` rather than the line's tip (`plan.ts`), and apply revalidates that. Freezing the branch tip and revalidating it keeps "created from a frozen OID, never from a ref name" exactly as true for a reattached branch as for a minted one.

*Alternatives considered:*

(a) **Delete the branch during cleanup, so re-preparation always meets a clean slate** — rejected, and it is the most tempting one. Cleanup's contract is that it is *provably lossless*: it refuses unless every commit on the side is reachable from the recorded ref, and it touches no branch, ref, Change directory, or Archive. Deleting the pair branch would put the one artifact that can hold unmerged commits inside the blast radius of a verb whose entire promise is that nothing is lost, and it would do so to fix a problem that is not cleanup's — the pair branch is equally in the way after a plain `git worktree remove`, which cleanup never saw. It also fixes nothing for the vanished-worktree shape, where cleanup was never run.

(b) **Let apply force-recreate the branch (`git worktree add -B`, or delete-then-create)** — rejected outright. `-B` resets an existing branch to the given commit, so a pair branch carrying commits would be silently rewound to the target line's tip and that work would become unreachable — the exact "deciding on the user's behalf which of two disagreeing facts they meant" that `workspace_plan_stale` exists to refuse. It also breaks the module's stated non-goal of never moving a ref or a HEAD, and it would make a *preparation* step the most destructive verb in the capability.

(c) **Have the plan refuse whenever the pair branch exists, naming manual branch deletion as the repair** — rejected: it is fail-closed but useless. The branch exists in every re-preparation, which is the flow being fixed, so the refusal would fire on the happy path and its repair would ask an operator to delete a branch that may hold their commits. A refusal whose repair is routinely dangerous trains people to ignore it.

(d) **Give the re-created pair a fresh branch name (a suffix or a counter)** — rejected: the branch is a LOCATOR embedding line, project, and Change (`workspaceBranchRef`), and nothing parses it back out. A second name for one Change's pair would leave two branches a human must tell apart, and would strand the first one's commits under a name nothing points at.

## Risks / Trade-offs

- [D1 loosens a check some flow silently relied on] → the check's only reachable extra behavior was refusing absent destinations with non-empty surviving entries; scenario 4 pins the resume case that remains guarded, and the full store/workspace suites must stay green. A guard is only trusted after being shown to fail against the pre-fix behavior, with an asserted-unique landing site.
- [D2's `workspace_already_bound` block breaks a legitimate two-pair workflow] → no such workflow exists by design ("a Change instance belongs to exactly one pair", `detectBindingAmbiguity`); the refusal names cleanup, and cleanup of a live pair is an existing, working verb.
- [D3's compound holds locks across `git worktree add` (seconds on Windows)] → the same locks are already held across the same writes by `apply()` today; the compound adds only the plan build (reads) to the hold. The lock-contention failure mode is unchanged (`workspace_lock_unavailable`, bounded retry).
- [Overwriting the index entry on re-creation loses the old pair's record] → the old worktrees are gone (vanished shape) or cleanup removed them (fresh-destination shape); the entry is a rebuildable projection, and `record()`/`completeChangeBinding` re-derive pair identity from live state — the spec's "different pair identity on re-preparation" scenario is the intended outcome. The mid-apply `record('planned')` overwrite of a bound entry (`apply.ts:294-343`) predates this change and stays: after D2, an apply that reaches it is either resuming its own pair or re-creating a reconciled one.
- [D6 reattaches a branch whose tip is not the target line's, so a re-prepared pair can be born "behind" the line] → that is the pre-existing meaning of the pair branch, not something reattachment introduces: a pair prepared before the line moved is equally behind it, and preparation has never fast-forwarded anything. The preview states which commit the side is born from either way (`<side>-created-from`), so the divergence is visible rather than silent, and moving the pair onto a newer tip stays the operator's own merge/rebase decision inside the worktree.
- [Windows path shapes in the root comparisons] → all new comparisons go through the existing `samePath`/flavor machinery (`workspace/identity.ts`); fixtures cover a case-aliased recorded root on Windows.

## Migration Plan

No data migration: index entries, markers, plans, and tokens keep their shapes; stale plans stored under `planning-workspaces/plans/` remain loadable (revalidation semantics change only in apply's create branch). Rollback is a plain revert. After landing: `pnpm build`, reinstall the dogfood CLI (tarball harness), then the next elftia delivery runs its retention through the official verified-checkout flow with no waiver — that waiver-free run is the acceptance pilot for the sibling A + B pair, coordinated with the operator because it mutates the live stores (owner action, not CI; the 2026-08-25 xlsx archives are already sound and are not re-run).

## Open Questions

- None blocking. (Whether target lines on actively-published stores should point at remote-tracking refs, and any upstream-divergence advisory, are G2 scope. Whether the retention/finalization skill text should steer sessions to `plan --apply` is a doc follow-up alongside G2.)
