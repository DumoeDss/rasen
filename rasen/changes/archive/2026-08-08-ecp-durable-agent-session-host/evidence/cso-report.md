# Security posture report: durable agent Session host

## Audit identity and scope

- Mode: dispatched, report-only, independent non-author CSO audit
- Scope: child-1 diff surfaces only: local hosted-Session API/CLI, registry and
  leases, Claude process adapter, writer/process-tree ownership, cwd binding,
  recovery, cancel/restart/retire/shutdown, and forbidden Run/signing authority.
- Method: OWASP/STRIDE review, command/data-flow inspection, focused security
  and process tests, and self-verification because dispatched mode forbids
  subagent fan-out.

## Attack surface map

| Surface | Exposure and control |
| --- | --- |
| Hosted HTTP routes | 6 local loopback routes; all pass the existing daemon bearer-token check before routing |
| CLI | `session exec/list/inspect/cancel/restart/retire`; adopts only a positively identified same-version daemon |
| Process boundary | One server-resolved Claude binary and fixed argv through `spawnAgentCli`; prompt is structured stdin |
| Durable files | Owner-restricted registry, writer lease, candidate/tombstone, cwd binding, and worker token below machine data home |
| Sensitive transient data | Prompt/result bodies and backend environment in daemon/child memory; prompt/result bodies are excluded from registry |
| Privileged authority | No canonical Run/Action/Record/EvidenceStore mutation and no trusted-producer/private signing-key input or custody |

## Security finding summary

| # | Native severity | Canonical | Confidence | Category | Finding | OWASP | File:line |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | HIGH | Major | 9/10 | Process ownership / containment | Nonce-first publication still permits fake authority and an unbound privileged worker | A04 | `src/core/session-host/host.ts:358-379` |

## Finding 1: Nonce-first authority still has an unrecoverable pre-bind window

- **Native severity:** HIGH
- **Canonical severity:** Major
- **Confidence:** 9/10
- **OWASP:** A04 Insecure Design
- **Verification:** Round 1 independently traced the revised
  `openTransport()` ordering and executed an exact child-process probe. The
  verifier cleaned the exact probe PID after observing the failure; dispatched
  mode forbids an independent subtask.
- **Description:** Round 1 now publishes the owner nonce in the registry before
  `backend.open()` (`src/core/session-host/host.ts:358-367`), then spawns the
  worker, binds its root into the ownership token, and only afterward publishes
  the root PID (`host.ts:367-393`). This closes the original bind-to-registry
  interval, but leaves two adjacent unrecoverable states. A crash before spawn
  leaves registry “process” authority and a dead bridge claim with no worker;
  a crash after spawn but before `bindWorker()` leaves a real worker with no
  durable root. Both are intentionally classified `live-or-uncertain` when the
  worker token is absent (`src/core/claude/session-state.ts:273-279,673-675`),
  so recovery cannot remove the fake claim or signal the real worker.
- **Exploit scenario:**
  1. A hosted backend is spawned with the user's workspace/account capability.
  2. The bridge dies after spawn returns but before the synchronous worker-token
     bind, whether from an adversarial backend-triggered fault or ordinary host
     failure.
  3. The replacement daemon sees the exact registry nonce but no worker token
     or root PID. Its only safe answer is `live-or-uncertain`; it cannot signal
     an unknown PID.
  4. The old worker remains alive outside control. The symmetric crash before
     spawn leaves the same durable uncertainty even though no worker exists,
     permanently denying safe recovery.
- **Impact:** loss of lifecycle containment: an agent process can retain
  workspace/backend capability after the daemon believes the Session is
  terminal, defeating cancel/retire and allowing continued file or external
  actions outside observable host control.
- **Recommendation:** move process creation and worker-token publication behind
  one recoverable supervisor/handshake boundary, such that the parent cannot
  observe a spawned worker before exact durable root authority exists. Model a
  provably pre-spawn claim separately so it can be reclaimed when the bridge is
  dead, without treating it as evidence of an unknown worker. Add both
  crash-before-spawn and crash-after-spawn-before-bind fault tests.

## OWASP / STRIDE result

- A01 access control: hosted routes are bearer-authenticated and exact UUID
  matched; no cross-resource authorization vulnerability was found in this
  machine-local single-user boundary.
- A02 cryptography: SHA-256 is used for non-secret integrity/digests and
  cryptographic randomness for tokens; no private signing custody enters scope.
- A03 injection: backend binary/argv are server-owned, Windows shims use the
  shared escaped adapter, prompt content is stdin-only, and the real
  metacharacter/CJK wrapper tests passed.
- A04 insecure design: Finding 1 is an authority-publication/containment gap.
- A05/A06/A07/A08/A09/A10: no in-scope confidence-8 vulnerability found.
- STRIDE: spoofing/tampering are bounded by bearer auth, registry digest and
  exact owner nonce; information disclosure scans were clean; elevation of
  privilege was not found. Worker containment across bridge death remains open.

## False-positive filtering

Discarded below the 8/10 confidence gate or by hard exclusion:

- normal string equality for the local 256-bit bearer token (no realistic
  remote timing exploit established);
- owner-permissioned machine-local lifecycle data at rest;
- generic output/resource exhaustion claims (bounded and hard-excluded);
- attacks requiring caller-controlled `RASEN_CLAUDE_BIN`, `ComSpec`, or process
  environment (trusted environment/CLI configuration under the skill precedent);
- same-user cwd path replacement without a distinct privilege gain.

## Gates observed

- Round 1 focused host/registry/protocol/ownership/Management/daemon/CLI suite:
  14 files, 86/86 tests passed.
- Build, lint, TypeScript no-emit, and strict Change validation passed.
- Static authority scan found no host import from `change-run`, no
  `EvidenceStore`/trusted completion call, and no private-key parameter surface.

## Final verdict

Round 1 independently confirms the original post-bind gap was displaced, not
fully eliminated. The security Major overlaps code-review V5 and is counted
once in the aggregate review/verification verdict.

CSO VERDICT: CHANGES_REQUIRED — Blocker:0 Major:1 Minor:0 Trivial:0

This AI-assisted audit is not a substitute for a professional security audit.

## Strategy attempt 1 — fresh non-author security audit (2026-08-04)

### [Major][HIGH 10/10] Backend-root exit releases authority while a detached agent descendant is still live

**Boundary:** lifecycle / process authority; OWASP A04 (Insecure Design).

**Exploit scenario:** a compromised or defective hosted backend spawns a
detached process with the hosted worker's filesystem access, then exits its root
process cleanly. The native supervisor reports root `EXIT`, the Node capsule
client resolves whole-scope `closed`, and SessionHost clears the registry
`runtimeRef` and writer ownership even though the controller, supervisor, and
descendant are still alive. The detached process can continue operating after
the product reports the generation closed and has discarded its control
capability.

**Evidence:** `native/process-capsule/src/main.rs:285-294`,
`src/core/session-host/process-capsule/native-process-scope.ts:224-229`, and
`src/core/session-host/host.ts:640-679`. A fresh real-Windows probe observed the
`closed` promise resolve while native `inspect(ref)` still returned
`{state:"live", controllable:true}` and the detached descendant was alive.

**Required fix:** make backend-root exit an event distinct from scope-empty /
controller-terminal close; retain registry and writer authority until exact
scope closure is observed; add a real detached-descendant root-exit regression.

### [Major][HIGH 9/10] POSIX replacement termination can leave the privileged worker group orphaned

**Boundary:** recovery / process containment; OWASP A04 (Insecure Design).

**Exploit scenario:** on Linux or macOS, a hosted worker retains a resistant
descendant and the old native controller crashes or is killed during daemon
replacement. The replacement helper validates and signals only the controller
PID. POSIX has no Windows-Job-style controller-death cleanup, while the
supervisor and its process group remain alive. Recovery cannot reattach the
pipes and cannot terminate the group, so the worker continues with its original
cwd and allowed environment despite cancel/reconcile intent.

**Evidence:** `native/process-capsule/src/main.rs:832-844`, `:1011-1159`, and
`:1246-1256`. The path is source-direct and confidence is high; actual Linux /
macOS execution is still the explicitly deferred ECP-8 matrix.

**Required fix:** persist/validate the exact supervisor native identity and
terminate the exact group after controller loss (or provide equivalent kernel
containment), then exercise real controller/daemon-death and resistant-
descendant cases on both POSIX platforms.

The Windows controller-death escape from historical R3-V5-A is independently
resolved. No new secret leakage, shell injection, arbitrary client argv,
registry corruption replacement, Run/Action/EvidenceStore authority, or signing
key custody was found in this strategy delta. The macOS ABI, unbounded control
phase, and build reproducibility issues are code/spec findings rather than
additional security findings in this report.

CSO VERDICT: CHANGES_REQUIRED - Blocker:0 Major:2 Minor:0 Trivial:0

This AI-assisted audit is not a substitute for a professional security audit.

It is a focused first pass and does not guarantee that all vulnerabilities were
found; production systems handling sensitive data should also receive qualified
penetration testing.

## Round 2 independent confirmation

The Round 2 supervised-admission design materially closes the original
crash-before-activation defect: the outer Node supervisor is inert, its private
fd-3 activation byte is sent only after the host synchronously binds the exact
root under the durable nonce, and a failed commit does not launch the backend.
The supervisor command payload contains only server-resolved command/argv
facts; prompt content remains on stdin and neither prompt, environment secrets,
nor the private activation byte is added to process argv or diagnostics.
`shell:false`, `windowsHide:true`, fixed server-owned argv, and the existing
Windows shim preparation remain intact on the reviewed production path.

Two HIGH / Major containment findings remain.

### Finding 1: matching stale PID can signal an unrelated reused process

- **Native severity:** HIGH
- **Canonical severity:** Major
- **Confidence:** 9/10
- **OWASP:** A04 Insecure Design
- **Locations:** `src/core/claude/session-state.ts:114-122,661-699`;
  `rasen/changes/ecp-durable-agent-session-host/design.md:92`.
- **Evidence:** the worker token has no OS process-start identity. A safe-spy
  probe modeled an exact old nonce/root whose numeric PID had been reused by
  the verifier process. Recovery called `terminateTree()` with the unrelated
  PID. This is precisely the named PID-reuse threat; matching durable token
  bytes prove the old host generation, not that the current OS process is the
  old worker.
- **Impact:** startup recovery can terminate an unrelated same-user process.
- **Required correction:** compare a durable process-instance fingerprint that
  cannot survive PID reuse, or classify the tree as uncertain and do not
  signal when exact instance identity cannot be proven.

### Finding 2: supervisor crash can orphan a detached descendant

- **Native severity:** HIGH
- **Canonical severity:** Major
- **Confidence:** 9/10
- **OWASP:** A04 Insecure Design
- **Locations:** `src/core/agent-cli-process.ts:140-229` and
  `src/core/session-host/host.ts:420-480`.
- **Evidence:** on the current Windows host, a real admitted supervisor
  activated a backend that launched a detached grandchild. After forcibly
  terminating the supervisor, both root and backend were dead but the
  grandchild remained live; production `killProcessTree(rootPid)` did not reach
  it. Separately, a late-open transport returning `closed:false` or throwing
  caused shutdown to release its claim and clear durable authority while the
  injected process remained live.
- **Impact:** an agent descendant can retain workspace/account capability
  after daemon shutdown or crash while recovery has neither a live root nor
  durable ownership with which to control it.
- **Required correction:** enforce a durable OS containment primitive whose
  lifetime is not the supervisor PID alone, and never release writer/process
  authority until close of the admitted tree is positively observed.

Fresh negative checks found no prompt/secret/activation injection, no client-
controlled binary or argv path, no Run/Action/EvidenceStore mutation, and no
signing-key custody. Legacy missing-worker claims remain fail-closed;
supervised no-worker pre-spawn claims are reclaimed without signalling.

The two security findings correspond to review V5 (PID reuse and crash
containment) and V6 (unobserved late-open close); they are not added again to
the aggregate code-review count.

CSO VERDICT: CHANGES_REQUIRED - Blocker:0 Major:2 Minor:0 Trivial:0

This AI-assisted audit is not a substitute for a professional security audit.

## Round 3 independent confirmation

Security review identity: branch
`wip/ecp-shared-bounded-loop-lifecycle-resume`, HEAD
`050fc84332b26a75a07f441efd6b235842f89e1e`, tree
`58489c46633a209d2c1761c2a4b684ad8b95cb48`, exact 20-file manifest SHA-256
`df1d7bf6ac444a334969dac7e68c4e4ab3df0f8bf448fb00a4801512164ceaca`.

### Attack-surface delta

Round 3 adds two security-sensitive mechanisms: a pre-activation Windows Job
controller and exact process-instance tokens used to authorize later signals.
The trusted state boundary remains local Session/Registry ownership; no
Run/Action/Record/EvidenceStore mutation, completion signature, trusted-state
promotion, or private-key custody was introduced. Controller source is a
constant encoded command, the root PID is numeric and passed through an
overwritten environment variable, and backend launch remains `shell:false`.
No command, prompt, or secret injection path was found.

### R3-CSO-1 - Major - Controller death bypasses the intended Windows containment boundary

- **Confidence:** 10/10.
- **OWASP:** A04 Insecure Design.
- **Locations:** `src/core/agent-cli-process.ts:223-310`.
- **Exploit path:** an admitted backend runs with the user's authority and can
  enumerate same-user sibling processes. It terminates or crashes the direct
  PowerShell Job controller. In two production-adapter probes, that exact
  controller died while the admitted root and detached descendant remained
  live; the stronger probe observed both survivors for six seconds. The agent
  can then retain workspace/account capability after a later supervisor or
  daemon failure even though the promised last-resort controller is gone.
- **Impact:** containment escape and an orphaned privileged agent process.
- **Required correction:** use a kernel containment/handle-ownership design in
  which controller death provably closes the last active
  `KILL_ON_JOB_CLOSE` handle, and add a real controller-death regression that
  verifies both root and detached descendants terminate.

### R3-CSO-2 - Major - Remaining-POSIX signal authority can alias a reused PID

- **Confidence:** 9/10.
- **OWASP:** A04 Insecure Design.
- **Locations:** `src/core/claude/session-state.ts:751-783`.
- **Exploit path:** the fallback identity is a hash of second-resolution
  `ps ... lstart` text. Under process churn, a numeric PID reused within that
  second can have the same stored identity. Recovery then classifies the new,
  unrelated process as `same` and is permitted to signal it.
- **Impact:** unintended termination of a same-user process and loss of the
  fail-closed ownership guarantee.
- **Required correction:** use an exact OS birth identity on remaining POSIX,
  or classify the identity as uncertain and refuse to signal. Test the actual
  fallback, not only injected `different` inspections for Windows and Linux.

These are the same two canonical V5 review findings and are not added again to
the aggregate count. V6's retained-authority shutdown behavior is resolved.

CSO VERDICT: CHANGES_REQUIRED - Blocker:0 Major:2 Minor:0 Trivial:0

This AI-assisted audit is not a substitute for a professional security audit.

## Current authoritative CSO verdict (strategy attempt 1)

The fresh strategy security audit records two open Major findings: premature
authority release on backend-root exit and POSIX orphaning after controller
loss. It supersedes the historical Round 3 tail without changing the aggregate
security count.

CSO VERDICT: CHANGES_REQUIRED - Blocker:0 Major:2 Minor:0 Trivial:0

This AI-assisted audit is not a substitute for a professional security audit.
