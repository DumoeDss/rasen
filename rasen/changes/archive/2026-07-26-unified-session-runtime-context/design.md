## Context

`resolveSessionLaunchContext` (`src/core/management-api/session-launch-context.ts`) already does the hard part. It validates the execution selector, resolves the space, checks the checkout is live, confirms the registry entry's `projectId` matches, and returns:

```ts
{ planningSpace?, cwd, attachedRoots, executionProject?: { projectId, root } }
```

Then `sessions.ts:146-154` builds the launch call from `resolved.cwd`, `resolved.attachedRoots`, and `resolved.planningSpace` — and drops `executionProject` on the floor. It reaches nothing downstream:

- `SessionRecord` (`session-registry.ts:36`) has `cwd` and `space?: SessionSpace`, and no execution field at all.
- `supervisor.ts:300` spawns with `env: process.env` — nothing session-specific is injected.
- `run-state.ts:167` freezes `knowledgeContext` only, and `freezeKnowledgeContext` (`learned-skills/context.ts:547`) freezes `{ planningRoot, owner }` as `{type, id}` pairs with no checkout binding.
- `buildActionContext` (`change-status-policy.ts:55`) returns `allowedEditRoots: [input.projectRoot]` — one root, one meaning.

So the selected checkout survives only as `cwd`, by coincidence. Anything that re-resolves — the knowledge resolver reading `classifyOpenSpecDir`, a resumed pipeline re-deriving its root, `rasen status` in a subshell — starts again from the working directory and the nearest pointer. With one clone per project and a pointer aimed at the Store you are planning in, that lands on the right answer. Change either and it lands somewhere else, silently.

Child A shipped the identity layer this builds on: `resolveStoreBinding()` and its tri-state, `hasStoreDeclaration(pointer)`, `inspectRegisteredStore` (now `src/core/store/inspection.ts`), and the `identity-types.ts` vocabulary — including `ResolvedProjectCheckoutRef = { type:'project'; projectId; id?; root; home? }`, which child A defined and left unused. This change is its first real consumer.

**Child B is proposed, not implemented.** Its membership provider (`src/core/store/membership.ts`, `listStoreMembers` / `resolveProjectMembership` returning `StoreMembershipRecord` with `roles: {planning, knowledge}` and `provenance`) exists only as a spec contract. Implementation of this change MUST re-verify child B's final exported surface — names *and* signatures — before starting, and must not assume any child B symbol exists yet. Where this change needs membership validation and child B has not landed, the existing pointer-based member check stays in place behind the same seam.

Constraints from the plan (§16, §17, §18.2, §18.4, §26 Phase C) and §33: the session must carry an exact checkout binding (§33.10); checkout roots never enter Git (§33.5); ordinary commands stay read-only; doctor stays read-only; legacy state stays readable and new shapes are versioned.

## Goals / Non-Goals

**Goals:**

- The session records planning identity, execution identity, and the local checkout binding — all machine-local.
- The child process is handed that context by file path, and commands inside the session read it instead of re-deriving.
- One stated resolution order for a first command, and a different, equally stated one for a frozen resume.
- A frozen/checkout disagreement fails closed rather than selecting another clone.
- File capability separates planning writes, code writes, and reads; planning-only has no code write root at all.
- The legacy single-list capability projection can only narrow, never widen.
- The planning-only restriction is visible where the session is launched and where the agent reads its instructions.

**Non-Goals:**

- Which knowledge a project may draw on, the effective algorithm, ledger v2, the logical knowledge home (child D). This change makes the knowledge resolver *read the session context*; it does not change what the resolver then decides.
- Bootstrap (child E), knowledge bundles (child F), Issue / Execution Plan / checkpoint (`0.2.0`, never).
- Re-litigating the launch-time validation `resolveSessionLaunchContext` already performs. This change propagates its result; it does not redesign it.
- Rewriting the Store member listing — that is child B's.

## Decisions

### D1 — Spec surface is one NEW capability plus one uncontested MODIFIED capability

This change deliberately writes **no** delta against `session-supervision`, `task-detail-ui`, `planning-space-addressing`, or `learned-skill-knowledge-context`. All four are already owned by another unarchived change:

| Capability | Owned by | Status |
|---|---|---|
| `session-supervision`, `task-detail-ui` | `separate-session-planning-and-execution-context` (PR #68) | code merged into `dev/0.1.5`, **change never archived** |
| `planning-space-addressing`, `store-project-membership`, … | `project-keyed-store-membership` (child B) | proposed |
| `learned-skill-knowledge-context` | `store-aware-learned-skills-context` / `-scope` | child D's source material |

`MODIFIED` replaces an entire requirement at archive time, so two changes carrying a `MODIFIED` block for one requirement means whichever archives second silently discards the other's work. The PR #68 case is worse than a sibling collision: its code is already in `dev/0.1.5` while `rasen/specs/session-supervision/spec.md` still describes the pre-#68 behavior, so main is stale relative to shipped code. A `MODIFIED` here would be written against a spec that does not describe reality, and a requirement this change might want to extend (`Session launch separates planning space from validated execution context`) exists only in #68's pending delta.

So the runtime contract lands as its own capability, `session-runtime-context`, composed with session supervision rather than editing it. That is honest decomposition — "what a session records and hands to its child process" is a distinct behavior area from "how a session is spawned and supervised" — and it makes this change archivable in any order relative to #68.

The one modified capability is `cli-artifact-workflow`'s `Status JSON action context`, which no active change touches.

### D2 — `RuntimeContext`: durable identity plus local binding, versioned

```ts
type RuntimePlanningRef =
  | { type: 'project'; projectId: string; root: string }
  | { type: 'store';   uid?: string; id?: string; root: string };

type RuntimeExecutionRef =
  | { kind: 'planning-only' }
  | { kind: 'project'; projectId: string; root: string; home?: string };

type RuntimeContext = { version: 1; sessionId: string;
                        planning: RuntimePlanningRef; execution: RuntimeExecutionRef };
```

`uid` is optional on the Store arm for exactly the reason child A made it optional on `ResolvedStoreRef`: a Store whose metadata predates permanent identities resolves legitimately with no identity yet. It is never optional in anything durable. The project arm reuses child A's `ResolvedProjectCheckoutRef` shape rather than redeclaring it.

`root` appears throughout because this structure is machine-local by construction (D3). Consumers that persist anything shared strip to durable identity — the existing rule that manifests, ledgers, and digests carry no root is unchanged.

### D3 — The context file is machine-local, and the child gets its path

`<machine data dir>/sessions/<sessionId>/context.json`, written atomically (temp + rename) before spawn and removed when the session finalizes. Absolute paths are allowed here and only here: the file never enters Git, is never shared, and dies with its session.

The supervisor sets `RASEN_SESSION_CONTEXT=<absolute path to that file>`. **The path, never the JSON.** Inlining the document would put roots and identifiers into the process table, every `ps` listing, and any log that dumps the environment — and would hit quoting and length limits on Windows besides. A reader that finds the variable set but the file missing or unparseable reports it as a broken session context rather than falling back, because a silent fallback here is exactly how a command ends up in the wrong clone.

Cleanup is best-effort on finalize and, failing that, on the session registry's existing exited-record prune — a stale context directory is inert (its session id no longer resolves) but should not accumulate.

### D4 — Two resolution orders, stated separately

**First command in a session** (§16.3):

```
explicit CLI selector  →  session context  →  launch cwd / pointer fallback
```

**Resumed frozen run** — a different shape, not a longer version of the same list:

- the **frozen durable identity is the authority** — it says which project the run belongs to;
- the session context, and failing that the current checkout, is the **local locator** — it says where that project is on this machine;
- an explicit selector **only cross-checks**; it cannot retarget a frozen run.

Mismatch handling, fail-closed:

- frozen `projectId` ≠ the session's execution checkout identity → **fail**, naming both and the checkout. Never fall back to another clone of the same project. A run resumed into the wrong working tree is data loss with a plausible-looking diff, which is worse than an error.
- no session context → the current directory is used **only if** its config identity matches the frozen `projectId`; else a single registered checkout for that `projectId`; else `project_binding_ambiguous`, listing the candidates.

The existing `freezeKnowledgeContext` output stays readable and is extended, not replaced: the frozen record gains the execution identity alongside the planning root and owner it already carries, under a bumped version, with the old shape read as "no execution binding recorded" rather than as an error.

### D5 — `ActionContextV2`, and a projection that can only narrow

```ts
type ActionContextV2 = {
  version: 2;
  planningWriteRoots: string[];
  codeWriteRoots: string[];
  readRoots: string[];
  requiresAffectedAreaSelection: boolean;
  constraints: string[];
};
```

Composition:

| Session shape | `planningWriteRoots` | `codeWriteRoots` | `readRoots` |
|---|---|---|---|
| Store planning + project execution | the Store's `rasen/specs` and `rasen/changes` | the selected checkout | Store root, selected checkout |
| Project planning + own execution | that project's `rasen/specs` and `rasen/changes` | that checkout | that checkout |
| Planning-only | the Store's `rasen/specs` and `rasen/changes` | **`[]`** | Store root |

Security clauses, all load-bearing and each stated as a spec scenario rather than left to implementation care: never add a Store's other member checkouts to `codeWriteRoots`; never add a home directory to any list; narrow planning writes to the planning subdirectories rather than granting a repository root; and `--add-dir` remains process visibility, not authorization — a root being readable by the process never implies it is writable by the work.

The v1 projection is the delicate part. `allowedEditRoots` is computed as `codeWriteRoots ∪ planningWriteRoots` only when that union is a subset of what v1 would previously have granted for the same session; when it is not — the Store-planning-plus-project-execution case, where v1 had no way to express two roots — the reported `version` changes so a v1 consumer sees an unknown contract and stops, rather than inheriting a root it never asked for. Widening silently is the one outcome this projection must make impossible.

### D6 — Membership validation, with a seam that survives child B not existing yet

Choosing a project to execute in a Store session validates, in order: the Store resolves and is healthy (child A's `resolveStoreBinding`); the checkout exists; the checkout's own config `projectId` matches the selector's; and the Store's membership record permits it (child B's provider). A project whose primary pointer names a *different* Store is explicitly still valid — the session pins planning explicitly, which is the whole point of separating the two relations.

The current implementation checks membership by reading the member repo's pointer (`session-launch-context.ts:174`, `pointer.value !== resolvedSpace.space.id`). That check is replaced by a single call behind one seam. Until child B lands, the seam's implementation is today's pointer check; after, it is `resolveProjectMembership`. Two consequences worth stating: the pointer check must go through `hasStoreDeclaration` / durable comparison rather than `pointer.value`, because a durable declaration carries no alias (child A's most-repeated trap); and this change adds `session-launch-context.ts` to the boundary test's file list so the by-id-lookup ban keeps covering it.

**Resolved during implementation: the seam is a UNION of two authorities, not a switch.** Child B's provider answers `null` for a project whose only link to the Store is its own `store:` declaration — the shape of every install that predates membership records. Switching the seam wholly onto the provider would therefore have made every pointer-declared project unselectable, which is the regression this seam exists to prevent. So `storePermitsProject` accepts when *either* the Store's record vouches or the project's own durable declaration resolves to this Store's root. It strictly widens: it can never accept a project neither authority vouches for, the declaration arm requires `binding.kind === 'resolved'` (an unavailable Store fails closed), and the identity checks immediately upstream prove the declaration read is that project's own. The requirement in `specs/session-runtime-context/spec.md` states both authorities, because a spec narrower than this gate invites a future reader to "tighten the code to spec" and re-create exactly that regression.

**Known-open — the union's long-term home is inside the provider, not at its call sites.** Child B's landed requirement says every surface asking which projects belong to a Store gets its answer from one provider; there are now two surfaces consulting a second authority outside it — B's own `spaces.ts` (its design D9, for the same reason) and this seam. Teaching `src/core/store/membership.ts` the declaration arm is a small additive change after which both call sites collapse to one authority, B's requirement holds literally, and this requirement's sentence reduces back to naming one authority. **Owner: the next change that touches `membership.ts` — most likely child D (`store-scoped-learned-knowledge` or `learned-knowledge-effective-resolution`).** Deliberately not done here: `membership.ts` is child B's file, the change is additive rather than corrective, and doing it during child C's ship would put a shared provider's behaviour change inside a session-context change's blast radius.

### D7 — Wire types and the UI mirror are one task, not an assumption

`src/core/management-api/wire-types.ts` gains the session's execution fields. A purely additive server-side change still leaves `packages/ui/src/api/types.ts` silently stale, because the mirror is maintained by hand and nothing fails when it drifts. Updating the mirror is an explicit task, and the launch dialog reads the new fields to state which project a run will modify and, for a planning-only run, that it will modify none.

**Sequencing constraint:** `packages/ui/src/components/LaunchSessionDialog.tsx` and `packages/ui/src/api/types.ts` are currently clear of the concurrent session's edits, but `packages/ui/src/i18n/locales/{en,ja,zh-cn}.json` are not. Any new UI string therefore cannot be written in the same pass; the task list isolates that step so it can be sequenced separately. The CLI-side `src/locales/*.json` work is unaffected.

### D8 — Cross-platform

Every path is composed with `path.join()`; the context file path derives from the existing machine data directory helper. Checkout comparison uses `FileSystemUtils.canonicalizeExistingPath` with the established `path.resolve` fallback, so a drive-letter case or separator difference never reads as a different clone — which in this change would mean a spurious fail-closed. The context file is written UTF-8 without a BOM and read back tolerantly of either line ending. Tests build expected paths with `path.join()`, and Windows scenarios cover a worktree root, two clones differing only by separator form, and the environment variable surviving the Windows shim.

## Risks / Trade-offs

- **Fail-closed on a frozen/checkout mismatch turns a silent wrong-clone resume into an error.** → It is the point of the change; a resume that edits the wrong working tree produces a plausible diff and is far more expensive than an error. The message names the frozen identity, the checkout, and the command to resume in the right place.
- **The v1 action-context projection is where permissions could silently widen.** → Constructed so the union is reported under v1 only when it cannot exceed v1's previous grant, and reports a changed version otherwise. Asserted directly: a test enumerates each session shape and checks the projected v1 root set is a subset of what v1 previously produced.
- **Child B is not implemented, so the membership check has two possible implementations.** → One seam, one call site, today's pointer check behind it until child B lands. Implementation re-verifies child B's final surface first; if it has not landed, nothing about this change blocks.
- **PR #68's change is unarchived while its code is in `dev/0.1.5`.** → This change writes no delta against its capabilities, so the two are order-independent. But `rasen/specs/session-supervision/spec.md` describes pre-#68 behavior today, and anyone reading it as ground truth will be misled. Flagged for the LEAD as portfolio archive debt; not this change's to fix.
- **A stale or hand-edited context file could point a command at the wrong place.** → The file is validated against its schema and its session id on read; a mismatch or parse failure is reported, never silently ignored, and never falls back to cwd derivation.
- **Context files could accumulate under the machine data directory.** → Removed on finalize, with the registry's existing exited-record prune as the backstop; a leftover directory is inert because its session id no longer resolves.

## Migration Plan

1. **Readers and shapes first.** `RuntimeContext`, the context-file reader, the versioned frozen-run-state extension, and `ActionContextV2` with its projection land as readers. Nothing is written yet; every existing session behaves identically.
2. **Propagation.** The launch context's `executionProject` reaches the session record; the supervisor writes the context file and sets the environment variable. This is where the session starts carrying its answer.
3. **Consumers.** The knowledge resolver, run-state resume, and the artifact/instruction surfaces read the session context instead of re-deriving. This is where the fail-closed rules become observable.
4. **Capability.** `ActionContextV2` is reported, with the narrowing v1 projection.
5. **Surfaces, docs, locales.** Wire types, the UI mirror and dialog, `docs/cli.md`, the agent contract, session troubleshooting, JSON examples, and the three CLI locale bundles — with the UI locale strings held for separate sequencing per D7.

Rollback: reverting leaves context files that nothing reads and a frozen run-state field an older reader ignores as unknown. No file written by this change is unreadable to the previous version, and no shared or Git-tracked data is touched at all.

## Open Questions

- Whether the session context file should also carry the resolved `ActionContextV2` rather than having each consumer recompose it from planning and execution. Recomposition is assumed here so there is one derivation rather than a cached copy that can go stale mid-session; caching it becomes attractive only if the recomputation shows up in profiling.
- Whether `rasen doctor` should report orphaned session context directories. It is read-only and cheap, but it is reporting on transient state rather than durable configuration, so it is left out until someone actually trips over an accumulation.
