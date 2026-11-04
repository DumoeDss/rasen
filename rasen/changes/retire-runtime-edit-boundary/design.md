## Context

The active `runtime-edit-boundary` change replaced the earlier
`freeze`/`guard`/`unfreeze` experts with a base runtime command and
project-local Claude/Codex hooks. Its implementation is complete enough to
have shipped across the 0.1.6 and 0.2.0 lines, but the capability remains an
active, not-yet-synced change in this repository.

The replacement improved honesty by reporting `hard`, `soft`, or
`unsupported`, yet it did not create a security sandbox. Codex remains soft
and asks users to review the project hook definition. Even Claude's covered
write denial excludes shell, MCP, external-process, and specialized write
paths. The product value is therefore scope discipline, while the cost spans
CLI surface, host-specific hooks, runtime metadata, machine-local state,
templates, locales, docs, migrations, and tests.

Two artifact generations must be handled without assigning them exclusively
to different release lines:

- The predecessor skill/state generation may retain the three retired expert
  ids/directories and `freeze-dir.txt`. Its cleanup remains additive for any
  installation where those artifacts survive.
- The runtime hook/state generation landed independently on `dev/0.1.6` in
  `8e0be936c97d58fe7a24508ffaba8e55c839da35` and on the 0.2.0 line in
  `897fa6c1b8adf0582cd0044781b3ad51a84819e6`. The frozen hook source was
  byte-identical, so installations from either released line may retain the
  same Rasen-owned Claude/Codex hook handlers and version-1 JSON records under
  the fixed `runtime/edit-boundaries` machine-data directory.

The 0.2.0 daemon and ECP also contain independently valuable
`workspace.access`, sandbox, workspace-reservation, and isolated-worktree
controls. They govern managed execution and are not consumers of the public
edit-boundary command.

## Goals / Non-Goals

**Goals:**

- Remove the complete live `rasen agent edit-boundary` product surface and
  stop creating project hooks.
- Heal both upgrade generations using bounded, exact-identity cleanup that is
  safe on Windows, macOS, and Linux.
- Preserve unrelated hook groups, handlers, JSON keys, user files, and
  unknown/future state records.
- Replace mechanical-boundary language with declared scope and post-change
  changed-file verification.
- Keep generic daemon/ECP execution controls unchanged.
- Make this change the explicit successor to the active
  `runtime-edit-boundary` change so it cannot later be resumed as a request to
  restore the feature.

**Non-Goals:**

- Reimplementing freeze/unfreeze through the daemon, a managed launcher,
  approval callbacks, Git worktrees, or another hook system.
- Claiming that prompt guidance or diff review is a security boundary.
- Removing the already-retired `freeze`, `guard`, and `unfreeze` migration
  compatibility in the same release.
- Changing the semantics of ECP workspace access, sandbox selection,
  reservations, delivery worktrees, or runtime dispatch.
- Automatically deleting arbitrary hook commands that merely contain words
  such as `rasen`, `freeze`, or `edit-boundary`.

## Decisions

### D1 — Retire the capability instead of moving its enforcement

Delete the live state/evaluation module, public and hidden agent actions,
Commander subtree, completion subtree, runtime-adapter classification,
exports, locale strings, live docs, and feature-focused tests. Init and update
will no longer reconcile an edit-boundary hook.

The user-facing replacement is a workflow discipline:

1. declare the intended affected area before editing;
2. keep the implementation within that area unless evidence forces an
   explicit scope revision;
3. inspect the final changed-file set and diff;
4. report or revert unrelated changes through the normal review/fix process.

Alternative: preserve `set/status/clear` as a soft reminder without hooks.
Rejected because it retains state and ceremony while providing no stronger
outcome than explicit scope text plus diff evidence.

Alternative: move the command behind the 0.2.0 daemon. Rejected because the
daemon's generic execution policy is valuable independently, while exposing a
mid-session freeze abstraction would carry the same narrow product concept
into a broader control plane.

### D2 — Separate live removal from a bounded compatibility shim

The feature modules are removed from the public/runtime graph. A narrowly
named retirement cleanup helper remains reachable only from init/update and
contains frozen identifiers for artifacts that released versions generated.
It is not exported as a general edit-boundary API and cannot set, inspect, or
enforce a boundary.

The existing `RETIRED_EDIT_BOUNDARY_EXPERT_IDS` and
`RETIRED_EDIT_BOUNDARY_SKILL_DIRS` lists remain for predecessor-generation
saved-selection normalization and installed-directory cleanup. The
compatibility helper adds the shared frozen hook shapes and version-1 state
location/schema emitted independently on both the 0.1.6 and 0.2.0 lines. A
follow-up release may remove this shim only after the supported upgrade window
is explicitly closed.

Alternative: delete every trace immediately. Rejected because an installed
hook would continue invoking a removed hidden command and Codex would continue
asking the user to trust it.

### D3 — Remove hooks by exact generated shape

For `.claude/settings.json` and `.codex/hooks.json`, cleanup reuses the existing
validated JSON-tree handling but performs subtraction rather than
reconciliation:

- Resolve paths with `path.join`.
- Maintain an explicit list of complete historical handler objects for each
  runtime, including the Windows command field where it was generated.
- Remove a handler only when its complete normalized object equals one frozen
  generated shape; matching only a command, status message, matcher, prefix,
  glob, or regular expression is insufficient.
- When an owned handler shares a group with unrelated handlers, remove only
  the exact handler and preserve group order, matcher, metadata, and siblings.
- Remove a now-empty group only when its remaining structure is the exact
  Rasen-generated group shell; otherwise preserve it.
- Preserve all root keys and unrelated hook phases. Do not delete the config
  file or parent directory.
- Invalid JSON or an unexpected nested shape is left byte-for-byte unchanged
  and produces an actionable warning.

Cleanup runs during init/update before an up-to-date short circuit. This makes
one normal upgrade sufficient to remove the Codex startup trust prompt while
avoiding unrelated configuration changes.

Alternative: keep the current `handlerIsOwned` OR-match on command or status
message. Rejected because retirement is destructive and must use a stricter
identity test than live reconciliation.

### D4 — Clean recognized state without recursively deleting the feature directory

Cleanup retains the exact `freeze-dir.txt` behavior for the predecessor
skill/state generation. For version-1 runtime state it scans only the fixed
`getGlobalDataDir()/runtime/edit-boundaries` directory and considers only
direct children:

- A canonical record is removable only when the filename is a 64-character
  SHA-256 hex name plus `.json`, the JSON has the complete recognized v1
  record shape, and hashing the record's normalized `root` with the shipped
  platform rule reproduces the filename.
- Recognized stale atomic-write temporary files may be removed only by their
  frozen filename grammar and only within this exact directory.
- Unreadable files, malformed records, future versions, unexpected names,
  nested directories, and sibling files remain untouched and are reported as
  preserved.
- The exact directory may be removed with a non-recursive empty-directory
  operation after cleanup; parent directories are never removed.

This is intentionally more conservative than recursively deleting a
feature-owned directory: the compatibility code must not assume ownership of
unknown future or user-created contents.

### D5 — Scope guidance uses observable diff evidence

Remove `EDIT_BOUNDARY_GUIDANCE` and all set/status/clear instructions from the
shared preamble, investigate, and navigator.

Investigate records an initial affected-area allowlist after the reproduction
is minimized. If root-cause evidence expands the necessary area, it records
the reason before editing the new area. Before completion it compares the
actual changed-file set with the latest declared scope and classifies any
unexpected file as either justified scope expansion or an unresolved
out-of-scope change.

The shared expert contract continues to prohibit false `[AUTO-FIXED]` claims,
but grounds this in the observable result of the write and current diff rather
than a boundary status. Navigator routes destructive-command caution to
`rasen-careful`, root-cause isolation to `rasen-investigate`, and final scope
checking to review/verification workflows.

Alternative: keep generic wording that agents should “stay in scope.”
Rejected because a concrete changed-file audit is testable and gives later
review/ship stages reusable evidence.

### D6 — Daemon/ECP controls remain generic and independently specified

No file under change-run contracts, action lowering/reconciliation,
workspace reservations, pipeline sandbox resolution, daemon supervision, or
isolated delivery worktrees is changed merely because its behavior can limit
writes. Tests guard that these contracts remain present after the retirement.
Future managed containment must be designed as an execution-policy capability,
not as a compatibility alias for freeze/unfreeze.

### D7 — Supersede, do not silently rewrite, the prior active change

`runtime-edit-boundary` remains historical evidence of why the current code
exists, but this change is the authoritative product direction. Implementation
marks the prior active change as superseded using repository-supported
change metadata or a clear committed notice, records its unchecked
verification tasks as not applicable because of supersession rather than
falsely completed, and does not sync its delta specs into the main
specification set. The retirement capability is archived normally after the
code is removed.

The implementation lands on `dev/0.2.0`. The same deletion and frozen cleanup
shapes are suitable for a targeted 0.1.6 maintenance backport; branch
publication is a delivery decision, not a second implementation architecture.

### D8 — Sequence cross-platform verification across apply and delivery

Apply requires the same focused path/config migration suite to pass against
the exact retirement source state under actual Windows and POSIX Node
runtimes. The suite constructs expected paths with platform APIs and covers
unrelated user hooks and unknown state. Apply also verifies that the
committed-ref CI workflow is configured to run the relevant tests on Windows
and at least one POSIX host.

Hosted CI results are delivery evidence collected after ship creates a commit
or other ref; they are not an apply prerequisite that would require shipping
before apply can finish. A native Linux run under WSL is valid POSIX runtime
evidence but is not described as CI.

The Windows-plus-POSIX hosted CI run is therefore a **PENDING, ship-owned
delivery check** until ship creates the exact commit/ref. Ship must record one
passing Windows shard and one passing POSIX shard for that ref, or report the
delivery check as still pending/failed; no artifact claims those hosted jobs
have already run.

Alternative: require hosted Windows and POSIX CI results before apply
completion. Rejected because CI can only test a committed ref produced by the
later ship stage, creating an apply-to-ship-to-CI-to-apply cycle.

## Risks / Trade-offs

- [A hook was hand-edited after Rasen generated it] → Remove only a complete
  frozen handler match; preserve ambiguous entries and warn with the exact
  config path so the user can review them manually.
- [A removed command is still invoked before init/update runs] → Keep cleanup
  before lifecycle short circuits and document that one upgrade run removes
  the owned entry; the command itself is not kept as a long-lived alias.
- [Unknown files accumulate in the retired state directory] → Preserve them
  and report the skipped names; never trade migration neatness for unsafe
  recursive deletion.
- [Prompt-based scope discipline is weaker than covered-tool denial] → State
  that it is not enforcement, require a final diff audit, and rely on generic
  managed sandbox/workspace controls where actual containment is required.
- [The prior active change could later be applied or archived] → Mark it
  superseded and ensure its unsynced capability is not promoted into main
  specs.
- [Backport code drifts between 0.1.6 and 0.2.0] → Freeze generated artifact
  identities in tests and keep daemon/ECP files outside the backportable
  removal patch.

## Migration Plan

1. Add exact subtractive hook cleanup and recognized v1 state cleanup with
   preservation tests on Windows-shaped and POSIX paths.
2. Invoke retirement cleanup from init/update before all relevant short
   circuits, then remove live hook reconciliation.
3. Remove the CLI, state/evaluation module, runtime-adapter metadata,
   completions, exports, locales, and feature tests.
4. Rewrite expert templates and current docs; regenerate only affected parity
   hashes and generated fixtures.
5. Mark `runtime-edit-boundary` superseded without syncing its delta specs.
6. Run focused migration, init/update, command, template, locale, and runtime
   registry tests, followed by lint, full tests, build, and package checks.
7. Smoke-test an upgrade containing unrelated Claude/Codex hooks and both
   generations of recognized state; confirm the Rasen hook disappears and no
   unrelated entry changes.
8. Use the resulting commit as the basis for any approved 0.1.6 maintenance
   backport.

Rollback may restore the public runtime implementation, but must not recreate
hooks automatically without revisiting the trust-prompt decision. The
subtractive cleanup is safe to retain during rollback because it only removes
frozen retired entries.

## Open Questions

None. The compatibility window length is intentionally deferred to release
policy; until it is explicitly closed, the frozen cleanup remains.
