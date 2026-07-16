## 1. Edit the handoff template (session-relay launch commands)

- [x] 1.1 In `src/core/templates/workflows/handoff.ts`, Windows launch (Session-relay section, ~line 52): change the built command string from `claude "$(Get-Content -Raw '<...>')"` to `claude --dangerously-skip-permissions "$(Get-Content -Raw '<...>')"` — flag placed BEFORE the `"$(...)"` so it survives the base64 `-EncodedCommand` wrapping.
- [x] 1.2 In the same file, macOS launch (~line 53): change the `relay.command` body from `cd '<root>' && claude "$(cat '<...>')"` to `cd '<root>' && claude --dangerously-skip-permissions "$(cat '<...>')"`.
- [x] 1.3 In the same file, Linux launch (~line 54): change `gnome-terminal -- bash -lc 'cd <root> && claude "$(cat <abs path>)"'` to include `claude --dangerously-skip-permissions "$(cat <abs path>)"` (and the `konsole -e` variant in the same clause).
- [x] 1.4 In the "Fallback is always manual" paragraph (~line 56), ensure the exact launch command printed for the user carries `--dangerously-skip-permissions` too, so a user-launched successor equals a spawned one. Add a brief inline note that the flag is intentional for the authorized unattended relay (do not soften to a scoped permission mode).

## 2. Add Codex relay permission guidance

- [x] 2.1 In `src/core/templates/workflows/handoff.ts` Session-relay section, add a short note: a Codex-hosted relay successor uses `--dangerously-bypass-approvals-and-sandbox` (the Codex analogue of `--dangerously-skip-permissions`), accepted by the interactive `codex resume`/`codex fork` relay primitives.
- [x] 2.2 In `src/core/templates/workflows/_orchestration.ts` Step H.7 Codex note (the "codex resume [SESSION_ID] [PROMPT] / codex fork --last ... named here only, not designed" sentence, ~line 303), extend it to record the verified full-access flag `--dangerously-bypass-approvals-and-sandbox` that the future Codex relay would carry, keeping the "not fully designed" framing.

## 3. Regenerate generated skills (build → update, no hand edits)

- [x] 3.1 Run `pnpm build` (compiles `dist/` and runs `node build.js`).
- [x] 3.2 Run the skill-regeneration/update step (`node bin/rasen.js update`, or the project's dogfood update path) so the installed `.claude/skills/**/SKILL.md` files regenerate from the edited templates. Do NOT hand-edit any generated `SKILL.md`.
- [x] 3.3 Verify parity: `grep -R "dangerously-skip-permissions" .claude/skills/rasen-handoff/SKILL.md` returns the three platform launches + fallback; `grep -R "dangerously-bypass-approvals-and-sandbox" .claude/skills/rasen-handoff/SKILL.md .claude/skills/rasen-auto/SKILL.md` confirms the Codex note propagated to the handoff skill and the orchestration-carrying skills (rasen-auto/rasen-review-cycle/rasen-goal share `_orchestration.ts`).

## 4. Validate

- [x] 4.1 Run `rasen validate relay-launch-permissions --json` — change and delta spec parse clean.
- [x] 4.2 Run the repo test suite (`pnpm test`, or the workflow-template-parity test subset) to confirm generated-skill parity checks pass and no template snapshot is stale.
- [x] 4.3 Confirm no version bump occurred (`package.json` version unchanged) and no generated `SKILL.md` was hand-edited (only templates + regenerated output changed).
