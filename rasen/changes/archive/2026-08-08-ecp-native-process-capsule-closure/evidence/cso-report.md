# Security posture report: ecp-native-process-capsule-closure

## Scope and verdict

Mode: dispatched, report-only. Branch:
`wip/ecp-shared-bounded-loop-lifecycle-resume`.

This review covered the Change artifacts and evidence plus the actual
ProcessScope, native ProcessCapsule, Session-host integration, helper resolver,
build/package, and narrow Management API surfaces. It specifically tested the
security reasoning around root-exit versus scope-empty authority, exact native
identity/group control, Windows Job ownership, bounded uncertainty, helper
adjacency and provenance, cwd identity, command construction, secret handling,
and authority-scope exclusions.

**Verdict: BLOCKED.** The implementation has one canonical Blocker and two
canonical Majors. In particular, the principal S2 requirement is still violated
when `LiveProcessScope.closed` rejects: the rejection is converted into a
fulfilled transport-close signal and the host releases authority without an
observed `SCOPE_EMPTY` receipt.

| Canonical severity | Count |
| --- | ---: |
| Blocker | 1 |
| Major | 2 |
| Minor | 0 |
| Trivial | 0 |

Native CSO scale: CRITICAL 1, HIGH 2, MEDIUM 0. All reported findings were
self-verified from the concrete call paths because dispatched leaf mode forbids
independent subagent verification.

## Focused attack-surface map

| Surface | Exposed operations | Security boundary |
| --- | --- | --- |
| Hosted Session Management API | execute, cancel, restart, retire, inspect/list | Accepts lifecycle commands but does not expose `runtimeRef`; server authorization is outside this Change. |
| Session host | open, observe close, reconcile, cancel/restart/retire/shutdown | Owns durable registry facts and writer release; only exact scope-empty may clear them. |
| ProcessScope | prepare, activate/abort, inspect, terminate | `ProcessRef` is the only TypeScript control capability; native PID/PGID/Job details remain below this seam. |
| Native helper protocol | controller, supervisor, one-shot inspect/terminate | Parses framed launch/control input and holds OS containment/signal authority. |
| Helper package resolver | manifest and adjacent native executable | Must reject platform/protocol/hash mismatch, non-regular artifacts, and every symlink/junction escape. |
| Release build staging | three OS helper artifacts plus provenance sidecars | Produces a closed manifest and per-artifact integrity/input-provenance claims. |

No signer custody, EvidenceStore publication, canonical Run/Record mutation, or
broader execution authority was found in this Change's implementation paths.

## Findings

### 1. Control loss is converted into clean host detachment

* **Native severity:** CRITICAL
* **Canonical severity:** Blocker
* **Confidence:** 10/10
* **OWASP:** A04 – Insecure Design
* **Location:** `src/core/session-host/process-capsule/native-process-scope.ts:185`, `src/core/session-host/claude-backend.ts:271`, `src/core/session-host/claude-backend.ts:366`, `src/core/session-host/host.ts:484`, `src/core/session-host/host.ts:640`
* **Verification:** Self-verified by following both the failure and observer call paths.

`CapsuleClient` correctly rejects `live.closed` when the controller/control pipe
closes before `SCOPE_EMPTY`. `ClaudeResidentTransport` then handles that rejection
by calling `close(error)`, but `close()` always fulfills its public `closed`
promise via `resolveClosed()`. The host observes both transport fulfillment and
rejection through the same `observeTransportClose` callback, which calls
`detachLive`, releases the writer claim, and clears the registry's process facts.
Thus a typed uncertain native result becomes an authoritative clean detach at
the next layer.

**Exploit scenario:**

1. On Linux or macOS, a hosted backend starts a descendant that remains in the
   reserved process group.
2. The native controller crashes or is killed before it emits `SCOPE_EMPTY`.
3. `CapsuleClient.fail()` rejects `live.closed` with `process-control-lost` while
   the descendant is still alive.
4. `ClaudeResidentTransport.close(error)` fulfills `transport.closed` anyway.
5. `SessionHost.observeTransportClose()` removes the exact process authority and
   writer claim.
6. A later restart/new admission can acquire a new writer while the old
   descendant continues running, producing concurrent generations and allowing
   stale work or filesystem mutations after authority was declared gone.

**Impact:** Loss of the core durable-process authorization invariant, concurrent
writer generations, and untracked agent execution. This directly violates the
Change's required “only `SCOPE_EMPTY` authorizes detachment” behavior.

**Recommendation:** Preserve the distinction at the transport boundary. A
`live.closed` rejection must publish typed control uncertainty and must not
settle the host's exact-close signal. Prefer a typed terminal observation such
as `scope-empty | control-uncertain`, or keep exact close and uncertainty as
separate promises/events. In the host, only the `scope-empty` branch may call
`detachLive` or clear registry/ownership; the rejection branch must retain the
transport/process authority and mark the Session interrupted/busy. Add a
discriminator that rejects `live.closed` before scope-empty and proves registry
facts, writer claim, capacity, and restart refusal remain until later exact
reconciliation.

### 2. An ancestor junction can move the entire helper trust root outside the package

* **Native severity:** HIGH
* **Canonical severity:** Major
* **Confidence:** 9/10
* **OWASP:** A08 – Software and Data Integrity Failures
* **Location:** `src/core/session-host/process-capsule/resolver.ts:111`, `src/core/session-host/process-capsule/resolver.ts:120`, `src/core/session-host/process-capsule/resolver.ts:149`, `src/core/session-host/process-capsule/resolver.ts:158`
* **Verification:** Self-verified against the existing nested-junction negative test and the unguarded ancestor path.

The resolver canonicalizes `packageRoot`, but constructs `nativeRoot` lexically
and never proves the real native root remains below the real package root. It
rejects a symlink at the final manifest/helper path and verifies that the real
helper stays below the real `nativeRoot`; those checks still pass when
`native/process-capsule` or `dist/native/process-capsule` itself is a junction to
an external directory. The existing junction test replaces only the platform
subdirectory, so it does not exercise this ancestor escape.

**Exploit scenario:**

1. A compromised extraction/staging step or local package-tree attacker replaces
   the whole `dist/native/process-capsule` directory with a junction to an
   attacker-controlled directory.
2. The external directory contains a regular `manifest.json` and malicious
   helper whose declared length and SHA-256 match each other.
3. The manifest is not itself a symlink, and the helper is below the canonical
   external `nativeRoot`, so every current containment check passes.
4. The daemon spawns the external malicious executable with its own process and
   filesystem authority.

**Impact:** Native code execution through a path shape the closed-manifest
contract explicitly promises to reject. Hash equality proves only consistency
between two attacker-controlled external files in this case.

**Recommendation:** Canonicalize the selected native root and require it to be a
strict descendant of the canonical package root before reading the manifest.
Canonicalize the manifest itself and require it to remain under that validated
root. Reject symlink/reparse-point ancestors, not only the final directory entry,
and add source-root and dist-root ancestor-junction negatives. Where practical,
open/hash/execute the same file identity to avoid a validation-to-spawn swap.

### 3. The backend cwd is re-resolved after durable publication

* **Native severity:** HIGH
* **Canonical severity:** Major
* **Confidence:** 8/10
* **OWASP:** A04 – Insecure Design
* **Location:** `src/core/session-host/claude-backend.ts:437`, `src/core/session-host/process-capsule/native-process-scope.ts:398`, `native/process-capsule/src/main.rs:243`, `src/core/session-host/host.ts:440`
* **Verification:** Self-verified across canonicalization, publication, activation, and native spawn.

The host and backend canonicalize the cwd before preparation, and the controller
is spawned using that path. However, the launch frame persists only the path
string. After the ProcessRef is durably published, the supervisor launches the
backend with `Command::current_dir(&spec.cwd)`, re-resolving the pathname rather
than inheriting the already-open controller cwd or validating the same directory
identity. A rename-plus-symlink/junction swap between publication and activation
therefore retargets the actual backend while the registry and writer claim still
name the original canonical directory.

**Exploit scenario:**

1. A Session is prepared for canonical workspace `P`; the inert controller is
   created and the ProcessRef for `P` is written durably.
2. A concurrent actor watching the registry renames `P` and replaces that name
   with a symlink/junction to attacker-controlled directory `Q` before ACTIVATE.
3. The host activates the already-published scope without another identity check.
4. Rust resolves `spec.cwd` again and starts Claude in `Q`, while the registry,
   ownership claim, and Session API continue to assert `P`.
5. Project instructions/configuration from `Q` can influence the agent and its
   subsequent privileged tool actions under a falsely attributed Session.

**Impact:** Workspace identity and policy attribution can diverge from the
executed directory, enabling cross-workspace prompt/config injection and actions
under the wrong durable Session boundary.

**Recommendation:** Bind cwd by filesystem identity across preparation and
activation. On POSIX, inherit the controller's already-resolved cwd (for example
launch the backend relative to `.`) or pass an opened directory descriptor and
use `fchdir`; on Windows, retain and validate an equivalent directory handle/file
identity. At minimum re-canonicalize and compare immediately before activation,
but handle-based inheritance avoids another check/use race. Add a publication-
barrier mutation test that swaps the path and proves activation fails closed
without backend work.

## STRIDE summary

| Component | Spoofing | Tampering | Repudiation | Disclosure | DoS context | Elevation / authority |
| --- | --- | --- | --- | --- | --- | --- |
| ProcessScope/host close path | Exact native births resist PID spoofing, but close-state translation is wrong. | Control loss can tamper lifecycle truth by becoming clean close. | Registry retains bounded facts, but the erroneous detach destroys the controlling fact. | No ProcessRef is exposed by public views. | Retained uncertain scopes are expected; generic exhaustion is not reported. | Old and new generations can overlap after false detach. |
| Helper resolver/package | Platform/protocol/hash fields are closed-schema. | Ancestor-junction escape lets both manifest and helper leave the package trust root. | Per-artifact digest is observable. | Compiler/source metadata contains no secrets. | Not separately reported. | Escaped native helper executes with daemon authority. |
| cwd binding | Canonical strings and digests prevent ordinary aliasing. | Path identity can change after publication but before native spawn. | Durable record can claim a different directory than execution. | Retargeted workspace may expose unintended project context to the agent. | Not separately reported. | Agent actions can occur under the wrong workspace/policy attribution. |
| POSIX/Windows containment | Controller and supervisor birth checks plus Job/PGID topology materially reduce PID reuse risk. | No additional confidence-8 defect found beyond the host close translation. | Typed observations exist. | Native refs stay out of API views. | Actual Linux/macOS runtime proof remains an ECP-8 obligation. | No signer/Run authority crosses this module. |

## Data classification

* **Restricted:** No passwords, payment data, private keys, or signer custody are
  intentionally stored by this Change. Backend prompts/results can contain user
  secrets, but stderr is drained and registry persistence uses digests/bounded
  classifications rather than raw output.
* **Confidential:** Opaque ProcessRefs, writer owner tokens, backend Session ids,
  canonical cwd values, and live process facts in the owner-only registry.
* **Internal:** Display PIDs, bounded lifecycle diagnostics, helper compiler and
  source-digest metadata, test receipts.
* **Public:** Published helper binaries/manifests and release provenance metadata.

No concrete secret/PII logging defect meeting the confidence threshold was
found. Public Session views omit the ProcessRef and writer token.

## Candidates filtered

Ten concrete candidates were screened; seven were filtered and three reported.

* The ProcessRef nonce is not cryptographically authenticated by the one-shot
  helper, but no additional privilege was demonstrated: a same-user process able
  to forge registry/native facts can already signal the same same-user processes.
* The POSIX group-number check/signal interval was filtered as theoretical: a
  live orphan group reserves its PGID, and a newly reused leader must occupy the
  recorded supervisor PID and is checked against its birth before each signal.
* Manifest plus helper substitution without the ancestor-junction bypass was
  filtered because the selected contract claims adjacent-artifact integrity, not
  signer authenticity; signer custody is explicitly outside this prerequisite.
* Staged provenance sidecars are descriptive build-input metadata, not a
  reproducible-build or cryptographic-attestation claim.
* Windows Job creation/assignment retains a single non-inherited owning handle
  in the production path; no concrete last-handle escape was found.
* Command and arguments use absolute executable resolution, argument vectors,
  `execFile`/`Command`, `shell: false`, and the established Windows shim escaping;
  no attacker-controlled command-injection path survived review.
* Linux/macOS real-runtime evidence is deliberately deferred to ECP-8 and is not
  misreported as executed here; its absence is a release gate, not a duplicate
  child security finding.

## Commands and evidence inspected

* `git branch --show-current`
* `node bin/rasen.js status --change ecp-native-process-capsule-closure --json`
* `git status --short` and scoped `git diff`
* Read the complete proposal, design, tasks, specification, and all five existing
  evidence files.
* Read and line-traced the relevant Rust helper, ProcessScope/client/resolver,
  Claude transport, host, registry/ownership, contracts, build script, release
  workflow, package metadata, and focused tests.
* Used scoped `rg` searches for native identity/group control, protocol frames,
  helper/path validation, provenance, command construction, runtimeRef exposure,
  signer/Run crossing, and secret/diagnostic handling.

No product code, tests, tasks, run-state, commits, pushes, shipping, or archive
state were modified by this review.

## Disclaimer

**This tool is not a substitute for a professional security audit.** `/cso` is an
AI-assisted scan that catches common vulnerability patterns; it is not
comprehensive, not guaranteed, and not a replacement for hiring a qualified
security firm. LLMs can miss subtle vulnerabilities, misunderstand complex auth
flows, and produce false negatives. For production systems handling sensitive
data, payments, or PII, engage a professional penetration testing firm. Use
`/cso` as a first pass to catch low-hanging fruit and improve your security
posture between professional audits, not as your only line of defense.
