## Context

The current boundary is split across three optional experts. `freeze` and
`guard` write `${CLAUDE_PLUGIN_DATA:-$HOME/.rasen}/freeze-dir.txt`;
`unfreeze` removes it; and `investigate` reaches sideways into the freeze
skill. The only checker is
`skills/experts/freeze/bin/check-freeze.sh`. Init/update copy that file beside
`SKILL.md`, but no production path registers it. The only emitted PreToolUse
hint names the unrelated top-level `hooks/safety-check.sh`, which is not even
included by the package `files` list. Thus an installed skill can claim a hard
block while supplying neither registration nor a portable runtime contract.

The base CLI already owns agent-runtime operations under `rasen agent`, a
canonical provenance-bearing host detector, runtime adapter metadata, a
cross-platform machine-data root, and safe JSON-settings merge code for
Claude. Codex now has project hooks, but non-managed hooks require trust and
its own host documentation says specialized tool paths can bypass the default
hook path. Zed is registered for audit only. Those facts require an explicit
enforcement level rather than one universal promise.

## Goals / Non-Goals

**Goals:**

- Provide `set`, `status`, and `clear` without any optional skill installed.
- Make state, containment, hook evaluation, and install/update reconciliation
  one base-runtime module with testable JSON contracts.
- Report `hard`, `soft`, or `unsupported` from verified host capability and
  actual hook configuration.
- Remove all three expert surfaces and heal prior installations and state.
- Give workflows concise, accurate invocation and limitation guidance.

**Non-Goals:**

- A security sandbox or prevention of arbitrary shell/MCP/external-process
  writes.
- Dynamic reconfiguration of a host sandbox or approval policy.
- A replacement for `rasen-careful`; `guard` is removed, not re-created as a
  combined skill or command.
- Guessing that an unknown or unadapted host can enforce a boundary.

## Decisions

### D1 — Put the public surface under `rasen agent edit-boundary`

Add:

```text
rasen agent edit-boundary set <directory> [--runtime <id>] [--json]
rasen agent edit-boundary status [--runtime <id>] [--json]
rasen agent edit-boundary clear [--runtime <id>] [--json]
```

An internal, hidden `check` action consumes one hook JSON object on stdin and
emits the host-native deny/allow shape. Command code remains a thin consumer
of a new `src/core/edit-boundary.ts` module. Every successful public action
reports detected runtime and source, enforcement, canonical scope/boundary,
active state, and limitations. `set` on `unsupported` fails without creating
active state.

Alternative: a new standalone `rasen guard` command. Rejected because it would
preserve the retired combined concept and fragment the existing agent-runtime
surface.

### D2 — Scope state to the canonical project/execution root, not a skill

Store a versioned JSON record beneath
`getGlobalDataDir()/runtime/edit-boundaries/`, keyed by a SHA-256 digest of the
canonical execution root. The record contains the canonical root and boundary,
the setting host/enforcement, and update time. Writes use an adjacent temporary
file plus rename and restrictive file mode. `status` and `clear` resolve the
same root. This deliberately makes the boundary apply to concurrent agents
operating in the same checkout; it avoids pretending Claude exposes a session
id to an ordinary `set` shell command.

`set` accepts an existing directory inside the execution root. Containment uses
`path.relative`, never string prefix matching. Existing paths use native
realpath; a not-yet-created write target canonicalizes its nearest existing
ancestor before appending the unresolved tail. Windows drive-letter casing,
separators, UNC roots, `..`, symlinks, and the `/src` versus `/src-old` case
receive focused tests.

Alternative: retain `freeze-dir.txt` under `CLAUDE_PLUGIN_DATA`. Rejected
because it is plugin-owned, unavailable on missing-skill installs, and falls
back to one global file that cross-contaminates projects.

### D3 — Enforcement is a three-value adapter contract

Extend runtime adapter metadata with edit-boundary support:

| Host | Level | Contract |
|---|---|---|
| Claude | `hard` only when the exact Rasen PreToolUse entry is enabled and usable | Host rejects covered `Edit`/`Write` calls outside the boundary. Shell, MCP, and external writes remain outside the contract. |
| Codex | `soft` | State and a best-effort project PreToolUse hook are available, but trust requirements and documented tool-path exceptions prohibit a hard claim. The agent must cooperate. |
| Zed, unknown, unadapted hosts | `unsupported` | No active boundary is created and callers must say that edits remain unrestricted. |

The registry is the only runtime-to-level table. A configured host can
downgrade (for example invalid/disabled/missing hook registration); no
consumer can upgrade a level. JSON uses stable locale-neutral literals.

Alternative: add a boolean `canEnforceEditBoundary`. Rejected because it
cannot distinguish deterministic covered-tool denial from cooperation or
unsupported operation.

### D4 — Hooks call packaged CLI code and are reconciled by init/update

Claude project settings gain one exact Rasen-owned `PreToolUse` matcher for
`Edit|Write`, merged without disturbing existing keys/hooks. Codex gains one
exact project hook entry for `apply_patch|Edit|Write`; it is reported as soft
until trusted and remains soft afterward. Both invoke the installed
`rasen agent edit-boundary check` implementation, so no hook executable lives
under an optional skill. Reconciliation is idempotent, preserves unrelated
entries, warns instead of clobbering invalid user configuration, and is tested
on macOS/Linux/Windows command forms. Init/update run it even when none of the
retired skills is selected.

Alternative: move `check-freeze.sh` to another copied sidecar. Rejected because
sidecars are selected and materialized through the skill loop, recreating the
missing-skill defect.

### D5 — Retirement and cleanup use exact frozen identifiers

Delete the three templates, exports, registry rows, freeze sidecar directory,
locale/catalog rows, fixtures, parity entries, docs, and direct tests. Add
`RETIRED_EDIT_BOUNDARY_EXPERT_IDS` and
`RETIRED_EDIT_BOUNDARY_SKILL_DIRS` exact lists. Init/update remove only those
installed directories across configured tool skill roots, before any
up-to-date short circuit. Profile/config readers tolerate and normalize the
three retired ids so old full/custom/named selections remain usable.

Legacy state cleanup removes only `freeze-dir.txt` from the canonical old
`getGlobalDataDir()` location and, when distinct and explicitly present, the
current `CLAUDE_PLUGIN_DATA` directory. It never recursively removes a state
directory. New state is not migrated because the old hook was not registered
and its global/session scope cannot be identified safely; cleanup prevents a
stale checker from surprising the user.

### D6 — One concise guidance block keeps skill claims honest

Create a shared edit-boundary introduction used by `investigate` and legitimate
safety/fix-loop references. It teaches the three public commands, requires
reading `status`, defines all three levels, limits `hard` to the host-covered
write tools, and forbids claiming restriction on `soft` or `unsupported`.
Investigate may call `set` for its narrowed directory, but proceeds with an
explicit warning when the result is not hard. Navigator routes users to the
runtime command; `rasen-guard` is never retained.

## Risks / Trade-offs

- [Project hook configuration can be invalid, disabled, untrusted, or changed
  after setup] → Inspect exact registration on every `status`, downgrade
  conservatively, warn during reconciliation, and test invalid configurations.
- [A hard host hook does not cover shell or external writes] → Define hard only
  for named structured write tools and print the limitation in every mode.
- [Concurrent sessions in one checkout share a boundary] → Make checkout scope
  explicit in status and clear output; atomic records prevent torn state.
- [Symlinks and Windows casing can bypass naïve prefix checks] → Realpath the
  boundary and nearest existing target ancestor and use platform-aware
  `path.relative` containment tests.
- [Removing catalog ids can break persisted profiles] → Normalize only the
  exact retired ids and preserve every other unknown-id diagnostic.
- [A stale installed sidecar hook may still be manually registered] → Remove
  exact old state and document removal of manually configured
  `check-freeze.sh` entries; never delete unrelated user hooks automatically.

## Migration Plan

1. Land the base module, CLI actions, adapter classification, and tests while
   the old templates still exist.
2. Add hook reconciliation and prove init/update behavior without the freeze
   skill installed, including invalid and unsupported hosts.
3. Switch investigate/shared guidance and add exact profile/state/install
   cleanup.
4. Remove the three experts and all catalog/locale/fixture/parity/doc residue;
   regenerate golden hashes and built-in counts.
5. On upgrade, init/update remove exact old skill directories and state and
   install the base hook integration. Users with a manually authored old hook
   receive guidance to remove that exact entry.

Rollback may restore the retired templates, but must not remove the new state
module blindly. The new record is versioned and ignored by older binaries.

## Open Questions

None. Host support is deliberately conservative; a future adapter can promote
Codex or another host only after complete covered-write interception is
verified and added to the registry contract with tests.
