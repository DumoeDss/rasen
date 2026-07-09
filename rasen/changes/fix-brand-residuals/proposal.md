## Why

An independent brand sweep (post `specs-brand-rewrite`) found three residual `OpenSpec` tokens in active specs/config, plus two open questions about whether the tokens are cosmetic or mask a real behavior gap. Investigation in this change confirmed both gaps are real: the `cli-update` spec describes a marker-scoped partial-update mechanism that no longer exists anywhere in the command-generation path (every AI-tool adapter does whole-file regeneration), and the shell-completion installers (bash/zsh/PowerShell) still write the legacy `# OPENSPEC:START/END` marker literal into brand-new profile content, violating the existing `rasen-cli-identity` requirement that legacy markers are recognized-only and never written into new content. Fixing this now keeps the spec corpus and the installers honest about actual behavior and closes the last namespace leaks from the `OpenSpec` → `rasen` rebrand.

## What Changes

- Correct `cli-update/spec.md`'s marker-mechanism scenarios (8 sites across CodeBuddy, Factory Droid, Codex, GitHub Copilot, Gemini CLI, iFlow, and two generic requirements) to describe what actually happens — full regeneration of each command/skill file from the current template — instead of a marker-scoped partial update that was never true for any of these tools in the current implementation.
- Fix `bash-installer.ts`, `zsh-installer.ts`, and `powershell-installer.ts` so newly written shell-profile blocks use a `# RASEN:START` / `# RASEN:END` marker instead of the legacy `# OPENSPEC:START` / `# OPENSPEC:END` literal, while continuing to recognize and replace/remove a pre-existing legacy `OPENSPEC` block (upgrade and uninstall paths keep working for users who installed under the old marker).
- Rewrite the fictional `isOpenSpecProject(): boolean` method name in `cli-completion/spec.md`'s interface sketch to `isRasenProject(): boolean` (token-only; no such method exists in the real `CompletionProvider` class either way).
- Rewrite `rasen/config.yaml`'s governance prose ("Write OpenSpec proposals and specs...") to say "Rasen".
- Add regression test coverage for the installer marker fix: fresh-install writes `RASEN` markers only, upgrade replaces an existing legacy `OPENSPEC` block in place (no duplicate block), and uninstall removes either marker family.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `cli-update`: the marker-mechanism scenarios for CodeBuddy, Factory Droid, Codex, GitHub Copilot, Gemini CLI, and iFlow slash-command updates, plus the general "Tool-Agnostic Updates" requirement, are corrected to describe whole-file template regeneration with preserved-content semantics accurately, replacing the stale "OpenSpec managed markers" / "OpenSpec marker block" language.
- `rasen-cli-identity`: adds a scenario making explicit that shell-completion profile installers (bash/zsh/PowerShell) write the current `RASEN` marker into new content and only recognize the legacy `OPENSPEC` marker for upgrade/uninstall of pre-existing blocks — bringing the installers into conformance with the existing "SHALL NOT be written into newly generated content" requirement.

## Impact

- `rasen/specs/cli-update/spec.md` — scenario text edits, no schema/requirement-ID changes.
- `rasen/specs/cli-completion/spec.md` — one method-name token edit in an interface sketch (prose only).
- `rasen/specs/rasen-cli-identity/spec.md` — one added scenario.
- `rasen/config.yaml` — one-word prose edit.
- `src/core/completions/installers/bash-installer.ts`, `zsh-installer.ts`, `powershell-installer.ts`, `src/utils/file-system.ts` (`updateFileWithMarkers` gains legacy-marker recognition) — marker-literal and dual-recognition fix.
- `test/core/completions/installers/{bash,zsh,powershell}-installer.test.ts` — assertion updates plus new upgrade/uninstall regression cases.
- No change to `update`/`init` command behavior beyond the corrected spec wording; no change to completion-installer behavior beyond the marker literal.

Out of scope (flagged, not fixed here): the `cli-update` spec's root-level `AGENTS.md`/`CLAUDE.md` "stub" scenarios describe a feature (`@/rasen/AGENTS.md` pointer stub) that a codebase search found no trace of in `src/` — this looks like a larger, separate staleness issue and is left for a follow-up change.
