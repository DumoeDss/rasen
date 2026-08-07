## 1. Baseline and Boundary Locks

- [ ] 1.1 Record the implementation start HEAD, targeted `git status`, Direction source revision, archived foundation revision/evidence paths, and architecture-replan digest without normalizing unrelated worktree changes.
- [ ] 1.2 Record hashes for the accepted main `process-authority-provider` spec and `test/helpers/process-authority-provider-conformance.ts`; add a verification guard that this Change consumes both unchanged.
- [ ] 1.3 Record the frozen Linux tree marker (`sourceDigest 087d87a5948c74ae770233f15bb1dce845557d8bcc66dc23fa12642cf615ad59`) and add a guard that no file under `native/linux-process-authority/**` or `rasen/changes/ecp-linux-process-authority-provider/**` is modified by this Change.
- [ ] 1.4 Create an implementation file map assigning the new Windows TypeScript adapter, native crate, artifact manifests, build script, tests, fixtures, and evidence files, and explicitly excluding ProcessScope default switching, SessionHost integration, legacy PGID or legacy Windows-capsule removal, macOS, and ECP-8 release truth.
- [ ] 1.5 Capture the legacy ProcessCapsule Windows behaviour as migration baseline — the unnamed Job with kill-on-job-close, the `PROC_THREAD_ATTRIBUTE_JOB_LIST` supervisor assignment, the `duplicate_job` mutation switch, the accounting poll, and the `unnamed-job-kill-on-close` capability gate at `src/core/session-host/process-capsule/resolver.ts:143` — and add a guard that the new provider does not reinterpret any of it as exact authority.
- [ ] 1.6 Capture actual environment facts: Windows build and edition, kernel version, architecture, Node and pnpm versions, rustc/cargo versions and installed targets, ambient-Job membership of the developing process, and whether the boot-identity candidate sources are readable. Record them as environment evidence, not as a passing oracle.
- [ ] 1.7 Add named acceptance-gate records for platform-neutral contract, actual Windows x64 runtime, oracle discrimination, arm64 cross-build shape, package/build matrix, closure integration, and ECP-8 release, so that no narrower receipt can close a broader gate.

## 2. Provider Contract and RED Tests

- [x] 2.1 Add RED tests for the exact `rasen.windows.job-object` descriptor, capability id, protocol version, common-contract version, provider-reference version, complete semantic list, unique provider id, and exact manifest entry.
- [x] 2.2 Add RED tests that an unavailable Windows provider selects nothing else — no legacy capsule helper, no process-group path, no process-tree or task-listing path — and that a non-Windows or wrong-architecture runtime cannot select the artifact.
- [x] 2.3 Add RED tests for a closed, bounded Windows private-reference codec binding provider discriminator, versions, scope id, generation, both capabilities, preparation operation id, launch digest, boot identity, guardian process id and birth identity, endpoint owner identity, attested limit mask, sole-handle attestation, and helper protocol/source identity.
- [x] 2.4 Add RED codec mutation tests for unknown fields, future versions, truncation, oversize, tampering, discriminator swap, capability substitution, and log redaction, proving the sensitive reference never reaches diagnostics.
- [x] 2.5 Add RED lifecycle mapping tests for prepared-inert, published-inert, live, root-exited, exact-scope-empty, authority-unavailable, authority-uncertain, identity-drift, event-gap, timeout, and control-loss without expanding the frozen common vocabulary.
- [x] 2.6 Add RED tests for exit-status fidelity: the unsigned status is preserved exactly with no sign extension or truncation, the signal branch is always null on this platform, and a result carrying both branches or neither is rejected as control-loss rather than repaired.
- [x] 2.7 Add a Windows fixture that imports `test/helpers/process-authority-provider-conformance.ts` unchanged, supplies the concrete durable Windows publisher, and initially fails its measured mutation snapshot against the unimplemented provider.
- [x] 2.8 Add RED durable-publication tests for no-record prepared state, commit-before-acknowledgement, crash after commit and before acknowledgement, crash after acknowledgement and before activate, exact recovered published state, forged or conflicting ledger provenance, and activation without a matching record.

## 3. Windows Native Artifact and Closed Protocol

- [x] 3.1 Create `native/windows-process-authority` with pinned Rust settings, a committed lockfile, zero external dependencies, license/provenance accounting, and separate helper and guardian entry points.
- [x] 3.2 Hand-declare the required `kernel32`, `advapi32`, and `ntdll` foreign items with explicit struct layouts and constants, and record a table mapping each declared item to the SDK definition it mirrors; every declared item is subject to the real-call obligation in 9.6.
- [x] 3.3 Define the Windows helper protocol constants, closed frame and event schemas, maximum frame/string/vector counts, operation ids, monotonic event sequence, exact unsigned status encoding, and explicit protocol and reference versions.
- [x] 3.4 Implement strict launch decoding for a server-resolved absolute executable, absolute working directory, bounded arguments and environment, no path search, no shell, no caller-supplied handle or process id, and immutable launch-snapshot ownership including the `windowsVerbatimArguments` input.
- [ ] 3.5 Implement a provider-owned trusted state root and bounded scope-id directory and endpoint derivation with exact owner SID, DACL, non-inherited ACE, regular-file/named-pipe type, reparse-point rejection, and parent-ownership checks outside the workload working directory.
- [ ] 3.6 Implement adjacent native artifact manifest parsing and resolution for exact Windows platform, architecture, mode, protocol, length, digest, compiler, and source digest, rejecting escape, reparse points, path search, download, runtime compilation, shell, and legacy-helper fallback.
- [ ] 3.7 Add protocol and resolver mutation tests for truncation, oversize, unknown frame or field, duplicate or conflicting sequence, wrong artifact identity, endpoint escape, insecure DACL, wrong owner, and late results.
- [ ] 3.8 Add an isolated build/output/export seam for the Windows artifact that does not modify the meaning or source digest of the legacy ProcessCapsule manifest.

## 4. Job Authority Prepare and Availability

- [x] 4.1 Implement unnamed Job creation and set the exact extended limit mask with kill-on-job-close enabled and both breakaway permissions disabled; read the mask back and require bit-exact equality, recording the observed mask in the prepare attestation.
- [x] 4.2 Implement completion-port association on the still-empty Job during prepare, attest that the active-process count was zero at association time, and reject any authority whose port was associated after a member existed.
- [x] 4.3 Implement the Job handle ownership discipline: created non-inheritable, never duplicated, never placed in any inherit list, never transmitted, held only by the guardian; emit the sole-handle attestation consumed by the reference and by the recovery rules.
- [x] 4.4 Implement boot-identity acquisition by probing the enumerated candidate sources in order, rejecting all tick-arithmetic derivations, recording which source was selected and that it was probed, and returning typed `authority-unavailable` when no exact source is obtainable.
- [x] 4.5 Implement the private control endpoint as a first-instance-only named pipe with an owner-only non-inherited DACL and remote clients rejected, treating an existing name as a typed failure rather than a reuse.
- [x] 4.6 Implement guardian launch with only the minimum inherited handles, closing every unintended inherited handle, and verify the workload can never reach the endpoint, the Job handle, or the trusted state root.
- [x] 4.7 Implement guardian readiness and prepare attestation containing boot identity, guardian process id and birth identity, observed limit mask, port-association state, endpoint owner identity, sole-handle attestation, helper identity, and the fact that no workload process exists.
- [x] 4.8 Implement the TypeScript availability transaction that revalidates every attested fact before returning `prepared-inert` and maps each enumerated denied or unsupported prerequisite to typed unavailable with a bounded diagnostic.
- [ ] 4.9 Implement exact partial-construction reconciliation for every injected failure point from state-root validation through final revalidation, proving no workload process, no live guardian, no surviving Job, and no residual endpoint remain; tie the injected-failure matrix to the checkpoint enumeration with a compile-time exhaustiveness forcing function.

## 5. Suspended Assign-Before-Run Activation

- [x] 5.1 Implement activation that creates the workload root exactly once with `CREATE_SUSPENDED` and an at-creation Job-list assignment, an explicit handle list restricted to the three standard I/O handles, no window, an absolute executable and working directory, and a fully materialised environment block.
- [x] 5.2 Implement the pre-resume proof sequence — membership confirmed for that exact process, limit mask re-read and unchanged, membership event received for that exact process id — and resume the initial thread only after all three succeed.
- [x] 5.3 Implement the failure path that terminates the still-suspended root and returns a typed failure whenever any pre-resume proof fails, and assert the workload produced no observable side effect.
- [ ] 5.4 Implement exactly-once activation semantics: a repeated activation creates no second root, changes no recorded lifecycle truth, and returns a typed ordering conflict.
- [ ] 5.5 Implement the provider runtime bridge over the authenticated private endpoint, opening standard I/O and the root and empty event streams before the resume, without exposing provider-private fields above the existing adapter seam.
- [x] 5.6 Prove activation performs no publication write and sends no publish frame, and that the ledger check precedes root creation rather than following it.
- [ ] 5.7 Add native and TypeScript tests proving prepare never creates a workload process object and activation never runs a workload that failed a membership proof.

## 6. Guardian Lifecycle, Membership Events, and Exact Empty

- [x] 6.1 Implement the guardian's completion-port reader with a closed message vocabulary, a monotonic sequence, and per-process-id correlation for new-process, exit, abnormal-exit, and active-process-zero messages.
- [x] 6.2 Implement root-exit observation that waits on the root handle to completion before reading the exit status, and encodes it as an exact unsigned value with a null signal branch, recorded exactly once.
- [x] 6.3 Implement exact-empty emission solely from the active-process-zero message with a complete event history, recording the accounting active-process count alongside it as corroboration only, and never as the oracle.
- [x] 6.4 Reject the total-process accounting field as an emptiness input and add a guard that the corroboration reads the active-process field.
- [x] 6.5 Implement the durable event journal with `prepared`, `activated`, `root-exited`, and `exact-scope-empty` records, a monotonic sequence, and a durably flushed terminal record written before the guardian exits and before the last handle closes.
- [x] 6.6 Classify missing, duplicated, reordered, or unexplained membership messages as `event-gap`, and a broken port or dead guardian as `control-loss`; prove neither can be rewritten as exact empty.
- [ ] 6.7 Implement guardian unexpected-death classification using the last-handle destruction rule plus the sole-handle attestation and identity proof, returning exact empty only when that proof completes and retained uncertainty otherwise.
- [ ] 6.8 Add native state-machine tests for activation replay, root-status corruption, descendant survival, final-member races, nested-authority lifecycle, guardian death, event gaps, and terminal-record crash points.

## 7. Recovery, Inspect, Abort, Terminate, and Durable Publication

- [x] 7.1 Implement the Windows provider factory, exact descriptor, prepare result, runtime opener, and common outcome mapping, without registering it as a production ProcessScope default.
- [x] 7.2 Implement private-reference creation and decoding with native-generated random scope id, generation, and both capabilities; the TypeScript layer validates and preserves the attested values and MUST NOT generate or backfill them.
- [x] 7.3 Implement replacement reopen in the required order: verify envelope, version, and boot identity; derive the endpoint from the trusted root and bound scope id; open the guardian; read its birth identity; connect the endpoint with identification-level impersonation only; verify the serving process id and owner identity.
- [x] 7.4 Implement the mandatory post-open reread of the complete identity tuple and require it to be unchanged before any observation or control; a differing reread returns `identity-drift` with no control issued.
- [x] 7.5 Implement the recovery classification table distinguishing live-and-stable, absent-with-terminal-record, absent-without-record, identity reuse, endpoint drift, boot drift, authentication failure, and malformed reference, so that none of them collapses into another.
- [x] 7.6 Implement inspect for prepared, published, live, root-exited, exact-empty, and retained states using the guardian journal and control results rather than process enumeration or task listing.
- [x] 7.7 Implement prepared and published abort that never creates a root, destroys the authority, and returns exact empty only when the authority reports empty, preserving uncertainty for interrupted proof.
- [x] 7.8 Implement activated termination with an optional bounded non-authoritative graceful step, then authority-wide forced termination, with the bounded re-terminate loop that re-applies force on any new-process message until the authority reports empty or the phase deadline expires.
- [x] 7.9 Prove termination never enumerates or signals individual descendants and never invokes task-listing, process-tree, snapshot, management-instrumentation, or console-control mechanisms.
- [x] 7.10 Implement the concrete trusted Windows publication ledger and the existing common publisher callback with canonical reference reconstruction, exact binding/generation/operation/launch validation, atomic replace with file and directory flushing, bounded recovery, trusted-root ownership and reparse rejection, and acknowledgement only after commit.
- [x] 7.11 Keep helper-native state as inert and map it to prepared or published only through the exact ledger; require the same ledger proof inside `ProviderPreparedAuthority.activate()` and never add a hidden publish frame or publication write to activate.
- [x] 7.12 Close the unchanged common conformance suite and the provider mutation snapshot for the Windows adapter, keeping Windows-specific fault injection outside the production factory and outside the shared suite, guarded by the spec and suite hash assertions from 1.2.

## 8. Actual-Windows Kernel Gate

This section runs natively on the Windows host. **No task here may be closed on environment-unavailability grounds**, and every task records the helper digest, the crate source digest, the OS build, the toolchain, and the exact command. Each task's oracle also owes its discrimination proof in Section 9.

- [x] 8.1 Build the helper natively with the pinned toolchain and locked dependencies into an isolated output root, verify manifest length, digest, source digest, and compiler, and execute the built artifact on this kernel.
- [x] 8.2 Run and record the successful prepare oracle: unnamed Job created, exact limit mask read back, completion port associated on an empty Job, endpoint created as a first instance with the expected owner, guardian ready, and no workload process in existence.
- [x] 8.3 Run and record suspended assign-before-run: the root is created suspended and already a member, the membership event arrives for that exact process id before the resume, and the workload's first observable side effect occurs only after the resume.
- [x] 8.4 Run and record a real breakaway attempt from inside the authority and prove the operating system refuses to create the escaping process.
- [x] 8.5 Run and record detached, new-console, new-process-group, and double-forked descendants surviving their parents, and prove each remains a member and is reached by authority-wide termination without identifier enumeration.
- [x] 8.6 Run and record a real nested Job Object created by a member with live descendants inside it, and prove outer membership, outer termination reach, and that outer exact empty cannot be reported while nested members live.
- [x] 8.7 Run and record root exit with a live detached descendant, proving `root-exited` with exactly one non-null status branch while emptiness stays pending.
- [x] 8.8 Run and record exit-status fidelity on the real kernel for a normal code, a high-bit status, a status equal to the still-running sentinel, and an authority-forced termination, proving exact unsigned values, a null signal branch, and no misreport of an exited root as live.
- [x] 8.9 Run and record exact natural empty driven by the active-process-zero message with a complete event history, and record the accounting corroboration alongside it.
- [x] 8.10 Run and record recursive forced termination against a workload that creates processes continuously during teardown, proving the bounded re-terminate loop converges on the authority's own empty event and that deadline expiry retains `timeout` rather than reporting empty.
- [x] 8.11 Run and record guardian forced death while members are live, proving the operating system destroys the authority and terminates every member, and that the provider reports exact empty only through the last-handle rule with its attestation.
- [x] 8.12 Run and record controller replacement while the authority is live: a fresh process authenticates the endpoint and guardian birth identity, rereads the full tuple after opening handles, then inspects and terminates the same authority.
- [x] 8.13 Run and record identity-drift mutations on the real kernel — reused guardian identifier with a different birth identity, endpoint served by a different process, wrong endpoint owner, injected boot-identity change, and tuple change between pre-open and post-open reads — proving no destructive operation targets a replacement or unrelated process.
- [x] 8.14 Run and record prepared abort, published abort, and the two publication crash windows (commit-before-acknowledgement, acknowledgement-before-activate) with real process replacement, proving the ledger reports published-inert while no workload root has ever been created.
- [x] 8.15 Run and record every enumerated unavailable configuration reachable on this host, and for each unreachable one state precisely why it is unreachable and which entry points were enumerated before that verdict; a verdict may not be generalised from a single probe or validated against design prose instead of the consuming code.
- [x] 8.16 Run and record the proxied-creation boundary: a member asks a pre-existing out-of-authority service to create a process, the created process is demonstrably outside the authority, and the provider neither claims nor counts it while its exact-empty receipt stays exact for actual members.
- [x] 8.17 Publish an actual-Windows gate summary naming every command, receipt, helper digest, source digest, and limitation, and leaving arm64 runtime, distribution/install, packaging-matrix, closure, and ECP-8 gates explicitly open.

## 9. Oracle Discrimination and Anti-Vacuity Gate

Every task in this section produces a RED/GREEN pair. A green assertion with no demonstrated failing counterpart does not close its gate.

- [x] 9.1 Demonstrate RED for breakaway containment by enabling the breakaway permission on the Job and showing a descendant successfully creating a process outside the authority.
- [x] 9.2 Demonstrate RED for the sole-handle invariant by duplicating the Job handle into a second process, killing the guardian, and showing descendants surviving — proving the guardian-absence exact-empty inference is load-bearing rather than incidental.
- [x] 9.3 Demonstrate RED for completion-port ordering by associating the port after the first member exists and showing the membership event history becomes incomplete.
- [x] 9.4 Demonstrate RED for the wait-before-status rule by reading the exit status without a completed wait and showing an exited root misreported as running, and RED for status fidelity by sign-extending or truncating a high-bit status.
- [x] 9.5 Demonstrate RED for the post-open reread by skipping it and showing that a target that changed identity between lookup and use would be acted upon.
- [x] 9.6 Prove that every hand-declared foreign item from 3.2 is exercised by at least one real call against the real kernel, and record any item that is not; an unexercised declared item leaves its dependent gate open.
- [x] 9.7 Audit which production types and factories are crossed only by a recording stand-in, an injected fixture, or a testing-only variant — including the TypeScript production assembly factory — and record the answer per module rather than in aggregate; each uncovered production entry point leaves its dependent gates open.
- [ ] 9.8 Run production code directly against the real kernel with no test harness in the loop, exercising prepare, activate, inspect, terminate, abort, and recovery end to end, and record what that run found that no test found.
- [x] 9.9 For every acceptance row that records observed behaviour, state separately what the contract requires and show the assertion discriminates between the two; remove or rewrite any assertion that merely restates current behaviour.
- [x] 9.10 Record asserting-test counts separately from headline suite counts, name every gated or early-returning test entry point, and bind every count and receipt to the helper digest and crate source digest that produced it; artifact byte length is not a change signal.

## 10. Build, Package, and Cross-Architecture Evidence

- [x] 10.1 Add a locked Windows-provider build script with an isolated build root, native export and staging seams, deterministic manifest ordering, compiler provenance, and a source digest computed with the existing convention including the trailing NUL after each file's contents (`scripts/build-linux-process-authority.mjs:115`).
- [x] 10.2 Add package inclusion for the Windows helper and its manifest plus the exact provider entry, without changing the legacy ProcessCapsule package shape.
- [x] 10.3 Add package resolver tests for missing, foreign-platform, wrong-architecture, future, wrong-mode, wrong-capability, wrong-length, wrong-digest, wrong-source, reparse-point, path-escape, insecure-permission, runtime-compile, download, path-search, shell, and legacy-helper fallback mutations.
- [ ] 10.4 Add Windows arm64 cross-build and package-shape evidence using Node path APIs and the installed Rust target, labelling every such result non-runtime and leaving the arm64 runtime gate open.
- [x] 10.5 Add a Windows CI job that builds the provider natively and runs the non-interactive portion of the actual-kernel matrix, reporting any runner-policy restriction as an open gate rather than a pass.
- [x] 10.6 Verify the existing ProcessCapsule build, manifest, package, provenance, native, replacement, migration, and deadline tests remain unchanged in meaning until closure owns atomic migration.
- [x] 10.7 Verify no file under `native/linux-process-authority/**` or `rasen/changes/ecp-linux-process-authority-provider/**` changed, and that the recorded frozen source digest still matches.

## 11. Verification, Review, and Closure Handoff

- [ ] 11.1 Run focused TypeScript typecheck and unit/integration suites for the descriptor, codec, resolver, lifecycle mapping, provider adapter, publication ledger, shared conformance, native helper, package, and failure mutations.
- [ ] 11.2 Run native `cargo fmt --check`, locked build/check/test, dependency and license accounting, protocol bounds and fuzz tests, and source/artifact provenance checks.
- [ ] 11.3 Run the complete Section 8 actual-Windows matrix fresh and verify every receipt refers to a real process on this kernel and is bound to the current helper digest and crate source digest rather than a stale build.
- [ ] 11.4 Run the complete Section 9 discrimination matrix fresh and verify every oracle has a recorded failing counterpart; leave unchecked any gate whose RED was not produced.
- [ ] 11.5 Run an independent security review focused on Job handle ownership and non-inheritance, inherited-handle restriction, endpoint DACL and impersonation level, endpoint squatting, reference and capability secrecy, identity revalidation before destructive control, trusted state-root ownership and reparse rejection, ledger durability, and hand-declared FFI struct layouts; resolve every Blocker and Major.
- [ ] 11.6 Run an independent spec/implementation review and mutation audit proving every requirement and scenario is covered, the common spec and suite hashes are unchanged, the recovered inert phase comes only from the authentic publication ledger, activate contains no publish side effect, and no process-group, process-tree, task-listing, or sampled-count claim remains in the new provider.
- [ ] 11.7 Run strict Change validation and targeted regression, build, and package gates proportional to touched code, recording exact commands, asserting counts, environment exceptions, and zero hidden skips.
- [ ] 11.8 Produce the closure handoff with the exact provider tuple, reference and protocol versions, manifest and artifact paths, runtime opener, actual evidence links, retained limitations, the demonstrated proxied-creation boundary, and the explicit remaining closure and ECP-8 gates; do not switch defaults or claim Windows release support in this Change.
- [ ] 11.9 Run local ship only after every implementation, actual-kernel, discrimination, verification, and review task above is complete; create a path-scoped child commit with no push, no child PR, no production-default switch, and no unrelated retained file.
- [ ] 11.10 Immediately archive the locally shipped child through the authoritative archive engine, sync its delta spec, and record the real transaction and accounting result rather than deferring child archive to ECP-8.
- [ ] 11.11 Return terminal Windows evidence to the ECP-7 parent only after real local ship and archive; keep macOS decision-deferred, keep arm64 runtime open, and do not resume native closure or claim release support.
