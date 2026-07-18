## 1. Fix the Windows relay recipe (handoff.ts)

- [x] 1.1 In `src/core/templates/workflows/handoff.ts` Windows launch (Session-relay section), change the prompt read from `Get-Content -Raw '<path>'` to `Get-Content -Raw -Encoding UTF8 '<path>'` so PS 5.1 decodes the UTF-8 relay-prompt.txt as UTF-8, not the system ANSI codepage.
- [x] 1.2 In the same Windows recipe, prefix the built `-EncodedCommand` payload (before the `claude --dangerously-skip-permissions "$(...)"` launch) with the inline console UTF-8 setup: `[Console]::OutputEncoding=[Text.Encoding]::UTF8; [Console]::InputEncoding=[Text.Encoding]::UTF8; $OutputEncoding=[Text.Encoding]::UTF8;`. Keep the base64 `-EncodedCommand` encoding step unchanged — only the plaintext payload grows. The flag order (`--dangerously-skip-permissions` before `"$(...)"`) is preserved.
- [x] 1.3 Add belt-and-braces recipe guidance in the narrative: write `relay-prompt.txt` (and Windows-consumed handoff docs) as UTF-8; a UTF-8 BOM lets PS 5.1 auto-detect even without `-Encoding`; prefer `pwsh` (PS 7, UTF-8 default) when installed, falling back to `powershell`. Note macOS/Linux already default to UTF-8, so no command change there.

## 2. Keep the Codex-window note consistent

- [x] 2.1 In `src/core/templates/workflows/handoff.ts` Session-relay Codex note, add a one-line caveat that a future Windows Codex successor window uses the same UTF-8 console setup.
- [x] 2.2 In `src/core/templates/workflows/_orchestration.ts` Step H.7 Codex note, echo the same UTF-8-console caveat ONLY if that note references the window recipe (keep the two host recipes parallel). If _orchestration.ts is edited, remember it ripples to rasen-auto/rasen-review-cycle/rasen-goal generated skills (accounted for in the parity recompute below). — NOT edited: Step H.7 defers window-recipe mechanics to the rasen-handoff skill ("The mechanics ... live in the rasen-handoff skill's 'Session relay' section") and its Codex note covers only the `--dangerously-bypass-approvals-and-sandbox` permission flag, not the window/encoding recipe. Per design D4 the echo lands only if the note references the window recipe; it does not, so no ripple to rasen-auto/rasen-review-cycle/rasen-goal.

## 3. Regenerate skills and recompute parity hashes (build → init --force → recompute)

- [x] 3.1 Run `pnpm build` (compiles `dist/`, required before the CLI runs).
- [x] 3.2 Regenerate installed skills: `node bin/rasen.js init --tools claude --force` (`rasen update` no-ops in this fresh worktree — no configured tools). Do NOT hand-edit any generated `SKILL.md`.
- [x] 3.3 Recompute BOTH hardcoded SHA256 snapshot maps in `test/core/templates/skill-templates-parity.test.ts` — `EXPECTED_FUNCTION_HASHES` and `EXPECTED_GENERATED_SKILL_CONTENT_HASHES` — legitimately, from the freshly generated template/skill content (use the test's own hashing routine, not by copying stale values), for every function/skill the template edits touched (handoff.ts → getHandoffSkillTemplate + getOpsxHandoffCommandTemplate + rasen-handoff; _orchestration.ts if edited → rasen-auto/rasen-review-cycle/rasen-goal).
- [x] 3.4 Grep-verify parity: `grep -R "Encoding UTF8" .claude/skills/rasen-handoff/SKILL.md` and `grep -R "OutputEncoding" .claude/skills/rasen-handoff/SKILL.md` both hit; confirm the Windows recipe in the regenerated skill matches the edited template.

## 4. Validate

- [x] 4.1 Run `rasen validate relay-window-utf8 --json` — change and delta spec parse clean.
- [x] 4.2 Run the full suite `npx vitest run` (bare `vitest` not on PATH); the parity test passes with the recomputed hashes and no other test regresses (baseline was 2692 passed / 0 failed).
- [x] 4.3 Confirm no version bump (`package.json` version unchanged) and that only templates + regenerated output + the parity-hash maps changed (no generated `SKILL.md` hand-edited).
