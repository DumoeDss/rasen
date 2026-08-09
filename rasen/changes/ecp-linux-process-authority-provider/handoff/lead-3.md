# Handoff: ECP-7 — LEAD #3 (Step 1 Direction replan)

Date: 2026-08-07

## Read this first

**`lead-2.md` remains authoritative for everything it covers.** This document supersedes only the
five items listed under "What this supersedes in lead-2". Do not re-derive lead-2's operational
knowledge — its WSL toolchain workarounds, digest/freeze mechanics, Windows line-ending re-freeze
order, eliminated hypotheses, LEAD-error record, and the "production code exercised only through a
stand-in" pattern are all still correct and still load-bearing. Read lead-2 in full before acting.

This session was a **Direction/LEAD session, not an implementation session**. No product code was
written; no task was ticked; no finding was closed. Two commits were made:

```text
f00f418f  chore(session)   preserve process-authority work   147 files, +60,017
64c6deea  docs(direction)  Step 1 + threat-model correction   10 files, +2,465 -52
```

## Original intent

The operator asked why the design felt too heavy to converge, and whether it could be simplified to
match how a comparable product manages process lifetime. That question turned into a scope decision
(Step 1), which this session landed in Direction and in portfolio run-state.

## Position

`ecp-linux-process-authority-provider` — unchanged at **75/93**, implementation-frozen, NON-TERMINAL.
`ecp-windows-process-authority-provider` — unchanged at **47/104**, apply wave.
`ecp-macos-process-authority-provider` — **reopened `pending` with narrowed scope** (see below).
`ecp-native-process-capsule-closure` / `ecp-durable-agent-session-host` — unchanged, `escalated`.
`ecp-frozen-action-session-executor`, `ecp-session-policy-and-control-parity`,
`ecp-session-self-hosting-vertical-proof` — **change directories are empty; not started.**

Portfolio replans: **4** (was 3). Run-state `updatedAt` 2026-08-07T12:58:56+08:00.

## What this session did

### 1. Located the real source of complexity

Investigation concluded the weight is **not in containment** — the kernel primitives are small
(`unshare(CLONE_NEWUSER|CLONE_NEWPID)` + guardian; unnamed Job + `KILL_ON_JOB_CLOSE`) — but in
**criterion 4, replacement-safe identity**, which exists solely so a scope can outlive its own daemon.
Opaque reference envelopes, boot-id/birth-time/PID-ns-inode binding, pidfd reopen-and-revalidate, the
`prepared -> published -> activate` three-phase protocol and registry v2 are all downstream of that
one requirement.

Comparison product `E:\...\Reference\multica` (Go; CLI + local daemon executing AI tasks) spends
**zero** on criterion 4: on daemon death the server fails and re-dispatches the task
(`server/internal/daemon/client.go:438`), and orphan directories are GC'd after 72h. Its POSIX
containment is ~60 lines (`server/pkg/agent/proc_other.go`); its Windows containment is effectively
absent (`configureProcessGroup` is a no-op, `waitProcessGroupGone` returns `false` unconditionally),
and it honestly disables a feature rather than pretend
(`codexInitializeRetrySupported` returns false "until Codex children are owned by a Job Object and
descendant termination can be positively confirmed").

### 2. Found that existing acceptance never required reattach

Slice `spec.md` acceptance 4 and the ECP-7 exit evidence both say *"recovery only continues the
uncommitted frontier"* and *"fail-closed evidence"*. **Neither ever required re-acquiring authority.**
That makes Step 1 an implementation change rather than a scope reduction, and it is why locked
decision 9's exit clause was not needed.

### 3. Landed Step 1 in Direction

`target-state.md` gained **locked decision 11**; `roadmap.md`, Slice `spec.md`, Slice `plan.md`
(Architecture Replan 5), Slice `result.md` and `work.yaml` were synced. North Star verified
byte-identical before and after.

**Step 1 semantics:** daemon death => scope death => in-flight action typed `execution-lost` => Run
resumes only from the last committed frontier. No reattach, no identity revalidation. Linux/Windows
must be zero-orphan by kernel guarantee: an inherited pipe held by the guardian tears down the PID
namespace on EOF (**use the pipe, not `PR_SET_PDEATHSIG`** — the latter fires on *thread* death and is
cleared across setuid/exec), and last-handle close fires `KILL_ON_JOB_CLOSE`.

### 4. Updated portfolio run-state

Replan entry 4 added (append-only; the prior three are intact). `scopeBoundary`,
`decompositionAudit.dag`, `executionPolicy.movedOutOfScope` and four child notes updated. Verified
through the product CLI: JSON valid, 0 dangling deps, closure `dependsOn` still `[linux, windows]`.

### 5. Preservation commit `f00f418f`

**Discovery: none of the process-authority work was in git.** `git ls-files native/` returned **0**;
`git log -- native/` was empty. Roughly 60k lines existed only as untracked files in this one
worktree, so "retained as upgrade path" was policy text with nothing behind it.

Committed 147 files / 60,017 insertions with a narrow pathspec (`git commit -- <paths>`), covering
`native/` (3 crates), `src/core/session-host/`, focused tests, session-host fixtures, the Linux build
script, `rust-toolchain.toml` and the CI workflow. Build artifacts (230 MB of `target/`) correctly
excluded. `git diff --cached --check` caught one trailing blank line in
`native/linux-process-authority/.gitignore`, fixed before commit.

### 6. Threat-model correction — locked decision 12

The operator's F-L2-17 reframe generalised: *"a lot of this design is security for its own sake,
detached from actual work."* A sweep found four instances. The governing statement is now
**locked decision 12: the threat model is "we get it wrong ourselves", not "someone attacks us."**
The agent already runs as the user, on the user's machine, with the user's credentials, in the user's
repository. **Process authority is a janitor, not a sandbox.**

Dividing line: **defences against our own mistakes stay** (they fire constantly); **defences against
a local attacker go** (that attacker, if real, could already edit the local Run Record directly and
bypass all of it).

| # | Design | Was defending against | Disposition |
| --- | --- | --- | --- |
| ① | Production producer Ed25519 signing + private-key custody | forged completion claims | **retired** -> transactional integrity (complete-set publish, re-read before Record mutation, claim bound to Action/invocation/workspace revision/actor). The real kernel was "never treat a half-written evidence set as complete" — a transaction problem, not a cryptography problem. |
| ② | `producerIsolation` capability field | "the LEAD forges its relay" | **retired**. The LEAD is us; the real risk is a bug. Direction added this field earlier the same day and removed it the same day. |
| ③ | Byte-reproducible helper builds as a **provenance** claim | supply-chain poisoning | **no longer acceptance**. We ship via npm; the real supply-chain surface is the tarball. **Manifest-to-adjacent-binary hash/length integrity stays** — it catches install corruption, a real failure. `F-L2-15` is fixed and is not rolled back; the Windows `/Brepro` sibling is "enough is enough", do not add more. |
| ④ | Path-resolution TOCTOU hardening (`SEC-002`, `SEC-003`) | a local attacker racing us | **no longer acceptance**. On a single-user dev machine that attacker already owns every file. **The review wave re-grades these findings against the new threat model — Direction did not close them.** |

**Explicitly retained, so nobody overcorrects:** fail-closed typed uncertainty; capability honesty
(`authority-unavailable` never silently reroutes); programmatic actor separation (this repo keeps
proving it necessary); containment and recursive termination of **our own** workers; complete-set
evidence publication with re-read verification.

**Boundary: shipped and archived ECP-6 work is not rolled back.** What changed is which *new*
evidence ECP-7 and later must establish.

**Practical effect: the two Changes that have not started — executor and host — get materially
smaller**, because neither has to extend signing or key-custody discipline into the production
Session executor.

### 7. Research documents (in `rasen/explorations/`)

- `process-authority-sandbox-survey.md` — three-platform mechanism survey, every claim graded by
  source tier, two fabrications and one of my own errors recorded.
- `direction-replan-input-step1-daemon-lifetime-scope.md` — the Step 1 decision input.
- `ecp7-graded-execution-backends.md` — the earlier graded-backend draft, now marked landed.

## What this supersedes in lead-2

1. **macOS is no longer `skipped`.** lead-2's "Direction update 2026-08-07 (Architecture Replan 4)"
   section says the macOS child is `skipped` / `moved-out-to-0.3.0`. Step 1 **reopened it as
   `pending` with narrowed scope**: an explicitly declared **best-effort** hosted provider using POSIX
   process groups (Multica's shape — `setpgid`, group SIGTERM, grace, group SIGKILL, with the
   escalation keyed off *whole-group emptiness*, not leader exit). It must declare
   `exactCancel: false` and `scopeEmptyProof: false` visibly before start, and its cancel terminal
   state must be `cancelled / emptiness-unproven` — **never "cleanly cancelled"**.
   **macOS DURABLE authority is still 0.3.0 and still unapproved** (no ES, VM, minimum version,
   entitlement or signing). The best-effort tier is not a substitute for it.
   **DAG safety: this child has no outgoing edge into closure and must not gain one.** Re-adding that
   edge would undo the unblocking Replan 4 achieved.

2. **Criterion 4 moved to the upgrade path.** New. Implementation and evidence retained in full
   (that is what commit `f00f418f` is for); nothing deleted, no history rewritten.

3. **Section 9 leaves with the broker.** lead-2's closing line says "one blocker remains above this
   work: provisioning a unified-cgroup-v2 self-hosted runner". The broker moved to 0.3.0, so
   **Section 9's environment gate is no longer on the 0.2.0 critical path.** The runner is no longer
   a release blocker. Do not spend effort provisioning it for 0.2.0.

4. **Finding impact.** Each of the Linux provider's 11 open findings was read in full (not from
   summaries). **7 leave**: `BRK-R2-B06` (the only Blocker), `BRK-R2-B01`, `BRK-R2-B02-M03` with the
   broker; `NATIVE-SEAM-R1-M01`/`M02` because the ready-hook seam depends on both the broker hook and
   same-boot process-recovery state, neither of which exists in Step 1; `WSL-R4-M04`
   (published-inert abort) and `WSL-R4-M06` (controller-replacement windows) with the
   publish/replacement machinery. `WSL-R4-M00` and `WSL-R4-M01` partially survive.
   **`WSL-R4-M05` (unavailable-configuration matrix) and `PKG-P5` survive.**
   Carry forward lead-2's carve-out: **`BRK-R2-B06` must not move whole — its primary-path analogue
   stays in 0.2.0.**

5. **The executor's ownership grew and its job shrank.** It now owns **three** declared tiers
   (in-tool; hosted kernel-enforced; hosted best-effort), the OS-by-backend capability matrix, and the
   never-silently-reroute rule — but it no longer has to implement reattach, identity revalidation or
   the three-phase protocol. Step 1's largest practical gain is probably here, and nobody has started
   it.

## `F-L2-17` — reframed by the operator; do NOT "fix" it

An earlier revision of this handoff called F-L2-17 "the finding that got more important" and proposed
masking the session bus. **The operator rejected that framing and is right. This section replaces it.
Do not spend effort blocking this vector.**

What F-L2-17 demonstrates (`evidence/f-l2-17-linux-escape-demonstration.md`): a workload inside the
authority's namespace can reach `/run/user/<uid>/bus` and ask the host `systemd --user` to
`StartTransientUnit`, and the resulting process lives outside the authority's PID namespace and cgroup,
parented to the host manager. Three kernel facts confirm it. The authority's `ECHILD`-based oracle
cannot see it.

**Why this is not a defect.** The process authority is **not a security sandbox — it is a janitor.**
The agent already runs on the user's machine, as the user, with their credentials, in their repo; it
has full filesystem and network access and a namespace does not change that. The authority exists for
exactly one purpose: so that *cancel* actually cancels and *done* actually means our own workers
stopped, and we do not leak agent processes that keep burning tokens.

Under that framing F-L2-17 splits into two unrelated things:

| Situation | PID namespace | What we want |
| --- | --- | --- |
| An MCP server or tool subprocess calls `setsid()` and detaches | **caught** | **exactly what we want caught** — an accidental leak of *our own* worker. This is Multica's real production bug #5918: orphaned MCP servers burning model budget and starving the task queue. |
| The agent asks `systemd --user` to start a service | not caught | **should not be caught** — the user asked for a dev server and got one. |

F-L2-17 demonstrates the second. That is normal, intended behaviour.

**Rejected, with reasons, so nobody re-derives them:**

- *Masking `/run/user/<uid>` in the mount namespace* — actively harmful. It breaks `systemd-run` and
  other legitimate user-service use for a threat model we do not have.
- *Building a minimal mount tree (`pivot_root` + allowlist)* — reinstates exactly the containment
  complexity Step 1 removed, to solve a non-problem. Note also that socket-by-socket masking is a
  denylist (system bus, docker socket, any user daemon with a spawn API), and denylists are what this
  Direction distrusts everywhere else.

**The one real residual is wording, not behaviour.** `workload-non-escape` — a frozen constant in
`RECURSIVE_PROCESS_SCOPE_SEMANTICS` (`src/core/session-host/process-authority/types.ts:26`), shipped
and archived with the foundation — overclaims. What the implementation measures, and all we actually
need, is *"descendants the workload itself forks cannot escape"*. `exact-scope-empty` is accurate as
measured (no descendant remains in scope); the risk is only that a reader over-infers it as "nothing
the workload caused still exists". Narrow the contract's wording to match. **No behaviour change, no
masking, no mount-tree work.**

Incidental consistency note: a service started with `npm run dev &` is a descendant and dies with the
scope; one started via `systemd-run` survives. That difference lines up with user intent
(task-scoped vs deliberately persistent) rather than against it.

## Key decisions (and why)

- **Wrote lead-3 rather than rewriting lead-2.** lead-2 carries operational knowledge that took a full
  session to earn and that I have not independently verified; overwriting it would destroy that record
  and risk mangling it. This repo preserves history everywhere else (priorEscalation, replans,
  superseded spec requirements), so handoffs should too.
- **Reopened the macOS child rather than folding best-effort into the executor.** It implements the
  same `ProcessAuthorityProvider` contract as Linux/Windows, needs its own real-macOS receipts, and
  keeping platform detail out of the executor preserves the backend abstraction. Reversible if the
  operator prefers otherwise.
- **Refused to re-add the macOS -> closure edge.** Reopening a child is not a reason to restore a
  dependency that was deliberately cut; the whole point of Replan 4 was unblocking five downstream
  children.
- **Made the preservation commit before any re-tiering.** Re-tiering work that exists only as
  untracked files is a one-`git clean`-away disaster, and the retention promise in three Direction
  documents had nothing behind it.
- **Attached one non-negotiable condition to the operator's macOS choice.** The operator chose the
  Multica approach; I recorded it, and required that macOS cancel report
  `cancelled / emptiness-unproven`. The invariant worth protecting is "the Record must not lie", not
  "processes must never leak" — an honest unproven state keeps the invariant, a false clean-cancel
  breaks it.

## Dead ends & gotchas (this session)

- **`rasen-direction` is no longer in the session skill registry.** `Skill(rasen-direction)` returns
  `Unknown skill`. Its contract was still in context from an earlier invocation and was followed
  manually. If you need it and it is still missing, follow the contract, do not skip the preflight.
- **PowerShell here-strings (`@'...'@`) are a parse error in the Bash tool.** Use a message file with
  `git commit -F`.
- **`git add -- test/fixtures/` is too wide.** It sweeps in unrelated ECP-6 fixtures. Stage the two
  session-host-related paths explicitly.
- **`.rasen/changes/` is gitignored by design** (`.gitignore:169`). Run-state is deliberately not
  committed — do not "fix" that.
- **The Slice's `spec.md`/`plan.md`/`result.md` had never been tracked at all** until commit
  `64c6deea`. Every Direction decision for this slice lived in one worktree. They are now in git.
- **⚠️ The `rasen/changes/ecp-*` Change artifacts are still untracked — 101 files, including this
  handoff.** That covers `handoff/lead-1..3.md`, `evidence/f-l2-17-linux-escape-demonstration.md`
  (both of today's decisions rest on it), `evidence/lead2-implementation-wave-findings.md`
  (`F-L2-01..F-L2-22`), and all three provider Changes' proposal/design/tasks/specs. Committing them
  was offered and the operator declined for now. **Be aware the handoff you are reading is one
  `git clean` from gone**; if you intend to rely on it across sessions, raise it again.
- **`pipeline resume` reports `skipped` children inside `completedChildren`.** That read as "macOS was
  completed" while it meant "moved out of scope". The reopen removed the instance, but the projection
  behaviour is still there for any future `skipped` child.

## Eliminated hypotheses

- *"systemd cgroup delegation gives unprivileged kernel-enforced containment, so the broker was
  unnecessary."* No. Delegation `chown`s the whole subtree to one UID and the workload shares that
  UID, so the common-ancestor rule passes and it can migrate to a sibling. `nsdelegate` **does** close
  it (namespace-reachability, `-ENOENT`, UID-independent) and systemd mounts with it by default
  (`src/shared/mount-setup.c`) — but creating the cgroup namespace needs `CAP_SYS_ADMIN`, obtainable
  unprivileged only via `CLONE_NEWUSER`. **Both mechanisms collapse to one gate.**
- *"macOS has no viable path at all."* `es_new_descendants_client` and `es_sync_client` **do exist**
  (Apple DocC, raw fetch): macOS 27.0, beta, "Does NOT require root privilege / Does NOT require TCC
  approval" — but they require the same Apple-approval-gated
  `com.apple.developer.endpoint-security.client` entitlement, and give observation plus per-event
  auth, never bulk termination. An earlier claim in my own survey that these APIs were absent was
  **wrong** — I mistook "not in the public topic-group listing" for "does not exist".
- *"The design is too complex because containment is over-engineered."* No — containment is already
  minimal. The weight was criterion 4.

## Next action

**Do the Step 1 task-ledger re-tiering before any implementation work**, or the next session will
spend effort on tasks that have left 0.2.0 scope.

1. **Re-tier `ecp-linux-process-authority-provider/tasks.md` line by line against the file.**
   This is written into three Direction documents and the run-state as mandatory: **re-tiering from
   finding summaries or from any handoff note is explicitly forbidden.** Section 9 leaves with the
   broker; criterion-4 tasks move to the upgrade path; containment/exact-empty/availability tasks stay
   and still owe real WSL receipts.
2. **Same for `ecp-native-process-capsule-closure`**: determine which of `SEC-001..003` and
   `RC-002..005` survive by reading each finding in full. No finding may be treated as closed by scope
   change without that check. **Note two independent re-gradings now apply to this set** — Step 1
   (criterion 4 out of scope) and locked decision 12 (TOCTOU path hardening no longer acceptance,
   which is specifically `SEC-002`/`SEC-003`). Keep them distinct in the record; a finding may leave
   for one reason, both, or neither.
3. **Narrow `workload-non-escape`'s wording** in `RECURSIVE_PROCESS_SCOPE_SEMANTICS`
   (`src/core/session-host/process-authority/types.ts:26`) to "descendants the workload itself forks
   cannot escape". It is a **frozen constant shipped and archived with the foundation**, so this is a
   spec/contract change with archive implications, not a local edit. No behaviour change; small, but
   it needs the right process. Doing it late means re-taking any receipt phrased against the old
   semantic.
4. **Windows: lead-2's next-action item 2 is unchanged and still first** — fix the crate's line endings
   and re-freeze (`.gitattributes` LF pin, normalise the five Python-patched files, re-freeze at
   `2b3fabd9…`, re-take the receipts bound to `b44c5e25…`, then write the marker). Step 1 does not
   touch this. Doing it after Section 8 costs 21 rows of receipts.
5. **macOS: propose the narrowed best-effort provider.** Its change directory is empty. Scope is small
   (~60 lines of process-group handling) but the honesty conditions in §1 above are acceptance, not
   decoration.
6. **Then the unified review wave** — the surviving pre-existing findings plus `F-L2-01..F-L2-22`,
   then `11.1-11.11`. Owed non-author reviews: the three Linux TypeScript oracles and the Windows
   17-mutation matrix.
7. **Then executor -> policy-parity -> self-hosting.** All three are empty directories. **They are
   ECP-7's actual user result**; everything before them is prerequisite. Budget accordingly.

## Honest state of "can we release soon"

No. Three of ECP-7's children have not started, two are `escalated` with open review rounds, neither
provider has ever had an independent review (implementation-first deferred all of it), and ECP-8 —
clean branch, single PR, three-OS CI, completion audit, version/changelog/tag — has not begun.
Step 1 shortened the path materially; it did not shorten it to "nearly done".
