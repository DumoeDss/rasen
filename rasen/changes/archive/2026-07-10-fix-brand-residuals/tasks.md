## 1. Re-verify investigation findings (cheap spot-checks)

- [x] 1.1 Re-confirm `src/core/update.ts:224` and `:252` write skill/command files via whole-file `FileSystemUtils.writeFile()`
- [x] 1.2 Re-confirm none of the 9 relevant adapters (`codebuddy`, `factory`, `codex`, `github-copilot`, `gemini`, `iflow`, `antigravity`, `windsurf`, `kilocode`) in `src/core/command-generation/adapters/` read existing file content or reference a marker constant in `formatFile()`
- [x] 1.3 Re-confirm `bash-installer.ts:17-20`, `zsh-installer.ts:17-20` each define an independent `# OPENSPEC:START`/`# OPENSPEC:END` literal, and `powershell-installer.ts:217-223` inlines the same literal directly
- [x] 1.4 Re-confirm `src/core/completions/completion-provider.ts`'s `CompletionProvider` class has only `getChangeIds()`/`getSpecIds()`, no `isOpenSpecProject` method
- [x] 1.5 Re-confirm `rasen/config.yaml:9` reads `- Write OpenSpec proposals and specs in user-facing product behavior language` and is prose inside a YAML value, not a parsed key

## 2. Spec text edits (already drafted as delta specs; apply to main specs at archive time, verify draft content now)

- [x] 2.1 Verify `specs/cli-update/spec.md` (this change's delta) fully replaces the `Tool-Agnostic Updates` and `Slash Command Updates` requirement blocks with whole-file-regeneration language for CodeBuddy, Factory Droid, Codex, GitHub Copilot, Gemini CLI, iFlow, Antigravity, Windsurf, and Kilo Code scenarios, while leaving all other scenario clauses (file paths, frontmatter fields, `$ARGUMENTS` placeholders, root-stub language) unchanged
- [x] 2.2 Verify `specs/cli-completion/spec.md` (this change's delta) renames `isOpenSpecProject(): boolean` to `isRasenProject(): boolean` inside the `Architecture Patterns` requirement's `Dynamic completion providers` scenario, with no other change to that requirement block
- [x] 2.3 Verify `specs/rasen-cli-identity/spec.md` (this change's delta) adds the three new scenarios (new-write uses RASEN markers, upgrade replaces legacy OPENSPEC block, uninstall removes either family) to the `Brand namespace identifiers` requirement, keeping the existing three scenarios and requirement text unchanged

## 3. Config prose edit (B1)

- [x] 3.1 Edit `rasen/config.yaml:9` — change "Write OpenSpec proposals and specs..." to "Write Rasen proposals and specs..."

## 4. Installer code fix (F6)

- [x] 4.1 In `src/utils/file-system.ts`, extend `updateFileWithMarkers()` to accept an optional legacy marker pair (or ordered list of recognized pairs) to search for an existing block; when found under any recognized pair, replace that span; always write using the passed-in (current) start/end marker regardless of which pair was matched or whether none was found
- [x] 4.2 In `bash-installer.ts`, rename the write-time marker literal from `# OPENSPEC:START`/`# OPENSPEC:END` to `# RASEN:START`/`# RASEN:END`; pass the legacy `OPENSPEC` pair to `updateFileWithMarkers()` for upgrade recognition; update `removeBashrcConfig()` to remove a block under either marker family
- [x] 4.3 In `zsh-installer.ts`, apply the same fix as 4.2 (write-time literal renamed to RASEN, legacy OPENSPEC recognized for upgrade, uninstall removes either family)
- [x] 4.4 In `powershell-installer.ts`, update `configureProfile()`'s inline block construction to write `# RASEN:START`/`# RASEN:END` for new blocks, recognize an existing legacy `# OPENSPEC:START`/`# OPENSPEC:END` block for replace-in-place, and update `removeProfileConfig()` to search for and remove either marker family

## 5. Test updates and additions (F6)

- [x] 5.1 In `test/core/completions/installers/bash-installer.test.ts`, flip fresh-install assertions (e.g. around line 118-119) from `# OPENSPEC:START/END` to `# RASEN:START/END`; keep pre-seeded legacy-block fixtures as `OPENSPEC` where they test detection/removal, but assert the post-configure result uses `RASEN` markers and contains no duplicate block
- [x] 5.2 Apply the equivalent test updates to `test/core/completions/installers/zsh-installer.test.ts`
- [x] 5.3 Apply the equivalent test updates to `test/core/completions/installers/powershell-installer.test.ts`
- [x] 5.4 Add a dedicated upgrade-path regression test per installer: seed a profile with a legacy `# OPENSPEC:START/END` block, run configure/install, assert the block was replaced in place (single block, `RASEN` markers, no `OPENSPEC` remaining)
- [x] 5.5 Add a dedicated uninstall regression test per installer: seed a profile with ONLY a legacy `# OPENSPEC:START/END` block (never upgraded), run uninstall, assert it is fully removed

## 6. Validation

- [x] 6.1 Run `pnpm build` in the worktree (note: depends on `pnpm install` having completed in the worktree)
- [x] 6.2 Run `npx vitest run test/core/completions/` in the worktree and confirm all tests pass
- [x] 6.3 Run `node dist/cli/index.js validate fix-brand-residuals` using the worktree's own build output and confirm exit code 0
- [x] 6.4 Run `node dist/cli/index.js validate --specs` (worktree dist) and confirm it passes
- [x] 6.5 Re-run the corpus brand-grep per the `spec-brand-consistency` governance spec and confirm it stays clean (no new `OpenSpec` residuals introduced, and the fixed sites no longer match)
