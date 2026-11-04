# Planning context — store-bootstrap-repair-text (Phase E, child 4 of 4, FINAL)

Seeded by the LEAD before propose. Read this FIRST. This is a **carve from an
existing design** — E's artifacts already exist.

## User intent

E1 (`store-bootstrap-diagnose`, `f11daa1d`), E2 (`store-bootstrap-adopt-local`,
`9f4286da`), E3 (`store-bootstrap-obtain`, `3e4a1a19`) are all shipped and
review-clean. **This is the last Phase E child.** When it ships, Phase E is
complete.

## What E4 is

E's group 11: **ordinary commands that cannot resolve a Store name say "run
`rasen bootstrap` to fix this"** — plus `rasen doctor` readiness integration.

The core requirement (E's req 9, deferred by E1 because bootstrap couldn't
repair anything then): *"Commands that cannot resolve a Store name bootstrap as
the repair."* Its 4 scenarios were deferred because 3 of them make OTHER
commands say "run bootstrap to fix this," which in E1 was a hint that repaired
nothing. **Now that E1/E2/E3 make bootstrap actually able to register, obtain,
and prepare, that text is true.** E4 makes it real.

## THE invariant

**Read-only.** E4 changes what commands **say**, not what they **do**. No
behavior change, no new writes, no new network contact. This is a breadth sweep
(~8–12 command sites) not a depth read.

## Doctor design ownership — E4 OWNS it (LEAD ruling)

The decomposition plan's open question #4 flagged that E4 and F4
(`knowledge-bundle-prepare-integration`) both touch `rasen doctor`. **E4 owns
the doctor readiness design** and must **explicitly write the seam F4 will
use** into `design.md`. F4 inherits it and does not re-design. If you touch
`src/commands/doctor.ts` or `src/core/relationship-health.ts`, you are
designing the interface both children consume.

## Scope

IN: E's group 11 (ordinary-command repair text + doctor readiness), plus
command-surface / acceptance / docs / verification slices.

OUT: anything E1/E2/E3 already delivered. OUT: Phase F.

### Requirement structure (pre-resolved — confirm against E's spec)

- **ADD** *Commands that cannot resolve a Store name bootstrap as the repair*
  (E's req 9, deferred by E1 — now satisfiable).
- Check whether E4 deepens any E1/E2/E3 requirement (e.g. E1's "Every hint
  bootstrap prints can be pasted and will work" may need extending to cover
  the new "run bootstrap" hints from other commands). If so, MODIFY — preserve
  all prior scenarios verbatim, add only.

## ⚠ The concurrent-session file-overlap risk

Two concurrent sessions are active in this tree:
1. **UI session**: `packages/ui/**` + `rasen/config.yaml` (disjoint from E4)
2. **Pipeline-registry session**: `src/commands/pipeline{,-messages}.ts`,
   `src/core/pipeline-registry/**`, `src/core/{keepalive,runtime-adapters,codex,
   management-api,templates}/**` and their tests.

**E4's command-site modifications MAY overlap with the pipeline-registry
session's files.** If E4 needs to make `rasen pipeline` or any pipeline command
say "run bootstrap to fix this" when it can't resolve a Store, it would touch
`src/commands/pipeline.ts` — which the concurrent session is actively editing.

**Your job:** identify EVERY command site E4 touches. For each, check whether it
is in the concurrent session's modified set (`git status --porcelain`). If there
is overlap, **do not edit that file** — record the overlap in `design.md` and
defer that command site to a follow-up, OR coordinate by editing narrowly
without staging. **Never overwrite a concurrent session's hunk.**

## Ground truth (verified 2026-07-26/27)

- E1/E2/E3 all shipped, review-clean, delta specs frozen. None archived
  (branch unmerged). E4's archive follows E3's (E1→E2→E3→E4 in sequence).
- F1 in a separate worktree. Concurrent UI + pipeline-registry sessions in
  this tree.
- `store-bootstrap-and-hydration/` must NOT be modified — after E4 absorbs its
  content, it can be cleaned up with user confirmation.
- Branch: `feat/store-context-unification`, `HEAD=3e4a1a19`, pushed.

## Inherited constraints (E1/E2/E3 — all binding)

1. Construction-time `mutates` field on repairs (E2 built it; E4's "run
   bootstrap" hint is `mutates: true` — bootstrap changes state).
2. Every composed reader pushes diagnostics.
3. A repair that changes state only against an established answer.
4. **Every hint is pasteable** — the "run bootstrap" text must be a command
   that works when pasted, naming an unambiguous selector.
5. English at the call site for command descriptions; locale parity en/ja/zh-cn.

## Repo conventions, test discipline, known failures — same as E1/E2/E3

See prior planning contexts. Serial vitest only. Known pre-existing failures
unchanged. SHALL/MUST on first body line. `validate --changes` shows ~10-22
container-dir failures (read per-item).

## Append below: durable findings from each stage

### Planner findings (2026-07-27)

**The breadth is in the tests, not the source.** Every command that resolves a
declared Store funnels through one pair: `primaryRepair(binding)` and
`describeUnavailableStore(binding)` in `src/core/store/identity.ts`. The repair
arrays are built in two files (`identity.ts` + `identity-diagnostics.ts`) and
read by every consumer (`root-selection.ts`, `effective-config.ts`,
`learned-skills/{context,stores}.ts`, `store/{membership,migration-ops}.ts`,
`config-api/project-addressing.ts`). No consumer builds its own repair text.
So the source-edit surface is **5 files** (the two central, plus
`relationship-health.ts`, `doctor.ts`, `shared-gather.ts`); the remaining two
(`locales`, `docs`) are content. The "8–12 command sites" estimate describes the
**test** surface (group 4 proves each consumer path), not the source.

**Zero concurrent-session overlap (verified).** E4's seven source-edit files
are entirely disjoint from both the pipeline-registry session
(`pipeline{,-messages}.ts`, `pipeline-registry/**`, `keepalive`,
`runtime-adapters`, `codex`, `management-api`, `templates`, `cli/index.ts`) and
the UI session (`packages/ui/**`, `rasen/config.yaml`). The pipeline commands
inherit the new repair text through `notice.repair` without any edit. No
deferrals needed.

**Spec: ADD only, zero MODIFIED blocks.** E4 adds one requirement to
`store-bootstrap`. No E1/E2/E3 requirement changes. The repair-text change in
the resolver satisfies child A's existing `store-identity` contract (every
unavailable-Store failure carries a pasteable repair); it does not amend it
(E's design D1 reasoning).

**Doctor readiness = pure composition (design D4/D5).** The section composes
from facts `gatherHealth` already assembles (Store binding, membership,
machine-home entry) — no new I/O. The F4 seam is a new optional input field
(`knowledgeBundlePrepared`) plus an extension of the composer's switch; the
output shape (`{ state, findings }`) does not change.

**Task count: 33 subtasks / 10 groups.** The ~16 estimate held for the
source-edit + doctor-readiness surface (groups 2-3, 5-6 = 13 subtasks). The
total grew because consumer-path test coverage (group 4, 6 tests) and the
verification suite (group 10, 7 tasks) are broader — the natural consequence
of the narrow-source/broad-test architecture.

**Validate verdict:** `store-bootstrap-repair-text` passes clean (zero issues).
The 10 failing changes are all pre-existing container-dir failures outside the
store-bootstrap family.
