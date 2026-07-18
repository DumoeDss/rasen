## Context

The session-relay protocol (spec `session-relay`, playbook Step H.7) lets the LEAD launch its own successor: with explicit user authorization it spawns a visible interactive Claude Code window seeded with a file-indirected bootstrap prompt, then ends its own turn. The launch commands live in the rasen-handoff skill template `src/core/templates/workflows/handoff.ts` (lines ~52–54), one per platform:

- Windows: build `claude "$(Get-Content -Raw '<relay-prompt.txt>')"`, base64-encode, `Start-Process powershell ... -EncodedCommand`.
- macOS: write a `relay.command` script with `cd '<root>' && claude "$(cat '<relay-prompt.txt>')"`, then `open relay.command`.
- Linux: `gnome-terminal -- bash -lc 'cd <root> && claude "$(cat <abs path>)"'`.

All three spawn **bare `claude`**. A relay is authorized precisely so the successor can continue **unattended**, but a bare `claude` successor inherits none of the predecessor's permission grants — the first tool call that needs approval blocks with no human present. The manual fallback (printed when a spawn fails) prints the same bare command, so a user-launched successor has the same gap.

Separately, the orchestration playbook's Step H.7 names `codex resume [SESSION_ID] [PROMPT]` and `codex fork --last` as the candidate primitives for a future Codex-hosted LEAD relay, "named here only, not designed" (`_orchestration.ts` ~line 303). Those carry no permission-bypass guidance either.

Skills are GENERATED from these templates; shipped `skills/**/SKILL.md` must be regenerated via build → update, never hand-edited (project process, verified by the `workflow-template-parity` capability).

## Goals / Non-Goals

**Goals:**
- The spawned successor session starts with full permissions so an authorized, unattended relay runs without stalling on permission prompts.
- The manual-fallback launch command is identical to the spawned one (same flag), so a user who runs it themselves gets the same unattended-capable successor.
- Provide verified, copy-correct Codex relay guidance so a future Codex-hosted LEAD relay is also unattended-capable.
- Keep generated skills in sync with the edited templates.

**Non-Goals:**
- Designing the full Codex-hosted LEAD relay mechanism — only the permission-bypass flag is documented; the primitives stay "named, not fully designed".
- Changing the bootstrap-prompt delivery (file indirection / `-EncodedCommand`), the quiesce invariant, the generation cap, or any other relay behavior.
- Softening the flag to a scoped permission mode (`acceptEdits`); the requirement is FULL permissions for the unattended successor.
- Any version bump.

## Decisions

**D1 — Flag: `claude --dangerously-skip-permissions` on all three platform launch commands and the manual fallback.**
The successor becomes `claude --dangerously-skip-permissions "$(... relay-prompt.txt)"`. Chosen over `--permission-mode acceptEdits` because acceptEdits still prompts for non-edit actions (bash, network, etc.), which an unattended relay cannot answer; the user mandated full permissions. The flag goes on the manual-fallback command too so the two paths never diverge.

**D2 — Codex relay flag: `--dangerously-bypass-approvals-and-sandbox`.**
Verified LIVE on codex-cli 0.144.1 — the flag appears in `--help` for `codex` (interactive), `codex exec`, `codex resume`, AND `codex fork`. It is the direct Codex analogue of `--dangerously-skip-permissions`: "Skip all confirmation prompts and execute commands without sandboxing." No `--yolo` or `--full-auto` alias exists in this Codex version; this is the single canonical flag. Because the interactive relay primitives are `codex resume` / `codex fork`, and BOTH accept the flag, the documented Codex relay form is `codex resume [SESSION_ID] --dangerously-bypass-approvals-and-sandbox` (or `codex fork --last --dangerously-bypass-approvals-and-sandbox`). Note the interactive `codex resume` accepts `-s`/sandbox flags — distinct from the `codex exec resume` subcommand, which prior project research found rejects `-s`; the relay path is the interactive one, so the flag is valid there.

**D3 — Where the Codex guidance lives.**
Add it in TWO template spots, matching where the existing relay narrative and Codex mention already are:
1. `handoff.ts` Session-relay section — a short note that a Codex-hosted relay successor uses `--dangerously-bypass-approvals-and-sandbox`, parallel to the Claude flag.
2. `_orchestration.ts` Step H.7 Codex note — extend the existing "named here only" sentence to record the verified bypass flag the future mechanism would carry.
This keeps the Claude change and the Codex guidance co-located with the text they qualify, and updates both surfaces a reader might consult.

**D4 — Regeneration via build → update (not hand edits).**
After editing the templates, run the project's build then the update/generate step so `skills/**/SKILL.md` (rasen-handoff and any orchestration-carrying skill) regenerate. The `workflow-template-parity` capability treats generated files as build outputs; hand-editing them would drift. Tasks make this an explicit, verified step (grep the regenerated SKILL.md for the flag).

**D5 — Spec scope: one capability, `session-relay`, with two delta entries.**
The user-facing contract change is "the authorized relay successor launches with full permissions." That lands in `session-relay` as one MODIFIED requirement (Authorized session relay — the existing contract gains the full-permissions launch) plus one ADDED requirement (Cross-platform successor launch permissions — new cross-platform/Codex coverage that has no base-spec counterpart). The Codex note remains documentation of an as-yet-undesigned mechanism, not a separate capability — the added requirement references the documented Codex flag so the two-audience guidance is traceable. `orchestration-handoff` is not modified (it defers relay mechanics to `session-relay`).

## Risks / Trade-offs

- **[Full permissions is a real security posture, not cosmetic]** → Mitigation: the flag is only on the relay-spawn path, which the spec already gates behind explicit user authorization for unattended continuation; the flag scope matches the authorization scope. It is documented as intentional in the proposal and template comments so a future reader does not "helpfully" soften it.
- **[Codex flag could change across CLI versions]** → Mitigation: guidance names the verified version (codex-cli 0.144.1) and the flag's stable, self-describing name; it is documentation for a not-yet-built mechanism, so a future implementer re-verifies against the then-current `codex --help` (the same live-verify discipline this change used).
- **[Generated SKILL.md drift if regeneration is skipped]** → Mitigation: an explicit task runs build → update and greps the regenerated output for the flag; parity is verified, not assumed.
- **[Windows `-EncodedCommand` string must still encode correctly]** → Mitigation: the flag is added to the command string BEFORE base64 encoding, so the encoded payload is `claude --dangerously-skip-permissions "$(...)"`; no change to the encoding mechanism itself.

## Migration Plan

Pure template/docs edit plus regeneration; no runtime state, no data migration. Rollback is reverting the template edits and re-running build → update. Existing on-disk change run-states are unaffected (the flag only changes how a NEW successor is launched).

## Open Questions

None. The Claude flag is user-mandated; the Codex flag is live-verified on the installed CLI (0.144.1) across all four relevant (sub)commands.
