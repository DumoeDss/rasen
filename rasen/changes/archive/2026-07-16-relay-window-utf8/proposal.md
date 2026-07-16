## Why

On a Chinese-locale Windows machine the relayed successor window shows mojibake in the injected bootstrap prompt (`锛`=`：`, `浣`=`你`) — the classic UTF-8-bytes-decoded-as-GBK failure. Root cause (web-confirmed 2026-07-16): the Windows relay recipe spawns Windows PowerShell 5.1 and reads the UTF-8 `relay-prompt.txt` with `Get-Content -Raw` and NO `-Encoding`, so PS 5.1 decodes the BOM-less file as the system ANSI codepage (GBK/936 on zh-CN). The spawned console also stays at codepage 936, so the successor CLI's own CJK TUI/stdio output garbles too. A relay whose first instruction is unreadable cannot continue unattended, defeating the relay. This affects both a Claude and a Codex successor window on Windows.

## What Changes

- The Windows relay recipe in the rasen-handoff skill template (`src/core/templates/workflows/handoff.ts`) pins the prompt read encoding and sets the successor console to UTF-8 before launching the CLI, so CJK bootstrap text is decoded correctly and the successor's own CJK output renders:
  - Read the prompt with `Get-Content -Raw -Encoding UTF8 '<path>'` (accepted by PS 5.1 and 7).
  - Prefix the `-EncodedCommand` payload with console UTF-8 setup (`[Console]::OutputEncoding`/`::InputEncoding`/`$OutputEncoding = [Text.Encoding]::UTF8`, the chcp 65001 equivalent that works under `-NoProfile`) BEFORE the `claude --dangerously-skip-permissions "$(...)"` launch.
  - Belt-and-braces guidance: write `relay-prompt.txt` (and Windows-consumed handoff docs) as UTF-8; a UTF-8 BOM lets PS 5.1 auto-detect even without `-Encoding`; prefer `pwsh` (PS 7, UTF-8 default) when available, falling back to `powershell`.
- The Codex-hosted relay note (handoff.ts Session-relay section and the `_orchestration.ts` Step H.7 Codex note) is kept consistent: the same UTF-8 console setup applies to a future Codex successor window on Windows.
- The parity test's two SHA256 snapshot maps are legitimately recomputed and generated skills are regenerated (build → init --force → grep-verify) so shipped `SKILL.md` stays in sync (generated files are never hand-edited).

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `session-relay`: the "Cross-platform successor launch permissions" requirement gains a Windows encoding guarantee — the Windows launch command SHALL read the bootstrap prompt as UTF-8 and set the successor console to UTF-8 so CJK bootstrap text and the successor's own CJK output are not mojibaked, independent of the machine's ANSI codepage or user profile.

## Impact

- **Templates (source of truth):** `src/core/templates/workflows/handoff.ts` (Windows relay recipe), `src/core/templates/workflows/_orchestration.ts` (Step H.7 Codex note — consistency echo only if the note references the window recipe).
- **Parity test:** `test/core/templates/skill-templates-parity.test.ts` — both `EXPECTED_FUNCTION_HASHES` and `EXPECTED_GENERATED_SKILL_CONTENT_HASHES` recomputed for the changed templates.
- **Generated artifacts:** regenerated `skills/` SKILL.md (build → `node bin/rasen.js init --tools claude --force`); no hand edits.
- **Spec:** delta on `session-relay` (MODIFIED "Cross-platform successor launch permissions").
- **No version bump** — template/docs-pipeline change; versions are user-owned.
