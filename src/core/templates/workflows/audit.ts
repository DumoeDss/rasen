/**
 * Audit Rasen Workflow Command
 *
 * Guidance layer for `rasen agent audit` (workflow-audit-command spec):
 * helps a user find the session id to audit, runs the command, offers to
 * open the viewer, and helps interpret the report — on both the Claude and
 * Codex runtimes. Diagnostic/optional: registered in BUILT_IN_WORKFLOW_IDS
 * (full profile) but NOT in CORE_WORKFLOW_IDS.
 */
import type { SkillTemplate } from '../types.js';
import { STORE_SELECTION_GUIDANCE } from './store-selection.js';

const AUDIT_INSTRUCTIONS = `Guide the user to a token-spend report for one of their own sessions, using \`rasen agent audit\`. **Experimental**: this command parses Claude Code's (or Codex CLI's) internal, undocumented session-log format — a harness update can make parsing fail without warning. Say so up front, don't bury it.

Local, pull-model, zero-upload: the user runs the command, the report lands on their own machine under \`~/.rasen/analytics/\` (or wherever \`--out\` points), and nothing is sent anywhere.

${STORE_SELECTION_GUIDANCE} \`rasen agent audit\` is one of those store/project-agnostic commands, same as \`rasen agent context\` — it never takes \`--store\`/\`--project\`; it resolves purely against a session id, a transcript path, or (for Codex) \`--runtime codex\` plus a thread id.

## 1. Identify the session

If the user already gave a session id or a transcript/rollout path, skip to step 2.

Otherwise, help them find one:
- **Current or most recent Claude Code session for this project**: the project's Claude transcripts directory is derived from the cwd (same slugging \`agent context\` uses); the newest \`*.jsonl\` file there (excluding \`agent-*.jsonl\` subagent files) is the one to audit. \`rasen agent context --latest --json\` will report on that same transcript and print its path if you need to confirm which file that is.
- **A Codex CLI session**: if the user mentions Codex, or the current tool is Codex, route to \`--runtime codex\` (see step 2) — Codex rollouts live under \`~/.codex/sessions/<Y>/<M>/<D>/rollout-*.jsonl\` (or \`CODEX_HOME\`), keyed by thread id rather than a Claude session id.
- If genuinely unsure which runtime or session, ask the user rather than guessing — a wrong \`--runtime\` guess just produces a resolution error, but confirming first is faster.

## 2. Run the audit

\`\`\`bash
rasen agent audit <sessionId|path>                       # Claude session (default runtime)
rasen agent audit <threadId|path/to/rollout.jsonl> --runtime codex   # Codex session
\`\`\`

Useful flags: \`--projects-dir <dir>\` (override the Claude projects directory a bare id resolves against), \`--out <path>\` (write the report somewhere other than the default \`analytics\` directory), \`--json\` (machine-readable output), \`--open\` (open the shipped viewer pre-loaded with the report — offer this every time; it's the fastest way to actually look at the result).

On success, the command prints the report's file path and a one-line totals summary — relay both to the user.

## 3. Interpreting the report

**Claude report** — talk in these terms:
- **Billed input equivalent**: \`raw input + cache-write × TTL-coefficient + cache-read × 0.1\` — the main session's cache writes cost 2× (1h TTL), a subagent's cost 1.25× (5m TTL). This is what actually drove the bill, not raw token counts.
- **Churn**: cache rewrites, broken down by cause — \`ttl-expiry\` (idle past the tier's TTL), \`rebase\` (a forked conversation branch or an injected message, e.g. SendMessage), \`context-drop\` (compaction/rewind shrank the context), \`unattributed\` (none of those fingerprints matched). This is usually where the "why did this cost so much" answer lives — point the user at whichever cause dominates.
- **Resumes HIT/MISS**: how many request bursts continued warm vs. paid a rewrite.

**Codex report** — different vocabulary, do NOT use Claude's terms here (no billed-input-equivalent, no churn-cause taxonomy — Codex's cache/pricing model has neither):
- **Raw token totals**: input, cached input, output, reasoning output, per agent/turn.
- **Cache hit ratio**: \`cachedInputTokens / inputTokens\` — the health signal Codex offers in place of churn-cause attribution.
- Turns are grouped by \`task_started\`/\`task_complete\` boundaries, tokens attributed by the change in Codex's cumulative usage counter (not by summing every stream update, which would overcount).

If asked for detail beyond the summary, offer \`--open\` (or point at the printed JSON path to drag onto \`viewer/audit.html\` manually) rather than trying to hand-render the full timeline in chat.

## 4. When the command fails

Relay the actual error and next step — do not invent a cause:
- **Ambiguous session id prefix**: the error names the matches; ask the user to supply more of the id, or a direct path.
- **Format-drift** (\`transcript format not recognized\`): this is the experimental-format risk materializing — say so plainly, note the harness may have updated its log format since this command was last verified against it, and suggest filing feedback (\`rasen feedback\`) if it keeps happening. Don't attempt to patch or work around the parse failure yourself.
- **No transcript matching**: check the session id and, if relevant, \`--projects-dir\`/\`--runtime\`.

## Guardrails

- Disclose the experimental status before or alongside the first command you run — not buried at the end.
- Never fabricate a dollar cost for a Codex report; Codex has no validated pricing formula the way Claude's TTL model does (see the report's own field names — Codex reports raw totals, not a billed-equivalent).
- If the command fails, relay its message; don't diagnose the transcript format yourself.`;

export function getAuditSkillTemplate(): SkillTemplate {
  return {
    name: 'rasen-audit',
    description: "Diagnose a Claude Code or Codex CLI session's token spend — local, pull-model audit with churn-cause breakdown (Claude) or raw totals and cache-hit ratio (Codex). Experimental: parses an internal transcript format.",
    instructions: AUDIT_INSTRUCTIONS,
    license: 'MIT',
    compatibility: 'Requires rasen CLI.',
    metadata: { author: 'rasen', version: '1.0' },
  };
}
