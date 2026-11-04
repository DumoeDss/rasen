# Linux process-authority TypeScript review fix — round 1

## Scope and disposition

- Fix target: `evidence/review-report-ts-round-1.md`.
- Owned product surface: `src/core/session-host/process-authority/linux/**`.
- Owned test surface: the six `linux-process-authority-*.test.ts` files and the Linux provider fixture.
- No common provider, native Rust, task checkbox, run-state, host/closure, package/release, Windows, macOS, or legacy ProcessCapsule file was edited by this fix unit.
- Disposition: both Blockers, all four Majors, and both Minors have code and regression-test fixes. Actual-Linux and package/release acceptance remain separate evidence gates; this report does not relabel Windows execution as Linux kernel proof.

## TDD review-fix receipts

The reproduced chains were first installed as focused regressions and observed failing against the reviewed implementation:

1. `B-001`: a subclassed ledger could be constructed and could forge publish/activation truth without a write.
2. `M-002`: deleting a committed entry mapped native inert back to `prepared-inert`.
3. `M-004`: replacing the ledger pathname with a new directory, or supplying an existing non-private root, was accepted.
4. `M-001`: reordered private-reference keys plus a recomputed integrity digest decoded successfully.
5. `m-001`: exit code `256` and `SIGNOTREAL` became exact root-exit facts.
6. `m-002`: over-bound/NUL launch paths and malformed environment names reached native; a null-prototype `__proto__` entry was not preserved faithfully.
7. `M-003`: a replacement helper plus a self-consistent adjacent manifest was accepted as package integrity.
8. `B-002`: the public factory still expected caller-supplied transport/runtime/artifact truth rather than a source-owned state root.

Each focused test was then made green before the aggregate gates below were run.

## Finding-by-finding closure

### B-001 — exact non-virtual publication capability

- `LinuxAuthorityPublicationLedger` rejects non-exact `new.target`, records exact instances in a module-private `WeakSet`, freezes each instance, and freezes the prototype.
- Publisher commit and provider lookup are captured through module-private accessors that apply the frozen exact prototype methods. Production activation and inspection no longer call virtual methods on a caller-visible ledger object.
- The publisher acknowledges only after the exact commit path returns.

### B-002 — source-owned production assembly

- The public primary factory now accepts only `{ stateRoot }`; extra dependency-injection keys are rejected.
- The old structural adapter was renamed to an internal test-only constructor and is not re-exported from the Linux package index.
- The production factory owns the private runtime/publication directories, concrete ledger, package-root/artifact resolution, pinned helper identity, RPA1 request/response codec, one-shot control transport, and persistent runtime bridge.
- The helper is executed from the already verified descriptor through `/proc/self/fd/3`; PATH, shell, download, runtime compilation, and caller-selected executable paths are absent.
- Missing/untrusted package material becomes selected-provider typed prepare unavailability. The separately selected broker factory remains fail-closed until the authenticated broker installation/client gate is supplied; it is not an automatic fallback.

### M-001 — one canonical private-reference serialization

- Decode rebuilds primary fields and broker extensions in their fixed source-owned order, hashes that canonical preimage, rebuilds the complete body in fixed order, and requires byte-for-byte equality with the decoded bytes.
- A reordered but self-consistent alias is rejected.

### M-002 — phase-monotonic durable publication

- Commit durably installs an independent generation publication-head before the final publication entry.
- A missing entry with an exact head is `authority-uncertain/ledger-missing`, never `prepared-inert`; missing/malformed/conflicting head state is retained.
- Idempotent commit repairs an absent exact head before returning. Head creation uses exclusive hard-link installation rather than a replacing rename, and UUID-shaped crash temporaries are provenance-checked and reconciled.

### M-003 — trust root and inspected-byte execution identity

- Artifact inspection now requires one canonical package-root trust record outside the adjacent companion manifest and binds exact relative path, arch, mode, provider/protocol/reference tuple, length, artifact/source hashes, and compiler identity.
- Package root, trust, manifest, and helper ownership/write modes are validated. A self-authored helper+companion pair no longer passes while package trust remains unchanged.
- On actual Linux, resolution opens with `O_NOFOLLOW`, validates owner and full `0755` mode including special bits, hashes and re-stats the same descriptor, returns dev/inode identity, and production execution uses that pinned descriptor.
- Linux-only regressions cover pathname replacement after pinning and setuid-mode rejection; they remain classified as Linux-runtime tests and are not counted as Windows kernel evidence.

### M-004 — stable ledger filesystem authority

- The production provider derives the ledger beneath its exact private `0700` host state root and validates the child directory.
- The ledger pins realpath/device/inode. On Linux it also holds an `O_DIRECTORY|O_NOFOLLOW` directory descriptor, validates it on access, and performs entry/head operations through `/proc/self/fd/<directory-fd>` rather than reopening the mutable leaf pathname.
- Root replacement, non-private modes, invalid owner, writable parent, symlink/file-type changes, malformed partials, and over-bound records fail closed.
- Workload namespace/mount reachability remains an actual native construction property and is not inferred from these TypeScript filesystem tests.

### m-001 and m-002 — closed native facts and launch bounds

- Exact root exit is limited to codes `0..255` or the closed Linux signal set; impossible values map to retained protocol loss.
- Command/cwd, args, environment keys/values, counts, NULs, `=`, and UTF-8 byte lengths now match the Rust protocol bounds.
- Environment snapshots use a frozen null-prototype record and byte-order sorting. The launch digest uses the Rust `RPL1` canonical byte encoding.
- Abort duration is derived from the common monotonic deadline with `performance.now()`, not wall-clock time.

## Final verification

- Six Linux TypeScript files: `6` files, `82/82` tests passed.
- Common conformance plus typed prepare-unavailability: `2` files, `51/51` tests passed.
- `pnpm exec tsc --noEmit --pretty false`: passed with no diagnostics.
- Focused Linux ESLint over product, six tests, and fixture: passed with no diagnostics.
- `pnpm exec rasen validate ecp-linux-process-authority-provider --strict --no-interactive`: `Change 'ecp-linux-process-authority-provider' is valid`.

Exact Linux aggregate command:

`pnpm exec vitest run test/core/session-host/linux-process-authority-contract.test.ts test/core/session-host/linux-process-authority-boundary-guards.test.ts test/core/session-host/linux-process-authority-conformance.test.ts test/core/session-host/linux-process-authority-provider.test.ts test/core/session-host/linux-process-authority-publication-ledger.test.ts test/core/session-host/linux-process-authority-artifact-resolver.test.ts`

Exact common command:

`pnpm exec vitest run test/core/session-host/process-authority-prepare-unavailable.test.ts test/core/session-host/process-authority-conformance.test.ts --maxWorkers=1 --minWorkers=1 --reporter=dot`

## Remaining gates outside this fix unit

- Fresh independent TypeScript re-review is still required before review closure.
- Actual WSL/Linux primary receipts, package assembly/trust generation, clean-package execution, broker/cgroup-v2 acceptance, host/ProcessScope closure, and release truth remain governed by their own tasks and evidence.
- macOS/MMAC remains explicitly deferred for a later Direction decision and was not selected or implemented here.
