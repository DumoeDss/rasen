# Planning context — session cache optimization portfolio

## Original intent

> `$rasen-auto auto-decompose 阅读交接文档：C:\Users\Sayo\.rasen\handoff\2026-07-30-fork-point.md 然后开始推进缓存优化的所有任务！`
>
> `在OpenSpec-code-ecp-review-cycle的worktree，从0.2.0新建开发分支吧！`

Work in `OpenSpec-code-ecp-review-cycle` on
`feat/session-cache-optimization`. The branch starts from the latest 0.2.0 ECP
baseline, includes the #113 CLI localization/structure migration, and carries
the #112 cache/session design and probe evidence.

## Authoritative inputs

- `C:\Users\Sayo\.rasen\handoff\2026-07-30-fork-point.md`, especially sections
  1–4 and 6.
- `docs/session-execution-layer-design.md`, especially sections 4–7 and P1 in
  section 9.
- `docs/experiments/session-cache-probe-results.md`.
- `rasen/handoff/hybrid-session-workers-design.md`.

## Facts already established

- The reusable cache asset is a live
  `claude -p --input-format stream-json` host process, not a session id.
- A live same-cwd host remained a cache HIT after 55 minutes and was a MISS
  after 65 minutes. Touch is therefore only for expected idle windows beyond
  roughly 55 minutes.
- Concurrent resume/wake can charge both calls while silently dropping one
  turn. Every session must have a CLI-side single-flight lock.
- Fork does not inherit the hot cache.
- Durable collection must not rely on a background completion notification.
- Registry writes need bounded retry-on-lock plus atomic replacement.
- Correctness must survive daemon absence; the daemon improves cache
  efficiency only.
- P1 extends `src/core/management-api/supervisor.ts`; it must not introduce a
  parallel `src/core/session-host/` subsystem.
- P1 must not modify `src/core/change-run/**` or
  `src/core/pipeline-registry/**`.
- CLI commands follow the #113 structure/localization split: empty structural
  descriptions in code, complete entries in all three locale catalogs, and
  `completionValues` rather than `acceptedValues` where completion candidates
  are needed.
- Do not modify the ECP Direction's `work.yaml`, `roadmap.md`, `README.md`, or
  `target-state.md`; those files are owned by the parallel ECP line.
- Do not modify or delete the pre-existing untracked
  `packages/ui/package-lock.json`.

## Decomposition rationale

The P1 scope has five reviewable deliverables with a strict dependency spine:
live host lifecycle → durable registry/recovery → CLI and touch fan-out →
acceptance evidence. CLI and touch may run in parallel after the registry is
review-clean because their owned product files do not overlap. The final
acceptance slice merges both branches of the DAG and proves the end-to-end
contract.

## Cross-child planning rules

- Read the dependent child's proposal/design before carrying forward a
  prerequisite's conventions.
- Keep child scope to its declared ownership. Any newly discovered overlap
  makes the affected children serial.
- Every child includes focused tests and Windows behavior where paths,
  processes, locks, or command spawning are involved.
- Root build/vitest commands are never run concurrently inside one worktree.
- Completion requires non-author review and durable evidence, not merely
  checked task boxes or artifact presence.
- Auto-decomposed children use local delivery and must not independently push a
  partial portfolio tree merely to obtain CI. A platform-sensitive child
  closes its local gate with native-host focused coverage plus deterministic
  injected coverage for the other platform, explicitly recording the
  limitation.
- Injected POSIX semantics are not real POSIX CI and do not waive the
  cross-platform product requirement. The exact-tree Windows/POSIX GitHub
  matrix is a mandatory `session-cache-optimization-acceptance-evidence` gate:
  after all children are integrated, the parent may publish one explicitly
  authorized exact-tree Draft PR for review while E1 is deferred. That action
  is not E2, the PR remains draft/unmerged, and early CI is advisory only.
  Physical E1 binds that exact PR head; only afterward may the parent authorize
  E2 for the same head, mark the PR ready, and record the final SHA, run URLs,
  `linux-bash`, `linux-bash-node24`, and all Windows PowerShell shard results.
  Any later tree/head change requires a new freeze and E1.

## Host-lifecycle decisions carried forward

- Reusable-host overall/no-output bounds apply to an accepted turn only; they
  are cleared while the host is idle, or the supervisor would destroy the
  live-process cache asset it is meant to preserve.
- If a host dies after stdin accepted a wake but before its result event,
  delivery is uncertain and the message must not be auto-replayed. The
  registry/recovery child must reconcile that boundary against durable
  transcript/ledger facts before deciding any follow-up.
- A short-lived public CLI process cannot own the live host's stdin pipe.
  Future CLI and scheduler paths must reach (or establish and recover through)
  the same resident supervisor owner and its admission seam; their designs
  must not introduce independent process owners that bypass single-flight.
