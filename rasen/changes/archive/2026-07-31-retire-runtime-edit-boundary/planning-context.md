# Planning Context

## User intent

> freeze/unfreeze 是否真的有必要存在呢？直接移除这个功能行不行呢？
>
> $rasen-auto small-feature 开始做吧！

Retire the public `freeze` / `unfreeze` / runtime `edit-boundary` feature instead
of replacing its hooks with another enforcement mechanism.

## Established findings

- The current Codex integration is only a soft boundary and its project hook
  creates a startup trust-review burden.
- The feature is not a security boundary and can be bypassed by shell, MCP,
  external, and specialized write paths.
- Production consumers are narrow: the `investigate` and `navigator` expert
  templates, shared guidance, CLI/runtime implementation, hook reconciliation,
  docs, migrations, and tests.
- Core change workflows, review/verification, reservations, gates, ECP
  contracts, and daemon orchestration do not require the public edit-boundary
  feature.
- Rasen currently reconciles owned Codex and Claude hook entries during init and
  update, so removal must stop reconciliation and safely clean exact
  Rasen-owned entries without touching unrelated user hooks.
- Existing installations may retain `freeze-dir.txt`, checkout-scoped runtime
  state, retired skill directories, or owned hook entries. Upgrade cleanup
  should remain narrowly tracked for a compatibility window.
- The 0.2 daemon's generic `workspace.access`, sandbox, and isolated-worktree
  controls remain useful independently and must not be removed or renamed as
  freeze/unfreeze.

## Scope and design direction

- One coherent change is sufficient; no portfolio decomposition is needed.
- Remove the public command/runtime/template/documentation surface and stop
  installing or reconciling edit-boundary hooks.
- Preserve a bounded, exact-match legacy cleanup path so upgrading users do not
  retain hooks that invoke a removed command.
- Rewrite investigation guidance around explicit scope discipline and
  post-change diff verification, without claiming mechanical write denial.
- Preserve unrelated hooks and unrelated local configuration.
- Cover Windows, macOS, and Linux path/config behavior using existing constants
  and exact list lookup rather than broad pattern deletion.
- Inspect the active `runtime-edit-boundary` change and current implementation
  as historical context, but author a separate retirement change rather than
  silently rewriting that change's intent.

## Pipeline

- Explicit pipeline: `small-feature`
- Gate policy: `off` from global config; effective gates auto-approve.
- Host/runtime: Codex native workers (Tier A).

## Durable planning findings

- The implementation branch is `dev/0.2.0`; a 0.1.6 maintenance backport is a
  delivery follow-up, while the migration code on this branch must recognize
  artifacts produced by both release lines.
- The runtime hook/state feature landed independently on `dev/0.1.6` at
  `8e0be936c97d58fe7a24508ffaba8e55c839da35` and on the 0.2.0 line at
  `897fa6c1b8adf0582cd0044781b3ad51a84819e6`; the frozen hook source was
  byte-identical. Both released lines may therefore carry the same
  Claude/Codex hooks and version-1 state. Predecessor
  `freeze`/`guard`/`unfreeze` and `freeze-dir.txt` cleanup remains an additive
  artifact-generation concern, not a 0.1.6-only release classification.
- Version-1 runtime state uses direct
  `runtime/edit-boundaries/<sha256-root>.json` children plus a frozen adjacent
  temporary-file grammar. Retirement cleanup can validate the record digest
  and delete recognized entries without recursively owning the whole
  directory.
- Existing hook reconciliation identifies owned handlers by a broad OR-match
  on status or command. Destructive retirement cleanup must instead compare a
  complete frozen generated handler object and preserve user-modified near
  matches.
- The earlier `runtime-edit-boundary` delta specs are still active and
  unsynced. This retirement change is the authoritative direction; the earlier
  change needs an explicit supersession notice and must not later promote its
  capability into the main specs.
- Cross-platform migration verification is staged: apply proves the focused
  suite under actual Windows and POSIX Node runtimes plus committed-ref CI
  configuration for both. Hosted Windows-plus-POSIX CI results have not run
  and remain a **PENDING, ship-owned delivery check** after the exact commit/ref
  exists. Native Linux under WSL is runtime evidence, not CI.
