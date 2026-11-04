# Linux Process-Authority TypeScript Review - Round 2

STATUS: DONE_WITH_CONCERNS

Verdict: **FAIL - 4 Majors, no Blockers or Minors.** B-001, B-002's structural-injection defect, M-001, M-002's single-record-loss case, m-001, and m-002 are closed. M-003 and M-004 remain materially open, and the production assembly adds two replacement/runtime-liveness defects.

## Scope and review basis

- Fresh delta review of `src/core/session-host/process-authority/linux/**`, the six Linux TypeScript suites, and `test/helpers/linux-process-authority-provider-fixture.ts`.
- Contract basis: the accepted common process-authority spec plus this Change's design and Linux provider delta spec.
- Review mode was report-only. No product, test, task, run-state, or commit was changed.
- The two files authored by this review are this report and `handoff/reviewer-ts-2.md`.

## Original finding disposition

| Finding | Disposition | Evidence |
|---|---|---|
| B-001 ledger override can forge publication | **CLOSED** | Exact `new.target`, exact-prototype/WeakSet checks, frozen instance/prototype, and module-private `Reflect.apply` paths reject subclass and prototype mutation. Fresh probe: `subclassRejected=true`, `prototypeMutationRejected=true`; no forged publisher or activation capability can be constructed. |
| B-002 exported provider is caller-injected structural truth | **CLOSED for the original chain** | The public index exports only `{ stateRoot }` production factories. Extra transport/runtime keys are rejected before construction; the primary factory owns resolver -> pinned descriptor -> native transport/runtime. The direct-module `ForTesting` seams are absent from `linux/index.ts`. A separate replacement construction defect is M-005 below. |
| M-001 reordered private-reference alias | **CLOSED** | Decode rebuilds one fixed-order preimage/body and compares exact bytes. Fresh hostile alias with reversed keys and recomputed SHA-256 was rejected. |
| M-002 committed entry deletion rolls back to prepared | **CLOSED for one-entry loss** | An independent publication head retains missing-entry recovery as `authority-uncertain/ledger-missing`. Fresh probe after deleting only `<digest>.entry`: `{"state":"authority-uncertain","diagnosticCode":"ledger-missing"}`. End-to-end durability remains exposed by M-004 if an untrusted same-UID workload can delete both files. |
| M-003 artifact identity is self-authored/path-only | **PARTIAL - Major remains** | FD/dev/inode/full-mode/TOCTOU execution pinning is implemented, but the new trust record is mutable alongside the helper and companion manifest; see M-003 below. |
| M-004 ledger root is not pinned or isolated | **PARTIAL - Major remains** | Leaf realpath/dev/inode and Linux dirfd pinning are implemented. Ancestor/workload isolation and a non-workload-writable phase root are not established; see M-004 below. |
| m-001 impossible root status accepted | **CLOSED** | Exit codes are `0..255`; signals use the closed Linux set. The regression exercises valid-shape impossible values and maps them to retained control loss. |
| m-002 launch boundary gaps | **CLOSED** | Path/count/per-value bounds match Rust, NUL/`=` are rejected, the environment is a frozen null-prototype record, and the RPL1 digest encoding matches the native BTreeMap order. |

## Majors

### M-003 - The package trust file is still self-authored by the same mutable authority

- Locations: `artifact-resolver.ts:118-126`, `:161-170`, `:224-284`, `:286-325`; production selection at `native-assembly.ts:453-464`.
- Contract: Linux spec `Native artifacts have adjacent integrity and build provenance` requires a source-owned exact helper and rejection of different valid artifact/source identity.
- Failure chain:
  1. `rasen-linux-process-authority.trust.json`, the helper, and the companion manifest are all accepted when owned by the current UID and merely not group/other writable. Owner-writable package files are therefore accepted as the trust root.
  2. A same-UID actor can replace the helper bytes and write matching valid alternate artifact SHA-256, source SHA-256, compiler identity, manifest, and package trust entry.
  3. `inspectLinuxProcessAuthorityArtifact()` returns `package-integrity`; on Linux the later FD pin faithfully pins and executes those attacker-selected bytes. FD pinning closes path-swap TOCTOU but cannot create authenticity for a self-authored expected hash.
- Fresh probe: `{"accepted":true,"result":"package-integrity","sha256":"4ea19b3bb4e820f74f0838cb11eef0273a0396fd93d548e34aecaf15ee3d4e9f","sourceSha256":"bbbb...bbbb"}` after writing all three mutually consistent files.
- Test sensitivity: the new self-consistent replacement test changes only helper + companion manifest and deliberately leaves trust unchanged. The `different valid source` table row likewise changes only the manifest. Both are valid mismatch tests, but neither challenges trust-root authorship.
- Required fix: anchor the expected artifact/source identity in installation authority that the workload/package owner cannot rewrite (for example authenticated root-owned install metadata or a signature rooted outside the mutable package set), and add a regression that rewrites helper + manifest + current trust file with a different valid pair and still rejects.

### M-004 - The durable publication root is pinned but not proven inaccessible to the same-UID workload

- Locations: production root validation `provider.ts:495-530`; ledger root validation `publication-ledger.ts:394-479`; missing-both classification `publication-ledger.ts:692-703`.
- Contract: design `:72` and `:82` requires a trusted host state root that is not reachable from workload authority. Once published, recovery must not become prepared again.
- Failure chain:
  1. The public factory accepts any caller-selected absolute leaf directory owned by the current UID with `(mode & 0777) == 0700`. It does not validate the ancestor chain or full special-mode bits.
  2. The ledger validates only its immediate parent. The directory FD prevents pathname substitution against the host process, but it does not prevent another process with the same mapped UID and path reachability from editing entries inside the pinned directory.
  3. The TypeScript assembly gives native only `runtimeRoot`; it does not establish that sibling `publication-ledger` is hidden from the workload mount namespace. Thus the security property is assumed rather than constructed at this boundary.
  4. If both the publication entry and head are removed, lookup returns `prepared-inert`, recreating the phase rollback that the independent head was meant to prevent.
- Fresh probe after a real commit and deletion of both durable files: `{"afterBothDeleted":{"state":"prepared-inert"}}`.
- The leaf dirfd/device/inode checks and single-entry deletion test are useful and non-tautological, but they do not test ancestor permissions, full `0700` mode, same-UID reachability, or deletion of all phase evidence.
- Required fix: derive the ledger beneath an approved host-owned root with complete ancestor/full-mode validation and explicitly construct workload mount/path exclusion. If workload exclusion cannot be proved, publication phase needs independently authenticated/append-only storage that a workload UID cannot erase into `prepared-inert`.

### M-005 - A production provider cannot reopen an existing state root

- Location: `provider.ts:513-530`, especially unconditional `fs.mkdirSync(directory, { mode: 0o700 })` at `:515`.
- Contract: replacement recovery is an indivisible process-authority semantic; the Change requires a replacement controller to reopen the same reference and durable state.
- Failure chain: the first factory creates `runtime` and `publication-ledger`; every later primary or broker construction on that same `stateRoot` throws `EEXIST` before ledger/native reopen. A normal process replacement therefore cannot even assemble the provider that must inspect or control retained authority.
- Fresh probe: `{"first":true,"second":false,"secondError":"Error: EEXIST: file already exists, mkdir '.../state/runtime'","children":["publication-ledger","runtime"]}`. Structural injection was rejected in the same probe.
- Test sensitivity: the production test constructs the factory exactly once. Its later injected-options assertion fails at exact-key validation before exercising existing child directories, so it cannot detect restart failure.
- Required fix: create-or-open each exact child, then validate no-follow directory type, full mode, owner, parent identity, and expected realpath. Add same-process and replacement-process reopen regressions using the same state root and committed ledger state.

### M-006 - A clean runtime-bridge exit after readiness can leave terminal observations pending forever

- Location: `native-assembly.ts:352-450`, specifically the close handler at `:430-434`.
- Contract: Linux spec `Native transport fails` requires helper exit/socket break before exact terminal proof to become retained `control-loss` or `authority-uncertain`; it must not silently hang the runtime facts.
- Failure chain:
  1. The runtime helper emits `runtimeReady`, so `sawReady=true`.
  2. It then exits with code `0` before a `root-exited` or `exact-scope-empty` frame, or with a truncated trailing frame.
  3. The close handler calls `fail()` only when readiness was absent or the code was non-zero. Both `rootExited` and `exactScopeEmpty` remain unsettled, streams remain open, and the transport loss is never classified.
- No regression exercises a ready-then-clean-premature-close sequence.
- Required fix: track exact terminal/event settlement and buffered-frame completeness. Any close before the required terminal proof must reject every unsettled promise and close/destroy streams regardless of exit code; add a deterministic child-protocol regression.

## Verified clean points and hostile-probe receipts

- Ledger subclass/prototype: rejected before publisher creation; the exact non-virtual capability is effective.
- No durable commit -> no acknowledgement/activation: the original subclass path is unreachable; exact publisher acknowledgement still occurs only after base commit returns.
- Public structural injection: rejected; testing seams are not re-exported by the Linux public index.
- Canonical reorder: rejected even with recomputed digest.
- Published entry deletion: retained as `ledger-missing` while the independent head remains.
- Exact helper execution mechanics: Linux resolution opens `O_NOFOLLOW`, checks full `0755` including special bits, hashes and re-stats the same FD (dev/inode/size/mode), and spawn executes `/proc/self/fd/3` with that FD.
- Root status and launch bounds: closed by code and sensitive tests.
- Production broker: a fresh production broker bundle returned typed `authority-unavailable` (`selected provider prerequisites unavailable`) and the source performs no primary probe or automatic fallback.

## Verification gates

- Focused Linux TypeScript aggregate: **6 files, 82/82 passed**.
- Common conformance + typed prepare-unavailability: **2 files, 51/51 passed**.
- `pnpm exec tsc --noEmit --pretty false`: passed, no diagnostics.
- Focused ESLint over Linux product, six suites, and fixture: passed, no diagnostics.
- `pnpm exec rasen validate ecp-linux-process-authority-provider --strict --no-interactive`: `Change 'ecp-linux-process-authority-provider' is valid`.
- Hostile probes used only validated OS-temp directories and removed them. Linux-only FD/mode tests skip on this Windows host; source inspection confirms their implementation shape, but this review does not relabel it as actual-Linux kernel evidence.

## Required disposition

Do not mark the TypeScript provider or Change terminal. Route M-003 through M-006 to a non-reviewer fixer, add the missing hostile regressions, rerun the same gates, and obtain another fresh independent TypeScript review.
