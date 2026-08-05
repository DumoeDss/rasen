## 1. Investigation and RED contract

- [x] 1.1 Preserve the full-root failure and minimized reproduction receipts outside the worktree, including the non-reproducing agent-dispatch symptom.
- [x] 1.2 Prove the ambient-ancestor root cause by rerunning the four exact config failures with only `TEMP/TMP` moved beneath a clean ancestor.
- [x] 1.3 Add a deterministic RED config-editor case whose working directory is below an ancestor containing an unrelated `rasen/` directory without project config.

## 2. Narrow config project resolution

- [x] 2.1 Add one config-command helper that accepts the nearest candidate only when the existing config-path resolver identifies an existing project configuration file.
- [x] 2.2 Route explicit `--scope project`, effective-view, and interactive-editor project discovery through the helper without changing general planning-root discovery.
- [x] 2.3 Prove valid initialized projects still enable project-only rows and scope selection, while the ambient ancestor stays outside-project with localized guidance.

## 3. Verification and review

- [x] 3.1 Run the minimized four-test loop under the original Windows temp environment and prove it turns GREEN without changing `TEMP/TMP`.
- [x] 3.2 Run the complete config-editor and CLI config test files with single workers, then build, lint, TypeScript no-emit, diff-check, and strict Change validation.
- [x] 3.3 Run the exact previously flaky agent-dispatch ownership test separately and record that no config fix file crosses its seam.
- [x] 3.4 Dispatch a fresh non-author review of the two-file product/test delta and resolve every Blocker/Major.

## 4. Local lifecycle and foundation unblock

- [x] 4.1 Run local ship with a path-scoped commit containing only this Change, its config implementation, and focused regression; do not push or open a PR.
- [ ] 4.2 Archive the shipped Change through the authoritative archive engine and record the terminal evidence.
- [x] 4.3 Rerun the foundation's complete `pnpm test` gate from the normal environment and resume foundation task 9.11 only from a clean full-suite receipt.
