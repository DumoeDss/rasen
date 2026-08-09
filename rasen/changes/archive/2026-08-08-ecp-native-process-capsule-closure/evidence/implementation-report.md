# ProcessCapsule closure implementation report

## Verdict and evidence boundaries

The implementation-owned S1-S5 closure is complete on the Windows x64 current
host. Native ProcessScope, host, static, Rust, package, full-root, and UI gates
pass. Linux and macOS cross-target checks pass as compile-only evidence. No
Linux or macOS runtime claim is made: the exact real-OS commands and receipts in
`platform-obligations.md` remain mandatory ECP-8 release gates.

Evidence classes used below:

- **Windows runtime:** a real Windows process/Job/controller/helper oracle ran.
- **Deterministic:** a public ProcessScope/protocol/fault seam ran without
  claiming target-OS behavior.
- **ABI/source:** a sourced declaration, compile-time layout assertion, or
  reviewed production topology is present.
- **Cross-target compile:** Rust compiled for the named target on Windows; this
  is not runtime evidence.
- **Package/static:** resolver, manifest, migration, compiler, linter, pack, or
  source-claim validation ran.
- **ECP-8 obligation:** the real target-OS oracle has not run in this Change.

## S1-S5 closure map

| Finding | Production closure | Primary tests/evidence | Result |
| --- | --- | --- | --- |
| S1: incomplete macOS birth ABI | `native/process-capsule/src/main.rs` declares the complete 56-byte `ProcUniqIdentifierInfo`, including both reserve fields, asserts 56-byte size/8-byte alignment at compile time, and accepts only a full non-zero kernel identity. | `process-capsule-macos-identity.test.ts`; `aarch64-apple-darwin` check; `platform-obligations.md` | ABI/source and cross-target compile pass; actual macOS collision/foreign/unavailable runtime remains ECP-8. |
| S2: root exit released whole-scope authority | Native protocol v2 emits `ROOT_EXIT` separately from terminal `SCOPE_EMPTY`; `CapsuleClient`, `LiveProcessScope`, deterministic ProcessScope, Claude transport, and host closure paths retain authority until scope-empty. | `process-scope-contract.test.ts`, `process-scope-host-closure.test.ts`, `claude-backend.test.ts`, `host.test.ts` | Deterministic and Windows runtime paths pass. |
| S3: replacement could not reap a surviving POSIX group | Opaque ref v2 binds controller and supervisor births plus reserved PGID; Linux/macOS replacement revalidate exact identity and perform bounded TERM/KILL group cleanup, returning closed only after absence. | `process-capsule-posix-replacement.test.ts`; Linux/macOS target checks; `platform-obligations.md` | Source/discriminator and compile-only gates pass; actual Linux/macOS cleanup remains ECP-8. |
| S4: ACTIVATE/abort could wait forever | One `awaitControl` helper bounds prepare, activate, abort, inspect/terminate, and scope-empty phases; timeout/control-loss outcomes retain the ref and identify the phase. | `process-capsule-control-deadline.test.ts`, `process-scope-contract.test.ts`, `host.test.ts`, `server-shutdown.test.ts` | 47/47 passed in the exact task 5.6 command. |
| S5: provenance wording exceeded the evidence | Build output and resolver require per-artifact integrity plus `build-inputs` compiler/source provenance; isolated clean builds are compared honestly without promising reproducible bytes. | `provenance-audit.md`, `process-capsule-provenance.test.ts`, `process-capsule-package.test.ts`, `docs/session-host.md` | Two Windows clean builds repeatedly differed while each matched its own manifest; the narrow claim passes. |

## Requirement/scenario map

### One opaque exact authority

| Scenario | Code and test evidence | Class/status |
| --- | --- | --- |
| Published authority precedes backend work | `process-scope.ts`; native `PREPARED` then `ACTIVATE`; registry-before-activate host path; Windows early-activation mutation in `process-capsule-native.test.ts` | Windows runtime + deterministic, pass |
| Foreign identity receives zero signals | Native ref birth checks; rollback/foreign mutations in native and POSIX replacement tests | Windows runtime for opaque rollback; deterministic/source for POSIX; actual POSIX ECP-8 |
| Native capability is unavailable | Resolver closed-manifest failures and macOS unavailable-birth test mode | Package/deterministic pass; actual macOS ECP-8 |

### Complete macOS kernel unique identity

| Scenario | Code and test evidence | Class/status |
| --- | --- | --- |
| Same-second macOS processes remain distinct | Complete `proc_pidinfo` binding and platform-gated collision oracle in `process-capsule-macos-identity.test.ts` | ABI/source pass; runtime ECP-8 |
| Reused macOS PID does not authorize control | Exact unique-birth comparison and foreign mutation oracle | Source/deterministic pass; runtime ECP-8 |
| macOS unique source is unavailable | Full-return/non-zero checks and unavailable controller mode | ABI/source and deterministic pass; runtime ECP-8 |
| Cross compilation is not runtime proof | Pinned `aarch64-apple-darwin` check and `platform-obligations.md` wording | Compile-only pass; no support claim |

### Root exit differs from scope-empty

| Scenario | Code and test evidence | Class/status |
| --- | --- | --- |
| Root exits with detached descendant | `ROOT_EXIT`/`SCOPE_EMPTY` protocol states and `process-scope-host-closure.test.ts` | Windows runtime pass |
| Descendants later empty naturally | Controller containment observer emits one `SCOPE_EMPTY`; natural close oracle | Windows runtime pass |
| Exact terminate closes descendants after root exit | Retained `ProcessRef` termination path and detached descendant oracle | Windows runtime pass |
| Controller/pipe closes before scope-empty | `CapsuleClient.fail` emits `process-control-lost`/`scope-empty`; controller-death tests now assert uncertainty rather than fake close | Windows runtime pass |

### Exact POSIX replacement group

| Scenario | Code and test evidence | Class/status |
| --- | --- | --- |
| Linux replacement closes a resistant descendant group | Linux pidfd/controller/supervisor/group implementation and platform-gated resistant-group oracle | Source + cross-target pass; runtime ECP-8 |
| macOS replacement closes a resistant descendant group | Kernel birth revalidation/group implementation and same oracle | Source + cross-target pass; runtime ECP-8 |
| Same PID with different birth is never signalled | Controller birth, supervisor birth, and supervisor PID/PGID mutation cases | Deterministic/source pass; runtime ECP-8 |
| Controller gone but old group remains reserved | Leader-exit-before-replacement and daemon force-death cases in POSIX suite | Deterministic/source pass; runtime ECP-8 |

### Bounded post-PREPARED control

| Scenario | Code and test evidence | Class/status |
| --- | --- | --- |
| ACTIVATE acknowledgement withheld | `awaitControl('activate', ...)` and withheld-activate helper mode | Windows runtime pass |
| Prepared abort acknowledgement withheld | `awaitControl('abort', ...)` and withheld-first-terminate mode | Windows runtime pass |
| Control succeeds before deadline | control deadline tests assert one result and no late timeout mutation | Windows runtime pass |
| Timed-out control reconciles later | retained original ref is inspected/terminated after abort timeout | Windows runtime pass |

### Integrity and truthful provenance

| Scenario | Code and test evidence | Class/status |
| --- | --- | --- |
| Adjacent helper matches manifest | `resolver.ts`; package fixture; independent dist helper length/SHA verification | Package/static pass |
| Helper or manifest differs | Missing, protocol, platform, architecture, capability, length, hash, non-regular, and junction/symlink-escape negatives | Package/static pass |
| Two clean builds differ | isolated build-root test records unequal hashes and exact adjacent manifests | Windows build evidence, pass without reproducibility claim |
| Two clean builds are identical | same test accepts equality only as platform-local evidence | Contract covered; no cross-platform claim |

### Preserved containment, migration, and no fallback

| Scenario | Code and test evidence | Class/status |
| --- | --- | --- |
| Windows controller dies after activation | suspended Job-at-create, last-handle ownership, real root/descendant/unrelated oracle | Windows runtime pass |
| Duplicate Job handle mutation detected | explicit duplicate-handle helper mode makes controller-death oracle fail while production passes | Windows runtime pass |
| Activation before publication detected | explicit early-activation mode makes the inertness oracle fail | Windows runtime pass |
| Live v1 PID facts encountered | registry migration preserves original bytes and refuses to invent v2 authority | Package/migration pass |
| Packaged capability absent | resolver negatives and forbidden-fallback source assertions | Package/static pass |

### Independent closure and release ownership

| Scenario | Evidence | Status |
| --- | --- | --- |
| Linux/macOS runtime unavailable during child | `platform-obligations.md` contains exact commands, metadata, and expected receipts | Truthfully recorded; not a pass |
| Independent closure clean | Implementation gates below are complete; security and code/spec verdicts are intentionally left for fresh non-authors | Pending tasks 9.3-9.5 |
| ECP-8 final release assurance | Exact three-OS obligations remain assigned to clean release CI | Unexecuted ECP-8 gate |
| Original host child remains separate | This report does not mark `ecp-durable-agent-session-host` delivered | Preserved portfolio boundary |

## Gate receipts

| Gate | Receipt |
| --- | --- |
| Control/deep boundary | Exact task 5.6 command: 4 files, 47 tests passed. |
| Package/provenance | 2 files, 9 tests passed; production helper built; `npm pack --dry-run --json` succeeded; packed/current manifest-to-helper length and SHA were independently recomputed. |
| Preservation/migration | Exact task 7.6 command: 3 files, 21 tests passed, including five real Windows native tests and opaque-ref rollback. |
| Native closure | Exact task 8.1 command: 9 files, 35 passed, 4 target-OS tests skipped on Windows. |
| Focused host/daemon/CLI | Exact task 8.2 command: 25 files, 154 passed, 4 target-OS tests skipped on Windows. |
| TypeScript/static | `pnpm run build`, `pnpm run lint`, `pnpm exec tsc --noEmit`, and `git diff --check` passed. CRLF conversion notices were warnings only. |
| Rust | Stable fmt check and clippy with `-D warnings` passed. |
| Cross-target | Pinned Linux x64 and macOS arm64 checks passed; compile-only. |
| Change/package | Strict Change validation, helper build, npm dry-run pack, closed manifest entry audit, and exact helper length/SHA audit passed. |
| Full repository | Initial default-TEMP run exposed four environment-only config-editor failures because Windows `%TEMP%` is below `AppData\\Local`, whose sibling `Rasen` directory is found case-insensitively as an ancestor workspace; one concurrent agent-dispatch case was flaky and passed 16/16 focused. The unchanged `pnpm test` command then completed with exit 0 in 1,252.7 seconds using the exact isolated `E:\\rasen-ecp7-full-suite-tmp-20260804-2205` TEMP root. That exact test-owned root was removed afterward. |
| UI consumers | UI typecheck, complete test command, and production build all exited 0. |
| Residue | No exact Change-owned helper/controller/supervisor/backend process or native/scope/capsule/POSIX temp root remained. Pre-existing/unknown repo temp and run-state roots were left untouched. |

## Scope audit

The closure owns only the native helper, opaque ProcessScope and capsule client,
the smallest Claude/host authority integration, build/package/docs wiring,
their tests, and this Change's artifacts/evidence. It introduces no frozen
Action executor, signer custody, Run/Record mutation, policy/control UI,
self-hosting proof, release/version/tag work, Issue/Dispatch/portfolio runtime,
or `auto-decompose` migration.

The worktree is intentionally cumulative and dirty from the larger ECP
portfolio, so a global `git diff` also contains other approved children. The
child delivery must remain path-scoped to the surfaces listed above; no unknown
temp root, `.rasen/**` run-state, safety stash, or unrelated portfolio surface
belongs in this child commit.
