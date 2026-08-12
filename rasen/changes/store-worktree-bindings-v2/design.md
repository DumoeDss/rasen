## Context

Second of three serial children of the `store-v2-foundation` slice, Layer 1. It depends on
`store-planning-contract-v2` (landed on this branch at `f8e17e3d`) and unblocks
`store-issue-resources`, which imports this module's dependency, lock, binding, and registry surfaces.

`dev/0.1.7` is a released, frozen behavior reference — never a copy target. Attribution below follows
the recipe this portfolio established during the first child: **the tip of a file is never the port
target**; separate the reference child's own contribution from what later children added to the same
file, then decide each block on where its consumers live.

### Attribution: what the reference line did to this child's files

Unlike the first child, there is no single clean ship commit. `0ede6cfb` is a squash of five 0.1.7
children delivered as one PR. Its effect *on this child's files* is nonetheless unambiguous: it
introduces all of them at once, from nothing.

| Commit | Effect on this child's files | Owner | Decision |
| --- | --- | --- | --- |
| `0ede6cfb` (squash) | Creates `workspace/**` (13 files, 5,470), `target-lines.ts` (569), `commands/workspace.ts` (377), `commands/store-target-line.ts` (203) — 6,619 insertions from zero | **this child** | **Base.** |
| `0ede6cfb` | `session-runtime-context.ts` +84, `commands/context.ts` +131, `file-state.ts` +19 | mixed | file-state **included**; the other two **carved out** — Decision 2. |
| `79fd80a9` `fix(archive): enforce crash-safe finalization recovery` | `workspace/dependencies.ts` +468 | atomic write block | **included** — Decision 3. |
| `55aafa1d` `fix(archive): harden recovery ownership checks` | `workspace/dependencies.ts` +113 / −45 | same block | **included** — Decision 3. |
| `bf6bdbb7` `fix(workspace): harden atomic claim recovery` | `workspace/dependencies.ts` +489 / −151 | = archived fixup `2026-08-10-fix-workspace-claim-portability` | **included** — mandated fixup. |
| `70b5a74c` `fix(store): complete existing-change workspace binding` | `workspace/apply.ts` +78, `module.ts` +41 | = archived fixup `2026-08-09-fix-existing-change-workspace-binding` | **included** — mandated fixup. |
| `3b050663`, `7efdc849`, `43c7e88f` | `project-registry.ts` +471 net | scope-routing and registry hardening | **excluded** — not this child, and not this portfolio. |

Net: this child ports `workspace/**` and `target-lines.ts` at the 0.1.7 **tip**, because every
post-squash change to those files is either one of the two mandated fixups or the block those fixups
rewrote. That is the opposite conclusion from the first child, reached by the same method — which is
the point of running the method rather than assuming an answer.

### Measured collision surface

| Path | 0.2.0 churn since merge-base `e62b101f` | Consequence |
| --- | --- | --- |
| `src/core/store/**` | **empty diff** | The whole module lands on an untouched base. |
| `src/core/file-state.ts`, `project-registry.ts`, `global-config.ts`, `store/registry.ts`, `commands/store.ts`, `store/membership.ts` | **empty diff** | Every dependency and every declared rim file is byte-identical on both lines. The portfolio record's "rim overlap on `commands/store.ts` + `store/membership.ts`" is clean on the 0.2.0 side. |
| `src/cli/index.ts` | +140 | Command registration. Append-style; both lines only add. |
| `src/core/completions/command-registry.ts` | +150 | Same shape. |
| `src/core/session-runtime-context.ts`, `src/commands/context.ts` | **empty diff** | Not a textual collision — but a *semantic* one. See Decision 2. |

Every external import `workspace/**` makes was checked against this line and resolves:
`utils/file-system`, `canonical-json`, `change-metadata`, `file-state`, `global-config`,
`project-registry`, `store/{errors,foundation,identity-types,registry,target-lines}`,
`store/{planning-foundation,planning-identity,planning-layout-v2}` (delivered by the first child),
plus `node:{async_hooks,child_process,crypto,fs,fs/promises,path,util}` and `yaml`. **Nothing in
`workspace/` imports `store-planning/`, `layout-migration/`, `issues/`, or `query/`.**

## Goals / Non-Goals

**Goals:**

- Land the workspace plan/apply/cleanup module and target-line operations on this line, whole.
- Fold both archived fixups in rather than re-discover the defects they fixed.
- Answer the portfolio's two inbound review lessons with evidence rather than assurance.
- Keep the ported file layout byte-comparable to the reference so the archived 0.1.7 changes stay
  usable as a diff-able reference.
- Regress nothing: in particular, nothing in the daemon, session supervisor, or reusable-session
  stack this line has built.

**Non-Goals:**

- The session-frozen worktree pair and the `rasen context` projection — Decision 2.
- Wiring preparation onto the `StorePlanning` seam, or unlocking finalization. Those slices do not
  exist on this line.
- Store Issues and the aggregate query — the next child.
- `membership-layout.ts`, `layout-write-guard.ts`, `migration-ops-v2.ts`, `consistency-gates.ts`,
  `layout-migration/**` — removed from this child by portfolio decision and owned by the
  layout-migration slice.
- Minting layout v2 at Store creation. The reference change recorded this as a known remaining gap
  belonging to `store-bootstrap`; it is still out of scope here.

## Decisions

### 1. `workspace/` ports whole — all thirteen files

Settled by portfolio decision and not reopened. Recorded here because the reasoning must survive into
review: the source-only closure of what the next child imports is 7 of 13 files, but
`test/helpers/store-workspace-fixture.ts` imports the module barrel, which pulls `apply`, `cleanup`,
and `plan`, and five of the next child's ten test files go through that fixture. Buying the paper
saving would mean discarding the reference test suite this whole portfolio leans on, to avoid
shipping source this child is chartered to deliver anyway.

The portfolio's standing rule applies to the file layout too: do **not** extract the two string
constants the next child takes out of `binding.ts` (611 LOC) merely because they look separable.
Byte-comparability with the reference is worth more than local tidiness.

### 2. The session-frozen pair and the `rasen context` projection are carved out

The reference change also modified `session-runtime-context`, freezing the complete pair into the
session and **raising the session context file version from 1 to 2** — a change it declared BREAKING.

On the reference line that was cheap. On this line it is not, and the difference is measured:

- `src/core/session-runtime-context.ts` has **13 production consumers** here, six of them in the
  management API: `supervisor.ts`, `sessions.ts`, `session-registry.ts`,
  `durable-session-registry.ts`, `reusable-session-api.ts`, `session-launch-context.ts`. The
  reference line had none of that stack.
- The version is not advisory. `RUNTIME_CONTEXT_VERSION` is currently `1`, it is bound into the
  schema as a literal, and a declared version that differs is rejected on read. Bumping it makes
  every context file already on disk unreadable — under a daemon that keeps durable session
  registries alive across restarts.
- The workstream's own target state lists "change-run Run Record, daemon / SessionSupervisor,
  reusable sessions, and ECP are not regressed" as an outcome. A breaking bump to that substrate, to
  deliver a reporting convenience, is the wrong trade in this child.
- The carve-out is clean at every boundary: nothing in `workspace/**`, `target-lines.ts`,
  `commands/workspace.ts`, or `commands/store-target-line.ts` imports `session-runtime-context` or
  `commands/context.ts`. Their entire import surface is listed in Context above.

What is **not** lost: the pair stays fully auditable. The reference's requirement that machine-readable
output report the pair as inert locators is retained here, re-homed onto `store workspace show`, which
this child ships. What is deferred is the *session freezing* and the `rasen context` projection —
handed forward as an inbound item to the store-session execution-context slice, which owns
`session-runtime-context.ts` already and must touch it regardless.

`src/core/file-state.ts` +19 is kept: it is one additive exported predicate that lets a read-only
lock probe apply the same ownership test the acquirer applies, and the lock protocol in this child
depends on it. Zero collision, no version change.

### 3. The atomic coordination-write block ports, and its only production caller is deferred

`workspace/dependencies.ts` grew by 876 lines after the squash — larger than the file was. All of it
is one coherent block: the atomic workspace write, its snapshot reader, carrier authority, claim
recovery, and directory-durability portability.

Attribution was not obvious, and the naïve read is wrong twice over:

- Two of the four contributing commits are titled `fix(archive): …`, which suggests the finalization
  slice. But the third and largest, `bf6bdbb7`, **is** the archived fixup
  `2026-08-10-fix-workspace-claim-portability` that this child is mandated to fold in, and its
  proposal names `src/core/store/workspace/dependencies.ts` as the file it fixes.
- Its only *production* consumer is `finalization/association.ts`, which belongs to a deferred slice.
  By the first child's rule that would argue for exclusion. But it has a dedicated ~920-line suite in
  this child's own namespace, `test/core/store/workspace-atomic-write.test.ts`, which does not import
  finalization at all and covers crash recovery, carrier authority, alias targets, and
  platform-specific durability errors directly.

Excluding it is also not mechanically possible without inventing a file state that never existed on
the reference line: `bf6bdbb7` rewrote the block (+489 / −151), so folding in the mandated fixup and
excluding the block are the same edit contradicting itself.

Decision: **port it, and say plainly what it is** — a durable-write primitive that lives in this
child's dependency layer, is directly covered by this child's own suite, and whose production caller
arrives with the finalization slice. It is not vacuous (its suite exercises it), and it is not
silently smuggled (it is stated here and pinned by a task). No other `workspace/` file uses it; that
was checked, not assumed.

### 4. Six digest sites make this child squarely subject to the relational-blindness lesson

The portfolio's most expensive lesson is that a suite built from `toMatch(shape)`, `.toBe(other)`,
`.not.toBe(other)` and distinct-set counts is uniformly blind to any change that transforms every
value the same way. This child has **six** such sites, every one a `sha256` over a canonical
serialization:

| Site | Value |
| --- | --- |
| `workspace/plan.ts:794` | the workspace plan id — the content-addressed token `apply` consumes |
| `workspace/cleanup.ts:170`, `:251` | the two cleanup plan ids |
| `workspace/locks.ts:128` | the lock key digest, over a versioned domain preimage |
| `workspace/registry.ts:201` | the binding index document digest |
| `workspace/binding.ts:93` | the binding document content digest |
| `workspace/dependencies.ts:343` | the atomic carrier content digest |

The reference spec's own scenario **"Equal inputs produce an identical plan"** is exactly the blind
shape: it compares two derivations *to each other*, so it stays green under any uniform change to the
preimage or the serialization. That scenario is retained here and **anchored** — it now also requires
the token to equal a pinned value for those exact inputs.

Every one of the six therefore needs a known-input / known-value anchor, with the inputs **pinned as
literals per anchor and never chained off a previous derivation** — a chained anchor smears a break
across all of them instead of localising it — and each anchor must also walk back through the value's
own reader or verifier, so a preimage change cannot hide behind a verifier that stopped checking.
This is tasks 6.1–6.3, and it is the single most important thing in this change's test surface.

### 5. No new branded types, so the first child's vocabulary guard needs no extension

The portfolio carries an inbound note that the first child's brand-vocabulary guard reads exactly
three hardcoded source files, so a brand declared elsewhere inherits none of it. Checked directly:
`git grep 'unique symbol'` across `src/core/store/workspace/**` and `src/core/store/target-lines.ts`
on the reference line returns **nothing**. This child declares no branded type; it consumes the
identity brands the first child already ships and guards.

So the guard needs no extension here, and adding files to its list would be noise. The note stays
live for the next child, which must re-run the same check rather than inherit this answer.

### 6. Lock kinds are defined here and two of them deliberately have no taker

The protocol defines four lock kinds — scope, workspace, change, integration — in a fixed acquisition
order. Preparation and cleanup take **scope** and **workspace**. The **change** and **integration**
kinds are published for the finalization owner, which is a later slice.

This is stated as a decision because the portfolio records a review hazard of exactly this shape: an
ordering assertion that compares two frozen arrays keeps passing while the ordering it encodes loses
every enforcement surface. The honest position here is that two of the four kinds are
**unenforced-by-design in this child**, and a test that merely proves the order array is well-formed
proves nothing about that. Task 6.4 requires the taker of each kind to be named in shipped code, and
any kind whose taker lives in a deferred slice to be recorded as deliberately unenforced rather than
counted as covered.

### 7. Preparation is fail-closed by construction, not by convention

Three rules carry the safety of this child and each is structural rather than advisory:

- **Plan is total and pure.** It writes nothing and reports every problem, so a user fixes one round
  of problems rather than discovering them one refusal at a time.
- **Apply consumes only the token.** It re-reads neither the working directory nor the selectors.
  This is what makes locked decision D2 — runtime cwd is never a durable binding — hold at this layer
  and not merely upstream.
- **Preconditions are commit identities, not ref names.** New worktrees are created from the recorded
  commit, so a ref that moves between plan and apply invalidates the plan instead of quietly
  retargeting it somewhere else.

The Git verb set is closed by an explicit constant plus a source guard, per the repo rule that
generated or restricted sets are tracked by name in a constant rather than detected by pattern.

## Risks / Trade-offs

- [Risk] This is the first Git mutation in the workstream, on a user's real repositories. → Immutable
  plan, token revalidated against commit identities, closed non-destructive verb set with a source
  guard, no write outside the two planned roots, and refusal rather than repair on every
  disagreement. Task 6.5 audits the diff for exactly this.
- [Risk] Carving out the session-frozen pair means this child ships bindings that the *session* does
  not yet enforce, so a command inside a session can still resolve a worktree from the working
  directory. → Accepted and bounded: this child changes nothing about that behavior, so it is not a
  regression, and `store workspace show` reports drift. Recorded as an explicit inbound item so the
  owning slice cannot silently drop it.
- [Risk] The atomic-write block ships with its production caller deferred, so a reviewer could read it
  as dead code. → Decision 3 states it plainly, its own suite exercises it, and a task pins the
  suite's presence and result so the situation is visible rather than discovered.
- [Risk] Two lock kinds have no taker, and the ordering assertion cannot tell. → Decision 6 and task
  6.4: name the taker of each kind in shipped code and record the unenforced ones as such.
- [Risk] Six digest sites, and the reference suite's own strongest plan scenario is relationally
  blind. → Decision 4 and tasks 6.1–6.3: pinned literal anchors per site, each walked back through
  its own reader.
- [Risk] `rasen store workspace` and `store target-line` add command surface across the command tree,
  the completion registry, and three locale trees, which this repo has repeatedly broken by moving
  them out of lockstep. → Task 5.4 treats locale and completion parity as one atomic step with an
  explicit count check.
- [Risk] `workspace/` touches real Git worktrees and real paths, and the reference suite includes
  Windows alias, case, and long-path fixtures. → Windows behavior is a product requirement in the spec
  (identity aliasing, exact filesystem identity, directory durability) and task 6.6 requires the
  Windows CI leg, not a POSIX-only run.
- [Trade-off] Porting `workspace/` whole ships ~6,400 LOC in one child. That is large for one review,
  but it is one coherent module with one entry point, and every alternative measured costs more than
  it saves.

## Migration Plan

1. Add `target-lines.ts` and the target-line command group; they have no dependency on the workspace
   module and can be verified alone.
2. Add `workspace/**` whole at the reference tip — base plus both mandated fixups — and its command
   group.
3. Add the additive file-lock predicate and wire the lock probe to it.
4. Register both command groups across the command tree, completions, and all three locale trees in
   one step.
5. Port the test surface, then add the anchors Decision 4 requires.

Rollback is removal of the two additive modules, the two command groups, their registrations, and one
exported predicate. Nothing in this child changes an existing record format, an existing command's
behavior, or any file already on disk, so rollback needs no data migration.

## Open Questions

None blocking. One item is handed forward rather than left open: the session-frozen pair and the
`rasen context` projection are an inbound acceptance item for the store-session execution-context
slice, recorded in the proposal and in the portfolio's planning context.
