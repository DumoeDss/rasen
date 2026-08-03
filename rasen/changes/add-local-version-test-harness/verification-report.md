# Verification Report: add-local-version-test-harness

## Summary

| Dimension | Status |
|---|---|
| Completeness | 16/16 tasks complete; 7/7 requirements implemented |
| Correctness | 7/7 requirements and 19/19 scenarios covered by implementation or tests |
| Coherence | All six design decisions followed |

VERIFY VERDICT: CLEAN — Blocker:0 Major:0 Minor:0 Trivial:0

## Requirement mapping

- Local source and project selection: canonical source/project resolution and manifest pairing are implemented in `scripts/local-version/local-runtime.mjs`; default, explicit, space-containing, and alias paths are exercised in `test/scripts/local-version-runtime.test.ts`.
- Paired release-shaped local runtime: independent CLI/UI preparation, pack, install, version checks, UI assets, and the installed CLI's real `resolveUiPackageDir` are implemented in the shared runtime module and covered by the packable fixture plus real 0.2.0 E2E evidence.
- Content-addressed runtime reuse: relevant-input hashing, toolchain identity, staging, bounded locks, atomic publication, warm verification, dirty invalidation, corrupt repair, and concurrent convergence are implemented and directly covered by focused tests.
- Target project and global installation isolation: all npm writes are confined to source dependency graphs and the harness cache; tests preserve existing package bytes, leave an empty non-Node target empty, restore the parent environment, and verify the global Rasen remains unchanged.
- Isolated machine state, daemon, and telemetry: source/project/version identity, stable high ports, dedicated `RASEN_HOME`, and child-only `RASEN_TELEMETRY=0` overlays are implemented and exercised through the PowerShell launcher boundary.
- Rasen and agent launchers: the three PowerShell adapters preserve working directory, standard I/O, arguments, exit codes, and profile-defined Codex/Claude functions while putting only the selected runtime on child `PATH`.
- Actionable machine-readable diagnostics: stdout is reserved for one prepare JSON object; stable code/phase/command/exit fields are emitted on stderr. Version mismatch and a real exit-code-7 build failure are covered directly.

## Design adherence

- D1: three thin PowerShell adapters use one deep Node runtime module.
- D2: CLI and UI are packed and installed side by side; no link mode is exposed.
- D3: runtime keys include content plus platform and toolchain identity; cache publication is lock-protected and atomic.
- D4: homes and daemon ports are stable per canonical source/project/version identity.
- D5: target project integrity is an explicit tested invariant.
- D6: preparation output is structured, fail-closed, and does not leak child environment data.

## Findings

### Blocker

None.

### Major

None.

### Minor

None.

### Trivial

None.

## Final assessment

All checks passed. The implementation matches the proposal, delta specification, design, and completed task list. It is ready for delivery.

TEST EVIDENCE
- scope: focused local-version build-failure regression plus static lint/diff checks
- rationale: closes the only scenario not already directly locked by the existing focused suite before branch-port verification
- command: `pnpm exec vitest run test/scripts/local-version-runtime.test.ts -t "reports a failed source build"`; `pnpm exec eslint scripts/local-version/local-runtime.mjs test/scripts/local-version-runtime.test.ts`; `git diff --check -- scripts/README.md scripts/local-version test/scripts rasen/changes/add-local-version-test-harness`
- result: pass
- tree: `6bd4d5467090cdf34f8089e795c3b5ed9a36dd98` (pre-commit working tree; intentionally not reusable by ship)
