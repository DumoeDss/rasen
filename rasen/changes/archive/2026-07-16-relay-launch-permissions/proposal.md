## Why

When the LEAD relays its own session (Step H.7 / the rasen-handoff "Session relay" section), it spawns a successor `claude` interactive window with a bare `claude` command. That successor starts with NONE of the predecessor's permission grants, so an unattended autopilot chain stalls on the first permission prompt with no human present to approve it — defeating the point of an automatic relay. The relay is only ever launched with explicit user authorization for unattended continuation, so the successor should inherit full permissions to match. The same gap exists for a future Codex-based relay LEAD, whose launch primitives are named in the playbook but carry no permission-bypass guidance.

## What Changes

- The three platform session-relay launch commands in the rasen-handoff skill template (`src/core/templates/workflows/handoff.ts`) launch the successor with `claude --dangerously-skip-permissions` instead of bare `claude`, so the relayed LEAD runs unattended with full permissions.
- The manual-fallback launch command printed when a spawn fails carries the same flag, so a user-launched successor is identical to a spawned one.
- Codex relay guidance is added: for a future Codex-hosted LEAD, the interactive `codex resume`/`codex fork` relay primitives carry `--dangerously-bypass-approvals-and-sandbox` (verified live on codex-cli 0.144.1 for `codex`, `codex exec`, `codex resume`, and `codex fork`). This is documented in the handoff template's Session-relay section and the orchestration playbook's Step H.7 Codex note (`src/core/templates/workflows/_orchestration.ts`), which today names those primitives "only, not designed".
- Generated skills output is regenerated from the templates via the build → update pipeline so shipped `SKILL.md` files stay in sync (generated files are never hand-edited).

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `session-relay`: the successor session launch requirement gains a full-permissions contract — the spawned (and manual-fallback) launch command starts the successor with permission prompts bypassed so an authorized, unattended relay proceeds without human approval, with the verified per-platform flag documented for both Claude (`--dangerously-skip-permissions`) and a Codex-hosted relay LEAD (`--dangerously-bypass-approvals-and-sandbox`).

## Impact

- **Templates (source of truth):** `src/core/templates/workflows/handoff.ts` (three platform launch commands + manual fallback + Session-relay narrative), `src/core/templates/workflows/_orchestration.ts` (Step H.7 Codex primitive note).
- **Generated artifacts:** regenerated `skills/` SKILL.md output (build → update); no hand edits.
- **Spec:** delta on `session-relay`.
- **No version bump** — template/docs-pipeline change; versions are user-owned.
- **Safety note:** `--dangerously-skip-permissions` is intentional and user-mandated for the unattended-successor case; it is not softened to `acceptEdits`. It only applies to the relay-spawn path, which already requires explicit user authorization.
