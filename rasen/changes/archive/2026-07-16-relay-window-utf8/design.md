## Context

Follow-up to `relay-launch-permissions` (already archived), which added `--dangerously-skip-permissions` to the three platform relay launch commands. This change fixes a separate Windows-only defect: CJK mojibake in the relayed successor window.

The Windows recipe in `src/core/templates/workflows/handoff.ts` builds a command string, base64-encodes it, and runs it via `Start-Process powershell -NoProfile ... -EncodedCommand`. Today that command string is:

```
claude --dangerously-skip-permissions "$(Get-Content -Raw '<relay-prompt.txt>')"
```

Two encoding faults, both web-confirmed (2026-07-16, Microsoft `about_Character_Encoding` + PS-console-CJK troubleshooting):

1. **Read side:** `Get-Content -Raw` with no `-Encoding` on Windows PowerShell 5.1 decodes a BOM-less file as the system ANSI codepage — GBK/936 on a zh-CN machine. The UTF-8 `relay-prompt.txt` is therefore garbled at injection (`：`→`锛`, `你`→`浣`). ASCII/paths survive because they coincide across UTF-8 and GBK.
2. **Console side:** the spawned console inherits codepage 936, so even a correctly-injected CJK prompt — and the successor CLI's own CJK TUI/stdio output — renders as mojibake.

Codex hardcodes `-NoProfile` when it invokes PowerShell tools (openai/codex#4498), and OUR relay also passes `-NoProfile`; so any fix that relies on a user `$PROFILE` is dead on arrival. The fix must be inline in the `-EncodedCommand` payload.

## Goals / Non-Goals

**Goals:**
- The Windows successor window receives the CJK bootstrap prompt intact and renders its own CJK output correctly, regardless of the machine's ANSI codepage or user profile.
- The fix works under `-NoProfile` and on both Windows PowerShell 5.1 and PowerShell 7.
- Keep the Claude and future-Codex Windows-window guidance consistent (same console-UTF-8 setup).
- Keep generated skills and the parity-hash snapshots legitimately in sync.

**Non-Goals:**
- Fixing Codex's upstream `-NoProfile`/CJK issues (#4498, #4574, #4431, #16542) — out of our repo; we only make our own recipe robust.
- Changing macOS/Linux recipes — they run in UTF-8 locales by default; no mojibake reported there. (A one-line note that those already default to UTF-8 is fine; no command change.)
- Touching permission flags, quote-safe delivery mechanics, quiesce, or the generation cap — all unchanged from the prior change.
- Any version bump.

## Decisions

**D1 — Pin the read encoding: `Get-Content -Raw -Encoding UTF8 '<path>'`.**
`-Encoding UTF8` is accepted by both PS 5.1 and PS 7 and forces UTF-8 decode regardless of the ANSI codepage, fixing fault (1). Chosen over "write the file with a BOM and rely on auto-detect" as the primary fix because an explicit `-Encoding` is unambiguous and does not depend on every writer emitting a BOM; the BOM is kept as a belt-and-braces secondary (D3).

**D2 — Prefix the payload with console UTF-8 setup (chcp 65001 equivalent).**
Before the `claude ...` launch, the `-EncodedCommand` payload runs:
```
[Console]::OutputEncoding = [Text.Encoding]::UTF8
[Console]::InputEncoding  = [Text.Encoding]::UTF8
$OutputEncoding           = [Text.Encoding]::UTF8
```
This sets the console to UTF-8 in-process, works under `-NoProfile` (unlike a `$PROFILE` edit), and fixes fault (2) — the successor CLI's CJK output renders. Chosen over injecting `chcp 65001` because the `[Console]::*Encoding` assignments are the PowerShell-native, in-process form and also cover `$OutputEncoding` (how PS encodes text piped to native commands). The full built command string becomes:
```
[Console]::OutputEncoding=[Text.Encoding]::UTF8; [Console]::InputEncoding=[Text.Encoding]::UTF8; $OutputEncoding=[Text.Encoding]::UTF8; claude --dangerously-skip-permissions "$(Get-Content -Raw -Encoding UTF8 '<abs path>')"
```
then base64-encoded to `-EncodedCommand` exactly as before (the encoding mechanism is unchanged; only the plaintext payload grows).

**D3 — Belt-and-braces write-side guidance.**
Instruct that `relay-prompt.txt` (and Windows-consumed handoff docs) be written as UTF-8, and note that a UTF-8 BOM makes PS 5.1 auto-detect even without `-Encoding` — a redundant safety net behind D1. Also note: prefer `pwsh` (PS 7, UTF-8 by default) when installed, falling back to `powershell` (5.1). These are documentation refinements in the recipe narrative, not new mechanisms.

**D4 — Codex-window consistency.**
The Codex-hosted relay note added by the prior change (handoff.ts Session-relay section, and `_orchestration.ts` Step H.7) gets the same one-line UTF-8-console caveat for a future Windows Codex successor window, so the two host recipes stay parallel. This is a doc echo; it changes `_orchestration.ts` only if that note references the window recipe (ripples to rasen-auto/rasen-review-cycle/rasen-goal — accounted for in parity recompute).

**D5 — Spec: MODIFY "Cross-platform successor launch permissions".**
The encoding guarantee is a property of the platform launch COMMAND (the Windows recipe), which is exactly what that requirement governs, so the delta extends it rather than adding a new requirement. Label MODIFIED (the requirement is present in base after the prior change). `rasen validate` does NOT check MODIFIED-vs-base, so the label is set by hand and must be correct — the two prior-change requirements ARE in base now, so MODIFIED is right and ADDED would be wrong.

**D6 — Regeneration + parity recompute (verified, not assumed).**
`pnpm build` first (dist needed), then `node bin/rasen.js init --tools claude --force` (`rasen update` no-ops in a fresh worktree with no configured tools). Then recompute both hardcoded SHA256 maps in `test/core/templates/skill-templates-parity.test.ts` (`EXPECTED_FUNCTION_HASHES`, `EXPECTED_GENERATED_SKILL_CONTENT_HASHES`) from the new template/skill content, and run `npx vitest run` (bare `vitest` not on PATH). Grep the regenerated SKILL.md for the UTF-8 markers as the parity check.

## Risks / Trade-offs

- **[Longer `-EncodedCommand` payload]** → Mitigation: base64 of a few hundred extra chars is trivially within Windows command-length limits; the encoding path is unchanged.
- **[`-Encoding UTF8` behavior differs 5.1 vs 7]** → Mitigation: on PS 5.1 `UTF8` means "UTF-8"; on PS 7 the default is already UTF-8 and `-Encoding UTF8` is still accepted (no-BOM). Both decode the UTF-8 file correctly; verified against Microsoft `about_Character_Encoding`.
- **[Parity hashes recomputed wrongly (copying stale values)]** → Mitigation: recompute FROM the freshly generated content via the test's own hashing routine / a scripted recompute, then run the suite; a mislabeled hash fails the parity test loudly.
- **[MODIFIED-vs-ADDED mislabel]** → Mitigation: base spec was just read and confirmed to contain the target requirement; delta is labeled MODIFIED. Called out explicitly because `rasen validate` won't catch it.

## Migration Plan

Pure template/docs edit + parity-hash recompute + regeneration. No runtime state or data migration. Rollback = revert the template edit and restore prior hashes, re-run build → init --force. Existing on-disk run-states are unaffected (only how a NEW Windows successor window is launched changes).

## Open Questions

None. Root cause is web-confirmed and the fix is inline (profile-independent), satisfying the `-NoProfile` constraint that both Codex and our own relay impose.
