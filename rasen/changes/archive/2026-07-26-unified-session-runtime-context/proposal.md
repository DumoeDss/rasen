## Why

A Store session already asks the user the right question — plan in this Store, implement in that project checkout — and then throws the answer away. The launch resolver works out exactly which checkout was chosen, and the session then records only a working directory. The choice never reaches the session record, the agent's child process, the frozen run state, or the knowledge resolver. Every one of those re-derives "which project am I in?" from the working directory and the nearest config pointer.

That happens to work while there is one clone of each project and its pointer names the Store you are planning in. It stops working the moment either is untrue. Two clones of the same project, and a resumed run can silently continue in the wrong one. A project whose pointer names Store A while you are planning in Store B, and the child process quietly re-derives Store A. A worktree, and the exact root is lost on the first re-resolution.

The same gap makes permissions unexpressible. A session's file capability is a single list of editable roots, which cannot say "planning artifacts go in the Store, code changes go in this one checkout, and a planning-only session changes no code at all". Today a Store session either gets too little to do its job or too much to be safe.

This change makes the session carry its full answer — where planning lives, which project is being worked on, and which checkout on this machine that is — and makes every consumer read that answer instead of guessing.

## What Changes

- **A session records what it resolved.** The planning space, the project being worked on, and the exact checkout on this machine are all recorded together, not just a working directory. Everything is machine-local; none of it enters Git.
- **A session's child process is told, not left to guess.** The supervisor writes a session-local context file and passes the agent that file's location. Commands run inside the session read it instead of re-deriving from the working directory. The location is passed, never the contents — session details do not belong in an environment variable that ends up in logs and process listings.
- **Resolution has one stated order.** An explicit selector on the command wins; then the session's own context; then, only as a last resort, the working directory and its pointer. For work resumed from a frozen run, the frozen identity is the authority, the session context and current checkout are only the local address for it, and an explicit selector merely cross-checks.
- **Disagreement stops the run instead of picking a clone. BREAKING** When a resumed run's recorded project does not match the checkout the session is executing in, the command fails and says so. It never falls back to another clone of the same project. With no session context at all, the current directory is used only if its identity matches; failing that, a single registered checkout is used; several candidates is reported as ambiguous.
- **File capability says what may be written, and where.** A session's capability separates the planning roots it may write, the code checkouts it may write, and the roots it may only read, alongside the constraints an agent must respect. A planning-only session has no code checkout it may write — the list is empty, not merely discouraged. Planning writes are narrowed to the planning directories rather than granting a whole repository root.
- **The old single-list capability keeps working, and cannot silently widen. BREAKING** Consumers still reading the old shape keep a compatible view, computed so it can only ever be narrower or equal — never broader. Where that cannot hold, the reported version changes so a consumer notices rather than inheriting permissions it never asked for.
- **A planning-only Store session says what it cannot do.** It runs at the Store root, changes no project code, and states that restriction where the user launches it and where the agent reads its instructions.
- **Choosing a project to work on in a Store session is validated.** The Store must be healthy and identifiable, the checkout must exist and actually be that project, and the Store's own membership record must permit it. A project whose default planning Store is a different Store is still a valid choice, because the session pins planning explicitly.

Out of scope for this change (later work in this series): which knowledge a session's project may draw on and how it is materialized, the bootstrap flow for a fresh machine, and portable knowledge bundles.

## Capabilities

### New Capabilities
- `session-runtime-context`: what a session records about where it plans and where it executes, the session-local context handed to its child process, the order in which any command resolves that context, what happens when a resumed run disagrees with its checkout, the file capability a session grants, and the planning-only restriction as the user and the agent see it.

### Modified Capabilities
- `cli-artifact-workflow`: the action context reported to agents describes planning writes, code writes, and read-only roots separately instead of a single editable-roots list, and states its version so a consumer can tell which contract it is reading.

## Impact

- **Machine-local state**: a new per-session context file under the machine data directory. It may contain absolute paths because it never enters Git, is never shared, and is removed with its session.
- **Agent environment**: one new environment variable carrying the context file's location.
- **Code**: `src/core/management-api/session-launch-context.ts`, `sessions.ts`, `supervisor.ts`, `session-registry.ts`, `wire-types.ts`, `spaces.ts`; `src/core/learned-skills/context.ts`; `src/core/pipeline-registry/run-state.ts`; `src/core/change-status-policy.ts`; `src/core/artifact-graph/instruction-loader.ts`; and the UI mirror in `packages/ui/src/api/types.ts` and `packages/ui/src/components/LaunchSessionDialog.tsx`.
- **Docs and locales**: `docs/cli.md`, the agent contract, session troubleshooting, JSON examples, and the `en` / `zh-cn` / `ja` CLI locale bundles.
- **Compatibility**: no existing recorded state becomes unreadable. The two intentional breaks are the fail-closed rule on a frozen/checkout mismatch and the versioned action context; both are documented with what to do instead.
- **Depends on** the Store identity work (Stores resolve through the single identity resolver, and planning identity is carried by permanent identity) and on the Store membership work (a Store session's project choice is validated against the Store's membership record).
