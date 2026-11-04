# Fixer 1 design-level handoff

## Reason

`RC-001` crosses the brief's mandatory design boundary. The selected POSIX
process-group model is voluntarily escapable through `setsid()`/`setpgid()` on
both Linux and macOS, so no bounded patch to the existing group inspection,
reaping, or signalling code can satisfy the authored platform-neutral
whole-scope contract. The remaining work requires a privileged/delegated broker,
an OS-specific containment service, a VM boundary, or an explicit supported-
platform product decision.

No product code or test was edited. The complete evidence and architecture
options are in `../evidence/fix-round-1.md`.

## Completed in this leaf

- Fully read the TDD/apply instructions, complete Change artifacts/evidence,
  both review reports, and implementer handoff.
- Reconfirmed the approved public seams and current 56/63 task state.
- Traced the concrete Rust process-group, replacement, one-shot parser,
  resolver, transport close, host release, and cwd activation paths.
- Confirmed from Linux and Apple primary API documentation that `setsid()`
  creates a new session/group on both targets.
- Confirmed that Linux cgroup v2 provides recursive live/empty and kill
  authority plus migration containment only under an owned/delegated subtree.
- Confirmed that macOS Endpoint Security requires an entitled privileged
  daemon/system extension; event observation alone still needs a proved
  termination barrier. Recorded VM containment as the public strong fallback.
- Wrote the finding-by-finding unresolved delta and exact successor proof gates.
- Preserved tasks 9.3-9.10, `.rasen/**`, cumulative ECP work, unknown temp roots,
  v1 `auto-decompose`, and the safety stash.

## Remaining work

1. LEAD/Direction must select and authorize a new containment architecture and
   update the Change design/spec/tasks before further implementation.
2. The successor must begin with RED real-process oracles where a backend or
   descendant actually calls `setsid()` on Linux and macOS. It must prove no
   `SCOPE_EMPTY` while that process lives, exact termination, and unrelated
   process survival.
3. Implement the selected Linux authority. The concrete recommended spike is a
   broker-owned cgroup-v2 leaf with publish-before-activate opaque identity,
   recursive `cgroup.events` empty observation, migration containment, and
   `cgroup.kill` force closure.
4. Spike and select the macOS authority: entitled/root Endpoint Security broker
   with a proved fork/termination barrier, or VM-backed capsule. Do not infer
   containment from notifications or process enumeration.
5. Only after the authority shape is stable, repair SEC-001/002/003 and
   RC-002/003/004/005 at their public seams. RC-002/003 may disappear when the
   obsolete PGID implementation is replaced; SEC-001/002/003 and RC-004/005
   remain independently required.
6. Rebuild the ECP-8 platform obligations so Linux/macOS execute actual
   `setsid()` escape cases, broker restart/recovery, exact empty, force close,
   foreign identity, and unrelated-process survival.
7. Run focused/static/native/cross-target/package gates, then obtain fresh
   non-author security and code/spec review. Do not local-ship/archive while any
   Blocker/Major remains.

## Eliminated hypotheses

- Exact controller/supervisor birth plus one reserved PGID is sufficient.
- Reaping the supervisor makes the process group a whole descendant scope.
- A `setsid()` descendant can be found and controlled exactly by later
  PPID/SID/PGID polling.
- Existing platform-gated resistant-child tests exercise a real detached POSIX
  escape.
- Cross-target build success can substitute for kernel containment evidence.
- macOS Endpoint Security notifications are available to the current plain
  adjacent helper or are themselves a kill/empty authority.
- Linux cgroup v2 can be assumed available and writable without an explicit
  installation/delegation contract.
- Marking Linux/macOS unsupported is an implementation-local resolution for the
  locked 0.2.0 target.

## Exact state at handoff

- Branch: `wip/ecp-shared-bounded-loop-lifecycle-resume`
- Change progress: 56/63 (unchanged; orchestration tasks untouched)
- Findings resolved: 0/8
- Findings remaining: SEC-001, SEC-002, SEC-003, RC-001, RC-002, RC-003,
  RC-004, RC-005
- Commands running: none
- Product/test files changed by this leaf: none
- Evidence/handoff files changed by this leaf: the two paths named above
- Test-owned processes/temp roots created: none
- Commit/push/ship/archive/PR/stash operations: none

## Durable findings

1. A process group is a signalling convenience, not a non-escapable process
   capability; `setsid()` is the decisive counterexample on both POSIX targets.
2. Linux's correct primitive is cgroup-v2 subtree authority, but its security
   comes from ownership/delegation of the migration boundary, which must be a
   product install/runtime contract.
3. macOS has no drop-in public Job/cgroup analogue for this plain helper;
   exact containment moves ECP from a packaged binary into a signed privileged
   service or a VM runtime.
4. Fixing zombie reaping or controller/group absence inside the old model before
   choosing containment risks polishing code that the correct design removes.
5. The ECP-8 oracle must deliberately call `setsid()`; an in-group resistant
   child cannot validate whole-scope containment.
