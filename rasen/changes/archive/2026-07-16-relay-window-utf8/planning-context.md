# Planning Context — relay-window-utf8

## User intent (verbatim)

> Codex在Windows进行handoff时新开的窗口会有乱码，上网调查一下看能否修复 → 继续走auto修复，no gate，完成后push

Fix the Windows relay-window mojibake so a relayed successor (Claude or Codex) on a Chinese-locale Windows machine receives an intact UTF-8 bootstrap prompt and renders CJK correctly. After ship+archive, push the worktree branch (user-authorized delivery escalation covering this change AND the already-archived relay-launch-permissions).

## Root cause (LEAD-investigated, web-confirmed 2026-07-16)

Observed: successor Codex window on Windows shows classic UTF-8-bytes-read-as-GBK mojibake (`锛`=`：`, `浣`=`你`) in the injected prompt content; paths/ASCII intact.

- **Layer 1 (ours, the fix target):** `src/core/templates/workflows/handoff.ts` Windows relay recipe spawns Windows PowerShell 5.1 (`Start-Process powershell`) and reads the bootstrap prompt via `Get-Content -Raw '<path>'` with NO `-Encoding`. PS 5.1 decodes BOM-less files as the system ANSI codepage (GBK/936 on zh-CN), so the UTF-8 relay-prompt.txt is garbled at injection. The spawned console also stays at codepage 936, so the successor CLI's own CJK stdio/TUI output can garble too. (Microsoft docs: about_Character_Encoding; PS-console-CJK-garbled troubleshoot page.)
- **Layer 2 (Codex upstream, mitigate only):** codex hardcodes `-NoProfile` when invoking PowerShell tools (openai/codex#4498) so user-profile UTF-8 settings never load; assorted CJK output issues (#4574, #4431, #16542). Not fixable from our repo; our fix must not depend on profiles (and note: our own relay ALSO passes -NoProfile, so profile-based fixes are dead on arrival — the fix must be inline in the encoded command).

## Fix design (three-part, all in the Windows recipe of handoff.ts; check _orchestration.ts for any echo)

1. `Get-Content -Raw -Encoding UTF8 '<path>'` — pin the read encoding (accepted by PS 5.1 and 7).
2. Prefix the `-EncodedCommand` payload with console UTF-8 setup BEFORE launching the CLI: `[Console]::OutputEncoding=[Text.Encoding]::UTF8; [Console]::InputEncoding=[Text.Encoding]::UTF8; $OutputEncoding=[Text.Encoding]::UTF8; claude --dangerously-skip-permissions "$(Get-Content -Raw -Encoding UTF8 '<path>')"` (equivalent of chcp 65001, works under -NoProfile).
3. Belt-and-braces: instruct writing relay-prompt.txt (and handoff docs consumed on Windows) as UTF-8; note that a UTF-8 BOM makes PS 5.1 auto-detect even without -Encoding. Optionally note preferring `pwsh` (PS 7, UTF-8 default) when installed, falling back to `powershell`.

Scope note: the same UTF-8 console setup applies to a future Codex-hosted relay window (the Step H.7 / Session-relay Codex guidance added by relay-launch-permissions — keep the two notes consistent).

## Constraints / process facts (from the just-shipped relay-launch-permissions run — follow them)

- Template edits ripple: editing handoff.ts changes getHandoffSkillTemplate + getOpsxHandoffCommandTemplate + rasen-handoff generated skill; editing _orchestration.ts ripples to rasen-auto/rasen-review-cycle/rasen-goal. The parity test test/core/templates/skill-templates-parity.test.ts holds TWO hardcoded SHA256 snapshot maps (EXPECTED_FUNCTION_HASHES, EXPECTED_GENERATED_SKILL_CONTENT_HASHES) that MUST be legitimately recomputed on any template change.
- Regeneration in this worktree: `pnpm build` first (dist needed), then `node bin/rasen.js init --tools claude --force` (`rasen update` no-ops — no configured tools in a fresh worktree). Verify with greps.
- Tests: use `npx vitest run` (bare vitest not on PATH). Suite was 2692 passed / 0 failed at last ship.
- Spec target: `session-relay` capability (base spec now contains the two requirements landed by relay-launch-permissions). This change likely MODIFIES "Cross-platform successor launch permissions" (now in base) to add the encoding guarantee. Remember: `rasen validate` does NOT check MODIFIED-vs-base — get the delta label right (MODIFIED only for requirements present in base).
- No version bump. Gate policy: off (user). Delivery: after archive, push the worktree branch `worktree-handoff-relay-permissions` to origin (user-authorized).

## Durable findings (planner-2, 2026-07-16 — proposal complete)

- **Base spec state confirmed:** `rasen/specs/session-relay/spec.md` now holds BOTH requirements the prior change landed — "Cross-platform successor launch permissions" (line ~24) and the encoding is folded into it here. Delta label is MODIFIED (correct; ADDED would be wrong). `rasen validate` passed but does NOT check MODIFIED-vs-base, so the label was verified by hand-reading the base spec.
- **Spec home decision:** put the UTF-8 guarantee in MODIFIED "Cross-platform successor launch permissions" (not "Quote-safe bootstrap prompt delivery"). Rationale: encoding is a property of the platform launch COMMAND (the Windows recipe), which is what that requirement governs; keeps it to one modified requirement. Added 3 scenarios (CJK prompt intact, console renders CJK, fix holds without a profile).
- **Current Windows recipe (handoff.ts:52) verified:** `claude --dangerously-skip-permissions "$(Get-Content -Raw '<abs path>')"` launched via `Start-Process powershell -ArgumentList '-NoProfile','-NoExit','-EncodedCommand',$enc`. The `-NoProfile` is right there in OUR launch args — confirms firsthand that any profile-based fix is dead; fix must be inline in the payload. Fix touches exactly this one line (read `-Encoding UTF8`) plus a payload prefix.
- **Fix payload shape (design D2):** `[Console]::OutputEncoding=[Text.Encoding]::UTF8; [Console]::InputEncoding=[Text.Encoding]::UTF8; $OutputEncoding=[Text.Encoding]::UTF8; claude --dangerously-skip-permissions "$(Get-Content -Raw -Encoding UTF8 '<abs path>')"` → base64 to `-EncodedCommand` unchanged. Chose `[Console]::*Encoding` assignments over `chcp 65001` (PowerShell-native, in-process, also sets `$OutputEncoding` for text piped to native commands).
- **Artifacts written:** proposal.md, design.md, specs/session-relay/spec.md (1 MODIFIED requirement, 5 scenarios), tasks.md (4 groups). Change validates clean, isComplete: true.
