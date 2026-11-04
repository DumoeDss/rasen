# Linux process-authority TypeScript review fix — round 2

## Scope and verdict target

- Fix target: `evidence/review-report-ts-round-2.md`.
- Owned changes are limited to `src/core/session-host/process-authority/linux/**`, the Linux TypeScript suites, this evidence file, and the existing TypeScript implementer handoff.
- No native Rust, broker service, task checkbox, run-state, host/closure, package/release, Windows, macOS, or legacy ProcessCapsule file was edited.
- Target findings: `M-003` through `M-006`.

## Hostile RED-to-GREEN cases

1. `M-003`: replace helper bytes and write mutually consistent valid alternate artifact SHA-256, source SHA-256, compiler, companion manifest, and the former package trust JSON. The old resolver accepted the self-signed set. GREEN rejects it against a separately supplied test build identity; production has no generated build identity yet and remains unavailable.
2. `M-004`: publish, delete both old publication entry and publication head, then reopen. The old lookup returned `prepared-inert`. GREEN retains `ledger-missing`; deleting the new phase journal as well also retains rather than inventing fresh preparation.
3. `M-005`: construct the production provider twice on the same state root and construct it again in a new Node process. The old unconditional child `mkdir` failed with `EEXIST`. GREEN reopens the exact existing directories after no-follow/type/owner/mode/parent checks.
4. `M-006`: feed `RuntimeReady`, then emit helper close code `0` without root/empty proof. The old bridge left both promises pending. GREEN rejects both and destroys the streams. A second regression covers `RuntimeReady` followed by a truncated trailing frame and clean close.

## Finding closure

### M-003 — build-pinned identity, not mutable package consensus

- Runtime package trust JSON is no longer an authority input.
- `build-authority.ts` contains the compile-time identity table consumed by production resolution. It is deliberately empty because authenticated package generation has not supplied an identity in this worktree.
- Therefore the production factory maps the absent authority to typed selected-provider unavailability; it cannot trust a helper/manifest/trust set merely because all files agree.
- A direct-module, non-index-exported test seam supplies one immutable build identity so package parser and actual-Linux fd tests remain sensitive without giving production a caller-selected oracle.
- The build identity binds relative artifact path, arch, provider mode/id, protocol/reference versions, length, artifact SHA-256, source SHA-256, and compiler identity. Valid alternate 64-hex hashes/source values and compiler text are rejected.
- Packaging must generate the compile-time table from authenticated release inputs. Until it does, this TypeScript layer intentionally does not claim a usable production artifact.

### M-004 — durable preparation/phase truth and workload path exclusion

- Every successful provider prepare now durably records an exact identity-bound `prepared` phase before returning its preparation capability.
- Publish appends the exact `published` phase after the independent head and entry are durable. Recovery recognizes prepared only from the phase journal; absence is retained `ledger-missing`, including removal of entry, head, and phase journal.
- This separates a real fresh preparation from a recovered reference with erased evidence. Unknown/no-record references are never optimistically classified as prepared.
- Production validates the state-root leaf with full `0700` bits and validates the complete ancestor chain for exact directory type, owner (current host identity or root), no special bits, and no group/world write.
- The publication ledger now lives beneath `runtimeRoot`. The source-owned native guardian overmounts that exact root with a mode-000 tmpfs inside the workload mount namespace before activation, so the sibling mapped workload UID cannot reach publication state. Host controls continue to use the original mount namespace and pinned ledger directory fd.
- Prepared phase is verified across a new ledger instance; published evidence loss is retained across replacement.

### M-005 — idempotent exact reopen

- Production child directories use create-or-open semantics: only `EEXIST` is accepted, followed by exact non-symlink directory, full mode, owner, real parent, and realpath validation.
- Same-process and fresh-Node-process factory reconstruction both reopen the same state root successfully.
- Structural dependency injection remains rejected before assembly.

### M-006 — closed runtime settlement

- Runtime bridge state now tracks readiness, root settlement, exact-empty settlement, failure, and buffered bytes.
- Close before both terminal facts, any nonzero close, or any truncated pending frame rejects every unsettled promise and destroys stdin/stdout/stderr regardless of whether `RuntimeReady` was observed.
- Exact empty without a prior root-exit observation rejects the root promise instead of leaving it pending.
- The deterministic protocol-liveness seam is direct-module test-only and absent from the Linux public index; production still creates the child from the pinned helper descriptor.

## Verification receipts

- Linux TypeScript aggregate: `6` files, `87/87` tests passed.
- Common conformance plus typed prepare-unavailability: `2` files, `51/51` tests passed.
- `pnpm exec tsc --noEmit --pretty false`: passed with no diagnostics.
- Focused ESLint over Linux product, six Linux suites, and fixture: passed with no diagnostics.
- `pnpm exec rasen validate ecp-linux-process-authority-provider --strict --no-interactive`: `Change 'ecp-linux-process-authority-provider' is valid`.

Exact Linux aggregate command:

`pnpm exec vitest run test/core/session-host/linux-process-authority-contract.test.ts test/core/session-host/linux-process-authority-boundary-guards.test.ts test/core/session-host/linux-process-authority-conformance.test.ts test/core/session-host/linux-process-authority-provider.test.ts test/core/session-host/linux-process-authority-publication-ledger.test.ts test/core/session-host/linux-process-authority-artifact-resolver.test.ts`

Exact common command:

`pnpm exec vitest run test/core/session-host/process-authority-prepare-unavailable.test.ts test/core/session-host/process-authority-conformance.test.ts --maxWorkers=1 --minWorkers=1 --reporter=dot`

## Truth boundary

- These receipts close the reported TypeScript defects; they are not actual-Linux kernel or clean-package execution evidence.
- The empty build authority is intentional fail-closed state, not packaging completion.
- Fresh independent TypeScript re-review remains required. Actual Linux, authenticated package generation, broker/cgroup-v2, ProcessScope closure, release, and deferred macOS/MMAC decisions remain separate gates.
