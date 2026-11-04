# Linux Process-Authority TypeScript Review — Round 1

STATUS: DONE_WITH_CONCERNS

Verdict: **FAIL — 2 Blockers, 4 Majors, 2 Minors.** The focused suite is green, but publication provenance can be bypassed, the exported provider is still an injection-only adapter rather than a concrete Linux authority, and multiple durability/canonical/artifact invariants have reproducible false positives.

## Scope and review basis

- Product: `src/core/session-host/process-authority/linux/**`
- Tests: `test/core/session-host/linux-process-authority-*.test.ts`, `test/helpers/linux-process-authority-provider-fixture.ts`
- Shared-suite dependency read only to determine evidence meaning: `test/helpers/process-authority-provider-conformance.ts`
- Change contract: `proposal.md`, `design.md`, `specs/linux-process-authority-provider/spec.md`, `tasks.md`
- Frozen common contract: `rasen/specs/process-authority-provider/spec.md` (the archived foundation/prepare-unavailability result consumed by the boundary hash)
- No product, test, task, or run-state file was modified.

Scope check: **REQUIREMENTS MISSING.** The delivered TypeScript files provide descriptors, codecs, an injectable mapper, a filesystem ledger, and an artifact inspector. They do not yet provide a production-native transport/runtime composition that can establish the advertised Linux authority.

## Blockers

### B-001 — A subclassed ledger can acknowledge publication and authorize activation without one durable write

- Locations: `src/core/session-host/process-authority/linux/publication-ledger.ts:49`, `:323-337`, `:514-523`; `src/core/session-host/process-authority/linux/provider.ts:294-309`, `:346-355`.
- Contract: Linux spec `:49-75` requires one concrete trusted ledger, commit-before-ack, and exact ledger verification before activation. Design `:70-82` explicitly rejects a structurally similar caller object as publication truth. Common spec `:56-85` requires durable publication before the one activation capability.
- Failure/exploit chain:
  1. `LinuxAuthorityPublicationLedger` adds every constructed instance to `authenticLedgers`, including subclass instances.
  2. `createLinuxAuthorityPublicationPublisher()` checks only `WeakSet.has()` and then invokes the virtual `ledger.commit()` method.
  3. A subclass can override `commit()` as a no-op and override `requirePublished()` to return `published-inert`.
  4. The publisher returns the common acknowledgement even though the ledger root is empty; provider activation trusts the same overridden method and calls native `activate()`.
- Fresh probe: `SUBCLASS_LEDGER {"accepted":true,"overrideCalls":1,"rootEntries":[]}`.
- Impact: publish-before-activate is bypassable at the TypeScript authority seam. The exact ledger provenance claim and durable crash-recovery fact are both false.
- Minimum fix direction: make the ledger a non-subclassable/non-overridable opaque capability. Reject any non-exact prototype/new-target, freeze the prototype, and invoke module-private operations rather than virtual instance methods. The provider must capture and call the same private ledger capability used by the publisher; do not call overridable `lookup`/`requirePublished` methods from activation.

### B-002 — The only exported “production” provider factory accepts arbitrary structural native truth

- Locations: `src/core/session-host/process-authority/linux/provider.ts:58-98`, `:174-200`, `:238-325`, `:327-430`, `:433-450`; `test/core/session-host/linux-process-authority-provider.test.ts:78-150`, `:184-215`; `test/helpers/linux-process-authority-provider-fixture.ts:71-166`.
- Contract: Linux spec `:25-47`, `:141-167`, and `:223-233` requires complete native construction/revalidation and exact adjacent artifact identity before `prepared-inert`; tasks `4.6`, `6.1-6.4`, and `6.8` require the production TypeScript primary adapter and replacement reopen. Design `:62`, `:122`, and `:148` requires native identity proof and says injected fault dependencies must not be selectable by the production factory.
- Failure chain:
  1. `createLinuxPrimaryProcessAuthorityProviderBundle()` accepts any object with five methods as `transport`, any object with `open()` as `runtimeOpener`, and caller-provided 64-hex strings as artifact identity.
  2. No product implementation under `src/` constructs a native transport, invokes the artifact resolver, binds an opened helper, or performs pidfd/namespace reopen. Repository search finds only test fakes as consumers.
  3. A structural transport can mint generation/control capabilities, attest arbitrary Linux identity, report `live`/`exact-scope-empty`, and be registered under the exact Linux descriptor. The TypeScript layer checks shapes, not that the facts came from the resolved Linux helper.
  4. Artifact resolution failure therefore cannot become typed selected-provider `authority-unavailable` on this factory path; the resolver and provider are disconnected.
- Impact: an exact manifest tuple currently selects a caller-supplied oracle, not an established Linux authority. The advertised platform provider is missing on the common path even though unit/conformance tests can be green.
- Minimum fix direction: split a non-exported injectable test constructor from one exported production factory. The production factory must resolve and pin the exact artifact, create the closed native transport/runtime bridge itself, own replacement revalidation, and map resolver/prerequisite denial to typed unavailable. Brand or otherwise close the production transport/opener so structurally similar objects cannot enter that factory.

## Majors

### M-001 — Private-reference decoding accepts non-canonical aliases of the same native capability

- Location: `src/core/session-host/process-authority/linux/private-reference.ts:95-110`, `:146-184`, `:228-273`.
- Contract: common spec `:29-42` says field-order changes are non-dispatchable; Linux spec `:141-167` requires fresh, canonical, integrity-bound references. Design `:72-80` depends on deterministic canonical encoding for the full-reference ledger digest.
- Failure chain: decode derives the integrity preimage and the later “canonical” body in the order received. Reordering all preimage keys, recomputing the unkeyed digest, and placing the two integrity keys last produces different provider-reference bytes that decode to the same generation and control capability. A newly encoded outer reference then has a different full-reference/ledger digest for the same native authority, splitting lifecycle and replay identity.
- Fresh probe: `CANONICAL_REORDER {"differentBytes":true,"accepted":true}`.
- Minimum fix direction: serialize and validate against one fixed key order. Rebuild the preimage from `PRIMARY_KEYS` plus the exact broker extension order, hash that canonical serialization, rebuild the complete body in the fixed order, and require byte-for-byte equality with the decoded UTF-8 input.

### M-002 — Loss of a committed publication record silently rolls phase backward

- Locations: `src/core/session-host/process-authority/linux/publication-ledger.ts:382-409`, `:412-443`; `src/core/session-host/process-authority/linux/provider.ts:359-379`.
- Contract: Linux spec `:49-75` requires replacement recovery to preserve exact published inert truth and forged/unavailable/malformed/ambiguous ledger state to retain. Common spec `:87-113` requires lifecycle facts to remain distinct and replacement recovery to preserve the exact inert phase.
- Failure chain:
  1. Publication commits and acknowledges `published-inert`.
  2. The sole `<digest>.entry` is deleted or lost.
  3. `#readRecord()` maps `ENOENT` to `undefined`; `lookup()` always maps `undefined` to `prepared-inert`.
  4. Replacement inspection of native `inert` reports `prepared-inert`, indistinguishable from a never-published generation.
- Fresh probe: after a real publisher commit, deleting the committed entry produced `DELETED_PUBLICATION {"state":"prepared-inert"}`.
- Impact: recovery is not phase-monotonic and durable publication loss is hidden rather than retained as uncertainty/event gap.
- Minimum fix direction: persist an independently durable generation/head record at preparation or use an append-only authenticated phase journal so “never published” and “published record missing” are distinguishable. Once any durable phase reaches published, absence/corruption must never map to prepared.

### M-003 — Artifact integrity is self-authored and execution is not bound to the inspected bytes

- Locations: `src/core/session-host/process-authority/linux/artifact-resolver.ts:55-66`, `:135-185`, `:187-232`, `:235-253`; `test/core/session-host/linux-process-authority-artifact-resolver.test.ts:101-125`.
- Contract: Linux spec `:223-233` requires exact source-owned identity, wrong source/hash/mode/symlink rejection, and no alternate artifact. Design `:52` and `:161-165` requires exact companion provenance and modes.
- Failure/exploit chain:
  1. Inspection takes no trusted expected hash/source/compiler identity; it only checks that the companion manifest contains syntactically valid values.
  2. Replacing both helper and adjacent manifest with a self-consistent pair passes and is labelled `package-integrity`. The “wrong source” test mutates the digest to the malformed string `future`; it never tries a different valid 64-hex digest.
  3. Hashing and mode checks are pathname-based and the resolver returns only a path. The helper can be swapped after hashing and before a later spawn. No fd/device/inode is pinned.
  4. Runtime mode compares `mode & 0o777`, so setuid/setgid bits are ignored; `04755`/`02755` satisfy the apparent `0755` check.
- Fresh probe: a replacement helper plus self-authored valid manifest produced `SELF_AUTHORED_MANIFEST {"accepted":true,"classification":"package-integrity"}`.
- Minimum fix direction: require build-pinned expected artifact/source identity from a trust root outside the companion file; validate package-root and file ownership; open with no-follow semantics, `fstat` and hash the same handle, compare full relevant mode bits, and execute the pinned file descriptor or revalidate exact dev/inode/hash atomically at launch.

### M-004 — Ledger “trusted root” validation does not pin or isolate the filesystem authority

- Locations: `src/core/session-host/process-authority/linux/publication-ledger.ts:293-320`, `:340-409`, `:456-505`.
- Contract: design `:72` and `:82` requires trusted-root ownership, file type, bounds, and a state root unreachable from workload authority; tasks `6.9` requires trusted-root ownership and bounded recovery.
- Failure chain: only the leaf root is `lstat`-checked. Existing mode `0755` is accepted, ancestors are not checked, the canonical real path/device/inode is not retained, and every later operation reopens by pathname. A process able to rename/replace the parent or same-UID leaf can substitute another owner/mode-valid directory, delete a committed entry (triggering M-002), or install a recomputed unkeyed record. The class API accepts any absolute path, so the intended workload-inaccessible root is not enforced.
- Impact: filesystem ownership is being used as publication authenticity without proving stable directory identity or workload isolation.
- Minimum fix direction: create/validate the provider-owned root from an approved host state root; validate every relevant ancestor, exact owner and restrictive mode; pin realpath plus dev/inode or hold a directory fd; perform fd-relative no-follow operations; ensure the workload mount namespace cannot reach the root.

## Minors

### m-001 — Root-exit mapper accepts impossible Linux statuses as exact facts

- Location: `src/core/session-host/process-authority/linux/outcomes.ts:71-80`.
- Failure chain: any non-negative safe integer is accepted as an exit code and any `SIG` plus uppercase alphanumerics is accepted as a signal. Corrupt values such as code `9007199254740991` or `SIGNOTREAL` become exact `root-exited` rather than retained protocol loss.
- Minimum fix direction: use the closed native protocol’s exact exit-code bound and signal enum (or validated signal number-to-name map); reject every other value as control loss/event gap.

### m-002 — Launch snapshot leaves command/cwd and environment-map boundary gaps

- Location: `src/core/session-host/process-authority/linux/provider.ts:107-171`.
- Failure chain: `command` and `cwd` are checked for absolute shape but not NUL or length; the copied environment uses `{}`, so an own `__proto__` key is not faithfully snapshotted. Direct provider use can therefore pass over-bound/NUL paths or silently change the launch snapshot before native decoding.
- Minimum fix direction: apply explicit command/cwd byte/character bounds and NUL rejection, validate environment names (including `=`), and copy into a null-prototype record before freezing and hashing.

## Conformance and verification truth

- The boundary hash and import are real: `linux-process-authority-boundary-guards.test.ts:7-41` pins the accepted common spec and the shared suite, and `linux-process-authority-conformance.test.ts:3-16` invokes that unchanged suite.
- The result is **provider-neutral/injected adapter evidence only**, exactly as common spec `:196-217` warns. The Linux fixture fabricates native attestation/outcomes in TypeScript (`test/helpers/linux-process-authority-provider-fixture.ts:84-146`), hard-codes external facts (`:186-191`), and ignores its `_mutation` parameter (`:71-73`). It does not cross an artifact, native protocol, pidfd, namespace, or kernel boundary. It must not close actual-Linux acceptance or compensate for B-002.
- Focused command:

  `pnpm exec vitest run test/core/session-host/linux-process-authority-contract.test.ts test/core/session-host/linux-process-authority-boundary-guards.test.ts test/core/session-host/linux-process-authority-conformance.test.ts test/core/session-host/linux-process-authority-provider.test.ts test/core/session-host/linux-process-authority-publication-ledger.test.ts test/core/session-host/linux-process-authority-artifact-resolver.test.ts`

- Result: **6 files passed, 71 tests passed, 0 failed**.
- Fresh temporary probes wrote no repository files and cleaned their validated OS-temp roots.

## Verified clean points

- Exact primary/broker descriptor ids are distinct and the selected-provider path itself contains no automatic fallback.
- Typed `prepare-unavailable` is isolated from thrown/malformed native results at the adapter mapping boundary.
- Activation normally checks the ledger before calling transport and contains no hidden publication write.
- Native diagnostic strings are reduced to a closed generic code projection; private-reference diagnostics do not expose PID, namespace inode, capabilities, or broker token.
- Root-exit code XOR signal shape and exact-key checks reject null/null, code+signal, and extra-field variants.

## Required disposition

Do not mark the TypeScript provider, shared provider-conformance gate, or Linux Change terminal. Route B-001/B-002 to a non-reviewer fixer first, then address M-001 through M-004 and add regression probes for every reproduced chain before fresh independent re-review.
