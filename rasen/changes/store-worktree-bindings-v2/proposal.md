## Why

The planning contract landed by `store-planning-contract-v2` can describe a planning worktree, a
target line, and a workspace pair — but nothing on this line can *create* one. A Store cannot gain a
second release line after it exists, because nothing authors a target-line catalog. And the only
planning worktree Rasen accepts is one an operator assembles by hand with a `git worktree add` plus a
hand-written marker file, which is admitted on the strength of that file alone: nothing checks that
the target line resolves, that the marker agrees with the Change's own committed identity, or that
the worktree is still the one the marker describes.

This change fills that gap. It is also the first place in this workstream where Rasen mutates Git on
a user's behalf, so mutation goes through an immutable plan and a content-addressed token
revalidated against commit identities under semantic locks, the allowed Git verb set is closed and
non-destructive, and every uncertain fact — an unresolvable ref, a disagreeing marker, a dirty tree,
an unmerged branch — refuses rather than repairs itself.

## What Changes

- Add **target lines** as explicit, authored Store content: `add` / `set-ref` / `list` / `show` /
  `resolve`. A target line's identity is stable while its Store ref and per-project code refs are
  mutable locators resolved to concrete refs and commit identities at use time. Changing a locator
  never changes the identity, and no command ever infers a target line from a branch name.
- Add **workspace preparation as plan then apply**. Planning is read-only, total, and reports every
  problem it finds rather than stopping at the first. Applying consumes only the content-addressed
  token — it re-reads neither the current directory nor the selectors that produced the plan — and
  creates worktrees from the commit identities the plan froze, so a ref that moves between plan and
  apply invalidates the plan instead of silently retargeting it.
- Derive the planning and execution **worktree identities** from canonical Git repository and worktree
  identity, and complete the **workspace pair** when the pair's single Change instance exists. A
  prepared workspace is unbound until exactly one Change is created in its planning worktree, then
  bound; a second Change creation in the same planning worktree is refused.
- Record the binding in **four carriers with explicit authority**: the Change's committed identity
  block is the portable half, the planning-worktree marker and the execution-worktree association are
  per-worktree local locators, and the machine workspace index is a rebuildable cache that is
  re-verified before every use and is never authority on its own. A missing index entry is repaired
  from the markers and Git; a disagreeing one fails closed.
- Add the **semantic lock protocol**: owner-aware machine-root locks acquired in a fixed order with
  bounded retry. Contention retries; a semantic conflict never does. Workspace preparation and
  cleanup take the scope and workspace locks; the change and integration lock kinds are published for
  the finalization owner, which is a later slice — so they are defined here and deliberately have no
  taker yet.
- **Refuse rather than repair** on every binding disagreement, through a closed and named conflict
  taxonomy, so a user is told which fact disagreed with which rather than being silently corrected.
- Guarantee that **preparation never moves a ref, a HEAD, or a working tree**. Reusing an existing
  worktree that sits on a different ref refuses rather than switching it; uncommitted work is left
  alone; an occupied destination refuses; nothing outside the two planned worktree roots is written.
- Add a **cleanup protocol** that is itself plan then apply and removes only what it can prove safe:
  the worktree must be one the pair recorded, on the ref the pair recorded, clean, with every commit
  on its branch reachable from the recorded integration or target ref, with no live session
  referencing it and no lock held. Cleanup never deletes a branch, never merges, never resets, and
  never touches the Store integration checkout, another pair's state, the Change directory, or the
  Archive.
- **Close the Git verb set with a source guard.** The workspace adapter may call `worktree add`,
  `worktree remove`, `worktree prune`, and read-only plumbing, and may never call `merge`, `rebase`,
  `reset`, `checkout`, `switch`, branch deletion, `push`, `fetch`, `clone`, or a forced worktree
  removal.
- Make every coordination write **atomic, self-verifying, and recoverable**: an interrupted write may
  be resumed by an identical retry only when its target, intended bytes, directory, prior target, and
  intent still match exactly; corrupt, disagreeing, foreign, or replaced state is kept intact and
  refused. Only a demonstrably unsupported directory-synchronization outcome degrades to a
  portability path — permission, device, capacity, file-sync, and close failures stay visible.
- Add `rasen store workspace plan|apply|show|cleanup` and `rasen store target-line
  add|set-ref|list|show`, each with a machine-readable form whose content matches the human form, and
  each printing scoped commit suggestions while staging, committing, fetching, and pushing nothing.
- **Behavior tightening (not a capability loss):** a planning-worktree marker is no longer sufficient
  on its own. It must declare the resolved Store, project, and target line; its target line must
  resolve to an existing Store ref; and its worktree identity must re-derive from the live
  repository. A healthy hand-assembled pair keeps working and is indexed on first use; an inconsistent
  one that previously passed now fails closed.

**Deliberately deferred, with evidence** (see design.md for the measurements):

- The **session-frozen worktree pair** and its `rasen context` projection. On the reference line this
  shipped in the same change and raised the session context file version from 1 to 2. On this line
  that file is the substrate under a live daemon, session supervisor, durable session registry, and
  reusable-session service — thirteen production consumers, six inside the management API. A breaking
  version bump there is a daemon-regression risk that has nothing to do with worktree bindings, and
  the workspace pair remains fully auditable here through `store workspace show`. Deferred as an
  inbound item to the store-session execution-context slice, which owns that file already.
- Wiring workspace preparation onto the `StorePlanning` seam. That seam does not exist on this line;
  it belongs to the scope-routing and finalization slices.

## Capabilities

### New Capabilities

- `store-target-lines`: stable target-line identity with mutable Store and per-project code-ref
  locators, explicit authoring, resolution to concrete refs and commit identities, and the gate that
  stops a Change from being re-pointed at another line.
- `store-planning-worktree-bindings`: the immutable workspace plan and revalidated token, planning and
  execution worktree identities and their pairing, the four binding carriers and their authority
  order, the conflict taxonomy, the semantic lock protocol, the non-mutating preparation rule, the
  closed Git verb set, the machine-readable report of a pair, atomic coordination-write recovery and
  durability portability, and the safe cleanup protocol.

### Modified Capabilities

None. `session-runtime-context` is modified by the reference change and is deliberately not modified
here — see the deferral above. No existing capability's requirements change: this change adds command
groups and Store content without altering Store registration, membership, root selection, file
placement, or archive behavior.

## Impact

- **Adds** `src/core/store/workspace/**` (thirteen modules: plan, apply, cleanup, binding, identity,
  registry, locks, scope, module, types, diagnostics, dependencies, index) and
  `src/core/store/target-lines.ts`, built on the planning-foundation contract this portfolio's first
  change landed.
- **Adds** one machine-root family for plans, the binding index, and locks. Neither Git repository
  stores a plan, a token, a lock, or an index entry, and no command in this change stages, commits,
  fetches, or pushes.
- **Adds** `rasen store workspace` and `rasen store target-line` to the command tree, the completion
  registry, and all three locale trees in lockstep.
- **Extends** the shared file-lock module with one additive predicate so a read-only "is this lock
  held?" probe reflects the acquire protocol instead of treating file existence as ownership.
- **Adds** target-line, identity, plan/token, lock, binding, conflict, cleanup, atomic-write, and
  Git-verb-guard suites; a two-line concurrent end-to-end journey; and Windows/POSIX path-identity,
  alias-path, and long-path fixtures.
- **No** new runtime dependency, no change to Store registration or membership, no Git mutation
  outside the two planned worktree roots, and no management-API or UI surface.
- **Unblocks** `store-issue-resources`, the last change of this portfolio, which imports the workspace
  dependency, lock, binding, and registry surfaces.
