## Context

`POST /api/v1/sessions` currently has one location input, `space`. The router resolves it to a planning root, `sessions.ts` uses that same root as the subprocess working directory, and the Supervisor builds a fixed headless-Claude argv. This is correct for an in-repo project but wrong for a Store: Change/spec/run-state artifacts belong to the Store while Git, dependencies, tests, and code edits belong to one member project or linked worktree.

The current foundations already provide most facts needed for a safe split:

- planning spaces resolve through `resolveSpaceSelector`;
- project selectors resolve registered projects and linked worktree roots through `resolveProjectSelector`;
- the project registry distinguishes `in-repo` and Store-pointer entries;
- Store membership is authoritative only while the member's current `store:` pointer still names that Store;
- `SessionRecord.space` and `SessionRecord.cwd` can already represent distinct planning and execution locations;
- the Windows Supervisor path already escapes every server-built argv token through the `.cmd`/`.bat` double-parse boundary.

The management server remains a read-only resolver and launcher. The session registry remains process-only; planning and pipeline truth stay in existing disk artifacts.

## Goals / Non-Goals

**Goals:**

- Make planning attribution and execution cwd separate, explicit concepts.
- Resolve the complete launch context behind one deep module boundary.
- Preserve project launch compatibility while refusing ambiguous Store execution.
- Validate a Store execution project/worktree from current registry, Git worktree, filesystem, and pointer facts.
- Attach a distinct Store planning root to headless Claude without exposing client-controlled argv.
- Preserve `session.space = planning space` and `session.cwd = actual execution root`.
- Keep server and UI wire types mirrored and test the path on Windows, macOS, and Linux.

**Non-Goals:**

- Issue or Execution Plan schemas, persistent target-project binding, or durable Change ownership.
- A multi-project scheduler, automatic project routing, or attaching every Store member to one session.
- Board information-architecture changes or redefining member chips as ownership.
- Re-enabling Workset CLI-agent openers.
- Adding Codex browser supervision or a general runtime-adapter redesign.
- Persisting an execution selector or execution project on the Session record.

## Decisions

### D1. Use one deep `resolveSessionLaunchContext` selector-in / facts-out seam

Add a module such as `src/core/management-api/session-launch-context.ts` with one public operation:

```ts
interface ResolveSessionLaunchContextInput {
  space?: string;
  execution?: string;
  launchProject: {
    root: string;
    projectId: string;
    name: string;
  } | null;
}

interface ResolvedSessionLaunchContext {
  planningSpace?: SessionSpace;
  cwd: string;
  attachedRoots: string[];
  executionProject?: {
    projectId: string;
    root: string;
  };
}

type SessionLaunchContextResult =
  | { ok: true; context: ResolvedSessionLaunchContext }
  | { ok: false; status: number; code: string; message: string };

async function resolveSessionLaunchContext(
  input: ResolveSessionLaunchContextInput
): Promise<SessionLaunchContextResult>;
```

The module accepts selectors and returns launch-ready facts. Behind this small interface it owns:

- explicit and launch-project-fallback planning-space resolution;
- execution-selector parsing;
- project registry lookup and linked-worktree resolution;
- Store-member validation against the owning registry entry and current pointer;
- Store planning-only policy;
- existing-path canonicalization and root equality;
- calculation of the one allowed attached planning root;
- stable, pre-spawn error mapping.

`router.ts` stops resolving a session space separately. `sessions.ts` validates only generic request fields, calls this seam, and passes its resolved facts onward. The Supervisor accepts `cwd`, `planningSpace`, and `attachedRoots`; it does not read registries or infer membership. The UI only supplies choices returned by the spaces API; it is never authoritative.

Two plausible interface shapes were considered:

1. **Resolved roots in:** `resolveSessionLaunchContext({ planningRoot, cwd })`. This looks smaller but is shallow: the HTTP handler or UI-facing service must still decide Store membership, pointer freshness, worktree validity, and planning-only behavior. Those rules would spread across callers and could drift.
2. **Selectors in, resolved facts out (chosen):** `{ space, execution, launchProject } -> { planningSpace, cwd, attachedRoots, executionProject? }`. This interface is slightly more semantic but localizes every registry/member/worktree/pointer rule, giving callers a stable launch contract and making the complex implementation replaceable.
3. **A broad stateful resolver object:** separate `resolvePlanningSpace`, `resolveMember`, `resolveWorktree`, and `calculateAttachments` methods with injected registry adapters. This exposes intermediate policy and encourages callers to compose an invalid sequence. The 0.1.5 seam needs one transaction-shaped answer, not a framework.

This is a deep module in the design sense: the interface stays small while the volatile cross-registry and cross-platform reasoning remains hidden behind it.

### D2. Use a compact execution-selector string on the wire

Extend `LaunchSessionRequest` in both the server and UI mirrors with:

```ts
execution?: 'planning' | `project:${string}`;
```

`planning` is an explicit request to use the planning root as cwd. `project:<selector>` reuses the existing registered-project selector vocabulary: the suffix may be a project id, a canonicalizable registered root, or a linked worktree root accepted by `resolveProjectSelector`. Parsing removes only the leading `project:` token, so a Windows drive colon remains part of the suffix.

A discriminated object such as `{ type: 'project', selector } | { type: 'planning' }` was also considered. It is more mechanically extensible, but this slice has only two choices, the product already uses opaque prefixed selector strings, and the scalar form keeps the server/UI mirror and submitted JSON small. Any future execution-plan model should introduce its own durable shape rather than growing this runtime-only selector indefinitely.

The server never treats the suffix as a cwd directly. It must resolve through the registered-project/worktree resolver and, for Store planning, pass membership validation. Malformed values return 400 `invalid_execution`; an explicit Store launch without a value returns 409 `execution_required`; a missing project match returns 404 `execution_not_found`; a dead root, wrong registry mode, stale pointer, or non-member returns 409 `execution_unavailable`. Every failure occurs before Supervisor admission or spawn.

### D3. Apply an explicit selection matrix without guessing

The resolver applies these rules:

| Planning selection | Execution selection | Result |
|---|---|---|
| Explicit project space | omitted | Use the resolved project/worktree planning root as cwd (compatibility). |
| Explicit project space | same-project `project:<selector>` | Use the resolved linked worktree/root; reject a different project identity. |
| Explicit Store space | omitted | Reject with `execution_required`; do not choose the Store root, sole member, or first member. |
| Explicit Store space | `project:<selector>` | Resolve the project/worktree and require current membership in that Store. |
| Explicit Store space | `planning` | Use the Store root as cwd and attach nothing; this is the only Store-root cwd path. |
| Omitted space | omitted | Preserve the trusted daemon launch-project fallback. Derive its planning attribution from cwd; a pointer repo therefore runs in that repo while attaching its Store, while a cwd with no derivable space remains unattributed. |

For a Store member, resolution requires:

1. an existing project or linked-worktree root accepted by the existing project resolver;
2. an owning project-registry entry whose mode is `store`;
3. a current `store:` pointer at the execution checkout that names the selected Store;
4. the same owning project identity when a linked worktree is selected.

These facts are re-read at launch time. A member list previously rendered by the UI is only a convenience snapshot. The resolver freezes the resulting planning space and cwd into the session at launch, matching existing Session semantics.

### D4. Attach only a distinct planning root

All roots are canonicalized with existing filesystem utilities and compared in canonical form. When a planning space is resolved, `attachedRoots` is:

```ts
planningSpace.root === cwd ? [] : [planningSpace.root];
```

An unattributed compatibility launch has no planning root and therefore no
attachment.

No sibling members are attached. This gives the agent access to Store-resident Change/spec/run-state artifacts while keeping one unambiguous primary execution root and avoiding an implicit multi-project write surface.

The optional `executionProject` result is an in-process observation for tests, diagnostics, or future adapters. It is not persisted in 0.1.5 and is not interpreted as durable target ownership.

### D5. Keep the Supervisor policy-free and server-build every argv token

Extend `LaunchInput` with `attachedRoots: readonly string[]`. The Supervisor continues to own only process concerns and builds headless Claude argv itself, adding one `--add-dir <canonical-root>` pair for each resolved attached root. The client cannot supply an argv fragment, executable, `--add-dir`, or raw cwd.

On POSIX and native Windows executables, spawning remains direct with `shell: false`. On Windows `.cmd`/`.bat`, the existing cross-spawn escaping is applied to the additional option and root token exactly like the prompt and fixed flags; tests cover metacharacter-bearing paths and prove no command injection or token splitting. Path assertions use `path.join`/canonical filesystem helpers, never hardcoded separators.

Codex is not added to the browser supervision whitelist in this Change. A future runtime adapter can consume the same resolved launch facts without changing their semantics.

### D6. Keep Session and run-state semantics unchanged

The Supervisor creates the record with:

```text
session.space = resolved planningSpace when one is derivable
session.cwd   = resolved execution cwd
```

Run-state joins continue to read from `session.space.root`, and `GET /api/v1/sessions?space=store:<id>` continues to find the session by planning attribution. Existing Board/member activity projection continues to compare member roots with `session.cwd`; it becomes more accurate once cwd is the actual member, but it is still provenance rather than ownership.

No new Session field or durable file is introduced.

### D7. Make the Store UI explicit but not authoritative

The Task Detail launch flow loads the selected Store's current `members` from `GET /api/v1/spaces` and passes them to the dialog:

- project pages omit `execution`, preserving current behavior;
- a Store with one member preselects it but submits
  `execution: project:<server-listed-member-root>` explicitly;
- a Store with multiple members starts without a selected execution target and disables/rejects submission until the user chooses one;
- a Store with zero members offers no project default;
- planning-only is a separate explicit option, never the initial Store default;
- server errors, including stale-member validation, remain visible verbatim.

The root returned by the spaces API is used as the registered selector rather
than as an unvalidated cwd. This keeps independent live clones with the same
`projectId` unambiguous. The server re-resolves the root against the registry
and revalidates Store membership at submit time; an arbitrary client path is
still rejected. Worktree-root selectors are supported by the API/resolver;
adding a new Store worktree browser is not required for this 0.1.5 UI slice.

Member inventory transport state remains distinct from authoritative empty
inventory. The Task Detail page preserves the last successful member list when
polling fails, shows a localized retryable error, and replaces the list only
after a later successful response. An initial failure therefore never renders
the zero-member message, while planning-only remains explicitly selectable.

The dialog also distinguishes an automatic sole-member preselection from an
explicit user choice. If live inventory expands from one member to multiple
members before submission, an automatic selection is cleared so the user must
choose. A still-valid explicit project or planning-only choice survives
inventory refreshes; a project that disappears is discarded and the current
inventory's safe default rules are reapplied. The effective choice is derived
synchronously from current inventory and provenance for radio checked state,
submit-button gating, and the launch request; passive state reconciliation is
only bookkeeping and is not a safety boundary.

## Risks / Trade-offs

- **[Member data changes after the dialog opens]** → Treat the listing as presentation only and re-read registry/pointer facts in `resolveSessionLaunchContext`; surface the exact server rejection without closing the dialog.
- **[Member inventory polling fails]** → Keep the last successful choices, render a retryable localized transport error, and reserve the zero-member message for a successful authoritative response.
- **[A Store attachment broadens what Claude can write]** → Attach only the selected Store planning root, never all members; preserve the server-built whitelist and explicit primary cwd.
- **[Windows path casing or separators cause false non-membership]** → Canonicalize existing roots through shared filesystem utilities and use Node path APIs in implementation and tests.
- **[Windows shim reparses an attached root as shell grammar]** → Reuse the existing double-escape path for every argv token and add injection-focused `.cmd` coverage for `--add-dir`.
- **[Registry or pointer changes in the small interval after resolution]** → Treat launch-time resolved facts as the frozen session observation, as today; no persistent lock spans config files and process spawn.
- **[Old Store UI/client requests fail after upgrade]** → Return the actionable `execution_required` error and ship the UI/server wire change together. Project-space clients remain compatible.
- **[A runtime selector is mistaken for future ownership]** → Do not persist it or expose it as a Change/Issue field; document `session.cwd` as an observation only.

## Migration Plan

1. Add the mirrored request type and resolver behind tests without changing persistent data.
2. Route session launch through the resolver and pass resolved attachments to the Supervisor.
3. Update the Task Detail dialog and localized labels/errors in the same release.
4. Run focused resolver/API/Supervisor/UI tests on the host platform and CI on Windows plus POSIX.
5. Dogfood a Store with two real member projects: select member A, run one full pipeline, verify Store artifact access, project-local Git/dependency/test execution, no member-B modification, Store visibility, and member-A activity projection.

There is no data migration. Rollback restores the prior binary and UI; no Session or planning artifact requires conversion. If deployment must be split, disable Store-page Launch Run until both halves are present rather than reintroducing an implicit Store-root cwd.

## Open Questions

None for the 0.1.5 slice. Durable target ownership and multi-project execution belong to the next Issue / Execution Plan model and must not be answered by extending this runtime selector.
