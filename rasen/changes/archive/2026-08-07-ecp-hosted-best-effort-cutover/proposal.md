## Why

Locked decision 13 (2026-08-07) converges the 0.2.0 `hosted` execution backend to the explicitly declared best-effort tier on all three OSes and moves the kernel-enforced authority crates whole to the upgrade path. The audit that triggered it established, and this plan re-verified in code, that the production hosted path never wired the two frozen crates: all three construction sites (`src/core/management-api/router.ts:639`, `src/core/session-host/host.ts:306`, `src/core/session-host/claude-backend.ts:423`) construct through the single platform selection in `src/core/session-host/process-capsule/hosted-process-scope.ts`, which routes darwin to the built, reviewed, wired best-effort scope and every other platform to the legacy ProcessCapsule - whose POSIX exact-scope-empty claim review already disproved, and whose Windows side already is a Job-object implementation. The invariant this change protects is "the Record must not lie": Linux and Windows hosted sessions currently terminate in an exact vocabulary the tier cannot prove; the cutover replaces that disproven claim with declared honesty, losing no capability that ever actually worked.

## What Changes

- Generalise `darwin-best-effort-scope.ts` into a platform-neutral POSIX best-effort scope module and enable it for `linux` (alongside darwin) at the hosted-session platform selection. The mechanics are already POSIX-generic (own process group via detached spawn, group SIGTERM, bounded grace keyed on whole-group emptiness, group SIGKILL, bounded final observation); only naming and messages are darwin-flavoured today.
- Give the win32 hosted tier an honest re-declaration: a thin new scope delegates to the unmodified legacy ProcessCapsule - keeping its measured-working Job-object kill mechanics (`CreateJobObjectW`/`TerminateJobObject` in `native/process-capsule/src/main.rs`) - while the hosted seam declares `exactCancel: false`, `scopeEmptyProof: false` before start and every terminal uses the declared-unproven vocabulary (`cancelled / emptiness-unproven`), never the capsule's proven scope-empty claim.
- Transport or controller loss on win32 maps to retained uncertainty, never to any terminal that authorises release; only actual capsule protocol outcomes mint a declared-unproven terminal. This is expected to structurally close the shape of closure finding SEC-001 ("transport loss can become a clean host detach") - to be verified at the closure re-grade, not claimed done here.
- Windows retains and receipts its one stronger property: `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` daemon-death teardown - when the daemon dies, the job handle chain closes and the kernel tears down remaining job members. Receipted by a real run on this host.
- Capability declarations stay visible before start on every hosted platform. The host-side machinery (declaration persistence at prepare time, the declaration-gated release rule in `closeDurableProcess`, API projection of the terminal) is already tier-agnostic and live; this change verifies it and does not modify it.
- The legacy capsule's pinned bytes stay untouched. Both byte-hash pin lists (`test/core/session-host/linux-process-authority-boundary-guards.test.ts`, `test/core/session-host/windows-process-authority-package-ci.test.ts`) are expected to remain green without rebaseline; an explicit integrity task receipts that, and any deviation stops for a LEAD decision instead of a silent rebaseline.
- Acceptance requires real receipts on Linux (WSL, external isolated run tree - never the repo checkout) and Windows (this host), each with mutation receipts proving guard discrimination. Kernel-enforced proofs are explicitly not acceptance.

## Capabilities

### New Capabilities

- `hosted-best-effort-process-scope`: the all-platform declared best-effort hosted process tier - POSIX generalisation enabled for Linux, win32 honest re-declaration over retained Job kill mechanics, pre-start declaration visibility, transport-loss honesty, KILL_ON_JOB_CLOSE teardown receipting, and real Linux/Windows acceptance evidence.

### Modified Capabilities

None. The frozen common `process-authority-provider` contract, its registry, and its manifest are untouched (the best-effort tier lives at the ProcessScope seam, not in the recursive capability registry - subset providers are rejected index-exact by design). The macOS change's `macos-process-authority-provider` delta is consumed as the verification baseline, not edited.

## Impact

- Affects: `src/core/session-host/process-capsule/hosted-process-scope.ts` (platform selection), a moved/renamed POSIX scope module, a new thin win32 scope module, additive win32 semantics vocabulary at the ProcessScope seam (`src/core/session-host/process-scope.ts`), and the tests that guard selection and terminals. No changes to `host.ts`, `claude-backend.ts`, `router.ts`, the session-host registry record shape, or any pinned legacy-capsule file.
- Frozen assets: `native/linux-process-authority/**` and `native/windows-process-authority/**` are not touched (parked upgrade-path assets). `native/process-capsule/` is not modified; its exact tier simply stops being constructed on any production platform.
- DAG: `ecp-native-process-capsule-closure` now depends on this change alone; this change adds no other edges. The macOS provider change keeps its remaining real-macOS obligations (Section 7, 8.4) owed to ECP-8; its best-effort implementation and declaration-gated release rule are this change's verification baseline.
- Governing decisions: locked decision 13 (all-platform best-effort convergence; kernel-enforced authority to the upgrade path), locked decision 11 (daemon lifetime; daemon death means scope death and typed `execution-lost` downstream), locked decision 12 (janitor, not sandbox; the threat model is our own mistakes).
- Direction source: `rasen/work/issue-centered-automation-platform/executable-composite-pipelines/slices/session-execution-and-self-hosting/` (plan.md Architecture Replan 6; slice spec acceptance 2 and 4 as revised 2026-08-07).
