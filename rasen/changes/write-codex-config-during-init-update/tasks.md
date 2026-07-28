## 1. Shared Codex Project Config Foundation

- [ ] 1.1 Add `toml-eslint-parser` as a runtime dependency and define one shared constant set for the `[features.multi_agent_v2]` table, its three managed wait field names, and the `3600000` values.
- [ ] 1.2 Add `test/core/codex-project-config.test.ts` fixtures for absent/current/drifted configs, unrelated content, LF/CRLF and final-newline variants, multiline strings with header-like text, duplicate or inline targets, invalid TOML, and filesystem failures using platform path helpers.
- [ ] 1.3 Define typed read-only inspection (`current`, `missing`, `drifted`, `blocked`) and write reconciliation (`unchanged`, `created`, `updated`) results in `src/core/codex/project-config.ts`.

## 2. Lossless and Atomic Reconciliation

- [ ] 2.1 Implement syntax-aware TOML source-range inspection that locates exactly one supported `[features.multi_agent_v2]` table, compares the three managed wait values, and returns `blocked` for invalid or structurally ambiguous input.
- [ ] 2.2 Implement lossless insertion/replacement of only the three managed wait fields while preserving unrelated bytes, comments, order, BOM policy, newline style, final-newline convention, and any `multi_agent_mode_hint_text`.
- [ ] 2.3 Validate the edited candidate as TOML and verify its resolved managed values before writing; cover target-table and multiline-string edge cases in the focused unit suite.
- [ ] 2.4 Implement same-directory temporary-file writing and atomic destination replacement, including cleanup/error reporting that leaves an existing config available for retry on macOS, Linux, and Windows.
- [ ] 2.5 Prove idempotency by asserting an already-current file is not rewritten and a second reconciliation returns `unchanged`.

## 3. Init Integration

- [ ] 3.1 Add init integration tests showing explicit Codex selection writes the project-root config, externalized planning writes at the exact repository root, and selections excluding Codex never touch `.codex/config.toml`.
- [ ] 3.2 Reconcile the Codex project policy in `src/core/init.ts` through the existing validated per-tool setup path without changing generated-skill counts or other tool results.
- [ ] 3.3 Add init tests and output for created/updated config, config-specific restart guidance, unchanged config, and actionable blocked/write failures that do not report Codex as fully configured.

## 4. Update Drift and Manifest Integration

- [ ] 4.1 Add update tests showing missing/stale Codex config bypasses the "Already up to date." branch even when skills are current, while a current config preserves that branch.
- [ ] 4.2 Inspect Codex config before the up-to-date decision and reconcile it only when Codex is resolved from the authoritative `tools:` manifest or its one-time migration seed.
- [ ] 4.3 Add tests proving `tools: []`, a non-Codex manifest, and an unmanifested `.codex/` directory leave the config untouched while preserving the existing add-tool advisory.
- [ ] 4.4 Integrate config outcomes into the existing per-tool update result so blocked/write failures are actionable, do not claim the project is current, and do not prevent independent tool updates.
- [ ] 4.5 Add update summary and restart output for created/updated config without counting the TOML file as a workflow or skill.

## 5. User Guidance

- [ ] 5.1 Document the project-local Codex policy, its three managed wait fields, manifest-based ownership, preserved native delegation behavior, fresh-session restart requirement, and the intentional incompatibility with short `wait_agent` timeouts.
- [ ] 5.2 Document recovery for invalid or ambiguous `.codex/config.toml` and clarify that Rasen never edits the global Codex config.

## 6. Verification

- [ ] 6.1 Run the focused project-config, init, and update Vitest suites and resolve all regressions.
- [ ] 6.2 Run `pnpm lint` and `pnpm build` on the supported Node version.
- [ ] 6.3 Run the focused suite in Windows CI (or the repository's Windows verification job) and confirm backslash-root resolution, CRLF preservation, and atomic replacement behavior.
- [ ] 6.4 In a fresh Codex session, run a worker canary lasting longer than 60 seconds and record that the lead issues one `3600000ms` `wait_agent` call which wakes early on completion.
