# Prepare-unavailability implementation baseline

Date: 2026-08-05

- Start HEAD: `81d0ea37770979c0b58b0e54735585fef3280e64` on `wip/ecp-shared-bounded-loop-lifecycle-resume`.
- Accepted foundation implementation commit: `222eac509f5fb40ecce182c9eb7533ed754f310d`; authoritative archive transaction `eb60dbba-dee7-4d32-b004-440c58a7cef1`.
- Discovery context: Direction-selected `ecp-linux-process-authority-provider` APPLY requires denied/unsupported user/PID/mount namespace prerequisites to settle as typed `authority-unavailable` without fallback.
- Baseline type: `ProcessAuthorityProvider.prepare()` returns only `Promise<ProviderPreparedAuthority>`.
- Baseline coordinator behavior: provider rejection/exception maps to prepare `control-loss`; a structurally invalid prepared value maps generically to `authority-unavailable` and cannot preserve an intentional provider diagnostic.
- Owned product/test paths: `src/core/session-host/process-authority/types.ts`, `coordinator.ts`, `index.ts`, `test/helpers/process-authority-provider-conformance.ts`, `test/helpers/deterministic-process-authority-provider.ts`, focused process-authority tests, and this Change directory.
- Excluded: Linux provider files, native helpers, manifests/references, production defaults, legacy ProcessCapsule, macOS/MMAC, Windows, release support, retained temp output, and unrelated cumulative worktree state.

The Change was strict-valid before RED implementation. No existing dirty file is assumed owned merely because it appears in repository status.
