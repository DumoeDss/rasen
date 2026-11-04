# Integration verification — Claude Code pass (2026-08-10, Windows)

Independent re-verification of the `teacher-consultation-dev-integration`
child. Every command below was run by Claude Code on the integrated tree;
no result is relayed from the earlier Codex implementer report.

## Merge identity

- Teacher parent (first): `914c836ae4c08aaf12fb4459b69ea48ac7e3b16f`
- Dev parent (second): `96452f5cd5554e69617e6d559387717c04bb6cc9` (= `origin/dev/0.2.0`, PR #147)
- Merge base: `91d71d6c4bf1e35b4c7575bffabbdcafe547d38c`
- Integration merge commit: `c7221341e7d3694e48835cbaa5afa5a0edcab284`
- Integration tree: `c702b522dcdb8ee6468148ea80a9894cbdc48889`
- Parent order verified: `git log -1 --pretty=%P` => `914c836a 96452f5c` (Teacher-first).
- Original Teacher commits reachable from the merge:
  `3c595019` yes, `f6d6854c` yes, `914c836a` yes (`git merge-base --is-ancestor`).
- Pre-merge backup ref: `backup/teacher-advisor-pre-dev-merge-20260810` at `914c836a`.
- `git diff --name-only --diff-filter=U` on the staged merge: 0 paths.

## Conflict-resolution audit

All eight textual conflicts and all six auto-merged overlaps were audited
by diffing the resolved content against each parent (`git diff --numstat
<PARENT>`). Every file differs from both parents, i.e. no side was
selected wholesale:

- `frozen-action-session-executor/spec.md`: resolved == 335 lines; the
  complete Teacher consultation requirement append (119 lines added since
  the merge base) is retained. Dev's only change was deleting one
  trailing blank line at EOF (cosmetic), so the substantive requirement
  "no requirement/scenario dropped" holds.
- `facade-runtime.ts`, `reconciler.ts`, `runtime-context.ts`,
  `router.ts`, `server.ts`, `worker-contracts.ts`,
  `claude-backend.test.ts`: each carries both dev and Teacher semantic
  tokens (grep-confirmed: task-loop/BoundedLoop + consultation/advice/
  continuation/receipt; reusable + exact host; allSettled owner drain;
  consultable-leaf + leaf-rejects-CONSULT; path.resolve + acceptEdits).
- Six auto-merged overlaps (`facade.ts`, `projector.ts`,
  `pipeline-registry/index.ts`, `session-host/registry.ts`,
  `trusted-completion.ts`, `commands/agent.ts`) each differ from both
  parents — true merges, both sides retained.

`runtime-context.ts` uses exactly one `node:path` import (line 36).
`StoredRuntimeContextInput` carries no `cwd` field; the only workspace
authority source is `sourceSessionHost` ("never reconstructed from a
request"), so request-supplied cwd is structurally unable to reach the
trusted observer.

## Added discriminating regression (task 5.6)

The earlier implementation had zero behavioral coverage of the
`task_loop_workspace_authority_*` fail-closed guard. Added
`fails closed on missing or mismatched daemon Session authority ...`
to `consultation-facade-journey.test.ts`. It reopens a stored task-loop
consultation (a) with no `sourceSessionHost` and (b) with a Session whose
cwd digest disagrees with its cwd, and asserts the typed
`StoredRuntimeContextError` (codes `..._unavailable` and `..._mismatch`
respectively), unchanged Record digest, and no generated report. The test
is discriminating: removing the guard in `trustedTaskLoopProjectRoot`
would make `resume()` not throw and fail the `instanceof` assertion.

## Commands and counts (all run by Claude Code)

- `pnpm exec tsc --noEmit` => exit 0.
- `pnpm run lint` (eslint src/ test/ vitest.config.ts vitest.setup.ts) => exit 0, clean.
- `pnpm run build` => exit 0; ProcessCapsule win32-x64 built (`740eba98...`).
- Focused integration suites (sections 7.1-7.3 + 4.3): 25 files / 273 tests PASS.
- Adapter conformance + digest stability (7.4 + 8.1): 7 files / 197 tests PASS.
- Earlier focused set (consultation journey, codex dispatch, facade-runtime,
  supervisor-host-lifecycle, claude-backend, reusable-session-routes,
  worker-contracts): 7 files / 89 tests; 2 EPERM failures on first run
  (see Flakes), 27/27 PASS on the retried file.
- New 5.6 guard test: 1 PASS.
- `node ./bin/rasen.js validate teacher-consultation-dev-integration --strict --json`
  => PASS, 1/1, valid:true, issues:[] (local dev/0.2.0 build, not the
  global 0.1.7 install).
- `git diff --cached --check` and `git diff --check` on the staged+working
  tree => exit 0 (no whitespace errors).

## Native evidence (section 8.2)

- `cargo test --manifest-path native/windows-process-authority/Cargo.toml`
  => exit 0. Visible in the captured tail: section-8 gate 8 passed,
  section-9 discrimination 4 passed; the overall exit 0 confirms the
  preceding unit/kernel/guardian suites also passed (cargo aborts on the
  first failing binary). This is actual Windows native Job Object /
  guardian evidence.

## Platform classification

- Windows: native (cargo Job Object/guardian above; the win32 adapter
  conformance vitest suite is real Windows adapter behavior).
- Linux adapter conformance ran on this Windows host only as deterministic
  cross-target simulation (the Linux crate's WSL-oracle fixture
  early-returns on win32); it is NOT native Linux kernel evidence.
- macOS: exact-Teacher authority typed-unavailable branch covered by
  `exact-teacher-session-lane.test.ts` ("keeps ordinary hosting only when
  exact Teacher authority is typed unavailable before activation").
- Linux native/integration CI (task 8.3) is NOT runnable on this Windows
  host and is deferred to equipped Linux CI; no WSL/cross-target
  substitution was used to claim it.

## Flakes

Two tests in `consultation-facade-journey.test.ts` failed once with
`Error: EPERM ... fs.rmSync(root, { recursive: true, force: true })` in
their `finally` cleanup blocks (temp-directory teardown on Windows), not
in any assertion. One of the two is a pre-existing test (predates this
change), confirming the cause is environmental Windows file-handle
retention, not a logic regression. After clearing the residual temp dirs
and re-running the file, it passed 27/27. No test code was changed to
mask this.

## Encoding

Strict UTF-8 decoding of every edited planning/source/test file succeeds.
The inherited dev file `test/core/templates/skill-templates-parity.test.ts`
still carries a UTF-8 BOM; it was not touched by this integration, so a
whole-merge no-BOM claim is not made. `git diff --check` is clean.

## Archive immutability (task 9.4)

`rasen/changes/archive/2026-08-10-teacher-consultation-runtime/` is
unchanged by this integration (13 files at `914c836a`, purely additive
from the Teacher side; dev has no such directory). Its evidence is cited
only as historical input for the original tree. Every current PASS above
names the integrated commit `c7221341` / tree `c702b522`.

## Open before archive

- 9.3 independent non-author review (this pass is author = verifier).
- 8.3 equipped Linux native/integration CI.
