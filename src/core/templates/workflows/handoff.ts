/**
 * Handoff Rasen Workflow Command
 *
 * Writes a distilled handoff document so a fresh agent (a new session's LEAD,
 * or a successor worker) can continue the work without replaying the exhausted
 * agent's transcript. The document carries what the change-directory blackboard
 * cannot: decision rationale, eliminated hypotheses, dead ends, and the next
 * concrete action. Session-level use is manual (`/rasen:handoff`); worker-level
 * use is driven by the orchestration playbook's handoff protocol (Step H).
 */
import type { SkillTemplate, CommandTemplate } from '../types.js';
import { STORE_SELECTION_GUIDANCE } from './store-selection.js';

const HANDOFF_INSTRUCTIONS = `Write a handoff document — distill the current working context so a fresh agent can continue without replaying this conversation.

${STORE_SELECTION_GUIDANCE}

Context-window occupancy is measured, never guessed: \`rasen agent context --latest\` reads the exact API usage from the session transcript (\`--transcript <path>\` probes a specific worker transcript instead). The handoff document is a DISTILLATION CHECKPOINT on top of the change-directory blackboard, not a replacement for it — tasks.md ticks and on-disk artifacts stay the primary state; the document carries only what the blackboard cannot record.

## When to Use

Use when: "handoff", "交接", context usage is high and a fresh session is planned, before intentionally ending a long session mid-change, or when the orchestration playbook directs a worker to hand off mid-stage.

## Session-level flow (the default when a user invokes this)

1. **Probe first.** Run \`rasen agent context --latest --json\` and report \`{ contextTokens, limit, pct }\` to the user. This is informational — the user decides; do not refuse to hand off below any threshold.
2. **Select the change.** Use the active change being driven (infer from conversation / \`rasen list --json\`; prompt only if genuinely ambiguous). If no change is active, write the document to \`rasen/handoff/<topic-slug>.md\` instead and skip the run-state update (this repo-level fallback has no change scope and is unaffected by the rest of this section). Otherwise resolve \`workDir\` from \`rasen status --change <name> --json\`: process ephemera below is written there, falling back to the change directory when \`workDir\` is absent or the file already lives there (sticky-legacy).
3. **Write the document** to \`<workDir>/handoff/lead-<n>.md\` (fallback: \`rasen/changes/<name>/handoff/lead-<n>.md\`) where \`<n>\` is 1 + the highest existing lead-* number (never overwrite a predecessor). Use the template below.
4. **Update run-state** (\`<workDir>/auto-run.json\`, fallback: \`rasen/changes/<name>/auto-run.json\`): set top-level \`sessionHandoff\` to \`{ "path": "handoff/lead-<n>.md", "n": <n>, "pct": <probe pct>, "afterStage": "<last completed stage>", "at": "<ISO timestamp>" }\` — \`n\` is the relay generation and matches the document number (a record without \`n\` reads as generation 1). Create the file with just that field if no run-state exists yet.
5. **Offer to relay** (below the cap — see Session relay): ask whether to launch the successor session now. On yes, follow the Session relay protocol. On no — or when the generation cap is reached — fall back to manual resume:
6. **Tell the user how to resume manually**: start a fresh session and run \`/rasen:auto <change>\` (or \`rasen pipeline resume <change> --json\` manually) — resume reports the sessionHandoff pointer and the new LEAD reads the document FIRST, before any transcript warm-seeding.

## Session relay (launching the successor yourself)

With the user's authorization you can launch the successor instead of asking them to open a new session. Preconditions: the handoff document AND the run-state update are already on disk (spawn strictly after both), and no worker is in flight (stage boundary — every dispatched worker has returned \`DONE\`/\`HANDOFF\`).

**Generation cap.** Before spawning, check the generation: if the new document's \`n\` has reached \`maxRelays\` (the pipeline's resolved handoff config via \`rasen pipeline show <pipeline> --json\`, default 3), do NOT auto-spawn. Present the relay history (\`handoff/lead-*.md\`) and recommend decomposing the change instead — repeated session relays signal work that should be split, not relayed harder.

**Bootstrap prompt — file indirection, never bare quoting.** Write the successor's first instruction to \`<workDir>/handoff/relay-prompt.txt\` (fallback: \`rasen/changes/<name>/handoff/relay-prompt.txt\`):

\`\`\`
You are the successor session (generation <n+1>) for change <name>.
1. Read your predecessor's distillate at the handoff path reported above (lead-<n>.md); do not re-litigate its decisions.
2. Run: rasen pipeline resume <name> --json   (add --store <id> if the change lives in a store, or --project <id> if it lives in a project)
3. Continue from the document's "Next action". Workers from the previous session are gone (dead agentIds) — re-create any you need via the resume ladder (handoff doc, then recorded transcript, then change directory).
\`\`\`

NEVER inline the prompt into the spawn command as a bare quoted string: nested shell parsing strips the quotes and the successor receives only the text up to the first space (observed live — a non-ASCII prompt truncated to its first two characters). The file is the platform-neutral channel; on Windows, PowerShell \`-EncodedCommand\` (base64) is an equally safe shortcut.

**Spawn a visible interactive window** (never headless — the user must be able to watch and take over), from the project root:

- Windows (verified): build the command string \`[Console]::OutputEncoding=[Text.Encoding]::UTF8; [Console]::InputEncoding=[Text.Encoding]::UTF8; $OutputEncoding=[Text.Encoding]::UTF8; claude --dangerously-skip-permissions "$(Get-Content -Raw -Encoding UTF8 '<abs path to relay-prompt.txt>')"\`, base64-encode it (\`[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($cmd))\`), then \`Start-Process powershell -WorkingDirectory '<project root>' -ArgumentList '-NoProfile','-NoExit','-EncodedCommand',$enc\`. The flag goes BEFORE the \`"$(...)"\` so it survives the base64 \`-EncodedCommand\` wrapping. The \`-Encoding UTF8\` read and the \`[Console]::*Encoding\`/\`$OutputEncoding\` prefix defeat CJK mojibake: without them Windows PowerShell 5.1 decodes the BOM-less UTF-8 relay-prompt.txt as the system ANSI codepage (GBK/936 on a zh-CN machine) and the spawned console inherits codepage 936, so both the injected prompt and the successor CLI's own CJK output garble. Both fixes are INLINE in the encoded payload so they hold under \`-NoProfile\` (which our own launch passes and Codex hardcodes) — a \`$PROFILE\`-based fix would be dead on arrival. Belt-and-braces: write relay-prompt.txt (and any Windows-consumed handoff docs) as UTF-8 — a UTF-8 BOM additionally lets PS 5.1 auto-detect even without \`-Encoding\` — and prefer \`pwsh\` (PS 7, UTF-8 by default) when installed, falling back to \`powershell\` (5.1).
- macOS: write a small executable \`relay.command\` script containing \`cd '<project root>' && claude --dangerously-skip-permissions "$(cat '<abs path to relay-prompt.txt>')"\`, then \`open relay.command\`.
- Linux: \`gnome-terminal -- bash -lc 'cd <project root> && claude --dangerously-skip-permissions "$(cat <abs path>)"'\` (or \`konsole -e\` with the same body). macOS and Linux need no encoding change — they run in UTF-8 locales by default, so no mojibake arises there.

**Full permissions on the successor is intentional.** All three launches invoke \`claude --dangerously-skip-permissions\`, not bare \`claude\`: a relay is authorized precisely so the successor continues UNATTENDED, and a bare successor inherits none of the predecessor's permission grants — the first tool call needing approval would block with no human present. Do NOT soften this to a scoped mode (\`--permission-mode acceptEdits\`), which still prompts for bash/network/etc.; the requirement is full permissions for the unattended successor. (A Codex-hosted relay LEAD is the same story: its interactive \`codex resume [SESSION_ID]\` / \`codex fork --last\` relay primitives carry \`--dangerously-bypass-approvals-and-sandbox\`, the Codex analogue of \`--dangerously-skip-permissions\` — verified on codex-cli 0.144.1, accepted by both \`codex resume\` and \`codex fork\`. That mechanism is named, not yet designed. A future Windows Codex successor window uses the SAME inline UTF-8 console setup as the Claude Windows recipe above — the \`[Console]::*Encoding\`/\`$OutputEncoding\` prefix and the UTF-8 prompt read — so the two host recipes stay parallel and neither garbles CJK.)

**Fallback is always manual.** If the terminal form is unknown or the spawn errors, print the project root, the relay-prompt file path, and the exact launch command for the user to run themselves — the same \`claude --dangerously-skip-permissions "$(cat '<abs path to relay-prompt.txt>')"\` so a user-launched successor equals a spawned one — never retry headless.

**After the spawn**, end your turn: tell the user the successor window is up and this session can be closed. Do not keep working in the predecessor.

## Worker-level use (directed by the orchestration playbook)

A worker told to hand off mid-stage writes \`<workDir>/handoff/<role>-<n>.md\` (fallback: \`rasen/changes/<name>/handoff/<role>-<n>.md\`) with the same template, then returns the structured \`HANDOFF\` result to the LEAD. Workers NEVER update run-state — the LEAD does that accounting (single-writer invariant).

**Retired between child changes (\`retired-between-children\`).** When the orchestration playbook retires a warm worker BETWEEN dependent child changes (a cross-change re-staffing, not a mid-stage exhaustion) rather than reusing it, that worker writes the SAME document with reason \`retired-between-children\`, but its content focus shifts from "resume this task" to "transfer cross-change knowledge": lead with **Key decisions**, **Dead ends & gotchas**, and **Working set** — the conventions and traps the successor on the dependent child inherits — and leave **Remaining** empty (the change is complete; there is nothing to finish, only knowledge to carry forward). The template is unchanged — only the emphasis differs. The successor implementer on the dependent child is then dual-source seeded from this document plus the LEAD's dispatch brief. This \`retired-between-children\` document is also what the session-relay quiesce rule calls a held warm reuse candidate's **knowledge digest** — the same file, written before any session relay so the worker's cross-change knowledge survives the boundary.

## Handoff document template

\`\`\`markdown
# Handoff: <change> — <role> #<n>

## Original intent
<What the user actually asked for, verbatim where it matters — not "what I was doing".>

## Position
Pipeline: <name>. Completed stages: <...>. Current stage: <id> (<what part of it>).

## Done / Remaining
Done: <task ids/short labels — reference tasks.md, do not copy it>.
Remaining: <task ids + anything discovered that tasks.md does not list>.

## Key decisions (and why)
- <decision> — <rationale; the successor must not re-litigate or silently reverse these>

## Dead ends & gotchas
- <approach tried and abandoned — why; traps in the code/tooling that cost time>

## Eliminated hypotheses (MANDATORY for fixer/debugger roles)
- <hypothesis> — ruled out by <evidence>. Current best hypothesis: <...>.

## Working set
<Files touched / mid-edit; commands or test invocations that matter.>

## Next action
<The single concrete first step the successor should take.>
\`\`\`

Sections with nothing to say state "none" rather than being dropped — an explicit "no dead ends" is information. Write for a reader with ZERO shared context: no conversation shorthand, no unexplained labels.

## Guardrails

- Never overwrite an existing handoff document; numbering is append-only.
- The document must not contradict the blackboard — if tasks.md is stale, fix tasks.md rather than describing the divergence.
- Do not paste large code/diff bodies into the document; point at files and line ranges instead.
- Relay only with user authorization, only below the generation cap, and only after the document and run-state are on disk; bootstrap prompts travel via file indirection or \`-EncodedCommand\`, never bare quoted strings.`;

export function getHandoffSkillTemplate(): SkillTemplate {
  return {
    name: 'rasen-handoff',
    description:
      'Write a handoff document — probe context usage (rasen agent context), distill decisions / dead ends / eliminated hypotheses / next action to the change directory, and record the sessionHandoff pointer so a fresh session or successor worker resumes from the distillate instead of a raw transcript.',
    instructions: HANDOFF_INSTRUCTIONS,
    license: 'MIT',
    compatibility: 'Requires rasen CLI.',
    metadata: { author: 'rasen', version: '1.0' },
  };
}

export function getOpsxHandoffCommandTemplate(): CommandTemplate {
  return {
    name: 'Rasen: Handoff',
    description:
      'Write a handoff document distilling the current session or worker context so a fresh agent can continue the change',
    category: 'Workflow',
    tags: ['workflow', 'handoff', 'context', 'orchestration'],
    content: HANDOFF_INSTRUCTIONS,
  };
}
